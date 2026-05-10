import React, { useState, useEffect, useCallback, useRef } from "react";
import { createPortal } from "react-dom";
import { useNavigate } from "react-router-dom";
import AppHeader from "../../components/common/AppHeader";
import ApiService from "../../services/api";
import { getMlInfo } from "../../cache/sessionCache";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell,
} from "recharts";
import {
  Brain, Settings, ChevronDown, ChevronUp, Play, Save, Zap, Library,
  RefreshCw, CheckCircle, AlertCircle, X, Star, TrendingUp, Clock, Database,
  Eye, Cpu, FlaskConical, Upload, Download, Trash2,
} from "lucide-react";

// ── Color helpers ──────────────────────────────────────────────────────────
const accColor = (v) => {
  if (v === null || v === undefined) return "#9CA3AF";
  if (v >= 0.88) return "#16A34A";
  if (v >= 0.85) return "#2563EB";
  return "#D97706";
};

const medal = (rank) =>
  rank === 0 ? "🥇" : rank === 1 ? "🥈" : rank === 2 ? "🥉" : `#${rank + 1}`;

const corrColor = (v) => {
  const abs = Math.abs(v);
  if (abs >= 0.8) return "#DC2626";
  if (abs >= 0.6) return "#EC4899";
  if (abs >= 0.2) return "#F59E0B";
  return "#16A34A";
};

// ── Tooltip portal ────────────────────────────────────────────────────────
function TooltipPortal({ tip, pos }) {
  if (!tip || !pos) return null;
  return createPortal(
    <div
      style={{ position: "fixed", left: pos.x, top: pos.y - 8, transform: "translate(-50%, -100%)", zIndex: 99999, pointerEvents: "none" }}
      className="w-56"
    >
      <div className="bg-gray-900 rounded-xl px-3.5 py-3 shadow-2xl">
        <p className="text-[11.5px] font-semibold text-white mb-1">{tip.title}</p>
        <p className="text-[10.5px] text-gray-300 leading-relaxed">{tip.desc}</p>
        {tip.warning && (
          <p className="text-[10px] text-amber-400 mt-2 flex items-start gap-1 leading-relaxed">
            <span className="mt-px shrink-0">⚠</span><span>{tip.warning}</span>
          </p>
        )}
      </div>
      <div className="w-3 h-3 bg-gray-900 rotate-45 mx-auto -mt-1.5 rounded-sm" />
    </div>,
    document.body
  );
}

function Tip({ tip, children, className = "" }) {
  const [pos, setPos] = useState(null);
  const ref = useRef(null);
  return (
    <div
      ref={ref}
      className={className}
      onMouseEnter={() => {
        if (!ref.current) return;
        const r = ref.current.getBoundingClientRect();
        setPos({ x: r.left + r.width / 2, y: r.top });
      }}
      onMouseLeave={() => setPos(null)}
    >
      {children}
      <TooltipPortal tip={pos ? tip : null} pos={pos} />
    </div>
  );
}

// ── Model tooltip content ──────────────────────────────────────────────────
const MODEL_TOOLTIPS = {
  KNN: {
    title: "K-Nearest Neighbors",
    desc: "Classifies by finding the K most similar training samples. Simple and interpretable.",
    warning: "Sensitive to feature scale — standardize numeric features for best results.",
  },
  Random_Forest: {
    title: "Random Forest",
    desc: "Ensemble of decision trees voting together. Robust, handles mixed data, and rarely overfits.",
  },
  XGBoost: {
    title: "XGBoost",
    desc: "Gradient boosting with built-in regularization. Consistently top-performing on structured data.",
  },
  LightGBM: {
    title: "LightGBM",
    desc: "Fast gradient boosting using histogram-based splits. Ideal for large datasets with many features.",
  },
  SVM: {
    title: "Support Vector Machine",
    desc: "Finds the optimal hyperplane separating classes. Effective in high-dimensional spaces.",
    warning: "Requires feature standardization. Slow on datasets larger than ~10 000 rows.",
  },
  Linear_Regression: {
    title: "Linear Regression",
    desc: "Predicts a continuous output as a linear combination of features. Fast and fully interpretable.",
    warning: "Best suited for regression tasks (numeric target).",
  },
  Logistic_Regression: {
    title: "Logistic Regression",
    desc: "Linear classifier with L2 regularization. Highly interpretable and a strong baseline.",
  },
  CatBoost: {
    title: "CatBoost",
    desc: "Gradient boosting built for categorical features — handles them natively without manual encoding.",
  },
};

// ── Default hyperparameters ────────────────────────────────────────────────
const DEFAULT_PARAMS = {
  KNN: { k: 5, distance: "euclidean", weights: "uniform" },
  Random_Forest: { n_estimators: 100, max_depth: 10, min_samples_split: 2, criterion: "gini" },
  XGBoost: { learning_rate: 0.1, max_depth: 6, n_estimators: 100 },
  LightGBM: { learning_rate: 0.1, max_depth: 6, n_estimators: 100 },
  SVM: { C: 1.0, kernel: "rbf" },
  Linear_Regression: {},
  Logistic_Regression: { C: 1.0, max_iter: 1000, solver: "lbfgs", penalty: "l2" },
  CatBoost: { learning_rate: 0.1, depth: 6, iterations: 100 },
};

const MODEL_LABELS = {
  KNN: "KNN",
  Random_Forest: "Random Forest",
  XGBoost: "XGBoost",
  LightGBM: "LightGBM",
  SVM: "SVM",
  Linear_Regression: "Linear Regression",
  Logistic_Regression: "Logistic Regression",
  CatBoost: "CatBoost",
};

const MODEL_ICONS = {
  KNN: "🔵",
  Random_Forest: "🌲",
  XGBoost: "⚡",
  LightGBM: "💡",
  SVM: "🔷",
  Linear_Regression: "📈",
  Logistic_Regression: "📊",
  CatBoost: "🐱",
};

// ── Slider ─────────────────────────────────────────────────────────────────
const Slider = ({ label, value, min, max, step = 1, onChange }) => (
  <div className="flex flex-col gap-1">
    <div className="flex justify-between text-[11px] text-[#374151]">
      <span>{label}</span>
      <span className="font-semibold text-[#2563EB]">{value}</span>
    </div>
    <input
      type="range" min={min} max={max} step={step} value={value}
      onChange={(e) => onChange(step < 1 ? parseFloat(e.target.value) : parseInt(e.target.value))}
      className="w-full h-1.5 accent-[#2563EB]"
    />
    <div className="flex justify-between text-[10px] text-[#9CA3AF]">
      <span>{min}</span><span>{max}</span>
    </div>
  </div>
);

// ── Toggle group ───────────────────────────────────────────────────────────
const ToggleGroup = ({ label, value, options, onChange }) => (
  <div className="flex flex-col gap-1">
    <span className="text-[11px] text-[#374151]">{label}</span>
    <div className="inline-flex bg-[#F3F4F6] rounded-md p-0.5 gap-0.5 flex-wrap">
      {options.map((opt) => (
        <button
          key={opt}
          onClick={() => onChange(opt)}
          className={`px-2 py-0.5 text-[11px] rounded transition-colors ${
            value === opt ? "bg-[#2563EB] text-white font-medium" : "text-[#6B7280] hover:text-[#374151]"
          }`}
        >
          {opt}
        </button>
      ))}
    </div>
  </div>
);

// ── HyperParam panel ───────────────────────────────────────────────────────
const HyperParamPanel = ({ modelType, params, onChange }) => {
  const set = (key) => (val) => onChange({ ...params, [key]: val });

  if (modelType === "KNN") return (
    <div className="grid grid-cols-1 gap-3">
      <Slider label="K (neighbors)" value={params.k} min={1} max={20} onChange={set("k")} />
      <ToggleGroup label="Distance" value={params.distance} options={["euclidean", "manhattan", "minkowski"]} onChange={set("distance")} />
      <ToggleGroup label="Weights" value={params.weights} options={["uniform", "distance"]} onChange={set("weights")} />
    </div>
  );
  if (modelType === "Random_Forest") return (
    <div className="grid grid-cols-1 gap-3">
      <Slider label="n_estimators" value={params.n_estimators} min={10} max={500} onChange={set("n_estimators")} />
      <Slider label="max_depth" value={params.max_depth} min={3} max={30} onChange={set("max_depth")} />
      <Slider label="min_samples_split" value={params.min_samples_split} min={2} max={20} onChange={set("min_samples_split")} />
      <ToggleGroup label="Criterion" value={params.criterion} options={["gini", "entropy"]} onChange={set("criterion")} />
    </div>
  );
  if (modelType === "XGBoost" || modelType === "LightGBM") return (
    <div className="grid grid-cols-1 gap-3">
      <Slider label="learning_rate" value={params.learning_rate} min={0.01} max={0.3} step={0.01} onChange={set("learning_rate")} />
      <Slider label="max_depth" value={params.max_depth} min={3} max={15} onChange={set("max_depth")} />
      <Slider label="n_estimators" value={params.n_estimators} min={50} max={500} onChange={set("n_estimators")} />
    </div>
  );
  if (modelType === "SVM") return (
    <div className="grid grid-cols-1 gap-3">
      <Slider label="C" value={params.C} min={0.1} max={10} step={0.1} onChange={set("C")} />
      <ToggleGroup label="Kernel" value={params.kernel} options={["rbf", "linear", "poly"]} onChange={set("kernel")} />
    </div>
  );
  if (modelType === "Logistic_Regression") return (
    <div className="grid grid-cols-1 gap-3">
      <Slider label="C (regularization)" value={params.C} min={0.01} max={10} step={0.01} onChange={set("C")} />
      <Slider label="max_iter" value={params.max_iter} min={100} max={5000} step={100} onChange={set("max_iter")} />
      <ToggleGroup label="Solver" value={params.solver} options={["lbfgs", "liblinear", "saga"]} onChange={set("solver")} />
      <ToggleGroup label="Penalty" value={params.penalty} options={["l2", "l1", "none"]} onChange={set("penalty")} />
    </div>
  );
  if (modelType === "CatBoost") return (
    <div className="grid grid-cols-1 gap-3">
      <Slider label="learning_rate" value={params.learning_rate} min={0.01} max={0.3} step={0.01} onChange={set("learning_rate")} />
      <Slider label="depth" value={params.depth} min={3} max={10} onChange={set("depth")} />
      <Slider label="iterations" value={params.iterations} min={50} max={500} step={50} onChange={set("iterations")} />
    </div>
  );
  return <p className="text-[11px] text-[#6B7280]">No tunable parameters.</p>;
};

// ── Modal ──────────────────────────────────────────────────────────────────
const Modal = ({ open, onClose, title, children }) => {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-lg max-h-[90vh] flex flex-col">
        <div className="flex items-center justify-between px-6 py-4 border-b border-[#E5E7EB]">
          <h3 className="text-[15px] font-semibold text-[#111827]">{title}</h3>
          <button onClick={onClose} className="p-1 rounded hover:bg-[#F3F4F6]">
            <X className="w-4 h-4 text-[#6B7280]" />
          </button>
        </div>
        <div className="overflow-y-auto flex-1 px-6 py-4">{children}</div>
      </div>
    </div>
  );
};

// ─────────────────────────────── MAIN PAGE ────────────────────────────────
export default function MLPage() {
  const navigate = useNavigate();
  const sessionId = localStorage.getItem("cleanlogic_session_id") || null;

  // ── Session columns
  const [sessionCols, setSessionCols] = useState([]);
  const [sessionRows, setSessionRows] = useState(0);
  const [colsLoading, setColsLoading] = useState(false);

  // ── Feature / target selection
  const [featureCols, setFeatureCols] = useState([]);
  const [targetCol, setTargetCol] = useState("");

  // ── Model selection
  const allModels = Object.keys(DEFAULT_PARAMS);
  const [selectedModels, setSelectedModels] = useState(["Random_Forest", "KNN"]);
  const [openTunePanel, setOpenTunePanel] = useState(null);
  const [hyperparams, setHyperparams] = useState(
    Object.fromEntries(allModels.map((m) => [m, { ...DEFAULT_PARAMS[m] }]))
  );

  // ── Global config
  const [trainSplit, setTrainSplit] = useState(80);
  const [cvFolds, setCvFolds] = useState(5);
  const [samplingMethod, setSamplingMethod] = useState("none");
  // ── Per-column preprocessing
  const [columnPrep, setColumnPrep] = useState({}); // col → "none"|"standard"|"normalize"|"label_encode"
  const [targetPrep, setTargetPrep] = useState("auto"); // "auto"|"label_encode"|"none"

  // ── Training state
  const [isTraining, setIsTraining] = useState(false);
  const [trainResult, setTrainResult] = useState(null);
  const [trainError, setTrainError] = useState("");
  const [resultRestored, setResultRestored] = useState(false);

  // ── View mode
  const [viewMode, setViewMode] = useState("table"); // "table" | "chart"

  // ── Correlation
  const [corrData, setCorrData] = useState(null);
  const [corrLoading, setCorrLoading] = useState(false);

  // ── Save modal
  const [saveModal, setSaveModal] = useState(null); // {result}
  const [saveForm, setSaveForm] = useState({ name: "", description: "", tags: "", visibility: "private" });
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState("");

  // ── Predict modal
  const [predictModal, setPredictModal] = useState(null);
  const [predictTab, setPredictTab] = useState("manual"); // "manual" | "file"
  const [predictInputs, setPredictInputs] = useState({});
  const [predicting, setPredicting] = useState(false);
  const [predResult, setPredResult] = useState(null);
  // file-mode state
  const [predFile, setPredFile] = useState(null);
  const [predFileDragging, setPredFileDragging] = useState(false);
  const predFileRef = React.useRef(null);
  const [trainRefOpen, setTrainRefOpen] = useState(false);

  // ── Preview transform modal
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewData, setPreviewData] = useState(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState("");
  const [previewTab, setPreviewTab] = useState("stats"); // "stats" | "rows"

  // ── Model library
  const [libraryTab, setLibraryTab] = useState("my"); // "my"|"public"|"all"
  const [libSort, setLibSort] = useState("date");
  const [libModels, setLibModels] = useState([]);
  const [libLoading, setLibLoading] = useState(false);
  const [libModelType, setLibModelType] = useState("");
  const [expandedMetrics, setExpandedMetrics] = useState(new Set());

  // ── Load session columns ──────────────────────────────────────────────────
  useEffect(() => {
    if (!sessionId) return;
    setColsLoading(true);
    getMlInfo(sessionId)
      .then((data) => {
        const cols = data.columns || [];
        setSessionCols(cols);
        setSessionRows(data.rows || 0);
        // Auto-populate columnPrep defaults for every column
        const initPrep = {};
        for (const col of cols) {
          initPrep[col.name] = col.type === "numeric" ? "none" : "label_encode";
        }
        setColumnPrep(initPrep);
        // Auto-select numeric features, last numeric as target
        const numCols = cols.filter((c) => c.type === "numeric").map((c) => c.name);
        if (numCols.length > 1) {
          setFeatureCols(numCols.slice(0, -1));
          setTargetCol(numCols[numCols.length - 1]);
        }
      })
      .catch(() => {})
      .finally(() => setColsLoading(false));
  }, [sessionId]);

  // ── Restore cached training result from localStorage on mount ───────────────
  useEffect(() => {
    if (!sessionId) return;
    try {
      const cached = localStorage.getItem(`cleanlogic_ml_cache_${sessionId}`);
      if (cached) {
        const parsed = JSON.parse(cached);
        if (parsed && parsed.results && parsed.results.length > 0) {
          setTrainResult(parsed);
          setResultRestored(true);
        }
      }
    } catch {}
  }, [sessionId]);

  // ── Load correlation on mount ─────────────────────────────────────────────
  useEffect(() => {
    if (!sessionId) return;
    setCorrLoading(true);
    ApiService.getMLCorrelation(sessionId)
      .then(setCorrData)
      .catch(() => {})
      .finally(() => setCorrLoading(false));
  }, [sessionId]);

  // ── Load library ──────────────────────────────────────────────────────────
  const loadLibrary = useCallback(() => {
    const userId = parseInt(localStorage.getItem("user_id") || localStorage.getItem("userId") || "1");
    setLibLoading(true);
    ApiService.listMLModels({ user_id: userId, scope: libraryTab, model_type: libModelType || undefined, sort_by: libSort })
      .then((data) => setLibModels(data.models || []))
      .catch(() => {})
      .finally(() => setLibLoading(false));
  }, [libraryTab, libSort, libModelType]);

  useEffect(() => { loadLibrary(); }, [loadLibrary]);

  // ── Train ─────────────────────────────────────────────────────────────────
  const handleTrain = async () => {
    if (!sessionId) return;
    if (selectedModels.length === 0) { setTrainError("Select at least one model."); return; }
    if (featureCols.length === 0) { setTrainError("Select at least one feature column."); return; }
    if (!targetCol) { setTrainError("Select a target column."); return; }

    setIsTraining(true);
    setTrainError("");
    setTrainResult(null);
    setResultRestored(false);

    try {
      const result = await ApiService.trainMLModels({
        session_id: sessionId,
        feature_columns: featureCols,
        target_column: targetCol,
        selected_models: selectedModels,
        hyperparameters: hyperparams,
        train_test_split: trainSplit / 100,
        cv_folds: cvFolds,
        feature_preprocessing: Object.fromEntries(
          featureCols.map((c) => [c, columnPrep[c] || "none"])
        ),
        target_preprocessing: targetPrep,
        sampling_method: samplingMethod,
      });
      setTrainResult(result);
      // Persist training result for ExportPage and reload restoration
      if (sessionId && result) {
        try {
          // Trimmed summary for ExportPage
          localStorage.setItem(
            `cleanlogic_ml_result_${sessionId}`,
            JSON.stringify({
              task: result.task,
              target_column: result.target_column || targetCol,
              feature_columns: result.feature_columns || featureCols,
              trained_at: new Date().toISOString(),
              results: (result.results || []).map((r) => ({
                model_type: r.model_type,
                metrics: r.metrics,
              })),
            }),
          );
          // Full result for reload restoration
          localStorage.setItem(
            `cleanlogic_ml_cache_${sessionId}`,
            JSON.stringify({ ...result, cached_at: new Date().toISOString() }),
          );
        } catch {}
      }
    } catch (e) {
      setTrainError(e.message || "Training failed");
    } finally {
      setIsTraining(false);
    }
  };

  // ── Save ──────────────────────────────────────────────────────────────────
  const openSave = (result) => {
    setSaveModal(result);
    setSaveForm({ name: `${MODEL_LABELS[result.model_type] || result.model_type} Model`, description: "", tags: "", visibility: "private" });
    setSaveMsg("");
  };

  const handleSave = async () => {
    if (!saveModal) return;
    if (!saveForm.name.trim()) { setSaveMsg("Name is required."); return; }
    setSaving(true);
    setSaveMsg("");
    const userId = parseInt(localStorage.getItem("user_id") || localStorage.getItem("userId") || "1");
    try {
      await ApiService.saveMLModel({
        session_id: sessionId,
        model_type: saveModal.model_type,
        model_name: saveForm.name.trim(),
        description: saveForm.description,
        tags: saveForm.tags.split(",").map((t) => t.trim()).filter(Boolean),
        visibility: saveForm.visibility,
        user_id: userId,
        feature_columns: saveModal.feature_columns || trainResult?.feature_columns || featureCols,
        target_column: saveModal.target_column || trainResult?.target_column || targetCol,
        hyperparameters: saveModal.hyperparameters || {},
        metrics: saveModal.metrics || {},
        training_time_seconds: saveModal.metrics?.training_time || 0,
        training_samples: saveModal.training_samples || 0,
        test_samples: saveModal.test_samples || 0,
        train_test_split: trainSplit / 100,
      });
      setSaveMsg("✓ Model saved successfully!");
      loadLibrary();
      setTimeout(() => setSaveModal(null), 1500);
    } catch (e) {
      const detail = e?.response?.data?.detail || e?.response?.data?.message || e.message || "";
      if (detail.toLowerCase().includes("not found in cache") || detail.toLowerCase().includes("retrain")) {
        setSaveMsg("Model is no longer in server memory. Click 'Train Models' again, then save.");
      } else {
        setSaveMsg(detail || "Save failed");
      }
    } finally {
      setSaving(false);
    }
  };

  // ── Predict ───────────────────────────────────────────────────────────────
  const openPredict = (result) => {
    const cols = result.feature_columns || featureCols;
    // Resolve feature_preprocessing: from result summary, or from stored hyperparameters
    const featPrep =
      result.preprocessing_summary?.feature_preprocessing ||
      result.hyperparameters?.feature_preprocessing ||
      {};
    const initInputs = Object.fromEntries(cols.map((c) => [c, ""]));
    setPredictModal({ ...result, featurePrep: featPrep });
    setPredictTab("manual");
    setPredictInputs(initInputs);
    setPredResult(null);
    setPredFile(null);
    setTrainRefOpen(false);
  };

  const closePredict = () => {
    setPredictModal(null);
    setPredResult(null);
    setPredFile(null);
  };

  // ── Manual single-row prediction ──────────────────────────────────────────
  const handlePredict = async () => {
    if (!predictModal) return;
    setPredicting(true);
    setPredResult(null);
    try {
      const userId = parseInt(localStorage.getItem("user_id") || localStorage.getItem("userId") || "1");
      const dbId = predictModal.id || predictModal.model_id;
      let res;
      if (dbId) {
        res = await ApiService.predictMLModel(dbId, { input_data: predictInputs, user_id: userId });
      } else {
        res = await ApiService.predictMLModelCached({
          session_id: sessionId,
          model_type: predictModal.model_type,
          feature_columns: predictModal.feature_columns || featureCols,
          target_column: predictModal.target_column || targetCol,
          input_data: predictInputs,
        });
      }
      setPredResult(res);
    } catch (e) {
      setPredResult({ error: e.message || "Prediction failed" });
    } finally {
      setPredicting(false);
    }
  };

  // ── File bulk prediction ───────────────────────────────────────────────────
  const handlePredictFile = async () => {
    if (!predictModal || !predFile) return;
    setPredicting(true);
    setPredResult(null);
    try {
      const dbId = predictModal.id || predictModal.model_id;
      let res;
      if (dbId) {
        res = await ApiService.predictMLModelFile(dbId, predFile);
      } else {
        res = await ApiService.predictMLModelCachedFile({
          session_id: sessionId,
          model_type: predictModal.model_type,
          feature_columns: predictModal.feature_columns || featureCols,
          target_column: predictModal.target_column || targetCol,
          file: predFile,
        });
      }
      setPredResult({ ...res, isFile: true });
    } catch (e) {
      setPredResult({ error: e.message || "Prediction failed" });
    } finally {
      setPredicting(false);
    }
  };

  // Download predictions as CSV
  const downloadPredCSV = () => {
    if (!predResult?.data) return;
    const cols = predResult.columns || Object.keys(predResult.data[0] || {});
    const header = cols.join(",");
    const rows = predResult.data.map((r) =>
      cols.map((c) => {
        const v = r[c];
        return v == null ? "" : String(v).includes(",") ? `"${v}"` : v;
      }).join(",")
    );
    const csv = [header, ...rows].join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `predictions_${predictModal?.model_type || "model"}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // ── Preview transform ─────────────────────────────────────────────────────
  const handlePreviewTransform = async () => {
    if (!sessionId || featureCols.length === 0 || !targetCol) return;
    setPreviewOpen(true);
    setPreviewLoading(true);
    setPreviewError("");
    setPreviewData(null);
    setPreviewTab("stats");
    try {
      const result = await ApiService.previewTransform({
        session_id: sessionId,
        feature_columns: featureCols,
        target_column: targetCol,
        feature_preprocessing: Object.fromEntries(
          featureCols.map((c) => [c, columnPrep[c] || "none"])
        ),
        target_preprocessing: targetPrep,
      });
      setPreviewData(result);
    } catch (e) {
      setPreviewError(e.message || "Preview failed");
    } finally {
      setPreviewLoading(false);
    }
  };

  // ── Toggle feature col ────────────────────────────────────────────────────
  const toggleFeature = (col) => {
    setFeatureCols((prev) =>
      prev.includes(col) ? prev.filter((c) => c !== col) : [...prev, col]
    );
  };

  if (!sessionId) {
    return (
      <div className="min-h-screen bg-[#F9FAFB]">
        <AppHeader />
        <div className="pt-[80px] sm:pt-[90px] lg:pt-[130px] flex items-center justify-center min-h-screen">
          <div className="text-center">
            <Brain className="w-16 h-16 text-[#9CA3AF] mx-auto mb-4" />
            <h2 className="text-xl font-semibold text-[#374151] mb-2">No Dataset Loaded</h2>
            <p className="text-[#6B7280] mb-4">Upload and preprocess a dataset first.</p>
            <button onClick={() => navigate("/upload")}
              className="px-5 py-2 bg-[#2563EB] text-white rounded-lg text-sm font-medium hover:bg-[#1D4ED8]">
              Go to Upload
            </button>
          </div>
        </div>
      </div>
    );
  }

  const results = trainResult?.results || [];
  const okResults = results
    .filter((r) => r.metrics)
    .sort((a, b) => (b.metrics.holdout_accuracy ?? b.metrics.accuracy ?? 0) - (a.metrics.holdout_accuracy ?? a.metrics.accuracy ?? 0));

  return (
    <div className="min-h-screen bg-[#F9FAFB]">
      <AppHeader />

      <div className="pt-[80px] sm:pt-[90px] lg:pt-[130px] max-w-[1400px] mx-auto px-4 sm:px-6 lg:px-[100px] py-6 space-y-6">
        {/* Page title */}
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-xl sm:text-2xl lg:text-[28px] font-bold text-transparent bg-clip-text bg-gradient-to-r from-[#2B7FFF] to-[#AD46FF]">
              ML Model Training
            </h2>
            <p className="text-sm text-[#6A7282] mt-0.5">
              Train, evaluate, and save machine learning models on your dataset
            </p>
          </div>
          {sessionId && (
            <span className="text-[12px] text-[#6B7280] bg-[#F3F4F6] px-3 py-1.5 rounded-full border border-[#E5E7EB]">
              {sessionRows.toLocaleString()} rows · {sessionCols.length} columns
            </span>
          )}
        </div>

        {/* ── Section: Column Selection ── */}
        <section className="bg-white rounded-xl border border-[#E5E7EB] overflow-hidden">
          <div className="px-5 py-3 bg-gradient-to-r from-[#7C3AED] to-[#6D28D9] flex items-center gap-2">
            <Database className="w-4 h-4 text-white" />
            <h2 className="text-sm font-semibold text-white">1. Column Selection</h2>
          </div>
          <div className="p-5">
            {colsLoading ? (
              <div className="text-[#6B7280] text-sm">Loading columns…</div>
            ) : (
              <>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                {/* Features */}
                <div>
                  <label className="text-[12px] font-semibold text-[#374151] mb-2 block">
                    Feature Columns (X) — {featureCols.length} selected
                  </label>
                  <div className="border border-[#E5E7EB] rounded-lg max-h-44 overflow-y-auto divide-y divide-[#F3F4F6]">
                    {sessionCols.map((col) => (
                      col.name !== targetCol && (
                        <label key={col.name} className="flex items-center gap-2 px-3 py-1.5 hover:bg-[#F9FAFB] cursor-pointer">
                          <input
                            type="checkbox"
                            checked={featureCols.includes(col.name)}
                            onChange={() => toggleFeature(col.name)}
                            className="accent-[#7C3AED]"
                          />
                          <span className="text-[12px] text-[#374151] flex-1">{col.name}</span>
                          <span className={`text-[10px] px-1.5 py-0.5 rounded-full ${
                            col.type === "numeric" ? "bg-[#DBEAFE] text-[#2563EB]" : "bg-[#FEF3C7] text-[#D97706]"
                          }`}>{col.type}</span>
                        </label>
                      )
                    ))}
                  </div>
                </div>
                {/* Target */}
                <div>
                  <label className="text-[12px] font-semibold text-[#374151] mb-2 block">
                    Target Column (y)
                  </label>
                  <select
                    value={targetCol}
                    onChange={(e) => {
                      const name = e.target.value;
                      setTargetCol(name);
                      setFeatureCols((p) => p.filter((c) => c !== name));
                      const tColInfo = sessionCols.find((c) => c.name === name);
                      setTargetPrep(tColInfo?.type === "numeric" ? "none" : "auto");
                    }}
                    className="w-full border border-[#E5E7EB] rounded-lg px-3 py-2 text-sm text-[#374151] focus:ring-2 focus:ring-[#7C3AED] outline-none"
                  >
                    <option value="">— select target —</option>
                    {sessionCols.map((col) => (
                      <option key={col.name} value={col.name}>{col.name}</option>
                    ))}
                  </select>
                  {targetCol && (
                    <p className="mt-1 text-[11px] text-[#6B7280]">
                      Task type will be auto-detected from target values.
                    </p>
                  )}
                  {/* Global config */}
                  <div className="mt-4 space-y-3">
                    <Slider label="Train / Test Split" value={trainSplit} min={60} max={90}
                      onChange={setTrainSplit} />
                    <Slider label="Cross Validation Folds" value={cvFolds} min={3} max={10} onChange={setCvFolds} />
                  </div>
                </div>
              </div>

              {/* ── Class Distribution & Sampling Card ── */}
              {targetCol && (() => {
                const tInfo = sessionCols.find((c) => c.name === targetCol);
                const dist = tInfo?.class_distribution || [];
                const isImbalanced = !!tInfo?.is_imbalanced;
                if (dist.length === 0) return null;

                const barColors = [
                  "#7C3AED","#2563EB","#059669","#D97706","#DC2626",
                  "#7C3AED","#0891B2","#65A30D","#EA580C","#9333EA",
                ];

                // Simulate post-resampling distribution
                const isSimulated = samplingMethod !== "none" && samplingMethod !== "stratified";
                const displayDist = (() => {
                  if (!isSimulated) return dist;
                  const maxCount = Math.max(...dist.map((d) => d.count));
                  const simCounts = dist.map((d) => {
                    if (samplingMethod === "smote_tomek") {
                      return d.count === maxCount
                        ? Math.round(maxCount * 0.88)
                        : maxCount;
                    }
                    return maxCount; // random_oversampling / smote
                  });
                  const simTotal = simCounts.reduce((a, b) => a + b, 0);
                  return dist.map((d, i) => ({
                    ...d,
                    count: simCounts[i],
                    pct: Math.round((simCounts[i] / simTotal) * 1000) / 10,
                  }));
                })();

                return (
                  <div className="mt-5 pt-5 border-t border-[#F3F4F6]">
                    {/* Distribution header */}
                    <div className="flex items-center justify-between mb-3">
                      <div className="flex items-center gap-2 flex-wrap">
                        <p className="text-[11px] font-semibold text-[#374151] uppercase tracking-wide">
                          Class Distribution — <span className="font-mono normal-case">{targetCol}</span>
                        </p>
                        {isImbalanced && !isSimulated && (
                          <span className="flex items-center gap-1 px-2 py-0.5 bg-amber-100 border border-amber-300 rounded-full text-[10px] font-semibold text-amber-700">
                            <AlertCircle className="w-3 h-3" /> Imbalanced
                          </span>
                        )}
                        {isSimulated && (
                          <span className="flex items-center gap-1 px-2 py-0.5 bg-blue-100 border border-blue-300 rounded-full text-[10px] font-semibold text-blue-700">
                            <Zap className="w-3 h-3" /> Simulated after resampling
                          </span>
                        )}
                      </div>
                      <span className="text-[10px] text-[#9CA3AF]">{dist.length} classes</span>
                    </div>

                    {/* Percentage bars */}
                    <div className="space-y-1.5 mb-4">
                      {displayDist.map((cls, i) => (
                        <div key={cls.label} className="flex items-center gap-2">
                          <span
                            className="text-[11px] text-[#374151] truncate font-mono"
                            style={{ minWidth: "6rem", maxWidth: "8rem" }}
                            title={cls.label}
                          >
                            {cls.label}
                          </span>
                          <div className="flex-1 h-4 bg-[#F3F4F6] rounded-full overflow-hidden">
                            <div
                              className="h-full rounded-full"
                              style={{
                                width: `${cls.pct}%`,
                                backgroundColor: isSimulated
                                  ? barColors[i % barColors.length]
                                  : isImbalanced && cls.label === tInfo.dominant_class
                                    ? "#F59E0B"
                                    : barColors[i % barColors.length],
                                transition: "width 0.5s ease",
                              }}
                            />
                          </div>
                          <span className="text-[11px] font-semibold text-[#6B7280] w-10 text-right tabular-nums">
                            {cls.pct}%
                          </span>
                          <span className="text-[10px] text-[#9CA3AF] w-16 text-right tabular-nums hidden sm:block">
                            {cls.count.toLocaleString()}
                          </span>
                        </div>
                      ))}
                    </div>

                    {/* Imbalance note */}
                    {isImbalanced && !isSimulated && (
                      <p className="text-[11px] text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 mb-4">
                        <span className="font-semibold">Imbalance ratio {tInfo.imbalance_ratio}×</span> — consider a sampling strategy below to prevent model bias.
                      </p>
                    )}
                    {isSimulated && (
                      <p className="text-[11px] text-blue-700 bg-blue-50 border border-blue-200 rounded-lg px-3 py-2 mb-4">
                        <span className="font-semibold">Preview only</span> — actual resampling happens at training time. Counts shown are approximate.
                      </p>
                    )}

                    {/* Sampling strategy */}
                    <p className="text-[11px] font-semibold text-[#374151] uppercase tracking-wide mb-2">
                      Sampling Strategy
                      {!isImbalanced && <span className="ml-1.5 font-normal normal-case text-[#9CA3AF]">— balanced, optional</span>}
                    </p>
                    <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
                      {[
                        { value: "none",                label: "None",              desc: "No resampling"                      },
                        { value: "stratified",          label: "Stratified",        desc: "Preserve class ratio in split"      },
                        { value: "random_oversampling", label: "Random Oversample", desc: "Duplicate minority rows"            },
                        { value: "smote",               label: "SMOTE",             desc: "Synthesize minority samples only"   },
                        { value: "smote_tomek",         label: "SMOTETomek",        desc: "Synthesize minority + reduce majority" },
                      ].map(({ value, label, desc }) => (
                        <button
                          key={value}
                          onClick={() => setSamplingMethod(value)}
                          className={`text-left px-3 py-2.5 rounded-xl border transition-all ${
                            samplingMethod === value
                              ? isImbalanced
                                ? "border-amber-400 bg-amber-50 text-amber-800 shadow-sm"
                                : "border-[#7C3AED] bg-[#F5F3FF] text-[#7C3AED] shadow-sm"
                              : "border-[#E5E7EB] bg-white text-[#374151] hover:border-[#C4B5FD] hover:bg-[#FAFAFA]"
                          }`}
                        >
                          <span className="font-semibold block text-[11px]">{label}</span>
                          <span className="text-[10px] text-[#6B7280] mt-0.5 block">{desc}</span>
                        </button>
                      ))}
                    </div>
                  </div>
                );
              })()}

              {/* ── Per-column Preprocessing Table ── */}
              {featureCols.length > 0 && (
                <div className="mt-5 pt-5 border-t border-[#F3F4F6]">
                  <div className="flex items-center justify-between mb-2">
                    <p className="text-[11px] font-semibold text-[#374151] uppercase tracking-wide">
                      Preprocessing — per column
                    </p>
                    <div className="flex items-center gap-2">
                      <span className="text-[10px] text-[#6B7280] bg-[#F3F4F6] px-2 py-0.5 rounded-full border border-[#E5E7EB]">
                        Training copy only · original data unchanged
                      </span>
                      <Tip tip={{ title: "Preview Transform", desc: "Shows a sample of your data after preprocessing transforms are applied — before any model sees it." }}>
                      <button
                        onClick={handlePreviewTransform}
                        disabled={featureCols.length === 0 || !targetCol}
                        className="flex items-center gap-1 px-2.5 py-1 bg-[#7C3AED] text-white text-[11px] rounded-lg hover:bg-[#6D28D9] disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                      >
                        <Eye className="w-3 h-3" /> Preview Transform
                      </button>
                      </Tip>
                    </div>
                  </div>
                  <div className="border border-[#E5E7EB] rounded-lg overflow-hidden text-[11px] overflow-x-auto">
                    {/* Header */}
                    <div className="grid grid-cols-[1fr_90px_160px] min-w-[340px] bg-[#F9FAFB] px-3 py-1.5 text-[10px] font-semibold text-[#6B7280] uppercase tracking-wide border-b border-[#E5E7EB]">
                      <span>Column</span>
                      <span>Type</span>
                      <span>Transform</span>
                    </div>
                    {/* Feature rows */}
                    {featureCols.map((colName) => {
                      const colInfo = sessionCols.find((c) => c.name === colName) || { type: "categorical" };
                      const prep = columnPrep[colName] || "none";
                      return (
                        <div key={colName} className="grid grid-cols-[1fr_90px_160px] items-center px-3 py-1.5 border-b border-[#F3F4F6] hover:bg-[#FAFAFA]">
                          <span className="font-mono text-[#374151] truncate pr-2">{colName}</span>
                          <span className={`text-[10px] px-1.5 py-0.5 rounded-full w-fit ${
                            colInfo.type === "numeric" ? "bg-[#DBEAFE] text-[#2563EB]" : "bg-[#FEF3C7] text-[#D97706]"
                          }`}>{colInfo.type}</span>
                          <select
                            value={prep}
                            onChange={(e) => setColumnPrep((p) => ({ ...p, [colName]: e.target.value }))}
                            className="border border-[#E5E7EB] rounded px-1.5 py-0.5 text-[11px] text-[#374151] focus:ring-1 focus:ring-[#7C3AED] outline-none bg-white"
                          >
                            <option value="none">None (passthrough)</option>
                            <option value="standard">Standardize (Z-score)</option>
                            <option value="normalize">Normalize [0,1]</option>
                            <option value="label_encode">Label Encode (Ordinal)</option>
                          </select>
                        </div>
                      );
                    })}
                    {/* Target row */}
                    {targetCol && (() => {
                      const tColInfo = sessionCols.find((c) => c.name === targetCol) || { type: "categorical" };
                      return (
                        <div className="grid grid-cols-[1fr_90px_160px] items-center px-3 py-1.5 bg-[#F5F3FF]">
                          <span className="font-mono text-[#7C3AED] truncate pr-2 font-medium">
                            {targetCol}
                            <span className="ml-1.5 text-[9px] bg-[#7C3AED] text-white px-1 py-0.5 rounded">target</span>
                          </span>
                          <span className={`text-[10px] px-1.5 py-0.5 rounded-full w-fit ${
                            tColInfo.type === "numeric" ? "bg-[#DBEAFE] text-[#2563EB]" : "bg-[#FEF3C7] text-[#D97706]"
                          }`}>{tColInfo.type}</span>
                          <select
                            value={targetPrep}
                            onChange={(e) => setTargetPrep(e.target.value)}
                            className="border border-[#E5E7EB] rounded px-1.5 py-0.5 text-[11px] text-[#374151] focus:ring-1 focus:ring-[#7C3AED] outline-none bg-white"
                          >
                            <option value="auto">Auto-detect</option>
                            <option value="label_encode">Label Encode</option>
                            <option value="none">None (numeric)</option>
                          </select>
                        </div>
                      );
                    })()}
                  </div>
                  <p className="text-[10px] text-[#9CA3AF] mt-1.5">
                    Defaults: numeric → None, categorical → Label Encode. Auto-detect for target infers classification vs. regression.
                  </p>
                </div>
              )}
              </>
            )}
          </div>
        </section>

        {/* ── Section: Model Selection ── */}
        <section className="bg-white rounded-xl border border-[#E5E7EB] overflow-hidden">
          <div className="px-5 py-3 bg-gradient-to-r from-[#7C3AED] to-[#6D28D9] flex items-center gap-2">
            <Cpu className="w-4 h-4 text-white" />
            <h2 className="text-sm font-semibold text-white">
              2. Model Selection — {selectedModels.length} selected
            </h2>
          </div>
          <div className="p-5 grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
            {allModels.map((mt) => {
              const selected = selectedModels.includes(mt);
              const tuneOpen = openTunePanel === mt;
              return (
                <div key={mt} className={`rounded-xl border-2 transition-all overflow-hidden ${
                  selected ? "border-[#7C3AED] bg-[#F5F3FF]" : "border-[#E5E7EB] bg-white"
                }`}>
                  <Tip tip={MODEL_TOOLTIPS[mt]}>
                  <button
                    onClick={() => setSelectedModels((p) =>
                      p.includes(mt) ? p.filter((m) => m !== mt) : [...p, mt]
                    )}
                    className="w-full p-3 text-center"
                  >
                    <div className="text-2xl mb-1">{MODEL_ICONS[mt]}</div>
                    <div className="text-[12px] font-semibold text-[#374151]">{MODEL_LABELS[mt]}</div>
                    {selected && (
                      <span className="mt-1 inline-block text-[10px] bg-[#7C3AED] text-white px-2 py-0.5 rounded-full">
                        Selected
                      </span>
                    )}
                  </button>
                  </Tip>
                  {selected && (
                    <>
                      <button
                        onClick={() => setOpenTunePanel(tuneOpen ? null : mt)}
                        className="w-full flex items-center justify-center gap-1 py-1.5 text-[10px] text-[#7C3AED] border-t border-[#E5E7EB] hover:bg-[#EDE9FE] transition-colors"
                      >
                        <Settings className="w-3 h-3" />
                        Tune Params
                        {tuneOpen ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
                      </button>
                      {tuneOpen && (
                        <div className="px-3 pb-3 pt-2 border-t border-[#E5E7EB] bg-white">
                          <HyperParamPanel
                            modelType={mt}
                            params={hyperparams[mt]}
                            onChange={(updated) => setHyperparams((p) => ({ ...p, [mt]: updated }))}
                          />
                        </div>
                      )}
                    </>
                  )}
                </div>
              );
            })}
          </div>
        </section>

        {/* ── Train Button ── */}
        <div className="flex items-center gap-4">
          <Tip tip={{ title: "Train & Compare", desc: "Trains all selected models on your data and evaluates each on a held-out 20% test set. Results are compared side by side.", warning: "Training time scales with dataset size and number of models selected." }}>
          <button
            onClick={handleTrain}
            disabled={isTraining || selectedModels.length === 0}
            className="flex items-center gap-2 px-6 py-3 bg-[#7C3AED] text-white rounded-xl font-semibold text-sm hover:bg-[#6D28D9] disabled:opacity-50 disabled:cursor-not-allowed transition-colors shadow-sm"
          >
            {isTraining ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4" />}
            {isTraining ? "Training…" : "Train & Compare All Models"}
          </button>
          </Tip>
          {trainError && (
            <div className="flex items-center gap-2 text-sm text-[#DC2626]">
              <AlertCircle className="w-4 h-4" />
              {trainError}
            </div>
          )}
          {trainResult && !isTraining && (
            <div className="flex items-center gap-2 text-sm text-[#16A34A]">
              <CheckCircle className="w-4 h-4" />
              {resultRestored
                ? `Restored from previous session · ${okResults.length} model${okResults.length !== 1 ? "s" : ""}`
                : `Training complete · ${okResults.length} model${okResults.length !== 1 ? "s" : ""} trained`}
            </div>
          )}
        </div>

        {/* ── Results ── */}
        {trainResult && okResults.length > 0 && (
          <>
            <section className="bg-white rounded-xl border border-[#E5E7EB] overflow-hidden">
              <div className="px-5 py-3 bg-gradient-to-r from-[#1D4ED8] to-[#2563EB] flex items-center justify-between">
                <div className="flex items-center gap-2 flex-wrap">
                  <TrendingUp className="w-4 h-4 text-white" />
                  <h2 className="text-sm font-semibold text-white">3. Results — {trainResult.task}</h2>
                  {(() => {
                    const summary = trainResult.results?.[0]?.preprocessing_summary;
                    if (!summary) return null;
                    const fp = summary.feature_preprocessing || {};
                    const hasStandard  = Object.values(fp).includes("standard");
                    const hasNormalize = Object.values(fp).includes("normalize");
                    const hasEncode    = Object.values(fp).includes("label_encode");
                    return <>
                      {hasStandard  && <span className="text-[10px] bg-white/20 text-white px-2 py-0.5 rounded-full">StandardScaler</span>}
                      {hasNormalize && <span className="text-[10px] bg-white/20 text-white px-2 py-0.5 rounded-full">MinMaxScaler</span>}
                      {hasEncode    && <span className="text-[10px] bg-white/20 text-white px-2 py-0.5 rounded-full">Label Encoded (features)</span>}
                      {summary.label_classes?.length > 0 && (
                        <span className="text-[10px] bg-white/20 text-white px-2 py-0.5 rounded-full">
                          Target: {summary.label_classes.join(" · ")}
                        </span>
                      )}
                    </>;
                  })()}
                </div>
                <div className="flex bg-white/20 rounded-lg p-0.5">
                  {["table", "chart"].map((v) => (
                    <button key={v} onClick={() => setViewMode(v)}
                      className={`px-3 py-1 text-[11px] font-medium rounded transition-colors ${
                        viewMode === v ? "bg-white text-[#1D4ED8]" : "text-white hover:bg-white/10"
                      }`}
                    >{v === "table" ? "Table View" : "Chart View"}</button>
                  ))}
                </div>
              </div>

              {viewMode === "table" ? (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="bg-[#F9FAFB] border-b border-[#E5E7EB]">
                        {["Rank", "Model", "Accuracy", "Precision", "Recall", "F1", "MAE", "RMSE", "R²", "Time (s)"].map((h) => (
                          <th key={h} className="px-4 py-2.5 text-left text-[11px] font-semibold text-[#6B7280] uppercase tracking-wide">{h}</th>
                        ))}
                        <th className="px-4 py-2.5 text-right text-[11px] font-semibold text-[#6B7280] uppercase tracking-wide">Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {okResults.map((r, i) => (
                        <tr key={r.model_type}
                          className={`border-b border-[#F3F4F6] ${i === 0 ? "bg-[#F0FDF4]" : "hover:bg-[#F9FAFB]"}`}
                        >
                          <td className="px-4 py-3 text-xl">{medal(i)}</td>
                          <td className="px-4 py-3">
                            <span className="mr-1">{MODEL_ICONS[r.model_type]}</span>
                            <span className="font-medium text-[#374151]">{MODEL_LABELS[r.model_type] || r.model_type}</span>
                          </td>
                          <td className="px-4 py-3">
                            <span className="font-bold" style={{ color: accColor(r.metrics.holdout_accuracy ?? r.metrics.accuracy) }}>
                              {(r.metrics.holdout_accuracy ?? r.metrics.accuracy) != null
                                ? `${((r.metrics.holdout_accuracy ?? r.metrics.accuracy) * 100).toFixed(1)}%`
                                : "—"}
                            </span>
                          </td>
                          <td className="px-4 py-3 text-[#374151]">
                            {r.metrics.holdout_precision != null ? `${(r.metrics.holdout_precision * 100).toFixed(1)}%` : "—"}
                          </td>
                          <td className="px-4 py-3 text-[#374151]">
                            {r.metrics.holdout_recall != null ? `${(r.metrics.holdout_recall * 100).toFixed(1)}%` : "—"}
                          </td>
                          <td className="px-4 py-3 text-[#374151]">
                            {r.metrics.holdout_f1 != null ? `${(r.metrics.holdout_f1 * 100).toFixed(1)}%` : "—"}
                          </td>
                          <td className="px-4 py-3 text-[#374151]">{r.metrics.holdout_mae?.toFixed(4) ?? "—"}</td>
                          <td className="px-4 py-3 text-[#374151]">{r.metrics.holdout_rmse?.toFixed(4) ?? "—"}</td>
                          <td className="px-4 py-3 text-[#374151]">{r.metrics.holdout_r2?.toFixed(4) ?? "—"}</td>
                          <td className="px-4 py-3 text-[#374151]">{r.metrics.training_time?.toFixed(2) ?? "—"}</td>
                          <td className="px-4 py-3 text-right">
                            <div className="flex justify-end gap-1.5">
                              <Tip tip={{ title: "Save Model", desc: "Save this trained model to your library so you can reload and run predictions on it later." }}>
                              <button onClick={() => openSave({ ...r, feature_columns: trainResult.feature_columns, target_column: trainResult.target_column })}
                                className="flex items-center gap-1 px-2.5 py-1 bg-[#7C3AED] text-white text-[11px] rounded-lg hover:bg-[#6D28D9]">
                                <Save className="w-3 h-3" /> Save
                              </button>
                              </Tip>
                              <Tip tip={{ title: "Run Prediction", desc: "Enter values manually or upload a CSV to get predictions from this trained model." }}>
                              <button onClick={() => openPredict({ ...r, feature_columns: trainResult.feature_columns, target_column: trainResult.target_column, model_id: null })}
                                className="flex items-center gap-1 px-2.5 py-1 bg-[#2563EB] text-white text-[11px] rounded-lg hover:bg-[#1D4ED8]">
                                <Zap className="w-3 h-3" /> Predict
                              </button>
                              </Tip>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <div className="p-5">
                  <ResponsiveContainer width="100%" height={280}>
                    <BarChart data={okResults.map((r) => ({
                      name: MODEL_LABELS[r.model_type] || r.model_type,
                      accuracy: parseFloat(((r.metrics.holdout_accuracy ?? r.metrics.accuracy ?? 0) * 100).toFixed(1)),
                    }))}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#F3F4F6" />
                      <XAxis dataKey="name" tick={{ fontSize: 12 }} />
                      <YAxis domain={[0, 100]} tick={{ fontSize: 12 }} unit="%" />
                      <Tooltip formatter={(v) => [`${v}%`, "Holdout Accuracy"]} />
                      <Bar dataKey="accuracy" radius={[4, 4, 0, 0]}>
                        {okResults.map((r, i) => (
                          <Cell key={i} fill={i === 0 ? "#7C3AED" : i === 1 ? "#2563EB" : i === 2 ? "#0891B2" : "#6B7280"} />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              )}
            </section>

            {/* ── Detailed Metric Cards ── */}
            <section>
              <h2 className="text-sm font-semibold text-[#374151] mb-3 flex items-center gap-2">
                <FlaskConical className="w-4 h-4 text-[#7C3AED]" />
                Detailed Metrics
              </h2>
              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4 items-start">
                {okResults.map((r, i) => {
                  const open = expandedMetrics.has(r.model_type);
                  return (
                    <div key={r.model_type} className="bg-white rounded-xl border border-[#E5E7EB] overflow-hidden">
                      <button
                        onClick={() => setExpandedMetrics(prev => { const next = new Set(prev); open ? next.delete(r.model_type) : next.add(r.model_type); return next; })}
                        className="w-full flex items-center justify-between px-4 py-3 hover:bg-[#F9FAFB]"
                      >
                        <div className="flex items-center gap-2">
                          <span className="text-lg">{medal(i)}</span>
                          <span className="text-lg">{MODEL_ICONS[r.model_type]}</span>
                          <span className="font-semibold text-[#374151] text-sm">{MODEL_LABELS[r.model_type]}</span>
                        </div>
                        <div className="flex items-center gap-2">
                          <div className="text-right">
                            <span className="font-bold text-sm" style={{ color: accColor(r.metrics.holdout_accuracy ?? r.metrics.accuracy) }}>
                              {(r.metrics.holdout_accuracy ?? r.metrics.accuracy) != null
                                ? `${((r.metrics.holdout_accuracy ?? r.metrics.accuracy) * 100).toFixed(1)}%`
                                : "—"}
                            </span>
                            <div className="text-[9px] text-[#9CA3AF]">Holdout Accuracy</div>
                          </div>
                          {open ? <ChevronUp className="w-4 h-4 text-[#6B7280]" /> : <ChevronDown className="w-4 h-4 text-[#6B7280]" />}
                        </div>
                      </button>
                      {open && (
                        <div className="px-4 pb-4 border-t border-[#F3F4F6]">
                          {/* CV metrics */}
                          <div className="mt-3 mb-1 text-[10px] font-semibold text-[#6B7280] uppercase tracking-wide">
                            {r.metrics.cv_folds ?? "k"}-Fold Cross-Validation
                          </div>
                          <div className="grid grid-cols-2 gap-2">
                            {[
                              ["Accuracy",  r.metrics.accuracy,  r.metrics.accuracy_std,  true],
                              ["Precision", r.metrics.precision, r.metrics.precision_std, true],
                              ["Recall",    r.metrics.recall,    r.metrics.recall_std,    true],
                              ["F1",        r.metrics.f1,        r.metrics.f1_std,        false],
                              ["MAE",       r.metrics.mae,       r.metrics.mae_std,       false],
                              ["RMSE",      r.metrics.rmse,      r.metrics.rmse_std,      false],
                              ["R²",        r.metrics.r2,        r.metrics.r2_std,        false],
                            ].map(([k, mean, std, isPct]) => (
                              <div key={k} className="bg-[#F5F3FF] rounded-lg p-2">
                                <div className="text-[10px] text-[#6B7280]">{k}</div>
                                <div className="text-sm font-semibold text-[#374151]">
                                  {mean != null ? (isPct ? `${(mean * 100).toFixed(2)}%` : mean.toFixed(4)) : "—"}
                                </div>
                                {std != null && (
                                  <div className="text-[10px] text-[#9CA3AF]">
                                    ±{isPct ? `${(std * 100).toFixed(2)}%` : std.toFixed(4)}
                                  </div>
                                )}
                              </div>
                            ))}
                          </div>
                          {/* Holdout metrics */}
                          <div className="mt-3 mb-1 text-[10px] font-semibold text-[#6B7280] uppercase tracking-wide">
                            Holdout Test Set
                          </div>
                          <div className="grid grid-cols-2 gap-2">
                            {[
                              ["Accuracy",  r.metrics.holdout_accuracy,  true],
                              ["Precision", r.metrics.holdout_precision, true],
                              ["Recall",    r.metrics.holdout_recall,    true],
                              ["F1",        r.metrics.holdout_f1,        false],
                              ["MAE",       r.metrics.holdout_mae,       false],
                              ["RMSE",      r.metrics.holdout_rmse,      false],
                              ["R²",        r.metrics.holdout_r2,        false],
                            ].map(([k, val, isPct]) => (
                              <div key={k} className="bg-[#F9FAFB] rounded-lg p-2">
                                <div className="text-[10px] text-[#6B7280]">{k}</div>
                                <div className="text-sm font-semibold text-[#374151]">
                                  {val != null ? (isPct ? `${(val * 100).toFixed(2)}%` : val.toFixed(4)) : "—"}
                                </div>
                              </div>
                            ))}
                          </div>
                          {/* General info */}
                          <div className="grid grid-cols-3 gap-2 mt-2">
                            {[
                              ["Time",    `${r.metrics.training_time?.toFixed(2)}s`],
                              ["Size",    `${r.metrics.model_size_mb?.toFixed(2)} MB`],
                              ["Train N", r.training_samples?.toLocaleString() ?? "—"],
                            ].map(([k, v]) => (
                              <div key={k} className="bg-[#F9FAFB] rounded-lg p-2">
                                <div className="text-[10px] text-[#6B7280]">{k}</div>
                                <div className="text-sm font-semibold text-[#374151]">{v}</div>
                              </div>
                            ))}
                          </div>
                          {/* Parameters used */}
                          {r.hyperparameters && Object.keys(r.hyperparameters).length > 0 && (
                            <div className="mt-3">
                              <div className="text-[10px] font-semibold text-[#6B7280] uppercase tracking-wide mb-1.5">
                                Parameters Used
                              </div>
                              <div className="flex flex-wrap gap-1.5">
                                {Object.entries(r.hyperparameters).map(([key, val]) => (
                                  <span
                                    key={key}
                                    className="inline-flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full border bg-[#EFF6FF] text-[#1D4ED8] border-[#BFDBFE] font-mono"
                                  >
                                    <span className="text-[#6B7280]">{key}</span>
                                    <span className="font-semibold">{String(val)}</span>
                                  </span>
                                ))}
                              </div>
                            </div>
                          )}
                          {/* Feature importance */}
                          {r.feature_importance && (
                            <div className="mt-3">
                              <div className="text-[11px] font-semibold text-[#6B7280] mb-1">Feature Importance</div>
                              {Object.entries(r.feature_importance)
                                .sort(([, a], [, b]) => b - a)
                                .slice(0, 8)
                                .map(([col, val]) => (
                                  <div key={col} className="flex items-center gap-2 mb-1">
                                    <span className="text-[10px] text-[#374151] w-24 truncate">{col}</span>
                                    <div className="flex-1 h-1.5 bg-[#F3F4F6] rounded-full">
                                      <div className="h-1.5 bg-[#7C3AED] rounded-full" style={{ width: `${(val * 100).toFixed(1)}%` }} />
                                    </div>
                                    <span className="text-[10px] text-[#6B7280]">{(val * 100).toFixed(1)}%</span>
                                  </div>
                                ))}
                            </div>
                          )}
                          {/* Preprocessing summary */}
                          {r.preprocessing_summary && (() => {
                            const ps = r.preprocessing_summary;
                            const fp = ps.feature_preprocessing || {};
                            const nonNone = Object.entries(fp).filter(([, v]) => v !== "none");
                            if (nonNone.length === 0 && !ps.label_classes?.length) return null;
                            return (
                              <div className="mt-3">
                                <div className="text-[11px] font-semibold text-[#6B7280] mb-1.5">Preprocessing Applied</div>
                                <div className="flex flex-wrap gap-1.5">
                                  {nonNone.map(([col, val]) => (
                                    <span key={col} className={`text-[10px] px-1.5 py-0.5 rounded-full border font-mono ${
                                      val === "standard"     ? "bg-[#EFF6FF] text-[#2563EB] border-[#BFDBFE]" :
                                      val === "normalize"    ? "bg-[#F0FDF4] text-[#16A34A] border-[#BBF7D0]" :
                                      val === "label_encode" ? "bg-[#FEF3C7] text-[#D97706] border-[#FCD34D]" : ""
                                    }`}>
                                      {col}: {val === "standard" ? "Z-score" : val === "normalize" ? "[0,1]" : "ordinal"}
                                    </span>
                                  ))}
                                  {ps.label_classes?.length > 0 && (
                                    <span className="text-[10px] px-1.5 py-0.5 rounded-full border bg-[#F5F3FF] text-[#7C3AED] border-[#DDD6FE]">
                                      target → {ps.label_classes.join(" / ")}
                                    </span>
                                  )}
                                </div>
                              </div>
                            );
                          })()}
                          <div className="flex gap-2 mt-3">
                            <Tip tip={{ title: "Save Model", desc: "Save this trained model to your library so you can reload and run predictions on it later." }} className="flex-1">
                            <button onClick={() => openSave({ ...r, feature_columns: trainResult.feature_columns, target_column: trainResult.target_column })}
                              className="w-full flex items-center justify-center gap-1 py-1.5 bg-[#7C3AED] text-white text-[11px] rounded-lg hover:bg-[#6D28D9]">
                              <Save className="w-3 h-3" /> Save to DB
                            </button>
                            </Tip>
                            <Tip tip={{ title: "Run Prediction", desc: "Enter values manually or upload a CSV to get predictions from this trained model." }} className="flex-1">
                            <button onClick={() => openPredict({ ...r, feature_columns: trainResult.feature_columns, target_column: trainResult.target_column, model_id: null })}
                              className="w-full flex items-center justify-center gap-1 py-1.5 bg-[#2563EB] text-white text-[11px] rounded-lg hover:bg-[#1D4ED8]">
                              <Zap className="w-3 h-3" /> Predict
                            </button>
                            </Tip>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </section>
          </>
        )}

        {/* ── Feature Correlation Heatmap ── */}
        {corrData && corrData.columns.length >= 2 && (
          <section className="bg-white rounded-xl border border-[#E5E7EB] overflow-hidden">
            <div className="px-5 py-3 bg-gradient-to-r from-[#0891B2] to-[#0E7490] flex items-center gap-2">
              <Eye className="w-4 h-4 text-white" />
              <h2 className="text-sm font-semibold text-white">Feature Correlation Heatmap</h2>
            </div>
            <div className="p-5">
              {corrData.warnings.length > 0 && (
                <div className="mb-4 p-3 bg-[#FEF3C7] border border-[#FCD34D] rounded-lg flex gap-2 text-[12px] text-[#92400E]">
                  <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
                  <span>
                    High correlation detected (&gt;0.8) in {corrData.warnings.length} pair(s):&nbsp;
                    {corrData.warnings.slice(0, 3).map((w) => `${w.col1}↔${w.col2} (${w.correlation})`).join(", ")}
                    {corrData.warnings.length > 3 ? ` and ${corrData.warnings.length - 3} more` : ""}.
                    Consider removing redundant features.
                  </span>
                </div>
              )}
              <div className="overflow-x-auto">
                <table className="border-collapse text-[10px]">
                  <thead>
                    <tr>
                      <th className="w-24 h-6" />
                      {corrData.columns.map((c) => (
                        <th key={c} className="h-6 px-1 text-[9px] text-[#6B7280] font-medium" style={{ writingMode: "vertical-rl", transform: "rotate(180deg)", maxWidth: 60 }}>
                          {c.length > 12 ? c.slice(0, 12) + "…" : c}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {corrData.matrix.map((row, ri) => (
                      <tr key={ri}>
                        <td className="pr-2 py-0.5 text-[9px] text-[#6B7280] text-right font-medium max-w-[96px] truncate">
                          {corrData.columns[ri].length > 14 ? corrData.columns[ri].slice(0, 14) + "…" : corrData.columns[ri]}
                        </td>
                        {row.map((val, ci) => (
                          <td key={ci} title={`${corrData.columns[ri]} × ${corrData.columns[ci]}: ${val}`}
                            className="w-9 h-9 text-center text-[9px] font-medium border border-white"
                            style={{ backgroundColor: `${corrColor(val)}22`, color: corrColor(val) }}>
                            {Math.abs(val) >= 0.2 ? val.toFixed(1) : ""}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {/* Legend */}
              <div className="flex flex-wrap gap-3 mt-3">
                {[["#DC2626", "> 0.8", "High"], ["#EC4899", "0.6–0.8", "Moderate"], ["#F59E0B", "0.2–0.6", "Low"], ["#16A34A", "< 0.2", "Negligible"]].map(([color, range, label]) => (
                  <div key={label} className="flex items-center gap-1.5 text-[11px] text-[#374151]">
                    <div className="w-3 h-3 rounded-sm" style={{ backgroundColor: color + "33", border: `1.5px solid ${color}` }} />
                    <span>{label} ({range})</span>
                  </div>
                ))}
              </div>
            </div>
          </section>
        )}

        {/* ── Model Library ── */}
        <section className="bg-white rounded-xl border border-[#E5E7EB] overflow-hidden">
          <div className="px-5 py-3 bg-gradient-to-r from-[#059669] to-[#047857] flex items-center gap-2">
            <Library className="w-4 h-4 text-white" />
            <h2 className="text-sm font-semibold text-white">Model Library</h2>
          </div>
          <div className="p-5">
            {/* Filters */}
            <div className="flex flex-wrap gap-3 mb-4 items-center">
              <div className="inline-flex bg-[#F3F4F6] rounded-lg p-0.5">
                {[["my", "My Models"], ["public", "All Public"], ["all", "All"]].map(([v, l]) => (
                  <button key={v} onClick={() => setLibraryTab(v)}
                    className={`px-3 py-1.5 text-[12px] font-medium rounded transition-colors ${
                      libraryTab === v ? "bg-white text-[#059669] shadow-sm" : "text-[#6B7280] hover:text-[#374151]"
                    }`}>{l}</button>
                ))}
              </div>
              <select value={libModelType} onChange={(e) => setLibModelType(e.target.value)}
                className="border border-[#E5E7EB] rounded-lg px-2 py-1.5 text-[12px] text-[#374151]">
                <option value="">All Types</option>
                {allModels.map((m) => <option key={m} value={m}>{MODEL_LABELS[m]}</option>)}
              </select>
              <select value={libSort} onChange={(e) => setLibSort(e.target.value)}
                className="border border-[#E5E7EB] rounded-lg px-2 py-1.5 text-[12px] text-[#374151]">
                <option value="date">Sort: Newest</option>
                <option value="accuracy">Sort: Accuracy</option>
                <option value="times_used">Sort: Most Used</option>
              </select>
              <button onClick={loadLibrary} className="p-1.5 rounded-lg hover:bg-[#F3F4F6]">
                <RefreshCw className={`w-4 h-4 text-[#6B7280] ${libLoading ? "animate-spin" : ""}`} />
              </button>
            </div>

            {libLoading ? (
              <div className="text-sm text-[#6B7280] py-4">Loading models…</div>
            ) : libModels.length === 0 ? (
              <div className="text-center py-10 text-[#6B7280]">
                <Library className="w-10 h-10 mx-auto mb-2 opacity-30" />
                <p className="text-sm">No models found. Train and save models to see them here.</p>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
                {libModels.map((m) => (
                  <div key={m.id} className="border border-[#E5E7EB] rounded-xl p-4 hover:border-[#059669] transition-colors">
                    <div className="flex items-start justify-between mb-2">
                      <div>
                        <div className="flex items-center gap-1.5">
                          <span className="text-lg">{MODEL_ICONS[m.model_type] || "🤖"}</span>
                          <h3 className="font-semibold text-[#374151] text-sm">{m.model_name}</h3>
                          {m.visibility === "public" && (
                            <span className="text-[9px] bg-[#D1FAE5] text-[#059669] px-1.5 py-0.5 rounded-full">Public</span>
                          )}
                        </div>
                        <p className="text-[11px] text-[#6B7280] mt-0.5">{MODEL_LABELS[m.model_type] || m.model_type}</p>
                      </div>
                      <span className="font-bold text-sm" style={{ color: accColor(m.accuracy) }}>
                        {m.accuracy != null ? `${(m.accuracy * 100).toFixed(1)}%` : "—"}
                      </span>
                    </div>
                    {m.description && <p className="text-[11px] text-[#6B7280] mb-2 line-clamp-2">{m.description}</p>}
                    <div className="flex flex-wrap gap-1 mb-2">
                      {(m.tags || []).map((tag) => (
                        <span key={tag} className="text-[10px] bg-[#F3F4F6] text-[#6B7280] px-1.5 py-0.5 rounded">{tag}</span>
                      ))}
                    </div>
                    <div className="flex justify-between text-[10px] text-[#6B7280] mb-3">
                      <span>By {m.created_by}</span>
                      <span className="flex items-center gap-1"><Star className="w-3 h-3" />{m.times_used} uses</span>
                      <span>{m.created_at ? new Date(m.created_at).toLocaleDateString() : ""}</span>
                    </div>
                    <div className="flex gap-2">
                      <button
                        onClick={() => openPredict({ ...m, feature_columns: m.feature_columns || [], model_id: m.id })}
                        className="flex-1 flex items-center justify-center gap-1.5 py-1.5 bg-[#059669] text-white text-[11px] font-medium rounded-lg hover:bg-[#047857] transition-colors"
                      >
                        <Zap className="w-3 h-3" /> Load & Predict
                      </button>
                      {libraryTab === "my" && (
                        <button
                          onClick={async () => {
                            if (!window.confirm(`Delete "${m.model_name}"? This cannot be undone.`)) return;
                            try {
                              await ApiService.deleteMLModel(m.id);
                              loadLibrary();
                            } catch (err) {
                              alert(err?.response?.data?.detail || "Failed to delete model.");
                            }
                          }}
                          className="flex items-center justify-center px-2.5 py-1.5 bg-[#FEF2F2] text-[#DC2626] text-[11px] font-medium rounded-lg hover:bg-[#FEE2E2] transition-colors border border-[#FECACA]"
                          title="Delete model"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </section>
      </div>

      {/* ══ Save Modal ══ */}
      <Modal open={!!saveModal} onClose={() => setSaveModal(null)} title="💾 Save Model">
        {saveModal && (
          <div className="space-y-4">
            {resultRestored && (
              <div className="bg-[#FEF3C7] border border-[#FCD34D] rounded-lg px-3 py-2 text-[12px] text-[#92400E]">
                This result was restored from a previous session. If the server restarted since then, saving will fail — click <strong>Train Models</strong> first to rebuild the model in server memory.
              </div>
            )}
            <div className="bg-[#F5F3FF] rounded-lg p-3 text-[12px] text-[#374151]">
              <span className="font-semibold">{MODEL_LABELS[saveModal.model_type]}</span>
              &nbsp;·&nbsp;CV Accuracy:&nbsp;
              <span className="font-semibold" style={{ color: accColor(saveModal.metrics?.accuracy) }}>
                {saveModal.metrics?.accuracy != null ? `${(saveModal.metrics.accuracy * 100).toFixed(1)}%` : "—"}
              </span>
              {saveModal.metrics?.accuracy_std != null && (
                <span className="text-[#9CA3AF]"> ±{(saveModal.metrics.accuracy_std * 100).toFixed(1)}%</span>
              )}
              &nbsp;·&nbsp;Holdout:&nbsp;
              <span className="font-semibold">
                {saveModal.metrics?.holdout_accuracy != null ? `${(saveModal.metrics.holdout_accuracy * 100).toFixed(1)}%` : "—"}
              </span>
            </div>
            <div>
              <label className="text-[12px] font-semibold text-[#374151] mb-1 block">Name *</label>
              <input value={saveForm.name} onChange={(e) => setSaveForm({ ...saveForm, name: e.target.value })}
                className="w-full border border-[#E5E7EB] rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-[#7C3AED] outline-none" />
            </div>
            <div>
              <label className="text-[12px] font-semibold text-[#374151] mb-1 block">Description</label>
              <textarea value={saveForm.description} onChange={(e) => setSaveForm({ ...saveForm, description: e.target.value })}
                rows={2} className="w-full border border-[#E5E7EB] rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-[#7C3AED] outline-none resize-none" />
            </div>
            <div>
              <label className="text-[12px] font-semibold text-[#374151] mb-1 block">Tags (comma-separated)</label>
              <input value={saveForm.tags} onChange={(e) => setSaveForm({ ...saveForm, tags: e.target.value })}
                placeholder="e.g. regression, production, v1"
                className="w-full border border-[#E5E7EB] rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-[#7C3AED] outline-none" />
            </div>
            <div>
              <label className="text-[12px] font-semibold text-[#374151] mb-1 block">Visibility</label>
              <div className="flex gap-3">
                {["private", "public"].map((v) => (
                  <label key={v} className="flex items-center gap-2 cursor-pointer">
                    <input type="radio" value={v} checked={saveForm.visibility === v}
                      onChange={() => setSaveForm({ ...saveForm, visibility: v })} className="accent-[#7C3AED]" />
                    <span className="text-sm text-[#374151] capitalize">{v}</span>
                  </label>
                ))}
              </div>
            </div>
            {saveMsg && (
              <div className={`text-sm font-medium ${saveMsg.startsWith("✓") ? "text-[#16A34A]" : "text-[#DC2626]"}`}>
                {saveMsg}
              </div>
            )}
            <div className="flex gap-3 pt-2">
              <button onClick={() => setSaveModal(null)} className="flex-1 py-2 border border-[#E5E7EB] rounded-lg text-sm text-[#374151] hover:bg-[#F9FAFB]">Cancel</button>
              <button onClick={handleSave} disabled={saving}
                className="flex-1 py-2 bg-[#7C3AED] text-white rounded-lg text-sm font-medium hover:bg-[#6D28D9] disabled:opacity-50 flex items-center justify-center gap-2">
                {saving ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                {saving ? "Saving…" : "Save"}
              </button>
            </div>
          </div>
        )}
      </Modal>

      {/* ══ Predict Modal ══ */}
      <Modal open={!!predictModal} onClose={closePredict} title="🔮 Make a Prediction">
        {predictModal && (
          <div className="space-y-4">
            {/* Model info + training data reference */}
            <div className="space-y-2">
              {/* Header row — always visible */}
              <div className="bg-[#EFF6FF] rounded-lg p-3 text-[12px] text-[#374151] flex items-center justify-between">
                <div>
                  <span className="font-semibold">{MODEL_LABELS[predictModal.model_type] || predictModal.model_type}</span>
                  &nbsp;→&nbsp;predicting <span className="font-semibold text-[#2563EB]">{predictModal.target_column}</span>
                  {predictModal.training_summary?.dataset && (
                    <span className="ml-2 text-[#6B7280]">
                      · {predictModal.training_summary.dataset.total_samples?.toLocaleString()} training rows
                      · {predictModal.training_summary.dataset.num_features} features
                    </span>
                  )}
                </div>
                <button
                  onClick={() => setTrainRefOpen(o => !o)}
                  className="flex items-center gap-1 text-[11px] font-medium text-[#2563EB] hover:text-[#1D4ED8] flex-shrink-0 ml-3 px-2 py-1 rounded-lg border border-[#BFDBFE] bg-white hover:bg-[#EFF6FF] transition-colors"
                >
                  {trainRefOpen ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                  {trainRefOpen ? "Hide Reference" : "Training Data Reference"}
                </button>
              </div>

              {/* Collapsible panel */}
              {trainRefOpen && (
                <div className="border border-[#E5E7EB] rounded-xl overflow-hidden text-[11px]">
                  {predictModal.training_summary ? (() => {
                    const ts = predictModal.training_summary;
                    const ds = ts.dataset || {};
                    const feats = ts.features || {};
                    const samples = ts.sample_rows || [];
                    return (
                      <>
                        {/* Class distribution */}
                        {ds.class_distribution && (
                          <div className="px-3 py-2.5 border-b border-[#F3F4F6] bg-[#FAFAFA]">
                            <p className="font-semibold text-[#374151] mb-1.5">
                              Target: <span className="font-mono">{ds.target_column}</span>
                              <span className="ml-2 text-[#9CA3AF] font-normal">({ds.num_classes} classes)</span>
                            </p>
                            <div className="flex flex-wrap gap-1.5">
                              {ds.class_distribution.map((c) => (
                                <span key={c.class} className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-[#EFF6FF] border border-[#BFDBFE] text-[#1D4ED8]">
                                  <span className="font-medium">{c.class}</span>
                                  <span className="text-[#6B7280] text-[10px]">{c.count} · {c.percent}%</span>
                                </span>
                              ))}
                            </div>
                          </div>
                        )}

                        {/* Regression target range */}
                        {ds.target_stats && (
                          <div className="px-3 py-2.5 border-b border-[#F3F4F6] bg-[#FAFAFA]">
                            <p className="font-semibold text-[#374151] mb-1.5">Target: <span className="font-mono">{ds.target_column}</span> — Range</p>
                            <div className="flex flex-wrap gap-4 text-[#6B7280]">
                              {[["Min", ds.target_stats.min], ["Max", ds.target_stats.max], ["Mean", ds.target_stats.mean?.toFixed?.(2)], ["Std", ds.target_stats.std?.toFixed?.(2)]].map(([l, v]) => (
                                <span key={l}><span className="font-semibold text-[#374151]">{l}</span> {v ?? "—"}</span>
                              ))}
                            </div>
                          </div>
                        )}

                        {/* Per-feature table */}
                        {Object.keys(feats).length > 0 && (
                          <div className="overflow-x-auto max-h-56 overflow-y-auto">
                            <table className="w-full text-[10px]">
                              <thead className="bg-[#F9FAFB] sticky top-0 z-10">
                                <tr>
                                  <th className="px-3 py-1.5 text-left font-semibold text-[#6B7280]">Feature</th>
                                  <th className="px-2 py-1.5 text-left font-semibold text-[#6B7280]">Type</th>
                                  <th className="px-2 py-1.5 text-left font-semibold text-[#6B7280]">Training Range / Values</th>
                                  <th className="px-2 py-1.5 text-center font-semibold text-[#6B7280]">Missing</th>
                                </tr>
                              </thead>
                              <tbody>
                                {Object.entries(feats).map(([col, meta]) => (
                                  <tr key={col} className="border-t border-[#F3F4F6] hover:bg-[#FAFAFA]">
                                    <td className="px-3 py-1.5 font-mono text-[#374151] whitespace-nowrap">{col}</td>
                                    <td className="px-2 py-1.5">
                                      <span className={`px-1.5 py-0.5 rounded text-[9px] font-semibold ${
                                        meta.type === "integer"     ? "bg-[#DBEAFE] text-[#1D4ED8]" :
                                        meta.type === "decimal"     ? "bg-[#EDE9FE] text-[#6D28D9]" :
                                        meta.type === "categorical" ? "bg-[#FEF3C7] text-[#92400E]" :
                                        meta.type === "datetime"    ? "bg-[#D1FAE5] text-[#065F46]" :
                                                                      "bg-[#F3F4F6] text-[#6B7280]"
                                      }`}>{meta.type}</span>
                                    </td>
                                    <td className="px-2 py-1.5 text-[#6B7280] max-w-[200px]">
                                      {(meta.type === "integer" || meta.type === "decimal") && (
                                        <span>
                                          min <b className="text-[#374151]">{meta.min ?? "—"}</b>
                                          {" · "}max <b className="text-[#374151]">{meta.max ?? "—"}</b>
                                          {" · "}mean <b className="text-[#374151]">{meta.mean ?? "—"}</b>
                                        </span>
                                      )}
                                      {meta.type === "categorical" && (
                                        <span className="truncate block" title={(meta.top_values || []).map(v => v.value).join(", ")}>
                                          <b className="text-[#374151]">{meta.unique_count}</b> unique ·{" "}
                                          {(meta.top_values || []).slice(0, 5).map(v => v.value).join(", ")}
                                          {meta.unique_count > 5 ? "…" : ""}
                                        </span>
                                      )}
                                      {meta.type === "datetime" && (
                                        <span>{meta.earliest} → {meta.latest}</span>
                                      )}
                                    </td>
                                    <td className="px-2 py-1.5 text-center">
                                      <span className={meta.missing > 0 ? "text-[#D97706] font-medium" : "text-[#16A34A]"}>
                                        {meta.missing > 0 ? meta.missing : "✓"}
                                      </span>
                                    </td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        )}

                        {/* Sample rows */}
                        {samples.length > 0 && (
                          <div className="px-3 py-2.5 border-t border-[#F3F4F6] bg-[#FAFAFA]">
                            <p className="font-semibold text-[#374151] mb-1.5">Sample Training Rows</p>
                            <div className="overflow-x-auto">
                              <table className="text-[10px] w-full">
                                <thead>
                                  <tr>
                                    {Object.keys(samples[0]).map((k) => (
                                      <th key={k} className="px-2 py-1 text-left font-medium text-[#6B7280] whitespace-nowrap">{k}</th>
                                    ))}
                                  </tr>
                                </thead>
                                <tbody>
                                  {samples.map((row, i) => (
                                    <tr key={i} className="border-t border-[#F3F4F6]">
                                      {Object.values(row).map((v, j) => (
                                        <td key={j} className="px-2 py-1 text-[#374151] whitespace-nowrap">{v ?? "—"}</td>
                                      ))}
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            </div>
                          </div>
                        )}
                      </>
                    );
                  })() : (
                    /* No summary stored — show feature list only */
                    <div className="px-3 py-3">
                      <p className="text-[11px] text-[#6B7280] mb-2">
                        Detailed training data reference is available for models trained after this feature was added.
                        Required feature columns for this model:
                      </p>
                      <div className="flex flex-wrap gap-1.5">
                        {(predictModal.feature_columns || []).map((col) => (
                          <span key={col} className="px-2 py-0.5 rounded bg-[#F3F4F6] border border-[#E5E7EB] text-[#374151] font-mono text-[10px]">{col}</span>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Mode tabs */}
            <div className="flex border border-[#E5E7EB] rounded-lg overflow-hidden text-[12px] font-medium">
              {[["manual", "✏️ Manual Input"], ["file", "📂 Upload File"]].map(([tab, label]) => (
                <button key={tab} onClick={() => { setPredictTab(tab); setPredResult(null); }}
                  className={`flex-1 py-2 transition-colors ${predictTab === tab ? "bg-[#2563EB] text-white" : "bg-white text-[#374151] hover:bg-[#F9FAFB]"}`}>
                  {label}
                </button>
              ))}
            </div>

            {/* ── Manual tab ── */}
            {predictTab === "manual" && (
              <>
                <div className="space-y-2 max-h-56 overflow-y-auto pr-1">
                  {(predictModal.feature_columns || []).map((col) => {
                    const isEncoded = predictModal.featurePrep?.[col] === "label_encode";
                    const cats = predictModal.preprocessing_summary?.label_classes_per_col?.[col] ||
                                 predictModal.hyperparameters?.label_classes_per_col?.[col];
                    return (
                      <div key={col}>
                        <label className="text-[11px] text-[#374151] font-medium mb-0.5 block flex items-center gap-1.5">
                          {col}
                          {isEncoded && <span className="text-[9px] bg-[#FEF3C7] text-[#D97706] px-1 py-0.5 rounded">categorical</span>}
                        </label>
                        {isEncoded && cats ? (
                          <select
                            value={predictInputs[col] ?? ""}
                            onChange={(e) => setPredictInputs({ ...predictInputs, [col]: e.target.value })}
                            className="w-full border border-[#E5E7EB] rounded-lg px-3 py-1.5 text-sm focus:ring-2 focus:ring-[#2563EB] outline-none"
                          >
                            <option value="">— select —</option>
                            {cats.map((c) => <option key={c} value={c}>{c}</option>)}
                          </select>
                        ) : (
                          <input
                            type={isEncoded ? "text" : "number"}
                            value={predictInputs[col] ?? ""}
                            onChange={(e) => setPredictInputs({ ...predictInputs, [col]: e.target.value })}
                            className="w-full border border-[#E5E7EB] rounded-lg px-3 py-1.5 text-sm focus:ring-2 focus:ring-[#2563EB] outline-none"
                            placeholder={isEncoded ? "Enter category value…" : "Enter value…"}
                          />
                        )}
                      </div>
                    );
                  })}
                </div>
                {predResult && !predResult.error && !predResult.isFile && (
                  <div className="space-y-2">
                    {/* Prediction result */}
                    <div className="bg-[#F0FDF4] border border-[#BBF7D0] rounded-lg p-4 text-center">
                      <div className="text-[11px] text-[#6B7280] mb-1">Predicted {predResult.target_column}</div>
                      <div className="text-2xl font-bold text-[#16A34A]">{String(predResult.prediction)}</div>
                      {predResult.confidence != null && (
                        <div className="text-[11px] text-[#6B7280] mt-1">Confidence: {(predResult.confidence * 100).toFixed(1)}%</div>
                      )}
                    </div>

                    {/* Model training metrics */}
                    {predResult.model_metrics && Object.keys(predResult.model_metrics).length > 0 && (
                      <div className="border border-[#E5E7EB] rounded-xl p-3 bg-[#F9FAFB]">
                        <p className="text-[11px] font-semibold text-[#374151] mb-2 flex items-center gap-1.5">
                          <TrendingUp className="w-3.5 h-3.5 text-[#7C3AED]" />
                          Model Training Metrics
                        </p>
                        {predResult.model_metrics.task === "regression" ? (
                          <div className="grid grid-cols-3 gap-2">
                            {[
                              { label: "MAE",  value: predResult.model_metrics.mae,  color: "#D97706" },
                              { label: "RMSE", value: predResult.model_metrics.rmse, color: "#DC2626" },
                              { label: "R²",   value: predResult.model_metrics.r2,   color: "#059669" },
                            ].filter(m => m.value != null).map((m) => (
                              <div key={m.label} className="bg-white rounded-lg border border-[#E5E7EB] px-2 py-2 text-center">
                                <p className="text-[16px] font-bold" style={{ color: m.color }}>{Number(m.value).toFixed(3)}</p>
                                <p className="text-[10px] text-[#6B7280] mt-0.5">{m.label}</p>
                              </div>
                            ))}
                          </div>
                        ) : (
                          <div className="grid grid-cols-2 gap-2">
                            {[
                              { label: "Accuracy",        value: predResult.model_metrics.holdout_accuracy ?? predResult.model_metrics.accuracy, color: "#2B7FFF", pct: true },
                              { label: "CV Accuracy",     value: predResult.model_metrics.cv_accuracy,      color: "#6366F1", pct: true },
                              { label: "F1 Score",        value: predResult.model_metrics.f1,               color: "#7C3AED", pct: false },
                              { label: "Precision",       value: predResult.model_metrics.precision,        color: "#059669", pct: false },
                              { label: "Recall",          value: predResult.model_metrics.recall,           color: "#D97706", pct: false },
                            ].filter(m => m.value != null).map((m) => (
                              <div key={m.label} className="bg-white rounded-lg border border-[#E5E7EB] px-2 py-2 text-center">
                                <p className="text-[16px] font-bold" style={{ color: m.color }}>
                                  {m.pct ? `${(m.value * 100).toFixed(1)}%` : Number(m.value).toFixed(3)}
                                </p>
                                <p className="text-[10px] text-[#6B7280] mt-0.5">{m.label}</p>
                              </div>
                            ))}
                          </div>
                        )}
                        <p className="text-[10px] text-[#9CA3AF] mt-2 text-center">Metrics from when this model was trained</p>
                      </div>
                    )}
                  </div>
                )}
                {predResult?.error && (
                  <div className="bg-[#FEF2F2] border border-[#FECACA] rounded-lg p-3 text-sm text-[#DC2626]">{predResult.error}</div>
                )}
                <div className="flex gap-3 pt-1">
                  <button onClick={closePredict}
                    className="flex-1 py-2 border border-[#E5E7EB] rounded-lg text-sm text-[#374151] hover:bg-[#F9FAFB]">Close</button>
                  <button onClick={handlePredict} disabled={predicting}
                    className="flex-1 py-2 bg-[#2563EB] text-white rounded-lg text-sm font-medium hover:bg-[#1D4ED8] disabled:opacity-50 flex items-center justify-center gap-2">
                    {predicting ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Zap className="w-4 h-4" />}
                    {predicting ? "Predicting…" : "Get Prediction"}
                  </button>
                </div>
              </>
            )}

            {/* ── File tab ── */}
            {predictTab === "file" && (
              <>
                <p className="text-[11px] text-[#6B7280]">
                  Upload a CSV or Excel file with the same feature columns used during training.
                  Predictions will be appended as a new column.
                </p>

                {/* Drop zone */}
                <div
                  onClick={() => predFileRef.current?.click()}
                  onDragOver={(e) => { e.preventDefault(); setPredFileDragging(true); }}
                  onDragLeave={() => setPredFileDragging(false)}
                  onDrop={(e) => {
                    e.preventDefault();
                    setPredFileDragging(false);
                    const f = e.dataTransfer.files[0];
                    if (f) { setPredFile(f); setPredResult(null); }
                  }}
                  className={`border-2 border-dashed rounded-xl p-6 text-center cursor-pointer transition-colors ${
                    predFileDragging ? "border-[#2563EB] bg-[#EFF6FF]" : "border-[#E5E7EB] hover:border-[#2563EB] hover:bg-[#F8FAFF]"
                  }`}
                >
                  <input
                    ref={predFileRef}
                    type="file"
                    accept=".csv,.xlsx,.xls"
                    className="hidden"
                    onChange={(e) => { const f = e.target.files?.[0]; if (f) { setPredFile(f); setPredResult(null); } }}
                  />
                  {predFile ? (
                    <div className="flex items-center justify-center gap-2 text-[#2563EB] font-medium text-sm">
                      <CheckCircle className="w-4 h-4" />
                      {predFile.name}
                      <span className="text-[#9CA3AF] text-[11px] font-normal">({(predFile.size / 1024).toFixed(1)} KB)</span>
                    </div>
                  ) : (
                    <div className="text-[#9CA3AF] text-[12px]">
                      <Upload className="w-8 h-8 mx-auto mb-2 text-[#D1D5DB]" />
                      Drag & drop a CSV or Excel file, or click to browse
                    </div>
                  )}
                </div>

                {/* Required columns + evaluation tip */}
                <div className="space-y-1.5">
                  <div className="text-[11px] text-[#6B7280]">
                    <span className="font-medium">Required columns:</span>{" "}
                    {(predictModal.feature_columns || []).join(", ")}
                  </div>
                  {predictModal.target_column && (
                    <div className="flex items-start gap-2 px-3 py-2 rounded-lg bg-[#EFF6FF] border border-[#BFDBFE]">
                      <TrendingUp className="w-3.5 h-3.5 text-[#2563EB] flex-shrink-0 mt-0.5" />
                      <p className="text-[11px] text-[#1D4ED8]">
                        <span className="font-semibold">Tip:</span> Include the actual{" "}
                        <span className="font-mono font-semibold">{predictModal.target_column}</span>{" "}
                        column in your file to automatically compute accuracy, F1, and other evaluation metrics.
                      </p>
                    </div>
                  )}
                </div>

                {/* File results */}
                {predResult?.isFile && !predResult.error && (
                  <div className="space-y-2">
                    {predResult.missing_cols?.length > 0 && (
                      <div className="bg-amber-50 border border-amber-200 rounded-lg p-2 text-[11px] text-amber-700">
                        Missing columns filled with 0: {predResult.missing_cols.join(", ")}
                      </div>
                    )}
                    <div className="bg-[#F0FDF4] border border-[#BBF7D0] rounded-lg p-3 flex items-center justify-between">
                      <div>
                        <p className="text-[12px] font-semibold text-[#15803D]">
                          {predResult.row_count} rows predicted
                        </p>
                        <p className="text-[11px] text-[#6B7280]">
                          Result column: <span className="font-mono">{predResult.pred_column}</span>
                        </p>
                      </div>
                      <button onClick={downloadPredCSV}
                        className="flex items-center gap-1.5 px-3 py-1.5 bg-[#16A34A] text-white text-[12px] rounded-lg hover:bg-[#15803D]">
                        <Download className="w-3.5 h-3.5" /> Download CSV
                      </button>
                    </div>

                    {/* Evaluation metrics on uploaded file */}
                    {predResult.metrics && !predResult.metrics.error ? (
                      <div className="border border-[#BFDBFE] rounded-xl p-3 bg-[#EFF6FF]">
                        <p className="text-[11px] font-semibold text-[#1D4ED8] mb-0.5 flex items-center gap-1.5">
                          <TrendingUp className="w-3.5 h-3.5" />
                          Performance on Uploaded Dataset
                        </p>
                        <p className="text-[10px] text-[#6B7280] mb-2">
                          Model predictions vs actual <span className="font-mono font-semibold text-[#374151]">{predResult.target_column}</span> values in your file
                        </p>
                        {predResult.metrics.task === "classification" ? (
                          <div className="grid grid-cols-2 gap-2">
                            {[
                              { label: "Accuracy",  value: predResult.metrics.accuracy,  color: "#2B7FFF", fmt: (v) => `${(v * 100).toFixed(1)}%` },
                              { label: "F1 Score",  value: predResult.metrics.f1,        color: "#7C3AED", fmt: (v) => v.toFixed(3) },
                              { label: "Precision", value: predResult.metrics.precision, color: "#059669", fmt: (v) => v.toFixed(3) },
                              { label: "Recall",    value: predResult.metrics.recall,    color: "#D97706", fmt: (v) => v.toFixed(3) },
                            ].map((m) => (
                              <div key={m.label} className="bg-white rounded-lg border border-[#DBEAFE] px-3 py-2 text-center">
                                <p className="text-[18px] font-bold" style={{ color: m.color }}>{m.fmt(m.value)}</p>
                                <p className="text-[10px] text-[#6B7280] mt-0.5">{m.label}</p>
                              </div>
                            ))}
                          </div>
                        ) : (
                          <div className="grid grid-cols-3 gap-2">
                            {[
                              { label: "MAE",  value: predResult.metrics.mae,  color: "#D97706", fmt: (v) => v.toFixed(3) },
                              { label: "RMSE", value: predResult.metrics.rmse, color: "#DC2626", fmt: (v) => v.toFixed(3) },
                              { label: "R²",   value: predResult.metrics.r2,   color: "#059669", fmt: (v) => v.toFixed(3) },
                            ].map((m) => (
                              <div key={m.label} className="bg-white rounded-lg border border-[#DBEAFE] px-3 py-2 text-center">
                                <p className="text-[18px] font-bold" style={{ color: m.color }}>{m.fmt(m.value)}</p>
                                <p className="text-[10px] text-[#6B7280] mt-0.5">{m.label}</p>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    ) : (
                      <div className="flex items-start gap-2 px-3 py-2 rounded-lg bg-[#F9FAFB] border border-[#E5E7EB]">
                        <AlertCircle className="w-3.5 h-3.5 text-[#9CA3AF] flex-shrink-0 mt-0.5" />
                        <p className="text-[11px] text-[#6B7280]">
                          No evaluation metrics — your file did not include the actual{" "}
                          <span className="font-mono font-semibold text-[#374151]">{predResult.target_column}</span>{" "}
                          column. Add it to measure how well the model performs on your data.
                        </p>
                      </div>
                    )}

                    {/* Model training metrics */}
                    {predResult.model_metrics && Object.keys(predResult.model_metrics).length > 0 && (
                      <div className="border border-[#E5E7EB] rounded-xl p-3 bg-[#F9FAFB]">
                        <p className="text-[11px] font-semibold text-[#374151] mb-2 flex items-center gap-1.5">
                          <TrendingUp className="w-3.5 h-3.5 text-[#7C3AED]" />
                          Model Training Metrics
                          <span className="text-[10px] font-normal text-[#9CA3AF] ml-1">· {predResult.model_name}</span>
                        </p>
                        {predResult.model_metrics.task === "regression" ? (
                          <div className="grid grid-cols-3 gap-2">
                            {[
                              { label: "MAE",  value: predResult.model_metrics.mae,  color: "#D97706" },
                              { label: "RMSE", value: predResult.model_metrics.rmse, color: "#DC2626" },
                              { label: "R²",   value: predResult.model_metrics.r2,   color: "#059669" },
                            ].filter((m) => m.value != null).map((m) => (
                              <div key={m.label} className="bg-white rounded-lg border border-[#E5E7EB] px-2 py-2 text-center">
                                <p className="text-[16px] font-bold" style={{ color: m.color }}>{Number(m.value).toFixed(3)}</p>
                                <p className="text-[10px] text-[#6B7280] mt-0.5">{m.label}</p>
                              </div>
                            ))}
                          </div>
                        ) : (
                          <div className="grid grid-cols-3 gap-2">
                            {[
                              { label: "Accuracy",    value: predResult.model_metrics.holdout_accuracy ?? predResult.model_metrics.accuracy, color: "#2B7FFF", pct: true },
                              { label: "CV Accuracy", value: predResult.model_metrics.cv_accuracy,      color: "#6366F1", pct: true },
                              { label: "F1 Score",    value: predResult.model_metrics.f1,               color: "#7C3AED", pct: false },
                              { label: "Precision",   value: predResult.model_metrics.precision,        color: "#059669", pct: false },
                              { label: "Recall",      value: predResult.model_metrics.recall,           color: "#D97706", pct: false },
                            ].filter((m) => m.value != null).map((m) => (
                              <div key={m.label} className="bg-white rounded-lg border border-[#E5E7EB] px-2 py-2 text-center">
                                <p className="text-[16px] font-bold" style={{ color: m.color }}>
                                  {m.pct ? `${(m.value * 100).toFixed(1)}%` : Number(m.value).toFixed(3)}
                                </p>
                                <p className="text-[10px] text-[#6B7280] mt-0.5">{m.label}</p>
                              </div>
                            ))}
                          </div>
                        )}
                        <p className="text-[10px] text-[#9CA3AF] mt-2 text-center">Metrics from when this model was trained</p>
                      </div>
                    )}

                    {/* Preview table — first 5 rows */}
                    <div className="overflow-x-auto rounded-lg border border-[#E5E7EB] max-h-48">
                      <table className="text-[11px] w-full">
                        <thead>
                          <tr className="bg-[#F9FAFB] border-b border-[#E5E7EB]">
                            {(predResult.columns || []).map((c) => (
                              <th key={c} className={`px-2 py-1.5 text-left font-medium whitespace-nowrap ${
                                c === predResult.pred_column ? "text-[#2563EB]" :
                                c === predResult.conf_column ? "text-[#7C3AED]" : "text-[#374151]"
                              }`}>{c}</th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {(predResult.data || []).slice(0, 5).map((row, i) => (
                            <tr key={i} className="border-b border-[#F3F4F6] hover:bg-[#FAFAFA]">
                              {(predResult.columns || []).map((c) => (
                                <td key={c} className={`px-2 py-1 whitespace-nowrap ${
                                  c === predResult.pred_column ? "font-semibold text-[#2563EB]" :
                                  c === predResult.conf_column ? "text-[#7C3AED]" : "text-[#374151]"
                                }`}>
                                  {row[c] == null ? "—" : String(row[c])}
                                </td>
                              ))}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                      {(predResult.data?.length || 0) > 5 && (
                        <p className="text-center text-[10px] text-[#9CA3AF] py-1.5">
                          Showing 5 of {predResult.data.length} rows — download CSV for full results
                        </p>
                      )}
                    </div>
                  </div>
                )}

                {predResult?.error && (
                  <div className="bg-[#FEF2F2] border border-[#FECACA] rounded-lg p-3 text-sm text-[#DC2626]">{predResult.error}</div>
                )}

                <div className="flex gap-3 pt-1">
                  <button onClick={closePredict}
                    className="flex-1 py-2 border border-[#E5E7EB] rounded-lg text-sm text-[#374151] hover:bg-[#F9FAFB]">Close</button>
                  <button onClick={handlePredictFile} disabled={predicting || !predFile}
                    className="flex-1 py-2 bg-[#2563EB] text-white rounded-lg text-sm font-medium hover:bg-[#1D4ED8] disabled:opacity-50 flex items-center justify-center gap-2">
                    {predicting ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Zap className="w-4 h-4" />}
                    {predicting ? "Predicting…" : "Run Predictions"}
                  </button>
                </div>
              </>
            )}
          </div>
        )}
      </Modal>

      {/* ══ Preview Transform Modal ══ */}
      {previewOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-4xl max-h-[90vh] flex flex-col">
            {/* Header */}
            <div className="flex items-center justify-between px-6 py-4 border-b border-[#E5E7EB]">
              <div>
                <h3 className="text-[15px] font-semibold text-[#111827]">Transform Preview</h3>
                <p className="text-[11px] text-[#6B7280] mt-0.5">
                  Showing how your data will look after preprocessing — original dataset is not modified
                </p>
              </div>
              <button onClick={() => setPreviewOpen(false)} className="p-1 rounded hover:bg-[#F3F4F6]">
                <X className="w-4 h-4 text-[#6B7280]" />
              </button>
            </div>

            {/* Body */}
            <div className="overflow-y-auto flex-1 px-6 py-4">
              {previewLoading && (
                <div className="flex items-center justify-center py-16 gap-2 text-[#6B7280] text-sm">
                  <div className="w-4 h-4 border-2 border-[#7C3AED] border-t-transparent rounded-full animate-spin" />
                  Applying transforms…
                </div>
              )}
              {previewError && (
                <div className="bg-[#FEF2F2] border border-[#FECACA] rounded-lg p-3 text-sm text-[#DC2626]">{previewError}</div>
              )}
              {previewData && !previewLoading && (
                <>
                  {/* Tabs */}
                  <div className="flex border border-[#E5E7EB] rounded-lg overflow-hidden text-[12px] font-medium mb-4 w-fit">
                    {[["stats", "📊 Column Stats"], ["rows", "🗂 Sample Rows"]].map(([tab, label]) => (
                      <button key={tab} onClick={() => setPreviewTab(tab)}
                        className={`px-4 py-1.5 transition-colors ${previewTab === tab ? "bg-[#7C3AED] text-white" : "bg-white text-[#374151] hover:bg-[#F9FAFB]"}`}>
                        {label}
                      </button>
                    ))}
                  </div>

                  {/* ── Stats tab ── */}
                  {previewTab === "stats" && (
                    <div className="border border-[#E5E7EB] rounded-lg overflow-hidden text-[12px]">
                      {/* Table header */}
                      <div className="grid grid-cols-[160px_110px_1fr_1fr] bg-[#F9FAFB] px-3 py-2 text-[10px] font-semibold text-[#6B7280] uppercase tracking-wide border-b border-[#E5E7EB]">
                        <span>Column</span>
                        <span>Transform</span>
                        <span>Before</span>
                        <span>After</span>
                      </div>
                      {(previewData.column_summary || []).map((row) => {
                        const isCat = row.before?.is_cat;
                        const transformLabel = {
                          none:         "Passthrough",
                          standard:     "Standardize",
                          normalize:    "Normalize",
                          label_encode: "Label Encode",
                          auto:         "Auto-detect",
                          label_encode_target: "Label Encode",
                        }[row.transform] || row.transform;

                        const transformColor = {
                          standard:     "bg-[#EFF6FF] text-[#2563EB] border-[#BFDBFE]",
                          normalize:    "bg-[#F0FDF4] text-[#16A34A] border-[#BBF7D0]",
                          label_encode: "bg-[#FEF3C7] text-[#D97706] border-[#FCD34D]",
                          auto:         "bg-[#F5F3FF] text-[#7C3AED] border-[#DDD6FE]",
                          none:         "bg-[#F3F4F6] text-[#6B7280] border-[#E5E7EB]",
                        }[row.transform] || "bg-[#F3F4F6] text-[#6B7280] border-[#E5E7EB]";

                        const renderStats = (stats) => {
                          if (!stats) return <span className="text-[#9CA3AF]">—</span>;
                          if (stats.is_cat) return (
                            <div className="space-y-0.5">
                              <div><span className="text-[#9CA3AF]">unique:</span> <span className="font-medium">{stats.unique}</span></div>
                              {stats.top != null && <div><span className="text-[#9CA3AF]">top:</span> <span className="font-mono font-medium">{String(stats.top)}</span></div>}
                              {stats.nulls > 0 && <div className="text-[#EF4444]"><span>nulls:</span> <span className="font-medium">{stats.nulls}</span></div>}
                              {stats.categories && <div className="text-[#9CA3AF] text-[10px]">{stats.categories.slice(0,4).join(" / ")}{stats.categories.length > 4 ? ` +${stats.categories.length-4}` : ""}</div>}
                            </div>
                          );
                          return (
                            <div className="grid grid-cols-2 gap-x-3 gap-y-0.5">
                              <div><span className="text-[#9CA3AF]">mean:</span> <span className="font-medium">{stats.mean}</span></div>
                              <div><span className="text-[#9CA3AF]">std:</span>  <span className="font-medium">{stats.std}</span></div>
                              <div><span className="text-[#9CA3AF]">min:</span>  <span className="font-medium">{stats.min}</span></div>
                              <div><span className="text-[#9CA3AF]">max:</span>  <span className="font-medium">{stats.max}</span></div>
                              {stats.nulls > 0 && <div className="col-span-2 text-[#EF4444]">nulls: {stats.nulls}</div>}
                            </div>
                          );
                        };

                        // Validation hint
                        let hint = null;
                        const after = row.after;
                        if (after && !after.is_cat) {
                          if (row.transform === "standard") {
                            const meanOk = Math.abs(after.mean) < 0.01;
                            const stdOk  = Math.abs(after.std - 1) < 0.05;
                            hint = meanOk && stdOk
                              ? <span className="text-[#16A34A] text-[10px] font-medium">✓ mean≈0, std≈1</span>
                              : <span className="text-[#D97706] text-[10px]">mean={after.mean}, std={after.std}</span>;
                          } else if (row.transform === "normalize") {
                            const minOk = Math.abs(after.min) < 0.001;
                            const maxOk = Math.abs(after.max - 1) < 0.001;
                            hint = minOk && maxOk
                              ? <span className="text-[#16A34A] text-[10px] font-medium">✓ min=0, max=1</span>
                              : <span className="text-[#D97706] text-[10px]">min={after.min}, max={after.max}</span>;
                          }
                        } else if (after?.is_cat && row.transform === "label_encode" && row.categories) {
                          hint = <span className="text-[#D97706] text-[10px]">{row.categories.slice(0,4).join(" / ")}{row.categories.length>4?` +${row.categories.length-4}`:""}</span>;
                        }

                        return (
                          <div key={row.column} className={`grid grid-cols-[160px_110px_1fr_1fr] px-3 py-2.5 border-b border-[#F3F4F6] ${row.is_target ? "bg-[#F5F3FF]" : "hover:bg-[#FAFAFA]"}`}>
                            <div className="flex items-start gap-1 font-mono text-[#374151] pr-2">
                              <span className="truncate">{row.column}</span>
                              {row.is_target && <span className="text-[9px] bg-[#7C3AED] text-white px-1 py-0.5 rounded flex-shrink-0">target</span>}
                            </div>
                            <div className="flex flex-col gap-1">
                              <span className={`text-[10px] px-1.5 py-0.5 rounded-full border w-fit ${transformColor}`}>{transformLabel}</span>
                              {hint}
                            </div>
                            <div className="text-[11px] text-[#374151] pr-2">{renderStats(row.before)}</div>
                            <div className="text-[11px] text-[#374151]">{renderStats(row.after)}</div>
                          </div>
                        );
                      })}
                    </div>
                  )}

                  {/* ── Rows tab ── */}
                  {previewTab === "rows" && (() => {
                    const allCols = [
                      ...(previewData.feature_columns || []),
                      ...(previewData.target_column ? [previewData.target_column] : []),
                    ];
                    const summary = previewData.column_summary || [];
                    return (
                      <div className="space-y-4">
                        <div className="text-[11px] text-[#6B7280]">
                          Showing first 10 rows. Left = original values · Right = after transform.
                        </div>
                        <div className="overflow-x-auto rounded-lg border border-[#E5E7EB]">
                          <table className="text-[11px] w-full border-collapse">
                            <thead>
                              <tr>
                                <th className="px-2 py-1.5 bg-[#F9FAFB] text-[#6B7280] text-[10px] font-semibold border-b border-r border-[#E5E7EB] text-left sticky left-0">#</th>
                                {allCols.map((col) => {
                                  const s = summary.find((r) => r.column === col);
                                  const transformColor = {
                                    standard:     "text-[#2563EB]",
                                    normalize:    "text-[#16A34A]",
                                    label_encode: "text-[#D97706]",
                                  }[s?.transform] || "text-[#6B7280]";
                                  return (
                                    <th key={col} colSpan={2} className="px-2 py-1.5 bg-[#F9FAFB] border-b border-r border-[#E5E7EB] text-left">
                                      <div className={`font-mono font-semibold ${s?.is_target ? "text-[#7C3AED]" : "text-[#374151]"}`}>{col}</div>
                                      <div className={`text-[9px] ${transformColor}`}>{s?.transform || "none"}</div>
                                    </th>
                                  );
                                })}
                              </tr>
                              <tr>
                                <th className="px-2 py-1 bg-[#F9FAFB] border-b border-r border-[#E5E7EB] sticky left-0" />
                                {allCols.map((col) => (
                                  <React.Fragment key={col}>
                                    <th className="px-2 py-1 bg-[#FEF3C7] text-[#92400E] text-[9px] font-medium border-b border-r border-[#E5E7EB]">Before</th>
                                    <th className="px-2 py-1 bg-[#D1FAE5] text-[#065F46] text-[9px] font-medium border-b border-r border-[#E5E7EB]">After</th>
                                  </React.Fragment>
                                ))}
                              </tr>
                            </thead>
                            <tbody>
                              {(previewData.sample_before || []).map((rowBefore, i) => {
                                const rowAfter = (previewData.sample_after || [])[i] || {};
                                return (
                                  <tr key={i} className="border-b border-[#F3F4F6] hover:bg-[#FAFAFA]">
                                    <td className="px-2 py-1.5 text-[#9CA3AF] border-r border-[#F3F4F6] sticky left-0 bg-white">{i + 1}</td>
                                    {allCols.map((col) => (
                                      <React.Fragment key={col}>
                                        <td className="px-2 py-1.5 border-r border-[#F3F4F6] text-[#374151] bg-[#FFFBEB]">
                                          {rowBefore[col] == null ? <span className="text-[#D1D5DB]">null</span> : String(rowBefore[col])}
                                        </td>
                                        <td className="px-2 py-1.5 border-r border-[#F3F4F6] font-medium text-[#111827] bg-[#F0FDF4]">
                                          {rowAfter[col] == null ? <span className="text-[#D1D5DB]">null</span> : String(rowAfter[col])}
                                        </td>
                                      </React.Fragment>
                                    ))}
                                  </tr>
                                );
                              })}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    );
                  })()}
                </>
              )}
            </div>

            {/* Footer */}
            <div className="px-6 py-3 border-t border-[#E5E7EB] flex justify-end">
              <button onClick={() => setPreviewOpen(false)}
                className="px-4 py-2 border border-[#E5E7EB] rounded-lg text-sm text-[#374151] hover:bg-[#F9FAFB]">
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
