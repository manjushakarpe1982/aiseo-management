'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

interface Filter {
  pattern: string;
  count: number;
}

export default function NewScanPage() {
  const router = useRouter();
  const [scanName, setScanName] = useState('');
  const [mode, setMode] = useState<'filters' | 'limit'>('filters');
  const [filters, setFilters] = useState<Filter[]>([{ pattern: 'silver-coins', count: 10 }]);
  const [limitN, setLimitN] = useState(50);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const addFilter = () => setFilters((f) => [...f, { pattern: '', count: 10 }]);
  const removeFilter = (i: number) => setFilters((f) => f.filter((_, idx) => idx !== i));
  const updateFilter = (i: number, key: keyof Filter, val: string | number) => {
    setFilters((f) => f.map((item, idx) => idx === i ? { ...item, [key]: val } : item));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!scanName.trim()) { setError('Scan name is required'); return; }
    setLoading(true);
    setError('');

    try {
      const res = await fetch('/api/scans/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ scanName: scanName.trim(), mode, urlFilters: filters, limitN }),
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
          <div className="flex gap-4">
            <label className={`flex-1 flex items-start gap-3 p-4 rounded-xl border-2 cursor-pointer transition-colors ${mode === 'filters' ? 'border-primary bg-primary-light' : 'border-border hover:border-border-strong'}`}>
              <input
                type="radio"
                name="mode"
                value="filters"
                checked={mode === 'filters'}
                onChange={() => setMode('filters')}
                className="mt-0.5 accent-primary"
              />
              <div>
                <p className="font-medium text-ink text-sm">URL Filters</p>
                <p className="text-muted text-xs mt-0.5">Specify URL patterns with counts (e.g. silver-coins:10)</p>
              </div>
            </label>
            <label className={`flex-1 flex items-start gap-3 p-4 rounded-xl border-2 cursor-pointer transition-colors ${mode === 'limit' ? 'border-primary bg-primary-light' : 'border-border hover:border-border-strong'}`}>
              <input
                type="radio"
                name="mode"
                value="limit"
                checked={mode === 'limit'}
                onChange={() => setMode('limit')}
                className="mt-0.5 accent-primary"
              />
              <div>
                <p className="font-medium text-ink text-sm">Top N</p>
                <p className="text-muted text-xs mt-0.5">Scrape the top N URLs from the source table</p>
              </div>
            </label>
          </div>

          {/* URL Filters mode */}
          {mode === 'filters' && (
            <div className="space-y-3">
              <div className="grid grid-cols-[1fr_100px_40px] gap-2 text-xs font-medium text-muted px-1">
                <span>URL Pattern (2nd path segment)</span>
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

          {/* Limit mode */}
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
              <p className="text-muted text-xs mt-1.5">Top N URLs from AISEO_PageSEOInputs</p>
            </div>
          )}
        </div>

        {/* Info box */}
        <div className="flex gap-3 p-4 bg-blue-50 border border-blue-200 rounded-xl">
          <svg className="w-5 h-5 text-primary flex-shrink-0 mt-0.5" fill="none" stroke="currentColor" strokeWidth={1.8} viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          <div className="text-sm text-blue-800">
            <p className="font-medium">Scan runs in the background</p>
            <p className="mt-0.5 text-blue-700">
              The Python pipeline will scrape URLs, call Claude 3× per page, and store results in SQL Server.
              Full scans may take 10–30 minutes. The scan detail page will auto-refresh while running.
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
              <>
                <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                Starting…
              </>
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
