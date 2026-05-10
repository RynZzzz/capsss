// frontend-jsx/src/components/ValueDetailsModal.jsx

import React, { useState, useEffect } from "react";
import { X, Edit2, Save, XCircle } from "lucide-react";
import { invalidateLogs } from "../../../cache/sessionCache";

export const ValueDetailsModal = ({
  isOpen,
  onClose,
  type, // 'unique', 'missing', 'outliers', 'type_errors', 'summary'
  columnName,
  sessionId,
  ApiService,
  onValueUpdated,
  onSaveCell,
}) => {
  const [values, setValues] = useState([]);
  const [isLoading, setIsLoading] = useState(false);
  const [editingCell, setEditingCell] = useState(null);
  const [editValue, setEditValue] = useState("");
  const [editOldValue, setEditOldValue] = useState(null);
  const [page, setPage] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [total, setTotal] = useState(0);
  const [columnDetails, setColumnDetails] = useState(null);
  const limit = 50;

  useEffect(() => {
    if (isOpen && sessionId && columnName) {
      if (type === "summary") {
        loadSummary();
      } else {
        loadValues();
      }
    }
  }, [isOpen, sessionId, columnName, type, page]);

  const loadValues = async () => {
    setIsLoading(true);
    try {
      let response;
      const offset = page * limit;

      if (type === "unique") {
        // Get all unique values with their counts
        response = await ApiService.getColumnValues(sessionId, columnName, {
          limit,
          offset,
        });
        setValues(response.value_counts || []);
        setTotal(response.total_unique || 0);
        setHasMore(response.has_more || false);
      } else if (type === "missing") {
        // Get rows with missing values
        response = await ApiService.getColumnValues(sessionId, columnName, {
          issue_type: "missing",
          limit,
          offset,
        });
        setValues(response.values || []);
        setTotal(response.total || 0);
        setHasMore(response.has_more || false);
      } else if (type === "outliers") {
        // Get outlier values
        response = await ApiService.getColumnValues(sessionId, columnName, {
          issue_type: "outlier",
          limit,
          offset,
        });
        setValues(response.values || []);
        setTotal(response.total || 0);
        setHasMore(response.has_more || false);
      } else if (type === "type_errors") {
        // Get type inconsistency values
        response = await ApiService.getColumnValues(sessionId, columnName, {
          issue_type: "type_inconsistency",
          limit,
          offset,
        });
        setValues(response.values || []);
        setTotal(response.total || 0);
        setHasMore(response.has_more || false);
      }
    } catch (error) {
      console.error("Failed to load values:", error);
    } finally {
      setIsLoading(false);
    }
  };

  const loadSummary = async () => {
    setIsLoading(true);
    try {
      const response = await ApiService.getColumnDetails(sessionId, columnName);
      const stats = response?.column_stats || response || null;
      setColumnDetails(stats);
      setTotal(
        (stats?.total_count !== undefined && Number(stats.total_count)) || 0,
      );
      setHasMore(false);
    } catch (error) {
      console.error("Failed to load column details:", error);
    } finally {
      setIsLoading(false);
    }
  };

  const handleEdit = (index, value) => {
    setEditingCell(index);
    setEditOldValue(value?.value ?? null);
    setEditValue(value?.value ?? "");
  };

  const handleSave = async (rowIndex) => {
    try {
      if (onSaveCell) {
        await onSaveCell({
          rowIndex,
          columnName,
          oldValue: editOldValue,
          newValue: editValue,
        });
      } else {
        await ApiService.updateCell(sessionId, rowIndex, columnName, editValue);
        const user = localStorage.getItem("user_name") || "Guest";
        invalidateLogs(sessionId);
        ApiService.addPreprocessingLog(sessionId, [
          {
            column_name: columnName,
            operation: "cell_update",
            parameters: { row_index: rowIndex, new_value: editValue },
            confidence: null,
            risk_level: "low",
            original_issue: null,
            reason: `Row ${rowIndex} edited manually`,
            user,
          },
        ]).catch(() => null);
      }
      setEditingCell(null);
      loadValues();
      if (onValueUpdated) onValueUpdated();
    } catch (error) {
      console.error("Failed to update cell:", error);
      alert("Failed to update value");
    }
  };

  const handleCancel = () => {
    setEditingCell(null);
    setEditValue("");
    setEditOldValue(null);
  };

  const getTitleInfo = () => {
    switch (type) {
      case "summary":
        return {
          title: "Column Summary",
          icon: "🧮",
          color: "text-[#2B7FFF]",
        };
      case "unique":
        return { title: "Unique Values", icon: "🔢", color: "text-[#00D3F2]" };
      case "missing":
        return { title: "Missing Values", icon: "❌", color: "text-[#FF6467]" };
      case "outliers":
        return { title: "Outliers", icon: "📊", color: "text-[#F0B000]" };
      case "type_errors":
        return { title: "Type Errors", icon: "⚠️", color: "text-[#C27AFF]" };
      default:
        return { title: "Values", icon: "📋", color: "text-gray-600" };
    }
  };

  if (!isOpen) return null;

  const { title, icon, color } = getTitleInfo();

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-4xl max-h-[80vh] flex flex-col">
        {/* Header */}
        <div className="px-6 py-4 border-b border-gray-200 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <span className="text-2xl">{icon}</span>
            <div>
              <h2 className={`text-xl font-bold ${color}`}>{title}</h2>
              <p className="text-sm text-gray-600">
                Column: <span className="font-medium">{columnName}</span> •{" "}
                {total.toLocaleString()} total
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
          >
            <X className="w-5 h-5 text-gray-600" />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6">
          {isLoading ? (
            <div className="flex items-center justify-center py-12">
              <div className="animate-spin w-8 h-8 border-4 border-[#2B7FFF] border-t-transparent rounded-full"></div>
            </div>
          ) : type === "summary" ? (
            <div className="space-y-6">
              {!columnDetails ? (
                <div className="text-center py-12 text-gray-500">
                  No details available
                </div>
              ) : (
                <>
                  <div className="grid grid-cols-4 gap-4">
                    <div className="p-4 bg-[#F9FAFB] rounded-2xl border border-gray-200">
                      <p className="text-sm text-[#4A5565] mb-2">Missing</p>
                      <p className="text-2xl text-[#FF6467] font-bold">
                        {columnDetails.missing_count?.toLocaleString?.() ??
                          columnDetails.missing_count ??
                          "-"}
                      </p>
                    </div>
                    <div className="p-4 bg-[#F9FAFB] rounded-2xl border border-gray-200">
                      <p className="text-sm text-[#4A5565] mb-2">Outliers</p>
                      <p className="text-2xl text-[#F0B000] font-bold">
                        {columnDetails.outlier_count?.toLocaleString?.() ??
                          columnDetails.outlier_count ??
                          "-"}
                      </p>
                    </div>
                    <div className="p-4 bg-[#F9FAFB] rounded-2xl border border-gray-200">
                      <p className="text-sm text-[#4A5565] mb-2">Unique</p>
                      <p className="text-2xl text-[#00D3F2] font-bold">
                        {columnDetails.unique_count?.toLocaleString?.() ??
                          columnDetails.unique_count ??
                          "-"}
                      </p>
                    </div>
                    <div className="p-4 bg-[#F9FAFB] rounded-2xl border border-gray-200">
                      <p className="text-sm text-[#4A5565] mb-2">
                        Completeness
                      </p>
                      <p className="text-2xl text-[#05DF72] font-bold">
                        {columnDetails.completeness?.toFixed?.(1) ??
                          (columnDetails.non_null_count &&
                          columnDetails.total_count
                            ? (
                                (columnDetails.non_null_count /
                                  columnDetails.total_count) *
                                100
                              ).toFixed(1)
                            : "-")}
                        {typeof columnDetails.completeness !== "undefined"
                          ? "%"
                          : ""}
                      </p>
                    </div>
                  </div>
                  {(columnDetails.type === "Integer" ||
                    columnDetails.type === "Decimal") && (
                    <div className="grid grid-cols-4 gap-4">
                      <div className="p-4 bg-[#D1D5DC] rounded-2xl">
                        <p className="text-sm text-[#4A5565] mb-2">Min</p>
                        <p className="text-xl text-[#797979] font-bold">
                          {(
                            columnDetails.min ?? columnDetails.min_value
                          )?.toFixed?.(2) ??
                            columnDetails.min ??
                            columnDetails.min_value ??
                            "-"}
                        </p>
                      </div>
                      <div className="p-4 bg-[#D1D5DC] rounded-2xl">
                        <p className="text-sm text-[#4A5565] mb-2">Max</p>
                        <p className="text-xl text-[#7C7C7C] font-bold">
                          {(
                            columnDetails.max ?? columnDetails.max_value
                          )?.toFixed?.(2) ??
                            columnDetails.max ??
                            columnDetails.max_value ??
                            "-"}
                        </p>
                      </div>
                      <div className="p-4 bg-[#D1D5DC] rounded-2xl">
                        <p className="text-sm text-[#4A5565] mb-2">Mean</p>
                        <p className="text-xl text-[#78737D] font-bold">
                          {columnDetails.mean?.toFixed?.(2) ??
                            columnDetails.mean ??
                            "-"}
                        </p>
                      </div>
                      <div className="p-4 bg-[#D1D5DC] rounded-2xl">
                        <p className="text-sm text-[#4A5565] mb-2">Median</p>
                        <p className="text-xl text-[#696969] font-bold">
                          {columnDetails.median?.toFixed?.(2) ??
                            columnDetails.median ??
                            "-"}
                        </p>
                      </div>
                    </div>
                  )}
                </>
              )}
            </div>
          ) : values.length === 0 ? (
            <div className="text-center py-12 text-gray-500">
              No {title.toLowerCase()} found
            </div>
          ) : (
            <div className="space-y-2">
              {type === "unique"
                ? values.map((item, idx) => (
                    <div
                      key={idx}
                      className="p-4 bg-gray-50 rounded-lg border border-gray-200 hover:bg-gray-100 transition-colors"
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex-1">
                          <span className="font-mono text-sm">
                            {String(item.value)}
                          </span>
                        </div>
                        <div className="flex items-center gap-4">
                          <span className="text-sm text-gray-600">
                            {(item.count ?? 0).toLocaleString()} occurrences (
                            {item.percentage ?? 0}%)
                          </span>
                        </div>
                      </div>
                    </div>
                  ))
                : values.map((item, idx) => (
                    <div
                      key={idx}
                      className="p-4 bg-gray-50 rounded-lg border border-gray-200 hover:bg-gray-100 transition-colors"
                    >
                      <div className="flex items-center justify-between gap-4">
                        <div className="flex items-center gap-3 flex-1">
                          <span className="text-xs text-gray-500 font-mono w-16">
                            Row {(item.index != null ? item.index : idx) + 1}
                          </span>
                          {editingCell === item.index ? (
                            <input
                              type="text"
                              value={editValue}
                              onChange={(e) => setEditValue(e.target.value)}
                              className="flex-1 px-3 py-2 border-2 border-[#2B7FFF] rounded-lg focus:outline-none"
                              autoFocus
                              onKeyDown={(e) => {
                                if (e.key === "Enter") handleSave(item.index);
                                if (e.key === "Escape") handleCancel();
                              }}
                            />
                          ) : (
                            <span className="flex-1 font-mono text-sm">
                              {item.value === null ||
                              item.value === undefined ? (
                                <span className="text-red-500 italic">
                                  null
                                </span>
                              ) : (
                                String(item.display_value || item.value)
                              )}
                            </span>
                          )}
                        </div>
                        <div className="flex items-center gap-2">
                          {item.issues && item.issues.length > 0 && (
                            <div className="flex gap-1">
                              {item.issues.map((issue, issueIdx) => (
                                <span
                                  key={issueIdx}
                                  className={`text-xs px-2 py-1 rounded ${
                                    issue.type === "missing"
                                      ? "bg-red-100 text-red-600"
                                      : issue.type === "outlier"
                                        ? "bg-yellow-100 text-yellow-600"
                                        : "bg-purple-100 text-purple-600"
                                  }`}
                                >
                                  {issue.type}
                                </span>
                              ))}
                            </div>
                          )}
                          {editingCell === item.index ? (
                            <>
                              <button
                                onClick={() => handleSave(item.index)}
                                className="p-2 bg-green-500 text-white rounded-lg hover:bg-green-600 transition-colors"
                              >
                                <Save className="w-4 h-4" />
                              </button>
                              <button
                                onClick={handleCancel}
                                className="p-2 bg-gray-300 text-gray-700 rounded-lg hover:bg-gray-400 transition-colors"
                              >
                                <XCircle className="w-4 h-4" />
                              </button>
                            </>
                          ) : (
                            <button
                              onClick={() => handleEdit(item.index, item)}
                              className="p-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 transition-colors"
                            >
                              <Edit2 className="w-4 h-4" />
                            </button>
                          )}
                        </div>
                      </div>
                    </div>
                  ))}
            </div>
          )}
        </div>

        {/* Footer with Pagination */}
        {type !== "summary" && (
          <div className="px-6 py-4 border-t border-gray-200 flex items-center justify-between">
            <div className="text-sm text-gray-600">
              Showing {page * limit + 1}-{Math.min((page + 1) * limit, total)}{" "}
              of {total.toLocaleString()}
            </div>
            <div className="flex gap-2">
              <button
                onClick={() => setPage((p) => Math.max(0, p - 1))}
                disabled={page === 0}
                className={`px-4 py-2 rounded-lg ${
                  page === 0
                    ? "bg-gray-100 text-gray-400 cursor-not-allowed"
                    : "bg-[#2B7FFF] text-white hover:bg-[#1A66FF]"
                }`}
              >
                Previous
              </button>
              <button
                onClick={() => setPage((p) => p + 1)}
                disabled={!hasMore}
                className={`px-4 py-2 rounded-lg ${
                  !hasMore
                    ? "bg-gray-100 text-gray-400 cursor-not-allowed"
                    : "bg-[#2B7FFF] text-white hover:bg-[#1A66FF]"
                }`}
              >
                Next
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
