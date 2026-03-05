'use client';

import { useEffect, useState, useMemo } from 'react';
import type { CannibalizationError, CannibalizationFix, PageSEOInput } from '@/lib/types';

type Tab = 'cannibalization' | 'seo';
const PAGE_SIZE = 10;
//
// ─── UI Helpers ───────────────────────────────────────────────────

function PriorityBadge({ priority }: { priority: number | null }) {
  const map: Record<number, { label: string; cls: string }> = {
    1: { label: 'Low',    cls: 'bg-green-50 text-green-600 border-green-200' },
    2: { label: 'Medium', cls: 'bg-amber-50 text-amber-600 border-amber-200' },
    3: { label: 'High',   cls: 'bg-red-50 text-red-600 border-red-200' },
  };
  const p = map[priority ?? 1] ?? map[1];
  return <span className={`inline-block text-[10px] font-semibold uppercase tracking-wider px-2.5 py-0.5 rounded-full border ${p.cls}`}>{p.label}</span>;
}

function ScoreBar({ score }: { score: number | null }) {
  const pct = Math.min(100, score ?? 0);
  const color = pct >= 75 ? '#EF4444' : pct >= 45 ? '#F59E0B' : '#10B981';
  return (
    <div className="flex items-center gap-2">
      <div className="w-16 h-1.5 bg-slate-100 rounded-full overflow-hidden">
        <div className="h-full rounded-full" style={{ width: `${pct}%`, background: color }} />
      </div>
      <span className="text-slate-400 text-xs font-mono">{score ?? '—'}</span>
    </div>
  );
}

function Tag({ children, variant = 'blue' }: { children: React.ReactNode; variant?: 'blue' | 'green' }) {
  const cls = variant === 'blue'
    ? 'bg-blue-50 text-blue-600 border-blue-200'
    : 'bg-emerald-50 text-emerald-600 border-emerald-200';
  return <span className={`inline-block text-[10px] font-mono font-medium px-2 py-0.5 rounded border whitespace-nowrap ${cls}`}>{children}</span>;
}

function StatusBadge({ code }: { code: number | null }) {
  if (!code) return <span className="text-slate-400 text-xs">—</span>;
  const cls = code < 300 ? 'bg-emerald-50 text-emerald-600' : code < 400 ? 'bg-amber-50 text-amber-600' : 'bg-red-50 text-red-600';
  return <span className={`text-[10px] font-mono font-semibold px-2 py-0.5 rounded ${cls}`}>{code}</span>;
}

function EmptyState({ icon, message }: { icon: string; message: string }) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 py-16 text-slate-400 text-sm text-center">
      <span className="text-4xl">{icon}</span>
      <p className="max-w-[260px] leading-relaxed">{message}</p>
    </div>
  );
}

function Spinner() {
  return (
    <div className="flex items-center justify-center py-16">
      <div className="w-7 h-7 border-2 border-blue-100 border-t-blue-500 rounded-full animate-spin" />
    </div>
  );
}

function SectionTitle({ title, count }: { title: string; count?: number }) {
  return (
    <div className="flex items-center gap-3 mb-3">
      <span className="text-[11px] font-bold uppercase tracking-widest text-slate-400" style={{ fontFamily: "'Plus Jakarta Sans', sans-serif" }}>{title}</span>
      {count !== undefined && (
        <span className="text-[10px] font-semibold bg-blue-50 text-blue-600 px-2 py-0.5 rounded-full border border-blue-100">{count}</span>
      )}
      <div className="flex-1 h-px bg-slate-100" />
    </div>
  );
}

function Th({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return (
    <th style={{ fontFamily: "'Plus Jakarta Sans', sans-serif" }}
      className={`text-[10px] font-bold uppercase tracking-widest text-slate-400 px-4 py-3 text-left whitespace-nowrap bg-slate-50 border-b border-slate-100 ${className}`}>
      {children}
    </th>
  );
}

// ─── Pagination ───────────────────────────────────────────────────
function Pagination({ page, total, pageSize, onChange }: { page: number; total: number; pageSize: number; onChange: (p: number) => void }) {
  const totalPages = Math.ceil(total / pageSize);
  if (totalPages <= 1) return null;
  const pages = Array.from({ length: totalPages }, (_, i) => i + 1);
  const visible = pages.filter(p => p === 1 || p === totalPages || Math.abs(p - page) <= 1);

  return (
    <div className="flex items-center justify-between px-4 py-3 border-t border-slate-100 bg-slate-50">
      <span className="text-xs text-slate-400">
        Showing {Math.min((page - 1) * pageSize + 1, total)}–{Math.min(page * pageSize, total)} of {total}
      </span>
      <div className="flex items-center gap-1">
        <button
          onClick={() => onChange(page - 1)} disabled={page === 1}
          className="px-2.5 py-1.5 rounded text-xs font-medium text-slate-500 hover:bg-slate-200 disabled:opacity-30 disabled:cursor-not-allowed transition-colors">
          ← Prev
        </button>
        {visible.map((p, i) => {
          const prev = visible[i - 1];
          return (
            <span key={p} className="flex items-center gap-1">
              {prev && p - prev > 1 && <span className="text-slate-300 px-1">…</span>}
              <button
                onClick={() => onChange(p)}
                className={`w-8 h-8 rounded text-xs font-medium transition-colors
                  ${p === page ? 'bg-blue-600 text-white' : 'text-slate-600 hover:bg-slate-200'}`}>
                {p}
              </button>
            </span>
          );
        })}
        <button
          onClick={() => onChange(page + 1)} disabled={page === totalPages}
          className="px-2.5 py-1.5 rounded text-xs font-medium text-slate-500 hover:bg-slate-200 disabled:opacity-30 disabled:cursor-not-allowed transition-colors">
          Next →
        </button>
      </div>
    </div>
  );
}

// ─── Fixes Popup Modal ────────────────────────────────────────────
function FixesModal({
  error, fixUrl, fixes, loading, onClose
}: {
  error: CannibalizationError;
  fixUrl: string | null;
  fixes: CannibalizationFix[];
  loading: boolean;
  onClose: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgba(15,23,42,0.5)' }}>
      {/* Backdrop */}
      <div className="absolute inset-0" onClick={onClose} />

      {/* Modal */}
      <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-5xl max-h-[85vh] flex flex-col overflow-hidden">

        {/* Modal Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100 bg-blue-50">
          <div className="flex flex-wrap items-center gap-3 text-sm">
            <span className="font-bold text-blue-600 font-mono text-base">{error.Code}</span>
            <span className="text-slate-300">|</span>
            <span className="text-slate-600 font-medium">{error.IssueType}</span>
            <span className="text-slate-300">|</span>
            <span className="text-xs text-slate-500">Fixes for:</span>
            <span className={`font-mono text-xs font-semibold ${fixUrl ? 'text-sky-600' : 'text-amber-600'}`}>
              {fixUrl ?? '⚡ All URLs'}
            </span>
            {fixes.length > 0 && (
              <span className="ml-1 text-[10px] bg-blue-100 text-blue-600 px-2 py-0.5 rounded-full font-semibold">
                {fixes.length} fix{fixes.length !== 1 ? 'es' : ''}
              </span>
            )}
          </div>
          <button
            onClick={onClose}
            className="ml-4 w-8 h-8 flex items-center justify-center rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-200 transition-colors text-lg font-bold flex-shrink-0"
          >
            ×
          </button>
        </div>

        {/* Modal Body */}
        <div className="flex-1 overflow-auto">
          {loading ? <Spinner /> : fixes.length === 0 ? (
            <EmptyState icon="📭" message="No suggested fixes available for this selection." />
          ) : (
            <table className="w-full border-collapse min-w-[700px]">
              <thead className="sticky top-0">
                <tr>
                  <Th className="w-10">#</Th>
                  <Th>URL</Th>
                  <Th className="w-32">Content Type</Th>
                  <Th>Current Content</Th>
                  <Th className="text-emerald-500 bg-emerald-50">✦ Suggested Content</Th>
                </tr>
              </thead>
              <tbody>
                {fixes.map((fix, i) => (
                  <tr key={fix.Id} className="border-b border-slate-100 last:border-b-0 hover:bg-slate-50 transition-colors">
                    <td className="px-4 py-4 text-slate-400 text-xs font-mono align-top">{i + 1}</td>
                    <td className="px-4 py-4 align-top">
                      <span className="text-sky-600 text-[11px] font-mono break-all leading-relaxed">{fix.Url || '—'}</span>
                    </td>
                    <td className="px-4 py-4 align-top"><Tag variant="blue">{fix.ContentType}</Tag></td>
                    <td className="px-4 py-4 text-xs text-slate-600 leading-relaxed align-top max-w-xs">
                      {fix.OldContent || <span className="text-slate-300 italic">—</span>}
                    </td>
                    <td className="px-4 py-4 text-xs text-emerald-600 leading-relaxed align-top font-medium bg-emerald-50/50 max-w-xs">
                      {fix.SuggestedContent || <span className="text-slate-300 italic">—</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── SEO Field pairs ──────────────────────────────────────────────
const SEO_FIELD_PAIRS: { label: string; old: keyof PageSEOInput; sug: keyof PageSEOInput }[] = [
  { label: 'Meta Title',       old: 'MetaTitle',       sug: 'SuggestedMetaTitle' },
  { label: 'Meta Description', old: 'MetaDescription', sug: 'SuggestedMetaDescription' },
  { label: 'H1', old: 'H1', sug: 'SuggestedH1' },
  { label: 'H2', old: 'H2', sug: 'SuggestedH2' },
  { label: 'H3', old: 'H3', sug: 'SuggestedH3' },
  { label: 'H4', old: 'H4', sug: 'SuggestedH4' },
  { label: 'H5', old: 'H5', sug: 'SuggestedH5' },
  { label: 'H6', old: 'H6', sug: 'SuggestedH6' },
  { label: 'Content', old: 'Content', sug: 'SuggestedContent' },
];

// ═══════════════════════════════════════════════════════════════════
// MAIN PAGE
// ═══════════════════════════════════════════════════════════════════
export default function Home() {
  const [scanCodes, setScanCodes]           = useState<string[]>([]);
  const [selectedScan, setSelectedScan]     = useState('');
  const [activeTab, setActiveTab]           = useState<Tab>('cannibalization');
  const [searchQuery, setSearchQuery]       = useState('');

  // Cannibalization
  const [errors, setErrors]                 = useState<CannibalizationError[]>([]);
  const [loadingErrors, setLoadingErrors]   = useState(false);
  const [errPage, setErrPage]               = useState(1);

  // Filters
  const [filterIssueTypes, setFilterIssueTypes] = useState<string[]>([]);
  const [filterPriorities, setFilterPriorities] = useState<number[]>([]);
  const [selIssueType, setSelIssueType]     = useState('');
  const [selPriority, setSelPriority]       = useState('');
  const [urlInput, setUrlInput]             = useState('');
  const [urlFilter, setUrlFilter]           = useState('');

  // Fixes modal
  const [modalError, setModalError]         = useState<CannibalizationError | null>(null);
  const [modalFixUrl, setModalFixUrl]       = useState<string | null>(null);
  const [fixes, setFixes]                   = useState<CannibalizationFix[]>([]);
  const [loadingFixes, setLoadingFixes]     = useState(false);

  // SEO
  const [seoInputs, setSeoInputs]           = useState<PageSEOInput[]>([]);
  const [loadingSeo, setLoadingSeo]         = useState(false);
  const [expandedId, setExpandedId]         = useState<number | null>(null);
  const [seoPage, setSeoPage]               = useState(1);

  // Load scan codes
  useEffect(() => {
    fetch('/api/scan-codes').then(r => r.json()).then(setScanCodes).catch(console.error);
  }, []);

  // Load errors (called on scan change OR filter change)
  async function loadErrors(scanCode: string, issueType = '', priority = '', url = '') {
    setLoadingErrors(true);
    setErrPage(1);
    const params = new URLSearchParams({ scanCode });
    if (issueType) params.set('issueType', issueType);
    if (priority)  params.set('priority', priority);
    if (url)       params.set('url', url);
    fetch(`/api/errors?${params}`)
      .then(r => r.json())
      .then(data => setErrors(Array.isArray(data) ? data : []))
      .catch(console.error)
      .finally(() => setLoadingErrors(false));
  }

  async function onScanChange(code: string) {
    setSelectedScan(code);
    setErrors([]); setFixes([]); setModalError(null);
    setSeoInputs([]); setExpandedId(null); setSearchQuery('');
    setSelIssueType(''); setSelPriority(''); setUrlInput(''); setUrlFilter('');
    setFilterIssueTypes([]); setFilterPriorities([]);
    setErrPage(1); setSeoPage(1);
    if (!code) return;

    // Load filter options
    fetch(`/api/error-filters?scanCode=${encodeURIComponent(code)}`)
      .then(r => r.json())
      .then(data => {
        setFilterIssueTypes(data.issueTypes ?? []);
        setFilterPriorities(data.priorities ?? []);
      }).catch(console.error);

    loadErrors(code);

    setLoadingSeo(true);
    fetch(`/api/seo-inputs?scanCode=${encodeURIComponent(code)}`)
      .then(r => r.json())
      .then(data => setSeoInputs(Array.isArray(data) ? data : []))
      .catch(console.error)
      .finally(() => setLoadingSeo(false));
  }

  // Filter change handlers
  function onIssueTypeChange(val: string) {
    setSelIssueType(val);
    loadErrors(selectedScan, val, selPriority, urlFilter);
  }
  function onPriorityChange(val: string) {
    setSelPriority(val);
    loadErrors(selectedScan, selIssueType, val, urlFilter);
  }
  function onUrlSearch() {
    setUrlFilter(urlInput);
    loadErrors(selectedScan, selIssueType, selPriority, urlInput);
  }
  function onClearFilters() {
    setSelIssueType(''); setSelPriority(''); setUrlInput(''); setUrlFilter('');
    loadErrors(selectedScan);
  }

  // Open fixes modal
  async function openFixes(err: CannibalizationError, url?: string) {
    setModalError(err);
    setModalFixUrl(url ?? null);
    setFixes([]);
    setLoadingFixes(true);
    const params = new URLSearchParams({
      scanCode: err.ScanCode ?? '',
      errorCode: err.Code,
    });
    if (url) params.set('url', url);
    fetch(`/api/fixes?${params}`)
      .then(r => r.json())
      .then(data => setFixes(Array.isArray(data) ? data : []))
      .catch(console.error)
      .finally(() => setLoadingFixes(false));
  }

  // Paginated errors
  const pagedErrors = useMemo(() => {
    const start = (errPage - 1) * PAGE_SIZE;
    return errors.slice(start, start + PAGE_SIZE);
  }, [errors, errPage]);

  // Filtered + paginated SEO
  const filteredSeo = useMemo(() => {
    if (!searchQuery.trim()) return seoInputs;
    const q = searchQuery.toLowerCase();
    return seoInputs.filter(s => s.Url?.toLowerCase().includes(q) || s.PageName?.toLowerCase().includes(q));
  }, [seoInputs, searchQuery]);

  const pagedSeo = useMemo(() => {
    const start = (seoPage - 1) * PAGE_SIZE;
    return filteredSeo.slice(start, start + PAGE_SIZE);
  }, [filteredSeo, seoPage]);

  const avgScore = errors.length
    ? Math.round(errors.reduce((s, e) => s + (e.Score ?? 0), 0) / errors.length) : null;

  const hasFilters = selIssueType || selPriority || urlFilter;

  return (
    <div className="min-h-screen bg-slate-50" style={{ fontFamily: "'Outfit', sans-serif" }}>

      {/* HEADER */}
      <header className="bg-white border-b border-slate-200 sticky top-0 z-30 shadow-sm">
        <div className="max-w-screen-2xl mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-blue-600 flex items-center justify-center shadow-sm">
              <span className="text-white text-sm font-bold" style={{ fontFamily: "'Plus Jakarta Sans', sans-serif" }}>AI</span>
            </div>
            <div>
              <h1 className="text-base font-bold text-slate-800 leading-none" style={{ fontFamily: "'Plus Jakarta Sans', sans-serif" }}>
                AISEO <span className="text-blue-600">Dashboard</span>
              </h1>
              <p className="text-slate-400 text-[10px] mt-0.5">Cannibalization & SEO Analysis</p>
            </div>
          </div>
          <span className="text-[10px] font-semibold uppercase tracking-widest px-3 py-1 rounded-full bg-blue-50 text-blue-600 border border-blue-100">Beta</span>
        </div>
      </header>

      <div className="max-w-screen-2xl mx-auto px-6 py-6 flex flex-col gap-5">

        {/* SCAN + GLOBAL SEARCH */}
        <div className="bg-white border border-slate-200 rounded-xl shadow-sm p-4 flex flex-wrap items-center gap-4">
          <div className="flex items-center gap-3 flex-1 min-w-[240px]">
            <label className="text-[11px] font-bold uppercase tracking-widest text-slate-400 whitespace-nowrap"
              style={{ fontFamily: "'Plus Jakarta Sans', sans-serif" }}>Scan Code</label>
            <select
              value={selectedScan}
              onChange={e => onScanChange(e.target.value)}
              className="flex-1 max-w-xs bg-slate-50 text-slate-800 border border-slate-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100 transition-all cursor-pointer"
            >
              <option value="">— Select a Scan —</option>
              {scanCodes.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>

          {selectedScan && activeTab === 'seo' && (
            <div className="relative flex-1 min-w-[200px] max-w-sm">
              <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
              </svg>
              <input type="text" placeholder="Search URLs…" value={searchQuery}
                onChange={e => { setSearchQuery(e.target.value); setSeoPage(1); }}
                className="w-full bg-slate-50 border border-slate-200 rounded-lg pl-9 pr-8 py-2 text-sm outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100 transition-all placeholder:text-slate-400"
              />
              {searchQuery && (
                <button onClick={() => setSearchQuery('')} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 text-lg">×</button>
              )}
            </div>
          )}

          {selectedScan && !loadingErrors && (
            <div className="flex gap-2 ml-auto flex-wrap">
              {[
                { label: 'Errors',    value: errors.length,    cls: 'bg-red-50 text-red-600 border-red-100' },
                { label: 'Avg Score', value: avgScore,         cls: 'bg-amber-50 text-amber-600 border-amber-100' },
                { label: 'SEO Pages', value: seoInputs.length, cls: 'bg-blue-50 text-blue-600 border-blue-100' },
              ].map(({ label, value, cls }) => (
                <div key={label} className={`text-[11px] px-3 py-1.5 rounded-full border font-medium ${cls}`}>
                  {label}: <span className="font-bold">{value ?? '—'}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* TABS */}
        {selectedScan && (
          <div className="flex gap-1 bg-white border border-slate-200 rounded-xl p-1 w-fit shadow-sm">
            {([
              { id: 'cannibalization' as Tab, label: 'Cannibalization Errors', icon: '⚠️', count: errors.length },
              { id: 'seo'            as Tab, label: 'SEO Errors',              icon: '🔍', count: seoInputs.length },
            ]).map(tab => (
              <button key={tab.id} onClick={() => setActiveTab(tab.id)}
                className={`flex items-center gap-2 px-5 py-2.5 rounded-lg text-sm font-semibold transition-all
                  ${activeTab === tab.id ? 'bg-blue-600 text-white shadow-sm' : 'text-slate-500 hover:text-slate-700 hover:bg-slate-50'}`}
                style={{ fontFamily: "'Plus Jakarta Sans', sans-serif" }}
              >
                <span>{tab.icon}</span>
                {tab.label}
                <span className={`text-[10px] font-mono px-1.5 py-0.5 rounded-full ${activeTab === tab.id ? 'bg-white/20 text-white' : 'bg-slate-100 text-slate-400'}`}>
                  {tab.count}
                </span>
              </button>
            ))}
          </div>
        )}

        {/* ══ TAB: CANNIBALIZATION ══ */}
        {selectedScan && activeTab === 'cannibalization' && (
          <div className="flex flex-col gap-4 animate-fade-slide">

            {/* FILTERS ROW */}
            <div className="bg-white border border-slate-200 rounded-xl shadow-sm p-4 flex flex-wrap items-end gap-3">
              <div className="flex flex-col gap-1 min-w-[180px]">
                <label className="text-[10px] font-bold uppercase tracking-widest text-slate-400"
                  style={{ fontFamily: "'Plus Jakarta Sans', sans-serif" }}>Issue Type</label>
                <select value={selIssueType} onChange={e => onIssueTypeChange(e.target.value)}
                  className="bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100 transition-all cursor-pointer">
                  <option value="">All Issue Types</option>
                  {filterIssueTypes.map(t => <option key={t} value={t}>{t}</option>)}
                </select>
              </div>

              <div className="flex flex-col gap-1 min-w-[140px]">
                <label className="text-[10px] font-bold uppercase tracking-widest text-slate-400"
                  style={{ fontFamily: "'Plus Jakarta Sans', sans-serif" }}>Priority</label>
                <select value={selPriority} onChange={e => onPriorityChange(e.target.value)}
                  className="bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100 transition-all cursor-pointer">
                  <option value="">All Priorities</option>
                  {filterPriorities.map(p => (
                    <option key={p} value={p}>{p === 3 ? 'High' : p === 2 ? 'Medium' : 'Low'}</option>
                  ))}
                </select>
              </div>

              <div className="flex flex-col gap-1 flex-1 min-w-[200px]">
                <label className="text-[10px] font-bold uppercase tracking-widest text-slate-400"
                  style={{ fontFamily: "'Plus Jakarta Sans', sans-serif" }}>URL Search</label>
                <div className="flex gap-2">
                  <input
                    type="text"
                    placeholder="Enter URL or keyword…"
                    value={urlInput}
                    onChange={e => setUrlInput(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && onUrlSearch()}
                    className="flex-1 bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100 transition-all placeholder:text-slate-400"
                  />
                  <button onClick={onUrlSearch}
                    className="px-4 py-2 bg-blue-600 text-white text-sm font-semibold rounded-lg hover:bg-blue-700 transition-colors whitespace-nowrap"
                    style={{ fontFamily: "'Plus Jakarta Sans', sans-serif" }}>
                    Search
                  </button>
                </div>
              </div>

              {hasFilters && (
                <button onClick={onClearFilters}
                  className="px-3 py-2 text-xs font-semibold text-slate-500 border border-slate-200 rounded-lg hover:bg-slate-50 transition-colors self-end">
                  ✕ Clear Filters
                </button>
              )}
            </div>

            {/* ERRORS TABLE */}
            <section>
              <SectionTitle title="Cannibalization Errors" count={errors.length} />
              <div className="bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden">

                <div className="flex items-center gap-2 px-4 py-2.5 bg-slate-50 border-b border-slate-100 text-[11px] text-slate-400">
                  <span>💡 Click</span>
                  <span className="font-mono font-semibold text-blue-600 underline cursor-default">Error Code</span>
                  <span>→ fixes for all URLs &nbsp;|&nbsp; Click a</span>
                  <span className="font-mono text-sky-600 underline cursor-default">URL</span>
                  <span>→ fixes for that URL only</span>
                </div>

                {loadingErrors ? <Spinner /> : pagedErrors.length === 0 ? (
                  <EmptyState icon="✅" message="No errors match the current filters." />
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full min-w-[860px] border-collapse">
                      <thead>
                        <tr><Th>#</Th><Th>Code</Th><Th>Issue Type</Th><Th>Description</Th><Th>URL(s)</Th><Th>Priority</Th><Th>Score</Th></tr>
                      </thead>
                      <tbody>
                        {pagedErrors.map((err, i) => {
                          const urls = [err.Url1, err.Url2, err.Url3, err.Url4].filter(Boolean) as string[];
                          const rowNum = (errPage - 1) * PAGE_SIZE + i + 1;
                          return (
                            <tr key={err.Id} className="border-b border-slate-100 hover:bg-slate-50 transition-colors text-sm">
                              <td className="px-4 py-3 text-slate-400 text-xs font-mono">{rowNum}</td>
                              <td
                                onClick={() => openFixes(err)}
                                className="px-4 py-3 font-mono font-semibold text-blue-600 text-xs whitespace-nowrap cursor-pointer hover:underline select-none"
                                title="Load fixes for all URLs"
                              >
                                {err.Code}
                              </td>
                              <td className="px-4 py-3 font-medium text-slate-700 max-w-[180px]">{err.IssueType || '—'}</td>
                              <td className="px-4 py-3 text-slate-500 text-xs max-w-[240px] leading-relaxed">{err.Description || '—'}</td>
                              <td className="px-4 py-3">
                                <div className="flex flex-col gap-1">
                                  {urls.map((u, j) => (
                                    <span key={j} onClick={() => openFixes(err, u)}
                                      className="text-sky-500 text-[11px] truncate max-w-[200px] font-mono cursor-pointer hover:underline select-none"
                                      title={`Load fixes for ${u}`}>{u}</span>
                                  ))}
                                </div>
                              </td>
                              <td className="px-4 py-3"><PriorityBadge priority={err.ErrorPriority} /></td>
                              <td className="px-4 py-3"><ScoreBar score={err.Score} /></td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
                <Pagination page={errPage} total={errors.length} pageSize={PAGE_SIZE} onChange={setErrPage} />
              </div>
            </section>
          </div>
        )}

        {/* ══ TAB: SEO ERRORS ══ */}
        {selectedScan && activeTab === 'seo' && (
          <div className="flex flex-col gap-4 animate-fade-slide">
            <SectionTitle title="SEO Page Analysis" count={filteredSeo.length} />
            {loadingSeo ? <Spinner /> : pagedSeo.length === 0 ? (
              <div className="bg-white border border-slate-200 rounded-xl shadow-sm">
                <EmptyState icon="🔍" message={searchQuery ? 'No pages match your search.' : 'No SEO data found for this scan.'} />
              </div>
            ) : (
              <>
                <div className="flex flex-col gap-3">
                  {pagedSeo.map(page => (
                    <div key={page.Id} className="bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden">
                      <button
                        onClick={() => setExpandedId(expandedId === page.Id ? null : page.Id)}
                        className="w-full flex items-center gap-4 px-5 py-4 hover:bg-slate-50 transition-colors text-left"
                      >
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="font-mono text-sm text-blue-600 truncate max-w-[500px]">{page.Url}</span>
                            {page.PageName && <span className="text-xs text-slate-400 bg-slate-100 px-2 py-0.5 rounded-full">{page.PageName}</span>}
                          </div>
                          <div className="flex items-center gap-3 mt-1.5 flex-wrap">
                            <StatusBadge code={page.StatusCode} />
                            {page.WordCount != null && <span className="text-[10px] text-slate-400 font-mono">{page.WordCount} words</span>}
                            {page.InternalLinks != null && <span className="text-[10px] text-slate-400 font-mono">{page.InternalLinks} int. links</span>}
                            {page.ExternalLinks != null && <span className="text-[10px] text-slate-400 font-mono">{page.ExternalLinks} ext. links</span>}
                            {page.IsAddressed && <span className="text-[10px] bg-emerald-50 text-emerald-600 border border-emerald-200 px-2 py-0.5 rounded-full font-semibold">✓ Addressed</span>}
                          </div>
                        </div>
                        <svg className={`w-4 h-4 text-slate-400 flex-shrink-0 transition-transform ${expandedId === page.Id ? 'rotate-180' : ''}`}
                          fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                        </svg>
                      </button>
                      {expandedId === page.Id && (
                        <div className="border-t border-slate-100 overflow-x-auto">
                          <table className="w-full border-collapse min-w-[640px]">
                            <thead>
                              <tr>
                                <Th className="w-32">Field</Th>
                                <th className="text-[10px] font-bold uppercase tracking-widest text-slate-400 px-4 py-3 text-left border-b border-slate-100 bg-slate-50 w-1/2"
                                  style={{ fontFamily: "'Plus Jakarta Sans', sans-serif" }}>Current Content</th>
                                <th className="text-[10px] font-bold uppercase tracking-widest text-emerald-500 px-4 py-3 text-left border-b border-emerald-100 bg-emerald-50 w-1/2"
                                  style={{ fontFamily: "'Plus Jakarta Sans', sans-serif" }}>✦ Suggested Content</th>
                              </tr>
                            </thead>
                            <tbody>
                              {SEO_FIELD_PAIRS.map(({ label, old: oldKey, sug: sugKey }) => {
                                const oldVal = page[oldKey] as string | null;
                                const sugVal = page[sugKey] as string | null;
                                if (!oldVal && !sugVal) return null;
                                return (
                                  <tr key={label} className="border-b border-slate-100 last:border-b-0 hover:bg-slate-50/50 transition-colors">
                                    <td className="px-4 py-3 align-top"><Tag variant="blue">{label}</Tag></td>
                                    <td className="px-4 py-3 text-xs text-slate-600 leading-relaxed align-top">
                                      {oldVal || <span className="text-slate-300 italic">—</span>}
                                    </td>
                                    <td className="px-4 py-3 text-xs text-emerald-600 leading-relaxed align-top font-medium bg-emerald-50/40">
                                      {sugVal || <span className="text-slate-300 italic">—</span>}
                                    </td>
                                  </tr>
                                );
                              })}
                            </tbody>
                          </table>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
                <div className="bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden">
                  <Pagination page={seoPage} total={filteredSeo.length} pageSize={PAGE_SIZE} onChange={setSeoPage} />
                </div>
              </>
            )}
          </div>
        )}

        {/* PLACEHOLDER */}
        {!selectedScan && (
          <div className="bg-white border border-slate-200 rounded-xl shadow-sm">
            <EmptyState icon="🔍" message="Select a scan code above to view cannibalization errors and SEO analysis." />
          </div>
        )}

      </div>

      {/* FIXES MODAL */}
      {modalError && (
        <FixesModal
          error={modalError}
          fixUrl={modalFixUrl}
          fixes={fixes}
          loading={loadingFixes}
          onClose={() => { setModalError(null); setFixes([]); setModalFixUrl(null); }}
        />
      )}

    </div>
  );
}
