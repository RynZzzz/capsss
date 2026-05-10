// utils/buildChartContext.js
//
// Pull per-column stats out of the dataset profile (from useDataProfiler) and
// package them alongside the chart config + applied cleaning steps into the
// payload expected by the POST /api/ai/analyze-chart backend endpoint.
//
// We only send column-level metadata and light-weight step descriptions —
// never raw row values — to keep the payload small and safe.

const asNumber = (v) => (typeof v === "number" && Number.isFinite(v) ? v : null);

const findColStats = (profile, colName) => {
  if (!colName) return null;
  const col = (profile?.columns || []).find((c) => c.name === colName);
  if (!col) return null;

  const total = col.total_count ?? null;
  const missing = col.missing_count ?? null;
  // completeness is 0–100 (percent) in this codebase. Fall back to computing
  // from missing / total when it isn't present.
  let missingPct = null;
  if (col.completeness != null) {
    missingPct = +(100 - col.completeness).toFixed(1);
  } else if (total && total > 0 && missing != null) {
    missingPct = +((missing / total) * 100).toFixed(1);
  }

  return {
    name: col.name,
    type: col.data_type ?? col.type ?? null,
    total,
    missing,
    missing_pct: missingPct,
    unique: col.unique_count ?? null,
    mean: asNumber(col.mean),
    median: asNumber(col.median),
    std: asNumber(col.std),
    min: col.min ?? null,
    max: col.max ?? null,
    outliers: col.outlier_count ?? 0,
    top_value: col.top_value ?? null,
    top_freq: col.top_freq ?? null,
  };
};

export const buildChartContext = (
  profile,
  chartType,
  xCol,
  yCol,
  appliedSteps = [],
  chartTitle = null,
) => ({
  chart_type: chartType,
  chart_title: chartTitle,
  x_axis: xCol || null,
  y_axis: yCol || null,
  x_stats: findColStats(profile, xCol),
  y_stats: findColStats(profile, yCol),
  // Only description + type + column — avoid sending full step payload.
  applied_steps: (appliedSteps || [])
    .filter(Boolean)
    .map((s) => ({
      type: s.type || "unknown",
      description: s.description ?? null,
      column: s.column ?? null,
    })),
});
