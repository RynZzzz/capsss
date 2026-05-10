import { useEffect, useState } from "react";
import {
  ShieldCheck,
  AlertTriangle,
  AlertCircle,
  Clock,
  Database,
  FileText,
} from "lucide-react";
import { useNavigate } from "react-router-dom";
import AppHeader from "../../components/common/AppHeader";
import ApiService from "../../services/api";
import { getLogs } from "../../cache/sessionCache";


// ---------------------------------------------------------------------------
// Risk badge
// ---------------------------------------------------------------------------
function RiskBadge({ level }) {
  const map = {
    low: {
      color: "bg-green-50 text-green-700 border-green-200",
      icon: ShieldCheck,
      label: "Low Risk",
    },
    medium: {
      color: "bg-amber-50 text-amber-700 border-amber-200",
      icon: AlertTriangle,
      label: "Medium Risk",
    },
    high: {
      color: "bg-red-50 text-[#FF6467] border-red-200",
      icon: AlertCircle,
      label: "High Risk",
    },
  };
  const cfg = map[level?.toLowerCase()] || map.low;
  const Icon = cfg.icon;
  return (
    <span className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-medium border ${cfg.color}`}>
      <Icon className="w-3 h-3" />
      {cfg.label}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Operation label
// ---------------------------------------------------------------------------
const OP_LABELS = {
  impute: "Impute Missing Values",
  fill_nulls: "Fill Nulls",
  outlier: "Handle Outliers",
  cap_outliers: "Cap Outliers",
  remove_outliers: "Remove Outliers",
  duplicates: "Handle Duplicates",
  deduplicate: "Deduplicate",
  type_conversion: "Type Conversion",
  convert_type: "Convert Type",
  type_inconsistency: "Fix Type Inconsistency",
  normalize_case: "Normalize Case",
  lowercase: "Lowercase",
  uppercase: "Uppercase",
  trim_whitespace: "Trim Whitespace",
  normalize_date: "Normalize Dates",
  validate_regex: "Validate Format",
  drop_column: "Drop Column",
  delete_rows: "Delete Rows",
  cell_update: "Cell Edit",
  add_column: "Add Column",
  add_rows: "Add Rows",
};

const OP_ICONS = {
  impute: "🩹",
  fill_nulls: "🩹",
  outlier: "📊",
  cap_outliers: "📊",
  remove_outliers: "📊",
  duplicates: "🔁",
  deduplicate: "🔁",
  type_conversion: "🔤",
  convert_type: "🔤",
  type_inconsistency: "⚠️",
  normalize_case: "✏️",
  lowercase: "✏️",
  uppercase: "✏️",
  trim_whitespace: "✂️",
  normalize_date: "📅",
  validate_regex: "🔍",
  drop_column: "🗑️",
  delete_rows: "🗑️",
  cell_update: "✏️",
  add_column: "➕",
  add_rows: "➕",
};

function OpLabel({ operation }) {
  const icon = OP_ICONS[operation?.toLowerCase()] || "🔧";
  const label = OP_LABELS[operation?.toLowerCase()] || operation || "Operation";
  return (
    <span className="inline-flex items-center gap-1.5">
      <span>{icon}</span>
      <span>{label}</span>
    </span>
  );
}

// ---------------------------------------------------------------------------
// Format timestamp
// ---------------------------------------------------------------------------
function fmtDate(iso) {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString(undefined, {
      month: "short",
      day: "numeric",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

// ---------------------------------------------------------------------------
// Single log entry card
// ---------------------------------------------------------------------------
function LogCard({ log, index }) {
  const confPct = log.confidence != null ? Math.round(log.confidence * 100) : null;

  return (
    <div className="flex gap-4">
      {/* Timeline spine */}
      <div className="flex flex-col items-center">
        <div className="w-9 h-9 rounded-[14px] flex items-center justify-center text-white text-sm font-bold flex-shrink-0"
          style={{ background: "linear-gradient(135deg, #2B7FFF 0%, #AD46FF 100%)" }}>
          {index + 1}
        </div>
        <div className="w-0.5 bg-gray-100 flex-1 mt-2" />
      </div>

      {/* Card body */}
      <div className="flex-1 bg-white rounded-2xl border border-gray-100 shadow-sm mb-4 overflow-hidden">
        {/* Header bar */}
        <div className="px-5 py-3 flex items-center justify-between flex-wrap gap-2"
          style={{ background: "linear-gradient(90deg, #155DFC 0%, #4F39F6 50%, #9810FA 100%)" }}>
          <div className="flex items-center gap-2 text-white font-semibold text-sm">
            <OpLabel operation={log.operation} />
          </div>
          <div className="flex items-center gap-2">
            {confPct !== null && (
              <span className="text-xs text-white/80 font-medium">{confPct}% confidence</span>
            )}
            <RiskBadge level={log.risk_level} />
          </div>
        </div>

        {/* Details */}
        <div className="px-5 py-4 grid grid-cols-1 sm:grid-cols-2 gap-x-8 gap-y-3">
          {/* Column */}
          <div className="flex items-start gap-3">
            <div className="w-7 h-7 rounded-lg bg-[#2B7FFF]/10 flex items-center justify-center flex-shrink-0 mt-0.5">
              <Database className="w-3.5 h-3.5 text-[#2B7FFF]" />
            </div>
            <div>
              <p className="text-xs text-[#6A7282] mb-0.5">Column</p>
              <p className="text-sm font-mono font-medium text-[#101828]">{log.column_name}</p>
            </div>
          </div>

          {/* Timestamp + user */}
          <div className="flex items-start gap-3">
            <div className="w-7 h-7 rounded-lg bg-[#AD46FF]/10 flex items-center justify-center flex-shrink-0 mt-0.5">
              <Clock className="w-3.5 h-3.5 text-[#AD46FF]" />
            </div>
            <div>
              <p className="text-xs text-[#6A7282] mb-0.5">Applied</p>
              <p className="text-sm text-[#101828]">{fmtDate(log.applied_at)}</p>
              {log.user && (
                <p className="text-xs text-[#6A7282] mt-0.5">by {log.user}</p>
              )}
            </div>
          </div>

          {/* Original issue */}
          {log.original_issue && (
            <div className="flex items-start gap-3">
              <div className="w-7 h-7 rounded-lg bg-amber-50 flex items-center justify-center flex-shrink-0 mt-0.5">
                <AlertTriangle className="w-3.5 h-3.5 text-amber-500" />
              </div>
              <div>
                <p className="text-xs text-[#6A7282] mb-0.5">Detected Issue</p>
                <p className="text-sm text-[#101828] capitalize">{log.original_issue.replace(/_/g, " ")}</p>
              </div>
            </div>
          )}

          {/* Parameters */}
          {log.parameters && Object.keys(log.parameters).length > 0 && (
            <div className="flex items-start gap-3">
              <div className="w-7 h-7 rounded-lg bg-gray-100 flex items-center justify-center flex-shrink-0 mt-0.5">
                <span className="text-xs font-mono text-gray-500">{"{}"}</span>
              </div>
              <div>
                <p className="text-xs text-[#6A7282] mb-0.5">Parameters</p>
                <p className="text-sm font-mono text-[#101828]">
                  {Object.entries(log.parameters)
                    .filter(([, v]) => v != null)
                    .map(([k, v]) => `${k}: ${v}`)
                    .join(" · ")}
                </p>
              </div>
            </div>
          )}
        </div>

        {/* Reason section */}
        {log.reason && (
          <div className="mx-5 mb-4 px-4 py-3 rounded-xl bg-green-50 border border-green-100">
            <p className="text-xs font-semibold text-green-700 mb-1">Audit Reason</p>
            <p className="text-sm text-green-900 leading-relaxed">{log.reason}</p>
          </div>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------
export default function CleaningOperationsLog() {
  const [logs, setLogs] = useState([]);
  const [isLoading, setIsLoading] = useState(false);
  const [loadError, setLoadError] = useState(null);
  const navigate = useNavigate();
  const sessionId = localStorage.getItem("cleanlogic_session_id") || null;
  const filename = localStorage.getItem("cleanlogic_filename") || null;

  useEffect(() => {
    if (!sessionId) navigate("/upload");
  }, [sessionId, navigate]);

  useEffect(() => {
    if (!sessionId) return;
    const load = async () => {
      setIsLoading(true);
      setLoadError(null);
      try {
        const result = await getLogs(sessionId);
        setLogs(result.logs || []);
      } catch (e) {
        setLoadError(e?.message || "Failed to load logs");
      } finally {
        setIsLoading(false);
      }
    };
    load();
  }, [sessionId]);

  // Summary stats
  const totalOps = logs.length;
  const highRisk = logs.filter((l) => l.risk_level === "high").length;
  const medRisk = logs.filter((l) => l.risk_level === "medium").length;
  const lowRisk = logs.filter((l) => l.risk_level === "low").length;

  return (
    <div className="min-h-screen bg-[#F8F9FB] font-['Poppins'] overflow-x-hidden">
      <AppHeader />

      <main className="pt-[80px] sm:pt-[90px] lg:pt-[130px] px-4 sm:px-6 lg:px-[100px] max-w-[1200px] mx-auto pb-16">
        {/* Page title */}
        <div className="flex items-start justify-between mb-6">
          <div>
            <h2 className="text-xl sm:text-2xl lg:text-[28px] font-bold text-transparent bg-clip-text bg-gradient-to-r from-[#2B7FFF] to-[#AD46FF]">
              Preprocessing Audit Log
            </h2>
            <p className="text-sm text-[#6A7282] mt-1">
              Full audit trail of every transformation applied to your dataset
            </p>
            {filename && (
              <p className="text-xs text-[#98A2B3] mt-1">Dataset: {filename}</p>
            )}
          </div>
        </div>

        {/* Summary cards */}
        {totalOps > 0 && (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-8">
            {[
              { label: "Total Operations", value: totalOps, color: "from-[#2B7FFF]/10 to-[#2B7FFF]/5", text: "text-[#2B7FFF]" },
              { label: "Low Risk", value: lowRisk, color: "from-green-50 to-green-50/50", text: "text-green-700" },
              { label: "Medium Risk", value: medRisk, color: "from-amber-50 to-amber-50/50", text: "text-amber-700" },
              { label: "High Risk", value: highRisk, color: "from-red-50 to-red-50/50", text: "text-[#FF6467]" },
            ].map((card) => (
              <div key={card.label} className={`bg-gradient-to-br ${card.color} rounded-2xl p-4 border border-white/60`}>
                <p className="text-xs text-[#6A7282] mb-1">{card.label}</p>
                <p className={`text-3xl font-bold ${card.text}`}>{card.value}</p>
              </div>
            ))}
          </div>
        )}

        {/* Log entries */}
        {isLoading && (
          <div className="flex items-center gap-2 text-sm text-[#6A7282] py-12 justify-center">
            <div className="w-4 h-4 border-2 border-[#2B7FFF] border-t-transparent rounded-full animate-spin" />
            Loading audit log…
          </div>
        )}
        {loadError && (
          <div className="bg-red-50 border border-red-200 text-red-700 rounded-2xl px-5 py-4 text-sm">{loadError}</div>
        )}
        {!isLoading && !loadError && logs.length === 0 && (
          <div className="text-center py-20">
            <FileText className="w-12 h-12 mx-auto mb-3 text-gray-300" />
            <p className="text-gray-500 text-sm">No preprocessing operations recorded yet.</p>
            <p className="text-gray-400 text-xs mt-1">Apply cleaning steps on the Profiling page to start building your audit trail.</p>
          </div>
        )}
        {!isLoading && logs.length > 0 && (
          <div>
            {logs.map((log, i) => (
              <LogCard key={log.id} log={log} index={i} />
            ))}
          </div>
        )}
      </main>
    </div>
  );
}
