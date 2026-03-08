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

# Pricing per million tokens (USD).
# Update when Anthropic changes rates: https://www.anthropic.com/pricing
# Format: model_prefix -> (input_$/M, output_$/M)
CLAUDE_PRICING: dict = {
    "claude-opus-4":          (15.00, 75.00),
    "claude-sonnet-4":        ( 3.00, 15.00),
    "claude-haiku-4":         ( 0.80,  4.00),
    "claude-3-5-sonnet":      ( 3.00, 15.00),
    "claude-3-5-haiku":       ( 0.80,  4.00),
    "claude-3-opus":          (15.00, 75.00),
    "claude-3-sonnet":        ( 3.00, 15.00),
    "claude-3-haiku":         ( 0.25,  1.25),
}
# Fallback if model not in dict
CLAUDE_PRICING_DEFAULT = (3.00, 15.00)

# Prompt caching pricing multipliers (applied to the base input price).
# Cache write: first time content is cached — costs 25 % MORE than normal input.
# Cache read:  subsequent hits                — costs only 10 % of normal input.
# Source: https://www.anthropic.com/pricing (Prompt Caching section)
CACHE_WRITE_MULTIPLIER = 1.25
CACHE_READ_MULTIPLIER  = 0.10

# Hard limit: if the estimated input token count exceeds this value the Claude
# call is skipped and logged as SKIPPED in ClCode_ClaudeCallLog.
# Claude Sonnet 4 window is 200 K tokens; we reserve ~50 K for the response.
MAX_INPUT_TOKENS = 150_000  # tokens
MAX_INPUT_CHARS  = MAX_INPUT_TOKENS * 4  # rough 4 chars-per-token estimate

def get_model_pricing(model: str) -> tuple:
    """Return (input_$/M, output_$/M) for the given model string."""
    for prefix, prices in CLAUDE_PRICING.items():
        if model.startswith(prefix):
            return prices
    return CLAUDE_PRICING_DEFAULT


def get_model_cache_pricing(model: str) -> tuple:
    """Return (cache_write_$/M, cache_read_$/M) for the given model string."""
    in_price, _ = get_model_pricing(model)
    return (
        in_price * CACHE_WRITE_MULTIPLIER,
        in_price * CACHE_READ_MULTIPLIER,
    )

# ── Table prefix ───────────────────────────────────────────────────────────
# All managed tables use this prefix.
TP = "ClCode_"

# Source table for URLs.  ClCode_URLs is the new authoritative URL registry.
# URLs are managed via the AISEO Management web UI and imported from
# the legacy AISEO_PageSEOInputs table on first setup.
URL_SOURCE_TABLE  = "ClCode_URLs"
URL_SOURCE_COLUMN = "PageURL"
