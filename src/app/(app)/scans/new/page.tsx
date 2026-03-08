'use client';

import { useState, useEffect, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import type { SiteURL } from '@/lib/types';

// ── types ──────────────────────────────────────────────────────────────────

interface Filter {
  pattern: string;
  count: number;
}

type Mode = 'filters' | 'limit' | 'urls';

// ── small helpers ──────────────────────────────────────────────────────────

function pathOf(url: string) {
  try { return new URL(url).pathname; } catch { return url; }
}

function Spinner({ sm }: { sm?: boolean }) {
  const sz = sm ? 'w-3 h-3' : 'w-4 h-4';
  return <div className={`${sz} border-2 border-current border-t-transparent rounded-full animate-spin inline-block`} />;
}

// ── URL selector component ─────────────────────────────────────────────────

function URLSelector({
  selected,
  onChange,
}: {
  selected: Set<number>;
  onChange: (s: Set<number>) => void;
}) {
  const [urls, setUrls] = useState<SiteURL[]>([]);
  const [loading, setLoading] = useState(true);
  const [needsSetup, setNeedsSetup] = useState(false);
  const [search, setSearch] = useState('');

  useEffect(() => {
    fetch('/api/urls')
      .then((r) => r.json())
      .then((d) => {
        if (d.needsSetup) { setNeedsSetup(true); }
        else { setUrls((d.urls ?? []).filter((u: SiteURL) => u.IsActive)); }
      })
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  const filtered = useMemo(() => {
    if (!search) return urls;
    const q = search.toLowerCase();
    return urls.filter(
      (u) => u.PageURL.toLowerCase().includes(q) || (u.PageTitle ?? '').toLowerCase().includes(q)
    );
  }, [urls, search]);

  // Group by TreeCluster
  const grouped = useMemo(() => {
    const map = new Map<string, SiteURL[]>();
    for (const u of filtered) {
      const key = u.TreeCluster ?? 'Other';
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(u);
    }
    return Array.from(map.entries()).sort(([a], [b]) => a.localeCompare(b));
  }, [filtered]);

  // Derive full objects for selected IDs (for the right panel)
  const selectedObjects = useMemo(
    () => urls.filter((u) => selected.has(u.URLID)),
    [urls, selected]
  );

  function toggleAll() {
    if (filtered.every((u) => selected.has(u.URLID))) {
      const next = new Set(selected);
      filtered.forEach((u) => next.delete(u.URLID));
      onChange(next);
    } else {
      const next = new Set(selected);
      filtered.forEach((u) => next.add(u.URLID));
      onChange(next);
    }
  }

  function toggleGroup(groupURLs: SiteURL[]) {
    const allSelected = groupURLs.every((u) => selected.has(u.URLID));
    const next = new Set(selected);
    groupURLs.forEach((u) => allSelected ? next.delete(u.URLID) : next.add(u.URLID));
    onChange(next);
  }

  function toggle(id: number) {
    const next = new Set(selected);
    next.has(id) ? next.delete(id) : next.add(id);
    onChange(next);
  }

  function clearAll() {
    onChange(new Set());
  }

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-muted text-sm py-4">
        <Spinner /> Loading URLs…
      </div>
    );
  }

  if (needsSetup) {
    return (
      <div className="text-center py-8 text-muted">
        <p className="text-sm">URL Registry not set up yet.</p>
        <a href="/urls" className="text-primary text-sm hover:underline mt-1 inline-block">
          Go to URL Registry to set it up →
        </a>
      </div>
    );
  }

  if (urls.length === 0) {
    return (
      <div className="text-center py-8 text-muted">
        <p className="text-sm">No active URLs found.</p>
        <a href="/urls" className="text-primary text-sm hover:underline mt-1 inline-block">
          Add URLs in the URL Registry →
        </a>
      </div>
    );
  }

  const allFilteredSelected = filtered.length > 0 && filtered.every((u) => selected.has(u.URLID));

  return (
    <div className="grid grid-cols-2 gap-4">

      {/* ── LEFT: URL picker ─────────────────────────────────────────────── */}
      <div className="space-y-2">
        {/* Search + select-all */}
        <div className="flex gap-2 items-center">
          <div className="relative flex-1">
            <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search URLs…"
              className="w-full pl-8 pr-3 py-1.5 rounded-lg border border-border bg-surface2 text-sm text-ink focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary transition"
            />
          </div>
          <button
            type="button"
            onClick={toggleAll}
            className="text-sm px-2.5 py-1.5 rounded-lg border border-border text-ink-2 hover:bg-surface2 whitespace-nowrap transition-colors"
          >
            {allFilteredSelected ? 'Deselect All' : 'Select All'}
          </button>
        </div>

        {/* Grouped checkbox list */}
        <div className="h-72 overflow-y-auto rounded-xl border border-border bg-surface2 divide-y divide-border">
          {grouped.map(([cluster, groupURLs]) => {
            const groupAllSelected = groupURLs.every((u) => selected.has(u.URLID));
            const groupSomeSelected = groupURLs.some((u) => selected.has(u.URLID));
            return (
              <div key={cluster}>
                {/* Cluster header */}
                <div
                  className="flex items-center gap-2 px-3 py-1.5 bg-surface sticky top-0 border-b border-border cursor-pointer select-none hover:bg-surface2 transition-colors"
                  onClick={() => toggleGroup(groupURLs)}
                >
                  <input
                    type="checkbox"
                    readOnly
                    checked={groupAllSelected}
                    ref={(el) => { if (el) el.indeterminate = !groupAllSelected && groupSomeSelected; }}
                    className="accent-primary rounded w-3 h-3 flex-shrink-0"
                  />
                  <span className="text-sm font-semibold text-ink uppercase tracking-wide">{cluster}</span>
                  <span className="text-sm text-muted ml-auto">{groupURLs.length}</span>
                </div>
                {/* URLs in group */}
                {groupURLs.map((u) => (
                  <label
                    key={u.URLID}
                    className="flex items-start gap-2.5 px-3 py-1.5 cursor-pointer hover:bg-primary/5 transition-colors"
                  >
                    <input
                      type="checkbox"
                      checked={selected.has(u.URLID)}
                      onChange={() => toggle(u.URLID)}
                      className="accent-primary rounded w-3 h-3 flex-shrink-0 mt-0.5"
                    />
                    <span className="font-mono text-sm text-ink leading-tight break-all">
                      {pathOf(u.PageURL)}
                    </span>
                  </label>
                ))}
              </div>
            );
          })}
        </div>
      </div>

      {/* ── RIGHT: Selected URLs panel ───────────────────────────────────── */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <span className="text-sm font-semibold text-ink">
            Selected
            <span className="ml-1.5 px-1.5 py-0.5 bg-primary text-white rounded-full text-sm font-bold">
              {selected.size}
            </span>
          </span>
          {selected.size > 0 && (
            <button
              type="button"
              onClick={clearAll}
              className="text-sm text-muted hover:text-danger transition-colors"
            >
              Clear all
            </button>
          )}
        </div>

        <div className="h-72 overflow-y-auto rounded-xl border border-border bg-surface2 divide-y divide-border">
          {selected.size === 0 ? (
            <div className="flex flex-col items-center justify-center h-full text-center px-4 py-8 text-muted">
              <svg className="w-8 h-8 mb-2 text-border" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
              </svg>
              <p className="text-sm">No URLs selected yet.</p>
              <p className="text-sm mt-0.5">Check URLs from the list on the left.</p>
            </div>
          ) : (
            selectedObjects.map((u) => (
              <div key={u.URLID} className="flex items-start gap-2 px-3 py-1.5 group hover:bg-danger-light/50 transition-colors">
                <span className="font-mono text-sm text-ink leading-tight break-all flex-1">
                  {pathOf(u.PageURL)}
                </span>
                <button
                  type="button"
                  onClick={() => toggle(u.URLID)}
                  title="Remove"
                  className="w-4 h-4 flex-shrink-0 mt-0.5 flex items-center justify-center rounded text-muted hover:text-danger transition-colors opacity-0 group-hover:opacity-100"
                >
                  <svg className="w-3 h-3" fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
            ))
          )}
        </div>
      </div>

    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function NewScanPage() {
  const router = useRouter();
  const [scanName, setScanName] = useState('');
  const [mode, setMode] = useState<Mode>('urls');
  const [filters, setFilters] = useState<Filter[]>([{ pattern: 'silver-coins', count: 10 }]);
  const [limitN, setLimitN] = useState(50);
  const [selectedURLIds, setSelectedURLIds] = useState<Set<number>>(new Set());
  const [analyses, setAnalyses] = useState({
    keyword: true,
    cannibalization: true,
    content: true,
  });
  const [provider, setProvider] = useState<'claude' | 'gemini'>('claude');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const toggleAnalysis = (key: keyof typeof analyses) =>
    setAnalyses((a) => ({ ...a, [key]: !a[key] }));

  const selectedAnalyses = Object.entries(analyses)
    .filter(([, v]) => v)
    .map(([k]) => k);

  const addFilter = () => setFilters((f) => [...f, { pattern: '', count: 10 }]);
  const removeFilter = (i: number) => setFilters((f) => f.filter((_, idx) => idx !== i));
  const updateFilter = (i: number, key: keyof Filter, val: string | number) => {
    setFilters((f) => f.map((item, idx) => idx === i ? { ...item, [key]: val } : item));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!scanName.trim()) { setError('Scan name is required'); return; }
    if (mode === 'urls' && selectedURLIds.size === 0) { setError('Select at least one URL'); return; }
    if (selectedAnalyses.length === 0) { setError('Select at least one analysis to run'); return; }
    setLoading(true);
    setError('');

    try {
      const res = await fetch('/api/scans/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          scanName: scanName.trim(),
          mode,
          urlFilters: mode === 'filters' ? filters : undefined,
          limitN: mode === 'limit' ? limitN : undefined,
          selectedURLIds: mode === 'urls' ? Array.from(selectedURLIds) : undefined,
          analyses: selectedAnalyses,
          provider,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to start scan');
      router.push(`/scans/${data.scanId}`);
    } catch (err: any) {
      setError(err.message);
      setLoading(false);
    }
  };

  return (
    <div className="max-w-2xl animate-fade-slide">
      {/* Header */}
      <div className="mb-8">
        <h1 className="text-2xl font-bold font-display text-ink">New Scan</h1>
        <p className="text-muted text-sm mt-1">Configure and launch a new SEO scan</p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-6">
        {/* Scan Name */}
        <div className="bg-surface rounded-2xl border border-border shadow-card p-6 space-y-4">
          <h2 className="font-semibold text-ink font-display">Scan Details</h2>
          <div>
            <label className="block text-sm font-medium text-ink-2 mb-1.5">Scan Name</label>
            <input
              type="text"
              value={scanName}
              onChange={(e) => setScanName(e.target.value)}
              placeholder="e.g. Silver Products – March 2025"
              className="w-full px-4 py-2.5 rounded-xl border border-border bg-surface2 text-ink text-sm focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary transition"
            />
          </div>
        </div>

        {/* Mode */}
        <div className="bg-surface rounded-2xl border border-border shadow-card p-6 space-y-4">
          <h2 className="font-semibold text-ink font-display">URL Selection Mode</h2>

          {/* Mode cards */}
          <div className="grid grid-cols-3 gap-3">
            {/* Select URLs (recommended) */}
            <label className={`flex flex-col gap-1.5 p-4 rounded-xl border-2 cursor-pointer transition-colors ${mode === 'urls' ? 'border-primary bg-primary-light' : 'border-border hover:border-border-strong'}`}>
              <div className="flex items-center gap-2">
                <input type="radio" name="mode" value="urls" checked={mode === 'urls'} onChange={() => setMode('urls')} className="accent-primary" />
                <span className="font-medium text-ink text-sm">Select URLs</span>
              </div>
              <p className="text-muted text-sm pl-5">Pick specific pages from your URL Registry</p>
              {mode === 'urls' && (
                <span className="self-start mt-0.5 ml-5 text-sm font-semibold px-1.5 py-0.5 bg-primary text-white rounded-full">Recommended</span>
              )}
            </label>

            {/* URL Filters */}
            <label className={`flex flex-col gap-1.5 p-4 rounded-xl border-2 cursor-pointer transition-colors ${mode === 'filters' ? 'border-primary bg-primary-light' : 'border-border hover:border-border-strong'}`}>
              <div className="flex items-center gap-2">
                <input type="radio" name="mode" value="filters" checked={mode === 'filters'} onChange={() => setMode('filters')} className="accent-primary" />
                <span className="font-medium text-ink text-sm">URL Filters</span>
              </div>
              <p className="text-muted text-sm pl-5">Pattern + count (e.g. silver-coins:10)</p>
            </label>

            {/* Top N */}
            <label className={`flex flex-col gap-1.5 p-4 rounded-xl border-2 cursor-pointer transition-colors ${mode === 'limit' ? 'border-primary bg-primary-light' : 'border-border hover:border-border-strong'}`}>
              <div className="flex items-center gap-2">
                <input type="radio" name="mode" value="limit" checked={mode === 'limit'} onChange={() => setMode('limit')} className="accent-primary" />
                <span className="font-medium text-ink text-sm">Top N</span>
              </div>
              <p className="text-muted text-sm pl-5">Scan the first N URLs from the registry</p>
            </label>
          </div>

          {/* ── Select URLs mode ── */}
          {mode === 'urls' && (
            <URLSelector
              selected={selectedURLIds}
              onChange={setSelectedURLIds}
            />
          )}

          {/* ── URL Filters mode ── */}
          {mode === 'filters' && (
            <div className="space-y-3">
              <div className="grid grid-cols-[1fr_100px_40px] gap-2 text-sm font-medium text-muted px-1">
                <span>URL Pattern (path segment)</span>
                <span>Count</span>
                <span />
              </div>
              {filters.map((f, i) => (
                <div key={i} className="grid grid-cols-[1fr_100px_40px] gap-2 items-center">
                  <input
                    type="text"
                    value={f.pattern}
                    onChange={(e) => updateFilter(i, 'pattern', e.target.value)}
                    placeholder="e.g. silver-coins"
                    className="px-3 py-2 rounded-xl border border-border bg-surface2 text-sm text-ink focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary transition"
                  />
                  <input
                    type="number"
                    min={1}
                    max={500}
                    value={f.count}
                    onChange={(e) => updateFilter(i, 'count', parseInt(e.target.value) || 10)}
                    className="px-3 py-2 rounded-xl border border-border bg-surface2 text-sm text-ink text-center focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary transition"
                  />
                  <button
                    type="button"
                    onClick={() => removeFilter(i)}
                    disabled={filters.length === 1}
                    className="w-9 h-9 flex items-center justify-center rounded-lg text-muted hover:text-danger hover:bg-danger-light disabled:opacity-30 disabled:cursor-not-allowed transition"
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                </div>
              ))}
              <button
                type="button"
                onClick={addFilter}
                className="flex items-center gap-1.5 text-sm text-primary font-medium hover:underline"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
                </svg>
                Add Filter
              </button>
            </div>
          )}

          {/* ── Top N mode ── */}
          {mode === 'limit' && (
            <div className="max-w-xs">
              <label className="block text-sm font-medium text-ink-2 mb-1.5">Number of URLs</label>
              <input
                type="number"
                min={1}
                max={1000}
                value={limitN}
                onChange={(e) => setLimitN(parseInt(e.target.value) || 50)}
                className="w-full px-4 py-2.5 rounded-xl border border-border bg-surface2 text-ink text-sm focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary transition"
              />
              <p className="text-muted text-sm mt-1.5">Top N active URLs from ClCode_URLs</p>
            </div>
          )}
        </div>

        {/* Analyses to run */}
        <div className="bg-surface rounded-2xl border border-border shadow-card p-6 space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="font-semibold text-ink font-display">Analyses to Run</h2>
            <span className="text-sm text-muted">{selectedAnalyses.length} of 3 selected</span>
          </div>

          <div className="space-y-2">
            {/* Keyword Extraction */}
            <label className={`flex items-start gap-3 p-3.5 rounded-xl border-2 cursor-pointer transition-colors ${analyses.keyword ? 'border-primary bg-primary-light' : 'border-border hover:border-border-strong'}`}>
              <input
                type="checkbox"
                checked={analyses.keyword}
                onChange={() => toggleAnalysis('keyword')}
                className="mt-0.5 accent-primary w-4 h-4 flex-shrink-0"
              />
              <div className="min-w-0">
                <p className="font-medium text-ink text-sm">Keyword Extraction</p>
                <p className="text-muted text-sm mt-0.5">
                  Identifies primary keywords, search intent, keyword gaps and missing LSI terms per page.
                  Enriches the other two analyses when enabled.
                </p>
              </div>
            </label>

            {/* Cannibalization */}
            <label className={`flex items-start gap-3 p-3.5 rounded-xl border-2 cursor-pointer transition-colors ${analyses.cannibalization ? 'border-primary bg-primary-light' : 'border-border hover:border-border-strong'}`}>
              <input
                type="checkbox"
                checked={analyses.cannibalization}
                onChange={() => toggleAnalysis('cannibalization')}
                className="mt-0.5 accent-primary w-4 h-4 flex-shrink-0"
              />
              <div className="min-w-0">
                <p className="font-medium text-ink text-sm">Cannibalization Analysis</p>
                <p className="text-muted text-sm mt-0.5">
                  Detects pages within the same tree cluster competing for the same keywords.
                  Requires at least 2 pages per cluster.
                </p>
              </div>
            </label>

            {/* Content Improvement */}
            <label className={`flex items-start gap-3 p-3.5 rounded-xl border-2 cursor-pointer transition-colors ${analyses.content ? 'border-primary bg-primary-light' : 'border-border hover:border-border-strong'}`}>
              <input
                type="checkbox"
                checked={analyses.content}
                onChange={() => toggleAnalysis('content')}
                className="mt-0.5 accent-primary w-4 h-4 flex-shrink-0"
              />
              <div className="min-w-0">
                <p className="font-medium text-ink text-sm">Content Improvements</p>
                <p className="text-muted text-sm mt-0.5">
                  Suggests per-field improvements to meta title, description, H1, body copy and more.
                  Uses keyword context if Keyword Extraction is also enabled.
                </p>
              </div>
            </label>
          </div>

          {selectedAnalyses.length === 0 && (
            <p className="text-sm text-danger font-medium">⚠ Select at least one analysis to run.</p>
          )}
        </div>

        {/* AI Provider */}
        <div className="bg-surface rounded-2xl border border-border shadow-card p-6 space-y-4">
          <h2 className="font-semibold text-ink font-display">AI Provider</h2>
          <div className="grid grid-cols-2 gap-3">
            {/* Claude */}
            <label className={`flex items-start gap-3 p-4 rounded-xl border-2 cursor-pointer transition-colors ${provider === 'claude' ? 'border-primary bg-primary-light' : 'border-border hover:border-border-strong'}`}>
              <input
                type="radio"
                name="provider"
                value="claude"
                checked={provider === 'claude'}
                onChange={() => setProvider('claude')}
                className="mt-0.5 accent-primary flex-shrink-0"
              />
              <div className="min-w-0">
                <p className="font-medium text-ink text-sm">Claude (Anthropic)</p>
                <p className="text-muted text-sm mt-0.5">claude-sonnet-4 · Prompt caching enabled</p>
                {provider === 'claude' && (
                  <span className="inline-block mt-1 text-sm font-semibold px-1.5 py-0.5 bg-primary text-white rounded-full">Recommended</span>
                )}
              </div>
            </label>

            {/* Gemini */}
            <label className={`flex items-start gap-3 p-4 rounded-xl border-2 cursor-pointer transition-colors ${provider === 'gemini' ? 'border-primary bg-primary-light' : 'border-border hover:border-border-strong'}`}>
              <input
                type="radio"
                name="provider"
                value="gemini"
                checked={provider === 'gemini'}
                onChange={() => setProvider('gemini')}
                className="mt-0.5 accent-primary flex-shrink-0"
              />
              <div className="min-w-0">
                <p className="font-medium text-ink text-sm">Gemini (Google)</p>
                <p className="text-muted text-sm mt-0.5">gemini-2.0-flash · Lower cost per token</p>
              </div>
            </label>
          </div>
          <p className="text-sm text-muted">
            Configure API keys in <a href="/settings" className="text-primary hover:underline">Settings</a> before running.
          </p>
        </div>

        {/* Info box */}
        <div className="flex gap-3 p-4 bg-blue-50 border border-blue-200 rounded-xl">
          <svg className="w-5 h-5 text-primary flex-shrink-0 mt-0.5" fill="none" stroke="currentColor" strokeWidth={1.8} viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          <div className="text-sm text-blue-800">
            <p className="font-medium">Scan runs in the background</p>
            <p className="mt-0.5 text-blue-700">
              The Python pipeline will scrape selected URLs, call the selected AI provider 3× per page, and store results in SQL Server.
              Full scans may take 10–30 minutes. The scan detail page auto-refreshes while running.
            </p>
          </div>
        </div>

        {/* Error */}
        {error && (
          <div className="p-3 bg-danger-light border border-red-200 rounded-xl text-sm text-danger">{error}</div>
        )}

        {/* Submit */}
        <div className="flex gap-3">
          <button
            type="submit"
            disabled={loading}
            className="flex items-center gap-2 px-6 py-2.5 bg-primary hover:bg-blue-600 text-white text-sm font-semibold rounded-xl transition-colors disabled:opacity-60 disabled:cursor-not-allowed shadow-sm"
          >
            {loading ? (
              <><Spinner /> Starting…</>
            ) : (
              <>
                <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z" />
                  <path strokeLinecap="round" strokeLinejoin="round" d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                Start Scan
              </>
            )}
          </button>
          <a
            href="/scans"
            className="px-6 py-2.5 border border-border text-ink-2 text-sm font-medium rounded-xl hover:bg-surface2 transition-colors"
          >
            Cancel
          </a>
        </div>
      </form>
    </div>
  );
}
