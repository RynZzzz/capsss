from sqlalchemy import create_engine, event as sa_event
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.orm import sessionmaker
import os

# ─── DATABASE URL ─────────────────────────────────────────────────────────────
# Reads from environment variables; falls back to a local SQLite file for dev.
#
# PostgreSQL (production):
#   DATABASE_URL=postgresql://user:password@host:5432/cleanlogic
#
# SQLite (development):
#   DATABASE_URL=sqlite:///./cleanlogic.db
#
DATABASE_URL = os.getenv("DATABASE_URL", f"mysql+pymysql://root:@localhost:3306/cleanLogic")

# SQLite-specific: allow concurrent access across threads (needed by FastAPI)
# connect_args = {"check_same_thread": False} if DATABASE_URL.startswith("sqlite") else {}

_100MB = 100 * 1024 * 1024  # 104857600

engine = create_engine(
    DATABASE_URL,
    echo=False,
    pool_pre_ping=True,          # test connection health before use
    pool_size=20,                # base connections kept open
    max_overflow=40,             # extra connections allowed under load
    pool_recycle=1800,           # recycle connections every 30 min to avoid MySQL's 8h timeout
    pool_timeout=20,             # raise immediately after 20s instead of hanging
    connect_args={"max_allowed_packet": _100MB},  # PyMySQL client-side packet budget
)


@sa_event.listens_for(engine, "connect")
def _set_max_allowed_packet(dbapi_conn, _connection_record):
    """Raise MySQL/MariaDB max_allowed_packet to 100 MB on every new connection.

    SET SESSION affects the current connection immediately — no SUPER privilege
    needed.  SET GLOBAL is attempted afterwards as a best-effort so that other
    clients (e.g. a second server process) also benefit.
    """
    cursor = dbapi_conn.cursor()
    try:
        cursor.execute("SET SESSION max_allowed_packet = 104857600")  # 100 MB, current conn
    except Exception:
        pass
    try:
        cursor.execute("SET GLOBAL max_allowed_packet = 104857600")   # 100 MB, future conns
    except Exception:
        pass  # no SUPER privilege — session setting still applies
    finally:
        cursor.close()


SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

Base = declarative_base()


# ─── DEPENDENCY ───────────────────────────────────────────────────────────────

def get_db():
    """
    FastAPI dependency that yields a database session and ensures it is
    closed after the request, even if an exception occurs.

    Usage:
        @app.get("/items")
        def read_items(db: Session = Depends(get_db)):
            ...
    """
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


# ─── INIT ─────────────────────────────────────────────────────────────────────

def init_db():
    """Create all tables and apply incremental schema migrations."""
    from app.db import models  # noqa: F401
    Base.metadata.create_all(bind=engine)
    _migrate_sessions_table()
    _migrate_step_snapshots_table()
    _migrate_trained_models_table()
    _migrate_accounts_table()
    _migrate_files_table()
    _migrate_preprocessing_jobs_table()


def _migrate_sessions_table():
    """
    Best-effort schema migration for the sessions table.
    - Adds file_id column (FK to files.id) if missing.
    - Drops legacy data and columns JSON blobs if present.
    """
    from sqlalchemy import text as _text
    with engine.connect() as conn:
        # Add file_id if it doesn't exist yet
        try:
            conn.execute(_text(
                "ALTER TABLE sessions ADD COLUMN file_id INT NULL, "
                "ADD INDEX idx_sessions_file_id (file_id)"
            ))
            conn.commit()
        except Exception:
            pass  # Column already exists

        # Drop legacy data column if present
        try:
            conn.execute(_text("ALTER TABLE sessions DROP COLUMN data"))
            conn.commit()
        except Exception:
            pass

        # Drop legacy columns column if present
        try:
            conn.execute(_text("ALTER TABLE sessions DROP COLUMN `columns`"))
            conn.commit()
        except Exception:
            pass


def _migrate_step_snapshots_table():
    """
    Best-effort migration: create step_snapshots table if it doesn't exist yet.
    SQLAlchemy's create_all handles new installs; this covers existing DBs.
    """
    from sqlalchemy import text as _text
    with engine.connect() as conn:
        try:
            conn.execute(_text(
                """
                CREATE TABLE IF NOT EXISTS step_snapshots (
                    id          INT AUTO_INCREMENT PRIMARY KEY,
                    session_id  VARCHAR(100) NOT NULL,
                    step_index  INT          NOT NULL,
                    file_binary LONGBLOB     NOT NULL,
                    created_at  DATETIME     DEFAULT NOW(),
                    UNIQUE KEY uq_step_snapshots_session_step (session_id, step_index),
                    KEY idx_step_snapshots_session (session_id)
                )
                """
            ))
            conn.commit()
        except Exception:
            pass


def _migrate_trained_models_table():
    """
    Best-effort migration: add new columns to trained_models if they don't
    exist yet (covers databases created before the ML feature was added).
    Also upgrades model_binary from BLOB → LONGBLOB so large models don't
    cause a silent MySQL packet-size drop (which the browser sees as Network Error).
    """
    from sqlalchemy import text as _text

    new_columns = [
        ("accuracy",               "FLOAT NULL"),
        ("mae",                    "FLOAT NULL"),
        ("r2_score",               "FLOAT NULL"),
        ("precision_score",        "FLOAT NULL"),
        ("recall_score",           "FLOAT NULL"),
        ("f1_score",               "FLOAT NULL"),
        ("rmse",                   "FLOAT NULL"),
        ("training_time_seconds",  "FLOAT NULL"),
        ("training_samples",       "INT NULL"),
        ("test_samples",           "INT NULL"),
        ("visibility",             "VARCHAR(20) DEFAULT 'private'"),
        ("tags",                   "JSON NULL"),
        ("created_by",             "VARCHAR(100) NULL"),
        ("times_used",             "INT DEFAULT 0"),
        ("last_used_at",           "DATETIME NULL"),
    ]

    with engine.connect() as conn:
        for col_name, col_def in new_columns:
            try:
                conn.execute(_text(
                    f"ALTER TABLE trained_models ADD COLUMN {col_name} {col_def}"
                ))
                conn.commit()
            except Exception:
                pass  # column already exists

        # Upgrade model_binary to LONGBLOB (no-op if already LONGBLOB)
        try:
            conn.execute(_text(
                "ALTER TABLE trained_models MODIFY COLUMN model_binary LONGBLOB NOT NULL"
            ))
            conn.commit()
        except Exception:
            pass


def _migrate_accounts_table():
    """Add password_hash column to accounts for LOCAL provider auth."""
    from sqlalchemy import text as _text
    with engine.connect() as conn:
        try:
            conn.execute(_text(
                "ALTER TABLE accounts ADD COLUMN password_hash VARCHAR(255) NULL"
            ))
            conn.commit()
        except Exception:
            pass  # column already exists


def _migrate_preprocessing_jobs_table():
    """Add profiling status columns to preprocessing_jobs for restart-safe polling."""
    from sqlalchemy import text as _text
    new_cols = [
        ("profiling_ready",    "BOOLEAN DEFAULT FALSE"),
        ("profiling_error",    "TEXT NULL"),
        ("merged_cells_json",  "JSON NULL"),
        ("has_merges",         "BOOLEAN DEFAULT FALSE"),
    ]
    with engine.connect() as conn:
        for col_name, col_def in new_cols:
            try:
                conn.execute(_text(
                    f"ALTER TABLE preprocessing_jobs ADD COLUMN {col_name} {col_def}"
                ))
                conn.commit()
            except Exception:
                pass  # column already exists


def _migrate_files_table():
    """Add original_file_binary column to files for immutable original copy."""
    from sqlalchemy import text as _text
    with engine.connect() as conn:
        try:
            conn.execute(_text(
                "ALTER TABLE files ADD COLUMN original_file_binary LONGBLOB NULL"
            ))
            conn.commit()
        except Exception:
            pass  # column already exists

        # Back-fill: copy file_binary → original_file_binary for rows where it is NULL
        try:
            conn.execute(_text(
                "UPDATE files SET original_file_binary = file_binary "
                "WHERE original_file_binary IS NULL"
            ))
            conn.commit()
        except Exception:
            pass