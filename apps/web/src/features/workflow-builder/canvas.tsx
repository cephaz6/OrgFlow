'use client';

import '@xyflow/react/dist/style.css';

import {
  Background,
  Controls,
  Handle,
  Position,
  ReactFlow,
  type Edge,
  type Node,
  type NodeProps,
} from '@xyflow/react';
import type { WorkflowStep } from '@orgflow/types';
import { cn } from '@orgflow/ui';
import { useMemo } from 'react';

import { computeLayout } from './layout';
import { DECISION_LABELS, isTerminalKey, STEP_TYPE_LABELS, TERMINAL_LABELS } from './step-defaults';

export interface CanvasProps {
  steps: WorkflowStep[];
  startStepKey: string;
  selectedStepKey: string | null;
  onSelect: (stepKey: string) => void;
}

const COLUMN_WIDTH = 260;
const ROW_HEIGHT = 110;

interface StepNodeData extends Record<string, unknown> {
  label: string;
  sublabel: string;
  isStart: boolean;
  isTerminal: boolean;
  isSelected: boolean;
  isReachable: boolean;
}

function StepNode({ data }: NodeProps<Node<StepNodeData>>) {
  return (
    <div
      className={cn(
        'rounded-md border-2 bg-card px-3 py-2 text-sm shadow-sm',
        data.isTerminal
          ? 'border-dashed border-muted-foreground'
          : data.isSelected
            ? 'border-primary'
            : data.isReachable
              ? 'border-border'
              : 'border-warning',
      )}
      style={{ width: COLUMN_WIDTH - 40 }}
    >
      <Handle type="target" position={Position.Left} className="bg-muted-foreground!" />
      <p className="font-medium">
        {data.label}
        {data.isStart ? <span className="ms-2 text-xs text-muted-foreground">(start)</span> : null}
      </p>
      <p className="text-xs text-muted-foreground">{data.sublabel}</p>
      {!data.isTerminal && !data.isReachable ? (
        <p className="mt-1 text-xs text-warning-subtle-foreground">Not reachable</p>
      ) : null}
      <Handle type="source" position={Position.Right} className="bg-muted-foreground!" />
    </div>
  );
}

const NODE_TYPES = { step: StepNode };

function assignmentSummary(step: WorkflowStep): string {
  const assignment = step.assignment;
  if (assignment.strategy === 'role') {
    return `Role: ${assignment.role}`;
  }
  if (assignment.strategy === 'group') {
    return `Group: ${assignment.groupKey}`;
  }
  return STEP_TYPE_LABELS[step.type];
}

// PRD.md §13.2: live validation highlighted on the canvas itself, not only
// in a separate panel, so unreachable steps and orphaned branches show
// exactly where they are wrong. React Flow supplies the rendering; the
// layout (which node goes in which column) is computeLayout's, kept
// separate so it can be unit tested without a DOM.
export function Canvas({ steps, startStepKey, selectedStepKey, onSelect }: CanvasProps) {
  const { nodes, edges } = useMemo(() => {
    const layout = computeLayout(steps, startStepKey);
    const stepByKey = new Map(steps.map((step) => [step.key, step]));

    const flowNodes: Node<StepNodeData>[] = layout.nodes.map((node) => {
      const step = stepByKey.get(node.key);
      return {
        id: node.key,
        type: 'step',
        position: { x: node.layer * COLUMN_WIDTH, y: node.index * ROW_HEIGHT },
        data: {
          label: step
            ? step.name
            : (TERMINAL_LABELS[node.key as keyof typeof TERMINAL_LABELS] ?? node.key),
          sublabel: step ? assignmentSummary(step) : 'Outcome',
          isStart: node.key === startStepKey,
          isTerminal: node.isTerminal,
          isSelected: node.key === selectedStepKey,
          isReachable: node.reachable,
        },
        draggable: false,
        selectable: Boolean(step),
      };
    });

    const flowEdges: Edge[] = layout.edges.map((edge) => ({
      id: edge.id,
      source: edge.from,
      target: edge.to,
      label: `${DECISION_LABELS[edge.decision as keyof typeof DECISION_LABELS] ?? edge.decision}${edge.isDefault ? '' : ' (if...)'}`,
      animated: false,
      style: { stroke: 'var(--color-muted-foreground)' },
      labelStyle: { fill: 'var(--color-foreground)', fontSize: 11 },
      labelBgStyle: { fill: 'var(--color-card)' },
    }));

    return { nodes: flowNodes, edges: flowEdges };
  }, [steps, startStepKey, selectedStepKey]);

  return (
    <div
      className="h-130 rounded-lg border border-border bg-background"
      role="img"
      aria-label="Workflow diagram. Use the list view to edit by keyboard."
    >
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={NODE_TYPES}
        onNodeClick={(_event, node) => {
          if (!isTerminalKey(node.id)) {
            onSelect(node.id);
          }
        }}
        fitView
        nodesConnectable={false}
        elementsSelectable
        panOnScroll
        proOptions={{ hideAttribution: true }}
      >
        <Background />
        <Controls showInteractive={false} />
      </ReactFlow>
    </div>
  );
}
