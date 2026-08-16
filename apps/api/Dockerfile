# Built from the repository root, not from apps/api: pnpm-workspace.yaml
# and the pnpm-lock.yaml a workspace install needs live there, and
# @orgflow/api depends on five workspace packages (core, db, documents,
# events, types) that only exist alongside it in the monorepo.
#
#   docker build -f apps/api/Dockerfile -t orgflow-api .
#
# Four stages, the shape `turbo prune` exists for: the first two isolate
# exactly the workspace slice apps/api needs (its own source plus the
# packages it depends on, nothing else), so neither the install layer nor
# the final image carries apps/web, workers, or infra.

FROM node:22-slim AS base
RUN corepack enable

# Stage 1: compute the pruned workspace. `turbo prune` reads the real
# dependency graph rather than a hand-maintained list, so a new
# @orgflow/* dependency apps/api picks up later is included automatically.
FROM base AS pruner
WORKDIR /app
COPY . .
RUN npx turbo prune @orgflow/api --docker

# --ignore-scripts on both installs below: the root package.json's own
# `prepare` script runs `husky`, a devDependency that git hook setup has no
# business needing inside a container that only ever runs `node dist/index.js`.
# Nothing @orgflow/api depends on needs a native postinstall build step.
#
# Stage 2: install and build using only the pruned files. Split into two
# COPY layers, as the prune output does, so `pnpm install` is cached
# unless a package.json actually changed, not on every source edit.
FROM base AS builder
WORKDIR /app
COPY --from=pruner /app/out/json/ .
RUN pnpm install --frozen-lockfile --ignore-scripts
COPY --from=pruner /app/out/full/ .
# `turbo prune` walks package.json dependencies, not tsconfig `extends`
# targets, so it never carries tsconfig.base.json even though every pruned
# package's tsconfig points at it; without this the build fails with
# TS5083, "Cannot read file '/app/tsconfig.base.json'".
COPY tsconfig.base.json .
RUN npx turbo build --filter=@orgflow/api

# Stage 3: production dependencies only, no devDependencies, no build
# toolchain (typescript, vitest, tsx) carried into the runtime image.
FROM base AS deps
WORKDIR /app
COPY --from=pruner /app/out/json/ .
RUN pnpm install --frozen-lockfile --prod --ignore-scripts

# Stage 4: runtime. No source, no node_modules beyond production
# dependencies, no build tools; only compiled dist/ output runs.
FROM node:22-slim AS runner
WORKDIR /app

# GOV-STANDARDS.md §7 / CIS Docker Benchmark: never run application code
# as root inside the container. node:22-slim ships a non-root `node` user
# already; reused rather than creating a new one.
RUN chown -R node:node /app
USER node

# pnpm places the workspace symlinks (@orgflow/db -> ../../../packages/db)
# inside the *consuming package's own* node_modules, not the root one, so
# both have to be copied: root node_modules holds the real third-party
# packages (express, kysely, mongodb...), apps/api/node_modules holds the
# five symlinks that resolve to the packages/ directory copied below. A
# build that copied only the root node_modules looked complete and then
# failed at boot with ERR_MODULE_NOT_FOUND for @orgflow/db, since the
# symlink it needed was never there to find.
COPY --from=deps --chown=node:node /app/node_modules ./node_modules
COPY --from=deps --chown=node:node /app/apps/api/node_modules ./apps/api/node_modules
COPY --from=deps --chown=node:node /app/apps/api/package.json ./apps/api/package.json
COPY --from=builder --chown=node:node /app/apps/api/dist ./apps/api/dist

# packages/ is copied whole from the builder stage rather than as a
# per-package glob: Docker's COPY does not preserve the <name> path
# segment when several `packages/*/dist`-style matches share a directory
# above them, so `packages/db/dist` and `packages/core/dist` would collide
# into the same destination. Copying the directory once side-steps that;
# the extra weight is each package's own node_modules and TypeScript
# source sitting next to its compiled dist, acceptable for a skeleton not
# yet tuned for image size.
COPY --from=builder --chown=node:node /app/packages ./packages

WORKDIR /app/apps/api

# ADR-0001: every value in ORGFLOW_ config comes from the environment at
# runtime (ECS task definition secrets and environment variables in a
# deployed environment); nothing is baked into the image.
ENV NODE_ENV=production
EXPOSE 4000

CMD ["node", "dist/index.js"]
