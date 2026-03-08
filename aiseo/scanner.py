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

import json
import re
import time
import traceback
from datetime import datetime
from urllib.parse import urlparse

import anthropic
from playwright.sync_api import sync_playwright

from .config import (
    ANTHROPIC_API_KEY,
    CLAUDE_MODEL,
    TP,
    URL_SOURCE_COLUMN,
    URL_SOURCE_TABLE,
)
from .db import get_connection

# ── Claude client ─────────────────────────────────────────────────────────

_claude = anthropic.Anthropic(api_key=ANTHROPIC_API_KEY)


def _call_claude(system_prompt: str, user_message: str) -> str:
    """Raw Claude API call with rate-limit retry. 3 s sleep after each call."""
    for attempt in range(3):
        try:
            response = _claude.messages.create(
                model=CLAUDE_MODEL,
                max_tokens=8192,
                system=system_prompt,
                messages=[{"role": "user", "content": user_message}],
            )
            time.sleep(3)   # stay within 30k tokens/min rate limit
            return response.content[0].text
        except Exception as exc:
            if "rate_limit" in str(exc).lower() and attempt < 2:
                wait = 30 * (attempt + 1)   # 30s then 60s
                print(f"    Rate limit hit — waiting {wait}s before retry...")
                time.sleep(wait)
            else:
                raise
    raise RuntimeError("Claude API failed after 3 attempts")


def _call_claude_logged(conn, scan_id: int, call_type: str, entity_url: str,
                        system_prompt: str, user_message: str) -> str:
    """
    Wrap _call_claude and persist the full input/output to ClCode_ClaudeCallLog.

    call_type: "KeywordExtraction" | "Cannibalization" | "ContentImprovement"
    entity_url: page URL (4a/4c) or tree cluster name (4b)
    Always re-raises any exception so the caller can handle it.
    """
    called_at  = datetime.utcnow()
    t0         = time.time()
    raw        = None
    succeeded  = False
    error_msg  = None

    try:
        raw = _call_claude(system_prompt, user_message)
        succeeded = True
        return raw
    except Exception as exc:
        error_msg = str(exc)[:2000]
        raise
    finally:
        duration_ms = int((time.time() - t0) * 1000)
        try:
            cursor = conn.cursor()
            cursor.execute(
                f"""
                INSERT INTO {TP}ClaudeCallLog
                    (ScanID, CallType, EntityURL, SystemPrompt, UserMessage,
                     RawResponse, CallSucceeded, InputCharsEstimate,
                     OutputCharsEstimate, CalledAt, DurationMs, ErrorMessage)
                VALUES (?,?,?,?,?,?,?,?,?,?,?,?)
                """,
                (
                    scan_id, call_type, entity_url,
                    system_prompt, user_message,
                    raw,
                    1 if succeeded else 0,
                    len(system_prompt) + len(user_message),
                    len(raw) if raw else 0,
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
        "BodyContent":     (page["BodyContent"] or "")[:1500],  # short excerpt for LSI analysis
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
            "BodyContent":     (p["BodyContent"] or "")[:500],  # evidence excerpt only
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
    page_data = {
        "url":             page["PageURL"],
        "MetaTitle":       page["MetaTitle"],
        "MetaDescription": page["MetaDescription"],
        "H1":              page["H1"],
        "H2s":             json.loads(page["H2s"]) if page["H2s"] else [],
        "H3s":             json.loads(page["H3s"]) if page["H3s"] else [],
        "BodyContent":     (page["BodyContent"] or "")[:5000],  # clean #seoContent
        "WordCount":       page["WordCount"],
        "CanonicalURL":    page["CanonicalURL"],
        "SchemaMarkup":    page["SchemaMarkup"],
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
             skip_content: bool = False) -> int:
    """
    Run a full SEO scan. Returns the ScanID.

    url_filters:          list of (pattern, count) tuples.
    skip_keyword:         skip Phase 4a (keyword extraction).
    skip_cannibalization: skip Phase 4b (cannibalization analysis).
    skip_content:         skip Phase 4c (content improvement).
    Resumes automatically if interrupted — already-scraped URLs are skipped.
    """
    conn   = get_connection()
    cursor = conn.cursor()

    # ── Phase 1: Initialisation ───────────────────────────────────────────
    now    = datetime.utcnow()
    run_id = f"RUN_{now.strftime('%Y%m%d_%H')}"

    print(f"\n{'='*60}")
    print(f"AISEO Scan: {scan_name}")
    print(f"RunID: {run_id}")
    print(f"{'='*60}")

    # Load active prompts — validate only the phases we will actually run
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

    with sync_playwright() as pw:
        for url in to_scrape:
            try:
                data = _scrape_page(pw, url)
            except Exception:
                data = {"ScrapeStatus": "Failed",
                        "ScrapeError":  traceback.format_exc()[:2000]}

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
                )
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
            except Exception as exc:
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
                    )
                    issues = _parse_json_response(raw)
                    _save_cannibal_issues(conn, scan_id, cannibal_prompt.PromptID,
                                          tree_name, issues)
                    cannibal_total += len(issues)
                    print(f"    Cannibalization: {len(issues)} issue(s) found")
                except Exception as exc:
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
                    )
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
                except Exception as exc:
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
    cursor.execute(
        f"""
        UPDATE {TP}Scans
        SET Status = 'Completed', EndedAt = ?
        WHERE ScanID = ?
        """,
        (end_time, scan_id),
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
