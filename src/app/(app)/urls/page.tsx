'use client';

import { useState, useEffect, useMemo } from 'react';
import type { SiteURL, URLGroup } from '@/lib/types';

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
  if (pos == null) return <span className="text-muted text-sm">—</span>;
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
          <input type="url" value={data.pageURL} onChange={(e) => onChange({ pageURL: e.target.value })}
            placeholder="https://example.com/page" className={inputCls} />
        </div>
      )}
      <div>
        <label className="block text-sm font-medium text-ink-2 mb-1.5">
          Page Title <span className="text-muted text-xs font-normal">(optional)</span>
        </label>
        <input type="text" value={data.pageTitle} onChange={(e) => onChange({ pageTitle: e.target.value })}
          placeholder="e.g. 1 Kilo Silver Bars | Buy Online" className={inputCls} />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-sm font-medium text-ink-2 mb-1.5">Primary Keyword</label>
          <input type="text" value={data.primaryKeyword} onChange={(e) => onChange({ primaryKeyword: e.target.value })}
            placeholder="e.g. silver bars" className={inputCls} />
        </div>
        <div>
          <label className="block text-sm font-medium text-ink-2 mb-1.5">Priority</label>
          <select value={data.priority} onChange={(e) => onChange({ priority: e.target.value })} className={inputCls}>
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
        <input type="text" value={data.secondaryKeywords} onChange={(e) => onChange({ secondaryKeywords: e.target.value })}
          placeholder="e.g. buy silver bars, silver bullion, 1kg silver bar" className={inputCls} />
      </div>
      <div>
        <label className="block text-sm font-medium text-ink-2 mb-1.5">
          Notes <span className="text-muted text-xs font-normal">(optional)</span>
        </label>
        <textarea value={data.notes} onChange={(e) => onChange({ notes: e.target.value })}
          rows={2} placeholder="Any notes about this URL…" className={`${inputCls} resize-none`} />
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
          pageURL: form.pageURL, pageTitle: form.pageTitle || null,
          primaryKeyword: form.primaryKeyword || null,
          secondaryKeywords: form.secondaryKeywords || null,
          priority: form.priority || null, notes: form.notes || null,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to add URL');
      onAdded(data.url);
    } catch (err: any) { setError(err.message); setSaving(false); }
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
          {error && <p className="mt-4 text-sm text-danger bg-danger-light px-3 py-2 rounded-xl border border-red-200">{error}</p>}
          <div className="flex gap-3 mt-5">
            <button type="submit" disabled={saving}
              className="flex items-center gap-2 px-5 py-2.5 bg-primary hover:bg-blue-600 text-white text-sm font-semibold rounded-xl transition-colors disabled:opacity-60">
              {saving ? <><Spinner /> Saving…</> : 'Add URL'}
            </button>
            <button type="button" onClick={onClose}
              className="px-5 py-2.5 border border-border text-ink-2 text-sm rounded-xl hover:bg-surface2 transition-colors">
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
    pageURL: url.PageURL, pageTitle: url.PageTitle ?? '',
    primaryKeyword: url.PrimaryKeyword ?? '', secondaryKeywords: url.SecondaryKeywords ?? '',
    priority: url.Priority ?? '', notes: url.Notes ?? '',
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
          pageURL: form.pageURL, pageTitle: form.pageTitle || null,
          primaryKeyword: form.primaryKeyword || null,
          secondaryKeywords: form.secondaryKeywords || null,
          priority: form.priority || null, notes: form.notes || null,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to save');
      onSaved({
        ...url, PageURL: form.pageURL, PageTitle: form.pageTitle || null,
        PrimaryKeyword: form.primaryKeyword || null,
        SecondaryKeywords: form.secondaryKeywords || null,
        Priority: (form.priority || null) as SiteURL['Priority'],
        Notes: form.notes || null,
      });
    } catch (err: any) { setError(err.message); setSaving(false); }
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
          {error && <p className="mt-4 text-sm text-danger bg-danger-light px-3 py-2 rounded-xl border border-red-200">{error}</p>}
          <div className="flex gap-3 mt-5">
            <button type="submit" disabled={saving}
              className="flex items-center gap-2 px-5 py-2.5 bg-primary hover:bg-blue-600 text-white text-sm font-semibold rounded-xl transition-colors disabled:opacity-60">
              {saving ? <><Spinner /> Saving…</> : 'Save Changes'}
            </button>
            <button type="button" onClick={onClose}
              className="px-5 py-2.5 border border-border text-ink-2 text-sm rounded-xl hover:bg-surface2 transition-colors">
              Cancel
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ── Import Sheet Modal ────────────────────────────────────────────────────────

function ImportSheetModal({ onClose, onImported }: { onClose: () => void; onImported: () => void }) {
  const [sheetUrl, setSheetUrl] = useState('');
  const [loading,  setLoading]  = useState(false);
  const [result,   setResult]   = useState<{ total: number; inserted: number; skipped: number; errors: number } | null>(null);
  const [error,    setError]    = useState('');

  async function handleImport(e: React.FormEvent) {
    e.preventDefault();
    if (!sheetUrl.trim()) { setError('Please enter a Google Sheets URL'); return; }
    setLoading(true); setError(''); setResult(null);
    try {
      const res  = await fetch('/api/urls/import-sheet', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sheetUrl: sheetUrl.trim() }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Import failed');
      setResult(data);
      onImported();
    } catch (err: any) { setError(err.message); }
    finally { setLoading(false); }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
      <div className="bg-surface rounded-2xl border border-border shadow-xl w-full max-w-lg mx-4 p-6">
        <div className="flex items-center justify-between mb-5">
          <div>
            <h2 className="font-semibold text-ink font-display text-lg">Import from Google Sheet</h2>
            <p className="text-xs text-muted mt-0.5">Sheet must have columns: New URL, Primary Keyword, Secondary Keyword, priority</p>
          </div>
          <button onClick={onClose} className="text-muted hover:text-ink transition-colors">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {!result ? (
          <form onSubmit={handleImport} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-ink-2 mb-1.5">Google Sheets URL</label>
              <input
                type="url"
                value={sheetUrl}
                onChange={(e) => setSheetUrl(e.target.value)}
                placeholder="https://docs.google.com/spreadsheets/d/..."
                className={inputCls}
                autoFocus
              />
              <p className="text-xs text-muted mt-1">The sheet must be publicly accessible (Anyone with link can view).</p>
            </div>
            {error && <p className="text-sm text-danger bg-danger-light px-3 py-2 rounded-xl border border-red-200">{error}</p>}
            <div className="flex gap-3">
              <button type="submit" disabled={loading}
                className="flex items-center gap-2 px-5 py-2.5 bg-primary hover:bg-blue-600 text-white text-sm font-semibold rounded-xl transition-colors disabled:opacity-60">
                {loading ? <><Spinner /> Importing…</> : (
                  <>
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                    </svg>
                    Import URLs
                  </>
                )}
              </button>
              <button type="button" onClick={onClose}
                className="px-5 py-2.5 border border-border text-ink-2 text-sm rounded-xl hover:bg-surface2 transition-colors">
                Cancel
              </button>
            </div>
          </form>
        ) : (
          <div className="space-y-4">
            <div className="grid grid-cols-4 gap-3">
              {[
                { label: 'Total',    value: result.total,    color: 'text-ink' },
                { label: 'Inserted', value: result.inserted, color: 'text-green-600' },
                { label: 'Skipped',  value: result.skipped,  color: 'text-yellow-600' },
                { label: 'Errors',   value: result.errors,   color: 'text-red-600' },
              ].map(({ label, value, color }) => (
                <div key={label} className="bg-surface2 rounded-xl p-3 text-center border border-border">
                  <p className={`text-xl font-bold font-display ${color}`}>{value}</p>
                  <p className="text-xs text-muted mt-0.5">{label}</p>
                </div>
              ))}
            </div>
            <p className="text-sm text-ink">
              {result.inserted > 0
                ? <><span className="text-green-600 font-semibold">{result.inserted} new URLs</span> added successfully.</>
                : 'No new URLs were added.'}
              {result.skipped > 0 && <> {result.skipped} already existed and were skipped.</>}
            </p>
            <div className="flex gap-3">
              <button onClick={onClose}
                className="px-5 py-2.5 bg-primary hover:bg-blue-600 text-white text-sm font-semibold rounded-xl transition-colors">
                Done
              </button>
              <button onClick={() => setResult(null)}
                className="px-5 py-2.5 border border-border text-ink-2 text-sm rounded-xl hover:bg-surface2 transition-colors">
                Import Another
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function URLsPage() {
  const [urls,           setUrls]           = useState<SiteURL[]>([]);
  const [loading,        setLoading]        = useState(true);
  const [needsSetup,     setNeedsSetup]     = useState(false);
  const [setupLoading,   setSetupLoading]   = useState(false);
  const [setupResult,    setSetupResult]    = useState<{ importedCount: number; totalURLs: number } | null>(null);
  const [search,         setSearch]         = useState('');
  const [filterActive,   setFilterActive]   = useState<'all' | 'active' | 'inactive'>('all');
  const [filterPriority, setFilterPriority] = useState<string>('all');
  const [showAdd,        setShowAdd]        = useState(false);
  const [showImport,     setShowImport]     = useState(false);
  const [editURL,        setEditURL]        = useState<SiteURL | null>(null);
  const [togglingId,     setTogglingId]     = useState<number | null>(null);
  const [selectedIds,    setSelectedIds]    = useState<Set<number>>(new Set());
  const [showGroupModal, setShowGroupModal] = useState<'create' | 'add' | null>(null);
  const [groups,         setGroups]         = useState<URLGroup[]>([]);
  const [groupSaving,    setGroupSaving]    = useState(false);
  const [groupName,      setGroupName]      = useState('');
  const [groupDesc,      setGroupDesc]      = useState('');
  const [addToGroupId,   setAddToGroupId]   = useState<number>(NaN);

  async function fetchGroups() {
    try {
      const res  = await fetch('/api/url-groups');
      const data = await res.json();
      setGroups(data.groups ?? []);
    } catch {}
  }

  async function handleCreateGroup() {
    if (!groupName.trim()) return;
    setGroupSaving(true);
    try {
      await fetch('/api/url-groups', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: groupName, description: groupDesc, urlIds: [...selectedIds] }),
      });
      setShowGroupModal(null); setGroupName(''); setGroupDesc(''); setSelectedIds(new Set());
      fetchGroups();
    } finally { setGroupSaving(false); }
  }

  async function handleAddToGroup() {
    if (!addToGroupId) return;
    setGroupSaving(true);
    try {
      await fetch(`/api/url-groups/${addToGroupId}/members`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ urlIds: [...selectedIds] }),
      });
      setShowGroupModal(null); setSelectedIds(new Set());
    } finally { setGroupSaving(false); }
  }

  function toggleSelect(id: number) {
    setSelectedIds((prev) => { const s = new Set(prev); s.has(id) ? s.delete(id) : s.add(id); return s; });
  }
  function toggleSelectAll() {
    if (selectedIds.size === filtered.length) setSelectedIds(new Set());
    else setSelectedIds(new Set(filtered.map((u) => u.URLID)));
  }

  async function fetchURLs() {
    setLoading(true);
    try {
      const res  = await fetch('/api/urls');
      const data = await res.json();
      if (data.needsSetup) { setNeedsSetup(true); }
      else { setUrls(data.urls ?? []); setNeedsSetup(false); }
    } catch (err) { console.error(err); }
    finally { setLoading(false); }
  }

  useEffect(() => { fetchURLs(); fetchGroups(); }, []);

  async function handleSetup() {
    setSetupLoading(true);
    try {
      const res  = await fetch('/api/urls/setup', { method: 'POST' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Setup failed');
      setSetupResult({ importedCount: data.importedCount, totalURLs: data.totalURLs });
      await fetchURLs();
    } catch (err: any) { alert(err.message); }
    finally { setSetupLoading(false); }
  }

  async function toggleActive(url: SiteURL) {
    setTogglingId(url.URLID);
    try {
      const res = await fetch(`/api/urls/${url.URLID}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isActive: !url.IsActive }),
      });
      if (!res.ok) throw new Error('Failed');
      setUrls((prev) => prev.map((u) => u.URLID === url.URLID ? { ...u, IsActive: !url.IsActive } : u));
    } catch (err) { console.error(err); }
    finally { setTogglingId(null); }
  }

  const filtered = useMemo(() => urls.filter((u) => {
    if (filterActive   === 'active'   && !u.IsActive)               return false;
    if (filterActive   === 'inactive' &&  u.IsActive)               return false;
    if (filterPriority !== 'all'      && u.Priority !== filterPriority) return false;
    if (search) {
      const q = search.toLowerCase();
      if (!u.PageURL.toLowerCase().includes(q) &&
          !(u.PageTitle ?? '').toLowerCase().includes(q) &&
          !(u.PrimaryKeyword ?? '').toLowerCase().includes(q) &&
          !(u.SecondaryKeywords ?? '').toLowerCase().includes(q)) return false;
    }
    return true;
  }), [urls, search, filterActive, filterPriority]);

  const activeCount   = urls.filter((u) =>  u.IsActive).length;
  const inactiveCount = urls.filter((u) => !u.IsActive).length;

  if (loading) return (
    <div className="flex items-center gap-2 text-muted animate-fade-slide"><Spinner /> Loading URLs…</div>
  );

  return (
    <div className="animate-fade-slide space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold font-display text-ink">URL Registry</h1>
          <p className="text-muted text-sm mt-1">{urls.length} URLs total · {activeCount} active · {inactiveCount} inactive</p>
        </div>
        <div className="flex gap-2 flex-shrink-0">
          {!needsSetup && (
            <button onClick={handleSetup} disabled={setupLoading}
              title="Add new columns and import missing URLs from legacy table"
              className="flex items-center gap-1.5 px-3 py-2 border border-border text-ink-2 text-sm rounded-xl hover:bg-surface2 transition-colors disabled:opacity-60">
              {setupLoading ? <Spinner /> : (
                <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
                </svg>
              )}
              Import / Migrate
            </button>
          )}
          <button onClick={() => setShowImport(true)}
            className="flex items-center gap-1.5 px-3 py-2 border border-border text-ink-2 text-sm rounded-xl hover:bg-surface2 transition-colors">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 17V7m0 10a2 2 0 01-2 2H5a2 2 0 01-2-2V7a2 2 0 012-2h2a2 2 0 012 2m0 10a2 2 0 002 2h2a2 2 0 002-2M9 7a2 2 0 012-2h2a2 2 0 012 2m0 10V7m0 10a2 2 0 002 2h2a2 2 0 002-2V7a2 2 0 00-2-2h-2a2 2 0 00-2 2" />
            </svg>
            Import Sheet
          </button>
          <button onClick={() => setShowAdd(true)}
            className="flex items-center gap-1.5 px-4 py-2 bg-primary hover:bg-blue-600 text-white text-sm font-semibold rounded-xl transition-colors shadow-sm">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
            </svg>
            Add URL
          </button>
        </div>
      </div>

      {/* Setup needed */}
      {needsSetup && (
        <div className="bg-blue-50 border border-blue-200 rounded-2xl p-6 text-center space-y-3">
          <svg className="w-10 h-10 text-primary mx-auto" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 10V7" />
          </svg>
          <div>
            <p className="font-semibold text-ink">URL Registry not set up yet</p>
            <p className="text-muted text-sm mt-1">Click below to create the tables and import existing URLs.</p>
          </div>
          <button onClick={handleSetup} disabled={setupLoading}
            className="inline-flex items-center gap-2 px-5 py-2.5 bg-primary hover:bg-blue-600 text-white text-sm font-semibold rounded-xl transition-colors disabled:opacity-60">
            {setupLoading ? <><Spinner /> Setting up…</> : 'Set Up URL Registry'}
          </button>
        </div>
      )}

      {/* Setup success */}
      {setupResult && (
        <div className="bg-green-50 border border-green-200 rounded-xl p-4 flex items-center gap-3">
          <svg className="w-5 h-5 text-green-600 flex-shrink-0" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          <p className="text-sm text-green-800">
            <span className="font-semibold">Setup complete!</span>{' '}
            {setupResult.importedCount > 0 ? `Imported ${setupResult.importedCount} URLs. ` : ''}
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
          {/* Filters */}
          <div className="flex flex-wrap gap-3 items-center">
            <div className="relative flex-1 min-w-[220px] max-w-sm">
              <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
              </svg>
              <input type="text" value={search} onChange={(e) => setSearch(e.target.value)}
                placeholder="Search URLs, keywords…"
                className="w-full pl-9 pr-4 py-2 rounded-xl border border-border bg-surface text-sm text-ink focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary transition" />
            </div>
            <div className="flex gap-1">
              {(['all', 'active', 'inactive'] as const).map((f) => (
                <button key={f} onClick={() => setFilterActive(f)}
                  className={`text-sm px-3 py-1.5 rounded-full border font-medium transition-colors capitalize
                    ${filterActive === f ? 'bg-primary text-white border-primary' : 'bg-surface text-muted border-border hover:border-primary/40 hover:text-ink'}`}>
                  {f === 'all' ? `All (${urls.length})` : f === 'active' ? `Active (${activeCount})` : `Inactive (${inactiveCount})`}
                </button>
              ))}
            </div>
            <div className="flex gap-1">
              {(['all', 'High', 'Medium', 'Low'] as const).map((p) => (
                <button key={p} onClick={() => setFilterPriority(p)}
                  className={`text-sm px-3 py-1.5 rounded-full border font-medium transition-colors
                    ${filterPriority === p ? 'bg-primary text-white border-primary' : 'bg-surface text-muted border-border hover:border-primary/40 hover:text-ink'}`}>
                  {p === 'all' ? 'All Priority' : p}
                </button>
              ))}
            </div>
            <span className="text-sm text-muted ml-auto">
              {filtered.length !== urls.length ? `Showing ${filtered.length} of ${urls.length}` : `${urls.length} URLs`}
            </span>
          </div>

          {/* Group action toolbar — shown when URLs are selected */}
          {selectedIds.size > 0 && (
            <div className="flex items-center gap-3 px-4 py-2.5 bg-primary/5 border border-primary/20 rounded-xl">
              <span className="text-sm font-semibold text-primary">{selectedIds.size} URL{selectedIds.size > 1 ? 's' : ''} selected</span>
              <div className="flex gap-2 ml-auto">
                <button onClick={() => { setShowGroupModal('create'); setGroupName(''); setGroupDesc(''); }}
                  className="flex items-center gap-1.5 px-3 py-1.5 bg-primary hover:bg-blue-600 text-white text-xs font-semibold rounded-lg transition-colors">
                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
                  </svg>
                  Create New Group
                </button>
                {groups.length > 0 && (
                  <button onClick={() => setShowGroupModal('add')}
                    className="flex items-center gap-1.5 px-3 py-1.5 border border-border text-ink-2 text-xs font-semibold rounded-lg hover:bg-surface2 transition-colors">
                    Add to Existing Group
                  </button>
                )}
                <button onClick={() => setSelectedIds(new Set())}
                  className="px-3 py-1.5 text-muted text-xs hover:text-ink transition-colors">
                  Clear
                </button>
              </div>
            </div>
          )}

          {/* Table */}
          {filtered.length === 0 ? (
            <div className="text-center py-16 text-muted">
              <p className="font-medium">No URLs match your filters</p>
              {search && <button onClick={() => setSearch('')} className="mt-2 text-primary text-sm hover:underline">Clear search</button>}
            </div>
          ) : (
            <div className="bg-surface rounded-2xl border border-border shadow-card overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border bg-surface2">
                    <th className="px-4 py-3 w-8">
                      <input type="checkbox"
                        checked={selectedIds.size > 0 && selectedIds.size === filtered.length}
                        onChange={toggleSelectAll}
                        className="rounded border-border text-primary focus:ring-primary/40 cursor-pointer"
                      />
                    </th>
                    <th className="text-left   px-4 py-3 font-semibold text-ink-2 text-xs uppercase tracking-wide">URL</th>
                    <th className="text-left   px-4 py-3 font-semibold text-ink-2 text-xs uppercase tracking-wide hidden md:table-cell">Primary Keyword</th>
                    <th className="text-center px-4 py-3 font-semibold text-ink-2 text-xs uppercase tracking-wide hidden sm:table-cell">Priority</th>
                    <th className="text-center px-4 py-3 font-semibold text-ink-2 text-xs uppercase tracking-wide">Status</th>
                    <th className="text-center px-4 py-3 font-semibold text-ink-2 text-xs uppercase tracking-wide hidden lg:table-cell">SERP</th>
                    <th className="text-center px-4 py-3 font-semibold text-ink-2 text-xs uppercase tracking-wide hidden lg:table-cell">Volume</th>
                    <th className="text-left   px-4 py-3 font-semibold text-ink-2 text-xs uppercase tracking-wide hidden xl:table-cell">Last Entry</th>
                    <th className="px-4 py-3" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {filtered.map((u) => (
                    <tr key={u.URLID} className={`hover:bg-surface2/50 transition-colors ${selectedIds.has(u.URLID) ? 'bg-primary/5' : ''}`}>
                      <td className="px-4 py-3 w-8">
                        <input type="checkbox" checked={selectedIds.has(u.URLID)} onChange={() => toggleSelect(u.URLID)}
                          className="rounded border-border text-primary focus:ring-primary/40 cursor-pointer" />
                      </td>
                      <td className="px-4 py-3 max-w-xs">
                        <a href={u.PageURL} target="_blank" rel="noopener noreferrer"
                          className="font-mono text-sm text-primary hover:underline truncate block" title={u.PageURL}>
                          {pathOf(u.PageURL)}
                        </a>
                        {u.PageTitle && <div className="text-xs text-muted mt-0.5 truncate">{u.PageTitle}</div>}
                      </td>
                      <td className="px-4 py-3 hidden md:table-cell max-w-[180px]">
                        {u.PrimaryKeyword
                          ? <span className="text-sm text-ink font-medium">{u.PrimaryKeyword}</span>
                          : <span className="text-muted italic text-sm">—</span>}
                        {u.SecondaryKeywords && (
                          <div className="text-xs text-muted mt-0.5 truncate" title={u.SecondaryKeywords}>{u.SecondaryKeywords}</div>
                        )}
                      </td>
                      <td className="px-4 py-3 text-center hidden sm:table-cell"><PriorityBadge priority={u.Priority} /></td>
                      <td className="px-4 py-3 text-center"><ActiveBadge active={u.IsActive} /></td>
                      <td className="px-4 py-3 text-center hidden lg:table-cell"><SerpBadge pos={u.LatestSERPPosition} /></td>
                      <td className="px-4 py-3 text-center hidden lg:table-cell font-mono text-sm text-ink">
                        {u.LatestSearchVolume != null ? u.LatestSearchVolume.toLocaleString() : <span className="text-muted">—</span>}
                      </td>
                      <td className="px-4 py-3 text-sm text-muted hidden xl:table-cell whitespace-nowrap">
                        {u.LatestMetricDate ?? '—'}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-1 justify-end">
                          {/* Edit */}
                          <button onClick={() => setEditURL(u)} title="Edit"
                            className="w-7 h-7 flex items-center justify-center rounded-lg text-muted hover:text-ink hover:bg-surface2 transition-colors">
                            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                            </svg>
                          </button>
                          {/* View in SERP Tracker */}
                          <a href={`/serp?q=${encodeURIComponent(u.PageURL)}`} title="View in SERP Tracker"
                            className="w-7 h-7 flex items-center justify-center rounded-lg text-muted hover:text-primary hover:bg-blue-50 transition-colors">
                            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" d="M7 12l3-3 3 3 4-4M8 21l4-4 4 4M3 4h18M4 4h16v12a1 1 0 01-1 1H5a1 1 0 01-1-1V4z" />
                            </svg>
                          </a>
                          {/* Toggle active / deactivate */}
                          <button onClick={() => toggleActive(u)} disabled={togglingId === u.URLID}
                            title={u.IsActive ? 'Deactivate' : 'Activate'}
                            className={`w-7 h-7 flex items-center justify-center rounded-lg transition-colors
                              ${u.IsActive ? 'text-muted hover:text-danger hover:bg-danger-light' : 'text-muted hover:text-green-600 hover:bg-green-50'}`}>
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

      {showAdd && (
        <AddURLModal onClose={() => setShowAdd(false)} onAdded={(u) => {
          setUrls((prev) => [...prev, u].sort((a, b) => a.PageURL.localeCompare(b.PageURL)));
          setShowAdd(false);
        }} />
      )}
      {editURL && (
        <EditURLModal url={editURL} onClose={() => setEditURL(null)} onSaved={(updated) => {
          setUrls((prev) => prev.map((u) => u.URLID === updated.URLID ? updated : u));
          setEditURL(null);
        }} />
      )}
      {showImport && (
        <ImportSheetModal
          onClose={() => setShowImport(false)}
          onImported={() => { fetchURLs(); }}
        />
      )}

      {/* Create New Group Modal */}
      {showGroupModal === 'create' && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
          <div className="bg-surface rounded-2xl border border-border shadow-xl w-full max-w-md mx-4 p-6">
            <div className="flex items-center justify-between mb-5">
              <h2 className="font-semibold text-ink font-display text-lg">Create Group from {selectedIds.size} URL{selectedIds.size > 1 ? 's' : ''}</h2>
              <button onClick={() => setShowGroupModal(null)} className="text-muted hover:text-ink">
                <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
              </button>
            </div>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-ink-2 mb-1.5">Group Name <span className="text-danger">*</span></label>
                <input type="text" value={groupName} onChange={(e) => setGroupName(e.target.value)} placeholder="e.g. Silver Coins"
                  className={inputCls} autoFocus />
              </div>
              <div>
                <label className="block text-sm font-medium text-ink-2 mb-1.5">Description <span className="text-muted text-xs font-normal">(optional)</span></label>
                <textarea value={groupDesc} onChange={(e) => setGroupDesc(e.target.value)} rows={2}
                  placeholder="Short description…" className={`${inputCls} resize-none`} />
              </div>
              <div className="flex gap-3">
                <button onClick={handleCreateGroup} disabled={groupSaving || !groupName.trim()}
                  className="flex items-center gap-2 px-5 py-2.5 bg-primary hover:bg-blue-600 text-white text-sm font-semibold rounded-xl transition-colors disabled:opacity-60">
                  {groupSaving ? <><Spinner /> Creating…</> : 'Create Group'}
                </button>
                <button onClick={() => setShowGroupModal(null)} className="px-5 py-2.5 border border-border text-ink-2 text-sm rounded-xl hover:bg-surface2">Cancel</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Add to Existing Group Modal */}
      {showGroupModal === 'add' && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
          <div className="bg-surface rounded-2xl border border-border shadow-xl w-full max-w-sm mx-4 p-6">
            <div className="flex items-center justify-between mb-5">
              <h2 className="font-semibold text-ink font-display text-lg">Add {selectedIds.size} URL{selectedIds.size > 1 ? 's' : ''} to Group</h2>
              <button onClick={() => setShowGroupModal(null)} className="text-muted hover:text-ink">
                <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
              </button>
            </div>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-ink-2 mb-1.5">Select Group</label>
                <select value={addToGroupId} onChange={(e) => setAddToGroupId(Number(e.target.value))} className={inputCls}>
                  <option value="">— Choose a group —</option>
                  {groups.map((g) => <option key={g.GroupID} value={g.GroupID}>{g.GroupName} ({g.URLCount} URLs)</option>)}
                </select>
              </div>
              <div className="flex gap-3">
                <button onClick={handleAddToGroup} disabled={groupSaving || !addToGroupId}
                  className="flex items-center gap-2 px-5 py-2.5 bg-primary hover:bg-blue-600 text-white text-sm font-semibold rounded-xl transition-colors disabled:opacity-60">
                  {groupSaving ? <><Spinner /> Adding…</> : 'Add to Group'}
                </button>
                <button onClick={() => setShowGroupModal(null)} className="px-5 py-2.5 border border-border text-ink-2 text-sm rounded-xl hover:bg-surface2">Cancel</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
