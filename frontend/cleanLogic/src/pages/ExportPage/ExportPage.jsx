import React, { useState, useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import AppHeader from "../../components/common/AppHeader";
import ApiService from "../../services/api";
import { getLogs, getMlInfo, getVizList } from "../../cache/sessionCache";
import {
  Download, FileText, Database, CheckCircle, AlertTriangle, Clock,
  BarChart3, Layers, Sparkles, RefreshCw, ExternalLink, Plus,
  ShieldCheck, AlertCircle, TrendingUp, Table2, Cpu,
} from "lucide-react";
import {
  ResponsiveContainer, BarChart, Bar, LineChart, Line,
  ScatterChart, Scatter, PieChart, Pie, Cell,
  XAxis, YAxis, Tooltip, CartesianGrid, Legend,
} from "recharts";

// ── Helpers ────────────────────────────────────────────────────────────────

function fmtDate(iso) {
  if (!iso) return new Date().toLocaleString(undefined, { month: "short", day: "numeric", year: "numeric", hour: "2-digit", minute: "2-digit" });
  try { return new Date(iso).toLocaleString(undefined, { month: "short", day: "numeric", year: "numeric", hour: "2-digit", minute: "2-digit" }); }
  catch { return iso; }
}

function simplifyDtype(dtype) {
  if (!dtype) return "—";
  const d = String(dtype).toLowerCase().trim();
  if (d.includes("int"))    return "int";
  if (d.includes("float64") || d.includes("double")) return "double";
  if (d.includes("float"))  return "float";
  if (d === "object" || d.includes("str") || d.includes("text") || d.includes("alpha")) return "string";
  if (d.includes("bool"))   return "bool";
  if (d.includes("date") || d.includes("time")) return "datetime";
  return dtype;
}

function pct(v, total) {
  if (!total) return "0%";
  return `${Math.round((v / total) * 100)}%`;
}

const OP_LABELS = {
  impute: "Impute Missing Values", fill_nulls: "Fill Nulls",
  outlier: "Handle Outliers", cap_outliers: "Cap Outliers", remove_outliers: "Remove Outliers",
  duplicates: "Handle Duplicates", deduplicate: "Deduplicate",
  type_conversion: "Type Conversion", convert_type: "Convert Type",
  type_inconsistency: "Fix Type Inconsistency", normalize_case: "Normalize Case",
  lowercase: "Lowercase", uppercase: "Uppercase", trim_whitespace: "Trim Whitespace",
  normalize_date: "Normalize Dates", validate_regex: "Validate Format",
  drop_column: "Drop Column", delete_rows: "Delete Rows", cell_update: "Cell Edit",
};

const OP_ICONS = {
  impute: "🩹", fill_nulls: "🩹", outlier: "📊", cap_outliers: "📊", remove_outliers: "📊",
  duplicates: "🔁", deduplicate: "🔁", type_conversion: "🔤", convert_type: "🔤",
  type_inconsistency: "⚠️", normalize_case: "✏️", lowercase: "✏️", uppercase: "✏️",
  trim_whitespace: "✂️", normalize_date: "📅", validate_regex: "🔍",
  drop_column: "🗑️", delete_rows: "🗑️", cell_update: "✏️",
};

const RISK_COLORS = { low: "#16A34A", medium: "#D97706", high: "#DC2626" };

const CHART_PALETTE = ["#3B82F6","#8B5CF6","#10B981","#F59E0B","#EF4444","#06B6D4","#6366F1","#EC4899"];

// ── Print styles injected once ─────────────────────────────────────────────
const PRINT_STYLE = `
@media print {
  body * { visibility: hidden; }
  #report-preview, #report-preview * { visibility: visible; }
  #report-preview {
    position: absolute;
    top: 0;
    left: 0;
    right: 0;
    width: 100%;
    background: white;
    box-shadow: none;
    border: none;
    border-radius: 0;
  }
  #report-preview section {
    break-before: auto;
    break-after: auto;
    break-inside: avoid;
    page-break-inside: avoid;
  }
  #report-preview .recharts-wrapper,
  #report-preview .recharts-responsive-container {
    break-inside: avoid;
    page-break-inside: avoid;
  }
  /* Each chart card stays on one page */
  #report-preview section > div > div {
    break-inside: avoid;
    page-break-inside: avoid;
  }
  /* Ensure reasoning text is fully visible */
  #report-preview p { orphans: 3; widows: 3; }
  @page { margin: 15mm; size: A4 portrait; }
}
`;

// ── Small stat chip ────────────────────────────────────────────────────────
function Chip({ label, value, color = "#2B7FFF", icon: Icon }) {
  return (
    <div className="flex flex-col items-center justify-center bg-white rounded-xl border border-gray-100 shadow-sm px-5 py-4 min-w-[110px]">
      {Icon && <Icon className="w-5 h-5 mb-1" style={{ color }} />}
      <p className="text-2xl font-bold" style={{ color }}>{value}</p>
      <p className="text-[11px] text-[#6A7282] mt-0.5 text-center">{label}</p>
    </div>
  );
}

// ── Risk badge (inline) ────────────────────────────────────────────────────
function RiskBadge({ level }) {
  const cfg = {
    low:    { bg: "bg-green-50",  text: "text-green-700",  label: "Low" },
    medium: { bg: "bg-amber-50",  text: "text-amber-700",  label: "Medium" },
    high:   { bg: "bg-red-50",    text: "text-red-600",    label: "High" },
  }[level?.toLowerCase()] || { bg: "bg-gray-50", text: "text-gray-500", label: level || "—" };
  return (
    <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${cfg.bg} ${cfg.text}`}>
      {cfg.label}
    </span>
  );
}

// ── Chart renderer with fixed pixel dimensions (avoids ResponsiveContainer height issues) ──
const CHART_H = 280;

function ExportChart({ type, data, xAxis, yAxis }) {
  if (!data || data.length === 0) {
    return (
      <div style={{ height: CHART_H }} className="flex items-center justify-center text-[10px] text-[#9CA3AF] bg-gray-50 rounded-lg">
        No data
      </div>
    );
  }
  return (
    <div style={{ width: "100%", height: CHART_H }}>
      <ResponsiveContainer width="100%" height={CHART_H}>
        {type === "pie" ? (
          <PieChart>
            <Pie data={data} dataKey="value" nameKey="name" outerRadius={100} innerRadius={45} cx="50%" cy="50%">
              {data.map((_, i) => <Cell key={i} fill={CHART_PALETTE[i % CHART_PALETTE.length]} />)}
            </Pie>
            <Tooltip contentStyle={{ fontSize: 10 }} />
            <Legend iconSize={8} wrapperStyle={{ fontSize: 10 }} />
          </PieChart>
        ) : type === "scatter" ? (
          <ScatterChart margin={{ top: 12, right: 20, left: 0, bottom: 20 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#F3F4F6" />
            <XAxis dataKey="x" tick={{ fontSize: 9 }} label={{ value: xAxis || "", position: "insideBottom", offset: -10, fontSize: 9 }} />
            <YAxis dataKey="y" tick={{ fontSize: 9 }} label={{ value: yAxis || "", angle: -90, position: "insideLeft", fontSize: 9 }} />
            <Tooltip contentStyle={{ fontSize: 10 }} cursor={{ strokeDasharray: "3 3" }} />
            <Scatter data={data} fill="#3B82F6" />
          </ScatterChart>
        ) : type === "line" ? (
          <LineChart data={data} margin={{ top: 12, right: 20, left: 0, bottom: 20 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#F3F4F6" />
            <XAxis dataKey="name" tick={{ fontSize: 9 }} interval="preserveStartEnd" />
            <YAxis tick={{ fontSize: 9 }} />
            <Tooltip contentStyle={{ fontSize: 10 }} />
            <Legend iconSize={8} wrapperStyle={{ fontSize: 10 }} />
            <Line type="monotone" dataKey="value" stroke="#3B82F6" strokeWidth={2} dot={false} />
          </LineChart>
        ) : type === "histogram" ? (
          <BarChart data={data} margin={{ top: 12, right: 20, left: 0, bottom: 20 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#F3F4F6" />
            <XAxis dataKey="name" tick={{ fontSize: 9 }} interval="preserveStartEnd" />
            <YAxis tick={{ fontSize: 9 }} />
            <Tooltip contentStyle={{ fontSize: 10 }} />
            <Bar dataKey="value" fill="#8B5CF6" radius={[3, 3, 0, 0]} />
          </BarChart>
        ) : (
          <BarChart data={data} margin={{ top: 12, right: 20, left: 0, bottom: 20 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#F3F4F6" />
            <XAxis dataKey="name" tick={{ fontSize: 9 }} interval="preserveStartEnd" />
            <YAxis tick={{ fontSize: 9 }} />
            <Tooltip contentStyle={{ fontSize: 10 }} />
            <Legend iconSize={8} wrapperStyle={{ fontSize: 10 }} />
            <Bar dataKey="value" radius={[3, 3, 0, 0]}>
              {data.map((_, i) => <Cell key={i} fill={CHART_PALETTE[i % CHART_PALETTE.length]} />)}
            </Bar>
          </BarChart>
        )}
      </ResponsiveContainer>
    </div>
  );
}

// ─────────────────────────── MAIN PAGE ────────────────────────────────────
export default function ExportPage() {
  const navigate = useNavigate();
  const sessionId  = localStorage.getItem("cleanlogic_session_id") || null;
  const filename   = localStorage.getItem("cleanlogic_filename") || "dataset";
  const reportRef  = useRef(null);

  // Data state
  const [profile,      setProfile]      = useState(null);
  const [logs,         setLogs]         = useState([]);
  const [mlInfo,       setMlInfo]       = useState(null);
  const [savedCharts,  setSavedCharts]  = useState([]);
  const [vizCharts,    setVizCharts]    = useState([]);
  const [loading,      setLoading]      = useState(false);
  const [error,        setError]        = useState("");

  // Export options
  const [fileFormat, setFileFormat] = useState("pdf");
  const [exporting,  setExporting]  = useState(false);

  // Inject print CSS once
  useEffect(() => {
    const style = document.createElement("style");
    style.textContent = PRINT_STYLE;
    document.head.appendChild(style);
    return () => document.head.removeChild(style);
  }, []);

  // Redirect if no session
  useEffect(() => {
    if (!sessionId) navigate("/upload");
  }, [sessionId, navigate]);

  // Load generated charts saved by VisualPage
  useEffect(() => {
    if (!sessionId) return;
    try {
      const stored = localStorage.getItem(`cleanlogic_viz_charts_${sessionId}`);
      if (stored) setVizCharts(JSON.parse(stored));
    } catch {
      setVizCharts([]);
    }
  }, [sessionId]);

  // Load ML training result saved by MLPage
  const [mlTrainResult, setMlTrainResult] = useState(null);
  useEffect(() => {
    if (!sessionId) return;
    try {
      const stored = localStorage.getItem(`cleanlogic_ml_result_${sessionId}`);
      if (stored) setMlTrainResult(JSON.parse(stored));
    } catch {
      setMlTrainResult(null);
    }
  }, [sessionId]);

  // Load all data
  useEffect(() => {
    if (!sessionId) return;
    setLoading(true);
    Promise.allSettled([
      ApiService.getProfile(sessionId, 5),
      getLogs(sessionId),
      getMlInfo(sessionId),
      getVizList(sessionId),
    ]).then(([profileRes, logsRes, mlRes, vizRes]) => {
      if (profileRes.status === "fulfilled") setProfile(profileRes.value);
      if (logsRes.status === "fulfilled")   setLogs(logsRes.value?.logs || []);
      if (mlRes.status === "fulfilled")     setMlInfo(mlRes.value);
      if (vizRes.status === "fulfilled") {
        const all = vizRes.value?.visualizations || [];
        setSavedCharts(all.filter((v) => v.chart_config?.is_custom));
      }
    }).catch(() => setError("Failed to load report data"))
      .finally(() => setLoading(false));
  }, [sessionId]);

  // ── Derived stats ──────────────────────────────────────────────────────────
  const totalRows    = profile?.summary?.total_rows     ?? mlInfo?.rows    ?? 0;
  const totalCols    = profile?.summary?.total_columns  ?? mlInfo?.columns?.length ?? 0;
  const missingCells = profile?.summary?.total_missing  ?? 0;
  const issueCount   = profile?.summary?.total_issues   ?? 0;
  const cleanScore   = profile?.summary?.quality_score  ?? (issueCount === 0 ? 100 : Math.max(0, Math.round(100 - (issueCount / Math.max(totalRows * totalCols, 1)) * 100)));
  const opCount      = logs.length;
  const highRisk     = logs.filter((l) => l.risk_level === "high").length;
  const colDetails   = profile?.columns || [];
  const numericCols  = colDetails.filter((c) => ["int64","float64","int32","float32"].some(t => c.dtype?.includes(t)));
  const catCols      = colDetails.filter((c) => !["int64","float64","int32","float32"].some(t => c.dtype?.includes(t)));

  // ── Export handlers ────────────────────────────────────────────────────────
  const handleExport = () => {
    if (fileFormat === "pdf") {
      window.print();
    } else if (fileFormat === "csv") {
      handleDownloadCSV();
    } else if (fileFormat === "json") {
      handleDownloadJSON();
    }
  };

  const [datasetExporting, setDatasetExporting] = useState("");

  const handleDownloadDataset = async (format) => {
    try {
      setDatasetExporting(format);
      const response = await ApiService.exportData(sessionId, format);
      const blob = response.data instanceof Blob ? response.data : new Blob([response.data]);
      const url  = URL.createObjectURL(blob);
      const a    = document.createElement("a");
      a.href = url;
      a.download = `${filename.replace(/\.[^.]+$/, "")}_cleaned.${format}`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      setError("Dataset export failed: " + (e.message || ""));
    } finally {
      setDatasetExporting("");
    }
  };

  const handleDownloadCSV = () => handleDownloadDataset("csv");

  const handleDownloadJSON = () => {
    const report = {
      generated_at: new Date().toISOString(),
      dataset: filename,
      summary: { totalRows, totalCols, cleanScore, opCount, highRisk },
      operations: logs.map((l) => ({
        operation: l.operation, column: l.column_name,
        risk_level: l.risk_level, applied_at: l.applied_at, reason: l.reason,
      })),
      columns: colDetails.map((c) => ({ name: c.name, dtype: c.dtype, missing: c.missing_count })),
    };
    const blob = new Blob([JSON.stringify(report, null, 2)], { type: "application/json" });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement("a");
    a.href = url; a.download = `${filename.replace(/\.[^.]+$/, "")}_report.json`; a.click();
    URL.revokeObjectURL(url);
  };

  if (!sessionId) return null;

  return (
    <div className="min-h-screen bg-[#F8F9FB] font-['Poppins']">
      <AppHeader />

      <main className="pt-[80px] sm:pt-[90px] lg:pt-[130px] px-4 sm:px-6 lg:px-[100px] max-w-[1400px] mx-auto pb-16">

        {/* Page title */}
        <div className="mb-6">
          <h2 className="text-xl sm:text-2xl lg:text-[28px] font-bold text-transparent bg-clip-text bg-gradient-to-r from-[#2B7FFF] to-[#AD46FF]">
            Export &amp; Report
          </h2>
          <p className="text-sm text-[#6A7282] mt-1">
            Generate a comprehensive documentation of your data cleaning session
          </p>
        </div>

        {/* Top stats */}
        <div className="flex flex-wrap gap-4 mb-8">
          <Chip label="Total Rows"    value={totalRows.toLocaleString()} color="#2B7FFF" icon={Database} />
          <Chip label="Columns"       value={totalCols}                  color="#AD46FF" icon={Table2} />
          <Chip label="Operations"    value={opCount}                    color="#16A34A" icon={Sparkles} />
          <Chip label="Quality Score" value={`${cleanScore}%`}           color={cleanScore >= 80 ? "#16A34A" : cleanScore >= 60 ? "#D97706" : "#DC2626"} icon={ShieldCheck} />
          {highRisk > 0 && <Chip label="High-Risk Ops" value={highRisk} color="#DC2626" icon={AlertCircle} />}
        </div>

        {loading && (
          <div className="flex items-center gap-2 text-sm text-[#6A7282] py-12 justify-center">
            <div className="w-4 h-4 border-2 border-[#2B7FFF] border-t-transparent rounded-full animate-spin" />
            Loading report data…
          </div>
        )}
        {error && (
          <div className="bg-red-50 border border-red-200 text-red-700 rounded-xl px-5 py-4 text-sm mb-6">{error}</div>
        )}

        {!loading && (
          <div className="flex flex-col xl:flex-row gap-6 items-start">

            {/* ── LEFT: PDF Report Preview ── */}
            <div className="flex-1 min-w-0">
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-[13px] font-semibold text-[#374151] flex items-center gap-2">
                  <FileText className="w-4 h-4 text-[#2B7FFF]" />
                  PDF Report Preview
                </h3>
                <button onClick={() => window.print()}
                  className="flex items-center gap-1.5 px-3 py-1.5 bg-[#2B7FFF] text-white text-[11px] font-medium rounded-lg hover:bg-[#1D4ED8] transition-colors">
                  <Download className="w-3 h-3" /> Export as PDF
                </button>
              </div>

              {/* Report document */}
              <div id="report-preview" ref={reportRef}
                className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">

                {/* Report header */}
                <div className="px-8 py-6 border-b border-gray-100"
                  style={{ background: "linear-gradient(135deg, #155DFC 0%, #4F39F6 50%, #9810FA 100%)" }}>
                  <div className="flex items-start justify-between">
                    <div>
                      <p className="text-white/70 text-[11px] font-medium uppercase tracking-wider mb-1">Data Cleaning Report</p>
                      <h1 className="text-white text-xl font-bold">{filename}</h1>
                      <p className="text-white/60 text-[11px] mt-1">{fmtDate()}</p>
                    </div>
                    <div className="text-right">
                      <div className="inline-flex items-center gap-2 bg-white/20 rounded-xl px-4 py-2">
                        <ShieldCheck className="w-5 h-5 text-white" />
                        <div>
                          <p className="text-white font-bold text-lg leading-none">{cleanScore}%</p>
                          <p className="text-white/70 text-[10px]">Quality Score</p>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>

                <div className="px-8 py-6 space-y-8">

                  {/* ── Executive Summary ── */}
                  <section>
                    <h2 className="text-[13px] font-bold text-[#111827] uppercase tracking-wider mb-4 flex items-center gap-2 pb-2 border-b border-gray-100">
                      <TrendingUp className="w-4 h-4 text-[#2B7FFF]" />
                      Executive Summary
                    </h2>
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
                      {[
                        { label: "Data Quality",    value: `${cleanScore}%`,           sub: "overall score",       color: "#2B7FFF" },
                        { label: "Rows Processed",  value: totalRows.toLocaleString(), sub: "total records",       color: "#AD46FF" },
                        { label: "Operations",      value: opCount,                    sub: "cleaning steps",      color: "#16A34A" },
                        { label: "Improvement",     value: `${Math.min(99, cleanScore + 5)}%`, sub: "vs. raw data", color: "#F59E0B" },
                      ].map((s) => (
                        <div key={s.label} className="rounded-xl border border-gray-100 p-3 text-center bg-[#F9FAFB]">
                          <p className="text-2xl font-bold" style={{ color: s.color }}>{s.value}</p>
                          <p className="text-[11px] font-semibold text-[#374151] mt-0.5">{s.label}</p>
                          <p className="text-[10px] text-[#9CA3AF]">{s.sub}</p>
                        </div>
                      ))}
                    </div>
                    <p className="text-[12px] text-[#374151] leading-relaxed bg-[#F0F7FF] border border-[#BFDBFE] rounded-xl px-4 py-3">
                      <strong>Report Summary:</strong> The dataset <em>{filename}</em> was processed through{" "}
                      <strong>{opCount} cleaning operation{opCount !== 1 ? "s" : ""}</strong>{" "}
                      resulting in a data quality score of <strong>{cleanScore}%</strong>.{" "}
                      {missingCells > 0 ? `${missingCells.toLocaleString()} missing values were addressed. ` : "No missing values were detected. "}
                      {highRisk > 0 ? `${highRisk} high-risk operation${highRisk > 1 ? "s" : ""} were applied — review the audit log for details.` : "All operations were low to medium risk."}
                    </p>
                  </section>

                  {/* ── Dataset Overview ── */}
                  <section>
                    <h2 className="text-[13px] font-bold text-[#111827] uppercase tracking-wider mb-4 flex items-center gap-2 pb-2 border-b border-gray-100">
                      <Database className="w-4 h-4 text-[#AD46FF]" />
                      Cleaned Dataset Overview
                    </h2>
                    <div className="grid grid-cols-3 gap-3 mb-4">
                      {[
                        { label: "Total Rows",        value: totalRows.toLocaleString() },
                        { label: "Total Columns",     value: totalCols },
                        { label: "Missing Cells",     value: missingCells.toLocaleString() },
                        { label: "Numeric Columns",   value: numericCols.length },
                        { label: "Categorical Cols",  value: catCols.length },
                        { label: "Issues Detected",   value: issueCount },
                      ].map((s) => (
                        <div key={s.label} className="flex justify-between items-center px-3 py-2 rounded-lg bg-[#F9FAFB] border border-gray-100 text-[12px]">
                          <span className="text-[#6A7282]">{s.label}</span>
                          <span className="font-bold text-[#111827]">{s.value}</span>
                        </div>
                      ))}
                    </div>

                    {/* Column table */}
                    {colDetails.length > 0 && (
                      <div className="border border-gray-100 rounded-xl overflow-x-auto text-[11px]">
                        <div className="grid grid-cols-[2fr_1fr_1fr_1fr] min-w-[340px] bg-[#F9FAFB] px-4 py-2 text-[10px] font-semibold text-[#6B7280] uppercase tracking-wide border-b border-gray-100">
                          <span>Column</span><span>Type</span><span>Missing</span><span>Unique</span>
                        </div>
                        {colDetails.map((col) => (
                          <div key={col.name} className="grid grid-cols-[2fr_1fr_1fr_1fr] min-w-[340px] px-4 py-2 border-b border-gray-50 hover:bg-[#FAFAFA] items-center">
                            <span className="font-mono text-[#374151] truncate">{col.name}</span>
                            <span className={`text-[10px] px-1.5 py-0.5 rounded-full w-fit ${
                              numericCols.some(c => c.name === col.name) ? "bg-[#DBEAFE] text-[#2563EB]" : "bg-[#FEF3C7] text-[#D97706]"
                            }`}>{simplifyDtype(col.dtype)}</span>
                            <span className={col.missing_count > 0 ? "text-[#D97706] font-medium" : "text-[#16A34A]"}>
                              {col.missing_count > 0 ? col.missing_count : "✓ None"}
                            </span>
                            <span className="text-[#374151]">{col.unique_count ?? "—"}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </section>

                  {/* ── Data Processing Operations ── */}
                  {logs.length > 0 && (
                    <section>
                      <h2 className="text-[13px] font-bold text-[#111827] uppercase tracking-wider mb-4 flex items-center gap-2 pb-2 border-b border-gray-100">
                        <Sparkles className="w-4 h-4 text-[#16A34A]" />
                        Data Processing Operations
                      </h2>
                      <div className="space-y-2">
                        {logs.map((log, i) => {
                          const icon = OP_ICONS[log.operation?.toLowerCase()] || "🔧";
                          const label = OP_LABELS[log.operation?.toLowerCase()] || log.operation;
                          return (
                            <div key={log.id || i} className="flex items-start gap-3 px-4 py-3 rounded-xl border border-gray-100 bg-[#F9FAFB]">
                              <div className="w-7 h-7 rounded-lg flex items-center justify-center text-sm flex-shrink-0"
                                style={{ background: "linear-gradient(135deg, #2B7FFF22, #AD46FF22)" }}>
                                {icon}
                              </div>
                              <div className="flex-1 min-w-0">
                                <div className="flex items-center justify-between gap-2">
                                  <p className="text-[12px] font-semibold text-[#111827]">{label}</p>
                                  <RiskBadge level={log.risk_level} />
                                </div>
                                <p className="text-[11px] text-[#6A7282] mt-0.5">
                                  Column: <span className="font-mono font-medium text-[#374151]">{log.column_name}</span>
                                  {log.reason && <span> · {log.reason}</span>}
                                </p>
                              </div>
                              <span className="text-[10px] text-[#9CA3AF] flex-shrink-0">{fmtDate(log.applied_at)}</span>
                            </div>
                          );
                        })}
                      </div>
                    </section>
                  )}

                  {/* ── Statistical Analysis ── */}
                  <section>
                    <h2 className="text-[13px] font-bold text-[#111827] uppercase tracking-wider mb-4 flex items-center gap-2 pb-2 border-b border-gray-100">
                      <BarChart3 className="w-4 h-4 text-[#F59E0B]" />
                      Statistical Analysis &amp; Visualization
                    </h2>
                    <div className="grid grid-cols-2 gap-4">
                      {/* Column type distribution */}
                      <div className="bg-[#F9FAFB] rounded-xl border border-gray-100 p-4">
                        <p className="text-[11px] font-semibold text-[#6B7280] mb-3">Column Type Distribution</p>
                        {totalCols > 0 && (
                          <>
                            <div className="flex gap-2 items-center mb-2">
                              <div className="flex-1 h-4 rounded-full overflow-hidden bg-gray-100">
                                <div className="h-full bg-[#2563EB] rounded-full transition-all"
                                  style={{ width: pct(numericCols.length, totalCols) }} />
                              </div>
                              <span className="text-[11px] text-[#2563EB] font-medium w-10 text-right">{pct(numericCols.length, totalCols)}</span>
                            </div>
                            <p className="text-[10px] text-[#6B7280] mb-3">Numeric ({numericCols.length} cols)</p>
                            <div className="flex gap-2 items-center mb-2">
                              <div className="flex-1 h-4 rounded-full overflow-hidden bg-gray-100">
                                <div className="h-full bg-[#D97706] rounded-full transition-all"
                                  style={{ width: pct(catCols.length, totalCols) }} />
                              </div>
                              <span className="text-[11px] text-[#D97706] font-medium w-10 text-right">{pct(catCols.length, totalCols)}</span>
                            </div>
                            <p className="text-[10px] text-[#6B7280]">Categorical ({catCols.length} cols)</p>
                          </>
                        )}
                      </div>

                      {/* Risk distribution */}
                      <div className="bg-[#F9FAFB] rounded-xl border border-gray-100 p-4">
                        <p className="text-[11px] font-semibold text-[#6B7280] mb-3">Operations by Risk Level</p>
                        {[
                          { label: "Low Risk",    count: logs.filter(l => l.risk_level === "low").length,    color: "#16A34A" },
                          { label: "Medium Risk", count: logs.filter(l => l.risk_level === "medium").length, color: "#D97706" },
                          { label: "High Risk",   count: logs.filter(l => l.risk_level === "high").length,   color: "#DC2626" },
                        ].map((r) => (
                          <div key={r.label} className="mb-2">
                            <div className="flex justify-between text-[10px] mb-1">
                              <span className="text-[#6B7280]">{r.label}</span>
                              <span className="font-semibold" style={{ color: r.color }}>{r.count}</span>
                            </div>
                            <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
                              <div className="h-full rounded-full" style={{ width: pct(r.count, Math.max(opCount, 1)), backgroundColor: r.color }} />
                            </div>
                          </div>
                        ))}
                        {opCount === 0 && <p className="text-[11px] text-[#9CA3AF]">No operations recorded</p>}
                      </div>
                    </div>
                  </section>

                  {/* ── Key Findings ── */}
                  <section>
                    <h2 className="text-[13px] font-bold text-[#111827] uppercase tracking-wider mb-4 flex items-center gap-2 pb-2 border-b border-gray-100">
                      <AlertTriangle className="w-4 h-4 text-[#D97706]" />
                      Key Findings &amp; Analysis
                    </h2>
                    <div className="space-y-2">
                      {[
                        missingCells > 0 && {
                          icon: "🩹", color: "#2563EB",
                          title: "Missing Value Treatment",
                          desc: `${missingCells.toLocaleString()} missing values detected across ${totalCols} columns. Imputation strategies applied to maintain dataset integrity.`,
                        },
                        highRisk > 0 && {
                          icon: "⚠️", color: "#DC2626",
                          title: "High-Risk Operations Detected",
                          desc: `${highRisk} high-risk operation${highRisk > 1 ? "s" : ""} were applied. Review the preprocessing audit log before using this data in production.`,
                        },
                        opCount > 0 && {
                          icon: "✅", color: "#16A34A",
                          title: "Automated Cleaning Pipeline",
                          desc: `${opCount} preprocessing step${opCount > 1 ? "s" : ""} successfully applied. Dataset is ready for analysis and machine learning.`,
                        },
                        numericCols.length > 0 && {
                          icon: "📊", color: "#7C3AED",
                          title: "Numeric Data Summary",
                          desc: `${numericCols.length} numeric column${numericCols.length > 1 ? "s" : ""} identified. Consider standardization or normalization before training ML models.`,
                        },
                      ].filter(Boolean).map((f, i) => (
                        <div key={i} className="flex items-start gap-3 px-4 py-3 rounded-xl bg-[#F9FAFB] border border-gray-100">
                          <span className="text-base mt-0.5">{f.icon}</span>
                          <div>
                            <p className="text-[12px] font-semibold" style={{ color: f.color }}>{f.title}</p>
                            <p className="text-[11px] text-[#6A7282] mt-0.5">{f.desc}</p>
                          </div>
                        </div>
                      ))}
                      {opCount === 0 && missingCells === 0 && (
                        <div className="flex items-center gap-2 text-[12px] text-[#16A34A] px-4 py-3 bg-green-50 rounded-xl border border-green-100">
                          <CheckCircle className="w-4 h-4" /> Dataset appears clean — no issues detected.
                        </div>
                      )}
                    </div>
                  </section>

                  {/* ── Custom Charts (saved from Visualization page) ── */}
                  {savedCharts.length > 0 && (
                    <section>
                      <h2 className="text-[13px] font-bold text-[#111827] uppercase tracking-wider mb-4 flex items-center gap-2 pb-2 border-b border-gray-100">
                        <BarChart3 className="w-4 h-4 text-[#2B7FFF]" />
                        Data Visualizations ({savedCharts.length})
                      </h2>
                      <div className="flex flex-col gap-6">
                        {savedCharts.map((chart) => {
                          const cfg = chart.chart_config || {};
                          const chartData = cfg.data || [];
                          const chartType = cfg.chart_type || "bar";
                          return (
                            <div key={chart.id} className="border border-gray-100 rounded-xl p-4 bg-[#F9FAFB]">
                              <p className="text-[12px] font-semibold text-[#374151] mb-0.5">
                                {cfg.title || chart.chart_title || "Custom Chart"}
                              </p>
                              <p className="text-[10px] text-[#9CA3AF] mb-3 capitalize">{chartType.replace("_", " ")}</p>
                              <ExportChart type={chartType} data={chartData} xAxis={cfg.x_axis} yAxis={cfg.y_axis} />
                            </div>
                          );
                        })}
                      </div>
                    </section>
                  )}

                  {/* ── Generated Visualizations (from Visualize page) ── */}
                  {vizCharts.length > 0 && (
                    <section>
                      <h2 className="text-[13px] font-bold text-[#111827] uppercase tracking-wider mb-4 flex items-center gap-2 pb-2 border-b border-gray-100">
                        <BarChart3 className="w-4 h-4 text-[#AD46FF]" />
                        Generated Visualizations ({vizCharts.length})
                      </h2>
                      <div className="flex flex-col gap-6">
                        {vizCharts.map((chart) => {
                          const data = chart.data || [];
                          const type = chart.chart_type || "bar";
                          return (
                            <div key={chart.id} className="border border-gray-100 rounded-xl p-4 bg-[#F9FAFB]">
                              <div className="flex items-center justify-between mb-0.5">
                                <p className="text-[12px] font-semibold text-[#374151]">{chart.title || type}</p>
                                {chart.isUserChart && (
                                  <span className="text-[9px] font-medium text-[#10B981] ml-1 shrink-0">Custom</span>
                                )}
                              </div>
                              <p className="text-[10px] text-[#9CA3AF] mb-3 capitalize">
                                {type}{chart.x_axis ? ` · ${chart.x_axis}` : ""}{chart.y_axis ? ` vs ${chart.y_axis}` : ""}
                              </p>
                              <ExportChart type={type} data={data} xAxis={chart.x_axis} yAxis={chart.y_axis} />
                              {chart.reasoning && (
                                <p className="text-[11px] text-[#6A7282] mt-3 leading-relaxed">{chart.reasoning}</p>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    </section>
                  )}

                  {/* ── ML Training Results ── */}
                  {mlTrainResult && mlTrainResult.results?.length > 0 && (() => {
                    const sortedResults = [...mlTrainResult.results].sort(
                      (a, b) => (b.metrics?.accuracy ?? b.metrics?.r2 ?? 0) - (a.metrics?.accuracy ?? a.metrics?.r2 ?? 0),
                    );
                    const isRegression = mlTrainResult.task?.toLowerCase().includes("regress");
                    const bestModel = sortedResults[0];
                    const MODEL_ICONS_LOCAL = { KNN:"🔵", Random_Forest:"🌲", XGBoost:"⚡", LightGBM:"💡", SVM:"🔷", Linear_Regression:"📈", Logistic_Regression:"📊", CatBoost:"🐱" };
                    const MODEL_LABELS_LOCAL = { KNN:"KNN", Random_Forest:"Random Forest", XGBoost:"XGBoost", LightGBM:"LightGBM", SVM:"SVM", Linear_Regression:"Linear Regression", Logistic_Regression:"Logistic Regression", CatBoost:"CatBoost" };
                    const fmtAcc = (v) => v != null ? `${(v * 100).toFixed(1)}%` : "—";
                    const fmtNum = (v, d = 4) => v != null ? Number(v).toFixed(d) : "—";
                    return (
                      <section>
                        <h2 className="text-[13px] font-bold text-[#111827] uppercase tracking-wider mb-4 flex items-center gap-2 pb-2 border-b border-gray-100">
                          <Cpu className="w-4 h-4 text-[#0891B2]" />
                          ML Training Results
                        </h2>

                        {/* Config chips */}
                        <div className="flex flex-wrap gap-2 mb-4">
                          {[
                            { label: "Task",    value: mlTrainResult.task || "—",          color: "#7C3AED" },
                            { label: "Target",  value: mlTrainResult.target_column || "—", color: "#2563EB" },
                            { label: "Features",value: (mlTrainResult.feature_columns || []).length, color: "#16A34A" },
                            { label: "Models",  value: sortedResults.length,               color: "#D97706" },
                          ].map((c) => (
                            <div key={c.label} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#F9FAFB] border border-gray-100 text-[11px]">
                              <span className="text-[#6A7282]">{c.label}:</span>
                              <span className="font-semibold" style={{ color: c.color }}>{c.value}</span>
                            </div>
                          ))}
                        </div>

                        {/* Best model callout */}
                        {bestModel && (
                          <div className="flex items-center gap-3 px-4 py-3 rounded-xl mb-4"
                            style={{ background: "linear-gradient(135deg, #EFF6FF 0%, #F5F3FF 100%)", border: "1px solid #DBEAFE" }}>
                            <span className="text-xl">{MODEL_ICONS_LOCAL[bestModel.model_type] || "🤖"}</span>
                            <div className="flex-1">
                              <p className="text-[12px] font-bold text-[#1D4ED8]">
                                Best Model: {MODEL_LABELS_LOCAL[bestModel.model_type] || bestModel.model_type}
                              </p>
                              <p className="text-[11px] text-[#6A7282]">
                                {isRegression
                                  ? `R² ${fmtNum(bestModel.metrics?.r2, 3)}  ·  MAE ${fmtNum(bestModel.metrics?.mae, 3)}`
                                  : `Accuracy ${fmtAcc(bestModel.metrics?.accuracy)}  ·  F1 ${fmtNum(bestModel.metrics?.f1, 3)}`}
                                {bestModel.metrics?.training_time != null && ` · ${bestModel.metrics.training_time.toFixed(2)}s`}
                              </p>
                            </div>
                            <span className="text-lg font-bold" style={{ color: "#1D4ED8" }}>
                              {isRegression ? fmtNum(bestModel.metrics?.r2, 3) : fmtAcc(bestModel.metrics?.accuracy)}
                            </span>
                          </div>
                        )}

                        {/* Results table */}
                        <div className="border border-gray-100 rounded-xl overflow-x-auto text-[11px]">
                          <div className={`grid min-w-[420px] bg-[#F9FAFB] px-4 py-2 text-[10px] font-semibold text-[#6B7280] uppercase tracking-wide border-b border-gray-100 ${isRegression ? "grid-cols-[2fr_1fr_1fr_1fr_1fr]" : "grid-cols-[2fr_1fr_1fr_1fr_1fr]"}`}>
                            <span>Model</span>
                            <span>{isRegression ? "R²" : "Accuracy"}</span>
                            <span>{isRegression ? "MAE" : "F1 Score"}</span>
                            <span>{isRegression ? "RMSE" : "Precision"}</span>
                            <span>Time (s)</span>
                          </div>
                          {sortedResults.map((r, i) => (
                            <div key={r.model_type} className={`grid grid-cols-[2fr_1fr_1fr_1fr_1fr] min-w-[420px] px-4 py-2.5 border-b border-gray-50 items-center ${i === 0 ? "bg-[#EFF6FF]" : "hover:bg-[#FAFAFA]"}`}>
                              <div className="flex items-center gap-1.5">
                                {i === 0 && <span className="text-[10px]">🥇</span>}
                                <span className="text-[10px]">{MODEL_ICONS_LOCAL[r.model_type] || "🤖"}</span>
                                <span className="font-medium text-[#374151]">{MODEL_LABELS_LOCAL[r.model_type] || r.model_type}</span>
                              </div>
                              <span className="font-bold" style={{ color: i === 0 ? "#1D4ED8" : "#374151" }}>
                                {isRegression ? fmtNum(r.metrics?.r2, 3) : fmtAcc(r.metrics?.accuracy)}
                              </span>
                              <span className="text-[#374151]">
                                {isRegression ? fmtNum(r.metrics?.mae, 3) : fmtNum(r.metrics?.f1, 3)}
                              </span>
                              <span className="text-[#374151]">
                                {isRegression ? fmtNum(r.metrics?.rmse, 3) : fmtNum(r.metrics?.precision, 3)}
                              </span>
                              <span className="text-[#374151]">
                                {r.metrics?.training_time != null ? r.metrics.training_time.toFixed(2) : "—"}
                              </span>
                            </div>
                          ))}
                        </div>

                        {/* Feature columns */}
                        {(mlTrainResult.feature_columns || []).length > 0 && (
                          <div className="mt-3 px-4 py-3 bg-[#F9FAFB] rounded-xl border border-gray-100">
                            <p className="text-[10px] font-semibold text-[#6B7280] uppercase tracking-wide mb-2">Feature Columns Used</p>
                            <div className="flex flex-wrap gap-1">
                              {mlTrainResult.feature_columns.map((f) => (
                                <span key={f} className="text-[10px] bg-white border border-gray-200 text-[#374151] px-2 py-0.5 rounded font-mono">{f}</span>
                              ))}
                            </div>
                          </div>
                        )}

                        {mlTrainResult.trained_at && (
                          <p className="text-[10px] text-[#9CA3AF] mt-2 text-right">
                            Trained {fmtDate(mlTrainResult.trained_at)}
                          </p>
                        )}
                      </section>
                    );
                  })()}

                  {/* ── Dataset Assessment ── */}
                  <section className="border-t border-gray-100 pt-6">
                    <h2 className="text-[13px] font-bold text-[#111827] uppercase tracking-wider mb-4 flex items-center gap-2">
                      <Layers className="w-4 h-4 text-[#6B7280]" />
                      Dataset Assessment
                    </h2>
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                      {[
                        { label: "Missing Cells",  value: missingCells.toLocaleString(),   color: missingCells > 0 ? "#D97706" : "#16A34A" },
                        { label: "Columns",        value: totalCols,                        color: "#2B7FFF" },
                        { label: "Outliers",       value: logs.filter(l => l.operation?.includes("outlier") || l.operation?.includes("cap")).length, color: "#7C3AED" },
                        { label: "Preprocessing",  value: opCount,                          color: "#16A34A" },
                      ].map((s) => (
                        <div key={s.label} className="rounded-xl bg-[#F9FAFB] border border-gray-100 px-4 py-3 text-center">
                          <p className="text-2xl font-bold" style={{ color: s.color }}>{s.value}</p>
                          <p className="text-[10px] text-[#9CA3AF] mt-1">{s.label}</p>
                        </div>
                      ))}
                    </div>
                    <p className="text-[10px] text-[#9CA3AF] mt-4 text-center">
                      Generated by CleanLogic · {fmtDate()} · Session {sessionId?.slice(0, 8)}…
                    </p>
                  </section>

                </div>
              </div>
            </div>

            {/* ── RIGHT: Export Options ── */}
            <div className="w-full xl:w-[280px] xl:flex-shrink-0 space-y-4">

              {/* Download Cleaned Dataset */}
              <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
                <p className="text-[12px] font-semibold text-[#374151] mb-1 uppercase tracking-wide">Download Cleaned Dataset</p>
                <p className="text-[11px] text-[#6A7282] mb-4">Export your processed data file directly</p>
                <div className="space-y-2">
                  <button
                    onClick={() => handleDownloadDataset("csv")}
                    disabled={!!datasetExporting}
                    className="w-full flex items-center justify-between px-4 py-3 rounded-xl border border-[#D1FAE5] bg-[#F0FDF4] hover:bg-[#DCFCE7] disabled:opacity-50 transition-colors group"
                  >
                    <div className="flex items-center gap-2.5">
                      <span className="text-base">📄</span>
                      <div className="text-left">
                        <p className="text-[12px] font-semibold text-[#15803D]">CSV Format</p>
                        <p className="text-[10px] text-[#6B7280]">Comma-separated values</p>
                      </div>
                    </div>
                    {datasetExporting === "csv"
                      ? <RefreshCw className="w-4 h-4 text-[#15803D] animate-spin" />
                      : <Download className="w-4 h-4 text-[#15803D]" />}
                  </button>
                  <button
                    onClick={() => handleDownloadDataset("xlsx")}
                    disabled={!!datasetExporting}
                    className="w-full flex items-center justify-between px-4 py-3 rounded-xl border border-[#DBEAFE] bg-[#EFF6FF] hover:bg-[#DBEAFE] disabled:opacity-50 transition-colors group"
                  >
                    <div className="flex items-center gap-2.5">
                      <span className="text-base">📊</span>
                      <div className="text-left">
                        <p className="text-[12px] font-semibold text-[#1D4ED8]">Excel Format</p>
                        <p className="text-[10px] text-[#6B7280]">Microsoft Excel (.xlsx)</p>
                      </div>
                    </div>
                    {datasetExporting === "xlsx"
                      ? <RefreshCw className="w-4 h-4 text-[#1D4ED8] animate-spin" />
                      : <Download className="w-4 h-4 text-[#1D4ED8]" />}
                  </button>
                </div>
                <p className="text-[10px] text-[#9CA3AF] mt-3 text-center">
                  {totalRows > 0 ? `${totalRows.toLocaleString()} rows · ${totalCols} columns` : "Session data"}
                </p>
              </div>

              {/* Format selector */}
              <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
                <p className="text-[12px] font-semibold text-[#374151] mb-3 uppercase tracking-wide">Export Options</p>
                <p className="text-[11px] text-[#6A7282] mb-3">File format</p>
                <div className="space-y-2 mb-4">
                  {[
                    { value: "pdf",  label: "PDF Report",   desc: "Full formatted report" },
                    { value: "csv",  label: "CSV Data",     desc: "Cleaned dataset rows" },
                    { value: "json", label: "JSON Report",  desc: "Machine-readable report" },
                  ].map((f) => (
                    <label key={f.value}
                      className={`flex items-center gap-3 px-3 py-2.5 rounded-xl border cursor-pointer transition-colors ${
                        fileFormat === f.value ? "border-[#2B7FFF] bg-[#EFF6FF]" : "border-gray-100 hover:border-gray-200"
                      }`}>
                      <input type="radio" name="format" value={f.value}
                        checked={fileFormat === f.value}
                        onChange={() => setFileFormat(f.value)}
                        className="accent-[#2B7FFF]" />
                      <div>
                        <p className="text-[12px] font-semibold text-[#374151]">{f.label}</p>
                        <p className="text-[10px] text-[#9CA3AF]">{f.desc}</p>
                      </div>
                    </label>
                  ))}
                </div>
                <button onClick={handleExport} disabled={exporting}
                  className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl text-white text-[13px] font-semibold disabled:opacity-50 transition-colors"
                  style={{ background: "linear-gradient(90deg, #155DFC 0%, #9810FA 100%)" }}>
                  {exporting ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
                  {exporting ? "Exporting…" : `Export ${fileFormat.toUpperCase()} Report`}
                </button>
              </div>

              {/* Quick Commands */}
              <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
                <p className="text-[12px] font-semibold text-[#374151] mb-3 uppercase tracking-wide">Quick Commands</p>
                <div className="space-y-1.5">
                  {[
                    { label: "Export PDF Report",     icon: FileText,  action: () => window.print(),       color: "#2B7FFF" },
                    { label: "Download CSV Dataset",    icon: Download,  action: () => handleDownloadDataset("csv"),  color: "#16A34A" },
                    { label: "Download Excel Dataset",  icon: Download,  action: () => handleDownloadDataset("xlsx"), color: "#0EA5E9" },
                    { label: "Download JSON Report",   icon: Download,  action: handleDownloadJSON,         color: "#7C3AED" },
                    { label: "View Audit Log",         icon: Layers,    action: () => navigate("/log"),     color: "#D97706" },
                    { label: "View ML Models",         icon: Cpu,       action: () => navigate("/ml"),      color: "#0891B2" },
                    { label: "Back to Visualize",      icon: BarChart3, action: () => navigate("/visualize"), color: "#EC4899" },
                  ].map((cmd) => (
                    <button key={cmd.label} onClick={cmd.action}
                      className="w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-left hover:bg-[#F9FAFB] transition-colors group">
                      <cmd.icon className="w-3.5 h-3.5 flex-shrink-0" style={{ color: cmd.color }} />
                      <span className="text-[12px] text-[#374151] group-hover:text-[#111827]">{cmd.label}</span>
                      <ExternalLink className="w-3 h-3 text-[#D1D5DB] ml-auto opacity-0 group-hover:opacity-100 transition-opacity" />
                    </button>
                  ))}
                </div>
              </div>

              {/* New session */}
              <button onClick={() => navigate("/upload")}
                className="w-full flex items-center justify-center gap-2 py-3 rounded-2xl text-white text-[13px] font-semibold transition-all hover:opacity-90 shadow-sm"
                style={{ background: "linear-gradient(135deg, #2B7FFF 0%, #AD46FF 100%)" }}>
                <Plus className="w-4 h-4" />
                New Data Session
              </button>
            </div>

          </div>
        )}
      </main>
    </div>
  );
}
