import { addDays, eachDayOfInterval, format, getDay, parseISO } from "date-fns";
import type {
  CourseSelection,
  EventCandidate,
  EventGroup,
  ExportConfig,
  ExportNotificationSetting,
  ExportValidationIssue,
  ParsedCourse,
  ParsedSectionOption,
  WeekdayCode,
} from "./types";

const WEEKDAY_BY_INDEX: WeekdayCode[] = ["SU", "MO", "TU", "WE", "TH", "FR", "SA"];
const WEEKDAY_LABELS: Record<WeekdayCode, string> = {
  MO: "Mon",
  TU: "Tue",
  WE: "Wed",
  TH: "Thu",
  FR: "Fri",
  SA: "Sat",
  SU: "Sun",
};
const GOOGLE_MEETING_CODE_BY_TYPE = {
  Lecture: "LEC",
  Tutorial: "TUT",
  Lab: "LAB",
} as const;

function unique(values: string[]) {
  return Array.from(new Set(values.filter(Boolean)));
}

function normalizeInlineText(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

function eventNotes(event: EventCandidate, occurrenceNotes?: string[]) {
  return unique([...(event.notes ?? []), ...(occurrenceNotes ?? [])]);
}

function extractAvailableDates(notes: string[]) {
  return unique(
    notes
      .map((note) => note.match(/^Available from (\d{4}-\d{2}-\d{2})$/i)?.[1])
      .filter(Boolean) as string[]
  );
}

function extractWeight(notes: string[]) {
  return notes
    .map((note) => note.match(/^Weight:\s*(.+)$/i)?.[1]?.trim())
    .find(Boolean);
}

function extractDueTime(notes: string[]) {
  return notes
    .map((note) => note.match(/^Due time:\s*(\d{2}:\d{2})$/i)?.[1]?.trim())
    .find(Boolean);
}

function formatDisplayTime(value: string) {
  const [hourText, minuteText] = value.split(":");
  const hour = Number(hourText);
  const minute = Number(minuteText);
  if (!Number.isFinite(hour) || !Number.isFinite(minute)) return value;

  const suffix = hour >= 12 ? "PM" : "AM";
  const hour12 = hour % 12 || 12;
  return `${hour12}:${`${minute}`.padStart(2, "0")} ${suffix}`;
}

function assignmentDueTime(event: EventCandidate, occurrenceNotes?: string[]) {
  const noteTime = extractDueTime(eventNotes(event, occurrenceNotes));
  if (noteTime) return noteTime;
  if (event.eventType !== "Assignment" || event.timing.kind !== "single") return undefined;
  if (event.timing.startTime && !event.timing.endTime) return event.timing.startTime;
  if (!event.timing.startTime && event.timing.endTime) return event.timing.endTime;
  return undefined;
}

function assignmentHasOnlyDueTime(event: EventCandidate) {
  return Boolean(assignmentDueTime(event));
}

function titleWithAssignmentDueTime(title: string, event: EventCandidate, occurrenceNotes?: string[]) {
  const dueTime = assignmentDueTime(event, occurrenceNotes);
  if (!dueTime) return title;
  const displayTime = formatDisplayTime(dueTime);
  if (
    new RegExp(`\\bdue\\s+${dueTime.replace(":", "\\:")}\\b`, "i").test(title) ||
    title.toLowerCase().includes(displayTime.toLowerCase())
  ) {
    return title;
  }
  return `${title} (due ${displayTime})`;
}

function titleWithLocation(base: string, location: string) {
  const normalizedLocation = normalizeInlineText(location);
  return normalizedLocation ? `${base} @ ${normalizedLocation}` : base;
}

function stripLocationSuffix(title: string, location: string) {
  const normalizedLocation = normalizeInlineText(location);
  if (!normalizedLocation) return title;
  const suffix = ` @ ${normalizedLocation}`;
  return title.endsWith(suffix) ? title.slice(0, -suffix.length) : title;
}

function isPhysicalAssessmentLocation(location: string) {
  const normalized = normalizeInlineText(location);
  if (!normalized) return false;
  return /^[A-Z]{1,5}\s\d{3,4}[A-Za-z]?(?:\s*\/\s*[A-Z]{1,5}\s\d{3,4}[A-Za-z]?)*$/i.test(
    normalized
  );
}

function isExportableAssignmentLocation(location: string) {
  const normalized = normalizeInlineText(location);
  if (!normalized) return false;
  if (isPhysicalAssessmentLocation(normalized)) return true;
  return /^(?:LEARN|LEARN Drop ?Box|LEARN Quiz|Crowdmark|McGraw-Hill Connect|Marmoset|Kritik|PebblePad(?: Portfolio)?|Padlet(?: \/ LEARN)?)$/i.test(
    normalized
  );
}

export function exportLocationForEvent(event: EventCandidate, overrideLocation?: string) {
  const normalizedLocation = normalizeInlineText(overrideLocation ?? event.location);
  if (!normalizedLocation) return "";
  if (event.eventType === "Assessment") {
    return isPhysicalAssessmentLocation(normalizedLocation) ? normalizedLocation : "";
  }
  if (event.eventType === "Assignment") {
    return isExportableAssignmentLocation(normalizedLocation) ? normalizedLocation : "";
  }
  return normalizedLocation;
}

function assignmentDescriptionNotes(notes: string[]) {
  return unique(
    notes.filter(
      (note) =>
        !/^Available from \d{4}-\d{2}-\d{2}$/i.test(note) &&
        !/^Weight:\s*/i.test(note) &&
        !/^Excluded:\s*/i.test(note) &&
        !/^Recurring .* series covering /i.test(note) &&
        !/^Assignments:\s*/i.test(note)
    )
  );
}

function notificationSettingToMinutes(setting: ExportNotificationSetting) {
  switch (setting) {
    case "atTime":
      return 0;
    case "10m":
      return 10;
    case "30m":
      return 30;
    case "1h":
      return 60;
    case "1d":
      return 1440;
    case "custom":
      return "custom";
    case "none":
      return null;
    default:
      return undefined;
  }
}

function normalizeCustomNotificationMinutes(minutes: number | undefined) {
  if (!Number.isFinite(minutes)) return 15;
  return Math.max(1, Math.min(43200, Math.round(minutes as number)));
}

export function exportNotificationMinutes(
  exportConfig: ExportConfig,
  eventGroup: EventGroup
) {
  const setting = notificationSettingToMinutes(
    exportConfig.notificationSettings[eventGroup] ?? "default"
  );
  if (setting === "custom") {
    return normalizeCustomNotificationMinutes(
      exportConfig.customNotificationMinutes?.[eventGroup]
    );
  }
  return setting;
}

export function buildGoogleEventReminders(
  exportConfig: ExportConfig,
  eventGroup: EventGroup
) {
  const minutes = exportNotificationMinutes(exportConfig, eventGroup);
  if (minutes === undefined) {
    return { useDefault: true };
  }
  if (minutes === null) {
    return { useDefault: false, overrides: [] as Array<{ method: "popup"; minutes: number }> };
  }
  return {
    useDefault: false,
    overrides: [{ method: "popup" as const, minutes }],
  };
}

function buildIcsAlarmLines(exportConfig: ExportConfig, event: EventCandidate) {
  const minutes = exportNotificationMinutes(exportConfig, event.eventGroup);
  if (minutes === undefined || minutes === null) {
    return [];
  }

  const trigger =
    minutes === 0
      ? "TRIGGER:PT0M"
      : minutes % 1440 === 0
        ? `TRIGGER:-P${minutes / 1440}D`
        : minutes % 60 === 0
          ? `TRIGGER:-PT${minutes / 60}H`
          : `TRIGGER:-PT${minutes}M`;

  return [
    "BEGIN:VALARM",
    "ACTION:DISPLAY",
    "DESCRIPTION:GooseCalendar Reminder",
    trigger,
    "END:VALARM",
  ];
}

function lectureDescriptionNotes(notes: string[]) {
  return unique(
    notes.filter(
      (note) =>
        !/^Available from \d{4}-\d{2}-\d{2}$/i.test(note) &&
        !/^Weight:\s*/i.test(note) &&
        !/^Excluded:\s*/i.test(note) &&
        !/^Assignments:\s*/i.test(note) &&
        !/^Recurring .* series covering /i.test(note) &&
        !/^Section:\s*/i.test(note)
    )
  );
}

function formatDescriptionBlock(
  heading: string,
  values: string[],
  bullet = false
) {
  if (values.length === 0) return [];
  if (!bullet) {
    return [heading, ...values];
  }
  return [heading, ...values.map((value) => `- ${value}`)];
}

function singularizeSeriesBase(base: string) {
  return normalizeInlineText(base)
    .replace(/\bAssignments\b/gi, "Assignment")
    .replace(/\bQuizzes\b/gi, "Quiz")
    .replace(/\bReports\b/gi, "Report")
    .replace(/\bResponses\b/gi, "Response")
    .replace(/\bPosts\b/gi, "Post");
}

function pluralizeSeriesBase(base: string) {
  const normalized = normalizeInlineText(base);
  if (/assignments$/i.test(normalized)) return normalized;
  if (/assignment$/i.test(normalized)) {
    return normalized.replace(/assignment$/i, "Assignments");
  }
  if (/quizzes$/i.test(normalized)) return normalized;
  if (/quiz$/i.test(normalized)) {
    return normalized.replace(/quiz$/i, "Quizzes");
  }
  if (/reports$/i.test(normalized)) return normalized;
  if (/report$/i.test(normalized)) {
    return normalized.replace(/report$/i, "Reports");
  }
  if (/responses$/i.test(normalized)) return normalized;
  if (/response$/i.test(normalized)) {
    return normalized.replace(/response$/i, "Responses");
  }
  if (/posts$/i.test(normalized)) return normalized;
  if (/post$/i.test(normalized)) {
    return normalized.replace(/post$/i, "Posts");
  }
  return normalized;
}

function compactAssignmentOccurrenceLabel(notes: string[]) {
  const assignmentsLine = notes.find((note) => /^Assignments:\s*/i.test(note));
  if (!assignmentsLine) return undefined;

  const labels = assignmentsLine
    .replace(/^Assignments:\s*/i, "")
    .split(/\s*,\s*/)
    .map((label) => normalizeInlineText(label.replace(/\*+$/g, "")))
    .filter(Boolean);

  if (labels.length === 0) return undefined;
  if (labels.length === 1) return labels[0];

  const parsed = labels.map((label) => {
    const match = label.match(/^(.*?)(?:\s*#\s*|\s+)(\d+)$/i);
    if (!match) return null;
    return {
      base: normalizeInlineText(match[1]),
      number: Number(match[2]),
    };
  });

  if (parsed.some((item) => !item)) {
    return labels.join(", ");
  }

  const resolved = parsed as Array<{ base: string; number: number }>;
  const base = resolved[0].base;
  if (!resolved.every((item) => item.base.toLowerCase() === base.toLowerCase())) {
    return labels.join(", ");
  }

  const numbers = Array.from(new Set(resolved.map((item) => item.number))).sort(
    (left, right) => left - right
  );

  if (numbers.length === 1) {
    return `${base} #${numbers[0]}`;
  }

  return `${pluralizeSeriesBase(base)} #${numbers[0]}-${numbers[numbers.length - 1]}`;
}

function formatShortDate(date: string) {
  return format(parseISO(date), "EEE, MMM d");
}

function formatAssignmentTiming(event: EventCandidate) {
  const directNotes = event.notes ?? [];
  const recurringNotes =
    event.timing.kind === "recurring"
      ? Object.values(event.timing.occurrenceNotes).flat()
      : [];
  const availableDates = extractAvailableDates([...directNotes, ...recurringNotes]);

  if (event.timing.kind === "single") {
    if (!event.timing.date) return "Date unresolved";
    if (availableDates.length === 0) {
      return event.timing.endDate
        ? `${formatShortDate(event.timing.date)} - ${formatShortDate(event.timing.endDate)}`
        : formatShortDate(event.timing.date);
    }

    const dueDate = event.timing.endDate ?? event.timing.date;
    return `Publishes ${formatShortDate(availableDates[0])} · Due ${formatShortDate(dueDate)}`;
  }

  const parts: string[] = [];
  if (availableDates.length > 0) {
    const publishWeekdays = unique(
      availableDates.map((date) => format(parseISO(date), "EEE"))
    );
    if (publishWeekdays.length === 1) {
      parts.push(`Publishes ${publishWeekdays[0]}`);
    } else {
      parts.push(`Publishes ${formatShortDate(availableDates[0])}`);
    }
  }
  if (event.timing.byDay.length > 0) {
    parts.push(`Due ${event.timing.byDay.map((day) => WEEKDAY_LABELS[day]).join("/")}`);
  }
  if (event.timing.startDate && event.timing.endDate) {
    parts.push(
      `${format(parseISO(event.timing.startDate), "MMM d")} - ${format(
        parseISO(event.timing.endDate),
        "MMM d"
      )}`
    );
  }
  return parts.join(" · ");
}

function escapeIcsText(value: string) {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/\n/g, "\\n")
    .replace(/,/g, "\\,")
    .replace(/;/g, "\\;");
}

function foldIcsLine(value: string) {
  if (value.length <= 75) return value;
  const parts: string[] = [];
  let remaining = value;
  while (remaining.length > 75) {
    parts.push(remaining.slice(0, 75));
    remaining = ` ${remaining.slice(75)}`;
  }
  parts.push(remaining);
  return parts.join("\r\n");
}

function toIcsDate(date: string) {
  return date.replace(/-/g, "");
}

function toIcsDateTime(date: string, time: string) {
  return `${toIcsDate(date)}T${time.replace(":", "")}00`;
}

function dtstampNow() {
  return new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
}

function vtimezoneBlock() {
  return [
    "BEGIN:VTIMEZONE",
    "TZID:America/Toronto",
    "X-LIC-LOCATION:America/Toronto",
    "BEGIN:DAYLIGHT",
    "TZOFFSETFROM:-0500",
    "TZOFFSETTO:-0400",
    "TZNAME:EDT",
    "DTSTART:19700308T020000",
    "RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=2SU",
    "END:DAYLIGHT",
    "BEGIN:STANDARD",
    "TZOFFSETFROM:-0400",
    "TZOFFSETTO:-0500",
    "TZNAME:EST",
    "DTSTART:19701101T020000",
    "RRULE:FREQ=YEARLY;BYMONTH=11;BYDAY=1SU",
    "END:STANDARD",
    "END:VTIMEZONE",
  ].join("\r\n");
}

export function getCourseSelection(
  courseId: string,
  selections: Record<string, CourseSelection>
) {
  return (
    selections[courseId] ?? {
      selectedSectionOptionIds: [],
      includedGroups: [],
      selectedOfficeHourEventIds: [],
    }
  );
}

export function getCourseSectionMap(course: ParsedCourse) {
  return new Map(course.sectionOptions.map((section) => [section.id, section]));
}

export function getSelectedSectionLabels(
  course: ParsedCourse,
  selection: CourseSelection,
  event?: EventCandidate
) {
  const sectionMap = getCourseSectionMap(course);
  const explicitLabels =
    event?.sectionOptionIds.length
      ? event.sectionOptionIds
          .map((sectionId) => sectionMap.get(sectionId)?.label)
          .filter(Boolean)
      : [];
  if (explicitLabels.length > 0) return explicitLabels as string[];

  const selectedLabels = selection.selectedSectionOptionIds
    .map((sectionId) => sectionMap.get(sectionId)?.label)
    .filter(Boolean);

  return selectedLabels.length > 0 ? (selectedLabels as string[]) : event?.extractedSectionLabels ?? [];
}

export function isEventVisible(
  event: EventCandidate,
  selection: CourseSelection
) {
  if (!selection.includedGroups.includes(event.eventGroup)) return false;

  if (event.eventGroup === "Office Hours") {
    return selection.selectedOfficeHourEventIds.includes(event.id);
  }

  if (event.sectionOptionIds.length === 0) return true;
  return event.sectionOptionIds.some((sectionId) =>
    selection.selectedSectionOptionIds.includes(sectionId)
  );
}

export function getVisibleCourseEvents(
  course: ParsedCourse,
  allEvents: EventCandidate[],
  selections: Record<string, CourseSelection>
) {
  const selection = getCourseSelection(course.id, selections);
  return allEvents
    .filter((event) => event.courseId === course.id)
    .filter((event) => isEventVisible(event, selection));
}

export function formatEventTiming(event: EventCandidate) {
  if (event.eventType === "Assignment") {
    return formatAssignmentTiming(event);
  }

  if (event.timing.kind === "single") {
    if (!event.timing.date) return "Date unresolved";
    if (!event.timing.startTime || !event.timing.endTime) {
      return format(parseISO(event.timing.date), "EEE, MMM d");
    }
    return `${format(parseISO(event.timing.date), "EEE, MMM d")} · ${
      event.timing.startTime
    }-${event.timing.endTime}`;
  }

  const parts: string[] = [];
  if (event.timing.byDay.length > 0) {
    parts.push(event.timing.byDay.map((day) => WEEKDAY_LABELS[day]).join("/"));
  }
  if (event.timing.startTime && event.timing.endTime) {
    parts.push(`${event.timing.startTime}-${event.timing.endTime}`);
  }
  if (event.timing.startDate && event.timing.endDate) {
    parts.push(
      `${format(parseISO(event.timing.startDate), "MMM d")} - ${format(
        parseISO(event.timing.endDate),
        "MMM d"
      )}`
    );
  }
  const overrideCount =
    event.timing.kind === "recurring"
      ? Object.keys(event.timing.occurrenceOverrides).length
      : 0;
  if (overrideCount > 0) {
    parts.push(
      `${overrideCount} special date${overrideCount === 1 ? "" : "s"}`
    );
  }
  return parts.length > 0 ? parts.join(" · ") : "Recurring schedule";
}

export function buildEventSummary(
  event: EventCandidate,
  occurrenceNotes?: string[],
  target: "default" | "google" = "default"
) {
  void target;
  if (
    event.eventType === "Lecture" ||
    event.eventType === "Tutorial" ||
    event.eventType === "Lab"
  ) {
    const baseTitle = `${event.courseCode} (${GOOGLE_MEETING_CODE_BY_TYPE[event.eventType]})`;
    return titleWithLocation(baseTitle, exportLocationForEvent(event));
  }

  if (event.eventType === "Assessment") {
    const baseTitle = stripLocationSuffix(event.title, event.location);
    return titleWithLocation(baseTitle, exportLocationForEvent(event));
  }

  if (event.eventType === "Assignment") {
    const baseTitle = stripLocationSuffix(event.title, event.location);
    if (!occurrenceNotes?.length) {
      return titleWithLocation(
        titleWithAssignmentDueTime(baseTitle, event, occurrenceNotes),
        exportLocationForEvent(event)
      );
    }

    const occurrenceLabel = compactAssignmentOccurrenceLabel(occurrenceNotes);
    const resolvedBaseTitle = occurrenceLabel
      ? `${event.courseCode} ${occurrenceLabel}`.trim()
      : baseTitle;

    return titleWithLocation(
      titleWithAssignmentDueTime(resolvedBaseTitle, event, occurrenceNotes),
      exportLocationForEvent(event)
    );
  }

  return event.title;
}

export function buildEventDescription(
  course: ParsedCourse,
  selection: CourseSelection,
  event: EventCandidate,
  occurrenceNotes?: string[]
) {
  void course;
  void selection;

  const notes = eventNotes(event, occurrenceNotes);

  if (
    event.eventType === "Lecture" ||
    event.eventType === "Tutorial" ||
    event.eventType === "Lab" ||
    event.eventType === "OfficeHours" ||
    event.eventType === "Other"
  ) {
    const lines: string[] = [];
    if (event.instructorName) {
      lines.push(`Instructor Name: ${event.instructorName}`);
    }
    if (event.instructorEmail) {
      lines.push(`Instructor Email: ${event.instructorEmail}`);
    }
    if (event.eventType === "Lecture") {
      const lectureNotes = lectureDescriptionNotes(notes);
      if (lectureNotes.length > 0) {
        if (lines.length > 0) {
          lines.push("");
        }
        lines.push(...formatDescriptionBlock("Course Content for Week:", lectureNotes, true));
      }
    }
    return lines.join("\n");
  }

  if (event.eventType === "Assignment") {
    const weight = extractWeight(notes);
    const lines = weight ? [`Weight: ${weight}`] : [];
    return lines.join("\n");
  }

  if (event.eventType === "Assessment") {
    const weight = extractWeight(notes);
    const lines = weight ? [`Weight: ${weight}`] : [];
    return lines.join("\n");
  }

  const lines: string[] = [];
  if (notes.length > 0) {
    lines.push(`Notes: ${notes.join(" | ")}`);
  }

  return lines.join("\n");
}

export function validateEventForExport(event: EventCandidate) {
  if (event.timing.kind === "single") {
    if (!event.timing.date) return "Missing event date.";
    if (assignmentHasOnlyDueTime(event)) return null;
    if ((event.timing.startTime && !event.timing.endTime) || (!event.timing.startTime && event.timing.endTime)) {
      return "Timed events need both a start and end time.";
    }
    return null;
  }

  if (!event.timing.startDate || !event.timing.endDate) {
    return "Recurring events need a start and end date.";
  }
  if (event.timing.endDate < event.timing.startDate) {
    return "Recurring events cannot end before they start.";
  }
  if (event.timing.byDay.length === 0) {
    return "Recurring events need at least one weekday.";
  }
  if ((event.timing.startTime && !event.timing.endTime) || (!event.timing.startTime && event.timing.endTime)) {
    return "Recurring timed events need both a start and end time.";
  }
  return null;
}

export function getExportValidationIssues(
  courses: ParsedCourse[],
  allEvents: EventCandidate[],
  selections: Record<string, CourseSelection>
) {
  const courseMap = new Map(courses.map((course) => [course.id, course]));
  const issues: ExportValidationIssue[] = [];

  courses.forEach((course) => {
    const selection = getCourseSelection(course.id, selections);
    allEvents
      .filter((event) => event.courseId === course.id)
      .filter((event) => isEventVisible(event, selection))
      .filter((event) => event.include)
      .forEach((event) => {
        const message = validateEventForExport(event);
        if (!message) return;
        issues.push({
          eventId: event.id,
          courseId: course.id,
          eventLabel: `${courseMap.get(course.id)?.courseCode ?? course.id}: ${event.label}`,
          message,
        });
      });
  });

  return issues;
}

function recurringOccurrenceDates(event: EventCandidate) {
  if (
    event.timing.kind !== "recurring" ||
    !event.timing.startDate ||
    !event.timing.endDate
  ) {
    return [];
  }

  return eachDayOfInterval({
    start: parseISO(event.timing.startDate),
    end: parseISO(event.timing.endDate),
  })
    .filter((date) => event.timing.byDay.includes(WEEKDAY_BY_INDEX[getDay(date)]))
    .map((date) => format(date, "yyyy-MM-dd"));
}

function firstRecurringOccurrenceDate(event: EventCandidate) {
  return recurringOccurrenceDates(event)[0];
}

function buildRecurringEventLines(
  course: ParsedCourse,
  selection: CourseSelection,
  event: EventCandidate,
  exportConfig: ExportConfig
) {
  if (
    event.timing.kind !== "recurring" ||
    !event.timing.startDate ||
    !event.timing.endDate
  ) {
    return [];
  }

  const dtstamp = dtstampNow();
  const uid = `${event.id}@goosecalendar`;
  const baseNotes = buildEventDescription(course, selection, event);
  const exDates = new Set(event.timing.exDates);
  const firstOccurrenceDate = firstRecurringOccurrenceDate(event);
  if (!firstOccurrenceDate) return [];
  const untilTime = event.timing.endTime ?? event.timing.startTime ?? "23:59";
  const lines: string[] = [
    "BEGIN:VEVENT",
    `UID:${uid}`,
    `DTSTAMP:${dtstamp}`,
    foldIcsLine(
      `SUMMARY:${escapeIcsText(
        buildEventSummary(
          event,
          event.timing.occurrenceNotes[firstOccurrenceDate] ?? undefined
        )
      )}`
    ),
    foldIcsLine(`DESCRIPTION:${escapeIcsText(baseNotes)}`),
  ];

  const exportedLocation = exportLocationForEvent(event);
  if (exportedLocation) {
    lines.push(foldIcsLine(`LOCATION:${escapeIcsText(exportedLocation)}`));
  }

  if (event.timing.startTime && event.timing.endTime) {
    lines.push(
      `DTSTART;TZID=America/Toronto:${toIcsDateTime(firstOccurrenceDate, event.timing.startTime)}`
    );
    lines.push(
      `DTEND;TZID=America/Toronto:${toIcsDateTime(firstOccurrenceDate, event.timing.endTime)}`
    );
    lines.push(
      `RRULE:FREQ=WEEKLY;BYDAY=${event.timing.byDay.join(",")};UNTIL=${toIcsDateTime(
        event.timing.endDate,
        untilTime
      )}`
    );
  } else {
    lines.push(`DTSTART;VALUE=DATE:${toIcsDate(firstOccurrenceDate)}`);
    lines.push(
      `RRULE:FREQ=WEEKLY;BYDAY=${event.timing.byDay.join(",")};UNTIL=${toIcsDate(
        event.timing.endDate
      )}`
    );
  }

  if (event.timing.exDates.length > 0) {
    if (event.timing.startTime) {
      lines.push(
        `EXDATE;TZID=America/Toronto:${event.timing.exDates
          .sort()
          .map((date) => toIcsDateTime(date, event.timing.startTime!))
          .join(",")}`
      );
    } else {
      lines.push(
        `EXDATE;VALUE=DATE:${event.timing.exDates.sort().map((date) => toIcsDate(date)).join(",")}`
      );
    }
  }

  lines.push(...buildIcsAlarmLines(exportConfig, event));
  lines.push("END:VEVENT");

  const overrideEntries = Object.entries(event.timing.occurrenceNotes)
    .filter(([date, notes]) => !exDates.has(date) && notes.length > 0);
  const overrideDates = Array.from(
    new Set([
      ...overrideEntries.map(([date]) => date),
      ...Object.keys(event.timing.occurrenceOverrides).filter((date) => !exDates.has(date)),
    ])
  ).map((date) => ({
    date,
    notes: event.timing.occurrenceNotes[date] ?? [],
    override: event.timing.occurrenceOverrides[date],
  }));

  overrideDates.forEach(({ date, notes, override }) => {
    const description = buildEventDescription(course, selection, event, notes);
    lines.push("BEGIN:VEVENT");
    lines.push(`UID:${uid}`);
    lines.push(`DTSTAMP:${dtstamp}`);
    if (event.timing.startTime && event.timing.endTime) {
      lines.push(
        `RECURRENCE-ID;TZID=America/Toronto:${toIcsDateTime(date, event.timing.startTime)}`
      );
      lines.push(
        `DTSTART;TZID=America/Toronto:${toIcsDateTime(
          date,
          override?.startTime ?? event.timing.startTime
        )}`
      );
      lines.push(
        `DTEND;TZID=America/Toronto:${toIcsDateTime(
          date,
          override?.endTime ?? event.timing.endTime
        )}`
      );
    } else {
      lines.push(`RECURRENCE-ID;VALUE=DATE:${toIcsDate(date)}`);
      lines.push(`DTSTART;VALUE=DATE:${toIcsDate(date)}`);
    }
    lines.push(
      foldIcsLine(`SUMMARY:${escapeIcsText(buildEventSummary(event, notes))}`)
    );
    lines.push(foldIcsLine(`DESCRIPTION:${escapeIcsText(description)}`));
    const exportedOverrideLocation = exportLocationForEvent(
      event,
      override?.location ?? event.location
    );
    if (exportedOverrideLocation) {
      lines.push(
        foldIcsLine(`LOCATION:${escapeIcsText(exportedOverrideLocation)}`)
      );
    }
    lines.push("END:VEVENT");
  });

  return lines;
}

function buildSingleEventLines(
  course: ParsedCourse,
  selection: CourseSelection,
  event: EventCandidate,
  exportConfig: ExportConfig
) {
  if (event.timing.kind !== "single" || !event.timing.date) return [];

  const dtstamp = dtstampNow();
  const lines = [
    "BEGIN:VEVENT",
    `UID:${event.id}@goosecalendar`,
    `DTSTAMP:${dtstamp}`,
    foldIcsLine(`SUMMARY:${escapeIcsText(buildEventSummary(event))}`),
    foldIcsLine(`DESCRIPTION:${escapeIcsText(buildEventDescription(course, selection, event))}`),
  ];

  const exportedLocation = exportLocationForEvent(event);
  if (exportedLocation) {
    lines.push(foldIcsLine(`LOCATION:${escapeIcsText(exportedLocation)}`));
  }

  if (
    event.timing.allDay ||
    (!event.timing.startTime && !event.timing.endTime) ||
    assignmentHasOnlyDueTime(event)
  ) {
    lines.push(`DTSTART;VALUE=DATE:${toIcsDate(event.timing.date)}`);
    const inclusiveEndDate = event.timing.endDate ?? event.timing.date;
    const nextDate = format(addDays(parseISO(inclusiveEndDate), 1), "yyyy-MM-dd");
    lines.push(`DTEND;VALUE=DATE:${toIcsDate(nextDate)}`);
  } else {
    lines.push(
      `DTSTART;TZID=America/Toronto:${toIcsDateTime(event.timing.date, event.timing.startTime!)}`
    );
    lines.push(
      `DTEND;TZID=America/Toronto:${toIcsDateTime(
        event.timing.endDate ?? event.timing.date,
        event.timing.endTime!
      )}`
    );
  }

  lines.push(...buildIcsAlarmLines(exportConfig, event));
  lines.push("END:VEVENT");
  return lines;
}

export function buildCalendarIcs(
  courses: ParsedCourse[],
  allEvents: EventCandidate[],
  selections: Record<string, CourseSelection>,
  exportConfig: ExportConfig
) {
  const courseMap = new Map(courses.map((course) => [course.id, course]));
  const issues = getExportValidationIssues(courses, allEvents, selections);
  if (issues.length > 0) {
    throw new Error("Cannot export calendar while included events are still incomplete.");
  }

  const bodyLines: string[] = [];
  courses.forEach((course) => {
    const selection = getCourseSelection(course.id, selections);
    allEvents
      .filter((event) => event.courseId === course.id)
      .filter((event) => event.include)
      .filter((event) => isEventVisible(event, selection))
      .forEach((event) => {
        const sourceCourse = courseMap.get(event.courseId);
        if (!sourceCourse) return;
        if (event.timing.kind === "recurring") {
          bodyLines.push(
            ...buildRecurringEventLines(sourceCourse, selection, event, exportConfig)
          );
        } else {
          bodyLines.push(
            ...buildSingleEventLines(sourceCourse, selection, event, exportConfig)
          );
        }
      });
  });

  return [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//GooseCalendar//UW Outline Calendar//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "X-WR-CALNAME:GooseCalendar",
    "X-WR-TIMEZONE:America/Toronto",
    vtimezoneBlock(),
    ...bodyLines,
    "END:VCALENDAR",
  ].join("\r\n");
}

export function downloadIcsFile(content: string, fileName = "goosecalendar.ics") {
  const blob = new Blob([content], { type: "text/calendar;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  URL.revokeObjectURL(url);
}

export function createDefaultCourseSelection(course: ParsedCourse) {
  const selectedSectionOptionIds: string[] = [];
  const seenKinds = new Set<string>();

  course.sectionOptions.forEach((section) => {
    if (seenKinds.has(section.kind)) return;
    seenKinds.add(section.kind);
    selectedSectionOptionIds.push(section.id);
  });

  return {
    selectedSectionOptionIds,
    includedGroups: unique(
      course.eventIds
        .map((eventId) => eventId)
        .length > 0
        ? [
            "Lecture",
            "Tutorial",
            "Lab",
            "Assessments",
            "Assignments",
            "Other",
          ]
        : []
    ) as CourseSelection["includedGroups"],
    selectedOfficeHourEventIds: [],
  };
}

function eventGroupForSectionKind(kind: string): EventGroup {
  const normalized = kind.toUpperCase();
  if (normalized.includes("LAB")) return "Lab";
  if (normalized.includes("TUT")) return "Tutorial";
  return "Lecture";
}

export function courseNeedsSectionChoice(course: ParsedCourse, selection: CourseSelection) {
  const multiChoiceKinds = unique(
    course.sectionOptions
      .filter(
        (section) =>
          course.sectionOptions.filter((other) => other.kind === section.kind).length > 1
      )
      .map((section) => section.kind)
  );

  return multiChoiceKinds.some(
    (kind) => {
      if (!selection.includedGroups.includes(eventGroupForSectionKind(kind))) {
        return false;
      }

      return !course.sectionOptions
        .filter((section) => section.kind === kind)
        .some((section) => selection.selectedSectionOptionIds.includes(section.id));
    }
  );
}
