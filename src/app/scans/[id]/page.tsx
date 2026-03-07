'use client';

import { useEffect, useRef, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import type {
  Scan,
  PageKeyword,
  CannibalizationIssue,
  ContentImprovement,
  ClaudeCallLog,
} from '@/lib/types';
import {
  ScanStatusBadge,
  SeverityBadge,
  PriorityBadge,
  StatusBadge,
  CallTypeBadge,
  ScoreBadge,
  Badge,
} from '@/components/Badge';

// ─── Helpers ──────────────────────────────────────────────────────────────────

type Tab = 'keywords' | 'cannibalization' | 'content' | 'calls';

function fmtDate(d: string | null) {
  if (!d) return '—';
  return new Date(d).toLocaleString('en-GB', {
    day: 'numeric', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}

function groupBy<T>(arr: T[], key: (item: T) => string): Record<string, T[]> {
  return arr.reduce<Record<string, T[]>>((acc, item) => {
    const k = key(item) || 'Uncategorised';
    (acc[k] = acc[k] || []).push(item);
    return acc;
  }, {});
}

// ─── Status selector (inline) ─────────────────────────────────────────────────

function IssueStatusRow({
  id,
  type,
  currentStatus,
  currentComment,
  onUpdated,
}: {
  id: number;
  type: 'cannibalization' | 'improvement';
  currentStatus: string;
  currentComment: string | null;
  onUpdated: (status: string, comment: string) => void;
}) {
  const [status, setStatus] = useState(currentStatus);
  const [comment, setComment] = useState(currentComment ?? '');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const save = async () => {
    setSaving(true);
    try {
      const res = await fetch(`/api/issues/${type}/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status, comment: comment || null }),
      });
      if (res.ok) {
        setSaved(true);
        onUpdated(status, comment);
        setTimeout(() => setSaved(false), 2000);
      }
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex flex-wrap items-center gap-2 mt-3 pt-3 border-t border-border/60">
      <select
        value={status}
        onChange={(e) => setStatus(e.target.value)}
        className="text-xs px-3 py-1.5 rounded-lg border border-border bg-surface2 text-ink focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary"
      >
        <option value="Yet to Act">Yet to Act</option>
        <option value="Acted">Acted</option>
        <option value="Deferred">Deferred</option>
      </select>
      <input
        type="text"
        value={comment}
        onChange={(e) => setComment(e.target.value)}
        placeholder="Add comment…"
        className="flex-1 min-w-[160px] text-xs px-3 py-1.5 rounded-lg border border-border bg-surface2 text-ink placeholder:text-muted focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary"
      />
      <button
        onClick={save}
        disabled={saving}
        className="text-xs px-3 py-1.5 rounded-lg bg-primary hover:bg-blue-600 text-white font-medium disabled:opacity-50 transition-colors"
      >
        {saving ? 'Saving…' : saved ? '✓ Saved' : 'Save'}
      </button>
    </div>
  );
}

// ─── Keywords Tab ─────────────────────────────────────────────────────────────

function KeywordsTab({ scanId }: { scanId: number }) {
  const [rows, setRows] = useState<PageKeyword[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch(`/api/scans/${scanId}/keywords`)
      .then((r) => r.json())
      .then((d) => { setRows(d); setLoading(false); });
  }, [scanId]);

  if (loading) return <Spinner />;
  if (rows.length === 0) return <Empty msg="No keyword data for this scan." />;

  return (
    <div className="overflow-x-auto rounded-xl border border-border">
      <table className="w-full text-sm">
        <thead>
          <tr className="bg-surface2 border-b border-border">
            <th className="text-left px-4 py-3 text-muted font-medium">Tree</th>
            <th className="text-left px-4 py-3 text-muted font-medium">URL</th>
            <th className="text-left px-4 py-3 text-muted font-medium">Primary Keyword</th>
            <th className="text-left px-4 py-3 text-muted font-medium">Intent</th>
            <th className="text-center px-4 py-3 text-muted font-medium">Score</th>
            <th className="text-left px-4 py-3 text-muted font-medium">Secondary</th>
            <th className="text-left px-4 py-3 text-muted font-medium">Gaps</th>
            <th className="text-left px-4 py-3 text-muted font-medium">Missing LSI</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((kw) => (
            <tr key={kw.KeywordID} className="border-b border-border/50 hover:bg-surface2 transition-colors">
              <td className="px-4 py-3">
                {kw.TreeCluster && (
                  <Badge variant="purple">{kw.TreeCluster}</Badge>
                )}
              </td>
              <td className="px-4 py-3 max-w-[220px]">
                <a
                  href={kw.PageURL}
                  target="_blank"
                  rel="noreferrer"
                  className="text-primary hover:underline text-xs break-all font-mono"
                >
                  {kw.PageURL.replace('https://www.boldpreciousmetals.com', '…')}
                </a>
              </td>
              <td className="px-4 py-3 font-medium text-ink">{kw.PrimaryKeyword}</td>
              <td className="px-4 py-3">
                {kw.SearchIntent && <Badge variant="green">{kw.SearchIntent}</Badge>}
              </td>
              <td className="px-4 py-3 text-center">
                <ScoreBadge score={kw.ContentFocusScore} />
              </td>
              <td className="px-4 py-3">
                <TagList items={kw.SecondaryKeywords} max={3} />
              </td>
              <td className="px-4 py-3">
                <TagList items={kw.KeywordGaps} max={3} />
              </td>
              <td className="px-4 py-3">
                <TagList items={kw.MissingLSITerms} max={3} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function TagList({ items, max }: { items: string[]; max: number }) {
  if (!items || items.length === 0) return <span className="text-muted text-xs">—</span>;
  const shown = items.slice(0, max);
  const rest = items.length - max;
  return (
    <div className="flex flex-wrap gap-1">
      {shown.map((t, i) => (
        <span key={i} className="bg-slate-100 text-slate-600 border border-slate-200 text-[10px] px-1.5 py-0.5 rounded-md">
          {t}
        </span>
      ))}
      {rest > 0 && (
        <span className="text-muted text-[10px]">+{rest}</span>
      )}
    </div>
  );
}

// ─── Cannibalization Tab ──────────────────────────────────────────────────────

function CannibalizationTab({ scanId }: { scanId: number }) {
  const [issues, setIssues] = useState<CannibalizationIssue[]>([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<Set<number>>(new Set());

  useEffect(() => {
    fetch(`/api/scans/${scanId}/cannibalization`)
      .then((r) => r.json())
      .then((d) => { setIssues(d); setLoading(false); });
  }, [scanId]);

  const updateIssue = (id: number, status: string, comment: string) => {
    setIssues((prev) =>
      prev.map((i) => i.IssueID === id ? { ...i, Status: status as any, UserComment: comment } : i)
    );
  };

  const toggleExpand = (id: number) => {
    setExpanded((s) => {
      const n = new Set(s);
      n.has(id) ? n.delete(id) : n.add(id);
      return n;
    });
  };

  if (loading) return <Spinner />;
  if (issues.length === 0) return <Empty msg="No cannibalization issues for this scan." />;

  const grouped = groupBy(issues, (i) => i.TreeCluster ?? 'Uncategorised');

  return (
    <div className="space-y-6">
      {Object.entries(grouped).map(([tree, items]) => (
        <div key={tree} className="space-y-3">
          <div className="flex items-center gap-3">
            <Badge variant="purple">{tree}</Badge>
            <span className="text-muted text-xs">{items.length} issue{items.length !== 1 ? 's' : ''}</span>
          </div>
          {items.map((issue) => {
            const open = expanded.has(issue.IssueID);
            return (
              <div
                key={issue.IssueID}
                className="bg-surface rounded-xl border border-border shadow-card overflow-hidden"
              >
                {/* Header row */}
                <button
                  onClick={() => toggleExpand(issue.IssueID)}
                  className="w-full flex items-center gap-4 px-5 py-4 hover:bg-surface2 transition-colors text-left"
                >
                  <SeverityBadge severity={issue.Severity} />
                  <div className="flex-1 min-w-0">
                    <p className="font-semibold text-ink text-sm truncate">
                      {issue.CannibalKeyword ?? 'Keyword Cannibalization'}
                    </p>
                    <p className="text-muted text-xs mt-0.5 truncate">
                      {issue.URL1?.replace('https://www.boldpreciousmetals.com', '…')} ↔{' '}
                      {issue.URL2?.replace('https://www.boldpreciousmetals.com', '…')}
                    </p>
                  </div>
                  <StatusBadge status={issue.Status} />
                  <svg
                    className={`w-4 h-4 text-muted transition-transform flex-shrink-0 ${open ? 'rotate-180' : ''}`}
                    fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24"
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                  </svg>
                </button>

                {open && (
                  <div className="px-5 pb-5 border-t border-border space-y-4">
                    {/* Severity reason */}
                    {issue.SeverityReason && (
                      <p className="text-sm text-ink-2 bg-surface2 rounded-lg px-4 py-3 mt-4">
                        <span className="font-medium">Severity: </span>{issue.SeverityReason}
                      </p>
                    )}

                    {/* URL side-by-side */}
                    <div className="grid grid-cols-2 gap-4 mt-4">
                      {[
                        { url: issue.URL1, field: issue.URL1_FieldName, current: issue.URL1_CurrentContent, fix: issue.URL1_SuggestedFix, label: 'URL 1' },
                        { url: issue.URL2, field: issue.URL2_FieldName, current: issue.URL2_CurrentContent, fix: issue.URL2_SuggestedFix, label: 'URL 2' },
                      ].map((side, si) => (
                        <div key={si} className="rounded-xl border border-border overflow-hidden">
                          <div className="px-4 py-2.5 bg-surface2 border-b border-border flex items-center gap-2">
                            <span className="text-xs font-semibold text-muted uppercase">{side.label}</span>
                            {side.field && <Badge variant="gray">{side.field}</Badge>}
                          </div>
                          <div className="p-4 space-y-3">
                            {side.url && (
                              <a
                                href={side.url}
                                target="_blank"
                                rel="noreferrer"
                                className="text-primary hover:underline text-xs font-mono break-all block"
                              >
                                {side.url}
                              </a>
                            )}
                            {side.current && (
                              <div>
                                <p className="text-[10px] font-semibold text-muted uppercase mb-1">Current</p>
                                <p className="text-xs text-ink-2 bg-surface2 rounded-lg p-3">{side.current}</p>
                              </div>
                            )}
                            {side.fix && (
                              <div>
                                <p className="text-[10px] font-semibold text-success uppercase mb-1">Suggested Fix</p>
                                <p className="text-xs text-ink-2 bg-success-light border border-green-100 rounded-lg p-3">{side.fix}</p>
                              </div>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>

                    {/* Recommendation + reasoning */}
                    {(issue.OverallRecommendation || issue.Reasoning) && (
                      <div className="grid grid-cols-2 gap-4">
                        {issue.OverallRecommendation && (
                          <div className="rounded-xl border border-border p-4">
                            <p className="text-[10px] font-semibold text-muted uppercase mb-1.5">Overall Recommendation</p>
                            <p className="text-sm text-ink-2">{issue.OverallRecommendation}</p>
                          </div>
                        )}
                        {issue.Reasoning && (
                          <div className="rounded-xl border border-border p-4">
                            <p className="text-[10px] font-semibold text-muted uppercase mb-1.5">Reasoning</p>
                            <p className="text-sm text-ink-2">{issue.Reasoning}</p>
                          </div>
                        )}
                      </div>
                    )}

                    {/* Status update */}
                    <IssueStatusRow
                      id={issue.IssueID}
                      type="cannibalization"
                      currentStatus={issue.Status}
                      currentComment={issue.UserComment}
                      onUpdated={(s, c) => updateIssue(issue.IssueID, s, c)}
                    />
                  </div>
                )}
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
}

// ─── Content Improvements Tab ─────────────────────────────────────────────────

function ContentTab({ scanId }: { scanId: number }) {
  const [items, setItems] = useState<ContentImprovement[]>([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<Set<number>>(new Set());

  useEffect(() => {
    fetch(`/api/scans/${scanId}/improvements`)
      .then((r) => r.json())
      .then((d) => { setItems(d); setLoading(false); });
  }, [scanId]);

  const updateItem = (id: number, status: string, comment: string) => {
    setItems((prev) =>
      prev.map((i) => i.ImprovementID === id ? { ...i, Status: status as any, UserComment: comment } : i)
    );
  };

  const toggleExpand = (id: number) => {
    setExpanded((s) => {
      const n = new Set(s);
      n.has(id) ? n.delete(id) : n.add(id);
      return n;
    });
  };

  if (loading) return <Spinner />;
  if (items.length === 0) return <Empty msg="No content improvements for this scan." />;

  const grouped = groupBy(items, (i) => i.PageURL ?? 'Unknown');

  return (
    <div className="space-y-6">
      {Object.entries(grouped).map(([url, pageItems]) => (
        <div key={url} className="space-y-3">
          <div className="flex items-center gap-3">
            <a
              href={url}
              target="_blank"
              rel="noreferrer"
              className="text-primary hover:underline text-xs font-mono break-all"
            >
              {url}
            </a>
            <span className="text-muted text-xs flex-shrink-0">{pageItems.length} improvement{pageItems.length !== 1 ? 's' : ''}</span>
          </div>
          {pageItems.map((item) => {
            const open = expanded.has(item.ImprovementID);
            return (
              <div
                key={item.ImprovementID}
                className="bg-surface rounded-xl border border-border shadow-card overflow-hidden"
              >
                <button
                  onClick={() => toggleExpand(item.ImprovementID)}
                  className="w-full flex items-center gap-4 px-5 py-4 hover:bg-surface2 transition-colors text-left"
                >
                  <PriorityBadge priority={item.Priority} />
                  <div className="flex-1 min-w-0">
                    <p className="font-semibold text-ink text-sm">
                      {item.FieldName ?? 'Content Field'}
                      {item.IssueType && (
                        <span className="ml-2 text-muted text-xs font-normal">· {item.IssueType}</span>
                      )}
                    </p>
                    <p className="text-muted text-xs mt-0.5 truncate">{item.ImpactEstimate}</p>
                  </div>
                  <StatusBadge status={item.Status} />
                  <svg
                    className={`w-4 h-4 text-muted transition-transform flex-shrink-0 ${open ? 'rotate-180' : ''}`}
                    fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24"
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                  </svg>
                </button>

                {open && (
                  <div className="px-5 pb-5 border-t border-border space-y-4 mt-1">
                    {/* Diff view */}
                    <div className="grid grid-cols-2 gap-4 mt-4">
                      <div className="rounded-xl border border-border overflow-hidden">
                        <div className="px-4 py-2 bg-surface2 border-b border-border">
                          <p className="text-[10px] font-semibold text-muted uppercase">
                            Current
                            {item.CurrentCharCount !== null && (
                              <span className="ml-1.5 text-muted font-mono">({item.CurrentCharCount} chars)</span>
                            )}
                          </p>
                        </div>
                        <div className="p-4">
                          <p className="text-xs text-ink-2 whitespace-pre-wrap">{item.CurrentContent || '—'}</p>
                        </div>
                      </div>
                      <div className="rounded-xl border border-green-200 overflow-hidden">
                        <div className="px-4 py-2 bg-success-light border-b border-green-200">
                          <p className="text-[10px] font-semibold text-success uppercase">
                            Suggested
                            {item.SuggestedCharCount !== null && (
                              <span className="ml-1.5 font-mono">({item.SuggestedCharCount} chars)</span>
                            )}
                          </p>
                        </div>
                        <div className="p-4">
                          <p className="text-xs text-ink-2 whitespace-pre-wrap">{item.SuggestedContent || '—'}</p>
                        </div>
                      </div>
                    </div>

                    {/* Reasoning + impact */}
                    {(item.Reasoning || item.ImpactEstimate) && (
                      <div className="grid grid-cols-2 gap-4">
                        {item.Reasoning && (
                          <div className="rounded-xl border border-border p-4">
                            <p className="text-[10px] font-semibold text-muted uppercase mb-1.5">Reasoning</p>
                            <p className="text-sm text-ink-2">{item.Reasoning}</p>
                          </div>
                        )}
                        {item.ImpactEstimate && (
                          <div className="rounded-xl border border-border p-4">
                            <p className="text-[10px] font-semibold text-muted uppercase mb-1.5">Impact Estimate</p>
                            <p className="text-sm text-ink-2">{item.ImpactEstimate}</p>
                          </div>
                        )}
                      </div>
                    )}

                    {/* Status update */}
                    <IssueStatusRow
                      id={item.ImprovementID}
                      type="improvement"
                      currentStatus={item.Status}
                      currentComment={item.UserComment}
                      onUpdated={(s, c) => updateItem(item.ImprovementID, s, c)}
                    />
                  </div>
                )}
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
}

// ─── Claude Calls Tab ─────────────────────────────────────────────────────────

function CallsTab({ scanId }: { scanId: number }) {
  const [calls, setCalls] = useState<ClaudeCallLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<Set<number>>(new Set());

  useEffect(() => {
    fetch(`/api/scans/${scanId}/calls`)
      .then((r) => r.json())
      .then((d) => { setCalls(d); setLoading(false); });
  }, [scanId]);

  const toggleExpand = (id: number) => {
    setExpanded((s) => {
      const n = new Set(s);
      n.has(id) ? n.delete(id) : n.add(id);
      return n;
    });
  };

  if (loading) return <Spinner />;
  if (calls.length === 0) return <Empty msg="No Claude API calls logged for this scan." />;

  return (
    <div className="overflow-x-auto rounded-xl border border-border">
      <table className="w-full text-sm">
        <thead>
          <tr className="bg-surface2 border-b border-border">
            <th className="text-left px-4 py-3 text-muted font-medium">Type</th>
            <th className="text-left px-4 py-3 text-muted font-medium">Entity / URL</th>
            <th className="text-center px-4 py-3 text-muted font-medium">Success</th>
            <th className="text-right px-4 py-3 text-muted font-medium">Duration</th>
            <th className="text-right px-4 py-3 text-muted font-medium">In chars</th>
            <th className="text-right px-4 py-3 text-muted font-medium">Out chars</th>
            <th className="text-left px-4 py-3 text-muted font-medium">Called At</th>
            <th className="px-4 py-3" />
          </tr>
        </thead>
        <tbody>
          {calls.map((call) => {
            const open = expanded.has(call.CallID);
            return (
              <>
                <tr
                  key={call.CallID}
                  className="border-b border-border/50 hover:bg-surface2 cursor-pointer transition-colors"
                  onClick={() => toggleExpand(call.CallID)}
                >
                  <td className="px-4 py-3"><CallTypeBadge type={call.CallType} /></td>
                  <td className="px-4 py-3 max-w-[280px]">
                    <span className="text-xs font-mono text-ink-2 break-all">
                      {call.EntityURL?.replace('https://www.boldpreciousmetals.com', '…')}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-center">
                    {call.CallSucceeded ? (
                      <span className="text-success">✓</span>
                    ) : (
                      <span className="text-danger">✗</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-right font-mono text-xs">
                    {call.DurationMs ? `${call.DurationMs}ms` : '—'}
                  </td>
                  <td className="px-4 py-3 text-right font-mono text-xs">
                    {call.InputCharsEstimate?.toLocaleString() ?? '—'}
                  </td>
                  <td className="px-4 py-3 text-right font-mono text-xs">
                    {call.OutputCharsEstimate?.toLocaleString() ?? '—'}
                  </td>
                  <td className="px-4 py-3 text-xs text-muted">{fmtDate(call.CalledAt)}</td>
                  <td className="px-4 py-3 text-right">
                    <svg
                      className={`w-4 h-4 text-muted inline transition-transform ${open ? 'rotate-180' : ''}`}
                      fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24"
                    >
                      <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                    </svg>
                  </td>
                </tr>
                {open && (
                  <tr key={`${call.CallID}-expand`} className="border-b border-border">
                    <td colSpan={8} className="px-4 py-4 bg-surface2">
                      {call.ErrorMessage && (
                        <div className="mb-4 p-3 bg-danger-light border border-red-200 rounded-xl text-xs text-danger">
                          <strong>Error:</strong> {call.ErrorMessage}
                        </div>
                      )}
                      <div className="space-y-3">
                        {[
                          { label: 'System Prompt', val: call.SystemPrompt },
                          { label: 'User Message', val: call.UserMessage },
                          { label: 'Raw Response', val: call.RawResponse },
                        ].map(({ label, val }) => (
                          val && (
                            <div key={label}>
                              <p className="text-[10px] font-semibold text-muted uppercase mb-1">{label}</p>
                              <pre className="text-xs text-ink-2 bg-surface border border-border rounded-lg p-3 overflow-x-auto whitespace-pre-wrap max-h-64">
                                {val}
                              </pre>
                            </div>
                          )
                        ))}
                      </div>
                    </td>
                  </tr>
                )}
              </>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ─── Shared components ────────────────────────────────────────────────────────

function Spinner() {
  return (
    <div className="flex items-center justify-center h-48">
      <div className="w-8 h-8 border-4 border-primary border-t-transparent rounded-full animate-spin" />
    </div>
  );
}

function Empty({ msg }: { msg: string }) {
  return (
    <div className="flex flex-col items-center justify-center h-48 text-muted text-sm">{msg}</div>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

const TABS: { id: Tab; label: string; countKey?: string }[] = [
  { id: 'keywords', label: 'Keywords', countKey: 'KeywordCount' },
  { id: 'cannibalization', label: 'Cannibalization', countKey: 'CannibalizationCount' },
  { id: 'content', label: 'Content', countKey: 'ImprovementCount' },
  { id: 'calls', label: 'Claude Calls', countKey: 'CallCount' },
];

export default function ScanDetailPage() {
  const params = useParams();
  const scanId = parseInt(params.id as string);

  const [scan, setScan] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<Tab>('keywords');
  const pollingRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const fetchScan = () =>
    fetch(`/api/scans/${scanId}`)
      .then((r) => r.json())
      .then((d) => { setScan(d); setLoading(false); });

  useEffect(() => {
    fetchScan();
  }, [scanId]);

  // Poll while Running
  useEffect(() => {
    if (scan?.Status === 'Running') {
      pollingRef.current = setTimeout(() => { fetchScan(); }, 10000);
    }
    return () => { if (pollingRef.current) clearTimeout(pollingRef.current); };
  }, [scan]);

  if (loading) return (
    <div className="flex items-center justify-center h-64">
      <div className="w-8 h-8 border-4 border-primary border-t-transparent rounded-full animate-spin" />
    </div>
  );

  if (!scan || scan.error) return (
    <div className="text-danger p-4 bg-danger-light rounded-xl border border-red-200">
      {scan?.error ?? 'Scan not found'}
    </div>
  );

  return (
    <div className="space-y-6 animate-fade-slide">
      {/* Breadcrumb */}
      <div className="flex items-center gap-2 text-sm text-muted">
        <Link href="/scans" className="hover:text-primary transition-colors">Scans</Link>
        <span>/</span>
        <span className="text-ink font-medium">{scan.ScanName}</span>
      </div>

      {/* Metadata card */}
      <div className="bg-surface rounded-2xl border border-border shadow-card p-6">
        <div className="flex items-start justify-between gap-4">
          <div className="space-y-1">
            <div className="flex items-center gap-3">
              <h1 className="text-xl font-bold font-display text-ink">{scan.ScanName}</h1>
              <ScanStatusBadge status={scan.Status} />
              {scan.Status === 'Running' && (
                <span className="flex items-center gap-1.5 text-xs text-blue-600">
                  <span className="w-2 h-2 rounded-full bg-blue-500 animate-pulse" />
                  Live — refreshing every 10s
                </span>
              )}
            </div>
            <p className="text-muted text-sm">Scan #{scan.ScanID}</p>
          </div>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-6 mt-6 pt-6 border-t border-border">
          <MetaField label="Started" value={fmtDate(scan.StartedAt)} />
          <MetaField label="Completed" value={fmtDate(scan.EndedAt)} />
          <MetaField label="URLs Scraped" value={scan.URLsScraped ?? '—'} />
          <MetaField label="Trees Analysed" value={scan.TreesAnalysed ?? '—'} />
          <MetaField
            label="Cannib. Prompt"
            value={
              scan.CannibalizationPromptLabel
                ? `v${scan.CannibalizationPromptVersion} · ${scan.CannibalizationPromptLabel}`
                : '—'
            }
          />
          <MetaField
            label="Content Prompt"
            value={
              scan.ContentPromptLabel
                ? `v${scan.ContentPromptVersion} · ${scan.ContentPromptLabel}`
                : '—'
            }
          />
          {scan.ErrorLog && (
            <div className="col-span-2">
              <MetaField label="Error Log" value={scan.ErrorLog} />
            </div>
          )}
        </div>
      </div>

      {/* Tabs */}
      <div className="border-b border-border">
        <div className="flex gap-1">
          {TABS.map((tab) => {
            const count = tab.countKey ? scan[tab.countKey] : null;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`px-5 py-3 text-sm font-medium border-b-2 transition-colors flex items-center gap-2 ${
                  activeTab === tab.id
                    ? 'border-primary text-primary'
                    : 'border-transparent text-muted hover:text-ink hover:border-border-strong'
                }`}
              >
                {tab.label}
                {count !== null && count !== undefined && (
                  <span className={`text-[11px] px-1.5 py-0.5 rounded-full font-semibold ${
                    activeTab === tab.id ? 'bg-primary-light text-primary' : 'bg-muted-light text-muted'
                  }`}>
                    {count}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </div>

      {/* Tab content */}
      <div>
        {activeTab === 'keywords' && <KeywordsTab scanId={scanId} />}
        {activeTab === 'cannibalization' && <CannibalizationTab scanId={scanId} />}
        {activeTab === 'content' && <ContentTab scanId={scanId} />}
        {activeTab === 'calls' && <CallsTab scanId={scanId} />}
      </div>
    </div>
  );
}

function MetaField({ label, value }: { label: string; value: string | number | null }) {
  return (
    <div>
      <p className="text-[11px] font-semibold text-muted uppercase tracking-wide">{label}</p>
      <p className="text-sm text-ink mt-0.5 font-mono">{value ?? '—'}</p>
    </div>
  );
}
