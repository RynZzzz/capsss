import { API_BASE_URL } from "../constants/config";

const mapImputeStrategy = (strategy) => {
  if (!strategy) return "mean";
  if (strategy === "remove_rows" || strategy === "omit") return "remove";
  if (strategy === "knn_impute") return "knn";
  return strategy;
};

const mapOutlierStrategy = (strategy) => {
  if (!strategy) {
    return { method: "iqr", action: "cap" };
  }
  const actionFromStrategy = (s) => {
    if (s.endsWith("_remove")) return "remove";
    if (s.endsWith("_ignore")) return "ignore";
    if (s.endsWith("_winsorize")) return "winsorize";
    return "cap";
  };
  if (strategy.startsWith("iqr_")) {
    return {
      method: "iqr",
      action: actionFromStrategy(strategy),
    };
  }
  if (strategy.startsWith("zscore_")) {
    return {
      method: "zscore",
      action: actionFromStrategy(strategy),
    };
  }
  if (strategy.startsWith("knn_")) {
    return {
      method: "isolation_forest",
      action: actionFromStrategy(strategy),
    };
  }
  return { method: "none", action: "ignore" };
};

// class ApiService {
//   async googleLogin(googleCredential) {
//     try {
//       const response = await fetch(`${API_BASE_URL}/auth/google`, {
//         method: "POST",
//         headers: {
//           "Content-Type": "application/json",
//         },
//         body: JSON.stringify({
//           token: googleCredential,
//         }),
//       });
//       if (!response.ok) {
//         const errorData = await response.json();
//         throw new Error(errorData.detail || "login failed");
//       }
//       const data = await response.json();

//       console.log("login successful, USER ID: ", data.user_id);
//       console.log("login successful, username: ", data.name);
//       console.log("your email address: ", data.email);
//       return data;
//     } catch (error) {
//       console.error("Auth Error:", error.message);
//       throw error;
//     }
//   }
//   async uploadFile(file) {
//     const formData = new FormData();
//     formData.append("file", file);

//     const response = await fetch(`${API_BASE_URL}/upload`, {
//       method: "POST",
//       body: formData,
//     });

//     if (!response.ok) {
//       throw new Error("Upload failed");
//     }

//     return response.json();
//   }

//   async saveData(data, columns, fileName, fileType) {
//     const response = await fetch(`${API_BASE_URL}/save`, {
//       method: "POST",
//       headers: { "Content-Type": "application/json" },
//       body: JSON.stringify({
//         data,
//         columns,
//         file_name: fileName,
//         file_type: fileType,
//       }),
//     });

//     if (!response.ok) {
//       throw new Error("Save failed");
//     }

//     return response.json();
//   }

//   async saveText(content, fileName) {
//     const response = await fetch(`${API_BASE_URL}/save-text`, {
//       method: "POST",
//       headers: { "Content-Type": "application/json" },
//       body: JSON.stringify({
//         content,
//         file_name: fileName,
//       }),
//     });

//     if (!response.ok) {
//       throw new Error("Save failed");
//     }

//     return response.json();
//   }
// }

// export default new ApiService();

// frontend/src/services/api.js

import axios from "axios";

// const API_BASE_URL = import.meta.env.VITE_API_URL || "http://localhost:8000";

const api = axios.create({
  baseURL: API_BASE_URL,
  headers: {
    "Content-Type": "application/json",
  },
});

const extractError = (err) => {
  const d = err?.response?.data;
  if (typeof d === "string") return d;
  return d?.detail || d?.message || err.message || "Request failed";
};

// export const dataProfilerAPI = {
//   // Upload and profile file
//   uploadFile: async (file) => {
//     const formData = new FormData();
//     formData.append("file", file);

//     const response = await api.post("/api/upload", formData, {
//       headers: { "Content-Type": "multipart/form-data" },
//     });

//     return response.data;
//   },

//   // Get current profile
//   getProfile: async (sessionId) => {
//     const response = await api.get(`/api/profile/${sessionId}`);
//     return response.data.profile;
//   },

//   // Get column details
//   getColumnDetails: async (sessionId, columnName) => {
//     const response = await api.get(
//       `/api/column/${sessionId}/${encodeURIComponent(columnName)}`,
//     );
//     return response.data.column_stats;
//   },

//   // Get column values with pagination
//   getColumnValues: async (sessionId, columnName, params = {}) => {
//     const queryParams = new URLSearchParams();
//     if (params.value_key) queryParams.append("value_key", params.value_key);
//     if (params.issue_type) queryParams.append("issue_type", params.issue_type);
//     if (params.limit) queryParams.append("limit", params.limit.toString());
//     if (params.offset) queryParams.append("offset", params.offset.toString());

//     const response = await api.get(
//       `/api/column/${sessionId}/${encodeURIComponent(columnName)}/values?${queryParams.toString()}`,
//     );
//     return response.data;
//   },

//   // Update single cell
//   updateCell: async (sessionId, rowIdx, colName, newValue) => {
//     const response = await api.put(`/api/cell/${sessionId}`, {
//       row_idx: rowIdx,
//       col_name: colName,
//       new_value: newValue,
//     });
//     return response.data;
//   },

//   // Batch update cells
//   batchUpdateCells: async (sessionId, updates) => {
//     const response = await api.put(`/api/cells/${sessionId}/batch`, {
//       updates,
//     });
//     return response.data;
//   },

//   // Update column type
//   updateColumnType: async (sessionId, colName, newType) => {
//     const response = await api.put(`/api/column/${sessionId}/type`, {
//       col_name: colName,
//       new_type: newType,
//     });
//     return response.data;
//   },

//   // Get changes log
//   getChangesLog: async (sessionId) => {
//     const response = await api.get(`/api/changes/${sessionId}`);
//     return response.data;
//   },

//   // Save changes
//   saveChanges: async (sessionId) => {
//     const response = await api.post(`/api/save/${sessionId}`);
//     return response.data;
//   },

//   // Reset changes
//   resetChanges: async (sessionId) => {
//     const response = await api.post(`/api/reset/${sessionId}`);
//     return response.data;
//   },

//   // Delete session
//   deleteSession: async (sessionId) => {
//     const response = await api.delete(`/api/session/${sessionId}`);
//     return response.data;
//   },

//   // Export data
//   exportData: async (sessionId, format = "xlsx") => {
//     const response = await api.get(`/api/export/${sessionId}?format=${format}`);
//     return response.data;
//   },
// };

class ApiService {
  async googleLogin(googleCredential) {
    try {
      const response = await api.post("/api/google", {
        token: googleCredential,
      });
      const data = response.data;
      console.log("login successful, USER ID: ", data.user_id);
      console.log("login successful, username: ", data.name);
      console.log("your email address: ", data.email);
      return data;
    } catch (error) {
      console.error("Auth Error:", error.message);
      throw error;
    }
  }

  async registerEmail(username, email, password) {
    const response = await api.post("/api/register", { username, email, password });
    return response.data;
  }

  async loginEmail(email, password) {
    const response = await api.post("/api/login/email", { email, password });
    return response.data;
  }
  // Upload and profile file
  async uploadFile(file) {
    const formData = new FormData();
    formData.append("file", file);
    const userId =
      localStorage.getItem("user_id") || localStorage.getItem("userId") || 1;

    // upload route lives at root (/upload)
    const response = await api.post(`/upload?user_id=${userId}`, formData, {
      headers: { "Content-Type": "multipart/form-data" },
    });

    return response.data;
  }

  async getProfileStatus(sessionId) {
    const response = await api.get(`/api/profile-status/${sessionId}`);
    return response.data;
  }

  async listFiles(userId) {
    const resolvedUserId =
      userId ||
      localStorage.getItem("user_id") ||
      localStorage.getItem("userId") ||
      1;
    const response = await api.get(`/files?user_id=${resolvedUserId}`);
    return response.data;
  }

  async deleteFile(fileId) {
    const response = await api.delete(`/file/${fileId}`);
    return response.data;
  }

  async deleteAllFiles(userId) {
    const resolvedUserId =
      userId ||
      localStorage.getItem("user_id") ||
      localStorage.getItem("userId") ||
      1;
    const response = await api.delete(`/files?user_id=${resolvedUserId}`);
    return response.data;
  }

  // Get current profile
  async getProfile(sessionId, rows = 50) {
    // backend profiling routes are mounted under /api
    const response = await api.get(`/api/profile/${sessionId}?rows=${rows}`);
    return response.data.profile;
  }

  // Get column details
  async getColumnDetails(sessionId, columnName) {
    try {
      const response = await api.get(
        `/api/column/${sessionId}/${encodeURIComponent(columnName)}`,
      );
      return response.data.column_stats;
    } catch (e) {
      if (e?.response?.status === 404) return null;
      throw e;
    }
  }

  // Get column values with pagination
  async getColumnValues(sessionId, columnName, params = {}) {
    const queryParams = new URLSearchParams();
    if (params.value_key) queryParams.append("value_key", params.value_key);
    if (params.issue_type) queryParams.append("issue_type", params.issue_type);
    if (params.limit) queryParams.append("limit", params.limit.toString());
    if (params.offset) queryParams.append("offset", params.offset.toString());

    const response = await api.get(
      `/api/column/${sessionId}/${encodeURIComponent(columnName)}/values?${queryParams.toString()}`,
    );
    return response.data;
  }

  async getPreviewRows(sessionId, params = {}) {
    const queryParams = new URLSearchParams();
    if (params.limit) queryParams.append("limit", params.limit.toString());
    if (params.offset) queryParams.append("offset", params.offset.toString());
    if (params.search) queryParams.append("search", params.search);
    if (params.errors_only) queryParams.append("errors_only", "true");
    if (params.filter_type) queryParams.append("filter_type", params.filter_type);

    const response = await api.get(
      `/api/preview/${sessionId}?${queryParams.toString()}`,
    );
    return response.data;
  }

  // Update single cell
  async updateCell(sessionId, rowIdx, colName, newValue) {
    const response = await api.put(`/api/cell/${sessionId}`, {
      row_idx: rowIdx,
      col_name: colName,
      new_value: newValue,
    });
    return response.data;
  }

  // Batch update cells
  async batchUpdateCells(sessionId, updates) {
    const response = await api.put(`/api/cells/${sessionId}/batch`, {
      updates,
    });
    return response.data;
  }

  // Update column type
  async updateColumnType(sessionId, colName, newType) {
    const response = await api.put(`/api/column/${sessionId}/type`, {
      col_name: colName,
      new_type: newType,
    });
    return response.data;
  }

  // Get changes log
  async getChangesLog(sessionId) {
    const response = await api.get(`/api/changes/${sessionId}`);
    return response.data;
  }

  // Save changes
  async saveChanges(sessionId) {
    const response = await api.post(`/api/project/${sessionId}/save`);
    return response.data;
  }

  // Reset changes
  async resetChanges(sessionId) {
    const response = await api.post(`/api/reset/${sessionId}`);
    return response.data;
  }

  // Delete session
  async deleteSession(sessionId) {
    const response = await api.delete(`/api/session/${sessionId}`);
    return response.data;
  }

  // Export cleaned dataset as file download
  async exportData(sessionId, format = "xlsx") {
    const response = await api.get(`/export/${sessionId}?format=${format}`, {
      responseType: "blob",
    });
    return response;
  }

  // ── Cleaning: missing value imputation ─────────────────────────────────────

  async imputeColumn(sessionId, params) {
    const mapped = mapImputeStrategy(params.strategy);
    const payload = {
      session_id: sessionId,
      missing_value_config: {
        method: mapped,
        columns: params.column ? [params.column] : [],
        constant_value:
          Object.prototype.hasOwnProperty.call(params, "constant_value") &&
          params.constant_value !== undefined
            ? params.constant_value
            : null,
        knn_neighbors:
          Object.prototype.hasOwnProperty.call(params, "knn_neighbors") &&
          params.knn_neighbors !== undefined
            ? params.knn_neighbors
            : 5,
      },
    };
    try {
      const response = await api.post("/api/cleaning/apply", payload);
      return response.data;
    } catch (e) {
      throw new Error(extractError(e));
    }
  }

  async batchImpute(sessionId, operations) {
    if (!operations || operations.length === 0) {
      return { success: false, message: "No imputation operations provided" };
    }
    const first = operations[0];
    const mapped = mapImputeStrategy(first.strategy);
    const columns = operations.map((op) => op.column).filter(Boolean);

    const payload = {
      session_id: sessionId,
      missing_value_config: {
        method: mapped,
        columns,
        constant_value:
          Object.prototype.hasOwnProperty.call(first, "constant_value") &&
          first.constant_value !== undefined
            ? first.constant_value
            : null,
        knn_neighbors:
          Object.prototype.hasOwnProperty.call(first, "knn_neighbors") &&
          first.knn_neighbors !== undefined
            ? first.knn_neighbors
            : 5,
      },
    };

    try {
      const response = await api.post("/api/cleaning/apply", payload);
      return response.data;
    } catch (e) {
      throw new Error(extractError(e));
    }
  }

  // ── Cleaning: duplicates ───────────────────────────────────────────────────

  async handleDuplicates(sessionId, params) {
    const actionMap = {
      remove_all: "remove_all",
      keep_first: "keep_first",
      keep_last: "keep_last",
      keep_all: "mark_only",
      mark: "mark_only",
    };

    const payload = {
      session_id: sessionId,
      duplicate_config: {
        action: actionMap[params.strategy] || "mark_only",
        subset_columns:
          params.columns && params.columns.length > 0 ? params.columns : null,
      },
    };

    try {
      const response = await api.post("/api/cleaning/apply", payload);
      return response.data;
    } catch (e) {
      throw new Error(extractError(e));
    }
  }

  // ── Cleaning: outliers ─────────────────────────────────────────────────────

  async handleOutliers(sessionId, params) {
    const { method, action } = mapOutlierStrategy(params.strategy);
    const payload = {
      session_id: sessionId,
      outlier_config: {
        method,
        action,
        columns: params.column ? [params.column] : [],
        iqr_multiplier:
          Object.prototype.hasOwnProperty.call(params, "iqr_multiplier") &&
          params.iqr_multiplier !== undefined
            ? params.iqr_multiplier
            : 1.5,
        zscore_threshold:
          Object.prototype.hasOwnProperty.call(params, "zscore_threshold") &&
          params.zscore_threshold !== undefined
            ? params.zscore_threshold
            : 3.0,
        contamination: 0.1,
      },
    };

    try {
      const response = await api.post("/api/cleaning/apply", payload);
      return response.data;
    } catch (e) {
      throw new Error(extractError(e));
    }
  }

  async batchOutliers(sessionId, operations) {
    if (!operations || operations.length === 0) {
      return { success: false, message: "No outlier operations provided" };
    }

    // For now we assume a single shared strategy across operations,
    // which matches how the Cleaning page constructs requests.
    const first = operations[0];
    const { method, action } = mapOutlierStrategy(first.strategy);
    const columns = operations.map((op) => op.column).filter(Boolean);

    const payload = {
      session_id: sessionId,
      outlier_config: {
        method,
        action,
        columns,
        iqr_multiplier:
          Object.prototype.hasOwnProperty.call(first, "iqr_multiplier") &&
          first.iqr_multiplier !== undefined
            ? first.iqr_multiplier
            : 1.5,
        zscore_threshold:
          Object.prototype.hasOwnProperty.call(first, "zscore_threshold") &&
          first.zscore_threshold !== undefined
            ? first.zscore_threshold
            : 3.0,
        contamination: 0.1,
      },
    };

    try {
      const response = await api.post("/api/cleaning/apply", payload);
      return response.data;
    } catch (e) {
      throw new Error(extractError(e));
    }
  }

  async handleTypeInconsistencies(sessionId, params = {}) {
    const payload = {
      session_id: sessionId,
      type_inconsistency_config: {
        method: params.method || "mode",
        columns: Array.isArray(params.columns) ? params.columns : [],
        numeric_only: Boolean(params.numeric_only),
        numeric_cleanup: Boolean(params.numeric_cleanup),
        text_cleanup: Boolean(params.text_cleanup),
        text_regex:
          Object.prototype.hasOwnProperty.call(params, "text_regex") &&
          params.text_regex !== undefined
            ? params.text_regex
            : null,
        text_replacement:
          Object.prototype.hasOwnProperty.call(params, "text_replacement") &&
          params.text_replacement !== undefined
            ? params.text_replacement
            : "",
      },
    };
    try {
      const response = await api.post("/api/cleaning/apply", payload);
      return response.data;
    } catch (e) {
      throw new Error(extractError(e));
    }
  }

  // ── Sessions ───────────────────────────────────────────────────────────────

  async getSession(sessionId) {
    const response = await api.get(`/api/sessions/${sessionId}`);
    return response.data;
  }

  async getSessionByFileId(fileId) {
    const response = await api.get(`/api/sessions/by-file/${fileId}`);
    return response.data;
  }

  async saveSessionSteps(sessionId, steps, fileId = null) {
    const payload = { steps };
    if (fileId != null) payload.file_id = fileId;
    const userId = localStorage.getItem("user_id");
    if (userId) payload.user_id = userId;
    const response = await api.post(
      `/api/sessions/${sessionId}/steps`,
      payload,
    );
    return response.data;
  }

  async saveRecipe(sessionId, steps, fileId = null) {
    return this.saveSessionSteps(sessionId, steps, fileId);
  }

  async getRecipe(sessionId) {
    const response = await api.get(`/api/sessions/${sessionId}`);
    const data = response.data;
    return { steps: data.applied_steps || [] };
  }

  async replaySession(sessionId, stepIndex) {
    const response = await api.post(`/api/sessions/${sessionId}/replay`, {
      step_index: stepIndex,
    });
    return response.data;
  }

  // ── Project: delta-based step dictionary ──────────────────────────────────

  async getProject(sessionId) {
    const response = await api.get(`/api/project/${sessionId}`);
    return response.data;
  }

  async addProjectStep(sessionId, step, fileId = null) {
    const userId = localStorage.getItem("user_id");
    const response = await api.post(`/api/project/${sessionId}/step`, {
      step,
      file_id: fileId,
      user_id: userId,
    });
    return response.data;
  }

  async deleteProjectStep(sessionId, stepIndex) {
    const response = await api.delete(
      `/api/project/${sessionId}/step/${stepIndex}`,
    );
    return response.data;
  }

  async clearProjectSteps(sessionId) {
    const response = await api.delete(`/api/project/${sessionId}/steps`);
    return response.data;
  }

  async updateProjectStep(sessionId, stepIndex, step) {
    const response = await api.patch(
      `/api/project/${sessionId}/step/${stepIndex}`,
      { step },
    );
    return response.data;
  }

  async previewProjectStep(sessionId, stepIndex) {
    const response = await api.post(
      `/api/project/${sessionId}/preview-step/${stepIndex}`,
    );
    return response.data;
  }

  // ── Cleaning: steps/summary ────────────────────────────────────────────────

  async getCleaningSteps(sessionId) {
    // Currently we proxy to stats and return an empty steps list so
    // the UI has something structured to consume.
    const response = await api.get(`/api/cleaning/stats/${sessionId}`);
    return { steps: [], stats: response.data };
  }

  async saveVisualization(sessionId, params) {
    const response = await api.post(`/api/visualization/${sessionId}`, params);
    return response.data;
  }

  async deleteVisualization(vizId) {
    const response = await api.delete(`/api/visualization/${vizId}`);
    return response.data;
  }

  async listVisualizations(sessionId) {
    const response = await api.get(`/api/visualizations/${sessionId}`);
    return response.data;
  }

  getVisualizationImageUrl(vizId) {
    return `${API_BASE_URL}/api/visualization/${vizId}/image`;
  }

  async explainVisualization(payload) {
    const response = await api.post("/api/ai/visualize", payload);
    return response.data;
  }

  async getMergeCells(sessionId) {
    const response = await api.get(`/api/merge-cells/${sessionId}`);
    return response.data;
  }

  async suggestPreprocessing(sessionId) {
    const response = await api.post(`/api/ai/suggest-preprocessing?session_id=${sessionId}`);
    return response.data;
  }

  async recommendCleaning(payload) {
    const response = await api.post("/api/ai/recommend-cleaning", payload);
    return response.data;
  }

  // Preprocessing audit log
  async addPreprocessingLog(sessionId, logs) {
    const response = await api.post("/api/logs/preprocessing", { session_id: sessionId, logs });
    return response.data;
  }

  async getPreprocessingLogs(sessionId) {
    const response = await api.get(`/api/logs/preprocessing/${sessionId}`);
    return response.data;
  }

  async getVizInsights(sessionId) {
    const response = await api.post(`/api/visualization/ai-insights/${sessionId}`);
    return response.data;
  }

  async getChartRecommendations(sessionId) {
    const response = await api.post(`/api/ai/chart-recommendations?session_id=${sessionId}`);
    return response.data;
  }

  async clearChartRecommendations(sessionId) {
    const response = await api.delete(`/api/ai/chart-recommendations?session_id=${sessionId}`);
    return response.data;
  }

  async getChartInsight(sessionId, { chart_type, x_axis, y_axis, title }) {
    const response = await api.post(`/api/ai/chart-insight`, { session_id: sessionId, chart_type, x_axis, y_axis: y_axis || null, title: title || null });
    return response.data;
  }

  async getChartData(sessionId, { chart_type, x_axis, y_axis, aggregation, filter_column, filter_value }) {
    const response = await api.post(`/api/visualization/chart-data`, {
      session_id: sessionId,
      chart_type,
      x_axis: x_axis || null,
      y_axis: y_axis || null,
      aggregation: aggregation || "sum",
      filter_column: filter_column || null,
      filter_value: filter_value != null ? String(filter_value) : null,
    });
    return response.data;
  }

  // ── ML ─────────────────────────────────────────────────────────────────────

  async getMLSessionInfo(sessionId) {
    const response = await api.get(`/api/ml/session-info/${sessionId}`);
    return response.data;
  }

  async getMLCorrelation(sessionId) {
    const response = await api.get(`/api/ml/correlation/${sessionId}`);
    return response.data;
  }

  async trainMLModels(params) {
    const response = await api.post("/api/ml/train", params);
    return response.data;
  }

  async previewTransform(params) {
    const response = await api.post("/api/ml/preview-transform", params);
    return response.data;
  }

  async saveMLModel(params) {
    const response = await api.post("/api/ml/models/save", params);
    return response.data;
  }

  async listMLModels({ user_id, scope = "my", model_type, sort_by = "date" } = {}) {
    const userId = user_id || parseInt(localStorage.getItem("user_id") || localStorage.getItem("userId") || "1");
    const params = new URLSearchParams({ user_id: userId, scope, sort_by });
    if (model_type) params.append("model_type", model_type);
    const response = await api.get(`/api/ml/models?${params}`);
    return response.data;
  }

  async getMLModel(modelId) {
    const response = await api.get(`/api/ml/models/${modelId}`);
    return response.data;
  }

  async predictMLModel(modelId, payload) {
    const response = await api.post(`/api/ml/models/${modelId}/predict`, payload);
    return response.data;
  }

  async deleteMLModel(modelId) {
    const userId = parseInt(localStorage.getItem("user_id") || localStorage.getItem("userId") || "1");
    const response = await api.delete(`/api/ml/models/${modelId}?user_id=${userId}`);
    return response.data;
  }

  async predictMLModelCached(payload) {
    // payload: { session_id, model_type, feature_columns, target_column, input_data }
    const response = await api.post("/api/ml/predict-cached", payload);
    return response.data;
  }

  async predictMLModelFile(modelId, file) {
    const form = new FormData();
    form.append("file", file);
    const response = await api.post(`/api/ml/models/${modelId}/predict-file`, form, {
      headers: { "Content-Type": "multipart/form-data" },
    });
    return response.data;
  }

  async predictMLModelCachedFile({ session_id, model_type, feature_columns, target_column, file }) {
    const form = new FormData();
    form.append("session_id", session_id);
    form.append("model_type", model_type);
    form.append("feature_columns", JSON.stringify(feature_columns));
    form.append("target_column", target_column);
    form.append("file", file);
    const response = await api.post("/api/ml/predict-cached-file", form, {
      headers: { "Content-Type": "multipart/form-data" },
    });
    return response.data;
  }
}
export default new ApiService();
