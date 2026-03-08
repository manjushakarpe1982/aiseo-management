#!/usr/bin/env python3
"""
AISEO Management System — CLI entry point.

Usage
-----
  # First-time setup (create tables, seed admin + prompts):
  python run_scan.py setup

  # Run a full scan (use UserID 1 = default admin):
  python run_scan.py scan --name "March 2026 Full Audit" --user 1

  # Export Excel report for a completed scan:
  python run_scan.py report --scan-id 3

  # Activate a new prompt version (interactive):
  python run_scan.py activate-prompt --type Cannibalization \\
      --system-file prompts/cannibal_system.txt \\
      --user-file prompts/cannibal_user.txt \\
      --label "v2 - added guardrail 8" --user 1

  # Update an issue status:
  python run_scan.py update-status --type cannibalization --id 42 \\
      --status Acted --user 1 --comment "Fixed meta title on CMS"

  # Verify fixes after a new scan:
  python run_scan.py verify-fixes --scan-id 4

  # List prompts:
  python run_scan.py list-prompts
"""

import argparse
import sys


def cmd_setup(_args) -> None:
    from aiseo.setup import run_setup
    run_setup()


def _parse_url_filters(filter_list):
    """Convert ['silver-coins:10', 'silver-bars:10'] → [('silver-coins', 10), ('silver-bars', 10)]."""
    result = []
    for f in (filter_list or []):
        parts = f.rsplit(":", 1)
        if len(parts) == 2:
            pattern, count_str = parts
            try:
                result.append((pattern.strip(), int(count_str)))
            except ValueError:
                print(f"  WARNING: Invalid --url-filter '{f}' (expected pattern:count) — skipped")
        else:
            print(f"  WARNING: Invalid --url-filter '{f}' (expected pattern:count) — skipped")
    return result if result else None


def cmd_scan(args) -> None:
    from aiseo.scanner import run_scan
    url_filters = _parse_url_filters(args.url_filters) if args.url_filters else None
    scan_id = run_scan(
        scan_name=args.name,
        user_id=args.user,
        limit=args.limit,
        url_filters=url_filters,
        skip_keyword=args.skip_keyword,
        skip_cannibalization=args.skip_cannibalization,
        skip_content=args.skip_content,
    )
    print(f"Scan finished. ScanID = {scan_id}")
    if args.report:
        from aiseo.reporting import generate_report
        generate_report(scan_id)


def cmd_report(args) -> None:
    from aiseo.reporting import generate_report
    generate_report(args.scan_id, output_dir=args.output_dir)


def cmd_activate_prompt(args) -> None:
    from aiseo.prompt_manager import activate_prompt

    if args.system_file:
        with open(args.system_file, encoding="utf-8") as f:
            system_prompt = f.read()
    else:
        print("Enter SYSTEM prompt (end with a line containing only '---END---'):")
        lines = []
        for line in sys.stdin:
            if line.strip() == "---END---":
                break
            lines.append(line)
        system_prompt = "".join(lines)

    if args.user_file:
        with open(args.user_file, encoding="utf-8") as f:
            user_template = f.read()
    else:
        print("Enter USER PROMPT TEMPLATE (end with '---END---'):")
        lines = []
        for line in sys.stdin:
            if line.strip() == "---END---":
                break
            lines.append(line)
        user_template = "".join(lines)

    activate_prompt(
        prompt_type=args.type,
        system_prompt=system_prompt,
        user_template=user_template,
        version_label=args.label,
        user_id=args.user,
    )


def cmd_update_status(args) -> None:
    from aiseo.actions import update_issue_status
    update_issue_status(
        entity_type=args.type,
        entity_id=args.id,
        new_status=args.status,
        user_id=args.user,
        comment=args.comment,
        deferred_reason=args.deferred_reason,
    )


def cmd_verify_fixes(args) -> None:
    from aiseo.actions import verify_fixes
    verify_fixes(new_scan_id=args.scan_id)


def cmd_list_prompts(args) -> None:
    from aiseo.prompt_manager import list_prompts
    list_prompts(prompt_type=getattr(args, "type", None))


# ── Argument parser ───────────────────────────────────────────────────────

def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="run_scan.py",
        description="AISEO Management System CLI",
    )
    sub = parser.add_subparsers(dest="command", required=True)

    # setup
    sub.add_parser("setup", help="Create tables + seed admin + prompts")

    # scan
    p_scan = sub.add_parser("scan", help="Run a full SEO scan")
    p_scan.add_argument("--name",   required=True, help="Human-readable scan name")
    p_scan.add_argument("--user",   type=int, default=1, help="UserID (default: 1)")
    p_scan.add_argument("--limit", type=int, default=None,
                        help="Only process first N URLs (for testing)")
    p_scan.add_argument(
        "--url-filters", nargs="*", default=None, metavar="PATTERN:COUNT",
        help=(
            "Filter URLs by pattern with per-pattern limits. "
            "Format: pattern:count  (space-separated pairs). "
            "Example: --url-filters silver-coins:10 silver-bars:10"
        ),
    )
    p_scan.add_argument("--skip-keyword", action="store_true",
                        help="Skip Phase 4a: Keyword Extraction")
    p_scan.add_argument("--skip-cannibalization", action="store_true",
                        help="Skip Phase 4b: Cannibalization Analysis")
    p_scan.add_argument("--skip-content", action="store_true",
                        help="Skip Phase 4c: Content Improvement")
    p_scan.add_argument("--report", action="store_true",
                        help="Auto-generate Excel report after scan completes")

    # report
    p_rep = sub.add_parser("report", help="Export Excel report for a scan")
    p_rep.add_argument("--scan-id",    type=int, required=True)
    p_rep.add_argument("--output-dir", default=".", help="Directory for the .xlsx file")

    # activate-prompt
    p_ap = sub.add_parser("activate-prompt", help="Activate a new prompt version")
    p_ap.add_argument("--type",        required=True,
                      choices=["KeywordExtraction", "Cannibalization", "ContentImprovement"])
    p_ap.add_argument("--system-file", help="Path to file containing SystemPrompt text")
    p_ap.add_argument("--user-file",   help="Path to file containing UserPromptTemplate text")
    p_ap.add_argument("--label",       required=True, help="Version label, e.g. 'v3 - added rule'")
    p_ap.add_argument("--user",        type=int, default=1)

    # update-status
    p_us = sub.add_parser("update-status", help="Update issue/improvement status")
    p_us.add_argument("--type",    required=True, choices=["cannibalization", "improvement"])
    p_us.add_argument("--id",      type=int, required=True)
    p_us.add_argument("--status",  required=True, choices=["Yet to Act", "Acted", "Deferred"])
    p_us.add_argument("--user",    type=int, default=1)
    p_us.add_argument("--comment", default=None)
    p_us.add_argument("--deferred-reason", default=None)

    # verify-fixes
    p_vf = sub.add_parser("verify-fixes", help="Mark improvements verified after new scan")
    p_vf.add_argument("--scan-id", type=int, required=True,
                      help="The new ScanID to compare against")

    # list-prompts
    p_lp = sub.add_parser("list-prompts", help="List all prompt versions")
    p_lp.add_argument("--type", default=None,
                      choices=["KeywordExtraction", "Cannibalization", "ContentImprovement"])

    return parser


def main() -> None:
    parser = build_parser()
    args = parser.parse_args()

    dispatch = {
        "setup":           cmd_setup,
        "scan":            cmd_scan,
        "report":          cmd_report,
        "activate-prompt": cmd_activate_prompt,
        "update-status":   cmd_update_status,
        "verify-fixes":    cmd_verify_fixes,
        "list-prompts":    cmd_list_prompts,
    }
    dispatch[args.command](args)


if __name__ == "__main__":
    main()
