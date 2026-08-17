import type { WorkflowStep } from '@orgflow/types';

import { isTerminalKey } from './step-defaults';

export interface LayoutNode {
  key: string;
  layer: number;
  index: number;
  isTerminal: boolean;
  reachable: boolean;
}

export interface LayoutEdge {
  id: string;
  from: string;
  to: string;
  decision: string;
  ruleIndex: number;
  isDefault: boolean;
}

export interface LayoutResult {
  nodes: LayoutNode[];
  edges: LayoutEdge[];
}

// A layered layout by distance from startStepKey, computed here rather than
// with a general graph library: the graph is small (a handful of steps) and
// close to a DAG by construction, so breadth-first layering is enough, and
// it keeps the canvas free of an extra dependency beyond @xyflow/react
// itself. Steps unreachable from startStepKey (a real defect the validation
// panel also flags) still get a layer, pushed one column past everything
// reachable, so the canvas never silently drops a step the process owner
// needs to see and fix.
export function computeLayout(steps: WorkflowStep[], startStepKey: string): LayoutResult {
  const stepByKey = new Map(steps.map((step) => [step.key, step]));
  const layerByKey = new Map<string, number>();
  const edges: LayoutEdge[] = [];

  const queue: string[] = [];
  if (stepByKey.has(startStepKey) || isTerminalKey(startStepKey)) {
    layerByKey.set(startStepKey, 0);
    queue.push(startStepKey);
  }

  // Bounded rather than a plain while(queue.length): a workflow document
  // hand-edited outside the builder could contain a cycle, which would
  // otherwise loop forever recomputing layers.
  let iterations = 0;
  const maxIterations = (steps.length + 1) * 8;

  while (queue.length > 0 && iterations < maxIterations) {
    iterations += 1;
    const key = queue.shift()!;
    const step = stepByKey.get(key);
    if (!step) {
      continue;
    }
    const currentLayer = layerByKey.get(key) ?? 0;

    for (const [decision, rules] of Object.entries(step.transitions)) {
      rules.forEach((rule, ruleIndex) => {
        edges.push({
          id: `${key}:${decision}:${ruleIndex}`,
          from: key,
          to: rule.to,
          decision,
          ruleIndex,
          isDefault: rule.when === null,
        });

        const nextLayer = currentLayer + 1;
        const existing = layerByKey.get(rule.to);
        if (existing === undefined || nextLayer > existing) {
          layerByKey.set(rule.to, nextLayer);
          if (stepByKey.has(rule.to)) {
            queue.push(rule.to);
          }
        }
      });
    }
  }

  const reachedKeys = new Set(layerByKey.keys());
  const maxReachedLayer = Math.max(0, ...Array.from(layerByKey.values()));

  // Every real step, reachable or not, and every terminal key actually
  // referenced by an edge or used as startStepKey: nothing else belongs on
  // the canvas.
  const allKeys = new Set<string>([
    ...stepByKey.keys(),
    ...edges.map((edge) => edge.to),
    startStepKey,
  ]);

  const nodesByLayer = new Map<number, string[]>();
  for (const key of allKeys) {
    const reachable = reachedKeys.has(key);
    const layer = reachable ? layerByKey.get(key)! : maxReachedLayer + 1;
    const list = nodesByLayer.get(layer) ?? [];
    list.push(key);
    nodesByLayer.set(layer, list);
  }

  const nodes: LayoutNode[] = [];
  for (const [layer, keys] of nodesByLayer) {
    keys.forEach((key, index) => {
      nodes.push({
        key,
        layer,
        index,
        isTerminal: isTerminalKey(key),
        reachable: reachedKeys.has(key),
      });
    });
  }

  return { nodes, edges };
}
