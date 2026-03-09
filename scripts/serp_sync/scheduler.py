"""
Python-based daily scheduler for SERP Sync.

Alternative to Windows Task Scheduler — keeps running in the background
and fires the sync job at the configured time every day.

Usage:
    python scheduler.py

Run this in a terminal you can leave open, or as a background service.
Set SCHEDULER_RUN_TIME in config.py (default: "09:00" local time).

For a more robust solution on Windows, use Windows Task Scheduler instead
(see setup_task.ps1).
"""
import sys
import os
import logging
from datetime import datetime

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import schedule
import time
import config
import main as serp_sync

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


def job() -> None:
    log.info("Scheduler triggered SERP Sync job.")
    try:
        serp_sync.run()
    except Exception as exc:
        log.error(f"Scheduled job failed: {exc}", exc_info=True)


if __name__ == "__main__":
    run_time = config.SCHEDULER_RUN_TIME
    schedule.every().day.at(run_time).do(job)

    log.info(f"SERP Sync Scheduler started.")
    log.info(f"  Daily run time : {run_time} (local)")
    log.info(f"  Log file       : {config.LOG_FILE}")
    log.info(f"  Next run       : {schedule.next_run()}")
    log.info("Press Ctrl+C to stop.\n")

    while True:
        schedule.run_pending()
        time.sleep(30)  # check every 30 seconds
