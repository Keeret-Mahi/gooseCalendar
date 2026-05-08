import { addDays, eachDayOfInterval, format, getDay, parseISO, subDays } from "date-fns";
import {
  buildEventSummary,
  buildEventDescription,
  buildGoogleEventReminders,
  exportLocationForEvent,
  getCourseSelection,
  isEventVisible,
} from "./calendar";
import {
  resolveExportPaletteColors,
  resolveGoogleEventColorId,
} from "./palettes";
import type {
  CourseSelection,
  EventCandidate,
  EventGroup,
  ExportConfig,
  ParsedCourse,
  WeekdayCode,
} from "./types";

export const GOOGLE_CALENDAR_LIST_COLOR_EXPORT_ENABLED = false;

const GOOGLE_CALENDAR_SCOPES = [
  "https://www.googleapis.com/auth/calendar.app.created",
  ...(GOOGLE_CALENDAR_LIST_COLOR_EXPORT_ENABLED
    ? ["https://www.googleapis.com/auth/calendar.calendarlist"]
    : []),
].join(" ");
const GOOGLE_IDENTITY_SCRIPT_URL = "https://accounts.google.com/gsi/client";
const GOOGLE_CALENDAR_API_BASE = "https://www.googleapis.com/calendar/v3";
const GOOGLE_CALENDAR_URL = "https://calendar.google.com/calendar/u/0/r";
const GOOGLE_TIMEZONE = "America/Toronto";
const GOOSECALENDAR_DESCRIPTION_PREFIX = "Managed by GooseCalendar. Event group:";
const GOOGLE_AUTH_TIMEOUT_MS = 60_000;
const GOOGLE_API_TIMEOUT_MS = 20_000;
const GOOGLE_EXPORT_CONCURRENCY = 2;
const GOOGLE_API_MAX_ATTEMPTS = 5;
const GOOGLE_API_RETRY_BASE_MS = 800;
const GOOGLE_API_RETRY_MAX_MS = 8_000;
const WEEKDAY_BY_INDEX: WeekdayCode[] = ["SU", "MO", "TU", "WE", "TH", "FR", "SA"];
const DEFAULT_HEX_BY_GROUP: Record<EventGroup, string> = {
  Lecture: "#f2b90d",
  Tutorial: "#9333ea",
  Lab: "#2563eb",
  "Office Hours": "#0f766e",
  Assessments: "#dc2626",
  Assignments: "#16a34a",
  Other: "#475569",
};
const PALETTE_INDEX_BY_GROUP: Record<EventGroup, number> = {
  Lecture: 0,
  Tutorial: 1,
  Lab: 2,
  Assessments: 3,
  Assignments: 4,
  "Office Hours": 5,
  Other: 6,
};

type GoogleEventDateTime =
  | {
      date: string;
      dateTime?: never;
      timeZone?: never;
    }
  | {
      date?: never;
      dateTime: string;
      timeZone: string;
    };

interface GoogleCalendarEventResource {
  id?: string;
  summary: string;
  description?: string;
  location?: string;
  colorId?: string;
  start: GoogleEventDateTime;
  end: GoogleEventDateTime;
  recurrence?: string[];
  reminders?: {
    useDefault: boolean;
    overrides?: Array<{
      method: "popup";
      minutes: number;
    }>;
  };
  extendedProperties?: {
    private?: Record<string, string>;
  };
}

interface GoogleCalendarEventResponse {
  id: string;
  htmlLink?: string;
}

interface GoogleCalendarInstanceResponse {
  id: string;
  originalStartTime?: {
    date?: string;
    dateTime?: string;
  };
  extendedProperties?: {
    private?: Record<string, string>;
  };
}

interface GoogleCalendarInstancesResponse {
  items?: GoogleCalendarInstanceResponse[];
}

interface GoogleCalendarListEntry {
  id: string;
  summary?: string;
  description?: string;
}

interface GoogleCalendarListResponse {
  items?: GoogleCalendarListEntry[];
  nextPageToken?: string;
}

interface GoogleCalendarResource {
  id: string;
}

interface GoogleApiErrorDetail {
  reason?: string;
}

interface GoogleApiErrorPayload {
  error?: {
    message?: string;
    errors?: GoogleApiErrorDetail[];
  };
}

interface GoogleTokenResponse {
  access_token?: string;
  error?: string;
  error_description?: string;
  expires_in?: number;
}

interface GoogleTokenClient {
  requestAccessToken: (options?: { prompt?: string }) => void;
}

interface GoogleIdentityWindow {
  accounts: {
    oauth2: {
      initTokenClient: (config: {
        client_id: string;
        scope: string;
        callback: (response: GoogleTokenResponse) => void;
      }) => GoogleTokenClient;
    };
  };
}

declare global {
  interface Window {
    google?: GoogleIdentityWindow;
  }
}

class GoogleCalendarApiError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "GoogleCalendarApiError";
    this.status = status;
  }
}

interface ExportableEvent {
  course: ParsedCourse;
  selection: CourseSelection;
  event: EventCandidate;
}

export interface GoogleCalendarExportResult {
  calendarUrl: string;
  eventCount: number;
  calendarCount: number;
}

export interface GoogleCalendarExportProgress {
  completed: number;
  total: number;
  label: string;
}

let googleIdentityScriptPromise: Promise<void> | null = null;
let tokenCache:
  | {
      accessToken: string;
      expiresAt: number;
    }
  | null = null;

function getGoogleClientId() {
  return import.meta.env.VITE_GOOGLE_CLIENT_ID?.trim() ?? "";
}

export function isGoogleCalendarConfigured() {
  return Boolean(getGoogleClientId());
}

function buildHexHash(seed: string) {
  let hash = 2166136261;
  for (let index = 0; index < seed.length; index += 1) {
    hash ^= seed.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

function buildGoogleEventId(seed: string) {
  return `gc${buildHexHash(seed)}${buildHexHash(`secondary:${seed}`)}`;
}

function wait(ms: number) {
  return new Promise<void>((resolve) => {
    window.setTimeout(resolve, ms);
  });
}

function parseRetryAfterMs(retryAfter: string | null) {
  if (!retryAfter) return null;

  const seconds = Number(retryAfter);
  if (Number.isFinite(seconds) && seconds >= 0) {
    return seconds * 1000;
  }

  const retryAt = Date.parse(retryAfter);
  if (Number.isNaN(retryAt)) return null;

  return Math.max(retryAt - Date.now(), 0);
}

function isRetryableGoogleError(status: number, payload: GoogleApiErrorPayload | null) {
  if (status === 429 || status === 500 || status === 502 || status === 503 || status === 504) {
    return true;
  }

  if (status !== 403) {
    return false;
  }

  const reasons = payload?.error?.errors?.map((error) => error.reason?.toLowerCase()) ?? [];
  return reasons.some((reason) =>
    reason === "ratelimitexceeded" ||
    reason === "userratelimitexceeded" ||
    reason === "quotaexceeded"
  );
}

function retryDelayMs(attempt: number, retryAfter: string | null) {
  const parsedRetryAfter = parseRetryAfterMs(retryAfter);
  if (parsedRetryAfter !== null) {
    return Math.min(parsedRetryAfter, GOOGLE_API_RETRY_MAX_MS);
  }

  const exponentialDelay = Math.min(
    GOOGLE_API_RETRY_BASE_MS * 2 ** attempt,
    GOOGLE_API_RETRY_MAX_MS
  );
  const jitter = Math.floor(Math.random() * 250);
  return exponentialDelay + jitter;
}

function loadGoogleIdentityScript() {
  if (window.google?.accounts?.oauth2) {
    return Promise.resolve();
  }

  if (googleIdentityScriptPromise) {
    return googleIdentityScriptPromise;
  }

  googleIdentityScriptPromise = new Promise<void>((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>(
      'script[data-goosecalendar-google-identity="true"]'
    );

    if (existing) {
      existing.addEventListener("load", () => resolve(), { once: true });
      existing.addEventListener(
        "error",
        () => reject(new Error("Google Identity Services failed to load.")),
        { once: true }
      );
      return;
    }

    const script = document.createElement("script");
    script.src = GOOGLE_IDENTITY_SCRIPT_URL;
    script.async = true;
    script.defer = true;
    script.dataset.goosecalendarGoogleIdentity = "true";
    script.onload = () => resolve();
    script.onerror = () =>
      reject(new Error("Google Identity Services failed to load."));
    document.head.appendChild(script);
  }).finally(() => {
    if (!window.google?.accounts?.oauth2) {
      googleIdentityScriptPromise = null;
    }
  });

  return googleIdentityScriptPromise;
}

function requestAccessToken(prompt: "" | "consent") {
  const clientId = getGoogleClientId();
  if (!clientId) {
    throw new Error(
      "Google Calendar export is not configured. Set VITE_GOOGLE_CLIENT_ID and reload the app."
    );
  }

  return new Promise<string>((resolve, reject) => {
    const timeoutId = window.setTimeout(() => {
      reject(
        new Error(
          "Google authorization timed out. If the consent popup was blocked or closed, allow it and try again."
        )
      );
    }, GOOGLE_AUTH_TIMEOUT_MS);

    const tokenClient = window.google?.accounts.oauth2.initTokenClient({
      client_id: clientId,
      scope: GOOGLE_CALENDAR_SCOPES,
      callback: (response) => {
        window.clearTimeout(timeoutId);
        if (response.error || !response.access_token) {
          reject(
            new Error(
              response.error_description ??
                response.error ??
                "Google authorization was not completed."
            )
          );
          return;
        }

        tokenCache = {
          accessToken: response.access_token,
          expiresAt: Date.now() + Math.max((response.expires_in ?? 3600) - 60, 60) * 1000,
        };
        resolve(response.access_token);
      },
    });

    if (!tokenClient) {
      window.clearTimeout(timeoutId);
      reject(new Error("Google Identity Services is unavailable."));
      return;
    }

    tokenClient.requestAccessToken({ prompt });
  });
}

async function getGoogleAccessToken() {
  if (tokenCache && tokenCache.expiresAt > Date.now()) {
    return tokenCache.accessToken;
  }

  await loadGoogleIdentityScript();

  try {
    return await requestAccessToken(tokenCache ? "" : "consent");
  } catch (error) {
    if (tokenCache) {
      throw error;
    }
    return requestAccessToken("consent");
  }
}

async function googleApiFetch<T>(
  accessToken: string,
  path: string,
  init?: RequestInit
) {
  let lastTimeout = false;

  for (let attempt = 0; attempt < GOOGLE_API_MAX_ATTEMPTS; attempt += 1) {
    const controller = new AbortController();
    const timeoutId = window.setTimeout(() => controller.abort(), GOOGLE_API_TIMEOUT_MS);

    try {
      const response = await fetch(`${GOOGLE_CALENDAR_API_BASE}${path}`, {
        ...init,
        signal: controller.signal,
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
          ...(init?.headers ?? {}),
        },
      });
      window.clearTimeout(timeoutId);

      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as GoogleApiErrorPayload | null;
        if (
          attempt < GOOGLE_API_MAX_ATTEMPTS - 1 &&
          isRetryableGoogleError(response.status, payload)
        ) {
          await wait(retryDelayMs(attempt, response.headers.get("Retry-After")));
          continue;
        }

        const message =
          payload?.error?.message ??
          `Google Calendar request failed with status ${response.status}.`;
        throw new GoogleCalendarApiError(message, response.status);
      }

      if (response.status === 204) {
        return null as T;
      }

      return (await response.json()) as T;
    } catch (error) {
      window.clearTimeout(timeoutId);

      if (error instanceof DOMException && error.name === "AbortError") {
        lastTimeout = true;
        if (attempt < GOOGLE_API_MAX_ATTEMPTS - 1) {
          await wait(retryDelayMs(attempt, null));
          continue;
        }
        break;
      }

      throw error;
    }
  }

  if (lastTimeout) {
    throw new Error(
      "Google Calendar took too long to respond after multiple attempts. Please try the export again."
    );
  }

  throw new Error("Google Calendar export failed after multiple attempts.");
}

function exportableEvents(
  courses: ParsedCourse[],
  allEvents: EventCandidate[],
  selections: Record<string, CourseSelection>
) {
  const items: ExportableEvent[] = [];

  courses.forEach((course) => {
    const selection = getCourseSelection(course.id, selections);
    allEvents
      .filter((event) => event.courseId === course.id)
      .filter((event) => event.include)
      .filter((event) => isEventVisible(event, selection))
      .forEach((event) => {
        items.push({ course, selection, event });
      });
  });

  return items;
}

function buildPrivateMetadata(event: EventCandidate, course: ParsedCourse, recurring = false) {
  return {
    goosecalendar: "1",
    goosecalendarCourseId: course.id,
    goosecalendarEventId: event.id,
    goosecalendarRecurring: recurring ? "1" : "0",
  };
}

function googleDateTime(date: string, time: string): GoogleEventDateTime {
  return {
    dateTime: `${date}T${time}:00`,
    timeZone: GOOGLE_TIMEZONE,
  };
}

function recurringDates(event: EventCandidate) {
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

function buildRecurrenceLines(event: EventCandidate) {
  if (
    event.timing.kind !== "recurring" ||
    !event.timing.startDate ||
    !event.timing.endDate
  ) {
    return [];
  }

  const baseDates = recurringDates(event);
  if (baseDates.length === 0) return [];

  const lines = [
    `RRULE:FREQ=WEEKLY;BYDAY=${event.timing.byDay.join(",")};COUNT=${baseDates.length}`,
  ];

  if (event.timing.exDates.length > 0) {
    if (event.timing.startTime) {
      lines.push(
        `EXDATE;TZID=${GOOGLE_TIMEZONE}:${event.timing.exDates
          .sort()
          .map((date) => `${date.replace(/-/g, "")}T${event.timing.startTime!.replace(":", "")}00`)
          .join(",")}`
      );
    } else {
      lines.push(
        `EXDATE;VALUE=DATE:${event.timing.exDates
          .sort()
          .map((date) => date.replace(/-/g, ""))
          .join(",")}`
      );
    }
  }

  return lines;
}

function buildSingleEventResource(
  course: ParsedCourse,
  selection: CourseSelection,
  event: EventCandidate,
  exportConfig: ExportConfig,
  colorId?: string
): GoogleCalendarEventResource {
  if (event.timing.kind !== "single" || !event.timing.date) {
    throw new Error("Cannot build a Google Calendar resource for an incomplete single event.");
  }

  const common = {
    id: buildGoogleEventId(`${course.id}:${event.id}`),
    summary: buildEventSummary(event, undefined, "google"),
    description: buildEventDescription(course, selection, event),
    location: exportLocationForEvent(event) || undefined,
    colorId,
    reminders: buildGoogleEventReminders(exportConfig, event.eventGroup),
    extendedProperties: {
      private: buildPrivateMetadata(event, course),
    },
  };

  if (
    event.timing.allDay ||
    (!event.timing.startTime && !event.timing.endTime) ||
    (event.eventType === "Assignment" &&
      event.timing.kind === "single" &&
      Boolean(event.timing.startTime) !== Boolean(event.timing.endTime))
  ) {
    const exclusiveEnd = format(
      addDays(parseISO(event.timing.endDate ?? event.timing.date), 1),
      "yyyy-MM-dd"
    );

    return {
      ...common,
      start: {
        date: event.timing.date,
      },
      end: {
        date: exclusiveEnd,
      },
    };
  }

  return {
    ...common,
    start: googleDateTime(event.timing.date, event.timing.startTime!),
    end: googleDateTime(event.timing.endDate ?? event.timing.date, event.timing.endTime!),
  };
}

function buildRecurringEventResource(
  course: ParsedCourse,
  selection: CourseSelection,
  event: EventCandidate,
  exportConfig: ExportConfig,
  colorId?: string
): GoogleCalendarEventResource {
  if (
    event.timing.kind !== "recurring" ||
    !event.timing.startDate ||
    !event.timing.endDate
  ) {
    throw new Error("Cannot build a Google Calendar resource for an incomplete recurring event.");
  }

  const common = {
    id: buildGoogleEventId(`${course.id}:${event.id}`),
    summary: buildEventSummary(
      event,
      event.timing.kind === "recurring" && event.timing.startDate
        ? event.timing.occurrenceNotes[event.timing.startDate]
        : undefined,
      "google"
    ),
    description: buildEventDescription(course, selection, event),
    location: exportLocationForEvent(event) || undefined,
    colorId,
    reminders: buildGoogleEventReminders(exportConfig, event.eventGroup),
    extendedProperties: {
      private: buildPrivateMetadata(event, course, true),
    },
    recurrence: buildRecurrenceLines(event),
  };

  if (event.timing.startTime && event.timing.endTime) {
    return {
      ...common,
      start: googleDateTime(event.timing.startDate, event.timing.startTime),
      end: googleDateTime(event.timing.startDate, event.timing.endTime),
    };
  }

  return {
    ...common,
    start: {
      date: event.timing.startDate,
    },
    end: {
      date: format(addDays(parseISO(event.timing.startDate), 1), "yyyy-MM-dd"),
    },
  };
}

function buildRecurringInstancePatch(
  course: ParsedCourse,
  selection: CourseSelection,
  event: EventCandidate,
  date: string,
  colorId?: string,
  previousOverride = false
) {
  const occurrenceNotes = event.timing.kind === "recurring" ? event.timing.occurrenceNotes[date] : undefined;
  const occurrenceOverride =
    event.timing.kind === "recurring" ? event.timing.occurrenceOverrides[date] : undefined;
  const hasOverrideNotes = (occurrenceNotes?.length ?? 0) > 0;
  const hasTimingOverride = Boolean(
    occurrenceOverride?.startTime ||
      occurrenceOverride?.endTime ||
      occurrenceOverride?.location
  );

  if (!hasOverrideNotes && !hasTimingOverride && !previousOverride) {
    return null;
  }

  const common = {
    summary: buildEventSummary(event, occurrenceNotes, "google"),
    description: buildEventDescription(course, selection, event, occurrenceNotes),
    location: exportLocationForEvent(event, occurrenceOverride?.location ?? event.location) || "",
    colorId,
    extendedProperties: {
      private: {
        ...buildPrivateMetadata(event, course, true),
        goosecalendarOccurrenceOverride:
          hasOverrideNotes || hasTimingOverride ? "1" : "0",
      },
    },
  };

  if (event.timing.kind === "recurring" && event.timing.startTime && event.timing.endTime) {
    return {
      ...common,
      start: googleDateTime(date, occurrenceOverride?.startTime ?? event.timing.startTime),
      end: googleDateTime(date, occurrenceOverride?.endTime ?? event.timing.endTime),
    };
  }

  return {
    ...common,
    start: {
      date,
    },
    end: {
      date: format(addDays(parseISO(date), 1), "yyyy-MM-dd"),
    },
  };
}

function hasRecurringOverrides(event: EventCandidate) {
  return (
    event.timing.kind === "recurring" &&
    (Object.values(event.timing.occurrenceNotes).some((notes) => notes.length > 0) ||
      Object.keys(event.timing.occurrenceOverrides).length > 0)
  );
}

function groupCalendarSummary(eventGroup: EventGroup) {
  return `GooseCalendar - ${eventGroup}`;
}

function groupCalendarDescription(eventGroup: EventGroup) {
  return `${GOOSECALENDAR_DESCRIPTION_PREFIX} ${eventGroup}`;
}

function paletteColorForGroup(eventGroup: EventGroup, paletteColors: string[]) {
  if (paletteColors.length === 0) {
    return DEFAULT_HEX_BY_GROUP[eventGroup];
  }

  return paletteColors[PALETTE_INDEX_BY_GROUP[eventGroup] % paletteColors.length];
}

interface CalendarBucket {
  key: string;
  summary: string;
  description: string;
  color: string;
}

function calendarBucketForItem(
  item: ExportableEvent,
  exportConfig: ExportConfig,
  paletteColors: string[],
  courseColorIndex: number
): CalendarBucket {
  if (exportConfig.colorStrategy === "course") {
    const color = paletteColors.length
      ? paletteColors[courseColorIndex % paletteColors.length]
      : DEFAULT_HEX_BY_GROUP.Other;
    return {
      key: `course:${item.course.id}`,
      summary: `GooseCalendar - ${item.course.courseCode}`,
      description: `${GOOSECALENDAR_DESCRIPTION_PREFIX} Course ${item.course.id}`,
      color,
    };
  }

  return {
    key: `group:${item.event.eventGroup}`,
    summary: groupCalendarSummary(item.event.eventGroup),
    description: groupCalendarDescription(item.event.eventGroup),
    color: paletteColorForGroup(item.event.eventGroup, paletteColors),
  };
}

async function listOwnedCalendars(accessToken: string) {
  const entries: GoogleCalendarListEntry[] = [];
  let pageToken = "";

  do {
    const response = await googleApiFetch<GoogleCalendarListResponse>(
      accessToken,
      `/users/me/calendarList?minAccessRole=owner&showHidden=true&maxResults=250${
        pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : ""
      }`
    );

    entries.push(...(response.items ?? []));
    pageToken = response.nextPageToken ?? "";
  } while (pageToken);

  return entries;
}

async function ensureCalendarListEntry(
  accessToken: string,
  calendarId: string,
  backgroundColor: string
) {
  try {
    await googleApiFetch(
      accessToken,
      `/users/me/calendarList/${encodeURIComponent(calendarId)}?colorRgbFormat=true`,
      {
        method: "PATCH",
        body: JSON.stringify({
          backgroundColor,
          selected: true,
        }),
      }
    );
  } catch (error) {
    if (!(error instanceof GoogleCalendarApiError) || error.status !== 404) {
      throw error;
    }

    await googleApiFetch(
      accessToken,
      "/users/me/calendarList?colorRgbFormat=true",
      {
        method: "POST",
        body: JSON.stringify({
          id: calendarId,
          backgroundColor,
          selected: true,
        }),
      }
    );
  }
}

async function ensureGroupCalendars(
  accessToken: string,
  items: ExportableEvent[],
  exportConfig: ExportConfig,
  paletteColors: string[],
  onCalendarReady?: (bucket: CalendarBucket) => void
) {
  const existingCalendars = await listOwnedCalendars(accessToken);
  const calendarIdsByBucketKey = new Map<string, string>();
  const courseOrder = Array.from(
    new Set(items.map((item) => item.course.id))
  ).sort((left, right) => {
    const leftCourse = items.find((item) => item.course.id === left)?.course;
    const rightCourse = items.find((item) => item.course.id === right)?.course;
    const leftLabel = `${leftCourse?.courseCode ?? left} ${leftCourse?.term ?? ""}`;
    const rightLabel = `${rightCourse?.courseCode ?? right} ${rightCourse?.term ?? ""}`;
    return leftLabel.localeCompare(rightLabel);
  });
  const courseIndexById = new Map(courseOrder.map((courseId, index) => [courseId, index]));
  const buckets = Array.from(
    new Map(
      items.map((item) => {
        const bucket = calendarBucketForItem(
          item,
          exportConfig,
          paletteColors,
          courseIndexById.get(item.course.id) ?? 0
        );
        return [bucket.key, bucket] as const;
      })
    ).values()
  );

  for (const bucket of buckets) {
    const summary = bucket.summary;
    const description = bucket.description;
    const backgroundColor = bucket.color;

    let existing = existingCalendars.find(
      (entry) => entry.description === description || entry.summary === summary
    );

    if (!existing) {
      const created = await googleApiFetch<GoogleCalendarResource>(
        accessToken,
        "/calendars",
        {
          method: "POST",
          body: JSON.stringify({
            summary,
            description,
            timeZone: GOOGLE_TIMEZONE,
          }),
        }
      );
      existing = {
        id: created.id,
        summary,
        description,
      };
    }

    await ensureCalendarListEntry(
      accessToken,
      existing.id,
      backgroundColor
    );
    calendarIdsByBucketKey.set(bucket.key, existing.id);
    onCalendarReady?.(bucket);
  }

  return calendarIdsByBucketKey;
}

function singleExportCalendarSummary(courses: ParsedCourse[]) {
  const courseCodes = Array.from(new Set(courses.map((course) => course.courseCode).filter(Boolean)));
  const terms = Array.from(new Set(courses.map((course) => course.term).filter(Boolean)));

  if (courseCodes.length === 1) {
    return `GooseCalendar - ${courseCodes[0]}`;
  }

  if (terms.length === 1) {
    return `GooseCalendar - ${terms[0]}`;
  }

  return "GooseCalendar Export";
}

async function createSingleExportCalendar(
  accessToken: string,
  courses: ParsedCourse[]
) {
  const created = await googleApiFetch<GoogleCalendarResource>(
    accessToken,
    "/calendars",
    {
      method: "POST",
      body: JSON.stringify({
        summary: singleExportCalendarSummary(courses),
        description: `${GOOSECALENDAR_DESCRIPTION_PREFIX} Single calendar export`,
        timeZone: GOOGLE_TIMEZONE,
      }),
    }
  );

  return created.id;
}

async function createEventGroupCalendars(
  accessToken: string,
  eventGroups: EventGroup[],
  onCalendarReady?: (summary: string) => void
) {
  const calendarIdsByGroup = new Map<string, string>();

  for (const eventGroup of eventGroups) {
    const summary = groupCalendarSummary(eventGroup);
    const created = await googleApiFetch<GoogleCalendarResource>(
      accessToken,
      "/calendars",
      {
        method: "POST",
        body: JSON.stringify({
          summary,
          description: groupCalendarDescription(eventGroup),
          timeZone: GOOGLE_TIMEZONE,
        }),
      }
    );

    calendarIdsByGroup.set(`group:${eventGroup}`, created.id);
    onCalendarReady?.(summary);
  }

  return calendarIdsByGroup;
}

function normalizeGoogleEventColorId(colorId: string | undefined) {
  return colorId && /^(?:[1-9]|10|11)$/.test(colorId) ? colorId : "5";
}

function googleEventColorIdForEvent(event: EventCandidate, exportConfig: ExportConfig) {
  if (exportConfig.googleEventColorMode === "uniform") {
    return normalizeGoogleEventColorId(exportConfig.googleUniformColorId);
  }

  return resolveGoogleEventColorId(event.eventGroup, exportConfig.paletteId);
}

async function upsertEvent(
  accessToken: string,
  calendarId: string,
  eventId: string,
  resource: GoogleCalendarEventResource
) {
  try {
    await googleApiFetch<GoogleCalendarEventResponse>(
      accessToken,
      `/calendars/${encodeURIComponent(calendarId)}/events/${eventId}`,
      {
        method: "PUT",
        body: JSON.stringify({ ...resource, id: eventId }),
      }
    );
    return "updated" as const;
  } catch (error) {
    if (!(error instanceof GoogleCalendarApiError) || error.status !== 404) {
      throw error;
    }

    await googleApiFetch<GoogleCalendarEventResponse>(
      accessToken,
      `/calendars/${encodeURIComponent(calendarId)}/events`,
      {
        method: "POST",
        body: JSON.stringify({ ...resource, id: eventId }),
      }
    );
    return "created" as const;
  }
}

function instanceDate(instance: GoogleCalendarInstanceResponse) {
  return (
    instance.originalStartTime?.date ??
    instance.originalStartTime?.dateTime?.slice(0, 10)
  );
}

async function syncRecurringOverrides(
  accessToken: string,
  calendarId: string,
  course: ParsedCourse,
  selection: CourseSelection,
  event: EventCandidate,
  masterEventId: string,
  colorId?: string
) {
  if (
    event.timing.kind !== "recurring" ||
    !event.timing.startDate ||
    !event.timing.endDate ||
    !hasRecurringOverrides(event)
  ) {
    return;
  }

  const timeMin = format(subDays(parseISO(event.timing.startDate), 1), "yyyy-MM-dd");
  const timeMax = format(addDays(parseISO(event.timing.endDate), 2), "yyyy-MM-dd");
  const instances = await googleApiFetch<GoogleCalendarInstancesResponse>(
    accessToken,
    `/calendars/${encodeURIComponent(calendarId)}/events/${masterEventId}/instances?timeMin=${encodeURIComponent(
      `${timeMin}T00:00:00Z`
    )}&timeMax=${encodeURIComponent(`${timeMax}T00:00:00Z`)}&showDeleted=false&maxResults=2500`
  );

  const patchable = (instances.items ?? [])
    .map((instance) => {
      const date = instanceDate(instance);
      if (!date) return null;

      const patch = buildRecurringInstancePatch(
        course,
        selection,
        event,
        date,
        colorId,
        instance.extendedProperties?.private?.goosecalendarOccurrenceOverride === "1"
      );

      return patch ? { instanceId: instance.id, patch } : null;
    })
    .filter(Boolean) as Array<{ instanceId: string; patch: Record<string, unknown> }>;

  for (const item of patchable) {
    await googleApiFetch(
      accessToken,
      `/calendars/${encodeURIComponent(calendarId)}/events/${item.instanceId}`,
      {
        method: "PATCH",
        body: JSON.stringify(item.patch),
      }
    );
  }
}

async function runWithConcurrency<T>(
  values: T[],
  concurrency: number,
  worker: (value: T) => Promise<void>
) {
  const executing = new Set<Promise<void>>();

  for (const value of values) {
    const task = worker(value).finally(() => {
      executing.delete(task);
    });
    executing.add(task);

    if (executing.size >= concurrency) {
      await Promise.race(executing);
    }
  }

  await Promise.all(executing);
}

export async function exportEventsToGoogleCalendar(
  courses: ParsedCourse[],
  allEvents: EventCandidate[],
  selections: Record<string, CourseSelection>,
  exportConfig: ExportConfig,
  onProgress?: (progress: GoogleCalendarExportProgress) => void
) {
  const accessToken = await getGoogleAccessToken();
  const items = exportableEvents(courses, allEvents, selections);
  const narrowCalendarMode = exportConfig.googleCalendarMode ?? "single";
  const paletteColors = GOOGLE_CALENDAR_LIST_COLOR_EXPORT_ENABLED
    ? resolveExportPaletteColors(exportConfig)
    : [];
  const bucketKeys = GOOGLE_CALENDAR_LIST_COLOR_EXPORT_ENABLED
    ? Array.from(
        new Set(
          items.map((item) =>
            exportConfig.colorStrategy === "course"
              ? `course:${item.course.id}`
              : `group:${item.event.eventGroup}`
          )
        )
      )
    : narrowCalendarMode === "many"
    ? Array.from(new Set(items.map((item) => `group:${item.event.eventGroup}`)))
    : items.length > 0
    ? ["single"]
    : [];
  const recurringOverrideCount = items.filter(
    (item) => item.event.timing.kind === "recurring" && hasRecurringOverrides(item.event)
  ).length;
  const totalSteps = Math.max(bucketKeys.length + items.length + recurringOverrideCount, 1);
  let completedSteps = 0;

  const reportProgress = (label: string) => {
    onProgress?.({
      completed: completedSteps,
      total: totalSteps,
      label,
    });
  };

  reportProgress("Preparing Google Calendar export...");

  if (items.length === 0) {
    completedSteps = totalSteps;
    reportProgress("Google Calendar export complete");
    return {
      calendarUrl: GOOGLE_CALENDAR_URL,
      eventCount: 0,
      calendarCount: 0,
    } satisfies GoogleCalendarExportResult;
  }

  const calendarIdsByGroup = GOOGLE_CALENDAR_LIST_COLOR_EXPORT_ENABLED
    ? await ensureGroupCalendars(
        accessToken,
        items,
        exportConfig,
        paletteColors,
        (bucket) => {
          completedSteps += 1;
          reportProgress(`Prepared ${bucket.summary}`);
        }
      )
    : narrowCalendarMode === "many"
    ? await createEventGroupCalendars(
        accessToken,
        Array.from(new Set(items.map((item) => item.event.eventGroup))),
        (summary) => {
          completedSteps += 1;
          reportProgress(`Prepared ${summary}`);
        }
      )
    : new Map<string, string>();
  const singleCalendarId = GOOGLE_CALENDAR_LIST_COLOR_EXPORT_ENABLED || narrowCalendarMode === "many"
    ? ""
    : await createSingleExportCalendar(accessToken, courses);

  if (!GOOGLE_CALENDAR_LIST_COLOR_EXPORT_ENABLED && narrowCalendarMode !== "many") {
    completedSteps += 1;
    reportProgress(`Prepared ${singleExportCalendarSummary(courses)}`);
  }

  await runWithConcurrency(items, GOOGLE_EXPORT_CONCURRENCY, async ({ course, selection, event }) => {
    const colorId = GOOGLE_CALENDAR_LIST_COLOR_EXPORT_ENABLED
      ? undefined
      : googleEventColorIdForEvent(event, exportConfig);
    const calendarId = GOOGLE_CALENDAR_LIST_COLOR_EXPORT_ENABLED
      ? calendarIdsByGroup.get(
          exportConfig.colorStrategy === "course"
            ? `course:${course.id}`
            : `group:${event.eventGroup}`
        )
      : narrowCalendarMode === "many"
      ? calendarIdsByGroup.get(`group:${event.eventGroup}`)
      : singleCalendarId;

    if (!calendarId) return;

    if (event.timing.kind === "single") {
      const resource = buildSingleEventResource(course, selection, event, exportConfig, colorId);
      await upsertEvent(accessToken, calendarId, resource.id!, resource);
      completedSteps += 1;
      reportProgress(`Exported ${buildEventSummary(event, undefined, "google")}`);
      return;
    }

    const resource = buildRecurringEventResource(course, selection, event, exportConfig, colorId);
    const masterEventId = resource.id!;
    await upsertEvent(accessToken, calendarId, masterEventId, resource);
    completedSteps += 1;
    reportProgress(`Exported ${buildEventSummary(event, undefined, "google")}`);
    await syncRecurringOverrides(
      accessToken,
      calendarId,
      course,
      selection,
      event,
      masterEventId,
      colorId
    );
    if (hasRecurringOverrides(event)) {
      completedSteps += 1;
      reportProgress(`Applied overrides for ${buildEventSummary(event, undefined, "google")}`);
    }
  });

  completedSteps = totalSteps;
  reportProgress("Google Calendar export complete");

  return {
    calendarUrl: GOOGLE_CALENDAR_URL,
    eventCount: items.length,
    calendarCount:
      GOOGLE_CALENDAR_LIST_COLOR_EXPORT_ENABLED || narrowCalendarMode === "many"
        ? calendarIdsByGroup.size
        : 1,
  } satisfies GoogleCalendarExportResult;
}
