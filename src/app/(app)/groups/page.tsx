'use client';

import { useState, useEffect } from 'react';
import type { URLGroup } from '@/lib/types';

function Spinner() {
  return <div className="w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin inline-block" />;
}

function pathOf(url: string) { try { return new URL(url).pathname; } catch { return url; } }

// ── Create / Edit Group Modal ─────────────────────────────────────────────────

function GroupModal({
  initial,
  onClose,
  onSaved,
}: {
  initial?: URLGroup;
  onClose: () => void;
  onSaved: (g: URLGroup) => void;
}) {
  const [name,    setName]    = useState(initial?.GroupName    ?? '');
  const [desc,    setDesc]    = useState(initial?.Description  ?? '');
  const [saving,  setSaving]  = useState(false);
  const [error,   setError]   = useState('');

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) { setError('Group name is required'); return; }
    setSaving(true); setError('');
    try {
      const res = initial
        ? await fetch(`/api/url-groups/${initial.GroupID}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name, description: desc }),
          })
        : await fetch('/api/url-groups', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name, description: desc }),
          });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed');
      onSaved(initial ? { ...initial, GroupName: name, Description: desc } : data.group);
    } catch (err: any) { setError(err.message); }
    finally { setSaving(false); }
  }

  const inp = 'w-full px-3 py-2.5 rounded-xl border border-border bg-surface2 text-sm text-ink focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary transition';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
      <div className="bg-surface rounded-2xl border border-border shadow-xl w-full max-w-md mx-4 p-6">
        <div className="flex items-center justify-between mb-5">
          <h2 className="font-semibold text-ink font-display text-lg">{initial ? 'Edit Group' : 'Create Group'}</h2>
          <button onClick={onClose} className="text-muted hover:text-ink">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-ink-2 mb-1.5">Group Name <span className="text-danger">*</span></label>
            <input type="text" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Silver Coins" className={inp} autoFocus />
          </div>
          <div>
            <label className="block text-sm font-medium text-ink-2 mb-1.5">Description <span className="text-muted text-xs font-normal">(optional)</span></label>
            <textarea value={desc} onChange={(e) => setDesc(e.target.value)} rows={2}
              placeholder="Short description of this group…" className={`${inp} resize-none`} />
          </div>
          {error && <p className="text-sm text-danger bg-danger-light px-3 py-2 rounded-xl border border-red-200">{error}</p>}
          <div className="flex gap-3">
            <button type="submit" disabled={saving}
              className="flex items-center gap-2 px-5 py-2.5 bg-primary hover:bg-blue-600 text-white text-sm font-semibold rounded-xl transition-colors disabled:opacity-60">
              {saving ? <><Spinner /> Saving…</> : initial ? 'Save Changes' : 'Create Group'}
            </button>
            <button type="button" onClick={onClose}
              className="px-5 py-2.5 border border-border text-ink-2 text-sm rounded-xl hover:bg-surface2">
              Cancel
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ── Group Detail Panel ────────────────────────────────────────────────────────

function GroupDetail({ group, onClose, onGroupUpdated }: {
  group: URLGroup;
  onClose: () => void;
  onGroupUpdated: (g: URLGroup) => void;
}) {
  const [members, setMembers]     = useState<any[]>([]);
  const [loading, setLoading]     = useState(true);
  const [removing, setRemoving]   = useState<number | null>(null);
  const [showEdit, setShowEdit]   = useState(false);

  useEffect(() => {
    fetch(`/api/url-groups/${group.GroupID}`)
      .then((r) => r.json())
      .then((d) => { setMembers(d.group?.members ?? []); setLoading(false); });
  }, [group.GroupID]);

  async function removeMember(urlId: number) {
    setRemoving(urlId);
    await fetch(`/api/url-groups/${group.GroupID}/members`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ urlIds: [urlId] }),
    });
    setMembers((prev) => prev.filter((m) => m.URLID !== urlId));
    onGroupUpdated({ ...group, URLCount: group.URLCount - 1 });
    setRemoving(null);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40 backdrop-blur-sm">
      <div className="bg-surface rounded-t-2xl sm:rounded-2xl border border-border shadow-xl w-full max-w-2xl mx-0 sm:mx-4 max-h-[85vh] flex flex-col">
        {/* Header */}
        <div className="flex items-start justify-between p-6 border-b border-border">
          <div>
            <h2 className="font-semibold text-ink font-display text-lg">{group.GroupName}</h2>
            {group.Description && <p className="text-sm text-muted mt-0.5">{group.Description}</p>}
            <p className="text-xs text-muted mt-1">{group.URLCount} URL{group.URLCount !== 1 ? 's' : ''}</p>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={() => setShowEdit(true)}
              className="text-xs px-3 py-1.5 border border-border rounded-lg text-muted hover:text-ink hover:bg-surface2 transition-colors">
              Edit
            </button>
            <button onClick={onClose} className="text-muted hover:text-ink">
              <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>

        {/* Members */}
        <div className="flex-1 overflow-y-auto p-4">
          {loading ? (
            <div className="flex justify-center py-8 text-muted"><Spinner /></div>
          ) : members.length === 0 ? (
            <div className="text-center py-10 text-muted">
              <p className="font-medium text-ink">No URLs in this group</p>
              <p className="text-sm mt-1">Select URLs in the <a href="/urls" className="text-primary hover:underline">URL Registry</a> and add them to this group.</p>
            </div>
          ) : (
            <div className="space-y-1">
              {members.map((m) => (
                <div key={m.URLID} className="flex items-center gap-3 px-3 py-2.5 rounded-xl hover:bg-surface2/50 transition-colors group">
                  <div className="flex-1 min-w-0">
                    <p className="font-mono text-sm text-ink truncate">{pathOf(m.PageURL)}</p>
                    {m.PrimaryKeyword && <p className="text-xs text-muted mt-0.5">{m.PrimaryKeyword}</p>}
                  </div>
                  {m.Priority && (
                    <span className={`text-xs px-2 py-0.5 rounded-full font-semibold flex-shrink-0
                      ${m.Priority === 'High' ? 'bg-red-100 text-red-700' : m.Priority === 'Medium' ? 'bg-yellow-100 text-yellow-700' : 'bg-green-100 text-green-700'}`}>
                      {m.Priority}
                    </span>
                  )}
                  <button onClick={() => removeMember(m.URLID)} disabled={removing === m.URLID}
                    title="Remove from group"
                    className="w-6 h-6 flex items-center justify-center rounded-md text-muted hover:text-danger hover:bg-danger-light transition-colors opacity-0 group-hover:opacity-100">
                    {removing === m.URLID ? <Spinner /> : (
                      <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                      </svg>
                    )}
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
        <div className="p-4 border-t border-border">
          <a href="/urls" className="text-sm text-primary hover:underline">← Go to URL Registry to add more URLs</a>
        </div>
      </div>

      {showEdit && (
        <GroupModal
          initial={group}
          onClose={() => setShowEdit(false)}
          onSaved={(updated) => { onGroupUpdated(updated); setShowEdit(false); }}
        />
      )}
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function GroupsPage() {
  const [groups,     setGroups]     = useState<URLGroup[]>([]);
  const [loading,    setLoading]    = useState(true);
  const [needsSetup, setNeedsSetup] = useState(false);
  const [setupBusy,  setSetupBusy]  = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [detail,     setDetail]     = useState<URLGroup | null>(null);
  const [deleting,   setDeleting]   = useState<number | null>(null);

  async function fetchGroups() {
    setLoading(true);
    try {
      const res  = await fetch('/api/url-groups');
      const data = await res.json();
      if (data.needsSetup) { setNeedsSetup(true); }
      else { setGroups(data.groups ?? []); setNeedsSetup(false); }
    } catch (err) { console.error(err); }
    finally { setLoading(false); }
  }

  useEffect(() => { fetchGroups(); }, []);

  async function handleSetup() {
    setSetupBusy(true);
    await fetch('/api/url-groups/setup', { method: 'POST' });
    setSetupBusy(false);
    fetchGroups();
  }

  async function deleteGroup(g: URLGroup) {
    if (!confirm(`Delete group "${g.GroupName}"? URLs will not be deleted.`)) return;
    setDeleting(g.GroupID);
    await fetch(`/api/url-groups/${g.GroupID}`, { method: 'DELETE' });
    setGroups((prev) => prev.filter((x) => x.GroupID !== g.GroupID));
    setDeleting(null);
  }

  if (loading) return (
    <div className="flex items-center gap-2 text-muted animate-fade-slide"><Spinner /> Loading groups…</div>
  );

  return (
    <div className="animate-fade-slide space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold font-display text-ink">URL Groups</h1>
          <p className="text-muted text-sm mt-1">
            Organise URLs into groups for bulk SERP tracking and scanning ·{' '}
            <a href="/urls" className="text-primary hover:underline">Manage URLs</a>
          </p>
        </div>
        {!needsSetup && (
          <button onClick={() => setShowCreate(true)}
            className="flex items-center gap-1.5 px-4 py-2 bg-primary hover:bg-blue-600 text-white text-sm font-semibold rounded-xl transition-colors shadow-sm">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
            </svg>
            New Group
          </button>
        )}
      </div>

      {/* Setup */}
      {needsSetup && (
        <div className="bg-blue-50 border border-blue-200 rounded-2xl p-6 text-center space-y-3">
          <p className="font-semibold text-ink">URL Groups not set up yet</p>
          <p className="text-muted text-sm">Click below to create the required database tables.</p>
          <button onClick={handleSetup} disabled={setupBusy}
            className="inline-flex items-center gap-2 px-5 py-2.5 bg-primary hover:bg-blue-600 text-white text-sm font-semibold rounded-xl transition-colors disabled:opacity-60">
            {setupBusy ? <><Spinner /> Setting up…</> : 'Set Up URL Groups'}
          </button>
        </div>
      )}

      {/* Groups grid */}
      {!needsSetup && (
        groups.length === 0 ? (
          <div className="text-center py-20 text-muted">
            <svg className="w-12 h-12 mx-auto mb-3 text-border" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
            </svg>
            <p className="font-medium text-ink">No groups yet</p>
            <p className="text-sm mt-1">
              Select URLs in <a href="/urls" className="text-primary hover:underline">URL Registry</a> and create your first group.
            </p>
            <button onClick={() => setShowCreate(true)}
              className="mt-4 inline-flex items-center gap-2 px-4 py-2 bg-primary hover:bg-blue-600 text-white text-sm font-semibold rounded-xl transition-colors">
              Create First Group
            </button>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {groups.map((g) => (
              <div key={g.GroupID}
                className="bg-surface rounded-2xl border border-border p-5 hover:border-primary/40 hover:shadow-sm transition-all cursor-pointer group"
                onClick={() => setDetail(g)}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="flex-1 min-w-0">
                    <h3 className="font-semibold text-ink font-display truncate">{g.GroupName}</h3>
                    {g.Description && <p className="text-xs text-muted mt-1 line-clamp-2">{g.Description}</p>}
                  </div>
                  <button
                    onClick={(e) => { e.stopPropagation(); deleteGroup(g); }}
                    disabled={deleting === g.GroupID}
                    className="w-6 h-6 flex items-center justify-center rounded-md text-muted hover:text-danger hover:bg-danger-light transition-colors opacity-0 group-hover:opacity-100 flex-shrink-0"
                    title="Delete group"
                  >
                    {deleting === g.GroupID ? <Spinner /> : (
                      <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                      </svg>
                    )}
                  </button>
                </div>
                <div className="mt-4 flex items-center gap-3">
                  <span className="text-2xl font-bold font-display text-primary">{g.URLCount}</span>
                  <span className="text-sm text-muted">URL{g.URLCount !== 1 ? 's' : ''}</span>
                  <span className="ml-auto text-xs text-primary opacity-0 group-hover:opacity-100 transition-opacity">View →</span>
                </div>
                <div className="mt-3 flex gap-2 flex-wrap">
                  <a href={`/serp?group=${g.GroupID}`} onClick={(e) => e.stopPropagation()}
                    className="text-xs px-2.5 py-1 rounded-lg border border-border text-muted hover:text-primary hover:border-primary/40 transition-colors">
                    SERP Tracker
                  </a>
                </div>
              </div>
            ))}
          </div>
        )
      )}

      {showCreate && (
        <GroupModal
          onClose={() => setShowCreate(false)}
          onSaved={(g) => { setGroups((prev) => [...prev, g].sort((a, b) => a.GroupName.localeCompare(b.GroupName))); setShowCreate(false); }}
        />
      )}
      {detail && (
        <GroupDetail
          group={detail}
          onClose={() => setDetail(null)}
          onGroupUpdated={(updated) => {
            setGroups((prev) => prev.map((g) => g.GroupID === updated.GroupID ? updated : g));
            setDetail(updated);
          }}
        />
      )}
    </div>
  );
}
