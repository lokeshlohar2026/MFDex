import sqlite3
from app.config import SQLITE_DB

def get_db_connection(timeout: float = 30.0) -> sqlite3.Connection:
    """
    Returns an active SQLite connection configured with high-performance production PRAGMAs.
    - mmap_size = 1 GB (zero-copy OS page cache)
    - cache_size = 128 MB (-131072 KiB RAM cache)
    - temp_store = MEMORY (in-memory B-Trees for sorts and aggregations)
    - journal_mode = WAL & synchronous = NORMAL
    - read_uncommitted = 1 (fast concurrent non-blocking reads)
    """
    conn = sqlite3.connect(SQLITE_DB, timeout=timeout)
    conn.row_factory = sqlite3.Row
    cur = conn.cursor()
    cur.execute("PRAGMA journal_mode = WAL;")
    cur.execute("PRAGMA synchronous = NORMAL;")
    cur.execute("PRAGMA mmap_size = 1073741824;")
    cur.execute("PRAGMA cache_size = -131072;")
    cur.execute("PRAGMA temp_store = MEMORY;")
    cur.execute("PRAGMA read_uncommitted = 1;")
    cur.close()
    return conn
