import { useState } from "react";
import { useNavigate } from "react-router";
import { RouteGuard } from "./RouteGuard";
import { PaletteCard, palettes, CustomPaletteCard } from "./AppearanceCard";
import { useAppContext } from "./AppContext";
import { FlowFooter } from "./FlowFooter";
import {
  goosePageBackgroundStyle,
  goosePageHeadingClass,
  goosePageMainClass,
  goosePageShellClass,
  goosePanelClass,
  goosePanelDividerClass,
} from "../lib/designSystem";
import svgPaths from "../../imports/svg-muqjom28j6";
import type { GoogleCalendarExportProgress } from "../lib/googleCalendar";
import { resolveExportPaletteColors } from "../lib/palettes";
import type {
  EventGroup,
  ExportColorStrategy,
  ExportNotificationSetting,
} from "../lib/types";

const EXPORT_GROUP_ORDER: EventGroup[] = [
  "Lecture",
  "Tutorial",
  "Lab",
  "Assessments",
  "Assignments",
  "Office Hours",
  "Other",
];

const COLOR_STRATEGY_OPTIONS: Array<{
  value: ExportColorStrategy;
  label: string;
  description: string;
}> = [
  {
    value: "eventGroup",
    label: "By event type",
    description: "Give lectures, labs, assignments, and assessments their own color families.",
  },
  {
    value: "course",
    label: "By course",
    description: "Keep every event from the same course on the same color calendar.",
  },
];

const NOTIFICATION_OPTIONS: Array<{
  value: ExportNotificationSetting;
  label: string;
}> = [
  { value: "default", label: "Calendar default" },
  { value: "none", label: "No reminder" },
  { value: "atTime", label: "At event time" },
  { value: "10m", label: "10 minutes before" },
  { value: "30m", label: "30 minutes before" },
  { value: "1h", label: "1 hour before" },
  { value: "1d", label: "1 day before" },
];

const FALLBACK_NOTIFICATION_SETTINGS: Record<EventGroup, ExportNotificationSetting> = {
  Lecture: "default",
  Tutorial: "default",
  Lab: "default",
  "Office Hours": "default",
  Assessments: "default",
  Assignments: "default",
  Other: "default",
};

function GoogleCalendarIcon() {
  return (
    <svg width="24" height="28" viewBox="0 0 24.02 28" fill="none">
      <path d={svgPaths.p3ee3f5f0} fill="#1C1917" />
    </svg>
  );
}

function DownloadIcon() {
  return (
    <svg width="24" height="28" viewBox="0 0 24.02 28" fill="none">
      <path d={svgPaths.p174b9400} fill="black" />
    </svg>
  );
}

function InfoIcon() {
  return (
    <svg width="14" height="16" viewBox="0 0 14.02 16" fill="none">
      <path d={svgPaths.p36c900} fill="#A8A29E" />
    </svg>
  );
}

export default function ExportPage() {
  const navigate = useNavigate();
  const {
    courses,
    exportConfig,
    setPaletteId,
    setCustomColors,
    setColorStrategy,
    setNotificationSetting,
    exportValidationIssues,
    downloadCalendar,
    googleCalendarConfigured,
    exportToGoogleCalendar,
  } = useAppContext();
  const [successState, setSuccessState] = useState<{
    kind: "ics" | "google";
    calendarUrl?: string;
    eventCount?: number;
    calendarCount?: number;
  } | null>(null);
  const [googleError, setGoogleError] = useState("");
  const [isGoogleExporting, setIsGoogleExporting] = useState(false);
  const [googleExportProgress, setGoogleExportProgress] =
    useState<GoogleCalendarExportProgress | null>(null);
  const [showSettingsModal, setShowSettingsModal] = useState(false);
  const [settingsTab, setSettingsTab] = useState<"colors" | "notifications">("colors");
  const hasSelectedPalette = Boolean(exportConfig.paletteId);
  const colorStrategy = exportConfig.colorStrategy ?? "eventGroup";
  const notificationSettings = {
    ...FALLBACK_NOTIFICATION_SETTINGS,
    ...(exportConfig.notificationSettings ?? {}),
  };
  const palettePreviewColors = resolveExportPaletteColors(exportConfig);
  const coursePreviewItems = courses
    .slice()
    .sort((left, right) =>
      `${left.courseCode} ${left.term}`.localeCompare(`${right.courseCode} ${right.term}`)
    )
    .slice(0, 7)
    .map((course, index) => ({
      label: course.courseCode,
      color: palettePreviewColors[index % Math.max(palettePreviewColors.length, 1)] ?? "#f2b90d",
    }));
  const colorPreviewItems =
    colorStrategy === "eventGroup"
      ? EXPORT_GROUP_ORDER.map((group, index) => ({
          label: group,
          color:
            palettePreviewColors[index % Math.max(palettePreviewColors.length, 1)] ?? "#f2b90d",
        }))
      : coursePreviewItems;

  const handleDownloadICS = () => {
    if (exportValidationIssues.length > 0) return;
    downloadCalendar();
    setSuccessState({ kind: "ics" });
  };

  const handleGoogleCalendar = async () => {
    if (
      !googleCalendarConfigured ||
      !hasSelectedPalette ||
      exportValidationIssues.length > 0 ||
      isGoogleExporting
    ) {
      return;
    }

    try {
      setGoogleError("");
      setIsGoogleExporting(true);
      setGoogleExportProgress({
        completed: 0,
        total: 1,
        label: "Preparing Google Calendar export...",
      });
      const result = await exportToGoogleCalendar((progress) => {
        setGoogleExportProgress(progress);
      });
      setSuccessState({
        kind: "google",
        calendarUrl: result.calendarUrl,
        eventCount: result.eventCount,
        calendarCount: result.calendarCount,
      });
    } catch (error) {
      setGoogleError(
        error instanceof Error
          ? error.message
          : "Google Calendar export could not be completed."
      );
    } finally {
      setIsGoogleExporting(false);
      setGoogleExportProgress(null);
    }
  };

  const googleExportPercent = googleExportProgress
    ? Math.max(
        6,
        Math.min(
          100,
          Math.round(
            (googleExportProgress.completed / Math.max(googleExportProgress.total, 1)) * 100
          )
        )
      )
    : 0;

  return (
    <RouteGuard>
      <div
        className={goosePageShellClass}
        style={goosePageBackgroundStyle}
      >
        {successState && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 px-4 backdrop-blur-sm">
            <div className="flex w-full max-w-[420px] flex-col items-center rounded-2xl border border-[#e8e2ce] bg-white p-8 text-center shadow-[0px_20px_60px_-10px_rgba(28,24,13,0.15)]">
              <div className="mb-5 flex size-16 items-center justify-center rounded-full bg-[#f0fdf4]">
                <svg width="32" height="32" viewBox="0 0 24 24" fill="none">
                  <path d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" stroke="#16a34a" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
              </div>

              <h3 className="mb-2 font-['Inter',sans-serif] text-[22px] font-black tracking-[-0.5px] text-[#1c180d]">
                {successState.kind === "ics"
                  ? "ICS File Downloaded!"
                  : "Google Calendar Updated!"}
              </h3>
              <p className="mb-6 text-sm font-normal leading-relaxed text-[#78716c]">
                {successState.kind === "ics"
                  ? "Your .ics file has been downloaded. Import it into any calendar app to add your events."
                  : `Synced ${successState.eventCount ?? 0} included events across ${successState.calendarCount ?? 0} GooseCalendar Google calendars.`}
              </p>

              <div className="flex w-full gap-3">
                <button
                  onClick={() => setSuccessState(null)}
                  className="h-11 min-w-0 flex-[0.95] cursor-pointer rounded-xl border border-[#e8e2ce] bg-white px-5 text-sm font-medium text-[#78716c] transition-colors hover:bg-[#faf9f6]"
                >
                  Back to Export
                </button>
                {successState.kind === "google" ? (
                  <a
                    href={successState.calendarUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="flex h-11 min-w-0 flex-[1.15] cursor-pointer items-center justify-center rounded-xl bg-[#f2b90d] px-7 text-sm font-bold whitespace-nowrap text-[#1c180d] shadow-[0px_0px_0px_2px_rgba(242,185,13,0.2)] transition-all hover:brightness-[1.03]"
                  >
                    Open Google Calendar
                  </a>
                ) : (
                  <button
                    onClick={() => setSuccessState(null)}
                    className="h-11 min-w-0 flex-[1.15] cursor-pointer rounded-xl bg-[#f2b90d] px-7 text-sm font-bold text-[#1c180d] shadow-[0px_0px_0px_2px_rgba(242,185,13,0.2)] transition-all hover:brightness-[1.03]"
                  >
                    Done
                  </button>
                )}
              </div>
            </div>
          </div>
        )}

        {showSettingsModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 px-4 backdrop-blur-sm">
            <div className="flex max-h-[calc(100vh-2.5rem)] w-full max-w-[760px] flex-col overflow-hidden rounded-2xl border border-[#e8e2ce] bg-white shadow-[0px_20px_60px_-10px_rgba(28,24,13,0.18)]">
              <div className="flex items-start justify-between gap-4 border-b border-[#efe7cc] px-6 py-5 sm:px-8">
                <div>
                  <h3 className="font-['Inter',sans-serif] text-[24px] font-black tracking-[-0.5px] text-[#1c180d]">
                    Notification and Colour Settings
                  </h3>
                  <p className="mt-1 max-w-[520px] text-sm leading-relaxed text-[#78716c]">
                    Choose how GooseCalendar should color Google calendars, and decide which event
                    types should get reminders when you export.
                  </p>
                </div>
                <button
                  onClick={() => setShowSettingsModal(false)}
                  className="cursor-pointer rounded-full p-2 text-[#a8a29e] transition-colors hover:bg-[#faf7ef] hover:text-[#57534e]"
                  aria-label="Close settings"
                >
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
                    <path
                      d="M6 6l12 12M18 6L6 18"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                    />
                  </svg>
                </button>
              </div>

              <div className="overflow-y-auto px-6 py-6 sm:px-8">
                <div className="relative mb-6 inline-grid w-fit grid-cols-2 rounded-2xl border border-[#e8e2ce] bg-[#fcfbf7] p-1">
                  <div
                    className={`pointer-events-none absolute inset-y-1 left-1 w-[calc(50%-0.25rem)] rounded-xl bg-[#f2b90d] shadow-[0px_0px_0px_2px_rgba(242,185,13,0.18)] transition-transform duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] ${
                      settingsTab === "notifications" ? "translate-x-full" : "translate-x-0"
                    }`}
                  />
                  <button
                    onClick={() => setSettingsTab("colors")}
                    className={`relative z-10 cursor-pointer rounded-xl px-4 py-2 text-sm font-bold transition-colors duration-200 ${
                      settingsTab === "colors"
                        ? "text-[#1c180d]"
                        : "text-[#78716c] hover:text-[#1c180d]"
                    }`}
                  >
                    Colour settings
                  </button>
                  <button
                    onClick={() => setSettingsTab("notifications")}
                    className={`relative z-10 cursor-pointer rounded-xl px-4 py-2 text-sm font-bold transition-colors duration-200 ${
                      settingsTab === "notifications"
                        ? "text-[#1c180d]"
                        : "text-[#78716c] hover:text-[#1c180d]"
                    }`}
                  >
                    Notifications
                  </button>
                </div>

                {settingsTab === "colors" ? (
                  <section key="colors" className="animate-in fade-in-0 slide-in-from-bottom-1 duration-200 ease-out space-y-5">
                    <div>
                      <h4 className="font-['Lexend',sans-serif] text-sm font-bold uppercase tracking-[0.12em] text-[#a8a29e]">
                        Colour mode
                      </h4>
                      <div className="mt-3 grid gap-3 sm:grid-cols-2">
                        {COLOR_STRATEGY_OPTIONS.map((option) => {
                          const selected = colorStrategy === option.value;
                          return (
                            <button
                              key={option.value}
                              onClick={() => setColorStrategy(option.value)}
                              className={`cursor-pointer rounded-2xl border p-4 text-left transition-all ${
                                selected
                                  ? "border-[#f2b90d] bg-[#fffbeb] shadow-[0px_0px_0px_2px_rgba(242,185,13,0.16)]"
                                  : "border-[#e8e2ce] bg-[#fdfcf8] hover:border-[#d9cfb8]"
                              }`}
                            >
                              <div className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-3">
                                <div>
                                  <p className="font-['Lexend',sans-serif] text-base font-bold text-[#1c180d]">
                                    {option.label}
                                  </p>
                                  <p className="mt-1 text-sm leading-relaxed text-[#78716c]">
                                    {option.description}
                                  </p>
                                </div>
                                <span
                                  className={`rounded-full px-2.5 py-1 text-[11px] font-bold uppercase tracking-[0.08em] whitespace-nowrap ${
                                    selected
                                      ? "bg-[#f2b90d] text-[#1c180d]"
                                      : "pointer-events-none select-none opacity-0"
                                  }`}
                                >
                                  Active
                                </span>
                              </div>
                            </button>
                          );
                        })}
                      </div>
                    </div>

                    <div className="rounded-2xl border border-[#e8e2ce] bg-[#fcfbf7] p-4 sm:p-5">
                      <div className="flex flex-wrap items-center justify-between gap-3">
                        <div>
                          <h4 className="font-['Lexend',sans-serif] text-sm font-bold uppercase tracking-[0.12em] text-[#a8a29e]">
                            Colour preview
                          </h4>
                          <p className="mt-1 text-sm text-[#78716c]">
                            Preview how GooseCalendar will assign the selected palette.
                          </p>
                        </div>
                        {colorStrategy === "course" && courses.length > colorPreviewItems.length && (
                          <span className="text-xs font-medium text-[#78716c]">
                            +{courses.length - colorPreviewItems.length} more course{courses.length - colorPreviewItems.length === 1 ? "" : "s"}
                          </span>
                        )}
                      </div>
                      <div className="mt-4 grid gap-2">
                        {colorPreviewItems.map((item) => (
                          <div
                            key={item.label}
                            className="flex items-center justify-between rounded-xl border border-[#efe7cc] bg-white px-3 py-2"
                          >
                            <span className="font-['Lexend',sans-serif] text-sm font-medium text-[#57534e]">
                              {item.label}
                            </span>
                            <div className="flex items-center gap-2">
                              <div
                                className="h-5 w-5 rounded-full border border-[#e8e2ce]"
                                style={{ backgroundColor: item.color }}
                              />
                              <span className="font-mono text-xs text-[#78716c]">
                                {item.color}
                              </span>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  </section>
                ) : (
                  <section key="notifications" className="animate-in fade-in-0 slide-in-from-bottom-1 duration-200 ease-out space-y-4">
                    <div>
                      <h4 className="font-['Lexend',sans-serif] text-sm font-bold uppercase tracking-[0.12em] text-[#a8a29e]">
                        Notification settings
                      </h4>
                      <p className="mt-2 text-sm leading-relaxed text-[#78716c]">
                        Choose a reminder preset for each event type. Google export uses popup reminders, and ICS export adds alarms when you choose a specific reminder.
                      </p>
                    </div>
                    <div className="space-y-3">
                      {EXPORT_GROUP_ORDER.map((group) => (
                        <div
                          key={group}
                          className="grid items-center gap-3 rounded-2xl border border-[#e8e2ce] bg-[#fcfbf7] px-4 py-3 md:grid-cols-[minmax(0,1fr)_220px]"
                        >
                          <div>
                            <p className="font-['Lexend',sans-serif] text-sm font-bold text-[#1c180d]">
                              {group}
                            </p>
                            <p className="text-xs text-[#78716c]">
                              {group === "Lecture"
                                ? "Useful for weekly class reminders."
                                : group === "Assessments"
                                  ? "Great for midterms, tests, and quizzes."
                                  : group === "Assignments"
                                    ? "Helpful for due-date reminders."
                                    : "Optional reminder for this event type."}
                            </p>
                          </div>
                          <label className="block">
                            <span className="sr-only">{group} reminder setting</span>
                            <select
                              value={notificationSettings[group]}
                              onChange={(event) =>
                                setNotificationSetting(
                                  group,
                                  event.target.value as ExportNotificationSetting
                                )
                              }
                              className="h-11 w-full rounded-xl border border-[#e8e2ce] bg-white px-3 text-sm font-medium text-[#1c180d] outline-none transition-colors focus:border-[#f2b90d] focus:ring-2 focus:ring-[#f2b90d]/20"
                            >
                              {NOTIFICATION_OPTIONS.map((option) => (
                                <option key={option.value} value={option.value}>
                                  {option.label}
                                </option>
                              ))}
                            </select>
                          </label>
                        </div>
                      ))}
                    </div>
                  </section>
                )}
              </div>

              <div className="flex justify-end border-t border-[#efe7cc] px-6 py-4 sm:px-8">
                <button
                  onClick={() => setShowSettingsModal(false)}
                  className="cursor-pointer rounded-xl bg-[#f2b90d] px-5 py-3 text-sm font-bold text-[#1c180d] shadow-[0px_0px_0px_2px_rgba(242,185,13,0.18)] transition-all hover:brightness-[1.03]"
                >
                  Done
                </button>
              </div>
            </div>
          </div>
        )}

        <main className={goosePageMainClass}>
          <div className="mb-8 w-full max-w-[600px] text-center">
            <h1 className={`${goosePageHeadingClass} leading-[1.1] tracking-[-0.9px] sm:text-[36px]`}>
              Export Your Calendar
            </h1>
            <p className="mt-3 font-['Lexend',sans-serif] text-base font-normal text-[#78716c]">
              Your calendar is all set — choose how you'd like to export it below.
            </p>
          </div>

          <div className={`${goosePanelClass} max-w-[680px] rounded-2xl`}>
            <div className="p-6 sm:p-8">
              <h2 className="mb-5 font-['Lexend',sans-serif] text-lg font-bold text-[#1c180d]">
                Choose Export Method
              </h2>

              <div className="flex flex-col gap-3 sm:flex-row">
                <button
                  onClick={handleGoogleCalendar}
                  disabled={
                    !googleCalendarConfigured ||
                    !hasSelectedPalette ||
                    exportValidationIssues.length > 0 ||
                    isGoogleExporting
                  }
                  className={`flex flex-1 items-center justify-center gap-3 rounded-xl p-4 transition-all ${
                    !googleCalendarConfigured ||
                    !hasSelectedPalette ||
                    exportValidationIssues.length > 0 ||
                    isGoogleExporting
                      ? "cursor-not-allowed bg-[#ede9dd] text-[#a8a29e]"
                      : "cursor-pointer bg-[#f4f1e7] text-[#1c180d] shadow-[0px_0px_0px_2px_rgba(231,229,228,0.9)] hover:bg-[#efe7cc]"
                  }`}
                >
                  <div className="-scale-y-100">
                    <GoogleCalendarIcon />
                  </div>
                  <span className="font-['Lexend',sans-serif] text-base font-bold whitespace-nowrap sm:text-lg">
                    {isGoogleExporting ? "Exporting..." : "Google Calendar"}
                  </span>
                </button>

                <button
                  onClick={handleDownloadICS}
                  disabled={exportValidationIssues.length > 0}
                  className={`flex flex-1 items-center justify-center gap-3 rounded-xl p-4 transition-all ${
                    exportValidationIssues.length > 0
                      ? "cursor-not-allowed bg-[#ede9dd] text-[#a8a29e]"
                      : "cursor-pointer bg-[#f2b90d] shadow-[0px_0px_0px_3px_rgba(242,185,13,0.2)] hover:brightness-[1.02] hover:shadow-[0px_0px_0px_4px_rgba(242,185,13,0.3)]"
                  }`}
                >
                  <div className="-scale-y-100">
                    <DownloadIcon />
                  </div>
                  <span className="font-['Lexend',sans-serif] text-base font-bold whitespace-nowrap text-[#1c180d] sm:text-lg">
                    Download .ICS
                  </span>
                </button>
              </div>

              <div className="mt-4 flex items-center gap-2 mb-[-18px]">
                <div className="-scale-y-100 shrink-0">
                  <InfoIcon />
                </div>
                <span className="font-['Lexend',sans-serif] text-xs font-normal text-[#a8a29e]">
                  .ICS files don't support colors. Google export now uses separate GooseCalendar calendars per event type so your selected hex palette can be preserved.
                </span>
              </div>

              {googleCalendarConfigured && !hasSelectedPalette && (
                <p className="mt-6 text-sm font-medium text-[#b91c1c]">
                  Google Calendar export is disabled until you select a color palette.
                </p>
              )}

              {isGoogleExporting && googleExportProgress && (
                <div className="mt-5 rounded-xl border border-[#e8e2ce] bg-[#fcfbf7] px-4 py-3">
                  <div className="mb-2 flex items-center justify-between gap-3">
                    <p className="min-w-0 truncate font-['Lexend',sans-serif] text-sm font-medium text-[#57534e]">
                      {googleExportProgress.label}
                    </p>
                    <span className="shrink-0 font-['Lexend',sans-serif] text-xs font-semibold text-[#78716c]">
                      {googleExportPercent}%
                    </span>
                  </div>
                  <div className="mt-3 h-2 overflow-hidden rounded-full bg-[#efe7cc]">
                    <div
                      className="h-full rounded-full bg-[#f2b90d] transition-[width] duration-300 ease-out"
                      style={{ width: `${googleExportPercent}%` }}
                    />
                  </div>
                </div>
              )}
            </div>

            <div className={`border-t ${goosePanelDividerClass} px-6 pb-6 pt-6 sm:px-8 sm:pb-8 sm:pt-7`}>
              <div className="mb-5">
                <div>
                  <h3 className="mb-1 font-['Lexend',sans-serif] text-base font-bold text-[#1c180d]">
                    Color palette
                  </h3>
                  <p className="text-sm font-normal leading-relaxed text-[#78716c]">
                    Pick a palette before exporting to Google Calendar so each event-type calendar gets its color.
                  </p>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
                {palettes.map((palette) => (
                  <PaletteCard
                    key={palette.id}
                    palette={palette}
                    selected={exportConfig.paletteId === palette.id}
                    onClick={() => setPaletteId(palette.id)}
                  />
                ))}
                <CustomPaletteCard
                  colors={exportConfig.customColors}
                  selected={exportConfig.paletteId === "custom"}
                  onClick={() => setPaletteId("custom")}
                  onColorsChange={setCustomColors}
                />
              </div>

              <div className="mt-5">
                <button
                  onClick={() => setShowSettingsModal(true)}
                  className="flex w-full cursor-pointer items-center justify-between rounded-2xl border border-[#e8e2ce] bg-[#fcfbf7] px-4 py-4 text-left transition-all hover:border-[#d9cfb8] hover:bg-[#faf7ef]"
                >
                  <div className="flex min-w-0 items-center gap-3">
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[#fff6d8] text-[#8f6a00]">
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                        <path
                          d="M4 6h16"
                          stroke="currentColor"
                          strokeWidth="1.8"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        />
                        <path
                          d="M4 12h16"
                          stroke="currentColor"
                          strokeWidth="1.8"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        />
                        <path
                          d="M4 18h16"
                          stroke="currentColor"
                          strokeWidth="1.8"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        />
                        <path
                          d="M9 4v4"
                          stroke="currentColor"
                          strokeWidth="1.8"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        />
                        <path
                          d="M15 10v4"
                          stroke="currentColor"
                          strokeWidth="1.8"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        />
                        <path
                          d="M12 16v4"
                          stroke="currentColor"
                          strokeWidth="1.8"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        />
                      </svg>
                    </div>
                    <div className="min-w-0">
                      <p className="font-['Lexend',sans-serif] text-sm font-bold text-[#1c180d] sm:text-base">
                        Notification and Colour Settings
                      </p>
                      <p className="mt-0.5 text-xs leading-relaxed text-[#78716c] sm:text-sm">
                        Choose colour grouping and reminder defaults before you export.
                      </p>
                    </div>
                  </div>
                  <svg
                    width="18"
                    height="18"
                    viewBox="0 0 24 24"
                    fill="none"
                    className="ml-3 shrink-0 text-[#a8a29e]"
                    aria-hidden="true"
                  >
                    <path
                      d="M9 6l6 6-6 6"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                </button>
              </div>
            </div>
          </div>

          {!googleCalendarConfigured && (
            <div className="mt-6 w-full max-w-[680px] rounded-xl border border-[#fde68a] bg-[#fffbeb] px-5 py-4">
              <h3 className="font-['Lexend',sans-serif] text-sm font-bold text-[#92400e]">
                Google Calendar needs one env var
              </h3>
              <p className="mt-2 text-sm text-[#92400e]">
                Set <code>VITE_GOOGLE_CLIENT_ID</code> in your environment, then reload the app to enable Google export.
              </p>
            </div>
          )}

          {googleError && (
            <div className="mt-6 w-full max-w-[680px] rounded-xl border border-[#fecaca] bg-[#fef2f2] px-5 py-4">
              <h3 className="font-['Lexend',sans-serif] text-sm font-bold text-[#b91c1c]">
                Google Calendar export failed
              </h3>
              <p className="mt-2 text-sm text-[#b91c1c]">{googleError}</p>
            </div>
          )}

          {exportValidationIssues.length > 0 && (
            <div className="mt-6 w-full max-w-[680px] rounded-xl border border-[#fecaca] bg-[#fef2f2] px-5 py-4">
              <h3 className="font-['Lexend',sans-serif] text-sm font-bold text-[#b91c1c]">
                Fix these items before export
              </h3>
              <div className="mt-3 flex flex-col gap-2">
                {exportValidationIssues.map((issue) => (
                  <p key={`${issue.eventId}-${issue.message}`} className="text-sm text-[#b91c1c]">
                    <span className="font-semibold">{issue.eventLabel}</span>: {issue.message}
                  </p>
                ))}
              </div>
            </div>
          )}
        </main>

        <FlowFooter
          backLabel="Back to Review"
          onBack={() => navigate("/review")}
        />
      </div>
    </RouteGuard>
  );
}
