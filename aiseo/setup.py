"""
Steps 1–3 from the AISEO Master Design Document v2.

Step 1 — Create all 9 ClCode_ tables (idempotent).
Step 2 — Seed default admin user if not present.
Step 3 — Seed / upgrade prompts:
           KeywordExtraction v1   (new)
           Cannibalization   v2   (keyword-map driven)
           ContentImprovement v3  (keyword-context + Marcus Reid expert body rules)
"""

import bcrypt
from datetime import datetime

from .db import get_connection
from .config import TP

# ── Prompt texts ──────────────────────────────────────────────────────────

# ── KeywordExtraction v1 ──────────────────────────────────────────────────

KEYWORD_SYSTEM_PROMPT = """\
You are an expert SEO analyst specialising in precious metals ecommerce.

You will be given data for a single product listing page. Extract the primary
keyword, secondary keywords, search intent, keyword gaps, and missing LSI terms
to support cannibalization detection and content improvement.

STRICT RULES — you must follow these without exception:

1. PRIMARY KEYWORD
   Derive the single most important keyword phrase this page should rank for.
   Use the URL slug as the primary signal — it reflects the SEO team's explicit
   intent. Cross-reference with H1 and MetaTitle to confirm. Keep it 2–5 words.
   Examples: "1 oz silver coins", "silver maple leaf coins", "buy gold bars"

2. SECONDARY KEYWORDS
   List 3–6 supporting phrases explicitly present in MetaTitle, H1,
   MetaDescription, H2s, or BodyContent. Do not invent phrases absent from
   the provided data.

3. SEARCH INTENT — MANDATORY RULE, CANNOT BE OVERRIDDEN
   This is a precious metals product listing page. You MUST always return:
     "search_intent": "transactional"
   No exceptions. Do not return "informational", "navigational", or any other
   value. Any deviation will be treated as a system error and rejected.

4. KEYWORD GAPS
   Identify 2–4 high-value phrases that are NOT present in the current data
   but would naturally appear on a well-optimised page targeting the primary
   keyword. Base these solely on the primary keyword.

5. MISSING LSI TERMS
   List 3–5 latent semantic indexing terms absent from the page but
   semantically related to the primary keyword.
   Example for "silver coins": "legal tender", "troy ounce", "numismatic",
   "brilliant uncirculated", "face value"

6. CONTENT FOCUS SCORE
   Rate 1–10 how tightly the current BodyContent focuses on the primary
   keyword. 10 = every sentence directly targets the primary keyword.
   Base this ONLY on the BodyContent field provided.

7. Return ONLY the JSON object. No preamble. No markdown fences.\
"""

KEYWORD_USER_TEMPLATE = """\
Extract keyword data for the following page.

Page data (JSON):
{PAGE_DATA}

Return a SINGLE JSON object (not an array):
{
  "primary_keyword": "2-5 word phrase from URL slug + H1 + MetaTitle",
  "secondary_keywords": ["phrase 1", "phrase 2", "phrase 3"],
  "search_intent": "transactional",
  "keyword_gaps": ["gap phrase 1", "gap phrase 2"],
  "missing_lsi_terms": ["lsi term 1", "lsi term 2", "lsi term 3"],
  "content_focus_score": 7
}

Return ONLY the JSON object. No preamble. No markdown fences.\
"""

# ── Cannibalization v2 (keyword-map driven) ───────────────────────────────

CANNIBAL_SYSTEM_PROMPT = """\
You are an expert SEO analyst specialising in ecommerce bullion websites.

You will be given:
  1. KEYWORD MAP — pre-extracted primary keyword, secondary keywords, and
     search intent for each page in the cluster (from a prior analysis step).
  2. PAGE DATA — full scraped fields (MetaTitle, H1, MetaDescription, H2s,
     H3s, BodyContent excerpt) for evidence only.

Your task: identify keyword cannibalization where multiple pages target the
same or near-identical primary keyword.

STRICT RULES — you must follow these without exception:

1. Use KEYWORD MAP as your primary signal. Two pages cannibalize each other if
   their primary_keyword phrases are the same or near-identical (allowing word
   order variation). Secondary keyword overlap alone does NOT qualify.

2. Populate url_current_content fields using PAGE DATA ONLY. Copy values
   EXACTLY as they appear — do not paraphrase, shorten, or alter them.

3. Do NOT flag pages differentiated by a weight or size specifier
   (e.g. "1 oz silver bars" vs "10 oz silver bars") — these serve distinct
   search intents.

4. If a page has a null, empty, or missing field, treat that field as absent.
   Do not assume what it might contain.

5. Severity rules:
   - High:   identical primary keywords AND near-identical MetaTitle + H1
   - Medium: same primary keyword, meaningful differences in MetaTitle or H1
   - Low:    overlapping secondary keywords only (distinct primary keywords)

6. If no clear, evidence-based cannibalization exists, return an empty array.
   Do not fabricate issues.\
"""

CANNIBAL_USER_TEMPLATE = """\
Analyse the "{TREE_NAME}" cluster for keyword cannibalization.

KEYWORD MAP (primary signal — use this to identify overlap):
{KEYWORD_MAP}

PAGE DATA (evidence only — copy field values exactly from here):
{TREE_DATA}

For EACH cannibalization issue found, return a JSON array:
[
  {
    "cannibal_keyword": "shared primary keyword phrase",
    "severity": "High|Medium|Low",
    "severity_reason": "one sentence citing which keyword map and page data fields triggered this level",
    "url1": "first competing URL",
    "url1_field": "MetaTitle|MetaDescription|H1|H2|H3",
    "url1_current_content": "exact value from PAGE DATA — do not alter",
    "url1_suggested_fix": "specific rewrite removing overlap, preserving intent",
    "url2": "second competing URL",
    "url2_field": "MetaTitle|MetaDescription|H1|H2|H3",
    "url2_current_content": "exact value from PAGE DATA — do not alter",
    "url2_suggested_fix": "specific rewrite removing overlap, preserving intent",
    "overall_recommendation": "consolidate|differentiate|redirect|canonical — one sentence why",
    "reasoning": "cite exact overlapping primary keywords, which page data fields confirm, and SERP impact"
  }
]

Return ONLY the JSON array. No preamble. No markdown fences.
If no qualifying cannibalization is found, return: []\
"""

# ── ContentImprovement v3 (keyword-context + Marcus Reid expert body rules) ─

CONTENT_SYSTEM_PROMPT = """\
You are an expert SEO content strategist specialising in precious metals
ecommerce. You will be given a product listing page with its scraped content
AND keyword analysis data (primary keyword, secondary keywords, keyword gaps,
and missing LSI terms) previously extracted for that page.

Use the keyword data to guide every suggestion:
- Verify the primary keyword appears in MetaTitle, H1, and MetaDescription
- Check that secondary keywords are present and used naturally
- Flag keyword gaps as opportunities to add new content sections
- Suggest missing LSI terms to improve semantic depth

Note: this site has previously received Surfer SEO and Gemini suggestions.
Focus on improvements those tools typically miss: semantic depth, intent
alignment, E-E-A-T signals, and keyword differentiation.

STRICT RULES — you must follow these without exception:

1. ONLY analyse fields present in the JSON. Do not invent content for null,
   empty, or absent fields.

2. Null or empty string field → flag as issue_type "Missing Field", priority High.

3. All suggestions must be based solely on the provided field values and
   keyword analysis. No invented competitor data or rankings.

4. Field length thresholds (strict character counts):
   - MetaTitle:       Too Short < 50 chars  |  Too Long > 60 chars
   - MetaDescription: Too Short < 140 chars |  Too Long > 160 chars
   - H1:              Missing Keyword only if primary keyword is genuinely absent
   - BodyContent:     Thin Content only if WordCount < 300

5. Do NOT flag a field that already meets its threshold.

6. current_content must be copied EXACTLY from the JSON — no alterations.

7. suggested_content must be complete and ready to publish. No placeholders.

8. Do not invent competitor data, rankings, or search volumes.

── BODY CONTENT: EXPERT WRITING RULES ────────────────────────────────────────
Apply the following rules ONLY when field_name = "BodyContent". Write the
suggested body content from the perspective of an experienced bullion dealer
with 20+ years in the physical market.

a. NO WALLS OF TEXT — maximum 3 lines per paragraph.

b. DYNAMIC COMPARISON TABLE — if the content covers 2 or more products or
   variants, open the suggested_content with an HTML table.
   - DO NOT hardcode generic headers. Analyse the specific products mentioned
     and select the 3–4 most relevant metrics (e.g. Purity, Mint Security,
     Buy-back Spread, Investor Intent).
   - Format: <th>Metric</th> followed by <th>[Product Name]</th>.

c. E-E-A-T SIGNALS — include all three in every BodyContent suggestion:
   - "Overlooked Fact": a detail about physical handling or market friction
     that most buyers ignore.
   - "Liquidity Score": a brief professional assessment of how easily this
     item sells back to a dealer.
   - "Marcus Verdict": a 1-sentence bottom line for a serious stacker.

d. Use bullet points for any "Insider Nuances" or tips section.

e. reasoning for BodyContent must start with:
   "Marcus Verdict: <1-sentence>. Overlooked Fact: <detail>. Liquidity: <score>."
──────────────────────────────────────────────────────────────────────────────\
"""

CONTENT_USER_TEMPLATE = """\
Analyse the following page for SEO content improvements.

KEYWORD ANALYSIS (use these to guide all suggestions):
  Primary Keyword   : {PRIMARY_KEYWORD}
  Secondary Keywords: {SECONDARY_KEYWORDS}
  Search Intent     : {SEARCH_INTENT}
  Keyword Gaps      : {KEYWORD_GAPS}
  Missing LSI Terms : {MISSING_LSI_TERMS}

Page data (JSON):
{PAGE_DATA}

CHECKLIST before generating suggestions:
- Does MetaTitle contain the primary keyword? (flag Missing Keyword if not)
- Does H1 contain the primary keyword? (flag Missing Keyword if not)
- Does MetaDescription contain the primary keyword? (flag if not)
- Are there keyword gaps to address? (flag each as issue_type "Keyword Gap")
- Are missing LSI terms absent from BodyContent? (flag as issue_type "No LSI")
- MetaTitle: flag only if < 50 or > 60 chars
- MetaDescription: flag only if < 140 or > 160 chars
- WordCount < 300 → Thin Content
- Null/empty fields → Missing Field, High priority
- Copy all current_content values EXACTLY from JSON
- For BodyContent: apply the Expert Writing Rules from the system prompt
  (comparison table if applicable, Overlooked Fact, Liquidity Score, Marcus Verdict)

For EACH improvement needed, return a JSON array:
[
  {
    "field_name": "MetaTitle|MetaDescription|H1|H2|BodyContent|SchemaMarkup",
    "current_content": "exact value from JSON — do not alter",
    "current_char_count": 0,
    "suggested_content": "complete ready-to-publish replacement — no placeholders",
    "suggested_char_count": 0,
    "issue_type": "Too Short|Too Long|Missing Keyword|Missing Field|Thin Content|Keyword Stuffed|Poor Structure|No LSI|Duplicate|Keyword Gap|Expert Content",
    "reasoning": "cite exact char count or keyword gap — no invented data. For BodyContent start with: Marcus Verdict: ... Overlooked Fact: ... Liquidity: ...",
    "priority": "High|Medium|Low",
    "impact_estimate": "CTR Impact|Rankings|Featured Snippet|E-E-A-T|Crawlability"
  }
]

Return ONLY the JSON array. No preamble. No markdown fences.
If a field meets all thresholds and has no genuine issue, omit it.\
"""


# ── Helpers ───────────────────────────────────────────────────────────────

def _table_exists(cursor, name: str) -> bool:
    cursor.execute(
        "SELECT 1 FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME = ?", (name,)
    )
    return cursor.fetchone() is not None


def _column_exists(cursor, table: str, column: str) -> bool:
    cursor.execute(
        "SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = ? AND COLUMN_NAME = ?",
        (table, column)
    )
    return cursor.fetchone() is not None


# ── Step 1: Create tables ─────────────────────────────────────────────────

def create_tables(conn) -> None:
    cursor = conn.cursor()
    created = []

    # 1. ClCode_Users
    t = f"{TP}Users"
    if not _table_exists(cursor, t):
        cursor.execute(f"""
            CREATE TABLE {t} (
                UserID          INT IDENTITY PRIMARY KEY,
                FullName        NVARCHAR(200)   NOT NULL,
                Email           NVARCHAR(200)   NOT NULL UNIQUE,
                PasswordHash    NVARCHAR(500)   NOT NULL,
                Role            NVARCHAR(50)    NOT NULL,
                IsActive        BIT             NOT NULL DEFAULT 1,
                CreatedAt       DATETIME        NOT NULL,
                CreatedByUserID INT             NULL,
                LastLoginAt     DATETIME        NULL
            )
        """)
        created.append(t)

    # 2. ClCode_Prompts
    t = f"{TP}Prompts"
    if not _table_exists(cursor, t):
        cursor.execute(f"""
            CREATE TABLE {t} (
                PromptID            INT IDENTITY PRIMARY KEY,
                PromptType          NVARCHAR(50)    NOT NULL,
                VersionNumber       INT             NOT NULL,
                VersionLabel        NVARCHAR(200)   NOT NULL,
                SystemPrompt        NVARCHAR(MAX)   NOT NULL,
                UserPromptTemplate  NVARCHAR(MAX)   NOT NULL,
                IsActive            BIT             NOT NULL DEFAULT 0,
                Notes               NVARCHAR(MAX)   NULL,
                CreatedAt           DATETIME        NOT NULL,
                CreatedByUserID     INT             NOT NULL,
                DeactivatedAt       DATETIME        NULL,
                DeactivatedByUserID INT             NULL
            )
        """)
        created.append(t)

    # 3. ClCode_Scans
    t = f"{TP}Scans"
    if not _table_exists(cursor, t):
        cursor.execute(f"""
            CREATE TABLE {t} (
                ScanID                  INT IDENTITY PRIMARY KEY,
                RunID                   NVARCHAR(100)   NOT NULL,
                ScanName                NVARCHAR(200)   NOT NULL,
                StartedAt               DATETIME        NOT NULL,
                EndedAt                 DATETIME        NULL,
                StartedByUserID         INT             NOT NULL,
                TotalURLs               INT             NOT NULL,
                URLsScraped             INT             NOT NULL DEFAULT 0,
                TreesAnalysed           INT             NOT NULL DEFAULT 0,
                Status                  NVARCHAR(50)    NOT NULL,
                CannibalizationPromptID INT             NOT NULL,
                ContentPromptID         INT             NOT NULL,
                ErrorLog                NVARCHAR(MAX)   NULL,
                Notes                   NVARCHAR(MAX)   NULL,
                CreatedAt               DATETIME        NOT NULL,
                CreatedByUserID         INT             NOT NULL
            )
        """)
        created.append(t)

    # 4. ClCode_ScrapedPages
    t = f"{TP}ScrapedPages"
    if not _table_exists(cursor, t):
        cursor.execute(f"""
            CREATE TABLE {t} (
                PageID          INT IDENTITY PRIMARY KEY,
                ScanID          INT             NOT NULL,
                PageURL         NVARCHAR(500)   NOT NULL,
                MetaTitle       NVARCHAR(500)   NULL,
                MetaDescription NVARCHAR(1000)  NULL,
                H1              NVARCHAR(500)   NULL,
                H2s             NVARCHAR(MAX)   NULL,
                H3s             NVARCHAR(MAX)   NULL,
                H4s             NVARCHAR(MAX)   NULL,
                H5s             NVARCHAR(MAX)   NULL,
                H6s             NVARCHAR(MAX)   NULL,
                BodyContent     NVARCHAR(MAX)   NULL,
                WordCount       INT             NULL,
                CanonicalURL    NVARCHAR(500)   NULL,
                SchemaMarkup    NVARCHAR(MAX)   NULL,
                InternalLinks   NVARCHAR(MAX)   NULL,
                ImageAltTags    NVARCHAR(MAX)   NULL,
                TreeCluster     NVARCHAR(200)   NULL,
                ScrapedAt       DATETIME        NOT NULL,
                ScrapeStatus    NVARCHAR(50)    NOT NULL,
                ScrapeError     NVARCHAR(MAX)   NULL
            )
        """)
        created.append(t)

    # 5. ClCode_CannibalizationIssues
    t = f"{TP}CannibalizationIssues"
    if not _table_exists(cursor, t):
        cursor.execute(f"""
            CREATE TABLE {t} (
                IssueID                 INT IDENTITY PRIMARY KEY,
                ScanID                  INT             NOT NULL,
                PromptID                INT             NOT NULL,
                TreeCluster             NVARCHAR(200)   NULL,
                CannibalKeyword         NVARCHAR(500)   NULL,
                Severity                NVARCHAR(50)    NULL,
                SeverityReason          NVARCHAR(500)   NULL,
                URL1                    NVARCHAR(500)   NULL,
                URL1_FieldName          NVARCHAR(100)   NULL,
                URL1_CurrentContent     NVARCHAR(MAX)   NULL,
                URL1_SuggestedFix       NVARCHAR(MAX)   NULL,
                URL2                    NVARCHAR(500)   NULL,
                URL2_FieldName          NVARCHAR(100)   NULL,
                URL2_CurrentContent     NVARCHAR(MAX)   NULL,
                URL2_SuggestedFix       NVARCHAR(MAX)   NULL,
                OverallRecommendation   NVARCHAR(MAX)   NULL,
                Reasoning               NVARCHAR(MAX)   NULL,
                Status                  NVARCHAR(50)    NOT NULL DEFAULT 'Yet to Act',
                LastAuditedByUserID     INT             NULL,
                LastAuditedAt           DATETIME        NULL,
                UserComment             NVARCHAR(MAX)   NULL,
                DeferredReason          NVARCHAR(MAX)   NULL,
                VerifiedFixed           BIT             NOT NULL DEFAULT 0,
                VerifiedInScanID        INT             NULL,
                CreatedAt               DATETIME        NOT NULL
            )
        """)
        created.append(t)

    # 6. ClCode_ContentImprovements
    t = f"{TP}ContentImprovements"
    if not _table_exists(cursor, t):
        cursor.execute(f"""
            CREATE TABLE {t} (
                ImprovementID       INT IDENTITY PRIMARY KEY,
                ScanID              INT             NOT NULL,
                PromptID            INT             NOT NULL,
                TreeCluster         NVARCHAR(200)   NULL,
                PageURL             NVARCHAR(500)   NOT NULL,
                FieldName           NVARCHAR(100)   NULL,
                CurrentContent      NVARCHAR(MAX)   NULL,
                CurrentCharCount    INT             NULL,
                SuggestedContent    NVARCHAR(MAX)   NULL,
                SuggestedCharCount  INT             NULL,
                IssueType           NVARCHAR(200)   NULL,
                Reasoning           NVARCHAR(MAX)   NULL,
                Priority            NVARCHAR(50)    NULL,
                ImpactEstimate      NVARCHAR(200)   NULL,
                Status              NVARCHAR(50)    NOT NULL DEFAULT 'Yet to Act',
                LastAuditedByUserID INT             NULL,
                LastAuditedAt       DATETIME        NULL,
                UserComment         NVARCHAR(MAX)   NULL,
                DeferredReason      NVARCHAR(MAX)   NULL,
                VerifiedFixed       BIT             NOT NULL DEFAULT 0,
                VerifiedInScanID    INT             NULL,
                CreatedAt           DATETIME        NOT NULL
            )
        """)
        created.append(t)

    # 7. ClCode_AuditLog
    t = f"{TP}AuditLog"
    if not _table_exists(cursor, t):
        cursor.execute(f"""
            CREATE TABLE {t} (
                AuditID         INT IDENTITY PRIMARY KEY,
                AuditedByUserID INT             NOT NULL,
                AuditedAt       DATETIME        NOT NULL,
                EntityType      NVARCHAR(100)   NULL,
                EntityID        INT             NULL,
                EntityURL       NVARCHAR(500)   NULL,
                EntityField     NVARCHAR(100)   NULL,
                ActionType      NVARCHAR(100)   NOT NULL,
                OldValue        NVARCHAR(MAX)   NULL,
                NewValue        NVARCHAR(MAX)   NULL,
                Comment         NVARCHAR(MAX)   NULL,
                IPAddress       NVARCHAR(50)    NOT NULL DEFAULT '0.0.0.0',
                SessionID       NVARCHAR(200)   NULL
            )
        """)
        created.append(t)

    # 8. ClCode_PageKeywords  (Phase 4a output — keyword extraction per page)
    t = f"{TP}PageKeywords"
    if not _table_exists(cursor, t):
        cursor.execute(f"""
            CREATE TABLE {t} (
                KeywordID           INT IDENTITY PRIMARY KEY,
                ScanID              INT             NOT NULL,
                PromptID            INT             NOT NULL,
                PageURL             NVARCHAR(500)   NOT NULL,
                TreeCluster         NVARCHAR(200)   NULL,
                PrimaryKeyword      NVARCHAR(300)   NULL,
                SecondaryKeywords   NVARCHAR(MAX)   NULL,
                SearchIntent        NVARCHAR(100)   NULL,
                KeywordGaps         NVARCHAR(MAX)   NULL,
                MissingLSITerms     NVARCHAR(MAX)   NULL,
                ContentFocusScore   INT             NULL,
                CreatedAt           DATETIME        NOT NULL
            )
        """)
        created.append(t)

    # 9. ClCode_ClaudeCallLog  (full input/output log for every Claude API call)
    t = f"{TP}ClaudeCallLog"
    if not _table_exists(cursor, t):
        cursor.execute(f"""
            CREATE TABLE {t} (
                CallID                  INT IDENTITY PRIMARY KEY,
                ScanID                  INT             NOT NULL,
                CallType                NVARCHAR(50)    NOT NULL,
                EntityURL               NVARCHAR(500)   NULL,
                SystemPrompt            NVARCHAR(MAX)   NULL,
                UserMessage             NVARCHAR(MAX)   NULL,
                RawResponse             NVARCHAR(MAX)   NULL,
                CallSucceeded           BIT             NOT NULL DEFAULT 0,
                InputCharsEstimate      INT             NULL,
                OutputCharsEstimate     INT             NULL,
                CalledAt                DATETIME        NOT NULL,
                DurationMs              INT             NULL,
                ErrorMessage            NVARCHAR(MAX)   NULL
            )
        """)
        created.append(t)

    # ── Migration: add token + cost + cache columns to ClCode_ClaudeCallLog ──
    # These columns were added after initial release; safe to run repeatedly.
    for col, definition in [
        ("InputTokens",      "INT NULL"),
        ("OutputTokens",     "INT NULL"),
        ("CostUSD",          "DECIMAL(10,6) NULL"),
        ("CacheWriteTokens", "INT NULL"),   # tokens written to prompt cache (first call)
        ("CacheReadTokens",  "INT NULL"),   # tokens read from prompt cache (subsequent calls)
    ]:
        cursor.execute(
            "SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS "
            "WHERE TABLE_NAME = ? AND COLUMN_NAME = ?",
            (f"{TP}ClaudeCallLog", col),
        )
        if cursor.fetchone()[0] == 0:
            cursor.execute(f"ALTER TABLE {TP}ClaudeCallLog ADD {col} {definition}")
            print(f"  Migration: added column {TP}ClaudeCallLog.{col}")

    # 10. ClCode_Settings  (master variables — e.g. ANTHROPIC_API_KEY)
    t = f"{TP}Settings"
    if not _table_exists(cursor, t):
        cursor.execute(f"""
            CREATE TABLE {t} (
                SettingKey      NVARCHAR(100)   NOT NULL PRIMARY KEY,
                SettingValue    NVARCHAR(1000)  NOT NULL DEFAULT '',
                Description     NVARCHAR(500)   NULL,
                UpdatedAt       DATETIME        NOT NULL DEFAULT GETUTCDATE(),
                UpdatedByUserID INT             NULL
            )
        """)
        created.append(t)

    conn.commit()

    if created:
        for name in created:
            print(f"  Created {name}")
    else:
        print("  All tables already exist — skipped.")


# ── Step 2: Seed admin user ───────────────────────────────────────────────

DEFAULT_ADMIN_PASSWORD = "Admin@2024!"


def seed_admin(conn) -> None:
    cursor = conn.cursor()
    cursor.execute(
        f"SELECT UserID FROM {TP}Users WHERE Email = ?",
        ("admin@boldpreciousmetals.com",),
    )
    if cursor.fetchone():
        print("  Admin user already exists — skipped.")
        return

    pwd_hash = bcrypt.hashpw(
        DEFAULT_ADMIN_PASSWORD.encode(), bcrypt.gensalt()
    ).decode()
    now = datetime.utcnow()

    cursor.execute(
        f"""
        INSERT INTO {TP}Users
            (FullName, Email, PasswordHash, Role, IsActive, CreatedAt)
        VALUES (?, ?, ?, ?, 1, ?)
        """,
        ("System Admin", "admin@boldpreciousmetals.com", pwd_hash, "Admin", now),
    )
    conn.commit()
    print(f"  Seeded admin:  admin@boldpreciousmetals.com  /  {DEFAULT_ADMIN_PASSWORD}")
    print("  *** Rotate this password before production use ***")


# ── Step 3: Seed / upgrade prompts ────────────────────────────────────────

def seed_prompts(conn) -> None:
    """
    Seed or upgrade prompts to the latest required versions.
    Each (PromptType, VersionNumber) pair is inserted at most once.
    When a new version is inserted, the previous active version is deactivated.
    """
    cursor = conn.cursor()
    cursor.execute(
        f"SELECT UserID FROM {TP}Users WHERE Email = ?",
        ("admin@boldpreciousmetals.com",),
    )
    row = cursor.fetchone()
    admin_id = row[0] if row else 1
    now = datetime.utcnow()

    # Each entry: (type, version_number, version_label, sys_prompt, user_template, notes)
    prompts_to_seed = [
        (
            "KeywordExtraction", 1,
            "v1 - URL slug + transactional intent enforcement",
            KEYWORD_SYSTEM_PROMPT,
            KEYWORD_USER_TEMPLATE,
            "Extracts primary keyword, secondary keywords, search intent, keyword gaps, "
            "and missing LSI terms. Enforces transactional intent for all PLPs.",
        ),
        (
            "Cannibalization", 2,
            "v2 - keyword-map driven detection",
            CANNIBAL_SYSTEM_PROMPT,
            CANNIBAL_USER_TEMPLATE,
            "Uses pre-extracted keyword map (Phase 4a output) as primary signal for "
            "cannibalization detection. More accurate than raw field comparison.",
        ),
        (
            "ContentImprovement", 3,
            "v3 - keyword-context + Marcus Reid expert body content rules",
            CONTENT_SYSTEM_PROMPT,
            CONTENT_USER_TEMPLATE,
            "Adds expert body content writing rules (Marcus Reid persona): "
            "dynamic comparison tables, Overlooked Fact, Liquidity Score, "
            "Marcus Verdict, max 3 lines per paragraph, E-E-A-T signals.",
        ),
    ]

    seeded = []
    for (ptype, vnum, vlabel, sysp, usert, notes) in prompts_to_seed:
        # Check if this exact (type, version) already exists
        cursor.execute(
            f"SELECT COUNT(*) FROM {TP}Prompts WHERE PromptType = ? AND VersionNumber = ?",
            (ptype, vnum),
        )
        if cursor.fetchone()[0] > 0:
            print(f"  {ptype} v{vnum} already exists — skipped.")
            continue

        # Deactivate any currently active prompt of this type
        cursor.execute(
            f"UPDATE {TP}Prompts SET IsActive = 0 WHERE PromptType = ?",
            (ptype,),
        )

        cursor.execute(
            f"""
            INSERT INTO {TP}Prompts
                (PromptType, VersionNumber, VersionLabel, SystemPrompt,
                 UserPromptTemplate, IsActive, Notes, CreatedAt, CreatedByUserID)
            VALUES (?, ?, ?, ?, ?, 1, ?, ?, ?)
            """,
            (ptype, vnum, vlabel, sysp.strip(), usert.strip(), notes, now, admin_id),
        )
        seeded.append(f"{ptype} v{vnum}")

    conn.commit()

    if seeded:
        print(f"  Seeded prompts: {', '.join(seeded)}")
    else:
        print("  All required prompts already exist — skipped.")


# ── Step 4: Seed master settings ──────────────────────────────────────────

def seed_settings(conn) -> None:
    """
    Seed master settings into ClCode_Settings.
    Each key is inserted at most once — existing rows are never overwritten
    so that a user-configured value is never reset.
    """
    cursor = conn.cursor()

    settings_to_seed = [
        (
            "ANTHROPIC_API_KEY",
            "",
            "Claude API key — get yours at https://console.anthropic.com",
        ),
    ]

    seeded = []
    for key, default_val, desc in settings_to_seed:
        cursor.execute(
            f"SELECT COUNT(*) FROM {TP}Settings WHERE SettingKey = ?", (key,)
        )
        if cursor.fetchone()[0] > 0:
            print(f"  Setting '{key}' already exists — skipped.")
            continue
        cursor.execute(
            f"""
            INSERT INTO {TP}Settings (SettingKey, SettingValue, Description, UpdatedAt)
            VALUES (?, ?, ?, GETUTCDATE())
            """,
            (key, default_val, desc),
        )
        seeded.append(key)

    conn.commit()

    if seeded:
        print(f"  Seeded settings: {', '.join(seeded)}")
    else:
        print("  All required settings already exist — skipped.")


# ── Entry point ───────────────────────────────────────────────────────────

def run_setup() -> None:
    print("=== AISEO Setup  (table prefix: ClCode_) ===")
    conn = get_connection()
    try:
        print("Step 1 — Tables")
        create_tables(conn)
        print("Step 2 — Admin user")
        seed_admin(conn)
        print("Step 3 — Prompts")
        seed_prompts(conn)
        print("Step 4 — Settings")
        seed_settings(conn)
    finally:
        conn.close()
    print("=== Setup complete ===")


if __name__ == "__main__":
    run_setup()
