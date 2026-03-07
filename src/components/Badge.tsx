import { ReactNode } from 'react';

type Variant = 'red' | 'amber' | 'green' | 'blue' | 'gray' | 'purple';

const VARIANTS: Record<Variant, string> = {
  red:    'bg-red-50 text-red-700 border-red-200',
  amber:  'bg-amber-50 text-amber-700 border-amber-200',
  green:  'bg-green-50 text-green-700 border-green-200',
  blue:   'bg-blue-50 text-blue-700 border-blue-200',
  gray:   'bg-slate-100 text-slate-600 border-slate-200',
  purple: 'bg-purple-50 text-purple-700 border-purple-200',
};

export function Badge({
  children,
  variant,
}: {
  children: ReactNode;
  variant: Variant;
}) {
  return (
    <span
      className={`inline-flex items-center px-2 py-0.5 rounded-full border text-[11px] font-semibold uppercase tracking-wide ${VARIANTS[variant]}`}
    >
      {children}
    </span>
  );
}

// ─── Convenience helpers ───────────────────────────────────────────────────────

export function SeverityBadge({ severity }: { severity: string }) {
  const map: Record<string, Variant> = { High: 'red', Medium: 'amber', Low: 'green' };
  return <Badge variant={map[severity] ?? 'gray'}>{severity}</Badge>;
}

export function PriorityBadge({ priority }: { priority: string }) {
  const map: Record<string, Variant> = { High: 'red', Medium: 'amber', Low: 'green' };
  return <Badge variant={map[priority] ?? 'gray'}>{priority}</Badge>;
}

export function StatusBadge({ status }: { status: string }) {
  const map: Record<string, Variant> = {
    'Yet to Act': 'blue',
    Acted: 'green',
    Deferred: 'amber',
  };
  return <Badge variant={map[status] ?? 'gray'}>{status}</Badge>;
}

export function ScanStatusBadge({ status }: { status: string }) {
  const map: Record<string, Variant> = {
    Running: 'blue',
    Completed: 'green',
    Failed: 'red',
  };
  return <Badge variant={map[status] ?? 'gray'}>{status}</Badge>;
}

export function CallTypeBadge({ type }: { type: string }) {
  const map: Record<string, Variant> = {
    KeywordExtraction: 'blue',
    Cannibalization: 'amber',
    ContentImprovement: 'green',
  };
  return <Badge variant={map[type] ?? 'gray'}>{type}</Badge>;
}

export function ScoreBadge({ score }: { score: number | null }) {
  if (score === null) return <span className="text-muted text-xs">—</span>;
  const variant: Variant = score >= 8 ? 'green' : score >= 5 ? 'amber' : 'red';
  return <Badge variant={variant}>{score}/10</Badge>;
}
