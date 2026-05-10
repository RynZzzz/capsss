// frontend-jsx/src/pages/CleaningPage.jsx
// Redesigned to match CleaningStudioAuto.png — AI-Powered Auto Cleaning UI
// ValueDetailsModal preserved exactly.

import React, {
  useState,
  useMemo,
  useCallback,
  useRef,
  useEffect,
} from "react";
import {
  ChevronDown,
  AlertCircle,
  AlertTriangle,
  Check,
  Play,
  RefreshCw,
  Plus,
  Trash2,
  Settings,
  Zap,
  Eye,
  Bot,
} from "lucide-react";
import { useNavigate } from "react-router-dom";
import AppHeader from "../../components/common/AppHeader";
import { useDataProfiler } from "../../components/hooks/useDataProfiler";
import { ValueDetailsModal } from "./ValueDetailsModal";
import ApiService from "../../services/api";

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────

const MISSING_STRATEGIES = [
  { value: "mean", label: "Fill with Mean" },
  { value: "median", label: "Fill with Median" },
  { value: "mode", label: "Fill with Mode" },
  { value: "knn_impute", label: "KNN Imputation" },
  { value: "constant", label: "Fill with Constant" },
  { value: "conditional", label: "Conditional" },
  { value: "forward_fill", label: "Forward Fill" },
  { value: "backward_fill", label: "Backward Fill" },
  { value: "omit", label: "Remove Rows (Omit)" },
];

const OUTLIER_METHODS = [
  { value: "iqr", label: "IQR" },
  { value: "zscore", label: "Z-Score" },
  { value: "knn", label: "KNN" },
];

const OUTLIER_ACTIONS = [
  { value: "cap", label: "Cap (Winsorise)" },
  { value: "remove", label: "Remove Rows" },
  { value: "mark", label: "Mark For Review" },
  { value: "ignore", label: "Ignore" },
];

const DUPLICATE_STRATEGIES = [
  { value: "keep_first", label: "Keep First Occurrence" },
  { value: "keep_last", label: "Keep Last Occurrence" },
  { value: "remove_all", label: "Remove All Duplicates" },
  { value: "mark", label: "Mark For Review" },
  { value: "keep_all", label: "Keep All (Mark Only)" },
];

const TYPE_INCONSISTENCY_METHODS = [
  { value: "mean", label: "Fill with Mean" },
  { value: "median", label: "Fill with Median" },
  { value: "mode", label: "Fill with Mode" },
];

const VIZ_TYPES = [
  { value: "card", label: "Card" },
  { value: "bar", label: "Bar Chart" },
  { value: "line", label: "Line Chart" },
  { value: "pie", label: "Pie Chart" },
  { value: "scatter", label: "Scatter Plot" },
  { value: "histogram", label: "Histogram" },
];

const OPERATIONS = [
  { value: "greater_than", label: "greater than" },
  { value: "less_than", label: "less than" },
  { value: "equals", label: "equals" },
  { value: "not_equals", label: "not equals" },
  { value: "contains", label: "contains" },
];

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

const Select = ({ value, onChange, options, placeholder, className = "" }) => (
  <select
    value={value}
    onChange={(e) => onChange(e.target.value)}
    className={`w-full px-3 py-2.5 bg-white border border-[#E5E7EB] rounded-[8px] text-sm text-[#101828] font-['Poppins'] focus:outline-none focus:border-[#2B7FFF] transition-colors appearance-none ${className}`}
  >
    {placeholder && (
      <option value="" disabled>
        {placeholder}
      </option>
    )}
    {options.map((o) => (
      <option key={o.value} value={o.value}>
        {o.label}
      </option>
    ))}
  </select>
);

const MultiSelectDropdown = ({
  label,
  columns,
  selected,
  onChange,
  placeholder,
}) => {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    const close = (e) => {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, []);

  const toggle = (name) =>
    onChange(
      selected.includes(name)
        ? selected.filter((n) => n !== name)
        : [...selected, name],
    );

  const displayLabel =
    selected.length === 0
      ? placeholder || "All eligible columns"
      : selected.length === 1
        ? selected[0]
        : `${selected.length} columns selected`;

  return (
    <div ref={ref} className="relative">
      {label && (
        <p className="text-xs font-medium text-[#6A7282] mb-1.5">{label}</p>
      )}
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center justify-between gap-2 px-3 py-2.5 bg-white border border-[#E5E7EB] rounded-[8px] text-sm font-['Poppins'] hover:border-[#2B7FFF] transition-colors"
      >
        <span
          className={
            selected.length === 0 ? "text-[#9CA3AF]" : "text-[#101828]"
          }
        >
          {displayLabel}
        </span>
        <ChevronDown
          className={`w-4 h-4 text-[#6A7282] flex-shrink-0 transition-transform ${open ? "rotate-180" : ""}`}
        />
      </button>

      {open && (
        <div className="absolute z-[500] mt-1 left-0 right-0 bg-white rounded-[10px] border border-[#E5E7EB] shadow-[0_8px_24px_rgba(0,0,0,.13)] max-h-[200px] overflow-y-auto">
          {columns.length === 0 ? (
            <div className="px-4 py-4 text-sm text-center text-[#9CA3AF]">
              No columns
            </div>
          ) : (
            <>
              <button
                type="button"
                onClick={() => onChange([])}
                className="w-full text-left px-4 py-2.5 text-xs text-[#6A7282] hover:bg-[#F9FAFB] border-b border-[#F3F4F6] transition-colors"
              >
                ✕ Clear — apply to all eligible
              </button>
              {columns.map((col) => {
                const checked = selected.includes(col.name);
                return (
                  <div
                    key={col.name}
                    onClick={() => toggle(col.name)}
                    className="flex items-center gap-3 px-4 py-2.5 hover:bg-[#F9FAFB] cursor-pointer"
                  >
                    <div
                      className={`w-4 h-4 rounded-[4px] border-2 flex items-center justify-center flex-shrink-0 transition-colors ${checked ? "bg-[#2B7FFF] border-[#2B7FFF]" : "bg-white border-[#D1D5DB]"}`}
                    >
                      {checked && <Check className="w-2.5 h-2.5 text-white" />}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-[#101828] truncate">
                        {col.name}
                      </p>
                      <p className="text-xs text-[#9CA3AF]">{col.type}</p>
                    </div>
                    <div className="flex gap-1 flex-shrink-0">
                      {col.missingCount > 0 && (
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-[#FEE2E2] text-[#DC2626] font-medium">
                          {col.missingCount} miss.
                        </span>
                      )}
                      {col.outliers > 0 && (
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-[#FEF3C7] text-[#D97706] font-medium">
                          {col.outliers} out.
                        </span>
                      )}
                    </div>
                  </div>
                );
              })}
            </>
          )}
        </div>
      )}
    </div>
  );
};

// Section Card — matches the screenshot style
const SectionCard = ({
  icon: Icon,
  iconColor,
  iconBg,
  title,
  badgeColor = "bg-[#6366F1]",
  children,
  onDelete,
  defaultOpen = true,
}) => {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="bg-white rounded-2xl border border-[#E5E7EB] shadow-sm">
      <div className="px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div
            className={`w-9 h-9 ${iconBg} rounded-[10px] flex items-center justify-center flex-shrink-0`}
          >
            <Icon
              className={`w-4.5 h-4.5 ${iconColor}`}
              style={{ width: 18, height: 18 }}
            />
          </div>
          <div className="flex items-center gap-2.5">
            <h4 className="text-[15px] font-semibold text-[#101828]">
              {title}
            </h4>
            <span
              className={`px-2 py-0.5 rounded-full text-[9px] font-bold text-white ${badgeColor} tracking-wide whitespace-nowrap`}
            >
              ✦ AI RECOMMENDATION
            </span>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {onDelete && (
            <button
              onClick={onDelete}
              className="w-7 h-7 flex items-center justify-center rounded-lg hover:bg-red-50 transition-colors"
            >
              <Trash2 className="w-3.5 h-3.5 text-[#9CA3AF] hover:text-red-500" />
            </button>
          )}
          <button
            onClick={() => setOpen((o) => !o)}
            className="w-7 h-7 flex items-center justify-center rounded-lg hover:bg-gray-100 transition-colors text-[#6A7282] text-lg leading-none"
          >
            {open ? "−" : "+"}
          </button>
        </div>
      </div>
      {open && (
        <div className="px-6 pb-5 pt-1 border-t border-[#F3F4F6]">
          {children}
        </div>
      )}
    </div>
  );
};

// Logic hint
const LogicHint = ({ text }) => (
  <div className="flex items-start gap-2 mt-3 px-3 py-2.5 bg-[#F9FAFB] rounded-lg border border-[#F3F4F6]">
    <span className="text-[#6366F1] mt-0.5 flex-shrink-0">ⓘ</span>
    <p className="text-xs text-[#6A7282]">
      <b>Logic:</b> {text}
    </p>
  </div>
);

const Toast = ({ toast, onClose }) => {
  if (!toast) return null;
  const isErr = toast.type === "error";
  return (
    <div
      className={`fixed bottom-28 left-1/2 -translate-x-1/2 z-[9998] flex items-center gap-3 px-5 py-3.5 rounded-2xl min-w-[340px] max-w-[600px] shadow-[0_8px_30px_rgba(0,0,0,.12)] font-['Poppins'] ${isErr ? "bg-[#FEF2F2] border border-[#FCA5A5]" : "bg-[#F0FFF4] border border-[#86EFAC]"}`}
    >
      <span className="text-xl">{isErr ? "❌" : "✅"}</span>
      <span
        className={`flex-1 text-sm ${isErr ? "text-[#991B1B]" : "text-[#166534]"}`}
      >
        {toast.msg}
      </span>
      <button
        onClick={onClose}
        className="text-[#9CA3AF] hover:text-[#6B7280] text-lg leading-none"
      >
        ✕
      </button>
    </div>
  );
};

// ─────────────────────────────────────────────────────────────────────────────
// Conditional Rule Row
// ─────────────────────────────────────────────────────────────────────────────
const ConditionalRow = ({
  rule,
  columns,
  onUpdate,
  onRemove,
  isElse = false,
}) => (
  <div className="grid grid-cols-[80px_1fr_1fr_1fr_1fr_32px] gap-2 items-center mb-2">
    <span className="text-xs font-semibold text-[#6A7282] text-right pr-1">
      {isElse ? "Else If" : "If"}
    </span>
    <Select
      value={rule.column}
      onChange={(v) => onUpdate({ ...rule, column: v })}
      options={columns.map((c) => ({ value: c.name, label: c.name }))}
      placeholder="Select column"
    />
    <Select
      value={rule.operation}
      onChange={(v) => onUpdate({ ...rule, operation: v })}
      options={OPERATIONS}
    />
    <input
      value={rule.condition}
      onChange={(e) => onUpdate({ ...rule, condition: e.target.value })}
      placeholder="Condition"
      className="w-full px-3 py-2.5 bg-white border border-[#E5E7EB] rounded-[8px] text-sm text-[#101828] font-['Poppins'] focus:outline-none focus:border-[#2B7FFF]"
    />
    <input
      value={rule.value}
      onChange={(e) => onUpdate({ ...rule, value: e.target.value })}
      placeholder="Value"
      className="w-full px-3 py-2.5 bg-white border border-[#E5E7EB] rounded-[8px] text-sm text-[#101828] font-['Poppins'] focus:outline-none focus:border-[#2B7FFF]"
    />
    <button
      onClick={onRemove}
      className="w-7 h-7 flex items-center justify-center rounded-lg hover:bg-red-50"
    >
      <Trash2 className="w-3.5 h-3.5 text-[#9CA3AF]" />
    </button>
  </div>
);

// ─────────────────────────────────────────────────────────────────────────────
// Missing Value Rule Item
// ─────────────────────────────────────────────────────────────────────────────
const MissingRuleItem = ({ rule, columns, allCols, onUpdate, onRemove }) => {
  const [conditionalRules, setConditionalRules] = useState(
    rule.conditionalRules || [],
  );

  const updateRules = (newRules) => {
    setConditionalRules(newRules);
    onUpdate({ ...rule, conditionalRules: newRules });
  };

  const addRule = () =>
    updateRules([
      ...conditionalRules,
      { column: "", operation: "greater_than", condition: "", value: "" },
    ]);

  return (
    <div className="mb-5 pb-5 border-b border-[#F3F4F6] last:border-0 last:mb-0 last:pb-0">
      <div className="grid grid-cols-[1fr_1fr_32px] gap-3 items-end mb-2">
        <div>
          <p className="text-xs font-medium text-[#6A7282] mb-1.5">Method</p>
          <Select
            value={rule.method}
            onChange={(v) => onUpdate({ ...rule, method: v })}
            options={MISSING_STRATEGIES}
          />
        </div>
        <div>
          <MultiSelectDropdown
            label="Selected Columns"
            columns={columns}
            selected={rule.selectedCols || []}
            onChange={(v) => onUpdate({ ...rule, selectedCols: v })}
            placeholder="Select Columns"
          />
        </div>
        <button
          onClick={onRemove}
          className="mb-0.5 w-7 h-7 flex items-center justify-center rounded-lg hover:bg-red-50"
        >
          <Trash2 className="w-3.5 h-3.5 text-[#9CA3AF]" />
        </button>
      </div>

      {rule.method === "conditional" && (
        <div className="ml-2 mt-3 p-4 bg-[#FAFAFA] rounded-xl border border-[#F3F4F6]">
          {conditionalRules.map((cr, i) => (
            <ConditionalRow
              key={i}
              rule={cr}
              columns={allCols}
              isElse={i > 0}
              onUpdate={(updated) => {
                const newRules = [...conditionalRules];
                newRules[i] = updated;
                updateRules(newRules);
              }}
              onRemove={() =>
                updateRules(conditionalRules.filter((_, idx) => idx !== i))
              }
            />
          ))}
          {/* Else row */}
          <div className="grid grid-cols-[80px_1fr_1fr_32px] gap-2 items-center mb-2">
            <span className="text-xs font-semibold text-[#6A7282] text-right pr-1">
              Else
            </span>
            <div className="col-span-2">
              <input
                value={rule.elseValue || ""}
                onChange={(e) =>
                  onUpdate({ ...rule, elseValue: e.target.value })
                }
                placeholder="None"
                className="w-full px-3 py-2.5 bg-white border border-[#E5E7EB] rounded-[8px] text-sm text-[#101828] font-['Poppins'] focus:outline-none focus:border-[#2B7FFF]"
              />
            </div>
            <div />
          </div>
          <button
            onClick={addRule}
            className="flex items-center gap-1.5 text-xs text-[#6366F1] hover:text-[#4F46E5] mt-1"
          >
            <Plus className="w-3 h-3" /> Add Condition
          </button>
        </div>
      )}

      <LogicHint
        text={
          rule.method === "mean"
            ? "Fill with Mean: for consistent completion and optimal algorithm performance in academic datasets."
            : rule.method === "conditional"
              ? "Conditionally, if a column value is below a defined threshold, it is labeled accordingly; otherwise, the original value is shown."
              : rule.method === "median"
                ? "Fill with Median: robust to outliers, ideal for skewed distributions."
                : rule.method === "mode"
                  ? "Fill with Mode: best for categorical columns with a dominant value."
                  : rule.method === "knn_impute"
                    ? "KNN Imputation: uses nearest neighbors to predict missing values."
                    : rule.method === "constant"
                      ? "Fill with Constant: replaces all missing values with the specified constant."
                      : "Removes rows with missing values from the dataset."
        }
      />
    </div>
  );
};

// ─────────────────────────────────────────────────────────────────────────────
// Visualization Rule Item
// ─────────────────────────────────────────────────────────────────────────────
const VizRuleItem = ({ rule, allCols, onUpdate, onRemove }) => {
  const logicMap = {
    card: "A card counter shows the total count per number.",
    pie: "The pie chart shows the distribution of categories based on count.",
    bar: "The bar chart shows the distribution of respondents by category.",
    line: "The line chart shows trends over time.",
    scatter: "The scatter plot shows correlation between two variables.",
    histogram: "The histogram shows the frequency distribution of values.",
  };

  const isCard = rule.vizType === "card";
  const isPie = rule.vizType === "pie";
  const typeOf = (col) => (col.type || "").toLowerCase();
  const isNumeric = (col) => {
    const t = typeOf(col);
    return t === "integer" || t === "decimal";
  };
  const isDate = (col) => typeOf(col) === "datetime";
  const numericCols = allCols.filter(isNumeric);
  const categoricalCols = allCols.filter((col) => !isNumeric(col));
  const xOptions =
    rule.vizType === "scatter" || rule.vizType === "histogram"
      ? numericCols
      : rule.vizType === "line"
        ? [...numericCols, ...allCols.filter(isDate)]
        : rule.vizType === "bar"
          ? categoricalCols
          : allCols;
  const yOptions =
    rule.vizType === "bar" ||
    rule.vizType === "line" ||
    rule.vizType === "scatter"
      ? numericCols
      : [];
  return (
    <div className="mb-4 pb-4 border-b border-[#F3F4F6] last:border-0 last:mb-0 last:pb-0">
      <div
        className={`grid gap-3 items-end ${
          isPie || isCard
            ? "grid-cols-[1fr_1fr_32px]"
            : "grid-cols-[1fr_1fr_1fr_32px]"
        }`}
      >
        <div>
          <p className="text-xs font-medium text-[#6A7282] mb-1.5">
            Visualization Graph
          </p>
          <Select
            value={rule.vizType || ""}
            onChange={(v) =>
              onUpdate(
                v === "card"
                  ? { ...rule, vizType: v, yColumn: "", selectedCols: [] }
                  : v === "pie"
                    ? {
                        ...rule,
                        vizType: v,
                        column: "",
                        yColumn: "",
                        selectedCols: rule.selectedCols || [],
                      }
                    : { ...rule, vizType: v, selectedCols: [] },
              )
            }
            options={VIZ_TYPES}
            placeholder="Select Graph"
          />
        </div>
        {(isCard || !isPie) && (
          <div>
            <p className="text-xs font-medium text-[#6A7282] mb-1.5">
              {isCard ? "Column" : "X Axis"}
            </p>
            <Select
              value={rule.column || ""}
              onChange={(v) => onUpdate({ ...rule, column: v })}
              options={xOptions.map((c) => ({ value: c.name, label: c.name }))}
              placeholder="Select Column"
            />
          </div>
        )}
        {isPie && (
          <div>
            <MultiSelectDropdown
              label="Columns"
              columns={categoricalCols}
              selected={rule.selectedCols || []}
              onChange={(v) => onUpdate({ ...rule, selectedCols: v })}
              placeholder="Select Columns"
            />
          </div>
        )}
        {!isCard && !isPie && (
          <div>
            <p className="text-xs font-medium text-[#6A7282] mb-1.5">Y Axis</p>
            <Select
              value={rule.yColumn || ""}
              onChange={(v) => onUpdate({ ...rule, yColumn: v })}
              options={yOptions.map((c) => ({ value: c.name, label: c.name }))}
              placeholder="Select Column"
            />
          </div>
        )}
        <button
          onClick={onRemove}
          className="mb-0.5 w-7 h-7 flex items-center justify-center rounded-lg hover:bg-red-50"
        >
          <Trash2 className="w-3.5 h-3.5 text-[#9CA3AF]" />
        </button>
      </div>
      {rule.vizType && (
        <LogicHint text={logicMap[rule.vizType] || "Visualize this column."} />
      )}
    </div>
  );
};

// ─────────────────────────────────────────────────────────────────────────────
// CleaningPage
// ─────────────────────────────────────────────────────────────────────────────

export const CleaningPage = () => {
  const navigate = useNavigate();

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
    sessionId,
    refreshProfile,
    saveChanges,
    resetChanges,
    updateCell,
    imputeColumn,
    batchImpute,
    handleDuplicates,
    handleOutliers,
    batchOutliers,
    handleTypeInconsistencies,
    cleaningSteps,
  } = useDataProfiler();

  useEffect(() => {
    if (!sessionId && !isLoading) {
      navigate("/upload");
    }
  }, [sessionId, isLoading, navigate]);

  // Modal state
  const [modalOpen, setModalOpen] = useState(false);
  const [modalType, setModalType] = useState(null);
  const [modalColumn, setModalColumn] = useState(null);

  const [activeTab, setActiveTab] = useState("automated");
  const [toast, setToast] = useState(null);
  const [runningAll, setRunningAll] = useState(false);
  const [showErrorsOnly, setShowErrorsOnly] = useState(false);
  const [previewQuery, setPreviewQuery] = useState("");
  const [processingStep, setProcessingStep] = useState(null);
  const [processingLog, setProcessingLog] = useState([]);
  const [stepInsights, setStepInsights] = useState([]);
  const [cellEditing, setCellEditing] = useState(null);
  const [cellEditValue, setCellEditValue] = useState("");
  const [cellSaving, setCellSaving] = useState(false);
  const [savingChanges, setSavingChanges] = useState(false);
  const [tableRows, setTableRows] = useState([]);
  const [tableColumns, setTableColumns] = useState([]);
  const [tableTotal, setTableTotal] = useState(0);
  const [tableOffset, setTableOffset] = useState(0);
  const [tableLoading, setTableLoading] = useState(false);
  const [tableHasMore, setTableHasMore] = useState(false);
  const [tableScrollTop, setTableScrollTop] = useState(0);
  const [tableViewportHeight, setTableViewportHeight] = useState(0);
  const tableViewportRef = useRef(null);
  const tableRequestIdRef = useRef(0);
  const tableScrollRafRef = useRef(null);
  const tableScrollTopRef = useRef(0);
  const tableViewportHeightRef = useRef(0);
  const appendLog = useCallback((msg) => {
    setProcessingLog((l) =>
      [...l, `${new Date().toLocaleTimeString()} — ${msg}`].slice(-12),
    );
    console.log(`[CleanLogic] ${msg}`);
  }, []);

  const stats = useMemo(() => {
    if (!profile) return null;
    const { metadata, issues_summary } = profile;
    return {
      rows: metadata?.total_rows || 0,
      cols: metadata?.total_columns || 0,
      issues: issues_summary || {
        total_issues: 0,
        missing: 0,
        outliers: 0,
        type_inconsistencies: 0,
      },
    };
  }, [profile]);

  const parseInsight = (text) => {
    const lines = String(text || "")
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean);
    let why = "";
    let process = "";
    lines.forEach((line) => {
      if (line.toLowerCase().startsWith("why:")) {
        why = line.slice(4).trim();
      } else if (line.toLowerCase().startsWith("process:")) {
        process = line.slice(8).trim();
      }
    });
    if (!why && lines.length) why = lines[0];
    if (!process && lines.length > 1) process = lines.slice(1).join(" ");
    return { why, process };
  };

  const addStepInsight = useCallback((entry) => {
    setStepInsights((prev) => [
      ...prev,
      { id: Date.now() + Math.random(), ...entry },
    ]);
  }, []);

  useEffect(() => {
    if (!sessionId) return;
    try {
      localStorage.setItem(
        `cleanlogic_step_insights_${sessionId}`,
        JSON.stringify(stepInsights),
      );
    } catch {
      return;
    }
  }, [sessionId, stepInsights]);

  const generateStepInsight = useCallback(
    async ({ title, targets, summary }) => {
      const prompt = `Provide two short sections labeled "Why:" and "Process:" explaining why the step "${title}" matters and what was executed. Keep each section to 1-2 sentences. Context: ${summary}`;
      try {
        const result = await ApiService.explainVisualization({
          prompt,
          context: {
            step: title,
            targets,
            summary,
            dataset: {
              rows: stats?.rows || 0,
              cols: stats?.cols || 0,
            },
          },
        });
        const parsed = parseInsight(result?.text);
        addStepInsight({
          title,
          targets,
          why: parsed.why,
          process: parsed.process,
        });
      } catch {
        addStepInsight({
          title,
          targets,
          why: summary,
          process: "",
        });
      }
    },
    [addStepInsight, parseInsight, stats],
  );

  // Missing rules array
  const [missingRules, setMissingRules] = useState([
    {
      id: 1,
      method: "mean",
      selectedCols: [],
      conditionalRules: [],
      elseValue: "",
    },
  ]);

  // Duplicate config
  const [dupMethod, setDupMethod] = useState("mark");
  const [dupTarget, setDupTarget] = useState([]);

  // Outlier config
  const [outlierMethod, setOutlierMethod] = useState("iqr");
  const [outlierTarget, setOutlierTarget] = useState([]);
  const [outlierParam, setOutlierParam] = useState(1.5);
  const [outlierAction, setOutlierAction] = useState("cap");

  const [typeMethod, setTypeMethod] = useState("mode");
  const [typeTarget, setTypeTarget] = useState([]);
  const [typeNumericOnly, setTypeNumericOnly] = useState(true);
  const [typeNumericCleanup, setTypeNumericCleanup] = useState(true);

  const [aiAutoConfig, setAiAutoConfig] = useState(null);

  // Viz rules
  const [vizRules, setVizRules] = useState([]);
  useEffect(() => {
    if (!sessionId) return;
    const initKey = `cleanlogic_viz_initialized_${sessionId}`;
    const hashKey = `cleanlogic_viz_rules_hash_${sessionId}`;
    const idsKey = `cleanlogic_viz_ids_${sessionId}`;
    try {
      const alreadyInitialized = localStorage.getItem(initKey) === "1";
      if (!alreadyInitialized) {
        setVizRules([]);
        localStorage.setItem("cleanlogic_viz_rules", "[]");
        localStorage.removeItem(hashKey);
        localStorage.removeItem(idsKey);
        localStorage.setItem(initKey, "1");
      }
    } catch {
      return;
    }
  }, [sessionId]);
  useEffect(() => {
    try {
      localStorage.setItem("cleanlogic_viz_rules", JSON.stringify(vizRules));
    } catch {
      return;
    }
  }, [vizRules]);

  // ── Derived data ─────────────────────────────────────────────────────────

  const tablePageSize = 10;

  const columnStats = useMemo(() => {
    if (!profile?.columns) return [];
    return profile.columns.map((col) => ({
      name: col.name,
      type: col.data_type || col.type,
      completeness: col.non_null_count
        ? ((col.non_null_count / col.total_count) * 100).toFixed(1)
        : "0.0",
      missingCount: col.missing_count || 0,
      uniqueValues: col.unique_count || 0,
      outliers: col.outlier_count || 0,
      typeErrors: col.type_inconsistency_count || 0,
    }));
  }, [profile]);

  const allColumns = useMemo(() => {
    const names =
      profile?.data?.columns || profile?.columns?.map((c) => c.name) || [];
    const statsMap = new Map(columnStats.map((c) => [c.name, c]));
    return names.map((name) => {
      const stats = statsMap.get(name);
      return (
        stats || {
          name,
          type: "Text",
          missingCount: 0,
          outliers: 0,
        }
      );
    });
  }, [profile, columnStats]);

  const columnNames = useMemo(
    () => columnStats.map((col) => col.name),
    [columnStats],
  );

  useEffect(() => {
    if (columnNames.length === 0) return;
    setMissingRules((rules) =>
      rules.map((rule) => ({
        ...rule,
        selectedCols: (rule.selectedCols || []).filter((col) =>
          columnNames.includes(col),
        ),
      })),
    );
    setDupTarget((cols) => cols.filter((col) => columnNames.includes(col)));
    setOutlierTarget((cols) => cols.filter((col) => columnNames.includes(col)));
    setTypeTarget((cols) => cols.filter((col) => columnNames.includes(col)));
    setVizRules((rules) =>
      rules.map((rule) => ({
        ...rule,
        column: columnNames.includes(rule.column) ? rule.column : "",
        yColumn: columnNames.includes(rule.yColumn) ? rule.yColumn : "",
        selectedCols: (rule.selectedCols || []).filter((col) =>
          columnNames.includes(col),
        ),
      })),
    );
    if (selectedColumn && !columnNames.includes(selectedColumn)) {
      selectColumn(null);
    }
  }, [
    columnNames,
    selectedColumn,
    selectColumn,
    setMissingRules,
    setDupTarget,
    setOutlierTarget,
    setTypeTarget,
    setVizRules,
  ]);

  const colsWithMissing = useMemo(
    () => columnStats.filter((c) => c.missingCount > 0),
    [columnStats],
  );
  const numericColsWithOutliers = useMemo(
    () =>
      columnStats.filter((c) => {
        const t = (c.type || "").toLowerCase();
        return c.outliers > 0 && (t === "integer" || t === "decimal");
      }),
    [columnStats],
  );
  const colsWithTypeErrors = useMemo(
    () => columnStats.filter((c) => (c.typeErrors || 0) > 0),
    [columnStats],
  );
  const numericColsWithTypeErrors = useMemo(
    () =>
      colsWithTypeErrors.filter((c) => {
        const t = (c.type || "").toLowerCase();
        return t === "integer" || t === "decimal";
      }),
    [colsWithTypeErrors],
  );

  useEffect(() => {
    const outlierAllowed = new Set(numericColsWithOutliers.map((c) => c.name));
    setOutlierTarget((selected) =>
      selected.filter((col) => outlierAllowed.has(col)),
    );

    const typeCandidates = typeNumericOnly
      ? numericColsWithTypeErrors
      : colsWithTypeErrors;
    const typeAllowed = new Set(typeCandidates.map((c) => c.name));
    setTypeTarget((selected) => selected.filter((col) => typeAllowed.has(col)));
  }, [
    numericColsWithOutliers,
    numericColsWithTypeErrors,
    colsWithTypeErrors,
    typeNumericOnly,
  ]);

  const columnMeta = useMemo(() => {
    if (!profile?.columns) return [];
    return profile.columns.map((col) => {
      const total =
        col.total_count ?? (col.non_null_count ?? 0) + (col.missing_count ?? 0);
      return {
        name: col.name,
        type: (col.data_type || col.type || "").toLowerCase(),
        total: total || 0,
        missing: col.missing_count || 0,
        outliers: col.outlier_count || 0,
      };
    });
  }, [profile]);

  const autoConfig = useMemo(() => {
    if (!profile?.columns) return null;
    const missingThreshold = 0.5;
    const highMissing = [];
    const numericMissing = [];
    const textMissing = [];
    columnMeta.forEach((c) => {
      if (!c.missing || !c.total) return;
      const ratio = c.missing / c.total;
      if (ratio >= missingThreshold) {
        highMissing.push(c.name);
      } else if (c.type === "integer" || c.type === "decimal") {
        numericMissing.push(c.name);
      } else {
        textMissing.push(c.name);
      }
    });
    const rules = [];
    const makeRule = (method, cols) => {
      if (!cols.length) return;
      rules.push({
        id: Date.now() + rules.length,
        method,
        selectedCols: cols,
        conditionalRules: [],
        elseValue: "",
      });
    };
    makeRule("omit", highMissing);
    makeRule("mean", numericMissing);
    makeRule("mode", textMissing);
    if (rules.length === 0) {
      rules.push({
        id: Date.now(),
        method: "mean",
        selectedCols: [],
        conditionalRules: [],
        elseValue: "",
      });
    }
    const outlierTargets = columnMeta
      .filter(
        (c) => c.outliers > 0 && (c.type === "integer" || c.type === "decimal"),
      )
      .map((c) => c.name);
    const outlierRatioMax = columnMeta.reduce((max, c) => {
      if (c.outliers > 0 && c.total > 0) {
        return Math.max(max, c.outliers / c.total);
      }
      return max;
    }, 0);
    const recommendedAction =
      outlierTargets.length === 0
        ? "ignore"
        : outlierRatioMax >= 0.1
          ? "remove"
          : "cap";
    return {
      missingRules: rules,
      dupMethod: "keep_first",
      dupTarget: [],
      outlierMethod: "iqr",
      outlierAction: recommendedAction,
      outlierTarget: outlierTargets,
      outlierParam: 1.5,
      typeMethod: "mode",
      typeTarget: columnMeta
        .filter((c) => c.type === "integer" || c.type === "decimal")
        .map((c) => c.name),
      typeNumericOnly: true,
      typeNumericCleanup: true,
    };
  }, [profile, columnMeta]);

  const readAiAutoConfig = useCallback(() => {
    if (!sessionId) return null;
    try {
      const raw = localStorage.getItem(
        `cleanlogic_ai_recommendation_${sessionId}`,
      );
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  }, [sessionId]);

  useEffect(() => {
    if (!sessionId) return;
    const load = () => setAiAutoConfig(readAiAutoConfig());
    const pendingKey = `cleanlogic_ai_autofill_pending_${sessionId}`;
    load();
    const onStorage = (event) => {
      if (event.key === `cleanlogic_ai_recommendation_${sessionId}`) {
        load();
      }
      if (event.key === pendingKey) {
        load();
      }
    };
    window.addEventListener("storage", onStorage);
    window.addEventListener("focus", load);
    return () => {
      window.removeEventListener("storage", onStorage);
      window.removeEventListener("focus", load);
    };
  }, [sessionId, readAiAutoConfig]);

  useEffect(() => {
    if (!sessionId || aiAutoConfig) return;
    ApiService.getAiSummary(sessionId)
      .then((result) => {
        if (!result?.summary || !result?.config) return;
        const payload = {
          sessionId,
          text: result.summary,
          config: result.config,
          generated_at: Date.now(),
        };
        setAiAutoConfig(payload);
        try {
          localStorage.setItem(
            `cleanlogic_ai_recommendation_${sessionId}`,
            JSON.stringify(payload),
          );
        } catch {
          return;
        }
      })
      .catch(() => {
        return;
      });
  }, [sessionId, aiAutoConfig]);

  const applyAutoConfig = useCallback((config, fallback) => {
    if (!config) return;
    const missingRulesRaw = Array.isArray(config.missing_rules)
      ? config.missing_rules
      : [];
    const builtMissingRules = missingRulesRaw.map((rule, idx) => ({
      id: Date.now() + idx,
      method: rule.method || "mean",
      selectedCols: Array.isArray(rule.columns) ? rule.columns : [],
      conditionalRules: [],
      elseValue: rule.constant_value || "",
    }));
    const missingRules =
      builtMissingRules.length > 0
        ? builtMissingRules
        : fallback?.missingRules || [];
    if (missingRules.length > 0) setMissingRules(missingRules);

    const dup = config.duplicates || {};
    setDupMethod(dup.method || fallback?.dupMethod || "keep_first");
    setDupTarget(
      Array.isArray(dup.columns) ? dup.columns : fallback?.dupTarget || [],
    );

    const outlier = config.outlier || {};
    setOutlierMethod(outlier.method || fallback?.outlierMethod || "iqr");
    setOutlierAction(outlier.action || fallback?.outlierAction || "cap");
    setOutlierTarget(
      Array.isArray(outlier.columns)
        ? outlier.columns
        : fallback?.outlierTarget || [],
    );
    setOutlierParam(
      Number.isFinite(outlier.param)
        ? outlier.param
        : (fallback?.outlierParam ?? 1.5),
    );

    const typeInconsistencies = config.type_inconsistencies || {};
    setTypeMethod(typeInconsistencies.method || fallback?.typeMethod || "mode");
    setTypeTarget(
      Array.isArray(typeInconsistencies.columns)
        ? typeInconsistencies.columns
        : fallback?.typeTarget || [],
    );
    setTypeNumericOnly(
      typeof typeInconsistencies.numeric_only === "boolean"
        ? typeInconsistencies.numeric_only
        : (fallback?.typeNumericOnly ?? true),
    );
    setTypeNumericCleanup(
      typeof typeInconsistencies.numeric_cleanup === "boolean"
        ? typeInconsistencies.numeric_cleanup
        : (fallback?.typeNumericCleanup ?? true),
    );
  }, []);

  useEffect(() => {
    if (activeTab !== "automated") return;
    const pendingKey = sessionId
      ? `cleanlogic_ai_autofill_pending_${sessionId}`
      : null;
    const pending = pendingKey && localStorage.getItem(pendingKey) === "1";
    const current = aiAutoConfig || readAiAutoConfig();
    if (current?.config) {
      applyAutoConfig(current.config, autoConfig);
      if (pendingKey && pending) localStorage.removeItem(pendingKey);
      return;
    }
    if (!autoConfig) return;
    setMissingRules(autoConfig.missingRules);
    setDupMethod(autoConfig.dupMethod);
    setDupTarget(autoConfig.dupTarget);
    setOutlierMethod(autoConfig.outlierMethod);
    setOutlierAction(autoConfig.outlierAction);
    setOutlierTarget(autoConfig.outlierTarget);
    setOutlierParam(autoConfig.outlierParam);
    setTypeMethod(autoConfig.typeMethod);
    setTypeTarget(autoConfig.typeTarget);
    setTypeNumericOnly(autoConfig.typeNumericOnly);
    setTypeNumericCleanup(autoConfig.typeNumericCleanup);
  }, [
    activeTab,
    autoConfig,
    aiAutoConfig,
    applyAutoConfig,
    readAiAutoConfig,
    sessionId,
  ]);

  // ── Cell helpers ─────────────────────────────────────────────────────────

  const getCellIssues = useCallback(
    (rowIndex, columnName) => {
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
    },
    [profile],
  );

  const getCellClassName = (issues) => {
    if (!issues || issues.length === 0) return "text-[#364153]";
    if (issues.some((i) => i.type === "missing"))
      return "px-2 py-0.5 bg-[#FB2C36]/20 rounded text-sm text-[#FF6467] font-medium";
    if (issues.some((i) => i.type === "type_inconsistency"))
      return "px-2 py-0.5 bg-[#AD46FF]/20 rounded text-sm text-[#C27AFF] font-medium";
    if (issues.some((i) => i.type === "outlier"))
      return "px-2 py-0.5 bg-[#F0B000]/20 rounded text-sm text-[#F0B000] font-medium";
    return "text-[#364153]";
  };

  const formatCellValue = (value) => {
    if (value === null || value === undefined) return value;
    if (typeof value === "number" && Number.isFinite(value)) {
      return value.toFixed(1);
    }
    if (typeof value === "string") {
      const trimmed = value.trim();
      if (!trimmed) return value;
      const numeric = Number(trimmed);
      return Number.isFinite(numeric) ? numeric.toFixed(1) : value;
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

  // ── Modal helpers ─────────────────────────────────────────────────────────

  const openModal = (type, columnName) => {
    setModalType(type);
    setModalColumn(columnName);
    setModalOpen(true);
  };
  const openDetailsCard = async (columnName) => {
    await selectColumn(columnName);
  };
  const closeModal = () => {
    setModalOpen(false);
    setModalType(null);
    setModalColumn(null);
  };
  const handleValueUpdated = async () => {
    await refreshProfile();
    if (selectedColumn && sessionId) await selectColumn(selectedColumn);
  };

  const loadTablePage = useCallback(
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

  const showToast = useCallback((msg, type = "success") => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 5000);
  }, []);

  const refreshAfterCleaning = useCallback(async () => {
    await refreshProfile();
    await loadTablePage(0, false);
    if (selectedColumn && sessionId) await selectColumn(selectedColumn);
  }, [refreshProfile, loadTablePage, selectedColumn, sessionId, selectColumn]);

  useEffect(() => {
    const checkMergedCells = async () => {
      if (!sessionId || !profile) return;
      const key = `cleanlogic_merge_cells_prompted_${sessionId}`;
      if (localStorage.getItem(key) === "1") return;
      try {
        const result = await ApiService.getMergeCells(sessionId);
        const ranges = result?.merged_ranges || [];
        if (ranges.length > 0) {
          const forward = window.confirm(
            `This Excel file has merged cells (${ranges.length} ranges detected).\n\nDo you want to forward-fill merged cells across columns?\n\nOK = Forward Fill\nCancel = Leave as empty`
          );
          localStorage.setItem(key, "1");
          if (forward) {
            const ops = columnNames.map((col) => ({
              column: col,
              strategy: "forward_fill",
            }));
            try {
              await batchImpute(ops);
              await refreshAfterCleaning();
              showToast("Forward fill applied for merged cells");
            } catch (e) {
              showToast(e?.message || "Forward fill failed", "error");
            }
          } else {
            showToast("Merged cells left as empty");
          }
        }
      } catch {
        // ignore detection errors silently
      }
    };
    checkMergedCells();
  }, [sessionId, profile, columnNames, batchImpute, refreshAfterCleaning, showToast]);

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

  const handleTableScroll = useCallback(
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

  const startCellEdit = (rowIdx, colName, currentValue) => {
    setCellEditing({ rowIdx, colName });
    setCellEditValue(currentValue == null ? "" : String(currentValue));
  };
  const cancelCellEdit = () => {
    setCellEditing(null);
    setCellEditValue("");
  };
  const commitCellEdit = async () => {
    if (!cellEditing) return;
    const { rowIdx, colName } = cellEditing;
    const valueForSave =
      typeof cellEditValue === "string" && cellEditValue.trim() === ""
        ? null
        : cellEditValue;
    setCellSaving(true);
    try {
      await updateCell(rowIdx, colName, valueForSave);
      setTableRows((prev) =>
        prev.map((row, idx) => {
          const actualRowIdx = row._index ?? idx;
          if (actualRowIdx !== rowIdx) return row;
          const existing = row[colName];
          const nextValue =
            existing && typeof existing === "object"
              ? {
                  ...existing,
                  value: valueForSave,
                  display_value: valueForSave,
                  issues: undefined,
                }
              : valueForSave;
          return { ...row, [colName]: nextValue };
        }),
      );
      setCellEditing(null);
      setCellEditValue("");
    } finally {
      setCellSaving(false);
    }
  };

  // ── Cleaning operations ───────────────────────────────────────────────────

  const runImputation = useCallback(async () => {
    const targets = colsWithMissing.map((c) => c.name);
    if (!targets.length) {
      showToast("No missing values to impute", "error");
      return;
    }
    try {
      const ops = targets.map((col) => ({
        column: col,
        strategy: "mean",
        knn_neighbors: 5,
      }));
      const r = await batchImpute(ops);
      showToast(r?.message || `Imputed ${targets.length} column(s)`);
      await refreshAfterCleaning();
    } catch (e) {
      showToast(e?.message || "Imputation failed", "error");
    }
  }, [colsWithMissing, batchImpute, showToast, refreshAfterCleaning]);

  const runMissingRules = useCallback(
    async (options = {}) => {
      const { silent = false, fallbackColumns = [] } = options;
      const activeRules = missingRules.filter(
        (r) => r && (r.selectedCols?.length || r.method),
      );
      if (activeRules.length === 0) {
        showToast("No missing rules configured", "error");
        return false;
      }
      if (!silent) {
        setRunningAll(true);
        setProcessingStep("Applying missing rules…");
        setProcessingLog([]);
      }
      let didRun = false;
      try {
        let fallbackUsed = false;
        for (const rule of activeRules) {
          let cols = rule.selectedCols?.length ? rule.selectedCols : [];
          if (!cols.length && fallbackColumns.length && !fallbackUsed) {
            cols = fallbackColumns;
            fallbackUsed = true;
          }
          if (!cols.length) {
            appendLog("Skip: Missing rule (no selected columns)");
            continue;
          }
          if (rule.method === "conditional") {
            appendLog("Skip: Conditional missing rule (unsupported)");
            continue;
          }
          if (rule.method === "constant" && !rule.elseValue) {
            appendLog("Skip: Constant missing rule (no value)");
            continue;
          }
          setProcessingStep(
            `Missing: ${rule.method} (${cols.length} column${cols.length > 1 ? "s" : ""})`,
          );
          appendLog(`Start: Missing (${rule.method})`);
          const ops = cols.map((col) => ({
            column: col,
            strategy: rule.method,
            constant_value: rule.elseValue || undefined,
          }));
          await batchImpute(ops);
          appendLog("Done: Missing");
          await generateStepInsight({
            title: "Missing Data",
            targets: cols,
            summary: `${rule.method} imputation on ${cols.length} column(s).`,
          });
          didRun = true;
        }
        if (!didRun) {
          showToast(
            "Missing values must be handled before continuing",
            "error",
          );
          return false;
        }
        showToast("✅ Missing rules applied");
        await refreshAfterCleaning();
        return true;
      } catch (e) {
        showToast(e?.message || "Missing rules failed", "error");
        appendLog(`Error: ${e?.message || e}`);
        return false;
      } finally {
        if (!silent) {
          setProcessingStep(null);
          setRunningAll(false);
        }
      }
    },
    [
      missingRules,
      batchImpute,
      showToast,
      appendLog,
      refreshAfterCleaning,
      generateStepInsight,
    ],
  );

  const runDuplicates = useCallback(async () => {
    try {
      const r = await handleDuplicates({
        strategy: dupMethod,
        columns: dupTarget.length > 0 ? dupTarget : undefined,
      });
      showToast(r?.message || "Duplicates handled");
      await generateStepInsight({
        title: "Duplicates",
        targets: dupTarget,
        summary: `${dupMethod} duplicates handling${
          dupTarget.length ? ` on ${dupTarget.join(", ")}` : ""
        }.`,
      });
      await refreshAfterCleaning();
    } catch (e) {
      showToast(e?.message || "Failed", "error");
    }
  }, [
    dupMethod,
    dupTarget,
    handleDuplicates,
    showToast,
    refreshAfterCleaning,
    generateStepInsight,
  ]);

  const runDuplicatesWithWindow = useCallback(async () => {
    setRunningAll(true);
    setProcessingStep("Handling duplicates…");
    setProcessingLog([]);
    try {
      appendLog(
        `Start: Duplicates (${dupMethod}${dupTarget.length ? ` / subset: ${dupTarget.join(", ")}` : ""})`,
      );
      await runDuplicates();
      appendLog("Done: Duplicates");
    } catch (e) {
      appendLog(`Error: ${e?.message || e}`);
    } finally {
      setProcessingStep(null);
      setRunningAll(false);
    }
  }, [dupMethod, dupTarget, runDuplicates, appendLog]);

  const runOutliers = useCallback(async () => {
    const targets =
      outlierTarget.length > 0
        ? outlierTarget
        : numericColsWithOutliers.map((c) => c.name);
    if (!targets.length) {
      showToast("No numeric outliers to handle", "error");
      return false;
    }
    try {
      const action = outlierAction === "mark" ? "ignore" : outlierAction;
      const strat = `${outlierMethod}_${action}`;
      const ops = targets.map((col) => ({
        column: col,
        strategy: strat,
        ...(outlierMethod === "iqr"
          ? { iqr_multiplier: outlierParam }
          : outlierMethod === "zscore"
            ? { zscore_threshold: outlierParam }
            : outlierMethod === "knn"
              ? { knn_neighbors: 20 }
              : {}),
      }));
      const r = await batchOutliers(ops);
      showToast(
        r?.message || `Outliers handled in ${targets.length} column(s)`,
      );
      await generateStepInsight({
        title: "Outliers",
        targets,
        summary: `${outlierMethod} detection with ${outlierAction} on ${targets.length} column(s).`,
      });
      await refreshAfterCleaning();
      return true;
    } catch (e) {
      showToast(e?.message || "Failed", "error");
      return false;
    }
  }, [
    outlierTarget,
    numericColsWithOutliers,
    outlierMethod,
    outlierParam,
    outlierAction,
    batchOutliers,
    showToast,
    refreshAfterCleaning,
    generateStepInsight,
  ]);

  const runOutliersWithWindow = useCallback(async () => {
    setRunningAll(true);
    setProcessingStep("Handling outliers…");
    setProcessingLog([]);
    try {
      appendLog(`Start: Outliers (${outlierMethod})`);
      await runOutliers();
      appendLog("Done: Outliers");
    } catch (e) {
      appendLog(`Error: ${e?.message || e}`);
    } finally {
      setProcessingStep(null);
      setRunningAll(false);
    }
  }, [outlierMethod, outlierAction, runOutliers, appendLog]);

  const runTypeInconsistencies = useCallback(async () => {
    const candidates = typeNumericOnly
      ? numericColsWithTypeErrors
      : colsWithTypeErrors;
    const targets =
      typeTarget.length > 0 ? typeTarget : candidates.map((c) => c.name);
    if (!targets.length) {
      showToast("No type inconsistencies to handle", "error");
      return false;
    }
    try {
      const result = await handleTypeInconsistencies({
        method: typeMethod,
        columns: targets,
        numeric_only: typeNumericOnly,
        numeric_cleanup: typeNumericCleanup,
      });
      showToast(
        result?.message ||
          `Type inconsistencies handled in ${targets.length} column(s)`,
      );
      await generateStepInsight({
        title: "Type Inconsistencies",
        targets,
        summary: `${typeMethod} strategy with numeric cleanup on ${targets.length} column(s).`,
      });
      await refreshAfterCleaning();
      return true;
    } catch (e) {
      showToast(e?.message || "Failed", "error");
      return false;
    }
  }, [
    typeTarget,
    typeNumericOnly,
    typeNumericCleanup,
    typeMethod,
    numericColsWithTypeErrors,
    colsWithTypeErrors,
    handleTypeInconsistencies,
    showToast,
    generateStepInsight,
    refreshAfterCleaning,
  ]);

  const runTypeInconsistenciesWithWindow = useCallback(async () => {
    setRunningAll(true);
    setProcessingStep("Fixing type inconsistencies…");
    setProcessingLog([]);
    try {
      appendLog(`Start: Type inconsistencies (${typeMethod})`);
      await runTypeInconsistencies();
      appendLog("Done: Type inconsistencies");
    } catch (e) {
      appendLog(`Error: ${e?.message || e}`);
    } finally {
      setProcessingStep(null);
      setRunningAll(false);
    }
  }, [typeMethod, runTypeInconsistencies, appendLog]);

  const runAutomated = useCallback(async () => {
    setRunningAll(true);
    setProcessingStep(null);
    setProcessingLog([]);
    try {
      if (colsWithMissing.length > 0) {
        setProcessingStep("Imputing missing values…");
        appendLog("Start: Imputing missing values");
        const missingHandled = await runMissingRules({
          silent: true,
          fallbackColumns: colsWithMissing.map((c) => c.name),
        });
        if (!missingHandled) return;
        appendLog("Done: Imputation");
      }
      if (colsWithTypeErrors.length > 0) {
        setProcessingStep("Fixing type inconsistencies…");
        appendLog(`Start: Type inconsistencies (${typeMethod})`);
        const typeHandled = await runTypeInconsistencies();
        if (!typeHandled) return;
        appendLog("Done: Type inconsistencies");
      }
      if (numericColsWithOutliers.length > 0) {
        setProcessingStep("Handling outliers…");
        appendLog(`Start: Outliers (${outlierMethod})`);
        const outliersHandled = await runOutliers();
        if (!outliersHandled) return;
        appendLog("Done: Outliers");
      }
      const shouldRunDuplicates = dupMethod !== "mark" || dupTarget.length > 0;
      if (shouldRunDuplicates) {
        setProcessingStep("Handling duplicates…");
        appendLog(
          `Start: Duplicates (${dupMethod}${dupTarget.length ? ` / subset: ${dupTarget.join(", ")}` : ""})`,
        );
        await runDuplicates();
        appendLog("Done: Duplicates");
      } else {
        appendLog("Skip: Duplicates (no action selected)");
      }
      const vizTargets = Array.from(
        new Set(
          vizRules.flatMap((rule) => {
            if (rule.vizType === "pie") return rule.selectedCols || [];
            return [rule.column, rule.yColumn].filter(Boolean);
          }),
        ),
      );
      if (vizTargets.length > 0) {
        setProcessingStep("Preparing visualization…");
        appendLog("Start: Visualization");
        await generateStepInsight({
          title: "Visualization",
          targets: vizTargets,
          summary: `Configured ${vizRules.length} visualization rule(s).`,
        });
        appendLog("Done: Visualization");
      } else {
        appendLog("Skip: Visualization (no rules)");
      }
      showToast("✅ Automated cleaning complete");
    } catch (e) {
      showToast(e?.message || "Cleaning failed", "error");
      appendLog(`Error: ${e?.message || e}`);
    } finally {
      await refreshAfterCleaning();
      setProcessingStep(null);
      setRunningAll(false);
    }
  }, [
    runDuplicates,
    runOutliers,
    runMissingRules,
    runTypeInconsistencies,
    colsWithMissing,
    numericColsWithOutliers,
    colsWithTypeErrors,
    dupMethod,
    dupTarget,
    outlierMethod,
    typeMethod,
    showToast,
    appendLog,
    refreshAfterCleaning,
    vizRules,
    generateStepInsight,
  ]);

  // ── Rule helpers ──────────────────────────────────────────────────────────

  const addMissingRule = () => {
    setMissingRules((r) => [
      ...r,
      {
        id: Date.now(),
        method: "mean",
        selectedCols: [],
        conditionalRules: [],
        elseValue: "",
      },
    ]);
  };

  const addVizRule = () => {
    setVizRules((r) => [
      ...r,
      {
        id: Date.now(),
        vizType: "bar",
        column: "",
        yColumn: "",
        selectedCols: [],
      },
    ]);
  };

  // ── Nav ───────────────────────────────────────────────────────────────────

  const navItems = [
    { name: "Upload", icon: Upload, path: "/upload" },
    { name: "Profiling", icon: Grid, path: "/profiling" },
    { name: "Clean", icon: Sparkles, path: "/cleaning", active: true },
    { name: "Log", icon: FileText, path: "/log" },
    { name: "Visualize", icon: BarChart3, path: "/visualize" },
    { name: "ML Model", icon: TrendingUp, path: "/ml" },
    { name: "Export", icon: Download, path: "/export" },
  ];

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

  // ── Guards ────────────────────────────────────────────────────────────────

  if (isLoading && !profile) {
    return (
      <div className="w-full min-h-screen bg-[#F8F9FB] font-['Poppins'] flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin w-16 h-16 border-4 border-[#2B7FFF] border-t-transparent rounded-full mx-auto mb-4"></div>
          <p className="text-xl text-gray-600">Loading your data...</p>
        </div>
      </div>
    );
  }

  if (!profile) {
    return (
      <div className="w-full min-h-screen bg-[#F8F9FB] font-['Poppins'] flex items-center justify-center">
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
    );
  }

  const displayRows = tableRows;
  const visibleColumns = tableColumns.length
    ? tableColumns
    : profile?.columns?.map((c) => c.name) || [];
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
  const configuredSteps = missingRules.length + 1 + 1 + 1 + vizRules.length;

  const renderCleaningControls = () => (
    <div className="flex flex-col gap-4">
      <SectionCard
        icon={AlertCircle}
        iconColor="text-[#6366F1]"
        iconBg="bg-[#EEF2FF]"
        title="Missing Data"
        badgeColor="bg-[#6366F1]"
      >
        <div className="mt-1">
          {missingRules.map((rule, idx) => (
            <MissingRuleItem
              key={rule.id}
              rule={rule}
              columns={colsWithMissing}
              allCols={columnStats}
              onUpdate={(updated) => {
                const newRules = [...missingRules];
                newRules[idx] = updated;
                setMissingRules(newRules);
              }}
              onRemove={() =>
                setMissingRules((r) => r.filter((_, i) => i !== idx))
              }
            />
          ))}
          <button
            onClick={addMissingRule}
            className="flex items-center gap-1.5 text-sm text-[#6366F1] hover:text-[#4F46E5] mt-2 font-medium"
          >
            <Plus className="w-4 h-4" /> Add Rule
          </button>
          <div className="mt-3">
            <button
              onClick={runMissingRules}
              className="px-4 py-2 bg-[#6366F1] text-white text-sm rounded-[10px] hover:bg-[#4F46E5] transition-colors"
            >
              Run Missing Rules
            </button>
          </div>
        </div>
      </SectionCard>

      <SectionCard
        icon={AlertTriangle}
        iconColor="text-[#F59E0B]"
        iconBg="bg-[#FEF3C7]"
        title="Duplicate Detection"
        badgeColor="bg-[#F59E0B]"
      >
        <div className="grid grid-cols-[1fr_1fr_32px] gap-3 items-end mt-1">
          <div>
            <p className="text-xs font-medium text-[#6A7282] mb-1.5">Method</p>
            <Select
              value={dupMethod}
              onChange={setDupMethod}
              options={DUPLICATE_STRATEGIES}
            />
          </div>
          <div>
            <MultiSelectDropdown
              label="Target Columns"
              columns={columnStats}
              selected={dupTarget}
              onChange={setDupTarget}
              placeholder="StudentNumber, LastName, FirstName"
            />
          </div>
          <div />
        </div>
        <LogicHint text="Mean imputation is statistically sound for normally distributed numerical data." />
        <div className="mt-3">
          <button
            onClick={runDuplicatesWithWindow}
            className="px-4 py-2 bg-[#F59E0B] text-white text-sm rounded-[10px] hover:bg-[#D97706] transition-colors"
          >
            Handle Duplicates
          </button>
        </div>
      </SectionCard>

      <SectionCard
        icon={Zap}
        iconColor="text-[#EF4444]"
        iconBg="bg-[#FEF2F2]"
        title="Outlier Detection"
        badgeColor="bg-[#EF4444]"
      >
        <div className="grid grid-cols-3 gap-3 items-end mt-1">
          <div>
            <p className="text-xs font-medium text-[#6A7282] mb-1.5">Method</p>
            <Select
              value={outlierMethod}
              onChange={setOutlierMethod}
              options={OUTLIER_METHODS}
            />
          </div>
          <div>
            <MultiSelectDropdown
              label="Target Columns"
              columns={numericColsWithOutliers}
              selected={outlierTarget}
              onChange={setOutlierTarget}
              placeholder="Course1, Course2, Course3, Course4, Cou..."
            />
          </div>
          <div>
            <p className="text-xs font-medium text-[#6A7282] mb-1.5">Action</p>
            <Select
              value={outlierAction}
              onChange={setOutlierAction}
              options={OUTLIER_ACTIONS}
            />
          </div>
        </div>
        <LogicHint text="The IQR method is robust to extreme values and works well with your dataset size." />
        <div className="mt-3">
          <button
            onClick={runOutliersWithWindow}
            className="px-4 py-2 bg-[#EF4444] text-white text-sm rounded-[10px] hover:bg-[#DC2626] transition-colors"
          >
            Handle Outliers
          </button>
        </div>
      </SectionCard>

      <SectionCard
        icon={Settings}
        iconColor="text-[#C27AFF]"
        iconBg="bg-[#F5EDFF]"
        title="Type Inconsistency"
        badgeColor="bg-[#C27AFF]"
      >
        <div className="grid grid-cols-2 gap-3 items-end mt-1">
          <div>
            <p className="text-xs font-medium text-[#6A7282] mb-1.5">Method</p>
            <Select
              value={typeMethod}
              onChange={setTypeMethod}
              options={TYPE_INCONSISTENCY_METHODS}
            />
          </div>
          <div>
            <MultiSelectDropdown
              label="Target Columns"
              columns={
                typeNumericOnly ? numericColsWithTypeErrors : colsWithTypeErrors
              }
              selected={typeTarget}
              onChange={setTypeTarget}
              placeholder="Columns with mixed numeric/text values"
            />
          </div>
        </div>
        <div className="mt-2 flex items-center gap-4">
          <label className="flex items-center gap-2 text-xs text-[#4A5565]">
            <input
              type="checkbox"
              checked={typeNumericOnly}
              onChange={(e) => setTypeNumericOnly(e.target.checked)}
            />
            Numeric columns only
          </label>
          <label className="flex items-center gap-2 text-xs text-[#4A5565]">
            <input
              type="checkbox"
              checked={typeNumericCleanup}
              onChange={(e) => setTypeNumericCleanup(e.target.checked)}
            />
            Clean text/alphanumeric before imputing
          </label>
        </div>
        <LogicHint text="For integer/decimal columns, inconsistent values are replaced and type issues are cleared." />
        <div className="mt-3">
          <button
            onClick={runTypeInconsistenciesWithWindow}
            className="px-4 py-2 bg-[#C27AFF] text-white text-sm rounded-[10px] hover:bg-[#A855F7] transition-colors"
          >
            Handle Type Inconsistencies
          </button>
        </div>
      </SectionCard>

      <SectionCard
        icon={BarChart3}
        iconColor="text-[#0EA5E9]"
        iconBg="bg-[#E0F2FE]"
        title="Data Visualization"
        badgeColor="bg-[#0EA5E9]"
      >
        <div className="mt-1">
          {vizRules.map((rule, idx) => (
            <VizRuleItem
              key={rule.id}
              rule={rule}
              allCols={allColumns}
              onUpdate={(updated) => {
                const newRules = [...vizRules];
                newRules[idx] = updated;
                setVizRules(newRules);
              }}
              onRemove={() => setVizRules((r) => r.filter((_, i) => i !== idx))}
            />
          ))}
          <button
            onClick={addVizRule}
            className="flex items-center gap-1.5 text-sm text-[#0EA5E9] hover:text-[#0284C7] mt-2 font-medium"
          >
            <Plus className="w-4 h-4" /> Add Visualization
          </button>
        </div>
      </SectionCard>
    </div>
  );

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="min-h-screen bg-[#F8F9FB] font-['Poppins'] overflow-x-hidden">
      {/* Header */}
      <AppHeader onLogout={handleLogout} />

      {/* Main */}
      <main className="pt-[80px] sm:pt-[90px] lg:pt-[130px] px-4 sm:px-6 lg:px-[100px] max-w-[1600px] mx-auto">
        {/* Page Title + Tab Toggle */}
        <div className="flex items-start justify-between mb-6">
          <div>
            <h2 className="text-xl sm:text-2xl lg:text-[28px] font-bold text-transparent bg-clip-text bg-gradient-to-r from-[#2B7FFF] to-[#AD46FF]">
              AI-Powered Auto Cleaning
            </h2>
            <p className="text-sm text-[#6A7282] mt-0.5">
              Review AI-recommended cleaning strategies and start automated
              process
            </p>
          </div>
          <div className="flex gap-1 bg-[#F3F4F6] p-1 rounded-[10px] border border-[#E5E7EB]">
            <button
              onClick={() => setActiveTab("automated")}
              className={`flex items-center gap-1.5 px-4 py-1.5 rounded-[8px] text-sm font-medium transition-all ${
                activeTab === "automated"
                  ? "bg-gradient-to-r from-[#6366F1] to-[#8B5CF6] text-white shadow-sm"
                  : "text-[#6A7282] hover:bg-white"
              }`}
            >
              <Zap className="w-3.5 h-3.5" /> Automated
            </button>
            <button
              onClick={() => setActiveTab("customize")}
              className={`flex items-center gap-1.5 px-4 py-1.5 rounded-[8px] text-sm font-medium transition-all ${
                activeTab === "customize"
                  ? "bg-white text-[#101828] shadow-sm"
                  : "text-[#6A7282] hover:bg-white"
              }`}
            >
              <Settings className="w-3.5 h-3.5" /> Customize
            </button>
          </div>
        </div>

        {/* Two-column layout */}
        <div
          className="grid gap-6"
          style={{ gridTemplateColumns: "minmax(0, 1fr) 300px" }}
        >
          {/* ── LEFT COLUMN ────────────────────────────────────────────────── */}
          <div className="flex flex-col gap-5">
            {/* Dataset Preview */}
            <div className="bg-white rounded-2xl border border-[#E5E7EB] shadow-sm overflow-hidden">
              <div className="px-6 py-4 border-b border-[#F3F4F6] flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="w-9 h-9 bg-[#EFF6FF] rounded-[10px] flex items-center justify-center">
                    <FileText
                      className="w-4.5 h-4.5 text-[#2B7FFF]"
                      style={{ width: 18, height: 18 }}
                    />
                  </div>
                  <div>
                    <h3 className="text-[15px] font-semibold text-[#101828]">
                      Raw Dataset Preview
                    </h3>
                    <p className="text-xs text-[#6A7282]">
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
                    onChange={(e) => {
                      setPreviewQuery(e.target.value);
                    }}
                    placeholder="Search rows"
                    className="px-3 py-2 text-sm border border-[#E5E7EB] rounded-[10px] focus:outline-none focus:border-[#2B7FFF]"
                  />
                  <button
                    onClick={() => {
                      setShowErrorsOnly((v) => !v);
                    }}
                    className="text-sm text-[#2B7FFF] hover:text-[#1A66FF] font-medium"
                  >
                    {showErrorsOnly ? "Show all" : "Show errors"}
                  </button>
                </div>
              </div>
              <div
                className="h-[520px] overflow-y-auto overflow-x-auto max-w-full"
                onScroll={handleTableScroll}
                ref={tableViewportRef}
              >
                <table className="w-full min-w-0">
                  <thead className="bg-[#F9FAFB]">
                    <tr>
                      <th className="px-4 py-3 text-left text-xs font-bold text-[#6A7282] w-10">
                        #
                      </th>
                      {visibleColumns.map((col, idx) => {
                        const cs = columnStats.find((c) => c.name === col);
                        const hasIssues =
                          cs &&
                          (cs.missingCount > 0 ||
                            cs.outliers > 0 ||
                            cs.typeErrors > 0);
                        return (
                          <th
                            key={idx}
                            className="px-4 py-3 text-left text-xs font-bold text-[#6A7282] whitespace-nowrap"
                          >
                            <div className="flex items-center gap-1.5">
                              {col}
                              {hasIssues && (
                                <div className="flex gap-0.5">
                                  {cs.missingCount > 0 && (
                                    <span className="text-[#FF6467] text-[9px]">
                                      ⬤
                                    </span>
                                  )}
                                  {cs.outliers > 0 && (
                                    <span className="text-[#F0B000] text-[9px]">
                                      ⬤
                                    </span>
                                  )}
                                  {cs.typeErrors > 0 && (
                                    <span className="text-[#C27AFF] text-[9px]">
                                      ⬤
                                    </span>
                                  )}
                                </div>
                              )}
                            </div>
                          </th>
                        );
                      })}
                    </tr>
                  </thead>
                  <tbody>
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
                      const actualRowIndex = row._index ?? rowIdx;
                      return (
                        <tr
                          key={actualRowIndex}
                          className="border-t border-[#F3F4F6] hover:bg-[#FAFAFA] h-10"
                        >
                          <td className="px-4 py-2.5 text-xs text-[#9CA3AF] h-10 align-middle whitespace-nowrap">
                            {actualRowIndex + 1}
                          </td>
                          {visibleColumns.map((col, colIdx) => {
                            const cellData = row[col];
                            const value =
                              typeof cellData === "object" && cellData !== null
                                ? (cellData.display_value ?? cellData.value)
                                : cellData;
                            const rowIndexForIssues = actualRowIndex;
                            const cellIssues =
                              typeof cellData === "object" && cellData?.issues
                                ? cellData.issues
                                : getCellIssues(rowIndexForIssues, col);
                            const cls = getCellClassName(cellIssues);
                            const formattedValue = formatCellValue(value);
                            const content = getCellContent(
                              formattedValue,
                              cellIssues,
                            );
                            const highlight = shouldHighlightCell(cellIssues);
                            const isEditing =
                              cellEditing &&
                              cellEditing.rowIdx === actualRowIndex &&
                              cellEditing.colName === col;
                            return (
                              <td
                                key={colIdx}
                                className="px-4 py-2.5 text-sm h-10 align-middle whitespace-nowrap"
                              >
                                {isEditing ? (
                                  <input
                                    type="text"
                                    value={cellEditValue}
                                    onChange={(e) =>
                                      setCellEditValue(e.target.value)
                                    }
                                    onBlur={commitCellEdit}
                                    onKeyDown={(e) => {
                                      if (e.key === "Enter") commitCellEdit();
                                      if (e.key === "Escape") cancelCellEdit();
                                    }}
                                    disabled={cellSaving}
                                    className="w-full px-2 py-1 border-2 border-[#2B7FFF] rounded-md focus:outline-none"
                                    autoFocus
                                  />
                                ) : (
                                  <span
                                    className={`${
                                      highlight ? cls : "text-[#364153]"
                                    } whitespace-nowrap`}
                                    onDoubleClick={() =>
                                      startCellEdit(
                                        actualRowIndex,
                                        col,
                                        formattedValue,
                                      )
                                    }
                                    title="Double-click to edit"
                                  >
                                    {highlight
                                      ? content
                                      : (formattedValue ?? "—")}
                                  </span>
                                )}
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

            {selectedColumnDetails && (
              <div className="p-6 bg-gradient-to-br from-[#2B7FFF]/10 via-[#AD46FF]/5 to-transparent rounded-2xl border border-[#2B7FFF]/30 shadow-sm">
                <div className="flex items-center justify-between mb-4">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 bg-[#2B7FFF]/20 rounded-[12px] flex items-center justify-center">
                      <BarChart3 className="w-5 h-5 text-[#51A2FF]" />
                    </div>
                    <div>
                      <h3 className="text-lg text-[#101828]">
                        {selectedColumnDetails.name}
                      </h3>
                      <p className="text-xs text-[#4A5565]">
                        {selectedColumnDetails.type}
                      </p>
                    </div>
                  </div>
                  <div className="px-3 py-1.5 bg-[#C7F0D9] rounded-[12px]">
                    <span className="text-sm text-black font-medium">
                      {selectedColumnDetails.completeness?.toFixed?.(1) ??
                        selectedColumnDetails.completeness ??
                        "-"}
                      %
                    </span>
                  </div>
                </div>
                <div className="grid grid-cols-4 gap-3 mb-4">
                  <button
                    onClick={() =>
                      openModal("unique", selectedColumnDetails.name)
                    }
                    className="p-3 bg-[#F9FAFB] rounded-2xl border border-gray-200 hover:border-[#00D3F2] hover:bg-[#00D3F2]/5 transition-all cursor-pointer text-left"
                  >
                    <p className="text-xs text-[#4A5565] mb-1.5">Unique</p>
                    <p className="text-xl text-[#00D3F2] font-bold">
                      {selectedColumnDetails.unique_count?.toLocaleString?.() ||
                        "-"}
                    </p>
                    <p className="text-[10px] text-[#00D3F2] mt-1">
                      Click to view →
                    </p>
                  </button>
                  <button
                    onClick={() =>
                      selectedColumnDetails.missing_count > 0 &&
                      openModal("missing", selectedColumnDetails.name)
                    }
                    disabled={selectedColumnDetails.missing_count === 0}
                    className={`p-3 bg-[#F9FAFB] rounded-2xl border border-gray-200 text-left transition-all ${
                      selectedColumnDetails.missing_count > 0
                        ? "hover:border-[#FF6467] hover:bg-[#FF6467]/5 cursor-pointer"
                        : "opacity-50 cursor-not-allowed"
                    }`}
                  >
                    <p className="text-xs text-[#4A5565] mb-1.5">Missing</p>
                    <p className="text-xl text-[#FF6467] font-bold">
                      {selectedColumnDetails.missing_count?.toLocaleString?.() ||
                        "-"}
                    </p>
                    {selectedColumnDetails.missing_count > 0 && (
                      <p className="text-[10px] text-[#FF6467] mt-1">
                        Click to view →
                      </p>
                    )}
                  </button>
                  <button
                    onClick={() =>
                      selectedColumnDetails.type_inconsistency_count > 0 &&
                      openModal("type_errors", selectedColumnDetails.name)
                    }
                    disabled={
                      selectedColumnDetails.type_inconsistency_count === 0
                    }
                    className={`p-3 bg-[#F9FAFB] rounded-2xl border border-gray-200 text-left transition-all ${
                      selectedColumnDetails.type_inconsistency_count > 0
                        ? "hover:border-[#C27AFF] hover:bg-[#C27AFF]/5 cursor-pointer"
                        : "opacity-50 cursor-not-allowed"
                    }`}
                  >
                    <p className="text-xs text-[#4A5565] mb-1.5">Type Errors</p>
                    <p className="text-xl text-[#C27AFF] font-bold">
                      {selectedColumnDetails.type_inconsistency_count?.toLocaleString?.() ||
                        "-"}
                    </p>
                    {selectedColumnDetails.type_inconsistency_count > 0 && (
                      <p className="text-[10px] text-[#C27AFF] mt-1">
                        Click to view →
                      </p>
                    )}
                  </button>
                  <button
                    onClick={() =>
                      selectedColumnDetails.outlier_count > 0 &&
                      openModal("outliers", selectedColumnDetails.name)
                    }
                    disabled={selectedColumnDetails.outlier_count === 0}
                    className={`p-3 bg-[#F9FAFB] rounded-2xl border border-gray-200 text-left transition-all ${
                      selectedColumnDetails.outlier_count > 0
                        ? "hover:border-[#F0B000] hover:bg-[#F0B000]/5 cursor-pointer"
                        : "opacity-50 cursor-not-allowed"
                    }`}
                  >
                    <p className="text-xs text-[#4A5565] mb-1.5">Outliers</p>
                    <p className="text-xl text-[#F0B000] font-bold">
                      {selectedColumnDetails.outlier_count?.toLocaleString?.() ||
                        "-"}
                    </p>
                    {selectedColumnDetails.outlier_count > 0 && (
                      <p className="text-[10px] text-[#F0B000] mt-1">
                        Click to view →
                      </p>
                    )}
                  </button>
                </div>
                {["Integer", "Decimal", "integer", "decimal"].includes(
                  selectedColumnDetails.type,
                ) && (
                  <div className="grid grid-cols-5 gap-3">
                    <div className="p-3 bg-[#D1D5DC] rounded-2xl">
                      <p className="text-xs text-[#4A5565] mb-1.5">Min</p>
                      <p className="text-lg text-[#7C7C7C] font-bold">
                        {selectedColumnDetails.min?.toFixed?.(2) || "-"}
                      </p>
                    </div>
                    <div className="p-3 bg-[#D1D5DC] rounded-2xl">
                      <p className="text-xs text-[#4A5565] mb-1.5">Max</p>
                      <p className="text-lg text-[#7C7C7C] font-bold">
                        {selectedColumnDetails.max?.toFixed?.(2) || "-"}
                      </p>
                    </div>
                    <div className="p-3 bg-[#D1D5DC] rounded-2xl">
                      <p className="text-xs text-[#4A5565] mb-1.5">Mean</p>
                      <p className="text-lg text-[#78737D] font-bold">
                        {selectedColumnDetails.mean?.toFixed?.(2) || "-"}
                      </p>
                    </div>
                    <div className="p-3 bg-[#D1D5DC] rounded-2xl">
                      <p className="text-xs text-[#4A5565] mb-1.5">Median</p>
                      <p className="text-lg text-[#696969] font-bold">
                        {selectedColumnDetails.median?.toFixed?.(2) || "-"}
                      </p>
                    </div>
                    <div className="p-3 bg-[#D1D5DC] rounded-2xl">
                      <p className="text-xs text-[#4A5565] mb-1.5">Q1–Q3</p>
                      <p className="text-lg text-[#696969] font-bold">
                        {selectedColumnDetails.q1?.toFixed?.(2) || "-"}–
                        {selectedColumnDetails.q3?.toFixed?.(2) || "-"}
                      </p>
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* AI Analysis Banner */}
            <div className="relative bg-gradient-to-r from-[#6366F1] to-[#8B5CF6] rounded-2xl px-6 py-4 overflow-hidden">
              <div className="absolute inset-0 opacity-10">
                {[...Array(6)].map((_, i) => (
                  <div
                    key={i}
                    className="absolute w-32 h-32 rounded-full border border-white"
                    style={{ left: `${i * 18}%`, top: "-20%", opacity: 0.3 }}
                  />
                ))}
              </div>
              <div className="relative flex items-center gap-3">
                <div className="w-9 h-9 bg-white/20 rounded-[10px] flex items-center justify-center">
                  <Bot className="w-5 h-5 text-white" />
                </div>
                <div>
                  <h4 className="text-white font-semibold text-[15px]">
                    AI Analysis Complete
                  </h4>
                  <p className="text-white/80 text-xs">
                    Based on your dataset characteristics, we recommend the
                    following configurations.
                  </p>
                </div>
              </div>
            </div>

            {activeTab === "automated" && renderCleaningControls()}
            {activeTab === "customize" && renderCleaningControls()}

            {(cleaningSteps?.length ?? 0) > 0 && (
              <div className="bg-white rounded-2xl border border-[#E5E7EB] shadow-sm p-5">
                <h3 className="text-sm font-semibold text-[#101828] mb-3">
                  🗒 Applied Steps ({cleaningSteps.length})
                </h3>
                <div className="max-h-[220px] overflow-y-auto flex flex-col gap-1.5">
                  {cleaningSteps.map((step, i) => (
                    <div
                      key={i}
                      className="flex items-center gap-2.5 px-3 py-2 bg-[#F9FAFB] border border-[#F3F4F6] rounded-lg text-sm"
                    >
                      <span className="w-5 h-5 bg-[#EFF6FF] rounded-full flex-shrink-0 flex items-center justify-center text-[10px] font-bold text-[#2B7FFF]">
                        {i + 1}
                      </span>
                      <span className="flex-1 text-[#101828]">
                        <b className="capitalize">
                          {step.type?.replace(/_/g, " ")}
                        </b>
                        {step.column && (
                          <span className="text-[#6A7282]">
                            {" "}
                            → {step.column}
                          </span>
                        )}
                        {step.strategy && (
                          <span className="text-[#2B7FFF]">
                            {" "}
                            ({step.strategy})
                          </span>
                        )}
                        {step.affected > 0 && (
                          <span className="text-[#00A63E]">
                            {" "}
                            · {step.affected} affected
                          </span>
                        )}
                      </span>
                      <span className="text-xs text-[#9CA3AF]">
                        {step.applied_at
                          ? new Date(step.applied_at).toLocaleTimeString()
                          : ""}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* ── RIGHT COLUMN: Column Overview ──────────────────────────────── */}
          <div className="sticky top-[130px] h-fit">
            <div className="bg-white rounded-2xl border border-[#E5E7EB] shadow-sm overflow-hidden">
              <div className="px-5 py-4 border-b border-[#F3F4F6] flex items-center gap-2.5">
                <Grid
                  className="w-4.5 h-4.5 text-[#2B7FFF]"
                  style={{ width: 18, height: 18 }}
                />
                <div>
                  <h3 className="text-[14px] font-semibold text-[#101828]">
                    Column Overview
                  </h3>
                  <p className="text-xs text-[#6A7282]">
                    {filename ? `Dataset: ${filename}` : "Dataset Check"}
                  </p>
                </div>
              </div>
              <div className="p-4 max-h-[calc(100vh-250px)] overflow-y-auto">
                <div className="flex flex-col gap-2">
                  {columnStats.map((col, idx) => {
                    const pct = parseFloat(col.completeness);
                    const clean =
                      col.missingCount === 0 &&
                      col.outliers === 0 &&
                      col.typeErrors === 0;
                    return (
                      <div
                        key={idx}
                        onClick={() => openDetailsCard(col.name)}
                        className="p-3 rounded-xl border border-[#F3F4F6] bg-[#FAFAFA] hover:bg-white hover:border-[#E5E7EB] cursor-pointer transition-all"
                      >
                        <div className="flex items-center justify-between mb-1">
                          <span className="text-sm font-medium text-[#101828] truncate">
                            {col.name}
                          </span>
                          <span
                            className={`ml-2 px-2 py-0.5 rounded-md text-xs font-semibold flex-shrink-0 ${pct === 100 ? "text-[#00C850]" : pct === 0 ? "text-[#FF6467]" : "text-[#F0B000]"}`}
                          >
                            {col.completeness}%
                          </span>
                        </div>
                        <p className="text-xs text-[#9CA3AF] mb-1.5">
                          {col.type}
                        </p>
                        <div className="flex items-center justify-between">
                          <div className="flex-1 mr-3 h-1 bg-[#E5E7EB] rounded-full overflow-hidden">
                            <div
                              className={`h-full rounded-full ${pct >= 90 ? "bg-[#00A63E]" : pct >= 70 ? "bg-[#D97706]" : "bg-[#DC2626]"}`}
                              style={{ width: `${Math.min(100, pct)}%` }}
                            />
                          </div>
                          {clean ? (
                            <span className="text-[10px] text-[#00C850] font-medium whitespace-nowrap">
                              ✓ Clean
                            </span>
                          ) : (
                            <div className="flex items-center gap-1.5">
                              {col.missingCount > 0 && (
                                <span className="text-[10px] text-[#FF6467] font-medium">
                                  {col.missingCount} missing
                                </span>
                              )}
                              {col.outliers > 0 && (
                                <span className="text-[10px] text-[#F0B000] font-medium">
                                  {col.outliers} out.
                                </span>
                              )}
                              {col.typeErrors > 0 && (
                                <span className="text-[10px] text-[#C27AFF] font-medium">
                                  {col.typeErrors} err.
                                </span>
                              )}
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Action bar — static, at bottom of page */}
        <div className="mt-6 mb-8 h-[72px] bg-white rounded-2xl border border-[#E5E7EB] shadow-sm px-6 flex justify-between items-center">
          <div>
            <h4 className="text-sm font-semibold text-[#101828]">
              Ready to Process
            </h4>
            <p className="text-xs text-[#6A7282]">
              {configuredSteps} steps configured
            </p>
          </div>
          <div className="flex items-center gap-3">
            <button
              onClick={async () => {
                try {
                  setSavingChanges(true);
                  await saveChanges();
                  showToast("Changes saved");
                } catch (e) {
                  showToast(e?.message || "Save failed", "error");
                } finally {
                  setSavingChanges(false);
                }
              }}
              disabled={savingChanges || isLoading}
              className="flex items-center gap-1.5 px-4 py-2.5 bg-white border border-[#E5E7EB] rounded-[10px] text-sm text-[#6A7282] hover:bg-[#F9FAFB] transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <Check className="w-3.5 h-3.5" />
              {savingChanges ? "Saving…" : "Save Changes"}
            </button>
            <button
              onClick={async () => {
                if (
                  window.confirm("Reset all changes back to original data?")
                ) {
                  try {
                    await resetChanges();
                    showToast("Dataset reset to original");
                  } catch (e) {
                    showToast(e?.message, "error");
                  }
                }
              }}
              className="flex items-center gap-1.5 px-4 py-2.5 bg-white border border-[#E5E7EB] rounded-[10px] text-sm text-[#6A7282] hover:bg-[#F9FAFB] transition-colors"
            >
              <RefreshCw className="w-3.5 h-3.5" /> Reset
            </button>
            <button
              onClick={runAutomated}
              disabled={runningAll || isLoading}
              className="flex items-center gap-2 px-7 py-2.5 rounded-[10px] bg-gradient-to-r from-[#6366F1] to-[#8B5CF6] text-white text-sm font-semibold disabled:opacity-50 disabled:cursor-not-allowed hover:shadow-lg transition-shadow"
            >
              {runningAll ? (
                <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
              ) : (
                <Play className="w-4 h-4 fill-white" />
              )}
              {runningAll ? "Running…" : "Run Automated Cleaning"}
            </button>
          </div>
        </div>
      </main>

      {runningAll && processingStep && (
        <div className="fixed bottom-24 left-1/2 -translate-x-1/2 z-[9998] px-5 py-3.5 rounded-2xl min-w-[340px] max-w-[640px] shadow-[0_8px_30px_rgba(0,0,0,.12)] bg-white border border-[#E5E7EB]">
          <div className="flex items-center gap-3">
            <div className="w-5 h-5 border-2 border-[#2B7FFF] border-t-transparent rounded-full animate-spin" />
            <div className="text-sm text-[#101828]">{processingStep}</div>
          </div>
          {processingLog.length > 0 && (
            <div className="mt-2 border-t border-[#F3F4F6] pt-2">
              <div className="text-[11px] text-[#6A7282]">Recent steps</div>
              <ul className="mt-1 max-h-24 overflow-y-auto text-[11px] text-[#475569] space-y-0.5">
                {processingLog.slice(-6).map((l, i) => (
                  <li key={i}>• {l}</li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}

      {/* ValueDetailsModal — preserved exactly */}
      <ValueDetailsModal
        isOpen={modalOpen}
        onClose={closeModal}
        type={modalType}
        columnName={modalColumn}
        sessionId={sessionId}
        ApiService={ApiService}
        onValueUpdated={handleValueUpdated}
      />

      {error && (
        <div className="fixed bottom-4 right-4 bg-red-500 text-white px-6 py-3 rounded-lg shadow-lg z-50">
          {error}
        </div>
      )}

      {isLoading && profile && (
        <div className="fixed inset-0 bg-black/20 flex items-center justify-center z-50">
          <div className="bg-white p-6 rounded-lg shadow-xl">
            <div className="animate-spin w-8 h-8 border-4 border-[#2B7FFF] border-t-transparent rounded-full"></div>
          </div>
        </div>
      )}

      <Toast toast={toast} onClose={() => setToast(null)} />
    </div>
  );
};

export default CleaningPage;
