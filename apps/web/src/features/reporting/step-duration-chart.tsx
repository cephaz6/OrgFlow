'use client';

import type { StepDuration } from '@orgflow/types';
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';

export interface StepDurationChartProps {
  steps: StepDuration[];
}

function formatHours(hours: number): string {
  return hours < 24 ? `${hours.toFixed(1)}h` : `${(hours / 24).toFixed(1)}d`;
}

// PRD.md §17.1 names step duration explicitly as "the bottleneck view."
// Sorted slowest-first, since that is the order the acceptance criteria
// (docs/PRD.md Phase 8: "slowest step is visible per process") asks for.
// The visually-hidden table is the same accessible-text-equivalent pattern
// VolumeChart uses, including its accessibilityLayer={false} for the same
// aria-hidden-focus reason recorded there.
export function StepDurationChart({ steps }: StepDurationChartProps) {
  const sorted = [...steps].sort((a, b) => b.meanDurationHours - a.meanDurationHours);

  if (sorted.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        Not enough completed steps in this period to show a duration breakdown.
      </p>
    );
  }

  return (
    <div>
      <div aria-hidden="true" className="h-64 w-full">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart
            data={sorted}
            layout="vertical"
            margin={{ left: 24 }}
            accessibilityLayer={false}
          >
            <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
            <XAxis
              type="number"
              tickFormatter={(value: number) => formatHours(value)}
              stroke="var(--muted-foreground)"
              fontSize={12}
            />
            <YAxis
              type="category"
              dataKey="stepName"
              width={140}
              stroke="var(--muted-foreground)"
              fontSize={12}
            />
            <Tooltip
              formatter={(value) => (typeof value === 'number' ? formatHours(value) : value)}
              contentStyle={{
                background: 'var(--popover)',
                border: '1px solid var(--border)',
                color: 'var(--popover-foreground)',
              }}
            />
            <Bar
              dataKey="meanDurationHours"
              name="Mean duration"
              fill="var(--warning)"
              radius={[0, 4, 4, 0]}
            />
          </BarChart>
        </ResponsiveContainer>
      </div>
      <table className="sr-only">
        <caption>Step duration, slowest first</caption>
        <thead>
          <tr>
            <th scope="col">Step</th>
            <th scope="col">Mean duration</th>
            <th scope="col">Median duration</th>
            <th scope="col">Sample size</th>
          </tr>
        </thead>
        <tbody>
          {sorted.map((step) => (
            <tr key={step.stepKey}>
              <td>{step.stepName}</td>
              <td>{formatHours(step.meanDurationHours)}</td>
              <td>{formatHours(step.medianDurationHours)}</td>
              <td>{step.sampleSize}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
