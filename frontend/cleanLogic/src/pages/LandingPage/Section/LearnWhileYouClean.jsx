export default function LearnWhileYouCleanSection() {
  const features = [
    {
      title: "Step by Step",
      description:
        "Understand every cleaning decision is made with comprehensive guide and visualization.",
    },
    {
      title: "Visualizations",
      description:
        "See every operations in graphs, chart, and every insights in the result.",
    },
    {
      title: "Export Report",
      description:
        "Learn reports in the cleaning log of the result and process.",
    },
  ];

  const cards = [
    {
      title: "Missing Value",
      description:
        "Fill all missing value in your data profiling to increase data completeness and use your data strategically for insights and support decision-making.",
      iconBg: "rgba(0, 201, 80, 0.10)",
      iconColor: "#05DF72",
      icon: "check",
    },
    {
      title: "Outlier Detection & Removal",
      description:
        "We provide AI auto detect and remove the outliers on your data cleaning automatically or manually depends on your method of analysis.",
      iconBg: "rgba(43, 127, 255, 0.10)",
      iconColor: "#51A2FF",
      icon: "settings",
    },
  ];

  const renderCheckIcon = (color) => (
    <div className="w-6 h-6 relative overflow-hidden">
      <div
        className="w-5 h-5 absolute left-0.5 top-0.5 border-2 rounded-sm"
        style={{ borderColor: color }}
      ></div>
      <div
        className="w-1.5 h-1 absolute left-2.25 top-2.5 border-2"
        style={{ borderColor: color }}
      ></div>
    </div>
  );

  const renderSettingsIcon = (color) => (
    <div className="w-6 h-6 relative overflow-hidden">
      <div
        className="w-[18px] h-[18px] absolute left-0.75 top-0.75 border-2"
        style={{ borderColor: color }}
      ></div>
    </div>
  );

  return (
    <div className="w-full bg-white py-24 px-28 flex gap-16">
      {/* Left Column */}
      <div className="flex-1 flex flex-col gap-6">
        {/* Header */}
        <div className="flex flex-col gap-6">
          <h2
            style={{
              color: "#0F172A",
              fontSize: "48px",
              fontFamily: "Poppins",
              fontWeight: 400,
              lineHeight: "48px",
              wordWrap: "break-word",
            }}
          >
            Learn While You Clean
          </h2>

          <p
            className="max-w-xl"
            style={{
              color: "#4A5565",
              fontSize: "20px",
              fontFamily: "Poppins",
              fontWeight: 400,
              lineHeight: "32.5px",
              wordWrap: "break-word",
            }}
          >
            CleanLogic isn't just a tool—it's your data preprocessing tutor.
            Every operation comes with detailed explanations, code snippets, and
            best practices.
          </p>
        </div>

        {/* Feature List */}
        <div className="flex flex-col gap-6">
          {features.map((feature, index) => (
            <div key={index} className="flex gap-4 items-start">
              {/* Check Icon */}
              <div className="w-6 h-6 mt-1 relative overflow-hidden flex-shrink-0">
                <div className="w-5 h-5 absolute left-0.5 top-0.5 border-2 border-[#05DF72] rounded-sm"></div>
                <div className="w-1.5 h-1 absolute left-2.25 top-2.5 border-2 border-[#05DF72]"></div>
              </div>

              {/* Content */}
              <div className="flex flex-col gap-2">
                <h3
                  style={{
                    color: "#0F172A",
                    fontSize: "18px",
                    fontFamily: "Poppins",
                    fontWeight: 400,
                    lineHeight: "28px",
                    wordWrap: "break-word",
                  }}
                >
                  {feature.title}
                </h3>
                <p
                  className="max-w-lg"
                  style={{
                    color: "#4A5565",
                    fontSize: "16px",
                    fontFamily: "Poppins",
                    fontWeight: 400,
                    lineHeight: "24px",
                    wordWrap: "break-word",
                  }}
                >
                  {feature.description}
                </p>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Right Column - Cards */}
      <div className="flex-1 flex flex-col gap-6">
        {cards.map((card, index) => (
          <div
            key={index}
            className="p-8 bg-white shadow-[0px_2px_4px_-2px_rgba(0,0,0,0.10)] rounded-2xl border border-gray-200"
          >
            <div className="flex gap-4 items-start">
              {/* Icon */}
              <div
                className="w-12 h-12 rounded-xl flex justify-center items-center flex-shrink-0"
                style={{ background: card.iconBg }}
              >
                {card.icon === "check" && renderCheckIcon(card.iconColor)}
                {card.icon === "settings" && renderSettingsIcon(card.iconColor)}
              </div>

              {/* Content */}
              <div className="flex-1 flex flex-col gap-3">
                <h3
                  style={{
                    color: "#0F172A",
                    fontSize: "20px",
                    fontFamily: "Poppins",
                    fontWeight: 400,
                    lineHeight: "28px",
                    wordWrap: "break-word",
                  }}
                >
                  {card.title}
                </h3>
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
                  {card.description}
                </p>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
