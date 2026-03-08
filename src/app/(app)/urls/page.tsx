'use client';

import { useState, useEffect, useMemo } from 'react';
import type { SiteURL } from '@/lib/types';

// ── helpers ────────────────────────────────────────────────────────────────

function fmtDate(s: string | null) {
  if (!s) return '—';
  return new Date(s).toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' });
}

function pathOf(url: string) {
  try { return new URL(url).pathname; } catch { return url; }
}

// ── small components ────────────────────────────────────────────────────────

function Badge({ active }: { active: boolean }) {
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-sm font-semibold ${active ? 'bg-green-100 text-green-700' : 'bg-surface2 text-muted'}`}>
      {active ? 'Active' : 'Inactive'}
    </span>
  );
}

function Spinner() {
  return (
    <div className="w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin inline-block" />
  );
}

// ── Add URL modal ────────────────────────────────────────────────────────────

function AddURLModal({ onClose, onAdded }: { onClose: () => void; onAdded: (u: SiteURL) => void }) {
  const [pageURL, setPageURL] = useState('');
  const [pageTitle, setPageTitle] = useState('');
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!pageURL.trim()) { setError('URL is required'); return; }
    setSaving(true);
    setError('');
    try {
      const res = await fetch('/api/urls', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pageURL, pageTitle, notes }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to add URL');
      onAdded(data.url);
    } catch (err: any) {
      setError(err.message);
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
      <div className="bg-surface rounded-2xl border border-border shadow-xl w-full max-w-lg mx-4 p-6">
        <div className="flex items-center justify-between mb-5">
          <h2 className="font-semibold text-ink font-display text-lg">Add New URL</h2>
          <button onClick={onClose} className="text-muted hover:text-ink transition-colors">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-ink-2 mb-1.5">Page URL <span className="text-danger">*</span></label>
            <input
              type="url"
              value={pageURL}
              onChange={(e) => setPageURL(e.target.value)}
              placeholder="https://www.boldpreciousmetals.com/silver-bullion/silver-bars/1-kilo-silver-bars"
              className="w-full px-3 py-2.5 rounded-xl border border-border bg-surface2 text-sm text-ink focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary transition"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-ink-2 mb-1.5">Page Title <span className="text-muted text-sm font-normal">(optional)</span></label>
            <input
              type="text"
              value={pageTitle}
              onChange={(e) => setPageTitle(e.target.value)}
              placeholder="e.g. 1 Kilo Silver Bars | Buy Online"
              className="w-full px-3 py-2.5 rounded-xl border border-border bg-surface2 text-sm text-ink focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary transition"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-ink-2 mb-1.5">Notes <span className="text-muted text-sm font-normal">(optional)</span></label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={2}
              placeholder="Any notes about this URL…"
              className="w-full px-3 py-2.5 rounded-xl border border-border bg-surface2 text-sm text-ink focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary transition resize-none"
            />
          </div>

          {error && <p className="text-sm text-danger bg-danger-light px-3 py-2 rounded-xl border border-red-200">{error}</p>}

          <div className="flex gap-3 pt-1">
            <button
              type="submit"
              disabled={saving}
              className="flex items-center gap-2 px-5 py-2.5 bg-primary hover:bg-blue-600 text-white text-sm font-semibold rounded-xl transition-colors disabled:opacity-60"
            >
              {saving ? <><Spinner /> Saving…</> : 'Add URL'}
            </button>
            <button type="button" onClick={onClose} className="px-5 py-2.5 border border-border text-ink-2 text-sm rounded-xl hover:bg-surface2 transition-colors">
              Cancel
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ── Edit URL modal ────────────────────────────────────────────────────────────

function EditURLModal({ url, onClose, onSaved }: { url: SiteURL; onClose: () => void; onSaved: (u: SiteURL) => void }) {
  const [pageURL, setPageURL] = useState(url.PageURL);
  const [pageTitle, setPageTitle] = useState(url.PageTitle ?? '');
  const [notes, setNotes] = useState(url.Notes ?? '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!pageURL.trim()) { setError('URL is required'); return; }
    setSaving(true);
    setError('');
    try {
      const res = await fetch(`/api/urls/${url.URLID}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pageURL, pageTitle: pageTitle || null, notes: notes || null }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to save');
      onSaved({ ...url, PageURL: pageURL, PageTitle: pageTitle || null, Notes: notes || null });
    } catch (err: any) {
      setError(err.message);
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
      <div className="bg-surface rounded-2xl border border-border shadow-xl w-full max-w-lg mx-4 p-6">
        <div className="flex items-center justify-between mb-5">
          <h2 className="font-semibold text-ink font-display text-lg">Edit URL</h2>
          <button onClick={onClose} className="text-muted hover:text-ink transition-colors">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-ink-2 mb-1.5">Page URL <span className="text-danger">*</span></label>
            <input
              type="url"
              value={pageURL}
              onChange={(e) => setPageURL(e.target.value)}
              className="w-full px-3 py-2.5 rounded-xl border border-border bg-surface2 text-sm text-ink focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary transition"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-ink-2 mb-1.5">Page Title</label>
            <input
              type="text"
              value={pageTitle}
              onChange={(e) => setPageTitle(e.target.value)}
              className="w-full px-3 py-2.5 rounded-xl border border-border bg-surface2 text-sm text-ink focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary transition"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-ink-2 mb-1.5">Notes</label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={2}
              className="w-full px-3 py-2.5 rounded-xl border border-border bg-surface2 text-sm text-ink focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary transition resize-none"
            />
          </div>
          {error && <p className="text-sm text-danger bg-danger-light px-3 py-2 rounded-xl border border-red-200">{error}</p>}
          <div className="flex gap-3 pt-1">
            <button
              type="submit"
              disabled={saving}
              className="flex items-center gap-2 px-5 py-2.5 bg-primary hover:bg-blue-600 text-white text-sm font-semibold rounded-xl transition-colors disabled:opacity-60"
            >
              {saving ? <><Spinner /> Saving…</> : 'Save Changes'}
            </button>
            <button type="button" onClick={onClose} className="px-5 py-2.5 border border-border text-ink-2 text-sm rounded-xl hover:bg-surface2 transition-colors">
              Cancel
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function URLsPage() {
  const [urls, setUrls] = useState<SiteURL[]>([]);
  const [loading, setLoading] = useState(true);
  const [needsSetup, setNeedsSetup] = useState(false);
  const [setupLoading, setSetupLoading] = useState(false);
  const [setupResult, setSetupResult] = useState<{ importedCount: number; totalURLs: number } | null>(null);
  const [search, setSearch] = useState('');
  const [filterActive, setFilterActive] = useState<'all' | 'active' | 'inactive'>('all');
  const [showAdd, setShowAdd] = useState(false);
  const [editURL, setEditURL] = useState<SiteURL | null>(null);
  const [togglingId, setTogglingId] = useState<number | null>(null);

  // ── fetch ──────────────────────────────────────────────────────────────────
  async function fetchURLs() {
    setLoading(true);
    try {
      const res = await fetch('/api/urls');
      const data = await res.json();
      if (data.needsSetup) {
        setNeedsSetup(true);
      } else {
        setUrls(data.urls ?? []);
        setNeedsSetup(false);
      }
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { fetchURLs(); }, []);

  // ── setup ──────────────────────────────────────────────────────────────────
  async function handleSetup() {
    setSetupLoading(true);
    try {
      const res = await fetch('/api/urls/setup', { method: 'POST' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Setup failed');
      setSetupResult({ importedCount: data.importedCount, totalURLs: data.totalURLs });
      await fetchURLs();
    } catch (err: any) {
      alert(err.message);
    } finally {
      setSetupLoading(false);
    }
  }

  // ── toggle active ──────────────────────────────────────────────────────────
  async function toggleActive(url: SiteURL) {
    setTogglingId(url.URLID);
    try {
      const res = await fetch(`/api/urls/${url.URLID}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isActive: !url.IsActive }),
      });
      if (!res.ok) throw new Error('Failed');
      setUrls((prev) => prev.map((u) => u.URLID === url.URLID ? { ...u, IsActive: !url.IsActive } : u));
    } catch (err) {
      console.error(err);
    } finally {
      setTogglingId(null);
    }
  }

  // ── filtered list ──────────────────────────────────────────────────────────
  const filtered = useMemo(() => {
    return urls.filter((u) => {
      if (filterActive === 'active' && !u.IsActive) return false;
      if (filterActive === 'inactive' && u.IsActive) return false;
      if (search) {
        const q = search.toLowerCase();
        if (!u.PageURL.toLowerCase().includes(q) &&
            !(u.PageTitle ?? '').toLowerCase().includes(q) &&
            !(u.TreeCluster ?? '').toLowerCase().includes(q)) return false;
      }
      return true;
    });
  }, [urls, search, filterActive]);

  const activeCount   = urls.filter((u) => u.IsActive).length;
  const inactiveCount = urls.length - activeCount;

  // ── render ─────────────────────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-muted animate-fade-slide">
        <Spinner /> Loading URLs…
      </div>
    );
  }

  return (
    <div className="animate-fade-slide space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold font-display text-ink">URL Registry</h1>
          <p className="text-muted text-sm mt-1">
            {urls.length} URLs total · {activeCount} active · {inactiveCount} inactive
          </p>
        </div>
        <div className="flex gap-2">
          {!needsSetup && (
            <button
              onClick={handleSetup}
              disabled={setupLoading}
              title="Re-import any missing URLs from the legacy AISEO_PageSEOInputs table"
              className="flex items-center gap-1.5 px-3 py-2 border border-border text-ink-2 text-sm rounded-xl hover:bg-surface2 transition-colors disabled:opacity-60"
            >
              {setupLoading ? <Spinner /> : (
                <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
                </svg>
              )}
              Import from Legacy
            </button>
          )}
          <button
            onClick={() => setShowAdd(true)}
            className="flex items-center gap-1.5 px-4 py-2 bg-primary hover:bg-blue-600 text-white text-sm font-semibold rounded-xl transition-colors shadow-sm"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
            </svg>
            Add URL
          </button>
        </div>
      </div>

      {/* Setup needed banner */}
      {needsSetup && (
        <div className="bg-blue-50 border border-blue-200 rounded-2xl p-6 text-center space-y-3">
          <svg className="w-10 h-10 text-primary mx-auto" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 10V7" />
          </svg>
          <div>
            <p className="font-semibold text-ink">URL Registry not set up yet</p>
            <p className="text-muted text-sm mt-1">
              Click below to create the <code className="bg-surface2 px-1 rounded text-sm">ClCode_URLs</code> table and import existing URLs from the legacy table.
            </p>
          </div>
          <button
            onClick={handleSetup}
            disabled={setupLoading}
            className="inline-flex items-center gap-2 px-5 py-2.5 bg-primary hover:bg-blue-600 text-white text-sm font-semibold rounded-xl transition-colors disabled:opacity-60"
          >
            {setupLoading ? <><Spinner /> Setting up…</> : 'Set Up URL Registry'}
          </button>
        </div>
      )}

      {/* Setup success banner */}
      {setupResult && (
        <div className="bg-green-50 border border-green-200 rounded-xl p-4 flex items-center gap-3">
          <svg className="w-5 h-5 text-green-600 flex-shrink-0" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          <p className="text-sm text-green-800">
            <span className="font-semibold">Setup complete!</span> Imported {setupResult.importedCount} URLs from legacy table.
            Total: {setupResult.totalURLs} URLs.
          </p>
          <button onClick={() => setSetupResult(null)} className="ml-auto text-green-600 hover:text-green-800">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
      )}

      {!needsSetup && (
        <>
          {/* Search + filter bar */}
          <div className="flex flex-wrap gap-3 items-center">
            {/* Search */}
            <div className="relative flex-1 min-w-[220px] max-w-sm">
              <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
              </svg>
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search URLs or titles…"
                className="w-full pl-9 pr-4 py-2 rounded-xl border border-border bg-surface text-sm text-ink focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary transition"
              />
            </div>

            {/* Active filter pills */}
            <div className="flex gap-1">
              {(['all', 'active', 'inactive'] as const).map((f) => (
                <button
                  key={f}
                  onClick={() => setFilterActive(f)}
                  className={`text-sm px-3 py-1.5 rounded-full border font-medium transition-colors capitalize ${filterActive === f ? 'bg-primary text-white border-primary' : 'bg-surface text-muted border-border hover:border-primary/40 hover:text-ink'}`}
                >
                  {f === 'all' ? `All (${urls.length})` : f === 'active' ? `Active (${activeCount})` : `Inactive (${inactiveCount})`}
                </button>
              ))}
            </div>

            {/* Result count */}
            <span className="text-sm text-muted ml-auto">
              {filtered.length !== urls.length ? `Showing ${filtered.length} of ${urls.length}` : `${urls.length} URLs`}
            </span>
          </div>

          {/* Table */}
          {filtered.length === 0 ? (
            <div className="text-center py-16 text-muted">
              <svg className="w-10 h-10 mx-auto mb-3 text-border" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101" />
                <path strokeLinecap="round" strokeLinejoin="round" d="M10.172 13.828a4 4 0 015.656 0l4 4a4 4 0 01-5.656 5.656l-1.102-1.101" />
              </svg>
              <p className="font-medium">No URLs match your filters</p>
              {search && (
                <button onClick={() => setSearch('')} className="mt-2 text-primary text-sm hover:underline">Clear search</button>
              )}
            </div>
          ) : (
            <div className="bg-surface rounded-2xl border border-border shadow-card overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border bg-surface2">
                    <th className="text-left px-4 py-3 font-semibold text-ink-2 text-sm uppercase tracking-wide">URL / Path</th>
                    <th className="text-left px-4 py-3 font-semibold text-ink-2 text-sm uppercase tracking-wide hidden lg:table-cell">Title</th>
                    <th className="text-center px-4 py-3 font-semibold text-ink-2 text-sm uppercase tracking-wide">Status</th>
                    <th className="text-center px-4 py-3 font-semibold text-ink-2 text-sm uppercase tracking-wide hidden md:table-cell">Scans</th>
                    <th className="text-center px-4 py-3 font-semibold text-ink-2 text-sm uppercase tracking-wide hidden md:table-cell">Suggestions Applied</th>
                    <th className="text-left px-4 py-3 font-semibold text-ink-2 text-sm uppercase tracking-wide hidden xl:table-cell">Last Scanned</th>
                    <th className="px-4 py-3" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {filtered.map((u) => (
                    <tr key={u.URLID} className="hover:bg-surface2/50 transition-colors">
                      <td className="px-4 py-3 max-w-xs">
                        <div className="font-mono text-sm text-ink truncate" title={u.PageURL}>
                          {pathOf(u.PageURL)}
                        </div>
                        {u.TreeCluster && (
                          <div className="text-sm text-muted mt-0.5">{u.TreeCluster}</div>
                        )}
                      </td>
                      <td className="px-4 py-3 hidden lg:table-cell">
                        <span className="text-sm text-ink-2 truncate block max-w-[220px]" title={u.PageTitle ?? ''}>
                          {u.PageTitle ?? <span className="text-muted italic">—</span>}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-center">
                        <Badge active={u.IsActive} />
                      </td>
                      <td className="px-4 py-3 text-center hidden md:table-cell">
                        <span className="text-sm font-semibold text-ink">{u.ScanRunCount}</span>
                      </td>
                      <td className="px-4 py-3 text-center hidden md:table-cell">
                        <span className="text-sm font-semibold text-ink">{u.SuggestionsApplied}</span>
                      </td>
                      <td className="px-4 py-3 text-sm text-muted hidden xl:table-cell whitespace-nowrap">
                        {u.LastScannedAt ? fmtDate(u.LastScannedAt) : '—'}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-1 justify-end">
                          {/* Edit */}
                          <button
                            onClick={() => setEditURL(u)}
                            title="Edit"
                            className="w-7 h-7 flex items-center justify-center rounded-lg text-muted hover:text-ink hover:bg-surface2 transition-colors"
                          >
                            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                            </svg>
                          </button>
                          {/* Toggle active */}
                          <button
                            onClick={() => toggleActive(u)}
                            disabled={togglingId === u.URLID}
                            title={u.IsActive ? 'Deactivate' : 'Activate'}
                            className={`w-7 h-7 flex items-center justify-center rounded-lg transition-colors ${u.IsActive ? 'text-muted hover:text-danger hover:bg-danger-light' : 'text-muted hover:text-green-600 hover:bg-green-50'}`}
                          >
                            {togglingId === u.URLID ? (
                              <Spinner />
                            ) : u.IsActive ? (
                              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636" />
                              </svg>
                            ) : (
                              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                              </svg>
                            )}
                          </button>
                          {/* Open in new tab */}
                          <a
                            href={u.PageURL}
                            target="_blank"
                            rel="noopener noreferrer"
                            title="Open URL"
                            className="w-7 h-7 flex items-center justify-center rounded-lg text-muted hover:text-ink hover:bg-surface2 transition-colors"
                          >
                            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                            </svg>
                          </a>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}

      {/* Modals */}
      {showAdd && (
        <AddURLModal
          onClose={() => setShowAdd(false)}
          onAdded={(u) => {
            setUrls((prev) => [...prev, u].sort((a, b) => a.PageURL.localeCompare(b.PageURL)));
            setShowAdd(false);
          }}
        />
      )}
      {editURL && (
        <EditURLModal
          url={editURL}
          onClose={() => setEditURL(null)}
          onSaved={(updated) => {
            setUrls((prev) => prev.map((u) => u.URLID === updated.URLID ? updated : u));
            setEditURL(null);
          }}
        />
      )}
    </div>
  );
}
