'use client';

import { useState, useEffect, useMemo } from 'react';
import { useSearchParams } from 'next/navigation';
import type { SerpURL, URLMetric } from '@/lib/types';

// ── helpers ──────────────────────────────────────────────────────────────────

function todayStr() { return new Date().toISOString().split('T')[0]; }
function daysAgoStr(n: number) {
  const d = new Date(); d.setDate(d.getDate() - n);
  return d.toISOString().split('T')[0];
}
function pathOf(url: string) { try { return new URL(url).pathname; } catch { return url; } }

// ── trend helpers ─────────────────────────────────────────────────────────────

type Trend = 'improved' | 'declined' | 'stable' | 'new' | 'none';

function getTrend(metrics: URLMetric[]): Trend {
  const withSerp = metrics.filter((m) => m.SERPPosition != null).sort((a, b) => a.RecordedDate.localeCompare(b.RecordedDate));
  if (withSerp.length === 0) return 'none';
  if (withSerp.length === 1) return 'new';
  const first = withSerp[0].SERPPosition!;
  const last  = withSerp[withSerp.length - 1].SERPPosition!;
  if (last < first) return 'improved';  // lower rank number = better
  if (last > first) return 'declined';
  return 'stable';
}

function getLatestSerp(metrics: URLMetric[]): number | null {
  const sorted = metrics.filter((m) => m.SERPPosition != null).sort((a, b) => b.RecordedDate.localeCompare(a.RecordedDate));
  return sorted[0]?.SERPPosition ?? null;
}
function getPrevSerp(metrics: URLMetric[]): number | null {
  const sorted = metrics.filter((m) => m.SERPPosition != null).sort((a, b) => b.RecordedDate.localeCompare(a.RecordedDate));
  return sorted[1]?.SERPPosition ?? null;
}
function getLatestVolume(metrics: URLMetric[]): number | null {
  const sorted = metrics.filter((m) => m.SearchVolume != null).sort((a, b) => b.RecordedDate.localeCompare(a.RecordedDate));
  return sorted[0]?.SearchVolume ?? null;
}

// ── small components ─────────────────────────────────────────────────────────

function Spinner() {
  return <div className="w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin inline-block" />;
}

function PriorityBadge({ p }: { p: string | null }) {
  if (!p) return null;
  const s: Record<string, string> = { High: 'bg-red-100 text-red-700', Medium: 'bg-yellow-100 text-yellow-700', Low: 'bg-green-100 text-green-700' };
  return <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold ${s[p] ?? 'bg-surface2 text-muted'}`}>{p}</span>;
}

function SerpBadge({ pos }: { pos: number | null }) {
  if (pos == null) return <span className="text-muted text-sm">—</span>;
  const cls = pos <= 3 ? 'bg-green-100 text-green-700' : pos <= 10 ? 'bg-blue-100 text-blue-700' : pos <= 20 ? 'bg-yellow-100 text-yellow-700' : 'bg-surface2 text-muted';
  return <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-bold ${cls}`}>#{pos}</span>;
}

function TrendBadge({ trend, delta }: { trend: Trend; delta: number | null }) {
  if (trend === 'none') return <span className="text-muted text-xs">No data</span>;
  if (trend === 'new')  return <span className="text-xs text-blue-600 font-medium">New</span>;
  if (trend === 'stable') return <span className="text-xs text-muted font-medium">→ Stable</span>;
  const improved = trend === 'improved';
  return (
    <span className={`inline-flex items-center gap-1 text-xs font-semibold ${improved ? 'text-green-600' : 'text-red-600'}`}>
      {improved ? '↑' : '↓'}
      {delta != null && <span>{Math.abs(delta)} pos</span>}
    </span>
  );
}

// ── Sparkline SVG ─────────────────────────────────────────────────────────────

function Sparkline({ metrics }: { metrics: URLMetric[] }) {
  const pts = metrics.filter((m) => m.SERPPosition != null).sort((a, b) => a.RecordedDate.localeCompare(b.RecordedDate));
  if (pts.length < 2) return <span className="text-muted text-xs italic">—</span>;

  const W = 80, H = 28;
  const positions = pts.map((p) => p.SERPPosition!);
  const minP = Math.min(...positions), maxP = Math.max(...positions), range = maxP - minP || 1;

  // Lower SERP position = better = drawn higher on chart
  const toY = (v: number) => ((v - minP) / range) * H;
  const toX = (i: number) => (i / (pts.length - 1)) * W;

  const polyPts = pts.map((p, i) => `${toX(i).toFixed(1)},${toY(p.SERPPosition!).toFixed(1)}`).join(' ');

  const trend = getTrend(metrics);
  const color = trend === 'improved' ? '#16a34a' : trend === 'declined' ? '#dc2626' : '#6b7280';

  return (
    <svg width={W} height={H} className="overflow-visible flex-shrink-0">
      <polyline points={polyPts} fill="none" stroke={color} strokeWidth={1.8} strokeLinejoin="round" strokeLinecap="round" />
      <circle cx={toX(pts.length - 1)} cy={toY(pts[pts.length - 1].SERPPosition!)} r={2.5} fill={color} />
    </svg>
  );
}

// ── Full SERP + Volume SVG chart ──────────────────────────────────────────────

function SERPChart({ metrics }: { metrics: URLMetric[] }) {
  const data = metrics.filter((m) => m.SERPPosition != null).sort((a, b) => a.RecordedDate.localeCompare(b.RecordedDate));
  if (data.length < 2) {
    return (
      <div className="text-center py-6 text-muted text-sm">
        {data.length === 0 ? 'No SERP data to chart yet.' : 'Need at least 2 data points to show chart.'}
      </div>
    );
  }

  const W = 560, H = 180;
  const PAD = { top: 20, right: 20, bottom: 38, left: 42 };
  const cW = W - PAD.left - PAD.right;
  const cH = H - PAD.top - PAD.bottom;

  const positions = data.map((d) => d.SERPPosition!);
  const minP = Math.min(...positions), maxP = Math.max(...positions);
  const range = maxP - minP || 1;
  const pad = range * 0.2;

  const toY = (v: number) => PAD.top + ((v - (minP - pad)) / (range + pad * 2)) * cH;
  const toX = (i: number) => PAD.left + (data.length === 1 ? cW / 2 : (i / (data.length - 1)) * cW);

  const pathD = data.map((d, i) => `${i === 0 ? 'M' : 'L'} ${toX(i).toFixed(1)} ${toY(d.SERPPosition!).toFixed(1)}`).join(' ');
  const areaD = `${pathD} L ${toX(data.length - 1).toFixed(1)} ${(PAD.top + cH).toFixed(1)} L ${PAD.left} ${(PAD.top + cH).toFixed(1)} Z`;

  // Y ticks: 4 evenly spaced SERP values
  const yTicks = Array.from({ length: 4 }, (_, i) => Math.round(minP + (range / 3) * i));
  // X ticks: max 6 labels
  const step = Math.max(1, Math.ceil(data.length / 6));
  const xTicks = data.filter((_, i) => i % step === 0 || i === data.length - 1);

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto">
      {/* Area fill */}
      <path d={areaD} fill="#3b82f6" fillOpacity={0.07} />
      {/* Horizontal grid lines */}
      {yTicks.map((v, i) => (
        <line key={i} x1={PAD.left} y1={toY(v)} x2={PAD.left + cW} y2={toY(v)} stroke="#f3f4f6" strokeWidth={1} />
      ))}
      {/* SERP line */}
      <path d={pathD} fill="none" stroke="#3b82f6" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
      {/* Dots */}
      {data.map((d, i) => (
        <circle key={i} cx={toX(i)} cy={toY(d.SERPPosition!)} r={3.5} fill="#3b82f6" stroke="white" strokeWidth={1.5} />
      ))}
      {/* Y-axis labels */}
      {yTicks.map((v, i) => (
        <text key={i} x={PAD.left - 6} y={toY(v) + 4} textAnchor="end" fontSize={10} fill="#9ca3af">#{v}</text>
      ))}
      {/* X-axis labels */}
      {xTicks.map((d, i) => {
        const origIdx = data.indexOf(d);
        return (
          <text key={i} x={toX(origIdx)} y={H - 6} textAnchor="middle" fontSize={10} fill="#9ca3af">
            {d.RecordedDate.slice(5)}
          </text>
        );
      })}
      {/* Axes */}
      <line x1={PAD.left} y1={PAD.top} x2={PAD.left} y2={PAD.top + cH} stroke="#e5e7eb" strokeWidth={1} />
      <line x1={PAD.left} y1={PAD.top + cH} x2={PAD.left + cW} y2={PAD.top + cH} stroke="#e5e7eb" strokeWidth={1} />
      {/* Y-axis label */}
      <text x={11} y={PAD.top + cH / 2} textAnchor="middle" fontSize={9} fill="#9ca3af"
        transform={`rotate(-90, 11, ${PAD.top + cH / 2})`}>SERP Pos</text>
      {/* "Higher = better rank" note */}
      <text x={PAD.left + cW} y={PAD.top - 4} textAnchor="end" fontSize={9} fill="#9ca3af">↓ lower = better rank</text>
    </svg>
  );
}

function VolumeChart({ metrics }: { metrics: URLMetric[] }) {
  const data = metrics.filter((m) => m.SearchVolume != null).sort((a, b) => a.RecordedDate.localeCompare(b.RecordedDate));
  if (data.length === 0) return null;

  const W = 560, H = 90;
  const PAD = { top: 10, right: 20, bottom: 30, left: 42 };
  const cW = W - PAD.left - PAD.right;
  const cH = H - PAD.top - PAD.bottom;

  const vols = data.map((d) => d.SearchVolume!);
  const maxV = Math.max(...vols) || 1;
  const barW = Math.max(2, (cW / data.length) - 2);
  const step = Math.max(1, Math.ceil(data.length / 6));

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto">
      {data.map((d, i) => {
        const x = PAD.left + (i / data.length) * cW + (cW / data.length - barW) / 2;
        const barH = (d.SearchVolume! / maxV) * cH;
        const y = PAD.top + cH - barH;
        return (
          <g key={i}>
            <rect x={x} y={y} width={barW} height={barH} fill="#8b5cf6" fillOpacity={0.75} rx={1} />
            {(i % step === 0 || i === data.length - 1) && (
              <text x={x + barW / 2} y={H - 6} textAnchor="middle" fontSize={10} fill="#9ca3af">
                {d.RecordedDate.slice(5)}
              </text>
            )}
          </g>
        );
      })}
      {/* Y label */}
      <text x={11} y={PAD.top + cH / 2} textAnchor="middle" fontSize={9} fill="#9ca3af"
        transform={`rotate(-90, 11, ${PAD.top + cH / 2})`}>Volume</text>
      <text x={PAD.left - 6} y={PAD.top + 4}  textAnchor="end" fontSize={9} fill="#9ca3af">{maxV.toLocaleString()}</text>
      <text x={PAD.left - 6} y={PAD.top + cH} textAnchor="end" fontSize={9} fill="#9ca3af">0</text>
      <line x1={PAD.left} y1={PAD.top} x2={PAD.left} y2={PAD.top + cH} stroke="#e5e7eb" strokeWidth={1} />
      <line x1={PAD.left} y1={PAD.top + cH} x2={PAD.left + cW} y2={PAD.top + cH} stroke="#e5e7eb" strokeWidth={1} />
    </svg>
  );
}

// ── Add Entry form (inline) ────────────────────────────────────────────────────

function AddEntryForm({ urlId, onSaved, onCancel }: { urlId: number; onSaved: (m: URLMetric) => void; onCancel: () => void }) {
  const [date,   setDate]   = useState(todayStr());
  const [serp,   setSerp]   = useState('');
  const [vol,    setVol]    = useState('');
  const [notes,  setNotes]  = useState('');
  const [saving, setSaving] = useState(false);
  const [error,  setError]  = useState('');

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true); setError('');
    try {
      const res = await fetch(`/api/urls/${urlId}/metrics`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ recordedDate: date, serpPosition: serp || null, searchVolume: vol || null, notes: notes || null }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed');
      onSaved(data.metric);
    } catch (err: any) { setError(err.message); }
    finally { setSaving(false); }
  }

  const inp = 'px-3 py-2 rounded-xl border border-border bg-surface text-sm text-ink focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary transition';

  return (
    <form onSubmit={handleSave} className="bg-surface2 rounded-xl p-4 border border-border">
      <p className="text-sm font-semibold text-ink mb-3">Add / Update Entry</p>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div>
          <label className="block text-xs font-medium text-ink-2 mb-1">Date <span className="text-danger">*</span></label>
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className={`w-full ${inp}`} />
        </div>
        <div>
          <label className="block text-xs font-medium text-ink-2 mb-1">SERP Position</label>
          <input type="number" value={serp} onChange={(e) => setSerp(e.target.value)} placeholder="e.g. 3" min={1} max={200} className={`w-full ${inp}`} />
        </div>
        <div>
          <label className="block text-xs font-medium text-ink-2 mb-1">Search Volume / mo</label>
          <input type="number" value={vol} onChange={(e) => setVol(e.target.value)} placeholder="e.g. 1200" min={0} className={`w-full ${inp}`} />
        </div>
        <div>
          <label className="block text-xs font-medium text-ink-2 mb-1">Notes</label>
          <input type="text" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="optional" className={`w-full ${inp}`} />
        </div>
      </div>
      {error && <p className="mt-2 text-xs text-danger">{error}</p>}
      <div className="flex gap-2 mt-3">
        <button type="submit" disabled={saving}
          className="flex items-center gap-1.5 px-4 py-1.5 bg-primary hover:bg-blue-600 text-white text-xs font-semibold rounded-xl transition-colors disabled:opacity-60">
          {saving ? <><Spinner /> Saving…</> : 'Save Entry'}
        </button>
        <button type="button" onClick={onCancel}
          className="px-4 py-1.5 border border-border text-ink-2 text-xs rounded-xl hover:bg-surface2 transition-colors">
          Cancel
        </button>
      </div>
    </form>
  );
}

// ── URL Row (collapsible) ─────────────────────────────────────────────────────

function URLRow({ url, onMetricAdded }: { url: SerpURL; onMetricAdded: (urlId: number, m: URLMetric) => void }) {
  const [expanded, setExpanded] = useState(false);
  const [showForm, setShowForm] = useState(false);

  const trend   = getTrend(url.metrics);
  const latest  = getLatestSerp(url.metrics);
  const prev    = getPrevSerp(url.metrics);
  const latVol  = getLatestVolume(url.metrics);
  const delta   = latest != null && prev != null ? latest - prev : null;
  const lastDate = url.metrics.length > 0
    ? url.metrics.sort((a, b) => b.RecordedDate.localeCompare(a.RecordedDate))[0].RecordedDate
    : null;

  // Data table (sorted newest first)
  const sortedMetrics = [...url.metrics].sort((a, b) => b.RecordedDate.localeCompare(a.RecordedDate));

  return (
    <div className="border border-border rounded-xl overflow-hidden">
      {/* Collapsed row */}
      <div
        className="flex items-center gap-3 px-4 py-3 bg-surface hover:bg-surface2/50 transition-colors cursor-pointer"
        onClick={() => setExpanded((e) => !e)}
      >
        {/* URL + keyword */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-mono text-sm text-ink truncate">{pathOf(url.PageURL)}</span>
            <PriorityBadge p={url.Priority} />
          </div>
          {url.PrimaryKeyword && (
            <p className="text-xs text-muted mt-0.5">{url.PrimaryKeyword}</p>
          )}
        </div>

        {/* Sparkline */}
        <div className="hidden sm:flex items-center">
          <Sparkline metrics={url.metrics} />
        </div>

        {/* Trend */}
        <div className="w-24 text-center flex-shrink-0">
          <TrendBadge trend={trend} delta={delta} />
        </div>

        {/* Latest SERP */}
        <div className="w-16 text-center flex-shrink-0">
          <SerpBadge pos={latest} />
          {prev != null && delta != null && (
            <div className={`text-xs mt-0.5 ${delta < 0 ? 'text-green-600' : delta > 0 ? 'text-red-600' : 'text-muted'}`}>
              {delta < 0 ? `↑ was #${prev}` : delta > 0 ? `↓ was #${prev}` : `= #${prev}`}
            </div>
          )}
        </div>

        {/* Search Volume */}
        <div className="w-20 text-center flex-shrink-0 font-mono text-sm text-ink hidden md:block">
          {latVol != null ? latVol.toLocaleString() : <span className="text-muted">—</span>}
        </div>

        {/* Last date */}
        <div className="w-20 text-right flex-shrink-0 text-xs text-muted hidden lg:block">
          {lastDate ?? '—'}
        </div>

        {/* Count + chevron */}
        <div className="flex items-center gap-2 flex-shrink-0">
          <span className="text-xs text-muted bg-surface2 px-1.5 py-0.5 rounded-full">{url.metrics.length}</span>
          <svg className={`w-4 h-4 text-muted transition-transform ${expanded ? 'rotate-180' : ''}`}
            fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
          </svg>
        </div>
      </div>

      {/* Expanded section */}
      {expanded && (
        <div className="border-t border-border bg-surface2/30 p-4 space-y-4">

          {/* Charts */}
          <div className="space-y-2">
            <p className="text-xs font-semibold text-ink-2 uppercase tracking-wide">SERP Position Over Time</p>
            <div className="bg-surface rounded-xl border border-border p-3">
              <SERPChart metrics={url.metrics} />
            </div>
          </div>

          {url.metrics.some((m) => m.SearchVolume != null) && (
            <div className="space-y-2">
              <p className="text-xs font-semibold text-ink-2 uppercase tracking-wide">Search Volume Over Time</p>
              <div className="bg-surface rounded-xl border border-border p-3">
                <VolumeChart metrics={url.metrics} />
              </div>
            </div>
          )}

          {/* Data table */}
          {sortedMetrics.length > 0 && (
            <div className="bg-surface rounded-xl border border-border overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border bg-surface2">
                    <th className="text-left   px-4 py-2 text-xs font-semibold text-ink-2 uppercase tracking-wide">Date</th>
                    <th className="text-center px-4 py-2 text-xs font-semibold text-ink-2 uppercase tracking-wide">SERP</th>
                    <th className="text-center px-4 py-2 text-xs font-semibold text-ink-2 uppercase tracking-wide">vs Prev</th>
                    <th className="text-center px-4 py-2 text-xs font-semibold text-ink-2 uppercase tracking-wide">Volume</th>
                    <th className="text-left   px-4 py-2 text-xs font-semibold text-ink-2 uppercase tracking-wide hidden sm:table-cell">Notes</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {sortedMetrics.map((m, idx) => {
                    const nextM = sortedMetrics[idx + 1]; // previous chronologically
                    const serpDelta = m.SERPPosition != null && nextM?.SERPPosition != null
                      ? m.SERPPosition - nextM.SERPPosition : null;
                    return (
                      <tr key={m.MetricID} className="hover:bg-surface2/50 transition-colors">
                        <td className="px-4 py-2 font-mono text-sm text-ink">{m.RecordedDate}</td>
                        <td className="px-4 py-2 text-center"><SerpBadge pos={m.SERPPosition} /></td>
                        <td className="px-4 py-2 text-center text-xs font-semibold">
                          {serpDelta == null ? <span className="text-muted">—</span>
                            : serpDelta < 0 ? <span className="text-green-600">↑ {Math.abs(serpDelta)}</span>
                            : serpDelta > 0 ? <span className="text-red-600">↓ {serpDelta}</span>
                            : <span className="text-muted">=</span>}
                        </td>
                        <td className="px-4 py-2 text-center font-mono text-sm text-ink">
                          {m.SearchVolume != null ? m.SearchVolume.toLocaleString() : <span className="text-muted">—</span>}
                        </td>
                        <td className="px-4 py-2 text-sm text-muted hidden sm:table-cell">{m.Notes ?? '—'}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          {/* Add entry */}
          {showForm ? (
            <AddEntryForm
              urlId={url.URLID}
              onSaved={(m) => { onMetricAdded(url.URLID, m); setShowForm(false); }}
              onCancel={() => setShowForm(false)}
            />
          ) : (
            <button
              onClick={(e) => { e.stopPropagation(); setShowForm(true); }}
              className="flex items-center gap-1.5 px-4 py-2 bg-primary hover:bg-blue-600 text-white text-sm font-semibold rounded-xl transition-colors"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
              </svg>
              Add Entry
            </button>
          )}
        </div>
      )}
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function SERPTrackerPage() {
  const searchParams    = useSearchParams();
  const [urls,          setUrls]          = useState<SerpURL[]>([]);
  const [loading,       setLoading]       = useState(true);
  const [needsSetup,    setNeedsSetup]    = useState(false);
  const [dateFrom,      setDateFrom]      = useState(daysAgoStr(90));
  const [dateTo,        setDateTo]        = useState(todayStr());
  const [filterPriority,setFilterPriority]= useState('all');
  const [search,        setSearch]        = useState(() => searchParams.get('q') ?? '');
  const [onlyWithData,  setOnlyWithData]  = useState(() => !searchParams.get('q'));

  async function fetchData() {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (dateFrom) params.set('from', dateFrom);
      if (dateTo)   params.set('to',   dateTo);
      if (filterPriority !== 'all') params.set('priority', filterPriority);
      if (onlyWithData) params.set('onlyData', '1');

      const res  = await fetch(`/api/serp?${params}`);
      const data = await res.json();
      if (data.needsSetup) { setNeedsSetup(true); }
      else { setUrls(data.urls ?? []); setNeedsSetup(false); }
    } catch (err) { console.error(err); }
    finally { setLoading(false); }
  }

  useEffect(() => { fetchData(); }, [dateFrom, dateTo, filterPriority, onlyWithData]);  // eslint-disable-line react-hooks/exhaustive-deps

  function handleMetricAdded(urlId: number, metric: URLMetric) {
    setUrls((prev) => prev.map((u) => {
      if (u.URLID !== urlId) return u;
      const exists = u.metrics.some((m) => m.RecordedDate === metric.RecordedDate);
      return {
        ...u,
        metrics: exists
          ? u.metrics.map((m) => m.RecordedDate === metric.RecordedDate ? metric : m)
          : [...u.metrics, metric].sort((a, b) => a.RecordedDate.localeCompare(b.RecordedDate)),
      };
    }));
  }

  // Filtered list
  const filtered = useMemo(() => {
    if (!search) return urls;
    const q = search.toLowerCase();
    return urls.filter((u) =>
      u.PageURL.toLowerCase().includes(q) ||
      (u.PrimaryKeyword ?? '').toLowerCase().includes(q) ||
      (u.SecondaryKeywords ?? '').toLowerCase().includes(q)
    );
  }, [urls, search]);

  // Summary stats
  const stats = useMemo(() => {
    const tracked   = filtered.filter((u) => u.metrics.some((m) => m.SERPPosition != null)).length;
    const improved  = filtered.filter((u) => getTrend(u.metrics) === 'improved').length;
    const declined  = filtered.filter((u) => getTrend(u.metrics) === 'declined').length;
    const allSerps  = filtered.flatMap((u) => u.metrics.map((m) => m.SERPPosition)).filter((v): v is number => v != null);
    const avgSerp   = allSerps.length > 0 ? (allSerps.reduce((a, b) => a + b, 0) / allSerps.length) : null;
    return { tracked, improved, declined, avgSerp };
  }, [filtered]);

  if (loading) return (
    <div className="flex items-center gap-2 text-muted animate-fade-slide"><Spinner /> Loading SERP data…</div>
  );

  return (
    <div className="animate-fade-slide space-y-6">

      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold font-display text-ink">SERP Tracker</h1>
        <p className="text-muted text-sm mt-1">Track search engine rankings and volume over time · Add URLs via <a href="/urls" className="text-primary hover:underline">URL Registry</a></p>
      </div>

      {/* Setup needed */}
      {needsSetup && (
        <div className="bg-blue-50 border border-blue-200 rounded-2xl p-6 text-center space-y-3">
          <p className="font-semibold text-ink">Metrics table not set up yet</p>
          <p className="text-muted text-sm">Go to <strong>URL Registry → Import / Migrate</strong> to create the metrics table first.</p>
        </div>
      )}

      {!needsSetup && (
        <>
          {/* Filters */}
          <div className="bg-surface rounded-2xl border border-border p-4 space-y-3">
            <div className="flex flex-wrap gap-3 items-end">
              {/* Date range */}
              <div className="flex items-end gap-2">
                <div>
                  <label className="block text-xs font-medium text-ink-2 mb-1">From</label>
                  <input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)}
                    className="px-3 py-2 rounded-xl border border-border bg-surface2 text-sm text-ink focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary transition" />
                </div>
                <span className="text-muted text-sm pb-2">—</span>
                <div>
                  <label className="block text-xs font-medium text-ink-2 mb-1">To</label>
                  <input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)}
                    className="px-3 py-2 rounded-xl border border-border bg-surface2 text-sm text-ink focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary transition" />
                </div>
              </div>

              {/* Quick presets */}
              <div className="flex gap-1 pb-0.5">
                {[['30d', 30], ['90d', 90], ['6m', 180], ['1y', 365]] .map(([label, days]) => (
                  <button key={label} onClick={() => { setDateFrom(daysAgoStr(Number(days))); setDateTo(todayStr()); }}
                    className="text-xs px-2.5 py-1.5 rounded-lg border border-border text-muted hover:text-ink hover:border-primary/40 transition-colors">
                    {label}
                  </button>
                ))}
              </div>

              {/* Priority */}
              <div className="flex gap-1 pb-0.5">
                {(['all', 'High', 'Medium', 'Low'] as const).map((p) => (
                  <button key={p} onClick={() => setFilterPriority(p)}
                    className={`text-xs px-3 py-1.5 rounded-full border font-medium transition-colors
                      ${filterPriority === p ? 'bg-primary text-white border-primary' : 'bg-surface text-muted border-border hover:border-primary/40 hover:text-ink'}`}>
                    {p === 'all' ? 'All Priority' : p}
                  </button>
                ))}
              </div>

              {/* Only with data toggle */}
              <label className="flex items-center gap-2 cursor-pointer pb-0.5 ml-auto">
                <div className="relative">
                  <input type="checkbox" checked={onlyWithData} onChange={(e) => setOnlyWithData(e.target.checked)} className="sr-only" />
                  <div className={`w-9 h-5 rounded-full transition-colors ${onlyWithData ? 'bg-primary' : 'bg-surface2 border border-border'}`}>
                    <div className={`w-3.5 h-3.5 bg-white rounded-full shadow transition-transform mt-0.5 ${onlyWithData ? 'translate-x-4' : 'translate-x-0.5'}`} />
                  </div>
                </div>
                <span className="text-sm text-ink-2">Only tracked URLs</span>
              </label>
            </div>

            {/* Search */}
            <div className="relative max-w-sm">
              <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
              </svg>
              <input type="text" value={search} onChange={(e) => setSearch(e.target.value)}
                placeholder="Search URLs or keywords…"
                className="w-full pl-9 pr-4 py-2 rounded-xl border border-border bg-surface2 text-sm text-ink focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary transition" />
            </div>
          </div>

          {/* Summary stats */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            {[
              { label: 'URLs Tracked',  value: stats.tracked,                    color: 'text-ink' },
              { label: 'Avg SERP Pos',  value: stats.avgSerp != null ? `#${stats.avgSerp.toFixed(1)}` : '—', color: 'text-blue-600' },
              { label: '↑ Improved',    value: stats.improved,                   color: 'text-green-600' },
              { label: '↓ Declined',    value: stats.declined,                   color: 'text-red-600' },
            ].map(({ label, value, color }) => (
              <div key={label} className="bg-surface rounded-2xl border border-border p-4">
                <p className="text-xs text-muted font-medium uppercase tracking-wide">{label}</p>
                <p className={`text-2xl font-bold font-display mt-1 ${color}`}>{value}</p>
              </div>
            ))}
          </div>

          {/* URL list */}
          {filtered.length === 0 ? (
            <div className="text-center py-16 text-muted">
              <svg className="w-10 h-10 mx-auto mb-3 text-border" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
              </svg>
              <p className="font-medium text-ink">No URLs found</p>
              <p className="text-sm mt-1">
                {urls.length === 0
                  ? <>No URLs added yet. Go to <a href="/urls" className="text-primary hover:underline">URL Registry</a> to add URLs for tracking.</>
                  : onlyWithData
                    ? 'No URLs have SERP data yet. Run the Python sync, or turn off "Only tracked URLs" to see all.'
                    : 'No URLs match your filters.'}
              </p>
            </div>
          ) : (
            <div className="space-y-2">
              {/* Column headers */}
              <div className="hidden sm:flex items-center gap-3 px-4 pb-1 text-xs font-semibold text-muted uppercase tracking-wide">
                <div className="flex-1">URL / Keyword</div>
                <div className="w-20 text-center hidden sm:block">Trend</div>
                <div className="w-24 text-center">Trend</div>
                <div className="w-16 text-center">SERP</div>
                <div className="w-20 text-center hidden md:block">Volume</div>
                <div className="w-20 text-right hidden lg:block">Last Entry</div>
                <div className="w-14" />
              </div>

              {filtered.map((u) => (
                <URLRow key={u.URLID} url={u} onMetricAdded={handleMetricAdded} />
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
