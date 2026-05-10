import React, { useState } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import {
  Upload, Grid, FileText, BarChart3, Download, User, Brain, Menu, X,
} from "lucide-react";

const NAV_ITEMS = [
  { name: "Upload",    icon: Upload,   path: "/upload" },
  { name: "Profiling", icon: Grid,     path: "/profiling" },
  { name: "Log",       icon: FileText, path: "/log" },
  { name: "Visualize", icon: BarChart3,path: "/visualize" },
  { name: "ML Model",  icon: Brain,    path: "/ml" },
  { name: "Export",    icon: Download, path: "/export" },
];

export default function AppHeader({ onLogout, extra }) {
  const navigate  = useNavigate();
  const location  = useLocation();
  const [mobileOpen, setMobileOpen] = useState(false);

  const displayName = (() => {
    const stored = localStorage.getItem("user_name");
    return !stored || stored === "undefined" || stored === "null" ? "Guest" : stored;
  })();

  const handleNav = (path) => {
    navigate(path);
    setMobileOpen(false);
  };

  return (
    <>
      <header className="fixed top-0 left-0 right-0 bg-white border-b border-gray-200 z-20">
        <div className="flex items-center justify-between px-4 sm:px-6 lg:px-[100px] h-[64px] lg:h-[110px] pt-0 lg:pt-[50px] lg:pb-5">

          {/* Logo */}
          <div className="flex items-center gap-2">
            <div className="flex items-center gap-1.5">
              <div className="flex flex-col items-center gap-0.5">
                <div className="w-1.5 h-1.5 bg-[#2980FD] rounded-full" />
                <div className="w-2 h-6 lg:h-8 bg-gradient-to-b from-[#2B7FFF] to-[#00B8DB] rounded-full" />
              </div>
              <div className="flex flex-col items-center gap-0.5">
                <div className="w-1.5 h-1.5 bg-[#AE45FC] rounded-full" />
                <div className="w-1.5 h-5 lg:h-6 bg-gradient-to-b from-[#AD46FF] to-[#F6339A] rounded-full" />
              </div>
              <div className="flex flex-col items-center gap-0.5">
                <div className="w-1.5 h-1.5 bg-[#50A0FE] rounded-full" />
                <div className="w-2 h-7 lg:h-10 bg-gradient-to-b from-[#51A2FF] to-[#9810FA] rounded-full" />
              </div>
            </div>
            <h1 className="text-lg lg:text-2xl text-[#0F172A] leading-none">CleanLogic</h1>
          </div>

          {/* Desktop nav */}
          <nav className="hidden lg:flex items-center gap-2">
            {NAV_ITEMS.map((item) => {
              const active = location.pathname === item.path;
              return (
                <button
                  key={item.path}
                  onClick={() => navigate(item.path)}
                  className={`h-9 px-4 rounded-[10px] flex items-center gap-2 transition-colors ${
                    active
                      ? "bg-gradient-to-b from-[#2B7FFF] to-[#AD46FF] text-white"
                      : "bg-white text-[#4A5565] hover:bg-gray-50"
                  }`}
                >
                  <item.icon className="w-4 h-4" />
                  <span className="text-sm leading-5">{item.name}</span>
                </button>
              );
            })}
          </nav>

          {/* Desktop extra + user */}
          <div className="hidden lg:flex items-center gap-3">
            {extra && <div className="flex items-center gap-3">{extra}</div>}
            <div className="flex items-center gap-3 bg-white rounded-[10px] p-2">
              <div className="w-8 h-8 bg-gradient-to-r from-[#2B7FFF] to-[#9810FA] rounded-full flex items-center justify-center shadow-md">
                <User className="w-4 h-4 text-white" />
              </div>
              <div className="max-w-[140px]">
                <p className="text-sm font-medium text-[#101828] truncate">{displayName}</p>
              </div>
              {onLogout && (
                <button
                  type="button"
                  onClick={onLogout}
                  className="ml-1 text-xs text-[#4A5565] hover:text-[#EF4444]"
                >
                  Logout
                </button>
              )}
            </div>
          </div>

          {/* Mobile right — user avatar + hamburger */}
          <div className="flex lg:hidden items-center gap-2">
            {extra && <div className="flex items-center gap-2">{extra}</div>}
            <div className="w-8 h-8 bg-gradient-to-r from-[#2B7FFF] to-[#9810FA] rounded-full flex items-center justify-center shadow-md">
              <User className="w-4 h-4 text-white" />
            </div>
            <button
              onClick={() => setMobileOpen((o) => !o)}
              className="p-2 rounded-lg text-[#4A5565] hover:bg-gray-100"
              aria-label="Toggle navigation"
            >
              {mobileOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
            </button>
          </div>
        </div>
      </header>

      {/* Mobile dropdown nav */}
      {mobileOpen && (
        <div className="fixed top-[64px] left-0 right-0 bg-white border-b border-gray-200 z-10 shadow-lg lg:hidden">
          <div className="px-4 py-3 space-y-1">
            {NAV_ITEMS.map((item) => {
              const active = location.pathname === item.path;
              return (
                <button
                  key={item.path}
                  onClick={() => handleNav(item.path)}
                  className={`w-full flex items-center gap-3 px-4 py-2.5 rounded-xl text-sm transition-colors ${
                    active
                      ? "bg-gradient-to-r from-[#2B7FFF] to-[#AD46FF] text-white"
                      : "text-[#4A5565] hover:bg-gray-50"
                  }`}
                >
                  <item.icon className="w-4 h-4" />
                  <span>{item.name}</span>
                </button>
              );
            })}
            <div className="pt-2 pb-1 border-t border-gray-100 flex items-center justify-between px-4">
              <span className="text-sm text-[#4A5565] truncate">{displayName}</span>
              {onLogout && (
                <button onClick={onLogout} className="text-xs text-[#EF4444]">
                  Logout
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
