"""
Step 6 — update_issue_status(entity_type, entity_id, new_status, user_id, comment)
Step 7 — verify_fixes(new_scan_id)
"""

from datetime import datetime

from .db import get_connection
from .config import TP

VALID_STATUSES = {"Yet to Act", "Acted", "Deferred"}


# ── Step 6: update_issue_status ───────────────────────────────────────────

def update_issue_status(
    entity_type: str,
    entity_id: int,
    new_status: str,
    user_id: int,
    comment: str = None,
    deferred_reason: str = None,
) -> None:
    """
    Update the Status of a cannibalization issue or content improvement.

    Parameters
    ----------
    entity_type     : 'cannibalization' or 'improvement'
    entity_id       : IssueID or ImprovementID
    new_status      : 'Yet to Act' | 'Acted' | 'Deferred'
    user_id         : UserID performing the action
    comment         : Optional freetext comment
    deferred_reason : Required when new_status == 'Deferred'
    """
    entity_type = entity_type.lower()
    if entity_type not in ("cannibalization", "improvement"):
        raise ValueError("entity_type must be 'cannibalization' or 'improvement'")
    if new_status not in VALID_STATUSES:
        raise ValueError(f"new_status must be one of {VALID_STATUSES}")
    if new_status == "Deferred" and not deferred_reason:
        raise ValueError("deferred_reason is required when status is 'Deferred'")

    table     = f"{TP}CannibalizationIssues" if entity_type == "cannibalization" else f"{TP}ContentImprovements"
    pk_col    = "IssueID" if entity_type == "cannibalization" else "ImprovementID"
    url_col   = "URL1" if entity_type == "cannibalization" else "PageURL"
    ent_label = "CannibalizationIssue" if entity_type == "cannibalization" else "ContentImprovement"

    conn = get_connection()
    cursor = conn.cursor()
    now = datetime.utcnow()

    # Fetch current status + URL for audit
    cursor.execute(
        f"SELECT Status, {url_col} FROM {table} WHERE {pk_col} = ?",
        (entity_id,),
    )
    row = cursor.fetchone()
    if not row:
        conn.close()
        raise ValueError(f"{ent_label} ID={entity_id} not found")

    old_status, entity_url = row[0], row[1]

    # Build UPDATE
    extra_sets = "UserComment = ?"
    params = [new_status, user_id, now, comment]
    if new_status == "Deferred":
        extra_sets += ", DeferredReason = ?"
        params.append(deferred_reason)
    params.append(entity_id)

    cursor.execute(
        f"""
        UPDATE {table}
        SET Status                = ?,
            LastAuditedByUserID   = ?,
            LastAuditedAt         = ?,
            {extra_sets}
        WHERE {pk_col} = ?
        """,
        params,
    )

    # Determine ActionType
    action_map = {
        "Acted":       "Acted",
        "Deferred":    "Deferred",
        "Yet to Act":  "StatusChanged",
    }
    action_type = action_map[new_status]

    cursor.execute(
        f"""
        INSERT INTO {TP}AuditLog
            (AuditedByUserID, AuditedAt, EntityType, EntityID, EntityURL,
             ActionType, OldValue, NewValue, Comment, IPAddress)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, '127.0.0.1')
        """,
        (user_id, now, ent_label, entity_id, entity_url,
         action_type, old_status, new_status, comment),
    )

    conn.commit()
    conn.close()
    print(f"  Updated {ent_label} ID={entity_id}: {old_status} → {new_status}")


# ── Step 7: verify_fixes ──────────────────────────────────────────────────

def verify_fixes(new_scan_id: int) -> int:
    """
    Compare new scraped content against previously 'Acted' suggestions.

    For each ContentImprovement with Status='Acted' and VerifiedFixed=0,
    look up the corresponding page in the new scan's ScrapedPages and check
    whether the live content now matches SuggestedContent.

    Sets VerifiedFixed=1, VerifiedInScanID=new_scan_id for matches, and
    logs to ClCode_AuditLog.

    Returns the count of newly verified fixes.
    """
    conn = get_connection()
    cursor = conn.cursor()

    # Load all Acted, not-yet-verified content improvements
    cursor.execute(
        f"""
        SELECT ci.ImprovementID, ci.PageURL, ci.FieldName,
               ci.SuggestedContent, ci.LastAuditedByUserID
        FROM {TP}ContentImprovements ci
        WHERE ci.Status = 'Acted'
          AND ci.VerifiedFixed = 0
          AND ci.SuggestedContent IS NOT NULL
        """
    )
    improvements = cursor.fetchall()

    # Build a dict of (PageURL → ScrapedPage fields) from the new scan
    cursor.execute(
        f"""
        SELECT PageURL, MetaTitle, MetaDescription, H1, BodyContent,
               SchemaMarkup, CanonicalURL
        FROM {TP}ScrapedPages
        WHERE ScanID = ? AND ScrapeStatus = 'Success'
        """,
        (new_scan_id,),
    )
    scraped = {}
    for row in cursor.fetchall():
        scraped[row[0]] = {
            "MetaTitle":       row[1],
            "MetaDescription": row[2],
            "H1":              row[3],
            "BodyContent":     row[4],
            "SchemaMarkup":    row[5],
            "CanonicalURL":    row[6],
        }

    verified_count = 0
    now = datetime.utcnow()

    for imp in improvements:
        imp_id, page_url, field_name, suggested, audited_by = (
            imp[0], imp[1], imp[2], imp[3], imp[4]
        )

        page = scraped.get(page_url)
        if not page:
            continue  # page not scraped in new scan

        live_value = page.get(field_name)
        if live_value is None:
            continue

        # Normalise whitespace for comparison
        def _norm(s: str) -> str:
            return " ".join(s.split()).lower() if s else ""

        if _norm(live_value) == _norm(suggested):
            cursor.execute(
                f"""
                UPDATE {TP}ContentImprovements
                SET VerifiedFixed    = 1,
                    VerifiedInScanID = ?
                WHERE ImprovementID  = ?
                """,
                (new_scan_id, imp_id),
            )
            cursor.execute(
                f"""
                INSERT INTO {TP}AuditLog
                    (AuditedByUserID, AuditedAt, EntityType, EntityID,
                     EntityURL, EntityField, ActionType,
                     OldValue, NewValue, IPAddress)
                VALUES (?, ?, 'ContentImprovement', ?, ?, ?, 'VerifiedFixed',
                        'Acted', 'VerifiedFixed', '127.0.0.1')
                """,
                (
                    audited_by or 1, now, imp_id, page_url,
                    field_name,
                ),
            )
            verified_count += 1

    conn.commit()
    conn.close()
    print(f"verify_fixes: {verified_count} fix(es) verified in ScanID={new_scan_id}")
    return verified_count
