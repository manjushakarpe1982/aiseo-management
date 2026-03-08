"""Database connection helper."""
import pyodbc
from .config import DB_SERVER, DB_NAME, DB_UID, DB_PWD


def get_connection() -> pyodbc.Connection:
    """Return an open pyodbc connection with autocommit off."""
    conn_str = (
        "DRIVER={ODBC Driver 17 for SQL Server};"
        f"SERVER={DB_SERVER};"
        f"DATABASE={DB_NAME};"
        f"UID={DB_UID};"
        f"PWD={DB_PWD};"
        "TrustServerCertificate=Yes;"
    )
    return pyodbc.connect(conn_str, autocommit=False)
