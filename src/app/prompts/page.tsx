'use client';

import { useEffect, useState } from 'react';
import type { Prompt } from '@/lib/types';
import { Badge } from '@/components/Badge';

const PROMPT_TYPES = ['KeywordExtraction', 'Cannibalization', 'ContentImprovement'] as const;
type PromptType = typeof PROMPT_TYPES[number];

function fmtDate(d: string | null) {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

function TypeBadge({ type }: { type: string }) {
  const map: Record<string, 'blue' | 'amber' | 'green'> = {
    KeywordExtraction: 'blue',
    Cannibalization: 'amber',
    ContentImprovement: 'green',
  };
  const short: Record<string, string> = {
    KeywordExtraction: 'Keywords',
    Cannibalization: 'Cannibalization',
    ContentImprovement: 'Content',
  };
  return <Badge variant={map[type] ?? 'gray'}>{short[type] ?? type}</Badge>;
}

// ─── Add new prompt form ──────────────────────────────────────────────────────

function AddPromptForm({ onCreated }: { onCreated: () => void }) {
  const [open, setOpen] = useState(false);
  const [type, setType] = useState<PromptType>('KeywordExtraction');
  const [label, setLabel] = useState('');
  const [system, setSystem] = useState('');
  const [userTemplate, setUserTemplate] = useState('');
  const [notes, setNotes] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const reset = () => {
    setType('KeywordExtraction');
    setLabel('');
    setSystem('');
    setUserTemplate('');
    setNotes('');
    setError('');
    setOpen(false);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!system.trim() || !userTemplate.trim()) {
      setError('System prompt and user template are required');
      return;
    }
    setLoading(true);
    setError('');
    try {
      const res = await fetch('/api/prompts/activate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ promptType: type, systemPrompt: system, userPromptTemplate: userTemplate, versionLabel: label, notes }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed');
      reset();
      onCreated();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="flex items-center gap-2 px-4 py-2.5 bg-primary hover:bg-blue-600 text-white text-sm font-semibold rounded-xl transition-colors shadow-sm"
      >
        <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
        </svg>
        Add New Version
      </button>
    );
  }

  return (
    <div className="bg-surface rounded-2xl border border-primary/40 shadow-card-md p-6 space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="font-semibold font-display text-ink">Add New Prompt Version</h2>
        <button onClick={reset} className="text-muted hover:text-ink transition-colors">
          <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>

      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-ink-2 mb-1.5">Prompt Type</label>
            <select
              value={type}
              onChange={(e) => setType(e.target.value as PromptType)}
              className="w-full px-3 py-2.5 rounded-xl border border-border bg-surface2 text-ink text-sm focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary"
            >
              {PROMPT_TYPES.map((t) => (
                <option key={t} value={t}>{t}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-ink-2 mb-1.5">Version Label</label>
            <input
              type="text"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="e.g. v3 — with LSI focus"
              className="w-full px-3 py-2.5 rounded-xl border border-border bg-surface2 text-ink text-sm focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary"
            />
          </div>
        </div>

        <div>
          <label className="block text-sm font-medium text-ink-2 mb-1.5">System Prompt</label>
          <textarea
            value={system}
            onChange={(e) => setSystem(e.target.value)}
            rows={6}
            placeholder="You are an SEO expert…"
            className="w-full px-3 py-2.5 rounded-xl border border-border bg-surface2 text-ink text-sm font-mono focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary resize-y"
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-ink-2 mb-1.5">User Prompt Template</label>
          <div className="text-xs text-muted mb-1.5">
            Available variables: <code className="bg-muted-light px-1 rounded">{'{PAGE_DATA}'}</code>{' '}
            <code className="bg-muted-light px-1 rounded">{'{TREE_NAME}'}</code>{' '}
            <code className="bg-muted-light px-1 rounded">{'{KEYWORD_MAP}'}</code>{' '}
            <code className="bg-muted-light px-1 rounded">{'{TREE_DATA}'}</code>{' '}
            <code className="bg-muted-light px-1 rounded">{'{PRIMARY_KEYWORD}'}</code>{' '}
            <code className="bg-muted-light px-1 rounded">{'{SECONDARY_KEYWORDS}'}</code>
          </div>
          <textarea
            value={userTemplate}
            onChange={(e) => setUserTemplate(e.target.value)}
            rows={6}
            placeholder="Analyse the following page: {PAGE_DATA}"
            className="w-full px-3 py-2.5 rounded-xl border border-border bg-surface2 text-ink text-sm font-mono focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary resize-y"
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-ink-2 mb-1.5">Notes (optional)</label>
          <input
            type="text"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="What changed in this version"
            className="w-full px-3 py-2.5 rounded-xl border border-border bg-surface2 text-ink text-sm focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary"
          />
        </div>

        {error && (
          <div className="p-3 bg-danger-light border border-red-200 rounded-xl text-sm text-danger">{error}</div>
        )}

        <div className="flex items-center gap-3 pt-2">
          <div className="flex gap-1.5 p-1.5 bg-warning-light border border-amber-200 rounded-xl text-xs text-amber-800">
            <svg className="w-4 h-4 flex-shrink-0" fill="none" stroke="currentColor" strokeWidth={1.8} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
            </svg>
            This will deactivate the current active version for <strong>{type}</strong>.
          </div>
        </div>

        <div className="flex gap-3">
          <button
            type="submit"
            disabled={loading}
            className="px-5 py-2.5 bg-primary hover:bg-blue-600 text-white text-sm font-semibold rounded-xl transition-colors disabled:opacity-60"
          >
            {loading ? 'Saving…' : 'Save & Activate'}
          </button>
          <button
            type="button"
            onClick={reset}
            className="px-5 py-2.5 border border-border text-ink-2 text-sm font-medium rounded-xl hover:bg-surface2 transition-colors"
          >
            Cancel
          </button>
        </div>
      </form>
    </div>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function PromptsPage() {
  const [prompts, setPrompts] = useState<Prompt[]>([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<Set<number>>(new Set());

  const load = () => {
    fetch('/api/prompts')
      .then((r) => r.json())
      .then((d) => { setPrompts(d); setLoading(false); });
  };

  useEffect(() => { load(); }, []);

  const toggleExpand = (id: number) => {
    setExpanded((s) => {
      const n = new Set(s);
      n.has(id) ? n.delete(id) : n.add(id);
      return n;
    });
  };

  return (
    <div className="space-y-6 animate-fade-slide">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold font-display text-ink">Prompt Manager</h1>
          <p className="text-muted text-sm mt-1">Manage Claude prompt versions for all scan phases</p>
        </div>
        <AddPromptForm onCreated={load} />
      </div>

      {/* Table */}
      <div className="bg-surface rounded-2xl border border-border shadow-card overflow-hidden">
        {loading ? (
          <div className="flex items-center justify-center h-48">
            <div className="w-8 h-8 border-4 border-primary border-t-transparent rounded-full animate-spin" />
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-surface2 border-b border-border">
                  <th className="text-left px-6 py-3 text-muted font-medium">#</th>
                  <th className="text-left px-4 py-3 text-muted font-medium">Type</th>
                  <th className="text-left px-4 py-3 text-muted font-medium">Version</th>
                  <th className="text-left px-4 py-3 text-muted font-medium">Label</th>
                  <th className="text-center px-4 py-3 text-muted font-medium">Active</th>
                  <th className="text-left px-4 py-3 text-muted font-medium">Notes</th>
                  <th className="text-left px-4 py-3 text-muted font-medium">Created</th>
                  <th className="px-4 py-3" />
                </tr>
              </thead>
              <tbody>
                {prompts.map((p) => {
                  const open = expanded.has(p.PromptID);
                  return (
                    <>
                      <tr
                        key={p.PromptID}
                        className={`border-b border-border/50 hover:bg-surface2 cursor-pointer transition-colors ${p.IsActive ? 'bg-success-light/30' : ''}`}
                        onClick={() => toggleExpand(p.PromptID)}
                      >
                        <td className="px-6 py-4 text-muted font-mono text-xs">{p.PromptID}</td>
                        <td className="px-4 py-4"><TypeBadge type={p.PromptType} /></td>
                        <td className="px-4 py-4 font-mono font-semibold text-ink">v{p.VersionNumber}</td>
                        <td className="px-4 py-4 text-ink-2">{p.VersionLabel ?? '—'}</td>
                        <td className="px-4 py-4 text-center">
                          {p.IsActive ? (
                            <Badge variant="green">Active</Badge>
                          ) : (
                            <Badge variant="gray">Inactive</Badge>
                          )}
                        </td>
                        <td className="px-4 py-4 text-muted text-xs max-w-[200px] truncate">{p.Notes ?? '—'}</td>
                        <td className="px-4 py-4 text-muted text-xs">{fmtDate(p.CreatedAt)}</td>
                        <td className="px-4 py-4 text-right">
                          <svg
                            className={`w-4 h-4 text-muted inline transition-transform ${open ? 'rotate-180' : ''}`}
                            fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24"
                          >
                            <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                          </svg>
                        </td>
                      </tr>
                      {open && (
                        <tr key={`${p.PromptID}-expand`} className="border-b border-border">
                          <td colSpan={8} className="px-6 py-4 bg-surface2">
                            <div className="space-y-4">
                              {[
                                { label: 'System Prompt', val: p.SystemPrompt },
                                { label: 'User Prompt Template', val: p.UserPromptTemplate },
                              ].map(({ label, val }) => (
                                <div key={label}>
                                  <p className="text-[10px] font-semibold text-muted uppercase mb-1.5">{label}</p>
                                  <pre className="text-xs text-ink-2 bg-surface border border-border rounded-xl p-4 overflow-x-auto whitespace-pre-wrap max-h-64 font-mono">
                                    {val}
                                  </pre>
                                </div>
                              ))}
                              {p.DeactivatedAt && (
                                <p className="text-xs text-muted">
                                  Deactivated: {fmtDate(p.DeactivatedAt)}
                                </p>
                              )}
                            </div>
                          </td>
                        </tr>
                      )}
                    </>
                  );
                })}
                {prompts.length === 0 && (
                  <tr>
                    <td colSpan={8} className="px-6 py-12 text-center text-muted">
                      No prompts found. Run <code className="bg-muted-light px-1 rounded">python run_scan.py setup</code> to seed defaults.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
