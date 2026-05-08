import type {
  EventCandidate,
  EventConfidence,
  EventGroup,
  EventTiming,
  EventType,
  ParsedCourse,
} from "./types";
import type { AiExtractedEvent, AiExtractionResponse } from "./aiExtractionSchema";

interface MappingOptions {
  termBounds?: {
    startDate: string;
    endDate: string;
  };
  outlineText?: string;
}

const EVENT_GROUP_BY_TYPE: Record<EventType, EventGroup> = {
  Lecture: "Lecture",
  Tutorial: "Tutorial",
  Lab: "Lab",
  OfficeHours: "Office Hours",
  Assessment: "Assessments",
  Assignment: "Assignments",
  Other: "Other",
};

function buildStableId(seed: string) {
  let hash = 2166136261;
  for (let index = 0; index < seed.length; index += 1) {
    hash ^= seed.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return Math.abs(hash >>> 0).toString(36);
}

function normalizeWhitespace(value: string | null | undefined) {
  return (value ?? "").replace(/\s+/g, " ").trim();
}

function normalizeOnlinePlatformLocation(value: string | null | undefined) {
  const normalized = normalizeWhitespace(value);
  if (!normalized) return "";

  const platformMatch =
    normalized.match(
      /^(?:online|electronically|submitted online)\s*,?\s*(?:through|via|on|using|in)\s+(.+)$/i
    ) ?? normalized.match(/^online\s*\(([^)]+)\)$/i);
  if (!platformMatch) return normalized;

  const platform = normalizeWhitespace(platformMatch[1])
    .replace(/^the\s+/i, "")
    .replace(/[.;,]+$/g, "");

  if (!platform || /^(?:online|platform|course platform|system|portal)$/i.test(platform)) {
    return normalized;
  }

  return platform;
}

function unique(values: string[]) {
  return Array.from(new Set(values.map(normalizeWhitespace).filter(Boolean)));
}

function normalizeWeight(value: string | null) {
  const normalized = normalizeWhitespace(value);
  if (!normalized) return "";
  return normalized.replace(/\s*%\s*$/, "%");
}

function titleWithLocation(base: string, location: string) {
  return location ? `${base} @ ${location}` : base;
}

function defaultTitle(course: ParsedCourse, eventType: EventType, label: string, location: string) {
  if (eventType === "OfficeHours") {
    return titleWithLocation(`${course.courseCode} Office Hours`, location);
  }
  return titleWithLocation(`${course.courseCode} ${label}`.trim(), location);
}

function confidenceFromTiming(
  timing: EventTiming,
  originalConfidence: EventConfidence
): EventConfidence {
  if (originalConfidence === "low") return "low";
  if (timing.kind === "single") {
    if (!timing.date) return "low";
    if (timing.startTime && timing.endTime) return originalConfidence;
    return originalConfidence === "high" ? "medium" : originalConfidence;
  }
  if (!timing.startDate || !timing.endDate || timing.byDay.length === 0) {
    return "low";
  }
  if (timing.startTime && timing.endTime) return originalConfidence;
  return originalConfidence === "high" ? "medium" : originalConfidence;
}

function reviewNeededForTiming(timing: EventTiming, confidence: EventConfidence) {
  if (confidence === "low") return true;
  if (timing.kind === "single") {
    if (!timing.date) return true;
    return Boolean(
      (timing.startTime && !timing.endTime) || (!timing.startTime && timing.endTime)
    );
  }
  if (!timing.startDate || !timing.endDate || timing.byDay.length === 0) return true;
  return Boolean(
    (timing.startTime && !timing.endTime) || (!timing.startTime && timing.endTime)
  );
}

function isSinglePointDeadlineAtEndOfDay(startTime?: string, endTime?: string) {
  if (!startTime && !endTime) return false;
  if (startTime === "23:59" && !endTime) return true;
  if (!startTime && endTime === "23:59") return true;
  return startTime === "23:59" && endTime === "23:59";
}

function dueTimeOnly(startTime?: string, endTime?: string) {
  if (startTime && !endTime) return startTime;
  if (!startTime && endTime) return endTime;
  return undefined;
}

function normalizeMeridiemTime(hourText: string, minuteText: string | undefined, meridiem: string) {
  let hour = Number(hourText);
  const minute = Number(minuteText ?? "00");
  if (!Number.isFinite(hour) || !Number.isFinite(minute)) return undefined;

  const normalizedMeridiem = meridiem.toLowerCase();
  if (normalizedMeridiem === "pm" && hour < 12) hour += 12;
  if (normalizedMeridiem === "am" && hour === 12) hour = 0;

  return `${`${hour}`.padStart(2, "0")}:${`${minute}`.padStart(2, "0")}`;
}

function extractDueTimeFromText(value: string | null | undefined) {
  const text = normalizeWhitespace(value);
  if (!text) return undefined;

  const contextualMeridiem = text.match(
    /\b(?:assignments?|due|deadline|deadlines|by|at)\b[^.\n|]{0,80}?\b(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b/i
  );
  if (contextualMeridiem) {
    return normalizeMeridiemTime(
      contextualMeridiem[1],
      contextualMeridiem[2],
      contextualMeridiem[3]
    );
  }

  const tableMeridiem = text.match(
    /\bassignments?\b[^.\n]{0,140}?\b(?:mon|tue|wed|thu|fri|sat|sun|monday|tuesday|wednesday|thursday|friday|saturday|sunday)s?\s+at\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b/i
  );
  if (tableMeridiem) {
    return normalizeMeridiemTime(tableMeridiem[1], tableMeridiem[2], tableMeridiem[3]);
  }

  return undefined;
}

function dueTimeFromItem(item: AiExtractedEvent) {
  if (item.timing.kind !== "single" || item.eventType !== "Assignment") return undefined;
  return (
    dueTimeOnly(item.timing.startTime ?? undefined, item.timing.endTime ?? undefined) ??
    extractDueTimeFromText(
      [item.label, ...item.notes, item.sourceSectionTitle ?? "", item.sourceSnippet].join(" ")
    )
  );
}

function defaultAssignmentDueTime(extraction: AiExtractionResponse, outlineText?: string) {
  return (
    extraction.events.map(dueTimeFromItem).find(Boolean) ??
    extractDueTimeFromText(outlineText)
  );
}

function mapTiming(item: AiExtractedEvent, options: MappingOptions): EventTiming {
  const timing = item.timing;
  let startTime = timing.startTime ?? undefined;
  let endTime = timing.endTime ?? undefined;

  if (timing.kind === "recurring") {
    const canUseTermBoundsForOfficeHours =
      item.eventType === "OfficeHours" && timing.byDay.length > 0 && options.termBounds;

    return {
      kind: "recurring",
      startDate:
        timing.startDate ?? (canUseTermBoundsForOfficeHours ? options.termBounds?.startDate : undefined),
      endDate:
        timing.recurringEndDate ??
        (canUseTermBoundsForOfficeHours ? options.termBounds?.endDate : undefined),
      startTime,
      endTime,
      byDay: timing.byDay,
      exDates: timing.exDates,
      occurrenceNotes: {},
      occurrenceOverrides: {},
    };
  }

  if (
    item.eventType !== "OfficeHours" &&
    (isSinglePointDeadlineAtEndOfDay(startTime, endTime) ||
      (item.eventType === "Assignment" && dueTimeOnly(startTime, endTime)))
  ) {
    startTime = undefined;
    endTime = undefined;
  }

  return {
    kind: "single",
    date: timing.date ?? undefined,
    endDate: timing.endDate ?? undefined,
    startTime,
    endTime,
    allDay: timing.allDay || !startTime || !endTime,
  };
}

function notesForItem(item: AiExtractedEvent, timing: EventTiming, fallbackDueTime?: string) {
  const weight = normalizeWeight(item.weight);
  const dateUnresolved =
    timing.kind === "single" && !timing.date && item.eventType !== "OfficeHours";
  const sourceDueTime =
    item.timing.kind === "single" && item.eventType === "Assignment"
      ? dueTimeFromItem(item) ?? fallbackDueTime
      : undefined;
  return unique([
    ...(weight ? [`Weight: ${weight}`] : []),
    ...(sourceDueTime ? [`Due time: ${sourceDueTime}`] : []),
    ...(dateUnresolved ? ["Date unresolved"] : []),
    ...item.notes,
  ]);
}

function labelForItem(item: AiExtractedEvent) {
  const normalized = normalizeWhitespace(item.label);
  if (normalized) return normalized;
  if (item.eventType === "OfficeHours") return "Office Hours";
  if (item.eventType === "Assignment") return "Assignment";
  if (item.eventType === "Assessment") return "Assessment";
  return "Other Event";
}

function officeHourLabel(item: AiExtractedEvent, label: string) {
  const person = normalizeWhitespace(item.instructorName);
  if (person) return `Office Hours with ${person}`;
  return /^office hours\b/i.test(label) ? label : `Office Hours: ${label}`;
}

export function mapAiExtractionToEventCandidates(
  extraction: AiExtractionResponse,
  course: ParsedCourse,
  options: MappingOptions = {}
) {
  const fallbackAssignmentDueTime = defaultAssignmentDueTime(extraction, options.outlineText);

  return extraction.events.map((item): EventCandidate => {
    const eventType = item.eventType;
    const eventGroup = EVENT_GROUP_BY_TYPE[eventType];
    const location = normalizeOnlinePlatformLocation(item.location);
    const baseLabel = labelForItem(item);
    const label = item.eventType === "OfficeHours" ? officeHourLabel(item, baseLabel) : baseLabel;
    const timing = mapTiming(item, options);
    const confidence = confidenceFromTiming(timing, item.confidence);
    const reviewNeeded = reviewNeededForTiming(timing, confidence);
    const id = buildStableId(
      [
        course.id,
        "ai",
        eventType,
        label,
        location,
        timing.kind === "single"
          ? `${timing.date ?? ""}:${timing.endDate ?? ""}:${timing.startTime ?? ""}:${timing.endTime ?? ""}`
          : `${timing.startDate ?? ""}:${timing.endDate ?? ""}:${timing.byDay.join(",")}:${timing.startTime ?? ""}:${timing.endTime ?? ""}`,
        item.sourceSnippet,
      ].join(":")
    );

    return {
      id,
      outlineId: course.outlineId,
      courseId: course.id,
      courseCode: course.courseCode,
      courseName: course.courseName,
      label,
      title: defaultTitle(course, eventType, label, location),
      location,
      eventType,
      eventGroup,
      sectionOptionIds: [],
      extractedSectionLabels: [],
      instructorName: item.instructorName ?? undefined,
      instructorEmail: item.instructorEmail ?? undefined,
      notes: notesForItem(item, timing, fallbackAssignmentDueTime),
      confidence,
      reviewNeeded,
      include: !reviewNeeded,
      timing,
      provenance: [
        {
          sectionId: "ai_non_meeting_extraction",
          sectionTitle: item.sourceSectionTitle ?? "AI extracted outline content",
          sourceKind: item.sourceKind,
          snippet: normalizeWhitespace(item.sourceSnippet).slice(0, 220),
        },
      ],
    };
  });
}
