import React from "react";
import HomePage from "./pages/UploadPage/UploadPage";
import LandingPage from "./pages/LandingPage/LandingPage";
import LoginPage from "./pages/LogIn/LoginPage";
import { DataProfilingPage } from "./pages/ProfilingPage/DataProfiling";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { DataEditorProvider } from "./components/hooks/useGlobalDataEditor";
import CleaningOperationsLog from "./pages/LogPage/CleaningOperationsLog";
import DataVisualizationDashboard from "./pages/VisualPage/VisualPage";
import MLPage from "./pages/MLPage/MLPage";
import ExportPage from "./pages/ExportPage/ExportPage";

function App() {
  return (
    <>
      <DataEditorProvider>
        <BrowserRouter>
          <Routes>
            <Route path="/" element={<LandingPage />} />
            <Route path="/login" element={<LoginPage />} />
            <Route path="/upload" element={<HomePage />} />
            <Route path="/profiling" element={<DataProfilingPage />} />
            <Route path="/log" element={<CleaningOperationsLog />} />
            <Route path="/visualize" element={<DataVisualizationDashboard />} />
            <Route path="/ml" element={<MLPage />} />
            <Route path="/export" element={<ExportPage />} />
          </Routes>
        </BrowserRouter>
      </DataEditorProvider>
    </>
  );
}

export default App;
