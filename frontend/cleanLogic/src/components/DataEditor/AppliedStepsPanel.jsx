import React, { useMemo, useState, useRef, useEffect } from "react";

const TYPE_ICON = {
  Source:             "⬤",
  "Changed Value":    "✏️",
  "Changed Values":   "✏️",
  "Removed Columns":  "✂️",
  "Renamed Columns":  "🏷️",
  "Changed Type":     "🔤",
  "Filtered Rows":    "🔎",
  "Removed Rows":     "🧹",
  "Added Column":     "➕",
  "Added Rows":       "➕",
  "Sorted Rows":      "↕️",
  "Replaced Values":  "♻️",
  "Filled Down":      "⬇️",
  "Merged Queries":   "🔗",
  "Split Column":     "✂️",
  "Grouped Rows":     "🧩",
  drop_column:        "✂️",
  delete_rows:        "🧹",
  cell_edit:          "✏️",
  type_conversion:    "🔤",
  impute:             "🩹",
  outlier:            "📊",
  duplicates:         "🔁",
  type_inconsistency: "⚠️",
};

const formatTimestamp = (timestamp) => {
  if (!timestamp) return "";
  const diff = Date.now() - timestamp;
  if (diff < 60000) return "just now";
  if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
  if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
  return new Date(timestamp).toLocaleDateString();
};

const StepRow = ({ step, index, isActive, onJump, onDelete, onRename }) => {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(step.name || step.type || "");
  const inputRef = useRef(null);

  useEffect(() => {
    if (editing) inputRef.current?.focus();
  }, [editing]);

  const commitRename = () => {
    const trimmed = draft.trim();
    if (trimmed && trimmed !== (step.name || step.type)) {
      onRename(index, trimmed);
    }
    setEditing(false);
  };

  const icon = TYPE_ICON[step.type] || TYPE_ICON[step.name] || "•";
  const label = step.name || step.type || "Step";
  const params = step.params || {};
  const detail =
    step.description ||
    (params.column
      ? params.row_index != null
        ? `${params.column} [row ${params.row_index}]`
        : params.column
      : "");

  return (
    <div
      className={`group relative flex items-start gap-2 px-3 py-2 cursor-pointer select-none transition-colors ${
        isActive
          ? "bg-[#EFF6FF] border-l-2 border-[#2B7FFF]"
          : "hover:bg-gray-50 border-l-2 border-transparent"
      }`}
      onClick={() => !editing && onJump(index)}
    >
      {/* Step number */}
      <span className="mt-0.5 text-[10px] text-gray-400 w-4 shrink-0 text-right">
        {index + 1}
      </span>

      {/* Icon */}
      <span className="mt-0.5 text-sm shrink-0">{icon}</span>

      {/* Name + detail */}
      <div className="flex-1 min-w-0">
        {editing ? (
          <input
            ref={inputRef}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={commitRename}
            onKeyDown={(e) => {
              if (e.key === "Enter") commitRename();
              if (e.key === "Escape") setEditing(false);
            }}
            className="w-full text-sm font-medium text-[#101828] bg-white border border-[#2B7FFF] rounded px-1 outline-none"
          />
        ) : (
          <p
            className={`text-sm font-medium truncate ${
              isActive ? "text-[#2B7FFF]" : "text-[#101828]"
            }`}
            onDoubleClick={() => {
              setDraft(label);
              setEditing(true);
            }}
            title="Double-click to rename"
          >
            {label}
          </p>
        )}
        {detail && (
          <p className="text-[10px] text-gray-400 truncate mt-0.5">{detail}</p>
        )}
        {step.timestamp && (
          <p className="text-[10px] text-gray-300 mt-0.5">
            {formatTimestamp(step.timestamp)}
          </p>
        )}
      </div>

      {/* Actions — visible on hover */}
      {step.type !== "source" && step.type !== "Source" && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            onDelete(index);
          }}
          className="mt-0.5 opacity-0 group-hover:opacity-100 text-gray-400 hover:text-red-500 transition-opacity text-xs shrink-0 px-1"
          title="Delete step"
        >
          ×
        </button>
      )}
    </div>
  );
};

/**
 * Power BI–style Applied Steps panel.
 *
 * Props:
 *   steps           – array of { id, name, type, timestamp, description, params }
 *   currentStepIndex
 *   onJump(index)   – navigate to that step (triggers backend replay if needed)
 *   onDeleteStep(index)
 *   onRenameStep(index, newName)
 *   onUndo / onRedo – keyboard-style undo/redo
 *   onResetAll
 */
const AppliedStepsPanel = ({
  steps = [],
  currentStepIndex,
  onUndo,
  onRedo,
  onJump,
  onDeleteStep,
  onRenameStep,
  onResetAll,
}) => {
  const listRef = useRef(null);
  const canUndo = currentStepIndex > 0;
  const canRedo = currentStepIndex < steps.length - 1;

  // Auto-scroll to the active step
  useEffect(() => {
    const active = listRef.current?.querySelector("[data-active='true']");
    active?.scrollIntoView({ block: "nearest" });
  }, [currentStepIndex]);

  return (
    <div className="h-full w-14 lg:w-[260px] bg-white border-l border-gray-200 flex flex-col">
      {/* Header */}
      <div className="px-3 py-3 border-b border-gray-100 shrink-0">
        <div className="hidden lg:flex items-center justify-between mb-2">
          <span className="text-xs font-semibold uppercase tracking-wider text-gray-500">
            Applied Steps
          </span>
          <span className="text-[10px] text-gray-400 bg-gray-100 px-1.5 py-0.5 rounded-full">
            {steps.length}
          </span>
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={onUndo}
            disabled={!canUndo}
            title="Undo"
            className="flex-1 py-1 text-xs bg-gray-50 border border-gray-200 rounded hover:bg-gray-100 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            ⟲
          </button>
          <button
            onClick={onRedo}
            disabled={!canRedo}
            title="Redo"
            className="flex-1 py-1 text-xs bg-gray-50 border border-gray-200 rounded hover:bg-gray-100 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            ⟳
          </button>
        </div>
      </div>

      {/* Step list */}
      <div ref={listRef} className="flex-1 overflow-y-auto py-1">
        {steps.length === 0 ? (
          <p className="hidden lg:block text-[11px] text-gray-400 px-4 py-3">
            No steps yet. Start editing to record changes.
          </p>
        ) : (
          steps.map((step, index) => (
            <div key={step.id ?? index} data-active={index === currentStepIndex}>
              <StepRow
                step={step}
                index={index}
                isActive={index === currentStepIndex}
                onJump={onJump}
                onDelete={onDeleteStep}
                onRename={onRenameStep ?? (() => {})}
              />
            </div>
          ))
        )}
      </div>

      {/* Footer */}
      <div className="px-3 py-2 border-t border-gray-100 shrink-0">
        <button
          onClick={onResetAll}
          className="hidden lg:block w-full px-2 py-1.5 text-[11px] text-gray-500 bg-gray-50 border border-gray-200 rounded hover:bg-gray-100 hover:text-red-500 transition-colors"
        >
          Reset All Steps
        </button>
      </div>
    </div>
  );
};

export default AppliedStepsPanel;
