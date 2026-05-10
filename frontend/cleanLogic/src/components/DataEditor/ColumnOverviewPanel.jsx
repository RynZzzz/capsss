import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  ComposedChart,
  Bar,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
} from "recharts";

// ---------------------------------------------------------------------------
// KDE helpers
// ---------------------------------------------------------------------------
function gaussianKernel(u) {
  return Math.exp(-0.5 * u * u) / Math.sqrt(2 * Math.PI);
}

function buildHistogramData(valueCounts, minVal, maxVal) {
  if (!valueCounts) return null;

  const entries = Object.entries(valueCounts)
    .map(([k, v]) => [parseFloat(k), Number(v)])
    .filter(([k]) => !isNaN(k))
    .sort(([a], [b]) => a - b);

  if (entries.length === 0) return null;

  const totalCount = entries.reduce((s, [, c]) => s + c, 0);
  if (totalCount === 0) return null;

  // Weighted mean + std for Silverman bandwidth
  const mean = entries.reduce((s, [v, c]) => s + v * c, 0) / totalCount;
  const variance = entries.reduce((s, [v, c]) => s + c * (v - mean) ** 2, 0) / totalCount;
  const std = Math.sqrt(variance);

  let bars; // [{ val: number, label: string, count: number }]

  if (entries.length <= 20) {
    // Low-cardinality: one bar per unique value — avoids sparse empty bins
    bars = entries.map(([val, count]) => ({
      val,
      label: Number.isInteger(val) ? String(val) : val.toFixed(2).replace(/\.?0+$/, ""),
      count,
    }));
  } else {
    // High-cardinality: 10 equal-width bins
    const lo = minVal ?? entries[0][0];
    const hi = maxVal ?? entries[entries.length - 1][0];
    if (lo === hi) return null;

    const numBins = 10;
    const binWidth = (hi - lo) / numBins;
    bars = Array.from({ length: numBins }, (_, i) => ({
      val: lo + i * binWidth + binWidth / 2,
      label: (lo + i * binWidth).toFixed(1),
      count: 0,
    }));
    for (const [val, cnt] of entries) {
      let idx = Math.floor((val - (minVal ?? entries[0][0])) / binWidth);
      if (idx >= numBins) idx = numBins - 1;
      if (idx >= 0) bars[idx].count += cnt;
    }
  }

  // KDE bandwidth — fall back to spread/n when std is 0
  const spread = entries[entries.length - 1][0] - entries[0][0];
  const bandwidth =
    std > 0
      ? 1.06 * std * Math.pow(totalCount, -0.2)
      : (spread / Math.max(entries.length - 1, 1) || 1);

  const maxCount = Math.max(...bars.map((b) => b.count), 1);

  const data = bars.map((bar) => {
    const density =
      entries.reduce((s, [v, c]) => s + c * gaussianKernel((bar.val - v) / bandwidth), 0) /
      (totalCount * bandwidth);
    return { label: bar.label, count: bar.count, density };
  });

  const maxDensity = Math.max(...data.map((d) => d.density), 1e-10);
  return data.map((d) => ({
    ...d,
    kde: (d.density / maxDensity) * maxCount,
  }));
}

const NUMERIC_TYPES = new Set([
  "integer", "int", "bigint", "smallint",
  "decimal", "float", "numeric", "double", "real", "number",
]);

// ---------------------------------------------------------------------------
// Custom recharts tooltip
// ---------------------------------------------------------------------------
function ChartTooltip({ active, payload, label, total }) {
  if (!active || !payload?.length) return null;
  const count = payload.find((p) => p.dataKey === "count")?.value ?? 0;
  const pct = total ? ((count / total) * 100).toFixed(1) : "0.0";
  return (
    <div className="bg-gray-900 text-white rounded-lg px-3 py-2 shadow-xl text-[10px] leading-relaxed pointer-events-none">
      <p className="font-semibold mb-0.5">≥ {label}</p>
      <p>
        {count} values · {pct}%
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Error percentage bar row
// ---------------------------------------------------------------------------
function PctBar({ label, count, total, color }) {
  const pct = total > 0 ? (count / total) * 100 : 0;
  return (
    <div className="flex items-center gap-2 text-xs">
      <div className="w-20 text-[#6B7280] text-right shrink-0">{label}</div>
      <div className="flex-1 h-2.5 rounded-full bg-gray-100 overflow-hidden">
        <div
          className="h-full rounded-full transition-all"
          style={{ width: `${pct}%`, backgroundColor: color }}
        />
      </div>
      <div className="w-12 text-[#6B7280] text-right shrink-0">
        {pct.toFixed(1)}%
      </div>
    </div>
  );
}

/**
 * @param {{ column: {id: string, name: string, type: string} | null, stats: object, visible: boolean, onClose: () => void, sessionId?: string|null, apiService: any, onValueUpdated?: () => Promise<void>|void, currentRows?: Array<Record<string, any>> }} props
 */
const ColumnOverviewPanel = ({
  column,
  stats,
  visible,
  onClose,
  sessionId,
  apiService,
  onValueUpdated,
  currentRows = [],
}) => {
  if (!visible || !column || !stats) return null;

  const [expandedSection, setExpandedSection] = useState(null);
  const [sectionData, setSectionData] = useState([]);
  const [sectionPage, setSectionPage] = useState(0);
  const [sectionTotal, setSectionTotal] = useState(0);
  const [sectionLoading, setSectionLoading] = useState(false);
  const [editingRowIdx, setEditingRowIdx] = useState(null);
  const [editingValue, setEditingValue] = useState("");
  const [valueCounts, setValueCounts] = useState(null);
  const [hasMoreValues, setHasMoreValues] = useState(false);
  const sectionLimit = 10;

  const isNumericType = NUMERIC_TYPES.has(column.type?.toLowerCase());

  // Fetch value_counts when panel opens for a numeric column
  useEffect(() => {
    if (!isNumericType || !sessionId || !apiService) return;
    setValueCounts(null);
    setHasMoreValues(false);
    apiService
      .getColumnDetails(sessionId, column.id)
      .then((data) => {
        setValueCounts(data?.value_counts || null);
        setHasMoreValues(!!data?.has_more_values);
      })
      .catch(() => setValueCounts(null));
  }, [column.id, sessionId, isNumericType]); // eslint-disable-line react-hooks/exhaustive-deps

  // Histogram + KDE data — min/max derived from value_counts when stats don't have them
  const histogramData = useMemo(
    () => buildHistogramData(valueCounts, stats.min ?? null, stats.max ?? null),
    [valueCounts, stats.min, stats.max],
  );

  const sectionConfig = useMemo(
    () => ({
      missing: { label: "Missing Values", issueType: "missing", count: stats.nullCount },
      outliers: { label: "Outliers", issueType: "outlier", count: stats.outliers },
      type_errors: {
        label: "Type Errors",
        issueType: "type_inconsistency",
        count: stats.typeErrors,
      },
      unique: { label: "Unique Values", issueType: null, count: stats.unique },
    }),
    [stats],
  );

  const uniqueRows = useMemo(() => {
    const values = (currentRows || []).map((row, idx) => {
      const raw = row?.[column.id];
      const value = raw && typeof raw === "object" ? raw.value : raw;
      const display = raw && typeof raw === "object" ? raw.display_value : value;
      return {
        row_idx: row?._index ?? idx,
        value,
        display_value:
          display === null || display === undefined || display === ""
            ? "Empty"
            : String(display),
      };
    });
    const seen = new Set();
    return values.filter((item) => {
      const key = String(item.value ?? "__empty__");
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }, [currentRows, column.id]);

  const loadSection = useCallback(async () => {
    if (!expandedSection || !sessionId) return;
    setSectionLoading(true);
    try {
      if (expandedSection === "unique") {
        const start = sectionPage * sectionLimit;
        const pageItems = uniqueRows.slice(start, start + sectionLimit);
        setSectionData(pageItems);
        setSectionTotal(uniqueRows.length);
        return;
      }
      const config = sectionConfig[expandedSection];
      const result = await apiService.getColumnValues(sessionId, column.id, {
        issue_type: config.issueType,
        limit: sectionLimit,
        offset: sectionPage * sectionLimit,
      });
      setSectionData(result?.values || []);
      setSectionTotal(Number(result?.total || 0));
    } catch {
      setSectionData([]);
      setSectionTotal(0);
    } finally {
      setSectionLoading(false);
    }
  }, [
    expandedSection,
    sessionId,
    sectionPage,
    sectionLimit,
    apiService,
    column.id,
    sectionConfig,
    uniqueRows,
  ]);

  useEffect(() => {
    setSectionPage(0);
    setSectionData([]);
    setSectionTotal(0);
    setEditingRowIdx(null);
  }, [expandedSection, column.id]);

  useEffect(() => {
    loadSection();
  }, [loadSection]);

  const handleSaveInlineEdit = useCallback(
    async (rowIdx) => {
      if (!sessionId) return;
      await apiService.updateCell(sessionId, Number(rowIdx), column.id, editingValue);
      setEditingRowIdx(null);
      if (onValueUpdated) await onValueUpdated();
      await loadSection();
    },
    [sessionId, apiService, column.id, editingValue, onValueUpdated, loadSection],
  );

  const total = stats.total || 1;
  const validCount = Math.max(
    0,
    stats.total - stats.nullCount - stats.outliers - stats.typeErrors,
  );

  return (
    <div className="w-full h-full">
      <div className="border-t border-gray-200 bg-white shadow-md px-4 py-4 relative h-full overflow-y-auto">
        <button
          onClick={onClose}
          className="absolute top-3 right-3 text-xs text-[#9CA3AF] hover:text-[#6B7280]"
        >
          ✕
        </button>

        {/* Header */}
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <div className="h-9 w-9 sm:h-10 sm:w-10 shrink-0 rounded-full bg-[#EEF2FF] flex items-center justify-center text-base sm:text-lg">
              📊
            </div>
            <div className="min-w-0">
              <p className="text-sm font-semibold text-[#111827] truncate">
                {column.name}
              </p>
              <p className="text-xs text-[#6A7282]">
                {column.type} • {stats.total} values
              </p>
            </div>
          </div>
          <span className="text-xs font-semibold text-[#16A34A] bg-[#DCFCE7] px-2 py-1 rounded-full shrink-0">
            {stats.completenessPct.toFixed(1)}% complete
          </span>
        </div>

        {/* Quick stats grid */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 sm:gap-3 mt-4 text-xs text-[#4B5563]">
          <div className="rounded-lg bg-[#F9FAFB] p-2">
            <span className="text-[#9CA3AF]">Unique</span>
            <div className="font-semibold mt-0.5">{stats.unique}</div>
          </div>
          <div className="rounded-lg bg-[#F9FAFB] p-2">
            <span className="text-[#9CA3AF]">Missing</span>
            <div className="font-semibold mt-0.5">{stats.nullCount}</div>
          </div>
          <div className="rounded-lg bg-[#F9FAFB] p-2">
            <span className="text-[#9CA3AF]">Type Errors</span>
            <div className="font-semibold mt-0.5">{stats.typeErrors}</div>
          </div>
          <div className="rounded-lg bg-[#F9FAFB] p-2">
            <span className="text-[#9CA3AF]">Outliers</span>
            <div className="font-semibold mt-0.5">{stats.outliers}</div>
          </div>
        </div>

        {/* Numeric stats */}
        {isNumericType && (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 sm:gap-3 mt-2 text-xs text-[#4B5563]">
            <div className="rounded-lg bg-[#F9FAFB] p-2">
              <span className="text-[#9CA3AF]">Min</span>
              <div className="font-semibold mt-0.5">{stats.min ?? "—"}</div>
            </div>
            <div className="rounded-lg bg-[#F9FAFB] p-2">
              <span className="text-[#9CA3AF]">Max</span>
              <div className="font-semibold mt-0.5">{stats.max ?? "—"}</div>
            </div>
            <div className="rounded-lg bg-[#F9FAFB] p-2">
              <span className="text-[#9CA3AF]">Mean</span>
              <div className="font-semibold mt-0.5">
                {stats.avg !== null && stats.avg !== undefined
                  ? Number(stats.avg).toFixed(2)
                  : "—"}
              </div>
            </div>
            <div className="rounded-lg bg-[#F9FAFB] p-2">
              <span className="text-[#9CA3AF]">Median</span>
              <div className="font-semibold mt-0.5">
                {stats.median !== null && stats.median !== undefined
                  ? Number(stats.median).toFixed(2)
                  : "—"}
              </div>
            </div>
          </div>
        )}

        {/* ----------------------------------------------------------------- */}
        {/* Error percentage breakdown                                         */}
        {/* ----------------------------------------------------------------- */}
        <div className="mt-4">
          <p className="text-xs font-semibold text-[#374151] mb-2">
            Data Quality Breakdown
          </p>
          <div className="space-y-1.5">
            <PctBar label="Valid" count={validCount} total={stats.total} color="#16A34A" />
            <PctBar label="Missing" count={stats.nullCount} total={stats.total} color="#F59E0B" />
            <PctBar label="Outliers" count={stats.outliers} total={stats.total} color="#EF4444" />
            <PctBar
              label="Type Errors"
              count={stats.typeErrors}
              total={stats.total}
              color="#8B5CF6"
            />
          </div>
        </div>

        {/* ----------------------------------------------------------------- */}
        {/* Histogram + KDE (numeric columns only)                             */}
        {/* ----------------------------------------------------------------- */}
        {isNumericType && (
          <div className="mt-5">
            <p className="text-xs font-semibold text-[#374151] mb-2">
              Distribution
              <span className="text-[10px] text-[#9CA3AF] font-normal ml-1">
                histogram + density curve
              </span>
              {hasMoreValues && (
                <span className="text-[10px] text-amber-500 font-normal ml-2">
                  · top 100 of {stats.unique} unique values
                </span>
              )}
            </p>
            {!histogramData && (
              <div className="flex items-center justify-center h-24 text-xs text-[#9CA3AF]">
                {valueCounts === null ? "Loading…" : "Not enough data to plot"}
              </div>
            )}
            {histogramData && (
              <div className="h-44 w-full max-w-sm mx-auto">
                <ResponsiveContainer width="100%" height="100%">
                  <ComposedChart
                    data={histogramData}
                    margin={{ top: 4, right: 4, bottom: 4, left: 0 }}
                    barCategoryGap="0%"
                  >
                    <XAxis
                      dataKey="label"
                      tick={{ fontSize: 9, fill: "#9CA3AF" }}
                      tickLine={false}
                      axisLine={false}
                      interval="preserveStartEnd"
                    />
                    <YAxis hide />
                    <Tooltip
                      content={<ChartTooltip total={stats.total} />}
                      cursor={{ fill: "rgba(43,127,255,0.08)" }}
                    />
                    <Bar
                      dataKey="count"
                      fill="url(#histGrad)"
                      radius={[2, 2, 0, 0]}
                    />
                    <Line
                      dataKey="kde"
                      type="monotone"
                      stroke="#AD46FF"
                      strokeWidth={2}
                      dot={false}
                      strokeDasharray="4 2"
                    />
                    <defs>
                      <linearGradient id="histGrad" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="#2B7FFF" stopOpacity={0.85} />
                        <stop offset="100%" stopColor="#2B7FFF" stopOpacity={0.35} />
                      </linearGradient>
                    </defs>
                  </ComposedChart>
                </ResponsiveContainer>
              </div>
            )}
          </div>
        )}

        {/* Most common values (non-numeric) */}
        {!isNumericType && stats.topValues && stats.topValues.length > 0 && (
          <div className="mt-4">
            <p className="text-xs font-semibold text-[#374151] mb-2">
              Most Common Values
            </p>
            <div className="space-y-1 text-xs text-[#4B5563]">
              {stats.topValues.map(([value, count]) => (
                <div key={value} className="flex items-center gap-2">
                  <div className="flex-1 truncate">{value}</div>
                  <div className="w-24 h-2.5 bg-gray-100 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-[#2B7FFF] rounded-full"
                      style={{
                        width: `${stats.total ? (count / stats.total) * 100 : 0}%`,
                      }}
                    />
                  </div>
                  <div className="text-[10px] text-[#6B7280] w-8 text-right">
                    {count}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ----------------------------------------------------------------- */}
        {/* Collapsible detail sections                                        */}
        {/* ----------------------------------------------------------------- */}
        <div className="mt-4 space-y-2">
          {Object.entries(sectionConfig).map(([key, config]) => (
            <div key={key} className="border border-gray-200 rounded-lg">
              <button
                onClick={() =>
                  setExpandedSection((prev) => (prev === key ? null : key))
                }
                className="w-full flex items-center justify-between px-3 py-2 text-sm text-[#374151] hover:bg-gray-50"
              >
                <span>{config.label}</span>
                <span className="text-xs bg-[#EEF2FF] text-[#4338CA] px-2 py-0.5 rounded-full">
                  {config.count}
                </span>
              </button>
              {expandedSection === key && (
                <div className="border-t border-gray-200 px-3 py-2">
                  {sectionLoading ? (
                    <div className="text-xs text-[#6B7280]">Loading...</div>
                  ) : (
                    <>
                      <div className="space-y-2 max-h-48 overflow-y-auto">
                        {sectionData.map((item) => (
                          <div
                            key={`${key}-${item.row_idx}-${item.display_value}`}
                            className="flex items-center gap-2 text-xs"
                          >
                            <span className="w-16 text-[#6B7280]">
                              Row {(item.row_idx ?? item.index) + 1}
                            </span>
                            {editingRowIdx === item.row_idx ? (
                              <input
                                value={editingValue}
                                onChange={(e) => setEditingValue(e.target.value)}
                                className="flex-1 border border-gray-200 rounded px-2 py-1"
                              />
                            ) : (
                              <span className="flex-1 truncate text-[#374151]">
                                {item.display_value ?? "Empty"}
                              </span>
                            )}
                            {editingRowIdx === item.row_idx ? (
                              <button
                                onClick={() => handleSaveInlineEdit(item.row_idx)}
                                className="px-2 py-1 rounded bg-[#2B7FFF] text-white"
                              >
                                Save
                              </button>
                            ) : (
                              <button
                                onClick={() => {
                                  setEditingRowIdx(item.row_idx);
                                  setEditingValue(item.value ?? "");
                                }}
                                className="px-2 py-1 rounded border border-gray-200"
                              >
                                Edit
                              </button>
                            )}
                          </div>
                        ))}
                        {sectionData.length === 0 && (
                          <div className="text-xs text-[#9CA3AF]">No values</div>
                        )}
                      </div>
                      <div className="flex items-center justify-between mt-3">
                        <button
                          onClick={() =>
                            setSectionPage((prev) => Math.max(0, prev - 1))
                          }
                          disabled={sectionPage === 0}
                          className="px-2 py-1 text-xs rounded border border-gray-200 disabled:opacity-40"
                        >
                          Previous
                        </button>
                        <span className="text-[11px] text-[#6B7280]">
                          Page {sectionPage + 1} /{" "}
                          {Math.max(1, Math.ceil(sectionTotal / sectionLimit))}
                        </span>
                        <button
                          onClick={() =>
                            setSectionPage((prev) =>
                              prev + 1 <
                              Math.max(1, Math.ceil(sectionTotal / sectionLimit))
                                ? prev + 1
                                : prev,
                            )
                          }
                          disabled={
                            (sectionPage + 1) * sectionLimit >= sectionTotal
                          }
                          className="px-2 py-1 text-xs rounded border border-gray-200 disabled:opacity-40"
                        >
                          Next
                        </button>
                      </div>
                    </>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

export default ColumnOverviewPanel;
