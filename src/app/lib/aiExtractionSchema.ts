import type {
  EventConfidence,
  EventProvenance,
  EventType,
  WeekdayCode,
} from "./types";

export type AiExtractedEventType = Extract<
  EventType,
  "Assignment" | "Assessment" | "OfficeHours" | "Other"
>;

export type AiExtractedSourceKind = Extract<
  EventProvenance["sourceKind"],
  "table" | "prose" | "topic"
>;

export interface AiExtractedTiming {
  kind: "single" | "recurring";
  date: string | null;
  endDate: string | null;
  startTime: string | null;
  endTime: string | null;
  allDay: boolean;
  startDate: string | null;
  recurringEndDate: string | null;
  byDay: WeekdayCode[];
  exDates: string[];
}

export interface AiExtractedEvent {
  label: string;
  eventType: AiExtractedEventType;
  location: string | null;
  instructorName: string | null;
  instructorEmail: string | null;
  notes: string[];
  weight: string | null;
  confidence: EventConfidence;
  sourceKind: AiExtractedSourceKind;
  sourceSectionTitle: string | null;
  sourceSnippet: string;
  timing: AiExtractedTiming;
}

export interface AiExtractionResponse {
  events: AiExtractedEvent[];
  warnings: string[];
}

export interface AiOutlineExtractionRequest {
  outlineName: string;
  courseCode: string;
  courseName: string;
  term: string;
  termYear: number;
  outlineText: string;
  outlineHash?: string;
}

const EVENT_TYPES = new Set<AiExtractedEventType>([
  "Assignment",
  "Assessment",
  "OfficeHours",
  "Other",
]);

const SOURCE_KINDS = new Set<AiExtractedSourceKind>([
  "table",
  "prose",
  "topic",
]);

const CONFIDENCE_VALUES = new Set<EventConfidence>(["high", "medium", "low"]);
const WEEKDAY_VALUES = new Set<WeekdayCode>([
  "MO",
  "TU",
  "WE",
  "TH",
  "FR",
  "SA",
  "SU",
]);

const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const TIME_PATTERN = /^\d{2}:\d{2}$/;

export const EMPTY_AI_EXTRACTION: AiExtractionResponse = {
  events: [],
  warnings: [],
};

export const AI_EXTRACTION_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["events", "warnings"],
  properties: {
    events: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: [
          "label",
          "eventType",
          "location",
          "instructorName",
          "instructorEmail",
          "notes",
          "weight",
          "confidence",
          "sourceKind",
          "sourceSectionTitle",
          "sourceSnippet",
          "timing",
        ],
        properties: {
          label: { type: "string" },
          eventType: {
            type: "string",
            enum: ["Assignment", "Assessment", "OfficeHours", "Other"],
          },
          location: { type: ["string", "null"] },
          instructorName: { type: ["string", "null"] },
          instructorEmail: { type: ["string", "null"] },
          notes: {
            type: "array",
            items: { type: "string" },
          },
          weight: { type: ["string", "null"] },
          confidence: {
            type: "string",
            enum: ["high", "medium", "low"],
          },
          sourceKind: {
            type: "string",
            enum: ["table", "prose", "topic"],
          },
          sourceSectionTitle: { type: ["string", "null"] },
          sourceSnippet: { type: "string" },
          timing: {
            type: "object",
            additionalProperties: false,
            required: [
              "kind",
              "date",
              "endDate",
              "startTime",
              "endTime",
              "allDay",
              "startDate",
              "recurringEndDate",
              "byDay",
              "exDates",
            ],
            properties: {
              kind: {
                type: "string",
                enum: ["single", "recurring"],
              },
              date: { type: ["string", "null"] },
              endDate: { type: ["string", "null"] },
              startTime: { type: ["string", "null"] },
              endTime: { type: ["string", "null"] },
              allDay: { type: "boolean" },
              startDate: { type: ["string", "null"] },
              recurringEndDate: { type: ["string", "null"] },
              byDay: {
                type: "array",
                items: {
                  type: "string",
                  enum: ["MO", "TU", "WE", "TH", "FR", "SA", "SU"],
                },
              },
              exDates: {
                type: "array",
                items: { type: "string" },
              },
            },
          },
        },
      },
    },
    warnings: {
      type: "array",
      items: { type: "string" },
    },
  },
} as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringValue(value: unknown) {
  return typeof value === "string" ? value.trim() : undefined;
}

function nullableStringValue(value: unknown) {
  if (value === null) return null;
  if (typeof value !== "string") return undefined;
  return value.trim() || null;
}

function validateDate(value: string | null, field: string, errors: string[]) {
  if (value === null) return;
  if (!ISO_DATE_PATTERN.test(value)) {
    errors.push(`${field} must be YYYY-MM-DD`);
  }
}

function validateTime(value: string | null, field: string, errors: string[]) {
  if (value === null) return;
  if (!TIME_PATTERN.test(value)) {
    errors.push(`${field} must be HH:mm`);
  }
}

function validateStringArray(
  value: unknown,
  field: string,
  errors: string[],
  pattern?: RegExp
) {
  if (!Array.isArray(value)) {
    errors.push(`${field} must be an array`);
    return undefined;
  }

  const strings = value.map((item) =>
    typeof item === "string" ? item.trim() : undefined
  );
  if (strings.some((item) => item === undefined)) {
    errors.push(`${field} must contain only strings`);
    return undefined;
  }

  const normalized = strings.filter(Boolean) as string[];
  if (pattern && normalized.some((item) => !pattern.test(item))) {
    errors.push(`${field} contains an invalid value`);
    return undefined;
  }

  return normalized;
}

function validateTiming(value: unknown, errors: string[]) {
  if (!isRecord(value)) {
    errors.push("timing must be an object");
    return undefined;
  }

  const kind = stringValue(value.kind);
  if (kind !== "single" && kind !== "recurring") {
    errors.push("timing.kind must be single or recurring");
    return undefined;
  }

  const date = nullableStringValue(value.date);
  const endDate = nullableStringValue(value.endDate);
  const startTime = nullableStringValue(value.startTime);
  const endTime = nullableStringValue(value.endTime);
  const startDate = nullableStringValue(value.startDate);
  const recurringEndDate = nullableStringValue(value.recurringEndDate);

  if (date === undefined) errors.push("timing.date must be a string or null");
  if (endDate === undefined) errors.push("timing.endDate must be a string or null");
  if (startTime === undefined) errors.push("timing.startTime must be a string or null");
  if (endTime === undefined) errors.push("timing.endTime must be a string or null");
  if (startDate === undefined) errors.push("timing.startDate must be a string or null");
  if (recurringEndDate === undefined) {
    errors.push("timing.recurringEndDate must be a string or null");
  }

  const allDay = value.allDay;
  if (typeof allDay !== "boolean") {
    errors.push("timing.allDay must be a boolean");
  }

  const byDay = validateStringArray(value.byDay, "timing.byDay", errors);
  const normalizedByDay = byDay?.filter((day): day is WeekdayCode =>
    WEEKDAY_VALUES.has(day as WeekdayCode)
  );
  if (byDay && normalizedByDay?.length !== byDay.length) {
    errors.push("timing.byDay contains an invalid weekday");
  }

  const exDates = validateStringArray(
    value.exDates,
    "timing.exDates",
    errors,
    ISO_DATE_PATTERN
  );

  if (
    date === undefined ||
    endDate === undefined ||
    startTime === undefined ||
    endTime === undefined ||
    startDate === undefined ||
    recurringEndDate === undefined ||
    typeof allDay !== "boolean" ||
    !normalizedByDay ||
    !exDates
  ) {
    return undefined;
  }

  validateDate(date, "timing.date", errors);
  validateDate(endDate, "timing.endDate", errors);
  validateDate(startDate, "timing.startDate", errors);
  validateDate(recurringEndDate, "timing.recurringEndDate", errors);
  validateTime(startTime, "timing.startTime", errors);
  validateTime(endTime, "timing.endTime", errors);

  return {
    kind,
    date,
    endDate,
    startTime,
    endTime,
    allDay,
    startDate,
    recurringEndDate,
    byDay: normalizedByDay,
    exDates,
  } satisfies AiExtractedTiming;
}

function validateEvent(value: unknown, index: number, warnings: string[]) {
  const errors: string[] = [];
  if (!isRecord(value)) {
    warnings.push(`AI event ${index + 1} skipped: event must be an object.`);
    return undefined;
  }

  const label = stringValue(value.label);
  if (!label) errors.push("label is required");

  const eventType = stringValue(value.eventType);
  if (!eventType || !EVENT_TYPES.has(eventType as AiExtractedEventType)) {
    errors.push("eventType is invalid");
  }

  const location = nullableStringValue(value.location);
  const instructorName = nullableStringValue(value.instructorName);
  const instructorEmail = nullableStringValue(value.instructorEmail);
  const weight = nullableStringValue(value.weight);
  const sourceSectionTitle = nullableStringValue(value.sourceSectionTitle);
  if (location === undefined) errors.push("location must be a string or null");
  if (instructorName === undefined) errors.push("instructorName must be a string or null");
  if (instructorEmail === undefined) errors.push("instructorEmail must be a string or null");
  if (weight === undefined) errors.push("weight must be a string or null");
  if (sourceSectionTitle === undefined) {
    errors.push("sourceSectionTitle must be a string or null");
  }

  const notes = validateStringArray(value.notes, "notes", errors) ?? [];

  const confidence = stringValue(value.confidence);
  if (!confidence || !CONFIDENCE_VALUES.has(confidence as EventConfidence)) {
    errors.push("confidence is invalid");
  }

  const sourceKind = stringValue(value.sourceKind);
  if (!sourceKind || !SOURCE_KINDS.has(sourceKind as AiExtractedSourceKind)) {
    errors.push("sourceKind is invalid");
  }

  const sourceSnippet = stringValue(value.sourceSnippet);
  if (!sourceSnippet) errors.push("sourceSnippet is required");

  const timing = validateTiming(value.timing, errors);

  if (errors.length > 0) {
    warnings.push(`AI event ${index + 1} skipped: ${errors.join("; ")}.`);
    return undefined;
  }

  return {
    label: label!,
    eventType: eventType as AiExtractedEventType,
    location: location!,
    instructorName: instructorName!,
    instructorEmail: instructorEmail!,
    notes,
    weight: weight!,
    confidence: confidence as EventConfidence,
    sourceKind: sourceKind as AiExtractedSourceKind,
    sourceSectionTitle: sourceSectionTitle!,
    sourceSnippet: sourceSnippet!,
    timing: timing!,
  } satisfies AiExtractedEvent;
}

export function validateAiExtractionResponse(value: unknown) {
  const warnings: string[] = [];

  if (!isRecord(value)) {
    return {
      ok: false,
      data: EMPTY_AI_EXTRACTION,
      warnings: ["AI extraction response was not a JSON object."],
    };
  }

  const rawWarnings = value.warnings;
  if (!Array.isArray(rawWarnings) || !rawWarnings.every((warning) => typeof warning === "string")) {
    warnings.push("AI extraction warnings field was missing or invalid.");
  }

  const rawEvents = value.events;
  if (!Array.isArray(rawEvents)) {
    return {
      ok: false,
      data: {
        events: [],
        warnings: Array.isArray(rawWarnings)
          ? rawWarnings.filter((warning): warning is string => typeof warning === "string")
          : [],
      },
      warnings: [...warnings, "AI extraction events field was missing or invalid."],
    };
  }

  const events = rawEvents
    .map((event, index) => validateEvent(event, index, warnings))
    .filter((event): event is AiExtractedEvent => Boolean(event));

  return {
    ok: warnings.length === 0,
    data: {
      events,
      warnings: Array.isArray(rawWarnings)
        ? rawWarnings
            .filter((warning): warning is string => typeof warning === "string")
            .map((warning) => warning.trim())
            .filter(Boolean)
        : [],
    },
    warnings,
  };
}
