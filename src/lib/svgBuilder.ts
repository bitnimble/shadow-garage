import { placedCutContours, type DesignResult } from "./design";
import { contoursToPathD } from "./geometry";
import { buildRegmarksSVG } from "./regmarks";
import type { SheetSize } from "./sheet";

export const CUT_LINE_COLOR = "#ff0000";

/**
 * Colour adjustment applied to the artwork (preview, print and export). Values are percentages,
 * 0 = unchanged, like the Epson driver's sliders. Darkening matters on foil/film stocks: inkjet
 * dye ink is translucent with no white, so pale tints all but vanish there.
 */
export interface ColorAdjust {
  brightness: number; // -100..100: scales every channel by (1 + b/100)
  contrast: number; // -100..100: stretches channels around mid grey
  saturation: number; // -100..100: feColorMatrix saturate of (1 + s/100)
}

export const NO_COLOR_ADJUST: ColorAdjust = { brightness: 0, contrast: 0, saturation: 0 };

export function isNoColorAdjust(a: ColorAdjust | undefined): boolean {
  return !a || (a.brightness === 0 && a.contrast === 0 && a.saturation === 0);
}

export interface RenderOptions {
  imageDataUrl: string;
  borderColor: string; // fill shown in the margin between artwork edge and cut line (driven by the selected paper type)
  cutStrokeWidthMm: number;
  showBorder: boolean;
  colorAdjust?: ColorAdjust; // applied to the artwork only, never to the border, cut lines or marks
}

function colorAdjustId(a: ColorAdjust): string {
  // "m" for minus keeps the id a plain XML name, e.g. color-adjust-m25_0_40.
  return "color-adjust-" + [a.brightness, a.contrast, a.saturation].map((v) => String(v).replace("-", "m")).join("_");
}

function colorAdjustFilter(a: ColorAdjust): string {
  const c = 1 + a.contrast / 100;
  const b = 1 + a.brightness / 100;
  // out = b * (c * x + 0.5 * (1 - c)), one linear pass per channel; the filter clamps to 0..1.
  const slope = +(b * c).toFixed(4);
  const intercept = +(b * 0.5 * (1 - c)).toFixed(4);
  const fn = (ch: string) => `<feFunc${ch} type="linear" slope="${slope}" intercept="${intercept}"/>`;
  return (
    `<filter id="${colorAdjustId(a)}" color-interpolation-filters="sRGB">` +
    `<feColorMatrix type="saturate" values="${+(1 + a.saturation / 100).toFixed(4)}"/>` +
    `<feComponentTransfer>${fn("R")}${fn("G")}${fn("B")}</feComponentTransfer>` +
    `</filter>`
  );
}

/** <defs> holding one filter per distinct colour adjustment in use, or "" when none is. */
function colorAdjustDefs(opts: RenderOptions[]): string {
  const filters = new Map<string, string>();
  for (const o of opts) if (o.colorAdjust && !isNoColorAdjust(o.colorAdjust)) filters.set(colorAdjustId(o.colorAdjust), colorAdjustFilter(o.colorAdjust));
  return filters.size ? `<defs>${[...filters.values()].join("")}</defs>` : "";
}

/**
 * Markup for a single sticker (border fill + image + cut outline), translated so its bbox origin
 * sits at (x, y). `rotated` turns it a quarter turn clockwise within that bbox.
 */
function stickerGroup(design: DesignResult, x: number, y: number, opts: RenderOptions, index: number, rotated = false): { print: string; cut: string } {
  const d = contoursToPathD(placedCutContours(design, x, y, rotated));
  const img = design.imagePlacementMM;

  const printParts: string[] = [];
  if (opts.showBorder) {
    printParts.push(`<path d="${d}" fill="${opts.borderColor}" fill-rule="evenodd"/>`);
  }
  // The cut path above is rotated point by point; the raster gets the same quarter turn as a transform.
  const [ix, iy] = rotated ? [img.x, img.y] : [x + img.x, y + img.y];
  const filter = opts.colorAdjust && !isNoColorAdjust(opts.colorAdjust) ? ` filter="url(#${colorAdjustId(opts.colorAdjust)})"` : "";
  const image = `<image href="${opts.imageDataUrl}" x="${ix.toFixed(3)}" y="${iy.toFixed(3)}" width="${img.width.toFixed(3)}" height="${img.height.toFixed(3)}" preserveAspectRatio="none"${filter}/>`;
  printParts.push(rotated ? `<g transform="translate(${(x + design.actualHmm).toFixed(3)} ${y.toFixed(3)}) rotate(90)">${image}</g>` : image);

  const cut = `<path id="cut-${index}" d="${d}" fill="none" stroke="${CUT_LINE_COLOR}" stroke-width="${opts.cutStrokeWidthMm}"/>`;

  return { print: `<g>${printParts.join("")}</g>`, cut };
}

/**
 * Single-sticker SVG, sized exactly to the sticker's own bounding box. Used for the main preview +
 * single-item export. includeCutLines=false leaves out the red cut outline (for printing).
 */
export function buildSingleStickerSVG(design: DesignResult, opts: RenderOptions, includeCutLines = true): string {
  const w = design.actualWmm;
  const h = design.actualHmm;
  const { print, cut } = stickerGroup(design, 0, 0, opts, 0);
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${w}mm" height="${h}mm" viewBox="0 0 ${w} ${h}">`,
    colorAdjustDefs([opts]),
    `<g id="print">${print}</g>`,
    includeCutLines ? `<g id="cutlines">${cut}</g>` : "",
    `</svg>`,
  ].join("");
}

export interface SheetItem {
  design: DesignResult;
  x: number;
  y: number;
  rotated?: boolean; // turned a quarter turn clockwise by the packer
  opts: RenderOptions;
}

/**
 * Full-sheet SVG placing each item (possibly different designs) at its packed position. Used for
 * Sheet Preview + sheet export. includeCutLines=false leaves out the red cut outlines (for printing).
 */
export function buildSheetSVG(
  items: SheetItem[],
  sheet: SheetSize,
  regmarks: false | "standard" | "four_corner" = false,
  includeCutLines = true
): string {
  const prints: string[] = [];
  const cuts: string[] = [];
  items.forEach((item, i) => {
    const { print, cut } = stickerGroup(item.design, item.x, item.y, item.opts, i, item.rotated);
    prints.push(print);
    cuts.push(cut);
  });
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${sheet.widthMm}mm" height="${sheet.heightMm}mm" viewBox="0 0 ${sheet.widthMm} ${sheet.heightMm}">`,
    colorAdjustDefs(items.map((i) => i.opts)),
    `<rect x="0" y="0" width="${sheet.widthMm}" height="${sheet.heightMm}" class="sheet-paper" fill="white"/>`,
    `<g id="print">${prints.join("")}</g>`,
    includeCutLines ? `<g id="cutlines">${cuts.join("")}</g>` : "",
    regmarks ? buildRegmarksSVG(sheet.widthMm, sheet.heightMm, regmarks === "four_corner") : "",
    `</svg>`,
  ].join("");
}
