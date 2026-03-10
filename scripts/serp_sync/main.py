"""
SERP Sync — daily orchestrator.

Fetches SERP positions from Google Search Console and keyword search volumes
from Google Ads, then upserts both into ClCode_URLMetrics in SQL Server.

Usage:
    # Sync for the default date (today minus GSC_DATA_DELAY_DAYS)
    python main.py

    # Sync for a specific date (backfill)
    python main.py 2025-12-01

    # Sync for a date range (backfill multiple days)
    python main.py 2025-11-01 2025-11-30
"""
import sys
import logging
import os
from calendar import monthrange
from datetime import date, timedelta, datetime
from typing import Optional

# Ensure imports work when run from any directory
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import config
import db_writer
import gsc_fetcher
import gads_fetcher

# ── Logging setup ─────────────────────────────────────────────────────────
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
    handlers=[
        logging.FileHandler(config.LOG_FILE, encoding="utf-8"),
        logging.StreamHandler(sys.stdout),
    ],
)
log = logging.getLogger(__name__)


def _is_last_day_of_month(d: date) -> bool:
    """Return True if d is the last calendar day of its month."""
    _, last = monthrange(d.year, d.month)
    return d.day == last


def _last_day_of_month(d: date) -> date:
    """Return the last day of d's month."""
    _, last = monthrange(d.year, d.month)
    return d.replace(day=last)


# ── Core sync ─────────────────────────────────────────────────────────────

def run(target_date: Optional[date] = None) -> dict:
    """
    Run the full SERP sync for one date.

    Returns a summary dict with keys: date, saved, updated, skipped, errors.
    """
    if target_date is None:
        target_date = date.today() - timedelta(days=config.GSC_DATA_DELAY_DAYS)

    log.info("=" * 60)
    log.info(f"SERP Sync  |  date={target_date}")
    log.info("=" * 60)

    summary = {
        "date":    str(target_date),
        "saved":   0,
        "updated": 0,
        "skipped": 0,
        "errors":  0,
    }

    # ── 1. Verify ClCode_URLMetrics table exists ───────────────────────────
    if not db_writer.metrics_table_exists():
        log.error(
            "ClCode_URLMetrics table does not exist.\n"
            "Open the AISEO Management web UI and click 'Setup / Migrate' "
            "under URL Registry, then re-run this script."
        )
        return summary

    # ── 2. Load tracked URLs ───────────────────────────────────────────────
    urls = db_writer.fetch_active_urls()
    log.info(f"Loaded {len(urls)} active URLs from DB")
    if not urls:
        log.warning("No active URLs found — nothing to sync.")
        return summary

    # ── 3. Fetch GSC data ──────────────────────────────────────────────────
    try:
        gsc_data = gsc_fetcher.fetch_all_positions(target_date)
    except FileNotFoundError as exc:
        log.error(str(exc))
        return summary
    except Exception as exc:
        log.error(f"GSC fetch failed: {exc}", exc_info=True)
        return summary

    # ── 4. Collect unique primary keywords for Google Ads ─────────────────
    # Search volumes are monthly averages — only fetch on the last day of each
    # month to avoid redundant API calls every day.
    keywords = list({
        u["PrimaryKeyword"].strip()
        for u in urls
        if u.get("PrimaryKeyword") and u["PrimaryKeyword"].strip()
    })
    log.info(f"Unique primary keywords to look up: {len(keywords)}")

    fetch_volume = _is_last_day_of_month(target_date)
    if keywords and fetch_volume:
        log.info(f"Last day of month — fetching search volumes for {len(keywords)} keyword(s) ...")
        try:
            volume_map = gads_fetcher.get_search_volumes(keywords)
        except Exception as exc:
            log.error(f"Google Ads fetch failed: {exc}", exc_info=True)
            volume_map = {}
    elif keywords:
        next_vol_date = _last_day_of_month(target_date)
        log.info(f"Skipping volume fetch (not last day of month — next fetch: {next_vol_date})")
        volume_map = {}
    else:
        volume_map = {}

    # ── 5. Write metrics per URL ───────────────────────────────────────────
    log.info("Writing metrics ...")
    for url in urls:
        page_url   = url["PageURL"]
        urlid      = url["URLID"]
        primary_kw = url.get("PrimaryKeyword") or ""
        secondary  = url.get("SecondaryKeywords") or ""

        position = gsc_fetcher.get_position_for_url(gsc_data, page_url, primary_kw)
        volume   = gads_fetcher.get_volume_for_keyword(volume_map, primary_kw, secondary)

        if position is None and volume is None:
            summary["skipped"] += 1
            log.debug(f"  SKIP  {page_url[:70]}")
            continue

        try:
            action = db_writer.upsert_metric(urlid, target_date, position, volume)
            if action == "insert":
                summary["saved"] += 1
            elif action == "update":
                summary["updated"] += 1

            pos_str = f"pos={round(position, 1)}" if position is not None else "pos=—"
            vol_str = f"vol={volume:,}"           if volume   is not None else "vol=—"
            log.info(f"  {action.upper():6}  {page_url[:55]:<55} | {pos_str} | {vol_str}")

        except Exception as exc:
            summary["errors"] += 1
            log.error(f"  ERROR  {page_url}: {exc}")

    # ── 6. Summary ─────────────────────────────────────────────────────────
    log.info("-" * 60)
    log.info(
        f"Done  |  inserted={summary['saved']}  updated={summary['updated']}  "
        f"skipped={summary['skipped']}  errors={summary['errors']}"
    )
    log.info("=" * 60)
    return summary


def run_range(start: date, end: date) -> None:
    """Run sync for every date in [start, end] inclusive."""
    d = start
    while d <= end:
        run(d)
        d += timedelta(days=1)


# ── Entry point ───────────────────────────────────────────────────────────

if __name__ == "__main__":
    args = sys.argv[1:]

    if len(args) == 0:
        # Default: latest available date
        run()

    elif len(args) == 1:
        # Single specific date
        try:
            run(datetime.strptime(args[0], "%Y-%m-%d").date())
        except ValueError:
            print(f"ERROR: Invalid date '{args[0]}'. Expected YYYY-MM-DD.")
            sys.exit(1)

    elif len(args) == 2:
        # Date range backfill
        try:
            d_start = datetime.strptime(args[0], "%Y-%m-%d").date()
            d_end   = datetime.strptime(args[1], "%Y-%m-%d").date()
        except ValueError as exc:
            print(f"ERROR: {exc}. Expected YYYY-MM-DD YYYY-MM-DD.")
            sys.exit(1)

        if d_start > d_end:
            print("ERROR: Start date must be before or equal to end date.")
            sys.exit(1)

        run_range(d_start, d_end)

    else:
        print("Usage: python main.py [YYYY-MM-DD [YYYY-MM-DD]]")
        sys.exit(1)
