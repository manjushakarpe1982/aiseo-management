# SERP Sync — Automated Daily Metrics Fetcher

Fetches **SERP positions** from Google Search Console and **keyword search volumes** from Google Ads, then stores them day-wise in `ClCode_URLMetrics` so the AISEO Management UI can show charts and trends.

---

## How It Works

```
Daily (9 AM by default)
        │
        ▼
  [Google Search Console]          [Google Ads]
  searchAnalytics.query            KeywordPlanIdeaService
  → SERP position per URL          → avg monthly search volume
        │                                │
        └──────────────┬─────────────────┘
                       ▼
              ClCode_URLMetrics
              (upsert per URL per date)
                       │
                       ▼
           AISEO Web UI → SERP Tracker page
```

---

## One-Time Setup

### 1. Install Python dependencies

```bash
cd scripts/serp_sync
python -m venv venv
venv\Scripts\activate          # Windows
pip install -r requirements.txt
```

### 2. Enable Google Search Console API

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Select project **feisty-coast-486209-g9**
3. Navigate to **APIs & Services → Library**
4. Search for **"Google Search Console API"** and click **Enable**

### 3. Authenticate with Google Search Console (one-time only)

```bash
python auth_gsc.py
```

- Your browser will open Google's login page
- Sign in with the account that owns the Search Console property
- Grant the requested permission ("View Search Console data")
- A `gsc_token.json` file is saved next to the script
- **Done!** Future runs auto-refresh the token silently

> **If auth fails:** Make sure `bpm_client_secret.json` path in `config.py` is correct and the Search Console API is enabled in the Cloud project.

### 4. Verify Google Ads credentials

The `bpm_google_ads.yaml` already contains a valid refresh token. Test it:

```bash
python -c "import gads_fetcher; print(gads_fetcher.get_search_volumes(['gold bars']))"
```

You should see something like: `{'gold bars': 49500}`

### 5. Verify the DB tables exist

The script requires `ClCode_URLMetrics` to exist. If not yet created:
1. Open the AISEO Management web UI
2. Go to **URL Registry**
3. Click **Setup / Migrate** if prompted

---

## Running Manually

```bash
# Activate venv first
venv\Scripts\activate

# Sync for today's default date (3 days ago — GSC data lag)
python main.py

# Sync for a specific past date
python main.py 2025-12-01

# Backfill a date range
python main.py 2025-11-01 2025-11-30
```

---

## Scheduling

### Option A — Windows Task Scheduler (recommended)

Run once as Administrator:

```powershell
Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass
.\setup_task.ps1
```

This creates a task named **AISEO_SerpSync** that runs daily at **09:00 local time**.

To change the time, edit `$RunTime = "09:00"` in `setup_task.ps1` and re-run it.

Manage the task:
```powershell
# View
Get-ScheduledTask -TaskName "AISEO_SerpSync"

# Run now
Start-ScheduledTask -TaskName "AISEO_SerpSync"

# Remove
Unregister-ScheduledTask -TaskName "AISEO_SerpSync" -Confirm:$false
```

### Option B — Python scheduler (leave a terminal open)

```bash
python scheduler.py
```

Change the run time by editing `SCHEDULER_RUN_TIME = "09:00"` in `config.py`.

---

## Configuration

All settings in `config.py` can be overridden with environment variables:

| Variable              | Default                   | Description                              |
|-----------------------|---------------------------|------------------------------------------|
| `AISEO_DB_SERVER`     | `106.201.231.27,58815`    | SQL Server host:port                     |
| `AISEO_DB_NAME`       | `BPMStagging`             | Database name                            |
| `AISEO_DB_UID`        | `sa`                      | SQL login username                       |
| `AISEO_DB_PWD`        | `ash@2011`                | SQL login password                       |
| `KEYS_DIR`            | `C:\Github\Keys`          | Directory containing key files           |
| `GSC_SITE_URL`        | `https://boldpreciousmetals.com/` | GSC property URL             |
| `GSC_DATA_DELAY_DAYS` | `3`                       | How many days back to fetch (GSC lag)    |
| `GADS_CUSTOMER_ID`    | `4347785221`              | Google Ads account ID                    |
| `SCHEDULER_RUN_TIME`  | `09:00`                   | Daily run time (local, 24h)              |

---

## Logs

All output is written to `serp_sync.log` in this directory, and also printed to the console.

```
2025-12-01 09:00:01 [INFO] ============================================================
2025-12-01 09:00:01 [INFO] SERP Sync  |  date=2025-11-28
2025-12-01 09:00:01 [INFO] Loaded 282 active URLs from DB
2025-12-01 09:00:03 [INFO] GSC returned 14,320 rows covering 248 unique pages.
2025-12-01 09:00:05 [INFO] Unique primary keywords to look up: 194
2025-12-01 09:00:08 [INFO] Got volumes for 187 / 194 keywords.
2025-12-01 09:00:08 [INFO] Writing metrics ...
2025-12-01 09:00:08 [INFO]   INSERT  https://boldpreciousmetals.com/silver-coins/  | pos=3.2 | vol=18,100
...
2025-12-01 09:00:12 [INFO] Done  |  inserted=247  updated=0  skipped=35  errors=0
```

---

## File Structure

```
scripts/serp_sync/
├── config.py          Central configuration
├── db_writer.py       SQL Server read/write layer
├── auth_gsc.py        One-time GSC OAuth2 setup → gsc_token.json
├── gsc_fetcher.py     Google Search Console SERP position fetcher
├── gads_fetcher.py    Google Ads keyword volume fetcher
├── main.py            Daily sync orchestrator
├── scheduler.py       Python-based daily scheduler
├── run.bat            Windows batch launcher (used by Task Scheduler)
├── setup_task.ps1     PowerShell: register Windows Task Scheduler job
├── requirements.txt   Python package dependencies
├── README.md          This file
└── gsc_token.json     Generated by auth_gsc.py (not committed to git)
```

---

## Troubleshooting

**`GSC token not found`** → Run `auth_gsc.py` first.

**`No refresh_token received`** during auth → Revoke existing access at
https://myaccount.google.com/permissions then delete `gsc_token.json` and re-run `auth_gsc.py`.

**`ClCode_URLMetrics table does not exist`** → Go to AISEO web UI → URL Registry → Setup.

**`Google Ads API error: Request contains an invalid argument`** →
Check that `GADS_CUSTOMER_ID` is correct and the account has Keyword Planner access.

**SERP position shows `0` or very high numbers** →
The URL might not have any GSC data for that date. Check in Search Console directly.

**`ODBC Driver 17 for SQL Server` not found** →
Download from https://learn.microsoft.com/en-us/sql/connect/odbc/download-odbc-driver-for-sql-server
