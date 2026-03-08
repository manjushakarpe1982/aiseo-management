#!/usr/bin/env python3
"""
Dry-run tool — scrape ONE URL and print exactly what would be sent to Claude.

Usage:
    python3 dry_run.py <URL>

Example:
    python3 dry_run.py https://www.boldpreciousmetals.com/silver-bullion/silver-coins/1-oz-silver-coins

No Claude API calls are made. No DB writes. Pure inspection only.
"""

import sys

from aiseo.scanner import _scrape_page, _build_content_prompt, _get_tree_cluster
from aiseo.db import get_connection
from aiseo.scanner import _load_active_prompts
from playwright.sync_api import sync_playwright

SEPARATOR = "=" * 70
BODY_LIMIT = 5000   # must match _build_content_prompt in scanner.py


def dry_run(url: str) -> None:
    print(f"\n{SEPARATOR}")
    print(f"DRY RUN — {url}")
    print(SEPARATOR)

    # ── Step 1: Scrape ─────────────────────────────────────────────────────
    print("\n[1] Scraping page...")
    with sync_playwright() as pw:
        data = _scrape_page(pw, url)

    if data.get("ScrapeStatus") != "Success":
        print(f"  ERROR: Scrape failed — {data.get('ScrapeError')}")
        return

    final_url = data.get("FinalURL") or url
    tree = _get_tree_cluster(final_url)
    body = data.get("BodyContent") or ""

    print(f"  Final URL    : {final_url}")
    print(f"  Tree cluster : {tree}")
    print(f"  MetaTitle    : {data.get('MetaTitle')}")
    print(f"  MetaDesc     : {(data.get('MetaDescription') or '')[:120]}")
    print(f"  H1           : {data.get('H1')}")
    print(f"  H2s          : {data.get('H2s', '[]')[:200]}")
    print(f"  WordCount    : {data.get('WordCount')}")
    print(f"  BodyContent  : {len(body):,} chars total (from #seoContent or full-body fallback)")

    # ── Step 2: Body content — full view ──────────────────────────────────
    sent_body = body[:BODY_LIMIT]
    dropped   = len(body) - len(sent_body)

    print(f"\n{SEPARATOR}")
    print(f"BODY CONTENT  ({len(body):,} chars raw  →  {len(sent_body):,} chars sent to Claude)")
    print(SEPARATOR)
    print(sent_body)
    if dropped > 0:
        print(f"\n  ... [{dropped:,} chars dropped — beyond {BODY_LIMIT} char limit]")

    # ── Step 3: Load prompts ───────────────────────────────────────────────
    print(f"\n{SEPARATOR}")
    print("[2] Loading active prompts from DB...")
    print(SEPARATOR)
    conn = get_connection()
    prompts = _load_active_prompts(conn)
    conn.close()
    content_prompt = prompts["ContentImprovement"]
    cannibal_prompt = prompts["Cannibalization"]
    print(f"  ContentImprovement : {content_prompt.VersionLabel}")
    print(f"  Cannibalization    : {cannibal_prompt.VersionLabel}")

    # ── Step 4: Build full content prompt ─────────────────────────────────
    page_dict = {
        "PageURL":        final_url,
        "MetaTitle":      data.get("MetaTitle"),
        "MetaDescription":data.get("MetaDescription"),
        "H1":             data.get("H1"),
        "H2s":            data.get("H2s"),
        "H3s":            data.get("H3s"),
        "BodyContent":    body,
        "WordCount":      data.get("WordCount"),
        "CanonicalURL":   data.get("CanonicalURL"),
        "SchemaMarkup":   data.get("SchemaMarkup"),
    }

    sys_p, user_msg = _build_content_prompt(content_prompt, page_dict)

    print(f"\n{SEPARATOR}")
    print(f"SYSTEM PROMPT  ({len(sys_p):,} chars  /  ~{len(sys_p)//4:,} tokens)")
    print(SEPARATOR)
    print(sys_p)

    print(f"\n{SEPARATOR}")
    print(f"USER MESSAGE  ({len(user_msg):,} chars  /  ~{len(user_msg)//4:,} tokens)")
    print(SEPARATOR)
    print(user_msg)

    # ── Step 5: Token summary ──────────────────────────────────────────────
    total_in  = len(sys_p) + len(user_msg)
    est_in    = total_in // 4
    print(f"\n{SEPARATOR}")
    print("TOKEN ESTIMATE")
    print(SEPARATOR)
    print(f"  System prompt  : {len(sys_p):,} chars  (~{len(sys_p)//4:,} tokens)")
    print(f"  User message   : {len(user_msg):,} chars  (~{len(user_msg)//4:,} tokens)")
    print(f"  TOTAL INPUT    : {total_in:,} chars  (~{est_in:,} tokens)")
    print(f"  Max output     : 8,192 tokens")
    print(f"  TOTAL per call : ~{est_in + 8192:,} tokens")
    print()


if __name__ == "__main__":
    if len(sys.argv) < 2:
        print(__doc__)
        sys.exit(1)
    dry_run(sys.argv[1])
