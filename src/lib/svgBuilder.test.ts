import { describe, expect, it } from "vitest";
import { placedCutContours, type DesignResult } from "./design";
import { boundingBox } from "./geometry";
import { SHEET_SIZES } from "./sheet";
import { buildSheetSVG } from "./svgBuilder";

const letter = SHEET_SIZES.find((s) => s.name === "Letter")!;

describe("buildSheetSVG", () => {
  it("tags the page rect for on-screen theming while keeping a white fill for exports", () => {
    const pageRect = buildSheetSVG([], letter).match(/<rect [^>]*\/>/)?.[0];
    expect(pageRect).toBeDefined();
    expect(pageRect).toContain('class="sheet-paper"');
    expect(pageRect).toContain('fill="white"');
  });

  it("keeps the cut lines by default and can leave them out for printing", () => {
    const withLines = buildSheetSVG([], letter, "standard");
    const without = buildSheetSVG([], letter, "standard", false);
    expect(withLines).toContain('<g id="cutlines">');
    expect(without).not.toContain('id="cutlines"');
    expect(without).toContain('<g id="print">');
    expect(without).toContain('<g id="regmarks">');
  });

  it("turns a rotated sticker's cut path and artwork by the same quarter turn", () => {
    // 40 x 20 sticker whose artwork sits 2 mm in from the left and 1 mm down.
    const design: DesignResult = {
      cutContoursMM: [[[0, 0], [40, 0], [40, 20], [0, 20]]],
      imagePlacementMM: { x: 2, y: 1, width: 30, height: 18 },
      actualWmm: 40,
      actualHmm: 20,
    };
    const contours = placedCutContours(design, 100, 50, true);
    expect(boundingBox(contours)).toEqual({ minX: 100, minY: 50, maxX: 120, maxY: 90 });
    expect(contours[0][0]).toEqual([120, 50]); // the sticker's top-left ends up top-right

    const opts = { imageDataUrl: "data:,", borderColor: "#fff", cutStrokeWidthMm: 0.1, showBorder: false };
    const svg = buildSheetSVG([{ design, x: 100, y: 50, rotated: true, opts }], letter);
    expect(svg).toContain('<g transform="translate(120.000 50.000) rotate(90)"><image href="data:," x="2.000" y="1.000"');
    expect(svg).toContain('d="M120.000,50.000 L120.000,90.000 100.000,90.000 100.000,50.000 Z"');
  });
});
