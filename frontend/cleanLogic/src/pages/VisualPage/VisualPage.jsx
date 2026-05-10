import React, { useEffect, useMemo, useState } from "react";
import {
  BarChart3,
  Database,
  TrendingUp,
  Activity,
  Cpu,
  Eye,
  Search,
  Grid,
  Sparkles,
  FileText,
  Pencil,
  X,
  Trash2,
} from "lucide-react";
import AppHeader from "../../components/common/AppHeader";
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  LineChart,
  Line,
  ScatterChart,
  Scatter,
  PieChart,
  Pie,
  Cell,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  Legend,
  Brush,
} from "recharts";
import { useNavigate } from "react-router-dom";

import { useDataProfiler } from "../../components/hooks/useDataProfiler";
import ApiService from "../../services/api";
import { getProject, getVizList, invalidateVizList } from "../../cache/sessionCache";
import { captureChartAsBase64 } from "../../utils/captureChart";
import { buildChartContext } from "../../utils/buildChartContext";


const formatActionLabel = (change) => {
  const action = change.action || "";
  if (change.type === "missing_value") {
    if (action === "fill_mean") return "Mean Imputation";
    if (action === "fill_median") return "Median Imputation";
    if (action === "fill_mode") return "Mode Imputation";
    if (action === "forward_fill") return "Forward Fill";
    if (action === "backward_fill") return "Backward Fill";
    if (action === "fill_constant") return "Constant Fill";
  }
  if (change.type === "duplicates") {
    if (action === "remove_all") return "Remove All";
    if (action === "keep_first") return "Keep First";
    if (action === "keep_last") return "Keep Last";
    if (action === "mark_only") return "Mark Only";
  }
  if (change.type === "outlier") {
    const method = (change.method || "").toUpperCase();
    const outAction = action ? ` · ${action}` : "";
    return `${method || "Outlier"}${outAction}`;
  }
  if (change.type === "cell_update") return "Cell Update";
  if (change.type === "type_conversion") return "Type Conversion";
  return action || "Update";
};

const DataVisualizationDashboard = () => {
  const [changes, setChanges] = useState([]);
  const [changesLoading, setChangesLoading] = useState(false);
  const [changesError, setChangesError] = useState(null);
  const [projectSteps, setProjectSteps] = useState([]);
  const [projectStepsLoading, setProjectStepsLoading] = useState(false);
  const [vizRules, setVizRules] = useState([]);
  const [serverVisualizations, setServerVisualizations] = useState([]);
  const [serverVizLoading, setServerVizLoading] = useState(false);
  const [serverVizError, setServerVizError] = useState(null);
  const [aiQuery, setAiQuery] = useState("");
  const [aiResponse, setAiResponse] = useState("");
  const [aiLoading, setAiLoading] = useState(false);
  const [aiError, setAiError] = useState(null);
  const [changeLog, setChangeLog] = useState([]);
  const [preprocessingConfig, setPreprocessingConfig] = useState(null);
  const [previewQuery, setPreviewQuery] = useState("");
  const [tableRows, setTableRows] = useState([]);
  const [tableColumns, setTableColumns] = useState([]);
  const [tableTotal, setTableTotal] = useState(0);
  const [tableOffset, setTableOffset] = useState(0);
  const [tableLoading, setTableLoading] = useState(false);
  const [tableHasMore, setTableHasMore] = useState(false);
  const [tableScrollTop, setTableScrollTop] = useState(0);
  const [tableViewportHeight, setTableViewportHeight] = useState(0);
  const [showErrorsOnly, setShowErrorsOnly] = useState(false);
  const tableViewportRef = React.useRef(null);
  const tableRequestIdRef = React.useRef(0);
  const tableScrollRafRef = React.useRef(null);
  const tableScrollTopRef = React.useRef(0);
  const tableViewportHeightRef = React.useRef(0);
  // ── Auto-viz + chart builder + AI insights ─────────────────────────────────
  const MAX_BUILDER_SLOTS = 6;

  // Multi-slot chart builder
  const makeSlot = (id) => ({ id, type: "bar", xCol: "", yCol: "", minFilter: "", maxFilter: "", title: "", result: null, saving: false });
  const [builderSlots, setBuilderSlots] = useState([makeSlot(Date.now())]);
  const updateSlot = (id, patch) => setBuilderSlots((prev) => prev.map((s) => s.id === id ? { ...s, ...patch } : s));

  // Saved custom charts from backend
  const [savedCharts, setSavedCharts] = useState([]);
  const [savedChartsLoading, setSavedChartsLoading] = useState(false);

  const [aiInsights, setAiInsights] = useState([]);
  const [aiInsightsLoading, setAiInsightsLoading] = useState(false);
  const [aiInsightsFetched, setAiInsightsFetched] = useState(() => {
    try {
      const sid = localStorage.getItem("cleanlogic_session_id");
      if (!sid) return false;
      const stored = localStorage.getItem(`cleanlogic_viz_insights_${sid}`);
      if (stored) {
        const insights = JSON.parse(stored);
        return Array.isArray(insights) && insights.length > 0;
      }
    } catch {}
    return false;
  });

  const [allCharts, setAllCharts] = useState([]);
  const [chartRecsLoading, setChartRecsLoading] = useState(false);
  const [chartRecsFetched, setChartRecsFetched] = useState(() => {
    try {
      const sid = localStorage.getItem("cleanlogic_session_id");
      if (!sid) return false;
      const stored = localStorage.getItem(`cleanlogic_viz_charts_${sid}`);
      if (stored) {
        const charts = JSON.parse(stored);
        return Array.isArray(charts) && charts.length > 0;
      }
    } catch {}
    return false;
  });
  const chartRecsLoadingRef = React.useRef(false);
  const [editingChartId, setEditingChartId] = useState(null);
  const [editDraft, setEditDraft] = useState({});
  const [crossFilter, setCrossFilter] = useState(null); // { column, value } | null
  const [drillRows, setDrillRows] = useState(null);     // { title, rows } | null
  const [chartDataCache, setChartDataCache] = React.useState({});
  const chartFetchingRef = React.useRef(new Set());
  const [sharedBrushRange, setSharedBrushRange] = useState({ startIndex: 0, endIndex: undefined });
  // Per-chart "Analyze with AI" state (keyed by chart.id):
  //   chartInsights[id] = { text, note, error, loading }
  const chartBodyRefs = React.useRef({});
  const [chartInsights, setChartInsights] = useState({});
  const navigate = useNavigate();
  const { profile, filename, sessionId, isLoading, highlightMode } =
    useDataProfiler();
  // Track whether the initial session restore has completed
  const [sessionChecked, setSessionChecked] = useState(false);
  useEffect(() => {
    if (!isLoading) setSessionChecked(true);
  }, [isLoading]);

  // Load applied project steps (from addProjectStep on ProfilingPage)
  useEffect(() => {
    if (!sessionId) return;
    setProjectStepsLoading(true);
    getProject(sessionId)
      .then((result) => {
        setProjectSteps(Array.isArray(result?.steps) ? result.steps : []);
      })
      .catch(() => setProjectSteps([]))
      .finally(() => setProjectStepsLoading(false));
  }, [sessionId]);

  useEffect(() => {
    const load = async () => {
      if (!sessionId) return;
      setChangesLoading(true);
      setChangesError(null);
      try {
        const response = await ApiService.getChangesLog(sessionId);
        setChanges(response.changes || []);
      } catch (e) {
        setChangesError(e?.message || "Failed to load log");
      } finally {
        setChangesLoading(false);
      }
    };
    load();
  }, [sessionId]);

  useEffect(() => {
    if (!sessionId) return;
    ApiService.getChangesLog(sessionId)
      .then((result) => setChangeLog(result?.changes || []))
      .catch(() => setChangeLog([]));
  }, [sessionId]);


  useEffect(() => {
    try {
      const stored = localStorage.getItem("cleanlogic_viz_rules");
      const parsed = stored ? JSON.parse(stored) : [];
      const normalized = parsed.map((rule) => ({
        id: rule.id,
        vizType: rule.vizType,
        column: rule.column || "",
        yColumn: rule.yColumn || "",
        selectedCols: Array.isArray(rule.selectedCols) ? rule.selectedCols : [],
      }));
      setVizRules(normalized);
    } catch {
      setVizRules([]);
    }
  }, []);

  const normalizedVizRules = useMemo(
    () =>
      vizRules
        .map((rule) => ({
          vizType: rule.vizType || "",
          column: rule.column || "",
          yColumn: rule.yColumn || "",
          selectedCols: (rule.selectedCols || []).slice().sort(),
        }))
        .sort((a, b) =>
          `${a.vizType}-${a.column}-${a.yColumn}-${a.selectedCols.join(",")}`.localeCompare(
            `${b.vizType}-${b.column}-${b.yColumn}-${b.selectedCols.join(",")}`,
          ),
        ),
    [vizRules],
  );

  useEffect(() => {
    if (!sessionId) return;
    let active = true;
    const syncVisualizations = async () => {
      setServerVizLoading(true);
      setServerVizError(null);
      try {
        const hashKey = `cleanlogic_viz_rules_hash_${sessionId}`;
        const idsKey = `cleanlogic_viz_ids_${sessionId}`;
        const currentHash = JSON.stringify(normalizedVizRules);
        const storedHash = localStorage.getItem(hashKey);
        let storedIds = [];
        try {
          storedIds = JSON.parse(localStorage.getItem(idsKey) || "[]");
        } catch {
          storedIds = [];
        }
        if (vizRules.length > 0 && storedHash !== currentHash) {
          const payloads = [];
          vizRules.forEach((rule) => {
            const type = rule.vizType || "bar";
            if (type === "card") return;
            if (type === "pie") {
              (rule.selectedCols || []).forEach((col) => {
                if (!col) return;
                payloads.push({
                  chart_type: "pie",
                  x_column: col,
                  chart_title: `${col} distribution`,
                });
              });
              return;
            }
            if (type === "histogram") {
              if (!rule.column) return;
              payloads.push({
                chart_type: "histogram",
                x_column: rule.column,
                chart_title: `${rule.column} histogram`,
              });
              return;
            }
            if (["bar", "line", "scatter"].includes(type)) {
              if (!rule.column || !rule.yColumn) return;
              payloads.push({
                chart_type: type,
                x_column: rule.column,
                y_column: rule.yColumn,
                chart_title: `${rule.yColumn} by ${rule.column}`,
              });
            }
          });
          const createdIds = [];
          for (const payload of payloads) {
            const result = await ApiService.saveVisualization(
              sessionId,
              payload,
            );
            if (result?.viz_id) createdIds.push(result.viz_id);
          }
          localStorage.setItem(hashKey, currentHash);
          localStorage.setItem(idsKey, JSON.stringify(createdIds));
          storedIds = createdIds;
          invalidateVizList(sessionId);
        }
        const list = await ApiService.listVisualizations(sessionId);
        const visualizations = list?.visualizations || [];
        const filtered =
          storedIds.length > 0
            ? visualizations.filter((viz) => storedIds.includes(viz.id))
            : visualizations;
        if (active) {
          setServerVisualizations(filtered);
        }
      } catch (e) {
        if (active) {
          setServerVizError(e?.message || "Failed to sync visualizations");
        }
      } finally {
        if (active) {
          setServerVizLoading(false);
        }
      }
    };
    syncVisualizations();
    return () => {
      active = false;
    };
  }, [sessionId, vizRules, normalizedVizRules]);

  const stats = useMemo(() => {
    if (!profile) return { rows: 0, cols: 0, issues: 0 };
    const issuesSummary = profile.issues_summary || {};
    const issues =
      issuesSummary.total_issues ??
      (issuesSummary.missing || 0) +
        (issuesSummary.outliers || 0) +
        (issuesSummary.type_inconsistencies || 0);
    return {
      rows: profile.metadata?.total_rows || 0,
      cols: profile.metadata?.total_columns || 0,
      issues,
    };
  }, [profile]);

  const previewRows = useMemo(() => {
    const dataArray = profile?.data?.data || profile?.data || [];
    return Array.isArray(dataArray) ? dataArray : [];
  }, [profile]);

  const getCellValue = (row, col) => {
    if (!row || col == null) return undefined;
    // 1. Exact match
    let cell = row[col];
    if (cell === undefined) {
      const keys = Object.keys(row);
      const colLower = col.toLowerCase();
      // 2. Case-insensitive exact match
      let key = keys.find((k) => k.toLowerCase() === colLower);
      // 3. Row key is a prefix of the requested col ("GENERAL APPEARANCE" → "GENERAL APPEARANCE Score")
      if (!key) key = keys.find((k) => colLower.startsWith(k.toLowerCase() + " ") || colLower.startsWith(k.toLowerCase() + "_"));
      // 4. Requested col is a prefix of the row key ("GENERAL APPEARANCE Score" → "GENERAL APPEARANCE")
      if (!key) key = keys.find((k) => k.toLowerCase().startsWith(colLower + " ") || k.toLowerCase().startsWith(colLower + "_"));
      // 5. Substring containment (last resort)
      if (!key) key = keys.find((k) => k.toLowerCase().includes(colLower) || colLower.includes(k.toLowerCase()));
      cell = key !== undefined ? row[key] : undefined;
    }
    if (cell && typeof cell === "object") {
      return cell.display_value ?? cell.value;
    }
    return cell;
  };

  const getCellIssues = (rowIndex, columnName) => {
    const col = profile?.columns?.find((c) => c.name === columnName);
    if (!col) return [];
    const issues = [];
    if (col.missing_indices?.includes(rowIndex))
      issues.push({ type: "missing", severity: "high" });
    if (col.outlier_indices?.includes(rowIndex))
      issues.push({ type: "outlier", severity: "medium" });
    if (col.type_inconsistency_indices?.includes(rowIndex))
      issues.push({ type: "type_inconsistency", severity: "medium" });
    return issues;
  };

  const getCellClassName = (issues) => {
    if (!issues || issues.length === 0) return "text-[#1F2937]";
    if (issues.some((i) => i.type === "missing"))
      return "px-2 py-0.5 bg-[#FB2C36]/20 rounded text-sm text-[#FF6467] font-medium";
    if (issues.some((i) => i.type === "type_inconsistency"))
      return "px-2 py-0.5 bg-[#AD46FF]/20 rounded text-sm text-[#C27AFF] font-medium";
    if (issues.some((i) => i.type === "outlier"))
      return "px-2 py-0.5 bg-[#F0B000]/20 rounded text-sm text-[#F0B000] font-medium";
    return "text-[#1F2937]";
  };

  const formatTableValue = (value) => {
    if (value === null || value === undefined || value === "") return value;
    if (typeof value === "number" && Number.isFinite(value)) {
      return Number.isInteger(value) ? value : value.toFixed(1);
    }
    if (typeof value === "string") {
      const normalized = value.trim();
      if (/^-?\d+(\.\d+)?$/.test(normalized)) {
        const numeric = Number(normalized);
        if (Number.isFinite(numeric) && !Number.isInteger(numeric)) {
          return numeric.toFixed(1);
        }
      }
    }
    return value;
  };

  const getCellContent = (value, issues) => {
    if (issues.some((i) => i.type === "missing")) return "Empty";
    const hasTypeError = issues.some((i) => i.type === "type_inconsistency");
    const hasOutlier = issues.some((i) => i.type === "outlier");
    if (hasTypeError && hasOutlier) return `${value} ⚠️🔢`;
    if (hasTypeError) return `${value} ⚠️`;
    if (hasOutlier) return `${value} 🔢`;
    return value;
  };

  const shouldHighlightCell = (issues) => {
    if (highlightMode === "none") return false;
    if (highlightMode === "all") return issues.length > 0;
    return issues.some((i) => i.type === highlightMode);
  };

  const toNumber = (value) => {
    if (value === null || value === undefined || value === "") return null;
    const num = Number(value);
    return Number.isFinite(num) ? num : null;
  };

  const chartPalette = [
    "#3B82F6",
    "#8B5CF6",
    "#10B981",
    "#F59E0B",
    "#EF4444",
    "#06B6D4",
    "#6366F1",
    "#EC4899",
  ];

  const generatedCharts = useMemo(() => {
    if (!vizRules.length) return [];
    return vizRules.map((rule) => {
      const type = rule.vizType || "bar";
      if (type === "card") {
        const col = rule.column || "";
        const count = col
          ? previewRows.filter((row) => {
              const v = getCellValue(row, col);
              return v !== null && v !== undefined && v !== "";
            }).length
          : stats.rows;
        return {
          id: rule.id,
          vizType: type,
          kind: "card",
          value: count,
          label: col || "Total Records",
        };
      }
      if (type === "pie") {
        const cols = rule.selectedCols || [];
        if (cols.length === 0) {
          return {
            id: rule.id,
            vizType: type,
            kind: "error",
            error: "Select columns for the pie chart",
          };
        }
        const pies = cols.map((col) => {
          const counts = new Map();
          previewRows.forEach((row) => {
            const v = getCellValue(row, col);
            const key =
              v === null || v === undefined || v === "" ? "Missing" : String(v);
            counts.set(key, (counts.get(key) || 0) + 1);
          });
          const data = Array.from(counts.entries()).map(([name, value]) => ({
            name,
            value,
          }));
          return { column: col, data };
        });
        return { id: rule.id, vizType: type, kind: "pie", pies };
      }
      const x = rule.column || "";
      const y = rule.yColumn || "";
      const needsY = ["bar", "line", "scatter"].includes(type);
      if (!x || (needsY && !y)) {
        return {
          id: rule.id,
          vizType: type,
          kind: "error",
          error: "Select required axis columns",
        };
      }
      if (type === "histogram") {
        const nums = previewRows
          .map((row) => toNumber(getCellValue(row, x)))
          .filter((v) => v !== null);
        if (!nums.length) {
          return {
            id: rule.id,
            vizType: type,
            kind: "error",
            error: "Histogram requires numeric data",
          };
        }
        const min = Math.min(...nums);
        const max = Math.max(...nums);
        const bins = 8;
        const size = (max - min) / bins || 1;
        const buckets = Array.from({ length: bins }).map((_, i) => ({
          name: `${(min + size * i).toFixed(1)}-${(min + size * (i + 1)).toFixed(1)}`,
          value: 0,
        }));
        nums.forEach((v) => {
          const idx = Math.min(
            bins - 1,
            Math.max(0, Math.floor((v - min) / size)),
          );
          buckets[idx].value += 1;
        });
        return { id: rule.id, vizType: type, kind: "histogram", data: buckets };
      }
      if (type === "scatter") {
        const data = previewRows
          .map((row) => ({
            x: toNumber(getCellValue(row, x)),
            y: toNumber(getCellValue(row, y)),
          }))
          .filter((row) => row.x !== null && row.y !== null);
        if (!data.length) {
          return {
            id: rule.id,
            vizType: type,
            kind: "error",
            error: "Scatter requires numeric X and Y",
          };
        }
        return { id: rule.id, vizType: type, kind: "scatter", data };
      }
      const groups = new Map();
      previewRows.forEach((row) => {
        const keyRaw = getCellValue(row, x);
        const key =
          keyRaw === null || keyRaw === undefined || keyRaw === ""
            ? "Missing"
            : String(keyRaw);
        const val = toNumber(getCellValue(row, y));
        if (val === null) return;
        const current = groups.get(key) || { sum: 0, count: 0 };
        current.sum += val;
        current.count += 1;
        groups.set(key, current);
      });
      const data = Array.from(groups.entries()).map(([name, agg]) => ({
        name,
        value: agg.count ? agg.sum / agg.count : 0,
      }));
      if (!data.length) {
        return {
          id: rule.id,
          vizType: type,
          kind: "error",
          error: "No numeric values for the selected axes",
        };
      }
      return { id: rule.id, vizType: type, kind: "series", data };
    });
  }, [previewRows, stats.rows, vizRules]);

  const explainContext = useMemo(() => {
    const selectedColumns = Array.from(
      new Set(
        vizRules.flatMap((rule) => {
          if (rule.vizType === "pie") return rule.selectedCols || [];
          return [rule.column, rule.yColumn].filter(Boolean);
        }),
      ),
    );
    const allColumns =
      tableColumns.length > 0
        ? tableColumns
        : (profile?.columns || []).map((col) => col.name);
    const columnsForRowSamples = allColumns.slice(0, 30);
    const columnStatsMap = new Map(
      (profile?.columns || []).map((col) => [col.name, col]),
    );
    const selectedStats = selectedColumns
      .map((name) => columnStatsMap.get(name))
      .filter(Boolean)
      .map((col) => ({
        name: col.name,
        type: col.data_type || col.type,
        missing_count: col.missing_count,
        unique_count: col.unique_count,
        outlier_count: col.outlier_count,
        min: col.min,
        max: col.max,
        mean: col.mean,
        median: col.median,
        q1: col.q1,
        q3: col.q3,
      }));
    const datasetColumnStats = allColumns
      .map((name) => columnStatsMap.get(name))
      .filter(Boolean)
      .map((col) => ({
        name: col.name,
        type: col.data_type || col.type,
        missing_count: col.missing_count,
        unique_count: col.unique_count,
        outlier_count: col.outlier_count,
      }));
    const sampleSource = tableRows.length > 0 ? tableRows : previewRows;
    const sampleRows = sampleSource.slice(0, 20).map((row) => {
      const filtered = {};
      columnsForRowSamples.forEach((col) => {
        filtered[col] = getCellValue(row, col);
      });
      return filtered;
    });
    const focusedSampleRows = sampleSource.slice(0, 20).map((row) => {
      const filtered = {};
      const columns = selectedColumns.length
        ? selectedColumns
        : columnsForRowSamples;
      columns.forEach((col) => {
        filtered[col] = getCellValue(row, col);
      });
      return filtered;
    });
    const visualizationColumnsByType = vizRules.map((rule) => {
      const vizType = rule.vizType || "bar";
      const columnsUsed =
        vizType === "pie"
          ? (rule.selectedCols || []).filter(Boolean)
          : [rule.column, rule.yColumn].filter(Boolean);
      return { viz_type: vizType, columns_used: columnsUsed };
    });
    const generatedChartSummaries = generatedCharts.slice(0, 12).map((chart) => {
      if (chart.kind === "card") {
        return {
          viz_type: chart.vizType,
          kind: chart.kind,
          label: chart.label,
          value: chart.value,
        };
      }
      if (chart.kind === "pie") {
        return {
          viz_type: chart.vizType,
          kind: chart.kind,
          pies: (chart.pies || []).map((pie) => ({
            column: pie.column,
            data: (pie.data || []).slice(0, 8),
          })),
        };
      }
      if (chart.kind === "scatter") {
        return {
          viz_type: chart.vizType,
          kind: chart.kind,
          data: (chart.data || []).slice(0, 80),
        };
      }
      if (chart.kind === "series" || chart.kind === "histogram") {
        return {
          viz_type: chart.vizType,
          kind: chart.kind,
          data: (chart.data || []).slice(0, 40),
        };
      }
      return {
        viz_type: chart.vizType,
        kind: chart.kind,
        error: chart.error || null,
      };
    });
    return {
      dataset: {
        filename,
        rows: stats.rows,
        columns: stats.cols,
      },
      dataset_columns: allColumns,
      dataset_column_stats: datasetColumnStats,
      dataset_sample_rows: sampleRows,
      selected_columns: selectedColumns,
      selected_column_stats: selectedStats,
      selected_sample_rows: focusedSampleRows,
      visualization_columns_by_type: visualizationColumnsByType,
      visualization_rules: vizRules,
      generated_charts: generatedChartSummaries,
      preprocessing: preprocessingConfig,
      cleaning_steps: changeLog.slice(-12),
    };
  }, [
    vizRules,
    generatedCharts,
    filename,
    stats.rows,
    stats.cols,
    profile,
    preprocessingConfig,
    changeLog,
    previewRows,
    tableRows,
    tableColumns,
  ]);

  const handleAiExplain = async (promptOverride) => {
    if (aiLoading) return;
    setAiLoading(true);
    setAiError(null);
    try {
      const prompt =
        promptOverride ||
        aiQuery ||
        "Explain the key insights from these visualizations.";
      const result = await ApiService.explainVisualization({
        prompt,
        context: explainContext,
      });
      setAiResponse(result?.text || "No response received.");
      setAiQuery(prompt);
    } catch (e) {
      setAiError(e?.message || "Failed to get AI response");
    } finally {
      setAiLoading(false);
    }
  };

  // ── Per-chart "Analyze with AI" (Gemini vision) ────────────────────────────
  // Build a compact list of applied cleaning steps, prefer projectSteps (has
  // column info), fall back to changeLog. Backend filters by column anyway.
  const appliedStepsCompact = useMemo(() => {
    const source = (projectSteps?.length ? projectSteps : changeLog) || [];
    return source
      .map((s) => ({
        type: s?.type || "unknown",
        column: s?.column || s?.col_name || null,
        description: formatActionLabel(s || {}) || s?.action || s?.type || "Update",
      }))
      .slice(-20);
  }, [projectSteps, changeLog]);

  const handleAnalyzeChart = React.useCallback(
    async (chart) => {
      if (!chart) return;
      const chartId = chart.id;
      setChartInsights((prev) => ({
        ...prev,
        [chartId]: { ...(prev[chartId] || {}), loading: true, error: null },
      }));
      try {
        const ref = { current: chartBodyRefs.current[chartId] };
        if (!ref.current) throw new Error("Chart is still rendering — try again in a moment.");
        // Give recharts one extra paint tick so getBoundingClientRect returns real pixels.
        await new Promise((r) => requestAnimationFrame(() => r()));
        const imageBase64 = await captureChartAsBase64(ref);
        const payload = {
          image_base64: imageBase64,
          ...buildChartContext(
            profile,
            chart.chart_type,
            chart.x_axis,
            chart.y_axis,
            appliedStepsCompact,
            chart.title || null,
          ),
        };
        const result = await ApiService.analyzeChart(payload);
        setChartInsights((prev) => ({
          ...prev,
          [chartId]: {
            loading: false,
            text: result?.insight || "No insight returned.",
            note: result?.note || null,
            error: null,
          },
        }));
      } catch (err) {
        setChartInsights((prev) => ({
          ...prev,
          [chartId]: {
            ...(prev[chartId] || {}),
            loading: false,
            error: err?.response?.data?.detail || err?.message || "Analysis failed",
          },
        }));
      }
    },
    [profile, appliedStepsCompact],
  );

  const previewColumns = useMemo(() => {
    if (profile?.data?.columns) return profile.data.columns;
    if (profile?.columns) return profile.columns.map((c) => c.name);
    return [];
  }, [profile]);

  const tablePageSize = 20;

  const loadTablePage = React.useCallback(
    async (nextOffset = 0, append = false) => {
      if (!sessionId) return;
      const requestId = ++tableRequestIdRef.current;
      if (!append && nextOffset === 0) {
        setTableScrollTop(0);
        if (tableViewportRef.current) {
          tableViewportRef.current.scrollTop = 0;
        }
      }
      setTableLoading(true);
      try {
        const result = await ApiService.getPreviewRows(sessionId, {
          limit: tablePageSize,
          offset: nextOffset,
          search: previewQuery,
          errors_only: showErrorsOnly,
        });
        if (requestId !== tableRequestIdRef.current) return;
        const rows = result.rows || [];
        const cols = result.columns || [];
        setTableColumns(cols);
        setTableTotal(result.total || 0);
        setTableHasMore(Boolean(result.has_more));
        setTableOffset(nextOffset);
        setTableRows((prev) => (append ? [...prev, ...rows] : rows));
      } catch {
        if (requestId !== tableRequestIdRef.current) return;
        setTableRows([]);
        setTableHasMore(false);
        setTableTotal(0);
        setTableOffset(0);
      } finally {
        if (requestId === tableRequestIdRef.current) {
          setTableLoading(false);
        }
      }
    },
    [sessionId, tablePageSize, previewQuery, showErrorsOnly],
  );

  useEffect(() => {
    loadTablePage(0, false);
  }, [loadTablePage]);

  useEffect(() => {
    const updateHeight = () => {
      if (tableViewportRef.current) {
        setTableViewportHeight(tableViewportRef.current.clientHeight);
      }
    };
    updateHeight();
    window.addEventListener("resize", updateHeight);
    return () => window.removeEventListener("resize", updateHeight);
  }, []);

  useEffect(() => {
    if (tableLoading || !tableHasMore) return;
    const viewport = tableViewportRef.current;
    if (!viewport) return;
    if (viewport.scrollHeight <= viewport.clientHeight + 8) {
      loadTablePage(tableOffset + tablePageSize, true);
    }
  }, [
    tableLoading,
    tableHasMore,
    tableOffset,
    tablePageSize,
    loadTablePage,
    tableRows.length,
  ]);

  const handleTableScroll = React.useCallback(
    (e) => {
      const target = e.currentTarget;
      tableScrollTopRef.current = target.scrollTop;
      if (tableViewportHeightRef.current !== target.clientHeight) {
        tableViewportHeightRef.current = target.clientHeight;
        setTableViewportHeight(target.clientHeight);
      }
      if (!tableScrollRafRef.current) {
        tableScrollRafRef.current = requestAnimationFrame(() => {
          tableScrollRafRef.current = null;
          setTableScrollTop(tableScrollTopRef.current);
        });
      }
      if (tableLoading || !tableHasMore) return;
      const remaining =
        target.scrollHeight - target.scrollTop - target.clientHeight;
      if (remaining < 80) {
        loadTablePage(tableOffset + tablePageSize, true);
      }
    },
    [tableLoading, tableHasMore, tableOffset, tablePageSize, loadTablePage],
  );

  const columnStats = useMemo(() => {
    if (!profile?.columns) return [];
    return profile.columns.map((col) => {
      const completeness =
        col.completeness ??
        (col.total_count ? (col.non_null_count / col.total_count) * 100 : 0);
      return {
        name: col.name,
        type: col.data_type || col.type,
        completeness,
        missingCount: col.missing_count || 0,
      };
    });
  }, [profile]);

  const typeDistribution = useMemo(() => {
    const dist = profile?.type_distribution || {};
    return Object.entries(dist)
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count);
  }, [profile]);

  // ── Auto-generated charts from profile metadata (no raw data needed) ───────
  const autoViz = useMemo(() => {
    if (!profile?.columns) return [];
    const charts = [];
    for (const col of profile.columns) {
      const name = col.name;
      const dtype = (col.data_type || col.type || "").toLowerCase();
      const isNumeric = ["integer", "decimal", "float", "numeric"].some((t) => dtype.includes(t));
      const isCategorical = !isNumeric;
      const dist = col.value_distribution || {};

      if (isNumeric) {
        // Histogram from value_distribution (already binned by profiler)
        const distEntries = Object.entries(dist)
          .filter(([, v]) => typeof v === "number")
          .sort((a, b) => parseFloat(a[0]) - parseFloat(b[0]))
          .slice(0, 15);
        if (distEntries.length > 0) {
          charts.push({
            id: `auto_hist_${name}`, column: name, chart_type: "histogram",
            title: `${name} — distribution`,
            data: distEntries.map(([k, v]) => ({ name: k, value: v })),
            summary: { min: col.min, max: col.max, mean: col.mean, median: col.median, missing_pct: col.missing_count ? Math.round(col.missing_count / (col.total_count || 1) * 100) : 0 },
          });
        }
        // Boxplot summary (from Q1/Q3/median stats)
        if (col.q1 != null && col.q3 != null && col.median != null) {
          charts.push({
            id: `auto_box_${name}`, column: name, chart_type: "boxplot",
            title: `${name} — spread`,
            data: [
              { name: "Min", value: col.min ?? col.q1 },
              { name: "Q1", value: col.q1 },
              { name: "Median", value: col.median },
              { name: "Q3", value: col.q3 },
              { name: "Max", value: col.max ?? col.q3 },
            ],
            summary: { q1: col.q1, median: col.median, q3: col.q3, outliers: col.outlier_count || 0 },
          });
        }
      } else {
        // Bar chart from top categories
        const entries = Object.entries(dist)
          .filter(([, v]) => typeof v === "number")
          .sort((a, b) => b[1] - a[1])
          .slice(0, 10);
        if (entries.length > 0) {
          charts.push({
            id: `auto_bar_${name}`, column: name, chart_type: "bar",
            title: `${name} — top values`,
            data: entries.map(([k, v]) => ({ name: k || "(blank)", value: v })),
            summary: { unique: col.unique_count || 0, missing_pct: col.missing_count ? Math.round(col.missing_count / (col.total_count || 1) * 100) : 0 },
          });
        }
      }
    }
    return charts;
  }, [profile]);

  // ── Custom chart builder (multi-slot) ────────────────────────────────────
  const buildSlotChart = React.useCallback(async (slotId) => {
    const slot = builderSlots.find((s) => s.id === slotId);
    if (!slot || !slot.xCol) return;
    const { type, xCol, yCol } = slot;

    if (!["pie", "histogram", "scatter"].includes(type) && !yCol) {
      updateSlot(slotId, { result: { error: "Select a Y-axis column" } });
      return;
    }

    const autoTitle = type === "pie" || type === "histogram"
      ? `${xCol} — ${type}`
      : `${yCol || xCol} by ${xCol}`;

    const chartId = `user_${Date.now()}`;
    const newChart = {
      id: chartId,
      chart_type: type,
      title: slot.title || autoTitle,
      x_axis: xCol,
      y_axis: yCol || null,
      aggregation: ["scatter", "histogram", "pie"].includes(type) ? null : "avg",
      reasoning: "Generating insight…",
      confidence: null,
      isUserChart: true,
    };

    setAllCharts((prev) => [...prev, newChart]);
    updateSlot(slotId, { result: { added: true } });
    document.getElementById("ai-charts-section")?.scrollIntoView({ behavior: "smooth" });

    try {
      const insightResult = await ApiService.getChartInsight(sessionId, {
        chart_type: type,
        x_axis: xCol,
        y_axis: yCol || null,
        title: slot.title || autoTitle,
      });
      if (insightResult?.insight) {
        setAllCharts((prev) =>
          prev.map((c) => c.id === chartId ? { ...c, reasoning: insightResult.insight } : c)
        );
      } else {
        setAllCharts((prev) =>
          prev.map((c) => c.id === chartId ? { ...c, reasoning: null } : c)
        );
      }
    } catch {
      setAllCharts((prev) =>
        prev.map((c) => c.id === chartId ? { ...c, reasoning: null } : c)
      );
    }
  }, [builderSlots, sessionId]);

  // ── Load / reload saved custom charts ────────────────────────────────────
  const loadSavedCharts = React.useCallback(async () => {
    if (!sessionId) return;
    setSavedChartsLoading(true);
    try {
      const list = await getVizList(sessionId);
      const all = list?.visualizations || [];
      setSavedCharts(all.filter((v) => v.chart_config?.is_custom));
    } catch {
      setSavedCharts([]);
    } finally {
      setSavedChartsLoading(false);
    }
  }, [sessionId]);

  React.useEffect(() => { loadSavedCharts(); }, [loadSavedCharts]);


  const deleteSavedChart = React.useCallback(async (vizId) => {
    try {
      await ApiService.deleteVisualization(vizId);
      invalidateVizList(sessionId);
      setSavedCharts((prev) => prev.filter((c) => c.id !== vizId));
    } catch { /* ignore */ }
  }, [sessionId]);

  // ── AI insights fetch ──────────────────────────────────────────────────────
  const fetchVizInsights = React.useCallback(async () => {
    if (!sessionId || aiInsightsFetched) return;
    setAiInsightsLoading(true);
    try {
      const result = await ApiService.getVizInsights(sessionId);
      setAiInsights(result.insights || []);
      setAiInsightsFetched(true);
    } catch {
      setAiInsights([]);
    } finally {
      setAiInsightsLoading(false);
    }
  }, [sessionId, aiInsightsFetched]);

  const fetchChartRecs = React.useCallback(async () => {
    if (!sessionId || chartRecsLoadingRef.current) return;
    chartRecsLoadingRef.current = true;
    setChartRecsLoading(true);
    try {
      const result = await ApiService.getChartRecommendations(sessionId);
      const recs = result.recommendations || [];
      const aiCharts = recs.map((rec, i) => ({
        ...rec,
        id: `ai_${i}_${Date.now()}`,
        isUserChart: false,
      }));
      setAllCharts((prev) => [...aiCharts, ...prev.filter((c) => c.isUserChart)]);
      setChartRecsFetched(true);
    } catch {
      setAllCharts((prev) => prev.filter((c) => c.isUserChart));
      setChartRecsFetched(true);
    } finally {
      chartRecsLoadingRef.current = false;
      setChartRecsLoading(false);
    }
  }, [sessionId]);

  // Auto-fetch chart recommendations once per session mount
  useEffect(() => {
    if (sessionId && profile && !chartRecsFetched) {
      fetchChartRecs();
    }
  }, [sessionId, profile, chartRecsFetched, fetchChartRecs]);

  // Build a stable cache key for a chart + optional cross-filter
  const chartCacheKey = React.useCallback((chart, filter) =>
    JSON.stringify({
      t: chart.chart_type, x: chart.x_axis, y: chart.y_axis,
      a: chart.aggregation, fc: filter?.column ?? null, fv: filter?.value ?? null,
    }), []);

  // Invalidate chart data cache when the underlying dataset changes
  React.useEffect(() => {
    setChartDataCache({});
    chartFetchingRef.current.clear();
  }, [profile]);

  // Fetch chart data from the server and store in cache
  const fetchChartData = React.useCallback(async (chart, filter = null) => {
    if (!sessionId) return;
    const key = chartCacheKey(chart, filter);
    if (chartFetchingRef.current.has(key)) return;
    chartFetchingRef.current.add(key);
    try {
      const result = await ApiService.getChartData(sessionId, {
        chart_type: chart.chart_type,
        x_axis: chart.x_axis || null,
        y_axis: chart.y_axis || null,
        aggregation: chart.aggregation || "sum",
        filter_column: filter?.column || null,
        filter_value: filter?.value ?? null,
      });
      setChartDataCache((prev) => ({ ...prev, [key]: { data: result.data || [], total: result.total_rows, sampled: result.sampled } }));
    } catch {
      setChartDataCache((prev) => ({ ...prev, [key]: { data: [], total: 0, sampled: false } }));
    } finally {
      chartFetchingRef.current.delete(key);
    }
  }, [sessionId, chartCacheKey]);

  // Restore allCharts and aiInsights from localStorage on session load
  useEffect(() => {
    if (!sessionId) return;
    try {
      const stored = localStorage.getItem(`cleanlogic_viz_charts_${sessionId}`);
      if (stored) {
        const charts = JSON.parse(stored);
        if (Array.isArray(charts) && charts.length > 0) {
          // Strip inline data — charts re-fetch lazily when rendered
          setAllCharts(charts.map(({ data: _data, ...rest }) => rest));
          setChartRecsFetched(true);
        }
      }
    } catch {}
    try {
      const stored = localStorage.getItem(`cleanlogic_viz_insights_${sessionId}`);
      if (stored) {
        const insights = JSON.parse(stored);
        if (Array.isArray(insights) && insights.length > 0) {
          setAiInsights(insights);
          setAiInsightsFetched(true);
        }
      }
    } catch {}
  }, [sessionId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Persist aiInsights to localStorage whenever they update
  useEffect(() => {
    if (!sessionId || aiInsights.length === 0) return;
    try {
      localStorage.setItem(`cleanlogic_viz_insights_${sessionId}`, JSON.stringify(aiInsights));
    } catch {}
  }, [aiInsights, sessionId]);

  // Persist allCharts + cached data to localStorage so ExportPage can render them
  useEffect(() => {
    if (!sessionId || allCharts.length === 0) return;
    try {
      const chartsWithData = allCharts.map((chart) => {
        const key = chartCacheKey(chart, null);
        return {
          id: chart.id,
          chart_type: chart.chart_type,
          title: chart.title || chart.chart_type,
          x_axis: chart.x_axis,
          y_axis: chart.y_axis,
          aggregation: chart.aggregation,
          isUserChart: Boolean(chart.isUserChart),
          reasoning: chart.reasoning || null,
          data: chartDataCache[key]?.data || [],
        };
      });
      localStorage.setItem(`cleanlogic_viz_charts_${sessionId}`, JSON.stringify(chartsWithData));
    } catch {
      // storage full or serialisation error — ignore
    }
  }, [allCharts, chartDataCache, chartCacheKey, sessionId]);

  const displayRows = tableRows;
  const visibleColumns = tableColumns.length
    ? tableColumns
    : previewColumns.slice(0, 10);
  const rowHeight = 40;
  const rowBuffer = 8;
  const startIndex = Math.max(
    0,
    Math.floor(tableScrollTop / rowHeight) - rowBuffer,
  );
  const endIndex = Math.min(
    displayRows.length,
    startIndex + Math.ceil(tableViewportHeight / rowHeight) + rowBuffer * 2,
  );
  const windowedRows = displayRows.slice(startIndex, endIndex);
  const topSpacerHeight = startIndex * rowHeight;
  const bottomSpacerHeight = (displayRows.length - endIndex) * rowHeight;
  const aiColumns = (
    visibleColumns.length ? visibleColumns : previewColumns
  ).slice(0, 6);
  const aiRows = previewRows.slice(0, 10);
  const typeMax = typeDistribution.length
    ? Math.max(...typeDistribution.map((t) => t.count))
    : 0;
  const topType = typeDistribution[0];

  const cleaningSteps = useMemo(() => {
    return (projectSteps || []).map((step, index) => {
      const titleMap = {
        impute: "Handle Missing Data",
        duplicates: "Handle Duplicates",
        outlier: "Handle Outliers",
        cell_update: "Cell Update",
        type_conversion: "Type Conversion",
        type_inconsistency: "Fix Type Errors",
        text_transform: "Text Transform",
        rename_column: "Rename Column",
        duplicate_column: "Duplicate Column",
        merge_columns: "Merge Columns",
        drop_column: "Drop Column",
        delete_rows: "Delete Rows",
      };
      const tagMap = {
        impute: "Data Quality",
        duplicates: "Deduplication",
        outlier: "Anomaly Detection",
        cell_update: "Edit",
        type_conversion: "Schema",
        type_inconsistency: "Data Quality",
        text_transform: "Transform",
        rename_column: "Schema",
        duplicate_column: "Schema",
        merge_columns: "Schema",
        drop_column: "Schema",
        delete_rows: "Data Quality",
      };
      return {
        step: index + 1,
        title: titleMap[step.type] || "Operation",
        description: step.description || step.type,
        tag: tagMap[step.type] || "Update",
      };
    });
  }, [projectSteps]);

  // Show spinner while session is being restored
  if (isLoading || !sessionChecked) {
    return (
      <div className="min-h-screen bg-[#F8F9FB]">
        <AppHeader />
        <div className="pt-[80px] sm:pt-[90px] lg:pt-[130px] flex items-center justify-center min-h-screen">
          <div className="flex flex-col items-center gap-4">
            <div className="w-10 h-10 border-4 border-[#2B7FFF] border-t-transparent rounded-full animate-spin" />
            <p className="text-sm text-[#6A7282]">Loading visualization…</p>
          </div>
        </div>
      </div>
    );
  }

  // No session — show prompt instead of invisible redirect
  if (!sessionId) {
    return (
      <div className="min-h-screen bg-[#F8F9FB]">
        <AppHeader />
        <div className="pt-[80px] sm:pt-[90px] lg:pt-[130px] flex items-center justify-center min-h-screen">
          <div className="bg-white rounded-3xl border border-gray-200 shadow-sm p-10 text-center max-w-md">
            <BarChart3 className="w-12 h-12 mx-auto mb-4 text-gray-300" />
            <h2 className="text-xl font-semibold text-[#101828] mb-2">No dataset loaded</h2>
            <p className="text-sm text-[#6A7282] mb-6">Upload and profile a file first to see visualizations.</p>
            <button
              onClick={() => navigate("/upload")}
              className="px-6 py-2.5 text-sm font-medium text-white rounded-xl"
              style={{ background: "linear-gradient(90deg,#2B7FFF,#AD46FF)" }}
            >
              Go to Upload
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#F8F9FB] font-['Poppins'] overflow-x-hidden">
      <AppHeader />

      <main className="pt-[80px] sm:pt-[90px] lg:pt-[130px] px-4 sm:px-6 lg:px-8 max-w-none mx-auto">
        <div className="mb-6">
          <h2 className="text-xl sm:text-2xl lg:text-[28px] font-bold text-transparent bg-clip-text bg-gradient-to-r from-[#2B7FFF] to-[#AD46FF]">
            Cleaned Data Profiling and Visualization
          </h2>
          <p className="text-sm text-[#6A7282] mt-1">
            Analyze and understand dataset structure and content
          </p>
          {filename && (
            <p className="text-xs text-[#98A2B3] mt-1">Dataset: {filename}</p>
          )}
        </div>

        {/* Stats Cards */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
          {/* Total Rows */}
          <div className="bg-gradient-to-br from-blue-50 to-transparent p-6 rounded-3xl border border-blue-200 shadow-sm">
            <div className="flex items-center gap-3 mb-3">
              <div className="w-12 h-12 bg-blue-100 rounded-2xl flex items-center justify-center">
                <Database className="w-6 h-6 text-blue-500" />
              </div>
              <span className="text-sm text-gray-600">Total Rows</span>
            </div>
            <div className="text-5xl font-normal text-blue-500 mb-3">
              {stats.rows.toLocaleString()}
            </div>
            <p className="text-sm text-gray-600">Records in dataset</p>
          </div>

          {/* Columns */}
          <div className="bg-gradient-to-br from-purple-50 to-transparent p-6 rounded-3xl border border-purple-200 shadow-sm">
            <div className="flex items-center gap-3 mb-3">
              <div className="w-12 h-12 bg-purple-100 rounded-2xl flex items-center justify-center">
                <Grid className="w-6 h-6 text-purple-500" />
              </div>
              <span className="text-sm text-gray-500">Columns</span>
            </div>
            <div className="text-5xl font-normal text-purple-500 mb-3">
              {stats.cols.toLocaleString()}
            </div>
            <p className="text-sm text-gray-500">Feature columns</p>
          </div>

          {/* Issues Found */}
          <div className="bg-gradient-to-br from-red-50 to-transparent p-6 rounded-3xl border border-red-200 shadow-sm">
            <div className="flex items-center gap-3 mb-3">
              <div className="w-12 h-12 bg-red-100 rounded-2xl flex items-center justify-center">
                <TrendingUp className="w-6 h-6 text-red-400" />
              </div>
              <span className="text-sm text-gray-500">Issues Found</span>
            </div>
            <div className="text-5xl font-normal text-red-400 mb-3">
              {stats.issues.toLocaleString()}
            </div>
            <p className="text-sm text-gray-500">Require attention</p>
          </div>
        </div>

        {/* ── AI-Generated Charts ──────────────────────────────────────────── */}
        <div id="ai-charts-section" className="bg-white rounded-3xl border border-gray-200 shadow-sm p-6 mb-6">
          <div className="flex items-center justify-between mb-5">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-2xl flex items-center justify-center" style={{ background: "linear-gradient(135deg,#2B7FFF,#AD46FF)" }}>
                <Sparkles className="w-5 h-5 text-white" />
              </div>
              <div>
                <h3 className="text-lg font-semibold text-[#101828]">AI-Generated Charts</h3>
                <p className="text-xs text-[#6A7282]">AI-recommended charts + charts you build below — all editable</p>
              </div>
            </div>
            <button
              onClick={async () => {
                setAllCharts((prev) => prev.filter((c) => c.isUserChart));
                setCrossFilter(null);
                setDrillRows(null);
                chartRecsLoadingRef.current = false;
                try { await ApiService.clearChartRecommendations(sessionId); } catch {}
                setChartRecsFetched(false);
              }}
              disabled={chartRecsLoading}
              className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-white rounded-xl disabled:opacity-60 hover:opacity-90 transition-opacity"
              style={{ background: "linear-gradient(90deg,#2B7FFF,#AD46FF)" }}
            >
              {chartRecsLoading
                ? <><div className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" />Generating…</>
                : <><Sparkles className="w-3.5 h-3.5" />Regenerate AI</>}
            </button>
          </div>

          {/* Loading skeleton */}
          {chartRecsLoading && (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {Array.from({ length: 6 }).map((_, i) => (
                <div key={i} className="border border-gray-100 rounded-2xl p-4 animate-pulse">
                  <div className="h-3 bg-gray-100 rounded w-2/3 mb-2" />
                  <div className="h-2 bg-gray-100 rounded w-1/3 mb-4" />
                  <div className="h-44 bg-gray-50 rounded-xl" />
                </div>
              ))}
            </div>
          )}

          {/* Empty state */}
          {!chartRecsLoading && allCharts.length === 0 && (
            <div className="text-center py-12 text-[#6A7282]">
              <Sparkles className="w-10 h-10 mx-auto mb-2 text-gray-200" />
              <p className="text-sm">{chartRecsFetched ? "No charts yet. Use the Chart Builder below to add one." : "Loading chart recommendations…"}</p>
            </div>
          )}

          {/* Cross-filter active banner */}
          {crossFilter && (
            <div className="mb-4 flex items-center gap-3 px-4 py-2 bg-blue-50 border border-blue-200 rounded-xl text-sm text-blue-700">
              <span>Filtering all charts: <strong>{crossFilter.column}</strong> = <strong>{crossFilter.value}</strong></span>
              <button onClick={() => setCrossFilter(null)} className="ml-auto text-xs px-2 py-1 bg-blue-100 hover:bg-blue-200 rounded-lg transition-colors">Clear filter</button>
            </div>
          )}

          {/* Drill-down panel */}
          {drillRows && (
            <div className="mb-4 border border-gray-200 rounded-xl overflow-hidden">
              <div className="flex items-center justify-between px-4 py-2 bg-gray-50 border-b border-gray-200">
                <span className="text-xs font-semibold text-[#374151]">Drill-down: {drillRows.title} ({drillRows.rows.length} rows)</span>
                <button onClick={() => setDrillRows(null)} className="text-xs text-gray-400 hover:text-gray-600 px-2 py-1 rounded hover:bg-gray-100">Close</button>
              </div>
              <div className="overflow-x-auto max-h-48">
                <table className="w-full text-xs">
                  <thead className="bg-gray-50 sticky top-0">
                    <tr>{drillRows.cols.map((c) => <th key={c} className="px-3 py-1.5 text-left text-[#6B7280] font-medium border-b border-gray-200">{c}</th>)}</tr>
                  </thead>
                  <tbody>
                    {drillRows.rows.slice(0, 50).map((row, ri) => (
                      <tr key={ri} className="border-b border-gray-100 hover:bg-gray-50">
                        {drillRows.cols.map((c) => <td key={c} className="px-3 py-1.5 text-[#374151]">{String(getCellValue(row, c) ?? "")}</td>)}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Charts grid */}
          {!chartRecsLoading && allCharts.length > 0 && (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {allCharts.map((chart, i) => {
                const isEditing = editingChartId === chart.id;
                const displayChart = isEditing ? { ...chart, ...editDraft } : chart;
                const isFiltered = crossFilter && crossFilter.column !== displayChart.x_axis;
                const activeFilter = isFiltered ? crossFilter : null;
                const cacheKey = chartCacheKey(displayChart, activeFilter);
                const cacheEntry = chartDataCache[cacheKey];
                const isChartLoading = cacheEntry === undefined;
                const data = cacheEntry?.data ?? [];
                const dataSampled = cacheEntry?.sampled ?? false;
                if (isChartLoading) fetchChartData(displayChart, activeFilter);
                const colors = ["#3B82F6","#8B5CF6","#10B981","#F59E0B","#EF4444","#06B6D4","#6366F1","#EC4899"];
                const conf = chart.confidence != null ? Math.round(chart.confidence * 100) : null;
                const confColor = conf >= 85 ? "#16A34A" : conf >= 70 ? "#D97706" : "#6B7280";

                const handleBarClick = (entry) => {
                  if (!entry || !displayChart.x_axis) return;
                  const val = entry.name ?? entry.activeLabel;
                  // Toggle cross-filter
                  setCrossFilter((prev) =>
                    prev?.column === displayChart.x_axis && prev?.value === val
                      ? null
                      : { column: displayChart.x_axis, value: val }
                  );
                  // Show drill-down rows
                  const cols = previewColumns.slice(0, 8);
                  const rows = previewRows.filter((row) => String(getCellValue(row, displayChart.x_axis) ?? "") === val);
                  setDrillRows({ title: `${displayChart.x_axis} = ${val}`, rows, cols });
                };

                const customTooltip = ({ active, payload, label }) => {
                  if (!active || !payload?.length) return null;
                  const item = payload[0];
                  return (
                    <div className="bg-white border border-gray-200 rounded-xl shadow-lg px-3 py-2 text-xs">
                      {label && <p className="font-semibold text-[#101828] mb-1">{label}</p>}
                      <p className="text-[#374151]">{displayChart.y_axis || "Value"}: <span className="font-semibold text-[#2B7FFF]">{typeof item.value === "number" ? item.value.toLocaleString(undefined, { maximumFractionDigits: 2 }) : item.value}</span></p>
                      {displayChart.x_axis && <p className="text-[10px] text-[#9CA3AF] mt-1">Click to filter all charts</p>}
                    </div>
                  );
                };
                return (
                  <div key={chart.id} className="group border border-gray-100 rounded-2xl p-4 hover:shadow-lg transition-all duration-200 flex flex-col gap-2">
                    {/* Title row */}
                    <div className="flex items-start justify-between gap-1">
                      <div className="flex-1 min-w-0">
                        {isEditing ? (
                          <input
                            type="text"
                            value={editDraft.title ?? ""}
                            onChange={(e) => setEditDraft((d) => ({ ...d, title: e.target.value }))}
                            className="w-full text-[12px] font-semibold border border-gray-200 rounded-lg px-2 py-0.5 focus:outline-none focus:border-[#2B7FFF]"
                            placeholder="Chart title"
                          />
                        ) : (
                          <p className="text-[12px] font-semibold text-[#101828] leading-tight line-clamp-1 group-hover:line-clamp-none">{chart.title || `${chart.chart_type} chart`}</p>
                        )}
                        <p className="text-[10px] text-[#6A7282] capitalize mt-0.5">
                          {displayChart.chart_type}{displayChart.x_axis ? ` · ${displayChart.x_axis}` : ""}{displayChart.y_axis ? ` vs ${displayChart.y_axis}` : ""}
                        </p>
                      </div>
                      <div className="flex items-center gap-0.5 shrink-0 ml-1">
                        {conf !== null && !isEditing && (
                          <span className="relative inline-block group/conf cursor-help mr-1">
                            <span className="text-[10px] font-semibold" style={{ color: confColor }}>{conf}%</span>
                            <div className="pointer-events-none absolute bottom-full left-1/2 -translate-x-1/2 mb-2 w-52 bg-gray-900 text-white text-[10px] rounded-xl px-3 py-2 opacity-0 group-hover/conf:opacity-100 transition-opacity z-50 leading-relaxed shadow-lg">
                              <p className="font-semibold mb-0.5 text-white">AI Confidence Score</p>
                              <p className="text-gray-300">How confident the AI is that this chart type is the best fit for the selected data. ≥85% is a strong match.</p>
                              <div className="absolute top-full left-1/2 -translate-x-1/2 border-4 border-transparent border-t-gray-900" />
                            </div>
                          </span>
                        )}
                        <button
                          onClick={() => {
                            if (isEditing) {
                              setEditingChartId(null);
                            } else {
                              setEditingChartId(chart.id);
                              setEditDraft({
                                chart_type: chart.chart_type,
                                title: chart.title || "",
                                x_axis: chart.x_axis || "",
                                y_axis: chart.y_axis || "",
                                aggregation: chart.aggregation || "avg",
                              });
                            }
                          }}
                          className="w-6 h-6 flex items-center justify-center rounded-lg hover:bg-gray-100 transition-colors"
                          title={isEditing ? "Cancel" : "Edit chart"}
                        >
                          {isEditing
                            ? <X className="w-3.5 h-3.5 text-gray-400" />
                            : <Pencil className="w-3.5 h-3.5 text-gray-400" />}
                        </button>
                        <button
                          onClick={() => setAllCharts((prev) => prev.filter((c) => c.id !== chart.id))}
                          className="w-6 h-6 flex items-center justify-center rounded-lg hover:bg-red-50 transition-colors"
                          title="Remove chart"
                        >
                          <Trash2 className="w-3.5 h-3.5 text-red-400" />
                        </button>
                      </div>
                    </div>

                    {/* Inline edit panel */}
                    {isEditing && (
                      <div className="bg-gray-50 border border-gray-100 rounded-xl p-3 space-y-2">
                        <div className="grid grid-cols-2 gap-2">
                          <div>
                            <label className="text-[9px] text-[#6A7282] uppercase tracking-wide block mb-0.5">Type</label>
                            <select
                              value={editDraft.chart_type}
                              onChange={(e) => setEditDraft((d) => ({ ...d, chart_type: e.target.value }))}
                              className="w-full text-[11px] border border-gray-200 rounded-lg px-2 py-1 bg-white focus:outline-none focus:border-[#2B7FFF]"
                            >
                              {["bar","line","scatter","histogram","pie"].map((t) => (
                                <option key={t} value={t}>{t.charAt(0).toUpperCase() + t.slice(1)}</option>
                              ))}
                            </select>
                          </div>
                          {!["histogram","pie"].includes(editDraft.chart_type) && (
                            <div>
                              <label className="text-[9px] text-[#6A7282] uppercase tracking-wide block mb-0.5">Aggregation</label>
                              <select
                                value={editDraft.aggregation || "avg"}
                                onChange={(e) => setEditDraft((d) => ({ ...d, aggregation: e.target.value }))}
                                className="w-full text-[11px] border border-gray-200 rounded-lg px-2 py-1 bg-white focus:outline-none focus:border-[#2B7FFF]"
                              >
                                {["sum","avg","count","min","max"].map((a) => (
                                  <option key={a} value={a}>{a}</option>
                                ))}
                              </select>
                            </div>
                          )}
                        </div>
                        <div className="grid grid-cols-2 gap-2">
                          <div>
                            <label className="text-[9px] text-[#6A7282] uppercase tracking-wide block mb-0.5">X Axis</label>
                            <select
                              value={editDraft.x_axis || ""}
                              onChange={(e) => setEditDraft((d) => ({ ...d, x_axis: e.target.value }))}
                              className="w-full text-[11px] border border-gray-200 rounded-lg px-2 py-1 bg-white focus:outline-none focus:border-[#2B7FFF]"
                            >
                              <option value="">Select…</option>
                              {(profile?.columns || []).map((c) => (
                                <option key={c.name} value={c.name}>{c.name}</option>
                              ))}
                            </select>
                          </div>
                          {!["histogram","pie"].includes(editDraft.chart_type) && (
                            <div>
                              <label className="text-[9px] text-[#6A7282] uppercase tracking-wide block mb-0.5">Y Axis</label>
                              <select
                                value={editDraft.y_axis || ""}
                                onChange={(e) => setEditDraft((d) => ({ ...d, y_axis: e.target.value || null }))}
                                className="w-full text-[11px] border border-gray-200 rounded-lg px-2 py-1 bg-white focus:outline-none focus:border-[#2B7FFF]"
                              >
                                <option value="">Select…</option>
                                {(profile?.columns || []).map((c) => (
                                  <option key={c.name} value={c.name}>{c.name}</option>
                                ))}
                              </select>
                            </div>
                          )}
                        </div>
                        <div className="flex gap-2 pt-1">
                          <button
                            onClick={() => {
                              setAllCharts((prev) => prev.map((c) => c.id === chart.id ? { ...c, ...editDraft } : c));
                              setEditingChartId(null);
                            }}
                            className="flex-1 py-1.5 text-[11px] font-medium text-white rounded-lg"
                            style={{ background: "linear-gradient(90deg,#2B7FFF,#AD46FF)" }}
                          >
                            Apply
                          </button>
                          <button
                            onClick={() => setEditingChartId(null)}
                            className="flex-1 py-1.5 text-[11px] font-medium text-[#6A7282] border border-gray-200 rounded-lg hover:bg-gray-50"
                          >
                            Cancel
                          </button>
                        </div>
                      </div>
                    )}

                    {/* Chart */}
                    <div
                      ref={(el) => { chartBodyRefs.current[chart.id] = el; }}
                      className={`h-52 ${crossFilter && crossFilter.column === displayChart.x_axis ? "ring-2 ring-blue-400 rounded-xl" : ""}`}
                    >
                      {isChartLoading ? (
                        <div className="h-full flex items-center justify-center bg-gray-50 rounded-xl">
                          <div className="flex flex-col items-center gap-2">
                            <div className="w-5 h-5 border-2 border-blue-400 border-t-transparent rounded-full animate-spin" />
                            <span className="text-[10px] text-gray-400">Loading data…</span>
                          </div>
                        </div>
                      ) : data.length === 0 ? (
                        <div className="h-full flex items-center justify-center text-[11px] text-[#9CA3AF] bg-gray-50 rounded-xl">
                          {(displayChart.x_axis || displayChart.y_axis) ? "Not enough data to render" : "Select columns to render"}
                        </div>
                      ) : (
                        <ResponsiveContainer width="100%" height="100%">
                          {displayChart.chart_type === "pie" ? (
                            <PieChart>
                              <Pie
                                data={data}
                                dataKey="value"
                                nameKey="name"
                                outerRadius={68}
                                innerRadius={30}
                                onClick={(entry) => handleBarClick(entry)}
                                cursor="pointer"
                              >
                                {data.map((entry, ci) => (
                                  <Cell
                                    key={ci}
                                    fill={colors[ci % colors.length]}
                                    opacity={crossFilter?.column === displayChart.x_axis && crossFilter?.value !== entry.name ? 0.35 : 1}
                                  />
                                ))}
                              </Pie>
                              <Tooltip content={customTooltip} />
                              <Legend iconSize={8} wrapperStyle={{ fontSize: 10 }} />
                            </PieChart>
                          ) : displayChart.chart_type === "scatter" ? (
                            <ScatterChart margin={{ top: 4, right: 4, left: -20, bottom: 4 }}>
                              <CartesianGrid strokeDasharray="3 3" stroke="#F3F4F6" />
                              <XAxis dataKey="x" name={displayChart.x_axis} tick={{ fontSize: 9 }} />
                              <YAxis dataKey="y" name={displayChart.y_axis} tick={{ fontSize: 9 }} />
                              <Tooltip content={customTooltip} cursor={{ strokeDasharray: "3 3" }} />
                              <Scatter data={data} fill={colors[i % colors.length]} cursor="pointer" />
                            </ScatterChart>
                          ) : displayChart.chart_type === "line" || displayChart.chart_type === "area" ? (
                            <LineChart
                              data={data}
                              margin={{ top: 4, right: 4, left: -20, bottom: 4 }}
                              onClick={(e) => e?.activeLabel && handleBarClick({ name: e.activeLabel })}
                            >
                              <CartesianGrid strokeDasharray="3 3" stroke="#F3F4F6" />
                              <XAxis dataKey="name" tick={{ fontSize: 9 }} interval="preserveStartEnd" />
                              <YAxis tick={{ fontSize: 9 }} />
                              <Tooltip content={customTooltip} />
                              <Legend iconSize={8} wrapperStyle={{ fontSize: 10 }} />
                              <Line
                                type="monotone"
                                dataKey="value"
                                stroke={colors[i % colors.length]}
                                strokeWidth={2}
                                dot={false}
                                activeDot={{ r: 5, stroke: colors[i % colors.length], strokeWidth: 2, fill: "#fff", cursor: "pointer" }}
                              />
                              {data.length > 10 && (
                                <Brush
                                  dataKey="name"
                                  height={18}
                                  stroke="#E5E7EB"
                                  fill="#F9FAFB"
                                  travellerWidth={6}
                                  startIndex={sharedBrushRange.startIndex}
                                  endIndex={sharedBrushRange.endIndex ?? data.length - 1}
                                  onChange={(range) => setSharedBrushRange(range)}
                                />
                              )}
                            </LineChart>
                          ) : (
                            <BarChart
                              data={data}
                              margin={{ top: 4, right: 4, left: -20, bottom: 4 }}
                              onClick={(e) => e?.activeLabel && handleBarClick({ name: e.activeLabel })}
                            >
                              <CartesianGrid strokeDasharray="3 3" stroke="#F3F4F6" />
                              <XAxis dataKey="name" tick={{ fontSize: 9 }} interval="preserveStartEnd" />
                              <YAxis tick={{ fontSize: 9 }} />
                              <Tooltip content={customTooltip} />
                              <Legend iconSize={8} wrapperStyle={{ fontSize: 10 }} />
                              <Bar dataKey="value" radius={[4, 4, 0, 0]} cursor="pointer">
                                {data.map((entry, ci) => (
                                  <Cell
                                    key={ci}
                                    fill={colors[ci % colors.length]}
                                    opacity={crossFilter?.column === displayChart.x_axis && crossFilter?.value !== entry.name ? 0.35 : 1}
                                  />
                                ))}
                              </Bar>
                              {data.length > 10 && (
                                <Brush
                                  dataKey="name"
                                  height={18}
                                  stroke="#E5E7EB"
                                  fill="#F9FAFB"
                                  travellerWidth={6}
                                  startIndex={sharedBrushRange.startIndex}
                                  endIndex={sharedBrushRange.endIndex ?? data.length - 1}
                                  onChange={(range) => setSharedBrushRange(range)}
                                />
                              )}
                            </BarChart>
                          )}
                        </ResponsiveContainer>
                      )}
                    </div>

                    {/* Footer */}
                    {chart.reasoning && (
                      <p className="text-[10px] text-[#9CA3AF] leading-relaxed line-clamp-2 group-hover:line-clamp-none transition-all duration-200">{chart.reasoning}</p>
                    )}
                    {dataSampled && (
                      <span className="text-[9px] text-gray-400">Showing 2,000 of {cacheEntry?.total?.toLocaleString()} points</span>
                    )}
                    {chart.isUserChart && (
                      <span className="text-[9px] font-medium text-[#10B981]">Custom chart</span>
                    )}

                    {/* ── Analyze with AI (Gemini vision) ─────────────────── */}
                    {(() => {
                      const insightState = chartInsights[chart.id] || {};
                      const analyzing = !!insightState.loading;
                      const canAnalyze = !isChartLoading && data.length > 0 && !analyzing;
                      return (
                        <>
                          <button
                            type="button"
                            onClick={() => handleAnalyzeChart(chart)}
                            disabled={!canAnalyze}
                            className="mt-1 inline-flex items-center justify-center gap-1.5 self-start px-3 py-1.5 text-[11px] font-medium text-white rounded-lg disabled:opacity-40 hover:opacity-90 transition-opacity"
                            style={{ background: "linear-gradient(90deg,#AD46FF,#2B7FFF)" }}
                            title={data.length === 0 ? "No data to analyze yet" : "Analyze this chart with AI vision"}
                          >
                            {analyzing ? (
                              <>
                                <div className="w-3 h-3 border-2 border-white border-t-transparent rounded-full animate-spin" />
                                Analyzing…
                              </>
                            ) : (
                              <>
                                <Sparkles className="w-3 h-3" />
                                {insightState.text ? "Re-analyze with AI" : "Analyze with AI"}
                              </>
                            )}
                          </button>

                          {insightState.text && (
                            <div className="mt-1 p-2.5 bg-[#AD46FF]/5 border border-[#AD46FF]/20 rounded-lg text-[11px] text-[#374151] leading-relaxed whitespace-pre-wrap">
                              {insightState.text}
                              {insightState.note && (
                                <p className="mt-1.5 text-[10px] text-[#9CA3AF] italic">{insightState.note}</p>
                              )}
                            </div>
                          )}
                          {insightState.error && (
                            <p className="mt-1 text-[10px] text-red-500">{insightState.error}</p>
                          )}
                        </>
                      );
                    })()}
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* ── Custom Chart Builder (multi-slot, up to 6) ───────────────────── */}
        <div id="chart-builder-section" className="bg-white rounded-3xl border border-gray-200 shadow-sm p-6 mb-6">
          {/* Header */}
          <div className="flex items-center justify-between mb-5">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-2xl flex items-center justify-center bg-[#F59E0B]/10">
                <Eye className="w-5 h-5 text-[#F59E0B]" />
              </div>
              <div>
                <h3 className="text-lg font-semibold text-[#101828]">Custom Chart Builder</h3>
                <p className="text-xs text-[#6A7282]">Configure a chart and click "Add to Charts" — it will appear in the AI-Generated Charts section above</p>
              </div>
            </div>
            <button
              onClick={() => setBuilderSlots((prev) => [...prev, makeSlot(Date.now())])}
              disabled={builderSlots.length >= MAX_BUILDER_SLOTS}
              className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-white rounded-xl disabled:opacity-40 transition-opacity hover:opacity-90"
              style={{ background: "linear-gradient(90deg,#2B7FFF,#AD46FF)" }}>
              + Add Chart
            </button>
          </div>

          {/* Slots grid */}
          <div className="space-y-6">
            {builderSlots.map((slot, slotIdx) => (
              <div key={slot.id} className="border border-gray-100 rounded-2xl p-4">
                {/* Slot header */}
                <div className="flex items-center justify-between mb-3">
                  <span className="text-xs font-semibold text-[#6A7282] uppercase tracking-wide">Chart {slotIdx + 1}</span>
                  {builderSlots.length > 1 && (
                    <button
                      onClick={() => setBuilderSlots((prev) => prev.filter((s) => s.id !== slot.id))}
                      className="text-xs text-red-400 hover:text-red-600 transition-colors px-2 py-1 rounded-lg hover:bg-red-50">
                      Remove
                    </button>
                  )}
                </div>

                {/* Controls row */}
                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3 mb-3">
                  {/* Title */}
                  <div className="lg:col-span-2">
                    <label className="text-xs text-[#6A7282] mb-1 block">Chart Title (optional)</label>
                    <input type="text" value={slot.title} onChange={(e) => updateSlot(slot.id, { title: e.target.value, result: null })}
                      placeholder="e.g. Age Distribution"
                      className="w-full text-sm border border-gray-200 rounded-xl px-3 py-2 focus:outline-none focus:border-[#2B7FFF]" />
                  </div>
                  {/* Chart type */}
                  <div>
                    <label className="text-xs text-[#6A7282] mb-1 block">Chart Type</label>
                    <select value={slot.type} onChange={(e) => updateSlot(slot.id, { type: e.target.value, result: null })}
                      className="w-full text-sm border border-gray-200 rounded-xl px-3 py-2 focus:outline-none focus:border-[#2B7FFF] bg-white">
                      {["bar", "line", "scatter", "histogram", "pie"].map((t) => (
                        <option key={t} value={t}>{t.charAt(0).toUpperCase() + t.slice(1)}</option>
                      ))}
                    </select>
                  </div>
                  {/* X / Column */}
                  <div>
                    <label className="text-xs text-[#6A7282] mb-1 block">{slot.type === "pie" ? "Column" : "X Axis"}</label>
                    <select value={slot.xCol} onChange={(e) => updateSlot(slot.id, { xCol: e.target.value, result: null })}
                      className="w-full text-sm border border-gray-200 rounded-xl px-3 py-2 focus:outline-none focus:border-[#2B7FFF] bg-white">
                      <option value="">Select…</option>
                      {(profile?.columns || []).map((c) => <option key={c.name} value={c.name}>{c.name}</option>)}
                    </select>
                  </div>
                  {/* Y column (not needed for pie/histogram) */}
                  {!["pie", "histogram"].includes(slot.type) ? (
                    <div>
                      <label className="text-xs text-[#6A7282] mb-1 block">Y Axis</label>
                      <select value={slot.yCol} onChange={(e) => updateSlot(slot.id, { yCol: e.target.value, result: null })}
                        className="w-full text-sm border border-gray-200 rounded-xl px-3 py-2 focus:outline-none focus:border-[#2B7FFF] bg-white">
                        <option value="">Select…</option>
                        {(profile?.columns || []).map((c) => <option key={c.name} value={c.name}>{c.name}</option>)}
                      </select>
                    </div>
                  ) : <div />}
                </div>

                {/* Filter row */}
                <div className="grid grid-cols-2 gap-3 mb-3 max-w-xs">
                  <div>
                    <label className="text-xs text-[#6A7282] mb-1 block">Min filter</label>
                    <input type="number" value={slot.minFilter} onChange={(e) => updateSlot(slot.id, { minFilter: e.target.value, result: null })}
                      placeholder="e.g. 18" className="w-full text-sm border border-gray-200 rounded-xl px-3 py-2 focus:outline-none focus:border-[#2B7FFF]" />
                  </div>
                  <div>
                    <label className="text-xs text-[#6A7282] mb-1 block">Max filter</label>
                    <input type="number" value={slot.maxFilter} onChange={(e) => updateSlot(slot.id, { maxFilter: e.target.value, result: null })}
                      placeholder="e.g. 60" className="w-full text-sm border border-gray-200 rounded-xl px-3 py-2 focus:outline-none focus:border-[#2B7FFF]" />
                  </div>
                </div>

                {/* Action buttons */}
                <div className="flex items-center gap-2 mb-3">
                  <button onClick={() => buildSlotChart(slot.id)} disabled={!slot.xCol}
                    className="px-4 py-2 text-sm font-medium text-white rounded-xl disabled:opacity-40 transition-opacity hover:opacity-90"
                    style={{ background: "linear-gradient(90deg,#2B7FFF,#AD46FF)" }}>
                    Add to Charts
                  </button>
                </div>

                {/* Result feedback */}
                {slot.result?.error && (
                  <p className="text-sm text-red-500">{slot.result.error}</p>
                )}
                {slot.result?.added && (
                  <div className="flex items-center gap-2 text-sm text-[#10B981] bg-[#10B981]/5 border border-[#10B981]/20 rounded-xl px-4 py-2.5">
                    <div className="w-4 h-4 rounded-full bg-[#10B981] flex items-center justify-center shrink-0">
                      <svg className="w-2.5 h-2.5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                      </svg>
                    </div>
                    Chart added to AI-Generated Charts above
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>

        {/* ── Saved Charts Gallery ──────────────────────────────────────────── */}
        {(savedCharts.length > 0 || savedChartsLoading) && (
          <div className="bg-white rounded-3xl border border-gray-200 shadow-sm p-6 mb-6">
            <div className="flex items-center gap-3 mb-5">
              <div className="w-10 h-10 rounded-2xl flex items-center justify-center" style={{ background: "linear-gradient(135deg,#10B981,#2B7FFF)" }}>
                <FileText className="w-5 h-5 text-white" />
              </div>
              <div>
                <h3 className="text-lg font-semibold text-[#101828]">Saved Charts Gallery</h3>
                <p className="text-xs text-[#6A7282]">{savedCharts.length} chart{savedCharts.length !== 1 ? "s" : ""} saved to report — these will appear in your export</p>
              </div>
            </div>
            {savedChartsLoading && (
              <div className="flex items-center gap-2 text-sm text-[#6A7282] py-4">
                <div className="w-4 h-4 border-2 border-[#2B7FFF] border-t-transparent rounded-full animate-spin" />
                Loading saved charts…
              </div>
            )}
            {!savedChartsLoading && savedCharts.length > 0 && (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                {savedCharts.map((chart) => {
                  const cfg = chart.chart_config || {};
                  const chartData = cfg.data || [];
                  const chartType = cfg.chart_type || "bar";
                  return (
                    <div key={chart.id} className="border border-gray-100 rounded-2xl p-4 hover:shadow-sm transition-shadow">
                      <div className="flex items-center justify-between mb-2">
                        <div>
                          <p className="text-xs font-semibold text-[#101828] truncate">{cfg.title || chart.chart_title || "Custom Chart"}</p>
                          <p className="text-xs text-[#6A7282] capitalize">{chartType.replace("_", " ")}</p>
                        </div>
                        <button onClick={() => deleteSavedChart(chart.id)}
                          className="text-xs text-red-400 hover:text-red-600 px-2 py-1 rounded-lg hover:bg-red-50 transition-colors shrink-0 ml-2">
                          Delete
                        </button>
                      </div>
                      <div className="h-44">
                        <ResponsiveContainer width="100%" height="100%">
                          {chartType === "pie" ? (
                            <PieChart>
                              <Pie data={chartData} dataKey="value" nameKey="name" outerRadius={80} innerRadius={40}>
                                {chartData.map((_, i) => <Cell key={i} fill={chartPalette[i % chartPalette.length]} />)}
                              </Pie>
                              <Tooltip /><Legend iconSize={10} />
                            </PieChart>
                          ) : chartType === "scatter" ? (
                            <ScatterChart margin={{ top: 4, right: 4, left: -20, bottom: 0 }}>
                              <CartesianGrid strokeDasharray="3 3" stroke="#F3F4F6" />
                              <XAxis dataKey="x" tick={{ fontSize: 10 }} />
                              <YAxis dataKey="y" tick={{ fontSize: 10 }} />
                              <Tooltip contentStyle={{ fontSize: 11 }} cursor={{ strokeDasharray: "3 3" }} />
                              <Scatter data={chartData} fill="#2B7FFF" />
                            </ScatterChart>
                          ) : chartType === "line" ? (
                            <LineChart data={chartData} margin={{ top: 4, right: 4, left: -20, bottom: 0 }}>
                              <CartesianGrid strokeDasharray="3 3" stroke="#F3F4F6" />
                              <XAxis dataKey="name" tick={{ fontSize: 10 }} />
                              <YAxis tick={{ fontSize: 10 }} />
                              <Tooltip contentStyle={{ fontSize: 11 }} />
                              <Line type="monotone" dataKey="value" stroke="#2B7FFF" strokeWidth={2} dot={false} />
                            </LineChart>
                          ) : (
                            <BarChart data={chartData} margin={{ top: 4, right: 4, left: -20, bottom: 0 }}>
                              <CartesianGrid strokeDasharray="3 3" stroke="#F3F4F6" />
                              <XAxis dataKey="name" tick={{ fontSize: 9 }} interval="preserveStartEnd" />
                              <YAxis tick={{ fontSize: 10 }} />
                              <Tooltip contentStyle={{ fontSize: 11 }} />
                              <Bar dataKey="value" fill="#2B7FFF" radius={[4, 4, 0, 0]}>
                                {chartData.map((_, i) => <Cell key={i} fill={chartPalette[i % chartPalette.length]} />)}
                              </Bar>
                            </BarChart>
                          )}
                        </ResponsiveContainer>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* ── AI Insights ──────────────────────────────────────────────────── */}
        <div className="bg-white rounded-3xl border border-gray-200 shadow-sm p-6 mb-6">
          <div className="flex items-center justify-between mb-5">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-2xl flex items-center justify-center" style={{ background: "linear-gradient(135deg,#AD46FF,#F6339A)" }}>
                <Sparkles className="w-5 h-5 text-white" />
              </div>
              <div>
                <h3 className="text-lg font-semibold text-[#101828]">AI Column Insights</h3>
                <p className="text-xs text-[#6A7282]">Metadata-only analysis — no raw data accessed</p>
              </div>
            </div>
            {!aiInsightsFetched && (
              <button onClick={fetchVizInsights} disabled={aiInsightsLoading}
                className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-white rounded-xl disabled:opacity-60 hover:opacity-90 transition-opacity"
                style={{ background: "linear-gradient(90deg,#AD46FF,#2B7FFF)" }}>
                {aiInsightsLoading ? <><div className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" />Analyzing…</> : <><Sparkles className="w-3.5 h-3.5" />Generate Insights</>}
              </button>
            )}
          </div>
          {aiInsights.length === 0 && !aiInsightsLoading && (
            <div className="text-center py-10 text-[#6A7282]">
              <Sparkles className="w-10 h-10 mx-auto mb-2 text-gray-200" />
              <p className="text-sm">Click "Generate Insights" to analyze column metadata with AI.</p>
            </div>
          )}
          {aiInsights.length > 0 && (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {aiInsights.map((ins, i) => {
                const conf = ins.confidence != null ? Math.round(ins.confidence * 100) : null;
                return (
                  <div key={i} className="border border-gray-100 rounded-2xl p-4 hover:shadow-sm transition-shadow">
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-xs font-mono font-semibold text-[#101828] truncate">{ins.column_name}</span>
                      {conf !== null && <span className="text-xs text-[#6A7282] shrink-0 ml-2">{conf}% conf.</span>}
                    </div>
                    <p className="text-xs text-[#374151] leading-relaxed mb-2">{ins.insight}</p>
                    <div className="bg-[#AD46FF]/5 rounded-xl px-3 py-2">
                      <p className="text-xs text-[#AD46FF] leading-relaxed">{ins.recommendation}</p>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Main Grid Layout */}
        <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
          {/* Left Column - Dataset Preview & Column Health */}
          <div className="xl:col-span-2 space-y-6">
            {/* Dataset Preview */}
            <div className="bg-white rounded-3xl border border-gray-200 shadow-sm overflow-hidden">
              <div className="p-6 border-b border-gray-200 flex items-center justify-between gap-4">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 bg-cyan-100 rounded-2xl flex items-center justify-center">
                    <Database className="w-5 h-5 text-cyan-500" />
                  </div>
                  <div>
                    <h3 className="text-xl font-normal text-gray-900">
                      Cleaned Dataset Preview
                    </h3>
                    <p className="text-sm text-gray-600">
                      {showErrorsOnly
                        ? `Showing ${displayRows.length} of ${tableTotal} error rows`
                        : `Showing ${displayRows.length} of ${tableTotal} rows`}
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
                  <button
                    onClick={() => setShowErrorsOnly((v) => !v)}
                    className="px-4 py-2 text-sm text-gray-700 bg-gray-50 border-2 border-gray-200 rounded-2xl hover:bg-gray-100"
                  >
                    {showErrorsOnly ? "Show all" : "Show errors"}
                  </button>
                </div>
              </div>

              {/* Table */}
              {(isLoading || tableLoading) && (
                <div className="px-6 py-4 text-sm text-gray-500">
                  Loading profile…
                </div>
              )}
              {!isLoading && !tableLoading && displayRows.length === 0 && (
                <div className="px-6 py-4 text-sm text-gray-500">
                  No data available. Upload and profile a dataset first.
                </div>
              )}
              <div
                className="h-[520px] overflow-y-auto overflow-x-auto max-w-full"
                onScroll={handleTableScroll}
                ref={tableViewportRef}
              >
                <table className="w-full text-xs">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="px-4 py-4 text-left font-medium text-black">
                        #
                      </th>
                      {visibleColumns.map((col) => (
                        <th
                          key={col}
                          className="px-4 py-4 text-left font-medium text-black"
                        >
                          {col}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="bg-white">
                    {topSpacerHeight > 0 && (
                      <tr>
                        <td
                          colSpan={visibleColumns.length + 1}
                          style={{ height: topSpacerHeight }}
                        />
                      </tr>
                    )}
                    {windowedRows.map((row, windowIdx) => {
                      const rowIdx = startIndex + windowIdx;
                      const rowIndexForIssues = row._index ?? rowIdx;
                      return (
                        <tr
                          key={row._index ?? rowIdx}
                          className="border-t border-gray-100 h-10"
                        >
                          <td className="px-4 py-2.5 text-black h-10 align-middle whitespace-nowrap">
                            {rowIndexForIssues + 1}
                          </td>
                          {visibleColumns.map((col) => {
                            const cell = row[col];
                            const value =
                              typeof cell === "object" && cell !== null
                                ? (cell.display_value ?? cell.value)
                                : cell;
                            const cellIssues =
                              typeof cell === "object" && cell?.issues
                                ? cell.issues
                                : getCellIssues(rowIndexForIssues, col);
                            const formattedValue = formatTableValue(value);
                            const className = getCellClassName(cellIssues);
                            const content = getCellContent(
                              formattedValue,
                              cellIssues,
                            );
                            const highlighted = shouldHighlightCell(cellIssues);
                            return (
                              <td
                                key={col}
                                className="px-4 py-2.5 text-black h-10 align-middle whitespace-nowrap"
                              >
                                <span
                                  className={`${
                                    highlighted ? className : "text-[#1F2937]"
                                  } whitespace-nowrap`}
                                >
                                  {highlighted ? content : (formattedValue ?? "—")}
                                </span>
                              </td>
                            );
                          })}
                        </tr>
                      );
                    })}
                    {bottomSpacerHeight > 0 && (
                      <tr>
                        <td
                          colSpan={visibleColumns.length + 1}
                          style={{ height: bottomSpacerHeight }}
                        />
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>

          {/* Right Column - Column Health Status */}
          <div className="bg-white rounded-2xl border border-gray-200 p-6">
            <div className="flex items-center gap-3 mb-6">
              <div className="w-10 h-10 bg-blue-50 rounded-xl flex items-center justify-center">
                <Database className="w-5 h-5 text-blue-600" />
              </div>
              <div>
                <h3 className="text-lg font-semibold text-gray-900">
                  Column Health Status
                </h3>
                <p className="text-xs text-gray-500">
                  Post-cleaning quality metrics
                </p>
              </div>
            </div>

            <div className="space-y-3 max-h-[500px] overflow-y-auto border border-gray-200 rounded-2xl p-3">
              {columnStats.slice(0, 8).map((col, idx) => (
                <div
                  key={idx}
                  className="p-4 border border-gray-100 rounded-2xl"
                >
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-sm font-medium text-gray-900">
                      {col.name}
                    </span>
                    <span className="px-2 py-1 bg-gray-100 text-gray-600 text-xs rounded-full">
                      {col.type}
                    </span>
                  </div>
                  <div className="space-y-2">
                    <div className="flex justify-between text-xs">
                      <span className="text-gray-500">Quality</span>
                      <span className="text-green-600 font-medium">
                        {Math.round(col.completeness)}%
                      </span>
                    </div>
                    <div className="w-full h-1.5 bg-gray-100 rounded-full overflow-hidden">
                      <div
                        className="h-full bg-green-500 rounded-full"
                        style={{ width: `${Math.round(col.completeness)}%` }}
                      ></div>
                    </div>
                    <div className="flex justify-between text-xs">
                      <span className="text-gray-500">Complete</span>
                      <span className="text-green-600 font-medium">
                        {Math.round(col.completeness)}%
                      </span>
                    </div>
                    <div className="flex justify-between text-xs">
                      <span className="text-gray-500">Missing</span>
                      <span className="text-green-600 font-medium">
                        {col.missingCount}
                      </span>
                    </div>
                  </div>
                </div>
              ))}
            </div>

            <div className="mt-6 p-3 bg-green-50 border border-green-200 rounded-2xl">
              <div className="flex items-center gap-2 mb-1">
                <Activity className="w-4 h-4 text-green-700" />
                <span className="text-sm font-semibold text-green-800">
                  Data Quality Summary
                </span>
              </div>
              <p className="text-xs text-green-700">
                {columnStats.every((c) => c.missingCount === 0)
                  ? "All columns are complete with no missing values."
                  : "Some columns still have missing values that may need review."}
              </p>
            </div>
          </div>


          {/* AI Query Section & Data Cleaning Steps */}
          <div className="mt-6 grid grid-cols-1 lg:grid-cols-3 gap-6 col-span-full">
            <div className="flex flex-col gap-6 lg:col-span-2">
              <div className="bg-white border border-purple-200 rounded-3xl p-6">
                <div className="flex items-center gap-3 mb-4">
                  <div className="w-12 h-12 bg-purple-100 rounded-2xl flex items-center justify-center">
                    <Activity className="w-6 h-6 text-purple-500" />
                  </div>
                  <div>
                    <h3 className="text-xl font-normal text-gray-900">
                      Ask AI About Your Data
                    </h3>
                    <p className="text-sm text-gray-600">
                      Natural language queries to generate insights
                    </p>
                  </div>
                </div>

                <div className="relative mb-4">
                  <input
                    type="text"
                    placeholder="e.g., Show me correlation between course1 and course2..."
                    value={aiQuery}
                    onChange={(e) => setAiQuery(e.target.value)}
                    className="w-full px-6 py-4 bg-gray-50 border-2 border-gray-300 rounded-2xl text-base text-gray-900 placeholder-gray-400 focus:outline-none focus:border-purple-500"
                  />
                  <button
                    onClick={() => handleAiExplain()}
                    className="absolute right-2 top-2 w-10 h-10 bg-gray-800 rounded-2xl flex items-center justify-center"
                  >
                    <Search className="w-5 h-5 text-white" />
                  </button>
                </div>

                
              </div>

              <div className="bg-white border border-purple-200 rounded-3xl p-6">
                <div className="flex items-center gap-3 mb-4">
                  <div className="w-10 h-10 bg-purple-100 rounded-2xl flex items-center justify-center">
                    <Activity className="w-5 h-5 text-purple-500" />
                  </div>
                  <div className="flex-1">
                    <h4 className="text-base font-medium text-gray-900">
                      AI Response
                    </h4>
                    <p className="text-xs text-gray-500">1:04:07 PM</p>
                  </div>
                </div>

                <div className="bg-blue-50 border border-blue-200 rounded-2xl p-4 mb-4">
                  <p className="text-sm text-gray-600 mb-1">Your query:</p>
                  <p className="text-base italic text-gray-900">
                    {aiQuery || "Explain the selected visualizations."}
                  </p>
                </div>

                {aiLoading && (
                  <p className="text-base text-gray-700 mt-4 leading-relaxed">
                    Generating explanation...
                  </p>
                )}
                {aiError && (
                  <p className="text-base text-red-500 mt-4 leading-relaxed">
                    {aiError}
                  </p>
                )}
                {!aiLoading && !aiError && aiResponse && (
                  <p className="text-base text-gray-700 mt-4 leading-relaxed">
                    {aiResponse}
                  </p>
                )}
              </div>
            </div>

            {/* Right - Data Cleaning Steps */}
            <div className="bg-white rounded-2xl border border-gray-200 p-6 lg:col-span-1">
              <h3 className="text-lg font-medium text-gray-900 mb-2">
                Data Cleaning Steps
              </h3>
              <p className="text-sm text-gray-600 mb-6">
                Applied transformations to improve data quality
              </p>

              <div className="space-y-4">
                {projectStepsLoading && (
                  <div className="text-sm text-gray-500">Loading steps…</div>
                )}
                {!projectStepsLoading && cleaningSteps.length === 0 && (
                  <div className="text-sm text-gray-500">
                    No cleaning steps recorded yet.
                  </div>
                )}
                {cleaningSteps.map((step, idx) => (
                  <div key={step.step} className="flex gap-3">
                    <div className="flex flex-col items-center">
                      <div className="w-8 h-8 bg-gray-100 rounded-full flex items-center justify-center text-sm font-medium text-gray-700 border-2 border-white">
                        {step.step}
                      </div>
                      {idx < cleaningSteps.length - 1 && (
                        <div className="w-px h-6 bg-gray-200"></div>
                      )}
                    </div>
                    <div className="flex-1 pb-2">
                      <h4 className="text-base font-medium text-gray-900 mb-2">
                        {step.title}
                      </h4>
                      <p className="text-sm text-gray-600 mb-2">
                        {step.description}
                      </p>
                      <span className="inline-block px-2 py-1 bg-gray-50 rounded-lg text-xs text-gray-600">
                        {step.tag}
                      </span>
                    </div>
                  </div>
                ))}
              </div>

              <div className="mt-6 pt-4 border-t border-gray-100">
                <p className="text-xs text-gray-500 mb-3">Process Summary</p>
                <div className="space-y-2">
                  <div>
                    <p className="text-xs text-gray-500">Total Records</p>
                    <p className="text-xs font-medium text-gray-900">
                      {stats.rows.toLocaleString()}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs text-gray-500">Steps Completed</p>
                    <p className="text-xs font-medium text-gray-900">
                      {projectSteps.length.toLocaleString()}
                    </p>
                  </div>
                </div>
              </div>

              <button
                onClick={() => navigate("/log")}
                className="mt-4 w-full px-4 py-3 border border-gray-200 rounded-xl flex items-center justify-between text-sm text-gray-700 hover:bg-gray-50"
              >
                <div className="flex items-center gap-2">
                  <FileText className="w-4 h-4 text-gray-500" />
                  <span>View Detailed Log</span>
                </div>
              </button>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
};

export default DataVisualizationDashboard;
