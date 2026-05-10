import LoginPage from "../../LogIn/LoginPage";
import React, { useState } from "react";
import { Link } from "react-router-dom";
function features() {
  const [isStarted, setStarted] = useState(false);

  const handleStart = () => {
    setStarted(true);
  };
  return (
    <>
      <div className="relative w-full overflow-hidden">
        {/* Background blur effects */}
        <div className="absolute w-96 h-96 left-96 top-16 opacity-60 bg-[rgba(43,127,255,0.05)] rounded-full blur-[64px]"></div>
        <div className="absolute w-96 h-96 left-[744px] top-[395px] opacity-90 bg-[rgba(173,70,255,0.05)] rounded-full blur-[64px]"></div>

        {/* Main content */}
        <div className="relative max-w-6xl mx-auto px-4 py-20 flex flex-col items-center gap-12">
          {/* Badge */}
          <div className="px-4 py-3 bg-[rgba(43,127,255,0.20)] rounded-full border border-[rgba(43,127,255,0.20)] flex items-center gap-3">
            <div className="w-4 h-4 relative">
              <div className="w-3.5 h-3.5 absolute left-0.5 top-0.5 border-2 border-[#51A2FF] rounded-sm"></div>
              <div className="w-[2.67px] h-[2.67px] absolute left-0.5 top-3 border-2 border-[#51A2FF]"></div>
            </div>
            <div
              style={{
                color: "#51A2FF",
                fontSize: "16px",
                fontFamily: "Poppins",
                fontWeight: 400,
                lineHeight: "20px",
                wordWrap: "break-word",
              }}
            >
              AI-Powered Data Preprocessing
            </div>
          </div>

          {/* Heading */}
          <div className="flex flex-col items-center gap-2">
            <h1
              className="text-center"
              style={{
                color: "#0F172A",
                fontSize: "72px",
                fontFamily: "Poppins",
                fontWeight: 400,
                lineHeight: "90px",
                wordWrap: "break-word",
              }}
            >
              Turn Messy Data into
            </h1>
            <h1
              className="text-center"
              style={{
                color: "#51A2FF",
                fontSize: "72px",
                fontFamily: "Poppins",
                fontWeight: 800,
                lineHeight: "90px",
                wordWrap: "break-word",
              }}
            >
              Clean Logic
            </h1>
          </div>

          {/* Description */}
          <div className="max-w-3xl px-4">
            <p
              className="text-center"
              style={{
                color: "#4A5565",
                fontSize: "24px",
                fontFamily: "Poppins",
                fontWeight: 400,
                lineHeight: "39px",
                wordWrap: "break-word",
              }}
            >
              Easy to use and free data preprocessing that clean, visualize, and
              learn all in one place.
            </p>
          </div>

          {/* CTA Button */}
          <Link
            to="/login"
            className="w-[500px] h-14 px-8 bg-gradient-to-r from-[#155DFC] to-[#9810FA] shadow-[0px_8px_10px_-6px_rgba(0,0,0,0.10)] rounded-2xl flex justify-center items-center gap-3 hover:shadow-lg transition-all duration-300 transform hover:scale-105"
          >
            <span
              style={{
                color: "white",
                fontSize: "16px",
                fontFamily: "Poppins",
                fontWeight: 600,
                lineHeight: "24px",
                wordWrap: "break-word",
              }}
            >
              Get Started
            </span>
          </Link>

          {/* Stats */}
          <div className="flex items-start gap-12 px-4">
            <div className="w-52 flex flex-col items-start gap-2">
              <div
                className="text-center w-full"
                style={{
                  color: "#0F172A",
                  fontSize: "36px",
                  fontFamily: "Poppins",
                  fontWeight: 400,
                  lineHeight: "40px",
                  wordWrap: "break-word",
                }}
              >
                NaN
              </div>
              <div
                className="text-center w-full"
                style={{
                  color: "#6A7282",
                  fontSize: "16px",
                  fontFamily: "Poppins",
                  fontWeight: 400,
                  lineHeight: "24px",
                  wordWrap: "break-word",
                }}
              >
                Rows Cleaned
              </div>
            </div>
            <div className="w-52 flex flex-col items-start gap-2">
              <div
                className="text-center w-full"
                style={{
                  color: "#0F172A",
                  fontSize: "36px",
                  fontFamily: "Poppins",
                  fontWeight: 400,
                  lineHeight: "40px",
                  wordWrap: "break-word",
                }}
              >
                Free
              </div>
              <div
                className="text-center w-full"
                style={{
                  color: "#6A7282",
                  fontSize: "16px",
                  fontFamily: "Poppins",
                  fontWeight: 400,
                  lineHeight: "24px",
                  wordWrap: "break-word",
                }}
              >
                Subscription Fee
              </div>
            </div>
            <div className="w-52 flex flex-col items-start gap-2">
              <div
                className="text-center w-full"
                style={{
                  color: "#0F172A",
                  fontSize: "36px",
                  fontFamily: "Poppins",
                  fontWeight: 400,
                  lineHeight: "40px",
                  wordWrap: "break-word",
                }}
              >
                24/7
              </div>
              <div
                className="text-center w-full"
                style={{
                  color: "#6A7282",
                  fontSize: "16px",
                  fontFamily: "Poppins",
                  fontWeight: 400,
                  lineHeight: "24px",
                  wordWrap: "break-word",
                }}
              >
                Available
              </div>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}

export default features;
