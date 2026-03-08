"""Central configuration.
All environment variables override the hard-coded defaults.
"""
import os

# ── SQL Server ─────────────────────────────────────────────────────────────
DB_SERVER = os.environ.get("AISEO_DB_SERVER", "106.201.231.27,58815")
DB_NAME   = os.environ.get("AISEO_DB_NAME",   "BPMStagging")
DB_UID    = os.environ.get("AISEO_DB_UID",    "sa")
DB_PWD    = os.environ.get("AISEO_DB_PWD",    "ash@2011")

# ── Claude API ─────────────────────────────────────────────────────────────
ANTHROPIC_API_KEY = os.environ.get("ANTHROPIC_API_KEY", "")
CLAUDE_MODEL      = "claude-sonnet-4-20250514"

# ── Table prefix ───────────────────────────────────────────────────────────
# All managed tables use this prefix.
TP = "ClCode_"

# Source table for URLs.  ClCode_URLs is the new authoritative URL registry.
# URLs are managed via the AISEO Management web UI and imported from
# the legacy AISEO_PageSEOInputs table on first setup.
URL_SOURCE_TABLE  = "ClCode_URLs"
URL_SOURCE_COLUMN = "PageURL"
