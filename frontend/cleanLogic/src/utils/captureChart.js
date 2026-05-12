// utils/captureChart.js
//
// Capture a Recharts (or any SVG) chart rendered inside a container div as a
// base64-encoded PNG. The SVG is stamped onto a canvas with a white background
// so the resulting PNG is never transparent.
//
// Returns a Promise resolving to a raw base64 string (no data:image/png;base64,
// prefix) — the backend only needs the raw bytes.

export const captureChartAsBase64 = (containerRef) => {
  return new Promise((resolve, reject) => {
    const container = containerRef?.current;
    if (!container) return reject(new Error("No container ref found"));

    const svg = container.querySelector("svg");
    if (!svg) return reject(new Error("No SVG found in container"));

    // Use the actual painted size, not the SVG attribute (which may be "100%").
    const rect = svg.getBoundingClientRect();
    const width = Math.max(Math.round(rect.width || svg.clientWidth || 600), 1);
    const height = Math.max(Math.round(rect.height || svg.clientHeight || 400), 1);

    // Clone so we can inject explicit width/height attributes without mutating
    // the live DOM node (recharts manages it).
    const clone = svg.cloneNode(true);
    clone.setAttribute("width", String(width));
    clone.setAttribute("height", String(height));
    if (!clone.getAttribute("xmlns")) {
      clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
    }

    const svgData = new XMLSerializer().serializeToString(clone);
    const blob = new Blob([svgData], { type: "image/svg+xml;charset=utf-8" });
    const url = URL.createObjectURL(blob);

    const canvas = document.createElement("canvas");
    // Render at 2x for sharper text on high-DPI displays.
    const scale = 2;
    canvas.width = width * scale;
    canvas.height = height * scale;
    const ctx = canvas.getContext("2d");

    const img = new Image();
    img.onload = () => {
      try {
        ctx.fillStyle = "#ffffff";
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        const dataUrl = canvas.toDataURL("image/png");
        URL.revokeObjectURL(url);
        // Strip "data:image/png;base64," prefix — backend wants raw bytes only.
        const commaIdx = dataUrl.indexOf(",");
        resolve(commaIdx >= 0 ? dataUrl.slice(commaIdx + 1) : dataUrl);
      } catch (err) {
        URL.revokeObjectURL(url);
        reject(err);
      }
    };
    img.onerror = (e) => {
      URL.revokeObjectURL(url);
      reject(new Error("Failed to load chart SVG as image"));
    };
    img.src = url;
  });
};
