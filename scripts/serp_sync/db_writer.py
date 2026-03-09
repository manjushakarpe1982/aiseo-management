"""
Database access layer for SERP sync.
Reads tracked URLs from ClCode_URLs and writes metrics to ClCode_URLMetrics.
"""
import pyodbc
from datetime import date
from typing import Optional
import config


def _get_conn() -> pyodbc.Connection:
    conn_str = (
        "DRIVER={ODBC Driver 17 for SQL Server};"
        f"SERVER={config.DB_SERVER};"
        f"DATABASE={config.DB_NAME};"
        f"UID={config.DB_UID};"
        f"PWD={config.DB_PWD};"
        "TrustServerCertificate=Yes;"
    )
    return pyodbc.connect(conn_str, autocommit=False)


def fetch_active_urls() -> list[dict]:
    """
    Return all active URLs from ClCode_URLs as a list of dicts.
    Each dict has: URLID, PageURL, PrimaryKeyword, SecondaryKeywords, Priority
    """
    conn = _get_conn()
    try:
        cursor = conn.cursor()
        cursor.execute("""
            SELECT
                URLID,
                PageURL,
                PrimaryKeyword,
                SecondaryKeywords,
                Priority
            FROM ClCode_URLs
            WHERE IsActive = 1
            ORDER BY
                CASE Priority
                    WHEN 'High'   THEN 1
                    WHEN 'Medium' THEN 2
                    WHEN 'Low'    THEN 3
                    ELSE 4
                END,
                PageURL
        """)
        cols = [col[0] for col in cursor.description]
        return [dict(zip(cols, row)) for row in cursor.fetchall()]
    finally:
        conn.close()


def upsert_metric(
    urlid: int,
    recorded_date: date,
    serp_position: Optional[float],
    search_volume: Optional[int],
    notes: Optional[str] = None,
) -> str:
    """
    INSERT or UPDATE a metric row for (URLID, RecordedDate).
    On conflict: updates SERPPosition and/or SearchVolume only if the
    incoming value is not None (preserves existing data on partial updates).

    Returns: 'inserted' | 'updated' | 'skipped'
    """
    if serp_position is None and search_volume is None:
        return "skipped"

    serp_int = int(round(serp_position)) if serp_position is not None else None
    vol_int  = int(search_volume)        if search_volume  is not None else None

    conn = _get_conn()
    try:
        cursor = conn.cursor()
        cursor.execute("""
            MERGE ClCode_URLMetrics AS target
            USING (SELECT ? AS URLID, ? AS RecordedDate) AS source
                ON target.URLID = source.URLID
               AND target.RecordedDate = source.RecordedDate
            WHEN MATCHED THEN
                UPDATE SET
                    SERPPosition = COALESCE(?, target.SERPPosition),
                    SearchVolume = COALESCE(?, target.SearchVolume),
                    Notes        = COALESCE(?, target.Notes)
            WHEN NOT MATCHED THEN
                INSERT (URLID, RecordedDate, SERPPosition, SearchVolume, Notes, CreatedAt)
                VALUES (?, ?, ?, ?, ?, GETUTCDATE())
            OUTPUT $action;
        """,
        # USING clause params
        urlid, recorded_date,
        # UPDATE params
        serp_int, vol_int, notes,
        # INSERT params
        urlid, recorded_date, serp_int, vol_int, notes,
        )
        row = cursor.fetchone()
        action = (row[0] if row else "UNKNOWN").lower()
        conn.commit()
        return action  # 'insert' or 'update'
    finally:
        conn.close()


def metrics_table_exists() -> bool:
    """Check if ClCode_URLMetrics table exists (created by setup endpoint)."""
    conn = _get_conn()
    try:
        cursor = conn.cursor()
        cursor.execute("""
            SELECT COUNT(1) FROM INFORMATION_SCHEMA.TABLES
            WHERE TABLE_NAME = 'ClCode_URLMetrics'
        """)
        return cursor.fetchone()[0] > 0
    finally:
        conn.close()
