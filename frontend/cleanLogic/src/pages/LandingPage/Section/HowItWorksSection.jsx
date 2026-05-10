export default function HowItWorksSection() {
  const steps = [
    {
      number: "01",
      title: "Upload Your Dataset",
      description:
        "Drop your CSV or Excel file and let CleanLogic scan for quality issues.",
      icon: "database",
    },
    {
      number: "02",
      title: "Review Your Dataset",
      description:
        "We create a single data profiling report, check issues, duplicate, or inconsistencies.",
      icon: "settings",
    },
    {
      number: "03",
      title: "Choose Your Process",
      description:
        "Use AI automated data cleaning process or you can customize cleanings with your choice.",
      icon: "sparkles",
    },
    {
      number: "04",
      title: "Export & Learn",
      description:
        "Download your cleaned data xlsx and your pdf with insights, steps, and visualization.",
      icon: "download",
    },
  ];

  const renderIcon = (iconType) => {
    return (
      <div className="w-16 h-16 bg-gradient-to-br from-[rgba(43,127,255,0.30)] to-[rgba(173,70,255,0.30)] shadow-[0px_8px_10px_-6px_rgba(43,127,255,0.30)] rounded-2xl flex justify-center items-center">
        <div className="w-8 h-8 relative overflow-hidden">
          {iconType === "database" && (
            <>
              <div className="w-6 h-2 absolute left-1 top-[2.67px] border-[2.67px] border-white"></div>
              <div className="w-6 h-[22.67px] absolute left-1 top-[6.67px] border-[2.67px] border-white"></div>
              <div className="w-6 h-1 absolute left-1 top-4 border-[2.67px] border-white"></div>
            </>
          )}
          {iconType === "settings" && (
            <div className="w-6 h-6 absolute left-1 top-1 border-[2.67px] border-white"></div>
          )}
          {iconType === "sparkles" && (
            <>
              <div className="w-[26.67px] h-[26.67px] absolute left-[2.66px] top-[2.66px] border-[2.67px] border-white"></div>
              <div className="w-[5.33px] h-[5.33px] absolute left-[2.67px] top-6 border-[2.67px] border-white"></div>
            </>
          )}
          {iconType === "download" && (
            <>
              <div className="w-[21.33px] h-[26.67px] absolute left-[5.33px] top-[2.67px] border-[2.67px] border-white"></div>
              <div className="w-2 h-2 absolute left-[18.67px] top-[2.67px] border-[2.67px] border-white"></div>
            </>
          )}
        </div>
      </div>
    );
  };

  return (
    <div
      id="HowItWorks"
      className="w-full bg-[#F8FAFC] py-24 px-28 flex flex-col gap-16"
    >
      {/* Header */}
      <div className="flex flex-col gap-4">
        <h2
          className="text-center"
          style={{
            color: "#0F172A",
            fontSize: "48px",
            fontFamily: "Poppins",
            fontWeight: 400,
            lineHeight: "48px",
            wordWrap: "break-word",
          }}
        >
          How It Works
        </h2>
        <p
          className="text-center"
          style={{
            color: "#4A5565",
            fontSize: "20px",
            fontFamily: "Poppins",
            fontWeight: 400,
            lineHeight: "28px",
            wordWrap: "break-word",
          }}
        >
          Four simple steps to use CleanLogic
        </p>
      </div>

      {/* Steps */}
      <div className="grid grid-cols-2 gap-6">
        <div className="flex gap-6 items-start">
          {/* Icon */}
          {renderIcon(steps[0].icon)}

          {/* Content */}
          <div className="flex-1 h-46 relative pb-8">
            {/* Number */}
            <div
              style={{
                color: "#0F172A",
                fontSize: "60px",
                fontFamily: "Poppins",
                fontWeight: 275,
                lineHeight: "60px",
                wordWrap: "break-word",
              }}
            >
              {steps[0].number}
            </div>

            {/* Title */}
            <h3
              className="mt-6"
              style={{
                color: "#0F172A",
                fontSize: "24px",
                fontFamily: "Poppins",
                fontWeight: 400,
                lineHeight: "32px",
                wordWrap: "break-word",
              }}
            >
              {steps[0].title}
            </h3>

            {/* Description */}
            <p
              className="mt-4 max-w-xl"
              style={{
                color: "#4A5565",
                fontSize: "16px",
                fontFamily: "Poppins",
                fontWeight: 400,
                lineHeight: "26px",
                wordWrap: "break-word",
              }}
            >
              {steps[0].description}
            </p>
          </div>
        </div>

        <div className="flex gap-6 items-start">
          {renderIcon(steps[1].icon)}
          <div className="flex-1 relative">
            <div
              style={{
                color: "#0F172A",
                fontSize: "60px",
                fontFamily: "Poppins",
                fontWeight: 275,
                lineHeight: "60px",
                wordWrap: "break-word",
              }}
            >
              {steps[1].number}
            </div>
            <h3
              className="mt-6"
              style={{
                color: "#0F172A",
                fontSize: "24px",
                fontFamily: "Poppins",
                fontWeight: 400,
                lineHeight: "32px",
                wordWrap: "break-word",
              }}
            >
              {steps[1].title}
            </h3>
            <p
              className="mt-4"
              style={{
                color: "#4A5565",
                fontSize: "16px",
                fontFamily: "Poppins",
                fontWeight: 400,
                lineHeight: "26px",
                wordWrap: "break-word",
              }}
            >
              {steps[1].description}
            </p>
          </div>
        </div>

        {/* Step 03 - Bottom Left */}
        <div className="flex gap-6 items-start">
          {renderIcon(steps[2].icon)}
          <div className="flex-1 relative">
            <div
              style={{
                color: "#0F172A",
                fontSize: "60px",
                fontFamily: "Poppins",
                fontWeight: 275,
                lineHeight: "60px",
                wordWrap: "break-word",
              }}
            >
              {steps[2].number}
            </div>
            <h3
              className="mt-6"
              style={{
                color: "#0F172A",
                fontSize: "24px",
                fontFamily: "Poppins",
                fontWeight: 400,
                lineHeight: "32px",
                wordWrap: "break-word",
              }}
            >
              {steps[2].title}
            </h3>
            <p
              className="mt-4"
              style={{
                color: "#4A5565",
                fontSize: "16px",
                fontFamily: "Poppins",
                fontWeight: 400,
                lineHeight: "26px",
                wordWrap: "break-word",
              }}
            >
              {steps[2].description}
            </p>
          </div>
        </div>

        {/* Step 04 - Bottom Right */}
        <div className="flex gap-6 items-start">
          {renderIcon(steps[3].icon)}
          <div className="flex-1 relative">
            <div
              style={{
                color: "#0F172A",
                fontSize: "60px",
                fontFamily: "Poppins",
                fontWeight: 275,
                lineHeight: "60px",
                wordWrap: "break-word",
              }}
            >
              {steps[3].number}
            </div>
            <h3
              className="mt-6"
              style={{
                color: "#0F172A",
                fontSize: "24px",
                fontFamily: "Poppins",
                fontWeight: 400,
                lineHeight: "32px",
                wordWrap: "break-word",
              }}
            >
              {steps[3].title}
            </h3>
            <p
              className="mt-4"
              style={{
                color: "#4A5565",
                fontSize: "16px",
                fontFamily: "Poppins",
                fontWeight: 400,
                lineHeight: "26px",
                wordWrap: "break-word",
              }}
            >
              {steps[3].description}
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
