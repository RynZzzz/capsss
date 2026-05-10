import sparkleIcon from "../../assets/sparkle.svg";
import chartIcon from "../../assets/visualIcon.svg";
import brainIcon from "../../assets/brain.svg";
import reportIcon from "../../assets/reportIcon.svg";
import googleIcon from "../../assets/googleIcon.svg";
import { useEffect, useRef, useState } from "react";
import ApiServices from "../../services/api.js";
import { useNavigate } from "react-router-dom";

const GOOGLE_CLIENT_ID =
  import.meta.env.VITE_GOOGLE_CLIENT_ID ||
  "233100127711-4utctelrrev725pi1equqbm5pq9a8s1f.apps.googleusercontent.com";

const benefits = [
  {
    title: "AI-Powered Cleaning",
    description: "Automatic data quality & smart preprocessing",
    gradient: "linear-gradient(90deg, #00BC7D 0%, #00BBA7 100%)",
    icon: "sparkles",
  },
  {
    title: "Interactive Dashboards",
    description: "Real-time charts & intelligent insights",
    gradient: "linear-gradient(90deg, #AD46FF 0%, #F6339A 100%)",
    icon: "chart",
  },
  {
    title: "Advanced ML Studio",
    description: "Train & compare 8+ machine learning models",
    gradient: "linear-gradient(90deg, #2B7FFF 0%, #00B8DB 100%)",
    icon: "ml",
  },
  {
    title: "Smart Reports",
    description: "Automated insights & professional documentation",
    gradient: "linear-gradient(90deg, #FF6900 0%, #FE9A00 100%)",
    icon: "report",
  },
];

const iconMap = {
  sparkles: sparkleIcon,
  chart: chartIcon,
  ml: brainIcon,
  report: reportIcon,
};

function Logo() {
  return (
    <div className="flex justify-center items-center gap-4">
      <div className="flex items-center gap-1">
        <div className="w-1.5 h-6 bg-gradient-to-b from-[#2B7FFF] to-[#00B8DB] rounded-full" />
        <div className="w-1.5 h-5 bg-gradient-to-b from-[#AD46FF] to-[#F6339A] rounded-full" />
        <div className="w-2 h-7 bg-gradient-to-b from-[#51A2FF] to-[#9810FA] rounded-full" />
      </div>
      <h1 className="text-[#0F172A] text-[30px] font-poppins font-bold">
        CleanLogic
      </h1>
    </div>
  );
}

function InputField({
  label,
  type = "text",
  value,
  onChange,
  placeholder,
  error,
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <label className="text-[#374151] text-[14px] font-poppins font-semibold">
        {label}
      </label>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className={`w-full px-4 py-3 rounded-xl border text-[14px] font-poppins outline-none transition-all
          ${
            error
              ? "border-red-400 focus:border-red-500 bg-red-50"
              : "border-gray-200 focus:border-[#2B7FFF] bg-white focus:shadow-[0_0_0_3px_rgba(43,127,255,0.12)]"
          }`}
      />
      {error && (
        <p className="text-red-500 text-[12px] font-poppins">{error}</p>
      )}
    </div>
  );
}

export default function LoginPage({ onLogin }) {
  const navigate = useNavigate();
  const googleClientRef = useRef(null);
  const [mode, setMode] = useState("signin"); // "signin" | "signup"
  const [isLoading, setIsLoading] = useState(false);
  const [globalError, setGlobalError] = useState("");

  // Sign-in fields
  const [siEmail, setSiEmail] = useState("");
  const [siPassword, setSiPassword] = useState("");
  const [siErrors, setSiErrors] = useState({});

  // Sign-up fields
  const [suUsername, setSuUsername] = useState("");
  const [suEmail, setSuEmail] = useState("");
  const [suPassword, setSuPassword] = useState("");
  const [suConfirm, setSuConfirm] = useState("");
  const [suErrors, setSuErrors] = useState({});

  useEffect(() => {
    if (window.google && GOOGLE_CLIENT_ID) {
      googleClientRef.current = google.accounts.oauth2.initTokenClient({
        client_id: GOOGLE_CLIENT_ID,
        scope: "openid email profile",
        callback: async (response) => {
          if (response.access_token) {
            setIsLoading(true);
            setGlobalError("");
            try {
              const result = await ApiServices.googleLogin(
                response.access_token,
              );
              if (result && result.status === "success") {
                _storeAndRedirect(result);
              }
            } catch {
              setGlobalError("Google sign-in failed. Please try again.");
            } finally {
              setIsLoading(false);
            }
          }
        },
      });
    }
  }, []);

  function _storeAndRedirect(result) {
    localStorage.setItem("user_id", result.user_id);
    localStorage.setItem("isLoggedIn", "true");
    localStorage.setItem("user_name", result.user_name);
    localStorage.setItem("user_email", result.user_email);
    if (onLogin) onLogin();
    navigate("/upload");
  }

  function handleGoogleLogin() {
    if (googleClientRef.current) {
      setGlobalError("");
      googleClientRef.current.requestAccessToken();
    } else if (!GOOGLE_CLIENT_ID) {
      setGlobalError("Google sign-in is not configured yet.");
    } else {
      setGlobalError("Google sign-in is still loading. Please try again.");
    }
  }

  async function handleSignIn(e) {
    e.preventDefault();
    const errs = {};
    if (!siEmail) errs.email = "Email is required";
    if (!siPassword) errs.password = "Password is required";
    if (Object.keys(errs).length) {
      setSiErrors(errs);
      return;
    }

    setSiErrors({});
    setGlobalError("");
    setIsLoading(true);
    try {
      const result = await ApiServices.loginEmail(siEmail, siPassword);
      if (result && result.status === "success") _storeAndRedirect(result);
    } catch (err) {
      const msg = err?.response?.data?.detail || "Invalid email or password";
      setGlobalError(msg);
    } finally {
      setIsLoading(false);
    }
  }

  async function handleSignUp(e) {
    e.preventDefault();
    const errs = {};
    if (!suUsername.trim()) errs.username = "Username is required";
    if (!suEmail) errs.email = "Email is required";
    if (!suPassword) errs.password = "Password is required";
    else if (suPassword.length < 8) errs.password = "Minimum 8 characters";
    if (suConfirm !== suPassword) errs.confirm = "Passwords do not match";
    if (Object.keys(errs).length) {
      setSuErrors(errs);
      return;
    }

    setSuErrors({});
    setGlobalError("");
    setIsLoading(true);
    try {
      const result = await ApiServices.registerEmail(
        suUsername,
        suEmail,
        suPassword,
      );
      if (result && result.status === "success") _storeAndRedirect(result);
    } catch (err) {
      const msg =
        err?.response?.data?.detail || "Registration failed. Please try again.";
      setGlobalError(msg);
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-purple-50 flex items-center justify-center px-4 gap-8">
      {/* ── Left Card ─────────────────────────────────────────────── */}
      <div className="w-[540px] p-10 bg-white shadow-[0px_25px_50px_-12px_rgba(0,0,0,0.25)] rounded-3xl border border-gray-200/60 flex flex-col gap-6">
        <Logo />

        {/* Tabs */}
        <div className="flex bg-gray-100 rounded-2xl p-1">
          {["signin", "signup"].map((tab) => (
            <button
              key={tab}
              onClick={() => {
                setMode(tab);
                setGlobalError("");
                setSiErrors({});
                setSuErrors({});
              }}
              className={`flex-1 py-2.5 rounded-xl text-[14px] font-poppins font-semibold transition-all
                ${
                  mode === tab
                    ? "bg-white shadow text-[#0F172A]"
                    : "text-[#6B7280] hover:text-[#374151]"
                }`}
            >
              {tab === "signin" ? "Sign In" : "Sign Up"}
            </button>
          ))}
        </div>

        {/* Global error */}
        {globalError && (
          <div className="px-4 py-3 bg-red-50 border border-red-200 rounded-xl text-red-600 text-[13px] font-poppins">
            {globalError}
          </div>
        )}

        {/* ── Sign In form ── */}
        {mode === "signin" && (
          <form onSubmit={handleSignIn} className="flex flex-col gap-4">
            <InputField
              label="Email"
              type="email"
              value={siEmail}
              onChange={setSiEmail}
              placeholder="you@example.com"
              error={siErrors.email}
            />
            <InputField
              label="Password"
              type="password"
              value={siPassword}
              onChange={setSiPassword}
              placeholder="••••••••"
              error={siErrors.password}
            />
            <button
              type="submit"
              disabled={isLoading}
              className="w-full py-3 bg-gradient-to-r from-[#2B7FFF] to-[#00B8DB] text-white rounded-xl font-poppins font-semibold text-[15px] hover:opacity-90 transition-opacity disabled:opacity-50"
            >
              {isLoading ? "Signing in…" : "Sign In"}
            </button>

            <div className="flex items-center gap-3">
              <div className="flex-1 h-px bg-gray-200" />
              <span className="text-[12px] font-poppins text-[#9CA3AF]">
                or
              </span>
              <div className="flex-1 h-px bg-gray-200" />
            </div>

            <button
              type="button"
              onClick={handleGoogleLogin}
              disabled={isLoading}
              className="w-full py-3 bg-white border-2 border-gray-200 rounded-xl flex justify-center items-center gap-2.5 font-poppins font-semibold text-[14px] text-[#101828] hover:border-blue-200 hover:shadow transition-all disabled:opacity-50"
            >
              <img src={googleIcon} alt="Google" className="w-5 h-5" />
              Continue with Google
            </button>
          </form>
        )}

        {/* ── Sign Up form ── */}
        {mode === "signup" && (
          <form onSubmit={handleSignUp} className="flex flex-col gap-4">
            <InputField
              label="Username"
              value={suUsername}
              onChange={setSuUsername}
              placeholder="johndoe"
              error={suErrors.username}
            />
            <InputField
              label="Email"
              type="email"
              value={suEmail}
              onChange={setSuEmail}
              placeholder="you@example.com"
              error={suErrors.email}
            />
            <InputField
              label="Password"
              type="password"
              value={suPassword}
              onChange={setSuPassword}
              placeholder="Min. 8 characters"
              error={suErrors.password}
            />
            <InputField
              label="Confirm Password"
              type="password"
              value={suConfirm}
              onChange={setSuConfirm}
              placeholder="••••••••"
              error={suErrors.confirm}
            />
            <button
              type="submit"
              disabled={isLoading}
              className="w-full py-3 bg-gradient-to-r from-[#2B7FFF] to-[#00B8DB] text-white rounded-xl font-poppins font-semibold text-[15px] hover:opacity-90 transition-opacity disabled:opacity-50"
            >
              {isLoading ? "Creating account…" : "Create Account"}
            </button>

            <div className="flex items-center gap-3">
              <div className="flex-1 h-px bg-gray-200" />
              <span className="text-[12px] font-poppins text-[#9CA3AF]">
                or sign up with
              </span>
              <div className="flex-1 h-px bg-gray-200" />
            </div>

            <button
              type="button"
              onClick={handleGoogleLogin}
              disabled={isLoading}
              className="w-full py-3 bg-white border-2 border-gray-200 rounded-xl flex justify-center items-center gap-2.5 font-poppins font-semibold text-[14px] text-[#101828] hover:border-blue-200 hover:shadow transition-all disabled:opacity-50"
            >
              <img src={googleIcon} alt="Google" className="w-5 h-5" />
              Continue with Google
            </button>
          </form>
        )}

        <p className="text-center text-[11px] text-[#6A7282] font-poppins">
          By continuing, you agree to our{" "}
          <a href="#" className="text-[#155DFC] underline">
            Terms of Service
          </a>{" "}
          and{" "}
          <a href="#" className="text-[#155DFC] underline">
            Privacy Policy
          </a>
        </p>
      </div>

      {/* ── Right Card ────────────────────────────────────────────── */}
      <div className="w-[380px] p-6 bg-white shadow-2xl rounded-3xl border border-gray-200/60 hidden lg:flex flex-col gap-4">
        <div className="text-center py-1">
          <h3 className="text-[#101828] text-[17px] font-poppins font-bold">
            You'll get access to:
          </h3>
        </div>
        <div className="flex flex-col gap-3">
          {benefits.map((b, i) => (
            <div
              key={i}
              className="p-4 bg-white/90 rounded-2xl border border-gray-200 flex items-center gap-4"
            >
              <div
                className="w-11 h-11 rounded-xl flex justify-center items-center flex-shrink-0"
                style={{ background: b.gradient }}
              >
                <img src={iconMap[b.icon]} alt={b.title} className="w-5 h-5" />
              </div>
              <div>
                <h4 className="text-[#101828] text-[13px] font-poppins font-bold">
                  {b.title}
                </h4>
                <p className="text-[#4A5565] text-[11px] font-poppins">
                  {b.description}
                </p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
