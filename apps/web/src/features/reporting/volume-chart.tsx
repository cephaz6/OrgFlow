'use client';

import type { VolumeBucket } from '@orgflow/types';
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';

import { formatDate } from '../../lib/format';

export interface VolumeChartProps {
  volume: VolumeBucket[];
}

interface PeriodTotal {
  periodStart: string;
  count: number;
}

function aggregateByPeriod(volume: VolumeBucket[]): PeriodTotal[] {
  const totals = new Map<string, number>();
  for (const bucket of volume) {
    totals.set(bucket.periodStart, (totals.get(bucket.periodStart) ?? 0) + bucket.count);
  }
  return [...totals.entries()]
    .map(([periodStart, count]) => ({ periodStart, count }))
    .sort((a, b) => a.periodStart.localeCompare(b.periodStart));
}

// Recharts renders an SVG with no text equivalent of its own, so this
// pairs the chart with a visually-hidden table carrying the same numbers
// (WCAG 2.2 AA non-text content), rather than the chart being the only
// place the data exists.
//
// accessibilityLayer is off deliberately. Recharts 3 turns it on by
// default, which puts tabIndex={0} on the chart surface; inside this
// aria-hidden wrapper that produces a focus stop announcing nothing, which
// axe reports as aria-hidden-focus (serious). The table below is the
// accessible path, so the chart has no business being in the tab order.
export function VolumeChart({ volume }: VolumeChartProps) {
  const totals = aggregateByPeriod(volume);

  if (totals.length === 0) {
    return <p className="text-sm text-muted-foreground">No cases were submitted in this period.</p>;
  }

  return (
    <div>
      <div aria-hidden="true" className="h-64 w-full">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={totals} accessibilityLayer={false}>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
            <XAxis
              dataKey="periodStart"
              tickFormatter={(value: string) => formatDate(value)}
              stroke="var(--muted-foreground)"
              fontSize={12}
            />
            <YAxis allowDecimals={false} stroke="var(--muted-foreground)" fontSize={12} />
            <Tooltip
              labelFormatter={(value) => (typeof value === 'string' ? formatDate(value) : value)}
              contentStyle={{
                background: 'var(--popover)',
                border: '1px solid var(--border)',
                color: 'var(--popover-foreground)',
              }}
            />
            <Bar
              dataKey="count"
              name="Cases submitted"
              fill="var(--primary)"
              radius={[4, 4, 0, 0]}
            />
          </BarChart>
        </ResponsiveContainer>
      </div>
      <table className="sr-only">
        <caption>Cases submitted by period</caption>
        <thead>
          <tr>
            <th scope="col">Period</th>
            <th scope="col">Cases submitted</th>
          </tr>
        </thead>
        <tbody>
          {totals.map((row) => (
            <tr key={row.periodStart}>
              <td>{formatDate(row.periodStart)}</td>
              <td>{row.count}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
