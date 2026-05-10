from sqlalchemy import (Column, String, Integer, Float, LargeBinary, BigInteger, JSON, Boolean, DateTime, ForeignKey, Text, Enum, UniqueConstraint)
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func
from app.db.connection import Base
import enum
from sqlalchemy.dialects.mysql import LONGBLOB
class FileTypeEnum(str, enum.Enum):
    CSV = "csv"
    XLSX = "xlsx"
    XLS = "xls"
    TXT = "txt"

class AuthProviderEnum(str, enum.Enum):
    GOOGLE   = "Google"
    GITHUB   = "GitHub"
    FACEBOOK = "Facebook"
    LOCAL    = "Local"      # email + password (no OAuth)

class MissingHandlingEnum(str, enum.Enum):
    OMIT = "omit"
    MEAN = "mean"
    MEDIAN = "median"
    MODE = "mode"
    CONSTANT = "constant"
    FORWARD_FILL = "forward_fill"
    BACKWARD_FILL = "backward_fill"
    KNN_IMPUTE = "knn_impute"

class OutlierMethodEnum(str, enum.Enum):
    IQR = "iqr"
    ZSCORE = "zscore"
    KNN = "knn"
    NONE = "none"
class OutlierActionEnum(str, enum.Enum):
    REMOVE = "remove"
    CAP = "cap"
    IGNORE = "ignore"

class ColumnTypeEnum(str, enum.Enum):
    INTEGER = "Integer"
    DECIMAL = "Decimal"
    ALPHANUMERIC = "Alphanumeric"
    TEXT = "Text"
    DATETIME = "DateTime"
    MIXED = "Mixed"   

class MLModelTypeEnum(str, enum.Enum):
    LINEAR_REGRESSION = "Linear_Regression"
    LOGISTIC_REGRESSION = "Logistic_Regression"
    RANDOM_FOREST = "Random_Forest"
    DECISION_TREE = "Decision_Tree"
    SVM = "SVM"
    GRADIENT_BOOSTING = "Gradient_Boosting"
    KNN = "KNN"
    XGBOOST = "XGBoost"
    LIGHTGBM = "LightGBM"

class ChartTypeEnum(str, enum.Enum):
    BAR = "Bar"
    LINE = "Line"
    PIE = "Pie"
    SCATTER = "Scatter"
    HISTOGRAM = "Histogram"
    HEATMAP = "Heatmap"
    BOX_PLOT = "Box_Plot"

class PreprocessingStatusEnum(str, enum.Enum):
    PENDING = "Pending"
    RUNNING = "Running"
    COMPLETED = "Completed"
    FAILED = "Failed"


    
class Accounts(Base):
 
    __tablename__ = "accounts"

    id          = Column(Integer, primary_key=True, index=True)

    # ✅ Fixed: "users.id" matches __tablename__ = "users"
    user_id     = Column(
                      Integer,
                      ForeignKey("users.id", ondelete="CASCADE"),
                      nullable=False,
                      index=True,
                  )

    # OAuth provider — typed enum instead of free-form string
    provider    = Column(Enum(AuthProviderEnum), nullable=False,
                         default=AuthProviderEnum.GOOGLE)

    # The unique ID the provider issued for this user (e.g. Google's "sub" claim)
    provider_id = Column(String(255), nullable=False)

    # ── OAuth tokens ──────────────────────────────────────────────────────────
    # WARNING: encrypt these at rest in production
    #   e.g. sqlalchemy-utils EncryptedType or app-level AES-256-GCM
    access_token  = Column(Text, nullable=True)                      # short-lived bearer token
    refresh_token = Column(Text, nullable=True)                      # long-lived, renews access_token
    token_expiry  = Column(DateTime(timezone=True), nullable=True)   # UTC expiry of access_token

    # ── Local auth (provider = "Local" only) ──────────────────────────────────
    password_hash = Column(String(255), nullable=True)               # bcrypt hash; NULL for OAuth accounts

    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())

    # Fixed: cascade removed from the child side — only back_populates needed here
    user = relationship("User", back_populates="accounts")

    # A provider_id is globally unique only within one provider.
    # Two different providers may issue the same numeric string to different users.
    __table_args__ = (
        UniqueConstraint("provider", "provider_id",
                         name="uq_accounts_provider_provider_id"),
    )
    user = relationship("User", back_populates="accounts")
class User(Base):
    """Application users"""
    __tablename__ = "users"

    id         = Column(Integer, primary_key=True, index=True)
    email      = Column(String(255), unique=True, nullable=False, index=True)
    username   = Column(String(255), unique=True, nullable=False, index=True)
    is_active  = Column(Boolean, default=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())

    # Relationships
    files       = relationship("FileTable",      back_populates="user", cascade="all, delete-orphan")
    ml_models   = relationship("TrainedModel",   back_populates="user", cascade="all, delete-orphan")
    accounts = relationship("Accounts", back_populates="user", cascade="all, delete-orphan")

class FileTable(Base):
    """
    Uploaded dataset files.
    The raw binary is stored here so the user can re-load without re-uploading.
    """
    __tablename__ = "files"

    id            = Column(Integer, primary_key=True, index=True)
    user_id       = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)

    # File identity
    file_name     = Column(String(255), nullable=False)
    file_type     = Column(Enum(FileTypeEnum), nullable=False)
    file_size     = Column(BigInteger, nullable=False)          # bytes
    file_binary          = Column(LONGBLOB, nullable=False)   # current working copy (may be cleaned)
    original_file_binary = Column(LONGBLOB, nullable=True)    # immutable original — never overwritten

    # Dataset shape (denormalised for quick display)
    row_count     = Column(Integer, nullable=True)
    column_count  = Column(Integer, nullable=True)

    # Session / profiling
    session_id    = Column(String(100), unique=True, index=True, nullable=True)

    created_at    = Column(DateTime(timezone=True), server_default=func.now())
    updated_at    = Column(DateTime(timezone=True), onupdate=func.now())

    # Relationships
    user               = relationship("User",              back_populates="files")
    column_profiles    = relationship("ColumnProfile",     back_populates="file", cascade="all, delete-orphan")
    preprocessing_jobs = relationship("PreprocessingJob",  back_populates="file", cascade="all, delete-orphan")
    visualizations     = relationship("Visualization",     back_populates="file", cascade="all, delete-orphan")
    trained_models     = relationship("TrainedModel",      back_populates="file")
    ai_summaries       = relationship("AiSummary",         back_populates="file", cascade="all, delete-orphan")


class SessionRecord(Base):
    __tablename__ = "sessions"

    id = Column(String(100), primary_key=True, index=True)
    user_id = Column(String(255), nullable=True, index=True)
    file_id = Column(Integer, ForeignKey("files.id", ondelete="SET NULL"), nullable=True, index=True)
    applied_steps = Column(JSON, nullable=True)
    chart_recommendations = Column(JSON, nullable=True)
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

    file = relationship("FileTable", foreign_keys=[file_id])


class StepSnapshot(Base):
    """
    Stores the materialised file binary after applying steps 0..step_index.
    Populated automatically by _commit_replay so that preview-step and
    page reloads can serve cached results instead of replaying from scratch.

    step_index = -1  →  original / source state (before any steps)
    step_index =  0  →  file after step 0 applied
    step_index =  N  →  file after steps 0..N applied
    """
    __tablename__ = "step_snapshots"

    id          = Column(Integer, primary_key=True, index=True)
    session_id  = Column(String(100), nullable=False, index=True)
    step_index  = Column(Integer,     nullable=False)
    file_binary = Column(LONGBLOB,    nullable=False)
    created_at  = Column(DateTime(timezone=True), server_default=func.now())

    __table_args__ = (
        UniqueConstraint("session_id", "step_index",
                         name="uq_step_snapshots_session_step"),
    )


class ColumnProfile(Base):
    """
    Profiling stats for every column in a file.
    Re-generated on each upload / after cleaning.
    """
    __tablename__ = "column_profiles"

    id          = Column(Integer, primary_key=True, index=True)
    file_id     = Column(Integer, ForeignKey("files.id", ondelete="CASCADE"), nullable=False, index=True)

    column_name          = Column(String(255), nullable=False)
    column_type          = Column(Enum(ColumnTypeEnum), nullable=False)
    total_count          = Column(Integer, nullable=False)
    non_null_count       = Column(Integer, nullable=False)
    missing_count        = Column(Integer, default=0)
    unique_count         = Column(Integer, default=0)
    completeness_pct     = Column(Float, default=100.0)

    # Numeric stats (null when non-numeric)
    mean        = Column(Float, nullable=True)
    median      = Column(Float, nullable=True)
    std_dev     = Column(Float, nullable=True)
    min_value   = Column(Float, nullable=True)
    max_value   = Column(Float, nullable=True)
    q1          = Column(Float, nullable=True)
    q3          = Column(Float, nullable=True)

    # Text stats
    top_value   = Column(String(500), nullable=True)
    top_freq    = Column(Integer, nullable=True)

    # Quality flags
    outlier_count            = Column(Integer, default=0)
    outlier_method           = Column(String(50), nullable=True)
    type_inconsistency_count = Column(Integer, default=0)

    # Detailed index lists stored as JSON arrays
    missing_indices             = Column(JSON, default=list)
    outlier_indices             = Column(JSON, default=list)
    type_inconsistency_indices  = Column(JSON, default=list)

    # Value distribution (top-N stored as JSON {value: count})
    value_distribution = Column(JSON, default=dict)

    profiled_at = Column(DateTime(timezone=True), server_default=func.now())

    # Relationships
    file = relationship("FileTable", back_populates="column_profiles")


class PreprocessingJob(Base):
    """
    One pre-processing configuration per file (can be updated).
    Stores WHAT was chosen and the cleaned binary result.
    """
    __tablename__ = "preprocessing_jobs"

    id      = Column(Integer, primary_key=True, index=True)
    file_id = Column(Integer, ForeignKey("files.id", ondelete="CASCADE"), nullable=False, index=True)

    # ── Missing-value handling ─────────────────────────────────────────────────
    missing_handling        = Column(Enum(MissingHandlingEnum), default=MissingHandlingEnum.OMIT)
    missing_constant_value  = Column(String(255), nullable=True)   # used when type == CONSTANT

    # Per-column overrides (JSON):  { "Age": "median", "Name": "omit", ... }
    column_missing_overrides = Column(JSON, default=dict)

    # ── Outlier handling ───────────────────────────────────────────────────────
    outlier_method  = Column(Enum(OutlierMethodEnum), default=OutlierMethodEnum.IQR)
    outlier_action  = Column(Enum(OutlierActionEnum), default=OutlierActionEnum.REMOVE)

    # IQR multiplier (default 1.5) or KNN contamination (default 0.05)
    outlier_param   = Column(Float, default=1.5)

    # Per-column overrides (JSON): { "Salary": {"method": "knn", "action": "cap"}, ... }
    column_outlier_overrides = Column(JSON, default=dict)

    # ── Column-type changes ────────────────────────────────────────────────────
    # JSON: { "Age": "Integer", "Joined": "DateTime" }
    column_type_changes = Column(JSON, default=dict)

    # ── Cell-level edits applied during profiling UI ──────────────────────────
    # JSON array of { row_idx, col_name, old_value, new_value, timestamp }
    cell_edits = Column(JSON, default=list)

    # ── Outputs ───────────────────────────────────────────────────────────────
    status              = Column(Enum(PreprocessingStatusEnum), default=PreprocessingStatusEnum.PENDING)
    cleaned_file_binary = Column(LargeBinary, nullable=True)    # cleaned dataset bytes
    cleaned_row_count   = Column(Integer, nullable=True)
    cleaned_col_count   = Column(Integer, nullable=True)
    error_message       = Column(Text, nullable=True)

    # Change log (full history)
    change_log = Column(JSON, default=list)

    # Profiling status — persisted so polling survives server restarts
    profiling_ready = Column(Boolean, default=False)
    profiling_error = Column(Text, nullable=True)
    merged_cells_json = Column(JSON, nullable=True)
    has_merges      = Column(Boolean, default=False)

    created_at   = Column(DateTime(timezone=True), server_default=func.now())
    completed_at = Column(DateTime(timezone=True), nullable=True)

    # Relationships
    file = relationship("FileTable", back_populates="preprocessing_jobs")


class Visualization(Base):
    """
    Stores rendered charts for a file.

    Strategy: generate the chart in Python (matplotlib / plotly) and store:
      - image_binary  → PNG/SVG bytes  (for static export / PDF reports)
      - chart_config  → JSON spec      (for re-rendering in the frontend,
                                         e.g. Recharts / Chart.js config)
    Both can be stored simultaneously; the frontend picks what it needs.
    """
    __tablename__ = "visualizations"

    id      = Column(Integer, primary_key=True, index=True)
    file_id = Column(Integer, ForeignKey("files.id", ondelete="CASCADE"), nullable=False, index=True)

    chart_type  = Column(Enum(ChartTypeEnum), nullable=False)
    chart_title = Column(String(255), nullable=True)

    # Which columns were used
    x_column    = Column(String(255), nullable=True)
    y_column    = Column(String(255), nullable=True)
    group_by    = Column(String(255), nullable=True)   # optional colour/facet column

    # --- Storage option 1: rendered image ---
    # PNG or SVG bytes; serve via /api/visualization/{id}/image
    image_binary    = Column(LargeBinary, nullable=True)
    image_format    = Column(String(10), nullable=True)    # "png" | "svg"

    # --- Storage option 2: JSON chart config ---
    # Recharts / Chart.js / Plotly JSON data that the frontend can render directly
    # This is the preferred approach — keeps the chart interactive and responsive
    chart_config    = Column(JSON, nullable=True)

    # Optional: chart-level summary statistics (e.g. for a histogram: bin_edges, counts)
    chart_metadata  = Column(JSON, default=dict)

    created_at = Column(DateTime(timezone=True), server_default=func.now())

    # Relationships
    file = relationship("FileTable", back_populates="visualizations")


class AiSummary(Base):
    __tablename__ = "ai_summaries"

    id         = Column(Integer, primary_key=True, index=True)
    file_id    = Column(Integer, ForeignKey("files.id", ondelete="CASCADE"), nullable=False, index=True)
    session_id = Column(String(100), unique=True, index=True, nullable=False)
    summary    = Column(Text, nullable=False)
    config     = Column(JSON, default=dict)

    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())

    file = relationship("FileTable", back_populates="ai_summaries")


class PreprocessingLog(Base):
    """
    Audit log for every preprocessing step applied in a session.
    Reason is generated via templates (low-risk) or AI (medium/high-risk).
    """
    __tablename__ = "preprocessing_logs"

    id             = Column(Integer, primary_key=True, index=True)
    session_id     = Column(String(100), nullable=False, index=True)
    file_id        = Column(Integer, ForeignKey("files.id", ondelete="SET NULL"), nullable=True, index=True)
    user_id        = Column(Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=True, index=True)

    column_name    = Column(String(255), nullable=False)
    operation      = Column(String(100), nullable=False)
    parameters     = Column(JSON, default=dict)

    applied_at     = Column(DateTime(timezone=True), server_default=func.now())
    confidence     = Column(Float, nullable=True)
    risk_level     = Column(String(20), nullable=True)        # "low" | "medium" | "high"
    original_issue = Column(String(255), nullable=True)
    reason         = Column(Text, nullable=True)
    user           = Column(String(255), nullable=True)

    file     = relationship("FileTable", foreign_keys=[file_id])
    user_rel = relationship("User",      foreign_keys=[user_id])


class TrainedModel(Base):
    """
    Persists a trained scikit-learn (or other) ML model as a pickle binary,
    plus its metadata and evaluation metrics.
    """
    __tablename__ = "trained_models"

    id         = Column(Integer, primary_key=True, index=True)
    user_id    = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    file_id    = Column(Integer, ForeignKey("files.id", ondelete="SET NULL"),  nullable=True,  index=True)

    # Identity
    model_name  = Column(String(255), nullable=False)
    model_type  = Column(Enum(MLModelTypeEnum, values_callable=lambda x: [e.value for e in x]), nullable=False)
    description = Column(Text, nullable=True)

    # Binary (pickle / joblib) — LONGBLOB to support models > 64 KB
    model_binary = Column(LONGBLOB, nullable=False)
    model_size   = Column(BigInteger, nullable=False)   # bytes

    # Training configuration (JSON): hyperparams, feature list, target column, etc.
    training_config = Column(JSON, default=dict)

    # Evaluation metrics (JSON): accuracy, F1, RMSE, R², confusion_matrix, etc.
    metrics = Column(JSON, default=dict)

    # Which columns were used as features / target
    feature_columns = Column(JSON, default=list)    # ["Age", "Salary", ...]
    target_column   = Column(String(255), nullable=True)

    # Dataset snapshot at training time
    training_row_count = Column(Integer, nullable=True)
    training_col_count = Column(Integer, nullable=True)

    # ── Flat metric columns for fast sorting/filtering ────────────────────────
    accuracy              = Column(Float, nullable=True, index=True)
    mae                   = Column(Float, nullable=True)
    r2_score              = Column(Float, nullable=True)
    precision_score       = Column(Float, nullable=True)
    recall_score          = Column(Float, nullable=True)
    f1_score              = Column(Float, nullable=True)
    rmse                  = Column(Float, nullable=True)
    training_time_seconds = Column(Float, nullable=True)
    training_samples      = Column(Integer, nullable=True)
    test_samples          = Column(Integer, nullable=True)

    # ── Sharing & discovery ───────────────────────────────────────────────────
    visibility  = Column(String(20), default="private", index=True)
    tags        = Column(JSON, default=list)
    created_by  = Column(String(100), nullable=True)   # username for display
    times_used  = Column(Integer, default=0)
    last_used_at = Column(DateTime(timezone=True), nullable=True)

    is_active  = Column(Boolean, default=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())

    # Relationships
    user = relationship("User",      back_populates="ml_models")
    file = relationship("FileTable", back_populates="trained_models")
