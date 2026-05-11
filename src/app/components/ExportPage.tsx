import { useRef, useState } from "react";
import { useNavigate } from "react-router";
import { RouteGuard } from "./RouteGuard";
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
import { trackAnalyticsEvent } from "../lib/analytics";
import { PaletteCard, CustomPaletteCard, palettes } from "./AppearanceCard";
import {
  googleEventColorHex,
  googleEventColorOptions,
  googleEventColorPalettes,
  resolveExportPaletteColors,
} from "../lib/palettes";
import {
  GOOGLE_CALENDAR_LIST_COLOR_EXPORT_ENABLED,
  type GoogleCalendarExportProgress,
} from "../lib/googleCalendar";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "./ui/select";
import type {
  EventGroup,
  ExportColorStrategy,
  ExportNotificationSetting,
  GoogleCalendarMode,
  GoogleEventColorMode,
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
  { value: "custom", label: "Custom time" },
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

const FALLBACK_CUSTOM_NOTIFICATION_MINUTES: Record<EventGroup, number> = {
  Lecture: 15,
  Tutorial: 15,
  Lab: 15,
  "Office Hours": 15,
  Assessments: 15,
  Assignments: 15,
  Other: 15,
};

const GOOGLE_CALENDAR_MODE_OPTIONS: Array<{
  value: GoogleCalendarMode;
  label: string;
}> = [
  { value: "single", label: "One calendar" },
  { value: "many", label: "By event type" },
];

const GOOGLE_EVENT_COLOR_MODE_OPTIONS: Array<{
  value: GoogleEventColorMode;
  label: string;
}> = [
  { value: "uniform", label: "Uniform" },
  { value: "eventGroup", label: "By event type" },
];

const COLOR_STRATEGY_OPTIONS: Array<{
  value: ExportColorStrategy;
  label: string;
}> = [
  { value: "eventGroup", label: "By event type" },
  { value: "course", label: "By course" },
];

type NotificationUnit = "minutes" | "hours" | "days" | "weeks";

type SuccessState =
  | { kind: "ics" }
  | {
      kind: "google";
      eventCount: number;
      calendarCount: number;
      calendarUrl: string;
    }
  | null;

const NOTIFICATION_UNIT_OPTIONS: Array<{
  value: NotificationUnit;
  label: string;
  singularLabel: string;
  minutes: number;
}> = [
  { value: "minutes", label: "Minutes", singularLabel: "Minute", minutes: 1 },
  { value: "hours", label: "Hours", singularLabel: "Hour", minutes: 60 },
  { value: "days", label: "Days", singularLabel: "Day", minutes: 1440 },
  { value: "weeks", label: "Weeks", singularLabel: "Week", minutes: 10080 },
];

function inferNotificationUnit(minutes: number): NotificationUnit {
  if (minutes % 10080 === 0) return "weeks";
  if (minutes % 1440 === 0) return "days";
  if (minutes % 60 === 0) return "hours";
  return "minutes";
}

function notificationValueForUnit(minutes: number, unit: NotificationUnit) {
  const divisor =
    NOTIFICATION_UNIT_OPTIONS.find((option) => option.value === unit)?.minutes ?? 1;
  return Math.max(1, Math.round(minutes / divisor));
}

function notificationMinutesFromValue(value: number, unit: NotificationUnit) {
  const multiplier =
    NOTIFICATION_UNIT_OPTIONS.find((option) => option.value === unit)?.minutes ?? 1;
  return Math.max(1, value * multiplier);
}

function notificationUnitLabelForCount(value: number, unit: NotificationUnit) {
  const option = NOTIFICATION_UNIT_OPTIONS.find((entry) => entry.value === unit);
  if (!option) return "Minutes";
  return value === 1 ? option.singularLabel : option.label;
}

function buildNotificationUnitState(minutesByGroup: Record<EventGroup, number>) {
  return {
    Lecture: inferNotificationUnit(minutesByGroup.Lecture),
    Tutorial: inferNotificationUnit(minutesByGroup.Tutorial),
    Lab: inferNotificationUnit(minutesByGroup.Lab),
    "Office Hours": inferNotificationUnit(minutesByGroup["Office Hours"]),
    Assessments: inferNotificationUnit(minutesByGroup.Assessments),
    Assignments: inferNotificationUnit(minutesByGroup.Assignments),
    Other: inferNotificationUnit(minutesByGroup.Other),
  } satisfies Record<EventGroup, NotificationUnit>;
}

function buildNotificationInputState(
  minutesByGroup: Record<EventGroup, number>,
  unitsByGroup: Record<EventGroup, NotificationUnit>
) {
  return {
    Lecture: String(
      notificationValueForUnit(minutesByGroup.Lecture, unitsByGroup.Lecture)
    ),
    Tutorial: String(
      notificationValueForUnit(minutesByGroup.Tutorial, unitsByGroup.Tutorial)
    ),
    Lab: String(notificationValueForUnit(minutesByGroup.Lab, unitsByGroup.Lab)),
    "Office Hours": String(
      notificationValueForUnit(
        minutesByGroup["Office Hours"],
        unitsByGroup["Office Hours"]
      )
    ),
    Assessments: String(
      notificationValueForUnit(minutesByGroup.Assessments, unitsByGroup.Assessments)
    ),
    Assignments: String(
      notificationValueForUnit(minutesByGroup.Assignments, unitsByGroup.Assignments)
    ),
    Other: String(notificationValueForUnit(minutesByGroup.Other, unitsByGroup.Other)),
  } satisfies Record<EventGroup, string>;
}

function DownloadIcon() {
  return (
    <svg width="24" height="28" viewBox="0 0 24.02 28" fill="none">
      <path d={svgPaths.p174b9400} fill="black" />
    </svg>
  );
}

function GoogleCalendarIcon() {
  return (
    <svg width="26" height="26" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <rect x="3" y="4" width="18" height="17" rx="3" fill="#fff" />
      <path d="M7 2v4M17 2v4M3 9h18" stroke="#1a73e8" strokeWidth="1.8" strokeLinecap="round" />
      <path d="M8.5 14.8a3.7 3.7 0 016.5-2.4" stroke="#34a853" strokeWidth="1.8" strokeLinecap="round" />
      <path d="M15 14.8a3.7 3.7 0 01-6.5 2.4" stroke="#ea4335" strokeWidth="1.8" strokeLinecap="round" />
      <path d="M12 12.5h3v3" stroke="#fbbc04" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function SettingsIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M4 6h16M4 12h16M4 18h16"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M9 4v4M15 10v4M12 16v4"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function SegmentedControl<T extends string>({
  value,
  options,
  onChange,
  ariaLabel,
}: {
  value: T;
  options: Array<{ value: T; label: string }>;
  onChange: (value: T) => void;
  ariaLabel: string;
}) {
  return (
    <div
      className="mx-auto grid w-full rounded-full bg-[#f6f1df] p-1"
      style={{ gridTemplateColumns: `repeat(${options.length}, minmax(0, 1fr))` }}
      role="group"
      aria-label={ariaLabel}
    >
      {options.map((option) => {
        const selected = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            onClick={() => onChange(option.value)}
            className={`h-9 cursor-pointer rounded-full px-3 text-center font-['Lexend',sans-serif] text-xs font-bold transition-all sm:text-sm ${
              selected
                ? "bg-white text-[#1c180d] shadow-[0px_4px_18px_-12px_rgba(28,24,13,0.55)]"
                : "text-[#78716c] hover:text-[#1c180d]"
            }`}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

function courseMappingLabel(course: { courseCode: string; courseName: string }) {
  return course.courseCode || course.courseName || "Course";
}

export default function ExportPage() {
  const navigate = useNavigate();
  const {
    courses,
    exportConfig,
    adminModeEnabled,
    setPaletteId,
    setCustomColors,
    setColorStrategy,
    setGoogleCalendarMode,
    setGoogleEventColorMode,
    setGoogleUniformColorId,
    setNotificationSetting,
    setCustomNotificationMinutes,
    exportValidationIssues,
    googleCalendarConfigured,
    exportToGoogleCalendar,
    downloadCalendar,
  } = useAppContext();
  const [successState, setSuccessState] = useState<SuccessState>(null);
  const [showSettingsModal, setShowSettingsModal] = useState(false);
  const [isGoogleExporting, setIsGoogleExporting] = useState(false);
  const [googleExportProgress, setGoogleExportProgress] =
    useState<GoogleCalendarExportProgress | null>(null);
  const [googleError, setGoogleError] = useState("");
  const googleStatusRef = useRef<HTMLDivElement>(null);
  const googleCalendarMode = exportConfig.googleCalendarMode ?? "single";
  const googleEventColorMode = exportConfig.googleEventColorMode ?? "uniform";
  const googleUniformColorId = exportConfig.googleUniformColorId ?? "5";
  const activePaletteId = palettes.some((palette) => palette.id === exportConfig.paletteId)
    ? exportConfig.paletteId
    : palettes[0]?.id ?? "matcha";
  const palettePreviewConfig =
    exportConfig.paletteId === "custom"
      ? exportConfig
      : { ...exportConfig, paletteId: activePaletteId };
  const paletteMappingColors = resolveExportPaletteColors(palettePreviewConfig);
  const eventGroupColorMappings = EXPORT_GROUP_ORDER.map((group, index) => ({
    label: group,
    color: paletteMappingColors[index % paletteMappingColors.length],
  }));
  const uniqueCourses = Array.from(
    new Map(courses.map((course) => [course.id, course])).values()
  ).sort((left, right) =>
    `${left.courseCode} ${left.term}`.localeCompare(`${right.courseCode} ${right.term}`)
  );
  const courseColorMappings = uniqueCourses.map((course, index) => ({
    label: courseMappingLabel(course),
    detail: course.term,
    color: paletteMappingColors[index % paletteMappingColors.length],
  }));
  const notificationSettings = {
    ...FALLBACK_NOTIFICATION_SETTINGS,
    ...(exportConfig.notificationSettings ?? {}),
  };
  const customNotificationMinutes = {
    ...FALLBACK_CUSTOM_NOTIFICATION_MINUTES,
    ...(exportConfig.customNotificationMinutes ?? {}),
  };
  const [draftNotificationSettings, setDraftNotificationSettings] =
    useState<Record<EventGroup, ExportNotificationSetting>>(notificationSettings);
  const [draftCustomNotificationMinutes, setDraftCustomNotificationMinutes] =
    useState<Record<EventGroup, number>>(customNotificationMinutes);
  const [draftGoogleCalendarMode, setDraftGoogleCalendarMode] =
    useState<GoogleCalendarMode>(googleCalendarMode);
  const [customNotificationUnits, setCustomNotificationUnits] = useState<
    Record<EventGroup, NotificationUnit>
  >(() => buildNotificationUnitState(customNotificationMinutes));
  const [customNotificationInputs, setCustomNotificationInputs] = useState<
    Record<EventGroup, string>
  >(() => {
    const units = buildNotificationUnitState(customNotificationMinutes);
    return buildNotificationInputState(customNotificationMinutes, units);
  });
  const exportTrackingParams = {
    course_count: courses.length,
    validation_issue_count: exportValidationIssues.length,
    admin_mode: adminModeEnabled,
  };

  const openSettingsModal = () => {
    const currentNotificationSettings = {
      ...FALLBACK_NOTIFICATION_SETTINGS,
      ...(exportConfig.notificationSettings ?? {}),
    };
    const currentCustomNotificationMinutes = {
      ...FALLBACK_CUSTOM_NOTIFICATION_MINUTES,
      ...(exportConfig.customNotificationMinutes ?? {}),
    };
    const currentUnits = buildNotificationUnitState(currentCustomNotificationMinutes);

    setDraftNotificationSettings(currentNotificationSettings);
    setDraftCustomNotificationMinutes(currentCustomNotificationMinutes);
    setDraftGoogleCalendarMode(exportConfig.googleCalendarMode ?? "single");
    setCustomNotificationUnits(currentUnits);
    setCustomNotificationInputs(
      buildNotificationInputState(currentCustomNotificationMinutes, currentUnits)
    );
    setShowSettingsModal(true);
  };

  const applySettingsModal = () => {
    const normalizedCustomNotificationMinutes = { ...draftCustomNotificationMinutes };

    EXPORT_GROUP_ORDER.forEach((group) => {
      const parsedValue = Number.parseInt(customNotificationInputs[group], 10);
      const displayValue = Number.isFinite(parsedValue) && parsedValue > 0 ? parsedValue : 1;
      normalizedCustomNotificationMinutes[group] = notificationMinutesFromValue(
        displayValue,
        customNotificationUnits[group]
      );
    });

    if (adminModeEnabled) {
      setGoogleCalendarMode(draftGoogleCalendarMode);
    }
    EXPORT_GROUP_ORDER.forEach((group) => {
      setNotificationSetting(group, draftNotificationSettings[group]);
      setCustomNotificationMinutes(group, normalizedCustomNotificationMinutes[group]);
    });
    setShowSettingsModal(false);
  };

  const handleDownloadICS = () => {
    void trackAnalyticsEvent("export_ics_clicked", {
      ...exportTrackingParams,
      blocked: exportValidationIssues.length > 0,
    });
    if (exportValidationIssues.length > 0) return;
    downloadCalendar();
    void trackAnalyticsEvent("export_ics_downloaded", exportTrackingParams);
    setSuccessState({ kind: "ics" });
  };

  const handleGoogleCalendarExport = async () => {
    void trackAnalyticsEvent("export_google_clicked", {
      ...exportTrackingParams,
      blocked: exportValidationIssues.length > 0,
      configured: googleCalendarConfigured,
      google_calendar_mode: googleCalendarMode,
      google_color_mode: googleEventColorMode,
    });

    if (exportValidationIssues.length > 0) return;

    if (!googleCalendarConfigured) {
      setGoogleError("Google Calendar export is not configured for this build.");
      googleStatusRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
      return;
    }

    setGoogleError("");
    setGoogleExportProgress({
      completed: 0,
      total: 1,
      label: "Preparing Google Calendar export...",
    });
    setIsGoogleExporting(true);

    try {
      const result = await exportToGoogleCalendar(setGoogleExportProgress);
      void trackAnalyticsEvent("export_google_succeeded", {
        ...exportTrackingParams,
        event_count: result.eventCount,
        calendar_count: result.calendarCount,
        google_calendar_mode: googleCalendarMode,
        google_color_mode: googleEventColorMode,
      });
      setSuccessState({
        kind: "google",
        eventCount: result.eventCount,
        calendarCount: result.calendarCount,
        calendarUrl: result.calendarUrl,
      });
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : "Google Calendar export failed. Please try again.";
      setGoogleError(message);
      void trackAnalyticsEvent("export_google_failed", {
        ...exportTrackingParams,
        message,
      });
    } finally {
      setIsGoogleExporting(false);
    }
  };

  const googleProgressPercent = googleExportProgress
    ? Math.min(
        100,
        Math.round((googleExportProgress.completed / googleExportProgress.total) * 100)
      )
    : 0;
  const settingsTitle = adminModeEnabled
    ? "Notification and Calendar Settings"
    : "Notification Settings";

  return (
    <RouteGuard>
      <div className={goosePageShellClass} style={goosePageBackgroundStyle}>
        {successState && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 px-4 backdrop-blur-sm">
            <div className="flex w-full max-w-[420px] flex-col items-center rounded-2xl border border-[#e8e2ce] bg-white p-8 text-center shadow-[0px_20px_60px_-10px_rgba(28,24,13,0.15)]">
              <div className="mb-5 flex size-16 items-center justify-center rounded-full bg-[#f0fdf4]">
                <svg width="32" height="32" viewBox="0 0 24 24" fill="none">
                  <path d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" stroke="#16a34a" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
              </div>

              <h3 className="mb-2 font-['Inter',sans-serif] text-[22px] font-black tracking-[-0.5px] text-[#1c180d]">
                {successState.kind === "google"
                  ? "Google Calendar Updated!"
                  : "ICS File Downloaded!"}
              </h3>
              <p className="mb-6 text-sm font-normal leading-relaxed text-[#78716c]">
                {successState.kind === "google"
                  ? `${successState.eventCount} events were exported across ${successState.calendarCount} calendar${successState.calendarCount === 1 ? "" : "s"}.`
                  : "Your .ics file has been downloaded. Import it into any calendar app to add your events."}
              </p>

              <div className="flex w-full gap-3">
                <button
                  onClick={() => setSuccessState(null)}
                  className="h-11 min-w-0 flex-1 cursor-pointer rounded-xl border border-[#e8e2ce] bg-white px-5 text-sm font-medium text-[#78716c] transition-colors hover:bg-[#faf9f6]"
                >
                  Back to Export
                </button>
                {successState.kind === "google" ? (
                  <a
                    href={successState.calendarUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="flex h-11 min-w-0 flex-1 cursor-pointer items-center justify-center rounded-xl bg-[#f2b90d] px-7 text-sm font-bold text-[#1c180d] shadow-[0px_0px_0px_2px_rgba(242,185,13,0.2)] transition-all hover:brightness-[1.03]"
                  >
                    Open Calendar
                  </a>
                ) : (
                  <button
                    onClick={() => setSuccessState(null)}
                    className="h-11 min-w-0 flex-1 cursor-pointer rounded-xl bg-[#f2b90d] px-7 text-sm font-bold text-[#1c180d] shadow-[0px_0px_0px_2px_rgba(242,185,13,0.2)] transition-all hover:brightness-[1.03]"
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
                    {settingsTitle}
                  </h3>
                  <p className="mt-1 max-w-[520px] text-sm leading-relaxed text-[#78716c]">
                    Choose reminder defaults for exported calendar events.
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

              <div className="space-y-7 overflow-y-auto px-6 py-6 sm:px-8">
                {adminModeEnabled && (
                  <section className="space-y-4">
                    <div>
                      <h4 className="font-['Lexend',sans-serif] text-sm font-bold uppercase tracking-[0.12em] text-[#a8a29e]">
                        Google Calendar layout
                      </h4>
                    </div>
                    <SegmentedControl
                      value={draftGoogleCalendarMode}
                      options={GOOGLE_CALENDAR_MODE_OPTIONS}
                      onChange={setDraftGoogleCalendarMode}
                      ariaLabel="Google Calendar layout"
                    />
                  </section>
                )}

                <section className="animate-in fade-in-0 slide-in-from-bottom-1 space-y-4 duration-200 ease-out">
                  <div>
                    <h4 className="font-['Lexend',sans-serif] text-sm font-bold uppercase tracking-[0.12em] text-[#a8a29e]">
                      Notification settings
                    </h4>
                    <p className="mt-2 text-sm leading-relaxed text-[#78716c]">
                      ICS export adds alarms when you choose a specific reminder.
                    </p>
                  </div>
                  <div className="space-y-3">
                    {EXPORT_GROUP_ORDER.map((group) => (
                      <div
                        key={group}
                        className="grid items-start gap-3 rounded-2xl border border-[#e8e2ce] bg-[#fcfbf7] px-4 py-3 md:grid-cols-[minmax(0,1fr)_220px]"
                      >
                        <div>
                          <p className="font-['Lexend',sans-serif] text-sm font-bold text-[#1c180d]">
                            {group}
                          </p>
                          <p className="text-xs text-[#78716c]">
                            Optional reminder for this event type.
                          </p>
                        </div>
                        <label className="block">
                          <span className="sr-only">{group} reminder setting</span>
                          <Select
                            value={draftNotificationSettings[group]}
                            onValueChange={(value) =>
                              setDraftNotificationSettings((current) => ({
                                ...current,
                                [group]: value as ExportNotificationSetting,
                              }))
                            }
                          >
                            <SelectTrigger className="h-11 w-full cursor-pointer rounded-xl border-[#e8e2ce] bg-white px-3 text-sm font-medium text-[#1c180d] shadow-none transition-colors focus-visible:border-[#f2b90d] focus-visible:ring-2 focus-visible:ring-[#f2b90d]/20">
                              <SelectValue placeholder="Calendar default" />
                            </SelectTrigger>
                            <SelectContent className="z-[80] rounded-2xl border-[#e8e2ce] bg-[#fffdf9] p-1.5 shadow-[0px_20px_50px_-20px_rgba(28,24,13,0.35)]">
                              {NOTIFICATION_OPTIONS.map((option) => (
                                <SelectItem
                                  key={option.value}
                                  value={option.value}
                                  className="cursor-pointer rounded-xl px-3 py-2 text-sm font-medium text-[#1c180d] focus:bg-[#fff7df] focus:text-[#1c180d] data-[state=checked]:bg-[#fff1cc] data-[state=checked]:text-[#1c180d]"
                                >
                                  {option.label}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </label>
                        {draftNotificationSettings[group] === "custom" && (
                          <div className="md:col-start-2">
                            <div className="grid gap-2 sm:grid-cols-[88px_minmax(0,1fr)]">
                              <input
                                type="number"
                                min={1}
                                step={1}
                                value={customNotificationInputs[group]}
                                onChange={(event) => {
                                  const rawValue = event.target.value;
                                  if (rawValue !== "" && !/^\d+$/.test(rawValue)) return;
                                  setCustomNotificationInputs((current) => ({
                                    ...current,
                                    [group]: rawValue,
                                  }));
                                  if (!rawValue) return;
                                  const nextValue = Number.parseInt(rawValue, 10);
                                  setDraftCustomNotificationMinutes((current) => ({
                                    ...current,
                                    [group]: notificationMinutesFromValue(
                                      Number.isFinite(nextValue) && nextValue > 0 ? nextValue : 1,
                                      customNotificationUnits[group]
                                    ),
                                  }));
                                }}
                                onBlur={() => {
                                  const parsedValue = Number.parseInt(
                                    customNotificationInputs[group],
                                    10
                                  );
                                  const normalizedValue =
                                    Number.isFinite(parsedValue) && parsedValue > 0
                                      ? parsedValue
                                      : 1;
                                  setCustomNotificationInputs((current) => ({
                                    ...current,
                                    [group]: String(normalizedValue),
                                  }));
                                  setDraftCustomNotificationMinutes((current) => ({
                                    ...current,
                                    [group]: notificationMinutesFromValue(
                                      normalizedValue,
                                      customNotificationUnits[group]
                                    ),
                                  }));
                                }}
                                onFocus={(event) => event.currentTarget.select()}
                                className="h-10 w-full rounded-lg border border-[#e8e2ce] bg-white px-3 font-['Inter',sans-serif] text-sm font-semibold text-[#1c180d] outline-none focus:border-[#f2b90d] focus:ring-2 focus:ring-[#f2b90d]/20"
                              />
                              <Select
                                value={customNotificationUnits[group]}
                                onValueChange={(value) => {
                                  const nextUnit = value as NotificationUnit;
                                  const parsedValue = Number.parseInt(
                                    customNotificationInputs[group],
                                    10
                                  );
                                  const displayValue =
                                    Number.isFinite(parsedValue) && parsedValue > 0
                                      ? parsedValue
                                      : 1;
                                  setCustomNotificationUnits((current) => ({
                                    ...current,
                                    [group]: nextUnit,
                                  }));
                                  setCustomNotificationInputs((current) => ({
                                    ...current,
                                    [group]: String(displayValue),
                                  }));
                                  setDraftCustomNotificationMinutes((current) => ({
                                    ...current,
                                    [group]: notificationMinutesFromValue(displayValue, nextUnit),
                                  }));
                                }}
                              >
                                <SelectTrigger className="h-10 w-full cursor-pointer rounded-lg border-[#e8e2ce] bg-white px-3 text-sm font-medium text-[#1c180d] shadow-none focus-visible:border-[#f2b90d] focus-visible:ring-2 focus-visible:ring-[#f2b90d]/20">
                                  <span>
                                    {notificationUnitLabelForCount(
                                      notificationValueForUnit(
                                        draftCustomNotificationMinutes[group],
                                        customNotificationUnits[group]
                                      ),
                                      customNotificationUnits[group]
                                    )}
                                  </span>
                                </SelectTrigger>
                                <SelectContent className="z-[80] rounded-2xl border-[#e8e2ce] bg-[#fffdf9] p-1.5 shadow-[0px_20px_50px_-20px_rgba(28,24,13,0.35)]">
                                  {NOTIFICATION_UNIT_OPTIONS.map((option) => (
                                    <SelectItem
                                      key={option.value}
                                      value={option.value}
                                      className="cursor-pointer rounded-xl px-3 py-2 text-sm font-medium text-[#1c180d] focus:bg-[#fff7df] focus:text-[#1c180d] data-[state=checked]:bg-[#fff1cc] data-[state=checked]:text-[#1c180d]"
                                    >
                                      {option.label}
                                    </SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                              <p className="text-xs text-[#78716c] sm:col-span-2">
                                {notificationUnitLabelForCount(
                                  Number.parseInt(customNotificationInputs[group], 10) > 0
                                    ? Number.parseInt(customNotificationInputs[group], 10)
                                    : 1,
                                  customNotificationUnits[group]
                                ).toLowerCase()} before the event
                              </p>
                            </div>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </section>
              </div>

              <div className="flex justify-end border-t border-[#efe7cc] px-6 py-4 sm:px-8">
                <button
                  onClick={applySettingsModal}
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
            <h1 className={goosePageHeadingClass}>Export Your Calendar</h1>
            <p className="mt-3 font-['Lexend',sans-serif] text-base font-normal text-[#78716c]">
              Your calendar is all set. Download an import-ready ICS file below.
            </p>
          </div>

          <div className={`${goosePanelClass} max-w-[760px] rounded-2xl`}>
            <div className="p-6 sm:p-8">
              <h2 className="mb-5 font-['Lexend',sans-serif] text-lg font-bold text-[#1c180d]">
                {adminModeEnabled ? "Choose Export Method" : "Download Calendar"}
              </h2>

              <div className={adminModeEnabled ? "grid gap-3 md:grid-cols-2" : ""}>
                {adminModeEnabled && (
                  <button
                    onClick={handleGoogleCalendarExport}
                    disabled={exportValidationIssues.length > 0 || isGoogleExporting}
                    className={`flex w-full items-center justify-center gap-3 rounded-xl p-4 transition-all ${
                      exportValidationIssues.length > 0 || isGoogleExporting
                        ? "cursor-not-allowed bg-[#ede9dd] text-[#a8a29e]"
                        : "cursor-pointer border border-[#d8e3fb] bg-white text-[#1c180d] shadow-[0px_0px_0px_3px_rgba(66,133,244,0.12)] hover:bg-[#f8fbff]"
                    }`}
                  >
                    <GoogleCalendarIcon />
                    <span className="font-['Lexend',sans-serif] text-base font-bold whitespace-nowrap sm:text-lg">
                      {isGoogleExporting ? "Exporting..." : "Export to Google"}
                    </span>
                  </button>
                )}

                <button
                  onClick={handleDownloadICS}
                  disabled={exportValidationIssues.length > 0}
                  className={`flex w-full items-center justify-center gap-3 rounded-xl p-4 transition-all ${
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

              <p className="mt-4 font-['Lexend',sans-serif] text-xs font-normal leading-relaxed text-[#a8a29e]">
                ICS files can be imported into most calendar apps.
              </p>

              {adminModeEnabled && (
                <div
                  ref={googleStatusRef}
                  className="mt-5 rounded-2xl border border-[#e8e2ce] bg-[#fcfbf7] px-4 py-4"
                >
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <p className="font-['Lexend',sans-serif] text-sm font-bold text-[#1c180d]">
                        Google Calendar admin export
                      </p>
                      <p className="mt-1 text-xs leading-relaxed text-[#78716c]">
                        {googleCalendarConfigured
                          ? "Configured for this build."
                          : "Set VITE_GOOGLE_CLIENT_ID before using Google export."}
                      </p>
                    </div>
                    <span
                      className={`rounded-full px-3 py-1 font-['Lexend',sans-serif] text-[11px] font-bold uppercase tracking-[0.1em] ${
                        googleCalendarConfigured
                          ? "bg-[#ecfdf5] text-[#047857]"
                          : "bg-[#fef2f2] text-[#b91c1c]"
                      }`}
                    >
                      {googleCalendarConfigured ? "Ready" : "Missing"}
                    </span>
                  </div>

                  {googleExportProgress && (
                    <div className="mt-4">
                      <div className="mb-2 flex items-center justify-between gap-3 text-xs font-semibold text-[#78716c]">
                        <span>{googleExportProgress.label}</span>
                        <span>{googleProgressPercent}%</span>
                      </div>
                      <div className="h-2 overflow-hidden rounded-full bg-[#ede9dd]">
                        <div
                          className="h-full rounded-full bg-[#f2b90d] transition-all duration-300"
                          style={{ width: `${googleProgressPercent}%` }}
                        />
                      </div>
                    </div>
                  )}

                  {googleError && (
                    <p className="mt-4 rounded-xl border border-[#fecaca] bg-[#fef2f2] px-3 py-2 text-sm font-medium text-[#b91c1c]">
                      {googleError}
                    </p>
                  )}
                </div>
              )}
            </div>

            {adminModeEnabled && (
              <div className={`border-t ${goosePanelDividerClass} px-6 py-6 sm:px-8`}>
                <div className="mb-5 flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
                  <div>
                    <h3 className="font-['Lexend',sans-serif] text-base font-bold text-[#1c180d]">
                      Color palette
                    </h3>
                    <p className="mt-1 text-sm leading-relaxed text-[#78716c]">
                      {GOOGLE_CALENDAR_LIST_COLOR_EXPORT_ENABLED
                        ? "Pick a palette before exporting to Google Calendar so each event-type calendar gets its color."
                        : "Choose how Google Calendar colours exported events."}
                    </p>
                  </div>
                </div>

                <div className="space-y-5">
                  {GOOGLE_CALENDAR_LIST_COLOR_EXPORT_ENABLED ? (
                    <>
                      <SegmentedControl
                        value={exportConfig.colorStrategy}
                        options={COLOR_STRATEGY_OPTIONS}
                        onChange={setColorStrategy}
                        ariaLabel="Calendar palette strategy"
                      />
                      <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-5">
                        {palettes.map((palette) => (
                          <PaletteCard
                            key={palette.id}
                            palette={palette}
                            selected={activePaletteId === palette.id}
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
                      <div className="rounded-2xl border border-[#e8e2ce] bg-[#fcfbf7] px-4 py-4">
                        <div className="mb-3 flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
                          <div>
                            <h4 className="font-['Lexend',sans-serif] text-sm font-bold text-[#1c180d]">
                              Colour mapping
                            </h4>
                            <p className="text-xs leading-relaxed text-[#78716c]">
                              {exportConfig.colorStrategy === "course"
                                ? "Each course calendar uses the next colour in the selected palette."
                                : "Each event-type calendar uses the matching palette colour below."}
                            </p>
                          </div>
                        </div>
                        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                          {(exportConfig.colorStrategy === "course" && courseColorMappings.length > 0
                            ? courseColorMappings
                            : eventGroupColorMappings
                          ).map((mapping) => (
                            <div
                              key={`${mapping.label}-${mapping.color}`}
                              className="flex items-center gap-3 rounded-xl border border-[#ebe2c9] bg-white px-3 py-2.5"
                            >
                              <span
                                className="h-8 w-8 shrink-0 rounded-full border-2 border-white shadow-[0px_0px_0px_1px_rgba(28,24,13,0.12)]"
                                style={{ backgroundColor: mapping.color }}
                              />
                              <div className="min-w-0">
                                <p className="truncate font-['Lexend',sans-serif] text-sm font-bold text-[#1c180d]">
                                  {mapping.label}
                                </p>
                                {"detail" in mapping && mapping.detail && (
                                  <p className="truncate text-xs text-[#78716c]">
                                    {mapping.detail}
                                  </p>
                                )}
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    </>
                  ) : (
                    <>
                      <SegmentedControl
                        value={googleEventColorMode}
                        options={GOOGLE_EVENT_COLOR_MODE_OPTIONS}
                        onChange={setGoogleEventColorMode}
                        ariaLabel="Google event colour mode"
                      />

                      {googleEventColorMode === "uniform" ? (
                        <div className="grid grid-cols-6 gap-3 sm:grid-cols-11">
                          {googleEventColorOptions.map((option) => {
                            const selected = option.id === googleUniformColorId;
                            return (
                              <button
                                key={option.id}
                                type="button"
                                onClick={() => setGoogleUniformColorId(option.id)}
                                className={`h-10 rounded-full border-2 transition-all ${
                                  selected
                                    ? "border-[#1c180d] ring-2 ring-[#f2b90d]/45"
                                    : "border-white ring-1 ring-[#e7e5e4] hover:ring-[#d6d3d1]"
                                }`}
                                style={{ backgroundColor: googleEventColorHex(option.id) }}
                                aria-label={`Google event colour ${option.id}`}
                              />
                            );
                          })}
                        </div>
                      ) : (
                        <div className="grid gap-3 sm:grid-cols-3">
                          {googleEventColorPalettes.map((palette) => {
                            const selected = palette.id === exportConfig.paletteId;
                            return (
                              <button
                                key={palette.id}
                                type="button"
                                onClick={() => setPaletteId(palette.id)}
                                className={`overflow-hidden rounded-xl text-left transition-all ${
                                  selected
                                    ? "bg-[rgba(242,185,13,0.05)] ring-2 ring-[#f2b90d]"
                                    : "bg-white ring-1 ring-[#e7e5e4] hover:ring-[#d6d3d1]"
                                }`}
                              >
                                <div className="flex h-14">
                                  {palette.colors.slice(0, 5).map((color) => (
                                    <span
                                      key={color}
                                      className="flex-1"
                                      style={{ backgroundColor: color }}
                                    />
                                  ))}
                                </div>
                                <div className="flex items-center justify-between px-3.5 py-3">
                                  <span className="font-['Lexend',sans-serif] text-[13px] font-bold text-[#1c1917]">
                                    {palette.name}
                                  </span>
                                  {selected && (
                                    <span className="rounded-full bg-[#f2b90d] px-2 py-0.5 text-[10px] font-black uppercase tracking-[0.08em] text-[#1c180d]">
                                      Selected
                                    </span>
                                  )}
                                </div>
                              </button>
                            );
                          })}
                        </div>
                      )}
                    </>
                  )}
                </div>
              </div>
            )}

            <div className={`border-t ${goosePanelDividerClass} px-6 pb-6 pt-6 sm:px-8 sm:pb-8 sm:pt-7`}>
              <button
                onClick={openSettingsModal}
                className="flex w-full cursor-pointer items-center justify-between rounded-2xl border border-[#e8e2ce] bg-[#fcfbf7] px-4 py-4 text-left transition-all hover:border-[#d9cfb8] hover:bg-[#faf7ef]"
              >
                <div className="flex min-w-0 items-center gap-3">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[#fff6d8] text-[#8f6a00]">
                    <SettingsIcon />
                  </div>
                  <div className="min-w-0">
                    <p className="font-['Lexend',sans-serif] text-sm font-bold text-[#1c180d] sm:text-base">
                      {settingsTitle}
                    </p>
                    <p className="mt-0.5 text-xs leading-relaxed text-[#78716c] sm:text-sm">
                      Choose reminder defaults before exporting your calendar.
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

          {exportValidationIssues.length > 0 && (
            <div className="mt-6 w-full max-w-[760px] rounded-xl border border-[#fecaca] bg-[#fef2f2] px-5 py-4">
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

        <FlowFooter backLabel="Back to Review" onBack={() => navigate("/review")} />
      </div>
    </RouteGuard>
  );
}
