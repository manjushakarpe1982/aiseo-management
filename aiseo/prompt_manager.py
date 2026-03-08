"""
Step 5 — activate_prompt(prompt_type, system_prompt, user_template, version_label, user_id)

Deactivates the currently active row for the given PromptType, inserts a new
active row with an auto-incremented VersionNumber, and logs to ClCode_AuditLog.
"""

from datetime import datetime

from .db import get_connection
from .config import TP


def activate_prompt(
    prompt_type: str,
    system_prompt: str,
    user_template: str,
    version_label: str,
    user_id: int,
) -> int:
    """
    Activate a new prompt version for the given PromptType.

    Parameters
    ----------
    prompt_type   : 'Cannibalization' or 'ContentImprovement'
    system_prompt : Full SYSTEM role text
    user_template : USER role text with {TREE_NAME}, {TREE_DATA}, or {PAGE_DATA}
    version_label : Human label, e.g. 'v3 - added guardrail 9'
    user_id       : UserID of the person activating

    Returns
    -------
    New PromptID
    """
    if prompt_type not in ("Cannibalization", "ContentImprovement"):
        raise ValueError(
            "prompt_type must be 'Cannibalization' or 'ContentImprovement'"
        )

    conn = get_connection()
    cursor = conn.cursor()
    now = datetime.utcnow()

    # Step A — deactivate current active row
    cursor.execute(
        f"""
        UPDATE {TP}Prompts
        SET IsActive            = 0,
            DeactivatedAt       = ?,
            DeactivatedByUserID = ?
        WHERE PromptType = ? AND IsActive = 1
        """,
        (now, user_id, prompt_type),
    )
    deactivated = cursor.rowcount  # 0 or 1

    # Step B — compute next VersionNumber
    cursor.execute(
        f"""
        SELECT ISNULL(MAX(VersionNumber), 0) + 1
        FROM {TP}Prompts
        WHERE PromptType = ?
        """,
        (prompt_type,),
    )
    next_version = cursor.fetchone()[0]

    # Step C — insert new active row
    cursor.execute(
        f"""
        INSERT INTO {TP}Prompts
            (PromptType, VersionNumber, VersionLabel, SystemPrompt,
             UserPromptTemplate, IsActive, CreatedAt, CreatedByUserID)
        VALUES (?, ?, ?, ?, ?, 1, ?, ?)
        """,
        (
            prompt_type, next_version, version_label,
            system_prompt.strip(), user_template.strip(),
            now, user_id,
        ),
    )

    # Retrieve new PromptID
    cursor.execute(
        f"""
        SELECT TOP 1 PromptID FROM {TP}Prompts
        WHERE PromptType = ? AND IsActive = 1
        ORDER BY PromptID DESC
        """,
        (prompt_type,),
    )
    new_prompt_id = cursor.fetchone()[0]

    # Step D — audit log
    cursor.execute(
        f"""
        INSERT INTO {TP}AuditLog
            (AuditedByUserID, AuditedAt, EntityType, EntityID, ActionType,
             OldValue, NewValue, IPAddress)
        VALUES (?, ?, 'Prompt', ?, 'PromptActivated', ?, ?, '127.0.0.1')
        """,
        (
            user_id, now, new_prompt_id,
            f"Deactivated previous version (rows={deactivated})",
            f"Activated {prompt_type} v{next_version}: {version_label}",
        ),
    )

    conn.commit()
    conn.close()

    print(f"Activated {prompt_type} v{next_version} (PromptID={new_prompt_id}): {version_label}")
    return new_prompt_id


def list_prompts(prompt_type: str = None) -> None:
    """Print all prompt versions for review."""
    conn = get_connection()
    cursor = conn.cursor()

    query = f"""
        SELECT PromptType, VersionNumber, VersionLabel, IsActive,
               CreatedAt, DeactivatedAt, Notes
        FROM {TP}Prompts
        {f"WHERE PromptType = ?" if prompt_type else ""}
        ORDER BY PromptType, VersionNumber DESC
    """
    args = (prompt_type,) if prompt_type else ()
    cursor.execute(query, args)
    rows = cursor.fetchall()
    conn.close()

    if not rows:
        print("No prompts found.")
        return

    print(f"\n{'PromptType':<22} {'Ver':>4} {'Active':>6}  {'CreatedAt':<20}  Label")
    print("-" * 90)
    for r in rows:
        active = "YES" if r.IsActive else "-"
        created = r.CreatedAt.strftime("%Y-%m-%d %H:%M") if r.CreatedAt else ""
        print(f"{r.PromptType:<22} {r.VersionNumber:>4} {active:>6}  {created:<20}  {r.VersionLabel}")
    print()
