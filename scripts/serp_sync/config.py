"""
Central configuration for the SERP Sync scripts.
All values can be overridden via environment variables.
"""
import os

# ── Directory paths ────────────────────────────────────────────────────────
SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
KEYS_DIR   = os.environ.get("KEYS_DIR", r"C:\Github\Keys")

# ── SQL Server ─────────────────────────────────────────────────────────────
DB_SERVER = os.environ.get("AISEO_DB_SERVER", "106.201.231.27,58815")
DB_NAME   = os.environ.get("AISEO_DB_NAME",   "BPMStagging")
DB_UID    = os.environ.get("AISEO_DB_UID",    "sa")
DB_PWD    = os.environ.get("AISEO_DB_PWD",    "ash@2011")

# ── Google Search Console ──────────────────────────────────────────────────
# OAuth2 client credentials — must be "Desktop app" type (NOT "Web application").
# Create in Google Cloud Console → boldpreciousmetals project →
#   APIs & Services → Credentials → + Create Credentials → OAuth 2.0 Client ID
#   → Application type: Desktop app → Download JSON → save as bpm_gsc_desktop.json
GSC_CLIENT_SECRET_FILE = os.environ.get(
    "GSC_CLIENT_SECRET_FILE",
    os.path.join(KEYS_DIR, "bpm_gsc_desktop.json"),
)
# Token saved after first OAuth flow — reused on subsequent runs
GSC_TOKEN_FILE = os.environ.get(
    "GSC_TOKEN_FILE",
    os.path.join(SCRIPT_DIR, "gsc_token.json"),
)
# GSC property URL — must match exactly as verified in Search Console
# Use "sc-domain:boldpreciousmetals.com" for a Domain property instead
GSC_SITE_URL = os.environ.get(
    "GSC_SITE_URL",
    "https://www.boldpreciousmetals.com/",
)
# OAuth scopes required
GSC_SCOPES = ["https://www.googleapis.com/auth/webmasters.readonly"]

# ── Google Ads ─────────────────────────────────────────────────────────────
GOOGLE_ADS_YAML = os.environ.get(
    "GOOGLE_ADS_YAML",
    os.path.join(KEYS_DIR, "bpm_google_ads.yaml"),
)
# Customer ID to use for GenerateKeywordIdeas calls (without dashes)
GADS_CUSTOMER_ID = os.environ.get("GADS_CUSTOMER_ID", "4347785221")
# Geo target: 2840 = United States
GADS_GEO_TARGET = os.environ.get("GADS_GEO_TARGET", "geoTargetConstants/2840")
# Language: 1000 = English
GADS_LANGUAGE = os.environ.get("GADS_LANGUAGE", "languageConstants/1000")
# Max keywords per GenerateKeywordIdeas batch
GADS_BATCH_SIZE = int(os.environ.get("GADS_BATCH_SIZE", "1000"))

# ── Sync behaviour ─────────────────────────────────────────────────────────
# GSC data is delayed by ~2–4 days; default to 3 days ago
GSC_DATA_DELAY_DAYS = int(os.environ.get("GSC_DATA_DELAY_DAYS", "3"))

# Daily run time for the built-in Python scheduler (24h format, local time)
SCHEDULER_RUN_TIME = os.environ.get("SCHEDULER_RUN_TIME", "09:00")

# Log file (relative to script dir)
LOG_FILE = os.path.join(SCRIPT_DIR, "serp_sync.log")
