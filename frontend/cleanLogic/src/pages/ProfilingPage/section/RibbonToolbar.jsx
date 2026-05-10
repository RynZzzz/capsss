import React, { useState, useRef } from "react";
import { createPortal } from "react-dom";
import {
  BarChart3,
  Calculator,
  Calendar,
  ChevronDown,
  Copy,
  Database,
  Filter,
  Scissors,
  Trash2,
  TrendingUp,
  Type,
  AlertTriangle,
  Wand2,
  ArrowUpDown,
  Replace,
  Merge,
  Pencil,
} from "lucide-react";

// ── Shared style tokens ──────────────────────────────────────────────────────

const ACCENT = {
  blue:   { bg: "hover:bg-blue-50",   icon: "text-blue-500",   ring: "hover:ring-blue-200"  },
  red:    { bg: "hover:bg-red-50",     icon: "text-red-400",    ring: "hover:ring-red-200"   },
  amber:  { bg: "hover:bg-amber-50",   icon: "text-amber-500",  ring: "hover:ring-amber-200" },
  violet: { bg: "hover:bg-violet-50",  icon: "text-violet-500", ring: "hover:ring-violet-200"},
  teal:   { bg: "hover:bg-teal-50",    icon: "text-teal-500",   ring: "hover:ring-teal-200"  },
  gray:   { bg: "hover:bg-gray-100",   icon: "text-gray-500",   ring: "hover:ring-gray-200"  },
};

// ── Tooltip portal ───────────────────────────────────────────────────────────

function TooltipPortal({ tip, pos }) {
  if (!tip) return null;
  return createPortal(
    <div
      style={{
        position: "fixed",
        left: pos.x,
        top: pos.y - 10,
        transform: "translate(-50%, -100%)",
        zIndex: 99999,
        pointerEvents: "none",
      }}
      className="w-60"
    >
      <div className="bg-gray-900 rounded-xl px-3.5 py-3 shadow-2xl">
        <p className="text-[11.5px] font-semibold text-white mb-1">{tip.title}</p>
        <p className="text-[10.5px] text-gray-300 leading-relaxed">{tip.desc}</p>
        {tip.warning && (
          <p className="text-[10px] text-amber-400 mt-2 flex items-start gap-1 leading-relaxed">
            <span className="mt-px shrink-0">⚠</span>
            <span>{tip.warning}</span>
          </p>
        )}
      </div>
      <div className="w-3 h-3 bg-gray-900 rotate-45 mx-auto -mt-1.5 rounded-sm" />
    </div>,
    document.body
  );
}

// ── RibbonGroup ──────────────────────────────────────────────────────────────

const RibbonGroup = ({ title, children }) => (
  <div className="inline-flex flex-col shrink-0 px-3 py-2 border-r border-gray-200 last:border-r-0">
    <div className="flex items-start gap-1.5 min-h-[72px]">{children}</div>
    <div className="mt-1.5 text-center text-[9.5px] font-semibold tracking-[0.08em] text-gray-400 uppercase select-none">
      {title}
    </div>
  </div>
);

// ── RibbonButton ─────────────────────────────────────────────────────────────

const RibbonButton = ({
  icon: Icon,
  label,
  onClick,
  disabled,
  variant = "large",
  accent = "gray",
  title,
  tooltip,
}) => {
  const a = ACCENT[accent] || ACCENT.gray;
  const wrapRef = useRef(null);
  const [showTip, setShowTip] = useState(false);
  const [tipPos, setTipPos] = useState({ x: 0, y: 0 });

  const handleMouseEnter = () => {
    if (!tooltip || !wrapRef.current) return;
    const rect = wrapRef.current.getBoundingClientRect();
    setTipPos({ x: rect.left + rect.width / 2, y: rect.top });
    setShowTip(true);
  };

  const handleMouseLeave = () => setShowTip(false);

  const wrapClass = "relative";

  if (variant === "small") {
    return (
      <div ref={wrapRef} className={wrapClass} onMouseEnter={handleMouseEnter} onMouseLeave={handleMouseLeave}>
        <button
          onClick={onClick}
          disabled={disabled}
          title={title || label}
          className={`flex items-center gap-1.5 px-2.5 py-1.5 bg-white border border-gray-200 rounded-lg
            text-[11px] font-medium text-gray-600 transition-all
            ${a.bg} hover:border-gray-300 hover:shadow-sm
            disabled:opacity-35 disabled:cursor-not-allowed disabled:hover:bg-white disabled:hover:border-gray-200 disabled:hover:shadow-none`}
        >
          <Icon className={`w-3.5 h-3.5 shrink-0 ${disabled ? "text-gray-400" : a.icon}`} />
          <span className="whitespace-nowrap">{label}</span>
        </button>
        {showTip && <TooltipPortal tip={tooltip} pos={tipPos} />}
      </div>
    );
  }

  if (variant === "text") {
    return (
      <div ref={wrapRef} className={wrapClass} onMouseEnter={handleMouseEnter} onMouseLeave={handleMouseLeave}>
        <button
          onClick={onClick}
          disabled={disabled}
          title={title || label}
          className={`px-2.5 py-1.5 bg-white border border-gray-200 rounded-lg
            text-[11px] font-medium text-gray-600 transition-all
            ${a.bg} hover:border-gray-300 hover:shadow-sm
            disabled:opacity-35 disabled:cursor-not-allowed disabled:hover:bg-white disabled:hover:border-gray-200 disabled:hover:shadow-none`}
        >
          {label}
        </button>
        {showTip && <TooltipPortal tip={tooltip} pos={tipPos} />}
      </div>
    );
  }

  // large (default)
  return (
    <div ref={wrapRef} className={wrapClass} onMouseEnter={handleMouseEnter} onMouseLeave={handleMouseLeave}>
      <button
        onClick={onClick}
        disabled={disabled}
        title={title || label}
        className={`flex flex-col items-center justify-center gap-1.5 px-2.5 py-2
          min-w-[62px] h-[68px] bg-white border border-gray-200 rounded-xl
          text-[10.5px] font-medium text-gray-600 transition-all ring-1 ring-transparent
          ${a.bg} ${a.ring} hover:border-gray-300 hover:shadow-sm hover:-translate-y-px
          active:translate-y-0 active:shadow-none
          disabled:opacity-35 disabled:cursor-not-allowed disabled:hover:bg-white
          disabled:hover:border-gray-200 disabled:hover:shadow-none disabled:hover:translate-y-0`}
      >
        <Icon className={`w-6 h-6 shrink-0 transition-colors ${disabled ? "text-gray-350" : a.icon}`} />
        <span className="text-center leading-tight max-w-[76px]">{label}</span>
      </button>
      {showTip && <TooltipPortal tip={tooltip} pos={tipPos} />}
    </div>
  );
};

// ── RibbonToolbar ────────────────────────────────────────────────────────────

const TABS = [
  { id: "Clean",     label: "Clean",     emoji: "✦" },
  { id: "Transform", label: "Transform", emoji: "⇄" },
  { id: "Columns",   label: "Columns",   emoji: "▤" },
];

const RibbonToolbar = ({
  ribbonTab,
  setRibbonTab,
  hasSelection,
  allNumericSelected,
  allDateSelected,
  allTextSelected,
  isLoading,
  applyImpute,
  openRibbonModal,
  applyOutliers,
  duplicateScope,
  setDuplicateScope,
  applyDuplicates,
  applyTypeFix,
  applyDeleteColumns,
  applyTypeConversion,
  applyTextTransform,
  applyReplaceValues,
  applyIgnoreErrors,
  applyRenameColumn,
  applyDuplicateColumn,
  applyMergeColumns,
}) => {
  return (
    <div className="mb-6 border border-gray-200 rounded-2xl overflow-hidden shadow-sm bg-white">
      {/* Tab bar */}
      <div className="flex items-center px-4 bg-gradient-to-b from-white to-gray-50 border-b border-gray-200">
        {TABS.map(({ id, label, emoji }) => (
          <button
            key={id}
            onClick={() => setRibbonTab(id)}
            className={`relative flex items-center gap-1.5 px-5 py-2.5 text-[12.5px] font-semibold transition-colors select-none ${
              ribbonTab === id
                ? "text-blue-600"
                : "text-gray-400 hover:text-gray-600"
            }`}
          >
            <span className="text-[11px] opacity-60">{emoji}</span>
            {label}
            {ribbonTab === id && (
              <span className="absolute bottom-0 left-3 right-3 h-0.5 rounded-full bg-gradient-to-r from-blue-500 to-violet-500" />
            )}
          </button>
        ))}

        {/* Right-side hint */}
        {!hasSelection && (
          <span className="ml-auto text-[11px] text-gray-400 pr-1 flex items-center gap-1">
            <span className="w-1.5 h-1.5 rounded-full bg-amber-400 inline-block" />
            Select a column to enable actions
          </span>
        )}
      </div>

      {/* Toolbar body */}
      <div className="px-2 py-2 overflow-x-auto bg-gray-50/60">

        {/* ── CLEAN tab ── */}
        {ribbonTab === "Clean" && (
          <div className="inline-flex min-w-full gap-0">

            <RibbonGroup title="Missing Values">
              <RibbonButton accent="blue" icon={TrendingUp} label="Fill Mean"
                onClick={() => applyImpute("mean")}
                disabled={!hasSelection || !allNumericSelected || isLoading}
                tooltip={{ title: "Fill with Mean", desc: "Replaces missing values with the column average. Best for symmetric, normally distributed numeric data.", warning: "May distort results if the data contains outliers or is heavily skewed." }}
              />
              <RibbonButton accent="blue" icon={BarChart3} label="Fill Median"
                onClick={() => applyImpute("median")}
                disabled={!hasSelection || !allNumericSelected || isLoading}
                tooltip={{ title: "Fill with Median", desc: "Replaces missing values with the middle value of the column. More robust than mean for skewed distributions or when outliers are present." }}
              />
              <RibbonButton accent="blue" icon={Calculator} label="Fill Mode"
                onClick={() => applyImpute("mode")}
                disabled={!hasSelection || isLoading}
                tooltip={{ title: "Fill with Mode", desc: "Replaces missing values with the most frequently occurring value. Works for both numeric and text columns." }}
              />
              <div className="flex flex-col gap-1 justify-center">
                <RibbonButton accent="teal" icon={ArrowUpDown} label="Forward Fill"
                  onClick={() => applyImpute("forward_fill")}
                  disabled={!hasSelection || isLoading}
                  variant="text"
                  tooltip={{ title: "Forward Fill", desc: "Propagates the last known value downward to fill gaps. Best for time-series or sequentially ordered data." }}
                />
                <RibbonButton accent="teal" icon={ArrowUpDown} label="Backward Fill"
                  onClick={() => applyImpute("backward_fill")}
                  disabled={!hasSelection || isLoading}
                  variant="text"
                  tooltip={{ title: "Backward Fill", desc: "Propagates the next known value upward to fill gaps. Best for time-series data where future context is available." }}
                />
                <RibbonButton
                  accent="teal" icon={Type} label="Fill Constant" variant="small"
                  disabled={!hasSelection || isLoading}
                  tooltip={{ title: "Fill with Constant", desc: "Replaces missing values with a fixed value you define. Use when the correct default is known (e.g. 0, N/A)." }}
                  onClick={() => openRibbonModal({
                    title: "Fill with Constant", confirmLabel: "Apply",
                    fields: [{ key: "value", label: "Constant value", type: "text" }],
                    onConfirm: (v) => applyImpute("constant", { constant_value: v.value }),
                  })}
                />
              </div>
              <div className="flex flex-col gap-1 justify-center">
                <RibbonButton accent="red" icon={Trash2} label="Remove Rows"
                  onClick={() => applyImpute("remove_rows")}
                  disabled={!hasSelection || isLoading}
                  tooltip={{ title: "Remove Rows", desc: "Deletes entire rows that have a missing value in the selected column.", warning: "Permanently reduces dataset size. Use only when missing rows are not recoverable." }}
                />
                <RibbonButton accent="gray" icon={Filter} label="Ignore"
                  onClick={() => applyIgnoreErrors("missing")}
                  disabled={!hasSelection || isLoading}
                  variant="small"
                  tooltip={{ title: "Ignore Missing Values", desc: "Marks the missing values as acknowledged without making any changes to the data." }}
                />
                <RibbonButton
                  accent="violet" icon={Database} label="KNN Impute"
                  disabled={!hasSelection || !allNumericSelected || isLoading}
                  tooltip={{ title: "KNN Imputation", desc: "Fills missing values using the average of K most similar rows based on other columns. More accurate than mean or median.", warning: "Slower on large datasets. Numeric columns only." }}
                  onClick={() => openRibbonModal({
                    title: "KNN Imputation", confirmLabel: "Apply",
                    fields: [{ key: "neighbors", label: "Neighbors", type: "select", options: ["3","5","7","10"] }],
                    onConfirm: (v) => applyImpute("knn_impute", { knn_neighbors: Number(v.neighbors) }),
                  })}
                />
              </div>
            </RibbonGroup>

            <RibbonGroup title="Outliers">
              <RibbonButton accent="amber" icon={Filter} label="Cap"
                onClick={() => applyOutliers("iqr_cap")}
                disabled={!hasSelection || !allNumericSelected || isLoading}
                tooltip={{ title: "Cap Outliers (IQR)", desc: "Clamps values outside Q1 − 1.5×IQR and Q3 + 1.5×IQR to those boundaries. All rows are preserved, only extreme values are adjusted." }}
              />
              <RibbonButton accent="red" icon={Trash2} label="Remove"
                onClick={() => applyOutliers("iqr_remove")}
                disabled={!hasSelection || !allNumericSelected || isLoading}
                tooltip={{ title: "Remove Outliers (IQR)", desc: "Deletes entire rows where a value falls outside the IQR range (Q1 − 1.5×IQR or Q3 + 1.5×IQR).", warning: "Permanently reduces dataset size. Best when outlier rate is above 10%." }}
              />
              <RibbonButton accent="blue" icon={ArrowUpDown} label="Winsorize"
                onClick={() => applyOutliers("iqr_winsorize")}
                disabled={!hasSelection || !allNumericSelected || isLoading}
                tooltip={{ title: "Winsorize (IQR)", desc: "Replaces outlier values with the exact IQR boundary value. Similar to Cap but uses the theoretical Q1 − 1.5×IQR / Q3 + 1.5×IQR bound directly rather than the nearest real data point." }}
              />
              <RibbonButton accent="gray" icon={Filter} label="Ignore"
                onClick={() => applyIgnoreErrors("outlier")}
                disabled={!hasSelection || isLoading}
                tooltip={{ title: "Ignore Outliers", desc: "Acknowledges detected outliers without modifying any values. Use when outliers are valid data points." }}
              />
            </RibbonGroup>

            <RibbonGroup title="Duplicates">
              <div className="flex flex-col gap-2 min-w-[200px] justify-center">
                <div className="inline-flex bg-white border border-gray-200 rounded-xl p-0.5 self-start">
                  {[["all","All Columns"],["selected","Selected"]].map(([val, lbl]) => (
                    <button
                      key={val}
                      onClick={() => setDuplicateScope(val)}
                      disabled={val === "selected" && !hasSelection}
                      className={`px-3 py-1 text-[11px] font-medium rounded-lg transition-all ${
                        duplicateScope === val
                          ? "bg-blue-600 text-white shadow-sm"
                          : "text-gray-500 hover:text-gray-700 disabled:opacity-40"
                      }`}
                    >{lbl}</button>
                  ))}
                </div>
                <div className="grid grid-cols-2 gap-1.5">
                  <RibbonButton accent="red" icon={Trash2} label="Remove All"
                    onClick={() => applyDuplicates("remove_all")}
                    disabled={(duplicateScope==="selected"&&!hasSelection)||isLoading}
                    variant="small"
                    tooltip={{ title: "Remove All Duplicates", desc: "Deletes every duplicate row, keeping none of the repeated occurrences.", warning: "All copies including originals are removed if all are duplicates." }}
                  />
                  <RibbonButton accent="blue" icon={Copy} label="Keep First"
                    onClick={() => applyDuplicates("keep_first")}
                    disabled={(duplicateScope==="selected"&&!hasSelection)||isLoading}
                    variant="small"
                    tooltip={{ title: "Keep First Occurrence", desc: "Removes duplicate rows but retains the first occurrence of each duplicate group. Subsequent duplicates are deleted." }}
                  />
                  <RibbonButton accent="blue" icon={Copy} label="Keep Last"
                    onClick={() => applyDuplicates("keep_last")}
                    disabled={(duplicateScope==="selected"&&!hasSelection)||isLoading}
                    variant="small"
                    tooltip={{ title: "Keep Last Occurrence", desc: "Removes duplicate rows but retains the last occurrence of each duplicate group. Earlier duplicates are deleted." }}
                  />
                  <RibbonButton accent="teal" icon={Filter} label="Mark"
                    onClick={() => applyDuplicates("mark")}
                    disabled={(duplicateScope==="selected"&&!hasSelection)||isLoading}
                    variant="small"
                    tooltip={{ title: "Mark Duplicates", desc: "Flags duplicate rows with a marker column without deleting them. Useful for reviewing before committing to removal." }}
                  />
                </div>
              </div>
            </RibbonGroup>

            <RibbonGroup title="Type Inconsistencies">
              <RibbonButton accent="blue" icon={Calculator} label="Fix w/ Mode"
                onClick={() => applyTypeFix({ method: "mode" })}
                disabled={!hasSelection || isLoading}
                tooltip={{ title: "Fix with Mode", desc: "Replaces type-inconsistent values with the most frequent value in the column. Works for any data type." }}
              />
              <RibbonButton accent="blue" icon={TrendingUp} label="Fix w/ Mean"
                onClick={() => applyTypeFix({ method: "mean", numeric_only: true })}
                disabled={!hasSelection || !allNumericSelected || isLoading}
                tooltip={{ title: "Fix with Mean", desc: "Replaces non-numeric values with the column mean. Only applicable to numeric columns.", warning: "Sensitive to outliers. Use median if data is skewed." }}
              />
              <RibbonButton accent="blue" icon={BarChart3} label="Fix w/ Median"
                onClick={() => applyTypeFix({ method: "median", numeric_only: true })}
                disabled={!hasSelection || !allNumericSelected || isLoading}
                tooltip={{ title: "Fix with Median", desc: "Replaces non-numeric values with the column median. More robust than mean for skewed numeric data." }}
              />
              <RibbonButton accent="teal" icon={Database} label="Clean Numeric"
                onClick={() => applyTypeFix({ numeric_cleanup: true })}
                disabled={!hasSelection || !allNumericSelected || isLoading}
                tooltip={{ title: "Clean Numeric", desc: "Strips non-numeric characters such as $, %, commas, and spaces from values to make them parseable as numbers." }}
              />
              <RibbonButton accent="red" icon={Trash2} label="Remove Rows"
                onClick={() => applyTypeFix({ method: "remove" })}
                disabled={!hasSelection || isLoading}
                variant="small"
                tooltip={{ title: "Remove Rows with Type Errors", desc: "Deletes entire rows where the selected column contains a value whose type doesn't match the column's dominant type.", warning: "Permanently reduces dataset size. Use only when the inconsistent values are not recoverable." }}
              />
              <RibbonButton accent="gray" icon={Filter} label="Ignore"
                onClick={() => applyIgnoreErrors("type_inconsistency")}
                disabled={!hasSelection || isLoading}
                variant="small"
                tooltip={{ title: "Ignore Type Issues", desc: "Acknowledges type inconsistencies without making any changes to the column data." }}
              />
              <RibbonButton
                accent="violet" icon={Type} label="Clean Text" variant="text"
                disabled={!hasSelection || !allTextSelected || isLoading}
                tooltip={{ title: "Clean Text (Regex)", desc: "Applies a custom regex find-and-replace pattern across all values in the column. Use for structured text cleaning." }}
                onClick={() => openRibbonModal({
                  title: "Clean Text", confirmLabel: "Apply",
                  fields: [
                    { key: "regex", label: "Regex pattern", type: "text" },
                    { key: "replacement", label: "Replacement", type: "text" },
                  ],
                  onConfirm: (v) => applyTypeFix({ text_cleanup: true, text_regex: v.regex, text_replacement: v.replacement }),
                })}
              />
            </RibbonGroup>

          </div>
        )}

        {/* ── TRANSFORM tab ── */}
        {ribbonTab === "Transform" && (
          <div className="inline-flex min-w-full gap-0">

            <RibbonGroup title="Text Operations">
              <RibbonButton accent="violet" icon={Type} label="Uppercase"
                onClick={() => applyTextTransform("uppercase")}
                disabled={!hasSelection || isLoading}
                tooltip={{ title: "Convert to Uppercase", desc: "Transforms all text values in the column to UPPERCASE letters." }}
              />
              <RibbonButton accent="violet" icon={Type} label="Lowercase"
                onClick={() => applyTextTransform("lowercase")}
                disabled={!hasSelection || isLoading}
                tooltip={{ title: "Convert to Lowercase", desc: "Transforms all text values in the column to lowercase letters." }}
              />
              <RibbonButton accent="violet" icon={Type} label="Trim"
                onClick={() => applyTextTransform("trim")}
                disabled={!hasSelection || isLoading}
                tooltip={{ title: "Trim Whitespace", desc: "Removes leading and trailing spaces from all text values. Useful for fixing imported or copy-pasted data." }}
              />
              <RibbonButton accent="violet" icon={Type} label="Capitalize"
                onClick={() => applyTextTransform("capitalize")}
                disabled={!hasSelection || isLoading}
                tooltip={{ title: "Capitalize", desc: "Capitalizes the first letter of each value while lowercasing the rest (e.g. 'john doe' → 'John doe')." }}
              />
              <RibbonButton accent="teal" icon={Wand2} label="Remove Special"
                onClick={() => applyTextTransform("remove_special_chars")}
                disabled={!hasSelection || isLoading}
                tooltip={{ title: "Remove Special Characters", desc: "Strips punctuation and special characters (!, @, #, %, etc.) from all text values in the column." }}
              />
              <RibbonButton
                accent="blue" icon={Replace} label="Replace Values"
                disabled={!hasSelection || isLoading}
                tooltip={{ title: "Replace Values", desc: "Finds an exact match across all values in the column and replaces it with a new value you specify." }}
                onClick={() => openRibbonModal({
                  title: "Replace Specific Values", confirmLabel: "Apply",
                  fields: [
                    { key: "find",    label: "Find (exact value)", type: "text" },
                    { key: "replace", label: "Replace with",       type: "text" },
                  ],
                  onConfirm: (v) => applyReplaceValues(v.find, v.replace ?? ""),
                })}
              />
              <RibbonButton
                accent="teal" icon={Scissors} label="Split"
                disabled={!hasSelection || isLoading}
                tooltip={{ title: "Split by Delimiter", desc: "Splits each cell at a delimiter and keeps either the part before or after it. If the delimiter is not found, the original value is kept." }}
                onClick={() => openRibbonModal({
                  title: "Split by Delimiter", confirmLabel: "Apply",
                  fields: [
                    { key: "delimiter", label: "Delimiter (e.g. , or @)", type: "text" },
                    { key: "keep", label: "Keep", type: "select", options: ["before", "after"] },
                  ],
                  onConfirm: (v) => applyTextTransform("split_by_delimiter", { delimiter: v.delimiter, keep: v.keep || "before" }),
                })}
              />
            </RibbonGroup>

          </div>
        )}

        {/* ── COLUMNS tab ── */}
        {ribbonTab === "Columns" && (
          <div className="inline-flex min-w-full gap-0">

            <RibbonGroup title="Operations">
              <RibbonButton accent="blue" icon={Pencil} label="Rename"
                onClick={applyRenameColumn}
                disabled={!hasSelection || isLoading}
                tooltip={{ title: "Rename Column", desc: "Changes the name of the selected column. Does not affect the data stored inside it." }}
              />
              <RibbonButton accent="red" icon={Trash2} label="Delete"
                onClick={applyDeleteColumns}
                disabled={!hasSelection || isLoading}
                tooltip={{ title: "Delete Column", desc: "Permanently removes the selected column and all of its data from the dataset.", warning: "This action cannot be undone. All data in the column will be lost." }}
              />
              <RibbonButton accent="teal" icon={Copy} label="Duplicate"
                onClick={applyDuplicateColumn}
                disabled={!hasSelection || isLoading}
                tooltip={{ title: "Duplicate Column", desc: "Creates an exact copy of the selected column with a '_copy' suffix appended to its name." }}
              />
              <RibbonButton accent="violet" icon={Merge} label="Merge"
                onClick={applyMergeColumns}
                disabled={!hasSelection || isLoading}
                tooltip={{ title: "Merge Columns", desc: "Combines the selected column with another column by concatenating their text values into a single new column." }}
              />
            </RibbonGroup>

            <RibbonGroup title="Type Conversion">
              <RibbonButton accent="blue" icon={Calculator} label="To Integer"
                onClick={() => applyTypeConversion("Integer")}
                disabled={!hasSelection || isLoading}
                tooltip={{ title: "Convert to Integer", desc: "Casts column values to whole numbers. Decimal parts are truncated, not rounded.", warning: "Non-numeric values will become null after conversion." }}
              />
              <RibbonButton accent="blue" icon={Calculator} label="To Float"
                onClick={() => applyTypeConversion("Decimal")}
                disabled={!hasSelection || isLoading}
                tooltip={{ title: "Convert to Decimal", desc: "Casts column values to floating-point numbers. Enables decimal arithmetic and statistical computations.", warning: "Non-numeric values will become null after conversion." }}
              />
              <RibbonButton accent="violet" icon={Type} label="To String"
                onClick={() => applyTypeConversion("Text")}
                disabled={!hasSelection || isLoading}
                tooltip={{ title: "Convert to Text", desc: "Casts column values to string format. Useful before applying text operations like Trim, Uppercase, or Replace." }}
              />
              <RibbonButton accent="teal" icon={Calendar} label="To DateTime"
                onClick={() => applyTypeConversion("DateTime")}
                disabled={!hasSelection || isLoading}
                tooltip={{ title: "Convert to DateTime", desc: "Parses column values as date/time objects. Enables date filtering, formatting, and time-based analysis.", warning: "Values that cannot be parsed as dates will become null." }}
              />
            </RibbonGroup>

          </div>
        )}

      </div>
    </div>
  );
};

export default RibbonToolbar;
