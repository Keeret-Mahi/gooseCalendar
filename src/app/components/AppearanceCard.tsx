import svgPaths from "../../imports/svg-muqjom28j6";
import { useRef, useState, useEffect } from "react";
import { HexColorPicker } from "react-colorful";
import type { PaletteOption } from "../lib/palettes";
import { palettes, VISIBLE_PALETTE_COLOR_COUNT } from "../lib/palettes";

export { palettes };

function CheckBadge() {
  return (
    <div className="absolute -top-2 -right-2 bg-[#f2b90d] rounded-full p-1 border-2 border-white shadow-sm z-10">
      <div className="-scale-y-100">
        <svg width="12" height="14" viewBox="0 0 14.02 16" fill="none">
          <path d={svgPaths.p2727a000} fill="#1C1917" />
        </svg>
      </div>
    </div>
  );
}

interface PaletteCardProps {
  palette: PaletteOption;
  selected: boolean;
  onClick: () => void;
}

export function PaletteCard({ palette, selected, onClick }: PaletteCardProps) {
  return (
    <button
      onClick={onClick}
      className={`relative rounded-xl text-left transition-all cursor-pointer w-full group ${
        selected
          ? "bg-[rgba(242,185,13,0.05)] ring-2 ring-[#f2b90d]"
          : "bg-white ring-1 ring-[#e7e5e4] hover:ring-[#d6d3d1]"
      }`}
    >
      {selected && <CheckBadge />}

      {/* Color swatches */}
      <div className="flex h-16 rounded-t-xl overflow-hidden">
        {palette.colors.slice(0, VISIBLE_PALETTE_COLOR_COUNT).map((color, i) => (
          <div
            key={i}
            className="flex-1 transition-transform duration-200"
            style={{ backgroundColor: color }}
          />
        ))}
      </div>

      {/* Label */}
      <div className="px-3.5 py-3">
        <span className="font-['Lexend',sans-serif] font-bold text-[13px] text-[#1c1917]">
          {palette.name}
        </span>
      </div>
    </button>
  );
}

interface CustomPaletteCardProps {
  colors: string[];
  selected: boolean;
  onClick: () => void;
  onColorsChange: (colors: string[]) => void;
}

export function CustomPaletteCard({ colors, selected, onClick, onColorsChange }: CustomPaletteCardProps) {
  const [showPopup, setShowPopup] = useState(false);
  const [draftColors, setDraftColors] = useState(
    colors.slice(0, VISIBLE_PALETTE_COLOR_COUNT)
  );
  const [activeSwatchIndex, setActiveSwatchIndex] = useState<number | null>(null);
  const popupRef = useRef<HTMLDivElement>(null);
  const cardRef = useRef<HTMLButtonElement>(null);
  const inputRefs = useRef<(HTMLInputElement | null)[]>([]);

  // Sync draft when colors change externally
  useEffect(() => {
    setDraftColors(colors.slice(0, VISIBLE_PALETTE_COLOR_COUNT));
  }, [colors]);

  // Close popup on outside click
  useEffect(() => {
    if (!showPopup) return;
    const handleClick = (e: MouseEvent) => {
      if (
        popupRef.current && !popupRef.current.contains(e.target as Node) &&
        cardRef.current && !cardRef.current.contains(e.target as Node)
      ) {
        setShowPopup(false);
      }
    };
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [showPopup]);

  const handleDraftChange = (index: number, value: string) => {
    const updated = [...draftColors];
    updated[index] = value;
    setDraftColors(updated);
  };

  const handleHexInput = (index: number, value: string) => {
    // Allow typing with or without #
    let hex = value.startsWith("#") ? value : `#${value}`;
    // Only update if it's a partial or complete hex
    if (/^#[0-9a-fA-F]{0,6}$/.test(hex)) {
      const updated = [...draftColors];
      updated[index] = hex;
      setDraftColors(updated);
    }
  };

  const handleRgbChange = (index: number, channel: "r" | "g" | "b", value: string) => {
    const num = value === "" ? 0 : parseInt(value, 10);
    if (isNaN(num) || num < 0 || num > 255) return;
    const hex = draftColors[index]?.length === 7 ? draftColors[index] : "#000000";
    const r = channel === "r" ? num : parseInt(hex.slice(1, 3), 16);
    const g = channel === "g" ? num : parseInt(hex.slice(3, 5), 16);
    const b = channel === "b" ? num : parseInt(hex.slice(5, 7), 16);
    const newHex = `#${r.toString(16).padStart(2, "0")}${g.toString(16).padStart(2, "0")}${b.toString(16).padStart(2, "0")}`;
    handleDraftChange(index, newHex);
  };

  const handleDone = () => {
    onColorsChange(draftColors);
    setShowPopup(false);
  };

  const handleCardClick = () => {
    onClick();
    setShowPopup(true);
    setDraftColors(colors.slice(0, VISIBLE_PALETTE_COLOR_COUNT));
  };

  return (
    <div className="relative">
      <button
        ref={cardRef}
        onClick={handleCardClick}
        className={`relative rounded-xl text-left transition-all cursor-pointer w-full group flex flex-col ${
          selected
            ? "bg-[rgba(242,185,13,0.05)] ring-2 ring-[#f2b90d]"
            : "bg-white ring-1 ring-[#e7e5e4] hover:ring-[#d6d3d1]"
        }`}
      >
        {selected && <CheckBadge />}

        {/* Color swatches preview */}
        <div className="flex h-16 w-full rounded-t-xl overflow-hidden">
          {colors.slice(0, VISIBLE_PALETTE_COLOR_COUNT).map((color, i) => (
            <div
              key={i}
              className="flex-1"
              style={{ backgroundColor: color }}
            />
          ))}
        </div>

        {/* Label */}
        <div className="px-3.5 py-3 flex items-center gap-1.5">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#78716c" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="13.5" cy="6.5" r="2.5" />
            <circle cx="17.5" cy="10.5" r="2.5" />
            <circle cx="8.5" cy="7.5" r="2.5" />
            <circle cx="6.5" cy="12" r="2.5" />
            <path d="M12 22C6.5 22 2 17.5 2 12S6.5 2 12 2s10 4.5 10 10c0 .9-.1 1.8-.3 2.5-.5 1.5-1.7 2.5-3.2 2.5h-2.6c-.9 0-1.6.7-1.6 1.6 0 .4.2.8.4 1.1.3.3.4.7.4 1.1 0 .9-.7 1.6-1.6 1.6H12z" />
          </svg>
          <span className="font-['Lexend',sans-serif] font-bold text-[13px] text-[#1c1917]">
            Custom
          </span>
        </div>
      </button>

      {/* Color picker popup */}
      {showPopup && (
        <div
          ref={popupRef}
          className="absolute z-50 bottom-full mb-3 right-0 flex items-center"
          onClick={(e) => e.stopPropagation()}
        >
          {/* Side color picker panel */}
          {activeSwatchIndex !== null && (
            <div className="relative w-[200px] rounded-2xl border border-[#e8e2ce] bg-[#fdfcf8] shadow-[0px_8px_30px_-4px_rgba(0,0,0,0.12)] p-4 mr-3">
              {/* Arrow pointing right toward main popup */}
              <div className="absolute top-1/2 -translate-y-1/2 -right-[8px] w-[14px] h-[14px] bg-[#fdfcf8] border-r border-b border-[#e8e2ce] rotate-[-45deg]" />
              <style>{`
                .goose-picker .react-colorful {
                  width: 100%;
                  height: auto;
                  border-radius: 10px;
                  overflow: hidden;
                }
                .goose-picker .react-colorful__saturation {
                  height: 140px;
                  border-radius: 8px;
                  border-bottom: none;
                }
                .goose-picker .react-colorful__hue,
                .goose-picker .react-colorful__alpha {
                  height: 14px;
                  border-radius: 7px;
                  margin-top: 10px;
                }
                .goose-picker .react-colorful__pointer {
                  width: 18px;
                  height: 18px;
                  border: 2.5px solid #fff;
                  box-shadow: 0 1px 4px rgba(0,0,0,0.2), 0 0 0 1px rgba(0,0,0,0.06);
                }
              `}</style>
              <div className="goose-picker">
                <HexColorPicker
                  color={draftColors[activeSwatchIndex]?.length === 7 ? draftColors[activeSwatchIndex] : "#000000"}
                  onChange={(newColor) => handleDraftChange(activeSwatchIndex, newColor)}
                />
              </div>
              {/* Color preview + label */}
              <div className="flex items-center justify-between mt-3">
                <span className="font-['Lexend',sans-serif] font-medium text-[11px] text-[#a8a29e]">
                  Color {activeSwatchIndex + 1}
                </span>
                <div
                  className="w-5 h-5 rounded border border-[#e8e2ce]"
                  style={{ backgroundColor: draftColors[activeSwatchIndex] }}
                />
              </div>
              {/* RGB values */}
              {(() => {
                const hex = draftColors[activeSwatchIndex]?.length === 7 ? draftColors[activeSwatchIndex] : "#000000";
                const r = parseInt(hex.slice(1, 3), 16);
                const g = parseInt(hex.slice(3, 5), 16);
                const b = parseInt(hex.slice(5, 7), 16);
                return (
                  <div className="mt-2 flex items-center gap-1 font-['Lexend',sans-serif] font-medium text-[11px] text-[#78716c]">
                    <label className="flex items-center gap-0.5 bg-white rounded border border-[#e8e2ce] px-1.5 py-0.5">
                      <span className="text-[10px] text-[#a8a29e]">R</span>
                      <input
                        type="text"
                        value={r}
                        onChange={(e) => handleRgbChange(activeSwatchIndex!, "r", e.target.value)}
                        className="w-[26px] bg-transparent text-[10px] text-[#1c1917] tracking-wide text-center focus:outline-none"
                        maxLength={3}
                        onClick={(e) => e.stopPropagation()}
                      />
                    </label>
                    <label className="flex items-center gap-0.5 bg-white rounded border border-[#e8e2ce] px-1.5 py-0.5">
                      <span className="text-[10px] text-[#a8a29e]">G</span>
                      <input
                        type="text"
                        value={g}
                        onChange={(e) => handleRgbChange(activeSwatchIndex!, "g", e.target.value)}
                        className="w-[26px] bg-transparent text-[10px] text-[#1c1917] tracking-wide text-center focus:outline-none"
                        maxLength={3}
                        onClick={(e) => e.stopPropagation()}
                      />
                    </label>
                    <label className="flex items-center gap-0.5 bg-white rounded border border-[#e8e2ce] px-1.5 py-0.5">
                      <span className="text-[10px] text-[#a8a29e]">B</span>
                      <input
                        type="text"
                        value={b}
                        onChange={(e) => handleRgbChange(activeSwatchIndex!, "b", e.target.value)}
                        className="w-[26px] bg-transparent text-[10px] text-[#1c1917] tracking-wide text-center focus:outline-none"
                        maxLength={3}
                        onClick={(e) => e.stopPropagation()}
                      />
                    </label>
                  </div>
                );
              })()}
            </div>
          )}

          {/* Main popup */}
          <div className="relative w-[280px] bg-white rounded-2xl border border-[#e7e5e4] shadow-[0px_8px_30px_-4px_rgba(0,0,0,0.12)] p-5">
            {/* Arrow */}
            <div className="absolute -bottom-[7px] right-6 w-3.5 h-3.5 bg-white border-r border-b border-[#e7e5e4] rotate-45" />

            <h4 className="font-['Lexend',sans-serif] font-bold text-[#1c1917] text-sm mb-1">
              Custom Colors
            </h4>
            <p className="font-['Lexend',sans-serif] font-normal text-[#a8a29e] text-xs mb-4">
              Pick 5 colors for your calendar events.
            </p>

            <div className="flex flex-col gap-2.5">
              {draftColors.map((color, i) => (
                <div key={i} className="flex items-center gap-3">
                  {/* Color swatch */}
                  <button
                    className={`w-9 h-9 rounded-lg border-2 cursor-pointer transition-all hover:shadow-md ${
                      activeSwatchIndex === i
                        ? "border-[#f2b90d] shadow-[0px_0px_0px_2px_rgba(242,185,13,0.3)]"
                        : "border-[#e7e5e4]"
                    }`}
                    style={{ backgroundColor: color }}
                    onClick={(e) => {
                      e.stopPropagation();
                      setActiveSwatchIndex(activeSwatchIndex === i ? null : i);
                    }}
                  />

                  {/* Hex input */}
                  <input
                    type="text"
                    value={color.toUpperCase()}
                    onChange={(e) => handleHexInput(i, e.target.value)}
                    maxLength={7}
                    className="flex-1 h-9 px-3 rounded-lg border border-[#e7e5e4] bg-[#faf9f6] font-['Lexend',sans-serif] font-medium text-[13px] text-[#1c1917] tracking-wide uppercase focus:outline-none focus:ring-2 focus:ring-[#f2b90d] focus:border-transparent transition-all"
                    onClick={(e) => e.stopPropagation()}
                    onFocus={() => setActiveSwatchIndex(i)}
                  />
                </div>
              ))}
            </div>

            {/* Done button */}
            <button
              onClick={(e) => {
                e.stopPropagation();
                handleDone();
              }}
              className="mt-5 w-full h-10 bg-[#f2b90d] hover:brightness-[1.03] rounded-xl font-['Lexend',sans-serif] font-bold text-[13px] text-[#1c1917] cursor-pointer transition-all shadow-[0px_0px_0px_2px_rgba(242,185,13,0.2)]"
            >
              Done
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
