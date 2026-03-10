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

function trunc(s: string | null | undefined, n = 120) {
  if (!s) return null;
  return s.length > n ? s.slice(0, n) + '…' : s;
}

function ActionedByChip({ name, at }: { name: string | null | undefined; at: string | null | undefined }) {
  if (!name) return null;
  return (
    <span className="flex items-center gap-1 text-sm text-muted border border-border bg-surface2 px-2 py-0.5 rounded-full whitespace-nowrap flex-shrink-0">
      <svg className="w-3 h-3" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
      </svg>
      {name}
      {at && <span className="text-muted/70">· {new Date(at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}</span>}
    </span>
  );
}

// ─── Expand All toolbar ───────────────────────────────────────────────────────

function ExpandToolbar({
  total,
  expandedCount,
  onExpandAll,
  onCollapseAll,
}: {
  total: number;
  expandedCount: number;
  onExpandAll: () => void;
  onCollapseAll: () => void;
}) {
  return (
    <div className="flex items-center justify-between mb-4">
      <p className="text-sm text-muted">
        {expandedCount} of {total} expanded
      </p>
      <div className="flex gap-2">
        <button
          onClick={onExpandAll}
          className="flex items-center gap-1.5 text-sm font-medium px-3 py-1.5 rounded-lg border border-border bg-surface hover:bg-surface2 text-ink-2 transition-colors"
        >
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
          </svg>
          Expand All
        </button>
        <button
          onClick={onCollapseAll}
          className="flex items-center gap-1.5 text-sm font-medium px-3 py-1.5 rounded-lg border border-border bg-surface hover:bg-surface2 text-ink-2 transition-colors"
        >
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M5 15l7-7 7 7" />
          </svg>
          Collapse All
        </button>
      </div>
    </div>
  );
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
        className="text-sm px-3 py-1.5 rounded-lg border border-border bg-surface2 text-ink focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary"
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
        className="flex-1 min-w-[160px] text-sm px-3 py-1.5 rounded-lg border border-border bg-surface2 text-ink placeholder:text-muted focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary"
      />
      <button
        onClick={save}
        disabled={saving}
        className="text-sm px-3 py-1.5 rounded-lg bg-primary hover:bg-blue-600 text-white font-medium disabled:opacity-50 transition-colors"
      >
        {saving ? 'Saving…' : saved ? '✓ Saved' : 'Save'}
      </button>
    </div>
  );
}

// ─── Push-to-DB helpers (client-side BPM page lookup) ─────────────────────────

// Mirrors bpm-pages.ts but kept here as a plain client-safe map
const BPM_PAGE_ID_MAP: Record<string, string> = {
  'https://www.boldpreciousmetals.com/gold-bullion': 'gold-bullion',
  'https://www.boldpreciousmetals.com/gold-bullion/gold-coins': 'gold-coins',
  'https://www.boldpreciousmetals.com/gold-bullion/gold-coins/american-gold-eagle-coins': 'american-gold-eagle',
};

const PUSH_FIELD_MAP: Record<string, string> = {
  'meta title':       'MetaTitle',
  'meta description': 'MetaDescription',
  'h1':               'H1',
  'page content':     'Content',
  'content':          'Content',
  'canonical url':    'CanonicalUrl',
  'canonical':        'CanonicalUrl',
};

function lookupBpmPageId(url: string | null | undefined): string | null {
  if (!url) return null;
  return BPM_PAGE_ID_MAP[url.replace(/\/$/, '')] ?? null;
}

function normalisePushField(name: string | null | undefined): string {
  if (!name) return '';
  return PUSH_FIELD_MAP[name.toLowerCase().trim()] ?? '';
}

// ─── Inline HTML editor ────────────────────────────────────────────────────────

type HtmlTab = 'source' | 'preview';

function InlineHtmlEditor({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const [tab, setTab] = useState<HtmlTab>('source');
  return (
    <div className="rounded-lg border border-border overflow-hidden">
      <div className="flex border-b border-border bg-surface2">
        {(['source', 'preview'] as HtmlTab[]).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-4 py-2 text-sm font-medium transition-colors ${
              tab === t
                ? 'text-primary border-b-2 border-primary -mb-px bg-surface'
                : 'text-muted hover:text-ink'
            }`}
          >
            {t === 'source' ? 'HTML Source' : 'Preview'}
          </button>
        ))}
      </div>
      {tab === 'source' ? (
        <textarea
          value={value}
          onChange={(e) => onChange(e.target.value)}
          rows={10}
          className="w-full p-3 text-sm font-mono bg-surface text-ink focus:outline-none focus:ring-1 focus:ring-primary/30 resize-y"
          placeholder="Enter HTML content…"
        />
      ) : (
        <div
          className="p-4 bg-white min-h-[120px] prose prose-sm max-w-none text-sm"
          dangerouslySetInnerHTML={{ __html: value || '<em style="color:#999">Nothing to preview.</em>' }}
        />
      )}
    </div>
  );
}

// ─── Push-to-DB panel ─────────────────────────────────────────────────────────

function PushToDbPanel({ item, onDismiss }: { item: ContentImprovement; onDismiss: () => void }) {
  const pageId   = lookupBpmPageId(item.PageURL);
  const fieldKey = normalisePushField(item.FieldName);
  const [value,   setValue]   = useState(item.SuggestedContent ?? '');
  const [pushing, setPushing] = useState(false);
  const [result,  setResult]  = useState<{ ok: boolean; msg: string } | null>(null);

  const isContent   = fieldKey === 'Content';
  const isMultiLine = fieldKey === 'MetaDescription';

  if (!pageId) {
    return (
      <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 flex items-start gap-3">
        <svg className="w-4 h-4 text-amber-500 mt-0.5 flex-shrink-0" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01M12 3a9 9 0 110 18A9 9 0 0112 3z" />
        </svg>
        <div>
          <p className="text-sm font-semibold text-amber-800">Not a BPM managed page</p>
          <p className="text-sm text-amber-700 mt-0.5">
            Push-to-DB is only available for pages configured in BPM Pages. This URL is not in the list.
          </p>
          <button onClick={onDismiss} className="mt-2 text-sm text-amber-700 font-medium hover:underline">Dismiss</button>
        </div>
      </div>
    );
  }

  if (!fieldKey) {
    return (
      <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 flex items-start gap-3">
        <svg className="w-4 h-4 text-amber-500 mt-0.5 flex-shrink-0" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01M12 3a9 9 0 110 18A9 9 0 0112 3z" />
        </svg>
        <div>
          <p className="text-sm font-semibold text-amber-800">Field not writable via Push-to-DB</p>
          <p className="text-sm text-amber-700 mt-0.5">
            &ldquo;{item.FieldName}&rdquo; is not a supported push field. Supported fields: MetaTitle, MetaDescription, H1, Page Content, CanonicalUrl.
          </p>
          <button onClick={onDismiss} className="mt-2 text-sm text-amber-700 font-medium hover:underline">Dismiss</button>
        </div>
      </div>
    );
  }

  const handlePush = async () => {
    setPushing(true);
    setResult(null);
    try {
      const res  = await fetch('/api/bpm-seo', {
        method:  'PUT',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ id: pageId, fields: { [fieldKey]: value } }),
      });
      const data = await res.json();
      if (res.ok && data.success) {
        setResult({ ok: true, msg: `✓ ${fieldKey} updated in the database.` });
      } else {
        setResult({ ok: false, msg: data.error ?? 'Unknown error' });
      }
    } catch (err) {
      setResult({ ok: false, msg: String(err) });
    } finally {
      setPushing(false);
    }
  };

  return (
    <div className="rounded-xl border border-primary/30 bg-blue-50/60 p-4 space-y-3">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm font-semibold text-ink">Push to Database</p>
          <p className="text-xs text-muted mt-0.5">
            Field: <span className="font-mono font-medium text-ink">{fieldKey}</span>
            {' · '}Page: <span className="font-mono font-medium text-ink">{pageId}</span>
          </p>
        </div>
        <button onClick={onDismiss} title="Cancel" className="text-muted hover:text-ink transition-colors">
          <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>

      {/* Editor */}
      {isContent ? (
        <InlineHtmlEditor value={value} onChange={setValue} />
      ) : isMultiLine ? (
        <textarea
          value={value}
          onChange={(e) => setValue(e.target.value)}
          rows={3}
          className="w-full px-3 py-2 text-sm rounded-lg border border-border bg-surface text-ink focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary resize-y"
          placeholder={`Enter ${fieldKey}…`}
        />
      ) : (
        <input
          type="text"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          className="w-full px-3 py-2 text-sm rounded-lg border border-border bg-surface text-ink focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary"
          placeholder={`Enter ${fieldKey}…`}
        />
      )}

      {/* Result feedback */}
      {result && (
        <div className={`flex items-center gap-2 text-sm rounded-lg px-3 py-2 ${
          result.ok
            ? 'bg-success-light border border-green-200 text-green-800'
            : 'bg-red-50 border border-red-200 text-red-700'
        }`}>
          {result.ok ? (
            <svg className="w-4 h-4 text-success flex-shrink-0" fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
            </svg>
          ) : (
            <svg className="w-4 h-4 text-red-500 flex-shrink-0" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01M12 3a9 9 0 110 18A9 9 0 0112 3z" />
            </svg>
          )}
          {result.msg}
        </div>
      )}

      {/* Actions */}
      <div className="flex items-center justify-end gap-2">
        <button
          onClick={onDismiss}
          className="text-sm px-3 py-1.5 rounded-lg border border-border bg-surface hover:bg-surface2 text-ink-2 transition-colors"
        >
          Cancel
        </button>
        <button
          onClick={handlePush}
          disabled={pushing || !value}
          className="text-sm px-4 py-1.5 rounded-lg bg-primary hover:bg-blue-600 text-white font-semibold disabled:opacity-50 transition-colors flex items-center gap-2"
        >
          {pushing ? (
            <>
              <svg className="w-3.5 h-3.5 animate-spin" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
              </svg>
              Pushing…
            </>
          ) : (
            <>
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
              </svg>
              Confirm Push to DB
            </>
          )}
        </button>
      </div>
    </div>
  );
}

// ─── Keywords Tab — helpers ───────────────────────────────────────────────────

interface KwSuggestion {
  priority: 'high' | 'medium' | 'low';
  title: string;
  reasoning: string;
  items?: string[];
}

function buildKwSuggestions(kw: PageKeyword): KwSuggestion[] {
  const out: KwSuggestion[] = [];
  const score = kw.ContentFocusScore ?? 0;

  // 1. Score-based focus recommendation
  if (score > 0 && score <= 4) {
    out.push({
      priority: 'high',
      title: 'Rewrite content to focus on the primary keyword',
      reasoning: `Content focus score is ${score}/10 — very low. Google may not confidently associate this page with "${kw.PrimaryKeyword}". Rewrite key sections so the primary topic is unmistakable: use it in the H1, opening paragraph, and at least one subheading.`,
    });
  } else if (score >= 5 && score <= 6) {
    out.push({
      priority: 'medium',
      title: 'Strengthen content focus',
      reasoning: `Score ${score}/10 is moderate. Add more on-topic copy about "${kw.PrimaryKeyword}" — particularly in the opening paragraph and at least one H2 subheading — to strengthen the relevance signal.`,
    });
  }

  // 2. Keyword gaps — high value
  if (kw.KeywordGaps.length > 0) {
    out.push({
      priority: 'high',
      title: 'Target these missing keyword opportunities',
      reasoning: `Your page doesn't currently rank for these closely related search terms. Users are actively looking for them — adding them in body copy, an FAQ section, or a dedicated paragraph can capture additional organic traffic without creating a new page.`,
      items: kw.KeywordGaps,
    });
  }

  // 3. Missing LSI terms
  if (kw.MissingLSITerms.length > 0) {
    out.push({
      priority: 'medium',
      title: 'Weave in LSI terms to build topical authority',
      reasoning: `Search engines use semantically related terms to judge how comprehensively a page covers a topic. Including these naturally in body copy, subheadings, or an FAQ signals expertise and can strengthen rankings for the primary keyword.`,
      items: kw.MissingLSITerms,
    });
  }

  // 4. Intent-specific recommendation
  const intent = kw.SearchIntent?.toLowerCase() ?? '';
  if (intent.includes('transactional')) {
    out.push({
      priority: 'low',
      title: 'Optimise page elements for buying intent',
      reasoning: `Visitors on this page intend to purchase. Ensure you have: a visible price, a prominent "Add to Cart" or "Buy Now" CTA above the fold, product specifications, and trust signals (customer reviews, certifications, secure-payment badges).`,
    });
  } else if (intent.includes('informational')) {
    out.push({
      priority: 'low',
      title: 'Structure content for information-seeking visitors',
      reasoning: `Users want to learn before they buy. Use clear H2/H3 headings, add a FAQ section, include comparison tables or bullet-point specs where relevant, and link to the nearest relevant buying page.`,
    });
  } else if (intent.includes('commercial')) {
    out.push({
      priority: 'low',
      title: 'Include comparison and decision-support elements',
      reasoning: `Commercial intent visitors are weighing options. Add comparison tables, pros/cons lists, and specific product differentiators — then make it easy to proceed to purchase from the same page.`,
    });
  }

  // 5. Always: primary keyword placement checklist
  out.push({
    priority: 'low',
    title: `Verify "${kw.PrimaryKeyword}" appears in all critical locations`,
    reasoning: `The primary keyword must appear in: the page <title> tag, the <h1>, the meta description (within 160 characters), and naturally in the first 100 words of body content. Missing any of these is a quick win.`,
  });

  return out;
}

// ── Suggestion card ───────────────────────────────────────────────────────────

function KwSuggestionCard({ s }: { s: KwSuggestion }) {
  const cfg = {
    high:   { bar: 'bg-red-400',   badge: 'bg-red-100 text-red-700 border-red-200',   label: 'High Priority',    tag: 'bg-red-50 text-red-800 border-red-200' },
    medium: { bar: 'bg-amber-400', badge: 'bg-amber-100 text-amber-700 border-amber-200', label: 'Medium Priority', tag: 'bg-amber-50 text-amber-800 border-amber-200' },
    low:    { bar: 'bg-blue-300',  badge: 'bg-blue-50 text-blue-600 border-blue-200',  label: 'Good Practice',    tag: 'bg-slate-100 text-slate-700 border-slate-200' },
  }[s.priority];

  return (
    <div className="flex gap-3">
      <div className={`w-1 rounded-full flex-shrink-0 self-stretch ${cfg.bar}`} />
      <div className="flex-1 min-w-0 py-0.5">
        <div className="flex items-center gap-2 mb-1">
          <span className={`inline-flex items-center text-xs font-semibold px-2 py-0.5 rounded-full border ${cfg.badge}`}>
            {cfg.label}
          </span>
        </div>
        <p className="font-semibold text-ink text-sm">{s.title}</p>
        <p className="text-muted text-sm mt-0.5 leading-relaxed">{s.reasoning}</p>
        {s.items && s.items.length > 0 && (
          <div className="flex flex-wrap gap-1 mt-2">
            {s.items.map((item, i) => (
              <span key={i} className={`border text-xs px-2 py-0.5 rounded-md font-medium ${cfg.tag}`}>
                {item}
              </span>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Keyword chip list ─────────────────────────────────────────────────────────

function KwChips({ label, items, cls }: { label: string; items: string[]; cls: string }) {
  if (!items || items.length === 0) return null;
  return (
    <div>
      <p className="text-xs font-semibold text-muted uppercase tracking-wide mb-1.5">{label}</p>
      <div className="flex flex-wrap gap-1">
        {items.map((t, i) => (
          <span key={i} className={`border text-xs px-2 py-0.5 rounded-md ${cls}`}>{t}</span>
        ))}
      </div>
    </div>
  );
}

// ── Single keyword card ───────────────────────────────────────────────────────

function KeywordCard({ kw, open, onToggle }: { kw: PageKeyword; open: boolean; onToggle: () => void }) {
  const suggestions = buildKwSuggestions(kw);
  const topSuggestion = suggestions[0];
  const highCount = suggestions.filter((s) => s.priority === 'high').length;
  const shortUrl = kw.PageURL.replace(/^https?:\/\/(www\.)?[^/]+/, '…');

  return (
    <div className="bg-surface rounded-xl border border-border shadow-card overflow-hidden">

      {/* ── Collapsed header ── */}
      <button onClick={onToggle} className="w-full text-left hover:bg-surface2 transition-colors">
        <div className="flex items-center gap-4 px-5 py-3.5">
          <ScoreBadge score={kw.ContentFocusScore} />
          <div className="flex-1 min-w-0">
            <p className="font-semibold text-ink text-sm">{kw.PrimaryKeyword}</p>
            <a
              href={kw.PageURL}
              target="_blank"
              rel="noreferrer"
              onClick={(e) => e.stopPropagation()}
              className="text-primary hover:underline text-sm font-mono"
            >
              {shortUrl}
            </a>
          </div>
          {kw.SearchIntent && (
            <Badge variant="green">{kw.SearchIntent.toUpperCase()}</Badge>
          )}
          {highCount > 0 && (
            <span className="flex items-center gap-1 text-xs font-semibold text-red-700 bg-red-50 border border-red-200 px-2 py-0.5 rounded-full whitespace-nowrap">
              {highCount} urgent action{highCount !== 1 ? 's' : ''}
            </span>
          )}
          <svg
            className={`w-4 h-4 text-muted transition-transform flex-shrink-0 ${open ? 'rotate-180' : ''}`}
            fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24"
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
          </svg>
        </div>

        {/* Top suggestion preview strip (collapsed only) */}
        {!open && topSuggestion && (
          <div className="mx-5 mb-3.5 flex items-start gap-2 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
            <svg className="w-3.5 h-3.5 text-amber-500 mt-0.5 flex-shrink-0" fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
            </svg>
            <p className="text-sm text-amber-800 leading-snug">
              <span className="font-semibold">Top action: </span>
              {topSuggestion.title}
              {topSuggestion.items && topSuggestion.items.length > 0 && (
                <span className="text-amber-700">
                  {' '}— {topSuggestion.items.slice(0, 3).join(', ')}
                  {topSuggestion.items.length > 3 ? ` +${topSuggestion.items.length - 3} more` : ''}
                </span>
              )}
            </p>
          </div>
        )}
      </button>

      {/* ── Expanded detail ── */}
      {open && (
        <div className="border-t border-border px-5 py-5">
          <div className="grid grid-cols-3 gap-6">

            {/* Left 2/3: Action Plan */}
            <div className="col-span-2 space-y-4">
              <p className="text-xs font-semibold text-muted uppercase tracking-wider">
                Action Plan — {suggestions.length} recommendation{suggestions.length !== 1 ? 's' : ''}
              </p>
              {suggestions.map((s, i) => (
                <KwSuggestionCard key={i} s={s} />
              ))}
            </div>

            {/* Right 1/3: All keyword lists */}
            <div className="space-y-4 pl-4 border-l border-border">
              <p className="text-xs font-semibold text-muted uppercase tracking-wider">All Keywords</p>
              <KwChips
                label="Secondary Keywords"
                items={kw.SecondaryKeywords}
                cls="bg-slate-100 text-slate-700 border-slate-200"
              />
              <KwChips
                label="Keyword Gaps"
                items={kw.KeywordGaps}
                cls="bg-amber-50 text-amber-800 border-amber-200"
              />
              <KwChips
                label="Missing LSI Terms"
                items={kw.MissingLSITerms}
                cls="bg-blue-50 text-blue-700 border-blue-200"
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Keywords Tab ─────────────────────────────────────────────────────────────

function KeywordsTab({ scanId }: { scanId: number }) {
  const [rows, setRows] = useState<PageKeyword[]>([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<Set<number>>(new Set());

  useEffect(() => {
    fetch(`/api/scans/${scanId}/keywords`)
      .then((r) => r.json())
      .then((d) => { setRows(d); setLoading(false); });
  }, [scanId]);

  const toggle = (id: number) => setExpanded((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const expandAll   = () => setExpanded(new Set(rows.map((r) => r.KeywordID)));
  const collapseAll = () => setExpanded(new Set());

  if (loading) return <Spinner />;
  if (rows.length === 0) return <Empty msg="No keyword data for this scan." />;

  const grouped = groupBy(rows, (r) => r.TreeCluster ?? 'Uncategorised');

  return (
    <div className="space-y-6">
      <ExpandToolbar
        total={rows.length}
        expandedCount={expanded.size}
        onExpandAll={expandAll}
        onCollapseAll={collapseAll}
      />
      {Object.entries(grouped).map(([tree, items]) => (
        <div key={tree} className="space-y-3">
          <div className="flex items-center gap-3">
            <Badge variant="purple">{tree}</Badge>
            <span className="text-muted text-sm">{items.length} page{items.length !== 1 ? 's' : ''}</span>
          </div>
          {items.map((kw) => (
            <KeywordCard
              key={kw.KeywordID}
              kw={kw}
              open={expanded.has(kw.KeywordID)}
              onToggle={() => toggle(kw.KeywordID)}
            />
          ))}
        </div>
      ))}
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
    setIssues((prev) => prev.map((i) => i.IssueID === id ? { ...i, Status: status as any, UserComment: comment } : i));
  };

  const toggle = (id: number) => setExpanded((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const expandAll = () => setExpanded(new Set(issues.map((i) => i.IssueID)));
  const collapseAll = () => setExpanded(new Set());

  if (loading) return <Spinner />;
  if (issues.length === 0) return <Empty msg="No cannibalization issues for this scan." />;

  const grouped = groupBy(issues, (i) => i.TreeCluster ?? 'Uncategorised');

  return (
    <div className="space-y-6">
      <ExpandToolbar
        total={issues.length}
        expandedCount={expanded.size}
        onExpandAll={expandAll}
        onCollapseAll={collapseAll}
      />

      {Object.entries(grouped).map(([tree, items]) => (
        <div key={tree} className="space-y-3">
          {/* Tree header */}
          <div className="flex items-center gap-3">
            <Badge variant="purple">{tree}</Badge>
            <span className="text-muted text-sm">{items.length} issue{items.length !== 1 ? 's' : ''}</span>
          </div>

          {items.map((issue) => {
            const open = expanded.has(issue.IssueID);
            const suggestion = issue.URL1_SuggestedFix || issue.URL2_SuggestedFix || issue.OverallRecommendation;

            return (
              <div key={issue.IssueID} className="bg-surface rounded-xl border border-border shadow-card overflow-hidden">

                {/* ── Collapsed header ── */}
                <button
                  onClick={() => toggle(issue.IssueID)}
                  className="w-full text-left hover:bg-surface2 transition-colors"
                >
                  {/* Top row */}
                  <div className="flex items-center gap-4 px-5 py-3.5">
                    <SeverityBadge severity={issue.Severity} />
                    <div className="flex-1 min-w-0">
                      <p className="font-semibold text-ink text-sm truncate">
                        {issue.CannibalKeyword ?? 'Keyword Cannibalization'}
                      </p>
                      <p className="text-muted text-sm mt-0.5 truncate">
                        {issue.URL1?.replace('https://www.boldpreciousmetals.com', '…')} ↔{' '}
                        {issue.URL2?.replace('https://www.boldpreciousmetals.com', '…')}
                      </p>
                    </div>
                    <StatusBadge status={issue.Status} />
                    <ActionedByChip name={issue.LastAuditedByName} at={issue.LastAuditedAt} />
                    <svg className={`w-4 h-4 text-muted transition-transform flex-shrink-0 ${open ? 'rotate-180' : ''}`}
                      fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                    </svg>
                  </div>

                  {/* Suggestion preview strip (always visible) */}
                  {!open && suggestion && (
                    <div className="mx-5 mb-3.5 flex items-start gap-2 bg-success-light border border-green-200 rounded-lg px-3 py-2">
                      <svg className="w-3.5 h-3.5 text-success mt-0.5 flex-shrink-0" fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
                      </svg>
                      <p className="text-sm text-green-800 font-medium leading-relaxed">
                        <span className="text-green-600 font-semibold">Suggestion: </span>
                        {trunc(suggestion, 160)}
                      </p>
                    </div>
                  )}
                </button>

                {/* ── Expanded detail ── */}
                {open && (
                  <div className="px-5 pb-5 border-t border-border space-y-4">
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
                            <span className="text-sm font-semibold text-muted uppercase">{side.label}</span>
                            {side.field && <Badge variant="gray">{side.field}</Badge>}
                          </div>
                          <div className="p-4 space-y-3">
                            {side.url && (
                              <a href={side.url} target="_blank" rel="noreferrer"
                                className="text-primary hover:underline text-sm font-mono break-all block">
                                {side.url}
                              </a>
                            )}
                            {side.current && (
                              <div>
                                <p className="text-sm font-semibold text-muted uppercase mb-1">Current</p>
                                <p className="text-sm text-ink-2 bg-surface2 rounded-lg p-3">{side.current}</p>
                              </div>
                            )}
                            {side.fix && (
                              <div>
                                <p className="text-sm font-semibold text-success uppercase mb-1">✦ Suggested Fix</p>
                                <p className="text-sm text-ink-2 bg-success-light border border-green-200 rounded-lg p-3 font-medium">{side.fix}</p>
                              </div>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>

                    {/* Recommendation + Reasoning */}
                    {(issue.OverallRecommendation || issue.Reasoning) && (
                      <div className="grid grid-cols-2 gap-4">
                        {issue.OverallRecommendation && (
                          <div className="rounded-xl border border-green-200 bg-success-light p-4">
                            <p className="text-sm font-semibold text-success uppercase mb-1.5">✦ Overall Recommendation</p>
                            <p className="text-sm text-ink-2">{issue.OverallRecommendation}</p>
                          </div>
                        )}
                        {issue.Reasoning && (
                          <div className="rounded-xl border border-border p-4">
                            <p className="text-sm font-semibold text-muted uppercase mb-1.5">Reasoning</p>
                            <p className="text-sm text-ink-2">{issue.Reasoning}</p>
                          </div>
                        )}
                      </div>
                    )}

                    {issue.LastAuditedByName && (
                      <p className="text-sm text-muted flex items-center gap-1.5">
                        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                        </svg>
                        Last actioned by <span className="font-semibold text-ink-2">{issue.LastAuditedByName}</span>
                        {issue.LastAuditedAt && <> on {fmtDate(issue.LastAuditedAt)}</>}
                        {issue.UserComment && <> · &ldquo;{issue.UserComment}&rdquo;</>}
                      </p>
                    )}
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

// ─── Filter pill row ──────────────────────────────────────────────────────────

function FilterPills<T extends string>({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: readonly T[];
  value: T;
  onChange: (v: T) => void;
}) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-sm font-semibold text-muted uppercase tracking-wide w-14 flex-shrink-0">{label}</span>
      <div className="flex gap-1 flex-wrap">
        {options.map((opt) => (
          <button
            key={opt}
            onClick={() => onChange(opt)}
            className={`text-sm px-2.5 py-1 rounded-full border font-medium transition-colors ${
              value === opt
                ? 'bg-primary text-white border-primary'
                : 'bg-surface text-muted border-border hover:border-primary/40 hover:text-ink'
            }`}
          >
            {opt}
          </button>
        ))}
      </div>
    </div>
  );
}

// ─── Content Improvements Tab ─────────────────────────────────────────────────

const PRIORITY_OPTIONS = ['All', 'High', 'Medium', 'Low'] as const;
const STATUS_OPTIONS   = ['All', 'Yet to Act', 'Acted', 'Deferred'] as const;
type PriorityFilter = typeof PRIORITY_OPTIONS[number];
type StatusFilter   = typeof STATUS_OPTIONS[number];

function ContentTab({ scanId }: { scanId: number }) {
  const [items, setItems] = useState<ContentImprovement[]>([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<Set<number>>(new Set());
  const [pushOpenId, setPushOpenId] = useState<number | null>(null);

  // ── Filter state ──
  const [filterPriority, setFilterPriority] = useState<PriorityFilter>('All');
  const [filterStatus,   setFilterStatus]   = useState<StatusFilter>('All');
  const [filterPage,     setFilterPage]     = useState<string>('All');

  useEffect(() => {
    fetch(`/api/scans/${scanId}/improvements`)
      .then((r) => r.json())
      .then((d) => { setItems(d); setLoading(false); });
  }, [scanId]);

  const updateItem = (id: number, status: string, comment: string) => {
    setItems((prev) => prev.map((i) => i.ImprovementID === id ? { ...i, Status: status as any, UserComment: comment } : i));
  };

  // ── Derived: unique pages for dropdown ──
  const uniquePages = Array.from(new Set(items.map((i) => i.PageURL ?? 'Unknown'))).sort();

  // ── Filtered items ──
  const filtered = items.filter((i) => {
    if (filterPriority !== 'All' && i.Priority !== filterPriority) return false;
    if (filterStatus   !== 'All' && i.Status   !== filterStatus)   return false;
    if (filterPage     !== 'All' && (i.PageURL ?? 'Unknown') !== filterPage) return false;
    return true;
  });

  const isFiltered = filterPriority !== 'All' || filterStatus !== 'All' || filterPage !== 'All';

  const clearFilters = () => {
    setFilterPriority('All');
    setFilterStatus('All');
    setFilterPage('All');
  };

  const toggle = (id: number) => setExpanded((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const expandAll  = () => setExpanded(new Set(filtered.map((i) => i.ImprovementID)));
  const collapseAll = () => setExpanded(new Set());

  if (loading) return <Spinner />;
  if (items.length === 0) return <Empty msg="No content improvements for this scan." />;

  const grouped = groupBy(filtered, (i) => i.PageURL ?? 'Unknown');

  return (
    <div className="space-y-5">

      {/* ── Filter bar ── */}
      <div className="bg-surface border border-border rounded-xl px-4 py-3.5 space-y-3">
        <FilterPills
          label="Priority"
          options={PRIORITY_OPTIONS}
          value={filterPriority}
          onChange={setFilterPriority}
        />
        <FilterPills
          label="Status"
          options={STATUS_OPTIONS}
          value={filterStatus}
          onChange={setFilterStatus}
        />

        {/* Page dropdown */}
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold text-muted uppercase tracking-wide w-14 flex-shrink-0">Page</span>
          <select
            value={filterPage}
            onChange={(e) => setFilterPage(e.target.value)}
            className="text-sm px-3 py-1.5 rounded-lg border border-border bg-canvas text-ink focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary max-w-sm"
          >
            <option value="All">All pages ({uniquePages.length})</option>
            {uniquePages.map((p) => (
              <option key={p} value={p}>
                {p.replace('https://www.boldpreciousmetals.com', '…')}
              </option>
            ))}
          </select>
        </div>

        {/* Result count + clear */}
        <div className="flex items-center justify-between pt-1 border-t border-border/60">
          <p className="text-sm text-muted">
            Showing <span className="font-semibold text-ink">{filtered.length}</span> of{' '}
            <span className="font-semibold">{items.length}</span> improvements
          </p>
          {isFiltered && (
            <button
              onClick={clearFilters}
              className="text-sm text-primary hover:text-blue-700 font-medium flex items-center gap-1"
            >
              <svg className="w-3 h-3" fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
              Clear filters
            </button>
          )}
        </div>
      </div>

      {filtered.length === 0 ? (
        <Empty msg="No improvements match the selected filters." />
      ) : (
        <>
      <ExpandToolbar
        total={filtered.length}
        expandedCount={expanded.size}
        onExpandAll={expandAll}
        onCollapseAll={collapseAll}
      />

      {Object.entries(grouped).map(([url, pageItems]) => (
        <div key={url} className="space-y-3">
          {/* Page URL header */}
          <div className="flex items-center gap-3">
            <a href={url} target="_blank" rel="noreferrer"
              className="text-primary hover:underline text-sm font-mono break-all">
              {url}
            </a>
            <span className="text-muted text-sm flex-shrink-0">
              {pageItems.length} improvement{pageItems.length !== 1 ? 's' : ''}
            </span>
          </div>

          {pageItems.map((item) => {
            const open = expanded.has(item.ImprovementID);

            return (
              <div key={item.ImprovementID} className="bg-surface rounded-xl border border-border shadow-card overflow-hidden">

                {/* ── Collapsed header ── */}
                <button
                  onClick={() => toggle(item.ImprovementID)}
                  className="w-full text-left hover:bg-surface2 transition-colors"
                >
                  {/* Top row */}
                  <div className="flex items-center gap-4 px-5 py-3.5">
                    <PriorityBadge priority={item.Priority} />
                    <div className="flex-1 min-w-0">
                      <p className="font-semibold text-ink text-sm">
                        {item.FieldName ?? 'Content Field'}
                        {item.IssueType && (
                          <span className="ml-2 text-muted text-sm font-normal">· {item.IssueType}</span>
                        )}
                      </p>
                      {/* Current content preview */}
                      {!open && item.CurrentContent && (
                        <p className="text-muted text-sm mt-0.5 truncate">
                          Current: {trunc(item.CurrentContent, 100)}
                        </p>
                      )}
                    </div>
                    <StatusBadge status={item.Status} />
                    <ActionedByChip name={item.LastAuditedByName} at={item.LastAuditedAt} />
                    <svg className={`w-4 h-4 text-muted transition-transform flex-shrink-0 ${open ? 'rotate-180' : ''}`}
                      fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                    </svg>
                  </div>

                  {/* Suggestion preview strip (always visible when collapsed) */}
                  {!open && item.SuggestedContent && (
                    <div className="mx-5 mb-3.5 rounded-lg border border-green-200 bg-success-light overflow-hidden">
                      <div className="px-3 py-1.5 bg-green-100 border-b border-green-200 flex items-center gap-1.5">
                        <svg className="w-3.5 h-3.5 text-success" fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                        </svg>
                        <span className="text-sm font-semibold text-success uppercase tracking-wide">Suggested Content</span>
                        {item.SuggestedCharCount && (
                          <span className="ml-auto text-sm text-green-600 font-mono">{item.SuggestedCharCount} chars</span>
                        )}
                      </div>
                      <p className="px-3 py-2 text-sm text-green-900 leading-relaxed">
                        {trunc(item.SuggestedContent, 200)}
                      </p>
                    </div>
                  )}
                </button>

                {/* ── Expanded detail ── */}
                {open && (
                  <div className="px-5 pb-5 border-t border-border space-y-4 mt-1">
                    {/* Side-by-side diff */}
                    <div className="grid grid-cols-2 gap-4 mt-4">
                      {/* Current */}
                      <div className="rounded-xl border border-border overflow-hidden">
                        <div className="px-4 py-2 bg-surface2 border-b border-border flex items-center justify-between">
                          <p className="text-sm font-semibold text-muted uppercase">Current</p>
                          {item.CurrentCharCount !== null && (
                            <span className="text-sm text-muted font-mono">{item.CurrentCharCount} chars</span>
                          )}
                        </div>
                        <div className="p-4">
                          <p className="text-sm text-ink-2 whitespace-pre-wrap leading-relaxed">{item.CurrentContent || '—'}</p>
                        </div>
                      </div>
                      {/* Suggested */}
                      <div className="rounded-xl border border-green-200 overflow-hidden">
                        <div className="px-4 py-2 bg-green-100 border-b border-green-200 flex items-center justify-between">
                          <p className="text-sm font-semibold text-success uppercase">✦ Suggested</p>
                          <div className="flex items-center gap-2">
                            {item.SuggestedCharCount !== null && (
                              <span className="text-sm text-green-600 font-mono">{item.SuggestedCharCount} chars</span>
                            )}
                            {item.SuggestedContent && (
                              <button
                                onClick={(e) => { e.stopPropagation(); setPushOpenId(pushOpenId === item.ImprovementID ? null : item.ImprovementID); }}
                                className="flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1 rounded-md bg-primary hover:bg-blue-600 text-white transition-colors"
                                title="Push this suggestion to the database"
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

                    {/* Push-to-DB panel */}
                    {pushOpenId === item.ImprovementID && (
                      <PushToDbPanel
                        item={item}
                        onDismiss={() => setPushOpenId(null)}
                      />
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

                    {item.LastAuditedByName && (
                      <p className="text-sm text-muted flex items-center gap-1.5">
                        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                        </svg>
                        Last actioned by <span className="font-semibold text-ink-2">{item.LastAuditedByName}</span>
                        {item.LastAuditedAt && <> on {fmtDate(item.LastAuditedAt)}</>}
                        {item.UserComment && <> · &ldquo;{item.UserComment}&rdquo;</>}
                      </p>
                    )}
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
        </>
      )}
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

  const toggle = (id: number) => setExpanded((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });

  if (loading) return <Spinner />;
  if (calls.length === 0) return <Empty msg="No Claude API calls logged for this scan." />;

  return (
    <div className="overflow-x-auto rounded-xl border border-border">
      <table className="w-full text-sm">
        <thead>
          <tr className="bg-surface2 border-b border-border">
            <th className="text-left px-4 py-3 text-muted font-medium">Type</th>
            <th className="text-left px-4 py-3 text-muted font-medium">Entity / URL</th>
            <th className="text-center px-4 py-3 text-muted font-medium">OK</th>
            <th className="text-right px-4 py-3 text-muted font-medium">Duration</th>
            <th className="text-right px-4 py-3 text-muted font-medium">In tokens</th>
            <th className="text-right px-4 py-3 text-muted font-medium">Out tokens</th>
            <th className="text-right px-4 py-3 text-muted font-medium">Cost</th>
            <th className="text-left px-4 py-3 text-muted font-medium">Called At</th>
            <th className="px-4 py-3" />
          </tr>
        </thead>
        <tbody>
          {calls.map((call) => {
            const open = expanded.has(call.CallID);
            return (
              <>
                <tr key={call.CallID}
                  className="border-b border-border/50 hover:bg-surface2 cursor-pointer transition-colors"
                  onClick={() => toggle(call.CallID)}>
                  <td className="px-4 py-3"><CallTypeBadge type={call.CallType} /></td>
                  <td className="px-4 py-3 max-w-[280px]">
                    <span className="text-sm font-mono text-ink-2 break-all">
                      {call.EntityURL?.replace('https://www.boldpreciousmetals.com', '…')}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-center">
                    {call.CallSucceeded
                      ? <span className="text-success font-bold">✓</span>
                      : <span className="text-danger font-bold">✗</span>}
                  </td>
                  <td className="px-4 py-3 text-right font-mono text-sm">{call.DurationMs ? `${(call.DurationMs/1000).toFixed(1)}s` : '—'}</td>
                  <td className="px-4 py-3 text-right font-mono text-sm">
                    {call.InputTokens != null ? call.InputTokens.toLocaleString() : (call.InputCharsEstimate != null ? `~${Math.round(call.InputCharsEstimate/4).toLocaleString()}` : '—')}
                  </td>
                  <td className="px-4 py-3 text-right font-mono text-sm">
                    {call.OutputTokens != null ? call.OutputTokens.toLocaleString() : (call.OutputCharsEstimate != null ? `~${Math.round(call.OutputCharsEstimate/4).toLocaleString()}` : '—')}
                  </td>
                  <td className="px-4 py-3 text-right font-mono text-sm font-semibold text-primary">
                    {call.CostUSD != null ? `$${call.CostUSD.toFixed(4)}` : '—'}
                  </td>
                  <td className="px-4 py-3 text-sm text-muted">{fmtDate(call.CalledAt)}</td>
                  <td className="px-4 py-3 text-right">
                    <svg className={`w-4 h-4 text-muted inline transition-transform ${open ? 'rotate-180' : ''}`}
                      fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                    </svg>
                  </td>
                </tr>
                {open && (
                  <tr key={`${call.CallID}-expand`} className="border-b border-border">
                    <td colSpan={9} className="px-4 py-4 bg-surface2">
                      {call.ErrorMessage && (
                        <div className="mb-4 p-3 bg-danger-light border border-red-200 rounded-xl text-sm text-danger">
                          <strong>Error:</strong> {call.ErrorMessage}
                        </div>
                      )}
                      <div className="space-y-3">
                        {[
                          { label: 'System Prompt', val: call.SystemPrompt },
                          { label: 'User Message', val: call.UserMessage },
                          { label: 'Raw Response', val: call.RawResponse },
                        ].map(({ label, val }) => val && (
                          <div key={label}>
                            <p className="text-sm font-semibold text-muted uppercase mb-1">{label}</p>
                            <pre className="text-sm text-ink-2 bg-surface border border-border rounded-lg p-3 overflow-x-auto whitespace-pre-wrap max-h-64 font-mono">
                              {val}
                            </pre>
                          </div>
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

// ─── Shared ───────────────────────────────────────────────────────────────────

function Spinner() {
  return (
    <div className="flex items-center justify-center h-48">
      <div className="w-8 h-8 border-4 border-primary border-t-transparent rounded-full animate-spin" />
    </div>
  );
}

function Empty({ msg }: { msg: string }) {
  return <div className="flex flex-col items-center justify-center h-48 text-muted text-sm">{msg}</div>;
}

// ─── Main page ────────────────────────────────────────────────────────────────

const TABS: { id: Tab; label: string; countKey?: string }[] = [
  { id: 'keywords',        label: 'Keywords',      countKey: 'KeywordCount' },
  { id: 'cannibalization', label: 'Cannibalization',countKey: 'CannibalizationCount' },
  { id: 'content',         label: 'Content',        countKey: 'ImprovementCount' },
  { id: 'calls',           label: 'Claude Calls',   countKey: 'CallCount' },
];

// ─── Countdown ring ───────────────────────────────────────────────────────────

const POLL_INTERVAL = 10; // seconds

function CountdownRing({ seconds, total }: { seconds: number; total: number }) {
  const r             = 9;
  const circumference = 2 * Math.PI * r;          // ≈ 56.55
  const dashoffset    = circumference * (1 - seconds / total);

  return (
    <svg width="22" height="22" viewBox="0 0 24 24" aria-label={`Refreshing in ${seconds}s`}>
      {/* faded background track */}
      <circle
        cx="12" cy="12" r={r}
        fill="none"
        stroke="currentColor"
        strokeWidth="2.5"
        strokeOpacity="0.2"
      />
      {/* shrinking progress arc — anchored at top (-90°) */}
      <circle
        cx="12" cy="12" r={r}
        fill="none"
        stroke="currentColor"
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeDasharray={circumference}
        strokeDashoffset={dashoffset}
        transform="rotate(-90 12 12)"
        style={{ transition: 'stroke-dashoffset 0.9s linear' }}
      />
      {/* countdown number */}
      <text
        x="12" y="12"
        textAnchor="middle"
        dominantBaseline="central"
        fill="currentColor"
        style={{ fontSize: '8px', fontWeight: 700, fontFamily: 'inherit' }}
      >
        {seconds}
      </text>
    </svg>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function ScanDetailPage() {
  const params = useParams();
  const scanId = parseInt(params.id as string);

  const [scan, setScan]         = useState<any>(null);
  const [loading, setLoading]   = useState(true);
  const [activeTab, setActiveTab] = useState<Tab>('keywords');
  const [countdown, setCountdown] = useState(POLL_INTERVAL);
  const pollingRef    = useRef<ReturnType<typeof setTimeout>  | null>(null);
  const countdownRef  = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchScan = () =>
    fetch(`/api/scans/${scanId}`)
      .then((r) => r.json())
      .then((d) => { setScan(d); setLoading(false); });

  useEffect(() => { fetchScan(); }, [scanId]);

  useEffect(() => {
    if (scan?.Status === 'Running') {
      // Reset visual countdown
      setCountdown(POLL_INTERVAL);

      // Tick every second for the ring animation
      if (countdownRef.current) clearInterval(countdownRef.current);
      countdownRef.current = setInterval(() => {
        setCountdown((prev) => Math.max(0, prev - 1));
      }, 1000);

      // Actual data refresh after full interval
      pollingRef.current = setTimeout(() => { fetchScan(); }, POLL_INTERVAL * 1000);
    }
    return () => {
      if (pollingRef.current)   clearTimeout(pollingRef.current);
      if (countdownRef.current) clearInterval(countdownRef.current);
    };
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

      {/* Failed banner — fatal error, scan did not complete */}
      {scan.Status === 'Failed' && (
        <div className="rounded-2xl border border-red-200 bg-danger-light overflow-hidden">
          <div className="flex items-center gap-3 px-5 py-4 border-b border-red-200">
            <svg className="w-5 h-5 text-danger flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
              <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" />
            </svg>
            <p className="text-sm font-semibold text-danger">
              This scan failed. See the error details below.
            </p>
          </div>
          {scan.ErrorLog && (
            <pre className="px-5 py-4 text-xs text-danger/80 font-mono whitespace-pre-wrap overflow-x-auto max-h-60 leading-relaxed">
              {scan.ErrorLog.trim()}
            </pre>
          )}
        </div>
      )}

      {/* Warning banner — scan completed but some analyses had errors (e.g. AI API failures) */}
      {scan.Status !== 'Failed' && scan.ErrorLog && (
        <div className="rounded-2xl border border-amber-200 bg-amber-50 overflow-hidden">
          <div className="flex items-center gap-3 px-5 py-4 border-b border-amber-200">
            <svg className="w-5 h-5 text-amber-600 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
              <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
            </svg>
            <div>
              <p className="text-sm font-semibold text-amber-700">
                Some analyses encountered errors during this scan.
              </p>
              <p className="text-sm text-amber-600 mt-0.5">
                Check your AI provider API key in <a href="/settings" className="underline hover:text-amber-800">Settings</a> if you see API-related errors below.
              </p>
            </div>
          </div>
          <pre className="px-5 py-4 text-xs text-amber-800 font-mono whitespace-pre-wrap overflow-x-auto max-h-60 leading-relaxed">
            {scan.ErrorLog.trim()}
          </pre>
        </div>
      )}

      {/* Metadata card */}
      <div className="bg-surface rounded-2xl border border-border shadow-card p-6">
        <div className="flex items-center gap-3 flex-wrap">
          <h1 className="text-xl font-bold font-display text-ink">{scan.ScanName}</h1>
          <ScanStatusBadge status={scan.Status} />
          {scan.Status === 'Running' && (
            <span className="flex items-center gap-1.5 text-sm text-blue-600">
              <CountdownRing seconds={countdown} total={POLL_INTERVAL} />
              Refreshing in {countdown}s
            </span>
          )}
          <span className="text-muted text-sm ml-1">#{scan.ScanID}</span>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-6 mt-6 pt-6 border-t border-border">
          <MetaField label="Started"       value={fmtDate(scan.StartedAt)} />
          <MetaField label="Completed"     value={fmtDate(scan.EndedAt)} />
          <MetaField label="URLs Scraped"  value={scan.URLsScraped ?? '—'} />
          <MetaField label="Trees"         value={scan.TreesAnalysed ?? '—'} />
          <MetaField label="Cannib. Prompt"
            value={scan.CannibalizationPromptLabel ? `v${scan.CannibalizationPromptVersion} · ${scan.CannibalizationPromptLabel}` : '—'} />
          <MetaField label="Content Prompt"
            value={scan.ContentPromptLabel ? `v${scan.ContentPromptVersion} · ${scan.ContentPromptLabel}` : '—'} />
          {/* API cost — only show when we have data */}
          {(scan.TotalCostUSD != null && scan.TotalCostUSD > 0) && (
            <div className="col-span-2 md:col-span-2 flex items-center gap-3 px-4 py-3 bg-primary/5 border border-primary/20 rounded-xl">
              <svg className="w-4 h-4 text-primary flex-shrink-0" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              <div>
                <p className="text-xs font-semibold text-muted uppercase tracking-wide">Total API Cost</p>
                <p className="text-sm font-bold text-primary mt-0.5">${scan.TotalCostUSD.toFixed(4)}</p>
              </div>
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
              <button key={tab.id} onClick={() => setActiveTab(tab.id)}
                className={`px-5 py-3 text-sm font-medium border-b-2 transition-colors flex items-center gap-2 ${
                  activeTab === tab.id
                    ? 'border-primary text-primary'
                    : 'border-transparent text-muted hover:text-ink hover:border-border-strong'
                }`}>
                {tab.label}
                {count !== null && count !== undefined && (
                  <span className={`text-sm px-1.5 py-0.5 rounded-full font-semibold ${
                    activeTab === tab.id ? 'bg-primary-light text-primary' : 'bg-muted-light text-muted'
                  }`}>{count}</span>
                )}
              </button>
            );
          })}
        </div>
      </div>

      {/* Tab content */}
      <div>
        {activeTab === 'keywords'        && <KeywordsTab      scanId={scanId} />}
        {activeTab === 'cannibalization' && <CannibalizationTab scanId={scanId} />}
        {activeTab === 'content'         && <ContentTab        scanId={scanId} />}
        {activeTab === 'calls'           && <CallsTab          scanId={scanId} />}
      </div>
    </div>
  );
}

function MetaField({ label, value }: { label: string; value: string | number | null }) {
  return (
    <div>
      <p className="text-sm font-semibold text-muted uppercase tracking-wide">{label}</p>
      <p className="text-sm text-ink mt-0.5 font-mono">{value ?? '—'}</p>
    </div>
  );
}
