'use client';

import { useState, useEffect, useMemo } from 'react';
import type { SiteURL, URLMetric } from '@/lib/types';

// ── helpers ──────────────────────────────────────────────────────────────────

function fmtDate(s: string | null) {
  if (!s) return '—';
  return new Date(s).toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' });
}

function pathOf(url: string) {
  try { return new URL(url).pathname; } catch { return url; }
}

// ── small components ─────────────────────────────────────────────────────────

function Spinner() {
  return <div className="w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin inline-block" />;
}

function ActiveBadge({ active }: { active: boolean }) {
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold ${active ? 'bg-green-100 text-green-700' : 'bg-surface2 text-muted'}`}>
      {active ? 'Active' : 'Inactive'}
    </span>
  );
}

function PriorityBadge({ priority }: { priority: string | null }) {
  if (!priority) return <span className="text-muted text-sm">—</span>;
  const styles: Record<string, string> = {
    High:   'bg-red-100 text-red-700',
    Medium: 'bg-yellow-100 text-yellow-700',
    Low:    'bg-green-100 text-green-700',
  };
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold ${styles[priority] ?? 'bg-surface2 text-muted'}`}>
      {priority}
    </span>
  );
}

function SerpBadge({ pos }: { pos: number | null }) {
  if (pos == null) return <span className="text-muted">—</span>;
  const cls =
    pos <= 3  ? 'bg-green-100 text-green-700' :
    pos <= 10 ? 'bg-blue-100 text-blue-700' :
    pos <= 20 ? 'bg-yellow-100 text-yellow-700' :
                'bg-surface2 text-muted';
  return <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-bold ${cls}`}>#{pos}</span>;
}

// ── shared form fields ────────────────────────────────────────────────────────

interface URLFormData {
  pageURL: string;
  pageTitle: string;
  primaryKeyword: string;
  secondaryKeywords: string;
  priority: string;
  notes: string;
}

const inputCls =
  'w-full px-3 py-2.5 rounded-xl border border-border bg-surface2 text-sm text-ink ' +
  'focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary transition';

function URLFormFields({
  data,
  onChange,
  showURL = true,
}: {
  data: URLFormData;
  onChange: (patch: Partial<URLFormData>) => void;
  showURL?: boolean;
}) {
  return (
    <div className="space-y-4">
      {showURL && (
        <div>
          <label className="block text-sm font-medium text-ink-2 mb-1.5">
            Page URL <span className="text-danger">*</span>
          </label>
          <input
            type="url"
            value={data.pageURL}
            onChange={(e) => onChange({ pageURL: e.target.value })}
            placeholder="https://example.com/page"
            className={inputCls}
          />
        </div>
      )}
      <div>
        <label className="block text-sm font-medium text-ink-2 mb-1.5">
          Page Title <span className="text-muted text-xs font-normal">(optional)</span>
        </label>
        <input
          type="text"
          value={data.pageTitle}
          onChange={(e) => onChange({ pageTitle: e.target.value })}
          placeholder="e.g. 1 Kilo Silver Bars | Buy Online"
          className={inputCls}
        />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-sm font-medium text-ink-2 mb-1.5">Primary Keyword</label>
          <input
            type="text"
            value={data.primaryKeyword}
            onChange={(e) => onChange({ primaryKeyword: e.target.value })}
            placeholder="e.g. silver bars"
            className={inputCls}
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-ink-2 mb-1.5">Priority</label>
          <select
            value={data.priority}
            onChange={(e) => onChange({ priority: e.target.value })}
            className={inputCls}
          >
            <option value="">— None —</option>
            <option value="High">High</option>
            <option value="Medium">Medium</option>
            <option value="Low">Low</option>
          </select>
        </div>
      </div>
      <div>
        <label className="block text-sm font-medium text-ink-2 mb-1.5">
          Secondary Keywords <span className="text-muted text-xs font-normal">(comma-separated)</span>
        </label>
        <input
          type="text"
          value={data.secondaryKeywords}
          onChange={(e) => onChange({ secondaryKeywords: e.target.value })}
          placeholder="e.g. buy silver bars, silver bullion, 1kg silver bar"
          className={inputCls}
        />
      </div>
      <div>
        <label className="block text-sm font-medium text-ink-2 mb-1.5">
          Notes <span className="text-muted text-xs font-normal">(optional)</span>
        </label>
        <textarea
          value={data.notes}
          onChange={(e) => onChange({ notes: e.target.value })}
          rows={2}
          placeholder="Any notes about this URL…"
          className={`${inputCls} resize-none`}
        />
      </div>
    </div>
  );
}

// ── Add URL Modal ─────────────────────────────────────────────────────────────

function AddURLModal({ onClose, onAdded }: { onClose: () => void; onAdded: (u: SiteURL) => void }) {
  const [form, setForm] = useState<URLFormData>({
    pageURL: '', pageTitle: '', primaryKeyword: '', secondaryKeywords: '', priority: '', notes: '',
  });
  const [saving, setSaving] = useState(false);
  const [error,  setError]  = useState('');

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.pageURL.trim()) { setError('URL is required'); return; }
    setSaving(true); setError('');
    try {
      const res = await fetch('/api/urls', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          pageURL:           form.pageURL,
          pageTitle:         form.pageTitle         || null,
          primaryKeyword:    form.primaryKeyword    || null,
          secondaryKeywords: form.secondaryKeywords || null,
          priority:          form.priority          || null,
          notes:             form.notes             || null,
        }),
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
      <div className="bg-surface rounded-2xl border border-border shadow-xl w-full max-w-lg mx-4 p-6 max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between mb-5">
          <h2 className="font-semibold text-ink font-display text-lg">Add New URL</h2>
          <button onClick={onClose} className="text-muted hover:text-ink transition-colors">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
        <form onSubmit={handleSubmit}>
          <URLFormFields data={form} onChange={(p) => setForm((prev) => ({ ...prev, ...p }))} />
          {error && (
            <p className="mt-4 text-sm text-danger bg-danger-light px-3 py-2 rounded-xl border border-red-200">{error}</p>
          )}
          <div className="flex gap-3 mt-5">
            <button
              type="submit" disabled={saving}
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

// ── Edit URL Modal ────────────────────────────────────────────────────────────

function EditURLModal({ url, onClose, onSaved }: { url: SiteURL; onClose: () => void; onSaved: (u: SiteURL) => void }) {
  const [form, setForm] = useState<URLFormData>({
    pageURL:           url.PageURL,
    pageTitle:         url.PageTitle         ?? '',
    primaryKeyword:    url.PrimaryKeyword    ?? '',
    secondaryKeywords: url.SecondaryKeywords ?? '',
    priority:          url.Priority          ?? '',
    notes:             url.Notes             ?? '',
  });
  const [saving, setSaving] = useState(false);
  const [error,  setError]  = useState('');

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.pageURL.trim()) { setError('URL is required'); return; }
    setSaving(true); setError('');
    try {
      const res = await fetch(`/api/urls/${url.URLID}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          pageURL:           form.pageURL,
          pageTitle:         form.pageTitle         || null,
          primaryKeyword:    form.primaryKeyword    || null,
          secondaryKeywords: form.secondaryKeywords || null,
          priority:          form.priority          || null,
          notes:             form.notes             || null,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to save');
      onSaved({
        ...url,
        PageURL:           form.pageURL,
        PageTitle:         form.pageTitle         || null,
        PrimaryKeyword:    form.primaryKeyword    || null,
        SecondaryKeywords: form.secondaryKeywords || null,
        Priority:          (form.priority || null) as SiteURL['Priority'],
        Notes:             form.notes             || null,
      });
    } catch (err: any) {
      setError(err.message);
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
      <div className="bg-surface rounded-2xl border border-border shadow-xl w-full max-w-lg mx-4 p-6 max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between mb-5">
          <h2 className="font-semibold text-ink font-display text-lg">Edit URL</h2>
          <button onClick={onClose} className="text-muted hover:text-ink transition-colors">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
        <form onSubmit={handleSubmit}>
          <URLFormFields data={form} onChange={(p) => setForm((prev) => ({ ...prev, ...p }))} />
          {error && (
            <p className="mt-4 text-sm text-danger bg-danger-light px-3 py-2 rounded-xl border border-red-200">{error}</p>
          )}
          <div className="flex gap-3 mt-5">
            <button
              type="submit" disabled={saving}
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

// ── Metrics Modal ─────────────────────────────────────────────────────────────

function MetricsModal({ url, onClose }: { url: SiteURL; onClose: () => void }) {
  const [metrics,    setMetrics]    = useState<URLMetric[]>([]);
  const [loading,    setLoading]    = useState(true);
  const [needsSetup, setNeedsSetup] = useState(false);
  const [showForm,   setShowForm]   = useState(false);

  // form state
  const today = new Date().toISOString().split('T')[0];
  const [date,         setDate]         = useState(today);
  const [serpPosition, setSerpPosition] = useState('');
  const [searchVolume, setSearchVolume] = useState('');
  const [notes,        setNotes]        = useState('');
  const [saving,       setSaving]       = useState(false);
  const [formError,    setFormError]    = useState('');

  async function fetchMetrics() {
    setLoading(true);
    try {
      const res  = await fetch(`/api/urls/${url.URLID}/metrics`);
      const data = await res.json();
      if (data.needsSetup) { setNeedsSetup(true); }
      else                 { setMetrics(data.metrics ?? []); }
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { fetchMetrics(); }, []);  // eslint-disable-line react-hooks/exhaustive-deps

  async function handleSetup() {
    try {
      const res = await fetch('/api/urls/setup', { method: 'POST' });
      if (res.ok) { setNeedsSetup(false); fetchMetrics(); }
    } catch (err) { console.error(err); }
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true); setFormError('');
    try {
      const res = await fetch(`/api/urls/${url.URLID}/metrics`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          recordedDate: date,
          serpPosition: serpPosition || null,
          searchVolume: searchVolume || null,
          notes:        notes        || null,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to save');
      setShowForm(false);
      setSerpPosition(''); setSearchVolume(''); setNotes('');
      await fetchMetrics();
    } catch (err: any) {
      setFormError(err.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
      <div className="bg-surface rounded-2xl border border-border shadow-xl w-full max-w-2xl mx-4 max-h-[90vh] flex flex-col">

        {/* Header */}
        <div className="flex items-start justify-between p-6 pb-4 border-b border-border flex-shrink-0">
          <div>
            <h2 className="font-semibold text-ink font-display text-lg">SERP & Search Volume</h2>
            <p className="text-sm text-muted mt-0.5 font-mono truncate max-w-sm">{pathOf(url.PageURL)}</p>
            {url.PrimaryKeyword && (
              <p className="text-sm text-ink-2 mt-0.5">
                Tracking: <span className="font-medium text-primary">{url.PrimaryKeyword}</span>
              </p>
            )}
          </div>
          <button onClick={onClose} className="text-muted hover:text-ink transition-colors mt-0.5 flex-shrink-0 ml-4">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-6 space-y-4">
          {needsSetup ? (
            <div className="text-center py-10 space-y-3">
              <p className="text-muted text-sm">Metrics table has not been set up yet.</p>
              <button
                onClick={handleSetup}
                className="px-4 py-2 bg-primary hover:bg-blue-600 text-white text-sm font-semibold rounded-xl transition-colors"
              >
                Run Setup
              </button>
            </div>
          ) : loading ? (
            <div className="flex items-center gap-2 text-muted py-4"><Spinner /> Loading metrics…</div>
          ) : (
            <>
              {/* Add form */}
              {showForm ? (
                <form onSubmit={handleSave} className="bg-surface2 rounded-xl p-4 border border-border space-y-3">
                  <h3 className="font-semibold text-ink text-sm">Add / Update Entry</h3>
                  <div className="grid grid-cols-3 gap-3">
                    <div>
                      <label className="block text-xs font-medium text-ink-2 mb-1">
                        Date <span className="text-danger">*</span>
                      </label>
                      <input
                        type="date"
                        value={date}
                        onChange={(e) => setDate(e.target.value)}
                        className="w-full px-3 py-2 rounded-xl border border-border bg-surface text-sm text-ink focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary transition"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-ink-2 mb-1">SERP Position</label>
                      <input
                        type="number"
                        value={serpPosition}
                        onChange={(e) => setSerpPosition(e.target.value)}
                        placeholder="e.g. 3"
                        min="1" max="200"
                        className="w-full px-3 py-2 rounded-xl border border-border bg-surface text-sm text-ink focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary transition"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-ink-2 mb-1">Search Volume / mo</label>
                      <input
                        type="number"
                        value={searchVolume}
                        onChange={(e) => setSearchVolume(e.target.value)}
                        placeholder="e.g. 1200"
                        min="0"
                        className="w-full px-3 py-2 rounded-xl border border-border bg-surface text-sm text-ink focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary transition"
                      />
                    </div>
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-ink-2 mb-1">Notes (optional)</label>
                    <input
                      type="text"
                      value={notes}
                      onChange={(e) => setNotes(e.target.value)}
                      placeholder="e.g. After content update"
                      className="w-full px-3 py-2 rounded-xl border border-border bg-surface text-sm text-ink focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary transition"
                    />
                  </div>
                  {formError && <p className="text-xs text-danger">{formError}</p>}
                  <div className="flex gap-2">
                    <button
                      type="submit" disabled={saving}
                      className="flex items-center gap-1.5 px-4 py-2 bg-primary hover:bg-blue-600 text-white text-xs font-semibold rounded-xl transition-colors disabled:opacity-60"
                    >
                      {saving ? <><Spinner /> Saving…</> : 'Save Entry'}
                    </button>
                    <button
                      type="button"
                      onClick={() => { setShowForm(false); setFormError(''); }}
                      className="px-4 py-2 border border-border text-ink-2 text-xs rounded-xl hover:bg-surface2 transition-colors"
                    >
                      Cancel
                    </button>
                  </div>
                </form>
              ) : (
                <button
                  onClick={() => { setDate(today); setShowForm(true); }}
                  className="flex items-center gap-1.5 px-4 py-2 bg-primary hover:bg-blue-600 text-white text-sm font-semibold rounded-xl transition-colors"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
                  </svg>
                  Add Entry
                </button>
              )}

              {/* Metrics table */}
              {metrics.length === 0 ? (
                <div className="text-center py-10 text-muted text-sm">
                  No metrics recorded yet. Click <strong>Add Entry</strong> to start tracking.
                </div>
              ) : (
                <div className="bg-surface rounded-xl border border-border overflow-hidden">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-border bg-surface2">
                        <th className="text-left  px-4 py-3 font-semibold text-ink-2 text-xs uppercase tracking-wide">Date</th>
                        <th className="text-center px-4 py-3 font-semibold text-ink-2 text-xs uppercase tracking-wide">SERP Position</th>
                        <th className="text-center px-4 py-3 font-semibold text-ink-2 text-xs uppercase tracking-wide">Search Volume</th>
                        <th className="text-left  px-4 py-3 font-semibold text-ink-2 text-xs uppercase tracking-wide hidden sm:table-cell">Notes</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {metrics.map((m) => (
                        <tr key={m.MetricID} className="hover:bg-surface2/50 transition-colors">
                          <td className="px-4 py-3 font-mono text-sm text-ink">{m.RecordedDate}</td>
                          <td className="px-4 py-3 text-center">
                            <SerpBadge pos={m.SERPPosition} />
                          </td>
                          <td className="px-4 py-3 text-center font-mono text-sm text-ink">
                            {m.SearchVolume != null ? m.SearchVolume.toLocaleString() : <span className="text-muted">—</span>}
                          </td>
                          <td className="px-4 py-3 text-sm text-muted hidden sm:table-cell">{m.Notes ?? '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function URLsPage() {
  const [urls,          setUrls]          = useState<SiteURL[]>([]);
  const [loading,       setLoading]       = useState(true);
  const [needsSetup,    setNeedsSetup]    = useState(false);
  const [setupLoading,  setSetupLoading]  = useState(false);
  const [setupResult,   setSetupResult]   = useState<{ importedCount: number; totalURLs: number } | null>(null);
  const [search,        setSearch]        = useState('');
  const [filterActive,  setFilterActive]  = useState<'all' | 'active' | 'inactive'>('all');
  const [filterPriority,setFilterPriority]= useState<string>('all');
  const [showAdd,       setShowAdd]       = useState(false);
  const [editURL,       setEditURL]       = useState<SiteURL | null>(null);
  const [metricsURL,    setMetricsURL]    = useState<SiteURL | null>(null);
  const [togglingId,    setTogglingId]    = useState<number | null>(null);
  const [deletingId,    setDeletingId]    = useState<number | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<number | null>(null);

  // ── fetch ───────────────────────────────────────────────────────────────────
  async function fetchURLs() {
    setLoading(true);
    try {
      const res  = await fetch('/api/urls');
      const data = await res.json();
      if (data.needsSetup) { setNeedsSetup(true); }
      else                 { setUrls(data.urls ?? []); setNeedsSetup(false); }
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { fetchURLs(); }, []);

  // ── setup ───────────────────────────────────────────────────────────────────
  async function handleSetup() {
    setSetupLoading(true);
    try {
      const res  = await fetch('/api/urls/setup', { method: 'POST' });
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

  // ── toggle active ───────────────────────────────────────────────────────────
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

  // ── delete ──────────────────────────────────────────────────────────────────
  async function deleteURL(id: number) {
    setDeletingId(id);
    try {
      const res = await fetch(`/api/urls/${id}`, { method: 'DELETE' });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Failed to delete');
      }
      setUrls((prev) => prev.filter((u) => u.URLID !== id));
      setConfirmDeleteId(null);
    } catch (err: any) {
      alert(err.message);
    } finally {
      setDeletingId(null);
    }
  }

  // ── filtered list ───────────────────────────────────────────────────────────
  const filtered = useMemo(() => {
    return urls.filter((u) => {
      if (filterActive   === 'active'   && !u.IsActive)                       return false;
      if (filterActive   === 'inactive' &&  u.IsActive)                       return false;
      if (filterPriority !== 'all'      && u.Priority !== filterPriority)     return false;
      if (search) {
        const q = search.toLowerCase();
        if (
          !u.PageURL.toLowerCase().includes(q) &&
          !(u.PageTitle         ?? '').toLowerCase().includes(q) &&
          !(u.PrimaryKeyword    ?? '').toLowerCase().includes(q) &&
          !(u.SecondaryKeywords ?? '').toLowerCase().includes(q) &&
          !(u.TreeCluster       ?? '').toLowerCase().includes(q)
        ) return false;
      }
      return true;
    });
  }, [urls, search, filterActive, filterPriority]);

  const activeCount   = urls.filter((u) =>  u.IsActive).length;
  const inactiveCount = urls.filter((u) => !u.IsActive).length;

  // ── render ──────────────────────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-muted animate-fade-slide">
        <Spinner /> Loading URLs…
      </div>
    );
  }

  return (
    <div className="animate-fade-slide space-y-6">

      {/* ── Header ── */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold font-display text-ink">URL Registry</h1>
          <p className="text-muted text-sm mt-1">
            {urls.length} URLs total · {activeCount} active · {inactiveCount} inactive
          </p>
        </div>
        <div className="flex gap-2 flex-shrink-0">
          {!needsSetup && (
            <button
              onClick={handleSetup}
              disabled={setupLoading}
              title="Add new columns and import any missing URLs from the legacy table"
              className="flex items-center gap-1.5 px-3 py-2 border border-border text-ink-2 text-sm rounded-xl hover:bg-surface2 transition-colors disabled:opacity-60"
            >
              {setupLoading ? <Spinner /> : (
                <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
                </svg>
              )}
              Import / Migrate
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

      {/* ── Setup needed banner ── */}
      {needsSetup && (
        <div className="bg-blue-50 border border-blue-200 rounded-2xl p-6 text-center space-y-3">
          <svg className="w-10 h-10 text-primary mx-auto" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 10V7" />
          </svg>
          <div>
            <p className="font-semibold text-ink">URL Registry not set up yet</p>
            <p className="text-muted text-sm mt-1">
              Click below to create the <code className="bg-surface2 px-1 rounded text-xs">ClCode_URLs</code> and <code className="bg-surface2 px-1 rounded text-xs">ClCode_URLMetrics</code> tables.
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

      {/* ── Setup success banner ── */}
      {setupResult && (
        <div className="bg-green-50 border border-green-200 rounded-xl p-4 flex items-center gap-3">
          <svg className="w-5 h-5 text-green-600 flex-shrink-0" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          <p className="text-sm text-green-800">
            <span className="font-semibold">Setup complete!</span>{' '}
            {setupResult.importedCount > 0
              ? `Imported ${setupResult.importedCount} URLs from legacy table. `
              : ''}
            Total: {setupResult.totalURLs} URLs.
          </p>
          <button onClick={() => setSetupResult(null)} className="ml-auto text-green-600 hover:text-green-800">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
      )}

      {/* ── Main content ── */}
      {!needsSetup && (
        <>
          {/* Search + filters */}
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
                placeholder="Search URLs, keywords…"
                className="w-full pl-9 pr-4 py-2 rounded-xl border border-border bg-surface text-sm text-ink focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary transition"
              />
            </div>

            {/* Active filter */}
            <div className="flex gap-1">
              {(['all', 'active', 'inactive'] as const).map((f) => (
                <button
                  key={f}
                  onClick={() => setFilterActive(f)}
                  className={`text-sm px-3 py-1.5 rounded-full border font-medium transition-colors capitalize
                    ${filterActive === f
                      ? 'bg-primary text-white border-primary'
                      : 'bg-surface text-muted border-border hover:border-primary/40 hover:text-ink'}`}
                >
                  {f === 'all'      ? `All (${urls.length})`        :
                   f === 'active'   ? `Active (${activeCount})`     :
                                      `Inactive (${inactiveCount})`}
                </button>
              ))}
            </div>

            {/* Priority filter */}
            <div className="flex gap-1">
              {(['all', 'High', 'Medium', 'Low'] as const).map((p) => (
                <button
                  key={p}
                  onClick={() => setFilterPriority(p)}
                  className={`text-sm px-3 py-1.5 rounded-full border font-medium transition-colors
                    ${filterPriority === p
                      ? 'bg-primary text-white border-primary'
                      : 'bg-surface text-muted border-border hover:border-primary/40 hover:text-ink'}`}
                >
                  {p === 'all' ? 'All Priority' : p}
                </button>
              ))}
            </div>

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
                    <th className="text-left   px-4 py-3 font-semibold text-ink-2 text-xs uppercase tracking-wide">URL</th>
                    <th className="text-left   px-4 py-3 font-semibold text-ink-2 text-xs uppercase tracking-wide hidden md:table-cell">Primary Keyword</th>
                    <th className="text-center px-4 py-3 font-semibold text-ink-2 text-xs uppercase tracking-wide hidden sm:table-cell">Priority</th>
                    <th className="text-center px-4 py-3 font-semibold text-ink-2 text-xs uppercase tracking-wide">Status</th>
                    <th className="text-center px-4 py-3 font-semibold text-ink-2 text-xs uppercase tracking-wide hidden lg:table-cell">Scans</th>
                    <th className="text-left   px-4 py-3 font-semibold text-ink-2 text-xs uppercase tracking-wide hidden xl:table-cell">Last Scanned</th>
                    <th className="px-4 py-3" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {filtered.map((u) => (
                    <tr key={u.URLID} className="hover:bg-surface2/50 transition-colors">
                      {/* URL */}
                      <td className="px-4 py-3 max-w-xs">
                        <div className="font-mono text-sm text-ink truncate" title={u.PageURL}>
                          {pathOf(u.PageURL)}
                        </div>
                        {u.PageTitle && (
                          <div className="text-xs text-muted mt-0.5 truncate" title={u.PageTitle}>{u.PageTitle}</div>
                        )}
                        {u.TreeCluster && (
                          <div className="text-xs text-muted/70 mt-0.5">{u.TreeCluster}</div>
                        )}
                      </td>

                      {/* Primary keyword + secondary */}
                      <td className="px-4 py-3 hidden md:table-cell max-w-[200px]">
                        {u.PrimaryKeyword
                          ? <span className="text-sm text-ink font-medium">{u.PrimaryKeyword}</span>
                          : <span className="text-muted italic text-sm">—</span>}
                        {u.SecondaryKeywords && (
                          <div className="text-xs text-muted mt-0.5 truncate" title={u.SecondaryKeywords}>
                            {u.SecondaryKeywords}
                          </div>
                        )}
                      </td>

                      {/* Priority */}
                      <td className="px-4 py-3 text-center hidden sm:table-cell">
                        <PriorityBadge priority={u.Priority} />
                      </td>

                      {/* Status */}
                      <td className="px-4 py-3 text-center">
                        <ActiveBadge active={u.IsActive} />
                      </td>

                      {/* Scans */}
                      <td className="px-4 py-3 text-center hidden lg:table-cell">
                        <span className="text-sm font-semibold text-ink">{u.ScanRunCount}</span>
                      </td>

                      {/* Last scanned */}
                      <td className="px-4 py-3 text-sm text-muted hidden xl:table-cell whitespace-nowrap">
                        {u.LastScannedAt ? fmtDate(u.LastScannedAt) : '—'}
                      </td>

                      {/* Actions */}
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-1 justify-end">

                          {/* Metrics */}
                          <button
                            onClick={() => setMetricsURL(u)}
                            title="SERP & Search Volume"
                            className="w-7 h-7 flex items-center justify-center rounded-lg text-muted hover:text-primary hover:bg-blue-50 transition-colors"
                          >
                            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
                            </svg>
                          </button>

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
                            className={`w-7 h-7 flex items-center justify-center rounded-lg transition-colors
                              ${u.IsActive
                                ? 'text-muted hover:text-danger hover:bg-danger-light'
                                : 'text-muted hover:text-green-600 hover:bg-green-50'}`}
                          >
                            {togglingId === u.URLID ? <Spinner /> : u.IsActive ? (
                              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636" />
                              </svg>
                            ) : (
                              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                              </svg>
                            )}
                          </button>

                          {/* Open URL in new tab */}
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

                          {/* Delete (with inline confirm) */}
                          {confirmDeleteId === u.URLID ? (
                            <div className="flex items-center gap-1">
                              <button
                                onClick={() => deleteURL(u.URLID)}
                                disabled={deletingId === u.URLID}
                                className="flex items-center gap-1 px-2 py-1 bg-danger hover:bg-red-600 text-white text-xs font-semibold rounded-lg transition-colors disabled:opacity-60"
                              >
                                {deletingId === u.URLID ? <Spinner /> : 'Yes, delete'}
                              </button>
                              <button
                                onClick={() => setConfirmDeleteId(null)}
                                className="px-2 py-1 border border-border text-xs rounded-lg hover:bg-surface2 transition-colors"
                              >
                                No
                              </button>
                            </div>
                          ) : (
                            <button
                              onClick={() => setConfirmDeleteId(u.URLID)}
                              title="Delete URL"
                              className="w-7 h-7 flex items-center justify-center rounded-lg text-muted hover:text-danger hover:bg-danger-light transition-colors"
                            >
                              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                              </svg>
                            </button>
                          )}

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

      {/* ── Modals ── */}
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
      {metricsURL && (
        <MetricsModal url={metricsURL} onClose={() => setMetricsURL(null)} />
      )}

    </div>
  );
}
