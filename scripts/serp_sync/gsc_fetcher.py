"""
Google Search Console data fetcher.
Retrieves SERP position for each tracked URL using the Search Analytics API.

Data availability note:
    GSC data is typically delayed by 2–4 days. The script defaults to
    fetching data for 3 days ago (configurable via GSC_DATA_DELAY_DAYS).
"""
import json
import os
import logging
from datetime import date
from typing import Optional
from urllib.parse import urlparse, urlunparse

from google.oauth2.credentials import Credentials
from google.auth.transport.requests import Request
from googleapiclient.discovery import build

import config

log = logging.getLogger(__name__)


# ── Auth helpers ──────────────────────────────────────────────────────────

def _load_credentials() -> Credentials:
    """Load (and auto-refresh) credentials from the saved token file."""
    if not os.path.exists(config.GSC_TOKEN_FILE):
        raise FileNotFoundError(
            f"GSC token not found at: {config.GSC_TOKEN_FILE}\n"
            "Run auth_gsc.py first to set up authentication."
        )

    with open(config.GSC_TOKEN_FILE) as f:
        data = json.load(f)

    creds = Credentials(
        token=data.get("token"),
        refresh_token=data["refresh_token"],
        token_uri=data["token_uri"],
        client_id=data["client_id"],
        client_secret=data["client_secret"],
        scopes=data.get("scopes", config.GSC_SCOPES),
    )

    if creds.expired and creds.refresh_token:
        log.debug("GSC token expired — refreshing...")
        creds.refresh(Request())
        # Persist the new access token
        data["token"] = creds.token
        with open(config.GSC_TOKEN_FILE, "w") as f:
            json.dump(data, f, indent=2)
        log.debug("GSC token refreshed and saved.")

    return creds


def _build_service():
    """Return an authenticated Search Console service object."""
    creds = _load_credentials()
    return build("searchconsole", "v1", credentials=creds, cache_discovery=False)


# ── URL normalisation ─────────────────────────────────────────────────────

def _normalise_url(url: str) -> str:
    """
    Normalise a URL for comparison:
      - lowercase scheme + host
      - strip trailing slash from path
    """
    try:
        p = urlparse(url.strip())
        path = p.path.rstrip("/") or "/"
        return urlunparse((p.scheme.lower(), p.netloc.lower(), path, "", "", ""))
    except Exception:
        return url.strip().lower().rstrip("/")


# ── Core fetch ────────────────────────────────────────────────────────────

def fetch_all_positions(target_date: date) -> dict[str, dict[str, float]]:
    """
    Fetch all page+query rows from GSC for the given date.

    Returns a nested dict:
        {
          normalised_page_url: {
            query_string: position_float,
            ...
          },
          ...
        }

    Position is 1-based (1 = top result) and is an average across all
    sessions/devices recorded for that day.
    """
    date_str = target_date.strftime("%Y-%m-%d")
    log.info(f"Querying GSC for {config.GSC_SITE_URL} on {date_str} ...")

    service   = _build_service()
    results   = {}
    start_row = 0
    row_limit = 5000
    total     = 0

    while True:
        body = {
            "startDate":  date_str,
            "endDate":    date_str,
            "dimensions": ["page", "query"],
            "rowLimit":   row_limit,
            "startRow":   start_row,
        }
        response = (
            service.searchanalytics()
            .query(siteUrl=config.GSC_SITE_URL, body=body)
            .execute()
        )

        rows = response.get("rows", [])
        if not rows:
            break

        for row in rows:
            page     = _normalise_url(row["keys"][0])
            query    = row["keys"][1].lower().strip()
            position = float(row["position"])

            if page not in results:
                results[page] = {}
            results[page][query] = position

        total += len(rows)
        log.debug(f"  Fetched {total} rows so far (last batch: {len(rows)})")

        if len(rows) < row_limit:
            break
        start_row += row_limit

    log.info(f"GSC returned {total} rows covering {len(results)} unique pages.")
    return results


# ── Position lookup ───────────────────────────────────────────────────────

def get_position_for_url(
    gsc_data: dict[str, dict[str, float]],
    page_url: str,
    primary_keyword: Optional[str],
) -> Optional[float]:
    """
    Determine the best SERP position for a given URL.

    Lookup priority:
      1. Exact match of primary_keyword in the page's query data
      2. The primary keyword is a substring of a query (or vice versa)
      3. Best (lowest) position across ALL queries for this page

    Returns None if the page has no GSC data at all.
    """
    norm = _normalise_url(page_url)

    # Try with and without trailing slash
    page_data = gsc_data.get(norm) or gsc_data.get(norm + "/") or gsc_data.get(norm.rstrip("/"))

    if not page_data:
        return None

    if primary_keyword:
        kw = primary_keyword.lower().strip()

        # 1. Exact match
        if kw in page_data:
            return page_data[kw]

        # 2. Partial match (primary keyword ⊆ query or query ⊆ primary keyword)
        for query, pos in page_data.items():
            if kw in query or query in kw:
                return pos

    # 3. Best position across all queries
    return min(page_data.values())


def get_all_clicks_impressions(target_date: date) -> dict[str, dict]:
    """
    (Optional) Fetch per-page clicks + impressions for context/logging.
    Useful for dashboards but not stored in URLMetrics currently.
    """
    date_str = target_date.strftime("%Y-%m-%d")
    service  = _build_service()

    body = {
        "startDate":  date_str,
        "endDate":    date_str,
        "dimensions": ["page"],
        "rowLimit":   5000,
    }
    response = (
        service.searchanalytics()
        .query(siteUrl=config.GSC_SITE_URL, body=body)
        .execute()
    )

    result = {}
    for row in response.get("rows", []):
        page = _normalise_url(row["keys"][0])
        result[page] = {
            "clicks":      row.get("clicks", 0),
            "impressions": row.get("impressions", 0),
            "ctr":         row.get("ctr", 0.0),
            "position":    row.get("position", 0.0),
        }
    return result
