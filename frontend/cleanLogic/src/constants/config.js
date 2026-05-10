export const API_BASE_URL =
  import.meta.env.VITE_API_BASE_URL || "";

export const ACCEPTED_FILE_TYPES = ".csv,.xlsx,.xls,.json,.txt,.sql";

export const FILE_TYPE_ICONS = {
  csv: "📊",
  excel: "📗",
  json: "📋",
  text: "📄",
  sql: "🗄️",
};
