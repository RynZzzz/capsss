// frontend-jsx/src/components/DataProfilingPage.jsx

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ChevronDown,
  AlertCircle,
  AlertTriangle,
  XCircle,
  Save,
  Trash2,
  Grid,
  Sparkles,
  FileText,
  Columns,
} from "lucide-react";
import { useNavigate, useLocation } from "react-router-dom";
import AppHeader from "../../components/common/AppHeader";
import { useDataProfiler } from "../../components/hooks/useDataProfiler";
import { ValueDetailsModal } from "./section/ValueDetailsModals";
import InteractiveDataTable from "../../components/DataEditor/InteractiveDataTable";
import RibbonToolbar from "./section/RibbonToolbar";
import ApiService from "../../services/api";
import { getProject, invalidateLogs, invalidateProject } from "../../cache/sessionCache";

// ---------------------------------------------------------------------------
// Audit log helper — converts a step object to one or more log entries
// ---------------------------------------------------------------------------
function _stepToLogEntries(step, user) {
  const logMeta = step._logMeta || {};
  const base = (col, op, params) => ({
    column_name: col || "dataset",
    operation: op,
    parameters: params || {},
    confidence: logMeta.confidence ?? null,
    risk_level: logMeta.risk_level ?? null,
    original_issue: null,
    reason: logMeta.reason ?? null,
    user: user || "Guest",
  });

  switch (step.type) {
    case "impute": {
      const cols = step.payload?.columns?.length
        ? step.payload.columns
        : step.column
          ? [step.column]
          : ["dataset"];
      return cols.map((c) =>
        base(c, "impute", { strategy: step.payload?.strategy }),
      );
    }
    case "outlier": {
      const cols = step.payload?.columns?.length
        ? step.payload.columns
        : step.column
          ? [step.column]
          : ["dataset"];
      return cols.map((c) =>
        base(c, "outlier", { strategy: step.payload?.strategy }),
      );
    }
    case "duplicates": {
      const cols = step.payload?.columns?.length
        ? step.payload.columns
        : step.column
          ? [step.column]
          : [];
      if (cols.length === 0)
        return [
          base("dataset", "duplicates", { strategy: step.payload?.strategy }),
        ];
      return cols.map((c) =>
        base(c, "duplicates", { strategy: step.payload?.strategy }),
      );
    }
    case "type_conversion":
      return [
        base(step.column || "dataset", "type_conversion", {
          target_type: step.edited_value || step.payload?.targetType,
        }),
      ];
    case "type_inconsistency": {
      const cols = step.payload?.columns?.length
        ? step.payload.columns
        : step.column
          ? [step.column]
          : ["dataset"];
      return cols.map((c) =>
        base(c, "type_inconsistency", { method: step.payload?.method }),
      );
    }
    case "drop_column":
      return [base(step.payload?.colName || step.column || "unknown", "drop_column", {})];
    case "add_column":
      return [
        base(step.payload?.column_name || step.column || "unknown", "add_column", {
          column_type: step.payload?.column_type || "text",
        }),
      ];
    case "add_rows": {
      const rowCount = Array.isArray(step.payload?.row_data)
        ? step.payload.row_data.length
        : 1;
      return [base("dataset", "add_rows", { row_count: rowCount })];
    }
    case "delete_rows":
      return [
        base("dataset", "delete_rows", {
          row_count: step.payload?.rowIndices?.length ?? 1,
        }),
      ];
    case "cell_edit":
    case "cell_update":
      return [
        base(step.column || "unknown", "cell_update", {
          old_value: step.previous_value,
          new_value: step.edited_value,
        }),
      ];
    default:
      return [];
  }
}

const GlobalIssueFilter = ({ value, onChange }) => {
  const modes = [
    {
      value: "all",
      label: "All Issues",
      icon: AlertCircle,
      color: "bg-gray-100",
    },
    {
      value: "missing",
      label: "Missing",
      icon: XCircle,
      color: "bg-[#FB2C36]/10 text-[#FF6467]",
    },
    {
      value: "outlier",
      label: "Outliers",
      icon: AlertTriangle,
      color: "bg-[#F0B000]/10 text-[#F0B000]",
    },
    {
      value: "type_inconsistency",
      label: "Type Errors",
      icon: AlertCircle,
      color: "bg-[#AD46FF]/10 text-[#C27AFF]",
    },
    {
      value: "duplicates",
      label: "Duplicates",
      icon: AlertTriangle,
      color: "bg-[#2B7FFF]/10 text-[#2B7FFF]",
    },
    {
      value: "none",
      label: "None",
      icon: Grid,
      color: "bg-white border border-gray-200",
    },
  ];

  return (
    <div className="flex items-center gap-2">
      <span className="text-sm text-[#4A5565] mr-2">Filter:</span>
      {modes.map((mode) => (
        <button
          key={mode.value}
          onClick={() => onChange(mode.value)}
          className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
            value === mode.value
              ? `${mode.color} ring-2 ring-offset-1 ring-current`
              : "bg-gray-50 text-gray-600 hover:bg-gray-100"
          }`}
        >
          <mode.icon className="w-3 h-3 inline mr-1" />
          {mode.value === "none" && value === "none"
            ? "Clear Filters"
            : mode.label}
        </button>
      ))}
    </div>
  );
};

export const DataProfilingPage = () => {
  const navigate = useNavigate();
  const location = useLocation();

  // Modal state
  const [modalOpen, setModalOpen] = useState(false);
  const [modalType, setModalType] = useState(null); // 'unique', 'missing', 'outliers', 'type_errors'
  const [modalColumn, setModalColumn] = useState(null);

  const {
    filename,
    profile,
    selectedColumn,
    selectedColumnDetails,
    highlightMode,
    changeCount,
    isLoading,
    error,
    selectColumn,
    setHighlightMode,
    saveChanges,
    sessionId,
    refreshProfile,
    updateColumnType,
  } = useDataProfiler();

  useEffect(() => {
    if (!sessionId && !isLoading) {
      navigate("/upload");
    }
  }, [sessionId, isLoading, navigate]);

  useEffect(() => {
    if (!sessionId) return;
    let cancelled = false;
    // getProject rejects with "stale:project" if invalidateProject was called
    // while the request was in-flight, so outdated step lists are never applied.
    getProject(sessionId)
      .then((result) => {
        if (cancelled) return; // component unmounted or effect was superseded
        if (!result) return;
        if (result.file_id) setFileId(result.file_id);
        if (Array.isArray(result.steps)) setAppliedSteps(result.steps);
        if (Array.isArray(result.data) && result.data.length > 0) {
          const rows = result.data.map((row, i) => ({
            ...row,
            id: row._index ?? i,
          }));
          setTableRows(rows);
          if (Array.isArray(result.columns)) setTableColumns(result.columns);
          setRibbonRefreshTrigger((t) => t + 1);
        }
      })
      .catch(() => null);
    return () => { cancelled = true; };
  }, [sessionId]);

  const columnPickerRef = useRef(null);
  const [previewQuery, setPreviewQuery] = useState("");
  const [columnPickerOpen, setColumnPickerOpen] = useState(false);
  const [columnPickerQuery, setColumnPickerQuery] = useState("");
  const [selectedColumns, setSelectedColumns] = useState([]);
  const [selectedRows, setSelectedRows] = useState(new Set());
  const [selectedColumnIds, setSelectedColumnIds] = useState([]);
  const [appliedSteps, setAppliedSteps] = useState([]);
  const [highlightCell, setHighlightCell] = useState(null); // { rowIndex, columnName }
  const [fileId, setFileId] = useState(null);
  const [applyingSteps, setApplyingSteps] = useState(false);
  const [tableRows, setTableRows] = useState([]);
  const [tableColumns, setTableColumns] = useState([]);
  const [tableTotal, setTableTotal] = useState(0);
  const [tableOffset, setTableOffset] = useState(0);
  const [tableLoading, setTableLoading] = useState(false);
  const [tableHasMore, setTableHasMore] = useState(false);
  const tableViewportRef = React.useRef(null);
  const [selectedCell, setSelectedCell] = useState(null);
  const [cellSuggestion, setCellSuggestion] = useState(null);
  const [cellSuggestionLoading, setCellSuggestionLoading] = useState(false);
  const [cellSuggestionError, setCellSuggestionError] = useState(null);
  const [cellApplying, setCellApplying] = useState(false);
  const tableRequestIdRef = React.useRef(0);
  // Tracks which step is currently being previewed (null = at latest step)
  const previewIndexRef = React.useRef(null);
  // Tracks the previous allColumns so we can detect truly new columns
  const prevAllColumnsRef = useRef([]);
  const [ribbonTab, setRibbonTab] = useState("Clean");
  const [toast, setToast] = useState(null);
  const [activeAction, setActiveAction] = useState(null);
  const [duplicateScope, setDuplicateScope] = useState("all");
  const [modalState, setModalState] = useState(null);
  const [ribbonRefreshTrigger, setRibbonRefreshTrigger] = useState(0);
  const [issuesModalOpen, setIssuesModalOpen] = useState(false);
  const [suggestLoading, setSuggestLoading] = useState(false);
  const [suggestModalOpen, setSuggestModalOpen] = useState(false);
  const [suggestColumns, setSuggestColumns] = useState([]);
  const [appliedSuggestions, setAppliedSuggestions] = useState(new Set());
  // Incremented AFTER the API call completes so InteractiveDataTable fetches
  // fresh data from the backend (not before, which would race with _commit_replay).
  const [tableFetchTrigger, setTableFetchTrigger] = useState(0);
  // Live data pushed directly from addStep/deleteStep responses — avoids a second
  // HTTP round-trip and makes the table update feel instant.
  const [liveTableData, setLiveTableData] = useState(null);
  const [liveTableVersion, setLiveTableVersion] = useState(0);
  // Dedicated preview state for step-click — bypasses tableRows to avoid batching races
  const [stepPreviewData, setStepPreviewData] = useState(null);
  // Version counter — increments on every step click so InteractiveDataTable's effect
  // always fires even when the row data happens to be structurally identical.
  const [stepPreviewVersion, setStepPreviewVersion] = useState(0);

  // Open modal handler
  const openModal = (type, columnName) => {
    setModalType(type);
    setModalColumn(columnName);
    setModalOpen(true);
  };

  // Close modal handler
  const closeModal = () => {
    setModalOpen(false);
    setModalType(null);
    setModalColumn(null);
  };

  const showToast = useCallback((msg, type = "success") => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 5000);
  }, []);

  // Refresh profile after editing
  const handleValueUpdated = async () => {
    await refreshProfile();
    if (selectedColumn && sessionId) {
      await selectColumn(selectedColumn);
    }
  };

  const buildProfileContext = useCallback(() => {
    if (!profile) return null;
    const columns = (profile.columns || []).map((col) => ({
      name: col.name,
      type: col.data_type || col.type,
      total_count: col.total_count,
      non_null_count: col.non_null_count,
      missing_count: col.missing_count,
      unique_count: col.unique_count,
      outlier_count: col.outlier_count,
      type_inconsistency_count: col.type_inconsistency_count,
    }));
    return {
      metadata: profile.metadata,
      issues_summary: profile.issues_summary,
      columns,
    };
  }, [profile]);

  const columnTypeMap = useMemo(() => {
    const map = new Map();
    (profile?.columns || []).forEach((col) => {
      map.set(col.name, col.data_type || col.type || "text");
    });
    return map;
  }, [profile]);

  // Full-dataset column stats for ColumnOverviewPanel — avoids current-page bias.
  const profileColumnStatsMap = useMemo(() => {
    const map = {};
    (profile?.columns || []).forEach((col) => {
      const total = col.total_count || 0;
      const nonNull = col.non_null_count ?? total;
      map[col.name] = {
        total,
        nullCount:      col.missing_count || 0,
        outliers:       col.outlier_count || 0,
        typeErrors:     col.type_inconsistency_count || 0,
        unique:         col.unique_count || 0,
        completenessPct: col.completeness ?? (total ? (nonNull / total) * 100 : 0),
        min:      col.min    ?? null,
        max:      col.max    ?? null,
        avg:      col.mean   ?? null,
        median:   col.median ?? null,
        topValue: col.top_value ?? null,
        topFreq:  col.top_freq  ?? null,
      };
    });
    return map;
  }, [profile]);

  // Pre-built O(1) Sets from profile indices — avoids O(n) Array.includes per cell.
  const issueIndexSets = useMemo(() => {
    const sets = {};
    (profile?.columns || []).forEach((col) => {
      sets[col.name] = {
        missing: new Set(col.missing_indices || []),
        outlier: new Set(col.outlier_indices || []),
        type_inconsistency: new Set(col.type_inconsistency_indices || []),
      };
    });
    return sets;
  }, [profile]);

  const fallbackColumnIds = useMemo(
    () => (profile?.columns || []).map((col) => col.name),
    [profile],
  );
  const effectiveColumnIds = useMemo(
    () =>
      selectedColumnIds.length > 0 ? selectedColumnIds : fallbackColumnIds,
    [selectedColumnIds, fallbackColumnIds],
  );

  const selectedColumnMeta = useMemo(
    () =>
      effectiveColumnIds.map((id) => ({
        id,
        type: columnTypeMap.get(id) || "text",
      })),
    [effectiveColumnIds, columnTypeMap],
  );

  const normalizedTypes = useMemo(
    () =>
      selectedColumnMeta
        .map((col) => String(col.type).toLowerCase())
        .filter(Boolean),
    [selectedColumnMeta],
  );

  const hasSelection = effectiveColumnIds.length > 0;
  const allNumericSelected =
    hasSelection &&
    normalizedTypes.some(
      (t) =>
        t.includes("int") ||
        t.includes("dec") ||
        t.includes("num") ||
        t.includes("float"),
    );
  const allTextSelected =
    hasSelection &&
    normalizedTypes.some(
      (t) => t.includes("text") || t.includes("alpha") || t.includes("string"),
    );
  const allDateSelected =
    hasSelection && normalizedTypes.some((t) => t.includes("date"));

  useEffect(() => {
    if (selectedColumnIds.length === 1 && sessionId) {
      selectColumn(selectedColumnIds[0]);
    }
  }, [selectedColumnIds, sessionId, selectColumn]);


  const storedName = localStorage.getItem("user_name");
  const displayName =
    !storedName || storedName === "undefined" || storedName === "null"
      ? "Guest"
      : storedName;

  const handleLogout = () => {
    localStorage.removeItem("user_id");
    localStorage.removeItem("isLoggedIn");
    localStorage.removeItem("user_name");
    localStorage.removeItem("user_email");
    navigate("/login");
  };

  // const stats = useMemo(() => {
  //   if (!profile) return null;
  //   const { metadata, issues_summary } = profile;
  //   return {
  //     rows: metadata.total_rows,
  //     cols: metadata.total_columns,
  //     issues: issues_summary,
  //   };
  // }, [profile]);

  // const dataTypeDistribution = useMemo(() => {
  //   if (!profile) return [];
  //   const distribution = profile.type_distribution;
  //   const colors = {
  //     Integer: "bg-[#3B82F6]",
  //     Decimal: "bg-[#3B82F6]",
  //     Text: "bg-[#8B5CF6]",
  //     Alphanumeric: "bg-[#10B981]",
  //     DateTime: "bg-[#F59E0B]",
  //     Mixed: "bg-[#F59E0B]",
  //   };
  //   return Object.entries(distribution)
  //     .filter(([_, count]) => count > 0)
  //     .map(([name, count]) => ({
  //       name,
  //       count: `${count} cols`,
  //       color: colors[name] || "bg-[#6B7280]",
  //       value: count,
  //     }));
  // }, [profile]);

  // const columnStats = useMemo(() => {
  //   if (!profile?.columns) return [];

  //   return profile.columns.map((col) => ({
  //     // Use col.name (the string), NOT row[col.name]
  //     name: col.name,
  //     // Ensure this matches your Backend DataType Enum (col.data_type)
  //     type: col.data_type || col.type || "Mixed",
  //     completeness:
  //       col.completeness?.toFixed(1) || col.non_null_count
  //         ? ((col.non_null_count / col.total_count) * 100).toFixed(1)
  //         : "0.0",
  //     missingCount: col.missing_count || 0,
  //     uniqueValues: col.unique_count || 0,
  //     duplicates: (col.non_null_count || 0) - (col.unique_count || 0),
  //     outliers: col.outlier_count || 0,
  //     typeErrors: col.type_inconsistency_count || 0,
  //     // Add null checks for numeric stats
  //     min: col.min !== undefined ? col.min : (col.min_val ?? "N/A"),
  //     max: col.max !== undefined ? col.max : (col.max_val ?? "N/A"),
  //     mean: col.mean ? col.mean.toFixed(2) : "N/A",
  //     median: col.median ?? "N/A",
  //   }));
  // }, [profile]);

  // Derive ignored error flags from ignore_error steps — { "col|error_type": true }
  const ignoredErrors = useMemo(() => {
    const map = {};
    appliedSteps.forEach((step) => {
      if (step.type !== "ignore_error") return;
      const cols = step.payload?.columns || (step.column ? [step.column] : []);
      const errorType = step.payload?.error_type || "all";
      cols.forEach((col) => {
        if (errorType === "all") {
          map[`${col}|missing`] = true;
          map[`${col}|outlier`] = true;
          map[`${col}|type_inconsistency`] = true;
        } else {
          map[`${col}|${errorType}`] = true;
        }
      });
    });
    return map;
  }, [appliedSteps]);

  // Close column picker when clicking outside
  useEffect(() => {
    if (!columnPickerOpen) return;
    const handler = (e) => {
      if (columnPickerRef.current && !columnPickerRef.current.contains(e.target))
        setColumnPickerOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [columnPickerOpen]);


  // 1. Stats for the Top Cards (Rows, Cols, Issues)
  const stats = useMemo(() => {
    if (!profile) return null;
    const { metadata, issues_summary } = profile;
    const base = issues_summary || { total_issues: 0, missing: 0, outliers: 0, type_inconsistencies: 0, duplicates: 0 };

    // Subtract ignored counts per column
    let ignoredMissing = 0, ignoredOutliers = 0, ignoredTypeInc = 0;
    (profile.columns || []).forEach((col) => {
      if (ignoredErrors[`${col.name}|missing`]) ignoredMissing += col.missing_count || 0;
      if (ignoredErrors[`${col.name}|outlier`]) ignoredOutliers += col.outlier_count || 0;
      if (ignoredErrors[`${col.name}|type_inconsistency`]) ignoredTypeInc += col.type_inconsistency_count || 0;
    });

    const missing = Math.max(0, (base.missing || 0) - ignoredMissing);
    const outliers = Math.max(0, (base.outliers || 0) - ignoredOutliers);
    const type_inconsistencies = Math.max(0, (base.type_inconsistencies || 0) - ignoredTypeInc);
    const duplicates = base.duplicates || 0;
    return {
      rows: metadata?.total_rows || 0,
      cols: metadata?.total_columns || 0,
      issues: {
        ...base,
        missing,
        outliers,
        type_inconsistencies,
        duplicates,
        total_issues: missing + outliers + type_inconsistencies + duplicates,
      },
    };
  }, [profile, ignoredErrors]);


  const tablePageSize = 50;

  const loadTablePage = useCallback(
    async (nextOffset = 0, append = false) => {
      if (!sessionId) return;
      const requestId = ++tableRequestIdRef.current;
      if (!append && nextOffset === 0) {
        if (tableViewportRef.current) {
          tableViewportRef.current.scrollTop = 0;
        }
        setSelectedRows(new Set());
      }
      setTableLoading(true);
      try {
        const result = await ApiService.getPreviewRows(sessionId, {
          limit: tablePageSize,
          offset: nextOffset,
          search: previewQuery,
        });
        if (requestId !== tableRequestIdRef.current) return;
        const rows = result.rows || [];
        const cols = result.columns || [];
        setTableColumns(cols);
        setTableTotal(result.total || 0);
        setTableHasMore(Boolean(result.has_more));
        setTableOffset(nextOffset);
        setTableRows((prev) => (append ? [...prev, ...rows] : rows));
        return { rows, columns: cols, total: result.total || 0 };
      } catch {
        if (requestId !== tableRequestIdRef.current) return;
        setTableRows([]);
        setTableHasMore(false);
        setTableTotal(0);
        setTableOffset(0);
        return { rows: [], columns: [] };
      } finally {
        if (requestId === tableRequestIdRef.current) {
          setTableLoading(false);
        }
      }
    },
    [sessionId, tablePageSize, previewQuery],
  );

  // Search: debounce query changes and push results directly via liveData so
  // InteractiveDataTable doesn't need to know about the search term.
  const prevPreviewQueryRef = useRef("");
  useEffect(() => {
    if (!sessionId) return;
    const wasSearching = prevPreviewQueryRef.current !== "";
    prevPreviewQueryRef.current = previewQuery;

    if (!previewQuery) {
      if (wasSearching) {
        // Search cleared — reset table to full unfiltered data
        setTableFetchTrigger((t) => t + 1);
      }
      return;
    }

    const timer = setTimeout(async () => {
      const result = await loadTablePage(0);
      if (!result) return;
      setLiveTableData({ rows: result.rows, columns: result.columns, total: result.total });
      setLiveTableVersion((v) => v + 1);
    }, 350);
    return () => clearTimeout(timer);
  }, [previewQuery, sessionId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Initial row load is handled by InteractiveDataTable's own fetchData.
  // loadTablePage is still used for applyCellSuggestion and handleLoadMore.

  // ── Project / delta-based step dictionary ─────────────────────────────────
  // Every mutation goes through the backend's /api/project/{session_id}/step
  // endpoints. The backend replays all steps from original_file_binary and
  // returns fresh data + the updated step list.  No frontend replay needed.

  const addStep = useCallback(
    async (step) => {
      if (!sessionId) return;
      previewIndexRef.current = null;
      // Optimistic update — panel reflects the step immediately, no waiting for API
      setAppliedSteps((prev) => [...prev, step]);
      try {
        const result = await ApiService.addProjectStep(sessionId, step, fileId);
        if (result?.steps) setAppliedSteps(result.steps);
        if (Array.isArray(result?.columns)) setTableColumns(result.columns);
        invalidateProject(sessionId);
        setStepPreviewData(null);
        // cell_edit: if the table already applied the edit inline (_tableUpdated flag),
        // don't overwrite rows. For external edits (issues modal, drawer), re-fetch
        // so the table reflects the change without jumping to page 1.
        if (step.type === "cell_edit" && step._tableUpdated) {
          // nothing — InteractiveDataTable's commitEdit already updated the cell
        } else if (step.type === "cell_edit") {
          // External cell edit — re-fetch current page to show updated value
          setTableFetchTrigger((t) => t + 1);
        } else if (Array.isArray(result?.data)) {
          // Apply result directly — instant display, no second HTTP round-trip
          setLiveTableData({
            rows: result.data,
            columns: result.columns,
            total: result.total_rows,
          });
          setLiveTableVersion((v) => v + 1);
        } else {
          setTableFetchTrigger((t) => t + 1);
        }
        // Profile refresh is non-blocking — stats panel updates in the background
        refreshProfile().catch(() => null);
        // Fire-and-forget audit log — never blocks the UI
        try {
          const user = localStorage.getItem("user_name") || "Guest";
          const entries = _stepToLogEntries(step, user);
          if (entries.length > 0) {
            invalidateLogs(sessionId);
            ApiService.addPreprocessingLog(sessionId, entries).catch(
              () => null,
            );
          }
        } catch {}
      } catch (err) {
        // Revert optimistic step on failure
        setAppliedSteps((prev) => prev.filter((s) => s.id !== step.id));
        showToast(err?.message || "Failed to apply step. Please try again.", "error");
        await refreshProfile();
        setStepPreviewData(null);
        setTableFetchTrigger((t) => t + 1);
      }
    },
    [sessionId, fileId, refreshProfile, showToast],
  );

  // Called from ValueDetailsModal when user manually edits a cell — routes through addStep
  // so the table refreshes and the step appears in the applied steps panel.
  const handleSaveCell = useCallback(
    async ({ rowIndex, columnName, oldValue, newValue }) => {
      await addStep({
        id: `step_${Date.now()}`,
        type: "cell_edit",
        description: `Changed row ${rowIndex + 1}, "${columnName}": "${oldValue ?? "Empty"}" → "${newValue ?? "Empty"}"`,
        timestamp: Date.now(),
        column: columnName,
        row_index: rowIndex,
        previous_value: oldValue ?? null,
        edited_value: newValue ?? null,
        payload: {
          column: columnName,
          row_index: rowIndex,
          previous_value: oldValue ?? null,
          edited_value: newValue ?? null,
        },
      });
    },
    [addStep],
  );

  const handleDeleteSelected = useCallback(async () => {
    if (!sessionId) return;
    const rowIndices = Array.from(selectedRows);
    if (rowIndices.length === 0) return;
    const step = {
      id: `step_${Date.now()}`,
      type: "delete_rows",
      description: `Deleted ${rowIndices.length} row(s)`,
      timestamp: Date.now(),
      column: null,
      row_index: rowIndices.length === 1 ? rowIndices[0] : null,
      previous_value: null,
      edited_value: null,
      payload: { rowIndices },
    };
    await addStep(step);
    setSelectedRows(new Set());
  }, [sessionId, selectedRows, addStep]);

  const handleDeleteRow = useCallback(
    async (rowIndex) => {
      if (!sessionId) return;
      const step = {
        id: `step_${Date.now()}`,
        type: "delete_rows",
        description: "Deleted 1 row",
        timestamp: Date.now(),
        column: null,
        row_index: rowIndex,
        previous_value: null,
        edited_value: null,
        payload: { rowIndices: [rowIndex] },
      };
      await addStep(step);
      setSelectedRows(new Set());
    },
    [sessionId, addStep],
  );

  // Preview-only: ask backend to replay steps 0..index without persisting.
  const handleStepClick = useCallback(
    async (index) => {
      if (!sessionId) return;
      previewIndexRef.current = index;
      setHighlightCell(null); // clear while loading

      const clickedStep = appliedSteps[index];
      const isCellEdit =
        clickedStep &&
        (clickedStep.type === "cell_edit" || clickedStep.type === "cell_update");
      const isBatchStep =
        clickedStep &&
        (clickedStep.type === "impute" ||
          clickedStep.type === "outlier" ||
          clickedStep.type === "type_conversion" ||
          clickedStep.type === "type_inconsistency");

      try {
        // Fetch the "after" preview. For batch steps, also fetch "before" (step N-1)
        // so we can diff and highlight only the cells that actually changed.
        const fetchAfter = ApiService.previewProjectStep(sessionId, index);
        const fetchBefore =
          isBatchStep
            ? ApiService.previewProjectStep(sessionId, index - 1)
            : Promise.resolve(null);

        const [after, before] = await Promise.all([fetchAfter, fetchBefore]);

        if (after?.data) {
          const rows = after.data.map((row, i) => ({
            ...row,
            id: row._index ?? i,
          }));
          setStepPreviewVersion((v) => v + 1);
          setStepPreviewData({ rows, columns: after.columns || [] });
        }

        // Compute which cells actually changed
        if (isCellEdit) {
          setHighlightCell({
            rowIndex: clickedStep.row_index ?? clickedStep.payload?.row_index ?? null,
            columnName: clickedStep.column ?? clickedStep.payload?.column ?? null,
          });
        } else if (isBatchStep && after?.data && before?.data) {
          const { column, payload } = clickedStep;
          const affectedCols = payload?.columns?.length
            ? payload.columns
            : column
              ? [column]
              : [];

          if (affectedCols.length > 0) {
            // Build a lookup of before-rows by _index for O(1) access
            const beforeMap = new Map(
              before.data.map((r) => [r._index ?? 0, r]),
            );
            const changedCells = [];
            for (const afterRow of after.data) {
              const rowIdx = afterRow._index ?? 0;
              const beforeRow = beforeMap.get(rowIdx);
              if (!beforeRow) continue;
              for (const col of affectedCols) {
                const bVal = beforeRow[col];
                const aVal = afterRow[col];
                // Changed if both are defined and differ (treat null/undefined as equal)
                if (
                  (bVal == null) !== (aVal == null) ||
                  (bVal != null && aVal != null && String(bVal) !== String(aVal))
                ) {
                  changedCells.push({ rowIndex: rowIdx, columnName: col });
                }
              }
            }
            setHighlightCell(
              changedCells.length > 0 ? { changedCells } : null,
            );
          }
        }
      } catch {
        // ignore — leave table as-is
      }
    },
    [sessionId, appliedSteps],
  );

  const handleDeleteStep = useCallback(
    async (index) => {
      if (!sessionId || index < 0) return;
      previewIndexRef.current = null;
      try {
        const result = await ApiService.deleteProjectStep(sessionId, index);
        if (result?.steps) setAppliedSteps(result.steps);
        if (Array.isArray(result?.columns)) setTableColumns(result.columns);
        setStepPreviewData(null);
        if (Array.isArray(result?.data)) {
          setLiveTableData({
            rows: result.data,
            columns: result.columns,
            total: result.total_rows,
          });
          setLiveTableVersion((v) => v + 1);
        } else {
          setTableFetchTrigger((t) => t + 1);
        }
        refreshProfile().catch(() => null);
        // Backend cleared all logs; regenerate them from the remaining steps
        // so the log page stays in sync with the updated step list.
        invalidateLogs(sessionId);
        const remainingSteps = Array.isArray(result?.steps) ? result.steps : [];
        if (remainingSteps.length > 0) {
          try {
            const user = localStorage.getItem("user_name") || "Guest";
            const entries = remainingSteps.flatMap((s) => _stepToLogEntries(s, user));
            if (entries.length > 0) {
              ApiService.addPreprocessingLog(sessionId, entries).catch(() => null);
            }
          } catch {}
        }
      } catch {
        setStepPreviewData(null);
        setTableFetchTrigger((t) => t + 1);
      }
    },
    [sessionId, refreshProfile],
  );

  const handleResetAllSteps = useCallback(async () => {
    if (!sessionId) return;
    previewIndexRef.current = null;
    try {
      const result = await ApiService.clearProjectSteps(sessionId);
      invalidateProject(sessionId);
      invalidateLogs(sessionId);
      setAppliedSteps([]);
      setHighlightCell(null);
      if (Array.isArray(result?.columns)) setTableColumns(result.columns);
      setStepPreviewData(null);
      if (Array.isArray(result?.data)) {
        setLiveTableData({
          rows: result.data,
          columns: result.columns,
          total: result.total_rows,
        });
        setLiveTableVersion((v) => v + 1);
      } else {
        setTableFetchTrigger((t) => t + 1);
      }
      refreshProfile().catch(() => null);
    } catch (err) {
      const msg =
        err?.response?.data?.detail ||
        err?.message ||
        "Failed to reset steps. Please try again.";
      setToast({ type: "error", msg });
      setStepPreviewData(null);
      setTableFetchTrigger((t) => t + 1);
    }
  }, [sessionId, refreshProfile]);

  const handleRenameStep = useCallback(
    async (index, newName) => {
      if (!sessionId || index < 0 || index >= appliedSteps.length) return;
      const updatedStep = { ...appliedSteps[index], name: newName };
      // Optimistic update
      setAppliedSteps((prev) =>
        prev.map((s, i) => (i === index ? updatedStep : s)),
      );
      try {
        const result = await ApiService.updateProjectStep(
          sessionId,
          index,
          updatedStep,
        );
        if (result?.steps) setAppliedSteps(result.steps);
      } catch {
        // Revert on failure
        setAppliedSteps((prev) =>
          prev.map((s, i) => (i === index ? appliedSteps[index] : s)),
        );
      }
    },
    [sessionId, appliedSteps],
  );

  const issueLabel = (issues) => {
    if (!issues || issues.length === 0) return "No Issues";
    if (issues.some((i) => i.type === "type_inconsistency"))
      return "Type Mismatch";
    if (issues.some((i) => i.type === "outlier")) return "Outlier Detected";
    if (issues.some((i) => i.type === "missing")) return "Missing Value";
    return "Data Issue";
  };

  const openCellDrawer = useCallback(
    async ({ rowIdx, colName, value, issues }) => {
      setSelectedCell({ rowIdx, colName, value, issues });
      setCellSuggestion(null);
      setCellSuggestionError(null);
      setCellSuggestionLoading(true);
      try {
        const result = await ApiService.getCellSuggestion(
          sessionId,
          colName,
          rowIdx,
        );
        setCellSuggestion(result);
      } catch (e) {
        setCellSuggestionError(e?.message || "Failed to load suggestion");
      } finally {
        setCellSuggestionLoading(false);
      }
    },
    [sessionId],
  );

  const closeCellDrawer = () => {
    setSelectedCell(null);
    setCellSuggestion(null);
    setCellSuggestionError(null);
    setCellSuggestionLoading(false);
  };

  const applyCellSuggestion = useCallback(async () => {
    if (!selectedCell || !cellSuggestion) return;
    if (cellSuggestion.suggested_value === undefined) return;
    setCellApplying(true);
    try {
      await addStep({
        id: `step_${Date.now()}`,
        type: "cell_edit",
        description: `AI suggestion applied to ${selectedCell.colName}`,
        timestamp: Date.now(),
        column: selectedCell.colName,
        row_index: selectedCell.rowIdx,
        previous_value: selectedCell.value,
        edited_value: cellSuggestion.suggested_value,
        payload: {
          column: selectedCell.colName,
          row_index: selectedCell.rowIdx,
          old_value: selectedCell.value,
          new_value: cellSuggestion.suggested_value,
        },
      });
      closeCellDrawer();
    } catch (e) {
      setCellSuggestionError(e?.message || "Failed to apply suggestion");
    } finally {
      setCellApplying(false);
    }
  }, [selectedCell, cellSuggestion, sessionId, addStep]);


  const getCellIssues = useCallback((rowIndex, columnName) => {
    const sets = issueIndexSets[columnName];
    if (!sets) return [];
    const issues = [];
    if (!ignoredErrors[`${columnName}|missing`] && sets.missing.has(rowIndex))
      issues.push({ type: "missing", severity: "high" });
    if (!ignoredErrors[`${columnName}|outlier`] && sets.outlier.has(rowIndex))
      issues.push({ type: "outlier", severity: "medium" });
    if (!ignoredErrors[`${columnName}|type_inconsistency`] && sets.type_inconsistency.has(rowIndex))
      issues.push({ type: "type_inconsistency", severity: "medium" });
    return issues;
  }, [issueIndexSets, ignoredErrors]);

  const getRowId = useCallback((row, idx) => row._index ?? row.id ?? idx, []);

  const getCellValue = useCallback((row, columnName) => {
    const cell = row[columnName];
    if (cell && typeof cell === "object") {
      return cell.display_value ?? cell.value ?? "";
    }
    return cell ?? "";
  }, []);

  const getCellIssuesForRow = useCallback(
    (row, columnName) => {
      const rowIndex = row._index ?? (typeof row.id === "number" ? row.id : 0);
      return getCellIssues(rowIndex, columnName);
    },
    [getCellIssues],
  );

  const getCellClassName = useCallback((issues) => {
    if (!issues || issues.length === 0) return "text-[#364153]";
    if (issues.some((i) => i.type === "missing"))
      return "px-3 py-1 bg-[#FB2C36]/20 rounded-[10px] text-sm text-[#FF6467] font-medium";
    if (issues.some((i) => i.type === "type_inconsistency"))
      return "px-3 py-1 bg-[#AD46FF]/20 rounded-[10px] text-sm text-[#C27AFF] font-medium border border-[#AD46FF]/30";
    if (issues.some((i) => i.type === "outlier"))
      return "px-3 py-1 bg-[#F0B000]/20 rounded-[10px] text-sm text-[#F0B000] font-medium";
    return "text-[#364153]";
  }, []);

  const getCellContent = useCallback((value, issues) => {
    if (issues.some((i) => i.type === "missing")) return "Empty";
    const hasTypeError = issues.some((i) => i.type === "type_inconsistency");
    const hasOutlier = issues.some((i) => i.type === "outlier");
    if (hasTypeError && hasOutlier) return `${value} ⚠️🔢`;
    if (hasTypeError) return `${value} ⚠️`;
    if (hasOutlier) return `${value} 🔢`;
    return value;
  }, []);

  const allColumns = useMemo(
    () =>
      tableColumns.length
        ? tableColumns
        : profile?.columns?.map((c) => c.name) || [],
    [tableColumns, profile],
  );
  const pinnedColumn = allColumns.includes("Student Name")
    ? "Student Name"
    : allColumns[0];

  const handleDropColumn = useCallback(
    async (colName) => {
      if (!sessionId || !colName) return;
      if (colName === pinnedColumn) return;
      await addStep({
        id: `step_${Date.now()}`,
        type: "drop_column",
        description: `Dropped column "${colName}"`,
        timestamp: Date.now(),
        column: colName,
        row_index: null,
        previous_value: null,
        edited_value: null,
      });
      setSelectedColumns((prev) => prev.filter((c) => c !== colName));
    },
    [sessionId, pinnedColumn, addStep],
  );

  const closeRibbonModal = useCallback(() => {
    setModalState(null);
  }, []);

  const openRibbonModal = useCallback((config) => {
    setModalState({
      ...config,
      values: config.values || {},
    });
  }, []);

  const updateRibbonModalValue = useCallback((key, value) => {
    setModalState((prev) =>
      prev ? { ...prev, values: { ...prev.values, [key]: value } } : prev,
    );
  }, []);

  const requestConversionDecision = useCallback(
    ({ column, targetType, report }) =>
      new Promise((resolve) => {
        setModalState({
          title: `Conversion Check: ${column}`,
          message: `Some rows cannot be converted to ${targetType}. Choose how to continue.`,
          conversionReport: report,
          actions: [
            {
              label: "Cancel",
              variant: "secondary",
              onClick: () => resolve("cancel"),
            },
            {
              label: "Convert Partial",
              variant: "primary",
              onClick: () => resolve("partial"),
            },
          ],
        });
      }),
    [],
  );

  const applyImpute = useCallback(
    async (strategy, options = {}, columnsOverride) => {
      const columnsToUse =
        columnsOverride && columnsOverride.length > 0
          ? columnsOverride
          : effectiveColumnIds;
      if (!sessionId || columnsToUse.length === 0) return;
      setActiveAction(`impute_${strategy}`);
      try {
        await addStep({
          id: `step_${Date.now()}`,
          type: "impute",
          description: `Impute ${strategy} on ${columnsToUse.length} column(s)`,
          timestamp: Date.now(),
          column: columnsToUse.length === 1 ? columnsToUse[0] : null,
          row_index: null,
          previous_value: null,
          edited_value: null,
          payload: { strategy, options, columns: columnsToUse },
        });
        showToast(`Applied ${strategy.replace("_", " ")} imputation`);
      } catch (err) {
        showToast(err?.message || "Imputation failed", "error");
      } finally {
        setActiveAction(null);
      }
    },
    [sessionId, effectiveColumnIds, addStep, showToast],
  );

  const applyOutliers = useCallback(
    async (strategy, columnsOverride) => {
      const columnsToUse =
        columnsOverride && columnsOverride.length > 0
          ? columnsOverride
          : effectiveColumnIds;
      if (!sessionId || columnsToUse.length === 0) return;
      setActiveAction(`outliers_${strategy}`);
      try {
        await addStep({
          id: `step_${Date.now()}`,
          type: "outlier",
          description: `Outlier ${strategy} on ${columnsToUse.length} column(s)`,
          timestamp: Date.now(),
          column: columnsToUse.length === 1 ? columnsToUse[0] : null,
          row_index: null,
          previous_value: null,
          edited_value: null,
          payload: { strategy, columns: columnsToUse },
        });
        showToast("Outlier detection applied");
      } catch (err) {
        showToast(err?.message || "Outlier detection failed", "error");
      } finally {
        setActiveAction(null);
      }
    },
    [sessionId, effectiveColumnIds, addStep, showToast],
  );

  const applyDuplicates = useCallback(
    async (strategy, columnsOverride) => {
      if (!sessionId) return;
      setActiveAction(`duplicates_${strategy}`);
      try {
        const columns =
          columnsOverride && columnsOverride.length > 0
            ? columnsOverride
            : duplicateScope === "selected" && effectiveColumnIds.length > 0
              ? effectiveColumnIds
              : null;
        await addStep({
          id: `step_${Date.now()}`,
          type: "duplicates",
          description: `Duplicate ${strategy} applied`,
          timestamp: Date.now(),
          column: columns && columns.length === 1 ? columns[0] : null,
          row_index: null,
          previous_value: null,
          edited_value: null,
          payload: { strategy, columns, scope: duplicateScope },
        });
        showToast("Duplicate handling applied");
      } catch (err) {
        showToast(err?.message || "Duplicate handling failed", "error");
      } finally {
        setActiveAction(null);
      }
    },
    [sessionId, duplicateScope, effectiveColumnIds, addStep, showToast],
  );

  const applyTypeFix = useCallback(
    async (config) => {
      if (!sessionId || effectiveColumnIds.length === 0) return;
      setActiveAction(`typefix_${config.method || "cleanup"}`);
      try {
        await addStep({
          id: `step_${Date.now()}`,
          type: "type_inconsistency",
          description: `Type fix ${config.method || "cleanup"} on ${effectiveColumnIds.length} column(s)`,
          timestamp: Date.now(),
          column:
            effectiveColumnIds.length === 1 ? effectiveColumnIds[0] : null,
          row_index: null,
          previous_value: null,
          edited_value: null,
          payload: { ...config, columns: effectiveColumnIds },
        });
        showToast(config.method === "remove" ? "Rows with type errors removed" : "Type inconsistencies fixed");
      } catch (err) {
        showToast(err?.message || "Type fix failed", "error");
      } finally {
        setActiveAction(null);
      }
    },
    [sessionId, effectiveColumnIds, addStep, showToast],
  );

  const applyTypeConversion = useCallback(
    async (targetType) => {
      if (!sessionId || effectiveColumnIds.length === 0) return;
      setActiveAction(`convert_${targetType}`);
      try {
        for (const column of effectiveColumnIds) {
          await addStep({
            id: `step_${Date.now()}`,
            type: "type_conversion",
            description: `Converted "${column}" to ${targetType}`,
            timestamp: Date.now(),
            column,
            row_index: null,
            previous_value: null,
            edited_value: targetType,
            payload: { column, targetType },
          });
        }
        showToast(`Converted ${effectiveColumnIds.length} column(s)`);
      } catch (err) {
        showToast(err?.message || "Type conversion failed", "error");
      } finally {
        setActiveAction(null);
      }
    },
    [sessionId, effectiveColumnIds, addStep, showToast],
  );

  const applyTextTransform = useCallback(
    async (operation, extraPayload = {}) => {
      if (!sessionId || effectiveColumnIds.length === 0) return;
      setActiveAction(`text_${operation}`);
      try {
        await addStep({
          id: `step_${Date.now()}`,
          type: "text_transform",
          description: `${operation.charAt(0).toUpperCase() + operation.slice(1)} on "${effectiveColumnIds.join(", ")}"`,
          timestamp: Date.now(),
          column: effectiveColumnIds[0],
          row_index: null,
          previous_value: null,
          edited_value: operation,
          payload: { operation, columns: effectiveColumnIds, ...extraPayload },
        });
        showToast(
          `Applied ${operation} to ${effectiveColumnIds.length} column(s)`,
        );
      } catch (err) {
        showToast(err?.message || "Text transform failed", "error");
      } finally {
        setActiveAction(null);
      }
    },
    [sessionId, effectiveColumnIds, addStep, showToast],
  );

  const applyReplaceValues = useCallback(
    async (findValue, replaceValue) => {
      if (!sessionId || effectiveColumnIds.length === 0) return;
      const replacements = { [findValue]: replaceValue };
      setActiveAction("text_replace_values");
      try {
        await addStep({
          id: `step_${Date.now()}`,
          type: "text_transform",
          description: `Replace "${findValue}" → "${replaceValue}" in "${effectiveColumnIds.join(", ")}"`,
          timestamp: Date.now(),
          column: effectiveColumnIds[0],
          row_index: null,
          previous_value: findValue,
          edited_value: replaceValue,
          payload: { operation: "replace_values", columns: effectiveColumnIds, replacements },
        });
        showToast(`Replaced values in ${effectiveColumnIds.length} column(s)`);
      } catch (err) {
        showToast(err?.message || "Replace failed", "error");
      } finally {
        setActiveAction(null);
      }
    },
    [sessionId, effectiveColumnIds, addStep, showToast],
  );

  const applyIgnoreErrors = useCallback(
    async (errorType) => {
      if (!sessionId || effectiveColumnIds.length === 0) return;
      setActiveAction(`ignore_${errorType}`);
      try {
        await addStep({
          id: `step_${Date.now()}`,
          type: "ignore_error",
          description: `Ignored ${errorType} errors in "${effectiveColumnIds.join(", ")}"`,
          timestamp: Date.now(),
          column: effectiveColumnIds[0],
          row_index: null,
          previous_value: null,
          edited_value: errorType,
          payload: { error_type: errorType, columns: effectiveColumnIds },
        });
        showToast(`Ignored ${errorType} errors in ${effectiveColumnIds.length} column(s)`);
      } catch (err) {
        showToast(err?.message || "Ignore failed", "error");
      } finally {
        setActiveAction(null);
      }
    },
    [sessionId, effectiveColumnIds, addStep, showToast],
  );

  const applyRenameColumn = useCallback(() => {
    if (effectiveColumnIds.length !== 1) {
      showToast("Select exactly one column to rename", "error");
      return;
    }
    const oldName = effectiveColumnIds[0];
    openRibbonModal({
      title: `Rename Column: ${oldName}`,
      fields: [{ key: "newName", label: "New column name", type: "text" }],
      values: { newName: oldName },
      onConfirm: async ({ newName }) => {
        const trimmed = (newName || "").trim();
        if (!trimmed || trimmed === oldName) return;
        setActiveAction("rename_column");
        try {
          await addStep({
            id: `step_${Date.now()}`,
            type: "rename_column",
            description: `Renamed "${oldName}" → "${trimmed}"`,
            timestamp: Date.now(),
            column: oldName,
            row_index: null,
            previous_value: null,
            edited_value: trimmed,
            payload: { oldName, newName: trimmed },
          });
          showToast(`Renamed "${oldName}" to "${trimmed}"`);
        } catch (err) {
          showToast(err?.message || "Rename failed", "error");
        } finally {
          setActiveAction(null);
        }
      },
    });
  }, [effectiveColumnIds, openRibbonModal, addStep, showToast]);

  const applyDuplicateColumn = useCallback(() => {
    if (effectiveColumnIds.length !== 1) {
      showToast("Select exactly one column to duplicate", "error");
      return;
    }
    const col = effectiveColumnIds[0];
    openRibbonModal({
      title: `Duplicate Column: ${col}`,
      fields: [{ key: "newName", label: "New column name", type: "text" }],
      values: { newName: `${col}_copy` },
      onConfirm: async ({ newName }) => {
        const trimmed = (newName || "").trim();
        if (!trimmed) return;
        setActiveAction("duplicate_column");
        try {
          await addStep({
            id: `step_${Date.now()}`,
            type: "duplicate_column",
            description: `Duplicated "${col}" as "${trimmed}"`,
            timestamp: Date.now(),
            column: col,
            row_index: null,
            previous_value: null,
            edited_value: trimmed,
            payload: { column: col, newName: trimmed },
          });
          showToast(`Duplicated "${col}" as "${trimmed}"`);
        } catch (err) {
          showToast(err?.message || "Duplicate failed", "error");
        } finally {
          setActiveAction(null);
        }
      },
    });
  }, [effectiveColumnIds, openRibbonModal, addStep, showToast]);

  const applyMergeColumns = useCallback(() => {
    if (effectiveColumnIds.length < 2) {
      showToast("Select at least two columns to merge", "error");
      return;
    }
    openRibbonModal({
      title: "Merge Columns",
      message: `Merging: ${effectiveColumnIds.join(", ")}`,
      fields: [
        { key: "newName", label: "New column name", type: "text" },
        { key: "separator", label: "Separator", type: "text" },
      ],
      values: { newName: effectiveColumnIds.join("_"), separator: " " },
      onConfirm: async ({ newName, separator }) => {
        const trimmed = (newName || "").trim();
        if (!trimmed) return;
        setActiveAction("merge_columns");
        try {
          await addStep({
            id: `step_${Date.now()}`,
            type: "merge_columns",
            description: `Merged [${effectiveColumnIds.join(", ")}] → "${trimmed}"`,
            timestamp: Date.now(),
            column: effectiveColumnIds[0],
            row_index: null,
            previous_value: null,
            edited_value: trimmed,
            payload: {
              columns: effectiveColumnIds,
              newName: trimmed,
              separator: separator ?? " ",
            },
          });
          showToast(
            `Merged ${effectiveColumnIds.length} columns into "${trimmed}"`,
          );
        } catch (err) {
          showToast(err?.message || "Merge failed", "error");
        } finally {
          setActiveAction(null);
        }
      },
    });
  }, [effectiveColumnIds, openRibbonModal, addStep, showToast]);

  const applyDeleteColumns = useCallback(async () => {
    if (effectiveColumnIds.length === 0) return;
    setActiveAction("delete_columns");
    try {
      for (const col of effectiveColumnIds) {
        await handleDropColumn(col);
      }
      showToast(`Deleted ${effectiveColumnIds.length} column(s)`);
    } catch (err) {
      showToast(err?.message || "Delete failed", "error");
    } finally {
      setActiveAction(null);
    }
  }, [effectiveColumnIds, handleDropColumn, showToast]);

  const handleContextAction = useCallback(
    (action, columnId) => {
      if (!columnId) return;
      if (action === "fill_mode") {
        applyImpute("mode", {}, [columnId]);
      }
      if (action === "remove_missing_rows") {
        applyImpute("remove_rows", {}, [columnId]);
      }
      if (action === "outliers_iqr_cap") {
        applyOutliers("iqr_cap", [columnId]);
      }
      if (action === "duplicates_mark") {
        applyDuplicates("mark", [columnId]);
      }
    },
    [applyImpute, applyOutliers, applyDuplicates],
  );

  useEffect(() => {
    if (!allColumns.length) return;
    const prevAllCols = prevAllColumnsRef.current;
    prevAllColumnsRef.current = allColumns;
    const prevAllSet = new Set(prevAllCols);
    setSelectedColumns((prev) => {
      if (!prev || prev.length === 0) {
        return allColumns;
      }
      // Keep user's existing selections that still exist in allColumns
      const kept = prev.filter((col) => allColumns.includes(col));
      // Auto-include columns that are brand new (not in previous allColumns at all)
      const brandNew = allColumns.filter((col) => !prevAllSet.has(col));
      const merged = [...kept, ...brandNew];
      if (pinnedColumn && !merged.includes(pinnedColumn)) {
        merged.unshift(pinnedColumn);
      }
      const resolved = merged.length ? merged : allColumns;
      if (
        prev.length === resolved.length &&
        prev.every((col, idx) => col === resolved[idx])
      ) {
        return prev;
      }
      return resolved;
    });
  }, [allColumns, pinnedColumn]);

  const visibleColumns =
    selectedColumns.length > 0
      ? allColumns.filter((col) => selectedColumns.includes(col))
      : allColumns;
  const interactiveColumns = useMemo(
    () =>
      allColumns.map((name) => {
        const profileCol = profile?.columns?.find((c) => c.name === name);
        const type = profileCol?.data_type || profileCol?.type || "text";
        return { id: name, name, type };
      }),
    [allColumns, profile],
  );
  const baseRows = useMemo(() => {
    if (tableRows.length > 0) return tableRows;
    const fallback = profile?.data?.data || [];
    if (!previewQuery && !tableLoading && fallback.length > 0) {
      return fallback;
    }
    return [];
  }, [tableRows, previewQuery, tableLoading, profile]);

  const duplicateRowSet = useMemo(() => {
    // Start with full-dataset duplicate indices returned by the backend profiler
    const backendIndices = profile?.issues_summary?.duplicate_indices;
    const dupes = backendIndices?.length
      ? new Set(backendIndices)
      : new Set();

    // Also add any page-local duplicates (handles cases where profile is stale)
    if (visibleColumns.length > 0) {
      const counts = new Map();
      const keyForRow = (row) =>
        visibleColumns
          .map((col) => {
            const cell = row[col];
            if (cell && typeof cell === "object") {
              return cell.display_value ?? cell.value ?? "";
            }
            return cell ?? "";
          })
          .join("|");
      baseRows.forEach((row) => {
        const key = keyForRow(row);
        counts.set(key, (counts.get(key) || 0) + 1);
      });
      baseRows.forEach((row, idx) => {
        const key = keyForRow(row);
        if ((counts.get(key) || 0) > 1) {
          dupes.add(row._index ?? idx);
        }
      });
    }
    return dupes;
  }, [baseRows, visibleColumns, profile]);

  const rowMatchesFilter = useCallback(
    (row, rowIdx) => {
      if (highlightMode === "none") return true;
      const rowIndexForIssues = row._index ?? rowIdx;
      if (highlightMode === "duplicates") {
        return duplicateRowSet.has(rowIndexForIssues);
      }
      if (highlightMode === "all" && duplicateRowSet.has(rowIndexForIssues)) {
        return true;
      }
      for (const col of visibleColumns) {
        const cellData = row[col];
        const cellIssues =
          typeof cellData === "object" && cellData?.issues
            ? cellData.issues
            : getCellIssues(rowIndexForIssues, col);
        if (!cellIssues || cellIssues.length === 0) continue;
        if (highlightMode === "all") return true;
        if (cellIssues.some((i) => i.type === highlightMode)) return true;
      }
      return false;
    },
    [highlightMode, visibleColumns, getCellIssues, duplicateRowSet],
  );

  const filteredRows = useMemo(() => {
    if (highlightMode === "none") return baseRows;
    return baseRows.filter((row, idx) => rowMatchesFilter(row, idx));
  }, [baseRows, highlightMode, rowMatchesFilter]);

  const displayRows = filteredRows;
  const displayRowsMemo = useMemo(() => displayRows, [displayRows]);
  const interactiveRows = useMemo(
    () =>
      displayRowsMemo.map((row, index) => {
        const id = row._index ?? row.id ?? index;
        const values = interactiveColumns.reduce(
          (acc, col) => ({
            ...acc,
            [col.id]:
              row[col.id] && typeof row[col.id] === "object"
                ? row[col.id]
                : getCellValue(row, col.id),
          }),
          {},
        );
        return { id, _index: row._index ?? id, ...values };
      }),
    [displayRowsMemo, interactiveColumns, getCellValue],
  );
  const handleLoadMore = useCallback(() => {
    if (tableLoading || !tableHasMore) return;
    loadTablePage(tableOffset + tablePageSize, true);
  }, [tableLoading, tableHasMore, loadTablePage, tableOffset, tablePageSize]);

  const histogramBins = cellSuggestion?.histogram?.bins || [];
  const maxHistogramCount = histogramBins.length
    ? Math.max(...histogramBins.map((b) => b.count))
    : 0;
  const highlightedBin = cellSuggestion?.histogram?.value_bin;
  const suggestionStatus = cellSuggestionLoading
    ? "Loading"
    : cellSuggestionError
      ? "Unavailable"
      : cellSuggestion?.suggested_value !== undefined &&
          cellSuggestion?.suggested_value !== null
        ? "Suggested"
        : "No suggestion";

  // const previewData = useMemo(
  //   () => profile?.data?.data?.slice(0, 10) || [],
  //   [profile],
  // );


  // Map a DSL operation to an addStep payload
  const dslOpToStep = useCallback((op) => {
    const col = op.column;
    const ts = Date.now();
    const id = `step_${ts}_${Math.random().toString(36).slice(2, 7)}`;
    // AI suggestion metadata — passed through to the audit log
    const _logMeta = {
      reason: op.reason,
      confidence: op.confidence,
      risk_level: op.risk_level,
    };
    switch (op.type) {
      case "fill_nulls":
        return {
          id,
          type: "impute",
          description: `Fill nulls (${op.method}) on "${col}"`,
          timestamp: ts,
          column: col,
          row_index: null,
          previous_value: null,
          edited_value: null,
          payload: {
            strategy:
              op.method === "mean"
                ? "mean"
                : op.method === "median"
                  ? "median"
                  : op.method === "mode"
                    ? "mode"
                    : "constant",
            columns: [col],
          },
          _logMeta,
        };
      case "drop_nulls":
        return {
          id,
          type: "impute",
          description: `Drop nulls on "${col}"`,
          timestamp: ts,
          column: col,
          row_index: null,
          previous_value: null,
          edited_value: null,
          payload: { strategy: "remove", columns: [col] },
          _logMeta,
        };
      case "cap_outliers":
        return {
          id,
          type: "outlier",
          description: `Cap outliers (IQR) on "${col}"`,
          timestamp: ts,
          column: col,
          row_index: null,
          previous_value: null,
          edited_value: null,
          payload: { strategy: "iqr_cap", columns: [col] },
          _logMeta,
        };
      case "remove_outliers":
        return {
          id,
          type: "outlier",
          description: `Remove outliers (IQR) on "${col}"`,
          timestamp: ts,
          column: col,
          row_index: null,
          previous_value: null,
          edited_value: null,
          payload: { strategy: "iqr_remove", columns: [col] },
          _logMeta,
        };
      case "deduplicate":
        return {
          id,
          type: "duplicates",
          description: `Deduplicate "${col}"`,
          timestamp: ts,
          column: col,
          row_index: null,
          previous_value: null,
          edited_value: null,
          payload: { strategy: "keep_first", columns: [col] },
          _logMeta,
        };
      case "convert_type":
        return {
          id,
          type: "type_conversion",
          description: `Convert "${col}" to ${op.target_type}`,
          timestamp: ts,
          column: col,
          row_index: null,
          previous_value: null,
          edited_value: op.target_type,
          payload: { column: col, targetType: op.target_type },
          _logMeta,
        };
      case "trim_whitespace":
      case "normalize_case":
      case "lowercase":
      case "uppercase":
        return {
          id,
          type: "type_inconsistency",
          description: `${op.type.replace("_", " ")} on "${col}"`,
          timestamp: ts,
          column: col,
          row_index: null,
          previous_value: null,
          edited_value: null,
          payload: {
            method: op.type === "uppercase" ? "uppercase" : "lowercase",
            columns: [col],
          },
          _logMeta,
        };
      default:
        return null;
    }
  }, []);

  const handleSuggestPreprocessing = useCallback(async () => {
    if (!sessionId) return;
    setSuggestLoading(true);
    try {
      const result = await ApiService.suggestPreprocessing(sessionId);
      const cols = (result?.columns || []).filter(
        (c) => c.operations?.length > 0,
      );
      setSuggestColumns(cols);
      setAppliedSuggestions(new Set());
      setSuggestModalOpen(true);
    } catch {
      // ignore — nothing to show
    } finally {
      setSuggestLoading(false);
    }
  }, [sessionId]);

  const handleApplySuggestion = useCallback(
    async (op, key) => {
      const step = dslOpToStep(op);
      if (!step) return;
      await addStep(step);
      setAppliedSuggestions((prev) => new Set([...prev, key]));
    },
    [dslOpToStep, addStep],
  );

  const handleApplyAllSuggestions = useCallback(async () => {
    const allOps = suggestColumns
      .flatMap((col) =>
        col.operations.map((op, i) => ({ op, key: `${col.column_name}-${i}` })),
      )
      .filter(({ key }) => !appliedSuggestions.has(key));
    for (const { op, key } of allOps) {
      const step = dslOpToStep(op);
      if (step) {
        await addStep(step);
        setAppliedSuggestions((prev) => new Set([...prev, key]));
      }
    }
  }, [suggestColumns, appliedSuggestions, dslOpToStep, addStep]);

  const statsCards = useMemo(() => {
    if (!stats) return [];
    return [
      {
        title: "Total Rows",
        value: stats.rows.toLocaleString(),
        subtitle: "Records in dataset",
        icon: FileText,
        gradient: "from-[#2B7FFF]/10 to-[#2B7FFF]/5",
        border: "border-[#2B7FFF]/30",
        iconBg: "bg-[#2B7FFF]/20",
        iconColor: "text-[#51A2FF]",
        valueColor: "text-[#51A2FF]",
      },
      {
        title: "Columns",
        value: stats.cols.toString(),
        subtitle: "Feature columns",
        icon: Grid,
        gradient: "from-[#AD46FF]/10 to-[#AD46FF]/5",
        border: "border-[#AD46FF]/30",
        iconBg: "bg-[#AD46FF]/20",
        iconColor: "text-[#C27AFF]",
        valueColor: "text-[#C27AFF]",
      },
      {
        title: "Issues Found",
        value: stats.issues.total_issues.toLocaleString(),
        subtitle: `${stats.issues.missing} missing · ${stats.issues.outliers} outliers · ${stats.issues.type_inconsistencies} type errors · ${stats.issues.duplicates} duplicates`,
        icon: AlertCircle,
        gradient: "from-[#FA2B36]/10 to-[#FA2B36]/5",
        border: "border-[#FA2B36]/30",
        iconBg: "bg-[#FB2C36]/20",
        iconColor: "text-[#FF6467]",
        valueColor: "text-[#FF6467]",
        clickable: true,
      },
    ];
  }, [stats]);


  // Show loading spinner while uploading
  if (isLoading && !profile) {
    return (
      <div className="w-full min-h-screen bg-white font-['Poppins']">
        <AppHeader onLogout={handleLogout} />
        <div className="pt-[130px] flex items-center justify-center min-h-screen">
          <div className="text-center">
            <div className="animate-spin w-16 h-16 border-4 border-[#2B7FFF] border-t-transparent rounded-full mx-auto mb-4"></div>
            <p className="text-xl text-gray-600">Loading your data...</p>
          </div>
        </div>
      </div>
    );
  }

  // Show "no data" only if not loading and no profile exists
  if (!profile) {
    return (
      <div className="w-full min-h-screen bg-white font-['Poppins']">
        <AppHeader onLogout={handleLogout} />
        <div className="pt-[130px] flex items-center justify-center min-h-screen">
          <div className="text-center">
            <p className="text-2xl text-gray-600">No data loaded</p>
            <button
              onClick={() => navigate("/upload")}
              className="mt-4 px-6 py-3 bg-gradient-to-r from-[#51A2FF] to-[#C27AFF] text-white rounded-lg"
            >
              Upload Dataset
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="w-full min-h-screen bg-white font-['Poppins']">
      <AppHeader
        onLogout={handleLogout}
        extra={
          changeCount > 0 && (
            <button
              onClick={() => saveChanges()}
              className="px-4 py-2 bg-green-500 text-white rounded-lg flex items-center gap-2 hover:bg-green-600"
            >
              <Save className="w-4 h-4" />
              <span className="text-sm">Save ({changeCount})</span>
            </button>
          )
        }
      />
      <main className="pt-[80px] sm:pt-[90px] lg:pt-[130px] pb-16 px-4 sm:px-6 lg:px-[100px]">
        <div className="mb-6 flex items-end justify-between gap-4">
          <div>
            <h2 className="text-2xl sm:text-3xl lg:text-4xl font-bold text-transparent bg-clip-text bg-gradient-to-r from-[#2B7FFF] to-[#AD46FF]">
              Data Profiling
            </h2>
            <p className="text-xl text-[#4A5565] mt-1">Analyzing: {filename}</p>
          </div>
          <button
            onClick={handleSuggestPreprocessing}
            disabled={suggestLoading}
            className="flex items-center gap-2 px-5 py-2.5 bg-gradient-to-r from-[#AD46FF] to-[#2B7FFF] text-white text-sm font-medium rounded-xl shadow-sm hover:opacity-90 transition-opacity disabled:opacity-60 disabled:cursor-not-allowed shrink-0"
          >
            {suggestLoading ? (
              <>
                <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                Analyzing…
              </>
            ) : (
              <>
                <Sparkles className="w-4 h-4" />
                Suggest Preprocessing
              </>
            )}
          </button>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 mb-6">
          {statsCards.map((card, idx) => (
            <div
              key={idx}
              onClick={
                card.clickable ? () => setIssuesModalOpen(true) : undefined
              }
              className={`p-6 bg-gradient-to-br ${card.gradient} rounded-3xl border ${card.border} shadow-sm ${card.clickable ? "cursor-pointer hover:shadow-md transition-shadow" : ""}`}
            >
              <div className="flex items-center gap-3 mb-3">
                <div
                  className={`w-12 h-12 ${card.iconBg} rounded-[14px] flex items-center justify-center`}
                >
                  <card.icon className={`w-6 h-6 ${card.iconColor}`} />
                </div>
                <p className="text-sm text-[#4A5565]">{card.title}</p>
                {card.clickable && (
                  <span className="ml-auto text-xs text-[#FF6467] opacity-70">
                    View all →
                  </span>
                )}
              </div>
              <div className={`text-5xl font-bold ${card.valueColor} mb-3`}>
                {card.value}
              </div>
              <p className="text-sm text-[#4A5565]">{card.subtitle}</p>
            </div>
          ))}
        </div>

        {/* Table Preview with all highlighting logic - continuing from stats cards */}
        <div className="mb-6 bg-white rounded-3xl border border-gray-200 shadow-md overflow-hidden">
          <div className="px-6 py-6 border-b border-gray-200">
            <div className="flex justify-between items-center mb-4 gap-4">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 bg-[#00D3F2]/20 rounded-[14px] flex items-center justify-center">
                  <FileText className="w-5 h-5 text-[#00D3F2]" />
                </div>
                <div>
                  <h3 className="text-xl font-normal text-[#101828]">
                    Raw Dataset Preview
                  </h3>
                  <p className="text-sm text-[#4A5565]">
                    Showing {displayRows.length} of {tableTotal} rows
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <input
                  type="text"
                  value={previewQuery}
                  onChange={(e) => setPreviewQuery(e.target.value)}
                  placeholder="Search rows"
                  className="px-3 py-2 text-sm border border-gray-200 rounded-2xl focus:outline-none focus:border-purple-400"
                />
                {/* Column visibility picker */}
                <div className="relative" ref={columnPickerRef}>
                  <button
                    onClick={() => setColumnPickerOpen((o) => !o)}
                    className="flex items-center gap-1.5 px-3 py-2 text-sm border border-gray-200 rounded-2xl hover:border-purple-400 focus:outline-none"
                  >
                    <Columns className="w-4 h-4 text-gray-500" />
                    <span className="text-gray-600">
                      Columns
                      {selectedColumns.length > 0 && (
                        <span className="ml-1 text-purple-600 font-medium">
                          ({selectedColumns.length}/{allColumns.length})
                        </span>
                      )}
                    </span>
                    <ChevronDown className="w-3 h-3 text-gray-400" />
                  </button>
                  {columnPickerOpen && (
                    <div className="absolute right-0 top-full mt-1 w-64 bg-white border border-gray-200 rounded-xl shadow-lg z-50 flex flex-col max-h-80">
                      <div className="p-2 border-b border-gray-100">
                        <input
                          type="text"
                          value={columnPickerQuery}
                          onChange={(e) => setColumnPickerQuery(e.target.value)}
                          placeholder="Filter columns…"
                          className="w-full px-2 py-1.5 text-xs border border-gray-200 rounded-lg focus:outline-none focus:border-purple-400"
                          autoFocus
                        />
                      </div>
                      <div className="flex gap-2 px-2 py-1.5 border-b border-gray-100">
                        <button
                          onClick={() => setSelectedColumns([])}
                          className="text-xs text-purple-600 hover:underline"
                        >
                          Show all
                        </button>
                        <span className="text-gray-300">|</span>
                        <button
                          onClick={() => setSelectedColumns([...allColumns])}
                          className="text-xs text-gray-500 hover:underline"
                        >
                          Hide all
                        </button>
                      </div>
                      <div className="overflow-y-auto flex-1">
                        {allColumns
                          .filter((col) =>
                            col.toLowerCase().includes(columnPickerQuery.toLowerCase())
                          )
                          .map((col) => {
                            const hidden = selectedColumns.length > 0 && !selectedColumns.includes(col);
                            return (
                              <label
                                key={col}
                                className="flex items-center gap-2 px-3 py-1.5 hover:bg-gray-50 cursor-pointer"
                              >
                                <input
                                  type="checkbox"
                                  checked={!hidden}
                                  onChange={() => {
                                    if (selectedColumns.length === 0) {
                                      // All currently visible → hide this one
                                      setSelectedColumns(allColumns.filter((c) => c !== col));
                                    } else if (selectedColumns.includes(col)) {
                                      const next = selectedColumns.filter((c) => c !== col);
                                      // If unchecking the last visible column, keep it
                                      setSelectedColumns(next.length === 0 ? [col] : next);
                                    } else {
                                      const next = [...selectedColumns, col];
                                      // If all columns now visible, reset to "show all"
                                      setSelectedColumns(next.length === allColumns.length ? [] : next);
                                    }
                                  }}
                                  className="accent-purple-600"
                                />
                                <span className="text-sm text-gray-700 truncate">{col}</span>
                              </label>
                            );
                          })}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </div>
            <RibbonToolbar
              ribbonTab={ribbonTab}
              setRibbonTab={setRibbonTab}
              hasSelection={hasSelection}
              allNumericSelected={allNumericSelected}
              allDateSelected={allDateSelected}
              allTextSelected={allTextSelected}
              isLoading={isLoading}
              applyImpute={applyImpute}
              openRibbonModal={openRibbonModal}
              applyOutliers={applyOutliers}
              duplicateScope={duplicateScope}
              setDuplicateScope={setDuplicateScope}
              applyDuplicates={applyDuplicates}
              applyTypeFix={applyTypeFix}
              applyDeleteColumns={applyDeleteColumns}
              applyTypeConversion={applyTypeConversion}
              applyTextTransform={applyTextTransform}
              applyReplaceValues={applyReplaceValues}
              applyIgnoreErrors={applyIgnoreErrors}
              applyRenameColumn={applyRenameColumn}
              applyDuplicateColumn={applyDuplicateColumn}
              applyMergeColumns={applyMergeColumns}
            />
          </div>
          <div className="min-w-0">
            {isLoading && displayRowsMemo.length === 0 && (
              <div className="px-6 py-4 text-sm text-[#4A5565]">
                Loading profile…
              </div>
            )}
            {!isLoading && !tableLoading && baseRows.length === 0 && (
              <div className="px-6 py-4 text-sm text-[#4A5565]">
                {profile?.metadata?.total_rows
                  ? "No rows match the current filters."
                  : "No data available. Upload and profile a dataset first."}
              </div>
            )}
            <InteractiveDataTable
              key={sessionId}
              initialColumns={interactiveColumns}
              initialRows={interactiveRows}
              sessionId={sessionId}
              fileId={fileId}
              allColumnIds={allColumns}
              visibleColumnIds={selectedColumns}
              getProfileCellIssues={getCellIssues}
              profileColumnStatsMap={profileColumnStatsMap}
              ignoredErrors={ignoredErrors}
              selectedColumnIds={selectedColumnIds}
              onSelectedColumnIdsChange={setSelectedColumnIds}
              onColumnContextAction={handleContextAction}
              externalSteps={appliedSteps}
              refreshTrigger={ribbonRefreshTrigger}
              fetchTrigger={tableFetchTrigger}
              liveData={liveTableData}
              liveDataVersion={liveTableVersion}
              stepPreviewData={stepPreviewData}
              stepPreviewVersion={stepPreviewVersion}
              highlightCell={highlightCell}
              onAddStep={addStep}
              onStepClick={handleStepClick}
              onDeleteStep={handleDeleteStep}
              onRenameStep={handleRenameStep}
              onResetAllSteps={handleResetAllSteps}
              duplicateRowIndices={duplicateRowSet}
            />
          </div>
        </div>

      </main>

      {toast && (
        <div
          className={`fixed bottom-6 left-6 px-4 py-3 rounded-lg shadow-lg text-sm z-50 ${
            toast.type === "error"
              ? "bg-red-600 text-white"
              : "bg-[#2B7FFF] text-white"
          }`}
        >
          {toast.msg}
        </div>
      )}

      {modalState && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
          <div className="bg-white rounded-2xl p-6 w-[420px]">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold text-[#111827]">
                {modalState.title}
              </h3>
              <button
                onClick={closeRibbonModal}
                className="text-[#9CA3AF] hover:text-[#6B7280]"
              >
                <XCircle className="w-5 h-5" />
              </button>
            </div>
            <div className="space-y-4">
              {modalState.message && (
                <p className="text-sm text-[#374151]">{modalState.message}</p>
              )}
              {modalState.conversionReport && (
                <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-[#7C2D12] space-y-2">
                  <div>
                    Invalid rows:{" "}
                    {modalState.conversionReport.invalid_count || 0}
                  </div>
                  <div>
                    Row indices:{" "}
                    {(modalState.conversionReport.invalid_rows || [])
                      .slice(0, 10)
                      .join(", ") || "None"}
                  </div>
                  <div className="space-y-1">
                    {(modalState.conversionReport.preview || []).map((item) => (
                      <div key={`${item.row_idx}`} className="truncate">
                        Row {item.row_idx}: {item.old_value ?? "Empty"} →{" "}
                        {item.new_value ?? "Empty"}
                      </div>
                    ))}
                  </div>
                </div>
              )}
              {modalState.fields?.map((field) => (
                <div key={field.key}>
                  <label className="block text-sm text-[#4B5563] mb-1">
                    {field.label}
                  </label>
                  {field.type === "select" ? (
                    <select
                      className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm"
                      value={
                        modalState.values?.[field.key] ??
                        field.options?.[0] ??
                        ""
                      }
                      onChange={(e) =>
                        updateRibbonModalValue(field.key, e.target.value)
                      }
                    >
                      {field.options?.map((option) => (
                        <option key={option} value={option}>
                          {option}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <input
                      type="text"
                      className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm"
                      value={modalState.values?.[field.key] ?? ""}
                      onChange={(e) =>
                        updateRibbonModalValue(field.key, e.target.value)
                      }
                    />
                  )}
                </div>
              ))}
            </div>
            <div className="flex justify-end gap-2 mt-6">
              {modalState.actions ? (
                modalState.actions.map((action) => (
                  <button
                    key={action.label}
                    onClick={async () => {
                      await action.onClick?.(modalState.values || {});
                      closeRibbonModal();
                    }}
                    className={`px-4 py-2 text-sm rounded-lg ${
                      action.variant === "secondary"
                        ? "border border-gray-200"
                        : "bg-[#2B7FFF] text-white"
                    }`}
                  >
                    {action.label}
                  </button>
                ))
              ) : (
                <>
                  <button
                    onClick={closeRibbonModal}
                    className="px-4 py-2 text-sm rounded-lg border border-gray-200"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={async () => {
                      await modalState.onConfirm?.(modalState.values || {});
                      closeRibbonModal();
                    }}
                    className="px-4 py-2 text-sm rounded-lg bg-[#2B7FFF] text-white"
                  >
                    {modalState.confirmLabel || "Apply"}
                  </button>
                </>
              )}
            </div>
          </div>
        </div>
      )}

      {error && (
        <div className="fixed bottom-4 right-4 bg-red-500 text-white px-6 py-3 rounded-lg shadow-lg z-50">
          {error}
        </div>
      )}
      {isLoading && (
        <div className="fixed inset-0 bg-black/20 flex items-center justify-center z-50">
          <div className="bg-white p-6 rounded-lg shadow-xl">
            <div className="animate-spin w-8 h-8 border-4 border-[#2B7FFF] border-t-transparent rounded-full"></div>
          </div>
        </div>
      )}

      {/* Value Details Modal */}
      <ValueDetailsModal
        isOpen={modalOpen}
        onClose={closeModal}
        type={modalType}
        columnName={modalColumn}
        sessionId={sessionId}
        ApiService={ApiService}
        onValueUpdated={handleValueUpdated}
        onSaveCell={handleSaveCell}
      />

      {/* Issues Found Modal */}
      {issuesModalOpen && profile && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm"
          onClick={() => setIssuesModalOpen(false)}
        >
          <div
            className="bg-white rounded-3xl shadow-2xl w-full max-w-2xl max-h-[80vh] flex flex-col overflow-hidden mx-4"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div className="flex items-center justify-between px-6 py-5 border-b border-gray-100">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 bg-[#FB2C36]/10 rounded-[14px] flex items-center justify-center">
                  <AlertCircle className="w-5 h-5 text-[#FF6467]" />
                </div>
                <div>
                  <h2 className="text-lg font-semibold text-[#101828]">
                    Issues Found
                  </h2>
                  <p className="text-sm text-[#6A7282]">
                    {stats?.issues?.total_issues?.toLocaleString()} total ·{" "}
                    {stats?.issues?.missing} missing · {stats?.issues?.outliers}{" "}
                    outliers · {stats?.issues?.type_inconsistencies} type errors ·{" "}
                    {stats?.issues?.duplicates ?? 0} duplicates
                  </p>
                </div>
              </div>
              <button
                onClick={() => setIssuesModalOpen(false)}
                className="w-8 h-8 flex items-center justify-center rounded-full text-gray-400 hover:bg-gray-100 hover:text-gray-600 transition-colors"
              >
                ✕
              </button>
            </div>

            {/* Body */}
            <div className="overflow-y-auto flex-1 px-6 py-4 space-y-3">
              {(profile.columns || [])
                .filter(
                  (col) =>
                    (col.missing_count || 0) > 0 ||
                    (col.outlier_count || 0) > 0 ||
                    (col.type_inconsistency_count || 0) > 0,
                )
                .map((col) => (
                  <div
                    key={col.name}
                    className="flex items-center justify-between p-4 rounded-2xl border border-gray-100 hover:border-gray-200 bg-[#F9FAFB] transition-colors"
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <div className="w-8 h-8 bg-white border border-gray-200 rounded-xl flex items-center justify-center shrink-0">
                        <span className="text-xs text-gray-500 font-medium">
                          {(col.data_type || col.type || "?")[0]}
                        </span>
                      </div>
                      <span className="text-sm font-medium text-[#101828] truncate">
                        {col.name}
                      </span>
                    </div>
                    <div className="flex items-center gap-2 shrink-0 ml-4">
                      {(col.missing_count || 0) > 0 && (
                        <button
                          onClick={() => {
                            setIssuesModalOpen(false);
                            openModal("missing", col.name);
                          }}
                          className="flex items-center gap-1 px-2.5 py-1 bg-[#FB2C36]/10 text-[#FF6467] rounded-lg text-xs font-medium hover:bg-[#FB2C36]/20 transition-colors"
                        >
                          <XCircle className="w-3 h-3" />
                          {col.missing_count} missing
                        </button>
                      )}
                      {(col.outlier_count || 0) > 0 && (
                        <button
                          onClick={() => {
                            setIssuesModalOpen(false);
                            openModal("outliers", col.name);
                          }}
                          className="flex items-center gap-1 px-2.5 py-1 bg-[#F0B000]/10 text-[#F0B000] rounded-lg text-xs font-medium hover:bg-[#F0B000]/20 transition-colors"
                        >
                          <AlertTriangle className="w-3 h-3" />
                          {col.outlier_count} outliers
                        </button>
                      )}
                      {(col.type_inconsistency_count || 0) > 0 && (
                        <button
                          onClick={() => {
                            setIssuesModalOpen(false);
                            openModal("type_errors", col.name);
                          }}
                          className="flex items-center gap-1 px-2.5 py-1 bg-[#AD46FF]/10 text-[#C27AFF] rounded-lg text-xs font-medium hover:bg-[#AD46FF]/20 transition-colors"
                        >
                          <AlertCircle className="w-3 h-3" />
                          {col.type_inconsistency_count} type errors
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              {(profile.columns || []).filter(
                (col) =>
                  (col.missing_count || 0) > 0 ||
                  (col.outlier_count || 0) > 0 ||
                  (col.type_inconsistency_count || 0) > 0,
              ).length === 0 && (
                <div className="text-center py-12 text-[#6A7282]">
                  <AlertCircle className="w-12 h-12 mx-auto mb-3 text-gray-300" />
                  <p className="text-sm">No issues found in this dataset.</p>
                </div>
              )}
            </div>

            {/* Footer */}
            <div className="px-6 py-4 border-t border-gray-100 flex justify-end">
              <button
                onClick={() => setIssuesModalOpen(false)}
                className="px-5 py-2 text-sm bg-gray-100 text-gray-600 rounded-xl hover:bg-gray-200 transition-colors"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
      {/* Suggest Preprocessing Modal */}
      {suggestModalOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm"
          onClick={() => setSuggestModalOpen(false)}
        >
          <div
            className="bg-white rounded-3xl shadow-2xl w-full max-w-2xl max-h-[85vh] flex flex-col overflow-hidden mx-4"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div className="flex items-center justify-between px-6 py-5 border-b border-gray-100">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 bg-gradient-to-br from-[#AD46FF]/20 to-[#2B7FFF]/20 rounded-[14px] flex items-center justify-center">
                  <Sparkles className="w-5 h-5 text-[#AD46FF]" />
                </div>
                <div>
                  <h2 className="text-lg font-semibold text-[#101828]">
                    AI Preprocessing Suggestions
                  </h2>
                  <p className="text-sm text-[#6A7282]">
                    {suggestColumns.reduce(
                      (n, c) => n + c.operations.length,
                      0,
                    )}{" "}
                    suggestions across {suggestColumns.length} column(s)
                  </p>
                </div>
              </div>
              <button
                onClick={() => setSuggestModalOpen(false)}
                className="w-8 h-8 flex items-center justify-center rounded-full text-gray-400 hover:bg-gray-100 hover:text-gray-600 transition-colors"
              >
                ✕
              </button>
            </div>

            {/* Body */}
            <div className="overflow-y-auto flex-1 px-6 py-4 space-y-4">
              {suggestColumns.length === 0 && (
                <div className="text-center py-12 text-[#6A7282]">
                  <Sparkles className="w-12 h-12 mx-auto mb-3 text-gray-300" />
                  <p className="text-sm">
                    No suggestions — dataset looks clean!
                  </p>
                </div>
              )}
              {suggestColumns.map((col) => (
                <div
                  key={col.column_name}
                  className="rounded-2xl border border-gray-100 overflow-hidden"
                >
                  {/* Column header */}
                  <div className="px-4 py-3 bg-[#F9FAFB] border-b border-gray-100 flex items-center gap-2">
                    <span className="text-xs font-semibold text-gray-400 uppercase tracking-wider">
                      Column
                    </span>
                    <span className="text-sm font-semibold text-[#101828]">
                      {col.column_name}
                    </span>
                  </div>
                  {/* Operations */}
                  <div className="divide-y divide-gray-50">
                    {col.operations.map((op, i) => {
                      const key = `${col.column_name}-${i}`;
                      const applied = appliedSuggestions.has(key);
                      const riskColor =
                        op.risk_level === "low"
                          ? "bg-green-50 text-green-600"
                          : op.risk_level === "high"
                            ? "bg-red-50 text-[#FF6467]"
                            : "bg-amber-50 text-amber-600";
                      const confPct = Math.round((op.confidence || 0) * 100);
                      return (
                        <div
                          key={key}
                          className="px-4 py-3 hover:bg-gray-50 transition-colors"
                        >
                          {/* Top row: type + meta + actions */}
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-3 min-w-0">
                              <code className="text-xs bg-gray-100 text-[#6A7282] px-2 py-0.5 rounded-lg font-mono shrink-0">
                                {op.type}
                              </code>
                              {op.method && (
                                <span className="text-xs text-[#6A7282] shrink-0">
                                  method: <b>{op.method}</b>
                                </span>
                              )}
                              {op.target_type && (
                                <span className="text-xs text-[#6A7282] shrink-0">
                                  → <b>{op.target_type}</b>
                                </span>
                              )}
                            </div>
                            <div className="flex items-center gap-2 shrink-0 ml-3">
                              <span className="text-xs text-gray-400">
                                {confPct}%
                              </span>
                              <span
                                className={`text-xs px-2 py-0.5 rounded-full font-medium ${riskColor}`}
                              >
                                {op.risk_level || "low"}
                              </span>
                              {applied ? (
                                <span className="text-xs px-3 py-1.5 bg-green-50 text-green-600 rounded-xl font-medium">
                                  ✓ Applied
                                </span>
                              ) : (
                                <button
                                  onClick={() => handleApplySuggestion(op, key)}
                                  className="text-xs px-3 py-1.5 bg-[#2B7FFF]/10 text-[#2B7FFF] rounded-xl font-medium hover:bg-[#2B7FFF]/20 transition-colors"
                                >
                                  Apply
                                </button>
                              )}
                            </div>
                          </div>
                          {/* Reason row */}
                          {op.reason && (
                            <p className="mt-1.5 text-xs text-[#6A7282] leading-relaxed pl-1">
                              {op.reason}
                            </p>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>

            {/* Footer */}
            <div className="px-6 py-4 border-t border-gray-100 flex items-center justify-between">
              <p className="text-xs text-[#6A7282]">
                {appliedSuggestions.size} of{" "}
                {suggestColumns.reduce((n, c) => n + c.operations.length, 0)}{" "}
                applied
              </p>
              <div className="flex gap-2">
                <button
                  onClick={() => setSuggestModalOpen(false)}
                  className="px-4 py-2 text-sm bg-gray-100 text-gray-600 rounded-xl hover:bg-gray-200 transition-colors"
                >
                  Close
                </button>
                {suggestColumns.reduce((n, c) => n + c.operations.length, 0) >
                  appliedSuggestions.size && (
                  <button
                    onClick={handleApplyAllSuggestions}
                    className="px-4 py-2 text-sm bg-gradient-to-r from-[#AD46FF] to-[#2B7FFF] text-white rounded-xl font-medium hover:opacity-90 transition-opacity"
                  >
                    Apply All
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      <div
        className={`fixed top-0 right-0 h-full w-[360px] bg-white border-l border-gray-200 shadow-xl transform transition-transform duration-300 ${
          selectedCell ? "translate-x-0" : "translate-x-full"
        }`}
      >
        <div className="p-6 h-full flex flex-col">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h3 className="text-lg font-semibold text-[#101828]">
                {selectedCell?.colName || "Column"}
              </h3>
              <p className="text-sm text-[#6A7282]">
                Row {selectedCell ? selectedCell.rowIdx + 1 : "—"}
              </p>
            </div>
            <button
              onClick={closeCellDrawer}
              className="text-[#9CA3AF] hover:text-[#6B7280]"
            >
              <XCircle className="w-5 h-5" />
            </button>
          </div>

          <div className="mt-6 space-y-4 flex-1 overflow-auto">
            <div className="rounded-xl border border-[#E5E7EB] p-4 bg-[#F9FAFB]">
              <div className="flex items-center justify-between text-xs text-[#6A7282] mb-2">
                <span>Issue</span>
                <span>Status</span>
              </div>
              <div className="flex items-center justify-between">
                <p className="text-sm font-medium text-[#111827]">
                  {issueLabel(selectedCell?.issues)}
                </p>
                <span className="text-xs font-medium text-[#2B7FFF]">
                  {suggestionStatus}
                </span>
              </div>
              {cellSuggestion?.reason && (
                <p className="text-xs text-[#6A7282] mt-2">
                  {cellSuggestion.reason}
                </p>
              )}
            </div>

            <div className="rounded-xl border border-[#E5E7EB] p-4">
              <p className="text-xs text-[#6A7282] mb-1">Original Value</p>
              <p className="text-sm font-medium text-[#111827] break-words">
                {selectedCell?.value ?? "—"}
              </p>
            </div>

            <div className="rounded-xl border border-[#E5E7EB] p-4">
              <p className="text-xs text-[#6A7282] mb-1">Suggested Value</p>
              {cellSuggestionLoading ? (
                <p className="text-sm text-[#6A7282]">Loading suggestion…</p>
              ) : (
                <p className="text-sm font-medium text-[#111827] break-words">
                  {cellSuggestion?.suggested_value ?? "—"}
                </p>
              )}
              {cellSuggestionError && (
                <p className="text-xs text-[#EF4444] mt-2">
                  {cellSuggestionError}
                </p>
              )}
            </div>

            <div className="rounded-xl border border-[#E5E7EB] p-4">
              <p className="text-xs text-[#6A7282] mb-1">
                Why this suggestion?
              </p>
              <p className="text-sm text-[#111827]">
                {cellSuggestion?.xai_reason || "—"}
              </p>
            </div>

            <div className="rounded-xl border border-[#E5E7EB] p-4">
              <p className="text-xs text-[#6A7282] mb-3">Visual Evidence</p>
              <div className="h-[150px] flex items-end gap-1">
                {histogramBins.length > 0 ? (
                  histogramBins.map((bin, idx) => {
                    const height = maxHistogramCount
                      ? Math.max(
                          6,
                          Math.round((bin.count / maxHistogramCount) * 140),
                        )
                      : 6;
                    const isSelected = idx === highlightedBin;
                    return (
                      <div
                        key={`${bin.min}-${bin.max}-${idx}`}
                        className={`flex-1 rounded-t-sm ${
                          isSelected ? "bg-[#2B7FFF]" : "bg-[#E5E7EB]"
                        }`}
                        style={{ height }}
                      />
                    );
                  })
                ) : (
                  <div className="text-sm text-[#9CA3AF]">
                    No histogram available
                  </div>
                )}
              </div>
            </div>

            <div className="rounded-xl border border-[#E5E7EB] p-4">
              <div className="flex items-center justify-between mb-2">
                <p className="text-xs text-[#6A7282]">Confidence Meter</p>
                <span className="text-xs font-medium text-[#111827]">
                  {cellSuggestion?.confidence ?? 0}%
                </span>
              </div>
              <div className="h-2 bg-[#F3F4F6] rounded-full overflow-hidden">
                <div
                  className="h-full bg-gradient-to-r from-[#51A2FF] to-[#C27AFF]"
                  style={{
                    width: `${Math.min(
                      100,
                      Math.max(0, cellSuggestion?.confidence ?? 0),
                    )}%`,
                  }}
                />
              </div>
            </div>
          </div>

          <div className="mt-4">
            <button
              onClick={() => navigate("/log")}
              className="text-sm text-[#2B7FFF] hover:text-[#1A66FF]"
            >
              Tell me more
            </button>
          </div>

          <div className="mt-4 flex items-center gap-3">
            <button
              onClick={closeCellDrawer}
              className="flex-1 px-4 py-2 text-sm font-medium text-[#6A7282] bg-[#F3F4F6] rounded-xl hover:bg-[#E5E7EB]"
            >
              Keep Original
            </button>
            <button
              onClick={applyCellSuggestion}
              disabled={
                cellApplying ||
                cellSuggestionLoading ||
                cellSuggestion?.suggested_value === undefined ||
                cellSuggestion?.suggested_value === null
              }
              className="flex-1 px-4 py-2 text-sm font-medium text-white bg-gradient-to-r from-[#51A2FF] to-[#C27AFF] rounded-xl disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {cellApplying ? "Applying…" : "Apply Suggestion"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default DataProfilingPage;
