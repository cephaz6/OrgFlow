import { CheckCircle2, Gauge, Timer } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

export interface TurnaroundSummaryProps {
  completionRate: number | null;
  medianTurnaroundHours: number | null;
  p90TurnaroundHours: number | null;
}

function formatPercent(rate: number | null): string {
  return rate === null ? 'No data' : `${Math.round(rate * 100)}%`;
}

function formatHours(hours: number | null): string {
  if (hours === null) {
    return 'No data';
  }
  return hours < 24 ? `${hours.toFixed(1)} hours` : `${(hours / 24).toFixed(1)} days`;
}

function Tile({ icon: Icon, label, value }: { icon: LucideIcon; label: string; value: string }) {
  return (
    <div className="flex flex-col gap-2 rounded-lg border border-border p-4">
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Icon aria-hidden="true" className="h-4 w-4" />
        {label}
      </div>
      <span className="text-2xl font-semibold">{value}</span>
    </div>
  );
}

// PRD.md §17.1's three headline numbers, as stat tiles rather than a
// chart: a single value has nothing a chart adds, and CLAUDE.md §3's
// "status is never conveyed by colour alone" is satisfied for free here,
// since every tile already pairs an icon with a text label and value.
export function TurnaroundSummary({
  completionRate,
  medianTurnaroundHours,
  p90TurnaroundHours,
}: TurnaroundSummaryProps) {
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
      <Tile icon={CheckCircle2} label="Completion rate" value={formatPercent(completionRate)} />
      <Tile icon={Timer} label="Median turnaround" value={formatHours(medianTurnaroundHours)} />
      <Tile icon={Gauge} label="p90 turnaround" value={formatHours(p90TurnaroundHours)} />
    </div>
  );
}
