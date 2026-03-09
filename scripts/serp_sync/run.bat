@echo off
REM ─────────────────────────────────────────────────────────────────────────
REM  SERP Sync — Windows batch launcher
REM  Used by Windows Task Scheduler to fire the daily sync.
REM
REM  To run manually:  double-click or call from cmd:  run.bat
REM  To pass a date:   run.bat 2025-12-01
REM  To pass a range:  run.bat 2025-11-01 2025-11-30
REM ─────────────────────────────────────────────────────────────────────────

REM Change to the script directory so relative paths work correctly
cd /d "%~dp0"

REM Activate virtual environment if it exists
if exist "venv\Scripts\activate.bat" (
    call venv\Scripts\activate.bat
)

REM Run the sync — pass any CLI arguments through
python main.py %*

REM Exit code is propagated to Task Scheduler
exit /b %errorlevel%
