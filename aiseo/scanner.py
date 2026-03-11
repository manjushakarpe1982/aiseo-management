"""
Step 4 — run_scan(scan_name, user_id, limit, url_filters)

Full pipeline:
  Phase 1   Scan initialisation
  Phase 2   Scraping (per URL, with resume support)
  Phase 3   Tree clustering
  Phase 4a  Claude — Keyword Extraction (per page)
  Phase 4b  Claude — Cannibalization (per tree, using keyword map from 4a)
  Phase 4c  Claude — Content Improvement (per page, with keyword context from 4a)
  Phase 5   Completion
"""

from __future__ import annotations

import html as html_lib
import json
import re
import time
import traceback
from datetime import datetime
from urllib.parse import urlparse

import anthropic
from google import genai as google_genai
from google.genai import types as genai_types
from playwright.sync_api import sync_playwright

from .config import (
    ANTHROPIC_API_KEY,
    CLAUDE_MODEL,
    GEMINI_API_KEY,
    GEMINI_MODEL,
    MAX_INPUT_CHARS,
    MAX_INPUT_TOKENS,
    TP,
    URL_SOURCE_COLUMN,
    URL_SOURCE_TABLE,
    get_model_pricing,
    get_model_cache_pricing,
    get_gemini_pricing,
    get_gemini_cache_read_pricing,
)
from .db import get_connection

# ── Prompt-size guard ─────────────────────────────────────────────────────────

class PromptTooLargeError(Exception):
    """
    Raised (and logged to ClCode_ClaudeCallLog) when the combined prompt
    exceeds MAX_INPUT_TOKENS before making the Claude API call.
    """
    def __init__(self, total_chars: int, tokens_estimate: int):
        self.total_chars    = total_chars
        self.tokens_estimate = tokens_estimate
        super().__init__(
            f"Prompt too large: {total_chars:,} chars "
            f"(~{tokens_estimate:,} tokens, limit {MAX_INPUT_TOKENS:,})"
        )


# ── API clients (lazy — initialised at the start of each run_scan call) ───

_claude: anthropic.Anthropic | None = None
_gemini: google_genai.Client | None = None

# Gemini context-cache registry: sha256[:16] of system_prompt → cache resource name.
# None means "caching attempted but failed" — falls back to uncached call.
_gemini_caches: dict = {}


def _get_setting(conn, key: str, fallback: str = "") -> str:
    """
    Read a value from ClCode_Settings.
    Returns *fallback* if the row does not exist or the stored value is empty.
    """
    try:
        cursor = conn.cursor()
        cursor.execute(
            f"SELECT SettingValue FROM {TP}Settings WHERE SettingKey = ?", (key,)
        )
        row = cursor.fetchone()
        if row and row[0]:
            return row[0]
    except Exception:
        pass  # Table may not exist yet on first run — fall through to fallback
    return fallback


def _init_claude_client(conn) -> None:
    """
    Resolve the Anthropic API key (DB setting → env-var fallback) and
    create the module-level _claude client.
    Raises RuntimeError if no key is available.
    """
    global _claude
    api_key = _get_setting(conn, "ANTHROPIC_API_KEY", fallback=ANTHROPIC_API_KEY)
    if not api_key:
        raise RuntimeError(
            "ANTHROPIC_API_KEY is not configured.\n"
            "Set it via the web UI (Settings page) or with:\n"
            "  export ANTHROPIC_API_KEY='sk-ant-...'"
        )
    _claude = anthropic.Anthropic(api_key=api_key)
    masked = f"...{api_key[-6:]}" if len(api_key) > 6 else "***"
    print(f"  Claude client initialised  (key: {masked})")


def _call_claude(system_prompt: str, user_message: str, max_tokens: int = 8192) -> tuple:
    """
    Raw Claude API call with prompt caching + rate-limit retry. 3 s sleep after each call.

    The system prompt is always sent with cache_control so Anthropic caches it
    server-side.  On the first call the content is written to cache (costs +25 %
    of normal input price); every subsequent call within the 5-minute cache window
    reads from cache (costs only 10 % of normal input price).

    max_tokens: cap on output tokens. Increase for phases that produce large JSON
                (e.g. ContentImprovement / Cannibalization). Default: 8192.

    Returns (text, input_tokens, output_tokens, cache_write_tokens, cache_read_tokens).
    """
    for attempt in range(3):
        try:
            response = _claude.messages.create(
                model=CLAUDE_MODEL,
                max_tokens=max_tokens,
                system=[
                    {
                        "type": "text",
                        "text": system_prompt,
                        "cache_control": {"type": "ephemeral"},
                    }
                ],
                messages=[{"role": "user", "content": user_message}],
            )
            time.sleep(3)   # stay within 30k tokens/min rate limit
            usage       = response.usage
            in_tok      = getattr(usage, "input_tokens",                  0) or 0
            out_tok     = getattr(usage, "output_tokens",                 0) or 0
            cache_write = getattr(usage, "cache_creation_input_tokens",   0) or 0
            cache_read  = getattr(usage, "cache_read_input_tokens",       0) or 0
            stop_reason = getattr(response, "stop_reason", None)
            if stop_reason == "max_tokens":
                print(
                    f"    WARNING: Claude response hit max_tokens limit ({max_tokens})"
                    f" -- output was truncated. Consider increasing max_tokens."
                )
            return response.content[0].text, in_tok, out_tok, cache_write, cache_read
        except Exception as exc:
            if "rate_limit" in str(exc).lower() and attempt < 2:
                wait = 30 * (attempt + 1)   # 30s then 60s
                print(f"    Rate limit hit — waiting {wait}s before retry...")
                time.sleep(wait)
            else:
                raise
    raise RuntimeError("Claude API failed after 3 attempts")


def _init_gemini_client(conn) -> None:
    """
    Resolve the Google Gemini API key (DB setting → env-var fallback) and
    create the module-level _gemini client.
    Raises RuntimeError if no key is available.
    """
    global _gemini
    api_key = _get_setting(conn, "GEMINI_API_KEY", fallback=GEMINI_API_KEY)
    if not api_key:
        raise RuntimeError(
            "GEMINI_API_KEY is not configured.\n"
            "Set it via the web UI (Settings page) or with:\n"
            "  export GEMINI_API_KEY='AIzaSy...'"
        )
    _gemini = google_genai.Client(api_key=api_key)
    masked = f"...{api_key[-6:]}" if len(api_key) > 6 else "***"
    print(f"  Gemini client initialised  (key: {masked})")


def _get_gemini_cache_name(system_prompt: str) -> str | None:
    """
    Return a Gemini Context Cache resource name for the given system prompt,
    creating it on first use.  Returns None if caching is unavailable or the
    prompt is below the minimum token threshold — the caller falls back to an
    uncached request in that case.

    Cache TTL is set to 1 hour, which comfortably covers a full scan run.
    """
    import hashlib
    key = hashlib.sha256(system_prompt.encode()).hexdigest()[:16]

    if key in _gemini_caches:
        return _gemini_caches[key]   # may be None (previous attempt failed)

    try:
        cache = _gemini.caches.create(
            model=GEMINI_MODEL,
            config=genai_types.CreateCachedContentConfig(
                system_instruction=system_prompt,
                ttl="3600s",
            ),
        )
        _gemini_caches[key] = cache.name
        print(f"  Gemini context cache created: {cache.name}")
        return cache.name
    except Exception as exc:
        # Common reasons: prompt below minimum token count (1 024 for Flash),
        # or Context Caching not enabled on the account.
        print(f"  Gemini context caching unavailable ({exc}) — using uncached calls.")
        _gemini_caches[key] = None
        return None


def _call_gemini(system_prompt: str, user_message: str) -> tuple:
    """
    Raw Gemini API call using Context Caching for the system prompt.

    On the first call for a given system prompt, the prompt is uploaded to
    Gemini's cache (1-hour TTL).  Every subsequent call within that window
    reads from cache at ~75 % lower cost.  If caching is unavailable the call
    falls back gracefully to a standard uncached request.

    Returns (text, input_tokens, output_tokens, cache_write_tokens, cache_read_tokens).
    """
    cache_name = _get_gemini_cache_name(system_prompt)

    for attempt in range(3):
        try:
            if cache_name:
                response = _gemini.models.generate_content(
                    model=GEMINI_MODEL,
                    contents=user_message,
                    config=genai_types.GenerateContentConfig(
                        cached_content=cache_name,
                    ),
                )
            else:
                response = _gemini.models.generate_content(
                    model=GEMINI_MODEL,
                    contents=user_message,
                    config=genai_types.GenerateContentConfig(
                        system_instruction=system_prompt,
                    ),
                )
            time.sleep(3)
            usage      = response.usage_metadata
            in_tok     = getattr(usage, "prompt_token_count",          0) or 0
            out_tok    = getattr(usage, "candidates_token_count",      0) or 0
            cache_read = getattr(usage, "cached_content_token_count",  0) or 0
            return response.text, in_tok, out_tok, 0, cache_read
        except Exception as exc:
            exc_str = str(exc).lower()
            # If the cached content was deleted / expired, invalidate and retry
            if cache_name and ("not found" in exc_str or "cache" in exc_str):
                import hashlib
                key = hashlib.sha256(system_prompt.encode()).hexdigest()[:16]
                _gemini_caches[key] = None
                cache_name = None
                print(f"    Gemini cache expired/invalid — retrying without cache")
                continue
            if ("quota" in exc_str or "rate" in exc_str) and attempt < 2:
                wait = 30 * (attempt + 1)
                print(f"    Rate limit hit — waiting {wait}s before retry...")
                time.sleep(wait)
            else:
                raise
    raise RuntimeError("Gemini API failed after 3 attempts")


def _call_claude_logged(conn, scan_id: int, call_type: str, entity_url: str,
                        system_prompt: str, user_message: str,
                        provider: str = "claude",
                        max_tokens: int = 8192) -> str:
    """
    Wrap _call_claude and persist the full input/output to ClCode_ClaudeCallLog.

    call_type: "KeywordExtraction" | "Cannibalization" | "ContentImprovement"
    entity_url: page URL (4a/4c) or tree cluster name (4b)
    max_tokens: forwarded to _call_claude. Use higher values for phases that
                produce large JSON output (ContentImprovement, Cannibalization).

    Raises PromptTooLargeError (already logged) if prompt exceeds MAX_INPUT_TOKENS.
    Always re-raises any other exception so the caller can handle it.
    """
    total_chars     = len(system_prompt) + len(user_message)
    tokens_estimate = total_chars // 4   # 4 chars ≈ 1 token

    # ── Size guard: skip before touching the API ──────────────────────────
    if tokens_estimate > MAX_INPUT_TOKENS:
        err = PromptTooLargeError(total_chars, tokens_estimate)
        print(f"    SKIPPED — {err}")
        try:
            cursor = conn.cursor()
            cursor.execute(
                f"""
                INSERT INTO {TP}ClaudeCallLog
                    (ScanID, CallType, EntityURL, SystemPrompt, UserMessage,
                     RawResponse, CallSucceeded, InputCharsEstimate,
                     OutputCharsEstimate, InputTokens, OutputTokens, CostUSD,
                     CalledAt, DurationMs, ErrorMessage)
                VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
                """,
                (
                    scan_id, call_type, entity_url,
                    system_prompt[:4000],   # store enough to be diagnostic
                    user_message[:4000],
                    None,                   # no response
                    0,                      # CallSucceeded = false
                    total_chars,
                    0,
                    0, 0, 0.0,
                    datetime.utcnow(),
                    0,
                    f"SKIPPED: prompt too large — {total_chars:,} chars "
                    f"(~{tokens_estimate:,} tokens). "
                    f"Limit is {MAX_INPUT_TOKENS:,} tokens.",
                ),
            )
            conn.commit()
        except Exception as log_exc:
            print(f"    WARNING: Failed to log skipped call: {log_exc}")
        raise err

    # ── Normal path ───────────────────────────────────────────────────────
    called_at   = datetime.utcnow()
    t0          = time.time()
    raw         = None
    in_tok      = 0
    out_tok     = 0
    cache_write = 0
    cache_read  = 0
    succeeded   = False
    error_msg   = None

    try:
        if provider == "gemini":
            raw, in_tok, out_tok, cache_write, cache_read = _call_gemini(system_prompt, user_message)
        else:
            raw, in_tok, out_tok, cache_write, cache_read = _call_claude(system_prompt, user_message, max_tokens=max_tokens)
        succeeded = True

        if provider == "gemini":
            in_price, out_price = get_gemini_pricing(GEMINI_MODEL)
            cr_price = get_gemini_cache_read_pricing(GEMINI_MODEL)
            non_cached = in_tok - cache_read
            cost = (
                non_cached * in_price
                + cache_read * cr_price
                + out_tok * out_price
            ) / 1_000_000
        else:
            in_price, out_price = get_model_pricing(CLAUDE_MODEL)
            cw_price, cr_price  = get_model_cache_pricing(CLAUDE_MODEL)
            cost = (
                in_tok      * in_price
                + out_tok   * out_price
                + cache_write * cw_price
                + cache_read  * cr_price
            ) / 1_000_000
        cache_label = (
            f"  cache_write={cache_write:,}" if cache_write else
            f"  cache_read={cache_read:,}"   if cache_read  else
            ""
        )
        truncated = provider == "claude" and out_tok >= max_tokens
        trunc_label = "  [TRUNCATED]" if truncated else ""
        print(f"    [{provider}] tokens in={in_tok:,}  out={out_tok:,}{cache_label}  cost=${cost:.5f}{trunc_label}")
        return raw
    except Exception as exc:
        error_msg = str(exc)[:2000]
        raise
    finally:
        duration_ms = int((time.time() - t0) * 1000)
        if provider == "gemini":
            in_price, out_price = get_gemini_pricing(GEMINI_MODEL)
            cr_price = get_gemini_cache_read_pricing(GEMINI_MODEL)
            non_cached = in_tok - cache_read
            cost_usd = (
                non_cached * in_price
                + cache_read * cr_price
                + out_tok * out_price
            ) / 1_000_000
            cw_price = 0.0
        else:
            in_price, out_price = get_model_pricing(CLAUDE_MODEL)
            cw_price, cr_price  = get_model_cache_pricing(CLAUDE_MODEL)
            cost_usd = (
                in_tok      * in_price
                + out_tok   * out_price
                + cache_write * cw_price
                + cache_read  * cr_price
            ) / 1_000_000
        try:
            cursor = conn.cursor()
            cursor.execute(
                f"""
                INSERT INTO {TP}ClaudeCallLog
                    (ScanID, CallType, EntityURL, SystemPrompt, UserMessage,
                     RawResponse, CallSucceeded, InputCharsEstimate,
                     OutputCharsEstimate, InputTokens, OutputTokens,
                     CacheWriteTokens, CacheReadTokens,
                     CostUSD, CalledAt, DurationMs, ErrorMessage)
                VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
                """,
                (
                    scan_id, call_type, entity_url,
                    system_prompt, user_message,
                    raw,
                    1 if succeeded else 0,
                    total_chars,
                    len(raw) if raw else 0,
                    in_tok,
                    out_tok,
                    cache_write,
                    cache_read,
                    round(cost_usd, 6),
                    called_at,
                    duration_ms,
                    error_msg,
                ),
            )
            conn.commit()
        except Exception as log_exc:
            print(f"    WARNING: Failed to log Claude call to DB: {log_exc}")


# ── Tree clustering ───────────────────────────────────────────────────────

def _get_tree_cluster(url: str) -> str:
    """Derive tree cluster from the 2nd URL path segment.

    /silver-bullion/silver-bars/1-oz  → silver-bars
    /silver-bullion/silver-bars       → silver-bars
    /silver-bullion                   → silver-bullion
    """
    path  = urlparse(url).path.strip("/")
    parts = [p for p in path.split("/") if p]
    if len(parts) >= 2:
        return parts[1]
    if len(parts) == 1:
        return parts[0]
    return "root"


# ── BPM URL routing constants ──────────────────────────────────────────────

_METAL_SLUGS: list[tuple[str, str]] = [
    ('silver',    'Silver'),
    ('gold',      'Gold'),
    ('platinum',  'Platinum'),
    ('palladium', 'Palladium'),
]

_PT_SLUGS: list[tuple[str, str]] = [
    ('coins',  'Coins'),
    ('bars',   'Bars'),
    ('rounds', 'Rounds'),
    ('junk',   'Junk Silver'),
]


# ── DB-first SEO helpers ──────────────────────────────────────────────────

def _strip_html(html_text: str) -> str:
    """Strip HTML tags and decode common entities to get plain text."""
    text = re.sub(r'<[^>]+>', '', html_text)
    text = html_lib.unescape(text)
    text = re.sub(r'\s{2,}', ' ', text)
    return text.strip()


def _extract_html_headings(html_text: str, tag: str) -> list:
    """Extract plain-text content of all <tag> elements in an HTML string."""
    pattern = rf'<{tag}[^>]*>([\s\S]*?)</{tag}>'
    return [
        _strip_html(m).strip()
        for m in re.findall(pattern, html_text, re.IGNORECASE)
        if _strip_html(m).strip()
    ]


def _fill_template(tpl: str, metal: str = '', product_type: str = '') -> str:
    """Resolve {year}, {metal}, {product type} placeholders in a template string."""
    if not tpl:
        return ''
    year   = str(datetime.utcnow().year)
    result = re.sub(r'\{year\}',         year,         tpl,    flags=re.IGNORECASE)
    result = re.sub(r'\{metal\}',        metal,        result, flags=re.IGNORECASE)
    result = re.sub(r'\{product type\}', product_type, result, flags=re.IGNORECASE)
    result = re.sub(r'\{ProductType\}',  product_type, result, flags=re.IGNORECASE)
    result = re.sub(r'\{Product type\}', product_type, result, flags=re.IGNORECASE)
    result = re.sub(r'\s{2,}', ' ', result)
    return result.strip()


def _load_fp_map(conn) -> dict:
    """
    Pre-load FilterPages_SEOData into a dict keyed by SearchBy.lower().
    Call once before the Phase 2 scraping loop.
    """
    cursor = conn.cursor()
    cursor.execute(
        "SELECT SearchBy, MetaTitle, MetaDescription "
        "FROM FilterPages_SEOData WHERE IsActive = 1"
    )
    fp_map: dict = {}
    for row in cursor.fetchall():
        if row[0]:
            fp_map[row[0].lower().strip()] = {
                'MetaTitle':       row[1] or '',
                'MetaDescription': row[2] or '',
            }
    return fp_map


def _parse_url_segments(url: str) -> dict | None:
    """
    Parse a BPM page URL into its SEO routing components.
    Returns None if the URL doesn't look like a BPM product/metal page.
    """
    try:
        pathname = urlparse(url).path.lower().strip('/')
    except Exception:
        return None
    parts = [p for p in pathname.split('/') if p]
    if not parts:
        return None

    metal = ''
    for slug, m in _METAL_SLUGS:
        if slug in parts[0]:
            metal = m
            break
    if not metal:
        return None

    product_type = ''
    if len(parts) >= 2:
        for slug, pt in _PT_SLUGS:
            if slug in parts[1]:
                product_type = pt
                break

    last_seg = parts[-1] if parts else ''

    if len(parts) == 1:
        search_by = 'metal'
    elif len(parts) == 2:
        search_by = 'metalandproducttypes'
    else:
        search_by = 'metalNproducttypeNseries'

    return {
        'parts':        parts,
        'metal':        metal,
        'product_type': product_type,
        'last_seg':     last_seg,
        'search_by':    search_by,
        'series_text':  last_seg if len(parts) >= 3 else '',
    }


def _lookup_seo_from_db(conn, url: str, fp_map: dict) -> dict | None:
    """
    Attempt to retrieve all SEO fields for a BPM page URL from the database.

    Handles two page types:
      Tag page    — FilterPages_SEOData (MetaTitle/Desc templates) +
                    SEOContents WHERE TagId = last-slug
      Metal / ProductType / Series page — Search_GetPageSEOData SP

    Returns a dict in the same shape as _scrape_page() on success,
    or None if the URL is not a known BPM metal page or the lookup fails.

    Note: The 8 static landing pages (e.g. /gold-bullion, /silver-bullion/silver-coins)
    have hardcoded frontend content not stored in SEOContents.  The SP returns
    empty H1 + PageContent for these.  The caller detects this and falls back
    to Playwright.
    """
    segs = _parse_url_segments(url)
    if not segs:
        return None

    is_tag = len(segs['parts']) >= 3 and segs['last_seg'] in fp_map

    try:
        cursor = conn.cursor()

        if is_tag:
            # ── Tag page ─────────────────────────────────────────────────
            fp         = fp_map[segs['last_seg']]
            meta_title = _fill_template(fp['MetaTitle'],       segs['metal'], segs['product_type'])
            meta_desc  = _fill_template(fp['MetaDescription'], segs['metal'], segs['product_type'])

            h1 = ''
            content_html = ''
            canonical    = ''
            h2s = h3s = h4s = h5s = h6s = []

            cursor.execute(
                """
                SELECT TOP 1
                    ISNULL(CAST(ContentHeading AS NVARCHAR(MAX)), '') AS H1,
                    ISNULL(CAST(Content        AS NVARCHAR(MAX)), '') AS Content,
                    ISNULL(CanonicalUrl, '')                          AS CanonicalUrl
                FROM SEOContents
                WHERE IsActive = 1 AND TagId = ?
                ORDER BY Id
                """,
                (segs['last_seg'],),
            )
            row = cursor.fetchone()
            if row:
                h1           = row[0] or ''
                content_html = row[1] or ''
                canonical    = row[2] or ''
                h2s = _extract_html_headings(content_html, 'h2')
                h3s = _extract_html_headings(content_html, 'h3')
                h4s = _extract_html_headings(content_html, 'h4')
                h5s = _extract_html_headings(content_html, 'h5')
                h6s = _extract_html_headings(content_html, 'h6')

            body_content = _strip_html(content_html)

        else:
            # ── Metal / ProductType / Series page — SP ────────────────────
            cursor.execute(
                "EXEC Search_GetPageSEOData ?,?,?,?,?,?,?,?",
                (
                    segs['search_by'],
                    segs['metal'],
                    segs['product_type'],
                    '',                    # MintText
                    segs['series_text'],
                    '',                    # YearText
                    0,                     # tagId
                    '',                    # NarrowByMiscIdCSV
                ),
            )
            # Search_GetMetaTitleNDescription (called internally) may emit
            # intermediate result sets.  Skip them; use the very last one.
            row = None
            while True:
                rows = cursor.fetchall()
                if rows:
                    row = rows[0]
                if not cursor.nextset():
                    break

            if row is None:
                return None

            meta_title   = row[0] or ''   # MetaTitle
            # row[1]  = MetaTitle_Template  (not used here)
            meta_desc    = row[2] or ''   # MetaDescription
            # row[3]  = MetaDesc_Template   (not used here)
            h1           = row[4] or ''   # H1
            content_html = row[5] or ''   # PageContent
            canonical    = row[6] or ''   # CanonicalUrl

            body_content = _strip_html(content_html)
            h2s = _extract_html_headings(content_html, 'h2')
            h3s = _extract_html_headings(content_html, 'h3')
            h4s = _extract_html_headings(content_html, 'h4')
            h5s = _extract_html_headings(content_html, 'h5')
            h6s = _extract_html_headings(content_html, 'h6')

        return {
            'MetaTitle':       meta_title.strip()  or None,
            'MetaDescription': meta_desc.strip()   or None,
            'H1':              h1.strip()           or None,
            'H2s':             json.dumps(h2s)      if h2s else None,
            'H3s':             json.dumps(h3s)      if h3s else None,
            'H4s':             json.dumps(h4s)      if h4s else None,
            'H5s':             json.dumps(h5s)      if h5s else None,
            'H6s':             json.dumps(h6s)      if h6s else None,
            'BodyContent':     body_content         or None,
            'WordCount':       len(body_content.split()) if body_content else 0,
            'CanonicalURL':    canonical.strip()    or None,
            'SchemaMarkup':    None,
            'InternalLinks':   None,
            'ImageAltTags':    None,
            'ScrapeStatus':    'Success',
            'ScrapeError':     None,
            'FinalURL':        url,
        }

    except Exception as exc:
        print(f"  [seo-db] Lookup failed for {url}: {exc}")
        return None


# ── Playwright scraping ───────────────────────────────────────────────────

def _scrape_page(playwright, url: str) -> dict:
    """
    Scrape a single URL and return a dict of SEO fields.
    Returns dict with ScrapeStatus='Failed' on soft errors.
    """
    browser = playwright.chromium.launch(headless=True)
    try:
        context = browser.new_context(
            user_agent=(
                "Mozilla/5.0 (compatible; AISEO-Bot/2.0; "
                "+https://boldpreciousmetals.com)"
            )
        )
        page = context.new_page()
        response = page.goto(url, wait_until="domcontentloaded", timeout=30_000)

        if response and response.status >= 400:
            return {
                "ScrapeStatus": "Failed",
                "ScrapeError":  f"HTTP {response.status}",
            }

        final_url = page.url

        meta_title = page.evaluate("() => document.title || ''")

        meta_desc = page.evaluate(
            "() => (document.querySelector('meta[name=\"description\"]') || {}).content || ''"
        )

        canonical = page.evaluate(
            "() => (document.querySelector('link[rel=\"canonical\"]') || {}).href || ''"
        )

        h1 = page.evaluate(
            "() => (document.querySelector('h1') || {}).innerText || ''"
        )

        def _get_headings(tag: str) -> list:
            return page.evaluate(
                f"() => Array.from(document.querySelectorAll('{tag}')).map(e => e.innerText.trim()).filter(Boolean)"
            )

        h2s = _get_headings("h2")
        h3s = _get_headings("h3")
        h4s = _get_headings("h4")
        h5s = _get_headings("h5")
        h6s = _get_headings("h6")

        # Body text — prefer #seoContent (clean editorial copy present on all pages).
        # Falls back to full-body strip if #seoContent is absent.
        body_text = page.evaluate(
            """
            () => {
                const seoEl = document.getElementById('seoContent');
                if (seoEl) {
                    return seoEl.innerText.replace(/\\s+/g, ' ').trim();
                }
                const clone = document.body.cloneNode(true);
                clone.querySelectorAll(
                    'script,style,noscript,nav,header,footer,aside,iframe'
                ).forEach(el => el.remove());
                clone.querySelectorAll('[class*="sm:grid-cols-3"]').forEach(el => el.remove());
                return clone.innerText.replace(/\\s+/g, ' ').trim();
            }
            """
        )
        word_count = len(body_text.split()) if body_text else 0

        schema_blocks = page.evaluate(
            """
            () => Array.from(
                document.querySelectorAll('script[type="application/ld+json"]')
            ).map(s => { try { return JSON.parse(s.innerText); } catch(e) { return null; } })
             .filter(Boolean)
            """
        )
        schema_markup = json.dumps(schema_blocks) if schema_blocks else None

        parsed_url = urlparse(url)
        domain = parsed_url.netloc
        internal_links = page.evaluate(
            f"""
            () => {{
                const domain = '{domain}';
                return Array.from(document.querySelectorAll('a[href]'))
                    .map(a => a.href)
                    .filter(href => {{
                        try {{
                            const u = new URL(href, location.href);
                            return u.hostname === domain || u.hostname === '';
                        }} catch(e) {{ return false; }}
                    }})
                    .filter((v, i, arr) => arr.indexOf(v) === i)
                    .slice(0, 200);
            }}
            """
        )

        image_alts = page.evaluate(
            "() => Array.from(document.querySelectorAll('img[alt]')).map(i => i.alt.trim()).filter(Boolean)"
        )

        return {
            "MetaTitle":       meta_title or None,
            "MetaDescription": meta_desc or None,
            "H1":              (h1.strip() or None),
            "H2s":             json.dumps(h2s) if h2s else None,
            "H3s":             json.dumps(h3s) if h3s else None,
            "H4s":             json.dumps(h4s) if h4s else None,
            "H5s":             json.dumps(h5s) if h5s else None,
            "H6s":             json.dumps(h6s) if h6s else None,
            "BodyContent":     body_text or None,
            "WordCount":       word_count,
            "CanonicalURL":    canonical or None,
            "SchemaMarkup":    schema_markup,
            "InternalLinks":   json.dumps(internal_links) if internal_links else None,
            "ImageAltTags":    json.dumps(image_alts) if image_alts else None,
            "ScrapeStatus":    "Success",
            "ScrapeError":     None,
            "FinalURL":        final_url,
        }

    except Exception as exc:
        return {"ScrapeStatus": "Failed", "ScrapeError": str(exc)[:2000]}
    finally:
        browser.close()


# ── Prompt builders ───────────────────────────────────────────────────────

def _build_keyword_prompt(prompt_row, page: dict) -> tuple:
    """Phase 4a — keyword extraction for a single page."""
    page_data = {
        "url":             page["PageURL"],
        "MetaTitle":       page["MetaTitle"],
        "MetaDescription": page["MetaDescription"],
        "H1":              page["H1"],
        "H2s":             json.loads(page["H2s"]) if page["H2s"] else [],
        "BodyContent":     (page["BodyContent"] or "")[:5000],  # expanded for better LSI analysis
        "WordCount":       page["WordCount"],
    }
    user_msg = prompt_row.UserPromptTemplate.replace(
        "{PAGE_DATA}", json.dumps(page_data, indent=2)
    )
    return prompt_row.SystemPrompt, user_msg


def _build_cannibal_prompt(prompt_row, tree_name: str, pages: list,
                           keyword_map: dict = None) -> tuple:
    """
    Phase 4b — cannibalization analysis for a tree cluster.
    keyword_map: {page_url: {primary_keyword, secondary_keywords, search_intent}}
    Falls back gracefully if keyword_map is None or a page has no entry.
    """
    kw_map_data = []
    for p in pages:
        kw = (keyword_map or {}).get(p["PageURL"], {})
        kw_map_data.append({
            "url":               p["PageURL"],
            "primary_keyword":   kw.get("primary_keyword", ""),
            "secondary_keywords": kw.get("secondary_keywords", []),
            "search_intent":     kw.get("search_intent", ""),
        })

    tree_data = [
        {
            "url":             p["PageURL"],
            "MetaTitle":       p["MetaTitle"],
            "MetaDescription": p["MetaDescription"],
            "H1":              p["H1"],
            "H2s":             json.loads(p["H2s"]) if p["H2s"] else [],
            "H3s":             json.loads(p["H3s"]) if p["H3s"] else [],
            "BodyContent":     (p["BodyContent"] or "")[:1500],  # evidence excerpt per page
        }
        for p in pages
    ]

    user_msg = prompt_row.UserPromptTemplate
    user_msg = user_msg.replace("{TREE_NAME}",    tree_name)
    user_msg = user_msg.replace("{KEYWORD_MAP}",  json.dumps(kw_map_data, indent=2))
    user_msg = user_msg.replace("{TREE_DATA}",    json.dumps(tree_data,   indent=2))
    return prompt_row.SystemPrompt, user_msg


def _build_content_prompt(prompt_row, page: dict,
                          keyword_data: dict = None) -> tuple:
    """
    Phase 4c — content improvement for a single page.
    keyword_data: keyword extraction result from Phase 4a (may be None).
    Falls back gracefully if keyword_data is None.
    """
    # SchemaMarkup is truncated to 2000 chars — the full product list (can be 10k+ chars)
    # balloons input AND output tokens with minimal SEO value.  Claude only needs
    # enough to identify schema type and missing fields; it must NOT reproduce the
    # full schema in suggested_content (prompt instructs key changes only).
    raw_schema = page["SchemaMarkup"] or ""
    schema_preview = (raw_schema[:2000] + " ...[truncated]") if len(raw_schema) > 2000 else raw_schema

    page_data = {
        "url":             page["PageURL"],
        "MetaTitle":       page["MetaTitle"],
        "MetaDescription": page["MetaDescription"],
        "H1":              page["H1"],
        "H2s":             json.loads(page["H2s"]) if page["H2s"] else [],
        "H3s":             json.loads(page["H3s"]) if page["H3s"] else [],
        "BodyContent":     (page["BodyContent"] or "")[:15000],  # full editorial content for deep analysis
        "WordCount":       page["WordCount"],
        "CanonicalURL":    page["CanonicalURL"],
        "SchemaMarkup":    schema_preview,
    }

    kw = keyword_data or {}
    primary_kw      = kw.get("primary_keyword", "")
    secondary_kws   = json.dumps(kw.get("secondary_keywords", []))
    search_intent   = kw.get("search_intent", "transactional")
    keyword_gaps    = json.dumps(kw.get("keyword_gaps", []))
    missing_lsi     = json.dumps(kw.get("missing_lsi_terms", []))

    user_msg = prompt_row.UserPromptTemplate
    user_msg = user_msg.replace("{PRIMARY_KEYWORD}",    primary_kw)
    user_msg = user_msg.replace("{SECONDARY_KEYWORDS}", secondary_kws)
    user_msg = user_msg.replace("{SEARCH_INTENT}",      search_intent)
    user_msg = user_msg.replace("{KEYWORD_GAPS}",       keyword_gaps)
    user_msg = user_msg.replace("{MISSING_LSI_TERMS}",  missing_lsi)
    user_msg = user_msg.replace("{PAGE_DATA}",          json.dumps(page_data, indent=2))
    return prompt_row.SystemPrompt, user_msg


# ── DB helpers ────────────────────────────────────────────────────────────

def _log_audit(cursor, user_id: int, action: str, entity_type: str = None,
               entity_id: int = None, entity_url: str = None,
               entity_field: str = None, old_val: str = None,
               new_val: str = None, comment: str = None) -> None:
    cursor.execute(
        f"""
        INSERT INTO {TP}AuditLog
            (AuditedByUserID, AuditedAt, EntityType, EntityID, EntityURL,
             EntityField, ActionType, OldValue, NewValue, Comment, IPAddress)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '127.0.0.1')
        """,
        (user_id, datetime.utcnow(), entity_type, entity_id, entity_url,
         entity_field, action, old_val, new_val, comment),
    )


def _load_active_prompts(conn) -> dict:
    """
    Load all active prompts from DB. Returns dict keyed by PromptType.
    Raises if Cannibalization or ContentImprovement are missing
    (these are required for dry_run and scan).
    KeywordExtraction validation is done in run_scan() only.
    """
    cursor = conn.cursor()
    cursor.execute(
        f"""
        SELECT PromptID, PromptType, VersionNumber, VersionLabel,
               SystemPrompt, UserPromptTemplate
        FROM {TP}Prompts
        WHERE IsActive = 1
        """
    )
    rows = cursor.fetchall()

    class PromptRow:
        __slots__ = ("PromptID", "PromptType", "VersionNumber",
                     "VersionLabel", "SystemPrompt", "UserPromptTemplate")
        def __init__(self, row):
            self.PromptID           = row[0]
            self.PromptType         = row[1]
            self.VersionNumber      = row[2]
            self.VersionLabel       = row[3]
            self.SystemPrompt       = row[4]
            self.UserPromptTemplate = row[5]

    prompts = {PromptRow(r).PromptType: PromptRow(r) for r in rows}
    return prompts


def _get_source_urls(conn, limit: int = None,
                     url_filters: list = None) -> list:
    """
    Fetch source URLs from the source table.

    url_filters: list of (pattern, count) tuples — e.g.
                 [("silver-coins", 10), ("silver-bars", 10)]
                 Each pattern is matched as LIKE '%pattern%'.
                 Results from all filters are UNION ALL'd (may include duplicates).
    limit:       simple TOP N fallback when url_filters is not provided.
    """
    cursor = conn.cursor()

    if url_filters:
        parts  = []
        params = []
        for pattern, count in url_filters:
            parts.append(
                f"SELECT TOP {int(count)} {URL_SOURCE_COLUMN} "
                f"FROM {URL_SOURCE_TABLE} "
                f"WHERE {URL_SOURCE_COLUMN} LIKE ?"
            )
            params.append(f"%{pattern}%")
        query = " UNION ALL ".join(parts)
        cursor.execute(query, params)
    elif limit:
        cursor.execute(
            f"SELECT TOP {int(limit)} {URL_SOURCE_COLUMN} FROM {URL_SOURCE_TABLE}"
        )
    else:
        cursor.execute(f"SELECT {URL_SOURCE_COLUMN} FROM {URL_SOURCE_TABLE}")

    return [row[0] for row in cursor.fetchall() if row[0]]


def _already_scraped(conn, scan_name: str) -> set:
    """Return URL-path-slugs of all successfully scraped pages across ALL scans
    with this name (enables resume regardless of ScanID)."""
    cursor = conn.cursor()
    cursor.execute(
        f"""
        SELECT DISTINCT sp.PageURL
        FROM {TP}ScrapedPages sp
        JOIN {TP}Scans s ON sp.ScanID = s.ScanID
        WHERE s.ScanName = ? AND sp.ScrapeStatus = 'Success'
        """,
        (scan_name,),
    )
    slugs = set()
    for (page_url,) in cursor.fetchall():
        if page_url:
            slug = urlparse(page_url).path.rstrip("/").split("/")[-1]
            slugs.add(slug)
    return slugs


def _save_scraped_page(conn, scan_id: int, url: str, data: dict,
                       tree_cluster: str) -> None:
    cursor = conn.cursor()
    now = datetime.utcnow()
    cursor.execute(
        f"""
        INSERT INTO {TP}ScrapedPages
            (ScanID, PageURL, MetaTitle, MetaDescription, H1, H2s, H3s, H4s,
             H5s, H6s, BodyContent, WordCount, CanonicalURL, SchemaMarkup,
             InternalLinks, ImageAltTags, TreeCluster, ScrapedAt,
             ScrapeStatus, ScrapeError)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
        """,
        (
            scan_id, url,
            data.get("MetaTitle"),     data.get("MetaDescription"),
            data.get("H1"),            data.get("H2s"),
            data.get("H3s"),           data.get("H4s"),
            data.get("H5s"),           data.get("H6s"),
            data.get("BodyContent"),   data.get("WordCount"),
            data.get("CanonicalURL"),  data.get("SchemaMarkup"),
            data.get("InternalLinks"), data.get("ImageAltTags"),
            tree_cluster, now,
            data.get("ScrapeStatus", "Failed"),
            data.get("ScrapeError"),
        ),
    )
    cursor.execute(
        f"UPDATE {TP}Scans SET URLsScraped = URLsScraped + 1 WHERE ScanID = ?",
        (scan_id,),
    )
    conn.commit()


def _save_cannibal_issues(conn, scan_id: int, prompt_id: int,
                          tree_cluster: str, issues: list) -> None:
    if not issues:
        return
    # Filter same-URL false positives
    issues = [i for i in issues
              if i.get("url1", "").rstrip("/") != i.get("url2", "").rstrip("/")]
    if not issues:
        return
    cursor = conn.cursor()
    now = datetime.utcnow()
    for iss in issues:
        cursor.execute(
            f"""
            INSERT INTO {TP}CannibalizationIssues
                (ScanID, PromptID, TreeCluster, CannibalKeyword, Severity,
                 SeverityReason, URL1, URL1_FieldName, URL1_CurrentContent,
                 URL1_SuggestedFix, URL2, URL2_FieldName, URL2_CurrentContent,
                 URL2_SuggestedFix, OverallRecommendation, Reasoning,
                 Status, CreatedAt)
            VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,'Yet to Act',?)
            """,
            (
                scan_id, prompt_id, tree_cluster,
                iss.get("cannibal_keyword"),
                iss.get("severity"),
                iss.get("severity_reason"),
                iss.get("url1"),
                iss.get("url1_field"),
                iss.get("url1_current_content"),
                iss.get("url1_suggested_fix"),
                iss.get("url2"),
                iss.get("url2_field"),
                iss.get("url2_current_content"),
                iss.get("url2_suggested_fix"),
                iss.get("overall_recommendation"),
                iss.get("reasoning"),
                now,
            ),
        )
    conn.commit()


def _save_content_improvements(conn, scan_id: int, prompt_id: int,
                                tree_cluster: str, page_url: str,
                                improvements: list) -> None:
    if not improvements:
        return
    cursor = conn.cursor()
    now = datetime.utcnow()
    for imp in improvements:
        cursor.execute(
            f"""
            INSERT INTO {TP}ContentImprovements
                (ScanID, PromptID, TreeCluster, PageURL, FieldName,
                 CurrentContent, CurrentCharCount, SuggestedContent,
                 SuggestedCharCount, IssueType, Reasoning, Priority,
                 ImpactEstimate, Status, CreatedAt)
            VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,'Yet to Act',?)
            """,
            (
                scan_id, prompt_id, tree_cluster, page_url,
                imp.get("field_name"),
                imp.get("current_content"),
                imp.get("current_char_count"),
                imp.get("suggested_content"),
                imp.get("suggested_char_count"),
                imp.get("issue_type"),
                imp.get("reasoning"),
                imp.get("priority"),
                imp.get("impact_estimate"),
                now,
            ),
        )
    conn.commit()


def _save_page_keywords(conn, scan_id: int, prompt_id: int,
                        page_url: str, tree_cluster: str,
                        kw_data: dict) -> None:
    """Persist Phase 4a keyword extraction result to ClCode_PageKeywords."""
    secondary = kw_data.get("secondary_keywords", [])
    gaps      = kw_data.get("keyword_gaps", [])
    lsi       = kw_data.get("missing_lsi_terms", [])
    cursor    = conn.cursor()
    cursor.execute(
        f"""
        INSERT INTO {TP}PageKeywords
            (ScanID, PromptID, PageURL, TreeCluster, PrimaryKeyword,
             SecondaryKeywords, SearchIntent, KeywordGaps, MissingLSITerms,
             ContentFocusScore, CreatedAt)
        VALUES (?,?,?,?,?,?,?,?,?,?,?)
        """,
        (
            scan_id, prompt_id, page_url, tree_cluster,
            kw_data.get("primary_keyword"),
            json.dumps(secondary) if secondary else None,
            kw_data.get("search_intent"),
            json.dumps(gaps) if gaps else None,
            json.dumps(lsi)  if lsi  else None,
            kw_data.get("content_focus_score"),
            datetime.utcnow(),
        ),
    )
    conn.commit()


# ── JSON parsers ──────────────────────────────────────────────────────────

def _parse_json_response(raw: str) -> list:
    """
    Strip markdown fences and parse a JSON ARRAY from Claude's response.
    Attempts partial recovery if the response was truncated at max_tokens.
    """
    text = raw.strip()
    text = re.sub(r"^```[a-zA-Z]*\n?", "", text)
    text = re.sub(r"\n?```$", "", text)
    text = text.strip()
    if not text or text == "[]":
        return []

    try:
        return json.loads(text)
    except json.JSONDecodeError:
        # Try to recover complete objects from a truncated array
        last_brace = text.rfind("}")
        if last_brace != -1:
            trimmed = text[: last_brace + 1]
            trimmed = (trimmed + "]") if trimmed.lstrip().startswith("[") \
                      else ("[" + trimmed + "]")
            try:
                result = json.loads(trimmed)
                print(f"    WARNING: Claude response truncated — recovered {len(result)} item(s)")
                return result
            except json.JSONDecodeError:
                pass
        print(f"    WARNING: Could not parse Claude response — raw length: {len(text)}")
        return []


def _parse_json_object(raw: str) -> dict:
    """
    Strip markdown fences and parse a single JSON OBJECT from Claude's response.
    Used for Phase 4a (keyword extraction returns one object per page).
    """
    text = raw.strip()
    text = re.sub(r"^```[a-zA-Z]*\n?", "", text)
    text = re.sub(r"\n?```$", "", text)
    text = text.strip()
    if not text:
        return {}

    try:
        result = json.loads(text)
        return result if isinstance(result, dict) else {}
    except json.JSONDecodeError:
        # Try to extract the outermost {...} block
        start = text.find("{")
        end   = text.rfind("}") + 1
        if start >= 0 and end > start:
            try:
                result = json.loads(text[start:end])
                return result if isinstance(result, dict) else {}
            except json.JSONDecodeError:
                pass
        print(f"    WARNING: Could not parse keyword JSON — raw length: {len(text)}")
        return {}


# ── Main run_scan ─────────────────────────────────────────────────────────

def run_scan(scan_name: str, user_id: int, limit: int = None,
             url_filters: list = None,
             skip_keyword: bool = False,
             skip_cannibalization: bool = False,
             skip_content: bool = False,
             provider: str = "claude") -> int:
    """
    Run a full SEO scan. Returns the ScanID.

    url_filters:          list of (pattern, count) tuples.
    skip_keyword:         skip Phase 4a (keyword extraction).
    skip_cannibalization: skip Phase 4b (cannibalization analysis).
    skip_content:         skip Phase 4c (content improvement).
    provider:             "claude" (default) or "gemini".
    Resumes automatically if interrupted — already-scraped URLs are skipped.
    """
    conn    = get_connection()
    cursor  = conn.cursor()
    scan_id = None  # tracked early so fatal-error handler can mark it Failed

    # ── Pre-lookup: grab scan record already created by the web UI ───────
    # Next.js inserts the record (Status='Running') before spawning Python,
    # so we capture the scan_id here to allow error recovery if we crash
    # before Phase 1 would normally create/find it.
    try:
        cursor.execute(
            f"SELECT TOP 1 ScanID FROM {TP}Scans "
            f"WHERE ScanName = ? AND Status = 'Running' ORDER BY ScanID DESC",
            (scan_name,),
        )
        _pre = cursor.fetchone()
        if _pre:
            scan_id = _pre[0]
    except Exception:
        pass  # scan_id stays None; will be set/created in Phase 1

    def _fatal(exc: Exception) -> None:
        """Print the traceback and mark the scan record as Failed."""
        err_text = traceback.format_exc()
        print(f"\n{'='*60}")
        print(f"SCAN FAILED: {exc}")
        print(err_text)
        print(f"{'='*60}\n")
        if scan_id is not None:
            try:
                cursor.execute(
                    f"UPDATE {TP}Scans "
                    f"SET Status='Failed', EndedAt=GETUTCDATE(), "
                    f"    ErrorLog = ISNULL(ErrorLog,'') + ? "
                    f"WHERE ScanID = ?",
                    (f"\nFATAL: {str(exc)[:2000]}\n{err_text[:3000]}", scan_id),
                )
                conn.commit()
                print(f"  Marked ScanID={scan_id} as Failed.")
            except Exception as upd_exc:
                print(f"  WARNING: Could not update scan status: {upd_exc}")

    # ── Resolve API key from DB (falls back to env var) ──────────────────
    try:
        if provider == "gemini":
            _init_gemini_client(conn)
        else:
            _init_claude_client(conn)
    except Exception as exc:
        _fatal(exc)
        conn.close()
        raise

    # ── Phase 1: Initialisation ───────────────────────────────────────────
    now    = datetime.utcnow()
    run_id = f"RUN_{now.strftime('%Y%m%d_%H')}"

    print(f"\n{'='*60}")
    print(f"AISEO Scan: {scan_name}")
    print(f"RunID: {run_id}")
    print(f"{'='*60}")

    # Load active prompts — validate only the phases we will actually run
    try:
        prompts = _load_active_prompts(conn)

        if not skip_keyword and "KeywordExtraction" not in prompts:
            raise RuntimeError(
                "No active KeywordExtraction prompt found in ClCode_Prompts. "
                "Run 'python run_scan.py setup' to seed the v1 keyword prompt."
            )
        if not skip_cannibalization and "Cannibalization" not in prompts:
            raise RuntimeError(
                "No active Cannibalization prompt found in ClCode_Prompts. "
                "Run 'python run_scan.py setup' to seed the latest prompts."
            )
        if not skip_content and "ContentImprovement" not in prompts:
            raise RuntimeError(
                "No active ContentImprovement prompt found in ClCode_Prompts. "
                "Run 'python run_scan.py setup' to seed the latest prompts."
            )
    except Exception as exc:
        _fatal(exc)
        conn.close()
        raise

    keyword_prompt  = prompts.get("KeywordExtraction")
    cannibal_prompt = prompts.get("Cannibalization")
    content_prompt  = prompts.get("ContentImprovement")

    print("  Phases:")
    print(f"    Keyword Extraction  : {'SKIP' if skip_keyword        else keyword_prompt.VersionLabel}")
    print(f"    Cannibalization     : {'SKIP' if skip_cannibalization else cannibal_prompt.VersionLabel}")
    print(f"    Content Improvement : {'SKIP' if skip_content        else content_prompt.VersionLabel}")

    try:
        all_urls = _get_source_urls(conn, limit=limit, url_filters=url_filters)
    except Exception as exc:
        _fatal(exc)
        conn.close()
        raise RuntimeError(f"Cannot read {URL_SOURCE_TABLE}: {exc}") from exc

    total_urls = len(all_urls)
    print(f"  Source URLs: {total_urls}")
    if url_filters:
        print(f"  URL filters: {url_filters}")

    # Check for existing in-progress scan (resume case)
    cursor.execute(
        f"""
        SELECT TOP 1 ScanID, RunID FROM {TP}Scans
        WHERE (ScanName = ? OR RunID = ?) AND Status = 'Running'
        ORDER BY URLsScraped DESC, ScanID DESC
        """,
        (scan_name, run_id),
    )
    existing = cursor.fetchone()
    if existing:
        scan_id = existing[0]
        print(f"  Resuming existing scan ScanID={scan_id} (RunID={existing[1]})")
    else:
        cursor.execute(
            f"""
            INSERT INTO {TP}Scans
                (RunID, ScanName, StartedAt, StartedByUserID, TotalURLs,
                 URLsScraped, TreesAnalysed, Status,
                 CannibalizationPromptID, ContentPromptID,
                 CreatedAt, CreatedByUserID)
            VALUES (?,?,?,?,?,0,0,'Running',?,?,?,?)
            """,
            (run_id, scan_name, now, user_id, total_urls,
             cannibal_prompt.PromptID, content_prompt.PromptID, now, user_id),
        )
        _log_audit(cursor, user_id, "ScanStarted", "Scan",
                   comment=f"RunID={run_id}, kw={keyword_prompt.PromptID}, "
                           f"cannibal={cannibal_prompt.PromptID}, "
                           f"content={content_prompt.PromptID}")
        conn.commit()
        cursor.execute(
            f"SELECT ScanID FROM {TP}Scans WHERE RunID = ? AND Status = 'Running'",
            (run_id,),
        )
        scan_id = cursor.fetchone()[0]
        print(f"  Created ScanID={scan_id}")

    # ── Phase 2: Scraping ─────────────────────────────────────────────────
    print(f"\n--- Phase 2: Scraping ---")
    done_slugs    = _already_scraped(conn, scan_name)
    def _slug(u): return urlparse(u).path.rstrip("/").split("/")[-1]
    to_scrape     = [u for u in all_urls if _slug(u) not in done_slugs]
    scraped_count = len(done_slugs)
    print(f"  Already scraped: {scraped_count}/{total_urls} (skipping these)")

    # Pre-load FilterPages_SEOData for DB-first lookup (avoids browser launch
    # for the majority of BPM product/metal/series/tag pages).
    fp_map = _load_fp_map(conn)
    print(f"  FilterPages map: {len(fp_map)} tag entries")

    # First pass — resolve from DB wherever possible.
    # Pages where DB has both H1 and BodyContent are saved immediately.
    # Remaining pages (8 static landing pages, non-BPM URLs, DB errors) are
    # queued for Playwright along with any partial DB data we already have.
    playwright_queue: list[tuple[str, dict | None]] = []

    for url in to_scrape:
        db_data = _lookup_seo_from_db(conn, url, fp_map)
        if db_data and db_data.get("H1") and db_data.get("BodyContent"):
            tree = _get_tree_cluster(url)
            _save_scraped_page(conn, scan_id, url, db_data, tree)
            scraped_count += 1
            print(
                f"  Scraped {scraped_count}/{total_urls}"
                f"  [DB]  {url[:80]}"
            )
        else:
            # DB missing content (static pages, non-BPM URLs, etc.) → Playwright
            playwright_queue.append((url, db_data))

    # Second pass — Playwright for pages without full DB content.
    if playwright_queue:
        print(f"  Playwright queue: {len(playwright_queue)} URL(s)")
        with sync_playwright() as pw:
            for url, partial_db in playwright_queue:
                try:
                    data = _scrape_page(pw, url)
                    # If Playwright succeeded but DB already resolved meta fields,
                    # prefer the DB values (they come from the authoritative source).
                    if partial_db and data.get("ScrapeStatus") == "Success":
                        if not data.get("MetaTitle") and partial_db.get("MetaTitle"):
                            data["MetaTitle"] = partial_db["MetaTitle"]
                        if not data.get("MetaDescription") and partial_db.get("MetaDescription"):
                            data["MetaDescription"] = partial_db["MetaDescription"]
                except Exception:
                    data = {
                        "ScrapeStatus": "Failed",
                        "ScrapeError":  traceback.format_exc()[:2000],
                    }

                final_url = data.get("FinalURL") or url
                tree      = _get_tree_cluster(final_url)
                _save_scraped_page(conn, scan_id, final_url, data, tree)
                scraped_count += 1
                print(
                    f"  Scraped {scraped_count}/{total_urls}"
                    f"  [{data['ScrapeStatus']}]  {url[:80]}"
                )

    # ── Phase 3: Clustering ───────────────────────────────────────────────
    print(f"\n--- Phase 3: Clustering ---")

    cursor.execute(
        f"""
        SELECT PageID, PageURL, MetaTitle, MetaDescription, H1, H2s, H3s,
               H4s, H5s, H6s, BodyContent, WordCount, CanonicalURL,
               SchemaMarkup, TreeCluster, ScrapeStatus
        FROM (
            SELECT sp.*,
                   ROW_NUMBER() OVER (PARTITION BY sp.PageURL ORDER BY sp.PageID DESC) AS rn
            FROM {TP}ScrapedPages sp
            JOIN {TP}Scans s ON sp.ScanID = s.ScanID
            WHERE s.ScanName = ? AND sp.ScrapeStatus = 'Success'
        ) AS deduped
        WHERE rn = 1
        """,
        (scan_name,),
    )
    all_pages_raw = cursor.fetchall()
    cols          = [d[0] for d in cursor.description]
    all_pages     = [dict(zip(cols, row)) for row in all_pages_raw]

    trees: dict[str, list] = {}
    for p in all_pages:
        cluster = p["TreeCluster"] or "root"
        trees.setdefault(cluster, []).append(p)

    total_trees = len(trees)
    total_pages = len(all_pages)
    print(f"  Trees found: {total_trees}")
    for tree_name, pages in trees.items():
        print(f"    {tree_name}: {len(pages)} pages")

    # Track LLM API call outcomes across all phases.
    # If every single call fails (api_call_failed == api_call_total > 0) the scan
    # is marked Failed rather than Completed so the error banner shows on the UI.
    api_call_total  = 0
    api_call_failed = 0

    # ── Phase 4a: Keyword Extraction (per page) ───────────────────────────
    keyword_map: dict[str, dict] = {}   # {page_url: kw_data}

    if skip_keyword:
        print(f"\n--- Phase 4a: Keyword Extraction — SKIPPED ---")
    else:
        print(f"\n--- Phase 4a: Keyword Extraction ({total_pages} pages) ---")
        page_num = 0

        for page in all_pages:
            page_num += 1
            url_short = page["PageURL"][-70:]
            print(f"  [{page_num}/{total_pages}] {url_short}")
            try:
                sys_p, user_msg = _build_keyword_prompt(keyword_prompt, page)
                raw     = _call_claude_logged(
                    conn, scan_id, "KeywordExtraction",
                    page["PageURL"], sys_p, user_msg,
                    provider=provider,
                )
                api_call_total += 1
                kw_data = _parse_json_object(raw)
                if kw_data:
                    keyword_map[page["PageURL"]] = kw_data
                    _save_page_keywords(
                        conn, scan_id, keyword_prompt.PromptID,
                        page["PageURL"], page.get("TreeCluster") or "root",
                        kw_data,
                    )
                    print(
                        f"    primary='{kw_data.get('primary_keyword', '?')[:45]}'  "
                        f"intent={kw_data.get('search_intent', '?')}  "
                        f"focus={kw_data.get('content_focus_score', '?')}/10"
                    )
                else:
                    print("    WARNING: Empty keyword data returned")
            except PromptTooLargeError:
                pass  # already printed + logged to ClaudeCallLog; skip page
            except Exception as exc:
                api_call_total  += 1
                api_call_failed += 1
                err = f"Keyword extraction failed for {page['PageURL']}: {exc}"
                print(f"    WARNING: {err}")
                cursor.execute(
                    f"UPDATE {TP}Scans SET ErrorLog = ISNULL(ErrorLog,'') + ? WHERE ScanID = ?",
                    (f"\n{err}", scan_id),
                )
                conn.commit()

        print(f"\n  Keywords extracted: {len(keyword_map)}/{total_pages} pages")

    # ── Phase 4b: Cannibalization (per tree, using keyword map) ──────────
    cannibal_total = 0

    if skip_cannibalization:
        print(f"\n--- Phase 4b: Cannibalization — SKIPPED ---")
    else:
        print(f"\n--- Phase 4b: Cannibalization ({total_trees} trees) ---")
        tree_num = 0

        for tree_name, pages in trees.items():
            tree_num += 1
            print(f"\n  Tree {tree_num}/{total_trees}: {tree_name} ({len(pages)} pages)")

            if len(pages) >= 2:
                try:
                    sys_p, user_msg = _build_cannibal_prompt(
                        cannibal_prompt, tree_name, pages, keyword_map
                    )
                    raw    = _call_claude_logged(
                        conn, scan_id, "Cannibalization",
                        tree_name, sys_p, user_msg,
                        provider=provider,
                        max_tokens=16000,
                    )
                    api_call_total += 1
                    issues = _parse_json_response(raw)
                    _save_cannibal_issues(conn, scan_id, cannibal_prompt.PromptID,
                                          tree_name, issues)
                    cannibal_total += len(issues)
                    print(f"    Cannibalization: {len(issues)} issue(s) found")
                except PromptTooLargeError:
                    pass  # already printed + logged; skip this tree
                except Exception as exc:
                    api_call_total  += 1
                    api_call_failed += 1
                    err = f"Cannibal analysis failed for tree '{tree_name}': {exc}"
                    print(f"    WARNING: {err}")
                    cursor.execute(
                        f"UPDATE {TP}Scans SET ErrorLog = ISNULL(ErrorLog,'') + ? WHERE ScanID = ?",
                        (f"\n{err}", scan_id),
                    )
                    conn.commit()
            else:
                print(f"    Cannibalization: skipped (only {len(pages)} page)")

        print(f"\n  Total cannibalization issues found: {cannibal_total}")

    # Update trees count after Phase 4b
    cursor.execute(
        f"UPDATE {TP}Scans SET TreesAnalysed = ? WHERE ScanID = ?",
        (total_trees, scan_id),
    )
    conn.commit()

    # ── Phase 4c: Content Improvement (per page, with keyword context) ────
    improvement_total = 0

    if skip_content:
        print(f"\n--- Phase 4c: Content Improvement — SKIPPED ---")
    else:
        print(f"\n--- Phase 4c: Content Improvement ({total_pages} pages) ---")
        page_num = 0

        for tree_name, pages in trees.items():
            for page in pages:
                page_num += 1
                url_short = page["PageURL"][-65:]
                try:
                    kw_data = keyword_map.get(page["PageURL"])
                    sys_p, user_msg = _build_content_prompt(
                        content_prompt, page, kw_data
                    )
                    raw = _call_claude_logged(
                        conn, scan_id, "ContentImprovement",
                        page["PageURL"], sys_p, user_msg,
                        provider=provider,
                        max_tokens=16000,
                    )
                    api_call_total += 1
                    improvements = _parse_json_response(raw)
                    _save_content_improvements(
                        conn, scan_id, content_prompt.PromptID,
                        tree_name, page["PageURL"], improvements,
                    )
                    improvement_total += len(improvements)
                    print(
                        f"  [{page_num}/{total_pages}] {url_short}: "
                        f"{len(improvements)} suggestion(s)"
                    )
                except PromptTooLargeError:
                    pass  # already printed + logged; skip this page
                except Exception as exc:
                    api_call_total  += 1
                    api_call_failed += 1
                    err = f"Content analysis failed for {page['PageURL']}: {exc}"
                    print(f"    WARNING: {err}")
                    cursor.execute(
                        f"UPDATE {TP}Scans SET ErrorLog = ISNULL(ErrorLog,'') + ? WHERE ScanID = ?",
                        (f"\n{err}", scan_id),
                    )
                    conn.commit()

        print(f"\n  Total content suggestions: {improvement_total}")

    # ── Phase 5: Completion ───────────────────────────────────────────────
    print(f"\n--- Phase 5: Completion ---")
    end_time = datetime.utcnow()

    # If every LLM call failed (and there was at least one), mark as Failed so
    # the error banner is shown prominently on the scan detail page.
    all_calls_failed = (api_call_total > 0 and api_call_failed == api_call_total)
    final_status = "Failed" if all_calls_failed else "Completed"

    if all_calls_failed:
        print(f"  WARNING: All {api_call_total} AI API call(s) failed — marking scan as Failed.")

    cursor.execute(
        f"""
        UPDATE {TP}Scans
        SET Status = ?, EndedAt = ?
        WHERE ScanID = ?
        """,
        (final_status, end_time, scan_id),
    )
    skipped = []
    if skip_keyword:         skipped.append("KeywordExtraction")
    if skip_cannibalization: skipped.append("Cannibalization")
    if skip_content:         skipped.append("ContentImprovement")
    skipped_str = ",".join(skipped) if skipped else "none"
    _log_audit(cursor, user_id, "ScanCompleted", "Scan", entity_id=scan_id,
               comment=f"Trees={total_trees}, Pages={total_pages}, "
                       f"Keywords={len(keyword_map)}, "
                       f"Cannibalization={cannibal_total}, "
                       f"Improvements={improvement_total}, "
                       f"Skipped={skipped_str}")
    conn.commit()
    conn.close()

    print(f"\n{'='*60}")
    print(f"Scan complete.  ScanID={scan_id}")
    print(f"  Keywords extracted : {len(keyword_map)}/{total_pages}")
    print(f"  Cannibal issues    : {cannibal_total}")
    print(f"  Content suggestions: {improvement_total}")
    print(f"{'='*60}\n")

    return scan_id
