import logo from "../../../assets/logo.svg";

function landingPage() {
  return (
    <>
      <div className="w-full bg-white border-b border-gray-200 py-3 px-24 flex justify-between items-start">
        {/* Logo Section */}

        <div className="flex justify-start items-center gap-4">
          <div className="h-10 flex justify-start items-center gap-3">
            {/* Icon Bars */}
            <div className="flex justify-start items-center gap-2">
              {/* First Bar */}
              <div className="w-2 flex flex-col justify-start items-center gap-0.5">
                <div className="w-1.5 h-1.5 bg-[#2980FD]"></div>
                <div className="w-full h-8 bg-gradient-to-b from-[#2B7FFF] to-[#00B8DB] rounded-full"></div>
              </div>

              {/* Second Bar */}
              <div className="w-1.5 flex flex-col justify-start items-center gap-0.5">
                <div className="w-1.5 h-1.5 bg-[#AE45FC]"></div>
                <div className="w-full h-6 bg-gradient-to-b from-[#AD46FF] to-[#F6339A] rounded-full"></div>
              </div>

              {/* Third Bar */}
              <div className="flex flex-col justify-start items-center gap-0.5">
                <div className="w-1.5 h-1.5 bg-[#50A0FE]"></div>
                <div className="w-2 h-10 bg-gradient-to-b from-[#51A2FF] to-[#9810FA] rounded-full"></div>
              </div>
            </div>

            {/* Logo Text */}
            <div className="flex justify-center items-center gap-2.5">
              <div
                className="text-slate-900 text-2xl font-normal leading-8"
                style={{ fontFamily: "Poppins" }}
              >
                CleanLogic
              </div>
            </div>
          </div>
        </div>

        {/* Navigation Section */}
        <div className="h-9 flex justify-start items-center gap-2">
          <div className="w-25 h-9 px-4 rounded-lg flex justify-center items-center gap-2">
            <div className="h-5 flex justify-start items-start">
              <div
                className="text-center text-gray-600 text-xl font-normal leading-5"
                style={{ fontFamily: "Poppins" }}
              >
                <a
                  href="#features"
                  class="text-500 hover:text-blue-700 transition duration-300 "
                >
                  Features
                </a>
              </div>
            </div>
          </div>

          <div className="w-25 h-9 px-4 rounded-lg flex justify-center items-center gap-2">
            <div className="h-5 flex justify-start items-start">
              <div
                className="text-center text-gray-600 text-xl font-normal leading-5"
                style={{ fontFamily: "Poppins" }}
              >
                <a
                  href="#HowItWorks"
                  class="text-500 hover:text-blue-700 transition duration-300 "
                >
                  FAQ
                </a>
              </div>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}

export default landingPage;
