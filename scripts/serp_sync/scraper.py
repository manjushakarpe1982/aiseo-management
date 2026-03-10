"""
Page scraper — enriches ClCode_URLs with PageTitle and SecondaryKeywords
by fetching each URL's HTML and extracting metadata.

Usage:
    # Scrape all URLs where PageTitle is NULL
    python scraper.py

    # Scrape all URLs (re-fetch even if already has title)
    python scraper.py --all

    # Scrape a single URL
    python scraper.py --url "https://www.boldpreciousmetals.com/silver-bullion/"

Fields populated:
    PageTitle         — from <title> tag (stripped of site name suffix)
    SecondaryKeywords — from <meta name="keywords"> or top H2 headings
"""
import sys
import os
import re
import time
import logging
import argparse
from typing import Optional

import requests
from bs4 import BeautifulSoup
import pyodbc

# Ensure imports work from any directory
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import config

# ── Logging ────────────────────────────────────────────────────────────────

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
    handlers=[logging.StreamHandler(sys.stdout)],
)
log = logging.getLogger(__name__)

# ── DB helpers ─────────────────────────────────────────────────────────────

def _get_conn():
    return pyodbc.connect(
        f"DRIVER={{ODBC Driver 17 for SQL Server}};"
        f"SERVER={config.DB_SERVER};DATABASE={config.DB_NAME};"
        f"UID={config.DB_UID};PWD={config.DB_PWD};"
        f"TrustServerCertificate=yes;"
    )

def fetch_urls(all_urls: bool = False) -> list[dict]:
    conn = _get_conn()
    try:
        cursor = conn.cursor()
        if all_urls:
            cursor.execute("SELECT URLID, PageURL FROM ClCode_URLs WHERE IsActive=1 ORDER BY PageURL")
        else:
            cursor.execute(
                "SELECT URLID, PageURL FROM ClCode_URLs "
                "WHERE IsActive=1 AND PageTitle IS NULL ORDER BY PageURL"
            )
        return [{"URLID": r[0], "PageURL": r[1]} for r in cursor.fetchall()]
    finally:
        conn.close()

def fetch_single_url(page_url: str) -> Optional[dict]:
    conn = _get_conn()
    try:
        cursor = conn.cursor()
        cursor.execute("SELECT URLID, PageURL FROM ClCode_URLs WHERE PageURL=?", page_url)
        row = cursor.fetchone()
        return {"URLID": row[0], "PageURL": row[1]} if row else None
    finally:
        conn.close()

def update_url(urlid: int, page_title: Optional[str], secondary_keywords: Optional[str]):
    conn = _get_conn()
    try:
        cursor = conn.cursor()
        cursor.execute(
            "UPDATE ClCode_URLs SET PageTitle=?, SecondaryKeywords=?, UpdatedAt=GETUTCDATE() "
            "WHERE URLID=?",
            page_title, secondary_keywords, urlid,
        )
        conn.commit()
    finally:
        conn.close()

# ── Scraping helpers ────────────────────────────────────────────────────────

HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/122.0.0.0 Safari/537.36"
    ),
    "Accept-Language": "en-US,en;q=0.9",
}

# Strip common site-name suffixes from <title> tags
TITLE_SUFFIX_RE = re.compile(
    r"\s*[|\-–—]\s*(Bold Precious Metals|BoldPreciousMetals\.com|Buy Online.*)?$",
    re.IGNORECASE,
)


def _clean_title(raw: str) -> str:
    cleaned = TITLE_SUFFIX_RE.sub("", raw).strip()
    return cleaned[:255] if cleaned else raw.strip()[:255]


def _extract_meta_keywords(soup: BeautifulSoup) -> Optional[str]:
    tag = soup.find("meta", attrs={"name": re.compile(r"^keywords$", re.I)})
    if tag and tag.get("content"):
        kws = [k.strip() for k in tag["content"].split(",") if k.strip()]
        return ", ".join(kws[:10])[:500] if kws else None
    return None


def _extract_h2_keywords(soup: BeautifulSoup) -> Optional[str]:
    """Fallback: use H2 text as secondary keyword hints (max 5)."""
    h2s = soup.find_all("h2", limit=5)
    texts = [h.get_text(separator=" ").strip() for h in h2s]
    texts = [t for t in texts if 3 <= len(t) <= 80][:5]
    return ", ".join(texts)[:500] if texts else None


def scrape_page(url: str) -> dict:
    """
    Fetch a URL and return extracted metadata.
    Returns {title, secondary_keywords} — either may be None on failure.
    """
    try:
        resp = requests.get(url, headers=HEADERS, timeout=15, allow_redirects=True)
        resp.raise_for_status()
    except Exception as exc:
        log.warning(f"  Fetch failed: {exc}")
        return {"title": None, "secondary_keywords": None}

    soup = BeautifulSoup(resp.text, "html.parser")

    # Title
    title_tag = soup.find("title")
    title = _clean_title(title_tag.get_text()) if title_tag else None

    # Secondary keywords: prefer <meta keywords>, fall back to H2s
    secondary = _extract_meta_keywords(soup) or _extract_h2_keywords(soup)

    return {"title": title, "secondary_keywords": secondary}


# ── Main ───────────────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(description="Scrape page titles and secondary keywords for ClCode_URLs.")
    parser.add_argument("--all",  action="store_true", help="Re-scrape all active URLs, not just those missing a title.")
    parser.add_argument("--url",  type=str, default=None, help="Scrape a single specific URL.")
    parser.add_argument("--delay", type=float, default=0.5, help="Seconds between requests (default: 0.5).")
    args = parser.parse_args()

    if args.url:
        rows = [fetch_single_url(args.url)]
        rows = [r for r in rows if r is not None]
        if not rows:
            log.error(f"URL not found in DB: {args.url}")
            sys.exit(1)
    else:
        rows = fetch_urls(all_urls=args.all)

    log.info(f"URLs to scrape: {len(rows)}")
    if not rows:
        log.info("Nothing to scrape. Use --all to re-scrape all URLs.")
        return

    updated = 0
    failed  = 0
    for i, row in enumerate(rows, 1):
        url = row["PageURL"]
        log.info(f"[{i}/{len(rows)}] {url}")
        data = scrape_page(url)

        if data["title"] or data["secondary_keywords"]:
            update_url(row["URLID"], data["title"], data["secondary_keywords"])
            log.info(f"  ✓ Title: {data['title'] or '—'}  |  Keywords: {(data['secondary_keywords'] or '—')[:60]}")
            updated += 1
        else:
            log.warning(f"  ✗ Nothing extracted")
            failed += 1

        if i < len(rows):
            time.sleep(args.delay)

    log.info(f"\nDone — updated={updated}  failed={failed}")


if __name__ == "__main__":
    main()
