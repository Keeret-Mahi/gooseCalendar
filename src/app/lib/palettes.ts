import type { ExportConfig } from "./types";

export interface PaletteOption {
  id: string;
  name: string;
  colors: string[];
}

export const VISIBLE_PALETTE_COLOR_COUNT = 5;
export const INTERNAL_PALETTE_COLOR_COUNT = 7;

export const palettes: PaletteOption[] = [
  {
    id: "matcha",
    name: "Matcha",
    colors: ["#b6d6a8", "#8ca481", "#a4b49d", "#f5f0e6", "#53604d", "#dce8d2", "#6b7a64"],
  },
  {
    id: "mist",
    name: "Mist",
    colors: ["#b5e3d8", "#f2eae2", "#a8d8e0", "#cff3f0", "#c4bfb4", "#d9f2ef", "#8fb7be"],
  },
  {
    id: "berry",
    name: "Berry",
    colors: ["#574144", "#f9f1e8", "#bf7e81", "#b79ea1", "#ffe4e1", "#e7c7c5", "#8d5c64"],
  },
  {
    id: "plum",
    name: "Plum",
    colors: ["#7b4c63", "#c8c4c0", "#9e7393", "#a89a91", "#bfa5b8", "#d8ccd8", "#5f4056"],
  },
  {
    id: "vanilla",
    name: "Vanilla",
    colors: ["#faf5ec", "#d8d3ca", "#a69f8e", "#eadfc3", "#f7ede5", "#c7b69e", "#fffaf1"],
  },
  {
    id: "coffee",
    name: "Coffee",
    colors: ["#a49a98", "#9d8a7c", "#796254", "#523f31", "#b1b1b1", "#8b6f60", "#ddd7d2"],
  },
  {
    id: "midnight",
    name: "Midnight",
    colors: ["#7589a2", "#4e6188", "#909bbb", "#c0c6de", "#566288", "#cad1d9", "#3a405b"],
  },
  {
    id: "honey",
    name: "Honey",
    colors: ["#ead3a5", "#f2e6c0", "#f8eed6", "#f4d68e", "#f7e6ae", "#faf4e6", "#f4da9d"],
  },
  {
    id: "strawberry",
    name: "Strawberry",
    colors: ["#c66f80", "#f4c7d0", "#fcebf1", "#4a6644", "#9faa74", "#d7dab3", "#ece3d2"],
  },
];

function clampChannel(value: number) {
  return Math.max(0, Math.min(255, Math.round(value)));
}

function normalizeHexColor(color: string) {
  const normalized = color.trim();
  if (/^#[0-9a-f]{6}$/i.test(normalized)) {
    return normalized.toLowerCase();
  }
  return "#000000";
}

function hexToRgb(color: string) {
  const normalized = normalizeHexColor(color);
  return {
    r: Number.parseInt(normalized.slice(1, 3), 16),
    g: Number.parseInt(normalized.slice(3, 5), 16),
    b: Number.parseInt(normalized.slice(5, 7), 16),
  };
}

function rgbToHex(red: number, green: number, blue: number) {
  return `#${clampChannel(red).toString(16).padStart(2, "0")}${clampChannel(green)
    .toString(16)
    .padStart(2, "0")}${clampChannel(blue).toString(16).padStart(2, "0")}`;
}

function mixHexColors(left: string, right: string, weight: number) {
  const safeWeight = Math.max(0, Math.min(1, weight));
  const leftRgb = hexToRgb(left);
  const rightRgb = hexToRgb(right);
  return rgbToHex(
    leftRgb.r + (rightRgb.r - leftRgb.r) * safeWeight,
    leftRgb.g + (rightRgb.g - leftRgb.g) * safeWeight,
    leftRgb.b + (rightRgb.b - leftRgb.b) * safeWeight
  );
}

function shiftHexColor(color: string, amount: number) {
  const base = hexToRgb(color);
  const target = amount >= 0 ? 255 : 0;
  const weight = Math.abs(amount);
  return rgbToHex(
    base.r + (target - base.r) * weight,
    base.g + (target - base.g) * weight,
    base.b + (target - base.b) * weight
  );
}

function appendUniqueColor(colors: string[], candidate: string, fallbackBase: string, fallbackShift: number) {
  const normalizedCandidate = normalizeHexColor(candidate);
  if (!colors.includes(normalizedCandidate)) {
    colors.push(normalizedCandidate);
    return;
  }

  const shifted = shiftHexColor(fallbackBase, fallbackShift);
  if (!colors.includes(shifted)) {
    colors.push(shifted);
    return;
  }

  colors.push(shiftHexColor(fallbackBase, fallbackShift > 0 ? fallbackShift + 0.08 : fallbackShift - 0.08));
}

export function ensurePaletteColorCount(colors: string[]) {
  const normalized = colors.map(normalizeHexColor).filter(Boolean);
  if (normalized.length >= INTERNAL_PALETTE_COLOR_COUNT) {
    return normalized.slice(0, INTERNAL_PALETTE_COLOR_COUNT);
  }

  const seeded = normalized.slice(0, Math.max(normalized.length, VISIBLE_PALETTE_COLOR_COUNT));
  while (seeded.length < VISIBLE_PALETTE_COLOR_COUNT) {
    seeded.push(seeded[seeded.length - 1] ?? "#000000");
  }

  const expanded = [...seeded];
  appendUniqueColor(
    expanded,
    mixHexColors(expanded[1], expanded[3], 0.45),
    expanded[1],
    0.18
  );
  appendUniqueColor(
    expanded,
    mixHexColors(expanded[0], expanded[4], 0.58),
    expanded[4],
    -0.16
  );

  return expanded.slice(0, INTERNAL_PALETTE_COLOR_COUNT);
}

export function resolveExportPaletteColors(exportConfig: ExportConfig) {
  if (exportConfig.paletteId === "custom") {
    return ensurePaletteColorCount(exportConfig.customColors.filter(Boolean));
  }

  const presetColors =
    palettes.find((palette) => palette.id === exportConfig.paletteId)?.colors.filter(Boolean) ?? [];

  return ensurePaletteColorCount(presetColors);
}
