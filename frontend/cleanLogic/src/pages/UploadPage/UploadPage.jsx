import React, { useState, useEffect, useMemo } from "react";
import {
  Upload,
  Grid,
  FileText,
  ShoppingCart,
  TrendingUp,
  BarChart3,
  ChevronDown,
  Trash2,
} from "lucide-react";
import { useNavigate } from "react-router-dom";
import { useDataProfiler } from "../../components/hooks/useDataProfiler";
import ApiService from "../../services/api";
import AppHeader from "../../components/common/AppHeader";

export default function CleanLogicUpload() {
  const navigate = useNavigate();
  const [isDragging, setIsDragging] = useState(false);
  const [selectedFile, setSelectedFile] = useState(null);

  const {
    filename,
    profile,
    sessionId,
    isLoading,
    uploadPhase,
    error,
    uploadFile,
    loadSession,
    batchImpute,
    refreshProfile,
  } = useDataProfiler();

  const uploadLabel =
    uploadPhase === "analyzing" ? "Analyzing data..." : "{uploadLabel}";
  const [recentProjects, setRecentProjects] = useState([]);
  const [projectsLoading, setProjectsLoading] = useState(false);
  const [projectsError, setProjectsError] = useState(null);
  const [deletingAll, setDeletingAll] = useState(false);
  const [deletingId, setDeletingId] = useState(null);
  // Merged-cell detection modal
  const [mergeModal, setMergeModal] = useState(null); // { ranges: string[], applyingOption: null|string }
  const [mergeApplying, setMergeApplying] = useState(false);
  const [sizeError, setSizeError] = useState(null);

  const MAX_FILE_BYTES = 50 * 1024 * 1024; // 50 MB

  useEffect(() => {
    console.log("State updated:", {
      filename,
      profile,
      sessionId,
      isLoading,
      error,
      uploadFile,
    });
  }, [filename, profile, sessionId, isLoading, error, uploadFile]);

  useEffect(() => {
    const loadProjects = async () => {
      setProjectsLoading(true);
      setProjectsError(null);
      try {
        const r = await ApiService.listFiles();
        setRecentProjects(r.files || []);
      } catch (e) {
        setProjectsError(e?.message || "Failed to load projects");
      } finally {
        setProjectsLoading(false);
      }
    };
    loadProjects();
  }, []);

  const handleMergeOption = async (option) => {
    if (mergeApplying) return;
    if (option === "skip") {
      setMergeModal(null);
      return;
    }
    setMergeApplying(true);
    try {
      const columns = Array.isArray(profile?.columns)
        ? profile.columns.map((c) => c.name)
        : [];
      if (columns.length > 0) {
        const strategy = option === "forward_fill" ? "forward_fill" : "constant";
        const ops = columns.map((col) => ({ column: col, strategy, constant_value: option === "fill_empty" ? "" : undefined }));
        await batchImpute(ops);
        await refreshProfile();
      }
    } catch {
      // ignore — proceed to profiling regardless
    } finally {
      setMergeApplying(false);
      setMergeModal(null);
    }
  };

  // Handle file selection
  const handleFileSelect = async (file) => {
    if (!file) return;
    setSizeError(null);

    if (file.size > MAX_FILE_BYTES) {
      setSizeError(
        `File is too large (${(file.size / 1024 / 1024).toFixed(1)} MB). Maximum allowed size is 50 MB.`
      );
      return;
    }

    const lowerName = file.name.toLowerCase();
    const duplicate = recentProjects.some((p) => {
      const nameMatch = (p.file_name || "").toLowerCase() === lowerName;
      const sizeMatch =
        typeof p.file_size === "number" ? p.file_size === file.size : false;
      return nameMatch || sizeMatch;
    });
    if (duplicate) {
      const ok = window.confirm(
        "A similar file already exists. Are you sure you want to upload another copy?",
      );
      if (!ok) return;
    }

    setSelectedFile(file);

    try {
      const uploadResult = await uploadFile(file);
      if (uploadResult?.has_merges && (uploadResult?.merged_cells?.length ?? 0) > 0) {
        setMergeModal({ ranges: uploadResult.merged_cells });
      }
    } catch (err) {
      console.error("Upload failed:", err);
      setSelectedFile(null);
    }
  };

  // Drag and drop handlers
  const handleDragOver = (e) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = (e) => {
    e.preventDefault();
    setIsDragging(false);
  };

  const handleDrop = (e) => {
    e.preventDefault();
    setIsDragging(false);

    const file = e.dataTransfer.files[0];
    if (file) {
      handleFileSelect(file);
    }
  };

  // File input change handler
  const handleFileInputChange = (e) => {
    const file = e.target.files[0];
    if (file) {
      handleFileSelect(file);
    }
  };

  // Continue button handler
  const handleContinue = () => {
    if (profile && sessionId) {
      navigate("/profiling");
    } else if (!selectedFile) {
      alert("Please select a file first.");
    } else if (isLoading) {
      alert("Please wait for the file to finish uploading.");
    }
  };

  const handleDeleteAll = async () => {
    if (deletingAll || recentProjects.length === 0) return;
    const ok = window.confirm("Delete all datasets? This cannot be undone.");
    if (!ok) return;
    setDeletingAll(true);
    try {
      await ApiService.deleteAllFiles();
      setRecentProjects([]);
    } catch (e) {
      setProjectsError(e?.message || "Failed to delete datasets");
    } finally {
      setDeletingAll(false);
    }
  };

  const handleDeleteProject = async (projectId) => {
    if (deletingId) return;
    const ok = window.confirm("Delete this dataset? This cannot be undone.");
    if (!ok) return;
    setDeletingId(projectId);
    try {
      await ApiService.deleteFile(projectId);
      setRecentProjects((items) => items.filter((p) => p.id !== projectId));
    } catch (e) {
      setProjectsError(e?.message || "Failed to delete dataset");
    } finally {
      setDeletingId(null);
    }
  };

  const hasData = Boolean(sessionId);

  const iconMap = useMemo(
    () => ({
      csv: {
        icon: FileText,
        color: "bg-[#00BC7D]",
        bg: "from-[#ECFDF5] to-[#F0FDF4]",
        border: "border-[#A4F3CF]/50",
        text: "text-[#006045]",
        iconColor: "text-[#00D492]",
      },
      xlsx: {
        icon: BarChart3,
        color: "bg-[#2B7FFF]",
        bg: "from-[#EFF6FF] to-[#EEF2FF]",
        border: "border-[#BEDAFF]/50",
        text: "text-[#193CB8]",
        iconColor: "text-[#51A2FF]",
      },
      xls: {
        icon: BarChart3,
        color: "bg-[#2B7FFF]",
        bg: "from-[#EFF6FF] to-[#EEF2FF]",
        border: "border-[#BEDAFF]/50",
        text: "text-[#193CB8]",
        iconColor: "text-[#51A2FF]",
      },
      json: {
        icon: ShoppingCart,
        color: "bg-[#FE9A00]",
        bg: "from-[#FFFBEB] to-[#FFF7ED]",
        border: "border-[#FDE585]/50",
        text: "text-[#973C00]",
        iconColor: "text-[#FFB900]",
      },
      default: {
        icon: TrendingUp,
        color: "bg-[#AD46FF]",
        bg: "from-[#FAF5FF] to-[#F5F3FF]",
        border: "border-[#E9D4FF]/50",
        text: "text-[#6E11B0]",
        iconColor: "text-[#C27AFF]",
      },
    }),
    [],
  );

  const handleProjectClick = async (project) => {
    if (!project?.session_id) return;
    try {
      await loadSession(project.session_id, project.file_name);
      navigate("/profiling");
    } catch (e) {
      console.error("Failed to load project:", e);
    }
  };

  const handleLogout = () => {
    localStorage.removeItem("user_id");
    localStorage.removeItem("isLoggedIn");
    localStorage.removeItem("user_name");
    localStorage.removeItem("user_email");
    navigate("/login");
  };

  return (
    <div className="w-full min-h-screen bg-white font-['Poppins']">
      {/* Header */}
      <AppHeader onLogout={handleLogout} />

      {/* Main Content */}
      <main className="pt-[80px] sm:pt-[90px] lg:pt-[130px] pb-[50px] px-4 sm:px-6 lg:px-[100px]">
        <div className="flex flex-col lg:flex-row gap-8">
          {/* Left Section - Upload */}
          <div className="flex-1 flex flex-col gap-6">
            {/* Upload Card */}
            <div className="bg-white p-6 rounded-2xl shadow-[0px_8px_10px_-6px_rgba(0,0,0,0.1),0px_20px_25px_-5px_rgba(0,0,0,0.1)] border border-gray-200">
              <div className="mb-6">
                <h2 className="text-2xl font-bold text-[#0F172A] leading-8">
                  Upload Your Dataset
                </h2>
                <p className="text-base text-[#6A7282] leading-6">
                  Drag and drop or browse to select your file
                </p>
              </div>

              {/* Drop Zone */}
              <div
                onDragOver={handleDragOver}
                onDragLeave={handleDragLeave}
                onDrop={handleDrop}
                className={`relative border-2 border-dashed rounded-[14px] p-12 text-center transition-all ${
                  isDragging
                    ? "border-[#2B7FFF] bg-[#2B7FFF]/5"
                    : "border-gray-300 bg-gray-50"
                } ${isLoading ? "opacity-50 pointer-events-none" : "hover:border-[#2B7FFF] hover:bg-[#2B7FFF]/5"}`}
              >
                <input
                  type="file"
                  id="file-upload"
                  className="hidden"
                  accept=".csv,.xlsx,.xls"
                  onChange={handleFileInputChange}
                  disabled={isLoading}
                />

                <label
                  htmlFor="file-upload"
                  className="cursor-pointer flex flex-col items-center gap-4"
                >
                  {/* Upload Icon */}
                  <div className="w-16 h-16 bg-gradient-to-br from-[#2B7FFF] to-[#AD46FF] rounded-full flex items-center justify-center shadow-lg">
                    <Upload className="w-8 h-8 text-white" />
                  </div>

                  {/* Upload Text */}
                  <div>
                    {selectedFile ? (
                      <>
                        <p className="text-lg font-semibold text-[#0F172A] mb-1">
                          {selectedFile.name}
                        </p>
                        <p className="text-sm text-[#6A7282]">
                          {(selectedFile.size / 1024 / 1024).toFixed(2)} MB
                        </p>
                        {isLoading && (
                          <p className="text-sm text-[#2B7FFF] mt-2">
                            {uploadLabel}
                          </p>
                        )}
                      </>
                    ) : (
                      <>
                        <p className="text-lg font-semibold text-[#0F172A] mb-1">
                          Click to upload or drag and drop
                        </p>
                        <p className="text-sm text-[#6A7282]">
                          CSV, XLSX, XLS (MAX. 50MB)
                        </p>
                      </>
                    )}
                  </div>

                  {/* Browse Button */}
                  {!selectedFile && (
                    <p className="mt-4 px-6 py- text-[#2B7FFF] font-medium ">
                      Browse Files
                    </p>
                  )}
                </label>

                {/* Loading Spinner */}
                {isLoading && (
                  <div className="absolute inset-0 flex items-center justify-center bg-white/80 rounded-[14px]">
                    <div className="animate-spin w-12 h-12 border-4 border-[#2B7FFF] border-t-transparent rounded-full"></div>
                  </div>
                )}
              </div>

              {/* Error Message */}
              {(sizeError || error) && (
                <div className="mt-4 p-4 bg-red-50 border border-red-200 rounded-[10px]">
                  <p className="text-sm text-red-600">{sizeError || error}</p>
                </div>
              )}

              {/* File Info */}
              {selectedFile && !isLoading && (
                <div className="mt-4 p-4 bg-green-50 border border-green-200 rounded-[10px]">
                  <p className="text-sm text-green-600">
                    ✓ File uploaded successfully! Click Continue to proceed.
                  </p>
                </div>
              )}
            </div>

            {/* Continue Button */}
            <button
              disabled={!selectedFile || isLoading}
              onClick={handleContinue}
              className={`w-full h-12 px-6 py-3 rounded-[14px] text-base leading-6 text-center transition-all duration-200 ${
                selectedFile && !isLoading
                  ? "bg-[#2B7FFF] text-white hover:bg-[#1A66FF] shadow-lg shadow-blue-100"
                  : "bg-[#E5E7EB] text-[#99A1AF] cursor-not-allowed"
              }`}
            >
              {isLoading ? "{uploadLabel}" : "Continue to Data Profiling"}
            </button>
          </div>

          {/* Right Section - Recent Projects */}
          <div className="w-full lg:w-[400px] lg:shrink-0 bg-white p-6 rounded-2xl shadow-[0px_8px_10px_-6px_rgba(0,0,0,0.1),0px_20px_25px_-5px_rgba(0,0,0,0.1)] border border-gray-200">
            {/* Header */}
            <div className="flex items-center justify-between gap-4 mb-6">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 bg-gradient-to-r from-[#8E51FF] to-[#9810FA] rounded-[14px] shadow-md flex items-center justify-center">
                  <Grid className="w-5 h-5 text-white" />
                </div>
                <div>
                  <h3 className="text-xl font-bold text-[#0F172A] leading-7">
                    Recent Projects
                  </h3>
                  <p className="text-sm text-[#6A7282] leading-5">
                    Your past data processing history
                  </p>
                </div>
              </div>
              <button
                onClick={handleDeleteAll}
                disabled={deletingAll || recentProjects.length === 0}
                className="px-4 py-2 text-sm text-white bg-[#EF4444] rounded-[10px] hover:bg-[#DC2626] disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {deletingAll ? "Deleting…" : "Delete all"}
              </button>
            </div>

            {/* Project List */}
            <div className="flex flex-col gap-3">
              {projectsLoading && (
                <div className="text-sm text-[#6A7282]">Loading projects…</div>
              )}
              {!projectsLoading && projectsError && (
                <div className="text-sm text-[#EF4444]">{projectsError}</div>
              )}
              {!projectsLoading &&
                !projectsError &&
                recentProjects.length === 0 && (
                  <div className="text-sm text-[#6A7282]">No projects yet</div>
                )}
              {recentProjects.map((project, index) => {
                const key = project.file_type?.toLowerCase?.() || "default";
                const theme = iconMap[key] || iconMap.default;
                const Icon = theme.icon;
                return (
                  <div
                    key={index}
                    onClick={() => handleProjectClick(project)}
                    className={`p-4 bg-gradient-to-br ${theme.bg} rounded-[14px] border ${theme.border} cursor-pointer hover:shadow-md transition-shadow`}
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <div
                          className={`w-10 h-10 ${theme.color} rounded-[14px] shadow-md flex items-center justify-center`}
                        >
                          <Icon className="w-5 h-5 text-white" />
                        </div>
                        <h4
                          className={`text-base font-bold ${theme.text} leading-6`}
                        >
                          {project.file_name}
                        </h4>
                      </div>
                      <div className="flex items-center gap-3">
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            handleDeleteProject(project.id);
                          }}
                          disabled={deletingId === project.id}
                          className="p-2 rounded-full bg-white/70 hover:bg-white text-[#EF4444] disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                        <ChevronDown
                          className={`w-5 h-5 ${theme.iconColor} rotate-[-90deg]`}
                        />
                      </div>
                    </div>
                    <div className="mt-2 text-xs text-[#6A7282] flex gap-2">
                      <span>{project.row_count ?? 0} rows</span>
                      <span>•</span>
                      <span>{project.column_count ?? 0} cols</span>
                      <span>•</span>
                      <span>
                        {new Date(project.created_at).toLocaleDateString()}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </main>

      {/* Merged cells detection modal */}
      {mergeModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
          <div className="bg-white rounded-3xl shadow-2xl w-full max-w-md mx-4 overflow-hidden">
            {/* Header */}
            <div className="px-6 pt-6 pb-4">
              <div className="flex items-center gap-3 mb-3">
                <div className="w-10 h-10 bg-amber-50 rounded-2xl flex items-center justify-center shrink-0">
                  <svg className="w-5 h-5 text-amber-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
                  </svg>
                </div>
                <div>
                  <h2 className="text-base font-semibold text-[#101828]">Merged Cells Detected</h2>
                  <p className="text-sm text-[#6A7282]">
                    {mergeModal.ranges.length} merged region{mergeModal.ranges.length !== 1 ? "s" : ""} found in this Excel file
                  </p>
                </div>
              </div>

              {/* Range list */}
              <div className="bg-[#F9FAFB] rounded-2xl px-4 py-3 max-h-32 overflow-y-auto mb-4">
                <p className="text-xs font-medium text-gray-400 uppercase tracking-wider mb-2">Affected ranges</p>
                <div className="flex flex-wrap gap-1.5">
                  {mergeModal.ranges.slice(0, 20).map((r) => (
                    <span key={r} className="text-xs font-mono bg-amber-50 text-amber-700 border border-amber-100 px-2 py-0.5 rounded-lg">
                      {r}
                    </span>
                  ))}
                  {mergeModal.ranges.length > 20 && (
                    <span className="text-xs text-gray-400">+{mergeModal.ranges.length - 20} more</span>
                  )}
                </div>
              </div>

              <p className="text-sm text-[#6A7282]">
                When Excel merges cells, only the first cell keeps its value — the rest become empty. Choose how to handle them:
              </p>
            </div>

            {/* Options */}
            <div className="px-6 pb-6 space-y-2">
              <button
                onClick={() => handleMergeOption("forward_fill")}
                disabled={mergeApplying}
                className="w-full flex items-start gap-3 p-4 rounded-2xl border-2 border-[#2B7FFF]/30 bg-[#2B7FFF]/5 hover:border-[#2B7FFF] hover:bg-[#2B7FFF]/10 transition-all text-left disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <span className="text-lg shrink-0">⬇️</span>
                <div>
                  <p className="text-sm font-semibold text-[#101828]">Forward Fill <span className="text-xs font-normal text-[#2B7FFF] ml-1">Recommended</span></p>
                  <p className="text-xs text-[#6A7282] mt-0.5">Propagate each merged value down into the empty cells below it</p>
                </div>
              </button>

              <button
                onClick={() => handleMergeOption("fill_empty")}
                disabled={mergeApplying}
                className="w-full flex items-start gap-3 p-4 rounded-2xl border-2 border-gray-100 hover:border-gray-300 bg-gray-50 hover:bg-gray-100 transition-all text-left disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <span className="text-lg shrink-0">␣</span>
                <div>
                  <p className="text-sm font-semibold text-[#101828]">Fill with Empty</p>
                  <p className="text-xs text-[#6A7282] mt-0.5">Explicitly set merged cells to blank (empty string)</p>
                </div>
              </button>

              <button
                onClick={() => handleMergeOption("skip")}
                disabled={mergeApplying}
                className="w-full flex items-center justify-center gap-2 py-3 rounded-2xl border border-gray-200 text-sm text-[#6A7282] hover:bg-gray-50 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {mergeApplying
                  ? <><div className="w-4 h-4 border-2 border-gray-400 border-t-transparent rounded-full animate-spin" /> Applying…</>
                  : "Skip — leave as-is"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
