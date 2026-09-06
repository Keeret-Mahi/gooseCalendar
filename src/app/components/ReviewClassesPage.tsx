import React, { useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { createPortal } from "react-dom";
import { useNavigate } from "react-router";
import { RouteGuard } from "./RouteGuard";
import { useAppContext } from "./AppContext";
import { FlowFooter } from "./FlowFooter";
import { Calendar } from "./ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "./ui/popover";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "./ui/alert-dialog";
import { trackAnalyticsEvent } from "../lib/analytics";
import {
  formatEventTiming,
  getVisibleCourseEvents,
  validateEventForExport,
} from "../lib/calendar";
import { normalizeCourseNameCapitalization } from "../lib/courseNames";
import {
  gooseInputClass,
  goosePageBackgroundStyle,
  goosePageContentClass,
  goosePageHeadingClass,
  goosePageMainClass,
  goosePageShellClass,
  goosePageSubheadingClass,
  goosePanelDividerClass,
} from "../lib/designSystem";
import type { EventCandidate, EventGroup, EventType, ParsedCourse, WeekdayCode } from "../lib/types";
import { cn } from "./ui/utils";

const EVENT_TYPE_ORDER: Record<EventType, number> = {
  Lecture: 0,
  Tutorial: 1,
  Lab: 2,
  OfficeHours: 3,
  Assessment: 4,
  Assignment: 5,
  Other: 6,
};

const TYPE_STYLES: Record<
  EventType,
  {
    pillClassName: string;
    text: string;
  }
> = {
  Lecture: {
    pillClassName: "bg-[rgba(242,185,13,0.1)] text-[#d4a20a]",
    text: "Lecture",
  },
  Tutorial: {
    pillClassName: "bg-[#f3e8ff] text-[#9333ea]",
    text: "Tutorial",
  },
  Lab: {
    pillClassName: "bg-[#dbeafe] text-[#2563eb]",
    text: "Lab",
  },
  OfficeHours: {
    pillClassName: "bg-[#ccfbf1] text-[#0f766e]",
    text: "Office Hours",
  },
  Assessment: {
    pillClassName: "bg-[#fee2e2] text-[#dc2626]",
    text: "Assessment",
  },
  Assignment: {
    pillClassName: "bg-[#dcfce7] text-[#16a34a]",
    text: "Assignment",
  },
  Other: {
    pillClassName: "bg-[#e2e8f0] text-[#475569]",
    text: "Other",
  },
};

const COURSE_ACCENTS = ["#8fb394", "#f2b90d", "#60a5fa", "#c084fc", "#fb923c", "#14b8a6"];
const RECURRING_WEEKDAY_OPTIONS: { code: WeekdayCode; label: string }[] = [
  { code: "MO", label: "Mon" },
  { code: "TU", label: "Tue" },
  { code: "WE", label: "Wed" },
  { code: "TH", label: "Thu" },
  { code: "FR", label: "Fri" },
  { code: "SA", label: "Sat" },
  { code: "SU", label: "Sun" },
];

function CheckIcon({ color = "#10B981" }: { color?: string }) {
  return (
    <svg width="14" height="16" viewBox="0 0 14 16" fill="none">
      <path
        d="M5.19 10.81L2.38 8L1 9.38L5.19 13.57L13 5.76L11.62 4.38L5.19 10.81Z"
        fill={color}
      />
    </svg>
  );
}

function WarningIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
      <path
        d="M8 1.33L15 14H1L8 1.33ZM8.67 11.33V12.67H7.33V11.33H8.67ZM8.67 6V10H7.33V6H8.67Z"
        fill="#D97706"
      />
    </svg>
  );
}

function ClockIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 20 20" fill="none" className="shrink-0">
      <path
        d="M10 18.33C14.6 18.33 18.33 14.6 18.33 10C18.33 5.4 14.6 1.67 10 1.67C5.4 1.67 1.67 5.4 1.67 10C1.67 14.6 5.4 18.33 10 18.33Z"
        stroke="#6B7280"
        strokeWidth="1.8"
      />
      <path
        d="M10 5.83V10L12.92 11.67"
        stroke="#6B7280"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function ChevronIcon({ expanded }: { expanded: boolean }) {
  return (
    <svg
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="none"
      className={`transition-transform ${expanded ? "rotate-180" : ""}`}
    >
      <path d="M6 9L12 15L18 9" stroke="#9CA3AF" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-[11px] font-bold uppercase tracking-[0.08em] text-[#9ca3af]">
        {label}
      </span>
      {children}
    </label>
  );
}

function inputClassName() {
  return `h-[42px] ${gooseInputClass}`;
}

function textareaClassName() {
  return `py-2 ${gooseInputClass}`;
}

function normalizeInlineText(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

function isMeetingEventType(eventType: EventType) {
  return eventType === "Lecture" || eventType === "Tutorial" || eventType === "Lab";
}

function stripLegacyMeetingLocationSuffix(title: string, location: string) {
  const normalizedLocation = normalizeInlineText(location);
  if (!normalizedLocation) return title;
  const suffix = ` @ ${normalizedLocation}`;
  return title.endsWith(suffix) ? title.slice(0, -suffix.length) : title;
}

function meetingTypeCode(eventType: Extract<EventType, "Lecture" | "Tutorial" | "Lab">) {
  switch (eventType) {
    case "Lecture":
      return "LEC";
    case "Tutorial":
      return "TUT";
    case "Lab":
      return "LAB";
  }
}

function canonicalMeetingTitle(event: EventCandidate) {
  if (!isMeetingEventType(event.eventType)) return event.title;
  return `${event.courseCode} (${meetingTypeCode(event.eventType)})`;
}

function CalendarFieldIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" className="shrink-0 text-[#1c180d]">
      <path
        d="M6.67 1.67V5M13.33 1.67V5M2.5 8.33H17.5M4.17 3.33H15.83C16.75 3.33 17.5 4.08 17.5 5V15.83C17.5 16.75 16.75 17.5 15.83 17.5H4.17C3.25 17.5 2.5 16.75 2.5 15.83V5C2.5 4.08 3.25 3.33 4.17 3.33Z"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function parseIsoDate(value?: string) {
  if (!value) return undefined;
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return undefined;

  const year = Number(match[1]);
  const monthIndex = Number(match[2]) - 1;
  const day = Number(match[3]);
  return new Date(year, monthIndex, day);
}

function toIsoDate(date: Date) {
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, "0");
  const day = `${date.getDate()}`.padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function formatPickerDate(value?: string) {
  const parsed = parseIsoDate(value);
  if (!parsed) return "Select date";

  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(parsed);
}

function parseIsoTime(value?: string) {
  if (!value) return undefined;
  const match = value.match(/^(\d{2}):(\d{2})$/);
  if (!match) return undefined;

  let hour = Number(match[1]);
  const minute = match[2];
  const meridiem = hour >= 12 ? "PM" : "AM";
  hour %= 12;
  if (hour === 0) hour = 12;

  return {
    hour: `${hour}`.padStart(2, "0"),
    minute,
    meridiem: meridiem as "AM" | "PM",
  };
}

function toIsoTime(parts: {
  hour: string;
  minute: string;
  meridiem: "AM" | "PM";
}) {
  let hour = Number(parts.hour);
  if (parts.meridiem === "AM") {
    if (hour === 12) hour = 0;
  } else if (hour < 12) {
    hour += 12;
  }

  return `${`${hour}`.padStart(2, "0")}:${parts.minute}`;
}

function formatPickerTime(value?: string) {
  const parsed = parseIsoTime(value);
  if (!parsed) return "Select time";
  return `${parsed.hour}:${parsed.minute} ${parsed.meridiem}`;
}

const TIME_HOUR_OPTIONS = Array.from({ length: 12 }, (_, index) =>
  `${index + 1}`.padStart(2, "0")
);
const TIME_MINUTE_OPTIONS = Array.from({ length: 60 }, (_, index) =>
  `${index}`.padStart(2, "0")
);
const TIME_MERIDIEM_OPTIONS = ["AM", "PM"] as const;

function ThemedDateInput({
  value,
  onChange,
  minDate,
}: {
  value?: string;
  onChange: (next: string | undefined) => void;
  minDate?: string;
}) {
  const [open, setOpen] = useState(false);
  const selectedDate = parseIsoDate(value);
  const minimumDate = parseIsoDate(minDate);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className={cn(
            inputClassName(),
            "flex w-full cursor-pointer items-center justify-between gap-3 text-left font-['Lexend',sans-serif] text-base font-medium",
            !value && "text-[#9ca3af]",
          )}
        >
          <span>{formatPickerDate(value)}</span>
          <CalendarFieldIcon />
        </button>
      </PopoverTrigger>

      <PopoverContent
        align="start"
        sideOffset={8}
        className="z-[140] w-auto rounded-[18px] border border-[#e8e2ce] bg-[#fffdf8] p-2 shadow-[0px_18px_45px_-18px_rgba(28,24,13,0.28)]"
      >
        <Calendar
          mode="single"
          selected={selectedDate}
          disabled={minimumDate ? { before: minimumDate } : undefined}
          onSelect={(nextDate) => {
            if (!nextDate) return;
            onChange(toIsoDate(nextDate));
            setOpen(false);
          }}
          className="rounded-[16px] bg-transparent p-2"
          classNames={{
            month: "flex flex-col gap-4",
            caption:
              "relative flex items-center justify-center px-8 pb-1 pt-1 font-['Inter',sans-serif]",
            caption_label: "text-[17px] font-black tracking-[-0.02em] text-[#1c180d]",
            nav: "flex items-center gap-2",
            nav_button:
              "absolute top-1/2 flex size-8 -translate-y-1/2 items-center justify-center rounded-full border border-[#eadfbc] bg-[#fffaf0] text-[#7c5e10] transition hover:border-[#f2b90d] hover:bg-[#fff3cf]",
            nav_button_previous: "left-0",
            nav_button_next: "right-0",
            head_row: "mt-2 flex",
            head_cell:
              "w-9 rounded-full font-['Lexend',sans-serif] text-[11px] font-semibold uppercase tracking-[0.12em] text-[#9ca3af]",
            row: "mt-2 flex w-full",
            cell: "relative p-0 text-center text-sm",
            day:
              "flex size-9 items-center justify-center rounded-full font-['Lexend',sans-serif] text-sm font-medium text-[#1c180d] transition hover:bg-[#f6ecd0]",
            day_selected:
              "bg-[#f2b90d] text-[#1c180d] hover:bg-[#e4ad09] focus:bg-[#e4ad09]",
            day_today: "border border-[#f2b90d] bg-[#fff8de] text-[#7c5e10]",
            day_outside: "text-[#c4bfb1]",
            day_disabled: "text-[#d6d3cd]",
          }}
        />

        <div className="flex items-center justify-between px-3 pb-1 pt-2">
          <button
            type="button"
            onClick={() => {
              onChange(undefined);
              setOpen(false);
            }}
            className="cursor-pointer text-sm font-semibold text-[#9a7d2f] transition hover:text-[#7c5e10]"
          >
            Clear
          </button>

          <button
            type="button"
            onClick={() => {
              onChange(toIsoDate(new Date()));
              setOpen(false);
            }}
            className="cursor-pointer text-sm font-semibold text-[#9a7d2f] transition hover:text-[#7c5e10]"
          >
            Today
          </button>
        </div>
      </PopoverContent>
    </Popover>
  );
}

function TimeOptionColumn({
  label,
  options,
  selected,
  onSelect,
}: {
  label: string;
  options: readonly string[];
  selected?: string;
  onSelect: (value: string) => void;
}) {
  return (
    <div className="flex min-w-0 flex-1 flex-col gap-2">
      <span className="px-1 text-[10px] font-bold uppercase tracking-[0.12em] text-[#9ca3af]">
        {label}
      </span>
      <div className="max-h-52 overflow-y-auto rounded-[14px] border border-[#efe4c4] bg-[#fffaf0] p-1">
        <div className="flex flex-col gap-1">
          {options.map((option) => {
            const active = option === selected;
            return (
              <button
                key={option}
                type="button"
                onClick={() => onSelect(option)}
                className={cn(
                  "cursor-pointer rounded-[10px] px-3 py-2 text-sm font-semibold transition",
                  active
                    ? "bg-[#f2b90d] text-[#1c180d]"
                    : "text-[#7a7363] hover:bg-[#f7edd1] hover:text-[#1c180d]",
                )}
              >
                {option}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function ThemedTimeInput({
  value,
  onChange,
}: {
  value?: string;
  onChange: (next: string | undefined) => void;
}) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<{
    hour?: string;
    minute?: string;
    meridiem?: "AM" | "PM";
  }>({});

  useEffect(() => {
    if (!open) return;
    const parsed = parseIsoTime(value);
    setDraft(
      parsed
        ? parsed
        : {
            hour: undefined,
            minute: undefined,
            meridiem: undefined,
          }
    );
  }, [open, value]);

  const isComplete = Boolean(draft.hour && draft.minute && draft.meridiem);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className={cn(
            inputClassName(),
            "flex w-full cursor-pointer items-center justify-between gap-3 text-left font-['Lexend',sans-serif] text-base font-medium",
            !value && "text-[#9ca3af]",
          )}
        >
          <span>{formatPickerTime(value)}</span>
          <ClockIcon />
        </button>
      </PopoverTrigger>

      <PopoverContent
        align="start"
        sideOffset={8}
        className="z-[140] w-[320px] rounded-[18px] border border-[#e8e2ce] bg-[#fffdf8] p-3 shadow-[0px_18px_45px_-18px_rgba(28,24,13,0.28)]"
      >
        <div className="mb-3 flex items-center justify-between">
          <div className="font-['Inter',sans-serif] text-[17px] font-black tracking-[-0.02em] text-[#1c180d]">
            {isComplete
              ? `${draft.hour}:${draft.minute} ${draft.meridiem}`
              : "Select time"}
          </div>
        </div>

        <div className="grid grid-cols-[1fr_1fr_88px] gap-3">
          <TimeOptionColumn
            label="Hour"
            options={TIME_HOUR_OPTIONS}
            selected={draft.hour}
            onSelect={(hour) => setDraft((current) => ({ ...current, hour }))}
          />

          <TimeOptionColumn
            label="Minute"
            options={TIME_MINUTE_OPTIONS}
            selected={draft.minute}
            onSelect={(minute) => setDraft((current) => ({ ...current, minute }))}
          />

          <TimeOptionColumn
            label="AM/PM"
            options={TIME_MERIDIEM_OPTIONS}
            selected={draft.meridiem}
            onSelect={(meridiem) =>
              setDraft((current) => ({
                ...current,
                meridiem: meridiem as "AM" | "PM",
              }))
            }
          />
        </div>

        <div className="flex items-center justify-between px-1 pb-1 pt-3">
          <button
            type="button"
            onClick={() => {
              onChange(undefined);
              setOpen(false);
            }}
            className="cursor-pointer text-sm font-semibold text-[#9a7d2f] transition hover:text-[#7c5e10]"
          >
            Clear
          </button>

          <button
            type="button"
            disabled={!isComplete}
            onClick={() => {
              if (!draft.hour || !draft.minute || !draft.meridiem) return;
              onChange(
                toIsoTime({
                  hour: draft.hour,
                  minute: draft.minute,
                  meridiem: draft.meridiem,
                })
              );
              setOpen(false);
            }}
            className={cn(
              "rounded-full px-4 py-1.5 text-sm font-semibold transition",
              isComplete
                ? "cursor-pointer bg-[#f2b90d] text-[#1c180d] hover:bg-[#e4ad09]"
                : "cursor-not-allowed bg-[#efe9dc] text-[#b4ab99]",
            )}
          >
            Done
          </button>
        </div>
      </PopoverContent>
    </Popover>
  );
}

function formatTypeText(eventType: EventType) {
  return TYPE_STYLES[eventType].text;
}

function eventGroupForType(eventType: EventType): EventGroup {
  switch (eventType) {
    case "Lecture":
      return "Lecture";
    case "Tutorial":
      return "Tutorial";
    case "Lab":
      return "Lab";
    case "OfficeHours":
      return "Office Hours";
    case "Assessment":
      return "Assessments";
    case "Assignment":
      return "Assignments";
    default:
      return "Other";
  }
}

function stripTrailingPeriod(value: string) {
  return value.replace(/\.+$/g, "").trim();
}

function displayEventLabel(event: EventCandidate) {
  if (event.eventType !== "Assessment" || event.timing.kind !== "single" || !event.timing.date) {
    return stripTrailingPeriod(event.label);
  }

  const normalized = event.label.replace(/\s+/g, " ").trim();
  const match = normalized.match(
    /^(?:(?:Mon(?:day)?|Tue(?:s|sday)?|Wed(?:nesday)?|Thu(?:r|rs|rsday|ursday)?|Fri(?:day)?|Sat(?:urday)?|Sun(?:day)?),?\s+)?(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:t|tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\.?\s+\d{1,2}(?:st|nd|rd|th)?(?:,\s*\d{4})?,?\s*(.+)$/i
  );

  if (!match || !match[1]) return stripTrailingPeriod(event.label);
  if (!/(quiz|midterm|endterm|term test|test|exam|final)/i.test(match[1])) {
    return stripTrailingPeriod(event.label);
  }

  return stripTrailingPeriod(match[1]);
}

function buildDetectedSummary(events: EventCandidate[]) {
  const typeNames = Array.from(new Set(events.map((event) => formatTypeText(event.eventType))));
  const noun = events.length === 1 ? "event" : "events";
  return `${events.length} ${noun} detected (${typeNames.join(", ")})`;
}

function buildCourseHeading(course: ParsedCourse) {
  const normalizedCode = course.courseCode.replace(/\s+/g, " ").trim().toLowerCase();
  const normalizedName = normalizeCourseNameCapitalization(course.courseName)
    .replace(/\s+/g, " ")
    .trim();

  if (normalizedName.toLowerCase().startsWith(normalizedCode)) {
    return normalizedName;
  }

  return `${course.courseCode} - ${normalizedName}`;
}

const EVENT_TYPE_OPTIONS: EventType[] = [
  "Lecture",
  "Tutorial",
  "Lab",
  "Assignment",
  "Assessment",
  "OfficeHours",
  "Other",
];

function PlusIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" className="shrink-0">
      <path
        d="M8 3.33V12.67M3.33 8H12.67"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
    </svg>
  );
}

function AddEventButton({
  onAdd,
}: {
  onAdd: (eventType: EventType) => void;
}) {
  const [open, setOpen] = useState(false);
  const [panelPosition, setPanelPosition] = useState<{
    top: number;
    left: number;
    width: number;
    maxHeight: number;
    side: "top" | "bottom";
  } | null>(null);
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;

    const updatePosition = () => {
      const button = buttonRef.current;
      if (!button) return;
      const rect = button.getBoundingClientRect();
      const width = 320;
      const viewportPadding = 16;
      const verticalGap = 10;
      const estimatedHeight = panelRef.current?.offsetHeight ?? 300;
      const availableBelow = window.innerHeight - rect.bottom - viewportPadding;
      const availableAbove = rect.top - viewportPadding;
      const openAbove =
        availableBelow < Math.min(estimatedHeight, 260) && availableAbove > availableBelow;
      const maxHeight = Math.max(
        180,
        Math.min(
          openAbove ? availableAbove - verticalGap : availableBelow - verticalGap,
          window.innerHeight - viewportPadding * 2
        )
      );
      const panelHeight = Math.min(estimatedHeight, maxHeight);
      const left = Math.max(
        viewportPadding,
        Math.min(rect.right - width, window.innerWidth - width - viewportPadding)
      );
      const preferredTop = openAbove
        ? rect.top - panelHeight - verticalGap
        : rect.bottom + verticalGap;
      const maxTop = window.innerHeight - panelHeight - viewportPadding;
      const top = Math.max(viewportPadding, Math.min(preferredTop, maxTop));

      setPanelPosition({
        top,
        left,
        width,
        maxHeight,
        side: openAbove ? "top" : "bottom",
      });
    };

    const handlePointerDown = (event: MouseEvent) => {
      const target = event.target as Node | null;
      if (!target) return;
      if (buttonRef.current?.contains(target)) return;
      if (panelRef.current?.contains(target)) return;
      setOpen(false);
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
      }
    };

    updatePosition();
    window.addEventListener("resize", updatePosition);
    window.addEventListener("scroll", updatePosition, true);
    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);

    return () => {
      window.removeEventListener("resize", updatePosition);
      window.removeEventListener("scroll", updatePosition, true);
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [open]);

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        onClick={(event) => {
          event.preventDefault();
          event.stopPropagation();
          setOpen((current) => !current);
        }}
        className="inline-flex cursor-pointer items-center gap-2 rounded-full border border-[#eadfbc] bg-[#fffaf0] px-4 py-2 text-sm font-semibold text-[#7c5e10] transition hover:border-[#f2b90d] hover:bg-[#fff3cf]"
      >
        <PlusIcon />
        Add Event
      </button>

      {open && panelPosition && typeof document !== "undefined"
        ? createPortal(
            <div
              ref={panelRef}
              data-side={panelPosition.side}
              style={{
                top: panelPosition.top,
                left: panelPosition.left,
                width: panelPosition.width,
                maxHeight: panelPosition.maxHeight,
              }}
              className="fixed z-[90] overflow-y-auto rounded-[18px] border border-[#e8e2ce] bg-[#fffdf8] p-3 shadow-[0px_18px_45px_-18px_rgba(28,24,13,0.28)] data-[side=bottom]:animate-in data-[side=bottom]:fade-in-0 data-[side=bottom]:zoom-in-95 data-[side=bottom]:slide-in-from-top-2 data-[side=top]:animate-in data-[side=top]:fade-in-0 data-[side=top]:zoom-in-95 data-[side=top]:slide-in-from-bottom-2 duration-200 ease-out"
              onMouseDown={(event) => {
                event.stopPropagation();
              }}
              onClick={(event) => {
                event.stopPropagation();
              }}
            >
          <div className="mb-3">
            <p className="font-['Inter',sans-serif] text-[16px] font-black tracking-[-0.02em] text-[#1c180d]">
              Add an event
            </p>
            <p className="mt-1 text-sm text-[#78716c]">
              Pick the event type, then fill in the details.
            </p>
          </div>

          <div className="grid grid-cols-2 gap-2">
            {EVENT_TYPE_OPTIONS.map((eventType) => (
              <button
                key={eventType}
                type="button"
                onMouseDown={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                }}
                onClick={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  setOpen(false);
                  window.setTimeout(() => {
                    onAdd(eventType);
                  }, 0);
                }}
                className="cursor-pointer rounded-[12px] border border-[#efe4c4] bg-[#fffaf0] px-3 py-2 text-left text-sm font-semibold text-[#1c180d] transition hover:border-[#f2b90d] hover:bg-[#fff3cf]"
              >
                {formatTypeText(eventType)}
              </button>
            ))}
          </div>
            </div>,
            document.body
          )
        : null}
    </>
  );
}

function timingSortKey(event: EventCandidate) {
  if (event.timing.kind === "recurring") {
    return `${event.timing.startDate ?? ""}-${event.timing.byDay.join(",")}-${event.timing.startTime ?? ""}`;
  }
  return `${event.timing.date ?? ""}-${event.timing.startTime ?? ""}`;
}

function sortEvents(events: EventCandidate[]) {
  return [...events].sort((left, right) => {
    const typeDelta = EVENT_TYPE_ORDER[left.eventType] - EVENT_TYPE_ORDER[right.eventType];
    if (typeDelta !== 0) return typeDelta;

    const timingDelta = timingSortKey(left).localeCompare(timingSortKey(right));
    if (timingDelta !== 0) return timingDelta;

    return left.label.localeCompare(right.label);
  });
}

function sortEventsWithEditingAnchor(
  events: EventCandidate[],
  editingEventId: string | null,
  editingSortAnchor: EventCandidate | null
) {
  if (!editingEventId || !editingSortAnchor) return sortEvents(events);

  const eventById = new Map(events.map((event) => [event.id, event]));
  return sortEvents(
    events.map((event) =>
      event.id === editingEventId
        ? {
            ...editingSortAnchor,
            id: event.id,
          }
        : event
    )
  )
    .map((event) => eventById.get(event.id))
    .filter(Boolean) as EventCandidate[];
}

function restoreEventTypeDraft(
  current: EventCandidate,
  restored: EventCandidate,
  eventType: EventType
) {
  return {
    ...restored,
    id: current.id,
    outlineId: current.outlineId,
    courseId: current.courseId,
    courseCode: current.courseCode,
    courseName: current.courseName,
    eventType,
    eventGroup: eventGroupForType(eventType),
    include: current.include,
  };
}

function EventEditor({
  event,
  issue,
  onUpdate,
  onEventTypeChange,
  embedded = true,
  showSectionsUsed = true,
  notesLabel = "Notes",
}: {
  event: EventCandidate;
  issue: string | null;
  onUpdate: (updater: (current: EventCandidate) => EventCandidate) => void;
  onEventTypeChange?: (eventType: EventType) => void;
  embedded?: boolean;
  showSectionsUsed?: boolean;
  notesLabel?: string;
}) {
  const [hoveredRecurringDay, setHoveredRecurringDay] = useState<WeekdayCode | null>(null);
  const typeDraftsRef = useRef<Partial<Record<EventType, EventCandidate>>>({});
  const typeDraftEventIdRef = useRef(event.id);

  if (typeDraftEventIdRef.current !== event.id) {
    typeDraftsRef.current = {};
    typeDraftEventIdRef.current = event.id;
  }

  useEffect(() => {
    typeDraftsRef.current[event.eventType] = event;
  }, [event]);

  useEffect(() => {
    if (!isMeetingEventType(event.eventType)) return;

    const normalizedTitle = canonicalMeetingTitle({
      ...event,
      title: stripLegacyMeetingLocationSuffix(event.title, event.location),
    });
    if (normalizeInlineText(event.title) === normalizeInlineText(normalizedTitle)) return;

    onUpdate((current) =>
      current.id === event.id
        ? {
            ...current,
            title: canonicalMeetingTitle({
              ...current,
              title: stripLegacyMeetingLocationSuffix(current.title, current.location),
            }),
          }
        : current
    );
  }, [event.id, event.eventType, event.courseCode, event.location, event.title, onUpdate]);

  return (
    <div
      className={
        embedded
          ? `border-t ${goosePanelDividerClass} bg-[rgba(249,248,244,0.72)] px-4 py-4`
          : "rounded-[14px] border border-[#e8e2ce] bg-[rgba(249,248,244,0.72)] px-4 py-4"
      }
    >
      {issue && (
        <div className="mb-4 rounded-[10px] border border-[#fed7aa] bg-[#fffbeb] px-3 py-2 text-sm text-[#b45309]">
          {issue}
        </div>
      )}

      <div className="grid gap-4 md:grid-cols-2">
        <div className="md:col-span-2">
          <p className="mb-2 text-[11px] font-bold uppercase tracking-[0.08em] text-[#9ca3af]">
            Event Type
          </p>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-7">
            {EVENT_TYPE_OPTIONS.map((eventType) => {
              const typeStyle = TYPE_STYLES[eventType];
              const selected = event.eventType === eventType;

              return (
                <button
                  key={eventType}
                  type="button"
                  aria-pressed={selected}
                  onClick={() => {
                    if (selected) return;
                    onEventTypeChange?.(eventType);
                    onUpdate((current) => {
                      typeDraftsRef.current[current.eventType] = current;
                      const restored = typeDraftsRef.current[eventType];
                      if (restored) {
                        return restoreEventTypeDraft(current, restored, eventType);
                      }

                      return {
                        ...current,
                        eventType,
                        eventGroup: eventGroupForType(eventType),
                      };
                    });
                  }}
                  className={cn(
                    "flex cursor-pointer items-center justify-start rounded-full p-0.5 transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#f2b90d]/40 sm:justify-center",
                    selected ? "z-10" : ""
                  )}
                >
                  <span
                    className={`inline-flex min-h-7 items-center rounded-full px-3 py-1 text-[10px] font-bold uppercase transition-[filter,box-shadow] hover:brightness-[0.98] ${typeStyle.pillClassName} ${
                      selected ? "shadow-[0_0_0_2px_rgba(242,185,13,0.3)]" : ""
                    }`}
                  >
                    {typeStyle.text}
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        <Field label="Calendar Title">
          <input
            value={event.title}
            onChange={(entry) =>
              onUpdate((current) => ({ ...current, title: entry.target.value }))
            }
            className={inputClassName()}
          />
        </Field>

        <Field label="Location">
          <input
            value={event.location}
            onChange={(entry) =>
              onUpdate((current) => ({ ...current, location: entry.target.value }))
            }
            className={inputClassName()}
          />
        </Field>

        {event.timing.kind === "single" ? (
          <>
            <Field label="Date">
              <ThemedDateInput
                value={event.timing.date ?? ""}
                onChange={(nextDate) =>
                  onUpdate((current) => ({
                    ...current,
                    timing:
                      current.timing.kind === "single"
                        ? { ...current.timing, date: nextDate || undefined }
                        : current.timing,
                  }))
                }
              />
            </Field>

            <Field label="Start Time">
              <ThemedTimeInput
                value={event.timing.startTime ?? ""}
                onChange={(nextTime) =>
                  onUpdate((current) => ({
                    ...current,
                    timing:
                      current.timing.kind === "single"
                        ? { ...current.timing, startTime: nextTime || undefined }
                        : current.timing,
                  }))
                }
              />
            </Field>

            <Field label="End Time">
              <ThemedTimeInput
                value={event.timing.endTime ?? ""}
                onChange={(nextTime) =>
                  onUpdate((current) => ({
                    ...current,
                    timing:
                      current.timing.kind === "single"
                        ? { ...current.timing, endTime: nextTime || undefined }
                        : current.timing,
                  }))
                }
              />
            </Field>
          </>
        ) : (
          <>
            <Field label="Recurring Start">
              <ThemedDateInput
                value={event.timing.startDate ?? ""}
                onChange={(nextDate) =>
                  onUpdate((current) => ({
                    ...current,
                    timing:
                      current.timing.kind === "recurring"
                        ? {
                            ...current.timing,
                            startDate: nextDate || undefined,
                            endDate:
                              nextDate &&
                              current.timing.endDate &&
                              current.timing.endDate < nextDate
                                ? nextDate
                                : current.timing.endDate,
                          }
                        : current.timing,
                  }))
                }
              />
            </Field>

            <Field label="Recurring End">
              <ThemedDateInput
                value={event.timing.endDate ?? ""}
                minDate={event.timing.startDate ?? ""}
                onChange={(nextDate) =>
                  onUpdate((current) => ({
                    ...current,
                    timing:
                      current.timing.kind === "recurring"
                        ? { ...current.timing, endDate: nextDate || undefined }
                        : current.timing,
                  }))
                }
              />
            </Field>

            <Field label="Recurs On">
              <div className="flex flex-wrap gap-2">
                {RECURRING_WEEKDAY_OPTIONS.map((day) => {
                  const active =
                    event.timing.kind === "recurring" &&
                    event.timing.byDay.includes(day.code);
                  const hovered = hoveredRecurringDay === day.code;

                  return (
                    <button
                      key={day.code}
                      type="button"
                      onMouseEnter={() => setHoveredRecurringDay(day.code)}
                      onMouseLeave={() => setHoveredRecurringDay((current) => (current === day.code ? null : current))}
                      onClick={() =>
                        onUpdate((current) => {
                          if (current.timing.kind !== "recurring") return current;

                          const nextByDay = current.timing.byDay.includes(day.code)
                            ? current.timing.byDay.filter((code) => code !== day.code)
                            : [...current.timing.byDay, day.code];

                          return {
                            ...current,
                            timing: {
                              ...current.timing,
                              byDay: RECURRING_WEEKDAY_OPTIONS.map((option) => option.code).filter(
                                (code) => nextByDay.includes(code)
                              ),
                            },
                          };
                        })
                      }
                      className={cn(
                        "cursor-pointer rounded-full border px-3 py-1.5 text-sm font-semibold outline-none transition focus-visible:ring-2 focus-visible:ring-[#f2b90d]/40 focus-visible:ring-offset-2 focus-visible:ring-offset-[#fffdf8]",
                        active
                          ? "border-[#f2b90d] bg-[#f7cf52] text-[#1c180d] shadow-[inset_0_0_0_1px_rgba(242,185,13,0.12)]"
                          : hovered
                            ? "border-[#f2b90d] bg-[#fff8de] text-[#1c180d]"
                            : "border-[#e8e2ce] bg-white text-[#6b7280]"
                      )}
                      aria-pressed={active}
                    >
                      {day.label}
                    </button>
                  );
                })}
              </div>
            </Field>

            <Field label="Start Time">
              <ThemedTimeInput
                value={event.timing.startTime ?? ""}
                onChange={(nextTime) =>
                  onUpdate((current) => ({
                    ...current,
                    timing:
                      current.timing.kind === "recurring"
                        ? { ...current.timing, startTime: nextTime || undefined }
                        : current.timing,
                  }))
                }
              />
            </Field>

            <Field label="End Time">
              <ThemedTimeInput
                value={event.timing.endTime ?? ""}
                onChange={(nextTime) =>
                  onUpdate((current) => ({
                    ...current,
                    timing:
                      current.timing.kind === "recurring"
                        ? { ...current.timing, endTime: nextTime || undefined }
                        : current.timing,
                  }))
                }
              />
            </Field>
          </>
        )}

        {showSectionsUsed && (
          <Field label="Sections Used">
            <input
              value={event.extractedSectionLabels.join(", ")}
              onChange={(entry) =>
                onUpdate((current) => ({
                  ...current,
                  extractedSectionLabels: entry.target.value
                    .split(",")
                    .map((value) => value.trim())
                    .filter(Boolean),
                }))
              }
              className={inputClassName()}
            />
          </Field>
        )}

        <Field label="Instructor">
          <input
            value={event.instructorName ?? ""}
            onChange={(entry) =>
              onUpdate((current) => ({
                ...current,
                instructorName: entry.target.value || undefined,
              }))
            }
            className={inputClassName()}
          />
        </Field>

        <Field label="Instructor Email">
          <input
            value={event.instructorEmail ?? ""}
            onChange={(entry) =>
              onUpdate((current) => ({
                ...current,
                instructorEmail: entry.target.value || undefined,
              }))
            }
            className={inputClassName()}
          />
        </Field>

        <Field label={notesLabel}>
          <textarea
            rows={4}
            value={event.notes.join("\n")}
            onChange={(entry) =>
              onUpdate((current) => ({
                ...current,
                notes: entry.target.value
                  .split("\n")
                  .map((value) => value.trim())
                  .filter(Boolean),
              }))
            }
            className={`${textareaClassName()} md:col-span-2`}
          />
        </Field>

        {event.provenance.length > 0 && (
          <div className="md:col-span-2">
            <p className="text-[11px] font-bold uppercase tracking-[0.08em] text-[#9ca3af]">
              Source Evidence
            </p>
            <div className="mt-2 flex flex-col gap-2">
              {event.provenance.slice(0, 3).map((source, index) => (
                <div
                  key={`${source.sectionId}-${index}`}
                  className="rounded-[10px] border border-[#e8e2ce] bg-white px-3 py-3 text-sm text-[#78716c]"
                >
                  <p className="font-bold text-[#1c180d]">{source.sectionTitle}</p>
                  <p className="mt-1">{source.snippet}</p>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function ManualEventDialog({
  event,
  issue,
  open,
  onOpenChange,
  onUpdate,
  onDone,
}: {
  event: EventCandidate | null;
  issue: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onUpdate: (updater: (current: EventCandidate) => EventCandidate) => void;
  onDone: () => void;
}) {
  const openedAtRef = useRef(0);
  const wasOpenRef = useRef(false);

  if (open && !wasOpenRef.current) {
    openedAtRef.current = Date.now();
    wasOpenRef.current = true;
  } else if (!open && wasOpenRef.current) {
    wasOpenRef.current = false;
  }

  useEffect(() => {
    if (!open) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onOpenChange(false);
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [open, onOpenChange]);

  if (!open || typeof document === "undefined") return null;

  return createPortal(
    <div className="fixed inset-0 z-[100] flex animate-in fade-in-0 duration-200 items-center justify-center bg-[rgba(28,24,13,0.42)] px-4 py-6">
      <div
        className="absolute inset-0"
        onClick={() => {
          if (Date.now() - openedAtRef.current < 250) return;
          onOpenChange(false);
        }}
      />

      <div className="relative z-10 max-h-[85vh] w-full max-w-[920px] overflow-y-auto rounded-[22px] border border-[#e8e2ce] bg-[#fffdf8] p-0 shadow-[0px_24px_60px_-24px_rgba(28,24,13,0.32)] animate-in fade-in-0 zoom-in-95 slide-in-from-bottom-3 duration-200 ease-out">
        <div className="border-b border-[#ede6d3] px-6 pb-4 pt-6 text-left">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="font-['Inter',sans-serif] text-[24px] font-black tracking-[-0.03em] text-[#1c180d]">
                Add Event
              </p>
              <p className="mt-1 text-sm text-[#78716c]">
                Enter the event details, then add it to this course.
              </p>
            </div>

            <button
              type="button"
              onClick={() => onOpenChange(false)}
              className="cursor-pointer rounded-full border border-[#e8e2ce] bg-white px-3 py-1.5 text-sm font-semibold text-[#6b7280] transition hover:border-[#d6ccb0] hover:text-[#1c180d]"
            >
              Close
            </button>
          </div>
        </div>

        <div className="px-6 py-5">
          {event ? (
        <EventEditor
          event={event}
          issue={issue}
          onUpdate={onUpdate}
          embedded={false}
          showSectionsUsed={false}
          notesLabel="Event Description"
        />
          ) : null}
        </div>

        <div className="flex flex-col-reverse gap-2 border-t border-[#ede6d3] px-6 py-4 sm:flex-row sm:justify-between">
          <button
            type="button"
            onClick={() => onOpenChange(false)}
            className="cursor-pointer rounded-full border border-[#e8e2ce] bg-white px-4 py-2 text-sm font-semibold text-[#6b7280] transition hover:border-[#d6ccb0] hover:text-[#1c180d]"
          >
            Cancel
          </button>

          {event ? (
            <button
              type="button"
              onClick={onDone}
              className="cursor-pointer rounded-full bg-[#f2b90d] px-5 py-2 text-sm font-semibold text-[#1c180d] transition hover:bg-[#e3ae0c]"
            >
              Done
            </button>
          ) : null}
        </div>
      </div>
    </div>,
    document.body
  );
}

function EventRow({
  event,
  editing,
  issue,
  onToggleEdit,
  onToggleInclude,
  onUpdate,
  onEventTypeChange,
}: {
  event: EventCandidate;
  editing: boolean;
  issue: string | null;
  onToggleEdit: () => void;
  onToggleInclude: () => void;
  onUpdate: (updater: (current: EventCandidate) => EventCandidate) => void;
  onEventTypeChange: (eventType: EventType) => void;
}) {
  const typeStyle = TYPE_STYLES[event.eventType];

  return (
    <div
      data-event-row-id={event.id}
      className={`overflow-hidden rounded-[8px] bg-white ${
        editing || issue
          ? "border-2 border-[#f2b90d] shadow-[0px_1px_2px_0px_rgba(0,0,0,0.05)]"
          : "border border-[#e8e2ce]"
      } ${event.include ? "" : "opacity-70"}`}
    >
      <div className="flex flex-col gap-3 p-[13px] md:flex-row md:items-center md:justify-between">
        <div className="flex min-w-0 flex-1 flex-col gap-2 md:flex-row md:items-center md:gap-0">
          <div className="md:flex md:w-[170px] md:shrink-0 md:items-center md:justify-center">
            <div
              className={`inline-flex w-fit items-center rounded-full px-2 py-[2px] text-[10px] font-bold uppercase ${typeStyle.pillClassName}`}
            >
              {typeStyle.text}
            </div>
          </div>

          <div className="min-w-0 md:flex-1">
            <p className="truncate font-['Inter',sans-serif] text-[16px] font-bold leading-6 text-[#1c180d]">
              {displayEventLabel(event)}
            </p>
            <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-[14px] text-[#78716c]">
              <span>{formatEventTiming(event)}</span>
              {event.location && <span>{stripTrailingPeriod(event.location)}</span>}
              {issue && <span className="font-medium text-[#d97706]">{issue}</span>}
            </div>
          </div>
        </div>

        <div className="flex items-center gap-5 self-end md:self-center">
          <button
            onClick={onToggleEdit}
            className={`text-[14px] font-medium ${
              editing ? "text-[#1c180d]" : "text-[#6b7280]"
            }`}
          >
            {editing ? "Done" : "Edit"}
          </button>
          <button
            onClick={onToggleInclude}
            className="text-[14px] font-medium text-[#6b7280]"
          >
            {event.include ? "Exclude" : "Include"}
          </button>
        </div>
      </div>

      {editing && (
        <EventEditor
          event={event}
          issue={issue}
          onUpdate={onUpdate}
          onEventTypeChange={onEventTypeChange}
        />
      )}
    </div>
  );
}

function CourseCard({
  course,
  events,
  accentColor,
  expanded,
  onToggle,
  onRequestAddEvent,
  onUpdate,
  onEventTypeChange,
}: {
  course: ParsedCourse;
  events: EventCandidate[];
  accentColor: string;
  expanded: boolean;
  onToggle: () => void;
  onRequestAddEvent: (eventType: EventType) => void;
  onUpdate: (eventId: string, updater: (current: EventCandidate) => EventCandidate) => void;
  onEventTypeChange: (event: EventCandidate, eventType: EventType) => void;
}) {
  const [editingEventId, setEditingEventId] = useState<string | null>(null);
  const [editingSortAnchor, setEditingSortAnchor] = useState<EventCandidate | null>(null);
  const eventsContainerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (editingEventId && !events.some((event) => event.id === editingEventId)) {
      setEditingEventId(null);
      setEditingSortAnchor(null);
    }
  }, [editingEventId, events]);

  useEffect(() => {
    const targetId = editingEventId;
    if (!targetId) return;
    const frame = window.requestAnimationFrame(() => {
      const row = eventsContainerRef.current?.querySelector<HTMLElement>(
        `[data-event-row-id="${targetId}"]`
      );
      row?.scrollIntoView({ behavior: "smooth", block: "nearest" });
    });

    return () => window.cancelAnimationFrame(frame);
  }, [editingEventId]);

  const sortedEvents = useMemo(
    () => sortEventsWithEditingAnchor(events, editingEventId, editingSortAnchor),
    [editingEventId, editingSortAnchor, events]
  );

  const issuesByEventId = useMemo(
    () =>
      new Map(
        events
          .map((event) => [event.id, event.include ? validateEventForExport(event) : null] as const)
          .filter((entry) => entry[1])
      ),
    [events]
  );

  const hasIssues = issuesByEventId.size > 0;

  return (
    <div
      className={`overflow-hidden rounded-[8px] bg-white ${
        expanded
          ? "border-2 border-[#f2b90d] shadow-[0px_1px_2px_0px_rgba(0,0,0,0.05)]"
          : "border border-[#e8e2ce] hover:border-[#f2b90d] hover:shadow-[0px_8px_24px_-18px_rgba(242,185,13,0.28)]"
      }`}
      style={{
        transition:
          "border-color 300ms cubic-bezier(0.16, 1, 0.3, 1), box-shadow 300ms cubic-bezier(0.16, 1, 0.3, 1)",
      }}
    >
      <button
        onClick={onToggle}
        className={`flex w-full cursor-pointer flex-col gap-4 p-6 text-left transition-colors duration-300 md:grid md:grid-cols-[minmax(0,1fr)_260px] md:items-center md:gap-6 lg:grid-cols-[minmax(0,1fr)_290px] ${
          expanded ? "" : "hover:bg-[#fafaf8]"
        }`}
      >
        <div className="flex min-w-0 items-center gap-4">
          <div
            className="h-4 w-4 shrink-0 rounded-full"
            style={{ backgroundColor: accentColor }}
          />
          <div className="min-w-0">
            <h2 className="truncate font-['Inter',sans-serif] text-[20px] font-bold leading-7 text-[#1c180d]">
              {buildCourseHeading(course)}
            </h2>
            <p className="mt-1 text-[14px] text-[#78716c]">
              {buildDetectedSummary(events)}
            </p>
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-4 self-end md:min-w-[260px] md:self-center md:justify-end lg:min-w-[290px]">
          <div className="flex shrink-0 items-center gap-2 whitespace-nowrap">
            {hasIssues ? <WarningIcon /> : <CheckIcon />}
            <span
              className={`whitespace-nowrap text-[14px] font-bold ${
                hasIssues ? "text-[#d97706]" : "text-[#059669]"
              }`}
            >
              {hasIssues ? "Needs Attention" : "Ready to Export"}
            </span>
          </div>

          <div className="shrink-0">
            <ChevronIcon expanded={expanded} />
          </div>
        </div>
      </button>

      <div
        className={`grid transition-[grid-template-rows] duration-700 ease-[cubic-bezier(0.16,1,0.3,1)] ${
          expanded ? "grid-rows-[1fr]" : "grid-rows-[0fr]"
        }`}
      >
        <div className="overflow-hidden">
          <div
            className={`origin-top border-t ${goosePanelDividerClass} bg-[rgba(249,248,244,0.72)] p-4 transition-[opacity,transform] duration-650 ease-[cubic-bezier(0.16,1,0.3,1)] ${
              expanded ? "translate-y-0 scale-y-100 opacity-100" : "-translate-y-1 scale-y-[0.985] opacity-0"
            }`}
          >
            {sortedEvents.length > 0 ? (
              <div ref={eventsContainerRef} className="flex flex-col gap-3">
                {sortedEvents.map((event) => {
                  const issue = issuesByEventId.get(event.id) ?? null;
                  return (
                    <EventRow
                      key={event.id}
                      event={event}
                      editing={editingEventId === event.id}
                      issue={issue}
                      onToggleEdit={() =>
                        setEditingEventId((current) => {
                          if (current === event.id) {
                            setEditingSortAnchor(null);
                            return null;
                          }

                          setEditingSortAnchor(event);
                          return event.id;
                        })
                      }
                      onToggleInclude={() =>
                        onUpdate(event.id, (current) => ({ ...current, include: !current.include }))
                      }
                      onUpdate={(updater) => onUpdate(event.id, updater)}
                      onEventTypeChange={(eventType) => onEventTypeChange(event, eventType)}
                    />
                  );
                })}
              </div>
            ) : (
              <div className="rounded-[8px] border border-dashed border-[#e8e2ce] bg-[#fcfbf8] px-4 py-5 text-sm text-[#78716c]">
                No events match the section choices for this course yet.
              </div>
            )}

            <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-[8px] border border-[#e8e2ce] bg-white px-4 py-3">
              <div>
                <p className="font-['Inter',sans-serif] text-[15px] font-bold text-[#1c180d]">
                  Add an event
                </p>
                <p className="mt-1 text-sm text-[#78716c]">
                  Add a lecture, tutorial, lab, assignment, assessment, office hours, or other event for this course.
                </p>
              </div>
              <AddEventButton
                onAdd={onRequestAddEvent}
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function ReviewClassesPage() {
  const navigate = useNavigate();
  const { courses, events, selections, updateSelection, updateEvent, createDraftEvent, addEvent } =
    useAppContext();

  const visibleCourses = useMemo(
    () =>
      courses.map((course) => ({
        course,
        events: getVisibleCourseEvents(course, events, selections),
      })),
    [courses, events, selections]
  );

  const [expandedCourseId, setExpandedCourseId] = useState<string | null>(null);
  const [draftEvent, setDraftEvent] = useState<EventCandidate | null>(null);
  const [showReviewReminder, setShowReviewReminder] = useState(false);
  const [pendingManualEvent, setPendingManualEvent] = useState<{
    courseId: string;
    eventType: EventType;
  } | null>(null);

  useEffect(() => {
    setExpandedCourseId((current) => {
      if (!current) return null;
      return visibleCourses.some(({ course }) => course.id === current) ? current : null;
    });
  }, [visibleCourses]);

  useEffect(() => {
    if (!pendingManualEvent) return;

    const nextDraft = createDraftEvent(
      pendingManualEvent.courseId,
      pendingManualEvent.eventType
    );

    if (nextDraft) {
      setDraftEvent(nextDraft);
    }

    setPendingManualEvent(null);
  }, [pendingManualEvent, createDraftEvent]);

  const draftIssue = draftEvent ? validateEventForExport(draftEvent) : null;

  const handleNext = () => {
    setShowReviewReminder(true);
  };

  const handleConfirmExport = () => {
    setShowReviewReminder(false);
    navigate("/export");

    const visibleEvents = visibleCourses.flatMap(({ events: courseEvents }) => courseEvents);
    void trackAnalyticsEvent("review_export_clicked", {
      course_count: visibleCourses.length,
      event_count: visibleEvents.length,
      review_issue_count: visibleEvents.filter(validateEventForExport).length,
    });
  };

  return (
    <RouteGuard>
      <div
        className={goosePageShellClass}
        style={goosePageBackgroundStyle}
      >
        <main className={goosePageMainClass}>
          <div className={goosePageContentClass}>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h1 className={goosePageHeadingClass}>
                  Review Classes Overview
                </h1>
                <p className={`max-w-[760px] ${goosePageSubheadingClass}`}>
                  Confirm the detected lecture, tutorial, lab, deadline, and office hour details before exporting.
                </p>
                <p className="mt-2 font-['Lexend',sans-serif] text-sm font-medium text-[#8b6b12]">
                  gooseCalendar can make mistakes, so give everything a quick review before exporting.
                </p>
              </div>
            </div>

            <div className="flex flex-col gap-4">
              {visibleCourses.map(({ course, events: courseEvents }, index) => (
                <CourseCard
                  key={course.id}
                  course={course}
                  events={courseEvents}
                  accentColor={COURSE_ACCENTS[index % COURSE_ACCENTS.length]}
                  expanded={expandedCourseId === course.id}
                  onToggle={() =>
                    setExpandedCourseId((current) =>
                      current === course.id ? null : course.id
                    )
                  }
                  onRequestAddEvent={(eventType) => {
                    setPendingManualEvent({
                      courseId: course.id,
                      eventType,
                    });
                  }}
                  onEventTypeChange={(event, eventType) => {
                    const nextEventGroup = eventGroupForType(eventType);
                    updateSelection(event.courseId, (current) => ({
                      ...current,
                      includedGroups: current.includedGroups.includes(nextEventGroup)
                        ? current.includedGroups
                        : [...current.includedGroups, nextEventGroup],
                      selectedOfficeHourEventIds:
                        nextEventGroup === "Office Hours" &&
                        !current.selectedOfficeHourEventIds.includes(event.id)
                          ? [...current.selectedOfficeHourEventIds, event.id]
                          : current.selectedOfficeHourEventIds,
                    }));
                  }}
                  onUpdate={(eventId, updater) => {
                    updateEvent(eventId, (current) => {
                      const updated = updater(current);
                      return {
                        ...updated,
                        reviewNeeded: !!validateEventForExport(updated),
                      };
                    });
                  }}
                />
              ))}
            </div>
          </div>
        </main>

        <ManualEventDialog
          event={draftEvent}
          issue={draftIssue}
          open={Boolean(draftEvent)}
          onOpenChange={(open) => {
            if (!open) setDraftEvent(null);
          }}
          onUpdate={(updater) =>
            setDraftEvent((current) => (current ? updater(current) : current))
          }
          onDone={() => {
            if (!draftEvent) return;
            addEvent({
              ...draftEvent,
              reviewNeeded: !!validateEventForExport(draftEvent),
            });
            setDraftEvent(null);
          }}
        />

        <AlertDialog open={showReviewReminder} onOpenChange={setShowReviewReminder}>
          <AlertDialogContent className="max-w-[500px] gap-0 overflow-hidden rounded-[24px] border border-[#e8dfc2] bg-[#fffdf8] p-0 shadow-[0px_28px_70px_-24px_rgba(28,24,13,0.35)]">
            <div className="h-1.5 bg-[#f2b90d]" />
            <div className="px-6 pb-6 pt-7 sm:px-8 sm:pb-7">
              <AlertDialogHeader className="items-center gap-3 text-center sm:text-center">
                <div className="flex size-12 items-center justify-center rounded-full bg-[rgba(242,185,13,0.16)]">
                  <CheckIcon color="#a77c00" />
                </div>
                <div>
                  <AlertDialogTitle className="font-['Inter',sans-serif] text-[24px] font-black tracking-[-0.03em] text-[#1c180d]">
                    One last check
                  </AlertDialogTitle>
                  <AlertDialogDescription className="mt-2 font-['Lexend',sans-serif] text-[15px] leading-6 text-[#6f695d]">
                    gooseCalendar can occasionally miss or misread dates. Please make sure you have
                    reviewed the events on this page before exporting.
                  </AlertDialogDescription>
                </div>
              </AlertDialogHeader>

              <div className="mt-5 rounded-[14px] border border-[#ead9a0] bg-[#fff8df] px-4 py-3 text-center font-['Lexend',sans-serif] text-sm font-medium leading-5 text-[#806814]">
                Compare assignments, assessments, and important deadlines with your original outline.
              </div>

              <AlertDialogFooter className="mt-6 gap-3 sm:justify-center">
                <AlertDialogCancel className="h-auto cursor-pointer rounded-xl border-[#ddd4ba] bg-white px-5 py-3 font-['Lexend',sans-serif] text-sm font-semibold text-[#645f52] shadow-none transition-colors hover:bg-[#f8f6ef] hover:text-[#1c180d]">
                  Keep reviewing
                </AlertDialogCancel>
                <AlertDialogAction
                  onClick={handleConfirmExport}
                  className="h-auto cursor-pointer rounded-xl bg-[#f2b90d] px-5 py-3 font-['Lexend',sans-serif] text-sm font-bold text-[#1c180d] shadow-[0px_0px_0px_3px_rgba(242,185,13,0.18)] transition-all hover:bg-[#e8b20c] hover:shadow-[0px_0px_0px_4px_rgba(242,185,13,0.25)]"
                >
                  Continue to export
                </AlertDialogAction>
              </AlertDialogFooter>
            </div>
          </AlertDialogContent>
        </AlertDialog>

        <FlowFooter
          backLabel="Back to Sections"
          onBack={() => navigate("/sections")}
          onAction={handleNext}
          actionLabel="Next: Export Calendar"
        />
      </div>
    </RouteGuard>
  );
}
