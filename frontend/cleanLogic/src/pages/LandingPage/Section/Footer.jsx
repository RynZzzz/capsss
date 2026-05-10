export default function FooterSection() {
  const footerLinks = {
    product: {
      title: "Product",
      links: ["Features", "Pricing"],
    },
    developers: {
      title: "Developers",
      links: ["Docs", "API"],
    },
    legal: {
      title: "Legal",
      links: ["Privacy", "Terms"],
    },
  };

  return (
    <div className="w-full bg-[#F3F4F6] border-t border-[#D1D5DC] py-16 px-28">
      <div className="flex flex-col gap-12">
        {/* Footer Links */}
        <div className="flex gap-20">
          {/* Product Column */}
          <div className="flex flex-col gap-4">
            <h3
              style={{
                color: "#0F172A",
                fontSize: "16px",
                fontFamily: "Poppins",
                fontWeight: 500,
                lineHeight: "24px",
                wordWrap: "break-word",
              }}
            >
              {footerLinks.product.title}
            </h3>
            <div className="flex flex-col gap-3">
              {footerLinks.product.links.map((link, index) => (
                <a
                  key={index}
                  href="#"
                  className="hover:underline"
                  style={{
                    color: "#4A5565",
                    fontSize: "16px",
                    fontFamily: "Poppins",
                    fontWeight: 400,
                    lineHeight: "24px",
                    wordWrap: "break-word",
                  }}
                >
                  {link}
                </a>
              ))}
            </div>
          </div>

          {/* Developers Column */}
          <div className="flex flex-col gap-4">
            <h3
              style={{
                color: "#0F172A",
                fontSize: "16px",
                fontFamily: "Poppins",
                fontWeight: 500,
                lineHeight: "24px",
                wordWrap: "break-word",
              }}
            >
              {footerLinks.developers.title}
            </h3>
            <div className="flex flex-col gap-3">
              {footerLinks.developers.links.map((link, index) => (
                <a
                  key={index}
                  href="#"
                  className="hover:underline"
                  style={{
                    color: "#4A5565",
                    fontSize: "16px",
                    fontFamily: "Poppins",
                    fontWeight: 400,
                    lineHeight: "24px",
                    wordWrap: "break-word",
                  }}
                >
                  {link}
                </a>
              ))}
            </div>
          </div>

          {/* Legal Column */}
          <div className="flex flex-col gap-4">
            <h3
              style={{
                color: "#0F172A",
                fontSize: "16px",
                fontFamily: "Poppins",
                fontWeight: 500,
                lineHeight: "24px",
                wordWrap: "break-word",
              }}
            >
              {footerLinks.legal.title}
            </h3>
            <div className="flex flex-col gap-3">
              {footerLinks.legal.links.map((link, index) => (
                <a
                  key={index}
                  href="#"
                  className="hover:underline"
                  style={{
                    color: "#4A5565",
                    fontSize: "16px",
                    fontFamily: "Poppins",
                    fontWeight: 400,
                    lineHeight: "24px",
                    wordWrap: "break-word",
                  }}
                >
                  {link}
                </a>
              ))}
            </div>
          </div>
        </div>

        {/* Bottom Section */}
        <div className="border-t border-[#D1D5DC] pt-6 flex justify-between items-center">
          {/* Logo */}
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2">
              <div className="w-2 h-6 bg-gradient-to-b from-[#2B7FFF] to-[#00B8DB] rounded-full"></div>
              <div className="w-1.5 h-5 bg-gradient-to-b from-[#AD46FF] to-[#F6339A] rounded-full"></div>
              <div className="w-2 h-7 bg-gradient-to-b from-[#51A2FF] to-[#9810FA] rounded-full"></div>
            </div>
            <div
              style={{
                color: "#0F172A",
                fontSize: "18px",
                fontFamily: "Poppins",
                fontWeight: 400,
                lineHeight: "28px",
                wordWrap: "break-word",
              }}
            >
              CleanLogic
            </div>
          </div>

          {/* Copyright */}
          <div
            style={{
              color: "#4A5565",
              fontSize: "14px",
              fontFamily: "Poppins",
              fontWeight: 400,
              lineHeight: "20px",
              wordWrap: "break-word",
            }}
          >
            © 2025 CleanLogic. All rights reserved.
          </div>
        </div>
      </div>
    </div>
  );
}
