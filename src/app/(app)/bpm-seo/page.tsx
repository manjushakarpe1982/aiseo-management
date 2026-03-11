'use client';

import { useEffect, useState, useRef, useCallback } from 'react';

// ─── Types ────────────────────────────────────────────────────────────────────

interface BpmSeoData {
  URLID: number;
  url: string;
  label: string;
  MetaTitle: string;
  MetaDescription: string;
  H1: string;
  Content: string;     // FirstParagraph from ClCode_URLs
  CanonicalUrl: string;
  SEOSource: string | null;
  SEOFetchedAt: string | null;
}

interface BpmSuggestion {
  ImprovementID: number;
  ScanID: number;
  ScanName: string;
  PageURL: string;
  FieldName: string | null;
  CurrentContent: string | null;
  CurrentCharCount: number | null;
  SuggestedContent: string | null;
  SuggestedCharCount: number | null;
  IssueType: string | null;
  Reasoning: string | null;
  Priority: 'High' | 'Medium' | 'Low';
  ImpactEstimate: string | null;
  Status: 'Yet to Act' | 'Acted' | 'Deferred';
  UserComment: string | null;
  LastAuditedAt: string | null;
  LastAuditedByName: string | null;
}

interface ScanOption {
  ScanID: number;
  ScanName: string;
  StartedAt: string;
}

const PUSH_FIELD_MAP: Record<string, string> = {
  'meta title':       'MetaTitle',
  'meta description': 'MetaDescription',
  'h1':               'H1',
  'page content':     'Content',
  'content':          'Content',
  'canonical url':    'CanonicalUrl',
  'canonical':        'CanonicalUrl',
};

function normField(name: string | null | undefined): string {
  if (!name) return '';
  return PUSH_FIELD_MAP[name.toLowerCase().trim()] ?? '';
}

function trunc(s: string | null | undefined, n = 140) {
  if (!s) return null;
  const plain = s.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  return plain.length > n ? plain.slice(0, n) + '…' : plain;
}

function fmtDate(d: string | null | undefined) {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

// ─── Char counter helper ──────────────────────────────────────────────────────

function CharCounter({ value, ideal, max }: { value: string; ideal: number; max: number }) {
  const len = value?.length ?? 0;
  const color =
    len === 0 ? 'text-muted' :
    len <= ideal ? 'text-success' :
    len <= max ? 'text-amber-600' :
    'text-red-600';
  return <span className={`text-xs font-mono ${color}`}>{len}/{max}</span>;
}

// ─── Badges ───────────────────────────────────────────────────────────────────

function PriorityBadge({ priority }: { priority: string }) {
  const cfg: Record<string, string> = {
    High:   'bg-red-100 text-red-700 border-red-200',
    Medium: 'bg-amber-100 text-amber-700 border-amber-200',
    Low:    'bg-blue-50 text-blue-600 border-blue-200',
  };
  return (
    <span className={`text-xs font-semibold px-2 py-0.5 rounded-full border ${cfg[priority] ?? 'bg-surface2 text-muted border-border'}`}>
      {priority}
    </span>
  );
}

function StatusBadge({ status }: { status: string }) {
  const cfg: Record<string, string> = {
    'Yet to Act': 'bg-amber-50 text-amber-700 border-amber-200',
    'Acted':      'bg-success-light text-green-700 border-green-200',
    'Deferred':   'bg-surface2 text-muted border-border',
  };
  return (
    <span className={`text-xs font-semibold px-2 py-0.5 rounded-full border whitespace-nowrap ${cfg[status] ?? 'bg-surface2 text-muted border-border'}`}>
      {status}
    </span>
  );
}

// ─── HTML Editor component ────────────────────────────────────────────────────

function HtmlEditor({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder?: string }) {
  const [tab, setTab] = useState<'edit' | 'preview'>('edit');
  return (
    <div className="border border-border rounded-xl overflow-hidden">
      <div className="flex items-center border-b border-border bg-surface2">
        <button onClick={() => setTab('edit')}
          className={`px-4 py-2 text-sm font-medium transition-colors ${tab === 'edit' ? 'bg-surface border-b-2 border-primary text-primary' : 'text-muted hover:text-ink'}`}>
          ✏ HTML Source
        </button>
        <button onClick={() => setTab('preview')}
          className={`px-4 py-2 text-sm font-medium transition-colors ${tab === 'preview' ? 'bg-surface border-b-2 border-primary text-primary' : 'text-muted hover:text-ink'}`}>
          👁 Preview
        </button>
        <span className="ml-auto px-3 text-xs text-muted font-mono">{value?.length ?? 0} chars</span>
      </div>
      {tab === 'edit' && (
        <textarea value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder}
          spellCheck={false}
          className="w-full h-96 p-4 text-sm font-mono text-ink bg-surface resize-y focus:outline-none leading-relaxed" />
      )}
      {tab === 'preview' && (
        <div className="h-96 overflow-y-auto p-4 bg-white">
          {value ? <div className="prose prose-sm max-w-none" dangerouslySetInnerHTML={{ __html: value }} />
            : <p className="text-muted text-sm italic">(No content to preview)</p>}
        </div>
      )}
    </div>
  );
}

function FieldLabel({ label, required }: { label: string; required?: boolean }) {
  return (
    <label className="block text-sm font-semibold text-ink-2 mb-1.5">
      {label}{required && <span className="text-red-500 ml-1">*</span>}
    </label>
  );
}

// ─── SEO Edit Modal ───────────────────────────────────────────────────────────

function SEOEditModal({ page, onClose, onSaved }: {
  page: BpmSeoData; onClose: () => void; onSaved: (updated: BpmSeoData) => void;
}) {
  const [tab, setTab] = useState<'meta' | 'content'>('meta');
  const [metaTitle,       setMetaTitle]       = useState(page.MetaTitle);
  const [metaDescription, setMetaDescription] = useState(page.MetaDescription);
  const [h1,              setH1]              = useState(page.H1);
  const [content,         setContent]         = useState(page.Content);
  const [canonicalUrl,    setCanonicalUrl]     = useState(page.CanonicalUrl);
  const [saving, setSaving] = useState(false);
  const [saved,  setSaved]  = useState(false);
  const [error,  setError]  = useState<string | null>(null);

  const metaDirty    = metaTitle !== page.MetaTitle || metaDescription !== page.MetaDescription || canonicalUrl !== page.CanonicalUrl;
  const contentDirty = h1 !== page.H1 || content !== page.Content;
  const anyDirty     = metaDirty || contentDirty;

  const handleSave = useCallback(async () => {
    setSaving(true); setError(null);
    try {
      const fields: Record<string, string> = {};
      if (metaTitle       !== page.MetaTitle)       fields.MetaTitle       = metaTitle;
      if (metaDescription !== page.MetaDescription) fields.MetaDescription = metaDescription;
      if (canonicalUrl    !== page.CanonicalUrl)     fields.CanonicalUrl    = canonicalUrl;
      if (h1              !== page.H1)               fields.H1              = h1;
      if (content         !== page.Content)          fields.Content         = content;
      if (Object.keys(fields).length === 0) { setSaving(false); return; }

      const res  = await fetch('/api/bpm-seo', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ urlId: page.URLID, fields }) });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Save failed');
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
      onSaved({ ...page, MetaTitle: metaTitle, MetaDescription: metaDescription, H1: h1, Content: content, CanonicalUrl: canonicalUrl });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally { setSaving(false); }
  }, [metaTitle, metaDescription, h1, content, canonicalUrl, page, onSaved]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/50 p-4 overflow-y-auto">
      <div className="relative w-full max-w-4xl bg-surface rounded-2xl shadow-2xl border border-border my-8">
        <div className="flex items-start justify-between px-6 py-5 border-b border-border">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <span className="text-xs font-semibold text-muted uppercase tracking-wider bg-surface2 border border-border px-2 py-0.5 rounded-full">Edit SEO</span>
              {page.SEOSource && <span className="text-xs text-muted font-mono">source: {page.SEOSource}</span>}
            </div>
            <h2 className="text-lg font-bold text-ink">{page.label}</h2>
            <a href={page.url} target="_blank" rel="noreferrer" className="text-sm text-primary hover:underline font-mono break-all">{page.url}</a>
          </div>
          <button onClick={onClose} className="ml-4 w-8 h-8 rounded-lg flex items-center justify-center text-muted hover:text-ink hover:bg-surface2 transition-colors flex-shrink-0">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
          </button>
        </div>

        <div className="flex border-b border-border px-6">
          {[{ key: 'meta', label: 'Meta Tags', dirty: metaDirty }, { key: 'content', label: 'Page Content', dirty: contentDirty }].map((t) => (
            <button key={t.key} onClick={() => setTab(t.key as 'meta' | 'content')}
              className={`relative px-4 py-3 text-sm font-medium transition-colors ${tab === t.key ? 'text-primary border-b-2 border-primary' : 'text-muted hover:text-ink'}`}>
              {t.label}
              {t.dirty && <span className="ml-1.5 inline-block w-1.5 h-1.5 rounded-full bg-amber-400 align-middle" />}
            </button>
          ))}
        </div>

        <div className="px-6 py-6 space-y-6">
          {tab === 'meta' && (
            <>
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <FieldLabel label="Meta Title" />
                  <CharCounter value={metaTitle} ideal={60} max={70} />
                </div>
                <input type="text" value={metaTitle} onChange={(e) => setMetaTitle(e.target.value)} placeholder="Enter meta title…"
                  className="w-full px-4 py-2.5 rounded-xl border border-border bg-surface2 text-ink text-sm focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary transition-colors" />
                <p className="text-xs text-muted mt-1.5">Ideal: 50–60 chars · Max: 70 chars</p>
              </div>
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <FieldLabel label="Meta Description" />
                  <CharCounter value={metaDescription} ideal={155} max={160} />
                </div>
                <textarea value={metaDescription} onChange={(e) => setMetaDescription(e.target.value)} rows={3} placeholder="Enter meta description…"
                  className="w-full px-4 py-2.5 rounded-xl border border-border bg-surface2 text-ink text-sm focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary transition-colors resize-none" />
                <p className="text-xs text-muted mt-1">Ideal: 150–155 chars · Max: 160 chars</p>
              </div>
              <div>
                <FieldLabel label="Canonical URL" />
                <input type="text" value={canonicalUrl} onChange={(e) => setCanonicalUrl(e.target.value)} placeholder="https://www.boldpreciousmetals.com/…"
                  className="w-full px-4 py-2.5 rounded-xl border border-border bg-surface2 text-ink text-sm font-mono focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary transition-colors" />
                <p className="text-xs text-muted mt-1.5">Canonical URL for this page</p>
              </div>
            </>
          )}
          {tab === 'content' && (
            <>
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <FieldLabel label="H1 (Content Heading)" />
                  <CharCounter value={h1} ideal={60} max={80} />
                </div>
                <input type="text" value={h1} onChange={(e) => setH1(e.target.value)} placeholder="Enter H1 heading…"
                  className="w-full px-4 py-2.5 rounded-xl border border-border bg-surface2 text-ink text-sm focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary transition-colors" />
                <p className="text-xs text-muted mt-1.5">Ideal: 20–70 chars</p>
              </div>
              <div>
                <FieldLabel label="Page Content (HTML)" />
                <HtmlEditor value={content} onChange={setContent} placeholder="<h2>Your heading</h2>&#10;<p>Your content here…</p>" />
                <p className="text-xs text-muted mt-1.5">HTML page content. Switch to <strong>Preview</strong> to see rendered output.</p>
              </div>
            </>
          )}
        </div>

        <div className="px-6 py-4 border-t border-border flex items-center justify-between gap-3 bg-surface2 rounded-b-2xl">
          <div className="flex items-center gap-3">
            {error && <span className="text-sm text-red-600 font-medium">{error}</span>}
            {saved && <span className="text-sm text-success font-medium">✓ Saved to database</span>}
          </div>
          <div className="flex items-center gap-3">
            <button onClick={onClose} className="px-4 py-2 text-sm font-medium text-muted hover:text-ink hover:bg-surface border border-border rounded-lg transition-colors">Cancel</button>
            <button onClick={handleSave} disabled={saving || !anyDirty}
              className="px-5 py-2 text-sm font-semibold text-white bg-primary hover:bg-blue-600 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2">
              {saving ? <><svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" /><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" /></svg>Saving…</> : <>Save to Database</>}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Page status dot ──────────────────────────────────────────────────────────

function StatusDot({ has }: { has: boolean }) {
  return <span className={`inline-block w-2 h-2 rounded-full flex-shrink-0 ${has ? 'bg-success' : 'bg-red-400'}`} />;
}

// ─── Page card ────────────────────────────────────────────────────────────────

function PageCard({ page, onEdit }: { page: BpmSeoData; onEdit: () => void }) {
  const missing = [
    !page.MetaTitle       && 'Meta Title',
    !page.MetaDescription && 'Meta Desc',
    !page.H1              && 'H1',
    !page.Content         && 'Content',
  ].filter(Boolean) as string[];

  const shortUrl = page.url.replace(/^https?:\/\/(www\.)?[^/]+/, '…');

  return (
    <div className="bg-surface rounded-xl border border-border shadow-card p-5 hover:border-primary/40 transition-colors">
      <div className="flex items-start justify-between gap-4">
        <div className="flex-1 min-w-0">
          <p className="font-bold text-ink text-base mb-0.5">{page.label}</p>
          <a href={page.url} target="_blank" rel="noreferrer" className="text-sm text-primary hover:underline font-mono break-all block">{shortUrl}</a>
          {page.SEOSource && (
            <div className="flex flex-wrap items-center gap-2 mt-3">
              <span className="text-xs bg-surface2 border border-border text-muted px-2 py-0.5 rounded-full font-mono">source: {page.SEOSource}</span>
            </div>
          )}
        </div>
        <button onClick={onEdit} className="flex items-center gap-2 px-4 py-2 bg-primary hover:bg-blue-600 text-white text-sm font-semibold rounded-lg transition-colors flex-shrink-0">
          <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
          </svg>
          Edit SEO
        </button>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-2">
        {[
          { key: 'Meta Title',   val: page.MetaTitle       },
          { key: 'Meta Desc',    val: page.MetaDescription },
          { key: 'H1',           val: page.H1              },
          { key: 'Page Content', val: page.Content         },
        ].map(({ key, val }) => (
          <div key={key} className="flex items-start gap-2 text-xs">
            <StatusDot has={!!val} />
            <div className="flex-1 min-w-0">
              <span className="font-semibold text-ink">{key}</span>
              {val ? (
                <p className="text-muted truncate mt-0.5">{val.replace(/<[^>]+>/g, ' ').slice(0, 80)}</p>
              ) : (
                <p className="text-red-500 font-medium mt-0.5">— Empty —</p>
              )}
            </div>
          </div>
        ))}
      </div>

      {missing.length > 0 && (
        <div className="mt-3 flex items-center gap-2 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
          <svg className="w-3.5 h-3.5 text-red-500 flex-shrink-0" fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          <p className="text-xs text-red-700 font-medium">Missing: {missing.join(', ')}</p>
        </div>
      )}
    </div>
  );
}

// ─── Push-to-DB inline panel (for suggestions) ────────────────────────────────

function SuggestionPushPanel({ item, pages, onDismiss }: { item: BpmSuggestion; pages: BpmSeoData[]; onDismiss: () => void }) {
  const page     = pages.find((p) => p.url.replace(/\/$/, '') === item.PageURL.replace(/\/$/, ''));
  const fieldKey = normField(item.FieldName);
  const [value,   setValue]   = useState(item.SuggestedContent ?? '');
  const [pushing, setPushing] = useState(false);
  const [result,  setResult]  = useState<{ ok: boolean; msg: string } | null>(null);

  const isContent   = fieldKey === 'Content';
  const isMultiLine = fieldKey === 'MetaDescription';

  if (!page || !fieldKey) {
    return (
      <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 flex items-start gap-3">
        <svg className="w-4 h-4 text-amber-500 mt-0.5 flex-shrink-0" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01M12 3a9 9 0 110 18A9 9 0 0112 3z" />
        </svg>
        <div>
          <p className="text-sm font-semibold text-amber-800">Cannot push field &ldquo;{item.FieldName}&rdquo;</p>
          <p className="text-sm text-amber-700 mt-0.5">Supported fields: MetaTitle, MetaDescription, H1, Page Content, CanonicalUrl.</p>
          <button onClick={onDismiss} className="mt-2 text-sm text-amber-700 font-medium hover:underline">Dismiss</button>
        </div>
      </div>
    );
  }

  const handlePush = async () => {
    setPushing(true); setResult(null);
    try {
      const res  = await fetch('/api/bpm-seo', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ urlId: page.URLID, fields: { [fieldKey]: value } }) });
      const data = await res.json();
      setResult(res.ok && data.success
        ? { ok: true,  msg: `✓ ${fieldKey} updated in the database.` }
        : { ok: false, msg: data.error ?? 'Unknown error' });
    } catch (err) {
      setResult({ ok: false, msg: String(err) });
    } finally { setPushing(false); }
  };

  return (
    <div className="rounded-xl border border-primary/30 bg-blue-50/60 p-4 space-y-3">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm font-semibold text-ink">Push to Database</p>
          <p className="text-xs text-muted mt-0.5">
            Field: <span className="font-mono font-medium text-ink">{fieldKey}</span> · Page: <span className="font-mono font-medium text-ink">{page.label}</span>
          </p>
        </div>
        <button onClick={onDismiss} title="Cancel" className="text-muted hover:text-ink transition-colors">
          <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
        </button>
      </div>

      {isContent ? (
        <HtmlEditor value={value} onChange={setValue} />
      ) : isMultiLine ? (
        <textarea value={value} onChange={(e) => setValue(e.target.value)} rows={3}
          className="w-full px-3 py-2 text-sm rounded-lg border border-border bg-surface text-ink focus:outline-none focus:ring-2 focus:ring-primary/30 resize-y" />
      ) : (
        <input type="text" value={value} onChange={(e) => setValue(e.target.value)}
          className="w-full px-3 py-2 text-sm rounded-lg border border-border bg-surface text-ink focus:outline-none focus:ring-2 focus:ring-primary/30" />
      )}

      {result && (
        <div className={`flex items-center gap-2 text-sm rounded-lg px-3 py-2 ${result.ok ? 'bg-success-light border border-green-200 text-green-800' : 'bg-red-50 border border-red-200 text-red-700'}`}>
          {result.ok
            ? <svg className="w-4 h-4 text-success flex-shrink-0" fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" /></svg>
            : <svg className="w-4 h-4 text-red-500 flex-shrink-0" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01M12 3a9 9 0 110 18A9 9 0 0112 3z" /></svg>}
          {result.msg}
        </div>
      )}

      <div className="flex items-center justify-end gap-2">
        <button onClick={onDismiss} className="text-sm px-3 py-1.5 rounded-lg border border-border bg-surface hover:bg-surface2 text-ink-2 transition-colors">Cancel</button>
        <button onClick={handlePush} disabled={pushing || !value}
          className="text-sm px-4 py-1.5 rounded-lg bg-primary hover:bg-blue-600 text-white font-semibold disabled:opacity-50 transition-colors flex items-center gap-2">
          {pushing ? <><svg className="w-3.5 h-3.5 animate-spin" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" /><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" /></svg>Pushing…</>
            : <><svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" /></svg>Confirm Push to DB</>}
        </button>
      </div>
    </div>
  );
}

// ─── Suggestion card ──────────────────────────────────────────────────────────

function SuggestionCard({
  item,
  pages,
  open,
  onToggle,
  pushOpenId,
  setPushOpenId,
  onStatusUpdated,
}: {
  item: BpmSuggestion;
  pages: BpmSeoData[];
  open: boolean;
  onToggle: () => void;
  pushOpenId: number | null;
  setPushOpenId: (id: number | null) => void;
  onStatusUpdated: (id: number, status: string, comment: string) => void;
}) {
  const matchedPage = pages.find((p) => p.url.replace(/\/$/, '') === item.PageURL.replace(/\/$/, ''));
  const pageLabel   = matchedPage?.label ?? item.PageURL.replace(/^https?:\/\/[^/]+/, '');
  const shortUrl  = item.PageURL.replace(/^https?:\/\/(www\.)?[^/]+/, '…');

  return (
    <div className="bg-surface rounded-xl border border-border shadow-card overflow-hidden">
      {/* Collapsed header */}
      <button onClick={onToggle} className="w-full text-left hover:bg-surface2 transition-colors">
        <div className="flex items-center gap-3 px-5 py-3.5 flex-wrap">
          <PriorityBadge priority={item.Priority} />
          <div className="flex-1 min-w-0">
            <p className="font-semibold text-ink text-sm">
              {item.FieldName ?? 'Content Field'}
              {item.IssueType && <span className="ml-2 text-muted text-sm font-normal">· {item.IssueType}</span>}
            </p>
            <p className="text-xs text-muted mt-0.5 font-mono">{shortUrl}</p>
          </div>
          <div className="flex items-center gap-2 flex-shrink-0">
            <StatusBadge status={item.Status} />
            <span className="text-xs text-muted bg-surface2 border border-border px-2 py-0.5 rounded-full hidden sm:inline">{item.ScanName}</span>
            <svg className={`w-4 h-4 text-muted transition-transform ${open ? 'rotate-180' : ''}`}
              fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
            </svg>
          </div>
        </div>

        {/* Suggested preview strip (collapsed) */}
        {!open && item.SuggestedContent && (
          <div className="mx-5 mb-3.5 rounded-lg border border-green-200 bg-success-light overflow-hidden">
            <div className="px-3 py-1 bg-green-100 border-b border-green-200 flex items-center gap-1.5">
              <svg className="w-3 h-3 text-success" fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
              </svg>
              <span className="text-xs font-semibold text-success uppercase tracking-wide">Suggested</span>
              {item.SuggestedCharCount && <span className="ml-auto text-xs text-green-600 font-mono">{item.SuggestedCharCount} chars</span>}
            </div>
            <p className="px-3 py-2 text-sm text-green-900 leading-relaxed">{trunc(item.SuggestedContent, 200)}</p>
          </div>
        )}
      </button>

      {/* Expanded detail */}
      {open && (
        <div className="px-5 pb-5 border-t border-border space-y-4 mt-1">

          {/* Scan info */}
          <div className="flex items-center gap-2 pt-3 text-xs text-muted">
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
            </svg>
            Scan: <span className="font-semibold text-ink-2">{item.ScanName}</span>
            <span className="mx-1">·</span>
            Page: <span className="font-semibold text-ink-2">{pageLabel}</span>
          </div>

          {/* Side-by-side diff */}
          <div className="grid grid-cols-2 gap-4">
            <div className="rounded-xl border border-border overflow-hidden">
              <div className="px-4 py-2 bg-surface2 border-b border-border flex items-center justify-between">
                <p className="text-sm font-semibold text-muted uppercase">Current</p>
                {item.CurrentCharCount !== null && <span className="text-sm text-muted font-mono">{item.CurrentCharCount} chars</span>}
              </div>
              <div className="p-4">
                <p className="text-sm text-ink-2 whitespace-pre-wrap leading-relaxed">{item.CurrentContent || '—'}</p>
              </div>
            </div>

            <div className="rounded-xl border border-green-200 overflow-hidden">
              <div className="px-4 py-2 bg-green-100 border-b border-green-200 flex items-center justify-between">
                <p className="text-sm font-semibold text-success uppercase">✦ Suggested</p>
                <div className="flex items-center gap-2">
                  {item.SuggestedCharCount !== null && <span className="text-sm text-green-600 font-mono">{item.SuggestedCharCount} chars</span>}
                  {item.SuggestedContent && (
                    <button
                      onClick={(e) => { e.stopPropagation(); setPushOpenId(pushOpenId === item.ImprovementID ? null : item.ImprovementID); }}
                      className="flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1 rounded-md bg-primary hover:bg-blue-600 text-white transition-colors"
                    >
                      <svg className="w-3 h-3" fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
                      </svg>
                      Push to DB
                    </button>
                  )}
                </div>
              </div>
              <div className="p-4 bg-success-light">
                <p className="text-sm text-green-900 whitespace-pre-wrap leading-relaxed font-medium">{item.SuggestedContent || '—'}</p>
              </div>
            </div>
          </div>

          {/* Push panel */}
          {pushOpenId === item.ImprovementID && (
            <SuggestionPushPanel item={item} pages={pages} onDismiss={() => setPushOpenId(null)} />
          )}

          {/* Reasoning + Impact */}
          {(item.Reasoning || item.ImpactEstimate) && (
            <div className="grid grid-cols-2 gap-4">
              {item.Reasoning && (
                <div className="rounded-xl border border-border p-4">
                  <p className="text-sm font-semibold text-muted uppercase mb-1.5">Reasoning</p>
                  <p className="text-sm text-ink-2">{item.Reasoning}</p>
                </div>
              )}
              {item.ImpactEstimate && (
                <div className="rounded-xl border border-border p-4">
                  <p className="text-sm font-semibold text-muted uppercase mb-1.5">Impact Estimate</p>
                  <p className="text-sm text-ink-2">{item.ImpactEstimate}</p>
                </div>
              )}
            </div>
          )}

          {/* Status update row */}
          <SuggestionStatusRow item={item} onUpdated={onStatusUpdated} />
        </div>
      )}
    </div>
  );
}

// ─── Suggestion status row ────────────────────────────────────────────────────

function SuggestionStatusRow({ item, onUpdated }: {
  item: BpmSuggestion;
  onUpdated: (id: number, status: string, comment: string) => void;
}) {
  const [status,  setStatus]  = useState(item.Status);
  const [comment, setComment] = useState(item.UserComment ?? '');
  const [saving,  setSaving]  = useState(false);
  const [saved,   setSaved]   = useState(false);

  const save = async () => {
    setSaving(true);
    try {
      const res = await fetch(`/api/issues/improvement/${item.ImprovementID}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status, comment: comment || null }),
      });
      if (res.ok) {
        setSaved(true);
        onUpdated(item.ImprovementID, status, comment);
        setTimeout(() => setSaved(false), 2000);
      }
    } finally { setSaving(false); }
  };

  return (
    <div className="flex flex-wrap items-center gap-2 pt-3 border-t border-border/60">
      <select value={status} onChange={(e) => setStatus(e.target.value as BpmSuggestion['Status'])}
        className="text-sm px-3 py-1.5 rounded-lg border border-border bg-surface2 text-ink focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary">
        <option value="Yet to Act">Yet to Act</option>
        <option value="Acted">Acted</option>
        <option value="Deferred">Deferred</option>
      </select>
      <input type="text" value={comment} onChange={(e) => setComment(e.target.value)}
        placeholder="Add comment…"
        className="flex-1 min-w-[160px] text-sm px-3 py-1.5 rounded-lg border border-border bg-surface2 text-ink placeholder:text-muted focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary" />
      <button onClick={save} disabled={saving}
        className="text-sm px-3 py-1.5 rounded-lg bg-primary hover:bg-blue-600 text-white font-medium disabled:opacity-50 transition-colors">
        {saving ? 'Saving…' : saved ? '✓ Saved' : 'Save'}
      </button>
      {item.LastAuditedByName && (
        <span className="text-xs text-muted whitespace-nowrap">
          Last: <span className="font-medium text-ink-2">{item.LastAuditedByName}</span> · {fmtDate(item.LastAuditedAt)}
        </span>
      )}
    </div>
  );
}

// ─── Filter pills ─────────────────────────────────────────────────────────────

function FilterPills<T extends string>({ label, options, value, onChange }: {
  label: string; options: readonly T[]; value: T; onChange: (v: T) => void;
}) {
  return (
    <div className="flex items-center gap-2 flex-wrap">
      <span className="text-sm font-semibold text-muted uppercase tracking-wide w-16 flex-shrink-0">{label}</span>
      <div className="flex gap-1 flex-wrap">
        {options.map((opt) => (
          <button key={opt} onClick={() => onChange(opt)}
            className={`text-sm px-2.5 py-1 rounded-full border font-medium transition-colors ${
              value === opt ? 'bg-primary text-white border-primary' : 'bg-surface text-muted border-border hover:border-primary/40 hover:text-ink'
            }`}>
            {opt}
          </button>
        ))}
      </div>
    </div>
  );
}

// ─── Suggestions section ──────────────────────────────────────────────────────

const PRIORITY_OPTIONS = ['All', 'High', 'Medium', 'Low'] as const;
const STATUS_OPTIONS   = ['All', 'Yet to Act', 'Acted', 'Deferred'] as const;
type PriorityFilter = typeof PRIORITY_OPTIONS[number];
type StatusFilter   = typeof STATUS_OPTIONS[number];

function SuggestionsSection({ pages }: { pages: BpmSeoData[] }) {
  const [improvements, setImprovements] = useState<BpmSuggestion[]>([]);
  const [scans,        setScans]        = useState<ScanOption[]>([]);
  const [loading,      setLoading]      = useState(true);
  const [error,        setError]        = useState<string | null>(null);
  const [expanded,     setExpanded]     = useState<Set<number>>(new Set());
  const [pushOpenId,   setPushOpenId]   = useState<number | null>(null);

  // Filters
  const [filterScan,     setFilterScan]     = useState<string>('All');
  const [filterPage,     setFilterPage]     = useState<string>('All');
  const [filterPriority, setFilterPriority] = useState<PriorityFilter>('All');
  const [filterStatus,   setFilterStatus]   = useState<StatusFilter>('All');

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const res  = await fetch('/api/bpm-seo/suggestions');
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Failed');
      setImprovements(json.improvements ?? []);
      setScans(json.scans ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  const toggle = (id: number) => setExpanded((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });

  const onStatusUpdated = (id: number, status: string, comment: string) => {
    setImprovements((prev) => prev.map((i) =>
      i.ImprovementID === id ? { ...i, Status: status as BpmSuggestion['Status'], UserComment: comment } : i
    ));
  };

  // Unique page URLs for filter pill
  const uniquePageUrls = Array.from(new Set(improvements.map((i) => i.PageURL)));

  const filtered = improvements.filter((i) => {
    if (filterScan     !== 'All' && String(i.ScanID) !== filterScan) return false;
    if (filterPage     !== 'All' && i.PageURL !== filterPage) return false;
    if (filterPriority !== 'All' && i.Priority !== filterPriority) return false;
    if (filterStatus   !== 'All' && i.Status   !== filterStatus)   return false;
    return true;
  });

  const isFiltered = filterScan !== 'All' || filterPage !== 'All' || filterPriority !== 'All' || filterStatus !== 'All';

  const clearFilters = () => { setFilterScan('All'); setFilterPage('All'); setFilterPriority('All'); setFilterStatus('All'); };

  // Summary counts
  const countByStatus = (s: string) => improvements.filter((i) => i.Status === s).length;

  return (
    <div className="space-y-4">
      {/* Section header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-bold text-ink">SEO Suggestions from Scans</h2>
          <p className="text-sm text-muted mt-0.5">AI-generated content improvement suggestions for BPM pages.</p>
        </div>
        <button onClick={load} disabled={loading}
          className="flex items-center gap-2 px-3 py-1.5 text-sm font-medium border border-border rounded-lg bg-surface hover:bg-surface2 text-ink-2 disabled:opacity-50 transition-colors">
          <svg className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
          </svg>
          Refresh
        </button>
      </div>

      {/* Summary chips */}
      {!loading && improvements.length > 0 && (
        <div className="flex flex-wrap gap-2">
          <span className="text-xs font-semibold text-muted bg-surface2 border border-border px-3 py-1 rounded-full">{improvements.length} total</span>
          <span className="text-xs font-semibold text-amber-700 bg-amber-50 border border-amber-200 px-3 py-1 rounded-full">{countByStatus('Yet to Act')} yet to act</span>
          <span className="text-xs font-semibold text-green-700 bg-success-light border border-green-200 px-3 py-1 rounded-full">{countByStatus('Acted')} acted</span>
          <span className="text-xs font-semibold text-muted bg-surface2 border border-border px-3 py-1 rounded-full">{countByStatus('Deferred')} deferred</span>
        </div>
      )}

      {loading && (
        <div className="flex items-center justify-center py-12">
          <svg className="w-6 h-6 text-primary animate-spin" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
          </svg>
          <span className="ml-3 text-muted text-sm">Loading suggestions…</span>
        </div>
      )}

      {error && (
        <div className="flex items-center gap-3 bg-red-50 border border-red-200 rounded-xl p-4">
          <svg className="w-5 h-5 text-red-500 flex-shrink-0" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          <p className="text-sm text-red-700">{error}</p>
          <button onClick={load} className="ml-auto text-sm text-red-600 hover:text-red-800 font-medium underline">Retry</button>
        </div>
      )}

      {!loading && !error && improvements.length === 0 && (
        <div className="flex flex-col items-center justify-center py-16 text-muted">
          <svg className="w-10 h-10 mb-3 text-muted/40" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
          </svg>
          <p className="text-sm font-medium">No suggestions yet</p>
          <p className="text-sm mt-1">Run a scan that includes BPM page URLs to see suggestions here.</p>
        </div>
      )}

      {!loading && !error && improvements.length > 0 && (
        <>
          {/* Filter bar */}
          <div className="bg-surface border border-border rounded-xl px-4 py-3.5 space-y-3">

            {/* Scan dropdown */}
            <div className="flex items-center gap-2">
              <span className="text-sm font-semibold text-muted uppercase tracking-wide w-16 flex-shrink-0">Scan</span>
              <select value={filterScan} onChange={(e) => setFilterScan(e.target.value)}
                className="text-sm px-3 py-1.5 rounded-lg border border-border bg-canvas text-ink focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary max-w-xs">
                <option value="All">All Scans ({scans.length})</option>
                {scans.map((s) => (
                  <option key={s.ScanID} value={String(s.ScanID)}>
                    {s.ScanName} · {fmtDate(s.StartedAt)}
                  </option>
                ))}
              </select>
            </div>

            {/* Page pills */}
            {uniquePageUrls.length > 1 && (
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-sm font-semibold text-muted uppercase tracking-wide w-16 flex-shrink-0">Page</span>
                <div className="flex gap-1 flex-wrap">
                  {(['All', ...uniquePageUrls] as string[]).map((purl) => {
                    const matchedPage = pages.find((p) => p.url.replace(/\/$/, '') === purl.replace(/\/$/, ''));
                    const label = purl === 'All' ? 'All' : (matchedPage?.label ?? purl.replace(/^https?:\/\/[^/]+/, ''));
                    return (
                      <button key={purl} onClick={() => setFilterPage(purl)}
                        className={`text-sm px-2.5 py-1 rounded-full border font-medium transition-colors ${
                          filterPage === purl ? 'bg-primary text-white border-primary' : 'bg-surface text-muted border-border hover:border-primary/40 hover:text-ink'
                        }`}>
                        {label}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Priority pills */}
            <FilterPills label="Priority" options={PRIORITY_OPTIONS} value={filterPriority} onChange={setFilterPriority} />

            {/* Status pills */}
            <FilterPills label="Status" options={STATUS_OPTIONS} value={filterStatus} onChange={setFilterStatus} />

            {/* Count + clear */}
            <div className="flex items-center justify-between pt-1 border-t border-border/60">
              <p className="text-sm text-muted">
                Showing <span className="font-semibold text-ink">{filtered.length}</span> of <span className="font-semibold">{improvements.length}</span> suggestions
              </p>
              {isFiltered && (
                <button onClick={clearFilters} className="text-sm text-primary hover:text-blue-700 font-medium flex items-center gap-1">
                  <svg className="w-3 h-3" fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
                  Clear filters
                </button>
              )}
            </div>
          </div>

          {filtered.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-10 text-muted text-sm">No suggestions match the selected filters.</div>
          ) : (
            <div className="space-y-3">
              {filtered.map((item) => (
                <SuggestionCard
                  key={item.ImprovementID}
                  item={item}
                  pages={pages}
                  open={expanded.has(item.ImprovementID)}
                  onToggle={() => toggle(item.ImprovementID)}
                  pushOpenId={pushOpenId}
                  setPushOpenId={setPushOpenId}
                  onStatusUpdated={onStatusUpdated}
                />
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function BpmSeoPage() {
  const [pages,   setPages]   = useState<BpmSeoData[]>([]);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState<string | null>(null);
  const [editing, setEditing] = useState<BpmSeoData | null>(null);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const res  = await fetch('/api/bpm-seo');
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Failed to load');
      setPages(Array.isArray(json) ? json : [json]);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  const handleSaved = (updated: BpmSeoData) => {
    setPages((prev) => prev.map((p) => (p.URLID === updated.URLID ? updated : p)));
    setEditing(updated);
  };

  const totalMissing = pages.reduce(
    (n, p) => n + (!p.MetaTitle ? 1 : 0) + (!p.MetaDescription ? 1 : 0) + (!p.H1 ? 1 : 0) + (!p.Content ? 1 : 0),
    0
  );

  return (
    <div className="max-w-5xl mx-auto space-y-8">

      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold text-ink">BPM Page SEO</h1>
          <p className="text-muted text-sm mt-1">
            Manage meta tags and page content for Bold Precious Metals category pages.
          </p>
        </div>
        <button onClick={load} disabled={loading}
          className="flex items-center gap-2 px-4 py-2 text-sm font-medium border border-border rounded-xl bg-surface hover:bg-surface2 text-ink-2 disabled:opacity-50 transition-colors">
          <svg className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
          </svg>
          Refresh
        </button>
      </div>

      {/* Summary stats */}
      {!loading && pages.length > 0 && (
        <div className="grid grid-cols-3 gap-4">
          <div className="bg-surface rounded-xl border border-border p-4">
            <p className="text-2xl font-bold text-ink">{pages.length}</p>
            <p className="text-sm text-muted mt-0.5">Managed Pages</p>
          </div>
          <div className="bg-surface rounded-xl border border-border p-4">
            <p className="text-2xl font-bold text-success">{pages.filter((p) => p.Content).length}</p>
            <p className="text-sm text-muted mt-0.5">Pages with Content</p>
          </div>
          <div className={`rounded-xl border p-4 ${totalMissing > 0 ? 'bg-red-50 border-red-200' : 'bg-surface border-border'}`}>
            <p className={`text-2xl font-bold ${totalMissing > 0 ? 'text-red-600' : 'text-success'}`}>{totalMissing}</p>
            <p className={`text-sm mt-0.5 ${totalMissing > 0 ? 'text-red-700' : 'text-muted'}`}>
              {totalMissing > 0 ? 'Missing SEO Fields' : 'All fields complete'}
            </p>
          </div>
        </div>
      )}

      {loading && (
        <div className="flex items-center justify-center py-20">
          <svg className="w-8 h-8 text-primary animate-spin" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
          </svg>
          <span className="ml-3 text-muted text-sm">Loading SEO data…</span>
        </div>
      )}

      {error && (
        <div className="flex items-center gap-3 bg-red-50 border border-red-200 rounded-xl p-4">
          <svg className="w-5 h-5 text-red-500 flex-shrink-0" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          <p className="text-sm text-red-700">{error}</p>
          <button onClick={load} className="ml-auto text-sm text-red-600 hover:text-red-800 font-medium underline">Retry</button>
        </div>
      )}

      {/* Page cards */}
      {!loading && !error && (
        <>
          <section className="space-y-3">
            <h2 className="text-lg font-bold text-ink">Current SEO Data</h2>
            {pages.map((p) => (
              <PageCard key={p.URLID} page={p} onEdit={() => setEditing(p)} />
            ))}
          </section>

          {/* Divider */}
          <div className="border-t border-border" />

          {/* Suggestions section */}
          <SuggestionsSection pages={pages} />
        </>
      )}

      {/* Edit Modal */}
      {editing && (
        <SEOEditModal page={editing} onClose={() => setEditing(null)} onSaved={handleSaved} />
      )}
    </div>
  );
}
