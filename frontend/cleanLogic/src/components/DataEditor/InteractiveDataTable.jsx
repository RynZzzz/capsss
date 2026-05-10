import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import AppliedStepsPanel from "./AppliedStepsPanel";
import ColumnOverviewPanel from "./ColumnOverviewPanel";
import { API_BASE_URL } from "../../constants/config";
import ApiService from "../../services/api";

const createSampleColumns = () => [
  { id: "name", name: "Name", type: "text" },
  { id: "age", name: "Age", type: "number" },
  { id: "enrolled", name: "Enrolled Date", type: "date" },
  { id: "grade", name: "Grade", type: "number" },
  { id: "status", name: "Status", type: "text" },
];

const createSampleRows = () => [
  {
    id: 1,
    name: "Ava Williams",
    age: 20,
    enrolled: "2024-01-12",
    grade: 91.5,
    status: "Active",
  },
  {
    id: 2,
    name: "Liam Johnson",
    age: 22,
    enrolled: "2023-09-05",
    grade: 84.2,
    status: "Active",
  },
  {
    id: 3,
    name: "Mia Chen",
    age: 19,
    enrolled: "2024-02-18",
    grade: 95.1,
    status: "Honors",
  },
  {
    id: 4,
    name: "Noah Patel",
    age: 21,
    enrolled: "2023-08-21",
    grade: 76.8,
    status: "Probation",
  },
  {
    id: 5,
    name: "Olivia Garcia",
    age: 20,
    enrolled: "2024-01-26",
    grade: 88.4,
    status: "Active",
  },
  {
    id: 6,
    name: "Ethan Smith",
    age: 23,
    enrolled: "2022-11-02",
    grade: 72.6,
    status: "Inactive",
  },
  {
    id: 7,
    name: "Sophia Brown",
    age: 19,
    enrolled: "2024-03-10",
    grade: 90.3,
    status: "Honors",
  },
  {
    id: 8,
    name: "Lucas Kim",
    age: 22,
    enrolled: "2023-10-14",
    grade: 79.9,
    status: "Active",
  },
  {
    id: 9,
    name: "Isabella Davis",
    age: 21,
    enrolled: "2023-07-30",
    grade: 86.7,
    status: "Active",
  },
  {
    id: 10,
    name: "James Miller",
    age: 20,
    enrolled: "2024-02-01",
    grade: 92.4,
    status: "Honors",
  },
];

const formatCellValue = (value, type) => {
  if (value === null || value === undefined || value === "") return "";
  if (type === "number") return Number(value);
  return value;
};

const toInputValue = (value, type) => {
  if (value === null || value === undefined) return "";
  if (type === "date") return String(value);
  return String(value);
};

const cloneColumns = (cols) => cols.map((col) => ({ ...col }));
const cloneRows = (data) => data.map((row) => ({ ...row }));

/**
 * @param {{ initialColumns?: Array<{id: string, name: string, type: string}>, initialRows?: Array<Record<string, any>>, sessionId?: string|null, pageSize?: number, allColumnIds?: string[], getProfileCellIssues?: (rowIndex: number, columnId: string) => Array<{type?: string} | string>, selectedColumnIds?: string[], onSelectedColumnIdsChange?: (next: string[]) => void, onColumnContextAction?: (action: string, columnId: string) => void }} props
 */
const InteractiveDataTable = ({
  initialColumns = createSampleColumns(),
  initialRows = createSampleRows(),
  sessionId = null,
  fileId = null,
  pageSize = 50,
  allColumnIds,
  getProfileCellIssues,
  selectedColumnIds,
  onSelectedColumnIdsChange,
  onColumnContextAction,
  visibleColumnIds = null,
  externalSteps = null,
  refreshTrigger = 0,
  fetchTrigger = 0,
  liveData = null,
  liveDataVersion = 0,
  stepPreviewData = null,
  stepPreviewVersion = 0,
  onStepClick = null,
  onDeleteStep = null,
  onAddStep = null,
  onRenameStep = null,
  onResetAllSteps = null,
  highlightCell = null,
  profileColumnStatsMap = null,
  duplicateRowIndices = null,
  ignoredErrors = null,
}) => {
  const [columns, setColumns] = useState(initialColumns);
  const [rows, setRows] = useState(initialRows);
  const [activeColumnId, setActiveColumnId] = useState(null);
  const [overviewColumnId, setOverviewColumnId] = useState(null);
  const [showColumnOverview, setShowColumnOverview] = useState(false);
  const [renamingColumnId, setRenamingColumnId] = useState(null);
  const [columnDraftName, setColumnDraftName] = useState("");
  const [selectedRowIds, setSelectedRowIds] = useState(new Set());
  const [editingCell, setEditingCell] = useState(null);
  const [editingValue, setEditingValue] = useState("");
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [totalCount, setTotalCount] = useState(0);
  const [loading, setLoading] = useState(false);
  const [loadedSteps, setLoadedSteps] = useState(false);
  const [showAddRowModal, setShowAddRowModal] = useState(false);
  const [showAddColumnModal, setShowAddColumnModal] = useState(false);
  const [pageInputValue, setPageInputValue] = useState("1");
  const [newRowData, setNewRowData] = useState([{}]);
  const [newColumn, setNewColumn] = useState({ name: "", type: "text" });
  const [activeFilters, setActiveFilters] = useState(new Set());
  const [errorsOnly, setErrorsOnly] = useState(false);
  const [sortConfig, setSortConfig] = useState({ columnId: null, direction: null });
  const [changedCells, setChangedCells] = useState(new Set());
  // Tracks cells that were edited to an empty/null value — shown red instead of green
  const [emptiedCells, setEmptiedCells] = useState(new Set());
  // Map active issue-type filters to a single backend filter_type param.
  // "merged" has no backend equivalent so it stays client-side only.
  const backendFilterType = useMemo(() => {
    const issueKeys = ["missing", "type-error", "outlier"];
    const active = issueKeys.filter((k) => activeFilters.has(k));
    if (active.length === 0) return null;
    if (active.length === 1) {
      if (active[0] === "type-error") return "type_inconsistency";
      return active[0]; // "missing" or "outlier"
    }
    return "all";
  }, [activeFilters]);
  // Derive changed/emptied key sets from committed steps — avoids stale-state timing issues.
  const { externalChangedKeys, externalEmptiedKeys } = useMemo(() => {
    if (!Array.isArray(externalSteps)) return { externalChangedKeys: new Set(), externalEmptiedKeys: new Set() };
    const changed = new Set();
    const emptied = new Set();
    externalSteps.forEach((step) => {
      if (step.type === "cell_edit" && step.row_index != null && step.column) {
        const val = step.edited_value ?? step.payload?.edited_value;
        const isEmpty = val === null || val === undefined || val === "";
        const k1 = `${step.row_index}-${step.column}`;
        changed.add(k1);
        if (isEmpty) emptied.add(k1);
      }
    });
    return { externalChangedKeys: changed, externalEmptiedKeys: emptied };
  }, [externalSteps]);
  const [mergeInfo, setMergeInfo] = useState({ hasMerges: false, ranges: [] });
  const [mergeFilling, setMergeFilling] = useState(false);
  const [useSavedData, setUseSavedData] = useState(false);
  const [internalSelectedColumnIds, setInternalSelectedColumnIds] = useState(
    [],
  );
  const [lastSelectedIndex, setLastSelectedIndex] = useState(null);
  const [columnMenu, setColumnMenu] = useState(null);
  const [steps, setSteps] = useState(() => {
    if (sessionId) return [];
    return [
      {
        id: Date.now(),
        type: "Source",
        timestamp: Date.now(),
        description: "Loaded initial data",
        columns: cloneColumns(initialColumns),
        rows: cloneRows(initialRows),
        page: 1,
        totalPages: 1,
      },
    ];
  });
  const [currentStepIndex, setCurrentStepIndex] = useState(sessionId ? -1 : 0);
  // sessionSteps drives the Applied Steps panel — always fetched from session DB,
  // never sourced from the in-memory snapshot array.
  const [sessionSteps, setSessionSteps] = useState([]);
  const prevRefreshTriggerRef = useRef(0);
  // Frozen snapshot of all columns at mount — used to restore dropped columns
  // when time-travelling to a step before a drop_column was applied.
  const allColumnsAtMountRef = useRef(null);
  // forceFetchTick is incremented by the fetchTrigger effect so that fetchData
  // always re-fires after an API call completes, even when page/useSavedData
  // haven't changed (which would otherwise cause React to skip the re-render).
  const [forceFetchTick, setForceFetchTick] = useState(0);
  const prevFetchTriggerRef = useRef(0);
  const prevLiveDataVersionRef = useRef(0);
  const highlightCellRef = useRef(null);

  const normalizeColumnType = useCallback((rawType) => {
    const type = String(rawType || "").toLowerCase();
    if (
      type.includes("int") ||
      type.includes("dec") ||
      type.includes("num") ||
      type.includes("float") ||
      type.includes("double")
    ) {
      return "number";
    }
    if (type.includes("date") || type.includes("time")) {
      return "date";
    }
    return "text";
  }, []);

  const getCellRawValue = useCallback((row, colId) => {
    const cell = row?.[colId];
    if (cell && typeof cell === "object") {
      return cell.value ?? cell.display_value ?? "";
    }
    return cell ?? "";
  }, []);

  // Capture the full column set on first meaningful render so we can restore
  // dropped columns when time-travelling back to a step before the drop.
  useEffect(() => {
    if (
      allColumnsAtMountRef.current === null &&
      Array.isArray(initialColumns) &&
      initialColumns.length > 0
    ) {
      allColumnsAtMountRef.current = cloneColumns(initialColumns);
    }
  }, [initialColumns]);

  // Keep page input in sync whenever page changes from any source
  useEffect(() => {
    setPageInputValue(String(page));
  }, [page]);

  const getCellDisplayValue = useCallback((row, colId) => {
    const cell = row?.[colId];
    if (cell && typeof cell === "object") {
      return cell.display_value ?? cell.value ?? "";
    }
    return cell ?? "";
  }, []);

  const rowIds = useMemo(() => rows.map((row) => row.id), [rows]);
  const allRowsSelected = useMemo(
    () => rowIds.length > 0 && rowIds.every((id) => selectedRowIds.has(id)),
    [rowIds, selectedRowIds],
  );

  const applySnapshot = useCallback((snapshot) => {
    if (snapshot.columns) setColumns(cloneColumns(snapshot.columns));
    if (snapshot.rows) setRows(cloneRows(snapshot.rows));
    if (snapshot.page) setPage(snapshot.page);
    if (snapshot.totalPages) setTotalPages(snapshot.totalPages);
    setSelectedRowIds(new Set());
  }, []);

  const addStep = useCallback(
    (
      type,
      description,
      nextColumns,
      nextRows,
      nextPage,
      nextTotalPages,
      params = {},
    ) => {
      const step = {
        // Lightweight fields — persisted to DB (Power BI recipe format)
        id: Date.now(),
        name: type, // user-editable display label
        type, // machine-readable operation type for replay
        timestamp: Date.now(),
        description,
        params, // operation parameters needed to replay this step
        // Heavy snapshot fields — in memory only for undo/redo, never saved to DB
        columns: cloneColumns(nextColumns),
        rows: cloneRows(nextRows),
        page: nextPage,
        totalPages: nextTotalPages,
      };
      setSteps((prev) => [...prev.slice(0, currentStepIndex + 1), step]);
      setCurrentStepIndex((prev) => prev + 1);
    },
    [currentStepIndex],
  );

  const startEditCell = useCallback(
    (rowId, colId) => {
      const column = columns.find((c) => c.id === colId);
      if (!column) return;
      const row = rows.find((r) => r.id === rowId);
      const value = getCellRawValue(row, colId);
      setEditingCell({ rowId, colId });
      setEditingValue(toInputValue(value, column.type));
    },
    [columns, rows, getCellRawValue],
  );

  const commitEditCell = useCallback(async () => {
    if (!editingCell) return;
    const column = columns.find((c) => c.id === editingCell.colId);
    if (!column) return;
    const row = rows.find((r) => r.id === editingCell.rowId);
    const oldValue = getCellRawValue(row, editingCell.colId);
    const updatedValue = formatCellValue(editingValue, column.type);
    if (oldValue === updatedValue) {
      setEditingCell(null);
      return;
    }
    const nextRows = rows.map((row) =>
      row.id === editingCell.rowId
        ? {
            ...row,
            [editingCell.colId]:
              row?.[editingCell.colId] &&
              typeof row[editingCell.colId] === "object"
                ? {
                    ...row[editingCell.colId],
                    value: updatedValue,
                    display_value:
                      updatedValue === null || updatedValue === undefined
                        ? ""
                        : String(updatedValue),
                  }
                : updatedValue,
          }
        : row,
    );
    setRows(nextRows);
    setChangedCells((prev) => {
      const next = new Set(prev);
      next.add(`${editingCell.rowId}-${editingCell.colId}`);
      return next;
    });
    const cellIsEmpty = updatedValue === null || updatedValue === undefined || updatedValue === "";
    setEmptiedCells((prev) => {
      const next = new Set(prev);
      if (cellIsEmpty) {
        next.add(`${editingCell.rowId}-${editingCell.colId}`);
      } else {
        next.delete(`${editingCell.rowId}-${editingCell.colId}`);
      }
      return next;
    });
    const colName = columns.find((c) => c.id === editingCell.colId)?.name;
    const rowIndex = rows.findIndex((r) => r.id === editingCell.rowId);
    const rowIdx = row?._index ?? row?.id;
    if (onAddStep) {
      // Delta-based path — delegate to DataProfiling which posts to backend
      setEditingCell(null);
      await onAddStep({
        id: `step_${Date.now()}`,
        type: "cell_edit",
        _tableUpdated: true,
        description: `Changed row ${rowIndex + 1}, "${colName}": "${oldValue ?? "Empty"}" → "${updatedValue ?? "Empty"}"`,
        timestamp: Date.now(),
        column: colName,
        row_index: Number(rowIdx),
        previous_value: oldValue ?? null,
        edited_value: updatedValue ?? null,
        payload: {
          column: colName,
          row_index: Number(rowIdx),
          previous_value: oldValue ?? null,
          edited_value: updatedValue ?? null,
        },
      });
      return;
    }
    // Legacy in-memory path (no session)
    addStep(
      "Changed Value",
      `Changed row ${rowIndex + 1}, "${colName}": "${oldValue ?? "Empty"}" → "${updatedValue ?? "Empty"}"`,
      columns,
      nextRows,
      page,
      totalPages,
      {
        column: colName,
        row_index: rowIndex,
        previous_value: oldValue ?? null,
        edited_value: updatedValue ?? null,
      },
    );
    setEditingCell(null);
    if (!sessionId) return;
    try {
      await fetch(`${API_BASE_URL}/api/cell/${sessionId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          row_idx: Number(rowIdx),
          col_name: editingCell.colId,
          new_value: updatedValue,
        }),
      });
    } catch {
      return;
    }
  }, [
    rows,
    editingCell,
    editingValue,
    columns,
    addStep,
    onAddStep,
    page,
    totalPages,
    sessionId,
    getCellRawValue,
  ]);

  const cancelEditCell = useCallback(() => {
    setEditingCell(null);
  }, []);

  const handleCellKeyDown = useCallback(
    (event, rowId, colId) => {
      if (event.key === "Enter") {
        event.preventDefault();
        commitEditCell();
      }
      if (event.key === "Escape") {
        event.preventDefault();
        cancelEditCell();
      }
      if (event.key === "Tab") {
        event.preventDefault();
        const colIndex = columns.findIndex((c) => c.id === colId);
        const rowIndex = rows.findIndex((r) => r.id === rowId);
        const direction = event.shiftKey ? -1 : 1;
        let nextCol = colIndex + direction;
        let nextRow = rowIndex;
        if (nextCol >= columns.length) {
          nextCol = 0;
          nextRow = rowIndex + 1;
        }
        if (nextCol < 0) {
          nextCol = columns.length - 1;
          nextRow = rowIndex - 1;
        }
        cancelEditCell();
        if (rows[nextRow] && columns[nextCol]) {
          startEditCell(rows[nextRow].id, columns[nextCol].id);
        }
      }
    },
    [columns, rows, commitEditCell, cancelEditCell, startEditCell],
  );

  const toggleRowSelection = useCallback((rowId) => {
    setSelectedRowIds((prev) => {
      const next = new Set(prev);
      if (next.has(rowId)) {
        next.delete(rowId);
      } else {
        next.add(rowId);
      }
      return next;
    });
  }, []);

  const toggleAllRows = useCallback(() => {
    if (allRowsSelected) {
      setSelectedRowIds(new Set());
      return;
    }
    setSelectedRowIds(new Set(rowIds));
  }, [allRowsSelected, rowIds]);

  const deleteSelectedRows = useCallback(async () => {
    if (selectedRowIds.size === 0) return;
    const selectedRows = rows.filter((row) => selectedRowIds.has(row.id));
    // Use _index (actual data index) for backend; fall back to id then visual position.
    const rowIndices = selectedRows.map(
      (row, i) => row._index ?? row.id ?? rows.indexOf(row),
    );
    setSelectedRowIds(new Set());

    if (onAddStep) {
      // Delta-based path — backend deletes the rows and replays.
      await onAddStep({
        id: `step_${Date.now()}`,
        type: "delete_rows",
        description: `Deleted ${selectedRows.length} row(s)`,
        timestamp: Date.now(),
        column: null,
        row_index: rowIndices.length === 1 ? rowIndices[0] : null,
        previous_value: null,
        edited_value: null,
        payload: { rowIndices },
      });
    } else {
      // Legacy in-memory path (no session).
      const nextRows = rows.filter((row) => !selectedRowIds.has(row.id));
      setRows(nextRows);
      addStep(
        "Removed Rows",
        `Removed ${selectedRows.length} row(s)`,
        columns,
        nextRows,
        page,
        totalPages,
        { row_indices: rowIndices },
      );
    }
  }, [rows, columns, selectedRowIds, onAddStep, addStep, page, totalPages]);

  const addRow = useCallback(
    (payload) => {
      const id = Date.now();
      const newRow = columns.reduce(
        (acc, col) => ({ ...acc, [col.id]: payload?.[col.id] ?? "" }),
        { id },
      );
      const nextRows = [...rows, newRow];
      setRows(nextRows);
      addStep(
        "Added Rows",
        "Added new row",
        columns,
        nextRows,
        page,
        totalPages,
        { row_data: payload ?? {} },
      );
    },
    [columns, rows, addStep, page, totalPages],
  );

  const addRows = useCallback(
    async (payloads) => {
      if (onAddStep) {
        // DataProfiling mode — send to backend so it persists in the DataFrame
        const rowsForBackend = payloads.map((p) => {
          const row = {};
          columns.forEach((col) => { row[col.name || col.id] = p[col.id] ?? ""; });
          return row;
        });
        await onAddStep({
          id: `step_${Date.now()}`,
          type: "add_rows",
          description: `Added ${payloads.length} new row${payloads.length > 1 ? "s" : ""}`,
          timestamp: Date.now(),
          column: null,
          row_index: null,
          previous_value: null,
          edited_value: null,
          payload: { row_data: rowsForBackend },
        });
        return;
      }
      // Standalone / no-session path — local in-memory only
      const newRows = payloads.map((payload, i) => {
        const id = Date.now() + i;
        return columns.reduce(
          (acc, col) => ({ ...acc, [col.id]: payload?.[col.id] ?? "" }),
          { id },
        );
      });
      const nextRows = [...rows, ...newRows];
      setRows(nextRows);
      addStep(
        "Added Rows",
        `Added ${newRows.length} new row${newRows.length > 1 ? "s" : ""}`,
        columns,
        nextRows,
        page,
        totalPages,
        { row_data: payloads },
      );
    },
    [columns, rows, addStep, page, totalPages, onAddStep],
  );

  const addColumn = useCallback(
    async (payload) => {
      const trimmed = payload.name.trim();
      if (!trimmed) return;
      if (onAddStep) {
        // DataProfiling mode — send to backend so it persists in the DataFrame
        await onAddStep({
          id: `step_${Date.now()}`,
          type: "add_column",
          description: `Added column "${trimmed}"`,
          timestamp: Date.now(),
          column: trimmed,
          row_index: null,
          previous_value: null,
          edited_value: null,
          payload: { column_name: trimmed, column_type: payload.type },
        });
        return;
      }
      // Standalone / no-session path — local in-memory only
      const id = Date.now().toString();
      const column = { id, name: trimmed, type: payload.type };
      const nextColumns = [...columns, column];
      const nextRows = rows.map((row) => ({ ...row, [id]: "" }));
      setColumns(nextColumns);
      setRows(nextRows);
      addStep(
        "Added Column",
        `Added column "${trimmed}"`,
        nextColumns,
        nextRows,
        page,
        totalPages,
        {
          column: trimmed,
          row_index: null,
          previous_value: null,
          edited_value: null,
        },
      );
    },
    [columns, rows, addStep, page, totalPages, onAddStep],
  );

  const beginRenameColumn = useCallback((col) => {
    setRenamingColumnId(col.id);
    setColumnDraftName(col.name);
  }, []);

  const commitRenameColumn = useCallback(() => {
    if (!renamingColumnId) return;
    const trimmed = columnDraftName.trim();
    if (!trimmed) return;
    const target = columns.find((col) => col.id === renamingColumnId);
    if (!target) return;
    const nextColumns = columns.map((col) =>
      col.id === renamingColumnId ? { ...col, name: trimmed } : col,
    );
    setColumns(nextColumns);
    addStep(
      "Renamed Columns",
      `Renamed "${target.name}" to "${trimmed}"`,
      nextColumns,
      rows,
      page,
      totalPages,
      { column: target.name, edited_value: trimmed },
    );
    setRenamingColumnId(null);
  }, [
    renamingColumnId,
    columnDraftName,
    columns,
    rows,
    addStep,
    page,
    totalPages,
  ]);

  const dropColumn = useCallback(
    async (colId) => {
      const targetId = colId ?? activeColumnId;
      if (!targetId) return;
      const target = columns.find((col) => col.id === targetId);
      if (!target) return;
      setActiveColumnId(null);
      if (overviewColumnId === targetId) {
        setOverviewColumnId(null);
        setShowColumnOverview(false);
      }
      if (onAddStep) {
        // DataProfiling mode — send to backend so it persists in the DataFrame
        await onAddStep({
          id: `step_${Date.now()}`,
          type: "drop_column",
          description: `Dropped column "${target.name}"`,
          timestamp: Date.now(),
          column: target.name,
          row_index: null,
          previous_value: null,
          edited_value: null,
          payload: { colName: target.name },
        });
        return;
      }
      // Standalone / no-session path — local in-memory only
      const nextColumns = columns.filter((col) => col.id !== targetId);
      const nextRows = rows.map((row) => {
        const { [targetId]: _, ...rest } = row;
        return rest;
      });
      setColumns(nextColumns);
      setRows(nextRows);
      addStep(
        "Removed Columns",
        `Removed column "${target.name}"`,
        nextColumns,
        nextRows,
        page,
        totalPages,
        { column: target.name },
      );
    },
    [
      activeColumnId,
      columns,
      rows,
      overviewColumnId,
      addStep,
      page,
      totalPages,
      onAddStep,
    ],
  );

  const fetchData = useCallback(
    async (pageNum) => {
      if (!sessionId) return;
      setLoading(true);
      try {
        const filterParam = backendFilterType
          ? `&filter_type=${backendFilterType}`
          : errorsOnly
            ? `&errors_only=true`
            : "";
        const response = await fetch(
          `${API_BASE_URL}/api/table-data?page=${pageNum}&limit=${pageSize}&sessionId=${sessionId}${filterParam}`,
        );
        const json = await response.json();
        const nextRows = (json.data || []).map((row, index) => {
          const id = row.id ?? row._index ?? index;
          return { id, ...row };
        });
        setRows(nextRows);
        setPage(json.page || pageNum);
        setTotalPages(json.totalPages || 1);
        setTotalCount(json.total || 0);
        // Sync column list so dropped columns are removed from the table header
        if (Array.isArray(json.columns) && json.columns.length > 0) {
          setColumns((prev) => {
            const nameSet = new Set(json.columns);
            const filtered = prev.filter((c) => nameSet.has(c.id));
            // preserve existing column objects (type, metadata); add any new ones as text
            const existing = new Set(filtered.map((c) => c.id));
            const added = json.columns
              .filter((n) => !existing.has(n))
              .map((n) => ({ id: n, name: n, type: "text" }));
            return [...filtered, ...added];
          });
        }
        if (steps.length === 0 && !sessionId) {
          addStep(
            "Source",
            "Loaded initial data",
            columns,
            nextRows,
            json.page || pageNum,
            json.totalPages || 1,
          );
        }
      } finally {
        setLoading(false);
      }
    },
    [sessionId, pageSize, errorsOnly, backendFilterType],
  );

  const toSlimStep = (step) => ({
    id: step.id,
    name: step.name || step.type,
    type: step.type,
    timestamp: step.timestamp,
    description: step.description,
    column: step.column ?? null,
    row_index: step.row_index ?? null,
    previous_value: step.previous_value ?? null,
    edited_value: step.edited_value ?? null,
    // preserve payload (required for bulk-op replay: strategy, columns, etc.)
    payload: step.payload || {},
    // params is the table-internal equivalent; keep for backwards compat
    params: step.params || {},
  });

  const saveSession = useCallback(
    async (payload) => {
      if (!sessionId) return;
      try {
        const rawSteps = payload?.steps ?? steps;
        if (!Array.isArray(rawSteps)) return;
        if (rawSteps.length === 0 && !payload?.allowEmpty) return;
        if (
          !payload?.allowEmpty &&
          sessionId &&
          rawSteps.every(
            (s) => String(s?.type || "").toLowerCase() === "source",
          )
        ) {
          return;
        }
        const slimSteps = rawSteps.map(toSlimStep);
        const body = { steps: slimSteps };
        if (payload?.allowEmpty) body.allow_empty = true;
        if (fileId != null) body.file_id = fileId;
        const userId = localStorage.getItem("user_id");
        if (userId) body.user_id = userId;
        const response = await fetch(
          `${API_BASE_URL}/api/sessions/${sessionId}/steps`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
          },
        );
        if (!response.ok) {
          console.error("Save failed", response.status);
        }
      } catch (error) {
        console.error("Save failed", error);
      }
    },
    [sessionId, fileId, steps],
  );

  const syncProfilerSnapshot = useCallback(
    async (snapshot) => {
      if (!sessionId || !snapshot) return;
      await fetch(`${API_BASE_URL}/api/sync-profiler/${sessionId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          data: snapshot.rows || [],
          columns: (snapshot.columns || []).map((col) => col.id || col.name),
        }),
      });
    },
    [sessionId],
  );

  useEffect(() => {
    if (!sessionId) return;
    const controller = new AbortController();
    const load = async () => {
      console.log("Loading session", sessionId);
      try {
        const response = await fetch(
          `${API_BASE_URL}/api/sessions/${sessionId}`,
          { signal: controller.signal },
        );
        if (!response.ok) {
          console.error("Failed to load session", response.status);
          return;
        }
        const json = await response.json();
        console.log("Loaded session", json);
        const savedSteps = json.applied_steps || json.steps || [];
        // Only drive the panel from DB if DataProfiling isn't already controlling it
        if (!externalSteps) setSessionSteps(savedSteps);
        if (savedSteps.length > 0) {
          setSteps(savedSteps);
          setCurrentStepIndex(savedSteps.length - 1);
          const last = savedSteps[savedSteps.length - 1];
          if (last?.columns && last?.rows) {
            // Fat snapshot available (legacy) — use it directly
            applySnapshot(last);
            setUseSavedData(true);
          }
          // For slim steps (no snapshots), do NOT set useSavedData so that
          // fetchData fires below and loads the current backend state.
          // Ribbon ops (impute/outlier/etc.) modify data in-place on the backend,
          // so fetchData always returns the correct current state.
          if (last?.page) setPage(last.page);
          if (last?.totalPages) setTotalPages(last.totalPages);
        } else {
          if (json.columns?.length) setColumns(json.columns);
          if (json.rows?.length) setRows(json.rows);
          if (json.data?.length) setRows(json.data);
          if (json.rows?.length || json.data?.length) {
            setUseSavedData(true);
            setTotalCount((json.rows || json.data || []).length);
            setTotalPages(1);
          }
          setCurrentStepIndex(-1);
        }
      } catch (error) {
        if (error?.name !== "AbortError") {
          console.error("Failed to load session", error);
        }
      } finally {
        setLoadedSteps(true);
      }
    };
    load();
    return () => controller.abort();
  }, [sessionId, applySnapshot]);

  useEffect(() => {
    if (!sessionId) return;
    const controller = new AbortController();
    const loadMergeInfo = async () => {
      try {
        const response = await fetch(
          `${API_BASE_URL}/api/merge-cells/${sessionId}`,
          { signal: controller.signal },
        );
        const json = await response.json();
        const ranges = json.merged_ranges || [];
        setMergeInfo({ hasMerges: ranges.length > 0, ranges });
      } catch {
        setMergeInfo({ hasMerges: false, ranges: [] });
      }
    };
    loadMergeInfo();
    return () => controller.abort();
  }, [sessionId]);

  useEffect(() => {
    if (!sessionId || !loadedSteps || useSavedData) return;
    fetchData(page);
  }, [sessionId, loadedSteps, page, fetchData, useSavedData, forceFetchTick]);

  useEffect(() => {
    // When DataProfiling owns the steps (externalSteps), the project route keeps
    // the session up-to-date with full payload. Never let saveSession overwrite
    // those steps with toSlimStep() which strips payload and breaks replay.
    if (!sessionId || !loadedSteps || externalSteps) return;
    if (steps.length === 0) return;
    const timeout = setTimeout(async () => {
      await saveSession();
      // Re-read from session only when not externally controlled
      if (!externalSteps) {
        try {
          const res = await fetch(`${API_BASE_URL}/api/sessions/${sessionId}`);
          if (res.ok) {
            const json = await res.json();
            setSessionSteps(json.applied_steps || json.steps || []);
          }
        } catch {
          // non-critical — panel will show last known state
        }
      }
    }, 500);
    return () => clearTimeout(timeout);
  }, [steps, sessionId, saveSession, loadedSteps]);

  const jumpToStep = useCallback(
    async (index) => {
      // index === -1 → Source (original, no steps applied)
      if (index < 0) {
        setCurrentStepIndex(-1);
        if (sessionId) {
          try {
            const res = await fetch(
              `${API_BASE_URL}/api/sessions/${sessionId}/replay`,
              {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ step_index: -1 }),
              },
            );
            if (res.ok) {
              const json = await res.json();
              if (json.data) {
                setColumns(
                  (json.columns || []).map((col) => ({ id: col, name: col, type: "text" })),
                );
                setRows(
                  (json.data || []).map((row, i) => ({ ...row, id: row.id ?? i })),
                );
                setUseSavedData(true);
              }
            }
          } catch {}
        }
        return;
      }
      // Check externalSteps first for _rowSnapshot (ribbon op snapshot from DataProfiling)
      const extStep = (externalSteps || sessionSteps)?.[index];
      if (extStep?._rowSnapshot) {
        const snapRows = extStep._rowSnapshot.map((row, i) => ({
          ...row,
          id: row._index ?? row.id ?? i,
        }));
        setRows(snapRows);
        if (extStep._columnSnapshot) {
          setColumns(
            extStep._columnSnapshot.map((name) => ({ id: name, name, type: "text" })),
          );
        }
        setUseSavedData(true);
        setCurrentStepIndex(index);
        return;
      }
      const step = steps[index];
      // Use in-memory snapshot if available (same session, no reload)
      if (step?.rows && step?.columns) {
        applySnapshot(step);
        await syncProfilerSnapshot(step);
        setUseSavedData(true);
        setCurrentStepIndex(index);
        return;
      }
      // Fall back to backend replay — re-derives data from original file
      if (!sessionId) return;
      try {
        const res = await fetch(
          `${API_BASE_URL}/api/sessions/${sessionId}/replay`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ step_index: index }),
          },
        );
        if (!res.ok) return;
        const json = await res.json();
        if (json.data) {
          setColumns(
            (json.columns || []).map((col) => ({ id: col, name: col, type: "text" })),
          );
          setRows(
            (json.data || []).map((row, i) => ({ ...row, id: row.id ?? i })),
          );
          setUseSavedData(true); // prevent fetchData from overwriting time-travel state
          setCurrentStepIndex(index);
        }
      } catch (e) {
        console.error("Replay failed", e);
      }
    },
    [steps, sessionId, externalSteps, sessionSteps, applySnapshot, syncProfilerSnapshot],
  );

  const handleUndo = useCallback(() => {
    if (currentStepIndex <= -1) return;
    jumpToStep(currentStepIndex - 1); // -1 = Source
  }, [currentStepIndex, jumpToStep]);

  const handleRedo = useCallback(() => {
    if (currentStepIndex >= steps.length - 1) return;
    jumpToStep(currentStepIndex + 1);
  }, [currentStepIndex, steps.length, jumpToStep]);

  const handleDeleteStep = useCallback(
    async (panelIndex) => {
      if (panelIndex <= 0) return;
      const sessionIndex = panelIndex - 1;
      // Delegate to DataProfiling if it owns the steps
      if (onDeleteStep) {
        await onDeleteStep(sessionIndex);
        return;
      }
      const nextSessionSteps = sessionSteps.slice(0, sessionIndex);
      setSessionSteps(nextSessionSteps);
      setSteps(nextSessionSteps);
      await saveSession({
        steps: nextSessionSteps,
        allowEmpty: nextSessionSteps.length === 0,
      });
      if (nextSessionSteps.length > 0) {
        await jumpToStep(nextSessionSteps.length - 1);
      } else {
        setCurrentStepIndex(-1);
        setUseSavedData(false);
        fetchData(1);
      }
    },
    [onDeleteStep, sessionSteps, saveSession, jumpToStep, fetchData],
  );

  const handleResetAll = useCallback(async () => {
    // If DataProfiling provides a direct reset handler, use it (single API call)
    if (onResetAllSteps) {
      await onResetAllSteps();
      return;
    }
    // If DataProfiling owns the steps but no batch handler, delete all one-by-one
    if (onDeleteStep && sessionSteps.length > 0) {
      for (let i = sessionSteps.length - 1; i >= 0; i--) {
        await onDeleteStep(i);
      }
      return;
    }
    // Clear all steps from backend and reload original data
    setSessionSteps([]);
    setSteps([]);
    await saveSession({ steps: [], allowEmpty: true });
    setCurrentStepIndex(-1);
    setUseSavedData(false);
    fetchData(1);
  }, [onResetAllSteps, onDeleteStep, sessionSteps, saveSession, fetchData]);

  // Rename a step by index (updates both in-memory and session)
  const handleRenameStep = useCallback(
    (panelIndex, newName) => {
      if (panelIndex <= 0) return;
      const index = panelIndex - 1;
      // Delegate to DataProfiling if it owns the steps
      if (onRenameStep) {
        onRenameStep(index, newName);
        return;
      }
      setSessionSteps((prev) =>
        prev.map((s, i) => (i === index ? { ...s, name: newName } : s)),
      );
      setSteps((prev) =>
        prev.map((s, i) => (i === index ? { ...s, name: newName } : s)),
      );
      // Persist the rename
      const updated = sessionSteps.map((s, i) =>
        i === index ? { ...s, name: newName } : s,
      );
      saveSession({ steps: updated });
    },
    [onRenameStep, sessionSteps, saveSession],
  );

  // When DataProfiling passes appliedSteps as externalSteps, keep the panel in sync.
  // Also move the active highlight to the last step so the panel always shows which
  // step is current after every add/delete (mirrors Power BI behaviour).
  useEffect(() => {
    if (!Array.isArray(externalSteps)) return;
    setSessionSteps(externalSteps);
    // panelSteps = [Source, ...externalSteps], so last external step sits at panel
    // index externalSteps.length.  currentStepIndex is panel-index − 1, hence:
    setCurrentStepIndex(externalSteps.length - 1);
  }, [externalSteps]);

  // When a ribbon op fires, update columns and let fetchData reload rows from backend.
  // Do NOT set useSavedData — that would block pagination. The backend file_binary is
  // already up-to-date after _commit_replay so fetchData will return correct data.
  useEffect(() => {
    if (!refreshTrigger || refreshTrigger === prevRefreshTriggerRef.current) return;
    prevRefreshTriggerRef.current = refreshTrigger;
    if (Array.isArray(initialColumns) && initialColumns.length > 0) {
      setColumns(cloneColumns(initialColumns));
    }
  }, [refreshTrigger, initialColumns]);

  // fetchTrigger fires AFTER the API call (_commit_replay) completes.
  // Incrementing forceFetchTick guarantees the fetchData effect re-runs even when
  // page and useSavedData haven't changed (React would skip a no-op state update).
  useEffect(() => {
    if (!fetchTrigger || fetchTrigger === prevFetchTriggerRef.current) return;
    prevFetchTriggerRef.current = fetchTrigger;
    setUseSavedData(false);
    setPage(1);
    setForceFetchTick((t) => t + 1);
  }, [fetchTrigger]);

  // Apply live API response data directly — eliminates the second HTTP round-trip
  // after addStep / deleteStep / search. Setting useSavedData=true blocks the
  // fetchData effect from overwriting these rows with an un-searched re-fetch.
  // Pagination buttons explicitly call setUseSavedData(false) so they still work.
  useEffect(() => {
    if (!liveDataVersion || liveDataVersion === prevLiveDataVersionRef.current) return;
    prevLiveDataVersionRef.current = liveDataVersion;
    if (!liveData) return;

    if (Array.isArray(liveData.rows)) {
      const nextRows = liveData.rows
        .slice(0, pageSize)
        .map((row, i) => ({ ...row, id: row.id ?? row._index ?? i }));
      setRows(nextRows);
    }
    if (Array.isArray(liveData.columns) && liveData.columns.length > 0) {
      setColumns((prev) => {
        const nameSet = new Set(liveData.columns);
        const filtered = prev.filter((c) => nameSet.has(c.id));
        const existing = new Set(filtered.map((c) => c.id));
        const added = liveData.columns
          .filter((n) => !existing.has(n))
          .map((n) => ({ id: n, name: n, type: "text" }));
        return [...filtered, ...added];
      });
    }
    if (liveData.total !== undefined) {
      const total = Number(liveData.total) || 0;
      setTotalCount(total);
      setTotalPages(Math.max(1, Math.ceil(total / pageSize)));
    }
    setPage(1);
    setUseSavedData(true);
  }, [liveDataVersion, liveData, pageSize]);

  // Apply step-preview data directly — avoids the tableRows→initialRows batching race.
  // When stepPreviewData is null (cleared after addStep/deleteStep), exit preview mode
  // so fetchData takes over and shows the full paginated live dataset.
  useEffect(() => {
    if (!stepPreviewData) {
      setUseSavedData(false);
      setPage(1);
      return;
    }
    if (Array.isArray(stepPreviewData.rows)) {
      setRows(cloneRows(stepPreviewData.rows));
      setUseSavedData(true);
    }
    // Rebuild columns from the preview's column name list.
    // Use allColumnsAtMountRef (frozen at first render) so dropped columns are
    // fully restored (type, name) when going back to a step before the drop.
    if (Array.isArray(stepPreviewData.columns) && stepPreviewData.columns.length > 0) {
      const metaMap = new Map(
        (allColumnsAtMountRef.current || []).map((c) => [c.id, c]),
      );
      const rebuilt = stepPreviewData.columns.map(
        (name) => metaMap.get(name) ?? { id: name, name, type: "text" },
      );
      setColumns(rebuilt);
    }
  }, [stepPreviewVersion, stepPreviewData]);

  // Scroll the highlighted cell into view after highlight changes OR after preview rows load.
  useEffect(() => {
    if (!highlightCell) return;
    const timer = setTimeout(() => {
      if (highlightCellRef.current) {
        highlightCellRef.current.scrollIntoView({
          behavior: "smooth",
          block: "center",
          inline: "center",
        });
      }
    }, 200);
    return () => clearTimeout(timer);
  }, [highlightCell, stepPreviewVersion]);

  // panelSteps: always starts with "Source", then the recorded session steps.
  // This is what the Applied Steps panel displays (Power BI pattern).
  const SOURCE_STEP = useMemo(
    () => ({
      id: "source",
      name: "Source",
      type: "Source",
      timestamp: null,
      description: "Loaded original file",
      params: {},
    }),
    [],
  );

  const panelSteps = useMemo(() => {
    const filtered = sessionSteps.filter(
      (s) => s.type !== "Source" && s.type !== "source",
    );
    return [SOURCE_STEP, ...filtered];
  }, [sessionSteps, SOURCE_STEP]);

  useEffect(() => {
    const handler = (event) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "z") {
        event.preventDefault();
        if (event.shiftKey) {
          handleRedo();
        } else {
          handleUndo();
        }
      }
      if (event.key === "Escape") {
        setShowColumnOverview(false);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [handleUndo, handleRedo]);

  const isValidDate = useCallback((value) => {
    if (!value) return false;
    return !Number.isNaN(Date.parse(value));
  }, []);

  const columnLetterToNumber = useCallback((letters) => {
    return letters
      .toUpperCase()
      .split("")
      .reduce((acc, char) => acc * 26 + (char.charCodeAt(0) - 64), 0);
  }, []);

  const parseCellRef = useCallback(
    (ref) => {
      const match = ref.match(/^([A-Z]+)(\d+)$/i);
      if (!match) return null;
      return { col: columnLetterToNumber(match[1]), row: Number(match[2]) };
    },
    [columnLetterToNumber],
  );

  const mergedCellPositions = useMemo(() => {
    const positions = new Set();
    mergeInfo.ranges.forEach((range) => {
      const [startRef, endRef] = range.split(":");
      const start = parseCellRef(startRef);
      const end = parseCellRef(endRef || startRef);
      if (!start || !end) return;
      for (let r = start.row; r <= end.row; r += 1) {
        for (let c = start.col; c <= end.col; c += 1) {
          positions.add(`${r}-${c}`);
        }
      }
    });
    return positions;
  }, [mergeInfo.ranges, parseCellRef]);

  const columnQuality = useMemo(() => {
    const result = {};
    columns.forEach((col) => {
      if (normalizeColumnType(col.type) !== "number") {
        result[col.id] = { lowerBound: null, upperBound: null };
        return;
      }
      const numeric = rows
        .map((row) => Number(getCellRawValue(row, col.id)))
        .filter((val) => !Number.isNaN(val));
      if (numeric.length === 0) {
        result[col.id] = { lowerBound: null, upperBound: null };
        return;
      }
      const sorted = [...numeric].sort((a, b) => a - b);
      const q1 = sorted[Math.floor(sorted.length * 0.25)];
      const q3 = sorted[Math.floor(sorted.length * 0.75)];
      const iqr = q3 - q1;
      result[col.id] = {
        lowerBound: q1 - 1.5 * iqr,
        upperBound: q3 + 1.5 * iqr,
      };
    });
    return result;
  }, [columns, rows, normalizeColumnType, getCellRawValue]);

  const absoluteColumnIndexMap = useMemo(() => {
    const source =
      Array.isArray(allColumnIds) && allColumnIds.length > 0
        ? allColumnIds
        : columns.map((c) => c.id);
    return new Map(source.map((id, idx) => [id, idx + 1]));
  }, [allColumnIds, columns]);

  const getCellIssues = useCallback(
    (value, colType, colId) => {
      const issues = [];
      if (value === null || value === undefined || value === "") {
        issues.push("missing");
        return issues;
      }
      const normalizedType = normalizeColumnType(colType);
      if (normalizedType === "number" && Number.isNaN(Number(value))) {
        issues.push("type-error");
      }
      if (normalizedType === "date" && !isValidDate(value)) {
        issues.push("type-error");
      }
      if (normalizedType === "number" && !Number.isNaN(Number(value))) {
        const bounds = columnQuality[colId];
        if (bounds?.lowerBound !== null && bounds?.upperBound !== null) {
          const numeric = Number(value);
          if (numeric < bounds.lowerBound || numeric > bounds.upperBound) {
            issues.push("outlier");
          }
        }
      }
      return issues;
    },
    [columnQuality, isValidDate, normalizeColumnType],
  );

  const resolveCellIssues = useCallback(
    (row, rowIndex, col, colIndex) => {
      const normalizeIssueType = (raw) => {
        const type = typeof raw === "string" ? raw : raw?.type;
        if (type === "type_inconsistency" || type === "type-error") return "type-error";
        if (type === "missing" || type === "outlier") return type;
        return null;
      };
      // Map frontend issue key → backend error_type key used in ignoredErrors
      const isIgnored = (frontendType) => {
        if (!ignoredErrors) return false;
        const backendType =
          frontendType === "type-error" ? "type_inconsistency" : frontendType;
        return Boolean(ignoredErrors[`${col.id}|${backendType}`]);
      };

      const cell = row?.[col.id];
      if (cell && typeof cell === "object" && Array.isArray(cell.issues)) {
        return cell.issues
          .map(normalizeIssueType)
          .filter(Boolean)
          .filter((t) => !isIgnored(t));
      }
      if (typeof getProfileCellIssues === "function") {
        const fallbackRowIndex = (page - 1) * pageSize + rowIndex;
        const resolvedRowIndex =
          typeof row?._index === "number"
            ? row._index
            : typeof row?.id === "number"
              ? row.id
              : fallbackRowIndex;
        const raw = getProfileCellIssues(resolvedRowIndex, col.id) || [];
        return raw
          .map(normalizeIssueType)
          .filter(Boolean)
          .filter((t) => !isIgnored(t));
      }
      return getCellIssues(getCellRawValue(row, col.id), col.type, col.id);
    },
    [getProfileCellIssues, page, pageSize, getCellIssues, getCellRawValue, ignoredErrors],
  );

  const issueStats = useMemo(() => {
    // Use dataset-wide counts from profile when available (avoids current-page bias).
    if (profileColumnStatsMap && columns.length > 0) {
      let missing = 0, typeErrors = 0, outliers = 0;
      columns.forEach((col) => {
        const p = profileColumnStatsMap[col.id];
        if (p) {
          if (!ignoredErrors?.[`${col.id}|missing`])           missing    += p.nullCount   || 0;
          if (!ignoredErrors?.[`${col.id}|type_inconsistency`]) typeErrors += p.typeErrors  || 0;
          if (!ignoredErrors?.[`${col.id}|outlier`])            outliers   += p.outliers    || 0;
        }
      });
      // merged and duplicates are client-side only (no dataset-wide profile source)
      let merged = 0;
      rows.forEach((row, rowIndex) => {
        const absoluteRow = (page - 1) * pageSize + rowIndex + 1;
        columns.forEach((col, colIndex) => {
          const absoluteColIndex = absoluteColumnIndexMap.get(col.id) ?? colIndex + 1;
          if (mergedCellPositions.has(`${absoluteRow}-${absoluteColIndex}`)) merged += 1;
        });
      });
      const duplicates = duplicateRowIndices?.size ?? 0;
      return { missing, typeErrors, outliers, merged, duplicates };
    }
    // Fallback: compute from current page rows
    let missing = 0;
    let typeErrors = 0;
    let outliers = 0;
    let merged = 0;
    rows.forEach((row, rowIndex) => {
      const absoluteRow = (page - 1) * pageSize + rowIndex + 1;
      columns.forEach((col, colIndex) => {
        const issues = resolveCellIssues(row, rowIndex, col, colIndex);
        if (issues.includes("missing")) missing += 1;
        if (issues.includes("type-error")) typeErrors += 1;
        if (issues.includes("outlier")) outliers += 1;
        const absoluteColIndex =
          absoluteColumnIndexMap.get(col.id) ?? colIndex + 1;
        if (mergedCellPositions.has(`${absoluteRow}-${absoluteColIndex}`)) merged += 1;
      });
    });
    const duplicates = duplicateRowIndices?.size ?? 0;
    return { missing, typeErrors, outliers, merged, duplicates };
  }, [
    rows,
    columns,
    resolveCellIssues,
    mergedCellPositions,
    page,
    pageSize,
    absoluteColumnIndexMap,
    profileColumnStatsMap,
    duplicateRowIndices,
    ignoredErrors,
  ]);

  const filteredRows = useMemo(() => {
    if (activeFilters.size === 0) return rows;
    // When backend handles issue filtering, rows already contain only matching rows.
    // Only apply client-side filter for "merged"/"duplicate" (no backend equivalent).
    if (backendFilterType) {
      const needsClientFilter = activeFilters.has("merged") || activeFilters.has("duplicate");
      if (!needsClientFilter) return rows;
      return rows.filter((row, rowIndex) => {
        const absoluteRow = (page - 1) * pageSize + rowIndex + 1;
        const rowIdx2 = row._index ?? row.id;
        if (activeFilters.has("duplicate") && duplicateRowIndices?.has(Number(rowIdx2))) return true;
        return columns.some((col, colIndex) => {
          const absoluteColIndex = absoluteColumnIndexMap.get(col.id) ?? colIndex + 1;
          return mergedCellPositions.has(`${absoluteRow}-${absoluteColIndex}`);
        });
      });
    }
    return rows.filter((row, rowIndex) =>
      columns.some((col, colIndex) => {
        const value = row[col.id];
        const issues = resolveCellIssues(row, rowIndex, col, colIndex);
        const filters = Array.from(activeFilters);
        const absoluteRow = (page - 1) * pageSize + rowIndex + 1;
        const absoluteColIndex =
          absoluteColumnIndexMap.get(col.id) ?? colIndex + 1;
        const mergedKey = `${absoluteRow}-${absoluteColIndex}`;
        const rowIdx2 = row._index ?? row.id;
        return filters.some((filter) => {
          if (filter === "merged") return mergedCellPositions.has(mergedKey);
          if (filter === "duplicate") return duplicateRowIndices?.has(Number(rowIdx2)) ?? false;
          return issues.includes(filter);
        });
      }),
    );
  }, [
    rows,
    columns,
    activeFilters,
    backendFilterType,
    resolveCellIssues,
    mergedCellPositions,
    duplicateRowIndices,
    page,
    pageSize,
    absoluteColumnIndexMap,
  ]);

  const sortedRows = useMemo(() => {
    if (!sortConfig.columnId || !sortConfig.direction) return filteredRows;
    const colId = sortConfig.columnId;
    const dir = sortConfig.direction === "asc" ? 1 : -1;
    return [...filteredRows].sort((a, b) => {
      const getRaw = (row) => {
        const cell = row[colId];
        if (cell && typeof cell === "object") return cell.value ?? cell.display_value ?? "";
        return cell ?? "";
      };
      const av = getRaw(a);
      const bv = getRaw(b);
      // Nulls always last
      if (av === null || av === undefined || av === "") return 1;
      if (bv === null || bv === undefined || bv === "") return -1;
      const an = Number(av);
      const bn = Number(bv);
      if (!Number.isNaN(an) && !Number.isNaN(bn)) return dir * (an - bn);
      return dir * String(av).localeCompare(String(bv), undefined, { sensitivity: "base" });
    });
  }, [filteredRows, sortConfig]);

  const toggleSort = useCallback((columnId) => {
    setSortConfig((prev) => {
      if (prev.columnId !== columnId) return { columnId, direction: "asc" };
      if (prev.direction === "asc") return { columnId, direction: "desc" };
      return { columnId: null, direction: null };
    });
  }, []);

  const toggleFilter = useCallback((filterKey) => {
    setActiveFilters((prev) => {
      const next = new Set(prev);
      if (next.has(filterKey)) {
        next.delete(filterKey);
      } else {
        next.add(filterKey);
      }
      return next;
    });
  }, []);

  const clearFilters = useCallback(() => {
    if (activeFilters.size === 0) return;
    setActiveFilters(new Set());
  }, [activeFilters.size]);

  // When the backend filter type changes, reset to page 1 so results start from the beginning.
  const prevBackendFilterTypeRef = useRef(null);
  useEffect(() => {
    if (backendFilterType === prevBackendFilterTypeRef.current) return;
    prevBackendFilterTypeRef.current = backendFilterType;
    setPage(1);
    setUseSavedData(false);
  }, [backendFilterType]);

  const selectedColumn = useMemo(
    () => columns.find((col) => col.id === overviewColumnId),
    [columns, overviewColumnId],
  );

  const columnStats = useMemo(() => {
    if (!selectedColumn) return null;
    const colType = normalizeColumnType(selectedColumn.type);
    // Compute per-page approximations (histogram, topValues) from current rows
    const rawValues = rows.map((row) => {
      const raw = row[selectedColumn.id];
      return raw && typeof raw === "object" ? raw.value : raw;
    });
    const nonEmpty = rawValues.filter(
      (value) => value !== null && value !== undefined && value !== "",
    );
    let histogram = null;
    let topValues = null;
    if (colType === "number") {
      const numeric = nonEmpty.map(Number).filter((v) => !Number.isNaN(v));
      const min = numeric.length ? Math.min(...numeric) : null;
      const max = numeric.length ? Math.max(...numeric) : null;
      const bins = 10;
      const range = max !== null && min !== null ? max - min : 0;
      const step = range === 0 ? 1 : range / bins;
      histogram = Array.from({ length: bins }, (_, i) => ({
        min: min !== null ? min + i * step : 0,
        max: min !== null ? min + (i + 1) * step : 0,
        count: 0,
      }));
      numeric.forEach((value) => {
        const index =
          range === 0 ? 0 : Math.min(bins - 1, Math.floor((value - min) / step));
        histogram[index].count += 1;
      });
    } else {
      const counts = nonEmpty.reduce((acc, value) => {
        const key = String(value);
        acc[key] = (acc[key] || 0) + 1;
        return acc;
      }, {});
      topValues = Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 5);
    }

    // Use full-dataset counts from profile when available — avoids current-page bias
    const p = profileColumnStatsMap?.[selectedColumn.id];
    if (p) {
      // Rebuild histogram using profile min/max so axis labels match bar ranges
      let profileHistogram = histogram;
      if (colType === "number" && p.min !== null && p.max !== null) {
        const profileMin = p.min;
        const profileMax = p.max;
        const range = profileMax - profileMin;
        const step = range === 0 ? 1 : range / 10;
        const numeric = nonEmpty.map(Number).filter((v) => !Number.isNaN(v));
        profileHistogram = Array.from({ length: 10 }, (_, i) => ({
          min: profileMin + i * step,
          max: profileMin + (i + 1) * step,
          count: 0,
        }));
        numeric.forEach((value) => {
          const index = range === 0 ? 0 : Math.min(9, Math.floor((value - profileMin) / step));
          if (index >= 0) profileHistogram[index].count += 1;
        });
      }

      // Use profile top value/frequency so bar widths are correct against full dataset total
      let profileTopValues = topValues;
      if (colType !== "number" && p.topValue != null && p.topFreq != null) {
        profileTopValues = [[p.topValue, p.topFreq]];
      }

      return {
        total:           p.total,
        unique:          p.unique,
        nullCount:       p.nullCount,
        typeErrors:      p.typeErrors,
        outliers:        p.outliers,
        completenessPct: p.completenessPct,
        min:             p.min ?? null,
        max:             p.max ?? null,
        avg:             p.avg ?? null,
        median:          p.median ?? null,
        histogram:       profileHistogram,
        topValues:       profileTopValues,
      };
    }

    // Fallback: compute everything from current page rows
    const nullCount = rawValues.length - nonEmpty.length;
    let typeErrors = 0;
    let outliers = 0;
    const completenessPct = rawValues.length
      ? ((rawValues.length - nullCount) / rawValues.length) * 100
      : 0;
    if (colType === "number") {
      const numeric = nonEmpty.map(Number).filter((v) => !Number.isNaN(v));
      typeErrors = nonEmpty.length - numeric.length;
      const bounds = columnQuality[selectedColumn.id];
      if (bounds?.lowerBound !== null && bounds?.upperBound !== null) {
        outliers = numeric.filter(
          (val) => val < bounds.lowerBound || val > bounds.upperBound,
        ).length;
      }
      const sorted = [...numeric].sort((a, b) => a - b);
      return {
        total: rawValues.length,
        unique: new Set(nonEmpty).size,
        nullCount,
        typeErrors,
        outliers,
        completenessPct,
        min: numeric.length ? Math.min(...numeric) : null,
        max: numeric.length ? Math.max(...numeric) : null,
        avg: numeric.length ? numeric.reduce((a, c) => a + c, 0) / numeric.length : null,
        median: sorted.length
          ? sorted.length % 2 === 0
            ? (sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2]) / 2
            : sorted[Math.floor(sorted.length / 2)]
          : null,
        histogram,
      };
    }
    if (colType === "date") {
      typeErrors = nonEmpty.filter((value) => !isValidDate(value)).length;
    }
    return {
      total: rawValues.length,
      unique: new Set(nonEmpty).size,
      nullCount,
      typeErrors,
      outliers,
      completenessPct,
      min: null,
      max: null,
      avg: null,
      median: null,
      topValues,
    };
  }, [rows, selectedColumn, columnQuality, isValidDate, profileColumnStatsMap, normalizeColumnType]);

  const selectedColumnSet = useMemo(() => {
    const list = selectedColumnIds ?? internalSelectedColumnIds;
    return new Set(list);
  }, [selectedColumnIds, internalSelectedColumnIds]);

  const displayColumns = useMemo(() => {
    if (!visibleColumnIds || visibleColumnIds.length === 0) return columns;
    return columns.filter((col) => visibleColumnIds.includes(col.id));
  }, [columns, visibleColumnIds]);

  const updateSelectedColumns = useCallback(
    (next) => {
      if (onSelectedColumnIdsChange) {
        onSelectedColumnIdsChange(next);
      } else {
        setInternalSelectedColumnIds(next);
      }
    },
    [onSelectedColumnIdsChange],
  );

  const handleHeaderClick = useCallback(
    (event, colId, colIndex) => {
      const current = Array.from(selectedColumnSet);
      let next = [];
      if (event.shiftKey && lastSelectedIndex !== null) {
        const start = Math.min(lastSelectedIndex, colIndex);
        const end = Math.max(lastSelectedIndex, colIndex);
        next = columns.slice(start, end + 1).map((col) => col.id);
      } else if (event.metaKey || event.ctrlKey) {
        if (selectedColumnSet.has(colId)) {
          next = current.filter((id) => id !== colId);
        } else {
          next = [...current, colId];
        }
      } else {
        next = [colId];
      }
      setLastSelectedIndex(colIndex);
      updateSelectedColumns(next);
      setActiveColumnId(colId);
      setOverviewColumnId(colId);
      setShowColumnOverview(true);
    },
    [columns, lastSelectedIndex, selectedColumnSet, updateSelectedColumns],
  );

  const handleHeaderContextMenu = useCallback((event, colId) => {
    event.preventDefault();
    setColumnMenu({
      x: event.clientX,
      y: event.clientY,
      colId,
    });
  }, []);

  const handleCloseOverview = useCallback(() => {
    setShowColumnOverview(false);
  }, []);

  const handleOverviewValueUpdated = useCallback(async () => {
    if (!sessionId) return;
    await fetchData(page);
  }, [sessionId, fetchData, page]);

  return (
    <div className="flex flex-col h-screen w-full">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
        <div className="flex items-center gap-2">
          <button
            onClick={() => { setNewRowData([{}]); setShowAddRowModal(true); }}
            className="px-3 py-2 text-sm rounded-lg bg-[#4F46E5] text-white hover:bg-[#4338CA] transition"
          >
            Add Row
          </button>
          <button
            onClick={() => setShowAddColumnModal(true)}
            className="px-3 py-2 text-sm rounded-lg border border-gray-200 text-gray-700 hover:bg-gray-50 transition"
          >
            Add Column
          </button>
          <button
            onClick={deleteSelectedRows}
            disabled={selectedRowIds.size === 0}
            className="px-3 py-2 text-sm rounded-lg bg-[#EF4444] text-white hover:bg-[#DC2626] disabled:opacity-50 disabled:cursor-not-allowed transition"
          >
            Delete Selected
          </button>
        </div>
      </div>
      {mergeInfo.hasMerges && (
        <div className="mb-3 px-4 py-2 rounded-lg bg-yellow-50 border border-yellow-200 text-sm text-yellow-800 flex flex-wrap items-center gap-3">
          <span className="flex-1">Merged cells detected in the original file. Some values may span multiple columns.</span>
          <div className="flex gap-2 flex-shrink-0">
            <button
              disabled={mergeFilling || !onAddStep}
              onClick={async () => {
                if (!sessionId || mergeFilling || !onAddStep) return;
                setMergeFilling(true);
                try {
                  const cols = (columns.length > 0 ? columns.map((c) => c.id) : null) || (allColumnIds && allColumnIds.length > 0 ? allColumnIds : null);
                  await onAddStep({
                    id: `step_${Date.now()}`,
                    type: "impute",
                    name: "Fill Forward",
                    description: "Merged cells — fill forward across all columns",
                    timestamp: Date.now(),
                    column: null,
                    row_index: null,
                    previous_value: null,
                    edited_value: null,
                    payload: { strategy: "forward_fill", options: {}, columns: cols },
                  });
                  setMergeInfo({ hasMerges: false, ranges: [] });
                } catch {
                  // ignore — addStep shows toast on API failure
                } finally {
                  setMergeFilling(false);
                }
              }}
              className="px-3 py-1 text-xs font-medium bg-yellow-600 text-white rounded-lg hover:bg-yellow-700 disabled:opacity-50 transition-colors"
            >
              {mergeFilling ? "Applying…" : "Fill Forward"}
            </button>
            <button
              disabled={mergeFilling || !onAddStep}
              onClick={async () => {
                if (!sessionId || mergeFilling || !onAddStep) return;
                setMergeFilling(true);
                try {
                  const cols = (columns.length > 0 ? columns.map((c) => c.id) : null) || (allColumnIds && allColumnIds.length > 0 ? allColumnIds : null);
                  await onAddStep({
                    id: `step_${Date.now()}`,
                    type: "impute",
                    name: "Fill Empty",
                    description: "Merged cells — fill with empty across all columns",
                    timestamp: Date.now(),
                    column: null,
                    row_index: null,
                    previous_value: null,
                    edited_value: null,
                    payload: { strategy: "constant", options: { constant_value: "" }, columns: cols },
                  });
                  setMergeInfo({ hasMerges: false, ranges: [] });
                } catch {
                  // ignore — addStep shows toast on API failure
                } finally {
                  setMergeFilling(false);
                }
              }}
              className="px-3 py-1 text-xs font-medium bg-white text-yellow-700 border border-yellow-400 rounded-lg hover:bg-yellow-50 disabled:opacity-50 transition-colors"
            >
              {mergeFilling ? "Applying…" : "Fill Empty"}
            </button>
          </div>
        </div>
      )}

      <div className="flex flex-1 overflow-hidden">
        <div className="flex-1 flex flex-col overflow-hidden min-w-0">
          <div className="flex flex-wrap gap-2 mb-3">
            <button
              onClick={() => {
                setErrorsOnly((prev) => {
                  const next = !prev;
                  setPage(1);
                  setUseSavedData(false);
                  return next;
                });
              }}
              className={`px-3 py-1.5 rounded text-sm flex items-center gap-2 border ${
                errorsOnly
                  ? "bg-red-600 text-white border-red-600"
                  : "bg-white border-gray-300 hover:bg-gray-50 text-gray-700"
              }`}
            >
              <span className="w-2 h-2 rounded-full bg-red-400"></span>
              {errorsOnly ? "Showing Issues Only" : "Show Issues Only"}
            </button>
            <button
              onClick={() => toggleFilter("missing")}
              className={`px-3 py-1.5 rounded text-sm flex items-center gap-2 ${
                activeFilters.has("missing")
                  ? "bg-red-500 text-white"
                  : "bg-gray-100 hover:bg-gray-200"
              }`}
            >
              <span className="w-2 h-2 rounded-full bg-red-400"></span>
              Missing ({issueStats.missing})
            </button>
            <button
              onClick={() => toggleFilter("type-error")}
              className={`px-3 py-1.5 rounded text-sm flex items-center gap-2 ${
                activeFilters.has("type-error")
                  ? "bg-purple-500 text-white"
                  : "bg-gray-100 hover:bg-gray-200"
              }`}
            >
              <span className="w-2 h-2 rounded-full bg-purple-400"></span>
              Type Errors ({issueStats.typeErrors})
            </button>
            <button
              onClick={() => toggleFilter("outlier")}
              className={`px-3 py-1.5 rounded text-sm flex items-center gap-2 ${
                activeFilters.has("outlier")
                  ? "bg-yellow-500 text-white"
                  : "bg-gray-100 hover:bg-gray-200"
              }`}
            >
              <span className="w-2 h-2 rounded-full bg-yellow-400"></span>
              Outliers ({issueStats.outliers})
            </button>
            <button
              onClick={() => toggleFilter("merged")}
              className={`px-3 py-1.5 rounded text-sm flex items-center gap-2 ${
                activeFilters.has("merged")
                  ? "bg-orange-500 text-white"
                  : "bg-gray-100 hover:bg-gray-200"
              }`}
            >
              <span className="w-2 h-2 rounded-full bg-orange-400"></span>
              Merged Cells ({issueStats.merged})
            </button>
            <button
              onClick={() => toggleFilter("duplicate")}
              className={`px-3 py-1.5 rounded text-sm flex items-center gap-2 ${
                activeFilters.has("duplicate")
                  ? "bg-blue-500 text-white"
                  : "bg-gray-100 hover:bg-gray-200"
              }`}
            >
              <span className="w-2 h-2 rounded-full bg-blue-400"></span>
              Duplicates ({issueStats.duplicates})
            </button>
            {activeFilters.size > 0 && (
              <button
                onClick={clearFilters}
                className="px-3 py-1.5 rounded text-sm bg-gray-200 hover:bg-gray-300"
              >
                Clear Filters
              </button>
            )}
          </div>
          <div className="flex-1 overflow-auto border border-gray-200 rounded-2xl min-h-0">
            <table className="min-w-full table-fixed">
              <thead className="sticky top-0 z-10 bg-[#F9FAFB]">
                <tr className="text-left text-xs font-semibold text-[#4A5565]">
                  <th className="w-10 px-3 py-3">
                    <input
                      type="checkbox"
                      checked={allRowsSelected}
                      onChange={toggleAllRows}
                    />
                  </th>
                  <th className="w-12 px-3 py-3">#</th>
                  {displayColumns.map((col, colIndex) => {
                    const isSelected = selectedColumnSet.has(col.id);
                    const isSorted = sortConfig.columnId === col.id;
                    const sortDir = isSorted ? sortConfig.direction : null;
                    return (
                      <th
                        key={col.id}
                        className={`px-3 py-3 min-w-[160px] ${
                          isSelected ? "bg-[#EEF2FF]" : ""
                        }`}
                        onClick={(event) =>
                          handleHeaderClick(event, col.id, colIndex)
                        }
                        onContextMenu={(event) =>
                          handleHeaderContextMenu(event, col.id)
                        }
                        onDoubleClick={() => beginRenameColumn(col)}
                      >
                        {renamingColumnId === col.id ? (
                          <input
                            value={columnDraftName}
                            onChange={(event) =>
                              setColumnDraftName(event.target.value)
                            }
                            onBlur={commitRenameColumn}
                            onKeyDown={(event) => {
                              if (event.key === "Enter") commitRenameColumn();
                              if (event.key === "Escape") {
                                setRenamingColumnId(null);
                              }
                            }}
                            className="w-full bg-white border border-gray-200 rounded px-2 py-1 text-xs"
                            autoFocus
                          />
                        ) : (
                          <div className="flex items-center justify-between gap-2">
                            <span className="truncate">{col.name}</span>
                            <div className="flex items-center gap-1 shrink-0">
                              <button
                                onClick={(e) => { e.stopPropagation(); toggleSort(col.id); }}
                                title={sortDir === "asc" ? "Sorted A→Z (click for Z→A)" : sortDir === "desc" ? "Sorted Z→A (click to clear)" : "Sort column"}
                                className={`text-[10px] px-1 rounded transition-colors ${
                                  isSorted
                                    ? "text-[#2B7FFF] bg-[#EEF2FF]"
                                    : "text-gray-300 hover:text-gray-500"
                                }`}
                              >
                                {sortDir === "asc" ? "↑" : sortDir === "desc" ? "↓" : "↕"}
                              </button>
                              {isSelected && (
                                <button
                                  onClick={(event) => {
                                    event.stopPropagation();
                                    dropColumn(col.id);
                                  }}
                                  className="text-xs text-[#EF4444] hover:text-[#DC2626]"
                                >
                                  Drop
                                </button>
                              )}
                            </div>
                          </div>
                        )}
                      </th>
                    );
                  })}
                </tr>
              </thead>
              <tbody>
                {sortedRows.map((row, rowIndex) => (
                  <tr
                    key={row.id}
                    className={`border-t border-gray-200 ${
                      rowIndex % 2 === 0 ? "bg-white" : "bg-[#FBFCFE]"
                    } hover:bg-[#F3F4F6] transition`}
                  >
                    <td className="px-3 py-2">
                      <input
                        type="checkbox"
                        checked={selectedRowIds.has(row.id)}
                        onChange={() => toggleRowSelection(row.id)}
                      />
                    </td>
                    <td className="px-3 py-2 text-xs text-[#6A7282]">
                      {(page - 1) * pageSize + rowIndex + 1}
                    </td>
                    {displayColumns.map((col, colIndex) => {
                      const isEditing =
                        editingCell?.rowId === row.id &&
                        editingCell?.colId === col.id;
                      const cellValue = getCellRawValue(row, col.id);
                      const cellContent =
                        getCellDisplayValue(row, col.id) === null ||
                        getCellDisplayValue(row, col.id) === undefined
                          ? ""
                          : getCellDisplayValue(row, col.id);
                      const normalizedDisplayType = String(
                        col.type || "",
                      ).toLowerCase();
                      const isIntegerDisplayType =
                        normalizedDisplayType.includes("int");
                      const isFloatDisplayType =
                        normalizedDisplayType.includes("dec") ||
                        normalizedDisplayType.includes("float") ||
                        normalizedDisplayType.includes("double") ||
                        normalizedDisplayType === "number" ||
                        normalizedDisplayType.includes("numeric");
                      let renderedContent = cellContent;
                      if (
                        cellContent !== "" &&
                        (isIntegerDisplayType || isFloatDisplayType)
                      ) {
                        const numeric = Number(cellValue);
                        if (!Number.isNaN(numeric)) {
                          renderedContent = isFloatDisplayType
                            ? numeric.toFixed(1)
                            : String(Math.trunc(numeric));
                        }
                      }
                      const issues = resolveCellIssues(
                        row,
                        rowIndex,
                        col,
                        colIndex,
                      );
                      const hasMissing = issues.includes("missing");
                      const hasTypeError = issues.includes("type-error");
                      const hasOutlier = issues.includes("outlier");
                      const isChanged =
                        changedCells.has(`${row.id}-${col.id}`) ||
                        externalChangedKeys.has(`${row.id}-${col.id}`) ||
                        externalChangedKeys.has(`${row._index}-${col.name}`);
                      const isEmptied =
                        emptiedCells.has(`${row.id}-${col.id}`) ||
                        externalEmptiedKeys.has(`${row.id}-${col.id}`) ||
                        externalEmptiedKeys.has(`${row._index}-${col.name}`);
                      const absoluteRow = (page - 1) * pageSize + rowIndex + 1;
                      const absoluteColIndex =
                        absoluteColumnIndexMap.get(col.id) ?? colIndex + 1;
                      const hasMerged = mergedCellPositions.has(
                        `${absoluteRow}-${absoluteColIndex}`,
                      );
                      const rowIdx2 = row._index ?? row.id;
                      const isDuplicateRow =
                        duplicateRowIndices != null &&
                        rowIdx2 != null &&
                        duplicateRowIndices.has(Number(rowIdx2));
                      // Build hover tooltip explaining WHY each highlight colour is shown
                      const cellIssueRaw = row[col.id]?.issues || [];
                      const cellTooltip = (() => {
                        const parts = [];
                        if (hasMissing) parts.push(`Missing value: no data found in column "${col.name}"`);
                        if (hasOutlier) {
                          const oi = cellIssueRaw.find((i) => i.type === "outlier") || {};
                          const method = oi.method || "IQR";
                          const numVal = Number(cellValue);
                          let msg = "Outlier";
                          if (!Number.isNaN(numVal) && oi.lower_bound != null && oi.upper_bound != null) {
                            if (numVal > oi.upper_bound) {
                              msg = `Outlier: value ${numVal} exceeds upper bound ${oi.upper_bound} (${method} method)`;
                            } else if (numVal < oi.lower_bound) {
                              msg = `Outlier: value ${numVal} is below lower bound ${oi.lower_bound} (${method} method)`;
                            } else {
                              msg = `Outlier: value ${numVal} flagged by ${method} method`;
                            }
                          } else {
                            msg = `Outlier flagged by ${method} method`;
                          }
                          parts.push(msg);
                        }
                        if (hasTypeError) {
                          const ti = cellIssueRaw.find((i) => i.type === "type_inconsistency") || {};
                          const exp = ti.expected_type;
                          const actual = ti.actual_value;
                          if (exp && actual != null) {
                            parts.push(`Type mismatch: value "${actual}" is not a valid ${exp}`);
                          } else if (exp) {
                            parts.push(`Type mismatch: column expects ${exp}`);
                          } else {
                            parts.push("Type inconsistency detected in this cell");
                          }
                        }
                        if (hasMerged) parts.push(`Merged cell in column "${col.name}"`);
                        if (isDuplicateRow) parts.push(`Duplicate row detected`);
                        if (isEmptied) parts.push(`Cleared: "${col.name}" was set to empty in this session`);
                        else if (isChanged) parts.push(`Edited: value in "${col.name}" was changed in this session`);
                        return parts.join("\n") || undefined;
                      })();
                      // Single-cell highlight (cell_edit steps)
                      const isCellHighlighted =
                        highlightCell != null &&
                        highlightCell.rowIndex != null &&
                        col.name === highlightCell.columnName &&
                        (Number(row._index) === Number(highlightCell.rowIndex) ||
                          Number(row.id) === Number(highlightCell.rowIndex));
                      // Batch-step highlight: only cells that actually changed
                      const isBatchHighlighted =
                        highlightCell != null &&
                        Array.isArray(highlightCell.changedCells) &&
                        highlightCell.changedCells.some(
                          (c) =>
                            c.columnName === col.name &&
                            (Number(row._index) === Number(c.rowIndex) ||
                              Number(row.id) === Number(c.rowIndex)),
                        );
                      const isHighlighted = isCellHighlighted || isBatchHighlighted;
                      // Scroll anchor: exact cell for single-edit, first changed cell for batch
                      const isScrollAnchor =
                        isCellHighlighted ||
                        (isBatchHighlighted &&
                          highlightCell.changedCells[0]?.columnName === col.name &&
                          (Number(row._index) ===
                            Number(highlightCell.changedCells[0]?.rowIndex) ||
                            Number(row.id) ===
                              Number(highlightCell.changedCells[0]?.rowIndex)));
                      return (
                        <td
                          key={`${row.id}-${col.id}`}
                          ref={isScrollAnchor ? highlightCellRef : null}
                          title={cellTooltip}
                          className={`px-3 py-2 text-sm ${
                            selectedColumnSet.has(col.id) ? "bg-[#EEF2FF]" : ""
                          } ${
                            hasMissing
                              ? "bg-red-50 border-l-4 border-red-400"
                              : ""
                          } ${
                            hasTypeError
                              ? "bg-purple-50 border-l-4 border-purple-400"
                              : ""
                          } ${
                            hasOutlier
                              ? "bg-yellow-50 border-l-4 border-yellow-400"
                              : ""
                          } ${
                            hasMerged
                              ? "bg-orange-50 border-l-4 border-orange-400"
                              : ""
                          } ${
                            isDuplicateRow
                              ? "bg-blue-50 border-l-4 border-blue-400"
                              : ""
                          } ${
                            isChanged && !isEmptied
                              ? "bg-green-50 border-l-4 border-green-500"
                              : isEmptied
                                ? "bg-red-50 border-l-4 border-red-500"
                                : ""
                          }`}
                          style={
                            isCellHighlighted
                              ? {
                                  backgroundColor: "#DBEAFE",
                                  outline: "3px solid #2563EB",
                                  outlineOffset: "-2px",
                                  animation: "pulse 1.5s ease-in-out 3",
                                }
                              : isBatchHighlighted
                                ? {
                                    backgroundColor: "#F0FDF4",
                                    outline: "3px solid #16A34A",
                                    outlineOffset: "-2px",
                                    animation: "pulse 1.5s ease-in-out 3",
                                  }
                                : undefined
                          }
                          onClick={() => startEditCell(row.id, col.id)}
                        >
                          {isEditing ? (
                            <input
                              type={col.type === "number" ? "number" : col.type}
                              value={editingValue}
                              onChange={(event) =>
                                setEditingValue(event.target.value)
                              }
                              onBlur={cancelEditCell}
                              onKeyDown={(event) =>
                                handleCellKeyDown(event, row.id, col.id)
                              }
                              className="w-full rounded border border-[#6366F1] px-2 py-1 text-sm"
                              autoFocus
                            />
                          ) : (
                            <span
                              className={`block truncate ${
                                cellContent === "" ? "text-gray-400 italic" : ""
                              } ${
                                cellContent !== "" &&
                                (isIntegerDisplayType || isFloatDisplayType)
                                  ? "italic"
                                  : ""
                              }`}
                            >
                              {cellContent === "" ? "Empty" : renderedContent}
                            </span>
                          )}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="flex items-center justify-between mt-3 text-sm text-[#4B5563]">
            <span>
              Showing {filteredRows.length ? (page - 1) * pageSize + 1 : 0}-
              {Math.min(page * pageSize, totalCount || filteredRows.length)} of{" "}
              {totalCount || filteredRows.length} rows
            </span>
            <div className="flex items-center gap-3">
              <button
                onClick={() => { setUseSavedData(false); setPage((prev) => Math.max(1, prev - 1)); }}
                disabled={page <= 1 || loading}
                className="px-3 py-2 rounded-lg border border-gray-200 disabled:opacity-50"
              >
                ← Previous
              </button>
              <span className="flex items-center gap-1.5 text-sm">
                Page
                <input
                  type="text"
                  inputMode="numeric"
                  value={pageInputValue}
                  onChange={(e) => setPageInputValue(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      const n = parseInt(pageInputValue, 10);
                      if (!isNaN(n)) {
                        setUseSavedData(false);
                        setPage(Math.min(totalPages, Math.max(1, n)));
                      } else {
                        setPageInputValue(String(page));
                      }
                      e.target.blur();
                    } else if (e.key === "Escape") {
                      setPageInputValue(String(page));
                      e.target.blur();
                    }
                  }}
                  onBlur={() => {
                    const n = parseInt(pageInputValue, 10);
                    if (!isNaN(n)) {
                      setUseSavedData(false);
                      setPage(Math.min(totalPages, Math.max(1, n)));
                    } else {
                      setPageInputValue(String(page));
                    }
                  }}
                  className="w-12 text-center border border-gray-300 rounded px-1 py-0.5 text-sm focus:outline-none focus:border-blue-400 focus:ring-1 focus:ring-blue-200"
                />
                of {totalPages}
              </span>
              <button
                onClick={() => { setUseSavedData(false); setPage((prev) => Math.min(totalPages, prev + 1)); }}
                disabled={page >= totalPages || loading}
                className="px-3 py-2 rounded-lg border border-gray-200 disabled:opacity-50"
              >
                Next →
              </button>
            </div>
          </div>
          {showColumnOverview && selectedColumn && (
            <div className="h-auto sm:h-80 border-t bg-white overflow-y-auto shrink-0 mt-4 rounded-2xl">
              <ColumnOverviewPanel
                column={selectedColumn}
                stats={columnStats}
                visible={showColumnOverview}
                onClose={handleCloseOverview}
                sessionId={sessionId}
                apiService={ApiService}
                onValueUpdated={handleOverviewValueUpdated}
                currentRows={rows}
              />
            </div>
          )}
        </div>

        {columnMenu && (
          <div
            className="fixed z-50 bg-white border border-gray-200 rounded-lg shadow-lg w-56"
            style={{ left: columnMenu.x, top: columnMenu.y }}
            onMouseLeave={() => setColumnMenu(null)}
          >
            <button
              onClick={() => {
                onColumnContextAction?.("fill_mode", columnMenu.colId);
                setColumnMenu(null);
              }}
              className="w-full text-left px-3 py-2 text-sm hover:bg-gray-50"
            >
              Fill Missing (Mode)
            </button>
            <button
              onClick={() => {
                onColumnContextAction?.(
                  "remove_missing_rows",
                  columnMenu.colId,
                );
                setColumnMenu(null);
              }}
              className="w-full text-left px-3 py-2 text-sm hover:bg-gray-50"
            >
              Remove Missing Rows
            </button>
            <button
              onClick={() => {
                onColumnContextAction?.("outliers_iqr_cap", columnMenu.colId);
                setColumnMenu(null);
              }}
              className="w-full text-left px-3 py-2 text-sm hover:bg-gray-50"
            >
              Detect Outliers (IQR)
            </button>
            <button
              onClick={() => {
                onColumnContextAction?.("duplicates_mark", columnMenu.colId);
                setColumnMenu(null);
              }}
              className="w-full text-left px-3 py-2 text-sm hover:bg-gray-50"
            >
              Mark Duplicates
            </button>
            <button
              onClick={() => {
                beginRenameColumn(
                  columns.find((c) => c.id === columnMenu.colId),
                );
                setColumnMenu(null);
              }}
              className="w-full text-left px-3 py-2 text-sm hover:bg-gray-50"
            >
              Rename Column
            </button>
            <button
              onClick={() => {
                dropColumn(columnMenu.colId);
                setColumnMenu(null);
              }}
              className="w-full text-left px-3 py-2 text-sm text-red-600 hover:bg-red-50"
            >
              Delete Column
            </button>
          </div>
        )}

        <AppliedStepsPanel
          steps={panelSteps}
          currentStepIndex={currentStepIndex + 1}
          onUndo={handleUndo}
          onRedo={handleRedo}
          onJump={(index) => {
            // index 0 = Source, index N = session step N-1
            const sessionIndex = index - 1;
            setCurrentStepIndex(sessionIndex); // update panel highlight immediately
            if (onStepClick) {
              onStepClick(sessionIndex);
            } else {
              jumpToStep(sessionIndex);
            }
          }}
          onDeleteStep={handleDeleteStep}
          onRenameStep={handleRenameStep}
          onResetAll={handleResetAll}
        />
      </div>

      {showAddRowModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-6 w-[92vw] max-w-5xl max-h-[82vh] flex flex-col shadow-xl">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold">Add Rows</h3>
              <button
                onClick={() => { setShowAddRowModal(false); setNewRowData([{}]); }}
                className="text-gray-400 hover:text-gray-600 text-xl leading-none"
              >
                ×
              </button>
            </div>

            <div className="overflow-auto flex-1 border rounded-md">
              <table className="text-sm border-collapse" style={{ minWidth: "max-content", width: "100%" }}>
                <thead>
                  <tr className="bg-gray-50 sticky top-0 z-10">
                    <th className="w-8 px-2 py-2 border-b border-r text-gray-400 font-normal text-center">#</th>
                    {columns.map((col) => (
                      <th
                        key={col.id}
                        className="px-3 py-2 border-b border-r text-left font-medium text-gray-700 whitespace-nowrap min-w-[120px]"
                      >
                        {col.name}
                      </th>
                    ))}
                    <th className="w-8 border-b" />
                  </tr>
                </thead>
                <tbody>
                  {newRowData.map((rowObj, rowIdx) => (
                    <tr key={rowIdx} className="hover:bg-blue-50/30">
                      <td className="px-2 py-1 border-b border-r text-center text-gray-400 text-xs select-none">
                        {rowIdx + 1}
                      </td>
                      {columns.map((col) => (
                        <td key={col.id} className="border-b border-r p-0">
                          <input
                            type="text"
                            className="w-full px-3 py-1.5 outline-none focus:bg-blue-50 min-w-[120px]"
                            value={rowObj[col.id] ?? ""}
                            onChange={(e) =>
                              setNewRowData((prev) =>
                                prev.map((r, i) =>
                                  i === rowIdx ? { ...r, [col.id]: e.target.value } : r,
                                )
                              )
                            }
                          />
                        </td>
                      ))}
                      <td className="border-b px-2 text-center">
                        {newRowData.length > 1 && (
                          <button
                            onClick={() =>
                              setNewRowData((prev) => prev.filter((_, i) => i !== rowIdx))
                            }
                            className="text-gray-300 hover:text-red-500 text-xl leading-none"
                          >
                            ×
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <button
              onClick={() => setNewRowData((prev) => [...prev, {}])}
              className="mt-2 text-sm text-blue-600 hover:text-blue-800 self-start flex items-center gap-1 py-1"
            >
              <span className="text-base font-bold leading-none">+</span> Add Row
            </button>

            <div className="flex gap-2 mt-3 pt-3 border-t">
              <button
                onClick={() => {
                  addRows(newRowData);
                  setShowAddRowModal(false);
                  setNewRowData([{}]);
                }}
                className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 text-sm font-medium"
              >
                Add {newRowData.length} Row{newRowData.length > 1 ? "s" : ""}
              </button>
              <button
                onClick={() => { setShowAddRowModal(false); setNewRowData([{}]); }}
                className="px-4 py-2 border rounded text-sm text-gray-600 hover:bg-gray-50"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {showAddColumnModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-6 w-[400px]">
            <h3 className="text-lg font-semibold mb-4">Add New Column</h3>
            <div className="mb-3">
              <label className="block text-sm font-medium mb-1">
                Column Name
              </label>
              <input
                type="text"
                className="w-full border rounded px-3 py-2"
                value={newColumn.name}
                onChange={(event) =>
                  setNewColumn((prev) => ({
                    ...prev,
                    name: event.target.value,
                  }))
                }
              />
            </div>
            <div className="mb-3">
              <label className="block text-sm font-medium mb-1">
                Data Type
              </label>
              <select
                className="w-full border rounded px-3 py-2"
                value={newColumn.type}
                onChange={(event) =>
                  setNewColumn((prev) => ({
                    ...prev,
                    type: event.target.value,
                  }))
                }
              >
                <option value="text">Text</option>
                <option value="number">Number</option>
                <option value="date">Date</option>
              </select>
            </div>
            <div className="flex gap-2 mt-6">
              <button
                onClick={() => {
                  addColumn(newColumn);
                  setShowAddColumnModal(false);
                  setNewColumn({ name: "", type: "text" });
                }}
                className="px-4 py-2 bg-blue-600 text-white rounded"
              >
                Add Column
              </button>
              <button
                onClick={() => {
                  setShowAddColumnModal(false);
                  setNewColumn({ name: "", type: "text" });
                }}
                className="px-4 py-2 border rounded"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default InteractiveDataTable;
