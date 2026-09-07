import sqlite3
from app.config import SQLITE_DB

def get_db_connection(timeout: float = 10.0) -> sqlite3.Connection:
    """
    Returns an active SQLite connection configured with Row factory.
    """
    conn = sqlite3.connect(SQLITE_DB, timeout=timeout)
    conn.row_factory = sqlite3.Row
    return conn
