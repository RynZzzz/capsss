import { useState, useCallback, useEffect } from "react";
import ApiService from "../../services/api"; // adjust path as needed
import { invalidateProject, prefetch, getProfileSync, setProfileCache, invalidateProfile } from "../../cache/sessionCache";

export const useDataProfiler = () => {
  // ── Persisted state ───────────────────────────────────────────────────────
  const [sessionId, setSessionId] = useState(() => {
    try {
      return localStorage.getItem("cleanlogic_session_id");
    } catch {
      return null;
    }
  });

  const [filename, setFilename] = useState(() => {
    try {
      return localStorage.getItem("cleanlogic_filename");
    } catch {
      return null;
    }
  });

  // ── UI state ──────────────────────────────────────────────────────────────
  // Initialize from module-level cache so navigation back shows data instantly.
  const [profile, setProfile] = useState(() => {
    try {
      return getProfileSync(localStorage.getItem("cleanlogic_session_id"));
    } catch {
      return null;
    }
  });
  const [selectedColumn, setSelectedColumn] = useState(null);
  const [selectedColumnDetails, setSelectedColumnDetails] = useState(null);
  const [highlightMode, setHighlightMode] = useState("none");
  const [isLoading, setIsLoading] = useState(false);
  const [uploadPhase, setUploadPhase] = useState(null); // null | "uploading" | "analyzing"
  const [error, setError] = useState(null);
  const [pendingChanges, setPendingChanges] = useState(new Map());
  const [changeCount, setChangeCount] = useState(0);

  // ── New: cleaning & viz state ─────────────────────────────────────────────
  const [cleaningSteps, setCleaningSteps] = useState([]);
  const [vizColumns, setVizColumns] = useState([]);
  const [lastChartData, setLastChartData] = useState(null);
  const [cleaningResult, setCleaningResult] = useState(null); // last op result

  // ── Restore session on mount ──────────────────────────────────────────────
  useEffect(() => {
    // Cache hit: profile was hydrated synchronously from module-level cache —
    // no network call needed. Still prefetch other pages in the background.
    if (!sessionId) return;
    if (profile) { prefetch(sessionId); return; }
    setIsLoading(true);
    ApiService.getProfile(sessionId)
      .then((p) => {
        setProfile(p);
        setProfileCache(sessionId, p);
        prefetch(sessionId);
      })
      .catch((err) => {
        const status = err?.response?.status;
        if (status === 404 || status === 401) {
          localStorage.removeItem("cleanlogic_session_id");
          localStorage.removeItem("cleanlogic_filename");
          setSessionId(null);
          setFilename(null);
        }
      })
      .finally(() => setIsLoading(false));
  }, []); // eslint-disable-line

  // ── Persist session to localStorage ──────────────────────────────────────
  useEffect(() => {
    sessionId
      ? localStorage.setItem("cleanlogic_session_id", sessionId)
      : localStorage.removeItem("cleanlogic_session_id");
  }, [sessionId]);

  useEffect(() => {
    filename
      ? localStorage.setItem("cleanlogic_filename", filename)
      : localStorage.removeItem("cleanlogic_filename");
  }, [filename]);

  // ── Helpers ───────────────────────────────────────────────────────────────

  const _setErr = (err) =>
    setError(typeof err === "string" ? err : err?.message || "Unknown error");

  /** After a cleaning op, update profile + steps from the response. */
  const _applyCleanResult = useCallback((result) => {
    if (result.profile) setProfile(result.profile);
    setCleaningResult(result);
    setChangeCount((n) => n + 1);
  }, []);

  // ── Upload ────────────────────────────────────────────────────────────────

  const uploadFile = useCallback(async (file) => {
    setIsLoading(true);
    setUploadPhase("uploading");
    setError(null);
    try {
      const result = await ApiService.uploadFile(file);
      setSessionId(result.session_id);
      setFilename(result.filename);

      // Poll until background profiling is complete
      setUploadPhase("analyzing");
      const status = await new Promise((resolve, reject) => {
        let attempts = 0;
        const poll = async () => {
          try {
            const s = await ApiService.getProfileStatus(result.session_id);
            if (s.ready) {
              resolve(s);
            } else if (++attempts > 600) {
              reject(new Error("Profiling timed out — please try again."));
            } else {
              setTimeout(poll, 1500);
            }
          } catch (err) {
            reject(err);
          }
        };
        poll();
      });

      setProfile(status.profile);
      setProfileCache(result.session_id, status.profile);
      setPendingChanges(new Map());
      setChangeCount(0);
      setCleaningSteps([]);
      return {
        session_id: result.session_id,
        has_merges: status.has_merges || false,
        merged_cells: status.merged_cells || [],
      };
    } catch (err) {
      _setErr(err);
      throw err;
    } finally {
      setIsLoading(false);
      setUploadPhase(null);
    }
  }, []);

  const loadSession = useCallback(async (session_id, file_name) => {
    if (!session_id) return;
    setIsLoading(true);
    setError(null);
    try {
      setSessionId(session_id);
      setFilename(file_name || "");
      const p = await ApiService.getProfile(session_id, 50);
      setProfile(p);
      setProfileCache(session_id, p);
      setPendingChanges(new Map());
      setChangeCount(0);
      setCleaningSteps([]);
    } catch (err) {
      _setErr(err);
      throw err;
    } finally {
      setIsLoading(false);
    }
  }, []);

  // ── Refresh ───────────────────────────────────────────────────────────────

  const refreshProfile = useCallback(async () => {
    if (!sessionId) return;
    setIsLoading(true);
    try {
      invalidateProfile(sessionId);
      const p = await ApiService.getProfile(sessionId, 200);
      setProfile(p);
      setProfileCache(sessionId, p);
      if (selectedColumn) {
        const d = await ApiService.getColumnDetails(sessionId, selectedColumn);
        setSelectedColumnDetails(d);
      }
    } catch (err) {
      _setErr(err);
    } finally {
      setIsLoading(false);
    }
  }, [sessionId, selectedColumn]);

  // ── Column selection ──────────────────────────────────────────────────────

  const selectColumn = useCallback(
    async (columnName) => {
      setSelectedColumn(columnName);
      if (!columnName || !sessionId) {
        setSelectedColumnDetails(null);
        return;
      }
      setIsLoading(true);
      try {
        const d = await ApiService.getColumnDetails(sessionId, columnName);
        setSelectedColumnDetails(d);
      } catch (err) {
        _setErr(err);
      } finally {
        setIsLoading(false);
      }
    },
    [sessionId],
  );

  // ── Cell edits ────────────────────────────────────────────────────────────

  const updateCell = useCallback(
    async (rowIdx, colName, newValue) => {
      if (!sessionId) return;
      try {
        const result = await ApiService.updateCell(
          sessionId,
          rowIdx,
          colName,
          newValue,
        );
        if (result.success) {
          setProfile((prev) => {
            if (!prev) return prev;
            return {
              ...prev,
              columns: prev.columns.map((c) =>
                c.name === colName ? result.column_stats : c,
              ),
              data: {
                ...prev.data,
                data: prev.data.data.map((row, idx) =>
                  idx === rowIdx
                    ? { ...row, [colName]: result.cell_info }
                    : row,
                ),
              },
            };
          });
          if (selectedColumn === colName)
            setSelectedColumnDetails(result.column_stats);
          await refreshProfile();
          await ApiService.saveChanges(sessionId);
          setPendingChanges(new Map());
          setChangeCount(0);
        }
      } catch (err) {
        _setErr(err);
        throw err;
      }
    },
    [sessionId, selectedColumn, refreshProfile],
  );

  const batchUpdateCells = useCallback(
    async (updates) => {
      if (!sessionId) return;
      setIsLoading(true);
      try {
        const result = await ApiService.batchUpdateCells(sessionId, updates);
        if (profile) {
          setProfile((prev) =>
            prev
              ? {
                  ...prev,
                  columns: prev.columns.map(
                    (c) => result.updated_columns[c.name] || c,
                  ),
                }
              : prev,
          );
        }
        if (selectedColumn && result.updated_columns[selectedColumn])
          setSelectedColumnDetails(result.updated_columns[selectedColumn]);
        await refreshProfile();
        await ApiService.saveChanges(sessionId);
        setPendingChanges(new Map());
        setChangeCount(0);
      } catch (err) {
        _setErr(err);
        throw err;
      } finally {
        setIsLoading(false);
      }
    },
    [sessionId, profile, selectedColumn, refreshProfile],
  );

  const updateColumnType = useCallback(
    async (colName, newType) => {
      if (!sessionId) return;
      setIsLoading(true);
      try {
        const result = await ApiService.updateColumnType(
          sessionId,
          colName,
          newType,
        );
        if (!result.success)
          throw new Error(result.error || "Failed to update column type");
        setChangeCount((n) => n + 1);
        await refreshProfile();
      } catch (err) {
        _setErr(err);
        throw err;
      } finally {
        setIsLoading(false);
      }
    },
    [sessionId, refreshProfile],
  );

  const getColumnValues = useCallback(
    async (columnName, params = {}) => {
      if (!sessionId) return null;
      try {
        return await ApiService.getColumnValues(sessionId, columnName, params);
      } catch (err) {
        _setErr(err);
        throw err;
      }
    },
    [sessionId],
  );

  const saveChanges = useCallback(async () => {
    if (!sessionId) return;
    setIsLoading(true);
    try {
      await ApiService.saveChanges(sessionId);
      setPendingChanges(new Map());
      setChangeCount(0);
      await refreshProfile();
    } catch (err) {
      _setErr(err);
      throw err;
    } finally {
      setIsLoading(false);
    }
  }, [sessionId, refreshProfile]);

  const resetChanges = useCallback(async () => {
    if (!sessionId) return;
    setIsLoading(true);
    try {
      const result = await ApiService.resetChanges(sessionId);
      setProfile(result.profile);
      setPendingChanges(new Map());
      setChangeCount(0);
      setCleaningSteps([]);
      if (selectedColumn) {
        const d = await ApiService.getColumnDetails(sessionId, selectedColumn);
        setSelectedColumnDetails(d);
      }
    } catch (err) {
      _setErr(err);
      throw err;
    } finally {
      setIsLoading(false);
    }
  }, [sessionId, selectedColumn]);

  const getChangesLog = useCallback(async () => {
    if (!sessionId) return [];
    try {
      const r = await ApiService.getChangesLog(sessionId);
      return r.changes;
    } catch (err) {
      _setErr(err);
      return [];
    }
  }, [sessionId]);

  // ── CLEANING OPERATIONS ───────────────────────────────────────────────────

  const imputeColumn = useCallback(
    async (params) => {
      if (!sessionId) return;
      setIsLoading(true);
      setError(null);
      try {
        const result = await ApiService.imputeColumn(sessionId, params);
        _applyCleanResult(result);
        await refreshProfile();
        const steps = await ApiService.getCleaningSteps(sessionId);
        setCleaningSteps(steps.steps || []);
        invalidateProject(sessionId);
        return result;
      } catch (err) {
        _setErr(err);
        throw err;
      } finally {
        setIsLoading(false);
      }
    },
    [sessionId, _applyCleanResult, refreshProfile],
  );

  const batchImpute = useCallback(
    async (operations) => {
      if (!sessionId) return;
      setIsLoading(true);
      setError(null);
      try {
        const result = await ApiService.batchImpute(sessionId, operations);
        _applyCleanResult(result);
        await refreshProfile();
        const steps = await ApiService.getCleaningSteps(sessionId);
        setCleaningSteps(steps.steps || []);
        invalidateProject(sessionId);
        return result;
      } catch (err) {
        _setErr(err);
        throw err;
      } finally {
        setIsLoading(false);
      }
    },
    [sessionId, _applyCleanResult, refreshProfile],
  );

  const handleDuplicates = useCallback(
    async (params) => {
      if (!sessionId) return;
      setIsLoading(true);
      setError(null);
      try {
        const result = await ApiService.handleDuplicates(sessionId, params);
        _applyCleanResult(result);
        await refreshProfile();
        const steps = await ApiService.getCleaningSteps(sessionId);
        setCleaningSteps(steps.steps || []);
        invalidateProject(sessionId);
        return result;
      } catch (err) {
        _setErr(err);
        throw err;
      } finally {
        setIsLoading(false);
      }
    },
    [sessionId, _applyCleanResult, refreshProfile],
  );

  const handleOutliers = useCallback(
    async (params) => {
      if (!sessionId) return;
      setIsLoading(true);
      setError(null);
      try {
        const result = await ApiService.handleOutliers(sessionId, params);
        _applyCleanResult(result);
        await refreshProfile();
        const steps = await ApiService.getCleaningSteps(sessionId);
        setCleaningSteps(steps.steps || []);
        invalidateProject(sessionId);
        return result;
      } catch (err) {
        _setErr(err);
        throw err;
      } finally {
        setIsLoading(false);
      }
    },
    [sessionId, _applyCleanResult, refreshProfile],
  );

  const batchOutliers = useCallback(
    async (operations) => {
      if (!sessionId) return;
      setIsLoading(true);
      setError(null);
      try {
        const result = await ApiService.batchOutliers(sessionId, operations);
        _applyCleanResult(result);
        await refreshProfile();
        const steps = await ApiService.getCleaningSteps(sessionId);
        setCleaningSteps(steps.steps || []);
        invalidateProject(sessionId);
        return result;
      } catch (err) {
        _setErr(err);
        throw err;
      } finally {
        setIsLoading(false);
      }
    },
    [sessionId, _applyCleanResult, refreshProfile],
  );

  const handleTypeInconsistencies = useCallback(
    async (params) => {
      if (!sessionId) return;
      setIsLoading(true);
      setError(null);
      try {
        const result = await ApiService.handleTypeInconsistencies(
          sessionId,
          params,
        );
        _applyCleanResult(result);
        await refreshProfile();
        const steps = await ApiService.getCleaningSteps(sessionId);
        setCleaningSteps(steps.steps || []);
        invalidateProject(sessionId);
        return result;
      } catch (err) {
        _setErr(err);
        throw err;
      } finally {
        setIsLoading(false);
      }
    },
    [sessionId, _applyCleanResult, refreshProfile],
  );

  const getCleaningSteps = useCallback(async () => {
    if (!sessionId) return [];
    try {
      const r = await ApiService.getCleaningSteps(sessionId);
      setCleaningSteps(r.steps || []);
      return r.steps || [];
    } catch (err) {
      _setErr(err);
      return [];
    }
  }, [sessionId]);

  // ── VISUALIZATION ─────────────────────────────────────────────────────────

  const visualize = useCallback(
    async (params) => {
      if (!sessionId) return null;
      setIsLoading(true);
      setError(null);
      try {
        const result = await ApiService.visualize(sessionId, params);
        setLastChartData(result.chart);
        return result.chart;
      } catch (err) {
        _setErr(err);
        throw err;
      } finally {
        setIsLoading(false);
      }
    },
    [sessionId],
  );

  const loadVizColumns = useCallback(async () => {
    if (!sessionId) return [];
    try {
      const r = await ApiService.getVisualizableColumns(sessionId);
      setVizColumns(r.columns || []);
      return r.columns || [];
    } catch (err) {
      _setErr(err);
      return [];
    }
  }, [sessionId]);

  // ── Export ────────────────────────────────────────────────────────────────

  const downloadCsv = useCallback(() => {
    if (!sessionId) return;
    window.open(ApiService.exportCsv(sessionId), "_blank");
  }, [sessionId]);

  const downloadExcel = useCallback(() => {
    if (!sessionId) return;
    window.open(ApiService.exportExcel(sessionId), "_blank");
  }, [sessionId]);

  // ── Return API ────────────────────────────────────────────────────────────

  return {
    // ── State
    sessionId,
    filename,
    profile,
    selectedColumn,
    selectedColumnDetails,
    highlightMode,
    isLoading,
    uploadPhase,
    error,
    pendingChanges,
    changeCount,
    cleaningSteps,
    vizColumns,
    lastChartData,
    cleaningResult,

    // ── Profile actions
    uploadFile,
    loadSession,
    selectColumn,
    setHighlightMode,
    updateCell,
    batchUpdateCells,
    updateColumnType,
    getColumnValues,
    saveChanges,
    resetChanges,
    getChangesLog,
    refreshProfile,

    // ── Cleaning actions
    imputeColumn,
    batchImpute,
    handleDuplicates,
    handleOutliers,
    batchOutliers,
    handleTypeInconsistencies,
    getCleaningSteps,

    // ── Visualization actions
    visualize,
    loadVizColumns,

    // ── Export
    downloadCsv,
    downloadExcel,
  };
};
