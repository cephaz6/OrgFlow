import type { SessionUser } from '../auth';

export interface UserSummaryProps {
  user: SessionUser;
}

// Two words at most, so "Local Dev User" reads LD rather than LDU. A single
// word contributes one letter rather than being sliced in half.
export function initialsOf(displayName: string): string {
  const words = displayName.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) {
    return '?';
  }
  return words
    .slice(0, 2)
    .map((word) => word[0]!.toUpperCase())
    .join('');
}

export function UserSummary({ user }: UserSummaryProps) {
  return (
    <span className="flex items-center gap-2">
      {/* Decorative: the initials are a compressed form of the name shown
          beside them, so announcing both would repeat the same
          information in a less useful form. */}
      <span
        aria-hidden="true"
        className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-accent text-xs font-medium text-accent-foreground"
      >
        {initialsOf(user.displayName)}
      </span>
      <span className="hidden text-sm sm:inline">{user.displayName}</span>
    </span>
  );
}
