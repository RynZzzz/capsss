import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, it, expect } from "vitest";

describe("CleaningPage refresh order", () => {
  it("declares refreshAfterCleaning before merged-cells effect uses it", () => {
    const filePath = fileURLToPath(
      new URL("./Cleaning.jsx", import.meta.url),
    );
    const source = readFileSync(filePath, "utf-8");
    const refreshIndex = source.indexOf("const refreshAfterCleaning");
    const mergedIndex = source.indexOf("checkMergedCells");
    expect(refreshIndex).toBeGreaterThan(-1);
    expect(mergedIndex).toBeGreaterThan(-1);
    expect(refreshIndex).toBeLessThan(mergedIndex);
  });

  it("declares showToast before merged-cells effect uses it", () => {
    const filePath = fileURLToPath(
      new URL("./Cleaning.jsx", import.meta.url),
    );
    const source = readFileSync(filePath, "utf-8");
    const toastIndex = source.indexOf("const showToast");
    const mergedIndex = source.indexOf("checkMergedCells");
    expect(toastIndex).toBeGreaterThan(-1);
    expect(mergedIndex).toBeGreaterThan(-1);
    expect(toastIndex).toBeLessThan(mergedIndex);
  });
});
