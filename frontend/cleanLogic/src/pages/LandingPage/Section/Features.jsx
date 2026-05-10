export default function FeaturesSection() {
  const features = [
    {
      title: "AI-Powered Cleaning",
      description:
        "Intelligent algorithms detect and fix data quality issues automatically while explaining every decision.",
      icon: "sparkles",
      bgGradient: "linear-gradient(135deg, #FAF5FF 0%, white 100%)",
      iconBg: "#AD46FF",
    },
    {
      title: "Smart Data Profiling",
      description:
        "Provides a comprehensive overview of dataset, highlighting missing values, outliers, and inconsistencies.",
      icon: "database",
      bgGradient: "linear-gradient(135deg, #EFF6FF 0%, white 100%)",
      iconBg: "#2B7FFF",
    },
    {
      title: "Customize Process",
      description:
        "Take control of your data cleaning process with flexible, user-defined settings.",
      icon: "settings",
      bgGradient: "linear-gradient(135deg, #F0FDF4 0%, white 100%)",
      iconBg: "#00C950",
    },
    {
      title: "Educational Focus",
      description:
        "Learn data preprocessing concepts with steps for every operation and insights of the result.",
      icon: "book",
      bgGradient: "linear-gradient(135deg, #FEFCE8 0%, white 100%)",
      iconBg: "#F0B100",
    },
    {
      title: "Interactive Visualization",
      description:
        "Visualize data with charts and graphs that reveal trends, counts, and groups, making it easier to understand and analyze.",
      icon: "chart",
      bgGradient: "linear-gradient(135deg, #FEF2F2 0%, white 100%)",
      iconBg: "#FB2C36",
    },
    {
      title: "Export Report",
      description:
        "Generate and download a report of cleaned and processed dataset, including visualization, insights and steps applied.",
      icon: "download",
      bgGradient: "linear-gradient(135deg, #FFF7ED 0%, white 100%)",
      iconBg: "#FF6900",
    },
  ];

  const renderIcon = (iconType, iconBg) => {
    const iconStyle = {
      width: "48px",
      height: "48px",
      background: iconBg,
      borderRadius: "50%",
      display: "flex",
      justifyContent: "center",
      alignItems: "center",
    };

    return (
      <div style={iconStyle} id="features">
        <div className="w-6 h-6 relative overflow-hidden">
          {iconType === "sparkles" && (
            <>
              <div className="w-5 h-5 absolute left-0.5 top-0.5 border-2 border-white rounded-sm"></div>
              <div className="w-1 h-1 absolute left-0.5 top-[18px] border-2 border-white"></div>
            </>
          )}
          {iconType === "database" && (
            <>
              <div className="w-[18px] h-1.5 absolute left-0.75 top-0.5 border-2 border-white"></div>
              <div className="w-[18px] h-[17px] absolute left-0.75 top-1.25 border-2 border-white"></div>
              <div className="w-[18px] h-0.75 absolute left-0.75 top-3 border-2 border-white"></div>
            </>
          )}
          {iconType === "settings" && (
            <div className="w-[18px] h-[18px] absolute left-0.75 top-0.75 border-2 border-white"></div>
          )}
          {iconType === "book" && (
            <div className="w-[18px] h-[14.25px] absolute left-0.75 top-1.25 border-2 border-white"></div>
          )}
          {iconType === "chart" && (
            <>
              <div className="w-1.5 h-1.5 absolute left-4 top-1.75 border-2 border-white"></div>
              <div className="w-5 h-2.5 absolute left-0.5 top-1.75 border-2 border-white"></div>
            </>
          )}
          {iconType === "download" && (
            <>
              <div className="w-4 h-5 absolute left-1 top-0.5 border-2 border-white"></div>
              <div className="w-1.5 h-1.5 absolute left-3.5 top-0.5 border-2 border-white"></div>
            </>
          )}
        </div>
      </div>
    );
  };

  return (
    <div className="w-full bg-white py-24 px-28 flex flex-col gap-16">
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
          Powerful Features
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
          Everything you need to master data preprocessing
        </p>
      </div>

      {/* Features Grid */}
      <div className="grid grid-cols-3 gap-6">
        {features.map((feature, index) => (
          <div
            key={index}
            className="rounded-2xl border border-gray-200 shadow-[0px_4px_6px_-4px_rgba(0,0,0,0.10)] p-8 flex flex-col gap-8"
            style={{ background: feature.bgGradient }}
          >
            {/* Icon */}
            {renderIcon(feature.icon, feature.iconBg)}

            {/* Title */}
            <h3
              style={{
                color: "#0F172A",
                fontSize: "24px",
                fontFamily: "Poppins",
                fontWeight: 400,
                lineHeight: "32px",
                wordWrap: "break-word",
              }}
            >
              {feature.title}
            </h3>

            {/* Description */}
            <p
              style={{
                color: "#4A5565",
                fontSize: "16px",
                fontFamily: "Poppins",
                fontWeight: 400,
                lineHeight: "26px",
                wordWrap: "break-word",
              }}
            >
              {feature.description}
            </p>
          </div>
        ))}
      </div>
    </div>
  );
}
