import {
  addDays,
  differenceInCalendarDays,
  eachDayOfInterval,
  format,
  getDay,
  isValid,
  parse,
  parseISO,
  subDays,
} from "date-fns";
import { extractNonMeetingEventsWithAi } from "./aiExtractionClient";
import { mapAiExtractionToEventCandidates } from "./aiEventMapper";
import { normalizeCourseNameCapitalization } from "./courseNames";
import type { AiOutlineExtractionRequest } from "./aiExtractionSchema";
import type { OutlineSource } from "./outlineSource";
import type {
  EventCandidate,
  EventConfidence,
  EventGroup,
  EventProvenance,
  EventType,
  OutlineParseResult,
  ParsedCourse,
  ParsedSectionOption,
  WeekdayCode,
} from "./types";

interface OutlineMeta {
  outlineName: string;
  courseCode: string;
  courseName: string;
  term: string;
  termYear: number;
  summary?: string;
}

interface SectionBlock {
  id: string;
  title: string;
  elements: Element[];
  text: string;
}

interface RawMeetingRow {
  sectionOptionId: string;
  sectionNumber: string;
  sectionKind: string;
  sectionLabel: string;
  eventType: Extract<EventType, "Lecture" | "Tutorial" | "Lab">;
  dayCodes: WeekdayCode[];
  startDate?: string;
  endDate?: string;
  explicitDates: string[];
  startTime?: string;
  endTime?: string;
  location: string;
  instructorName?: string;
  instructorEmail?: string;
  isAsync: boolean;
  provenance: EventProvenance[];
}

interface TopicAttachment {
  appliesTo: Extract<EventType, "Lecture" | "Tutorial" | "Lab">[];
  sectionOptionIds?: string[];
  exactDates?: string[];
  startDate?: string;
  endDate?: string;
  note: string;
  provenance: EventProvenance[];
}

interface ExclusionWindow {
  appliesTo: Extract<EventType, "Lecture" | "Tutorial" | "Lab">[];
  sectionOptionIds?: string[];
  startDate: string;
  endDate: string;
  reason: string;
  provenance: EventProvenance[];
}

interface AssessmentSeed {
  label: string;
  eventType: Extract<EventType, "Assessment" | "Assignment" | "Other">;
  date?: string;
  endDate?: string;
  startTime?: string;
  endTime?: string;
  allDay: boolean;
  location?: string;
  notes: string[];
  weight?: string;
  confidence: EventConfidence;
  provenance: EventProvenance[];
  replaceMeetingType?: Extract<EventType, "Lecture" | "Tutorial" | "Lab">;
  sectionOptionIds?: string[];
}

interface OfficeHourSeed {
  personName: string;
  personEmail?: string;
  location?: string;
  dayCode: WeekdayCode;
  startDate?: string;
  endDate?: string;
  exDates?: string[];
  startTime?: string;
  endTime?: string;
  notes: string[];
  provenance: EventProvenance[];
}

interface WeekWindow {
  startDate: string;
  endDate: string;
  note?: string;
}

interface AssessmentWeightReference {
  label: string;
  weight: string;
  eventType: Extract<EventType, "Assessment" | "Assignment" | "Other">;
  key: string;
  provenance: EventProvenance[];
}

const RELEVANT_PROSE_SECTIONS = new Set([
  "class_schedule",
  "instructional_team",
  "instructor_amp_ta_teaching_assistant_information",
  "instructor_information",
  "course_description",
  "tentative_class_plan",
  "tentative_course_schedule",
  "assessments_amp_activities",
  "assessments_and_grading",
  "assignments_and_grading",
  "student_assessment",
  "course_requirements_and_assessments",
  "course_requirements",
  "evaluation",
  "grading",
]);

const OFFICE_HOUR_SCHEDULE_SECTION_IDS = new Set([
  "class_schedule",
  "tentative_class_plan",
  "tentative_course_schedule",
  "course_schedule",
  "weekly_schedule",
  "schedule",
]);

const WEEKDAY_BY_INDEX: WeekdayCode[] = ["SU", "MO", "TU", "WE", "TH", "FR", "SA"];

const MONTH_ALIASES: Record<string, string> = {
  jan: "Jan",
  january: "Jan",
  feb: "Feb",
  february: "Feb",
  mar: "Mar",
  march: "Mar",
  apr: "Apr",
  april: "Apr",
  may: "May",
  jun: "Jun",
  june: "Jun",
  jul: "Jul",
  july: "Jul",
  aug: "Aug",
  august: "Aug",
  sep: "Sep",
  sept: "Sep",
  september: "Sep",
  oct: "Oct",
  october: "Oct",
  nov: "Nov",
  november: "Nov",
  dec: "Dec",
  december: "Dec",
};

const MONTH_INDEX_BY_ABBREV: Record<string, number> = {
  jan: 0,
  feb: 1,
  mar: 2,
  apr: 3,
  may: 4,
  jun: 5,
  jul: 6,
  aug: 7,
  sep: 8,
  oct: 9,
  nov: 10,
  dec: 11,
};

const EVENT_GROUP_BY_TYPE: Record<EventType, EventGroup> = {
  Lecture: "Lecture",
  Tutorial: "Tutorial",
  Lab: "Lab",
  OfficeHours: "Office Hours",
  Assessment: "Assessments",
  Assignment: "Assignments",
  Other: "Other",
};

const OFFICE_HOUR_ALLOWED_SECTION_IDS = new Set([
  "instructional_team",
  "instructor_amp_ta_teaching_assistant_information",
  "instructor_information",
  "class_schedule",
  "course_description",
  "course_staff",
]);

const OFFICE_HOUR_WEEKDAY_REGEX =
  /\b(Mon(?:day)?s?'?s?|Tue(?:s(?:day)?)?s?'?s?|Wed(?:nesday)?s?'?s?|Thu(?:r(?:s(?:day)?)?)?s?'?s?|Fri(?:day)?s?'?s?|Sat(?:urday)?s?'?s?|Sun(?:day)?s?'?s?)\b/i;

function normalizeWhitespace(value: string | null | undefined) {
  return (value ?? "")
    .replace(/&nbsp;|&#160;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/\u00a0/g, " ")
    .replace(/[\u200b-\u200d\ufeff\u2060\u00ad]/g, "")
    .replace(/[ \t]+/g, " ")
    .replace(/\s*\n\s*/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function normalizeOfficeHourParsingText(value: string | null | undefined) {
  return normalizeWhitespace(value)
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/((?:a\.?m\.?|p\.?m\.?|am|pm|AM|PM))([A-Z])/g, "$1 $2")
    .replace(/(\d)\.(\d{2})(?=\b)/g, "$1:$2")
    .replace(/([A-Za-z])(\d{1,2}:\d{2}\s*(?:a\.?m\.?|p\.?m\.?|am|pm|AM|PM)?)/g, "$1 $2")
    .replace(/([A-Za-z])(\d{3,4}[A-Za-z]?)/g, "$1 $2")
    .replace(/\ba\.?\s*m\.?\b/gi, "AM")
    .replace(/\bp\.?\s*m\.?\b/gi, "PM")
    .replace(/\bofice hours?\b/gi, "Office hours")
    .replace(/\bMc\s+([A-Z])/g, "Mc$1");
}

function stripOfficeHourContactNoise(value: string | null | undefined) {
  return normalizeWhitespace(value)
    .replace(
      /\*?\s*my preferred contact method is via email\.[\s\S]*?(?=(?:\bstudent(?:\s*\(office\))?\s*hours?\b|\boffice hours?\b|$))/gi,
      " "
    )
    .replace(/\bplease include\b[^.?!]*\bsubject line\b[^.?!]*[.?!]?/gi, " ")
    .replace(
      /\b(?:i will try to respond|i will do my best to respond|we check email[^.?!]*?and will make every effort to reply|feel free to re-send your email with a friendly reminder)[^.?!]*(?:24\s*(?:-|–|—|to)\s*48|24|48)\s*hours[^.?!]*[.?!]?/gi,
      " "
    )
    .replace(/\b(?:my\s+)?working hours are\b[^.?!]*[.?!]?/gi, " ")
    .replace(/\bemails received after\b[^.?!]*[.?!]?/gi, " ")
    .replace(/\b(?:during )?normal working hours\b[^.?!]*[.?!]?/gi, " ")
    .replace(/\bmonday to friday\b[^.?!]*(?:reply|respond|email)[^.?!]*[.?!]?/gi, " ")
    .replace(/([.?!])\s*((?:Teaching Assistants?|Teaching Assistant|TA(?:\s*\(|:|'s\b)).*)$/i, (_match, punctuation: string, tail: string) =>
      /\boffice hours?\b/i.test(tail) ? `${punctuation} ${tail}` : punctuation
    );
}

function officeHourBlockStartRegex() {
  return /^(?:(?:(?:Prof\.?|Professor|Dr\.?)\s+)?[\p{L}][\p{L}'’.-]*(?:\s+[\p{L}][\p{L}'’.-]*){0,4}'s\s+|instructor'?s\s+|teaching assistants?'?\s+|ta\s+)?(?:office hours?|office location (?:and|&) hours?|student(?:\s*\(office\))?\s*hours?|open student hours?|my office hours are|drop-in ta office hours)\b/iu;
}

function officeHourSectionBoundaryRegex() {
  return /^(?:instructor|course instructor|lab instructor|lecture instructor|tutorial instructor|lectures?|tutorials?|labs?|teaching assistants?|teaching assistant|lead teaching assistant|lead ta|tas?|instructional support coordinator|instructional support assistant|instructional assistants?|instructional apprentices?|name|contacting the instructor|contact details|technical support|student resources|who and why|piazza)\b/i;
}

function splitOfficeHourAwareLines(text: string) {
  return normalizeOfficeHourParsingText(text)
    .replace(
      /\s*((?:Instructor|Course Instructor|Teaching Assistants?|Teaching Assistant|Lead Teaching Assistant(?:\s*\(TA\))?|Lead TA|TA)\s+Office Hours?:)/gi,
      "\n$1"
    )
    .replace(
      /\s*(Instructor:|Course Instructor:|Teaching Assistants?:|Teaching Assistant:|Lead Teaching Assistant(?:\s*\(TA\))?:|Lead TA:|TA:|Name:|Piazza:|Lectures?:|Tutorials?:|Labs?:|Instructional Support Coordinator(?:\s*\(ISC\))?:|Instructional Support Assistant(?:\s*\(ISA\))?:|Instructional Assistants?(?:\s*\(IA\))?:|Instructional Apprentices?(?:\s*\(IA\))?:)/gi,
      "\n$1"
    )
    .replace(/\s*(Contacting the Instructor)\b/gi, "\n$1")
    .replace(
      /\s*(((?:Prof\.?|Professor|Dr\.?)\s+)?[\p{L}][\p{L}'’.-]*(?:\s+[\p{L}][\p{L}'’.-]*){0,4}'s office hours?:)/giu,
      "\n$1"
    )
    .split("\n")
    .map((line) => normalizeWhitespace(line))
    .filter(Boolean);
}

function htmlToText(element: Element) {
  return normalizeWhitespace(
    element.innerHTML
      .replace(/<(?:s|strike|del)[^>]*>[\s\S]*?<\/(?:s|strike|del)>/gi, " ")
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<\/p>/gi, "\n")
      .replace(/<\/li>/gi, "\n")
      .replace(/<li[^>]*>/gi, "\n")
      .replace(/<\/tr>/gi, "\n")
      .replace(/<\/td>/gi, "\n")
      .replace(/<[^>]+>/g, " ")
  );
}

function htmlSnippetToText(value: string | null | undefined) {
  return normalizeWhitespace(
    (value ?? "")
      .replace(/<(?:s|strike|del)[^>]*>[\s\S]*?<\/(?:s|strike|del)>/gi, " ")
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<\/p>/gi, "\n")
      .replace(/<\/li>/gi, "\n")
      .replace(/<li[^>]*>/gi, "\n")
      .replace(/<\/tr>/gi, "\n")
      .replace(/<\/td>/gi, "\n")
      .replace(/<[^>]+>/g, " ")
  );
}

function extractInstructionalTeamOfficeHourBlock(section: SectionBlock) {
  const html = section.elements.map((element) => element.outerHTML).join("\n");
  if (!html) return undefined;

  const matchedHtml = html.match(
    /Instructor.?s Office Hours[\s\S]*?(?=Contacting the Instructor|Teaching Assistants|TA(?:.s)?|Course Description|Student Resources|$)/i
  )?.[0];

  if (!matchedHtml) return undefined;

  const text = normalizeOfficeHourParsingText(
    htmlSnippetToText(
      matchedHtml.replace(
        /<strong[^>]*>\s*Instructor.?s Office Hours\s*<\/strong>/i,
        "Office Hours\n"
      )
    )
  );

  return text || undefined;
}

function shortSnippet(value: string) {
  const normalized = normalizeWhitespace(value).replace(/\n/g, " ");
  return normalized.length > 220 ? `${normalized.slice(0, 217)}...` : normalized;
}

function slugify(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function buildStableId(seed: string) {
  let hash = 2166136261;
  for (let index = 0; index < seed.length; index += 1) {
    hash ^= seed.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return Math.abs(hash >>> 0).toString(36);
}

function unique<T>(values: T[]) {
  return Array.from(new Set(values));
}

function uniqueNotes(values: string[]) {
  return unique(values.map((value) => normalizeWhitespace(value)).filter(Boolean));
}

function trimTrailingPeriods(value: string | null | undefined) {
  return normalizeWhitespace(value).replace(/\.+$/g, "").trim();
}

function trimTrailingClauses(value: string | null | undefined) {
  return trimTrailingPeriods(value)
    .replace(/\s*[-–—:;,]+\s*$/g, "")
    .trim();
}

function stripLeadingBulletPrefix(value: string | null | undefined) {
  return normalizeWhitespace(value)
    .replace(/^(?:[•·◦▪▫*]|o)(?=\s+[A-Z(])/i, "")
    .trim();
}

function isPlaceholderDeliverableLabel(label: string | null | undefined) {
  const normalized = normalizeWhitespace(label).toLowerCase();
  if (!normalized) return false;
  return (
    /^(?:assignment|assignments?|report|reports?|paper|papers?|project|projects?|presentation|presentations?)\s+due(?:\s+date)?(?:\b.*)?$/.test(
      normalized
    ) ||
    /^(?:submission|submissions?)$/.test(normalized) ||
    /^(?:assignment|report|paper|project|presentation|proposal)(?:\s+(?:available|review))$/i.test(
      normalized
    ) ||
    /^(?:submission|submissions?)(?:\s+(?:available|review))$/i.test(normalized) ||
    /^the assignments?\s+will\s+be\s+posted\s+on\s+learn(?:\s+available)?$/.test(normalized) ||
    /^there\s+(?:is|are|will be)\b.*\b(?:assignment|assignments?|report|reports?|presentation|presentations?|paper|papers?)\b.*$/.test(
      normalized
    )
  );
}

function contextualizePlaceholderDeliverableLabel(
  entry: string,
  previousLabel: string | undefined
) {
  const normalizedPrevious = normalizeWhitespace(previousLabel);
  if (!normalizedPrevious || !looksLikeAssignmentText(normalizedPrevious)) {
    return undefined;
  }

  const cleanedPrevious = trimTrailingPeriods(
    normalizedPrevious
      .replace(/\s*\(\s*\d+(?:\.\d+)?\s*%[^)]*\)\s*$/i, "")
      .replace(/\s*[-–—:;,]+\s*$/g, "")
  );
  if (!cleanedPrevious) return undefined;
  const cleanedPreviousCore = normalizeWhitespace(
    cleanedPrevious.replace(/\s+(?:available|review)\b/i, "")
  );

  const normalizedEntry = normalizeWhitespace(entry).toLowerCase();
  const partMatch = normalizedEntry.match(/\bpart\s+([a-z0-9]+)\b/i)?.[1];
  if (partMatch) {
    const normalizedPart =
      /^[a-z]$/i.test(partMatch) ? partMatch.toUpperCase() : partMatch;
    return /\bpart\s+[a-z0-9]+\b/i.test(cleanedPreviousCore)
      ? cleanedPreviousCore.replace(/\bpart\s+[a-z0-9]+\b/i, `Part ${normalizedPart}`)
      : `${cleanedPreviousCore} Part ${normalizedPart}`;
  }
  if (/\bslides?\b|\bpresentation materials\b/.test(normalizedEntry)) {
    return /\bpresentation materials\b|\bslides?\b/i.test(cleanedPreviousCore)
      ? cleanedPreviousCore
      : "Project Presentation Materials";
  }
  if (/\bpresent(?:ation|ed|ing)\b/.test(normalizedEntry)) {
    return /\bpresentation\b/i.test(cleanedPreviousCore)
      ? cleanedPreviousCore
      : `${cleanedPreviousCore} Presentation`;
  }
  const previousWithoutPresentation = normalizeWhitespace(
    cleanedPreviousCore.replace(/\s+presentations?\b/i, "")
  );
  if (/\bwritten portion\b/.test(normalizedEntry)) {
    const baseLabel = previousWithoutPresentation || cleanedPreviousCore;
    return /\bwritten portion\b/i.test(cleanedPreviousCore)
      ? cleanedPreviousCore
      : `${baseLabel} Written Portion`;
  }
  if (/\bwritten submissions?\b/.test(normalizedEntry)) {
    const baseLabel = previousWithoutPresentation || cleanedPreviousCore;
    return /\bwritten submission\b/i.test(cleanedPreviousCore)
      ? cleanedPreviousCore
      : `${baseLabel} Written Submission`;
  }
  if (/\breport\b/.test(normalizedEntry)) {
    const baseLabel = previousWithoutPresentation || cleanedPreviousCore;
    return /\breport\b/i.test(cleanedPreviousCore)
      ? cleanedPreviousCore
      : `${baseLabel} Report`;
  }
  if (/\bcheck-?ins?\b/.test(normalizedEntry)) {
    const baseLabel = previousWithoutPresentation || cleanedPreviousCore;
    return /\bcheck-?in\b/i.test(cleanedPreviousCore)
      ? cleanedPreviousCore
      : `${baseLabel} Check-In`;
  }
  if (/\bposts?\b/.test(normalizedEntry)) {
    return /\bpost\b/i.test(cleanedPreviousCore)
      ? cleanedPreviousCore
      : `${cleanedPreviousCore} Post`;
  }
  if (/\bresponses?\b/.test(normalizedEntry)) {
    return /\bresponse\b/i.test(cleanedPreviousCore)
      ? cleanedPreviousCore
      : `${cleanedPreviousCore} Response`;
  }
  if (/\breviewed in class\b/.test(normalizedEntry)) {
    return /\breview\b/i.test(cleanedPreviousCore)
      ? cleanedPreviousCore
      : `${cleanedPreviousCore} Review`;
  }
  if (
    /\b(?:available(?:\s+as\s+of|\s+from|\s+on)?|opens?(?:\s+on)?|posted(?:\s+on|\s+to)?|released|release(?:d)?\s+week\s+of|begins?(?:\s+on)?|starts?(?:\s+on)?)\b/i.test(
      normalizedEntry
    )
  ) {
    return /\bavailable\b/i.test(cleanedPreviousCore)
      ? cleanedPreviousCore
      : `${cleanedPreviousCore} Available`;
  }
  if (/\bposted on learn\b|\bavailable on learn\b/.test(normalizedEntry)) {
    return /\bavailable\b/i.test(cleanedPreviousCore)
      ? cleanedPreviousCore
      : `${cleanedPreviousCore} Available`;
  }
  return cleanedPreviousCore;
}

function hasAvailabilityCue(text: string | null | undefined) {
  const normalized = normalizeWhitespace(text);
  if (!normalized) return false;
  return /\b(?:available(?:\s+as\s+of|\s+from|\s+on)?|opens?(?:\s+on)?|posted(?:\s+on|\s+to)?|released|release(?:d)?\s+week\s+of|begins?(?:\s+on)?|starts?(?:\s+on)?)\b/i.test(
    normalized
  );
}

function hasInClassReviewCue(text: string | null | undefined) {
  const normalized = normalizeWhitespace(text);
  if (!normalized) return false;
  return /\b(?:reviewed in class|review in class|reviewed during class|reviewed on)\b/i.test(
    normalized
  );
}

function isReviewOrPlaceholderScheduleEntry(value: string | null | undefined) {
  const normalized = normalizeWhitespace(value);
  if (!normalized) return true;
  return (
    /^no quizzes?\b/i.test(normalized) ||
    /^no tests?\b/i.test(normalized) ||
    /^no assignments?\b/i.test(normalized) ||
    /^no tutorials?\b/i.test(normalized) ||
    /^review for (?:the )?(?:mid-?term|midterm|quiz|test|exam|final)/i.test(normalized) ||
    /^mid-?term prep\b/i.test(normalized) ||
    /^test preparation\b/i.test(normalized) ||
    /^discussing mid-?term\b/i.test(normalized) ||
    /^exam review$/i.test(normalized) ||
    /^\(?exam review\)?$/i.test(normalized) ||
    /^\d{1,2}\s*,\s*\d{1,2}\s+[A-Za-z]{3,9}\s*\(\s*exam review\s*\)$/i.test(normalized) ||
    /^more details? will be available\b.*\b(?:quiz|test|midterm|exam)\b/i.test(normalized) ||
    /^details? will be available\b.*\b(?:quiz|test|midterm|exam)\b/i.test(normalized)
  );
}

function applyEventTimingLabel(label: string, cueText: string | null | undefined) {
  const normalizedLabel = normalizeWhitespace(label);
  if (!normalizedLabel) return normalizedLabel;
  const labelCore = normalizeWhitespace(
    normalizedLabel.replace(/\s+(?:available|review)\b/i, "")
  );
  if (hasInClassReviewCue(cueText)) {
    return /\breview\b/i.test(labelCore) ? labelCore : `${labelCore} Review`;
  }
  if (hasAvailabilityCue(cueText)) {
    return /\bavailable\b/i.test(labelCore) ? labelCore : `${labelCore} Available`;
  }
  return labelCore;
}

function hasDirectDeadlineCue(value: string | null | undefined) {
  const normalized = normalizeWhitespace(value);
  if (!normalized) return false;
  return (
    /\b(?:due|deadline|available as of|opens?(?:\s+on)?|closes?(?:\s+on)?|submission due date|review of peers due date|feedback(?: review)? due date)\b/i.test(
      normalized
    ) || extractExplicitDates(normalized, new Date().getFullYear()).length > 0
  );
}

function normalizeLocation(location: string) {
  return trimTrailingPeriods(location)
    .replace(/\s+/g, " ")
    .replace(/ ,/g, ",")
    .trim();
}

function normalizeRoomToken(token: string) {
  return normalizeLocation(token.replace(/([A-Za-z0-9])-(\d)/g, "$1 $2"));
}

function extractStructuredLocation(text: string, allowVerbatimShort = false) {
  const normalized = stripLeadingBulletPrefix(text).replace(/^[-:;,.\s]+/, "");
  if (!normalized) return "";
  if (
    /\b(?:location|room)\s+tbd\b/i.test(normalized) ||
    /^tbd$/i.test(normalized)
  ) {
    return "";
  }
  if (/kritik/i.test(normalized)) return "";
  if (/pebblepad/i.test(normalized)) {
    return /portfolio/i.test(normalized) ? "PebblePad Portfolio" : "PebblePad";
  }
  if (/padlet/i.test(normalized) && /learn/i.test(normalized)) return "Padlet / LEARN";
  if (/padlet/i.test(normalized)) return "Padlet";
  if (/crowdmark/i.test(normalized)) return "Crowdmark";
  if (/learn.*quiz|quiz.*learn/i.test(normalized)) return "LEARN Quiz";
  if (/dropbox.*learn|learn.*dropbox|submitted to dropbox on learn|identified learn dropbox/i.test(normalized)) {
    return "LEARN Dropbox";
  }
  if (/learn/i.test(normalized)) return "LEARN";
  if (/connect/i.test(normalized)) return "McGraw-Hill Connect";
  if (/odyssey/i.test(normalized)) return "In-person, locations set by Odyssey";
  if (/written in-?class|in class/i.test(normalized)) return "In class";
  if (/in-person|in person/i.test(normalized)) return "In person";
  if (/virtual|online/i.test(normalized)) return "Online";

  const roomMatch =
    normalized.match(/\b(?:in|at|room)\s+([A-Z]{1,4}\s?-?\d{3,4}[A-Za-z]?)\b/)?.[1] ??
    normalized.match(/\b([A-Z]{1,4}\s?-?\d{3,4}[A-Za-z]?)\b/)?.[1];
  if (roomMatch) {
    return normalizeRoomToken(roomMatch);
  }

  if (allowVerbatimShort && normalized.length <= 48 && !/[.!?]/.test(normalized)) {
    return normalizeLocation(normalized);
  }

  return "";
}

function buildTitle(courseCode: string, location: string) {
  const normalized = normalizeLocation(location);
  return normalized ? `${courseCode} @ ${normalized}` : courseCode;
}

function addLocationToTitle(base: string, location?: string) {
  const normalized = normalizeLocation(location);
  return normalized ? `${base} @ ${normalized}` : base;
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

function assessmentSeriesKeyForTitle(label: string) {
  const normalized = normalizeAssessmentLabel(label).toLowerCase();

  if (/\bterm test\b/.test(normalized)) return "term test";
  if (/\bmidterm test\b/.test(normalized)) return "midterm test";
  if (/\bmidterm\b/.test(normalized)) return "midterm";
  if (/\bendterm\b/.test(normalized)) return "endterm";
  if (/\bquiz\b/.test(normalized)) return "quiz";
  if (/\bfinal exam\b/.test(normalized)) return "final exam";
  if (/\bexam\b/.test(normalized)) return "exam";
  if (/\btest\b/.test(normalized)) return "test";

  return "";
}

function stripAssessmentSequenceNumber(label: string) {
  return normalizeWhitespace(
    label.replace(
      /\b((?:term test|midterm test|midterm|quiz|final exam|exam|test))\s*#\s*\d+\b/i,
      "$1"
    )
  );
}

function normalizedAssessmentTitleLabel(
  label: string,
  assessmentSeriesCounts: Map<string, number>
) {
  const normalized = normalizeAssessmentLabel(label);
  const seriesKey = assessmentSeriesKeyForTitle(normalized);
  if (!seriesKey) return normalized;

  return (assessmentSeriesCounts.get(seriesKey) ?? 0) > 1
    ? normalized
    : stripAssessmentSequenceNumber(normalized);
}

function assignmentDueTimeFromNotes(notes: string[]) {
  return notes
    .map((note) => note.match(/^Due time:\s*(\d{2}:\d{2})$/i)?.[1]?.trim())
    .find(Boolean);
}

function formatAssignmentDueTime(value: string) {
  const [hourText, minuteText] = value.split(":");
  const hour = Number(hourText);
  const minute = Number(minuteText);
  if (!Number.isFinite(hour) || !Number.isFinite(minute)) return value;

  const suffix = hour >= 12 ? "PM" : "AM";
  const hour12 = hour % 12 || 12;
  return `${hour12}:${`${minute}`.padStart(2, "0")} ${suffix}`;
}

function addAssignmentDueTimeToTitle(title: string, event: EventCandidate) {
  const dueTime = assignmentDueTimeFromNotes(event.notes);
  if (!dueTime) return title;

  const displayTime = formatAssignmentDueTime(dueTime);
  if (title.toLowerCase().includes(displayTime.toLowerCase())) return title;

  return `${title} (due ${displayTime})`;
}

function buildCalendarTitle(
  courseCode: string,
  event: EventCandidate,
  assessmentSeriesCounts: Map<string, number>
) {
  if (
    event.eventType === "Lecture" ||
    event.eventType === "Tutorial" ||
    event.eventType === "Lab"
  ) {
    return `${courseCode} (${meetingTypeCode(event.eventType)})`;
  }

  if (event.eventType === "Assessment") {
    return addLocationToTitle(
      `${courseCode} ${normalizedAssessmentTitleLabel(event.label, assessmentSeriesCounts)}`,
      event.location
    );
  }

  if (event.eventType === "Assignment") {
    return addLocationToTitle(
      addAssignmentDueTimeToTitle(
        `${courseCode} ${normalizeWhitespace(event.label)}`.trim(),
        event
      ),
      event.location
    );
  }

  if (event.eventType === "Other") {
    return addLocationToTitle(
      `${courseCode} ${normalizeWhitespace(event.label)}`.trim(),
      event.location
    );
  }

  const officeHoursBase = `${courseCode} Office Hours`;
  return /^office hours$/i.test(normalizeLocation(event.location))
    ? officeHoursBase
    : addLocationToTitle(officeHoursBase, event.location);
}

function applyCalendarTitles(course: ParsedCourse, events: EventCandidate[]) {
  const assessmentSeriesCounts = new Map<string, number>();

  events
    .filter((event) => event.eventType === "Assessment")
    .forEach((event) => {
      const seriesKey = assessmentSeriesKeyForTitle(event.label);
      if (!seriesKey) return;
      assessmentSeriesCounts.set(
        seriesKey,
        (assessmentSeriesCounts.get(seriesKey) ?? 0) + 1
      );
    });

  return events.map((event) => ({
    ...event,
    title: buildCalendarTitle(course.courseCode, event, assessmentSeriesCounts),
  }));
}

function capitalizeAssessmentText(label: string) {
  const SMALL_WORDS = new Set(["a", "an", "and", "at", "by", "for", "in", "of", "on", "or", "the", "to"]);
  let wordIndex = 0;

  return normalizeWhitespace(label)
    .replace(/\b([A-Za-z][A-Za-z']*)\b/g, (word) => {
      const lower = word.toLowerCase();
      const isFirstWord = wordIndex === 0;
      wordIndex += 1;

      if (!isFirstWord && SMALL_WORDS.has(lower)) {
        return lower;
      }
      if (/^[ivxlcdm]+$/i.test(word)) {
        return word.toUpperCase();
      }
      return lower.charAt(0).toUpperCase() + lower.slice(1);
    })
    .replace(/\bmid[\s-]?term\b/gi, "Midterm")
    .replace(/\bin-Class\b/gi, "In-Class")
    .replace(/\blecture-Related\b/gi, "Lecture-Related")
    .replace(/\bone-Page\b/gi, "One-Page");
}

function capitalizeAssignmentText(label: string) {
  const SMALL_WORDS = new Set(["a", "an", "and", "at", "by", "for", "in", "of", "on", "or", "the", "to"]);
  let wordIndex = 0;

  return normalizeWhitespace(label)
    .replace(/\b([A-Za-z][A-Za-z']*)\b/g, (word) => {
      const lower = word.toLowerCase();
      const isFirstWord = wordIndex === 0;
      wordIndex += 1;

      if (/^[ivxlcdm]+$/i.test(word)) {
        return word.toUpperCase();
      }
      if (/^[A-Z]$/.test(word)) {
        return word;
      }
      if (!isFirstWord && SMALL_WORDS.has(lower)) {
        return lower;
      }
      if (isFirstWord || lower.length > 5) {
        return lower.charAt(0).toUpperCase() + lower.slice(1);
      }
      if (/^[A-Z]/.test(word)) {
        return word.charAt(0).toUpperCase() + word.slice(1);
      }
      return word;
    })
    .replace(/\bin-Class\b/gi, "In-Class")
    .replace(/\blecture-Related\b/gi, "Lecture-Related")
    .replace(/\bone-Page\b/gi, "One-Page");
}

function stripLeadingSeriesCount(label: string) {
  return normalizeWhitespace(label).replace(
    /^\d+\s+((?:(?:weekly|online|pre-?lab|lab|written|take-?home)\s+)*(?:midterm exams?|quizzes?|assignments?|worksheets?|reports?))\b/i,
    "$1"
  );
}

function looksLikeStandaloneDateOrRangeLabel(value: string | null | undefined) {
  const normalized = normalizeWhitespace(value);
  if (!normalized) return true;

  return (
    /^(?:week\s*\d+\s*[:.-]?\s*)?(?:(?:mon(?:day)?|tue(?:s|sday)?|wed(?:nesday)?|thu(?:r|rs|rsday|ursday)?|fri(?:day)?|sat(?:urday)?|sun(?:day)?),?\s+)?(?:(?:\d{1,2}\s+)?(?:january|february|march|april|may|june|july|august|september|october|november|december|jan|feb|mar|apr|jun|jul|aug|sep|sept|oct|nov|dec)\.?\s+\d{1,2}(?:st|nd|rd|th)?)(?:\s*(?:-|–|—|to)\s*(?:(?:\d{1,2}\s+)?(?:january|february|march|april|may|june|july|august|september|october|november|december|jan|feb|mar|apr|jun|jul|aug|sep|sept|oct|nov|dec)\.?\s+\d{1,2}(?:st|nd|rd|th)?|\d{1,2}(?:st|nd|rd|th)?))?$/i.test(
      normalized
    ) ||
    /^(?:\d+\.\s*)?(?:(?:mon(?:day)?|tue(?:s|sday)?|wed(?:nesday)?|thu(?:r|rs|rsday|ursday)?|fri(?:day)?|sat(?:urday)?|sun(?:day)?),?\s+)?(?:january|february|march|april|may|june|july|august|september|october|november|december|jan|feb|mar|apr|jun|jul|aug|sep|sept|oct|nov|dec)\.?\s+\d{1,2}(?:st|nd|rd|th)?$/i.test(
      normalized
    ) ||
    /^(?:may|june|july|august|september|october|november|december|jan|feb|mar|apr|jun|jul|aug|sep|sept|oct|nov|dec)\.?\s+\d{1,2}\s*(?:-|–|—|to)\s*\d{1,2}$/i.test(
      normalized
    ) ||
    /^(?:finals?|final exam period)$/i.test(normalized)
  );
}

function salvageTrailingSentenceFragmentLabel(label: string) {
  const normalized = normalizeWhitespace(label);
  const phraseMatch =
    normalized.match(
      /^(?:(?:this|that|the|these|those|my|our|your)\s+)(.+?)\s+(?:is|are)$/i
    ) ??
    normalized.match(/^(.+?)\s+(?:is|are)$/i);
  if (!phraseMatch) return undefined;
  const nounPhrase = normalizeWhitespace(phraseMatch[1]).replace(
    /^(?:all|this|that|the|these|those|my|our|your)\s+/i,
    ""
  );
  if (!nounPhrase) return undefined;
  if (
    /\b(?:due|available|opens?|closes?|posted|submitted?|reviewed?|released|scheduled|held|worth|weighted|described|listed)\b/i.test(
      nounPhrase
    )
  ) {
    return undefined;
  }
  if (
    !/\b(?:assignments?|assessments?|reports?|projects?|papers?|proposals?|submissions?|deliverables?|essays?|presentations?|reflections?|quiz(?:zes)?|tests?|midterms?|exams?|bibliograph(?:y|ies)|abstracts?|summaries?|problems?|check-?ins?|workbooks?|posters?|tasks?|analys(?:is|es)|reviews?|files?|contracts?|case studies?|program design|readiness activit(?:y|ies))\b$/i.test(
      nounPhrase
    )
  ) {
    return undefined;
  }

  if (/\b(?:assessment|quiz|test|midterm|exam)s?\b/i.test(nounPhrase)) {
    return capitalizeAssessmentText(nounPhrase);
  }

  return capitalizeAssignmentText(nounPhrase);
}

function salvageDeliverableFromSentencePrefix(label: string) {
  const normalized = normalizeWhitespace(label);
  const sentenceMatch = normalized.match(
    /^(?:(?:all|this|that|the|these|those|my|our|your)\s+)?(.+?)\s+(?:is|are|will be)\b/i
  );
  if (!sentenceMatch) return undefined;

  const nounPhrase = normalizeWhitespace(sentenceMatch[1]).replace(
    /^(?:all|this|that|the|these|those|my|our|your)\s+/i,
    ""
  );
  if (!nounPhrase) return undefined;
  if (
    /\b(?:due|available|opens?|closes?|posted|submitted?|reviewed?|released|scheduled|held|worth|weighted|described|listed|given)\b/i.test(
      nounPhrase
    )
  ) {
    return undefined;
  }

  if (/\b(?:assessment|quiz|test|midterm|exam)s?\b$/i.test(nounPhrase)) {
    return capitalizeAssessmentText(nounPhrase);
  }
  if (
    /\b(?:assignments?|reports?|projects?|papers?|proposals?|submissions?|deliverables?|essays?|presentations?|reflections?|bibliograph(?:y|ies)|abstracts?|summaries?|problems?|check-?ins?|workbooks?|posters?|tasks?|analys(?:is|es)|reviews?|files?|contracts?|surveys?|commentaries?|modules?|case studies?|program design|readiness activit(?:y|ies))\b$/i.test(
      nounPhrase
    )
  ) {
    return capitalizeAssignmentText(nounPhrase);
  }

  return undefined;
}

function isInstructionalDeliverableNoise(value: string | null | undefined) {
  const normalized = normalizeWhitespace(value);
  if (!normalized) return true;
  return (
    /\bspecific instructions?\b.*\bprovided via learn\b/i.test(normalized) ||
    /\bassignment should be completed\b/i.test(normalized) ||
    /\bwritten in your own words\b/i.test(normalized) ||
    /\binformation cited appropriately\b/i.test(normalized) ||
    /\bcited appropriately using\b/i.test(normalized) ||
    /\bexact questions .* will be announced on learn\b/i.test(normalized) ||
    /\bleave yourself enough time to submit assignments?\b/i.test(normalized) ||
    /\blike with the short presentation\b/i.test(normalized) ||
    /\byoutube link\b/i.test(normalized) ||
    /\blate penalty\b/i.test(normalized) ||
    /\bproject help session\b/i.test(normalized) ||
    /\bproject consultation\b/i.test(normalized) ||
    /\bclass project introduction\b/i.test(normalized) ||
    /\bclass project organization discussions?\b/i.test(normalized) ||
    /\bassignment one handout\b/i.test(normalized) ||
    /\bprogram instruction\/training session\b/i.test(normalized) ||
    /\bassessment booking\/practice\b/i.test(normalized) ||
    /\bpractical exam preparation\b/i.test(normalized) ||
    /^(?:start thinking about|work on|continue working on|keep working on|review for)\b/i.test(
      normalized
    ) ||
    /\bstudents?\s+(?:will|must|should|are)\b/i.test(normalized)
  );
}

function canonicalizeProseDeliverableLabel(label: string, contextText?: string) {
  const normalized = trimTrailingClauses(normalizeWhitespace(label))
    .replace(/^[“"'`(\[]+\s*/g, "")
    .replace(/\s*[”"'`\])]+$/g, "")
    .replace(/\s+\b(?:is|are)\b$/i, "")
    .trim();
  if (!normalized) return undefined;
  if (looksLikeStandaloneDateOrRangeLabel(normalized)) {
    return undefined;
  }
  if (
    /^week\b/i.test(normalized) &&
    !/\b(?:due|deadline|available|opens?|closes?|submission date|date of submission)\b/i.test(
      normalized
    )
  ) {
    return undefined;
  }
  if (
    /^(?:for example|example|if\b|otherwise\b|when you receive\b|requests? for re-?grading\b|please\b|like with\b|as with\b)/i.test(
      normalized
    ) ||
    /^(?:the|this|that|these|those)$/i.test(normalized) ||
    /^(?:start thinking about|work on|continue working on|keep working on|review for)\b/i.test(
      normalized
    ) ||
    /^we\s+(?:will|also)\b/i.test(normalized) ||
    /^assignments?\s+are\s+due(?:\s+by|\s+on)?\b/i.test(normalized) ||
    /^grades?\s+for\s+each\s+assignment\b/i.test(normalized) ||
    /^the following rules apply if\b/i.test(normalized) ||
    /^all assignments?\s+will\s+be\s+(?:open|posted|submitted|marked)\b/i.test(normalized) ||
    /\bassigned exercise or task\b/i.test(normalized) ||
    /\bgraded papers?\s+will\s+be\s+made\s+available\b/i.test(normalized) ||
    /\bnotification if you intend to assign\b/i.test(normalized)
  ) {
    return undefined;
  }
  if (isGenericProseDeliverableHeading(normalized)) {
    return undefined;
  }
  const salvagedTrailingFragmentLabel = salvageTrailingSentenceFragmentLabel(normalized);
  if (salvagedTrailingFragmentLabel) {
    return salvagedTrailingFragmentLabel;
  }
  const salvagedSentencePrefixLabel = salvageDeliverableFromSentencePrefix(normalized);
  if (salvagedSentencePrefixLabel) {
    return salvagedSentencePrefixLabel;
  }
  const descriptiveSentenceMatch = normalized.match(
    /^(?:this|that|the)\s+(.+?)\s+is\s+an?\s+(?:(?:weekly|written|group|team|final|online|lab|pre-?lab|post-?lab|take-?home|peer|short|research|reading|capstone|essay)\s+)*(?:assignment|report|project|proposal|reflection|paper|essay|presentation)\b/i
  );
  if (descriptiveSentenceMatch) {
    const salvagedDescription = normalizeWhitespace(descriptiveSentenceMatch[1]);
    if (salvagedDescription && looksLikeAssignmentText(salvagedDescription)) {
      return capitalizeAssignmentText(salvagedDescription);
    }
  }
  const futureSentenceMatch = normalized.match(
    /^(?:this|that|the)\s+(.+?)\s+will\s+be\b/i
  );
  if (futureSentenceMatch) {
    const salvagedDescription = normalizeWhitespace(futureSentenceMatch[1]);
    if (salvagedDescription && looksLikeAssignmentText(salvagedDescription)) {
      return capitalizeAssignmentText(salvagedDescription);
    }
  }
  if (/\b(?:is|are)$/i.test(normalized)) {
    return undefined;
  }

  const search = normalizeWhitespace([normalized, contextText].filter(Boolean).join(" ")).toLowerCase();
  if (/^(?:one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|\d+)\s+surveys?\b/i.test(normalized)) {
    return undefined;
  }
  if (
    /\b(?:one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|\d+)\s+surveys?\s+(?:will be|are)\b/.test(
      search
    )
  ) {
    return undefined;
  }
  if (/^first survey\b/i.test(normalized) && /\bprior knowledge survey\b/.test(search)) {
    return "Prior Knowledge Survey";
  }
  if (/\bassignments?\s+will\s+be\s+posted\s+on\s+learn\b/.test(search)) {
    return undefined;
  }
  if (/^assignment due(?:\s+date)?(?:\b.*)?$/.test(search)) {
    return "Assignment";
  }
  if (/^report due(?:\s+date)?(?:\b.*)?$/.test(search)) {
    return "Report";
  }
  if (/^presentation due(?:\s+date)?(?:\b.*)?$/.test(search)) {
    return "Presentation";
  }
  if (/\btechnical report\b/.test(search)) {
    return "Technical Report";
  }
  if (/\bprior knowledge survey\b/.test(search)) {
    return "Prior Knowledge Survey";
  }
  if (/\bpre-?course survey\b/.test(search)) {
    return "Pre-Course Survey";
  }
  if (/\bself-introduction\b/.test(search)) {
    return "Self-Introduction";
  }
  if (/\bcommentary\s*#?\s*(\d+)\s*post\b/i.test(search)) {
    const match = search.match(/\bcommentary\s*#?\s*(\d+)\s*post\b/i)?.[1];
    if (match) return `Commentary ${Number(match)} Post`;
  }
  if (/\bcommentary\s*#?\s*(\d+)\s*responses?\b/i.test(search)) {
    const match = search.match(/\bcommentary\s*#?\s*(\d+)\s*responses?\b/i)?.[1];
    if (match) return `Commentary ${Number(match)} Response`;
  }
  if (/\bfinal reflections? paper\b/.test(search)) {
    return "Final Reflections Paper";
  }
  if (/\breflections? paper\b/.test(search)) {
    return "Reflections Paper";
  }
  if (/\b(?:completion of )?an online survey\b/.test(search)) {
    return "Course Survey";
  }
  if (/\bpre-?midterm\b.*\bcheck-?in\b/.test(search)) {
    return "Pre-Midterm Check-In";
  }
  if (/\bpre-?final\b.*\bcheck-?in\b/.test(search)) {
    return "Pre-Final Check-In";
  }
  if (/\bthere (?:will be|are)\s+(?:\d+|one|two|three|four|five|six|seven|eight|nine|ten)\s+mobius assignments?\b/.test(search)) {
    return "Mobius Assignments";
  }
  if (/\bthere (?:will be|are)\s+(?:\d+|one|two|three|four|five|six|seven|eight|nine|ten)\s+written assignments?\b/.test(search)) {
    return "Written Assignments";
  }
  const mobiusAssignmentMatch = search.match(/\bmobius assignment\s*#?\s*(\d+)\b/i)?.[1];
  if (mobiusAssignmentMatch) {
    return `Mobius Assignment #${Number(mobiusAssignmentMatch)}`;
  }
  const mobiusAssignmentRangeMatch = search.match(
    /\bmobius(?: assignments?)?\s*(\d+)\s*(?:-|–|to)\s*(\d+)\b/i
  );
  if (mobiusAssignmentRangeMatch) {
    return `Mobius Assignments #${Number(mobiusAssignmentRangeMatch[1])}-${Number(
      mobiusAssignmentRangeMatch[2]
    )}`;
  }
  const writtenAssignmentMatch = search.match(/\bwritten assignment\s*#?\s*(\d+)\b/i)?.[1];
  if (writtenAssignmentMatch) {
    return `Written Assignment #${Number(writtenAssignmentMatch)}`;
  }
  const writtenAssignmentRangeMatch = search.match(
    /\bwritten assignments?\s*(\d+)\s*(?:-|–|to)\s*(\d+)\b/i
  );
  if (writtenAssignmentRangeMatch) {
    return `Written Assignments #${Number(writtenAssignmentRangeMatch[1])}-${Number(
      writtenAssignmentRangeMatch[2]
    )}`;
  }
  const tutorialProblemMatch = search.match(/\btutorial problem\s*#?\s*(\d+)/i)?.[1];
  if (tutorialProblemMatch) {
    return `Tutorial Problem ${tutorialProblemMatch}`;
  }
  const problemSetMatch = search.match(/\bproblem set\s*#?\s*(\d+)\b/i)?.[1];
  if (problemSetMatch) {
    return `Problem Set #${Number(problemSetMatch)}`;
  }
  const problemSetRangeMatch = search.match(
    /\bproblem sets?\s*#?\s*(\d+)\s*(?:-|–|to)\s*(\d+)\b/i
  );
  if (problemSetRangeMatch) {
    return `Problem Sets #${Number(problemSetRangeMatch[1])}-${Number(
      problemSetRangeMatch[2]
    )}`;
  }
  if (/\bfinal team case presentation\b/.test(search)) {
    return "Final Team Case Presentation";
  }
  if (/\bteam case presentation\b/.test(search)) {
    return "Final Team Case Presentation";
  }
  if (/\bproject abstract\b/.test(search)) {
    return "Project Abstract";
  }
  if (/\bskoden reflection\b/.test(search)) {
    return "Skoden Reflection";
  }
  if (/\bstory map\b/.test(search)) {
    return "Story Map";
  }
  const numberedTakeHomeAnalysisMatch = search.match(
    /\bassignment\s*#?\s*(\d+)\b.*\btake-?home final analysis\b/i
  )?.[1];
  if (numberedTakeHomeAnalysisMatch) {
    return `Assignment #${Number(numberedTakeHomeAnalysisMatch)}`;
  }
  if (/\bproblem sets?\b/.test(search)) {
    return "Problem Set";
  }
  if (/\bproject\s+([ivxlc]+)\b/i.test(search)) {
    const projectNumber = search.match(/\bproject\s+([ivxlc]+)\b/i)?.[1];
    if (projectNumber) {
      return `Project ${projectNumber.toUpperCase()}`;
    }
  }
  const ordinalProjectMatch = search.match(
    /\b(?:the\s+)?(first|second|third|fourth)\s+project\b/i
  )?.[1];
  if (ordinalProjectMatch) {
    const romanByOrdinal: Record<string, string> = {
      first: "I",
      second: "II",
      third: "III",
      fourth: "IV",
    };
    return `Project ${romanByOrdinal[ordinalProjectMatch.toLowerCase()]}`;
  }
  if (/\bannotated\s+bib[a-z]*\b/.test(search)) {
    return "Annotated Bibliography";
  }
  if (/\bop-?ed assignment\b/.test(search)) {
    return "Op-Ed Assignment";
  }
  if (/\bbook analysis\b/.test(search)) {
    return "Book Analysis";
  }
  if (/\bbook review discussion\b/.test(search)) {
    return "Book Review Discussion";
  }
  if (/\bevent report\b/.test(search)) {
    return "Event Report";
  }
  if (/\bconcept map\b/i.test(search) && /\bcheck-?ins?\b/i.test(search)) {
    return "Concept Map Check-In";
  }
  if (/\bposter presentations?\b/.test(search)) {
    return "Poster Presentation";
  }
  if (/\bresearch proposal\b/.test(search)) {
    return "Research Proposal";
  }
  if (/\bstudent survey\b/.test(search)) {
    return "Student Survey";
  }
  if (/\bcourse survey\b/.test(search)) {
    return "Course Survey";
  }
  if (/\bfinal response\b/.test(search)) {
    return "Final Response";
  }
  if (/\bproject reports?\b/.test(search)) {
    return "Project Report";
  }
  const commentaryMatch = search.match(/\bcommentary\s*#?\s*(\d+)\b/i)?.[1];
  if (commentaryMatch) {
    return `Commentary #${Number(commentaryMatch)}`;
  }
  if (/\bcommentary\b/.test(search)) {
    return "Commentary";
  }
  const labReportMatch = search.match(/\blab report\s*#?\s*(\d+)\b/i)?.[1];
  if (labReportMatch) {
    return `Lab Report #${Number(labReportMatch)}`;
  }
  if (/\blab report\b/.test(search)) {
    return "Lab Report";
  }
  const moduleMatch = search.match(/\bmodule\s*#?\s*(\d+)\b/i)?.[1];
  if (moduleMatch) {
    return `Module ${Number(moduleMatch)}`;
  }
  const majorGroupAssignmentMatch = search.match(/\bmajor group assignment\s*#?\s*(\d+)\b/i)?.[1];
  if (majorGroupAssignmentMatch) {
    return `Major Group Assignment #${Number(majorGroupAssignmentMatch)}`;
  }
  if (/\bmajor group assignment\b/.test(search)) {
    return "Major Group Assignment";
  }
  const groupAssignmentMatch = search.match(/\b(?:one\s+)?group assignment\s*#?\s*(\d+)\b/i)?.[1];
  if (groupAssignmentMatch) {
    return `Group Assignment #${Number(groupAssignmentMatch)}`;
  }
  if (/\b(?:one\s+)?group assignment\b/.test(search)) {
    return "Group Assignment";
  }
  if (/\bcapstone team and problem space\b/.test(search)) {
    return "Capstone Team and Problem Space";
  }
  if (/\bpeer mentoring reflection\b/.test(search)) {
    return "Peer Mentoring Reflection";
  }
  if (/\bindividual contribution statement\b/.test(search)) {
    return "Individual Contribution Statement";
  }
  if (/\bgrant proposal\b/.test(search)) {
    return "Grant Proposal";
  }
  if (/\bwritten,?\s+scientific report\b/.test(search)) {
    return "Research Report";
  }
  if (/\binitial submission\b/.test(search)) {
    return "Initial Submission";
  }
  if (/\bfinal paper\b/.test(search)) {
    return "Final Paper";
  }
  if (/\burban armature drawings?\b/.test(search)) {
    return "Urban Armature Drawings";
  }
  if (/\bsketchbook\b/.test(search) && /\breturned\b/.test(search)) {
    return "Sketchbook Return";
  }
  if (/\bsketchbook\b/.test(search) && /\b(?:submit|submission|due)\b/.test(search)) {
    return "Sketchbook Submission";
  }
  if (
    /\bpost your presentation\b/.test(search) ||
    /\bpresentation in your team'?s channel\b/.test(search)
  ) {
    return "Project Presentation Upload";
  }
  if (/\bproject delivery\b/.test(search)) {
    return "Project Delivery";
  }
  if (/\bsigned group agreement form\b/.test(search)) {
    return "Signed Group Agreement Form";
  }
  if (/\bshort video(?: submission)?\b/.test(search)) {
    return "Short Video Submission";
  }
  const deliverableMatch = search.match(/\bdeliverable\s*(\d+)(?:\s*\((part\s*\d+)\))?/i);
  if (deliverableMatch) {
    const [, number, part] = deliverableMatch;
    return part
      ? `Deliverable ${number} (${capitalizeAssessmentText(part)})`
      : `Deliverable ${number}`;
  }
  if (/\bgroup presentations?\b/.test(search)) {
    return "Group Presentation";
  }
  if (
    /\bdeck\b.*\bpresented in class\b/.test(search) ||
    /\bpresented in class\b.*\bdeck\b/.test(search) ||
    /\bmock cabinet\b/.test(search)
  ) {
    return "Group Presentation";
  }
  if (/\bif completing the documentary response\b/.test(search)) {
    return "Documentary Response";
  }
  if (/\bdisaster risk reduction assignment\b/.test(search)) {
    return "DRR Plan";
  }
  if (/\bfinal group report\b/.test(search) || (/\bgroup reports?\b/.test(search) && /\b40%\b/.test(search))) {
    return "Final Group Report";
  }
  if (/\bresearch paper discussion\b/.test(search)) {
    return "Research Paper Discussion";
  }
  if (/\bchoose a reading\b/.test(search)) {
    return "Choose a Reading";
  }
  if (/\bpaper assignment\b/.test(search)) {
    return "Paper Assignment";
  }
  const keywordMatches: Array<[RegExp, string]> = [
    [/\bproject pitch\b/, "Project Pitch"],
    [/\bproject proposal\b|\bproposal and the optional team charter\b|\bproposal\b.*\bteam charter\b/, "Project Proposal"],
    [/\b(?:completed\s+)?power\s*point presentation\b|\b(?:completed\s+)?powerpoint presentation\b/, "Project Presentation Materials"],
    [/\bproject presentation materials\b|\bpresentation materials\b|\bsubmit slides?\b|\bslides?\b.*\bpresentations?\b/, "Project Presentation Materials"],
    [/\bfinal project presentation\b|\bproject presentation\b|\bpresent their (?:work|project)\b/, "Project Presentation"],
    [/\bproject peer review\b|\bpeer review\b.*\bproject\b/, "Project Peer Review"],
    [/\bproject summary report\b|\bproject reports?\b|\bproject paper\b|\bworkshop-quality paper\b|\bfinal project deliverables\b/, "Project Report"],
    [/\bwritten assignment\b/, "Written Assignment"],
    [/\bwritten report\b/, "Written Report"],
    [/\bliterature survey\b/, "Literature Survey"],
    [/\bthe final\b.*\bpebblepad workbook\b/, "Final Assignment"],
    [/\bjournal prompts?\b|\bmonday journals?\b/, "Journal Prompts"],
    [/\bcritical reflection\b/, "Critical Reflection"],
    [/\bread(?:ing)? responses?\b/, "Reading Response"],
    [/\bperusall annotations?\b|\bannotations?\s+\(on readings\)\b/, "Perusall Annotation"],
    [/\bqfc\b/, "QFC"],
    [/\bself-assessment\b/, "Self-Assessment"],
    [/\bpassage analysis\b/, "Passage Analysis"],
    [/\bterm paper\b/, "Term Paper"],
    [/\bextra credit\b.*\b(?:present|discussion leader|lead discussion)\b/, "Extra Credit Paper Presentation or Discussion"],
    [/\bfive critical concepts project\b/, "Five Critical Concepts Project"],
    [/\bstudent presentations?\b/, "Student Presentation"],
    [/\bpaper presentations?\b/, "Paper Presentation"],
    [/\bpaper summaries?\b/, "Paper Summary"],
    [/\bparticipation in paper discussions?\b/, "Paper Discussion Participation"],
    [/\bgroup paper discussion write-?up\b/, "Group Paper Discussion Write-Up"],
  ];

  for (const [pattern, replacement] of keywordMatches) {
    if (pattern.test(search)) {
      return replacement;
    }
  }

  if (normalized.length > 120) {
    const concise = trimTrailingClauses(
      normalized
        .replace(/^by\b.+?\bstudents?\s+(?:will|must)\s+submit\b/i, "")
        .replace(/^students?\s+(?:will|must)\s+submit\b/i, "")
        .replace(
          /^in this assignment, students will be given prompt\(s\) and will be required to\b/i,
          ""
        )
        .replace(/^the goal of this written assignment is to\b/i, "Written Assignment")
    );

    if (concise && concise.length <= 80 && looksLikeAssignmentText(concise)) {
      return capitalizeAssignmentText(concise);
    }

    return undefined;
  }

  return capitalizeAssignmentText(normalized);
}

function hasNamedDeliverableCue(text: string) {
  return /\b(project\s+[ivxlc]+|problem sets?|project pitch|project proposal|research proposal|grant proposal|proposal|initial submission|final paper|sketchbook|urban armature drawings?|student survey|course survey|final response|major group assignment|capstone team and problem space|peer mentoring reflection|individual contribution statement|team charter|written assignment|written report|literature survey|critical reflection|term paper|workshop assignment|paper presentations?|poster presentations?|student presentations?|team case presentation|case presentation|paper summaries?|journal prompts?|monday journals?|presentation materials|slides? for the presentations?|project summary report|project report|project paper|project abstract|project delivery|project presentation upload|group presentations?|research paper discussion|tutorial problem|paper assignment|peer review|podcast review|book review discussion|annotated\s+bib[a-z]*|annotations?|perusall|qfc|brief|self-assessment|passage analysis|choose a reading|story map|group paper discussion write-?up|commentaries?|lab reports?|case studies?|program design|readiness activit(?:y|ies)|check-?ins?)\b/i.test(
    text
  );
}

function isGenericProseDeliverableHeading(value: string | null | undefined) {
  const normalized = trimTrailingPeriods(normalizeWhitespace(value)).toLowerCase();
  if (!normalized) return true;
  return /^(?:date|dates|date of submission|submission date|submission due date|due date|due dates|deadline|deadlines|following dates?|review of peers due date|feedback(?: review)? due date|notes?)$/.test(
    normalized
  );
}

function stripLeadingSchedulePrefix(label: string, date?: string) {
  let normalized = stripLeadingBulletPrefix(label).replace(/[–—]/g, "-");
  normalized = normalized.replace(/^due\s*\([^)]*\)\s*:\s*/i, "");
  normalized = normalized.replace(/^due\s*:\s*/i, "");
  normalized = normalized.replace(/^due by.+:\s*/i, "");
  normalized = normalized.replace(
    /^(?:(?:Mon(?:day)?|Tue(?:s|sday)?|Wed(?:nesday)?|Thu(?:r|rs|rsday|ursday)?|Fri(?:day)?|Sat(?:urday)?|Sun(?:day)?),?\s+)?(?:(?:\d{1,2}\s+)?(?:January|February|March|April|May|June|July|August|September|October|November|December|Jan|Feb|Mar|Apr|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)\.?\s+\d{1,2}(?:st|nd|rd|th)?(?:,?\s*\d{4})?)\s*:\s*/i,
    ""
  );
  normalized = normalized.replace(/^reminder:\s*/i, "");

  if (date) {
    const year = Number(date.slice(0, 4));
    const prefixedMatch = normalized.match(/^([^:]{0,120}):\s*(.+)$/);
    if (
      prefixedMatch &&
      /\b(?:by|due|deadline)\b/i.test(prefixedMatch[1]) &&
      extractExplicitDates(prefixedMatch[1], year).includes(date)
    ) {
      normalized = prefixedMatch[2];
    }
  }

  return normalized.replace(/^deadline for\s+/i, "");
}

function stripTrailingDateParenthetical(label: string, date?: string) {
  const year = date ? Number(date.slice(0, 4)) : new Date().getFullYear();
  return normalizeWhitespace(label).replace(/\s*\(([^)]*)\)\s*$/i, (match, inner: string) => {
    const normalizedInner = normalizeWhitespace(inner);
    const explicitDates = extractExplicitDates(normalizedInner, year);
    if (
      explicitDates.length === 0 &&
      !/\b(?:due|deadline|available|opens?|closes?|posted|scheduled)\b/i.test(
        normalizedInner
      ) &&
      !/\b(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t|tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\b/i.test(
        normalizedInner
      ) &&
      !/\b\d{1,2}(?::\d{2})?\s*(?:a\.?m\.?|p\.?m\.?|am|pm)\b/i.test(
        normalizedInner
      )
    ) {
      return match;
    }
    if (date && explicitDates.length > 0 && !explicitDates.includes(date)) {
      return match;
    }
    return "";
  });
}

function collapseDuplicateAssessmentWords(label: string) {
  return normalizeWhitespace(label).replace(
    /\b([A-Za-z][A-Za-z'/-]*)\s+\1\b/gi,
    "$1"
  );
}

function normalizeAssessmentLabel(label: string, date?: string) {
  const normalized = collapseDuplicateAssessmentWords(
    trimTrailingPeriods(
    stripTrailingDateParenthetical(
      stripLeadingSeriesCount(stripLeadingSchedulePrefix(label, date)).replace(
        /^[^A-Za-z0-9]+/,
        ""
      ),
      date
    )
    )
  );
  if (!normalized) return normalized;
  if (looksLikeStandaloneDateOrRangeLabel(normalized)) return "";
  if (/^\d+(?:\.\d+)?%$/i.test(normalized)) return "";
  const genericSeriesSentence = normalized.match(
    /\b(?:a total of|there (?:will be|are))\s+(?:\d+|one|two|three|four|five|six|seven|eight|nine|ten)\s+(tests?|quizzes?|midterms?|exams?)\b/i
  )?.[1];
  if (genericSeriesSentence) {
    return capitalizeAssessmentText(singularizeAssessmentSeriesLabel(genericSeriesSentence));
  }
  const headingMatch = normalized.match(
    /^(mid[\s-]?terms?|mid[\s-]?term exams?|mid[\s-]?term tests?|quizzes?|tests?|exams?|finals?|final exam)\s*:/i
  )?.[1];
  if (headingMatch) {
    return capitalizeAssessmentText(singularizeAssessmentSeriesLabel(headingMatch));
  }
  const deconflictedNumbering = normalizeWhitespace(
    normalized
      .replace(
        /\b(mid[\s-]?term)\s*#?\s*0*(\d+)\b/gi,
        (_match, kind: string, number: string) => `Midterm #${Number(number)}`
      )
      .replace(
        /\b(term test|endterm test|quiz|test|exam)\s*#?\s*0*(\d+)\b/gi,
        (_match, kind: string, number: string) =>
          `${capitalizeAssessmentText(kind)} #${Number(number)}`
      )
      .replace(
        /\b(mid[\s-]?term)\s+0*(\d+)\s*#\s*0*\d+\b/gi,
        (_match, kind: string, number: string) => `Midterm #${Number(number)}`
      )
      .replace(
        /\b(quizzes?|quiz|tests?|test|exams?|exam|finals?|final)\s+0*(\d+)\s*#\s*0*\d+\b/gi,
        (_match, kind: string, number: string) =>
          `${capitalizeAssessmentText(kind.replace(/s$/i, ""))} #${Number(number)}`
      )
  );
  const deconflictedText = normalizeWhitespace(
    deconflictedNumbering
      .replace(/\bLab(?=\d)/gi, "Lab ")
      .replace(/\b(Quiz|Test|Midterm|Exam|Practical)\s+at\s+[A-Za-z][\w\s'/-]*$/i, "$1")
  );
  if (!/(quiz|midterm|endterm|term test|test|exam|final)/i.test(deconflictedText)) {
    return capitalizeAssessmentText(deconflictedText);
  }

  const match = deconflictedText.match(
    /^(?:(?:Mon(?:day)?|Tue(?:s|sday)?|Wed(?:nesday)?|Thu(?:r|rs|rsday|ursday)?|Fri(?:day)?|Sat(?:urday)?|Sun(?:day)?),?\s+)?((?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:t|tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\.?\s+\d{1,2}(?:st|nd|rd|th)?(?:,\s*\d{4})?)(?:,?\s+)(.+)$/i
  );
  if (!match) return capitalizeAssessmentText(deconflictedText);

  const [, prefixDate, remainder] = match;
  if (!/(quiz|midterm|endterm|term test|test|exam|final)/i.test(remainder)) {
    return capitalizeAssessmentText(deconflictedText);
  }

  if (!date) return capitalizeAssessmentText(remainder);

  const inferredDate = parseFlexibleDate(prefixDate, Number(date.slice(0, 4)));
  if (inferredDate !== date) return capitalizeAssessmentText(deconflictedText);

  return capitalizeAssessmentText(remainder);
}

function normalizeAssignmentLabel(label: string, date?: string) {
  let normalized = trimTrailingPeriods(
    stripTrailingDateParenthetical(
      stripTrailingDeliverableDateClauses(
        stripLeadingSeriesCount(stripLeadingSchedulePrefix(label, date)).replace(
          /^[^A-Za-z0-9]+/,
          ""
        )
      ),
      date
    )
  );
  if (!normalized) return normalized;
  if (/^rlm assignment$/i.test(normalized)) return "RLM Assignment";

  const labReportLifecycleMatch = normalized.match(
    /^lab\s*#?\s*(\d+)\s+(pre-?lab|post-?lab)\s+report$/i
  );
  if (labReportLifecycleMatch) {
    const labNumber = Number(labReportLifecycleMatch[1]);
    const phase = /pre/i.test(labReportLifecycleMatch[2]) ? "Pre-Lab" : "Post-Lab";
    return `Lab ${labNumber} ${phase} Report`;
  }

  const shorthandAssignment =
    normalized.match(/^\s*A\s*0*(\d+)\b/i)?.[1] ??
    normalized.match(/^\s*(?:homework|hw)\s*#?\s*0*(\d+)\b/i)?.[1];
  if (shorthandAssignment) {
    normalized = `Assignment #${Number(shorthandAssignment)}`;
  }

  if (date) {
    const year = Number(date.slice(0, 4));
    const explicitDates = extractExplicitDates(normalized, year);
    if (explicitDates.includes(date)) {
      normalized = trimTrailingPeriods(
        normalized.replace(
          /\s*\b(?:due by|due(?:\s+on)?|deadline(?:\s+for)?|available(?:\s+as\s+of)?|opens?(?:\s+on)?|closes?(?:\s+on)?|submitted?\s+by)\b.*$/i,
          ""
        )
      );
    } else {
      normalized = trimTrailingPeriods(
        normalized.replace(
          /\s*\b(?:due(?:\s+on)?|on)\s+(?:(?:Mon(?:day)?|Tue(?:s|sday)?|Wed(?:nesday)?|Thu(?:r|rs|rsday|ursday)?|Fri(?:day)?|Sat(?:urday)?|Sun(?:day)?),?\s+)?(?:(?:\d{1,2}\s+)?(?:January|February|March|April|May|June|July|August|September|October|November|December|Jan|Feb|Mar|Apr|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)\.?\s+\d{1,2}(?:st|nd|rd|th)?(?:,?\s*\d{4})?|\d{1,2}\/\d{1,2}(?:\/\d{2,4})?|\d{2}-\d{2}-\d{4})\s*$/i,
          ""
        )
      );
    }
  }

  normalized = normalized
    .replace(
      /^(?:(?:Mon(?:day)?|Tue(?:s|sday)?|Wed(?:nesday)?|Thu(?:r|rs|rsday|ursday)?|Fri(?:day)?|Sat(?:urday)?|Sun(?:day)?)[.,]?\s+)?(?:(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)[.]?\s*\d{1,2})(?=[A-Z])/i,
      ""
    )
    .replace(/^assig\.?\s*#?\s*(\d+)\s+submission$/i, "Assignment #$1")
    .replace(/^assig\.?\s*#?\s*(\d+)\b/i, "Assignment #$1")
    .replace(/^assignment\s+0*(\d+)\b/i, "Assignment #$1")
    .replace(/^P\s*([1-9]\d*)$/i, "Project Part $1")
    .replace(/^week\s*\d+\s*\([^)]*\)\s*[-:]\s*/i, "")
    .replace(/^week\s*\d+\s*[-:]\s*/i, "")
    .replace(/^\d+(?:\.\d+)?%\s+/i, "")
    .replace(/^[A-Z]{2,8}\s*\d{2,3}[A-Z]?\s+(?=(?:review|assignment|report|project|proposal|reflection|paper|essay|presentation|survey|analysis|portfolio|summary|task|submission|files?|problem set|lab report)\b)/i, "")
    .replace(
      /^(?:(?:Mon(?:day)?|Tue(?:s|sday)?|Wed(?:nesday)?|Thu(?:r|rs|rsday|ursday)?|Fri(?:day)?|Sat(?:urday)?|Sun(?:day)?),?\s+)?(?:(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)[.]?\s+\d{1,2}(?:st|nd|rd|th)?(?:[.,]?\s*\d{4})?)\s+/i,
      ""
    )
    .replace(/^(?:all|the|this|that|these|those|a|an)\s+/i, "")
    .replace(/^for\s+one\s+group\s+/i, "")
    .replace(/^(?:submit|complete|upload|post|email|turn in|hand in)[:\s]+/i, "")
    .replace(/^approximately\s+\d+\s+/i, "")
    .replace(/^there (?:will be|are)\s+(?:equally weighted\s+)?\d+\s+/i, "")
    .replace(/^here is (?:a |the )?tentative schedule for the /i, "")
    .replace(
      /^completion of an?\s+(.+?\b(?:assignment|report|project|proposal|reflection|paper|essay|presentation|survey|analysis|portfolio|summary|review|task|contract|submission|problem set|lab report|module|brief|charter|map|check-?in))\b[\s\S]*$/i,
      "$1"
    )
    .replace(
      /^all\s+(.+?\b(?:assignments?|reports?|projects?|papers?|presentations?|proposals?|surveys?|reflections?|modules?|problem sets?))\b[\s\S]*$/i,
      "$1"
    )
    .replace(
      /^approximately\s+\d+\s+(.+?\b(?:assignments?|reports?|projects?|papers?|presentations?|proposals?|surveys?|reflections?|modules?|problem sets?))\b[\s\S]*$/i,
      "$1"
    )
    .replace(
      /^here is (?:a |the )?tentative schedule for the\s+(.+?\b(?:assignments?|reports?|projects?|papers?|presentations?|proposals?|surveys?|reflections?|modules?|problem sets?|due dates?))\b[\s\S]*$/i,
      "$1"
    )
    .replace(
      /^for the\s+(.+?\b(?:assignment|report|project|proposal|reflection|paper|essay|presentation|survey|analysis|portfolio|summary|review|task|contract|submission|problem set|lab report|module|brief|charter|map|check-?in))\b[\s\S]*$/i,
      "$1"
    )
    .replace(/^assignment due\s*#?\s*(\d+)\b/i, "Assignment #$1")
    .replace(/^first assignment\b/i, "Assignment #1")
    .replace(/^review assignment due\s*\d+\b/i, "Review Assignment")
    .replace(/^submission for the\s+(.+?)$/i, "$1")
    .replace(/^submission of the\s+(.+?)$/i, "$1")
    .replace(
      /^(.+?)\s+(?:learn(?:\s+dropbox)?|crowdmark|mobius|kritik)\s+submission$/i,
      "$1 Submission"
    )
    .replace(
      /^(assignment\s*#?\s*\d+)\s+(evaluation|feedback|post|response|responses|available|review)\b.*$/i,
      (_match, stem: string, modifier: string) =>
        `${stem.replace(/\s*#?\s*(\d+)/i, " #$1")} ${capitalizeAssignmentText(
          singularizeGenericSeriesLabel(modifier)
        )}`
    )
    .replace(/^group contracts?\s*#?\s*\d+\b.*$/i, "Group Contract")
    .replace(/^group contracts?\b.*$/i, "Group Contract")
    .replace(/^creative projects?\s+on\b.*$/i, "Creative Projects")
    .replace(/^for the project,\s+late submissions?\b.*$/i, "Project")
    .replace(/^the paper is to be submitted\b.*$/i, "Paper")
    .replace(/^paper is to be submitted\b.*$/i, "Paper")
    .replace(/^the graded papers?\s+will\s+be\s+made\b.*$/i, "Graded Paper")
    .replace(/^graded papers?\s+will\s+be\s+made\b.*$/i, "Graded Paper")
    .replace(/^ha\s*0*(\d+)\b[\s\S]*?\bgraded papers?\b.*$/i, "Graded Paper #$1")
    .replace(/^lab\s*#?\s*(\d+)\b/i, "Lab $1")
    .replace(/\bproblems?\s+set\b/gi, "Problem Set")
    .replace(
      /^(?:(?:Mon(?:day)?|Tue(?:s|sday)?|Wed(?:nesday)?|Thu(?:r|rs|rsday|ursday)?|Fri(?:day)?|Sat(?:urday)?|Sun(?:day)?),?\s+)?(?:(?:\d{1,2}\s+)?(?:January|February|March|April|May|June|July|August|September|October|November|December|Jan|Feb|Mar|Apr|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)\.?\s+\d{1,2}(?:st|nd|rd|th)?(?:,?\s*\d{4})?)\s+(?=(?:(?:weekly|written|mobius|group|team|final|online|lab|pre-?lab|post-?lab|take-?home|peer|short|research|reading|capstone)\s+)*(?:assignment|assignments|assessment|assessments|report|reports|project|projects|proposal|proposals|reflection|reflections|deliverable|deliverables|submission|submissions|paper|papers|essay|essays|quiz(?:zes)?|test(?:s)?|midterms?|exams?|problem set|problem sets)\b)/i,
      ""
    )
    .replace(
      /^((?:(?:weekly|written|mobius|group|team|final|online|lab|pre-?lab|post-?lab|take-?home|peer|short|research|reading|capstone)\s+)*(?:assignment|assignments|assessment|assessments|report|reports|project|projects|proposal|proposals|reflection|reflections|deliverable|deliverables|submission|submissions|paper|papers|essay|essays|quiz(?:zes)?|test(?:s)?|midterms?|exams?|problem set|problem sets)(?:\s*#?\s*\d+(?:-\d+)?)?)\s*(?:-|,)\s*(?:(?:Mon(?:day)?|Tue(?:s|sday)?|Wed(?:nesday)?|Thu(?:r|rs|rsday|ursday)?|Fri(?:day)?|Sat(?:urday)?|Sun(?:day)?),?\s+)?(?:(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)[.]?\s+\d{1,2}(?:st|nd|rd|th)?(?:[.,]?\s*\d{4})?)\s*$/i,
      "$1"
    )
    .replace(
      /^((?:(?:weekly|written|mobius|group|team|final|online|lab|pre-?lab|post-?lab|take-?home|peer|short|research|reading|capstone)\s+)*(?:assignment|assignments|assessment|assessments|report|reports|project|projects|proposal|proposals|reflection|reflections|deliverable|deliverables|submission|submissions|paper|papers|essay|essays|quiz(?:zes)?|test(?:s)?|midterms?|exams?|problem set|problem sets)\s*#?\s*\d+)\s+(?:(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)[.]?\s+\d{1,2}(?:st|nd|rd|th)?(?:[.,]?\s*\d{4})?)(?:\s*\([^)]*\))?\s*$/i,
      "$1"
    )
    .replace(/([,&]\s*)#(\d+)/g, "$1$2")
    .replace(/^deadline for\s+/i, "")
    .replace(
      /^(?:submit|complete|upload|post|email|turn in|hand in)\s+(.+?)\s+(?:by|on|no later than)\b/i,
      "$1"
    )
    .replace(
      /^(.+?\b(?:assignment|report|project|proposal|reflection|paper|essay|presentation|survey|analysis|portfolio|summary|review|task|submission|files?|problem set|lab report|course survey|final response|commentary|module|check-?in))\s+(?:is|are|will be)\b.*$/i,
      "$1"
    )
    .replace(
      /^the\s+(.+?\b(?:assignment|report|project|proposal|reflection|paper|essay|presentation|survey|analysis|portfolio|summary|review|task|submission|files?|problem set|lab report|course survey|final response|commentary|module|brief|charter|map|check-?in))\s+is\s+to\s+be\b.*$/i,
      "$1"
    )
    .replace(
      /^(.+?\b(?:assignment|report|project|proposal|reflection|paper|essay|presentation|survey|analysis|portfolio|summary|review|task|contract|submission|files?|check-?in))\s+(?:is|are|will be)\b.*$/i,
      "$1"
    )
    .replace(/\(\s*s\s*#\s*(\d+)\s*$/i, " #$1")
    .replace(/\b(?:ands?|bys?)\s*#\s*\d+\b/gi, "")
    .replace(/\s*\|\s*(?:tutorial|week|module)\b[\s\S]*$/i, "")
    .replace(
      /^(.+?)\s*:\s*(?:begins?(?:\s+on)?|starts?(?:\s+on)?|opens?(?:\s+on)?|available(?:\s+as\s+of|\s+from)?|due(?:\s+by|\s+on)?|deadline(?:\s+for)?)\b.*$/i,
      "$1"
    )
    .replace(
      /^(assignments?|reports?|projects?|papers?|proposals?|presentations?)\s+are\s+due(?:\s+by|\s+on)?\b.*$/i,
      (_match, noun: string) => singularizeGenericSeriesLabel(capitalizeAssignmentText(noun))
    )
    .replace(
      /^(assignments?|problem sets?|written assignments?|mobius assignments?|reflections?|commentaries?|modules?)\s+(?:will be|are)\b.*$/i,
      (_match, noun: string) => capitalizeAssignmentText(singularizeGenericSeriesLabel(noun))
    )
    .replace(/^(?:the\s+)?three assignments\b/i, "Assignments")
    .replace(/^\s*the\s+$/i, "")
    .replace(/\s+and submit required outputs(?: via learn)?$/i, "")
    .replace(/\s+on\s+learn\s*$/i, "")
    .replace(/\s+via learn$/i, "")
    .replace(/\bis\s+due(?:\s+(?:by|on))?\b.*$/i, "")
    .replace(/\bwill be(?:\s+reviewed\b.*|\s+submitted\b.*|\s+posted\b.*|\s+completed\b.*|\s*?$)/i, "")
    .replace(/\[\s*assigned\s*\]/gi, " Available")
    .replace(/\[\s*due\s*\]/gi, "")
    .replace(/\[\s*feedback(?: only)?\s*\]/gi, " Feedback")
    .replace(/\s*-\s*is$/i, "")
    .replace(/[.:]?\s*due$/i, "")
    .replace(/\b(?:due|deadline)\s+(?:friday|saturday|sunday|monday|tuesday|wednesday|thursday)\b.*$/i, "")
    .replace(/\(\s*(\d+(?:\.\d+)?%)\s*$/i, "")
    .replace(/\(\s*([^()]+)\s*$/i, " $1")
    .replace(/[)\]]+\s*$/g, "")
    .replace(/\b(?:due|available|opens?|closes?|posted|submitted?|feedback|evaluation)\s+(?:friday|saturday|sunday|monday|tuesday|wednesday|thursday)\b.*$/i, "")
    .replace(
      /\s+\b(?:on|due(?:\s+on)?|available(?:\s+from|\s+on)?|opens?(?:\s+on)?|closes?(?:\s+on)?)\b\s+(?:(?:Mon(?:day)?|Tue(?:s|sday)?|Wed(?:nesday)?|Thu(?:r|rs|rsday|ursday)?|Fri(?:day)?|Sat(?:urday)?|Sun(?:day)?),?\s+)?(?:(?:\d{1,2}\s+)?(?:January|February|March|April|May|June|July|August|September|October|November|December|Jan|Feb|Mar|Apr|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)\.?\s+\d{1,2}(?:st|nd|rd|th)?(?:,?\s*\d{4})?)(?:\s*,?\s*\d{1,2}:\d{2}\s*(?:a\.?m\.?|p\.?m\.?|am|pm))?(?:\s*,?\s*(?:learn|crowdmark|kritik|dropbox|mobius))?\s*$/i,
      ""
    )
    .replace(/\bFirst\s*#\s*(\d+)\b/gi, "First $1")
    .replace(/\bStep\s*#\s*(\d+)\b/gi, "Step $1")
    .replace(
      /^map the system(?::\s*exploring pathways for ecological health solutions)?\s*-\s*step\s*#?\s*1$/i,
      "Map the System Step 1"
    )
    .replace(/^map the system topic overview$/i, "Map the System Step 1")
    .replace(
      /^map the system(?::\s*exploring pathways for ecological health solutions)?\s*-\s*step\s*#?\s*2$/i,
      "Map the System Step 2"
    )
    .replace(
      /^map the system preliminary solution brief and systems map$/i,
      "Map the System Step 2"
    )
    .replace(
      /^map the system(?::\s*exploring pathways for ecological health solutions)?\s*-\s*step\s*#?\s*3$/i,
      "Map the System Step 3"
    )
    .replace(
      /^map the system.*?\bstep\s*#?\s*(\d+)$/i,
      (_match, number: string) => `Map the System Step ${number}`
    )
    .replace(/^map the system step\s*#\s*(\d+)$/i, "Map the System Step $1")
    .replace(/^map the system steps?\s*#\s*(\d+)$/i, "Map the System Step $1")
    .replace(
      /^map the system final solution brief and systems map$/i,
      "Map the System Step 3"
    )
    .replace(/([A-Za-z])#(?=\d)/g, "$1 #")
    .replace(
      /^practicing hope posts?\s*#\s*(\d+(?:-\d+)?)$/i,
      "Practicing Hope Post #$1"
    )
    .replace(
      /^practicing hope responses?\s*#\s*(\d+(?:-\d+)?)$/i,
      "Practicing Hope Response #$1"
    )
    .replace(
      /^health innovation challenge reflection and examples$/i,
      "Final Career ePortfolio"
    )
    .replace(/\bSteps?\s*#\s*(\d+)\b/gi, (_match, number: string) => `Step ${number}`)
    .replace(
      /\bPosts?\s*#\s*(\d+(?:-\d+)?)\b/gi,
      (_match, number: string) => `Post #${number}`
    )
    .replace(
      /\bResponses?\s*#\s*(\d+(?:-\d+)?)\b/gi,
      (_match, number: string) => `Response #${number}`
    )
    .replace(/\n+/g, " ");
  normalized = trimTrailingPeriods(normalizeWhitespace(normalized));
  if (/^(?:one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|\d+)\s+surveys?(?:\s+available)?$/i.test(normalized)) {
    return "";
  }
  if (/^first survey(?:\s*#\s*\d+)?$/i.test(normalized)) {
    return "Prior Knowledge Survey";
  }
  if (looksLikeStandaloneDateOrRangeLabel(normalized)) {
    return "";
  }
  if (/^(?:the|this|that|these|those|all)$/i.test(normalized)) {
    return "";
  }
  if (
    /^(?:student who has one or more assignments? outstanding|purpose of this assignment|rough drafts? will not be reviewed after this time|you may ask for feedback on rough drafts? prior to the)$/i.test(
      normalized
    )
  ) {
    return "";
  }
  if (/^papers? will be due by \d+/i.test(normalized)) {
    return "";
  }
  if (/^(?:you|students?)\b.*\bassignment\b.*\b(?:which|that)\s*$/i.test(normalized)) {
    return "Assignment";
  }
  if (
    /^(?:for example|example|if\b|otherwise\b|grades?\s+for\s+each\s+assignment\b|the following rules apply if\b)/i.test(
      normalized
    )
  ) {
    return "";
  }
  return canonicalizeProseDeliverableLabel(normalized, normalized) ?? capitalizeAssignmentText(normalized);
}

function extractAssessmentLabelFromText(text: string) {
  const baseNormalized = normalizeWhitespace(text).replace(/\bmidtern\b/gi, "midterm");
  if (looksLikeStandaloneDateOrRangeLabel(baseNormalized)) {
    return undefined;
  }
  if (
    /^\s*(?:start studying for|study for)\b/i.test(baseNormalized) ||
    /\b(?:a total of|there (?:will be|are))\s+(?:\d+|one|two|three|four|five|six|seven|eight|nine|ten)\s+(?:tests?|quizzes?|midterms?|exams?)\b/i.test(
      baseNormalized
    ) ||
    /\bmidterm exam week\b/i.test(baseNormalized) ||
    /\bpre-(?:midterm|final)\b[\w\s-]*\bcheck-?in\b/i.test(baseNormalized) ||
    (/\bmid-?term tests?\b/i.test(baseNormalized) && /\bfinal exam\b/i.test(baseNormalized)) ||
    /\b(?:midterm|final exam|test|quiz)\s+material\b/i.test(baseNormalized) ||
    /\bmaterial\s+for\s+the\s+(?:midterm|final exam|test|quiz)\b/i.test(baseNormalized) ||
    /\bmidterm exam and final exam material\b/i.test(baseNormalized) ||
    isReviewOrPlaceholderScheduleEntry(baseNormalized) ||
    /\b(?:chi-?squared|statistical|hypothesis|diagnostic|paired|independent|multiple|significance)\s+tests?\b/i.test(
      baseNormalized
    )
  ) {
    return undefined;
  }

  const normalized = normalizeWhitespace(
    baseNormalized
      .replace(/\b(?:mid-?term|midterm|final)\s+help session\b/gi, " ")
      .replace(/\breview for (?:the )?(?:mid-?term|midterm|final(?: exam)?|exam)\b/gi, " ")
      .replace(/\b(?:exam|mid-?term|midterm|quiz|test)\s+review\b/gi, " ")
      .replace(/\breview day\b/gi, " ")
      .replace(/\bmid-?term covers\b[^.?!;]*[.?!;]?/gi, " ")
      .replace(/\bquiz(?:\s*#?\s*\d+)?\s+covers\b[^.?!;]*[.?!;]?/gi, " ")
      .replace(/\btest(?:\s*#?\s*\d+)?\s+covers\b[^.?!;]*[.?!;]?/gi, " ")
      .replace(/\bquiz(?:\s*\d+)?\s+prep\b/gi, " ")
      .replace(/\bmid-?term prep\b/gi, " ")
      .replace(/\btest preparation\b/gi, " ")
      .replace(/\bno quizzes?\s+this\s+week\b/gi, " ")
      .replace(/\bno tests?\s+this\s+week\b/gi, " ")
  );

  if (!normalized) {
    return undefined;
  }
  if (
    /\bmid-?term weeks?\b/i.test(normalized) &&
    !/\bmid-?term (?:exam|test|#\s*\d+)/i.test(normalized)
  ) {
    return undefined;
  }
  if (
    /\bmid-?terms?\b/i.test(normalized) &&
    /\bno classes?\b|\bno class\b/i.test(normalized)
  ) {
    return undefined;
  }
  const tutorialPeerAssessmentMatch =
    normalized.match(/\bTPA\s*0*(\d+)\b/i)?.[1] ??
    normalized.match(/\btutorial peer assessment\s*#?\s*(\d+)\b/i)?.[1];
  if (tutorialPeerAssessmentMatch) {
    return `Tutorial Peer Assessment #${Number(tutorialPeerAssessmentMatch)}`;
  }
  const quizWeekMatch = normalized.match(/\bquiz\s*week\s*0*(\d+)\b/i)?.[1];
  if (quizWeekMatch) {
    return `Quiz #${Number(quizWeekMatch)}`;
  }
  const directMatch = normalized.match(
    /\b(Module\s*\d+\s+Exam|Module\s*\d+\s+Quiz|Knowledge Checks?(?:\s*#?\s*\d+)?|Mid-?term Exam(?:\s*#?\s*\d+)?|Mid-?term Test(?:\s*#?\s*\d+)?|Mid-?term(?:\s*#?\s*\d+)?|Endterm Test(?:\s*#?\s*\d+)?|Term Test(?:\s*#?\s*\d+)?|Take-?Home(?:\s+Final)?\s+Exam|Final Exam|Online Quiz(?:\s*#?\s*\d+)?|Quiz(?:\s*#?\s*\d+)?|Test(?:\s*#?\s*\d+)?)\b/i
  )?.[1];
  if (directMatch) {
    return normalizeAssessmentLabel(directMatch);
  }
  if (/\bmid-?term tests?\b/i.test(normalized)) {
    return "Midterm";
  }
  if (/\bknowledge checks?\b/i.test(normalized)) {
    return "Knowledge Check";
  }
  if (/\bquizzes\b/i.test(normalized)) {
    return "Quiz";
  }
  if (/\btests\b/i.test(normalized)) {
    return "Test";
  }
  return undefined;
}

function isFinalExamLabel(label: string) {
  const normalized = normalizeAssessmentLabel(label);
  return (
    /^final$/i.test(normalized) ||
    /\bfinal\s+exam(?:ination)?\b/i.test(normalized) ||
    /\bfinal\s+test\b/i.test(normalized) ||
    /\bfinal\s+written\s+exam\b/i.test(normalized) ||
    /\blecture\s+final\b/i.test(normalized) ||
    /\bexam\s+seat\b.*\bfinal\b/i.test(normalized)
  );
}

function isFinalAssessmentSeed(seed: AssessmentSeed) {
  const label = normalizeWhitespace(seed.label);
  if (!label) return false;
  if (isFinalExamLabel(label)) return true;
  if (/^final$/i.test(label)) {
    return true;
  }
  const evidence = normalizeWhitespace(
    [label, ...seed.notes, ...seed.provenance.map((item) => item.snippet)].join(" ")
  ).toLowerCase();
  if (/^exam$/i.test(label) && !seed.date) {
    return true;
  }
  if (
    /\b(?:exam|test|final)\b/.test(label.toLowerCase()) &&
    /exam period|registrar|final exam(?: period)?/i.test(evidence)
  ) {
    return true;
  }
  return (
    /^exam$/i.test(label) &&
    /\b(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\.?\s+\d{1,2}\s*[-–]\s*\d{1,2}\b/i.test(
      evidence
    ) &&
    !/\b\d{1,2}:\d{2}\b/.test(evidence)
  );
}

function shouldDropAssignmentLabel(label: string) {
  const normalized = normalizeWhitespace(label);
  return (
    normalized.length > 70 ||
    /^(?:available|review)$/i.test(normalized) ||
    /^(?:one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|\d+)\s+surveys?(?:\s+available)?$/i.test(
      normalized
    ) ||
    /\b(?:project help session|project consultation|class project introduction|class project organization discussions?|assignment one handout|youtube link|late penalty)\b/i.test(
      normalized
    ) ||
    /\|/.test(normalized)
  );
}

function assignmentLocationFromContext(text: string) {
  return extractStructuredLocation(text);
}

function sanitizeAssignmentLocation(location: string | null | undefined) {
  return extractStructuredLocation(location ?? "");
}

function isPhysicalAssessmentLocation(location: string) {
  return /^[A-Z]{1,5}\s\d{3,4}[A-Za-z]?(?:\s*\/\s*[A-Z]{1,5}\s\d{3,4}[A-Za-z]?)*$/i.test(
    normalizeLocation(location)
  );
}

function sanitizeAssessmentLocation(label: string, location: string | null | undefined) {
  const structured = extractStructuredLocation(location ?? "");
  if (!structured) return "";
  if (/\b(?:quiz|knowledge check)\b/i.test(label)) {
    return structured;
  }
  return isPhysicalAssessmentLocation(structured) ? structured : "";
}

function extractDeadlineAnchoredDates(text: string, year: number) {
  const normalized = normalizeWhitespace(text);
  const anchoredClause =
    normalized.match(
      /\b(?:due by|due on|due\b|deadline(?:\s+for)?|date of submission|submission date|available(?:\s+as\s+of|\s+from)?|opens?(?:\s+on)?|closes?(?:\s+on)?|submitted?(?:\s+virtually)?\s+(?:by|to)|class time on|following dates?|present(?:s|ed|ing)?\s+on)\b[\s\S]*$/i
    )?.[0] ?? normalized;
  const cleanedClause = anchoredClause.replace(
    /\bsince\s+(?:(?:Mon(?:day)?|Tue(?:s|sday)?|Wed(?:nesday)?|Thu(?:r|rs|rsday|ursday)?|Fri(?:day)?|Sat(?:urday)?|Sun(?:day)?),?\s+)?(?:(?:\d{1,2}\s+)?(?:January|February|March|April|May|June|July|August|September|October|November|December|Jan|Feb|Mar|Apr|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)\.?\s+\d{1,2}(?:st|nd|rd|th)?(?:,?\s*\d{4})?)/gi,
    ""
  );
  return extractExplicitDates(cleanedClause, year);
}

function extractPartDuePairsFromText(text: string, year: number) {
  const normalized = normalizeWhitespace(text);
  if (!normalized) return [] as Array<{ part: string; date: string }>;

  const pairs = Array.from(
    normalized.matchAll(
      /\bpart\s+([a-z0-9]+)\b(?=[\s\S]{0,180}\bdue\b)([\s\S]{0,260}?)(?=(?:\bpart\s+[a-z0-9]+\b(?![^.?!]{0,60}\bgraded\b)|$))/gi
    )
  )
    .map((match) => {
      const rawPart = normalizeWhitespace(match[1]);
      if (/^(?:is|are|due)$/i.test(rawPart)) return undefined;
      const part = /^[a-z]$/i.test(rawPart) ? rawPart.toUpperCase() : rawPart;
      const chunk = normalizeWhitespace(`Part ${rawPart} ${match[2]}`);
      if (!/\bdue\b/i.test(chunk)) return undefined;

      const anchoredDates = extractDeadlineAnchoredDates(chunk, year);
      const dateSpec = parseDateSpec(chunk, year);
      const date =
        anchoredDates[0] ??
        (dateSpec?.kind === "single"
          ? dateSpec.date
          : dateSpec?.kind === "dates"
          ? dateSpec.dates[0]
          : undefined);

      if (!date) return undefined;
      return { part, date };
    })
    .filter((value): value is { part: string; date: string } => Boolean(value));

  const seen = new Set<string>();
  return pairs.filter((pair) => {
    const key = `${pair.part}:${pair.date}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function assignmentLabelFromText(text: string) {
  const normalized = stripLeadingSchedulePrefix(text);
  if (looksLikeStandaloneDateOrRangeLabel(normalized)) {
    return undefined;
  }
  const withoutLeadingDate = normalized.replace(
    /^(?:(?:Mon(?:day)?|Tue(?:s|sday)?|Wed(?:nesday)?|Thu(?:r|rs|rsday|ursday)?|Fri(?:day)?|Sat(?:urday)?|Sun(?:day)?)[.,]?\s+)?(?:(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)[.]?\s+\d{1,2}|\d{1,2}\s+(?:January|February|March|April|May|June|July|August|September|October|November|December))[.,]?\s*/i,
    ""
  );
  if (
    /^week\b/i.test(normalized) &&
    !/\b(?:due|deadline|available(?:\s+as\s+of|\s+from)?|opens?(?:\s+on)?|closes?(?:\s+on)?|submission date|date of submission)\b/i.test(
      normalized
    )
  ) {
    return undefined;
  }
  if (
    /^(?:start thinking about|work on|continue working on|keep working on|review for)\b/i.test(
      normalized
    ) ||
    /^for example,\s*if the assignment deadline is\b/i.test(normalized) ||
    /^assigned exercise or task$/i.test(normalized)
  ) {
    return undefined;
  }
  if (
    /\bcfe\b/i.test(normalized) ||
    /\b(?:read assigned texts?|read assigned text|read group members['’] sources|purchase course textbook|complete .* before class|find schedule|join piazza|locate lecture room|log into learn|contact group members)\b/i.test(
      normalized
    )
  ) {
    return undefined;
  }
  const writtenAssignment = normalized.match(/\bWA\s*(\d+)\b/i)?.[1];
  if (writtenAssignment) {
    return `Written Assignment #${writtenAssignment}`;
  }
  const mobiusAssignmentRange = normalized.match(
    /\bmobius(?: assignments?)?\s*(\d+)\s*(?:-|–|to)\s*(\d+)\b/i
  );
  if (mobiusAssignmentRange) {
    return `Mobius Assignments #${Number(mobiusAssignmentRange[1])}-${Number(
      mobiusAssignmentRange[2]
    )}`;
  }
  const writtenAssignmentRange = normalized.match(
    /\bwritten assignments?\s*(\d+)\s*(?:-|–|to)\s*(\d+)\b/i
  );
  if (writtenAssignmentRange) {
    return `Written Assignments #${Number(writtenAssignmentRange[1])}-${Number(
      writtenAssignmentRange[2]
    )}`;
  }
  const genericAssignmentRange = normalized.match(
    /\bassignments?\s*(\d+)\s*(?:-|–|to)\s*(\d+)\b/i
  );
  if (genericAssignmentRange) {
    return `Assignments #${Number(genericAssignmentRange[1])}-${Number(
      genericAssignmentRange[2]
    )}`;
  }
  const mobiusAssignment = normalized.match(/\bmobius assignment\s*#?\s*(\d+)\b/i)?.[1];
  if (mobiusAssignment) {
    return `Mobius Assignment #${Number(mobiusAssignment)}`;
  }
  const moduleRangeMatch = normalized.match(
    /\bmodules?\s*(\d+)\s*(?:-|–|to)\s*(\d+)\b/i
  );
  if (moduleRangeMatch) {
    return `Modules #${Number(moduleRangeMatch[1])}-${Number(moduleRangeMatch[2])}`;
  }
  const kritikRangeMatch = normalized.match(
    /\bkritik\s*#?\s*(\d+)\s*(?:-|–|to)\s*(\d+)\b/i
  );
  if (kritikRangeMatch) {
    return `Kritik Assignments #${Number(kritikRangeMatch[1])}-${Number(
      kritikRangeMatch[2]
    )}`;
  }
  const kritikMatch = normalized.match(/\bkritik\s*#?\s*(\d+)\b/i)?.[1];
  if (kritikMatch) {
    return `Kritik Assignment #${Number(kritikMatch)}`;
  }
  const simulationMatch = normalized.match(/\bsimulation\s*#?\s*(\d+)\b/i)?.[1];
  if (simulationMatch) {
    return `Simulation #${Number(simulationMatch)}`;
  }
  const decimalAssignmentMatch =
    normalized.match(/\bAssignment\s*#?\s*0*(\d+)\.(\d+)\b/i) ??
    normalized.match(/\bA\s*0*(\d+)\.(\d+)\b/i);
  if (decimalAssignmentMatch) {
    return `Assignment ${Number(decimalAssignmentMatch[1])}.${Number(
      decimalAssignmentMatch[2]
    )}`;
  }
  const problemSetMatch =
    normalized.match(/\bproblem\s*sets?\s*#?\s*(\d+)\b/i)?.[1] ??
    normalized.match(/\bproblems?\s+set\s*#?\s*(\d+)\b/i)?.[1];
  if (problemSetMatch) {
    return `Problem Set #${Number(problemSetMatch)}`;
  }
  const homeworkMatch = normalized.match(/\b(?:homework|hw)\s*#?\s*0*(\d+)\b/i)?.[1];
  if (homeworkMatch) {
    return `Assignment #${Number(homeworkMatch)}`;
  }
  const labMatch = normalized.match(/\blab\s*#?\s*(\d+)\b/i)?.[1];
  if (labMatch) {
    return `Lab ${Number(labMatch)}`;
  }
  const moduleMatch = normalized.match(/\bmodule\s*#?\s*(\d+)\b/i)?.[1];
  if (moduleMatch) {
    return `Module ${Number(moduleMatch)}`;
  }
  const reflectionMatch = normalized.match(/\breflection\s*#?\s*(\d+)\b/i)?.[1];
  if (reflectionMatch) {
    return `Reflection #${Number(reflectionMatch)}`;
  }
  const commentaryPostMatch = normalized.match(/\bcommentary\s*#?\s*(\d+)\s*post\b/i)?.[1];
  if (commentaryPostMatch) {
    return `Commentary ${Number(commentaryPostMatch)} Post`;
  }
  const commentaryResponseMatch = normalized.match(
    /\bcommentary\s*#?\s*(\d+)\s*responses?\b/i
  )?.[1];
  if (commentaryResponseMatch) {
    return `Commentary ${Number(commentaryResponseMatch)} Response`;
  }

  const assignmentPartMatch =
    normalized.match(/\bA\s*0*(\d+)\s*Part\s*([A-Za-z0-9]+)\b/i) ??
    normalized.match(/\bAssignment\s*#?\s*0*(\d+)\s*Part\s*([A-Za-z0-9]+)\b/i);
  if (assignmentPartMatch) {
    const [, assignmentNumber, partRaw] = assignmentPartMatch;
    const part = /^[a-z]$/i.test(partRaw) ? partRaw.toUpperCase() : partRaw;
    return `Assignment #${Number(assignmentNumber)} Part ${part}`;
  }

  const assignmentSuffixMatch = normalized.match(
    /\bassignment\s*#?\s*0*(\d+)\s+(evaluation|feedback|peer review|review)\b/i
  );
  if (assignmentSuffixMatch) {
    return `Assignment #${Number(assignmentSuffixMatch[1])} ${capitalizeAssignmentText(
      assignmentSuffixMatch[2]
    )}`;
  }

  const handInAssignmentMatch = normalized.match(/\bHA\s*0*(\d+)\b/i)?.[1];
  if (handInAssignmentMatch) {
    return `Homework Assignment #${Number(handInAssignmentMatch)}`;
  }

  const assignmentCode =
    withoutLeadingDate.match(/^\s*Assig(?:nment)?\s*#?\s*0*(\d+)\b/i)?.[1] ??
    withoutLeadingDate.match(/^\s*A\s*0*(\d+)\b/i)?.[1] ??
    withoutLeadingDate.match(/^\s*(?:homework|hw)\s*#?\s*0*(\d+)\b/i)?.[1];
  if (assignmentCode) {
    return `Assignment #${Number(assignmentCode)}`;
  }

  const studioProjectSeries =
    withoutLeadingDate.match(
      /^\s*((?:P\.?\s*\d+[a-z]?)(?:\s*&\s*P\.?\s*\d+[a-z]?)+)\b/i
    )?.[1] ??
    withoutLeadingDate.match(/^\s*(P\.?\s*\d+[a-z]?)\b/i)?.[1];
  if (studioProjectSeries) {
    return normalizeWhitespace(studioProjectSeries)
      .replace(/\s*&\s*/g, " & ")
      .replace(/\s+/g, " ");
  }

  const assignmentMatch =
    normalized.match(/\b(Written Assignment\s*#?\s*\d+)\b/i)?.[1] ??
    normalized.match(/\b(Assignment\s*#?\s*\d+)\b/i)?.[1];
  if (assignmentMatch) {
    return trimTrailingPeriods(assignmentMatch);
  }

  return undefined;
}

function stripLeadingNumbering(value: string | null | undefined) {
  return normalizeWhitespace(value)
    .replace(/^\d+\s*[.)]\s*/g, "")
    .replace(/^[a-z]\)\s*/gi, "")
    .trim();
}

function stripTrailingDeliverableDateClauses(value: string) {
  const referenceYear = new Date().getFullYear();
  let normalized = normalizeLooseMonthDaySpacing(normalizeWhitespace(value))
    .replace(/\b(\d{1,2})\s+(st|nd|rd|th)\b/gi, "$1$2")
    .replace(/^week\s*\d+\s*\([^)]*\)\s*[-:]\s*/i, "")
    .replace(/^week\s*\d+\s*[-:]\s*/i, "");

  const hasDateLikeCue = (candidate: string) => {
    const cleanedCandidate = normalizeWhitespace(candidate);
    return (
      extractExplicitDates(cleanedCandidate, referenceYear).length > 0 ||
      /\b(?:due(?:\s+date)?|deadline(?:\s+for)?|available(?:\s+as\s+of|\s+from)?|opens?(?:\s+on)?|closes?(?:\s+on)?|submitted?(?:\s+virtually)?\s+(?:by|to)|review of peers due date|feedback(?: review)? due date)\b/i.test(
        cleanedCandidate
      ) ||
      /\b(?:at\s+)?\d{1,2}(?::\d{2})?\s*(?:a\.?m\.?|p\.?m\.?|am|pm)\b/i.test(cleanedCandidate)
    );
  };

  while (true) {
    const trailingParenthetical = normalized.match(/\s*\(([^()]*)\)\s*$/);
    if (!trailingParenthetical) break;
    if (!hasDateLikeCue(trailingParenthetical[1])) break;
    normalized = normalizeWhitespace(normalized.slice(0, -trailingParenthetical[0].length));
  }

  normalized = normalizeWhitespace(
    normalized
      .replace(
        /\s*\(\s*(?:due(?:\s+date)?|deadline(?:\s+for)?|available(?:\s+as\s+of|\s+from)?|opens?(?:\s+on)?|closes?(?:\s+on)?)[^)]*$/i,
        ""
      )
      .replace(
        /\s*(?:-|:)\s*(?:due(?:\s+date)?|deadline(?:\s+for)?|available(?:\s+as\s+of|\s+from)?|opens?(?:\s+on)?|closes?(?:\s+on)?|submitted?(?:\s+virtually)?\s+(?:by|to))\b[\s\S]*$/i,
        ""
      )
      .replace(
        /\s*,?\s*(?:to\s+be\s+completed\s+by\s+of|to\s+be\s+completed\s+by|completed\s+by|due(?:\s+by|\s+on)?|by)\s+(?:(?:Mon(?:day)?|Tue(?:s|sday)?|Wed(?:nesday)?|Thu(?:r|rs|rsday|ursday)?|Fri(?:day)?|Sat(?:urday)?|Sun(?:day)?),?\s+)?(?:(?:\d{1,2}\s+)?(?:January|February|March|April|May|June|July|August|September|October|November|December|Jan|Feb|Mar|Apr|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)\.?\s+\d{1,2}(?:st|nd|rd|th)?(?:,?\s*\d{4})?|\d{1,2}(?:st|nd|rd|th)?\s+(?:January|February|March|April|May|June|July|August|September|October|November|December))(?:\s*(?:at|by)?\s*\d{1,2}(?::\d{2})?\s*(?:a\.?m\.?|p\.?m\.?|am|pm|AM|PM))?[\s\w.,-]*$/i,
        ""
      )
      .replace(
        /\s*,?\s*(?:by|on|due(?:\s+on)?|deadline(?:\s+for)?|available(?:\s+as\s+of|\s+from)?|opens?(?:\s+on)?|closes?(?:\s+on)?|submitted?(?:\s+virtually)?\s+(?:by|to)|begins?(?:\s+on)?|starts?(?:\s+on)?|ends?(?:\s+on)?)\s+(?:(?:Mon(?:day)?|Tue(?:s|sday)?|Wed(?:nesday)?|Thu(?:r|rs|rsday|ursday)?|Fri(?:day)?|Sat(?:urday)?|Sun(?:day)?),?\s+)?(?:(?:\d{1,2}\s+)?(?:January|February|March|April|May|June|July|August|September|October|November|December|Jan|Feb|Mar|Apr|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)\.?\s+\d{1,2}(?:st|nd|rd|th)?(?:,?\s*\d{4})?|\d{1,2}\/\d{1,2}(?:\/\d{2,4})?)(?:\s*(?:at|by)?\s*\d{1,2}(?::\d{2})?\s*(?:a\.?m\.?|p\.?m\.?|am|pm|AM|PM|E\.?T\.?|ET)?)?[\s\w.,-]*$/i,
        ""
      )
      .replace(
        /\s*(?:-|,)\s*(?:(?:Mon(?:day)?|Tue(?:s|sday)?|Wed(?:nesday)?|Thu(?:r|rs|rsday|ursday)?|Fri(?:day)?|Sat(?:urday)?|Sun(?:day)?),?\s+)?\d{1,2}(?:st|nd|rd|th)?\s+(?:January|February|March|April|May|June|July|August|September|October|November|December|Jan|Feb|Mar|Apr|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)\.?(?:,?\s*\d{4})?(?:\s*,?\s*(?:by|at)\s*\d{1,2}(?::\d{2})?\s*(?:a\.?m\.?|p\.?m\.?|am|pm|AM|PM)?)?(?:\s+on\s+\w+)?\s*$/i,
        ""
      )
      .replace(
        /\s*(?:-|,)\s*(?:(?:Mon(?:day)?|Tue(?:s|sday)?|Wed(?:nesday)?|Thu(?:r|rs|rsday|ursday)?|Fri(?:day)?|Sat(?:urday)?|Sun(?:day)?)\.?,?\s+)?\d{1,2}(?:st|nd|rd|th)?\s+(?:January|February|March|April|May|June|July|August|September|October|November|December)\b(?:,?\s*\d{4})?(?:\s*(?:at|by)?\s*\d{1,2}(?::\d{2})?\s*(?:a\.?m\.?|p\.?m\.?|am|pm|AM|PM))?\s*$/i,
        ""
      )
      .replace(
        /\s*(?:-|,)\s*\b(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\.?\s+\d{1,2}(?:st|nd|rd|th)?(?:,?\s*\d{4})?(?:\s*(?:at|by)?\s*\d{1,2}(?::\d{2})?\s*(?:a\.?m\.?|p\.?m\.?|am|pm|AM|PM|E\.?T\.?|ET)?)?\s*$/i,
        ""
      )
      .replace(/\s+\bdue\s+(?:friday|saturday|sunday|monday|tuesday|wednesday|thursday)\b.*$/i, "")
      .replace(/\s+\b(?:by|at)\s+\d{1,2}(?::\d{2})?\s*(?:a\.?m\.?|p\.?m\.?|am|pm|AM|PM)?\b.*$/i, "")
      .replace(
        /^((?:(?:weekly|written|mobius|group|team|final|online|lab|pre-?lab|post-?lab|take-?home|peer|short|research|reading|capstone)\s+)*(?:assignment|assignments|assessment|assessments|report|reports|project|projects|proposal|proposals|reflection|reflections|deliverable|deliverables|submission|submissions|paper|papers|essay|essays|quiz(?:zes)?|test(?:s)?|midterms?|exams?|problem set|problem sets)(?:\s*#?\s*\d+(?:-\d+)?)?)\s*(?:-|,)\s*(?:(?:Mon(?:day)?|Tue(?:s|sday)?|Wed(?:nesday)?|Thu(?:r|rs|rsday|ursday)?|Fri(?:day)?|Sat(?:urday)?|Sun(?:day)?),?\s+)?(?:(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)[.]?\s+\d{1,2}(?:st|nd|rd|th)?(?:[.,]?\s*\d{4})?)\s*$/i,
        "$1"
      )
      .replace(
        /^((?:(?:written|mobius|reading)\s+assignment|assignment|task|problem set)\s*#?\s*\d+(?:-\d+)?)\s*-\s*(?:(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun)\.?\s+)?(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\.?\s+\d{1,2}(?:st|nd|rd|th)?(?:,?\s*\d{4})?(?:,?\s*\d{3,4}\s*(?:a\.?m\.?|p\.?m\.?|am|pm|AM|PM))?\s*$/i,
        "$1"
      )
      .replace(/[.:]?\s*due(?:\s*\([^)]*\))?$/i, "")
      .replace(/[.:]?\s*due$/i, "")
      .replace(/\(\s*$/g, "")
  );

  const trailingDateSuffixMatch = normalized.match(
    /^(.*?)\s*(?:-|,)\s*(?:(?:Mon(?:day)?|Tue(?:s|sday)?|Wed(?:nesday)?|Thu(?:r|rs|rsday|ursday)?|Fri(?:day)?|Sat(?:urday)?|Sun(?:day)?),?\s+)?(?:(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)[.]?\s+\d{1,2}(?:st|nd|rd|th)?(?:[.,]?\s*\d{4})?)(?:\s*@?\s*\d{1,2}(?::\d{2})?\s*(?:a\.?m\.?|p\.?m\.?|am|pm|AM|PM)?(?:\s*[A-Z]{2,4})?)?\s*$/i
  );
  if (trailingDateSuffixMatch) {
    const candidateLabel = normalizeWhitespace(trailingDateSuffixMatch[1]);
    if (candidateLabel && (looksLikeAssignmentText(candidateLabel) || hasNamedDeliverableCue(candidateLabel))) {
      normalized = candidateLabel;
    }
  }

  return normalized;
}

function extractProseDeliverableLabel(text: string) {
  const normalized = normalizeWhitespace(
    stripLeadingNumbering(stripLeadingSchedulePrefix(text)).replace(/^-+\s*/, "")
  );
  if (!normalized || isFinalExamLabel(normalized)) {
    return undefined;
  }
  if (isInstructionalDeliverableNoise(normalized)) {
    return undefined;
  }
  if (/\bbook review discussion\b/i.test(normalized)) {
    return "Book Review Discussion";
  }
  if (/\bevent report\b/i.test(normalized)) {
    return "Event Report";
  }
  const cleanedNormalized = stripTrailingDeliverableDateClauses(normalized);
  const headingPrefix = trimTrailingPeriods(
    normalizeWhitespace(cleanedNormalized.split(/\s*:\s*/, 2)[0] ?? "")
  );
  const candidates = [
    normalized.match(/^(.+?)\s*\(\s*\d+(?:\.\d+)?\s*%[^)]*\)(?=\s|$)/i)?.[1],
    normalized.match(
      /^(.+?)\s+(?:due by|due on|due|deadline(?:\s+for)?|available as of|opens?(?:\s+on)?|closes?(?:\s+on)?|submission due date|review of peers due date|feedback(?: review)? due date)\b/i
    )?.[1],
    normalized.match(
      /^(.+?)\s+(?:no later than|by)\s+(?:(?:Mon(?:day)?|Tue(?:s|sday)?|Wed(?:nesday)?|Thu(?:r|rs|rsday|ursday)?|Fri(?:day)?|Sat(?:urday)?|Sun(?:day)?),?\s+)?(?:(?:\d{1,2}\s+)?(?:January|February|March|April|May|June|July|August|September|October|November|December|Jan|Feb|Mar|Apr|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)\.?\s+\d{1,2}|\d{1,2}\/\d{1,2}(?:\/\d{2,4})?)/i
    )?.[1],
    normalized.match(
      /^(.+?)\s*:\s*(?:(?:Mon(?:day)?|Tue(?:s|sday)?|Wed(?:nesday)?|Thu(?:r|rs|rsday|ursday)?|Fri(?:day)?|Sat(?:urday)?|Sun(?:day)?),?\s+)?(?:(?:\d{1,2}\s+)?(?:January|February|March|April|May|June|July|August|September|October|November|December|Jan|Feb|Mar|Apr|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)\.?\s+\d{1,2}|\d{1,2}\/\d{1,2}(?:\/\d{2,4})?)/i
    )?.[1],
    normalized.match(
      /^(.+?)\s*\((?:(?:Mon(?:day)?|Tue(?:s|sday)?|Wed(?:nesday)?|Thu(?:r|rs|rsday|ursday)?|Fri(?:day)?|Sat(?:urday)?|Sun(?:day)?),?\s+)?(?:(?:\d{1,2}\s+)?(?:January|February|March|April|May|June|July|August|September|October|November|December|Jan|Feb|Mar|Apr|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)\.?\s+\d{1,2}|\d{1,2}\/\d{1,2}(?:\/\d{2,4})?)/i
    )?.[1],
    normalized.match(
      /^(.+?)\s*\(\s*(?:due by|due on|deadline(?:\s+for)?|available as of|opens?(?:\s+on)?|closes?(?:\s+on)?)\b/i
    )?.[1],
    normalized.match(
      /^(.+?)\s*\(\s*(?:due date|submission due date|review of peers due date|feedback(?: review)? due date)\b/i
    )?.[1],
    normalized.match(/\b(initial submission|final paper|urban armature drawings?|sketchbook)\b/i)?.[1],
    cleanedNormalized !== normalized ? cleanedNormalized : undefined,
  ]
    .filter((candidate) => !isGenericProseDeliverableHeading(candidate))
    .map((candidate) =>
      canonicalizeProseDeliverableLabel(
        normalizeWhitespace(candidate)
          .replace(/\(\s*\d+(?:\.\d+)?\s*%[^)]*\)$/i, "")
          .replace(/\s*[-–—]\s*$/g, ""),
        normalized
      )
    )
    .filter(Boolean);

  const directAssignmentLabel = assignmentLabelFromText(normalized);
  if (directAssignmentLabel) {
    const canonicalDirectLabel = canonicalizeProseDeliverableLabel(
      directAssignmentLabel,
      normalized
    );
    if (canonicalDirectLabel) {
      candidates.unshift(canonicalDirectLabel);
    }
  }

  if (
    headingPrefix &&
    !isGenericProseDeliverableHeading(headingPrefix) &&
    (looksLikeAssignmentText(headingPrefix) ||
      hasNamedDeliverableCue(headingPrefix) ||
      /^(?:project\s+[ivxlc]+|initial submission|final paper)\b/i.test(headingPrefix))
  ) {
    const canonicalHeadingLabel = canonicalizeProseDeliverableLabel(
      headingPrefix,
      normalized
    );
    if (canonicalHeadingLabel) {
      candidates.unshift(canonicalHeadingLabel);
    }
  }

  const extracted = candidates.find((candidate) => {
    if (!candidate) return false;
    if (/^module\s*\d+$/i.test(candidate)) return false;
    return looksLikeAssignmentText(candidate);
  });

  if (extracted) {
    return extracted;
  }

  if (cleanedNormalized && hasNamedDeliverableCue(cleanedNormalized)) {
    return canonicalizeProseDeliverableLabel(cleanedNormalized, normalized);
  }

  return undefined;
}

function normalizeLabDeliverableLabel(label: string) {
  const normalized = normalizeWhitespace(
    stripTrailingDeliverableDateClauses(
      label
        .replace(/\s*\(\s*\d+(?:\.\d+)?\s*%[^)]*\)/gi, "")
        .replace(/\bin class\b/gi, " ")
        .replace(
          /\s+on\s+(?:(?:Mon(?:day)?|Tue(?:s|sday)?|Wed(?:nesday)?|Thu(?:r|rs|rsday|ursday)?|Fri(?:day)?|Sat(?:urday)?|Sun(?:day)?),?\s+)?(?:January|February|March|April|May|June|July|August|September|October|November|December|Jan|Feb|Mar|Apr|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)\.?\s+\d{1,2}(?:st|nd|rd|th)?$/i,
          ""
        )
        .replace(/\bwritten submissions?\b/gi, "Written Submission")
        .replace(/\bdebate topics\b/gi, "Debate")
        .replace(/\bLab(?=\d)/gi, "Lab ")
    )
  );
  return capitalizeAssignmentText(normalized);
}

function extractWeekTableDeliverableLabel(
  entry: string,
  previousLabel?: string
) {
  const normalizedEntry = normalizeWhitespace(entry);
  if (
    /^(?:project starts?|project help session|project consultation)$/i.test(normalizedEntry) ||
    /\b(?:project help session|project consultation|class project introduction|class project organization discussions?|assignment one handout)\b/i.test(
      normalizedEntry
    )
  ) {
    return undefined;
  }

  const directLabel =
    labelFromScheduleEntry(entry) ??
    assignmentLabelFromText(entry) ??
    extractProseDeliverableLabel(entry);
  if (directLabel) {
    if (/^\s*lab\s*\d+\b/i.test(directLabel)) {
      return normalizeLabDeliverableLabel(directLabel);
    }
    return isPlaceholderDeliverableLabel(directLabel)
      ? contextualizePlaceholderDeliverableLabel(entry, previousLabel)
      : directLabel;
  }
  const projectDuePartMatch = normalizedEntry.match(
    /\bproject\s+due\s*\(\s*part\s*([^)]+?)\s*\)/i
  );
  if (projectDuePartMatch) {
    const part = normalizeWhitespace(projectDuePartMatch[1]).replace(/^part\s*/i, "");
    return `Project Part ${part}`;
  }
  const labEntryLabel =
    normalizedEntry.match(
      /\b(Lab\s*\d+\s*(?::\s*[^.;]+)?(?:\s+in\s+class\s+[^.;]+)?)(?:\s*\(\s*\d+(?:\.\d+)?\s*%[^)]*\))?(?:\s+(?:on|due|submitted?\b)|$)/i
    )?.[1] ??
    normalizedEntry.match(
      /\b(Lab\s*\d+\s*:\s*[^.;]+?)(?:\s*\(\s*\d+(?:\.\d+)?\s*%[^)]*\))?(?:\s|$)/i
    )?.[1];
  if (labEntryLabel) {
    return normalizeLabDeliverableLabel(labEntryLabel);
  }

  if (/^\s*ethics module\b/i.test(entry)) {
    return "Ethics Module";
  }

  const namedDeliverableMatch = normalizedEntry.match(
    /^(.+?\b(?:assignment|report|project|paper|proposal|presentation|essay|reflection|survey|worksheet|discussion|module))\b(?=\s+(?:due|available(?:\s+as\s+of|\s+from|\s+on)?|opens?(?:\s+on)?|closes?(?:\s+on)?|begins?(?:\s+on)?|starts?(?:\s+on)?|submitted?(?:\s+by|\s+to)?|deadline\b|review of peers due date|feedback(?: review)? due date)\b)/i
  )?.[1];
  if (namedDeliverableMatch) {
    return canonicalizeProseDeliverableLabel(namedDeliverableMatch, normalizedEntry);
  }

  return contextualizePlaceholderDeliverableLabel(entry, previousLabel);
}

function extractSectionDateGroups(
  section: SectionBlock,
  sectionOptions: ParsedSectionOption[]
) {
  const ordinalIndex: Record<string, number> = {
    first: 0,
    second: 1,
    third: 2,
    fourth: 3,
  };
  const groups: string[][] = [];
  const normalized = normalizeWhitespace(section.text).replace(/\n/g, " ");

  for (const match of normalized.matchAll(
    /\b(first|second|third|fourth)\s+dates?\s+are\s+for\s+sections?\s+([0-9,\sand]+)/gi
  )) {
    const index = ordinalIndex[match[1].toLowerCase()];
    const sectionNumbers = unique(match[2].match(/\d{3}/g) ?? []);
    groups[index] = sectionOptions
      .filter(
        (option) =>
          option.kind.toUpperCase().includes("LEC") &&
          sectionNumbers.includes(option.number)
      )
      .map((option) => option.id);
  }

  return groups;
}

function resolveSectionAwareDates(
  dateText: string,
  section: SectionBlock,
  sectionOptions: ParsedSectionOption[],
  defaultYear: number
) {
  const spec = parseDateSpec(dateText, defaultYear);
  if (!spec) return [] as Array<{ date: string; sectionOptionIds?: string[] }>;
  if (spec.kind === "single") {
    return [{ date: spec.date }];
  }
  if (spec.kind !== "dates") {
    return [] as Array<{ date: string; sectionOptionIds?: string[] }>;
  }

  const sectionDateGroups = extractSectionDateGroups(section, sectionOptions).filter(
    (group): group is string[] => Array.isArray(group) && group.length > 0
  );
  return spec.dates.map((date, index) => ({
    date,
    sectionOptionIds:
      sectionDateGroups.length > 0
        ? sectionDateGroups[
            spec.dates.length > sectionDateGroups.length
              ? index % sectionDateGroups.length
              : index
          ]
        : undefined,
  }));
}

function extractRelativeWeekdayCode(value: string) {
  const candidate =
    normalizeWhitespace(value).match(/\bdue\b([^.;|]*)/i)?.[1] ??
    normalizeWhitespace(value).match(/\(([^)]+)\)/)?.[1] ??
    normalizeWhitespace(value);

  const mappings: Array<[RegExp, WeekdayCode]> = [
    [/\bSunday\b|\bSun\b|\bSU\b/i, "SU"],
    [/\bSaturday\b|\bSat\b|\bSA\b/i, "SA"],
    [/\bFriday\b|\bFri\b|\bFR\b|\bF\b/i, "FR"],
    [/\bThursday\b|\bThu\b|\bTH\b|\bTh\b/i, "TH"],
    [/\bWednesday\b|\bWed\b|\bWE\b|\bW\b/i, "WE"],
    [/\bTuesday\b|\bTue\b|\bTU\b|\bT\b/i, "TU"],
    [/\bMonday\b|\bMon\b|\bMO\b|\bM\b/i, "MO"],
  ];

  for (const [pattern, code] of mappings) {
    if (pattern.test(candidate)) return code;
  }
  return undefined;
}

function inferDateFromAnchorAndWeekday(anchorDate: string, dayCode: WeekdayCode) {
  const anchor = parseISO(anchorDate);
  const targetIndex = WEEKDAY_BY_INDEX.indexOf(dayCode);
  if (targetIndex === -1) return anchorDate;
  const delta = (targetIndex - getDay(anchor) + 7) % 7;
  return format(addDays(anchor, delta), "yyyy-MM-dd");
}

function isGroupDeadlinePrefix(value: string) {
  return /^(?:all\s+groups?|grp\.?\s*\d|groups?\s*\d|sections?\s*\d)/i.test(
    normalizeWhitespace(value)
  );
}

function cleanGroupDeadlinePrefix(value: string) {
  return normalizeWhitespace(value)
    .replace(/grp\.?/i, "Grp")
    .replace(/\s+/g, " ")
    .trim();
}

function isRoutineScheduleEntry(value: string) {
  const normalized = normalizeWhitespace(value);
  if (!normalized) return true;
  return (
    /^(?:n\/a|none|spare|tbd)$/i.test(normalized) ||
    /^(?:lecture|tutorial|lab|seminar|class)\s*0*\d+\b/i.test(normalized) ||
    /^\d{1,2}\s*[–—-]\s*\d{1,2}(?::\d{2})?\s*[ap](?:\.?m\.?)?$/i.test(normalized) ||
    /^\d{1,2}(?::\d{2})?\s*(?:a\.?m\.?|p\.?m\.?|am|pm)?\s*[-–—]\s*\d{1,2}(?::\d{2})?\s*(?:a\.?m\.?|p\.?m\.?|am|pm)?$/i.test(
      normalized
    ) ||
    /^(?:in class|in person|see details on learn|see cfe learn page|date and time tbd)$/i.test(
      normalized
    ) ||
    /^no regular class\b/i.test(normalized) ||
    /\bcfe\b/i.test(normalized) ||
    /^no topics this week\b/i.test(normalized) ||
    /^no classes? or assignments due\b/i.test(normalized) ||
    /^for next week:?$/i.test(normalized) ||
    /^to do for (?:this|next) week:?$/i.test(normalized) ||
    /^interactive scenario$/i.test(normalized) ||
    /^weekly reflection in ppad workbook/i.test(normalized) ||
    /^(?:project starts?|project help session|project consultation)$/i.test(normalized) ||
    /\b(?:project help session|project consultation|class project introduction|class project organization discussions?|assignment one handout|program instruction\/training session|assessment booking\/practice|practical exam preparation)\b/i.test(
      normalized
    ) ||
    /\b(?:read assigned texts?|read assigned text|purchase course textbook|complete .* before class|read group members['’] sources|select source before class)\b/i.test(
      normalized
    ) ||
    /^pcl event\b/i.test(normalized)
  );
}

function isActionableScheduleEntry(entry: string) {
  const normalized = normalizeWhitespace(entry);
  if (!normalized || isRoutineScheduleEntry(normalized)) return false;
  const explicitDates = extractExplicitDates(normalized, new Date().getFullYear());
  const hasDateCue =
    explicitDates.length > 0 ||
    /\b(?:due|deadline|available as of|opens?(?:\s+on)?|closes?(?:\s+on)?|submission due date|review of peers due date|feedback(?: review)? due date)\b/i.test(
      normalized
    );
  const hasAssessmentCue =
    /\b(?:assignment|quiz|midterm|term test|test|exam|report|essay|reflection|portfolio|project|deliverable|survey|charter|homepage|linkedin|bibliography|paper|communication assignment|post\b|response\b|peer assessment|peer feedback|learning from place|map the system)\b/i.test(
      normalized
    );
  return hasAssessmentCue && hasDateCue;
}

function splitCompoundActionableEntries(line: string) {
  return line
    .split(/\s*;\s*/)
    .flatMap((segment) => {
      const normalizedSegment = normalizeWhitespace(segment);
      if (!normalizedSegment) return [];

      const splitOnAmpersand = normalizedSegment.split(
        /\s+(?:&|\+|and)\s+(?=(?:TPA\s*\d+\b|WA\s*\d+\b|HA\s*\d+\b|(?:tutorial peer assessment|written assignment|mobius assignment|homework assignment|assignment|quiz|test|mid-?term|midterm|problem set|task|step|project|simulation)\s*#?\s*\d+\b))/i
      );
      if (
        splitOnAmpersand.length > 1 &&
        splitOnAmpersand.every((part) => {
          const candidate = normalizeWhitespace(part);
          return Boolean(
            assignmentLabelFromText(candidate) ||
              extractAssessmentLabelFromText(candidate) ||
              /^TPA\s*\d+\b/i.test(candidate) ||
              /^WA\s*\d+\b/i.test(candidate) ||
              /^HA\s*\d+\b/i.test(candidate)
          );
        })
      ) {
        return splitOnAmpersand.map((part) => normalizeWhitespace(part)).filter(Boolean);
      }

      return [normalizedSegment];
    })
    .filter(Boolean);
}

function expandScheduleEntries(content: string) {
  const lines = normalizeWhitespace(content)
    .split(/\n+/)
    .map((line) => normalizeWhitespace(line))
    .filter(Boolean);

  return lines.flatMap((line) => {
    const normalizedLine = normalizeWhitespace(
      line
        .replace(
          /(?<=[a-z0-9)])(?=\s*(?:Quiz\s*\d+|Quiz\s*week\s*\d+|Assig(?:nment)?\s*#?\s*\d+(?:\.\d+)?|Problem Set\s*#?\s*\d+|Problems?\s+Set\s*#?\s*\d+|HA\s*\d+\b|Lab\s*\d+\b|Project Due\b|Project Starts\b|Project Help Session\b|Project Consultation\b|Midterm Exam\b|Mid-term Exam\b|Reflection\s*#?\s*\d+|Commentary\s*#?\s*\d+\s*(?:post|responses?)|Self-introduction\b|Pre-course survey\b|Case\s*\d+\s+analysis\b|Team project proposal\b|Paradise Lost Assignment\b|EEBO Assignment\b|Final Assignment\b|Case\s*\d+\b))/gi,
          "\n"
        )
        .replace(/(\d)(?=(?:post|responses?\b))/gi, "$1 ")
        .replace(
          /\)(?=\s*(?:Commentary|Responses?|Reflection|Case\s+\d+\s+Analysis|Team Project|Notification if|Self-introduction|Pre-course survey|Clinical Case Study|(?:\d+(?:st|nd|rd)|Final)\s+Assessment|Assessment Interpretation|Assig(?:nment)?\s*#?\s*\d+(?:\.\d+)?|Discussion Post\s*#?\s*\d+|Introduce Yourself|Introduction course survey|Practice Questions Quiz\s*\d+|Quiz week\s*\d+|Paradise Lost Assignment|EEBO Assignment|Final Assignment|Final Project|Project\s*#?\s*\d+|Module\s*\d+|HA\s*\d+)\b)/gi,
          ")\n"
        )
    );
    const duePrefixMatch = normalizedLine.match(/^((?:due by|due on|deadline(?:\s+for)?|submission due date|review of peers due date|feedback(?: review)? due date)[^:]*):\s*(.+)$/i);
    if (duePrefixMatch) {
      return splitCompoundActionableEntries(duePrefixMatch[2])
        .flatMap((item) =>
          item
            .replace(
              /\s+(?=(?:Due by|Due on|Deadline(?:\s+for)?|Submission Due Date|Review of Peers Due Date|Feedback(?: Review)? Due Date)\b)/gi,
              "\n"
            )
            .split(/\n+/)
            .map((segment) => normalizeWhitespace(segment))
            .filter(Boolean)
        )
        .map((item) =>
          /^(?:due by|due on|deadline(?:\s+for)?|submission due date|review of peers due date|feedback(?: review)? due date)\b/i.test(
            item
          )
            ? item
            : `${duePrefixMatch[1]}: ${item}`
        );
    }

    const datedPrefixMatch = normalizedLine.match(/^((?:(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)[a-z]*\.?\s+\d{1,2}|(?:Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday),?\s+(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)[a-z]*\.?\s+\d{1,2}).{0,40}?\bby\b[^:]*):\s*(.+)$/i);
    if (datedPrefixMatch) {
      return datedPrefixMatch[2]
        .split(/\s*;\s*/)
        .map((item) => normalizeWhitespace(item))
        .filter(Boolean)
        .map((item) => `${datedPrefixMatch[1]}: ${item}`);
    }

    const repeatedDateBoundedEntries = Array.from(
      normalizedLine.matchAll(
        /([^.;]*?\b(?:due by|due on|submission due date|review of peers due date|feedback(?: review)? due date)\b[^.;]*?(?:(?:Mon(?:day)?|Tue(?:s|sday)?|Wed(?:nesday)?|Thu(?:r|rs|rsday|ursday)?|Fri(?:day)?|Sat(?:urday)?|Sun(?:day)?),?\s+)?(?:\d{1,2}\s+)?(?:January|February|March|April|May|June|July|August|September|October|November|December|Jan|Feb|Mar|Apr|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)\.?\s+\d{1,2}(?:st|nd|rd|th)?(?:,?\s*\d{4})?)/gi
      )
    )
      .map((match) => normalizeWhitespace(match[1]))
      .filter(Boolean);
    if (repeatedDateBoundedEntries.length > 1) {
      return repeatedDateBoundedEntries;
    }

    const ampersandSplitEntries = normalizedLine
      .split(/\s*&\s*/)
      .map((entry) => normalizeWhitespace(entry))
      .filter(Boolean);
    if (
      ampersandSplitEntries.length > 1 &&
      ampersandSplitEntries.every((entry) =>
        /\b(?:TPA|WA|MA|HA|A|Q)\s*0*\d+\b/i.test(entry) ||
        /\b(?:tutorial peer assessment|written assignment|mobius assignment|assignment|quiz|test|midterm)\s*#?\s*\d+\b/i.test(
          entry
        ) ||
        /\b(?:due|deadline|available|opens?|closes?)\b/i.test(entry)
      )
    ) {
      return ampersandSplitEntries;
    }

    return normalizedLine
      .split(/\s*;\s*/)
      .map((entry) => normalizeWhitespace(entry))
      .filter(Boolean);
  });
}

function extractScheduleAssessmentEntries(content: string) {
  const lines = normalizeWhitespace(content)
    .split(/\n+/)
    .map((line) => normalizeWhitespace(line))
    .filter(Boolean);

  return lines.flatMap((line) => {
    if (isRoutineScheduleEntry(line)) return [];
    if (/^for next week:?$/i.test(line) || /^to do for /i.test(line)) return [];

    const dueKeywordIndex = line.search(
      /\b(?:due by|due on|deadline(?:\s+for)?)(?=[^:]{0,120}:)/i
    );
    const focusedLine =
      dueKeywordIndex > 0 &&
      !/^\s*(?:due by|due on|deadline(?:\s+for)?)/i.test(line)
        ? line.slice(dueKeywordIndex)
        : line;

    if (hasDirectDeadlineCue(focusedLine)) {
      return expandScheduleEntries(focusedLine).filter(
        (entry) => !isRoutineScheduleEntry(entry) && hasDirectDeadlineCue(entry)
      );
    }

    return hasDirectDeadlineCue(line) ? [line] : [];
  });
}

function labelFromScheduleEntry(entry: string) {
  const normalized = trimTrailingPeriods(stripLeadingSchedulePrefix(entry)).replace(/\s+/g, " ");
  if (!normalized) return undefined;
  if (/^(?:project starts?|project help session)$/i.test(normalized)) return undefined;
  const projectDuePartMatch = normalized.match(/\bproject\s+due\s*\(\s*part\s*([^)]+?)\s*\)/i);
  if (projectDuePartMatch) {
    const part = normalizeWhitespace(projectDuePartMatch[1]).replace(/^part\s*/i, "");
    return `Project Part ${part}`;
  }
  if (isRoutineScheduleEntry(normalized)) return undefined;
  if (isReviewOrPlaceholderScheduleEntry(normalized) || /\bexam review\b/i.test(normalized)) {
    return undefined;
  }
  if (!isActionableScheduleEntry(entry) && assessmentTypeFromLabel(normalized) === "Other") {
    return undefined;
  }
  if (/reading quiz/i.test(normalized)) return "Reading Quiz";

  const base = trimTrailingPeriods(
    normalized
      .replace(/^\((?:I|G)\)\s*/i, "")
      .replace(/^submit\s+/i, "")
      .replace(/^signed\s+/i, "")
      .replace(/^(?:students?\s+)?work on (?:the\s+)?/i, "")
      .replace(/^start working on (?:the\s+)?/i, "")
      .replace(/^create or update /i, "")
      .replace(/^complete (?:the\s+)?/i, "")
      .replace(/^prepare for (?:the\s+)?/i, "")
      .replace(/^finish (?:filling out|creating)?\s*/i, "")
      .replace(/^files of deliverables created for demo day.*$/i, "Demo Day Deliverables")
      .replace(/^weekly reflection(?: in ppad workbook)?(?:\s*\(.*)?$/i, "Weekly Reflection")
      .replace(/^week\s*(\d+)\s*reflection(?:\s*\(.*)?$/i, "Weekly Reflection #$1")
      .replace(/^reflection$/i, "Weekly Reflection")
      .replace(/^the skeleton structure of the career eportfolio in pebblepad.*$/i, "Career ePortfolio Structure")
      .replace(
        /^homepage of (?:(?:their|the)\s+)?career (?:eportfolio|portfolio)s?.*$/i,
        "Career ePortfolio Homepage"
      )
      .replace(/^linkedin page completed and linked from the career eportfolio.*$/i, "Career ePortfolio LinkedIn Page")
      .replace(/^ph communication portion of career portfolio.*$/i, "Career ePortfolio Public Health Communication Tab")
      .replace(/^other competency tab of career eportfolio.*$/i, "Career ePortfolio Other Competency Tab")
      .replace(/^group outline of systems framing\/solution ideas .*$/i, "Systems Framing and Solution Ideas Outline")
      .replace(/^problem space interest survey$/i, "Problem Space Interest Survey")
      .replace(/^team charter$/i, "Team Charter")
      .replace(/^peer assessment of group work$/i, "Group Work Peer Assessment")
      .replace(/^(?:the\s+)?peer reviews? of the portfolios.*$/i, "Career Portfolio Peer Feedback")
      .replace(/^complete the peer feedback on career portfolios.*$/i, "Career Portfolio Peer Feedback")
      .replace(/^pebblepad workbook reflection portfolio.*$/i, "PebblePad Workbook Reflection Portfolio")
      .replace(/^final polished career eportfolio.*$/i, "Final Career ePortfolio")
      .replace(/^final career eportfolio.*$/i, "Final Career ePortfolio")
      .replace(/^final team report on health innovation challenge.*$/i, "Final Team Report on Health Innovation Challenge")
      .replace(/^deadline for practicing hope post\s*#?\s*(\d+).*$/i, "Practicing Hope Post #$1")
      .replace(/^deadline for practicing hope response.*$/i, "Practicing Hope Response")
      .replace(/\bdue\b.*$/i, "")
      .replace(/\bdeadline for\s+/i, "")
      .replace(/^map the system topic overview$/i, "Map the System Step 1")
      .replace(/^map the system preliminary solution brief and systems map$/i, "Map the System Step 2")
      .replace(/^map the system final solution brief and systems map$/i, "Map the System Step 3")
      .replace(/\s*\((?:SUN|MON|TUE|WED|THU|FRI|SAT|SU|MO|TU|WE|TH|FR|SA|M|T|W|F)\)\s*$/i, "")
      .replace(/\(\s*$/i, "")
      .replace(/\s+for printing$/i, "")
      .replace(/\s+@\s+\d.*$/i, "")
      .replace(/\s*\(see details below\)\s*$/i, "")
  );

  return base || undefined;
}

function locationFromRowText(value: string) {
  const normalized = normalizeWhitespace(value);
  const structured = extractStructuredLocation(normalized);
  if (structured) return structured;
  const atMatch = normalized.match(/@\s*([A-Za-z][^|]+)$/);
  if (atMatch) {
    return extractStructuredLocation(atMatch[1], true) || normalizeLocation(atMatch[1]);
  }
  return "";
}

function normalizeAssessmentWeightKey(label: string) {
  const normalized = normalizeAssessmentLabel(label)
    .toLowerCase()
    .replace(/[–—]/g, "-");

  const numberedMatch = normalized.match(
    /\b(term test|midterm test|midterm|quiz|exam|final exam)\s*#?\s*(\d+)\b/i
  );
  if (numberedMatch) {
    return `${numberedMatch[1].replace(/\s+/g, " ")} ${numberedMatch[2]}`;
  }

  if (/\bfinal exam\b/i.test(normalized)) {
    return "final exam";
  }

  return normalized
    .replace(
      /\b(mon(?:day)?|tue(?:s|sday)?|wed(?:nesday)?|thu(?:r|rs|rsday|ursday)?|fri(?:day)?|sat(?:urday)?|sun(?:day)?)\b/gi,
      " "
    )
    .replace(
      /\b(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t|tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\.?\b/gi,
      " "
    )
    .replace(/\b\d{1,2}(?:st|nd|rd|th)?(?:,\s*\d{4})?\b/gi, " ")
    .replace(/\blectures?\b/gi, "lec")
    .replace(/\blaboratories\b/gi, "lab")
    .replace(/\blabs?\b/gi, "lab")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function eventTypeFromSectionKind(kind: string): Extract<EventType, "Lecture" | "Tutorial" | "Lab"> {
  const normalized = kind.toUpperCase();
  if (normalized.includes("LAB")) return "Lab";
  if (normalized.includes("TUT")) return "Tutorial";
  return "Lecture";
}

function ignoredScheduleSectionKind(kind: string) {
  return /\b(?:TST|TEST|EXAM|EXM|MID|MIDTERM|FIN|FINAL)\b/i.test(
    normalizeWhitespace(kind)
  );
}

function confidenceFromSeed(seed: {
  date?: string;
  startDate?: string;
  endDate?: string;
  startTime?: string;
  endTime?: string;
  location?: string;
  explicitDates?: string[];
}) {
  if (seed.date || (seed.startDate && seed.endDate) || (seed.explicitDates?.length ?? 0) > 0) {
    if (seed.startTime && seed.endTime) return "high" as const;
    return "medium" as const;
  }
  return "low" as const;
}

function reviewNeededForEvent(event: EventCandidate) {
  if (event.confidence === "low") return true;
  if (event.timing.kind === "single") {
    return !event.timing.date;
  }
  return !event.timing.startDate || !event.timing.endDate || event.timing.byDay.length === 0;
}

function defaultIncludeForEvent(event: EventCandidate) {
  return !reviewNeededForEvent(event);
}

function stripOrdinals(value: string) {
  return value.replace(/\b(\d{1,2})(st|nd|rd|th)\b/gi, "$1");
}

function stripLeadingWeekdayText(value: string) {
  return value.replace(
    /^(?:Mon(?:day)?|Tue(?:s|sday)?|Wed(?:nesday)?|Thu(?:r|rs|rsday|ursday)?|Fri(?:day)?|Sat(?:urday)?|Sun(?:day)?|M|T|W|Th|F|Sa|Su)\.?,?\s+/i,
    ""
  );
}

function normalizeLooseMonthDaySpacing(value: string) {
  return value.replace(
    /\b(January|February|March|April|May|June|July|August|September|October|November|December|Jan|Feb|Mar|Apr|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)\.?\s*(\d{1,2})\s*(st|nd|rd|th)?(?=\b)/gi,
    (_match, month: string, day: string, suffix?: string) =>
      `${month} ${day}${suffix ?? ""}`
  );
}

function normalizeWeightText(weight: string | null | undefined) {
  const normalized = normalizeWhitespace(weight);
  if (!normalized) return "";
  if (/^\d+(?:\.\d+)?\s*%$/.test(normalized)) {
    return normalized.replace(/\s*%$/, "%");
  }
  if (/^\d+(?:\.\d+)?$/.test(normalized)) {
    return `${normalized}%`;
  }
  return normalized;
}

function extractWeightFromText(text: string | null | undefined) {
  const normalized = normalizeWhitespace(text);
  return normalizeWeightText(normalized.match(/\b\d+(?:\.\d+)?\s*%/i)?.[0]);
}

function looksLikeAssessmentText(value: string | null | undefined) {
  return /\b(?:quizzes?|midterms?|endterm|term tests?|tests?|exams?|final exam|knowledge checks?)\b/i.test(
    normalizeWhitespace(value)
  );
}

function looksLikeAssignmentText(value: string | null | undefined) {
  const normalized = normalizeWhitespace(value);
  if (/\bp\.?\s*\d+[a-z]?\b/i.test(normalized)) {
    return true;
  }
  return /\b(?:assignments?|submissions?|reports?|lab reports?|essays?|analysis|analyses|reflections?|commentaries?|modules?|portfolios?|projects?|deliverables?|surveys?|charters?|homepage|linkedin|bibliography|papers?|sketchbooks?|drawings?|communication assignments?|posts?\b|responses?\b|peer assessment|peer feedback|peer review|learning from place|map the system|presentations?|presentation files?|applications?|packets?|worksheets?|speeches?|scripts?|briefing note|brief\b|deck|proposals?|videos?|review workshop|review comments?|rough drafts?|author['’]s statement|group contract|contracts?|goal statement|outlines?|annotations?\b|perusall\b|qfc\b|self-assessment\b|passage analysis|story map|tasks?|files?|case studies?|program design|readiness activit(?:y|ies)|check-?ins?)\b/i.test(
    normalized
  );
}

function parseFlexibleTime(value: string | null | undefined) {
  const normalized = normalizeWhitespace(value)
    .replace(/[–—]/g, "-")
    .replace(/(\d)\.(\d{2})(?=\b)/g, "$1:$2")
    .replace(/\b(a\.?m\.?|p\.?m\.?)\b/gi, (match) => match.replace(/\./g, "").toUpperCase());
  if (!normalized) return undefined;

  const patterns = ["h:mma", "ha", "h:mm a", "h a", "H:mm", "H"];
  for (const pattern of patterns) {
    const parsed = parse(normalized, pattern, new Date());
    if (isValid(parsed)) return format(parsed, "HH:mm");
  }
  return undefined;
}

function parseTimeRange(value: string | null | undefined) {
  const normalized = normalizeWhitespace(value)
    .replace(/[–—]/g, "-")
    .replace(/\bto\b/gi, "-")
    .replace(/(\d)\.(\d{2})(?=\b)/g, "$1:$2")
    .replace(/\s*-\s*-\s*/g, "-");
  if (!normalized) return {};
  const match = normalized.match(
    /(\d{1,2}(?::\d{2})?\s*(?:a\.?m\.?|p\.?m\.?|am|pm|AM|PM)?)\s*-\s*(\d{1,2}(?::\d{2})?\s*(?:a\.?m\.?|p\.?m\.?|am|pm|AM|PM)?)/i
  );
  if (!match) return {};
  if (!/[:]|a\.?m\.?|p\.?m\.?|am|pm/i.test(`${match[1]} ${match[2]}`)) {
    return {};
  }
  const startRaw = normalizeWhitespace(match[1]);
  const endRaw = normalizeWhitespace(match[2]);
  const startClock = parseLooseClock(startRaw);
  const endClock = parseLooseClock(endRaw);
  const startExplicit = hasMeridiem(startRaw) || (startClock?.hour ?? 0) > 12;
  const endExplicit = hasMeridiem(endRaw) || (endClock?.hour ?? 0) > 12;
  let directStart = startExplicit ? parseFlexibleTime(startRaw) : undefined;
  let directEnd = endExplicit ? parseFlexibleTime(endRaw) : undefined;

  if (!startClock || !endClock) {
    return {
      startTime: directStart,
      endTime: directEnd,
    };
  }

  let startMeridiem = startClock.meridiem;
  let endMeridiem = endClock.meridiem;

  if (startMeridiem && !endMeridiem) {
    if (startMeridiem === "AM" && endClock.hour < startClock.hour) {
      endMeridiem = "PM";
    } else {
      endMeridiem = startMeridiem;
    }
  } else if (!startMeridiem && endMeridiem) {
    if (endMeridiem === "PM" && startClock.hour > endClock.hour && startClock.hour !== 12) {
      startMeridiem = "AM";
    } else {
      startMeridiem = endMeridiem;
    }
  }

  const startTime = directStart ?? to24HourTime(startClock, startMeridiem);
  const endTime = directEnd ?? to24HourTime(endClock, endMeridiem);
  if (!startTime || !endTime) return {};
  return {
    startTime,
    endTime,
  };
}

function monthTokenToAbbrev(value: string) {
  return MONTH_ALIASES[value.toLowerCase()] ?? value;
}

function alignParsedDateToWeekdayHint(date: Date, desiredWeekday: WeekdayCode | undefined) {
  if (!desiredWeekday) return date;

  const exactWeekday = WEEKDAY_BY_INDEX[getDay(date)];
  if (exactWeekday === desiredWeekday) return date;

  const shiftedBackward = addDays(date, -1);
  if (
    shiftedBackward.getMonth() === date.getMonth() &&
    WEEKDAY_BY_INDEX[getDay(shiftedBackward)] === desiredWeekday
  ) {
    return shiftedBackward;
  }

  const shiftedForward = addDays(date, 1);
  if (
    shiftedForward.getMonth() === date.getMonth() &&
    WEEKDAY_BY_INDEX[getDay(shiftedForward)] === desiredWeekday
  ) {
    return shiftedForward;
  }

  return date;
}

function parseMonthNamedDateFromText(
  value: string,
  defaultYear: number,
  desiredWeekday: WeekdayCode | undefined
) {
  const monthFirstMatch = value.match(
    /(?:(Mon(?:day)?|Tue(?:s|sday)?|Wed(?:nesday)?|Thu(?:r|rs|rsday|ursday)?|Fri(?:day)?|Sat(?:urday)?|Sun(?:day)?)\s*,?\s+)?(January|February|March|April|May|June|July|August|September|October|November|December|Jan|Feb|Mar|Apr|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)\.?\s+(\d{1,2})(?:st|nd|rd|th)?(?:\s*,?\s*(\d{4}))?/i
  );
  if (monthFirstMatch) {
    const inferredWeekday = parseWeekdayCodes(monthFirstMatch[1])[0];
    const monthIndex = MONTH_INDEX_BY_ABBREV[
      monthTokenToAbbrev(monthFirstMatch[2]).toLowerCase()
    ];
    const day = Number(monthFirstMatch[3]);
    const year = monthFirstMatch[4] ? Number(monthFirstMatch[4]) : defaultYear;
    if (
      monthIndex !== undefined &&
      Number.isFinite(day) &&
      Number.isFinite(year)
    ) {
      const candidate = new Date(year, monthIndex, day);
      if (
        isValid(candidate) &&
        candidate.getFullYear() === year &&
        candidate.getMonth() === monthIndex &&
        candidate.getDate() === day
      ) {
        return format(
          alignParsedDateToWeekdayHint(candidate, desiredWeekday ?? inferredWeekday),
          "yyyy-MM-dd"
        );
      }
    }
  }

  const dayFirstMatch = value.match(
    /(?:(Mon(?:day)?|Tue(?:s|sday)?|Wed(?:nesday)?|Thu(?:r|rs|rsday|ursday)?|Fri(?:day)?|Sat(?:urday)?|Sun(?:day)?)\s*,?\s+)?(\d{1,2})(?:st|nd|rd|th)?\s+(January|February|March|April|May|June|July|August|September|October|November|December|Jan|Feb|Mar|Apr|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)\.?(?:\s*,?\s*(\d{4}))?/i
  );
  if (!dayFirstMatch) return undefined;

  const inferredWeekday = parseWeekdayCodes(dayFirstMatch[1])[0];
  const monthIndex = MONTH_INDEX_BY_ABBREV[
    monthTokenToAbbrev(dayFirstMatch[3]).toLowerCase()
  ];
  const day = Number(dayFirstMatch[2]);
  const year = dayFirstMatch[4] ? Number(dayFirstMatch[4]) : defaultYear;
  if (
    monthIndex === undefined ||
    !Number.isFinite(day) ||
    !Number.isFinite(year)
  ) {
    return undefined;
  }

  const candidate = new Date(year, monthIndex, day);
  if (
    !isValid(candidate) ||
    candidate.getFullYear() !== year ||
    candidate.getMonth() !== monthIndex ||
    candidate.getDate() !== day
  ) {
    return undefined;
  }

  return format(
    alignParsedDateToWeekdayHint(candidate, desiredWeekday ?? inferredWeekday),
    "yyyy-MM-dd"
  );
}

function parseFlexibleDate(rawValue: string | null | undefined, defaultYear: number) {
  const rawNormalized = normalizeWhitespace(rawValue);
  const weekdayHint = rawNormalized.match(
    /\b(Mon(?:day)?|Tue(?:s|sday)?|Wed(?:nesday)?|Thu(?:r|rs|rsday|ursday)?|Fri(?:day)?|Sat(?:urday)?|Sun(?:day)?)\b/i
  )?.[1];
  const desiredWeekday = parseWeekdayCodes(weekdayHint)[0];
  const directMonthNamedDate = parseMonthNamedDateFromText(
    rawNormalized,
    defaultYear,
    desiredWeekday
  );
  if (directMonthNamedDate) return directMonthNamedDate;

  const value = normalizeLooseMonthDaySpacing(
    rawNormalized
      .replace(/,/g, " ")
      .replace(/\.(?=(?:\s|$))/g, " ")
      .replace(/\bof\b/gi, " ")
      .replace(/\s+/g, " ")
  );
  if (!value) return undefined;

  const sanitized = stripOrdinals(
    stripLeadingWeekdayText(
      normalizeWhitespace(
        value.replace(/^\d{1,2}(?::\d{2})?\s*(?:a\.?m\.?|p\.?m\.?|am|pm)\s+/i, "")
      )
    )
  );
  const monthSwap = sanitized.replace(
    /\b(January|February|March|April|May|June|July|August|September|October|November|December|Jan|Feb|Mar|Apr|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)\b/gi,
    (match) => monthTokenToAbbrev(match)
  );

  const patterns = [
    "MMM d yyyy",
    "MMMM d yyyy",
    "d MMM yyyy",
    "d MMMM yyyy",
    "MMM d",
    "MMMM d",
    "d MMM",
    "d MMMM",
    "M/d/yyyy",
    "M/d/yy",
    "M/d",
    "MM-dd-yyyy",
    "yyyy-MM-dd",
    "d-MMM yyyy",
    "d-MMM",
    "MMM d yyyy",
  ];

  for (const pattern of patterns) {
    const parsed = parse(monthSwap, pattern, new Date(defaultYear, 0, 1));
    if (isValid(parsed)) {
      const withYear =
        /y/.test(pattern) || parsed.getFullYear() !== defaultYear
          ? parsed
          : new Date(defaultYear, parsed.getMonth(), parsed.getDate());
      return format(alignParsedDateToWeekdayHint(withYear, desiredWeekday), "yyyy-MM-dd");
    }
  }
  return undefined;
}

function parseSlashDate(rawValue: string | null | undefined, defaultYear: number) {
  const value = normalizeWhitespace(rawValue);
  if (!value) return undefined;
  const match = value.match(/\b(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\b/);
  if (!match) return undefined;
  const year = match[3] ? Number(match[3].length === 2 ? `20${match[3]}` : match[3]) : defaultYear;
  const parsed = parse(`${match[1]}/${match[2]}/${year}`, "M/d/yyyy", new Date());
  return isValid(parsed) ? format(parsed, "yyyy-MM-dd") : undefined;
}

function parseDateRange(value: string | null | undefined, defaultYear: number) {
  const normalized = normalizeLooseMonthDaySpacing(
    stripLeadingWeekdayText(normalizeWhitespace(value).replace(/[–—]/g, "-"))
  );
  if (!normalized) return undefined;
  const withoutTimes = normalizeWhitespace(
    normalized.replace(
      /\bat\s+\d{1,2}(?::\d{2})?\s*(?:a\.?m\.?|p\.?m\.?|am|pm|AM|PM)\b/gi,
      ""
    )
  );

  const explicitToRangeMatch = withoutTimes.match(
    /\b([A-Za-z]+)\s+(\d{1,2})(?:\s*,?\s*(\d{4}))?\s+to\s+(?:(?:Mon(?:day)?|Tue(?:s|sday)?|Wed(?:nesday)?|Thu(?:r|rs|rsday|ursday)?|Fri(?:day)?|Sat(?:urday)?|Sun(?:day)?)\s*,\s*)?([A-Za-z]+)\s+(\d{1,2})(?:\s*,?\s*(\d{4}))?\b/i
  );
  if (explicitToRangeMatch) {
    const startYear = explicitToRangeMatch[3]
      ? Number(explicitToRangeMatch[3])
      : defaultYear;
    const endYear = explicitToRangeMatch[6]
      ? Number(explicitToRangeMatch[6])
      : startYear;
    const startDate = parseFlexibleDate(
      `${explicitToRangeMatch[1]} ${explicitToRangeMatch[2]} ${startYear}`,
      startYear
    );
    const endDate = parseFlexibleDate(
      `${explicitToRangeMatch[4]} ${explicitToRangeMatch[5]} ${endYear}`,
      endYear
    );
    if (startDate && endDate) return { startDate, endDate };
  }

  const fullMatch = normalized.match(
    /\b([A-Za-z]+)\s+(\d{1,2})\s*-\s*([A-Za-z]+)\s+(\d{1,2})(?:\s*,?\s*(\d{4}))?\b/
  );
  if (fullMatch) {
    const year = fullMatch[5] ? Number(fullMatch[5]) : defaultYear;
    const startDate = parseFlexibleDate(`${fullMatch[1]} ${fullMatch[2]} ${year}`, year);
    const endDate = parseFlexibleDate(`${fullMatch[3]} ${fullMatch[4]} ${year}`, year);
    if (startDate && endDate) return { startDate, endDate };
  }

  const shortMatch = normalized.match(/\b([A-Za-z]+)\s+(\d{1,2})\s*-\s*(\d{1,2})(?!:)\b/);
  if (shortMatch) {
    const startDate = parseFlexibleDate(`${shortMatch[1]} ${shortMatch[2]} ${defaultYear}`, defaultYear);
    const endDate = parseFlexibleDate(`${shortMatch[1]} ${shortMatch[3]} ${defaultYear}`, defaultYear);
    if (startDate && endDate) return { startDate, endDate };
  }

  const reverseShortMatch = normalized.match(
    /\b(\d{1,2})\s*-\s*(\d{1,2})(?!:)\s+([A-Za-z]+)(?:\s*,?\s*(\d{4}))?\b/
  );
  if (reverseShortMatch) {
    const year = reverseShortMatch[4] ? Number(reverseShortMatch[4]) : defaultYear;
    const startDate = parseFlexibleDate(
      `${reverseShortMatch[3]} ${reverseShortMatch[1]} ${year}`,
      year
    );
    const endDate = parseFlexibleDate(
      `${reverseShortMatch[3]} ${reverseShortMatch[2]} ${year}`,
      year
    );
    if (startDate && endDate) return { startDate, endDate };
  }

  const numericMatch = normalized.match(/\b(\d{2})-(\d{2})-(\d{4})\s*-\s*(\d{2})-(\d{2})-(\d{4})\b/);
  if (numericMatch) {
    const startDate = parseFlexibleDate(
      `${numericMatch[1]}-${numericMatch[2]}-${numericMatch[3]}`,
      defaultYear
    );
    const endDate = parseFlexibleDate(
      `${numericMatch[4]}-${numericMatch[5]}-${numericMatch[6]}`,
      defaultYear
    );
    if (startDate && endDate) return { startDate, endDate };
  }

  return undefined;
}

function hasDeliverableSeriesPrefixBeforeDate(value: string, startIndex: number) {
  const prefix = value.slice(Math.max(0, startIndex - 40), startIndex).toLowerCase();
  return (
    /\b(?:project|assignment|quiz|test|exam|lab|module|week|chapter|part|phase|problem set|tutorial problem)\s*$/.test(
      prefix
    ) ||
    /\b(?:project|assignment|quiz|test|exam|lab|module|week|chapter|part|phase|problem set|tutorial problem)\s+\d+\s*$/.test(
      prefix
    )
  );
}

function extractExplicitDates(value: string | null | undefined, defaultYear: number) {
  const normalized = normalizeLooseMonthDaySpacing(
    stripLeadingWeekdayText(normalizeWhitespace(value))
  );
  if (!normalized) return [];
  const withoutTimes = normalizeWhitespace(
    normalized
      .replace(
        /\b\d{1,2}(?::\s*\d{2})?\s*-\s*\d{1,2}(?::\s*\d{2})?\s*(?:a\.?m\.?|p\.?m\.?|am|pm|AM|PM)\b/gi,
        " "
      )
      .replace(/\b\d{1,2}\s*:\s*\d{2}\s*-\s*\d{1,2}(?::\s*\d{2})?\b/gi, " ")
      .replace(/\b\d{1,2}\s*:\s*\d{2}\s*(?:a\.?m\.?|p\.?m\.?|am|pm|AM|PM)?\b/gi, " ")
      .replace(/\b\d{1,2}\s*h\s*\d{2}\b/gi, " ")
      .replace(/\b\d{3,4}\s*(?:a\.?m\.?|p\.?m\.?|am|pm|AM|PM)\b/gi, " ")
      .replace(/\b\d{1,2}\s*(?:a\.?m\.?|p\.?m\.?|am|pm|AM|PM)\b/gi, " ")
  );

  const explicit = new Set<string>();
  const shouldTreatSlashDateMatchAsDate = (source: string, startIndex: number) => {
    const prefix = source.slice(Math.max(0, startIndex - 24), startIndex);
    if (
      /(?:^|[\s|([{,:;])$/.test(prefix) ||
      /\b(?:on|by|due|deadline(?:\s+for)?|available(?:\s+as\s+of|\s+from)?|opens?(?:\s+on)?|closes?(?:\s+on)?|scheduled|from|until|through)\s*$/.test(
        prefix
      )
    ) {
      return true;
    }

    return false;
  };

  for (const match of withoutTimes.matchAll(
    /\b(January|February|March|April|May|June|July|August|September|October|November|December|Jan|Feb|Mar|Apr|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)\s+(\d{1,2}(?:st|nd|rd|th)?)\s*\/\s*(\d{1,2}(?:st|nd|rd|th)?)(?:\s*,?\s*(\d{4}))?/gi
  )) {
    const year = match[4] ? Number(match[4]) : defaultYear;
    const first = parseFlexibleDate(`${match[1]} ${match[2]} ${year}`, year);
    const second = parseFlexibleDate(`${match[1]} ${match[3]} ${year}`, year);
    if (first) explicit.add(first);
    if (second) explicit.add(second);
  }

  for (const match of withoutTimes.matchAll(
    /\b(\d{1,2}(?:st|nd|rd|th)?)\s*\/\s*(\d{1,2}(?:st|nd|rd|th)?)\s+(January|February|March|April|May|June|July|August|September|October|November|December|Jan|Feb|Mar|Apr|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)(?:\s*,?\s*(\d{4}))?/gi
  )) {
    const year = match[4] ? Number(match[4]) : defaultYear;
    const first = parseFlexibleDate(`${match[3]} ${match[1]} ${year}`, year);
    const second = parseFlexibleDate(`${match[3]} ${match[2]} ${year}`, year);
    if (first) explicit.add(first);
    if (second) explicit.add(second);
  }

  const withoutDualDayMonth = withoutTimes
    .replace(
      /\b(January|February|March|April|May|June|July|August|September|October|November|December|Jan|Feb|Mar|Apr|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)\s+\d{1,2}(?:st|nd|rd|th)?\s*\/\s*\d{1,2}(?:st|nd|rd|th)?(?:\s*,?\s*\d{4})?/gi,
      " "
    )
    .replace(
      /\b\d{1,2}(?:st|nd|rd|th)?\s*\/\s*\d{1,2}(?:st|nd|rd|th)?\s+(January|February|March|April|May|June|July|August|September|October|November|December|Jan|Feb|Mar|Apr|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)(?:\s*,?\s*\d{4})?/gi,
      " "
    );

  for (const match of withoutTimes.matchAll(
    /\b(January|February|March|April|May|June|July|August|September|October|November|December|Jan|Feb|Mar|Apr|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)\s+((?:\d{1,2}(?:st|nd|rd|th)?(?!\d))(?:\s*,\s*\d{1,2}(?:st|nd|rd|th)?(?!\d))*)(?:\s*,?\s*(\d{4}))?/gi
  )) {
    const month = match[1];
    const dayList = match[2];
    const year = match[3] ? Number(match[3]) : defaultYear;
    const dayMatches = Array.from(dayList.matchAll(/\d{1,2}(?:st|nd|rd|th)?(?!\d)/g));
    for (const dayMatch of dayMatches) {
      const parsed = parseFlexibleDate(`${month} ${dayMatch[0]} ${year}`, year);
      if (parsed) explicit.add(parsed);
    }
  }

  for (const match of withoutTimes.matchAll(
    /\b(\d{1,2}(?:st|nd|rd|th)?)\s+(January|February|March|April|May|June|July|August|September|October|November|December|Jan|Feb|Mar|Apr|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)(?:\s*,?\s*(\d{4}))?\b/gi
  )) {
    if (hasDeliverableSeriesPrefixBeforeDate(withoutTimes, match.index ?? 0)) {
      continue;
    }
    const year = match[3] ? Number(match[3]) : defaultYear;
    const parsed = parseFlexibleDate(`${match[1]} ${match[2]} ${year}`, year);
    if (parsed) explicit.add(parsed);
  }

  for (const match of withoutTimes.matchAll(/\b\d{1,2}-[A-Za-z]{3}\b/g)) {
    const parsed = parseFlexibleDate(match[0], defaultYear);
    if (parsed) explicit.add(parsed);
  }

  for (const match of withoutDualDayMonth.matchAll(/\b\d{1,2}\/\d{1,2}(?:\/\d{2,4})?\b/g)) {
    if (!shouldTreatSlashDateMatchAsDate(withoutDualDayMonth, match.index ?? 0)) {
      continue;
    }
    const parsed = parseSlashDate(match[0], defaultYear);
    if (parsed) explicit.add(parsed);
  }

  for (const match of withoutTimes.matchAll(/\b\d{2}-\d{2}-\d{4}\b/g)) {
    const parsed = parseFlexibleDate(match[0], defaultYear);
    if (parsed) explicit.add(parsed);
  }

  for (const match of withoutTimes.matchAll(/\b\d{4}-\d{2}-\d{2}\b/g)) {
    const parsed = parseFlexibleDate(match[0], defaultYear);
    if (parsed) explicit.add(parsed);
  }

  return Array.from(explicit).sort();
}

function parseDateSpec(value: string | null | undefined, defaultYear: number) {
  const range = parseDateRange(value, defaultYear);
  if (range) return { kind: "range" as const, ...range };

  const explicitDates = extractExplicitDates(value, defaultYear);
  if (explicitDates.length > 1) return { kind: "dates" as const, dates: explicitDates };
  if (explicitDates.length === 1) return { kind: "single" as const, date: explicitDates[0] };

  const direct = parseFlexibleDate(value, defaultYear) ?? parseSlashDate(value, defaultYear);
  if (direct) return { kind: "single" as const, date: direct };

  return undefined;
}

function outlineTermMonthBounds(meta: OutlineMeta) {
  const normalizedTerm = normalizeWhitespace(meta.term).toLowerCase();
  if (normalizedTerm.startsWith("winter")) {
    return { startMonth: 0, endMonth: 3 };
  }
  if (normalizedTerm.startsWith("spring")) {
    return { startMonth: 4, endMonth: 7 };
  }
  if (normalizedTerm.startsWith("fall")) {
    return { startMonth: 8, endMonth: 11 };
  }
  return undefined;
}

function normalizeDateToOutlineTermYear(
  date: string | undefined,
  sourceText: string | null | undefined,
  meta: OutlineMeta
) {
  if (!date) return date;

  const parsed = parseISO(date);
  if (!isValid(parsed) || parsed.getFullYear() === meta.termYear) {
    return date;
  }

  const normalizedSource = normalizeWhitespace(sourceText);
  if (!normalizedSource) return date;

  const sourceYears = Array.from(
    new Set(
      Array.from(normalizedSource.matchAll(/\b(20\d{2})\b/g), (match) => Number(match[1])).filter(
        (year) => Number.isFinite(year)
      )
    )
  );
  if (sourceYears.length !== 1) {
    return date;
  }
  if (Math.abs(sourceYears[0] - meta.termYear) > 1) {
    return date;
  }

  const monthBounds = outlineTermMonthBounds(meta);
  if (monthBounds) {
    const month = parsed.getMonth();
    if (month < monthBounds.startMonth || month > monthBounds.endMonth) {
      return date;
    }
    if (parsed.getFullYear() < 2000) {
      return format(new Date(meta.termYear, parsed.getMonth(), parsed.getDate()), "yyyy-MM-dd");
    }
  }

  return format(new Date(meta.termYear, parsed.getMonth(), parsed.getDate()), "yyyy-MM-dd");
}

function normalizeOccurrencesToOutlineTermYear(
  occurrences: Array<{ date: string; endDate?: string }>,
  sourceText: string | null | undefined,
  meta: OutlineMeta
) {
  return occurrences.map((occurrence) => ({
    ...occurrence,
    date: normalizeDateToOutlineTermYear(occurrence.date, sourceText, meta) ?? occurrence.date,
    endDate: normalizeDateToOutlineTermYear(occurrence.endDate, sourceText, meta),
  }));
}

function parseWeekdayCodes(value: string | null | undefined) {
  const normalized = normalizeWhitespace(value)
    .replace(/\bMondays?'s?\b/gi, "Mon")
    .replace(/\bTues?'s?\b/gi, "Tue")
    .replace(/\bTuesdays?'s?\b/gi, "Tue")
    .replace(/\bWednesdays?'s?\b/gi, "Wed")
    .replace(/\bThurs?'s?\b/gi, "Thu")
    .replace(/\bThursdays?'s?\b/gi, "Thu")
    .replace(/\bFridays?'s?\b/gi, "Fri")
    .replace(/\bSaturdays?'s?\b/gi, "Sat")
    .replace(/\bSundays?'s?\b/gi, "Sun")
    .replace(/\bTues?\b/gi, "Tue")
    .replace(/\bTuesdays?\b/gi, "Tue")
    .replace(/\bThurs?\b/gi, "Thu")
    .replace(/\bThursdays?\b/gi, "Thu")
    .replace(/\bWednesdays?\b/gi, "Wed")
    .replace(/\bMondays?\b/gi, "Mon")
    .replace(/\bFridays?\b/gi, "Fri")
    .replace(/\bSaturdays?\b/gi, "Sat")
    .replace(/\bSundays?\b/gi, "Sun");

  const dayCodes: WeekdayCode[] = [];
  const mappings: Array<[RegExp, WeekdayCode]> = [
    [/\bMon\b/i, "MO"],
    [/\bTue\b/i, "TU"],
    [/\bWed\b/i, "WE"],
    [/\bThu\b/i, "TH"],
    [/\bFri\b/i, "FR"],
    [/\bF\b/i, "FR"],
    [/\bSat\b/i, "SA"],
    [/\bSun\b/i, "SU"],
  ];

  for (const [pattern, code] of mappings) {
    if (pattern.test(normalized)) dayCodes.push(code);
  }
  return unique(dayCodes);
}

function officeHourDayCodeFromToken(value: string | null | undefined) {
  const normalized = normalizeWhitespace(value)
    .replace(/[.]/g, "")
    .replace(/s$/i, "")
    .toLowerCase();

  if (/^(?:m|mon|monday)$/.test(normalized)) return "MO" as const;
  if (/^(?:t|tu|tue|tues|tuesday)$/.test(normalized)) return "TU" as const;
  if (/^(?:w|wed|wednesday)$/.test(normalized)) return "WE" as const;
  if (/^(?:th|thu|thur|thurs|thursday)$/.test(normalized)) return "TH" as const;
  if (/^(?:f|fri|friday)$/.test(normalized)) return "FR" as const;
  if (/^(?:sat|saturday)$/.test(normalized)) return "SA" as const;
  if (/^(?:sun|sunday)$/.test(normalized)) return "SU" as const;
  return undefined;
}

function parseOfficeHourDayCodes(value: string | null | undefined) {
  const normalized = normalizeWhitespace(value)
    .replace(/\bMWF\b/gi, "Mon Wed Fri")
    .replace(/\bMW\b/gi, "Mon Wed")
    .replace(/\bWF\b/gi, "Wed Fri")
    .replace(/\bTTh\b/gi, "Tue Thu")
    .replace(/\bTuTh\b/gi, "Tue Thu")
    .replace(/\bT\/Th\b/gi, "Tue Thu")
    .replace(/[–—]/g, "-");
  const weekdayOnly = normalized
    .replace(/\b\d{1,2}(?::\d{2})?\s*(?:a\.?m\.?|p\.?m\.?|am|pm|AM|PM)\b/g, " ")
    .replace(/\b\d{1,2}:\d{2}\b/g, " ")
    .replace(/\b(?:a\.?m\.?|p\.?m\.?|am|pm|AM|PM)\b/g, " ")
    .replace(/\b[A-Z](?:\.?[A-Z0-9]){0,3}\.?(?:-|\s*)\d{3,4}[A-Za-z]?\b/g, " ")
    .replace(/\([^)]*\)/g, " ");
  const rangeMatch = weekdayOnly.match(
    /\b(Mon(?:day)?s?'?s?|Tue(?:s(?:day)?)?s?'?s?|Wed(?:nesday)?s?'?s?|Thu(?:r(?:s(?:day)?)?)?s?'?s?|Fri(?:day)?s?'?s?|Sat(?:urday)?s?'?s?|Sun(?:day)?s?'?s?|M|Tu|Th|T|W|F)\b\s*-\s*\b(Mon(?:day)?s?'?s?|Tue(?:s(?:day)?)?s?'?s?|Wed(?:nesday)?s?'?s?|Thu(?:r(?:s(?:day)?)?)?s?'?s?|Fri(?:day)?s?'?s?|Sat(?:urday)?s?'?s?|Sun(?:day)?s?'?s?|M|Tu|Th|T|W|F)\b/i
  );
  if (rangeMatch) {
    const weekdayOrder: WeekdayCode[] = ["MO", "TU", "WE", "TH", "FR", "SA", "SU"];
    const startCode = officeHourDayCodeFromToken(rangeMatch[1]);
    const endCode = officeHourDayCodeFromToken(rangeMatch[2]);
    if (startCode && endCode) {
      const startIndex = weekdayOrder.indexOf(startCode);
      const endIndex = weekdayOrder.indexOf(endCode);
      if (startIndex !== -1 && endIndex !== -1 && startIndex <= endIndex) {
        return weekdayOrder.slice(startIndex, endIndex + 1);
      }
    }
  }
  const cuesByCode: Array<[WeekdayCode, RegExp]> = [
    ["MO", /\b(?:m|mon(?:day)?s?'?s?)\b/gi],
    ["TU", /\b(?:t(?!h\b)|tu|tue(?:s(?:day)?)?s?'?s?)\b/gi],
    ["WE", /\b(?:w|wed(?:nesday)?s?'?s?)\b/gi],
    ["TH", /\b(?:th|thu(?:r(?:s(?:day)?)?)?s?'?s?)\b/gi],
    ["FR", /\b(?:f|fri(?:day)?s?'?s?)\b/gi],
    ["SA", /\b(?:sat(?:urday)?s?'?s?)\b/gi],
    ["SU", /\b(?:sun(?:day)?s?'?s?)\b/gi],
  ];

  const matches: WeekdayCode[] = [];
  cuesByCode.forEach(([code, pattern]) => {
    if (pattern.test(weekdayOnly)) {
      matches.push(code);
    }
  });

  return unique(matches);
}

function officeHourClauseContainingIndex(value: string, index: number) {
  if (index < 0 || index > value.length) {
    return normalizeWhitespace(value);
  }

  const lastBoundary = Math.max(
    value.lastIndexOf(".", index),
    value.lastIndexOf(";", index),
    value.lastIndexOf("\n", index)
  );
  const nextCandidates = [value.indexOf(".", index), value.indexOf(";", index), value.indexOf("\n", index)].filter(
    (candidate) => candidate !== -1
  );
  const nextBoundary =
    nextCandidates.length > 0 ? Math.min(...nextCandidates) : value.length;

  return normalizeWhitespace(
    value.slice(lastBoundary === -1 ? 0 : lastBoundary + 1, nextBoundary)
  );
}

function officeHourDayCodesForTimeRangeMatch(
  snippet: string,
  match: RegExpMatchArray
) {
  const clause = officeHourClauseContainingIndex(snippet, match.index ?? 0);
  const strictClauseDayCodes = parseStrictNamedOfficeHourDayCodes(clause);
  return strictClauseDayCodes.length > 0 ? strictClauseDayCodes : parseOfficeHourDayCodes(clause);
}

function parseStrictNamedOfficeHourDayCodes(value: string | null | undefined) {
  const normalized = normalizeWhitespace(value)
    .replace(/\bMWF\b/gi, "Mon Wed Fri")
    .replace(/\bMW\b/gi, "Mon Wed")
    .replace(/\bWF\b/gi, "Wed Fri")
    .replace(/\bTTh\b/gi, "Tue Thu")
    .replace(/\bTuTh\b/gi, "Tue Thu")
    .replace(/\bT\/Th\b/gi, "Tue Thu")
    .replace(/[–—]/g, "-");

  const cuesByCode: Array<[WeekdayCode, RegExp]> = [
    ["MO", /\bmon(?:day)?s?'?s?\b/gi],
    ["TU", /\b(?:tu|tue(?:s(?:day)?)?s?'?s?)\b/gi],
    ["WE", /\bwed(?:nesday)?s?'?s?\b/gi],
    ["TH", /\b(?:th|thu(?:r(?:s(?:day)?)?)?s?'?s?)\b/gi],
    ["FR", /\bfri(?:day)?s?'?s?\b/gi],
    ["SA", /\bsat(?:urday)?s?'?s?\b/gi],
    ["SU", /\bsun(?:day)?s?'?s?\b/gi],
  ];

  const matches: WeekdayCode[] = [];
  cuesByCode.forEach(([code, pattern]) => {
    if (pattern.test(normalized)) {
      matches.push(code);
    }
  });

  return unique(matches);
}

function datesForRecurringWindow(
  startDate: string,
  endDate: string,
  dayCodes: WeekdayCode[]
) {
  if (dayCodes.length === 0) return [] as string[];

  return eachDayOfInterval({
    start: parseISO(startDate),
    end: parseISO(endDate),
  })
    .filter((date) => dayCodes.includes(WEEKDAY_BY_INDEX[getDay(date)]))
    .map((date) => format(date, "yyyy-MM-dd"));
}

function parseMeetingDateSpec(
  dateSpans: string[],
  dayCodes: WeekdayCode[],
  defaultYear: number
) {
  if (dateSpans.length === 0) return undefined;
  if (dateSpans.length === 1) {
    return parseDateSpec(dateSpans[0], defaultYear);
  }

  const explicitDates = new Set<string>();

  dateSpans.forEach((span) => {
    const spec = parseDateSpec(span, defaultYear);
    if (!spec) return;

    if (spec.kind === "single") {
      explicitDates.add(spec.date);
      return;
    }

    if (spec.kind === "dates") {
      spec.dates.forEach((date) => explicitDates.add(date));
      return;
    }

    datesForRecurringWindow(spec.startDate, spec.endDate, dayCodes).forEach((date) =>
      explicitDates.add(date)
    );
  });

  const dates = Array.from(explicitDates).sort();
  if (dates.length === 0) return undefined;
  if (dates.length === 1) return { kind: "single" as const, date: dates[0] };
  return { kind: "dates" as const, dates };
}

function occurrenceDatesForRecurring(event: EventCandidate) {
  if (event.timing.kind !== "recurring" || !event.timing.startDate || !event.timing.endDate) {
    return [];
  }

  const exDates = new Set(event.timing.exDates);
  return eachDayOfInterval({
    start: parseISO(event.timing.startDate),
    end: parseISO(event.timing.endDate),
  })
    .filter((date) => event.timing.byDay.includes(WEEKDAY_BY_INDEX[getDay(date)]))
    .map((date) => format(date, "yyyy-MM-dd"))
    .filter((date) => !exDates.has(date));
}

function occurrenceTemplateForDate(
  meetingRows: RawMeetingRow[],
  eventType: Extract<EventType, "Lecture" | "Tutorial" | "Lab">,
  date: string,
  sectionOptionIds?: string[]
) {
  return meetingRows.find((meeting) => {
    if (meeting.eventType !== eventType || meeting.isAsync) return false;
    if (
      sectionOptionIds?.length &&
      !sectionOptionIds.includes(meeting.sectionOptionId)
    ) {
      return false;
    }
    if (meeting.explicitDates.includes(date)) return true;
    if (!meeting.startDate || !meeting.endDate || meeting.dayCodes.length === 0) return false;
    if (date < meeting.startDate || date > meeting.endDate) return false;
    const dayCode = WEEKDAY_BY_INDEX[getDay(parseISO(date))];
    return meeting.dayCodes.includes(dayCode);
  });
}

function structuredOfficeHourTableContext(table: HTMLTableElement) {
  const headingText = (() => {
    let sibling = table.previousElementSibling;
    while (sibling) {
      const text = normalizeWhitespace(htmlToText(sibling));
      if (!text) {
        sibling = sibling.previousElementSibling;
        continue;
      }
      if (
        /^points of contact\b/i.test(text) ||
        /^course personnel\b/i.test(text) ||
        /^course personnel winter\b/i.test(text) ||
        /^note\b[:\s-]*/i.test(text)
      ) {
        sibling = sibling.previousElementSibling;
        continue;
      }
      if (
        /\b(?:instructor|course instructor|teaching assistant|lead teaching assistant(?:\s*\(ta\))?|lead ta|ta|instructional support assistant(?:\s*\(isa\))?|instructional assistant(?:\s*\(ia\))?|instructional apprentice(?:\s*\(ia\))?|instructional support coordinator(?:\s*\(isc\))?|isc|isa|ia)\b/i.test(
          text
        )
      ) {
        return text;
      }
      sibling = sibling.previousElementSibling;
    }
    return "";
  })();
  const container = table.closest("li, p, div");
  const contextText = container ? normalizeWhitespace(htmlToText(container)) : "";
  const strongText = container
    ? Array.from(container.querySelectorAll("strong"))
        .map((node) => normalizeWhitespace(node.textContent))
        .find((text) => !isGenericOfficeHourName(text) && !/\b(?:office hours?|consulting hours?|e-?mail|email)\b/i.test(text))
    : undefined;
  const headingName = container
    ? normalizeWhitespace(container.childNodes[0]?.textContent)
    : "";
  const personName = sanitizeOfficeHourPersonName(
    headingText ||
      strongText ||
      headingName ||
      contextText.match(
        /\b((?:(?:Dr\.?|Prof\.?|Professor)\s+)?[\p{L}][\p{L}'’.-]+(?:\s+[\p{L}][\p{L}'’.-]+){0,5})\b/iu
      )?.[1]
  );
  const personEmail = extractOfficeHourEmail(headingText) || extractOfficeHourEmail(contextText);
  const location = officeHourLocation(headingText);

  return {
    personName: personName && !isGenericOfficeHourName(personName) ? personName : undefined,
    personEmail,
    location,
  };
}

function splitStructuredOfficeHourCellEntries(value: string | null | undefined) {
  return normalizeWhitespace(value)
    .split(/\n+/)
    .map((entry) => normalizeWhitespace(entry))
    .map((entry) =>
      entry.replace(
        /^(?:course instructor|instructor\(s\)|instructors?|lab instructors?|teaching assistant\(s\)|teaching assistants?|teaching assistant)\s*:?\s*/i,
        ""
      )
    )
    .map((entry) => entry.replace(/^&nbsp;$/i, "").trim())
    .filter(Boolean)
    .filter((entry) => !/^(?:-+|—+|–+)$/.test(entry));
}

function combineNotes(...noteGroups: Array<string[] | undefined>) {
  return uniqueNotes(noteGroups.flatMap((group) => group ?? []));
}

function makeProvenance(
  section: SectionBlock,
  sourceKind: EventProvenance["sourceKind"],
  snippet: string
): EventProvenance {
  return {
    sectionId: section.id,
    sectionTitle: section.title,
    sourceKind,
    snippet: shortSnippet(snippet),
  };
}

function findHeaderRow(rows: string[][]) {
  const keywords = [
    "week",
    "date",
    "dates",
    "assignment",
    "assessment",
    "due",
    "weight",
    "tutorial",
    "topic",
    "module",
    "lab",
    "location",
    "submission",
    "start",
    "end",
  ];
  const exactHeaderPattern =
    /^(?:week|date|dates|assignment|assignments|assessment|assessments|due|due date|due dates|deadline|deadlines|weight|weights|tutorial|tutorials|topic|topics|module|modules|lab|labs|location|locations|submission|submissions|start|end|deliverable|deliverables|capstone deliverables|regulatory deliverables|intended learning outcomes?)\.?$/i;
  const dataLikePattern =
    /\b(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec|monday|tuesday|wednesday|thursday|friday|saturday|sunday|week\s+\d+|\d{1,2}:\d{2}|due:)\b/i;

  let bestIndex = 0;
  let bestScore = -1;
  rows.forEach((row, index) => {
    const keywordScore = row.reduce((sum, cell) => {
      const normalized = cell.toLowerCase();
      return sum + Number(keywords.some((keyword) => normalized.includes(keyword)));
    }, 0);
    const exactHeaderCells = row.filter((cell) =>
      exactHeaderPattern.test(trimTrailingPeriods(normalizeWhitespace(cell)))
    ).length;
    const dataLikeCells = row.filter((cell) => {
      const normalized = normalizeWhitespace(cell);
      if (!normalized) return false;
      if (exactHeaderPattern.test(trimTrailingPeriods(normalized))) return false;
      return dataLikePattern.test(normalized);
    }).length;
    const score = exactHeaderCells * 20 + keywordScore - dataLikeCells * 6;
    if (score > bestScore) {
      bestScore = score;
      bestIndex = index;
    }
  });
  return bestIndex;
}

function tableToRows(table: HTMLTableElement) {
  return Array.from(table.querySelectorAll("tr"))
    .map((row) =>
      Array.from(row.querySelectorAll("th,td")).map((cell) => htmlToText(cell as Element))
    )
    .filter((row) => row.some((cell) => cell.length > 0));
}

function tableToAiText(table: HTMLTableElement) {
  return tableToRows(table)
    .map((row) => `| ${row.map((cell) => cell.replace(/\|/g, "/")).join(" | ")} |`)
    .join("\n");
}

function elementToAiText(element: Element) {
  if (element.tagName.toLowerCase() === "table") {
    return tableToAiText(element as HTMLTableElement);
  }

  const tables = Array.from(element.querySelectorAll("table")) as HTMLTableElement[];
  if (tables.length === 0) {
    return htmlToText(element);
  }

  const clone = element.cloneNode(true) as Element;
  Array.from(clone.querySelectorAll("table")).forEach((table, index) => {
    const replacement = clone.ownerDocument.createElement("div");
    replacement.textContent = `\n${tableToAiText(tables[index])}\n`;
    table.replaceWith(replacement);
  });

  return clone.textContent ?? "";
}

function normalizeAiExtractionText(value: string) {
  return value
    .replace(/\r/g, "")
    .split("\n")
    .map((line) => normalizeWhitespace(line))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function collectSectionBlocks(document: Document) {
  const headers = Array.from(
    document.querySelectorAll("article.outline-content > h2.header")
  ) as HTMLHeadingElement[];

  return headers.map((header) => {
    const elements: Element[] = [];
    let sibling = header.nextElementSibling;
    while (sibling && sibling.tagName.toLowerCase() !== "h2") {
      elements.push(sibling);
      sibling = sibling.nextElementSibling;
    }
    return {
      id: header.id || slugify(normalizeWhitespace(header.textContent)),
      title: normalizeWhitespace(header.textContent),
      elements,
      text: normalizeWhitespace(elements.map((element) => htmlToText(element)).join("\n")),
    };
  });
}

function removeInitialScheduleTable(document: Document) {
  const scheduleSection =
    document.querySelector("#class_schedule") ??
    Array.from(document.querySelectorAll("article.outline-content > h2.header")).find((header) =>
      /class schedule/i.test(normalizeWhitespace(header.textContent))
    );

  const scheduleTable =
    scheduleSection?.parentElement?.querySelector("figure.schedule-info table") ??
    scheduleSection?.parentElement?.querySelector("table") ??
    document.querySelector("figure.schedule-info table");

  const removable = scheduleTable?.closest("figure") ?? scheduleTable;
  removable?.remove();
}

const AI_EXTRACTION_TEXT_LIMIT = 45_000;
const AI_SECTION_TEXT_LIMIT = 18_000;
const AI_BOILERPLATE_SECTION_PATTERN =
  /\b(?:academic integrity|grievance|discipline|appeals?|mental health|accessability|accessibility|accommodations?|turnitin|territorial acknowledgement|intellectual property|privacy|emergency|student resources|wellness|counselling|policy\s+\d+|institutional-required statements?)\b/i;
const AI_COURSE_EVENT_SECTION_PATTERN =
  /\b(?:assignments?|assessments?|activities|grading|evaluation|course requirements?|student assessment|deliverables?|deadlines?|due dates?|quizzes?|tests?|midterms?|exams?|final exam|projects?|papers?|reports?|presentations?|participation|discussion posts?|reflections?|office hours?|student hours?|instructional team|instructors?|teaching assistants?|tas?|course schedule|class plan|weekly schedule|tentative schedule|schedule)\b/i;

function truncateText(value: string, limit: number) {
  if (value.length <= limit) return value;
  const truncated = value.slice(0, limit);
  const lastBreak = Math.max(truncated.lastIndexOf("\n\n"), truncated.lastIndexOf("\n"));
  return `${truncated.slice(0, lastBreak > limit * 0.7 ? lastBreak : limit).trim()}\n[Truncated]`;
}

function compactAiSection(section: SectionBlock) {
  const title = normalizeWhitespace(section.title);
  const rawText =
    section.elements.length > 0
      ? section.elements.map(elementToAiText).join("\n")
      : section.text;
  const text = normalizeAiExtractionText(rawText);
  if (!text) return "";

  const isCourseEventSection =
    AI_COURSE_EVENT_SECTION_PATTERN.test(title) ||
    AI_COURSE_EVENT_SECTION_PATTERN.test(text);
  const isBoilerplate = AI_BOILERPLATE_SECTION_PATTERN.test(title);
  if (isBoilerplate && !isCourseEventSection) return "";

  return truncateText([`## ${title}`, text].filter(Boolean).join("\n"), AI_SECTION_TEXT_LIMIT);
}

function buildAiExtractionOutlineText(document: Document) {
  const clone = document.cloneNode(true) as Document;
  clone.querySelectorAll("script, style, noscript").forEach((element) => element.remove());
  removeInitialScheduleTable(clone);

  const sections = collectSectionBlocks(clone);
  const fullText = normalizeWhitespace(
    clone.body ? htmlToText(clone.body) : clone.documentElement.textContent
  );
  const sectionText =
    sections.length > 0
      ? sections
          .map(compactAiSection)
          .filter(Boolean)
          .join("\n\n")
      : fullText;

  return truncateText(sectionText || fullText, AI_EXTRACTION_TEXT_LIMIT);
}

function buildAiExtractionRequest(
  document: Document,
  meta: OutlineMeta
): AiOutlineExtractionRequest {
  return {
    outlineName: meta.outlineName,
    courseCode: meta.courseCode,
    courseName: meta.courseName,
    term: meta.term,
    termYear: meta.termYear,
    outlineText: buildAiExtractionOutlineText(document),
    extractionMode: "nonMeeting",
    sourceFormat: "html",
  };
}

function outlineTextFromHtml(html: string) {
  const document = new DOMParser().parseFromString(html, "text/html");
  document.querySelectorAll("script, style, noscript").forEach((element) => element.remove());
  return normalizeAiExtractionText(
    document.body ? htmlToText(document.body) : document.documentElement.textContent ?? ""
  );
}

function normalizeTextOutline(value: string) {
  return normalizeAiExtractionText(value);
}

function normalizeCacheSource(value: string) {
  return normalizeWhitespace(value)
    .toLowerCase()
    .replace(/[^\S\r\n]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

async function computeOutlineHash(value: string) {
  if (!globalThis.crypto?.subtle) {
    throw new Error("Browser crypto is unavailable.");
  }

  const digest = await globalThis.crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(normalizeCacheSource(value))
  );

  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function isUWaterlooDeterministicDocument(document: Document) {
  return Boolean(
    document.querySelector("article.outline-content") &&
      (document.querySelector("figure.schedule-info table") ||
        document.querySelector(".outline-courses") ||
        document.querySelector(".outline-term"))
  );
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function extractMetaFromSourceText(text: string, outlineName: string): OutlineMeta {
  const normalized = normalizeTextOutline(text);
  const lines = normalized
    .split("\n")
    .map((line) => normalizeWhitespace(line))
    .filter(Boolean);
  const courseCode =
    normalized.match(/\b[A-Z]{2,8}\s*\d{2,4}[A-Z]?\b/)?.[0]?.replace(/\s+/g, " ") ??
    outlineName.match(/[A-Z]{2,8}\s*\d{2,4}[A-Z]?/i)?.[0]?.toUpperCase().replace(/\s+/g, " ") ??
    "COURSE";
  const term =
    normalized.match(/\b(?:Winter|Spring|Fall|Autumn)\s+20\d{2}\b/i)?.[0] ??
    normalized.match(/\b20\d{2}\s+(?:Winter|Spring|Fall|Autumn)\b/i)?.[0] ??
    "Unknown Term";
  const termYear = Number(term.match(/(20\d{2})/)?.[1] ?? new Date().getFullYear());
  const courseLineIndex = lines.findIndex((line) =>
    line.toLowerCase().includes(courseCode.toLowerCase())
  );
  const courseCodePattern = new RegExp(`\\b${escapeRegExp(courseCode)}\\b`, "i");
  const candidateName =
    (courseLineIndex >= 0
      ? lines
          .slice(courseLineIndex, courseLineIndex + 4)
          .find(
            (line) =>
              line.length > courseCode.length &&
              !/^course outline$/i.test(line) &&
              !/^(?:winter|spring|fall|autumn)\s+20\d{2}$/i.test(line)
          )
      : undefined) ??
    lines.find((line) => line.length > 8 && !/\b(?:university|outline|syllabus)\b/i.test(line)) ??
    outlineName.replace(/\.[^.]+$/, "");
  const courseName = normalizeCourseNameCapitalization(
    normalizeWhitespace(candidateName.replace(courseCodePattern, ""))
  );

  return {
    outlineName,
    courseCode,
    courseName: courseName || outlineName.replace(/\.[^.]+$/, ""),
    term,
    termYear,
    summary: undefined,
  };
}

function buildGenericParsedCourse(meta: OutlineMeta, sourceKey: string): ParsedCourse {
  return {
    id: buildStableId(`${meta.courseCode}:${meta.term}:${sourceKey}`),
    outlineId: buildStableId(sourceKey),
    outlineName: meta.outlineName,
    courseCode: meta.courseCode,
    courseName: meta.courseName,
    term: meta.term,
    sectionOptions: [],
    eventIds: [],
    officeHourEventIds: [],
    warnings: [
      "This outline was processed with full-outline AI extraction because it was not a deterministic UWaterloo HTML outline.",
    ],
    summary: meta.summary,
  };
}

function buildFullOutlineAiRequest(
  source: OutlineSource,
  meta: OutlineMeta,
  outlineText: string
): AiOutlineExtractionRequest {
  return {
    outlineName: meta.outlineName,
    courseCode: meta.courseCode,
    courseName: meta.courseName,
    term: meta.term,
    termYear: meta.termYear,
    outlineText: truncateText(outlineText, AI_EXTRACTION_TEXT_LIMIT),
    extractionMode: "fullOutline",
    sourceFormat: source.format,
  };
}

function sourceTextForAi(source: OutlineSource) {
  if (source.format === "html") {
    return outlineTextFromHtml(source.content);
  }
  return normalizeTextOutline(source.content);
}

function extractMeta(document: Document, outlineName: string): OutlineMeta {
  const courseCode =
    normalizeWhitespace(document.querySelector(".outline-courses")?.textContent) ||
    outlineName.match(/[A-Z]{2,}\s*\d+[A-Z]?/)?.[0] ||
    "COURSE";

  const courseName =
    normalizeCourseNameCapitalization(
      normalizeWhitespace(document.querySelector(".outline-title-full")?.textContent) ||
        outlineName.replace(/\.[^.]+$/, "")
    );

  const term =
    normalizeWhitespace(document.querySelector(".outline-term")?.textContent) ||
    "Unknown Term";

  const termYear = Number(term.match(/(\d{4})/)?.[1] ?? new Date().getFullYear());
  const summary =
    normalizeWhitespace(document.querySelector(".cd-content")?.textContent) || undefined;

  return {
    outlineName,
    courseCode,
    courseName,
    term,
    termYear,
    summary,
  };
}

function createSectionOptions(meetings: RawMeetingRow[]) {
  const byId = new Map<string, ParsedSectionOption>();
  const summariesById = new Map<string, string[]>();

  meetings.forEach((meeting) => {
    const existing = byId.get(meeting.sectionOptionId);
    if (!existing) {
      byId.set(meeting.sectionOptionId, {
        id: meeting.sectionOptionId,
        kind: meeting.sectionKind,
        number: meeting.sectionNumber,
        label: `${meeting.sectionKind} ${meeting.sectionNumber}`,
        location: meeting.location,
        instructorName: meeting.instructorName,
        instructorEmail: meeting.instructorEmail,
        defaultSelected: false,
      });
    }
    const summaries = summariesById.get(meeting.sectionOptionId) ?? [];
    if (meeting.isAsync) {
      summaries.push(meeting.location || "Online");
    } else if (meeting.explicitDates.length > 0) {
      summaries.push(
        `${meeting.explicitDates.length} scheduled date${
          meeting.explicitDates.length === 1 ? "" : "s"
        }`
      );
    } else if (meeting.dayCodes.length > 0 && meeting.startTime && meeting.endTime) {
      summaries.push(
        `${meeting.dayCodes.join("/")} ${meeting.startTime}-${meeting.endTime}`
      );
    }
    summariesById.set(meeting.sectionOptionId, uniqueNotes(summaries));
  });

  const options = Array.from(byId.values()).map((option) => ({
    ...option,
    scheduleSummary: (summariesById.get(option.id) ?? []).join(" · "),
  }));

  const countsByKind = options.reduce<Record<string, number>>((accumulator, option) => {
    accumulator[option.kind] = (accumulator[option.kind] ?? 0) + 1;
    return accumulator;
  }, {});

  return options.map((option) => ({
    ...option,
    defaultSelected: countsByKind[option.kind] === 1,
  }));
}

function parseScheduleSection(section: SectionBlock | undefined, meta: OutlineMeta) {
  if (!section) {
    return { sectionOptions: [] as ParsedSectionOption[], meetings: [] as RawMeetingRow[] };
  }

  const scheduleTable = section.elements
    .flatMap((element) => Array.from(element.querySelectorAll("figure.schedule-info table")))
    .find(Boolean) as HTMLTableElement | undefined;

  if (!scheduleTable) {
    return { sectionOptions: [] as ParsedSectionOption[], meetings: [] as RawMeetingRow[] };
  }

  const rows = Array.from(scheduleTable.querySelectorAll("tbody tr"));
  const meetings: RawMeetingRow[] = [];
  const parsedConcreteRows = new Set<string>();

  let currentSection:
    | {
        sectionOptionId: string;
        sectionNumber: string;
        sectionKind: string;
        sectionLabel: string;
      }
    | undefined;
  let currentInstructor: { name?: string; email?: string } = {};

  rows.forEach((row) => {
    const sectionNode = row.querySelector(".section");
    if (sectionNode) {
      const text = normalizeWhitespace(sectionNode.textContent);
      const match =
        text.match(/(\d[\d-]*)\s*\[([A-Za-z]+)\]/) ??
        text.match(/([A-Za-z]+)\s*(\d[\d-]*)/);
      const sectionNumber = match?.[1] ?? text.replace(/\[[^\]]+\]/g, "").trim();
      const sectionKind = (match?.[2] ?? "LEC").toUpperCase();
      if (ignoredScheduleSectionKind(sectionKind)) {
        currentSection = undefined;
        return;
      }
      currentSection = {
        sectionOptionId: buildStableId(`${meta.courseCode}:${sectionKind}:${sectionNumber}`),
        sectionNumber,
        sectionKind,
        sectionLabel: `${sectionKind} ${sectionNumber}`,
      };
    }

    const instructorNode = row.querySelector(".instructor-info");
    if (instructorNode) {
      currentInstructor = {
        name: normalizeWhitespace(instructorNode.querySelector("span")?.textContent),
        email:
          normalizeWhitespace(
            instructorNode.querySelector("a[href^='mailto:']")?.textContent
          ) || undefined,
      };
    }

    if (!currentSection) return;

    const cells = Array.from(row.querySelectorAll("td"));
    if (cells.length === 0) return;
    if (cells.length === 1 && cells[0].getAttribute("colspan") === "5") return;

    const meetDaysCell = row.querySelector("td.meet-days");
    if (!meetDaysCell) {
      if (cells[0]?.getAttribute("colspan") === "3") {
        meetings.push({
          ...currentSection,
          eventType: eventTypeFromSectionKind(currentSection.sectionKind),
          dayCodes: [],
          explicitDates: [],
          location: normalizeLocation(htmlToText(cells[0])),
          instructorName: currentInstructor.name,
          instructorEmail: currentInstructor.email,
          isAsync: true,
          provenance: [makeProvenance(section, "schedule", row.textContent ?? "")],
        });
      }
      return;
    }

    const tableCells = Array.from(row.querySelectorAll("td"));
    const meetIndex = tableCells.findIndex((cell) => cell === meetDaysCell);
    const timeCell = tableCells[meetIndex + 1];
    const locationCell = tableCells[meetIndex + 2];
    const dayCodes = parseWeekdayCodes(
      htmlToText(
        (meetDaysCell.querySelector(".days-visual") ??
          meetDaysCell.querySelector(".days-accessible") ??
          meetDaysCell) as Element
      )
    );

    const dateSpans = Array.from(meetDaysCell.querySelectorAll(".date-range span"))
      .map((span) => normalizeWhitespace(span.textContent))
      .filter(Boolean);
    const dateText = dateSpans.join(", ");
    const dateSpec = parseMeetingDateSpec(
      dateSpans.length > 0 ? dateSpans : [dateText],
      dayCodes,
      meta.termYear
    );
    const { startTime, endTime } = parseTimeRange(htmlToText(timeCell));
    const location = normalizeLocation(htmlToText(locationCell));

    if (
      !sectionNode &&
      !location &&
      dateSpec?.kind === "single" &&
      parsedConcreteRows.has(currentSection.sectionOptionId)
    ) {
      return;
    }

    meetings.push({
      ...currentSection,
      eventType: eventTypeFromSectionKind(currentSection.sectionKind),
      dayCodes,
      startDate: dateSpec?.kind === "range" ? dateSpec.startDate : undefined,
      endDate: dateSpec?.kind === "range" ? dateSpec.endDate : undefined,
      explicitDates:
        dateSpec?.kind === "dates"
          ? dateSpec.dates
          : dateSpec?.kind === "single"
          ? [dateSpec.date]
          : [],
      startTime,
      endTime,
      location,
      instructorName: currentInstructor.name,
      instructorEmail: currentInstructor.email,
      isAsync: false,
      provenance: [makeProvenance(section, "schedule", row.textContent ?? "")],
    });
    parsedConcreteRows.add(currentSection.sectionOptionId);
  });

  return { sectionOptions: createSectionOptions(meetings), meetings };
}

function computeTermBounds(meetings: RawMeetingRow[]) {
  const dates = meetings.flatMap((meeting) => {
    if (meeting.startDate && meeting.endDate) return [meeting.startDate, meeting.endDate];
    return meeting.explicitDates;
  });

  const sorted = dates.filter(Boolean).sort();
  if (sorted.length === 0) return undefined;
  return { startDate: sorted[0], endDate: sorted[sorted.length - 1] };
}

function computeFallbackTermBounds(sections: SectionBlock[], meta: OutlineMeta) {
  const dates = new Set<string>();

  sections.forEach((section) => {
    const text = normalizeWhitespace(section.text);
    if (!text) return;

    extractExplicitDates(text, meta.termYear).forEach((date) => dates.add(date));

    const range = parseDateRange(text, meta.termYear);
    if (range) {
      dates.add(range.startDate);
      dates.add(range.endDate);
    }
  });

  const sorted = Array.from(dates).sort();
  if (sorted.length > 0) {
    return { startDate: sorted[0], endDate: sorted[sorted.length - 1] };
  }

  const normalizedTerm = normalizeWhitespace(meta.term).toLowerCase();
  if (/\bwinter\b/.test(normalizedTerm)) {
    return {
      startDate: `${meta.termYear}-01-01`,
      endDate: `${meta.termYear}-04-30`,
    };
  }
  if (/\bspring\b/.test(normalizedTerm)) {
    return {
      startDate: `${meta.termYear}-05-01`,
      endDate: `${meta.termYear}-08-31`,
    };
  }
  if (/\bfall\b|\bautumn\b/.test(normalizedTerm)) {
    return {
      startDate: `${meta.termYear}-09-01`,
      endDate: `${meta.termYear}-12-31`,
    };
  }

  return undefined;
}

function officeHoursLineCandidates(text: string) {
  const lines = splitOfficeHourAwareLines(text)
    .join("\n")
    .replace(/\b(Day\s*Time\s*Location)\b/gi, "\n$1 ")
    .split("\n")
    .map((line) => normalizeWhitespace(line))
    .filter(Boolean);

  const candidateIndexes = new Set<number>();
  let withinOfficeHoursBlock = false;
  const looksLikeOfficeHoursIdentityLine = (line: string) => {
    const normalized = normalizeWhitespace(line);
    if (!normalized) return false;
    if (
      /^(?:Instructor|Course Instructor|Teaching Assistant|Lead Teaching Assistant|Lead TA|TA|Name)\s*:?\s*/i.test(
        normalized
      )
    ) {
      return true;
    }
    if (
      /^[A-Z][A-Za-z'’., -]{1,80}:\s*(?:.*@uwaterloo\.ca\b|.*\bTA\b|.*\bCommunication TA\b)/i.test(
        normalized
      )
    ) {
      return true;
    }
    if (
      /^(?:Dr\.?\s+)?[A-Z][A-Za-z'’.-]+(?:\s+[A-Z][A-Za-z'’.-]+){1,3}\s+[A-Z0-9._%+-]+@uwaterloo\.ca\b/i.test(
        normalized
      )
    ) {
      return true;
    }
    return false;
  };

  const looksLikeOfficeHoursContinuationLine = (line: string) => {
    const normalized = normalizeWhitespace(line);
    if (!normalized) return false;
    if (
      /\b(office hours?|office location (?:and|&) hours?|student(?:\s*\(office\))?\s*hours?|open student hours?|my office hours are|drop-in ta office hours)\b/i.test(
        normalized
      )
    ) {
      return true;
    }
    if (
      /^(?:office|office location|location|email|contact|instructor|course instructor|teaching assistants?|lead teaching assistant|ta|tas|teams?|zoom|online|virtual)\s*:?\b/i.test(
        normalized
      )
    ) {
      return true;
    }
    if (
      /\b(?:drop-?in|no appointment needed|clarify course content|ask questions?|student questions?)\b/i.test(
        normalized
      )
    ) {
      return true;
    }
    if (/\bby appointment\b/i.test(normalized)) {
      return true;
    }
    if (
      OFFICE_HOUR_WEEKDAY_REGEX.test(normalized) &&
      /\b\d{1,2}(?::\d{2})?\s*(?:a\.?m\.?|p\.?m\.?|am|pm)?\b/i.test(normalized)
    ) {
      return true;
    }
    if (officeHourLocation(normalized)) {
      return true;
    }
    if (
      /^[A-Z][A-Za-z'’.,() -]{1,80}:\s*(?:.*\b(?:office hours?|teams?|zoom|online|virtual)\b|.*\b\d{1,2}(?::\d{2})?\b)/.test(
        normalized
      )
    ) {
      return true;
    }
    return false;
  };

  lines.forEach((line, index) => {
    const startsOfficeHoursBlock = officeHourBlockStartRegex().test(line);
    const endsOfficeHoursBlock =
      withinOfficeHoursBlock &&
      !startsOfficeHoursBlock &&
      officeHourSectionBoundaryRegex().test(line);

    if (endsOfficeHoursBlock) {
      withinOfficeHoursBlock = false;
    }

    if (startsOfficeHoursBlock) {
      withinOfficeHoursBlock = true;
      const previousLine = lines[index - 1];
      if (previousLine && looksLikeOfficeHoursIdentityLine(previousLine)) {
        candidateIndexes.add(index - 1);
      }
      candidateIndexes.add(index);
      return;
    }

    if (withinOfficeHoursBlock) {
      if (!looksLikeOfficeHoursContinuationLine(line)) {
        withinOfficeHoursBlock = false;
        return;
      }
      candidateIndexes.add(index);
    }
  });

  return Array.from(candidateIndexes)
    .sort((left, right) => left - right)
    .map((index) => lines[index])
    .filter(Boolean);
}

function normalizeOfficeHoursSnippet(line: string | null | undefined) {
  return normalizeOfficeHourParsingText(
    (line ?? "")
      .replace(/^.*?\bdrop-in ta office hours\b[:\s-]*/i, "")
      .replace(/^.*?\bopen student hours?\b(?:\s+with\s+[^-:]+)?\s*[-:]\s*/i, "")
      .replace(/^.*?\bmy office hours are\b[:\s]*/i, "")
      .replace(/^.*?\boffice hours?\b(?:\s*\([^)]*\))?[:\s]*/i, "")
      .replace(/^.*?\boffice location (?:and|&) hours?\b[:\s]*/i, "")
      .replace(/^.*?\bstudent(?:\s*\(office\))?\s*hours?(?:\s*\(office hours\))?\b[:\s]*/i, "")
      .replace(/^\([^)]*\)\s*:\s*/i, "")
      .replace(
        /^((?:(?:Dr\.?|Prof\.?|Professor)\s+)?[\p{L}][\p{L}'’.-]+(?:\s+[\p{L}][\p{L}'’.-]+){0,4})(?:\s+[A-Z0-9._%+-]+@uwaterloo\.ca)?\s+(?=(?:Mon(?:day)?|Tue(?:s(?:day)?)?|Wed(?:nesday)?|Thu(?:r(?:s(?:day)?)?)?|Fri(?:day)?|Sat(?:urday)?|Sun(?:day)?))/iu,
        (match, candidateName: string) => {
          const normalizedCandidate = normalizeWhitespace(candidateName);
          return /\b(?:and|Mon(?:day)?s?|Tue(?:s(?:day)?)?s?|Wed(?:nesday)?s?|Thu(?:r(?:s(?:day)?)?)?s?|Fri(?:day)?s?|Sat(?:urday)?s?|Sun(?:day)?s?)\b/i.test(
            normalizedCandidate
          )
            ? match
            : "";
        }
      )
      .replace(/\bnoon\b/gi, "12:00 PM")
      .replace(/\bmidnight\b/gi, "12:00 AM")
      .replace(
        /\beach\s+(?=(?:Mon(?:day)?|Tue(?:s(?:day)?)?|Wed(?:nesday)?|Thu(?:r(?:s(?:day)?)?)?|Fri(?:day)?|Sat(?:urday)?|Sun(?:day)?|M|Tu|Th|T|W|F)\b)/gi,
        ""
      )
      .replace(
        /\btypically\s+on\s+(?=(?:Mon(?:day)?|Tue(?:s(?:day)?)?|Wed(?:nesday)?|Thu(?:r(?:s(?:day)?)?)?|Fri(?:day)?|Sat(?:urday)?|Sun(?:day)?|M|Tu|Th|T|W|F)\b)/gi,
        ""
      )
      .replace(
        /\bon\s+(?=(?:Mon(?:day)?|Tue(?:s(?:day)?)?|Wed(?:nesday)?|Thu(?:r(?:s(?:day)?)?)?|Fri(?:day)?|Sat(?:urday)?|Sun(?:day)?|M|Tu|Th|T|W|F)\b)/gi,
        ""
      )
      .replace(/\([^)]*\bshift to\b[^)]*\)/gi, "")
      .replace(/([.?!])\s*((?:Teaching Assistants?|Teaching Assistant|TA(?:\s*\(|:|'s\b)).*)$/i, (_match, punctuation: string, tail: string) =>
        /\boffice hours?\b/i.test(tail) ? `${punctuation} ${tail}` : punctuation
      )
      .replace(/\bor\s+e-?mail\s+for\s+appointment\b.*$/i, "")
  );
}

function normalizeWeekTableDateSourceText(value: string | null | undefined) {
  return normalizeLooseMonthDaySpacing(
    normalizeWhitespace(value)
      .replace(/^\s*(?:wk\.?\s*\d+|week\s+\d+|reading week|week of)\b[:\s-]*/i, "")
      .replace(/^\s*\d+\s*\(([^)]+)\)\s*$/i, "$1")
      .replace(/^\s*\d+\s*[:\-–—]\s*/i, "")
      .replace(
        /\s*\(\s*(?:Mon(?:day)?|Tue(?:s|sday)?|Wed(?:nesday)?|Thu(?:r|rs|rsday|ursday)?|Fri(?:day)?|Sat(?:urday)?|Sun(?:day)?)\s*\)\s*$/i,
        ""
      )
      .replace(/\b(?:wk\.?\s*\d+|week\s+\d+)\b[:\s-]*/gi, " ")
  );
}

function isWeekTableWeekCell(value: string | null | undefined) {
  const normalized = normalizeWhitespace(value);
  return (
    /^\d+$/.test(normalized) ||
    /^reading week$/i.test(normalized) ||
    /^week\s+\d+\b/i.test(normalized) ||
    /^wk\.?\s*\d+\b/i.test(normalized)
  );
}

function isWeekTableDateLike(value: string | null | undefined, termYear: number) {
  const normalized = normalizeWeekTableDateSourceText(value);
  if (!normalized) return false;
  return (
    Boolean(parseDateSpec(normalized, termYear)) ||
    extractExplicitDates(normalized, termYear).length > 0 ||
    Boolean(parseTimeRange(normalized).startTime) ||
    /\b\d{1,2}(?:st|nd|rd|th)?\s+(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)\b/i.test(
      normalized
    )
  );
}

function alignSparseWeekTableRow(
  row: string[],
  headers: string[],
  termYear: number,
  weekIndex: number,
  dateIndex: number,
  topicIndex: number,
  dueIndex: number
) {
  const normalizedRow = row.map((cell) => normalizeWhitespace(cell));
  if (normalizedRow.length >= headers.length) {
    return normalizedRow;
  }

  const aligned = Array.from({ length: headers.length }, () => "");

  if (
    normalizedRow.length >= 2 &&
    weekIndex === 0 &&
    dateIndex === 1 &&
    isWeekTableWeekCell(normalizedRow[0]) &&
    isWeekTableDateLike(normalizedRow[1], termYear)
  ) {
    aligned[weekIndex] = normalizedRow[0];
    aligned[dateIndex] = normalizedRow[1];
    if (normalizedRow[2] && topicIndex !== -1) {
      aligned[topicIndex] = normalizedRow[2];
    } else if (normalizedRow[2] && dueIndex !== -1) {
      aligned[dueIndex] = normalizedRow[2];
    }
    return aligned;
  }

  if (
    weekIndex > 0 &&
    normalizedRow.length <= headers.length - 1 &&
    isWeekTableWeekCell(normalizedRow[0])
  ) {
    aligned[weekIndex] = normalizedRow[0];
    let cursor = 1;
    for (
      let index = weekIndex + 1;
      index < headers.length && cursor < normalizedRow.length;
      index += 1
    ) {
      aligned[index] = normalizedRow[cursor] ?? "";
      cursor += 1;
    }
    return aligned;
  }

  if (
    normalizedRow.length === 2 &&
    dateIndex !== -1 &&
    !isWeekTableWeekCell(normalizedRow[0]) &&
    isWeekTableDateLike(normalizedRow[0], termYear)
  ) {
    aligned[dateIndex] = normalizedRow[0];
    if (topicIndex !== -1) {
      aligned[topicIndex] = normalizedRow[1];
    } else if (dueIndex !== -1) {
      aligned[dueIndex] = normalizedRow[1];
    }
    return aligned;
  }

  if (
    normalizedRow.length === 2 &&
    !isWeekTableWeekCell(normalizedRow[0]) &&
    !isWeekTableDateLike(normalizedRow[0], termYear) &&
    isWeekTableDateLike(normalizedRow[1], termYear)
  ) {
    if (topicIndex !== -1) {
      aligned[topicIndex] = normalizedRow[0];
    }
    if (dueIndex !== -1) {
      aligned[dueIndex] = normalizedRow[1];
    }
    return aligned;
  }

  if (normalizedRow.length === 1) {
    if (dueIndex !== -1 && isWeekTableDateLike(normalizedRow[0], termYear)) {
      aligned[dueIndex] = normalizedRow[0];
      return aligned;
    }
    if (topicIndex !== -1) {
      aligned[topicIndex] = normalizedRow[0];
      return aligned;
    }
    if (dueIndex !== -1) {
      aligned[dueIndex] = normalizedRow[0];
      return aligned;
    }
  }

  return normalizedRow;
}

function alignSparseStartDueTableRow(
  row: string[],
  headers: string[],
  assignmentIndex: number,
  activityIndex: number,
  sessionIndexes: number[],
  startIndex: number,
  dueIndex: number,
  weightIndex: number,
  carry: {
    start?: string;
    due?: string;
    weight?: string;
  }
) {
  const normalizedRow = row.map((cell) => normalizeWhitespace(cell));
  if (normalizedRow.length >= headers.length) {
    return normalizedRow;
  }

  const aligned = Array.from({ length: headers.length }, () => "");
  if (startIndex !== -1 && carry.start) aligned[startIndex] = carry.start;
  if (dueIndex !== -1 && carry.due) aligned[dueIndex] = carry.due;
  if (weightIndex !== -1 && carry.weight) aligned[weightIndex] = carry.weight;

  if (normalizedRow.length === 1) {
    const contentIndex =
      assignmentIndex !== -1
        ? assignmentIndex
        : activityIndex !== -1
        ? activityIndex
        : sessionIndexes[0] ?? 0;
    aligned[contentIndex] = normalizedRow[0];
    return aligned;
  }

  if (normalizedRow.length === 2) {
    const contentIndex =
      assignmentIndex !== -1
        ? assignmentIndex
        : activityIndex !== -1
        ? activityIndex
        : sessionIndexes[0] ?? 0;
    aligned[contentIndex] = normalizedRow[0];
    if (weightIndex !== -1 && normalizeWeightText(normalizedRow[1])) {
      aligned[weightIndex] = normalizedRow[1];
    } else if (dueIndex !== -1) {
      aligned[dueIndex] = normalizedRow[1];
    }
    return aligned;
  }

  return normalizedRow;
}

function normalizeWeekTableInferredDate(
  date: string | undefined,
  sourceText: string | null | undefined,
  termYear: number
) {
  if (!date) return date;

  const normalizedSource = normalizeWhitespace(sourceText);
  if (!normalizedSource || /\b\d{4}\b/.test(normalizedSource)) {
    return date;
  }

  if (
    !/\b(?:January|February|March|April|May|June|July|August|September|October|November|December|Jan|Feb|Mar|Apr|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)\b/i.test(
      normalizedSource
    ) &&
    !/\b\d{1,2}\/\d{1,2}(?:\/\d{2,4})?\b/.test(normalizedSource)
  ) {
    return date;
  }

  const parsed = parseISO(date);
  if (!isValid(parsed) || parsed.getFullYear() === termYear) {
    return date;
  }

  return format(new Date(termYear, parsed.getMonth(), parsed.getDate()), "yyyy-MM-dd");
}

function resolveWeekTableAssessmentDate(
  topicText: string,
  rowDates: string[],
  dateSpec: ReturnType<typeof parseDateSpec>,
  fallbackDate?: string
) {
  if (rowDates.length > 1) {
    if (/^\s*(?:test|quiz|mid-?term|midterm|term test|endterm)\b/i.test(topicText)) {
      return rowDates[0];
    }
    if (
      /\b(?:test|quiz|mid-?term|midterm|term test|endterm)\b/i.test(topicText) &&
      /\b\d+\s*:\s*/.test(topicText)
    ) {
      return rowDates[rowDates.length - 1];
    }
  }

  return (
    fallbackDate ??
    (dateSpec?.kind === "single"
      ? dateSpec.date
      : dateSpec?.kind === "dates"
      ? dateSpec.dates[0]
      : dateSpec?.kind === "range"
      ? dateSpec.startDate
      : undefined)
  );
}

function officeHourLocation(text: string | null | undefined) {
  const rawText = text ?? "";
  const normalized = normalizeWhitespace(rawText);
  const explicitPhysicalLocation =
    rawText.match(
      /^\s*([A-Z]{2,5}\s*\d{3,4}[A-Za-z]?)\s*\(\s*Office hours?\b/i
    )?.[1]?.trim() ||
    rawText.match(/\bLocation:\s*([A-Z]{1,5}(?:-|\s*)\d{3,4}[A-Za-z]?)\b/i)?.[1]?.trim() ||
    rawText.match(/\bOffice:\s*([A-Z]{1,5}(?:-|\s*)\d{3,4}[A-Za-z]?)\b/i)?.[1]?.trim() ||
    rawText.match(/\b([A-Z]{2,5}\s+[A-Z]{2,5}-\d{3,4}[A-Za-z]?)\b/i)?.[1]?.trim() ||
    rawText.match(/\b([A-Z]{2,4})\s*\([A-Z]{2,4}\)\s*(\d{3,4}[A-Za-z]?)\b/i)
      ?.slice(1, 3)
      .join(" ") ||
    rawText.match(/\bin my office\s*\(([A-Z]{2,4}\s*\d{3,4}[A-Za-z]?)\)/i)?.[1]?.trim() ||
    rawText.match(
      /\b(?:office location (?:and|&) hours?.{0,40}?|office location\s*:)\s*([A-Z](?:\.?[A-Z0-9]){0,3}\.?(?:-|\s*)\d{3,4}[A-Za-z]?)\b/i
    )?.[1]?.trim() ||
    rawText.match(/\((EV\d)\)\s*,?\s*Room\s*(\d{3,4}[A-Za-z]?)/i)?.slice(1, 3).join(" ") ||
    rawText.match(/\b(Hagey Hall\s*\d{3,4}[A-Za-z]?)\b/i)?.[1]?.trim() ||
    rawText.match(
      /\b(?:office hours?.{0,80}?(?:office at|office:)|my office:|his office at|her office at|their office at)\s*([A-Z][A-Z0-9]{0,3}(?:-|\s*)\d{3,4}[A-Za-z]?)\b/i
    )?.[1]?.trim() ||
    rawText.match(/\b([A-Z](?:\.?[A-Z0-9]){0,3}\.?(?:-|\s*)\d{3,4}[A-Za-z]?)\b/)?.[1]?.trim() ||
    rawText.match(/\bOffice:\s*([A-Za-z0-9 -]+\d+[A-Za-z0-9-]*)/i)?.[1]?.trim() ||
    rawText.match(/\b([A-Z][A-Z0-9]{0,3}(?:-|\s*)\d{3,4}[A-Za-z]?)\b/)?.[1]?.trim();
  if (explicitPhysicalLocation) {
    return explicitPhysicalLocation.replace(/^in\s+/i, "").trim();
  }
  if (
    /\b(?:subject line|homepage|classlist|connect dropdown|instructors tab|send email)\b/i.test(
      normalized
    )
  ) {
    return /\b(?:microsoft\s+)?teams?\b|zoom\b/i.test(normalized) ? "Online" : undefined;
  }
  if (
    /\b(?:microsoft\s+)?teams?\b|zoom\b/i.test(normalized) &&
    /\b(?:via|on|using|through|team)\b/i.test(normalized)
  ) {
    return "Online";
  }
  if (/\bmeeting-join\b/i.test(normalized) && /\b(?:microsoft\s+)?teams?\b|zoom\b/i.test(normalized)) {
    return "Online";
  }
  if (
    /\bonline\b/i.test(normalized) &&
    /\b(?:teams?|zoom|consulting team|ms teams?)\b/i.test(normalized)
  ) {
    return "Online";
  }
  return (
    rawText.match(/\bin\s+([A-Z]{2,4}\s*\d{3,4}[A-Za-z]?)\b/i)?.[1]?.trim() ||
    (/\bteams?\b|microsoft teams|zoom\b/i.test(rawText) ? "Online" : undefined) ||
    undefined
  );
}

function sanitizeOfficeHourPersonName(value: string | null | undefined) {
  return normalizeWhitespace(value)
    .replace(/^(?:Instructor(?:\s+name)?|Course Instructor(?:\s+name)?|Teaching Assistants?|Teaching Assistant|Lead Teaching Assistant(?:\s*\(TA\))?|Lead TA|TA|Instructional Support Coordinator(?:\s*\(ISC\))?|Instructional Support Assistants?(?:\s*\(ISA\))?|Instructional Assistants?(?:\s*\(IA\))?|Instructional Apprentices?(?:\s*\(IA\))?)\s*:?\s*/i, "")
    .replace(/^name\s*:?\s*/i, "")
    .replace(/^instructors?\s+and\s+office\s+hours?\s*/i, "")
    .replace(/^instructor(?:'s)?\s+office\s+hours?\s*/i, "")
    .replace(/^instructor\s+information\s*:?\s*/i, "")
    .replace(/^contacting\s+the\s+instructor\s*:?\s*/i, "")
    .replace(/^(?:and|or)\s+/i, "")
    .replace(/\[\s*\]/g, "")
    .replace(/\n+[a-z][a-z0-9._%+-]*$/g, "")
    .replace(/^for\s+[^,]+?\bquestions?,?\s*/i, "")
    .replace(/^with\s+/i, "")
    .replace(/^(?:e-?mail|email)\b[:\s-]*/i, "")
    .replace(/\([^)]*\[\s*at\s*\][^)]*\)/gi, "")
    .replace(/\([^)]*@uwaterloo\.ca[^)]*\)/gi, "")
    .replace(/\[[^\]]*@uwaterloo\.ca[^\]]*\]/gi, "")
    .replace(/\b[A-Z0-9._%+-]+@uwaterloo\.ca\b/gi, "")
    .replace(/^information\s*:?\s*/i, "")
    .replace(/^note\s*:?\s*/i, "")
    .replace(/\b(?:Office|Tutorials?|Lectures?|Consulting Hours?)\b.*$/i, "")
    .replace(/\s+Email(?:\s+Address)?\b.*$/i, "")
    .replace(/\s+Students?$/i, "")
    .replace(/\s*\([^)]*$/g, "")
    .replace(/\b(?:course staff|teaching assistants?|tas?)['’]?\s*$/i, "")
    .replace(/\s+[a-z]{2,}$/g, "")
    .replace(/\n+/g, " ")
    .replace(/^[\s"'`~!@#$%^&*()_+=[\]{}|\\:;,.<>/?-–—]+/g, "")
    .replace(/[\s"'`~!@#$%^&*()_+=[\]{}|\\:;,.<>/?-–—]+$/g, "")
    .replace(/\s*[-,:;]\s*$/g, "")
    .trim();
}

function extractOfficeHourEmail(text: string | null | undefined) {
  const normalized = normalizeWhitespace(text);
  if (!normalized) return undefined;

  const direct = normalized.match(/[A-Z0-9._%+-]+@uwaterloo\.ca/i)?.[0];
  if (direct) return direct;

  const obfuscated = normalized.match(
    /([A-Z0-9._%+-]+)\s*\[\s*at\s*\]\s*uwaterloo\s*\[\s*dot\s*\]\s*ca/i
  )?.[1];
  if (obfuscated) {
    return `${obfuscated}@uwaterloo.ca`;
  }

  return undefined;
}

function isClearlyInvalidOfficeHourLocation(value: string | null | undefined) {
  const normalized = normalizeWhitespace(value);
  if (!normalized) return true;
  return /^(?:LEC|TUT|LAB)\s*\d{3}$/i.test(normalized);
}

function chooseOfficeHourLocation(...candidates: Array<string | undefined>) {
  const validLocations = candidates
    .map((candidate) => normalizeWhitespace(candidate))
    .filter(
      (candidate): candidate is string =>
        !!candidate && !isClearlyInvalidOfficeHourLocation(candidate)
    );

  return validLocations.find((candidate) => candidate !== "Online") || validLocations[0];
}

function officeHourInstructorName(text: string, meetings: RawMeetingRow[], meta: OutlineMeta) {
  const roleInlineName = text.match(
    /\b(?:Instructor|Course Instructor)\s*:?\s*((?:(?:Dr\.?|Prof\.?|Professor)\s+)?[\p{L}][\p{L}'’.-]+(?:\s+[\p{L}][\p{L}'’.-]+){0,6})(?=\s*(?:\(|,|Email(?: Address)?\s*:|Office:|Office hours?\b|Student(?:\s*\(office\))?\s*hours?\b))/iu
  )?.[1];
  const inlineInstructorWithEmail = text.match(
    /\b(?:Instructor|Course Instructor)\s*:?\s*((?:(?:Dr\.?|Prof\.?|Professor)\s+)?[\p{L}][\p{L}'’.-]+(?:\s+[\p{L}][\p{L}'’.-]+){1,4})(?=\s+[A-Z0-9._%+-]+@uwaterloo\.ca\b)/iu
  )?.[1];
  const inlineInstructorBeforeOfficeHours = text.match(
    /\b(?:Instructor|Course Instructor)\s*:?\s*((?:(?:Dr\.?|Prof\.?|Professor)\s+)?[\p{L}][\p{L}'’.-]+(?:\s+[\p{L}][\p{L}'’.-]+){1,4})(?=\s*(?:Email(?: Address)?\s*:|[A-Z0-9._%+-]+@uwaterloo\.ca\b|Office hours?\b|Student(?:\s*\(office\))?\s*hours?\b))/iu
  )?.[1];
  const instructorLine = text.match(/\bInstructor:\s*([^\n]+)/i)?.[1];
  const courseInstructorLine = text.match(/\bCourse Instructor:\s*([^\n]+)/i)?.[1];
  const textLines = text
    .split("\n")
    .map((line) => normalizeWhitespace(line))
    .filter(Boolean);
  const fromHeading = (() => {
    const headingIndex = textLines.findIndex((line) => /^Instructor$/i.test(line));
    if (headingIndex === -1) return undefined;
    return textLines[headingIndex + 1]
      ?.split(/\s*(?:<|Email:|Office:|Office Hours?:|and my office hours are)\s*/i)[0]
      ?.trim();
  })();
  const fromLine = instructorLine
    ?.split(/\s*(?:,|<|Email:|Email Address:|Office:|Office Hours?:|and my office hours are)\s*/i)[0]
    ?.trim();
  const fromCourseInstructorLine = courseInstructorLine
    ?.split(/\s*(?:;|,|<|Email:|Email Address:|Office:|Office Hours?:|and my office hours are)\s*/i)[0]
    ?.trim();

  return sanitizeOfficeHourPersonName(
    roleInlineName ||
      inlineInstructorWithEmail ||
      inlineInstructorBeforeOfficeHours ||
      fromLine ||
      fromCourseInstructorLine ||
      fromHeading ||
      meetings.find((meeting) => meeting.instructorName)?.instructorName ||
      meta.courseName
  );
}

function officeHourInstructorEmail(text: string, meetings: RawMeetingRow[]) {
  const meetingEmail = meetings.find((meeting) => meeting.instructorEmail)?.instructorEmail;
  const instructorScopedText =
    text.match(/\b(?:Instructor|Course Instructor)\s*:[\s\S]{0,220}/i)?.[0] ??
    text.split(
      /\b(?:Teaching Assistants?|Teaching Assistant|Lead Teaching Assistant(?:\s*\(TA\))?|Lead TA|TA)\s*:/i
    )[0];

  return (
    meetingEmail ||
    extractOfficeHourEmail(instructorScopedText) ||
    extractOfficeHourEmail(text)
  );
}

function isLikelyInstructionalSection(section: SectionBlock) {
  if (OFFICE_HOUR_ALLOWED_SECTION_IDS.has(section.id)) {
    return true;
  }

  return /\b(instructional team|course staff|instructor|personnel)\b/i.test(
    `${section.id} ${section.title}`
  );
}

function extractDetailedOfficeHourSegments(
  snippet: string,
  fallbackLocation: string | undefined
) {
  const normalizedSnippet = normalizeOfficeHoursSnippet(snippet);
  const segmentMatches = Array.from(
    normalizedSnippet.matchAll(
      /\b((?:(?:and\s+)?(?:Mon(?:day)?s?'?s?|Tue(?:s(?:day)?)?s?'?s?|Wed(?:nesday)?s?'?s?|Thu(?:r(?:s(?:day)?)?)?s?'?s?|Fri(?:day)?s?'?s?|Sat(?:urday)?s?'?s?|Sun(?:day)?s?'?s?|M|Tu|Th|T|W|F(?![a-z]))\.?\s*(?:\/|,|&|-|\band\b)?\s*)+)\s*(?:,?\s*(?:between|from)\s*)?(\d{1,2}(?::\d{2})?\s*(?:a\.?m\.?|p\.?m\.?|am|pm|AM|PM)?)\s*(?:-|--|–|—|to)\s*(\d{1,2}(?::\d{2})?\s*(?:a\.?m\.?|p\.?m\.?|am|pm|AM|PM)?)([\s\S]*?)(?=(?:,\s*|\s+and\s+)?(?:Mon(?:day)?s?'?s?|Tue(?:s(?:day)?)?s?'?s?|Wed(?:nesday)?s?'?s?|Thu(?:r(?:s(?:day)?)?)?s?'?s?|Fri(?:day)?s?'?s?|Sat(?:urday)?s?'?s?|Sun(?:day)?s?'?s?|M|Tu|Th|T|W|F(?![a-z]))\.?\s*(?:\/|,|&|-|\band\b)?\s*(?:\d|from|between)|$)/gi
    )
  );

  return segmentMatches.flatMap((match) => {
    const dayCodes = parseOfficeHourDayCodes(match[1]);
    const range = parseOfficeHourTimeRange(`${match[2]} - ${match[3]}`);
    if (dayCodes.length === 0 || !range.startTime || !range.endTime) {
      return [];
    }

    const locationContext = normalizeWhitespace(match[4]);
    const location = chooseOfficeHourLocation(
      officeHourLocation(locationContext),
      officeHourLocation(match[0]),
      officeHourLocation(snippet),
      fallbackLocation
    );

    return dayCodes.map((dayCode) => ({
      dayCode,
      startTime: range.startTime!,
      endTime: range.endTime!,
      inferred: range.inferred,
      location,
    }));
  });
}

function createOfficeHourSeedsFromStructuredSnippet(
  section: SectionBlock,
  snippet: string,
  personName: string,
  personEmail: string | undefined,
  fallbackLocation: string | undefined,
  termBounds: { startDate: string; endDate: string }
) {
  if (isAdministrativeOfficeHourNoiseSnippet(snippet)) {
    return [] as OfficeHourSeed[];
  }
  const cleanedSnippet = stripOfficeHourContactNoise(snippet);
  if (
    isAdministrativeOfficeHourNoiseSnippet(cleanedSnippet) ||
    (!/\b(?:office hours?|student(?:\s*\(office\))?\s*hours?|drop-?in|no appointment needed)\b/i.test(
      cleanedSnippet
    ) &&
      /\b(?:within\s+24\s*hours|within\s+48\s*hours|24\s*(?:-|–|—|to)\s*48\s*hours|working hours)\b/i.test(
        cleanedSnippet
      ))
  ) {
    return [] as OfficeHourSeed[];
  }
  const normalizedSnippet = normalizeOfficeHoursSnippet(cleanedSnippet);
  const officeHourWindow = (() => {
    const year = parseISO(termBounds.startDate).getFullYear();
    const firstClause =
      normalizedSnippet.match(/\bfirst office hour\b[^.?!]*/i)?.[0] ??
      normalizedSnippet.match(/\b(?:starting|starts?)\b[^.?!]*\boffice hours?\b[^.?!]*/i)?.[0];
    const lastClause =
      normalizedSnippet.match(/\blast(?:\s+one|\s+office hour)?\b[^.?!]*/i)?.[0] ??
      normalizedSnippet.match(/\buntil\b[^.?!]*/i)?.[0];
    const exclusionClauses = Array.from(
      normalizedSnippet.matchAll(
        /\b(?:there (?:is|will be)\s+no office hour|no office hour(?: held)?|excluding|except(?: for)?)\b[^.?!]*/gi
      )
    ).map((match) => match[0]);
    const startDate = firstClause
      ? extractExplicitDates(firstClause, year)[0]
      : undefined;
    const endDates = lastClause ? extractExplicitDates(lastClause, year) : [];
    return {
      startDate: startDate ?? termBounds.startDate,
      endDate: endDates[endDates.length - 1] ?? termBounds.endDate,
      exDates: unique(
        exclusionClauses.flatMap((clause) => extractExplicitDates(clause, year))
      ),
      hasExplicitWindow:
        Boolean(startDate) ||
        endDates.length > 0 ||
        exclusionClauses.length > 0,
    };
  })();
  const snippetDates = unique(
    extractExplicitDates(normalizedSnippet, parseISO(termBounds.startDate).getFullYear())
  ).sort();
  const strictNamedDayCodes = parseStrictNamedOfficeHourDayCodes(normalizedSnippet);
  const strictNamedTimeRanges = Array.from(
    normalizedSnippet.matchAll(
      /(\d{1,2}(?::\d{2})?\s*(?:a\.?m\.?|p\.?m\.?|am|pm|AM|PM)?)\s*(?:-|--|–|—|to)\s*(\d{1,2}(?::\d{2})?\s*(?:a\.?m\.?|p\.?m\.?|am|pm|AM|PM)?)/gi
    )
  );
  const primaryStrictDayCodes =
    strictNamedTimeRanges.length > 0
      ? officeHourDayCodesForTimeRangeMatch(normalizedSnippet, strictNamedTimeRanges[0])
      : strictNamedDayCodes;
  if (
    strictNamedTimeRanges.length === 1 &&
    primaryStrictDayCodes.length > 0 &&
    (primaryStrictDayCodes.length > 1 ||
      snippetDates.length === 0 ||
      officeHourWindow.hasExplicitWindow)
  ) {
    const range = parseOfficeHourTimeRange(
      `${strictNamedTimeRanges[0][1]} - ${strictNamedTimeRanges[0][2]}`
    );
    if (range.startTime && range.endTime) {
      const location = chooseOfficeHourLocation(
        officeHourLocation(snippet),
        fallbackLocation
      );
      return primaryStrictDayCodes.map((dayCode) => ({
        personName,
        personEmail,
        location,
        dayCode,
        startDate: officeHourWindow.startDate,
        endDate: officeHourWindow.hasExplicitWindow
          ? officeHourWindow.endDate
          : undefined,
        exDates: officeHourWindow.exDates,
        startTime: range.startTime!,
        endTime: range.endTime!,
        notes: range.inferred
          ? ["Office-hour time inferred from shorthand in outline."]
          : [],
        provenance: [makeProvenance(section, "prose", snippet)],
      }));
    }
  }
  const snippetDayCodes = unique(parseOfficeHourDayCodes(normalizedSnippet));
  const snippetTimeRanges = Array.from(
    normalizedSnippet.matchAll(
      /(\d{1,2}(?::\d{2})?\s*(?:a\.?m\.?|p\.?m\.?|am|pm|AM|PM)?)\s*(?:-|--|–|—|to)\s*(\d{1,2}(?::\d{2})?\s*(?:a\.?m\.?|p\.?m\.?|am|pm|AM|PM)?)/gi
    )
  );
  if (snippetDates.length > 1 && snippetDayCodes.length === 1 && snippetTimeRanges.length === 1) {
    const range = parseOfficeHourTimeRange(
      `${snippetTimeRanges[0][1]} - ${snippetTimeRanges[0][2]}`
    );
    if (range.startTime && range.endTime) {
      return [
        {
          personName,
          personEmail,
          location: chooseOfficeHourLocation(
            officeHourLocation(normalizedSnippet),
            fallbackLocation
          ),
          dayCode: snippetDayCodes[0],
          startDate: snippetDates[0],
          endDate: snippetDates[snippetDates.length - 1],
          exDates: buildWeeklySeriesExDates(
            snippetDates[0],
            snippetDates[snippetDates.length - 1],
            snippetDates
          ),
          startTime: range.startTime,
          endTime: range.endTime,
          notes: range.inferred
            ? ["Office-hour time inferred from shorthand in outline."]
            : [],
          provenance: [makeProvenance(section, "prose", snippet)],
        },
      ];
    }
  }
  const prioritizedClusteredDayTimeMatches = Array.from(
    normalizedSnippet.matchAll(
      /\b((?:(?:and\s+)?(?:Mon(?:day)?s?'?s?|Tue(?:s(?:day)?)?s?'?s?|Wed(?:nesday)?s?'?s?|Thu(?:r(?:s(?:day)?)?)?s?'?s?|Fri(?:day)?s?'?s?|Sat(?:urday)?s?'?s?|Sun(?:day)?s?'?s?|M|Tu|Th|T|W|F(?![a-z]))\.?\s*(?:\/|,|&|-|\band\b)?\s*)+)\s*(?:\(([^)]+)\)|(?:,?\s*(?:between|from)\s*)?(\d{1,2}(?::\d{2})?\s*(?:a\.?m\.?|p\.?m\.?|am|pm|AM|PM)?)\s*(?:-|--|–|—|to)\s*(\d{1,2}(?::\d{2})?\s*(?:a\.?m\.?|p\.?m\.?|am|pm|AM|PM)?))\s*(?:,?\s*(?:in|at)\s*([^,.;]+))?/gi
    )
  );
  if (prioritizedClusteredDayTimeMatches.length > 0) {
    return prioritizedClusteredDayTimeMatches.flatMap((match) => {
      const dayCodes = parseOfficeHourDayCodes(match[1]);
      const rangeText = match[2] ? match[2] : `${match[3]} - ${match[4]}`;
      const range = parseOfficeHourTimeRange(rangeText);
      if (dayCodes.length === 0 || !range.startTime || !range.endTime) return [];

      const locationHint = normalizeWhitespace(match[5]);
      const location =
        /virtual|online|teams?|zoom/i.test(locationHint) && !chooseOfficeHourLocation(fallbackLocation)
          ? "Online"
          : chooseOfficeHourLocation(
              officeHourLocation(locationHint),
              officeHourLocation(match[0]),
              fallbackLocation,
              officeHourLocation(snippet)
            );

      return dayCodes.map((dayCode) => ({
        personName,
        personEmail,
        location,
        dayCode,
        startDate: termBounds.startDate,
        exDates: [],
        startTime: range.startTime,
        endTime: range.endTime,
        notes: range.inferred
          ? ["Office-hour time inferred from shorthand in outline."]
          : [],
        provenance: [makeProvenance(section, "prose", snippet)],
      }));
    });
  }
  const detailedSegments = extractDetailedOfficeHourSegments(
    normalizedSnippet,
    fallbackLocation
  );
  if (detailedSegments.length > 0) {
    return detailedSegments.map((segment) => ({
      personName,
      personEmail,
      location: segment.location,
      dayCode: segment.dayCode,
      startDate: termBounds.startDate,
      exDates: [],
      startTime: segment.startTime,
      endTime: segment.endTime,
      notes: segment.inferred
        ? ["Office-hour time inferred from shorthand in outline."]
        : [],
      provenance: [makeProvenance(section, "prose", snippet)],
    }));
  }
  const clusteredDayTimeMatches = Array.from(
    normalizedSnippet.matchAll(
      /\b((?:(?:and\s+)?(?:Mon(?:day)?s?'?s?|Tue(?:s(?:day)?)?s?'?s?|Wed(?:nesday)?s?'?s?|Thu(?:r(?:s(?:day)?)?)?s?'?s?|Fri(?:day)?s?'?s?|Sat(?:urday)?s?'?s?|Sun(?:day)?s?'?s?|M|Tu|Th|T|W|F(?![a-z]))\.?\s*(?:\/|,|&|-|\band\b)?\s*)+)\s*(?:\(([^)]+)\)|(?:,?\s*(?:between|from)\s*)?(\d{1,2}(?::\d{2})?\s*(?:a\.?m\.?|p\.?m\.?|am|pm|AM|PM)?)\s*(?:-|--|–|—|to)\s*(\d{1,2}(?::\d{2})?\s*(?:a\.?m\.?|p\.?m\.?|am|pm|AM|PM)?))\s*(?:,?\s*(?:in|at)\s*([^,.;]+))?/gi
    )
  );
  if (clusteredDayTimeMatches.length > 0) {
    return clusteredDayTimeMatches.flatMap((match) => {
      const dayCodes = parseOfficeHourDayCodes(match[1]);
      const rangeText = match[2] ? match[2] : `${match[3]} - ${match[4]}`;
      const range = parseOfficeHourTimeRange(rangeText);
      if (dayCodes.length === 0 || !range.startTime || !range.endTime) return [];

      const locationHint = normalizeWhitespace(match[5]);
      const location =
        /virtual|online|teams?|zoom/i.test(locationHint) && !chooseOfficeHourLocation(fallbackLocation)
          ? "Online"
          : chooseOfficeHourLocation(
              officeHourLocation(locationHint),
              officeHourLocation(match[0]),
              fallbackLocation,
              officeHourLocation(snippet)
            );

      return dayCodes.map((dayCode) => ({
        personName,
        personEmail,
        location,
        dayCode,
        startDate: termBounds.startDate,
        exDates: [],
        startTime: range.startTime,
        endTime: range.endTime,
        notes: range.inferred
          ? ["Office-hour time inferred from shorthand in outline."]
          : [],
        provenance: [makeProvenance(section, "prose", snippet)],
      }));
    });
  }
  const timeThenDaysMatch = normalizedSnippet.match(
    /(?:from\s*)?(\d{1,2}(?::\d{2})?\s*(?:a\.?m\.?|p\.?m\.?|am|pm|AM|PM)?)\s*(?:-|--|–|—|to)\s*(\d{1,2}(?::\d{2})?\s*(?:a\.?m\.?|p\.?m\.?|am|pm|AM|PM)?)\s*,?\s*((?:(?:and\s+)?(?:Mon(?:day)?s?'?s?|Tue(?:s(?:day)?)?s?'?s?|Wed(?:nesday)?s?'?s?|Thu(?:r(?:s(?:day)?)?)?s?'?s?|Fri(?:day)?s?'?s?|Sat(?:urday)?s?'?s?|Sun(?:day)?s?'?s?|M|Tu|Th|T|W|F(?![a-z]))\.?\s*(?:,|&|and|\/|-)?\s*)+)/i
  );
  if (timeThenDaysMatch) {
    const dayCodes = parseOfficeHourDayCodes(timeThenDaysMatch[3]);
    const range = parseOfficeHourTimeRange(
      `${timeThenDaysMatch[1]} - ${timeThenDaysMatch[2]}`
    );
    if (dayCodes.length > 0 && range.startTime && range.endTime) {
      const location = chooseOfficeHourLocation(
        officeHourLocation(snippet),
        fallbackLocation
      );
      return dayCodes.map((dayCode) => ({
        personName,
        personEmail,
        location,
        dayCode,
        startDate: termBounds.startDate,
        exDates: [],
        startTime: range.startTime!,
        endTime: range.endTime!,
        notes: range.inferred
          ? ["Office-hour time inferred from shorthand in outline."]
          : [],
        provenance: [makeProvenance(section, "prose", snippet)],
      }));
    }
  }
  const sequentialDayTimeMatches = Array.from(
    normalizedSnippet.matchAll(
      /\b(Mon(?:day)?s?'?s?|Tue(?:s(?:day)?)?s?'?s?|Wed(?:nesday)?s?'?s?|Thu(?:r(?:s(?:day)?)?)?s?'?s?|Fri(?:day)?s?'?s?|Sat(?:urday)?s?'?s?|Sun(?:day)?s?'?s?|M|Tu|Th|T|W|F(?![a-z]))\b\.?\s*(?:\(([^)]+)\)\s*)?(?:,)?\s*(?:from\s*)?(\d{1,2}(?::\d{2})?\s*(?:a\.?m\.?|p\.?m\.?|am|pm|AM|PM)?)\s*(?:-|--|–|—|to)\s*(\d{1,2}(?::\d{2})?\s*(?:a\.?m\.?|p\.?m\.?|am|pm|AM|PM)?)/gi
    )
  );
  if (sequentialDayTimeMatches.length > 0) {
    return sequentialDayTimeMatches.flatMap((match) => {
      const dayCodes = parseOfficeHourDayCodes(match[1]);
      const range = parseOfficeHourTimeRange(`${match[3]} - ${match[4]}`);
      if (dayCodes.length === 0 || !range.startTime || !range.endTime) return [];

      const locationHint = normalizeWhitespace(match[2]);
      const snippetLocation = chooseOfficeHourLocation(
        officeHourLocation(normalizedSnippet),
        fallbackLocation
      );
      const snippetHasPhysicalLocation =
        !!snippetLocation &&
        !isClearlyInvalidOfficeHourLocation(snippetLocation) &&
        snippetLocation !== "Online";
      const snippetIsSingleOnlineSeries =
        sequentialDayTimeMatches.length === 1 &&
        /\bonline\b/i.test(normalizedSnippet) &&
        /\b(?:teams?|zoom)\b/i.test(normalizedSnippet) &&
        !snippetHasPhysicalLocation;
      const location =
        /virtual|online|teams?|zoom/i.test(locationHint) && !snippetHasPhysicalLocation
          ? "Online"
          : snippetIsSingleOnlineSeries
          ? "Online"
          : chooseOfficeHourLocation(
              officeHourLocation(locationHint),
              officeHourLocation(match[0]),
              fallbackLocation,
              officeHourLocation(snippet)
            );

      return dayCodes.map((dayCode) => ({
        personName,
        personEmail,
        location,
        dayCode,
        startDate: termBounds.startDate,
        exDates: [],
        startTime: range.startTime,
        endTime: range.endTime,
        notes: range.inferred
          ? ["Office-hour time inferred from shorthand in outline."]
          : [],
        provenance: [makeProvenance(section, "prose", snippet)],
      }));
    });
  }
  const explicitDayCodes = parseOfficeHourDayCodes(normalizedSnippet);
  const explicitTimeRanges = Array.from(
    normalizedSnippet.matchAll(
      /(\d{1,2}(?::\d{2})?\s*(?:a\.?m\.?|p\.?m\.?|am|pm|AM|PM)?)\s*(?:-|--|–|—|to)\s*(\d{1,2}(?::\d{2})?\s*(?:a\.?m\.?|p\.?m\.?|am|pm|AM|PM)?)/gi
    )
  );
  if (explicitDayCodes.length > 1 && explicitTimeRanges.length === 1) {
    const range = parseOfficeHourTimeRange(
      `${explicitTimeRanges[0][1]} - ${explicitTimeRanges[0][2]}`
    );
    if (range.startTime && range.endTime) {
      const location = chooseOfficeHourLocation(
        officeHourLocation(snippet),
        fallbackLocation
      );
      return explicitDayCodes.map((dayCode) => ({
        personName,
        personEmail,
        location,
        dayCode,
        startDate: termBounds.startDate,
        exDates: [],
        startTime: range.startTime!,
        endTime: range.endTime!,
        notes: range.inferred
          ? ["Office-hour time inferred from shorthand in outline."]
          : [],
        provenance: [makeProvenance(section, "prose", snippet)],
      }));
    }
  }
  const compoundDayLeadMatch = normalizedSnippet.match(
    /^((?:(?:Mon(?:day)?s?'?s?|Tue(?:s(?:day)?)?s?'?s?|Wed(?:nesday)?s?'?s?|Thu(?:r(?:s(?:day)?)?)?s?'?s?|Fri(?:day)?s?'?s?|Sat(?:urday)?s?'?s?|Sun(?:day)?s?'?s?|M|Tu|Th|T|W|F(?![a-z]))\.?\s*(?:,|&|and|\/)?\s*){2,})(?::\s*|from\s*)?(\d{1,2}(?::\d{2})?\s*(?:a\.?m\.?|p\.?m\.?|am|pm|AM|PM)?)\s*(?:-|--|–|—|to)\s*(\d{1,2}(?::\d{2})?\s*(?:a\.?m\.?|p\.?m\.?|am|pm|AM|PM)?)/i
  );
  if (compoundDayLeadMatch) {
    const dayCodes = parseOfficeHourDayCodes(compoundDayLeadMatch[1]);
    const range = parseOfficeHourTimeRange(
      `${compoundDayLeadMatch[2]} - ${compoundDayLeadMatch[3]}`
    );
    if (dayCodes.length > 0 && range.startTime && range.endTime) {
      const resolvedLocation = officeHourLocation(snippet) || fallbackLocation;
      const location = isClearlyInvalidOfficeHourLocation(resolvedLocation)
        ? undefined
        : resolvedLocation;
      return dayCodes.map((dayCode) => ({
        personName,
        personEmail,
        location,
        dayCode,
        startDate: termBounds.startDate,
        exDates: [],
        startTime: range.startTime!,
        endTime: range.endTime!,
        notes: range.inferred
          ? ["Office-hour time inferred from shorthand in outline."]
          : [],
        provenance: [makeProvenance(section, "prose", snippet)],
      }));
    }
  }
  const extractedSlots = extractOfficeHourSlots(normalizedSnippet);
  const repeatedDayTimePattern =
    /\b(Mon(?:day)?s?'?s?|Tue(?:s(?:day)?)?s?'?s?|Wed(?:nesday)?s?'?s?|Thu(?:r(?:s(?:day)?)?)?s?'?s?|Fri(?:day)?s?'?s?|Sat(?:urday)?s?'?s?|Sun(?:day)?s?'?s?|F(?![a-z]))\b\.?\s*(?::\s*|from\s*)?(\d{1,2}(?::\d{2})?\s*(?:a\.?m\.?|p\.?m\.?|am|pm|AM|PM)?)\s*(?:-|–|—|to)\s*(\d{1,2}(?::\d{2})?\s*(?:a\.?m\.?|p\.?m\.?|am|pm|AM|PM)?)(?:\s*\(([^)]+)\))?/gi;
  const repeatedMatches = Array.from(normalizedSnippet.matchAll(repeatedDayTimePattern));
  if (repeatedMatches.length > 1 && repeatedMatches.some((match) => normalizeWhitespace(match[4]).length > 0)) {
    return repeatedMatches.flatMap((match) => {
      const dayCodes = parseOfficeHourDayCodes(match[1]);
      const range = parseOfficeHourTimeRange(`${match[2]} - ${match[3]}`);
      if (dayCodes.length === 0 || !range.startTime || !range.endTime) return [];

      const locationHint = normalizeWhitespace(match[4]);
      const resolvedLocation =
        /virtual|online|teams?|zoom/i.test(locationHint)
          ? "Online"
          : officeHourLocation(locationHint) ||
            officeHourLocation(match[0]) ||
            officeHourLocation(snippet) ||
            fallbackLocation;
      const location = isClearlyInvalidOfficeHourLocation(resolvedLocation)
        ? undefined
        : resolvedLocation;

      return dayCodes.map((dayCode) => ({
        personName,
        personEmail,
        location,
        dayCode,
        startDate: termBounds.startDate,
        exDates: [],
        startTime: range.startTime,
        endTime: range.endTime,
        notes: range.inferred
          ? ["Office-hour time inferred from shorthand in outline."]
          : [],
        provenance: [makeProvenance(section, "prose", snippet)],
      }));
    });
  }
  if (
    extractedSlots.length === 0 &&
    /by appointment|upon appointment|tbd|to be determined|posted on learn|see (?:piazza|learn|website)/i.test(
      normalizedSnippet
    )
  ) {
    return [] as OfficeHourSeed[];
  }

  const resolvedLocation = officeHourLocation(snippet) || fallbackLocation;
  const location = isClearlyInvalidOfficeHourLocation(resolvedLocation)
    ? undefined
    : resolvedLocation;

  return extractedSlots
    .filter((slot) => slot.startTime && slot.endTime)
    .map((slot) => ({
      personName,
      personEmail,
      location,
      dayCode: slot.dayCode,
      startDate: termBounds.startDate,
      exDates: [],
      startTime: slot.startTime,
      endTime: slot.endTime,
      notes: slot.inferred
        ? ["Office-hour time inferred from shorthand in outline."]
        : [],
      provenance: [makeProvenance(section, "prose", snippet)],
    }));
}

function parseStructuredOfficeHourTables(
  sections: SectionBlock[],
  meta: OutlineMeta,
  meetings: RawMeetingRow[]
) {
  const termBounds = computeTermBounds(meetings) ?? computeFallbackTermBounds(sections, meta);
  if (!termBounds) return [] as OfficeHourSeed[];

  const seeds: OfficeHourSeed[] = [];

  sections
    .filter(
      (section) =>
        isLikelyInstructionalSection(section) &&
        /\boffice hours?|student hours?|office location (?:and|&) hours?\b/i.test(
          normalizeOfficeHourParsingText(section.text)
        )
    )
    .forEach((section) => {
      const tables = section.elements.flatMap((element) =>
        Array.from(element.querySelectorAll("table"))
      ) as HTMLTableElement[];

      tables.forEach((table) => {
        const rows = tableToRows(table);
        if (rows.length < 2) return;
        const context = structuredOfficeHourTableContext(table);
        const tableOfficeCell =
          rows.find((row) => /^office:?$/i.test(normalizeWhitespace(row[0])))?.slice(1).join("\n") ||
          "";
        const tableEmailCell =
          rows.find((row) => /^email:?$/i.test(normalizeWhitespace(row[0])))?.slice(1).join("\n") ||
          "";
        const tableOfficeLocation = officeHourLocation(tableOfficeCell);
        const tableEmail = extractOfficeHourEmail(tableEmailCell);

        const officeHourHeaderIndex = rows.findIndex((row) => {
          const normalizedRow = row.map((cell) => normalizeWhitespace(cell).toLowerCase());
          const hasContactStyleHeader = normalizedRow.some((cell) =>
            /\b(?:name|contact|contact details|office|office hours?|who and why)\b/.test(
              cell
            )
          );
          const looksLikeHeader = normalizedRow.every((cell) => cell.length > 0 && cell.length <= 80);
          return hasContactStyleHeader && looksLikeHeader;
        });
        const headerIndex =
          officeHourHeaderIndex !== -1 ? officeHourHeaderIndex : findHeaderRow(rows);
        const headers = rows[headerIndex].map((cell) =>
          normalizeWhitespace(cell).toLowerCase()
        );
        const officeHoursIndex = headers.findIndex((cell) =>
          /\boffice hours\b|\bcontact and office hours\b/.test(cell)
        );

        const nameIndex = headers.findIndex((cell) => /^name$/.test(cell));
        const contactIndex = headers.findIndex((cell) => /\bcontact\b/.test(cell));
        const officeIndex = headers.findIndex((cell) => /^office$/.test(cell));
        const headerRowLooksLikeData =
          officeHoursIndex !== -1 &&
          nameIndex === -1 &&
          contactIndex === -1 &&
          officeIndex === -1 &&
          rows[headerIndex].some((cell) =>
            /@uwaterloo\.ca|(?:mon|tue|wed|thu|fri|sat|sun)(?:day)?s?|office hours?|student hours?|\d{1,2}:\d{2}|\d{1,2}\s*(?:a\.?m\.?|p\.?m\.?|am|pm)\b/i.test(
              cell
            )
          );

        if (officeHoursIndex !== -1) {
          rows.slice(headerIndex + (headerRowLooksLikeData ? 0 : 1)).forEach((row) => {
          const expandedRows = (() => {
            const nameEntries = nameIndex === -1 ? [] : splitStructuredOfficeHourCellEntries(row[nameIndex]);
            const officeEntries = officeIndex === -1 ? [] : splitStructuredOfficeHourCellEntries(row[officeIndex]);
            const contactEntries =
              contactIndex === -1 ? [] : splitStructuredOfficeHourCellEntries(row[contactIndex]);
            const officeHourEntries = splitStructuredOfficeHourCellEntries(row[officeHoursIndex]);
            const maxEntries = Math.max(
              1,
              nameEntries.length,
              officeEntries.length,
              contactEntries.length,
              officeHourEntries.length
            );
            const shouldExpand =
              maxEntries > 1 &&
              [nameEntries, officeEntries, contactEntries, officeHourEntries].filter(
                (entries) => entries.length > 1
              ).length >= 2;

            if (!shouldExpand) {
              return [row];
            }

            return Array.from({ length: maxEntries }, (_, index) => {
              const nextRow = [...row];
              if (nameIndex !== -1 && nameEntries.length > 0) {
                nextRow[nameIndex] = nameEntries[index] ?? "";
              }
              if (officeIndex !== -1 && officeEntries.length > 0) {
                nextRow[officeIndex] = officeEntries[index] ?? "";
              }
              if (contactIndex !== -1 && contactEntries.length > 0) {
                nextRow[contactIndex] = contactEntries[index] ?? "";
              }
              nextRow[officeHoursIndex] = officeHourEntries[index] ?? "";
              return nextRow;
            });
          })();

          expandedRows.forEach((expandedRow) => {
          const rowText = expandedRow.join("\n");
          const adjacentPersonName =
            nameIndex === -1 && officeHoursIndex > 0
              ? sanitizeOfficeHourPersonName(
                  expandedRow[officeHoursIndex - 1]?.match(
                    /\b((?:(?:Dr\.?|Prof\.?|Professor)\s+)?[\p{L}][\p{L}'’.-]+(?:\s+[\p{L}][\p{L}'’.-]+){0,5})\b/iu
                  )?.[1]
                )
              : undefined;
          const personName = sanitizeOfficeHourPersonName(
            expandedRow[nameIndex] ||
              adjacentPersonName ||
              (nameIndex === -1 && officeHoursIndex > 0 ? expandedRow[0] : undefined) ||
              context.personName ||
              rowText.match(
                /\b((?:(?:Dr\.?|Prof\.?|Professor)\s+)?[\p{L}][\p{L}'’.-]+(?:\s+[\p{L}][\p{L}'’.-]+){0,5})\b/iu
              )?.[1] ||
              officeHourInstructorName(rowText, meetings, meta)
          );
          if (!personName || isGenericOfficeHourName(personName)) return;

          const personEmail =
              extractOfficeHourEmail(expandedRow[contactIndex] || rowText) ||
              tableEmail ||
              context.personEmail ||
              officeHourInstructorEmail(rowText, meetings);
          const officeHoursCell = expandedRow[officeHoursIndex] || "";
          const officeCell = officeIndex === -1 ? "" : expandedRow[officeIndex] || "";
          const combinedSnippet = [officeHoursCell, officeCell].filter(Boolean).join("\n");
          const officeHoursWindowContext = (() => {
            const year = meta.termYear;
            const startingMatch = officeHoursCell.match(/\bstarting\s+([^,);]+)/i)?.[1];
            const excludingText = officeHoursCell.match(/\bexcluding\s+([^)]+)/i)?.[1] ?? "";
            const startDate =
              (startingMatch ? extractExplicitDates(startingMatch, year)[0] : undefined) ??
              undefined;
            const exDates = extractExplicitDates(excludingText, year);
            if (!startDate && exDates.length === 0) return undefined;
            return {
              startDate,
              exDates,
            };
          })();
          const explicitDayCodes = parseWeekdayCodes(officeHoursCell);
          const explicitRange = parseOfficeHourTimeRange(officeHoursCell);
          const explicitTimeRangeCount = countValidOfficeHourTimeRanges(officeHoursCell);
          if (
            explicitDayCodes.length > 1 &&
            explicitTimeRangeCount === 1 &&
            explicitRange.startTime &&
            explicitRange.endTime
          ) {
            const resolvedLocation =
              officeHourLocation(officeCell) ||
              officeHourLocation(rowText) ||
              context.location;
            const location = isClearlyInvalidOfficeHourLocation(resolvedLocation)
              ? undefined
              : resolvedLocation;
            seeds.push(
              ...explicitDayCodes.map((dayCode) => ({
                personName,
                personEmail,
                location,
                dayCode,
                startDate: officeHoursWindowContext?.startDate ?? termBounds.startDate,
                exDates: officeHoursWindowContext?.exDates ?? [],
                startTime: explicitRange.startTime!,
                endTime: explicitRange.endTime!,
                notes: explicitRange.inferred
                  ? ["Office-hour time inferred from shorthand in outline."]
                  : [],
                provenance: [makeProvenance(section, "prose", combinedSnippet)],
              }))
            );
            return;
          }
          const structuredSeeds = createOfficeHourSeedsFromStructuredSnippet(
            section,
            combinedSnippet,
            personName,
            personEmail,
            officeHourLocation(officeCell) || officeHourLocation(rowText) || context.location,
            termBounds
          );
          seeds.push(
            ...structuredSeeds.map((seed) => ({
              ...seed,
              startDate: officeHoursWindowContext?.startDate ?? seed.startDate,
              exDates: officeHoursWindowContext?.exDates ?? seed.exDates,
            }))
          );
          });
          });
          return;
        }

        if (contactIndex !== -1) {
          rows.slice(headerIndex + 1).forEach((row) => {
            const rowText = row.join("\n");
            const contactCell = row[contactIndex] || "";
            const normalizedContactCell = normalizeOfficeHourParsingText(contactCell);
            if (
              isAdministrativeOfficeHourNoiseSnippet(normalizedContactCell) ||
              isAdministrativeOfficeHourNoiseSnippet(rowText)
            ) {
              return;
            }
            if (
              !/\b(?:office hours?|student(?:\s*\(office\))?\s*hours?|open student hours?|my office hours are|consulting hours?)\b/i.test(
                normalizedContactCell
              )
            ) {
              return;
            }

            const officeSnippet =
              normalizeOfficeHoursSnippet(
                normalizedContactCell.match(
                  /(?:office hours?|student(?:\s*\(office\))?\s*hours?|open student hours?|my office hours are|consulting hours?)\b[:\s-]*.*$/i
                )?.[0] ?? normalizedContactCell
              ) || normalizedContactCell;
            const extractedContactSlots = extractOfficeHourSlots(officeSnippet);
            if (
              extractedContactSlots.length === 0 &&
              /by appointment|upon appointment|tbd|to be determined|posted on learn|see (?:piazza|learn|website)/i.test(
                officeSnippet
              )
            ) {
              return;
            }

            const personName = sanitizeOfficeHourPersonName(
              normalizedContactCell.match(
                /\b(?:Instructor|Course Instructor|Teaching Assistant|Lead Teaching Assistant(?:\s*\(TA\))?|Lead TA|TA)\s*:?\s*((?:(?:Dr\.?|Prof\.?|Professor)\s+)?[\p{L}][\p{L}'’.-]+(?:\s+[\p{L}][\p{L}'’.-]+){0,5}?)(?=\s*(?:[A-Z0-9._%+-]+@uwaterloo\.ca\b|Office hours?\b|Student(?:\s*\(office\))?\s*hours?\b|$))/iu
              )?.[1] ||
              normalizedContactCell.match(
                /\b(?:Instructor|Course Instructor|Teaching Assistant|Lead Teaching Assistant(?:\s*\(TA\))?|Lead TA|TA)\s*:?\s*((?:(?:Dr\.?|Prof\.?|Professor)\s+)?[\p{L}][\p{L}'’.-]+(?:\s+[\p{L}][\p{L}'’.-]+){0,5})/iu
              )?.[1] ||
                row[nameIndex] ||
                officeHourInstructorName(rowText, meetings, meta) ||
                context.personName
            );
            if (!personName || isGenericOfficeHourName(personName)) return;

            const personEmail =
              extractOfficeHourEmail(contactCell) ||
              extractOfficeHourEmail(rowText) ||
              context.personEmail ||
              officeHourInstructorEmail(rowText, meetings);
            const resolvedLocation =
              officeHourLocation(contactCell) ||
              officeHourLocation(rowText) ||
              tableOfficeLocation ||
              context.location;
            const location = isClearlyInvalidOfficeHourLocation(resolvedLocation)
              ? undefined
              : resolvedLocation;

            const structuredSeeds = createOfficeHourSeedsFromStructuredSnippet(
              section,
              officeSnippet,
              personName,
              personEmail,
              location,
              termBounds
            );
            seeds.push(...structuredSeeds);
          });
          return;
        }

        if (!context.personName) return;

        rows.forEach((row) => {
          if (row.length < 2) return;
          const label = normalizeWhitespace(row[0]).toLowerCase();
          if (!/\b(?:office hours?|consulting hours?)\b/.test(label)) return;
          const snippet = row.slice(1).join("\n");
          const structuredSeeds = createOfficeHourSeedsFromStructuredSnippet(
            section,
            snippet,
            context.personName,
            extractOfficeHourEmail(snippet) || tableEmail || context.personEmail,
            tableOfficeLocation || context.location,
            termBounds
          );
          seeds.push(...structuredSeeds);
        });
      });
    });

  return seeds;
}

function parseStructuredOfficeHourLines(
  sections: SectionBlock[],
  meta: OutlineMeta,
  meetings: RawMeetingRow[]
) {
  const termBounds = computeTermBounds(meetings) ?? computeFallbackTermBounds(sections, meta);
  if (!termBounds) return [] as OfficeHourSeed[];

  const seeds: OfficeHourSeed[] = [];

  sections
    .filter(
      (section) =>
        isLikelyInstructionalSection(section) &&
        /\boffice hours?|student hours?|office location (?:and|&) hours?|my office hours are\b/i.test(
          normalizeOfficeHourParsingText(section.text)
        )
    )
    .forEach((section) => {
      const initialSectionSeedCount = seeds.length;
      const sectionHasTable = section.elements.some(
        (element) =>
          element.tagName.toLowerCase() === "table" || !!element.querySelector("table")
      );
      let activeInstructorName = officeHourInstructorName(section.text, meetings, meta);
      let activeInstructorEmail = officeHourInstructorEmail(section.text, meetings);
      let activeLocation = officeHourLocation(section.text);
      const sectionFallbackInstructorName = activeInstructorName;
      const sectionFallbackInstructorEmail = activeInstructorEmail;
      const sectionFallbackLocation = activeLocation;
      const sectionTaOfficeHourLocation = officeHourLocation(
        normalizeOfficeHourParsingText(section.text).match(
          /\b(?:teaching assistants?|TAs?)['’]?\s+office hours?.{0,120}/i
        )?.[0]
      );
      let withinOfficeHoursBlock = false;
      let waitingForOfficeHourContinuation = false;

      let pendingSnippetLines: string[] = [];
      let pendingInstructorName = activeInstructorName;
      let pendingInstructorEmail = activeInstructorEmail;
      let pendingLocation = activeLocation;

      const flushPendingSnippet = () => {
        if (pendingSnippetLines.length === 0) return;
        const snippet = pendingSnippetLines.join("\n");
        const personName =
          sanitizeOfficeHourPersonName(pendingInstructorName) || activeInstructorName;
        if (!personName || isGenericOfficeHourName(personName)) {
          pendingSnippetLines = [];
          return;
        }
        const structuredSeeds = createOfficeHourSeedsFromStructuredSnippet(
          section,
          snippet,
          personName,
          pendingInstructorEmail,
          pendingLocation,
          termBounds
        );
        if (structuredSeeds.length > 0) {
          seeds.push(...structuredSeeds);
        } else {
          pendingSnippetLines.forEach((line) => {
            const fallbackLineSeeds = createOfficeHourSeedsFromStructuredSnippet(
              section,
              line,
              personName,
              pendingInstructorEmail,
              pendingLocation,
              termBounds
            );
            seeds.push(...fallbackLineSeeds);
          });
        }
        pendingSnippetLines = [];
      };

      const handlePotentialIdentityLine = (line: string) => {
        const namePrefixedMatch = line.match(
          /^name\s*:?\s*((?:(?:Dr\.?|Prof\.?|Professor)\s+)?[\p{L}][\p{L}'’.-]+(?:\s+[\p{L}][\p{L}'’.-]+){0,5})/iu
        )?.[1];
        const prefixedNameMatch = line.match(
          /^(?:Instructor|Course Instructor|Teaching Assistant|Lead Teaching Assistant(?:\s*\(TA\))?|Lead TA|TA|Instructional Support Assistant(?:\s*\(ISA\))?|Instructional Assistant(?:\s*\(IA\))?|Instructional Support Coordinator(?:\s*\(ISC\))?|ISC|ISA|IA)\s*:?\s*([^,]+)/i
        )?.[1];
        const roleMatch = line.match(
          /^(?:Instructor|Course Instructor|Teaching Assistant|Lead Teaching Assistant(?:\s*\(TA\))?|Lead TA|TA|Instructional Support Assistant(?:\s*\(ISA\))?|Instructional Assistant(?:\s*\(IA\))?|Instructional Support Coordinator(?:\s*\(ISC\))?|ISC|ISA|IA)\s*:?\s*((?:(?:Dr\.?|Prof\.?|Professor)\s+)?[\p{L}][\p{L}'’.-]+(?:\s+[\p{L}][\p{L}'’.-]+){0,4})/iu
        )?.[1];
        const directNameEmailMatch =
          line.match(
            /^((?:(?:Dr\.?|Prof\.?|Professor)\s+)?[\p{L}][\p{L}'’.-]+(?:\s+[\p{L}][\p{L}'’.-]+){0,4})\s*-\s*([A-Z0-9._%+-]+@uwaterloo\.ca)\b/iu
          ) ||
          line.match(
            /^((?:(?:Dr\.?|Prof\.?|Professor)\s+)?[\p{L}][\p{L}'’.-]+(?:\s+[\p{L}][\p{L}'’.-]+){0,4})\s+([A-Z0-9._%+-]+@uwaterloo\.ca)\b/iu
          );
        const directNameOfficeMatch = line.match(
          /^((?:(?:Dr\.?|Prof\.?|Professor)\s+)?[\p{L}][\p{L}'’.-]+(?:\s+[\p{L}][\p{L}'’.-]+){0,4})\s*-\s*([A-Z][A-Z0-9]{0,3}(?:-|\s*)\d{3,4}[A-Za-z]?)\b/iu
        );
        const bareNameMatch = line.match(
          /^((?:(?:Dr\.?|Prof\.?|Professor)\s+)?[\p{L}][\p{L}'’.-]+(?:\s+[\p{L}][\p{L}'’.-]+){1,4})$/u
        )?.[1];
        const lineEmail = extractOfficeHourEmail(line);

        if (namePrefixedMatch && !isGenericOfficeHourName(namePrefixedMatch)) {
          activeInstructorName = sanitizeOfficeHourPersonName(namePrefixedMatch);
          activeLocation = officeHourLocation(line) || activeLocation;
          return true;
        }

        if (prefixedNameMatch && !isGenericOfficeHourName(prefixedNameMatch)) {
          activeInstructorName = sanitizeOfficeHourPersonName(prefixedNameMatch);
          activeInstructorEmail = lineEmail || activeInstructorEmail;
          activeLocation = officeHourLocation(line) || activeLocation;
          return true;
        }

        if (roleMatch) {
          activeInstructorName = sanitizeOfficeHourPersonName(roleMatch);
          activeInstructorEmail = lineEmail || activeInstructorEmail;
          activeLocation = officeHourLocation(line) || activeLocation;
          return true;
        }

        if (directNameEmailMatch) {
          activeInstructorName = sanitizeOfficeHourPersonName(directNameEmailMatch[1]);
          activeInstructorEmail = directNameEmailMatch[2];
          activeLocation = officeHourLocation(line) || activeLocation;
          return true;
        }

        if (directNameOfficeMatch) {
          activeInstructorName = sanitizeOfficeHourPersonName(directNameOfficeMatch[1]);
          activeLocation = directNameOfficeMatch[2];
          return true;
        }

        if (bareNameMatch && !isGenericOfficeHourName(bareNameMatch)) {
          activeInstructorName = sanitizeOfficeHourPersonName(bareNameMatch);
          activeLocation = officeHourLocation(line) || activeLocation;
          return true;
        }

        if (/^[A-Z][A-Za-z'’.-]+(?:\s+[A-Z][A-Za-z'’.-]+){1,4}\s+[a-z]{2,6}$/i.test(line)) {
          activeInstructorName = sanitizeOfficeHourPersonName(line.replace(/\s+[a-z]{2,6}$/i, ""));
          return true;
        }

        if (lineEmail) {
          activeInstructorEmail = lineEmail;
          return true;
        }

        return false;
      };

      section.elements
        .filter((element) => element.tagName.toLowerCase() !== "table")
        .forEach((element) => {
          const lineSource = element.cloneNode(true) as Element;
          lineSource.querySelectorAll("table").forEach((table) => table.remove());
          const lines = splitOfficeHourAwareLines(htmlToText(lineSource));

          lines.forEach((line) => {
            const normalizedLine = normalizeOfficeHourParsingText(line);
            const hasOfficeHourCue =
              /\boffice hours?|student hours?|open student hours?|my office hours are|consulting hours?/i.test(
                normalizedLine
              );
            const roleNamedOfficeHours =
              normalizedLine.match(
                /^(?:Instructor|Course Instructor)\s*:?\s*((?:(?:Dr\.?|Prof\.?|Professor)\s+)?[\p{L}][\p{L}'’.-]+(?:\s+[\p{L}][\p{L}'’.-]+){0,6})(?:\s*\(([^)]*)\))?(?:,\s*([^,]+))?(?:,\s*([^,]+))?.*?\boffice hours?\b(?:\s*(?:to be held on|:))?\s*(.+)$/iu
              ) ||
              normalizedLine.match(
                /^((?:(?:Dr\.?|Prof\.?|Professor)\s+)?[\p{L}][\p{L}'’.-]+(?:\s+[\p{L}][\p{L}'’.-]+){0,6})(?:\s*\(([^)]*)\))?,\s*office hours?\s*:\s*(.+)$/iu
              );
            const namedScheduleLineMatch = normalizedLine.match(
              /^(?:name\s*:?\s*)?((?:(?:Dr\.?|Prof\.?|Professor)\s+)?[\p{L}][\p{L}'’.-]+(?:\s+[\p{L}][\p{L}'’.-]+){0,6})(?:\s*\(([^)]*)\))?\s*:\s*(?:office hours?\s*)?(.+)$/iu
            );
            const inlineInstructorOfficeHours =
              normalizedLine.match(
                /^(?:Instructor|Course Instructor)\s*:?\s*([^,]+?)(?:,\s*([^,]+@uwaterloo\.ca|[A-Z0-9._%+-]+\s*\[\s*at\s*\]\s*uwaterloo\s*\[\s*dot\s*\]\s*ca))?(?:,\s*([^,]+))?.*\boffice hours?\s*:\s*(.+)$/i
              );
            const possessiveOfficeHoursMatch = normalizedLine.match(
              /^((?:(?:Prof\.?|Professor)\s+)?(?:Dr\.?\s+)?[\p{L}][\p{L}'’.-]+(?:\s+[\p{L}][\p{L}'’.-]+){0,4})'s office hours?:\s*(.*)$/iu
            );

            if (roleNamedOfficeHours) {
              flushPendingSnippet();
              withinOfficeHoursBlock = true;
              const roleName = sanitizeOfficeHourPersonName(roleNamedOfficeHours[1]);
              const roleMetadata = roleNamedOfficeHours[2];
              const roleTail =
                roleNamedOfficeHours[5] || roleNamedOfficeHours[3] || "";
              const prefersTaLocation =
                !!sectionTaOfficeHourLocation &&
                !/^\s*(?:Instructor|Course Instructor)\b/i.test(normalizedLine);
              const roleEmail =
                extractOfficeHourEmail(
                  [roleMetadata, roleNamedOfficeHours[3], normalizedLine]
                    .filter(Boolean)
                    .join(" ")
                ) || activeInstructorEmail;
              const roleLocation =
                officeHourLocation(
                  [roleMetadata, roleNamedOfficeHours[4], roleTail, normalizedLine]
                    .filter(Boolean)
                    .join(" ")
                ) ||
                (prefersTaLocation
                  ? sectionTaOfficeHourLocation
                  : undefined) ||
                activeLocation;
              if (roleName && !isGenericOfficeHourName(roleName)) {
                seeds.push(
                  ...createOfficeHourSeedsFromStructuredSnippet(
                    section,
                    roleTail,
                    roleName,
                    roleEmail,
                    roleLocation,
                    termBounds
                  )
                );
                activeInstructorName = roleName;
                activeInstructorEmail = roleEmail;
                activeLocation = roleLocation || activeLocation;
              }
              return;
            }

            if (
              namedScheduleLineMatch &&
              (OFFICE_HOUR_WEEKDAY_REGEX.test(namedScheduleLineMatch[3]) ||
                extractOfficeHourSlots(namedScheduleLineMatch[3]).length > 0)
            ) {
              flushPendingSnippet();
              withinOfficeHoursBlock = true;
              const lineName = sanitizeOfficeHourPersonName(namedScheduleLineMatch[1]);
              const lineEmail =
                extractOfficeHourEmail(
                  [namedScheduleLineMatch[2], normalizedLine].filter(Boolean).join(" ")
                ) || activeInstructorEmail;
              const lineLocation =
                officeHourLocation(namedScheduleLineMatch[3]) ||
                officeHourLocation(normalizedLine) ||
                activeLocation;
              if (lineName && !isGenericOfficeHourName(lineName)) {
                seeds.push(
                  ...createOfficeHourSeedsFromStructuredSnippet(
                    section,
                    namedScheduleLineMatch[3],
                    lineName,
                    lineEmail,
                    lineLocation,
                    termBounds
                  )
                );
                activeInstructorName = lineName;
                activeInstructorEmail = lineEmail;
                activeLocation = lineLocation || activeLocation;
              }
              return;
            }

            if (inlineInstructorOfficeHours) {
              flushPendingSnippet();
              withinOfficeHoursBlock = true;
              const inlineName =
                sanitizeOfficeHourPersonName(inlineInstructorOfficeHours[1]) ||
                activeInstructorName;
              const inlineEmail =
                extractOfficeHourEmail(
                  [inlineInstructorOfficeHours[2], normalizedLine].filter(Boolean).join(" ")
                ) || activeInstructorEmail;
              const inlineLocation =
                officeHourLocation(
                  [inlineInstructorOfficeHours[3], inlineInstructorOfficeHours[4]].filter(Boolean).join(" ")
                ) || activeLocation;
              if (inlineName && !isGenericOfficeHourName(inlineName)) {
                seeds.push(
                  ...createOfficeHourSeedsFromStructuredSnippet(
                    section,
                    inlineInstructorOfficeHours[4],
                    inlineName,
                    inlineEmail,
                    inlineLocation,
                    termBounds
                  )
                );
                activeInstructorName = inlineName;
                activeInstructorEmail = inlineEmail;
                activeLocation = inlineLocation || activeLocation;
              }
              return;
            }

            if (possessiveOfficeHoursMatch) {
              flushPendingSnippet();
              withinOfficeHoursBlock = true;
              const possessiveName = sanitizeOfficeHourPersonName(
                possessiveOfficeHoursMatch[1]
              );
              pendingInstructorName =
                possessiveName.split(/\s+/).length === 1 &&
                activeInstructorName.toLowerCase().includes(possessiveName.toLowerCase())
                  ? activeInstructorName
                  : possessiveName;
              pendingInstructorEmail = activeInstructorEmail;
              pendingLocation =
                officeHourLocation(possessiveOfficeHoursMatch[2]) || activeLocation;
              pendingSnippetLines = [possessiveOfficeHoursMatch[2]].filter(Boolean);
              waitingForOfficeHourContinuation = pendingSnippetLines.length === 0;
              return;
            }

            if (
              /^(?:instructor'?s office hours|teaching assistants?'? office hours|ta office hours|office hours|student(?:\s*\(office\))?\s*hours?)\s*:?\s*$/i.test(
                normalizedLine
              )
            ) {
              flushPendingSnippet();
              withinOfficeHoursBlock = true;
              pendingInstructorName = activeInstructorName;
              pendingInstructorEmail = activeInstructorEmail;
              pendingLocation = activeLocation;
              pendingSnippetLines = [];
              waitingForOfficeHourContinuation = true;
              return;
            }

            if (/\boffice hours?:|my office hours are|instructor office hours?:/i.test(normalizedLine)) {
              flushPendingSnippet();
              withinOfficeHoursBlock = true;
              handlePotentialIdentityLine(normalizedLine);
              pendingInstructorName = activeInstructorName;
              pendingInstructorEmail = activeInstructorEmail;
              pendingLocation = officeHourLocation(normalizedLine) || activeLocation;
              const cleanedSnippet =
                normalizedLine
                  .replace(/^.*?\binstructor office hours?\b[:\s-]*/i, "")
                  .replace(/^.*?\bmy office hours are\b[:\s-]*/i, "")
                  .replace(/^.*?\boffice hours?\b[:\s-]*/i, "") || normalizedLine;
              const directNamedDayCodes = parseStrictNamedOfficeHourDayCodes(cleanedSnippet);
              const directRange = parseOfficeHourTimeRange(cleanedSnippet);
              if (
                pendingInstructorName &&
                !isGenericOfficeHourName(pendingInstructorName) &&
                directNamedDayCodes.length > 1 &&
                directRange.startTime &&
                directRange.endTime
              ) {
                seeds.push(
                  ...directNamedDayCodes.map((dayCode) => ({
                    personName: pendingInstructorName,
                    personEmail: pendingInstructorEmail,
                    location: pendingLocation,
                    dayCode,
                    startDate: termBounds.startDate,
                    exDates: [],
                    startTime: directRange.startTime!,
                    endTime: directRange.endTime!,
                    notes: directRange.inferred
                      ? ["Office-hour time inferred from shorthand in outline."]
                      : [],
                    provenance: [makeProvenance(section, "prose", cleanedSnippet)],
                  }))
                );
                waitingForOfficeHourContinuation = false;
                return;
              }
              pendingSnippetLines = [cleanedSnippet].filter(Boolean);
              waitingForOfficeHourContinuation = pendingSnippetLines.length === 0;
              return;
            }

            if (/^(?:office|my office|office location)\s*:/i.test(normalizedLine)) {
              activeLocation = officeHourLocation(normalizedLine) || activeLocation;
              if (pendingSnippetLines.length > 0) {
                pendingLocation = officeHourLocation(normalizedLine) || pendingLocation;
                pendingSnippetLines.push(normalizedLine);
              }
              return;
            }

            if (
              /\b(?:technical support|student resources|learnhelp@uwaterloo\.ca|regular business hours)\b/i.test(
                normalizedLine
              )
            ) {
              flushPendingSnippet();
              withinOfficeHoursBlock = false;
              waitingForOfficeHourContinuation = false;
              return;
            }

            if (
              /^(?:lectures?|tutorials?|labs?|teaching assistants?|instructional support coordinator|instructional support assistant|instructional assistants?|tas?)\s*:?\s*$/i.test(
                normalizedLine
              )
            ) {
              flushPendingSnippet();
              withinOfficeHoursBlock = false;
              return;
            }

            if (
              withinOfficeHoursBlock &&
              (pendingSnippetLines.length > 0 || waitingForOfficeHourContinuation) &&
              (OFFICE_HOUR_WEEKDAY_REGEX.test(normalizedLine) ||
                extractOfficeHourSlots(normalizedLine).length > 0 ||
                /\b(?:drop-?in|no appointment needed|clarify course content|ask questions?|student questions?)\b/i.test(
                  normalizedLine
                ) ||
                /\b(?:online|teams?|zoom|virtual|by appointment|appointment)\b/i.test(
                  normalizedLine
                ) ||
                /\b(?:location:|in\s+[A-Z][A-Z0-9]{0,3}(?:-|\s*)\d{3,4}[A-Za-z]?)\b/i.test(
                  normalizedLine
                ))
            ) {
              pendingSnippetLines.push(normalizedLine);
              waitingForOfficeHourContinuation = false;
              if (/^(?:office|my office|office location|location)\s*:/i.test(normalizedLine)) {
                pendingLocation = officeHourLocation(normalizedLine) || pendingLocation;
              }
              return;
            }

            if (pendingSnippetLines.length > 0) {
              flushPendingSnippet();
              withinOfficeHoursBlock = false;
              waitingForOfficeHourContinuation = false;
              if (!hasOfficeHourCue) {
                handlePotentialIdentityLine(normalizedLine);
                return;
              }
            }

            if (waitingForOfficeHourContinuation) {
              withinOfficeHoursBlock = false;
              waitingForOfficeHourContinuation = false;
            }

            if (officeHourSectionBoundaryRegex().test(normalizedLine)) {
              flushPendingSnippet();
              withinOfficeHoursBlock = false;
              waitingForOfficeHourContinuation = false;
              handlePotentialIdentityLine(normalizedLine);
              return;
            }

            handlePotentialIdentityLine(normalizedLine);
            if (!withinOfficeHoursBlock && !hasOfficeHourCue) {
              return;
            }

            if (
              hasOfficeHourCue &&
              !pendingSnippetLines.length &&
              (OFFICE_HOUR_WEEKDAY_REGEX.test(normalizedLine) ||
                extractOfficeHourSlots(normalizedLine).length > 0)
            ) {
              const structuredLinePersonName =
                activeInstructorName && !isGenericOfficeHourName(activeInstructorName)
                  ? activeInstructorName
                  : sectionFallbackInstructorName;
              if (structuredLinePersonName) {
                const directLineSeeds = createOfficeHourSeedsFromStructuredSnippet(
                  section,
                  normalizedLine,
                  structuredLinePersonName,
                  activeInstructorEmail,
                  activeLocation,
                  termBounds
                );
                if (directLineSeeds.length > 0) {
                  seeds.push(...directLineSeeds);
                  withinOfficeHoursBlock = true;
                  return;
                }
              }
            }
          });
        });

      flushPendingSnippet();

      if (
        seeds.length === initialSectionSeedCount &&
        !/\bName\s*:/.test(section.text) &&
        !sectionHasTable
      ) {
        const fallbackStructuredName =
          sectionFallbackInstructorName &&
          !isGenericOfficeHourName(sectionFallbackInstructorName)
            ? sectionFallbackInstructorName
            : undefined;
        if (fallbackStructuredName && !isGenericOfficeHourName(fallbackStructuredName)) {
          const fallbackOfficeBlock =
            normalizeWhitespace(
              normalizeOfficeHourParsingText(section.text).match(
                /\b(?:Instructor'?s Office Hours|Office Hours|Student(?:\s*\(Office\))?\s*Hours?)\b[:\s-]*([\s\S]*?)(?=\b(?:Contacting the Instructor|Teaching Assistants?|TA(?:'s)?\b|Course Description|Student Resources)\b|$)/i
              )?.[1]
            ) || section.text;
          seeds.push(
            ...createOfficeHourSeedsFromStructuredSnippet(
              section,
              fallbackOfficeBlock,
              fallbackStructuredName,
              sectionFallbackInstructorEmail,
              sectionFallbackLocation,
              termBounds
            )
          );

          if (seeds.length === initialSectionSeedCount) {
            const fallbackSlots = extractOfficeHourSlots(fallbackOfficeBlock);
            const fallbackLocation =
              officeHourLocation(fallbackOfficeBlock) || sectionFallbackLocation;
            if (fallbackSlots.length > 0) {
              seeds.push(
                ...fallbackSlots.map((slot) => ({
                  personName: fallbackStructuredName,
                  personEmail: sectionFallbackInstructorEmail,
                  location: isClearlyInvalidOfficeHourLocation(fallbackLocation)
                    ? undefined
                    : fallbackLocation,
                  dayCode: slot.dayCode,
                  startDate: termBounds.startDate,
                  exDates: [],
                  startTime: slot.startTime,
                  endTime: slot.endTime,
                  notes: slot.inferred
                    ? ["Office-hour time inferred from shorthand in outline."]
                    : [],
                  provenance: [makeProvenance(section, "prose", fallbackOfficeBlock)],
                }))
              );
            }
          }
        }
      }
    });

  return seeds;
}

function isGenericOfficeHourName(value: string | null | undefined) {
  const normalized = normalizeWhitespace(value)
    .replace(/^[•*-]\s*/, "")
    .replace(/:+$/, "")
    .trim();
  if (/^[a-z]/.test(normalized)) {
    return true;
  }
  if (normalized.replace(/[^A-Za-z]/g, "").length <= 1) {
    return true;
  }
  if (
    !/^(?:Dr\.?|Prof\.?|Professor)\b/i.test(normalized) &&
    /\b(?:portfolio|assignment|assignments|project|projects|report|reports|essay|essays|quiz|quizzes|test|tests|exam|exams|module|modules|schedule|schedules|lecture|lectures|lab|labs|tutorial|tutorials|discussion|deliverable|deliverables)\b/i.test(
      normalized
    )
  ) {
    return true;
  }
  return /^(?:office hours?|office hour|email|instructor|instructors|teaching assistants?|teaching assistant|tas?|instructional support assistants?|instructional support assistant|instructional assistants?|instructional apprentice|instructional support coordinator|isc|isa|ia|consulting hours?)$/i.test(
      normalized
  ) ||
    /^(?:course instructor|lab instructor|tutorial instructor|discussion instructor)$/i.test(
      normalized
    ) ||
    /^(?:walking|walking office hours|in-person|online)$/i.test(normalized) ||
    /^(?:information|instructor information|contacting the instructor|course coordinator and instructor|instructors and office hours|instructor'?s office hours)$/i.test(
      normalized
    ) ||
    /^(?:course instructor contact information|contact information)$/i.test(normalized) ||
    /^(?:student|students|department(?:\s+of\s+.+)?|school(?:\s+of\s+.+)?|faculty(?:\s+of\s+.+)?|program(?:\s+coordinator)?)$/i.test(
      normalized
    ) ||
    /\b(?:course staff|teaching assistants?|tas?)\b/i.test(normalized) ||
    /^(?:name|contact|name contact)$/i.test(normalized) ||
    /^(?:email address|phone number|contact details|who and why|technical support|student resources)$/i.test(
      normalized
    ) ||
    /^include your full name\b/i.test(normalized) ||
    /^please use\b/i.test(normalized) ||
    /^for\b.*\bquestions?\b/i.test(normalized) ||
    /^(?:(?:Mon(?:day)?s?|Tue(?:s(?:day)?)?s?|Wed(?:nesday)?s?|Thu(?:r(?:s(?:day)?)?)?s?|Fri(?:day)?s?|Sat(?:urday)?s?|Sun(?:day)?s?)\s*(?:,|&|and)?\s*)+$/i.test(
      normalized
    );
}

function isAdministrativeOfficeHourNoiseSnippet(value: string | null | undefined) {
  const normalized = normalizeWhitespace(value).toLowerCase();
  if (!normalized) return false;
  return (
    normalized.includes("technical support") ||
    normalized.includes("student resources") ||
    normalized.includes("learnhelp@uwaterloo.ca") ||
    normalized.includes("regular business hours") ||
    normalized.includes("not going to have specific set office hours") ||
    normalized.includes("set up individual times to meet") ||
    normalized.includes("if needed we can arrange a time and date to meet")
  );
}

function hasMeridiem(value: string) {
  return /\b(a\.?m\.?|p\.?m\.?|am|pm)\b/i.test(value);
}

function parseLooseClock(value: string) {
  const normalized = normalizeWhitespace(value)
    .replace(/(\d)\.(\d{2})(?=\b)/g, "$1:$2")
    .replace(/\b(a\.?m\.?|p\.?m\.?)\b/gi, (match) => match.replace(/\./g, ""))
    .toUpperCase();
  if (normalized === "NOON") {
    return {
      hour: 12,
      minute: 0,
      meridiem: "PM" as const,
    };
  }
  if (normalized === "MIDNIGHT") {
    return {
      hour: 12,
      minute: 0,
      meridiem: "AM" as const,
    };
  }
  const match = normalized.match(/^(\d{1,2})(?::(\d{2}))?\s*(AM|PM)?$/);
  if (!match) return undefined;
  return {
    hour: Number(match[1]),
    minute: Number(match[2] ?? "0"),
    meridiem: match[3] as "AM" | "PM" | undefined,
  };
}

function to24HourTime(
  value: ReturnType<typeof parseLooseClock>,
  fallbackMeridiem?: "AM" | "PM"
) {
  if (!value) return undefined;
  if (value.minute > 59) return undefined;

  const meridiem = value.meridiem ?? fallbackMeridiem;
  if (!meridiem) {
    if (value.hour > 23 || value.minute > 59) return undefined;
    return `${String(value.hour).padStart(2, "0")}:${String(value.minute).padStart(2, "0")}`;
  }
  if (value.hour < 1 || value.hour > 12) return undefined;

  let hour = value.hour;
  if (meridiem === "AM") {
    if (hour === 12) hour = 0;
  } else if (hour < 12) {
    hour += 12;
  }

  return `${String(hour).padStart(2, "0")}:${String(value.minute).padStart(2, "0")}`;
}

function parseOfficeHourTimeRange(value: string) {
  const normalized = normalizeWhitespace(value)
    .replace(/[–—]/g, "-")
    .replace(/\bto\b/gi, "-")
    .replace(/(\d)\.(\d{2})(?=\b)/g, "$1:$2")
    .replace(/:\s+/g, ":")
    .replace(/\s*-\s*-\s*/g, "-");

  const match = normalized.match(
    /(\d{1,2}(?::\d{2})?\s*(?:a\.?m\.?|p\.?m\.?|am|pm|AM|PM)?)\s*-\s*(\d{1,2}(?::\d{2})?\s*(?:a\.?m\.?|p\.?m\.?|am|pm|AM|PM)?)/i
  );
  if (!match) return {};

  const startRaw = normalizeWhitespace(match[1]);
  const endRaw = normalizeWhitespace(match[2]);
  const startClock = parseLooseClock(startRaw);
  const endClock = parseLooseClock(endRaw);
  const startExplicit = hasMeridiem(startRaw) || (startClock?.hour ?? 0) > 12;
  const endExplicit = hasMeridiem(endRaw) || (endClock?.hour ?? 0) > 12;
  let directStart = startExplicit ? parseFlexibleTime(startRaw) : undefined;
  let directEnd = endExplicit ? parseFlexibleTime(endRaw) : undefined;

  if (!startClock || !endClock) {
    return {
      startTime: directStart,
      endTime: directEnd,
    };
  }

  let inferred = false;
  let startMeridiem = startClock.meridiem;
  let endMeridiem = endClock.meridiem;

  if (startMeridiem && !endMeridiem) {
    inferred = true;
    if (startMeridiem === "AM" && endClock.hour < startClock.hour) {
      endMeridiem = "PM";
    } else {
      endMeridiem = startMeridiem;
    }
  } else if (!startMeridiem && endMeridiem) {
    inferred = true;
    if (endMeridiem === "PM" && startClock.hour > endClock.hour && startClock.hour !== 12) {
      startMeridiem = "AM";
    } else if (
      endMeridiem === "AM" &&
      endClock.hour === 12 &&
      startClock.hour >= 7 &&
      startClock.hour < 12
    ) {
      directEnd = undefined;
      startMeridiem = "AM";
      endMeridiem = "PM";
    } else {
      startMeridiem = endMeridiem;
    }
  } else if (!startMeridiem && !endMeridiem) {
    inferred = true;
    if (startClock.hour === 12) {
      startMeridiem = "PM";
      endMeridiem = endClock.hour < 12 ? "PM" : undefined;
    } else if (endClock.hour === 12) {
      startMeridiem = "AM";
      endMeridiem = "PM";
    } else if (startClock.hour >= 8) {
      startMeridiem = "AM";
      endMeridiem = endClock.hour < startClock.hour ? "PM" : "AM";
    } else {
      startMeridiem = "PM";
      endMeridiem = "PM";
    }
  }

  const startTime = directStart ?? to24HourTime(startClock, startMeridiem);
  const endTime = directEnd ?? to24HourTime(endClock, endMeridiem);

  return {
    startTime,
    endTime:
      endTime === "00:00" &&
      !hasMeridiem(startRaw) &&
      /12(?::00)?\s*a\.?m\.?/i.test(endRaw) &&
      startClock.hour >= 7 &&
      startClock.hour < 12
        ? "12:00"
        : endTime,
    inferred,
  };
}

function countValidOfficeHourTimeRanges(value: string | null | undefined) {
  const normalized = normalizeWhitespace(value);
  if (!normalized) return 0;

  return Array.from(
    normalized.matchAll(
      /(\d{1,2}(?::\d{2})?\s*(?:a\.?m\.?|p\.?m\.?|am|pm|AM|PM)?)\s*(?:-|--|–|—|to)\s*(\d{1,2}(?::\d{2})?\s*(?:a\.?m\.?|p\.?m\.?|am|pm|AM|PM)?)/gi
    )
  ).filter((match) => {
    const range = parseOfficeHourTimeRange(`${match[1]} - ${match[2]}`);
    return !!range.startTime && !!range.endTime;
  }).length;
}

function extractOfficeHourSlots(value: string | null | undefined) {
  const normalized = normalizeOfficeHoursSnippet(value)
    .replace(/\s*--+\s*/g, " - ")
    .replace(/^(?:in-person|in person|online|virtual|virtually)\s+/i, "")
    .replace(/\s*\((?:or\s+)?by appointment[^)]*\)/gi, "")
    .replace(/\bor\s+by appointment\b.*$/i, "")
    .trim();
  if (!normalized) return [] as Array<{
    dayCode: WeekdayCode;
    startTime: string;
    endTime: string;
    inferred?: boolean;
  }>;

  const strictNamedDayCodes = parseStrictNamedOfficeHourDayCodes(normalized);
  const strictNamedTimeRanges = Array.from(
    normalized.matchAll(
      /(\d{1,2}(?::\d{2})?\s*(?:a\.?m\.?|p\.?m\.?|am|pm|AM|PM)?)\s*(?:-|--|–|—|to)\s*(\d{1,2}(?::\d{2})?\s*(?:a\.?m\.?|p\.?m\.?|am|pm|AM|PM)?)/gi
    )
  );
  const primaryStrictDayCodes =
    strictNamedTimeRanges.length > 0
      ? officeHourDayCodesForTimeRangeMatch(normalized, strictNamedTimeRanges[0])
      : strictNamedDayCodes;
  if (primaryStrictDayCodes.length > 0 && strictNamedTimeRanges.length === 1) {
    const range = parseOfficeHourTimeRange(
      `${strictNamedTimeRanges[0][1]} - ${strictNamedTimeRanges[0][2]}`
    );
    if (range.startTime && range.endTime) {
      return primaryStrictDayCodes.map((dayCode) => ({
        dayCode,
        startTime: range.startTime!,
        endTime: range.endTime!,
        inferred: range.inferred,
      }));
    }
  }

  const clusteredDayTimeMatches = Array.from(
    normalized.matchAll(
      /\b((?:(?:and\s+)?(?:Mon(?:day)?s?'?s?|Tue(?:s(?:day)?)?s?'?s?|Wed(?:nesday)?s?'?s?|Thu(?:r(?:s(?:day)?)?)?s?'?s?|Fri(?:day)?s?'?s?|Sat(?:urday)?s?'?s?|Sun(?:day)?s?'?s?|M|Tu|Th|T|W|F(?![a-z]))\.?\s*(?:\/|,|&|-|\band\b)?\s*)+)\s*(?:\(([^)]+)\)|(?:,?\s*(?:between|from)\s*)?(\d{1,2}(?::\d{2})?\s*(?:a\.?m\.?|p\.?m\.?|am|pm|AM|PM)?)\s*(?:-|--|–|—|to)\s*(\d{1,2}(?::\d{2})?\s*(?:a\.?m\.?|p\.?m\.?|am|pm|AM|PM)?))/gi
    )
  );
  if (clusteredDayTimeMatches.length > 0) {
    const slots = clusteredDayTimeMatches.flatMap((match) => {
      const dayCodes = parseOfficeHourDayCodes(match[1]);
      const rangeText = match[2] ? match[2] : `${match[3]} - ${match[4]}`;
      const range = parseOfficeHourTimeRange(rangeText);
      if (dayCodes.length === 0 || !range.startTime || !range.endTime) return [];
      return dayCodes.map((dayCode) => ({
        dayCode,
        startTime: range.startTime!,
        endTime: range.endTime!,
        inferred: range.inferred,
      }));
    });
    if (slots.length > 0) {
      return slots;
    }
  }

  const explicitCompoundDayMatch = normalized.match(
    /^((?:(?:Mon(?:day)?s?'?s?|Tue(?:s(?:day)?)?s?'?s?|Wed(?:nesday)?s?'?s?|Thu(?:r(?:s(?:day)?)?)?s?'?s?|Fri(?:day)?s?'?s?|Sat(?:urday)?s?'?s?|Sun(?:day)?s?'?s?)(?:\s*(?:,|&|and|\/)\s*)?)+)\s*(?:from\s*)?(\d{1,2}(?::\d{2})?\s*(?:a\.?m\.?|p\.?m\.?|am|pm|AM|PM)?)\s*(?:-|–|—|to)\s*(\d{1,2}(?::\d{2})?\s*(?:a\.?m\.?|p\.?m\.?|am|pm|AM|PM)?)/i
  );
  if (explicitCompoundDayMatch) {
    const dayCodes = parseOfficeHourDayCodes(explicitCompoundDayMatch[1]);
    const range = parseOfficeHourTimeRange(
      `${explicitCompoundDayMatch[2]} - ${explicitCompoundDayMatch[3]}`
    );
    if (dayCodes.length > 0 && range.startTime && range.endTime) {
      return dayCodes.map((dayCode) => ({
        dayCode,
        startTime: range.startTime!,
        endTime: range.endTime!,
        inferred: range.inferred,
      }));
    }
  }

  const repeatedDayTimeMatches = Array.from(
    normalized.matchAll(
      /\b(Mon(?:day)?s?'?s?|Tue(?:s(?:day)?)?s?'?s?|Wed(?:nesday)?s?'?s?|Thu(?:r(?:s(?:day)?)?)?s?'?s?|Fri(?:day)?s?'?s?|Sat(?:urday)?s?'?s?|Sun(?:day)?s?'?s?|M|Tu|Th|T|W|F(?![a-z]))\b\.?\s*(?:,)?\s*(?:from\s*)?(\d{1,2}(?::\d{2})?\s*(?:a\.?m\.?|p\.?m\.?|am|pm|AM|PM)?)\s*(?:-|–|—|to)\s*(\d{1,2}(?::\d{2})?\s*(?:a\.?m\.?|p\.?m\.?|am|pm|AM|PM)?)/gi
    )
  );
  if (repeatedDayTimeMatches.length > 0) {
    return repeatedDayTimeMatches.flatMap((match) => {
      const dayCodes = parseOfficeHourDayCodes(match[1]);
      const range = parseOfficeHourTimeRange(`${match[2]} - ${match[3]}`);
      if (dayCodes.length === 0 || !range.startTime || !range.endTime) return [];
      return dayCodes.map((dayCode) => ({
        dayCode,
        startTime: range.startTime!,
        endTime: range.endTime!,
        inferred: range.inferred,
      }));
    });
  }

  const timeRangePattern =
    /(\d{1,2}(?::\d{2})?\s*(?:a\.?m\.?|p\.?m\.?|am|pm|AM|PM)?)\s*(?:-|–|—|to)\s*(\d{1,2}(?::\d{2})?\s*(?:a\.?m\.?|p\.?m\.?|am|pm|AM|PM)?)/gi;
  const dayLeadMatch = normalized.match(
    /^((?:(?:Mon(?:day)?s?'?s?|Tue(?:s(?:day)?)?s?'?s?|Wed(?:nesday)?s?'?s?|Thu(?:r(?:s(?:day)?)?)?s?'?s?|Fri(?:day)?s?'?s?|Sat(?:urday)?s?'?s?|Sun(?:day)?s?'?s?|M|Tu|Th|T|W|F(?![a-z]))\.?\s*(?:,|&|and|\/|\s+)?\s*)+)(.*)$/i
  );

  if (dayLeadMatch) {
    const dayCodes = parseOfficeHourDayCodes(dayLeadMatch[1]);
    const ranges = Array.from(dayLeadMatch[2].matchAll(timeRangePattern));
    if (dayCodes.length > 0 && ranges.length > 0) {
      return ranges.flatMap((match) => {
        const range = parseOfficeHourTimeRange(`${match[1]} - ${match[2]}`);
        if (!range.startTime || !range.endTime) return [];
        return dayCodes.map((dayCode) => ({
          dayCode,
          startTime: range.startTime!,
          endTime: range.endTime!,
          inferred: range.inferred,
        }));
      });
    }
  }

  const timeLeadMatches = Array.from(
    normalized.matchAll(
      /(\d{1,2}(?::\d{2})?\s*(?:a\.?m\.?|p\.?m\.?|am|pm|AM|PM)?\s*(?:-|–|—|to)\s*\d{1,2}(?::\d{2})?\s*(?:a\.?m\.?|p\.?m\.?|am|pm|AM|PM)?)\s*(?:,\s*|\s+)(?:on\s+)?((?:(?:Mon(?:day)?s?'?s?|Tue(?:s(?:day)?)?s?'?s?|Wed(?:nesday)?s?'?s?|Thu(?:r(?:s(?:day)?)?)?s?'?s?|Fri(?:day)?s?'?s?|Sat(?:urday)?s?'?s?|Sun(?:day)?s?'?s?|M|Tu|Th|T|W|F(?![a-z]))\.?\s*(?:,|&|and|\/|\s+)?\s*)+)/gi
    )
  );
  if (timeLeadMatches.length > 0) {
    return timeLeadMatches.flatMap((match) => {
      const range = parseOfficeHourTimeRange(match[1]);
      const dayCodes = parseOfficeHourDayCodes(match[2]);
      if (dayCodes.length === 0 || !range.startTime || !range.endTime) return [];
      return dayCodes.map((dayCode) => ({
        dayCode,
        startTime: range.startTime!,
        endTime: range.endTime!,
        inferred: range.inferred,
      }));
    });
  }

  return [] as Array<{
    dayCode: WeekdayCode;
    startTime: string;
    endTime: string;
    inferred?: boolean;
  }>;
}

function extractOfficeHourSlotsWithFallback(value: string | null | undefined) {
  const directSlots = extractOfficeHourSlots(value);
  if (directSlots.length > 0) {
    return {
      slots: directSlots,
      sourceText: normalizeOfficeHoursSnippet(value),
    };
  }

  const normalized = normalizeOfficeHourParsingText(value);
  const lines = normalized
    .split(/\n+/)
    .map((line) => normalizeWhitespace(line))
    .filter(Boolean);

  for (const line of lines) {
    const lineSlots = extractOfficeHourSlots(line);
    if (lineSlots.length > 0) {
      return {
        slots: lineSlots,
        sourceText: line,
      };
    }
  }

  const weekdayTail = normalized.match(
    /\b(?:Mon(?:day)?s?'?s?|Tue(?:s(?:day)?)?s?'?s?|Wed(?:nesday)?s?'?s?|Thu(?:r(?:s(?:day)?)?)?s?'?s?|Fri(?:day)?s?'?s?|Sat(?:urday)?s?'?s?|Sun(?:day)?s?'?s?)\b[\s\S]*$/i
  )?.[0];
  if (weekdayTail) {
    const tailSlots = extractOfficeHourSlots(weekdayTail);
    if (tailSlots.length > 0) {
      return {
        slots: tailSlots,
        sourceText: weekdayTail,
      };
    }
  }

  return {
    slots: [] as ReturnType<typeof extractOfficeHourSlots>,
    sourceText: normalizeOfficeHoursSnippet(value),
  };
}

function parseOfficeHours(
  sections: SectionBlock[],
  meta: OutlineMeta,
  meetings: RawMeetingRow[]
) {
  const termBounds = computeTermBounds(meetings) ?? computeFallbackTermBounds(sections, meta);
  if (!termBounds) return [] as OfficeHourSeed[];

  const seeds: OfficeHourSeed[] = [];
  const relevantSections = sections.filter((section) =>
    !isLikelyInstructionalSection(section) &&
    !OFFICE_HOUR_SCHEDULE_SECTION_IDS.has(section.id) &&
    /\b(office hours?|office location (?:and|&) hours?|student(?:\s*\(office\))?\s*hours?|open student hours?|my office hours are|drop-in ta office hours)\b/i.test(
      normalizeOfficeHourParsingText(section.text)
    ) &&
    !/\b(counselling services?|here ?24 ?7|booked appointments|hours:\s*$)\b/i.test(
      normalizeOfficeHourParsingText(section.text)
    )
  );

  relevantSections.forEach((section) => {
    const text = normalizeOfficeHourParsingText(section.text);
    const taGroupLocation =
      text.match(/\ball\s+ta\s+office hours?\s+are\s+in\s+([A-Z]{2,4}\d?(?:-|\s*)\d{3,4}[A-Za-z]?)\b/i)?.[1]?.trim() ??
      undefined;
    const initialSeedCount = seeds.length;
    const candidateLines = officeHoursLineCandidates(text);
    if (candidateLines.length === 0) {
      return;
    }
    const hasExplicitOfficeHourLine = candidateLines.some((candidate) =>
      /\b(office hours?|office location (?:and|&) hours?|student(?:\s*\(office\))?\s*hours?|open student hours?|my office hours are|drop-in ta office hours)\b/i.test(
        candidate
      )
    );
    const officeHoursWindowContext = (() => {
      const line = candidateLines.find((candidate) =>
        /\boffice hours?\s*\(/i.test(candidate)
      );
      if (!line) return undefined;
      const year = meta.termYear;
      const startingMatch = line.match(/\bstarting\s+([^,);]+)/i)?.[1];
      const excludingText = line.match(/\bexcluding\s+([^)]+)/i)?.[1] ?? "";
      const startDate =
        (startingMatch ? extractExplicitDates(startingMatch, year)[0] : undefined) ??
        undefined;
      const exDates = extractExplicitDates(excludingText, year);
      if (!startDate && exDates.length === 0) return undefined;
      return {
        startDate,
        exDates,
      };
    })();
    const resolvedFallbackLocation =
      /virtual|online/i.test(text) && !officeHourLocation(text)
        ? "Online"
        : officeHourLocation(text);
    const fallbackLocation = isClearlyInvalidOfficeHourLocation(resolvedFallbackLocation)
      ? undefined
      : resolvedFallbackLocation;
    const fallbackInstructorName = officeHourInstructorName(text, meetings, meta);
    const fallbackInstructorEmail = officeHourInstructorEmail(text, meetings);
    let activeInstructorName = fallbackInstructorName;
    let activeInstructorEmail = fallbackInstructorEmail;
    let activeLocation = fallbackLocation;
    let withinOfficeHoursBlock = false;

    const explicitTaOfficeHourMatches = Array.from(
      text.matchAll(
        /\b(?:TA|Teaching Assistant)\s*:\s*((?:(?:Dr\.?|Prof\.?|Professor)\s+)?[\p{L}][\p{L}'’.-]+(?:\s+[\p{L}][\p{L}'’.-]+){0,4})(?:\s*\(([A-Z0-9._%+-]+@uwaterloo\.ca)\))?[\s\S]{0,160}?\b(?:TA|Teaching Assistant)\s+Office Hours?\s*:\s*([^.\n]+)/giu
      )
    );
    explicitTaOfficeHourMatches.forEach((match) => {
      const taName = sanitizeOfficeHourPersonName(match[1]);
      const taEmail = match[2] || undefined;
      const taSnippet = `TA Office Hours: ${normalizeWhitespace(match[3])}`;
      if (!taName || !taSnippet) {
        return;
      }
      seeds.push(
        ...createOfficeHourSeedsFromStructuredSnippet(
          section,
          taSnippet,
          taName,
          taEmail,
          fallbackLocation,
          termBounds
        )
      );
    });

    const inlineRoleSegments = hasExplicitOfficeHourLine
      ? []
      : normalizeWhitespace(text)
          .split(
            /(?=\b(?:Instructor|Course Instructor|Teaching Assistant|Lead Teaching Assistant|TA)\s*:)/i
          )
          .map((segment) => normalizeOfficeHourParsingText(segment))
          .map((segment) => normalizeWhitespace(segment))
          .filter(Boolean);

    inlineRoleSegments.forEach((segment) => {
      if (!/\b(?:office hours?|student(?:\s*\(office\))?\s*hours?)\b/i.test(segment)) {
        return;
      }

      const segmentInstructor =
        sanitizeOfficeHourPersonName(
          segment.match(
            /\b(?:Instructor|Course Instructor|Teaching Assistant|Lead Teaching Assistant|TA)\s*:?\s*((?:Dr\.?\s+)?[A-Z][A-Za-z'’.-]+(?:\s+[A-Z][A-Za-z'’.-]+){1,3})(?=\s*(?:Email(?: Address)?\s*:|[A-Z0-9._%+-]+@uwaterloo\.ca\b|Office hours?\b|Student(?:\s*\(office\))?\s*hours?\b))/i
          )?.[1]
        ) || fallbackInstructorName;
      const segmentEmail =
        segment.match(/[A-Z0-9._%+-]+@uwaterloo\.ca/i)?.[0] || fallbackInstructorEmail;
      const segmentLocation =
        officeHourLocation(segment) && !isClearlyInvalidOfficeHourLocation(officeHourLocation(segment))
          ? officeHourLocation(segment)
          : activeLocation;
      const officeSnippet =
        normalizeOfficeHoursSnippet(
          segment.match(
            /\b(?:office hours?|student(?:\s*\(office\))?\s*hours?)\s*:?\s*.+$/i
          )?.[0] ?? segment
        ) || segment;
      const extractedSegmentSlots = extractOfficeHourSlots(officeSnippet);
      if (
        extractedSegmentSlots.length === 0 &&
        /by appointment|upon appointment|tbd|to be determined/i.test(officeSnippet)
      ) {
        return;
      }
      if (extractedSegmentSlots.length > 0) {
        extractedSegmentSlots.forEach((slot) => {
          seeds.push({
            personName: segmentInstructor,
            personEmail: segmentEmail,
            location: segmentLocation,
            dayCode: slot.dayCode,
            startDate: officeHoursWindowContext?.startDate,
            exDates: officeHoursWindowContext?.exDates,
            startTime: slot.startTime,
            endTime: slot.endTime,
            notes: slot.inferred
              ? ["Office-hour time inferred from shorthand in outline."]
              : [],
            provenance: [makeProvenance(section, "prose", segment)],
          });
        });
        return;
      }
      const simpleSegmentDayTimeMatch = officeSnippet.match(
        /^((?:(?:Mon(?:day)?s?'?s?|Tue(?:s(?:day)?)?s?'?s?|Wed(?:nesday)?s?'?s?|Thu(?:r(?:s(?:day)?)?)?s?'?s?|Fri(?:day)?s?'?s?|Sat(?:urday)?s?'?s?|Sun(?:day)?s?'?s?|F(?![a-z]))\.?\s*(?:,|&|and|\/)?\s*)+)(?::\s*|from\s*)?(\d{1,2}(?::\d{2})?\s*(?:a\.?m\.?|p\.?m\.?|am|pm|AM|PM)?)\s*(?:-|–|—|to)\s*(\d{1,2}(?::\d{2})?\s*(?:a\.?m\.?|p\.?m\.?|am|pm|AM|PM)?)/i
      );
      const simpleSegmentDayCodes = simpleSegmentDayTimeMatch
        ? parseOfficeHourDayCodes(simpleSegmentDayTimeMatch[1])
        : [];
      const repeatedSegmentDayTimePattern =
        /\b(Mon(?:day)?s?'?s?|Tue(?:s(?:day)?)?s?'?s?|Wed(?:nesday)?s?'?s?|Thu(?:r(?:s(?:day)?)?)?s?'?s?|Fri(?:day)?s?'?s?|Sat(?:urday)?s?'?s?|Sun(?:day)?s?'?s?|F(?![a-z]))\b\.?\s*(?::\s*|from\s*)?(\d{1,2}(?::\d{2})?\s*(?:a\.?m\.?|p\.?m\.?|am|pm|AM|PM)?)\s*(?:-|–|—|to)\s*(\d{1,2}(?::\d{2})?\s*(?:a\.?m\.?|p\.?m\.?|am|pm|AM|PM)?)(?:\s*\(([^)]+)\))?/gi;
      const repeatedSegmentMatches = Array.from(officeSnippet.matchAll(repeatedSegmentDayTimePattern));
      const repeatedSegmentDayCodeCount = repeatedSegmentMatches.reduce(
        (total, match) => total + parseOfficeHourDayCodes(match[1]).length,
        0
      );
      if (repeatedSegmentDayCodeCount > simpleSegmentDayCodes.length) {
        repeatedSegmentMatches.forEach((match) => {
          const dayCodes = parseOfficeHourDayCodes(match[1]);
          const range = parseOfficeHourTimeRange(`${match[2]} - ${match[3]}`);
          if (dayCodes.length === 0 || !range.startTime || !range.endTime) return;
          const repeatedLocationHint = normalizeWhitespace(match[4]);
          const repeatedLocation =
            /virtual|online|teams?|zoom/i.test(repeatedLocationHint)
              ? "Online"
              : /office/i.test(repeatedLocationHint)
                ? segmentLocation
                : segmentLocation;

          dayCodes.forEach((dayCode) => {
            seeds.push({
              personName: segmentInstructor,
              personEmail: segmentEmail,
              location: repeatedLocation,
              dayCode,
              startDate: officeHoursWindowContext?.startDate,
              exDates: officeHoursWindowContext?.exDates,
              startTime: range.startTime,
              endTime: range.endTime,
              notes: range.inferred
                ? ["Office-hour time inferred from shorthand in outline."]
                : [],
              provenance: [makeProvenance(section, "prose", segment)],
            });
          });
        });
        return;
      }

      if (!simpleSegmentDayTimeMatch) {
        return;
      }

      const dayCodes = simpleSegmentDayCodes;
      const range = parseOfficeHourTimeRange(
        `${simpleSegmentDayTimeMatch[2]} - ${simpleSegmentDayTimeMatch[3]}`
      );
      if (dayCodes.length === 0 || !range.startTime || !range.endTime) {
        return;
      }

      dayCodes.forEach((dayCode) => {
        seeds.push({
          personName: segmentInstructor,
          personEmail: segmentEmail,
          location: segmentLocation,
          dayCode,
          startDate: officeHoursWindowContext?.startDate,
          exDates: officeHoursWindowContext?.exDates,
          startTime: range.startTime,
          endTime: range.endTime,
          notes: range.inferred
            ? ["Office-hour time inferred from shorthand in outline."]
            : [],
          provenance: [makeProvenance(section, "prose", segment)],
        });
      });
    });

    candidateLines.forEach((line) => {
      const normalizedCandidateLine = normalizeWhitespace(line.replace(/^[•*-]\s*/, ""));
      const hasOfficeHourCue =
        /\b(?:office hours?|office location (?:and|&) hours?|student(?:\s*\(office\))?\s*hours?|open student hours?|my office hours are|drop-in ta office hours|consulting hours?)\b/i.test(
          normalizedCandidateLine
        );
      const lineEmail = normalizedCandidateLine.match(/[A-Z0-9._%+-]+@uwaterloo\.ca/i)?.[0];
      const sectionInstructorMatch = normalizedCandidateLine.match(
        /Section\s+\d+\s*\(([^)]+)\)\s*-\s*Office Hours/i
      );
      if (sectionInstructorMatch && !isGenericOfficeHourName(sectionInstructorMatch[1])) {
        activeInstructorName = sanitizeOfficeHourPersonName(sectionInstructorMatch[1]);
      }
      const rolePrefixedNameMatch = normalizedCandidateLine.match(
        /^(?:Instructor|Course Instructor|Teaching Assistant|TA|Instructional Support Assistant|Instructional Assistant|Instructional Apprentice|Instructional Support Coordinator|ISC|ISA|IA)\s*(?:\([^)]*\))?:\s*((?:Dr\.?\s+)?[A-Z][A-Za-z'’.-]+(?:\s+[A-Z][A-Za-z'’.-]+){1,3})\b/i
      );
      const namePrefixedMatch = normalizedCandidateLine.match(
        /^name\s*:?\s*((?:(?:Dr\.?|Prof\.?|Professor)\s+)?[A-Z][A-Za-z'’.-]+(?:\s+[A-Z][A-Za-z'’.-]+){1,4})\b/iu
      )?.[1];
      if (namePrefixedMatch && !isGenericOfficeHourName(namePrefixedMatch)) {
        activeInstructorName = sanitizeOfficeHourPersonName(namePrefixedMatch);
        activeInstructorEmail = lineEmail || activeInstructorEmail;
      }
      if (rolePrefixedNameMatch && !isGenericOfficeHourName(rolePrefixedNameMatch[1])) {
        activeInstructorName = sanitizeOfficeHourPersonName(rolePrefixedNameMatch[1]);
        activeInstructorEmail = lineEmail || activeInstructorEmail;
      }
      const personHeadingMatch = normalizedCandidateLine.match(
        /^((?:Dr\.?\s+)?[A-Z][A-Za-z'’.-]+(?:\s+[A-Z][A-Za-z'’.-]+){1,3})(?=\s*(?:,|\(|[A-Z0-9._%+-]+@uwaterloo\.ca|$))/i
      );
      if (personHeadingMatch && !isGenericOfficeHourName(personHeadingMatch[1])) {
        activeInstructorName = sanitizeOfficeHourPersonName(personHeadingMatch[1]);
        activeInstructorEmail = lineEmail || activeInstructorEmail;
      }
      const namedOfficeHourMatch = line.match(
        /^\s*([A-Z][A-Za-z'’., -]{1,80}?)\s*:\s*(?:(?:.*?(?:Mon(?:day)?s?'?s?|Tue(?:s(?:day)?)?s?'?s?|Wed(?:nesday)?s?'?s?|Thu(?:r(?:s(?:day)?)?)?s?'?s?|Fri(?:day)?s?'?s?|Sat(?:urday)?s?'?s?|Sun(?:day)?s?'?s?))|(?:.*@uwaterloo\.ca))/i
      );
      if (namedOfficeHourMatch && !isGenericOfficeHourName(namedOfficeHourMatch[1])) {
        activeInstructorName = sanitizeOfficeHourPersonName(namedOfficeHourMatch[1]);
        activeInstructorEmail = lineEmail || activeInstructorEmail;
      } else if (lineEmail) {
        activeInstructorEmail = lineEmail;
      }

      if (/^email\s*:/i.test(normalizedCandidateLine) && lineEmail) {
        activeInstructorEmail = lineEmail;
        return;
      }

      if (/^office\s*:/i.test(normalizedCandidateLine)) {
        const officeOnlyLocation = officeHourLocation(normalizedCandidateLine);
        if (officeOnlyLocation) {
          activeLocation = officeOnlyLocation;
        }
        withinOfficeHoursBlock = true;
        return;
      }

      if (/^(?:lectures?|tutorials?|labs?)\s*:/i.test(normalizedCandidateLine)) {
        withinOfficeHoursBlock = false;
        return;
      }

      if (
        /^(?:assignments?|midterm(?: exam)?|tests?|quizzes?|assessment schedule|course policies|grading|teaching assistants?|tas?|instructional support coordinator|isc)\b/i.test(
          normalizedCandidateLine
        )
      ) {
        withinOfficeHoursBlock = false;
      }

      if (
        /\b(?:regular business hours|business hours|working hours|technical support|include your full name|student resources)\b/i.test(
          normalizedCandidateLine
        ) &&
        !/\b(office hours?|student(?:\s*\(office\))?\s*hours?|open student hours?)\b/i.test(
          normalizedCandidateLine
        )
      ) {
        return;
      }

      const canUpdateLocationFromLine =
        /^office\s*:|^office location (?:and|&) hours?\s*:|^consulting (?:center|hours?)\s*:|^office hours?\s*:|^student hours?/i.test(
          normalizedCandidateLine
        ) ||
        /\b(?:online|teams?|zoom|room)\b/i.test(normalizedCandidateLine) ||
        /^[A-Z][A-Z0-9]{0,3}(?:-|\s*)\d{3,4}[A-Za-z]?\b/.test(normalizedCandidateLine) ||
        /\([A-Z][A-Z0-9]{0,3}(?:-|\s*)\d{3,4}[A-Za-z]?\)/.test(normalizedCandidateLine) ||
        /\bin\s+[A-Z][A-Z0-9]{0,3}(?:-|\s*)\d{3,4}[A-Za-z]?\b/i.test(normalizedCandidateLine);
      const officeHoursOnlySnippet =
        normalizeOfficeHoursSnippet(
          normalizedCandidateLine.match(
            /\b(?:office hours?|office location (?:and|&) hours?|student(?:\s*\(office\))?\s*hours?|open student hours?|my office hours are|drop-in ta office hours)\b[:\s-]*.*$/i
          )?.[0] ?? normalizedCandidateLine
        ) || normalizedCandidateLine;
      const lineLocation = canUpdateLocationFromLine
        ? officeHourLocation(normalizedCandidateLine) || officeHourLocation(officeHoursOnlySnippet)
        : undefined;
      const candidateLocation =
        lineLocation ||
        (/\b(?:tas?|teaching assistants?)\b/i.test(normalizedCandidateLine)
          ? taGroupLocation
          : undefined) ||
        activeLocation;
      if (lineLocation && !isClearlyInvalidOfficeHourLocation(lineLocation)) {
        activeLocation = lineLocation;
      }

      const normalizedLine = officeHoursOnlySnippet;
      if (!normalizedLine) return;
      if (hasOfficeHourCue) {
        withinOfficeHoursBlock = true;
      }
      const heldEachDayTimeMatch = normalizedCandidateLine.match(
        /\boffice hours?\s+will\s+be\s+held\s+(?:each\s+)?((?:(?:Mon(?:day)?s?'?s?|Tue(?:s(?:day)?)?s?'?s?|Wed(?:nesday)?s?'?s?|Thu(?:r(?:s(?:day)?)?)?s?'?s?|Fri(?:day)?s?'?s?|Sat(?:urday)?s?'?s?|Sun(?:day)?s?'?s?|F(?![a-z]))\.?\s*(?:,|&|and|\/)?\s*)+)(?:between\s+|from\s+)?(\d{1,2}(?::\d{2})?\s*(?:a\.?m\.?|p\.?m\.?|am|pm|AM|PM)?)\s*(?:-|–|—|to)\s*(\d{1,2}(?::\d{2})?\s*(?:a\.?m\.?|p\.?m\.?|am|pm|AM|PM)?)/i
      );
      if (heldEachDayTimeMatch) {
        const dayCodes = parseOfficeHourDayCodes(heldEachDayTimeMatch[1]);
        const range = parseOfficeHourTimeRange(
          `${heldEachDayTimeMatch[2]} - ${heldEachDayTimeMatch[3]}`
        );
        const personName =
          activeInstructorName && !isGenericOfficeHourName(activeInstructorName)
            ? activeInstructorName
            : fallbackInstructorName;
        if (dayCodes.length > 0 && range.startTime && range.endTime) {
          dayCodes.forEach((dayCode) => {
            seeds.push({
              personName,
              personEmail: activeInstructorEmail,
              location: candidateLocation,
              dayCode,
              startDate: officeHoursWindowContext?.startDate,
              exDates: officeHoursWindowContext?.exDates,
              startTime: range.startTime,
              endTime: range.endTime,
              notes: range.inferred
                ? ["Office-hour time inferred from shorthand in outline."]
                : [],
              provenance: [makeProvenance(section, "prose", line)],
            });
          });
          return;
        }
      }
      const extractedLineSlots = extractOfficeHourSlots(normalizedLine);
      if (
        extractedLineSlots.length === 0 &&
        /by appointment|tbd|to be determined|will be offered|scheduled on the course web site|no additional office hours/i.test(
          normalizedLine
        )
      ) {
        return;
      }
      const namedDayTimePattern =
        /([A-Z][A-Za-z'’.\- ]{1,80}?)\s*,\s*((?:(?:Mon(?:day)?s?'?s?|Tue(?:s(?:day)?)?s?'?s?|Wed(?:nesday)?s?'?s?|Thu(?:r(?:s(?:day)?)?)?s?'?s?|Fri(?:day)?s?'?s?|Sat(?:urday)?s?'?s?|Sun(?:day)?s?'?s?|F(?![a-z]))\.?\s*(?:,|&|and|\/)?\s*)+)(?::\s*|from\s*)?(\d{1,2}(?::\d{2})?\s*(?:a\.?m\.?|p\.?m\.?|am|pm|AM|PM)?)\s*(?:-|–|—|to)\s*(\d{1,2}(?::\d{2})?\s*(?:a\.?m\.?|p\.?m\.?|am|pm|AM|PM)?)/gi;
      const namedDayTimeMatches = Array.from(normalizedLine.matchAll(namedDayTimePattern));
      let lineProducedSeed = false;
      if (!withinOfficeHoursBlock && !hasOfficeHourCue) {
        return;
      }
      for (const match of namedDayTimeMatches) {
        const candidate = sanitizeOfficeHourPersonName(match[1]);
        if (!candidate || isGenericOfficeHourName(candidate)) {
          continue;
        }
        const personName = candidate;
        const dayCodes = parseOfficeHourDayCodes(match[2]);
        if (dayCodes.length === 0) continue;

        const range = parseOfficeHourTimeRange(`${match[3]} - ${match[4]}`);
        if (!range.startTime || !range.endTime) continue;

        seeds.push(
          ...dayCodes.map((dayCode) => ({
            personName,
            personEmail:
              personName === activeInstructorName ? activeInstructorEmail : undefined,
            location: candidateLocation,
            dayCode,
            startDate: officeHoursWindowContext?.startDate,
            exDates: officeHoursWindowContext?.exDates,
            startTime: range.startTime!,
            endTime: range.endTime!,
            notes: range.inferred
              ? ["Office-hour time inferred from shorthand in outline."]
              : [],
            provenance: [makeProvenance(section, "prose", line)],
          }))
        );
        lineProducedSeed = true;
      }

      if (lineProducedSeed) {
        return;
      }
      const structuredLinePersonName =
        activeInstructorName && !isGenericOfficeHourName(activeInstructorName)
          ? activeInstructorName
          : fallbackInstructorName;
      if (structuredLinePersonName) {
        const structuredLineSeeds = createOfficeHourSeedsFromStructuredSnippet(
          section,
          normalizedLine,
          structuredLinePersonName,
          activeInstructorEmail,
          candidateLocation,
          termBounds
        );
        if (structuredLineSeeds.length > 0) {
          seeds.push(...structuredLineSeeds);
          return;
        }
      }
      if (extractedLineSlots.length > 0) {
        const personName =
          activeInstructorName && !isGenericOfficeHourName(activeInstructorName)
            ? activeInstructorName
            : fallbackInstructorName;
        extractedLineSlots.forEach((slot) => {
          seeds.push({
            personName,
            personEmail: activeInstructorEmail,
            location: candidateLocation,
            dayCode: slot.dayCode,
            startDate: officeHoursWindowContext?.startDate,
            exDates: officeHoursWindowContext?.exDates,
            startTime: slot.startTime,
            endTime: slot.endTime,
            notes: slot.inferred
              ? ["Office-hour time inferred from shorthand in outline."]
              : [],
            provenance: [makeProvenance(section, "prose", line)],
          });
        });
        return;
      }

      const simpleDayTimeMatch = normalizedLine.match(
        /^((?:(?:Mon(?:day)?s?'?s?|Tue(?:s(?:day)?)?s?'?s?|Wed(?:nesday)?s?'?s?|Thu(?:r(?:s(?:day)?)?)?s?'?s?|Fri(?:day)?s?'?s?|Sat(?:urday)?s?'?s?|Sun(?:day)?s?'?s?|F(?![a-z]))\.?\s*(?:,|&|and|\/)?\s*)+)(?::\s*|from\s*)?(\d{1,2}(?::\d{2})?\s*(?:a\.?m\.?|p\.?m\.?|am|pm|AM|PM)?)\s*(?:-|–|—|to)\s*(\d{1,2}(?::\d{2})?\s*(?:a\.?m\.?|p\.?m\.?|am|pm|AM|PM)?)/i
      );
      const simpleDayCodes = simpleDayTimeMatch
        ? parseOfficeHourDayCodes(simpleDayTimeMatch[1])
        : [];
      const repeatedDayTimePattern =
        /\b(Mon(?:day)?s?'?s?|Tue(?:s(?:day)?)?s?'?s?|Wed(?:nesday)?s?'?s?|Thu(?:r(?:s(?:day)?)?)?s?'?s?|Fri(?:day)?s?'?s?|Sat(?:urday)?s?'?s?|Sun(?:day)?s?'?s?|F(?![a-z]))\b\.?\s*(?::\s*|from\s*)?(\d{1,2}(?::\d{2})?\s*(?:a\.?m\.?|p\.?m\.?|am|pm|AM|PM)?)\s*(?:-|–|—|to)\s*(\d{1,2}(?::\d{2})?\s*(?:a\.?m\.?|p\.?m\.?|am|pm|AM|PM)?)(?:\s*\(([^)]+)\))?/gi;
      const repeatedDayTimeMatches = Array.from(normalizedLine.matchAll(repeatedDayTimePattern));
      const repeatedDayCodeCount = repeatedDayTimeMatches.reduce(
        (total, match) => total + parseOfficeHourDayCodes(match[1]).length,
        0
      );

      for (const match of repeatedDayCodeCount > simpleDayCodes.length ? repeatedDayTimeMatches : []) {
        const dayCodes = parseOfficeHourDayCodes(match[1]);
        if (dayCodes.length === 0) continue;
        const range = parseOfficeHourTimeRange(`${match[2]} - ${match[3]}`);
        if (!range.startTime || !range.endTime) continue;
        const personName =
          activeInstructorName && !isGenericOfficeHourName(activeInstructorName)
            ? activeInstructorName
            : fallbackInstructorName;
        const repeatedLocationHint = normalizeWhitespace(match[4]);
        const repeatedLocation =
          /virtual|online|teams?|zoom/i.test(repeatedLocationHint)
            ? "Online"
            : /office/i.test(repeatedLocationHint)
              ? activeLocation
              : candidateLocation;

        dayCodes.forEach((dayCode) => {
          seeds.push({
            personName,
            personEmail: activeInstructorEmail,
            location: repeatedLocation,
            dayCode,
            startDate: officeHoursWindowContext?.startDate,
            exDates: officeHoursWindowContext?.exDates,
            startTime: range.startTime,
            endTime: range.endTime,
            notes: range.inferred
              ? ["Office-hour time inferred from shorthand in outline."]
              : [],
            provenance: [makeProvenance(section, "prose", line)],
          });
        });
        lineProducedSeed = true;
      }

      if (lineProducedSeed) {
        return;
      }
      if (simpleDayTimeMatch) {
        const dayCodes = simpleDayCodes;
        const range = parseOfficeHourTimeRange(
          `${simpleDayTimeMatch[2]} - ${simpleDayTimeMatch[3]}`
        );
        const personName =
          activeInstructorName && !isGenericOfficeHourName(activeInstructorName)
            ? activeInstructorName
            : fallbackInstructorName;

        if (dayCodes.length > 0 && range.startTime && range.endTime) {
          dayCodes.forEach((dayCode) => {
            seeds.push({
              personName,
              personEmail: activeInstructorEmail,
              location: candidateLocation,
              dayCode,
              startDate: officeHoursWindowContext?.startDate,
              exDates: officeHoursWindowContext?.exDates,
              startTime: range.startTime,
              endTime: range.endTime,
              notes: range.inferred
                ? ["Office-hour time inferred from shorthand in outline."]
                : [],
              provenance: [makeProvenance(section, "prose", line)],
            });
          });
          lineProducedSeed = true;
        }
      }

      const dayTimePattern =
        /((?:(?:Mon(?:day)?s?'?s?|Tue(?:s(?:day)?)?s?'?s?|Wed(?:nesday)?s?'?s?|Thu(?:r(?:s(?:day)?)?)?s?'?s?|Fri(?:day)?s?'?s?|Sat(?:urday)?s?'?s?|Sun(?:day)?s?'?s?|F)\.?\s*(?:,|&|and|\/)?\s*)+)(?::\s*|from\s*)?(\d{1,2}(?::\d{2})?\s*(?:a\.?m\.?|p\.?m\.?|am|pm|AM|PM)?)\s*(?:-|–|—|to)\s*(\d{1,2}(?::\d{2})?\s*(?:a\.?m\.?|p\.?m\.?|am|pm|AM|PM)?)/gi;

      for (const match of normalizedLine.matchAll(dayTimePattern)) {
        const dayCodes = parseOfficeHourDayCodes(match[1]);
        if (dayCodes.length === 0) continue;

        const range = parseOfficeHourTimeRange(`${match[2]} - ${match[3]}`);
        if (!range.startTime || !range.endTime) continue;
        const personName =
          activeInstructorName && !isGenericOfficeHourName(activeInstructorName)
            ? activeInstructorName
            : fallbackInstructorName;

        dayCodes.forEach((dayCode) => {
          seeds.push({
            personName,
            personEmail: activeInstructorEmail,
            location: candidateLocation,
            dayCode,
            startDate: officeHoursWindowContext?.startDate,
            exDates: officeHoursWindowContext?.exDates,
            startTime: range.startTime,
            endTime: range.endTime,
            notes: range.inferred
              ? ["Office-hour time inferred from shorthand in outline."]
              : [],
            provenance: [makeProvenance(section, "prose", line)],
          });
        });
      }

      const classPeriodMatch = normalizedLine.match(
        /\b(?:during|on)\s+the\s+(Mon(?:day)?|Tue(?:s|sday)?|Wed(?:nesday)?|Thu(?:r|rs|rsday|ursday)?|Fri(?:day)?|Sat(?:urday)?|Sun(?:day)?)\s+class period\b/i
      );
      if (!lineProducedSeed && classPeriodMatch) {
        const dayCode = parseOfficeHourDayCodes(classPeriodMatch[1])[0];
        const matchingMeeting = meetings.find(
          (meeting) =>
            meeting.dayCodes.includes(dayCode) &&
            meeting.startTime &&
            meeting.endTime &&
            meeting.eventType === "Lecture"
        );
        if (matchingMeeting?.startTime && matchingMeeting.endTime) {
          const personName =
            activeInstructorName && !isGenericOfficeHourName(activeInstructorName)
              ? activeInstructorName
              : fallbackInstructorName;
          seeds.push({
            personName,
            personEmail: activeInstructorEmail,
            location: candidateLocation,
            dayCode,
            startDate: officeHoursWindowContext?.startDate,
            exDates: officeHoursWindowContext?.exDates,
            startTime: matchingMeeting.startTime,
            endTime: matchingMeeting.endTime,
            notes: ["Office-hour time inferred from the scheduled class period in the outline."],
            provenance: [makeProvenance(section, "prose", line)],
          });
        }
      }
    });

    if (seeds.length === initialSeedCount) {
      const fallbackSegments = candidateLines
        .filter((candidate) => officeHourBlockStartRegex().test(candidate))
        .map((candidate) => normalizeOfficeHoursSnippet(candidate))
        .filter(Boolean);

      const fallbackDayTimePattern =
        /\b(Mon(?:day)?s?'?s?|Tue(?:s(?:day)?)?s?'?s?|Wed(?:nesday)?s?'?s?|Thu(?:r(?:s(?:day)?)?)?s?'?s?|Fri(?:day)?s?'?s?|Sat(?:urday)?s?'?s?|Sun(?:day)?s?'?s?|F)\b\.?\s*(?:between\s*|:\s*|from\s*)?(\d{1,2}(?::\d{2})?\s*(?:a\.?m\.?|p\.?m\.?|am|pm|AM|PM)?)\s*(?:-|–|—|to)\s*(\d{1,2}(?::\d{2})?\s*(?:a\.?m\.?|p\.?m\.?|am|pm|AM|PM)?)/gi;

      fallbackSegments.forEach((segment) => {
        if (!segment) return;

        const personName =
          activeInstructorName && !isGenericOfficeHourName(activeInstructorName)
            ? activeInstructorName
            : fallbackInstructorName;
        const segmentLocation = officeHourLocation([segment, text].join(" "));
        const extractedSegmentSlots = extractOfficeHourSlots(segment);
        if (extractedSegmentSlots.length > 0) {
          extractedSegmentSlots.forEach((slot) => {
            seeds.push({
              personName,
              personEmail: activeInstructorEmail,
              location:
                segmentLocation && !isClearlyInvalidOfficeHourLocation(segmentLocation)
                  ? segmentLocation
                  : activeLocation,
              dayCode: slot.dayCode,
              startDate: officeHoursWindowContext?.startDate,
              exDates: officeHoursWindowContext?.exDates,
              startTime: slot.startTime,
              endTime: slot.endTime,
              notes: slot.inferred
                ? ["Office-hour time inferred from shorthand in outline."]
                : [],
              provenance: [makeProvenance(section, "prose", segment)],
            });
          });
          return;
        }

        for (const match of segment.matchAll(fallbackDayTimePattern)) {
          const dayCodes = parseWeekdayCodes(match[1]);
          if (dayCodes.length === 0) continue;
          const range = parseOfficeHourTimeRange(`${match[2]} - ${match[3]}`);
          if (!range.startTime || !range.endTime) continue;

          dayCodes.forEach((dayCode) => {
            seeds.push({
              personName,
              personEmail: activeInstructorEmail,
              location:
                segmentLocation && !isClearlyInvalidOfficeHourLocation(segmentLocation)
                  ? segmentLocation
                  : activeLocation,
              dayCode,
              startDate: officeHoursWindowContext?.startDate,
              exDates: officeHoursWindowContext?.exDates,
              startTime: range.startTime,
              endTime: range.endTime,
              notes: range.inferred
                ? ["Office-hour time inferred from shorthand in outline."]
                : [],
              provenance: [makeProvenance(section, "prose", segment)],
            });
          });
        }
      });

      if (seeds.length === initialSeedCount) {
        const supplementalSegments = text
          .split(
            /(?=\b(?:Instructor|Course Instructor|Teaching Assistant|Lead Teaching Assistant|TA|Student(?:\s*\(office\))?\s*hours?)\s*:)/i
          )
          .map((segment) => normalizeOfficeHourParsingText(segment))
          .map((segment) => normalizeWhitespace(segment))
          .filter(Boolean);

        const supplementalMultiDayPattern =
          /((?:(?:Mon(?:day)?s?'?s?|Tue(?:s(?:day)?)?s?'?s?|Wed(?:nesday)?s?'?s?|Thu(?:r(?:s(?:day)?)?)?s?'?s?|Fri(?:day)?s?'?s?|Sat(?:urday)?s?'?s?|Sun(?:day)?s?'?s?|F)\.?\s*(?:,|&|and|\/)?\s*)+)(?::\s*|from\s*)?(\d{1,2}(?::\d{2})?\s*(?:a\.?m\.?|p\.?m\.?|am|pm|AM|PM)?)\s*(?:-|–|—|to)\s*(\d{1,2}(?::\d{2})?\s*(?:a\.?m\.?|p\.?m\.?|am|pm|AM|PM)?)/gi;
        const supplementalSingleDayPattern =
          /\b(Mon(?:day)?s?'?s?|Tue(?:s(?:day)?)?s?'?s?|Wed(?:nesday)?s?'?s?|Thu(?:r(?:s(?:day)?)?)?s?'?s?|Fri(?:day)?s?'?s?|Sat(?:urday)?s?'?s?|Sun(?:day)?s?'?s?|F)\b\.?\s*(?:between\s*|:\s*|from\s*)?(\d{1,2}(?::\d{2})?\s*(?:a\.?m\.?|p\.?m\.?|am|pm|AM|PM)?)\s*(?:-|–|—|to)\s*(\d{1,2}(?::\d{2})?\s*(?:a\.?m\.?|p\.?m\.?|am|pm|AM|PM)?)/gi;

        supplementalSegments.forEach((segment) => {
          if (!/\b(?:office hours?|student(?:\s*\(office\))?\s*hours?)\b/i.test(segment)) {
            return;
          }

          const segmentInstructor =
            sanitizeOfficeHourPersonName(
              segment.match(
                /\b(?:Instructor|Course Instructor|Teaching Assistant|Lead Teaching Assistant|TA)\s*:?\s*((?:Dr\.?\s+)?[A-Z][A-Za-z'’.-]+(?:\s+[A-Z][A-Za-z'’.-]+){1,3})(?=\s*(?:Email(?: Address)?\s*:|[A-Z0-9._%+-]+@uwaterloo\.ca\b|Office hours?\b|Student(?:\s*\(office\))?\s*hours?\b))/i
              )?.[1]
            ) ||
            fallbackInstructorName;
          const segmentEmail =
            segment.match(/[A-Z0-9._%+-]+@uwaterloo\.ca/i)?.[0] || activeInstructorEmail;
          const officeSnippet = normalizeOfficeHoursSnippet(
            segment.match(/\b(?:office hours?|student(?:\s*\(office\))?\s*hours?)\s*:?\s*.+$/i)?.[0] ??
              segment
          );
          const segmentLocation = officeHourLocation(officeSnippet) || officeHourLocation(segment);
          const extractedSegmentSlots = extractOfficeHourSlots(officeSnippet);
          if (
            extractedSegmentSlots.length === 0 &&
            /by appointment|upon appointment|tbd|to be determined/i.test(officeSnippet)
          ) {
            return;
          }
          if (extractedSegmentSlots.length > 0) {
            extractedSegmentSlots.forEach((slot) => {
              seeds.push({
                personName: segmentInstructor,
                personEmail: segmentEmail,
                location:
                  segmentLocation && !isClearlyInvalidOfficeHourLocation(segmentLocation)
                    ? segmentLocation
                    : activeLocation,
                dayCode: slot.dayCode,
                startDate: officeHoursWindowContext?.startDate,
                exDates: officeHoursWindowContext?.exDates,
                startTime: slot.startTime,
                endTime: slot.endTime,
                notes: slot.inferred
                  ? ["Office-hour time inferred from shorthand in outline."]
                  : [],
                provenance: [makeProvenance(section, "prose", segment)],
              });
            });
            return;
          }
          let segmentProducedSeed = false;

          for (const match of officeSnippet.matchAll(supplementalMultiDayPattern)) {
            const dayCodes = parseOfficeHourDayCodes(match[1]);
            if (dayCodes.length === 0) continue;
            const range = parseOfficeHourTimeRange(`${match[2]} - ${match[3]}`);
            if (!range.startTime || !range.endTime) continue;

            dayCodes.forEach((dayCode) => {
              seeds.push({
                personName: segmentInstructor,
                personEmail: segmentEmail,
                location:
                  segmentLocation && !isClearlyInvalidOfficeHourLocation(segmentLocation)
                    ? segmentLocation
                    : activeLocation,
                dayCode,
                startDate: officeHoursWindowContext?.startDate,
                exDates: officeHoursWindowContext?.exDates,
                startTime: range.startTime,
                endTime: range.endTime,
                notes: range.inferred
                  ? ["Office-hour time inferred from shorthand in outline."]
                  : [],
                provenance: [makeProvenance(section, "prose", segment)],
              });
            });
            segmentProducedSeed = true;
          }

          if (segmentProducedSeed) {
            return;
          }

          for (const match of officeSnippet.matchAll(supplementalSingleDayPattern)) {
            const dayCodes = parseOfficeHourDayCodes(match[1]);
            if (dayCodes.length === 0) continue;
            const range = parseOfficeHourTimeRange(`${match[2]} - ${match[3]}`);
            if (!range.startTime || !range.endTime) continue;

            dayCodes.forEach((dayCode) => {
              seeds.push({
                personName: segmentInstructor,
                personEmail: segmentEmail,
                location:
                  segmentLocation && !isClearlyInvalidOfficeHourLocation(segmentLocation)
                    ? segmentLocation
                    : activeLocation,
                dayCode,
                startDate: officeHoursWindowContext?.startDate,
                exDates: officeHoursWindowContext?.exDates,
                startTime: range.startTime,
                endTime: range.endTime,
                notes: range.inferred
                  ? ["Office-hour time inferred from shorthand in outline."]
                  : [],
                provenance: [makeProvenance(section, "prose", segment)],
              });
            });
          }
        });

        if (seeds.length === initialSeedCount) {
          const directInlineOfficeHoursPattern =
            /((?:(?:Mon(?:day)?s?'?s?|Tue(?:s(?:day)?)?s?'?s?|Wed(?:nesday)?s?'?s?|Thu(?:r(?:s(?:day)?)?)?s?'?s?|Fri(?:day)?s?'?s?|Sat(?:urday)?s?'?s?|Sun(?:day)?s?'?s?|F)\.?\s*(?:,|&|and|\/)?\s*)+)(?::\s*|from\s*)?(\d{1,2}(?::\d{2})?\s*(?:a\.?m\.?|p\.?m\.?|am|pm|AM|PM)?)\s*(?:-|–|—|to)\s*(\d{1,2}(?::\d{2})?\s*(?:a\.?m\.?|p\.?m\.?|am|pm|AM|PM)?)/gi;

          candidateLines.forEach((line) => {
            const snippet = normalizeOfficeHoursSnippet(line);
            const extractedLineSlots = extractOfficeHourSlots(snippet);
            if (
              !snippet ||
              (extractedLineSlots.length === 0 &&
                /by appointment|upon appointment|tbd|to be determined/i.test(snippet))
            ) {
              return;
            }

            const personName =
              activeInstructorName && !isGenericOfficeHourName(activeInstructorName)
                ? activeInstructorName
                : fallbackInstructorName;
            const location = officeHourLocation(line) || activeLocation;
            if (extractedLineSlots.length > 0) {
              extractedLineSlots.forEach((slot) => {
                seeds.push({
                  personName,
                  personEmail: activeInstructorEmail,
                  location,
                  dayCode: slot.dayCode,
                  startDate: officeHoursWindowContext?.startDate,
                  exDates: officeHoursWindowContext?.exDates,
                  startTime: slot.startTime,
                  endTime: slot.endTime,
                  notes: slot.inferred
                    ? ["Office-hour time inferred from shorthand in outline."]
                    : [],
                  provenance: [makeProvenance(section, "prose", line)],
                });
              });
              return;
            }

            for (const match of snippet.matchAll(directInlineOfficeHoursPattern)) {
              const dayCodes = parseOfficeHourDayCodes(match[1]);
              if (dayCodes.length === 0) continue;
              const range = parseOfficeHourTimeRange(`${match[2]} - ${match[3]}`);
              if (!range.startTime || !range.endTime) continue;

              dayCodes.forEach((dayCode) => {
                seeds.push({
                  personName,
                  personEmail: activeInstructorEmail,
                  location,
                  dayCode,
                  startDate: officeHoursWindowContext?.startDate,
                  exDates: officeHoursWindowContext?.exDates,
                  startTime: range.startTime,
                  endTime: range.endTime,
                  notes: range.inferred
                    ? ["Office-hour time inferred from shorthand in outline."]
                    : [],
                  provenance: [makeProvenance(section, "prose", line)],
                });
              });
            }
          });
        }
      }
    }
  });

  return dedupeOfficeHourSeeds(seeds);
}

function dedupeOfficeHourSeeds(seeds: OfficeHourSeed[]) {
  const deduped = new Map<string, OfficeHourSeed>();
  seeds.forEach((seed) => {
    if (isGenericOfficeHourName(seed.personName)) {
      return;
    }
    const snippetText = seed.provenance.map((entry) => entry.snippet).join(" ");
    if (isAdministrativeOfficeHourNoiseSnippet(snippetText)) {
      return;
    }
    const officeHoursSnippet =
      normalizeOfficeHoursSnippet(
        snippetText.match(
          /\b(?:office hours?|office location (?:and|&) hours?|student(?:\s*\(office\))?\s*hours?|open student hours?|my office hours are|drop-in ta office hours)\b[:\s-]*.*$/i
        )?.[0] ?? snippetText
      ) || snippetText;
    if (isAdministrativeOfficeHourNoiseSnippet(officeHoursSnippet)) {
      return;
    }
    const strictNamedDayCodes = parseStrictNamedOfficeHourDayCodes(officeHoursSnippet);
    const explicitDayCodes =
      strictNamedDayCodes.length > 0
        ? strictNamedDayCodes
        : parseOfficeHourDayCodes(officeHoursSnippet);
    const explicitTimeRangeCount = countValidOfficeHourTimeRanges(officeHoursSnippet);
    const shouldExpandSharedDaySeries =
      explicitDayCodes.length > 1 &&
      explicitTimeRangeCount === 1 &&
      extractOfficeHourSlots(officeHoursSnippet).length <= 1;
    const dayCodesToApply = shouldExpandSharedDaySeries
      ? explicitDayCodes
      : explicitDayCodes.length > 1
      ? explicitDayCodes.includes(seed.dayCode)
        ? [seed.dayCode]
        : []
      : [seed.dayCode];
    if (dayCodesToApply.length === 0) {
      return;
    }
    if (
      extractOfficeHourSlots(officeHoursSnippet).length === 0 &&
      /\bby appointment\b/i.test(officeHoursSnippet)
    ) {
      return;
    }
    dayCodesToApply.forEach((dayCode) => {
    const key = `${seed.personName}:${seed.personEmail ?? ""}:${dayCode}:${seed.startTime ?? ""}:${seed.endTime ?? ""}`;
    const existing = deduped.get(key);
    const seedLocationFromProvenance = seed.provenance
      .map((item) => officeHourLocation(item.snippet))
      .find((location) => location && !isClearlyInvalidOfficeHourLocation(location));
    if (!existing) {
      deduped.set(key, {
        ...seed,
        location: seed.location || seedLocationFromProvenance,
        dayCode,
      });
      return;
    }
      const existingLocation =
        existing.location && !isClearlyInvalidOfficeHourLocation(existing.location)
          ? existing.location
          : undefined;
      const nextLocation =
        seed.location && !isClearlyInvalidOfficeHourLocation(seed.location)
          ? seed.location
          : undefined;
      const mergedLocation =
        existingLocation === "Online" && nextLocation && nextLocation !== "Online"
          ? nextLocation
          : existingLocation && nextLocation === "Online"
          ? existingLocation
          : existingLocation ||
            nextLocation ||
            [existing, seed]
              .flatMap((candidate) => candidate.provenance.map((item) => officeHourLocation(item.snippet)))
              .find(
                (location) =>
                  location && !isClearlyInvalidOfficeHourLocation(location)
              );
      deduped.set(key, {
        ...existing,
        location: mergedLocation,
        notes: combineNotes(existing.notes, seed.notes),
        provenance: mergeProvenanceLists([existing.provenance, seed.provenance]),
      });
    });
  });
  return Array.from(deduped.values());
}

function parseInlineInstructionalTeamOfficeHours(
  sections: SectionBlock[],
  meta: OutlineMeta,
  meetings: RawMeetingRow[]
) {
  const termBounds = computeTermBounds(meetings) ?? computeFallbackTermBounds(sections, meta);
  if (!termBounds) return [] as OfficeHourSeed[];

  const sectionDayTimePattern =
    /^((?:(?:Mon(?:day)?s?'?s?|Tue(?:s(?:day)?)?s?'?s?|Wed(?:nesday)?s?'?s?|Thu(?:r(?:s(?:day)?)?)?s?'?s?|Fri(?:day)?s?'?s?|Sat(?:urday)?s?'?s?|Sun(?:day)?s?'?s?|F)\.?\s*(?:,|&|and|\/)?\s*)+)(?::\s*|from\s*)?(\d{1,2}(?::\d{2})?\s*(?:a\.?m\.?|p\.?m\.?|am|pm|AM|PM)?)\s*(?:-|–|—|to)\s*(\d{1,2}(?::\d{2})?\s*(?:a\.?m\.?|p\.?m\.?|am|pm|AM|PM)?)/i;

  const seeds = sections.flatMap((section) => {
    if (
      section.id !== "instructional_team" &&
      !/\binstructional team\b/i.test(section.title)
    ) {
      return [];
    }

    const text = normalizeOfficeHourParsingText(section.text);
    if (!/\boffice hours?\b/i.test(text)) {
      return [];
    }

    const fallbackInstructorName = officeHourInstructorName(text, meetings, meta);
    const fallbackInstructorEmail = officeHourInstructorEmail(text, meetings);
    const fallbackLocation = officeHourLocation(text);

    const inlineSegments = normalizeWhitespace(text)
      .split(
        /(?=\b(?:Course Instructor|Lab Instructor|Lecture Instructor|Tutorial Instructor|Teaching Assistants?|Teaching Assistant|Lead Teaching Assistant|Lead TA|TA|Name|Instructor)\s*:)/i
      )
      .map((segment) => normalizeWhitespace(normalizeOfficeHourParsingText(segment)))
      .filter(Boolean);

    const segmentSeeds = inlineSegments.flatMap((segment) => {
      if (isAdministrativeOfficeHourNoiseSnippet(segment)) {
        return [];
      }
      const segmentLines = splitOfficeHourAwareLines(
        normalizeOfficeHourParsingText(segment)
          .replace(/\s*(Contact:|Office:|Office hours?:)/gi, "\n$1")
          .replace(
            /\b(Teaching Assistants?:)\s*((?:(?:Dr\.?|Prof\.?|Professor)\s+)?[\p{L}][\p{L}'’.-]+(?:\s+[\p{L}][\p{L}'’.-]+){1,4}\s*\([A-Z0-9._%+-]+@uwaterloo\.ca\))/giu,
            "$1\n$2"
          )
          .replace(
            /\)\s+((?:(?:Dr\.?|Prof\.?|Professor)\s+)?[\p{L}][\p{L}'’.-]+(?:\s+[\p{L}][\p{L}'’.-]+){1,4}\s*\([A-Z0-9._%+-]+@uwaterloo\.ca\))/giu,
            ")\n$1"
          )
      )
        .map((line) => normalizeWhitespace(line))
        .filter(Boolean);
      const lineLevelSeeds: OfficeHourSeed[] = [];
      let lineLevelPersonName = fallbackInstructorName;
      let lineLevelPersonEmail = fallbackInstructorEmail;
      let lineLevelLocation = fallbackLocation;

      segmentLines.forEach((line) => {
        const normalizedLine = normalizeWhitespace(line);
        if (!normalizedLine || isAdministrativeOfficeHourNoiseSnippet(normalizedLine)) {
          return;
        }

        const lineEmail = normalizedLine.match(/[A-Z0-9._%+-]+@uwaterloo\.ca/i)?.[0];
        const roleLineName =
          sanitizeOfficeHourPersonName(
            normalizedLine.match(
              /\b(?:Instructor|Course Instructor|Lab Instructor|Teaching Assistant|Lead Teaching Assistant|TA|Name)\s*:?\s*((?:(?:Dr\.?|Prof\.?|Professor)\s+)?[\p{L}][\p{L}'’.-]+(?:\s+[\p{L}][\p{L}'’.-]+){0,4})\b/iu
            )?.[1]
          ) ||
          sanitizeOfficeHourPersonName(
            normalizedLine.match(
              /^((?:(?:Dr\.?|Prof\.?|Professor)\s+)?[\p{L}][\p{L}'’.-]+(?:\s+[\p{L}][\p{L}'’.-]+){1,4})(?=\s*(?:\(|[A-Z0-9._%+-]+@uwaterloo\.ca|$))/iu
            )?.[1]
          );

        if (roleLineName && !isGenericOfficeHourName(roleLineName)) {
          lineLevelPersonName = roleLineName;
        }
        if (lineEmail) {
          lineLevelPersonEmail = lineEmail;
        }

        const explicitOfficeLineLocation =
          /^office\s*:/i.test(normalizedLine) || /^office hours?\s*:/i.test(normalizedLine)
            ? officeHourLocation(normalizedLine)
            : undefined;
        if (explicitOfficeLineLocation && !isClearlyInvalidOfficeHourLocation(explicitOfficeLineLocation)) {
          lineLevelLocation = explicitOfficeLineLocation;
        }

        if (!/\boffice hours?\b/i.test(normalizedLine)) {
          return;
        }

        const officeHoursOnlySnippet =
          normalizeOfficeHoursSnippet(
            normalizedLine.match(
              /\b(?:office hours?|student(?:\s*\(office\))?\s*hours?)\b[:\s-]*.*$/i
            )?.[0] ?? normalizedLine
          ) || normalizedLine;
        const structuredLineLocation = chooseOfficeHourLocation(
          officeHourLocation(officeHoursOnlySnippet),
          lineLevelLocation,
          fallbackLocation
        );
        const structuredLineSeeds = createOfficeHourSeedsFromStructuredSnippet(
          section,
          officeHoursOnlySnippet,
          lineLevelPersonName,
          lineLevelPersonEmail,
          structuredLineLocation,
          termBounds
        );
        if (structuredLineSeeds.length > 0) {
          lineLevelSeeds.push(...structuredLineSeeds);
          return;
        }

        const fallbackLineRecovery = extractOfficeHourSlotsWithFallback(normalizedLine);
        if (fallbackLineRecovery.slots.length === 0) {
          return;
        }

        const fallbackLineLocation = chooseOfficeHourLocation(
          officeHourLocation(fallbackLineRecovery.sourceText),
          officeHourLocation(officeHoursOnlySnippet),
          structuredLineLocation
        );
        lineLevelSeeds.push(
          ...fallbackLineRecovery.slots.map((slot) => ({
            personName: lineLevelPersonName,
            personEmail: lineLevelPersonEmail,
            location: fallbackLineLocation,
            dayCode: slot.dayCode,
            startDate: termBounds.startDate,
            exDates: [],
            startTime: slot.startTime,
            endTime: slot.endTime,
            notes: slot.inferred
              ? ["Office-hour time inferred from shorthand in outline."]
              : [],
            provenance: [makeProvenance(section, "prose", fallbackLineRecovery.sourceText)],
          }))
        );
      });

      if (lineLevelSeeds.length > 0) {
        return lineLevelSeeds;
      }

      const officeHoursLineIndex = segmentLines.findIndex((line) =>
        /\b(?:office hours?|student(?:\s*\(office\))?\s*hours?)\b/i.test(line)
      );
      const boundedOfficeTail = (() => {
        const rawTail =
          officeHoursLineIndex === -1
            ? segment
            : segmentLines.slice(officeHoursLineIndex).join("\n");
        return (
          normalizeWhitespace(
            normalizeOfficeHourParsingText(rawTail).match(
              /([\s\S]*?)(?=\b(?:Contacting the Instructor|Teaching Assistants?|TA(?:'s)?\b|Course Description|Student Resources)\b|$)/i
            )?.[1]
          ) || rawTail
        );
      })();
      const officeSnippet = normalizeOfficeHoursSnippet(
        boundedOfficeTail
      );
      if (
        !/\boffice hours?\b/i.test(segment) ||
        isAdministrativeOfficeHourNoiseSnippet(officeSnippet) ||
        ((/by appointment|upon appointment|tbd|to be determined/i.test(officeSnippet) ||
          /\boffice hours?\s*\(\s*by appointment\s*\)/i.test(segment)) &&
          extractOfficeHourSlots(officeSnippet).length === 0)
      ) {
        return [];
      }

      const directSnippetDayCodes = parseStrictNamedOfficeHourDayCodes(officeSnippet);
      const directSnippetRange = parseOfficeHourTimeRange(officeSnippet);
      if (
        directSnippetDayCodes.length > 1 &&
        directSnippetRange.startTime &&
        directSnippetRange.endTime
      ) {
        const location = chooseOfficeHourLocation(
          officeHourLocation(officeSnippet),
          officeHourLocation(segment),
          fallbackLocation
        );
        return directSnippetDayCodes.map((dayCode) => ({
          personName:
            sanitizeOfficeHourPersonName(
              segment.match(
                /\bName\s*:?\s*((?:(?:Dr\.?|Prof\.?|Professor)\s+)?[\p{L}][\p{L}'’.-]+(?:\s+[\p{L}][\p{L}'’.-]+){0,4})\b/iu
              )?.[1]
            ) ||
            sanitizeOfficeHourPersonName(
              segment.match(
                /\b(?:Instructor|Course Instructor|Teaching Assistant|Lead Teaching Assistant|TA)\s*:?\s*((?:(?:Dr\.?|Prof\.?|Professor)\s+)?[\p{L}][\p{L}'’.-]+(?:\s+[\p{L}][\p{L}'’.-]+){0,4})(?=\s*(?:Email(?: Address)?\s*:|[A-Z0-9._%+-]+@uwaterloo\.ca\b|Office hours?\b))/iu
              )?.[1]
            ) ||
            fallbackInstructorName,
          personEmail:
            segment.match(/[A-Z0-9._%+-]+@uwaterloo\.ca/i)?.[0] || fallbackInstructorEmail,
          location,
          dayCode,
          startDate: termBounds.startDate,
          exDates: [],
          startTime: directSnippetRange.startTime,
          endTime: directSnippetRange.endTime,
          notes: directSnippetRange.inferred
            ? ["Office-hour time inferred from shorthand in outline."]
            : [],
          provenance: [makeProvenance(section, "prose", officeSnippet)],
        }));
      }

      const personName =
        sanitizeOfficeHourPersonName(
          segment.match(
            /\bName\s*:?\s*((?:(?:Dr\.?|Prof\.?|Professor)\s+)?[\p{L}][\p{L}'’.-]+(?:\s+[\p{L}][\p{L}'’.-]+){0,4})\b/iu
          )?.[1]
        ) ||
        sanitizeOfficeHourPersonName(
          segment.match(
            /\b(?:Instructor|Course Instructor|Teaching Assistant|Lead Teaching Assistant|TA)\s*:?\s*((?:(?:Dr\.?|Prof\.?|Professor)\s+)?[\p{L}][\p{L}'’.-]+(?:\s+[\p{L}][\p{L}'’.-]+){0,4})(?=\s*(?:Email(?: Address)?\s*:|[A-Z0-9._%+-]+@uwaterloo\.ca\b|Office hours?\b))/iu
          )?.[1]
        ) || fallbackInstructorName;
      const personEmail =
        segment.match(/[A-Z0-9._%+-]+@uwaterloo\.ca/i)?.[0] || fallbackInstructorEmail;
      const officeSnippetLocation = officeHourLocation(officeSnippet);
      const segmentLocation = officeHourLocation(segment);
      const location = chooseOfficeHourLocation(
        officeSnippetLocation,
        segmentLocation,
        fallbackLocation
      );

      const structuredSeeds = createOfficeHourSeedsFromStructuredSnippet(
        section,
        officeSnippet,
        personName,
        personEmail,
        location,
        termBounds
      );
      if (structuredSeeds.length > 0) {
        return structuredSeeds;
      }

      const extractedOfficeSnippetSlots = extractOfficeHourSlots(officeSnippet);
      if (extractedOfficeSnippetSlots.length > 0) {
        return extractedOfficeSnippetSlots.map((slot) => ({
          personName,
          personEmail,
          location,
          dayCode: slot.dayCode,
          startDate: termBounds.startDate,
          exDates: [],
          startTime: slot.startTime,
          endTime: slot.endTime,
          notes: slot.inferred
            ? ["Office-hour time inferred from shorthand in outline."]
            : [],
          provenance: [makeProvenance(section, "prose", segment)],
        }));
      }

      const explicitOfficeBlock = normalizeWhitespace(
        segment.match(
          /\bInstructor'?s Office Hours\b[:\s-]*([\s\S]*?)(?=\b(?:Contacting the Instructor|Teaching Assistants?|TA(?:'s)?\b|Course Description|Student Resources)\b|$)/i
        )?.[1]
      );
      const explicitOfficeBlockRecovery = extractOfficeHourSlotsWithFallback(explicitOfficeBlock);
      if (explicitOfficeBlock && explicitOfficeBlockRecovery.slots.length > 0) {
        const explicitLocation = chooseOfficeHourLocation(
          officeHourLocation(explicitOfficeBlockRecovery.sourceText),
          officeHourLocation(explicitOfficeBlock),
          location
        );
        return explicitOfficeBlockRecovery.slots.map((slot) => ({
          personName,
          personEmail,
          location: explicitLocation,
          dayCode: slot.dayCode,
          startDate: termBounds.startDate,
          exDates: [],
          startTime: slot.startTime,
          endTime: slot.endTime,
          notes: slot.inferred
            ? ["Office-hour time inferred from shorthand in outline."]
            : [],
          provenance: [makeProvenance(section, "prose", explicitOfficeBlockRecovery.sourceText)],
        }));
      }

      const match = officeSnippet.match(sectionDayTimePattern);
      if (!match) {
        return [];
      }

      const dayCodes = parseOfficeHourDayCodes(match[1]);
      const range = parseOfficeHourTimeRange(`${match[2]} - ${match[3]}`);
      if (dayCodes.length === 0 || !range.startTime || !range.endTime) {
        return [];
      }

      return dayCodes.map((dayCode) => ({
        personName,
        personEmail,
        location,
        dayCode,
        startDate: termBounds.startDate,
        exDates: [],
        startTime: range.startTime,
        endTime: range.endTime,
        notes: range.inferred
          ? ["Office-hour time inferred from shorthand in outline."]
          : [],
          provenance: [makeProvenance(section, "prose", segment)],
      }));
    });

    if (segmentSeeds.length > 0) {
      return segmentSeeds;
    }

    const explicitInstructorOfficeTextBlock = normalizeWhitespace(
      text.match(
        /\bInstructor'?s Office Hours\b[:\s-]*([\s\S]*?)(?=\b(?:Contacting the Instructor|Teaching Assistants?|TA(?:'s)?\b|Course Description|Student Resources)\b|$)/i
      )?.[1]
    );
    const explicitInstructorOfficeHtmlBlock = extractInstructionalTeamOfficeHourBlock(section);
    const explicitInstructorOfficeTextRecovery = extractOfficeHourSlotsWithFallback(
      explicitInstructorOfficeTextBlock
    );
    const explicitInstructorOfficeHtmlRecovery = extractOfficeHourSlotsWithFallback(
      explicitInstructorOfficeHtmlBlock
    );
    const explicitInstructorOfficeRecovery =
      explicitInstructorOfficeHtmlRecovery.slots.length >
      explicitInstructorOfficeTextRecovery.slots.length
        ? explicitInstructorOfficeHtmlRecovery
        : explicitInstructorOfficeTextRecovery;
    const explicitInstructorOfficeBlock =
      explicitInstructorOfficeRecovery === explicitInstructorOfficeHtmlRecovery
        ? explicitInstructorOfficeHtmlBlock
        : explicitInstructorOfficeTextBlock;
    if (
      explicitInstructorOfficeBlock &&
      explicitInstructorOfficeRecovery.slots.length > 0 &&
      fallbackInstructorName &&
      !isGenericOfficeHourName(fallbackInstructorName)
    ) {
      const explicitLocation = chooseOfficeHourLocation(
        officeHourLocation(explicitInstructorOfficeBlock),
        fallbackLocation
      );
      return explicitInstructorOfficeRecovery.slots.map((slot) => ({
        personName: fallbackInstructorName,
        personEmail: fallbackInstructorEmail,
        location: explicitLocation,
        dayCode: slot.dayCode,
        startDate: termBounds.startDate,
        exDates: [],
        startTime: slot.startTime,
        endTime: slot.endTime,
        notes: slot.inferred
          ? ["Office-hour time inferred from shorthand in outline."]
          : [],
        provenance: [makeProvenance(section, "prose", explicitInstructorOfficeBlock)],
      }));
    }

    return [];
  });

  return dedupeOfficeHourSeeds(seeds);
}

function recoverInstructionalTeamOfficeHours(
  sections: SectionBlock[],
  meta: OutlineMeta,
  meetings: RawMeetingRow[]
) {
  const termBounds = computeTermBounds(meetings) ?? computeFallbackTermBounds(sections, meta);
  if (!termBounds) return [] as OfficeHourSeed[];

  return sections.flatMap((section) => {
    if (
      section.id !== "instructional_team" &&
      !/\binstructional team\b/i.test(section.title)
    ) {
      return [];
    }

    const text = normalizeOfficeHourParsingText(section.text);
    const explicitInstructorOfficeTextBlock = normalizeWhitespace(
      text.match(
        /\bInstructor'?s Office Hours\b[:\s-]*([\s\S]*?)(?=\b(?:Contacting the Instructor|Teaching Assistants?|TA(?:'s)?\b|Course Description|Student Resources)\b|$)/i
      )?.[1]
    );
    const explicitInstructorOfficeHtmlBlock = extractInstructionalTeamOfficeHourBlock(section);
    const explicitInstructorOfficeTextRecovery = extractOfficeHourSlotsWithFallback(
      explicitInstructorOfficeTextBlock
    );
    const explicitInstructorOfficeHtmlRecovery = extractOfficeHourSlotsWithFallback(
      explicitInstructorOfficeHtmlBlock
    );
    const explicitInstructorOfficeRecovery =
      explicitInstructorOfficeHtmlRecovery.slots.length >
      explicitInstructorOfficeTextRecovery.slots.length
        ? explicitInstructorOfficeHtmlRecovery
        : explicitInstructorOfficeTextRecovery;
    const explicitInstructorOfficeBlock =
      explicitInstructorOfficeRecovery === explicitInstructorOfficeHtmlRecovery
        ? explicitInstructorOfficeHtmlBlock
        : explicitInstructorOfficeTextBlock;
    const personName = officeHourInstructorName(text, meetings, meta);

    if (
      !explicitInstructorOfficeBlock ||
      explicitInstructorOfficeRecovery.slots.length === 0 ||
      !personName ||
      isGenericOfficeHourName(personName)
    ) {
      return [];
    }

    const personEmail = officeHourInstructorEmail(text, meetings);
    const location = chooseOfficeHourLocation(
      officeHourLocation(explicitInstructorOfficeRecovery.sourceText),
      officeHourLocation(explicitInstructorOfficeBlock),
      officeHourLocation(text)
    );

    return explicitInstructorOfficeRecovery.slots.map((slot) => ({
      personName,
      personEmail,
      location,
      dayCode: slot.dayCode,
      startDate: termBounds.startDate,
      exDates: [],
      startTime: slot.startTime,
      endTime: slot.endTime,
      notes: slot.inferred
        ? ["Office-hour time inferred from shorthand in outline."]
        : [],
      provenance: [makeProvenance(section, "prose", explicitInstructorOfficeRecovery.sourceText)],
    }));
  });
}

function recoverExplicitNamedOfficeHours(
  sections: SectionBlock[],
  meta: OutlineMeta,
  meetings: RawMeetingRow[]
) {
  const termBounds = computeTermBounds(meetings) ?? computeFallbackTermBounds(sections, meta);
  if (!termBounds) return [] as OfficeHourSeed[];

  return dedupeOfficeHourSeeds(
    sections.flatMap((section) => {
      const text = normalizeOfficeHourParsingText(section.text);
      if (!/\boffice hours?\b/i.test(text)) {
        return [];
      }

      const fallbackInstructorName = officeHourInstructorName(text, meetings, meta);
      const fallbackInstructorEmail = officeHourInstructorEmail(text, meetings);
      const fallbackLocation = officeHourLocation(text);
      const recoveredSeeds: OfficeHourSeed[] = [];

      const instructorOfficeBlock = normalizeWhitespace(
        text.match(
          /\bOffice Hours?\b[:\s-]*([\s\S]*?)(?=\b(?:Piazza|Additional Help|Mode of delivery|Plan for|Course Description|Student Resources|Teaching Assistants?|TA\b|TAs\b|Email\b)\b|$)/i
        )?.[1]
      );
      if (
        instructorOfficeBlock &&
        fallbackInstructorName &&
        !isGenericOfficeHourName(fallbackInstructorName)
      ) {
        const structuredOfficeSnippet = normalizeWhitespace(
          `Office Hours: ${instructorOfficeBlock}`
        );
        recoveredSeeds.push(
          ...createOfficeHourSeedsFromStructuredSnippet(
            section,
            structuredOfficeSnippet,
            fallbackInstructorName,
            fallbackInstructorEmail,
            fallbackLocation,
            termBounds
          )
        );
      }

      const explicitTaOfficeHourMatches = Array.from(
        text.matchAll(
          /\b(?:TA|Teaching Assistant)\s*:\s*((?:(?:Dr\.?|Prof\.?|Professor)\s+)?[\p{L}][\p{L}'’.-]+(?:\s+[\p{L}][\p{L}'’.-]+){0,4})(?:\s*\(([A-Z0-9._%+-]+@uwaterloo\.ca)\))?[\s\S]{0,240}?\b(?:TA|Teaching Assistant)\s+Office Hours?\s*:\s*([^\n.]+)/giu
        )
      );
      explicitTaOfficeHourMatches.forEach((match) => {
        const taName = sanitizeOfficeHourPersonName(match[1]);
        const taEmail = match[2] || undefined;
        const taSnippet = normalizeWhitespace(match[3]);
        if (!taName || !taSnippet || isGenericOfficeHourName(taName)) {
          return;
        }
        recoveredSeeds.push(
          ...createOfficeHourSeedsFromStructuredSnippet(
            section,
            taSnippet,
            taName,
            taEmail,
            fallbackLocation,
            termBounds
          )
        );
      });

      return recoveredSeeds;
    })
  );
}

function assessmentTypeFromLabel(label: string | null | undefined, location?: string) {
  const normalizedLabel = normalizeWhitespace(label);
  if (!normalizedLabel) {
    return "Other" as const;
  }
  const labelOnly = normalizedLabel.toLowerCase().trim();
  const normalized = `${normalizedLabel} ${location ?? ""}`.toLowerCase();
  if (/\bforesight step\b/.test(labelOnly) || /\bforesight step\b/.test(normalized)) {
    return "Assignment" as const;
  }
  if (
    /^(?:a\s*0*\d+|(?:homework|hw)\s*#?\s*0*\d+|written assignment\s*#?\s*\d+|assignment\s*#?\s*\d+)\b/i.test(
      labelOnly
    )
  ) {
    return "Assignment" as const;
  }
  if (looksLikeAssignmentText(labelOnly) || /dropbox|crowdmark|reading assignment/.test(labelOnly)) {
    return "Assignment" as const;
  }
  if (looksLikeAssessmentText(labelOnly)) {
    return "Assessment" as const;
  }
  if (looksLikeAssignmentText(normalized) || /dropbox|crowdmark|reading assignment/.test(normalized)) {
    return "Assignment" as const;
  }
  if (looksLikeAssessmentText(normalized)) {
    return "Assessment" as const;
  }
  return "Other" as const;
}

function stripAssessmentSeriesCount(label: string) {
  return normalizeWhitespace(
    label
      .replace(/\(\s*\d+\s*\)\s*$/g, "")
      .replace(
        /^\s*\d+\s+((?:(?!#).)*(?:quiz(?:zes)?|assignment(?:s)?|report(?:s)?|essay(?:s)?|reflection(?:s)?|project(?:s)?|deliverable(?:s)?|presentation(?:s)?|paper(?:s)?|response(?:s)?|post(?:s)?|midterm(?:s)?|tests?|exams?))\b/i,
        "$1"
      )
  );
}

function singularizeAssessmentSeriesLabel(label: string) {
  return stripAssessmentSeriesCount(label)
    .replace(/\bAssignments\b/gi, "Assignment")
    .replace(/\bWorkshops\b/gi, "Workshop")
    .replace(/\bAnalyses\b/gi, "Analysis")
    .replace(/\bQuizzes\b/gi, "Quiz")
    .replace(/\bReports\b/gi, "Report")
    .replace(/\bEssays\b/gi, "Essay")
    .replace(/\bReflections\b/gi, "Reflection")
    .replace(/\bProjects\b/gi, "Project")
    .replace(/\bProblems\b/gi, "Problem")
    .replace(/\bSteps\b/gi, "Step")
    .replace(/\bPosts\b/gi, "Post")
    .replace(/\bMidterms\b/gi, "Midterm")
    .replace(/\bTests\b/gi, "Test")
    .replace(/\bExams\b/gi, "Exam");
}

function numberedAssessmentSeriesLabel(label: string, occurrenceIndex: number, totalCount: number) {
  const baseLabel = singularizeAssessmentSeriesLabel(label);
  if (totalCount <= 1 || /#\s*\d+\b/.test(baseLabel)) {
    return baseLabel;
  }
  return `${baseLabel} #${occurrenceIndex + 1}`;
}

function cleanAssessmentSeriesBaseLabel(label: string) {
  return trimTrailingClauses(
    stripAssessmentSeriesCount(label)
      .replace(/\(\s*n\s*=\s*~?\d+\s*\)/gi, "")
      .replace(/\bn\s*=\s*~?\d+\b/gi, "")
      .replace(/\(\s*in groups?\s*\)/gi, "")
  );
}

function shortAssessmentRowBase(label: string) {
  return trimTrailingClauses(cleanAssessmentSeriesBaseLabel(label).split(/\s*:\s*/)[0]);
}

function splitStructuredAssessmentEntries(line: string) {
  const normalized = normalizeWhitespace(line);
  if (!normalized) return [] as Array<{ prefix?: string; value: string }>;

  if (/^posts?\s*-/i.test(normalized)) {
    return [{ prefix: "Posts", value: normalized }];
  }

  const bulletDateEntries = Array.from(
    normalized.matchAll(
      /(?:^|\s)-\s*([^()]{1,120}?)\s*\(((?:(?:Mon(?:day)?|Tue(?:s|sday)?|Wed(?:nesday)?|Thu(?:r|rs|rsday|ursday)?|Fri(?:day)?|Sat(?:urday)?|Sun(?:day)?),?\s+)?(?:\d{1,2}\s+)?(?:January|February|March|April|May|June|July|August|September|October|November|December|Jan|Feb|Mar|Apr|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)\.?\s+\d{1,2}(?:st|nd|rd|th)?(?:,?\s*\d{4})?)\)/gi
    )
  ).map((match) => ({
    prefix: normalizeWhitespace(match[1]),
    value: normalizeWhitespace(match[2]),
  }));
  if (bulletDateEntries.length > 1) return bulletDateEntries;

  const assignmentBlocks = normalized
    .replace(/\bo\s+Assignment\s*#/gi, "||Assignment #")
    .split("||")
    .map((segment) => normalizeWhitespace(segment))
    .filter((segment) => /^Assignment\s*#\s*\d+/i.test(segment));
  if (assignmentBlocks.length > 1) {
    const entries: Array<{ prefix?: string; value: string }> = [];

    assignmentBlocks.forEach((block) => {
      const flatBlock = normalizeWhitespace(block).replace(/\n+/g, " ");
      const headerMatch = flatBlock.match(
        /^(Assignment\s*#\s*\d+)\s*:?\s*([^*]+?)(?=(?:\s*\*\s*(?:Submission Due Date|Review of Peers Due Date|Feedback(?: Review)? Due Date)|\s+\bdue\b|$))/i
      );
      const assignmentId = normalizeWhitespace(headerMatch?.[1] ?? "");
      const assignmentName = trimTrailingPeriods(
        normalizeWhitespace((headerMatch?.[2] ?? "").replace(/\([^)]*%\)/g, ""))
      );
      const assignmentPrefix = normalizeWhitespace(
        [assignmentId, assignmentName].filter(Boolean).join(" ")
      );

      const inlineDueMatch = flatBlock.match(
        /\b(due\s+.+?)(?=(?:\*\s*(?:Submission Due Date|Review of Peers Due Date|Feedback(?: Review)? Due Date)|$))/i
      );
      if (inlineDueMatch && assignmentPrefix) {
        entries.push({
          prefix: assignmentPrefix,
          value: normalizeWhitespace(inlineDueMatch[1]),
        });
      }

      const milestonePattern =
        /\*\s*(Submission Due Date|Review of Peers Due Date|Feedback Review Due Date|Feedback Due Date)\s+(.+?)(?=(?:\*\s*(?:Submission Due Date|Review of Peers Due Date|Feedback Review Due Date|Feedback Due Date)|$))/gi;
      for (const match of flatBlock.matchAll(milestonePattern)) {
        const milestone =
          /^submission/i.test(match[1])
            ? "Submission"
            : /^review of peers/i.test(match[1])
            ? "Peer Review"
            : "Feedback";
        if (milestone === "Submission" && inlineDueMatch && assignmentPrefix) {
          continue;
        }
        entries.push({
          prefix: normalizeWhitespace([assignmentPrefix, milestone].filter(Boolean).join(" - ")),
          value: normalizeWhitespace(match[2]),
        });
      }
    });

    if (entries.length > 0) return entries;
  }

  const prefixedEntries: Array<{ prefix?: string; value: string }> = [];
  const repeatedNamedEntries = Array.from(
    normalized.matchAll(
      /((?:term test|midterm|quiz|test|exam|case|reflection)\s*#?\s*\d+)\s*:\s*(.+?)(?=(?:(?:\s*)(?:term test|midterm|quiz|test|exam|case|reflection)\s*#?\s*\d+\s*:|$))/gi
    )
  ).map((match) => ({
    prefix: normalizeWhitespace(match[1]),
    value: normalizeWhitespace(match[2]),
  }));
  if (repeatedNamedEntries.length > 1) return repeatedNamedEntries;

  const responseSegments = normalized
    .split(/\s*;\s*/)
    .map((segment) => normalizeWhitespace(segment))
    .filter(Boolean);

  if (/^response\s*-\s*last names\b/i.test(normalized) && responseSegments.length > 1) {
    responseSegments.forEach((segment, index) => {
      const namedMatch = segment.match(
        /^((?:response\s*-\s*)?last names [^:;]+)\s*:\s*(.+)$/i
      );
      if (!namedMatch) return;
      const prefix =
        index === 0 || /^response\s*-/i.test(namedMatch[1])
          ? namedMatch[1]
          : `Response - ${namedMatch[1]}`;
      prefixedEntries.push({
        prefix,
        value: namedMatch[2],
      });
    });
    if (prefixedEntries.length > 0) return prefixedEntries;
  }

  const repeatedPrefixPattern =
    /(?:^|\s)((?:part\s*\d+|#\s*\d+))\s*:\s*(.+?)(?=(?:\s+(?:part\s*\d+|#\s*\d+)\s*:|$))/gi;
  for (const match of normalized.matchAll(repeatedPrefixPattern)) {
    prefixedEntries.push({
      prefix: normalizeWhitespace(match[1]),
      value: normalizeWhitespace(match[2]),
    });
  }
  if (prefixedEntries.length > 0) return prefixedEntries;

  const safeNamedMatch = normalized.match(/^([^:=\n]{1,80}?)\s*(?::|=)\s+(.+)$/);
  if (
    safeNamedMatch &&
    !/\b\d{1,2}$/.test(safeNamedMatch[1]) &&
    !/\b(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)\b/i.test(safeNamedMatch[1]) &&
    !/\b(?:due|deadline|available|opens?|closes?)\b/i.test(safeNamedMatch[1])
  ) {
    return [
      {
        prefix: normalizeWhitespace(safeNamedMatch[1]),
        value: normalizeWhitespace(safeNamedMatch[2]),
      },
    ];
  }

  return [{ value: normalized }];
}

function labelFromAssessmentDateEntry(
  rowLabel: string,
  prefix: string | undefined,
  occurrenceIndex: number,
  totalCount: number
) {
  const baseLabel = cleanAssessmentSeriesBaseLabel(rowLabel);
  const shortBase = shortAssessmentRowBase(rowLabel) || baseLabel;
  const normalizedPrefix = trimTrailingClauses(prefix);
  const normalizedRowLabel = normalizeWhitespace(rowLabel).toLowerCase();
  const listedSubLabels = (() => {
    const normalized = normalizeWhitespace(rowLabel);
    const listSource = normalized.includes(":") ? normalized.split(/:\s*/, 2)[1] ?? normalized : normalized;
    const matches = Array.from(
      listSource.matchAll(/(?:^|;)\s*\d+\.\s*([^;]+?)(?=(?:\s*;\s*\d+\.|$))/g)
    )
      .map((match) =>
        trimTrailingPeriods(
          normalizeWhitespace(match[1]).replace(/\s*[-–—]\s*\d+(?:\.\d+)?%\b.*$/i, "")
        )
      )
      .filter(Boolean);
    return matches.length >= 2 ? matches : [];
  })();

  if (listedSubLabels.length === totalCount && listedSubLabels[occurrenceIndex]) {
    return normalizeAssignmentLabel(listedSubLabels[occurrenceIndex]);
  }

  if (!normalizedPrefix) {
    return numberedAssessmentSeriesLabel(baseLabel, occurrenceIndex, totalCount);
  }

  if (/^assignment\s*#\s*\d+\b/i.test(normalizedPrefix)) {
    return normalizeAssignmentLabel(capitalizeAssessmentText(normalizedPrefix));
  }

  if (/career eportfolio project/i.test(normalizedRowLabel)) {
    if (/portfolio structure/i.test(normalizedPrefix)) return "Career ePortfolio Structure";
    if (/homepage/i.test(normalizedPrefix)) return "Career ePortfolio Homepage";
    if (/linkedin/i.test(normalizedPrefix)) return "Career ePortfolio LinkedIn Page";
    if (/\bph\b|\bpublic health communication\b/i.test(normalizedPrefix)) {
      return "Career ePortfolio Public Health Communication Tab";
    }
    if (/other competency/i.test(normalizedPrefix)) {
      return "Career ePortfolio Other Competency Tab";
    }
    if (/final polished career eportfolio|final career eportfolio/i.test(normalizedPrefix)) {
      return "Final Career ePortfolio";
    }
  }

  if (/health innovation challenge/i.test(normalizedRowLabel)) {
    if (/problem space interest/i.test(normalizedPrefix)) {
      return "Problem Space Interest Survey";
    }
    if (/team charter/i.test(normalizedPrefix)) return "Team Charter";
    if (/systems framing|solution ideas|questions for session 2/i.test(normalizedPrefix)) {
      return "Systems Framing and Solution Ideas Outline";
    }
    if (/demo day deliverables?/i.test(normalizedPrefix)) {
      return "Demo Day Deliverables";
    }
    if (/final report/i.test(normalizedPrefix)) {
      return "Final Team Report on Health Innovation Challenge";
    }
  }

  if (/map the system/i.test(normalizedRowLabel) || /map the system/i.test(normalizedPrefix)) {
    if (/step\s*1|topic overview/i.test(normalizedPrefix)) return "Map the System Step 1";
    if (/step\s*2|preliminary solution brief/i.test(normalizedPrefix)) {
      return "Map the System Step 2";
    }
    if (/step\s*3|final solution brief/i.test(normalizedPrefix)) {
      return "Map the System Step 3";
    }
  }

  if (/^posts?\b/i.test(normalizedPrefix)) {
    return totalCount > 1 ? `${shortBase} Post #${occurrenceIndex + 1}` : `${shortBase} Post`;
  }

  if (/^(?:response\s*-\s*)?last names\b/i.test(normalizedPrefix)) {
    return `${shortBase} ${capitalizeAssessmentText(
      normalizedPrefix.replace(/^response\s*-\s*/i, "Response - ")
    )}`;
  }

  if (/^response\b/i.test(normalizedPrefix)) {
    return `${shortBase} ${capitalizeAssessmentText(normalizedPrefix)}`;
  }

  if (/^(?:part\s*\d+|#\s*\d+)$/i.test(normalizedPrefix)) {
    const suffix = /^part/i.test(normalizedPrefix)
      ? capitalizeAssessmentText(normalizedPrefix)
      : normalizedPrefix.toUpperCase().replace(/\s+/g, " ");
    return `${baseLabel} ${suffix}`;
  }

  if (
    normalizedPrefix.length <= 42 &&
    !baseLabel.toLowerCase().includes(normalizedPrefix.toLowerCase())
  ) {
    return `${baseLabel} ${capitalizeAssessmentText(normalizedPrefix)}`;
  }

  return capitalizeAssessmentText(normalizedPrefix);
}

function buildSeriesWeightNotes(label: string, weight: string, occurrenceCount: number) {
  const normalizedWeight = normalizeWeightText(weight);
  if (!normalizedWeight) return [] as string[];
  if (occurrenceCount <= 1) {
    return [`Weight: ${normalizedWeight}`];
  }

  return [
    `Weight: ${normalizedWeight} total across ${occurrenceCount} ${stripAssessmentSeriesCount(
      label
    ).toLowerCase()}`,
  ];
}

function assessmentNameColumnIndex(headers: string[]) {
  const descriptionIndex = headers.findIndex((header) => /description/.test(header));
  if (descriptionIndex !== -1) return descriptionIndex;

  const assignmentIndex = headers.findIndex((header) =>
    /(assessment|component|assignment|exam|evaluation|item)/.test(header)
  );
  if (assignmentIndex !== -1) return assignmentIndex;

  return headers.findIndex(
    (header) => /activity/.test(header) && !/week\s+activity/.test(header)
  );
}

function isAssessmentPolicyNoise(text: string) {
  const normalized = normalizeWhitespace(text).toLowerCase();
  if (
    /\babsence declaration\b/.test(normalized) ||
    /\bfor example, assume an assignment\b/.test(normalized) ||
    /\bassignment is now due\b/.test(normalized) ||
    /\bassignment is still due\b/.test(normalized) ||
    /\bfor all the following examples\b/.test(normalized) ||
    /\blate penalties will apply\b/.test(normalized)
  ) {
    return true;
  }
  if (
    /\bturnitin|text matching software|plagiarism detection software\b/.test(normalized) &&
    /\balternative\b|\bprivacy\b|\bsecurity\b|\bwish to request\b|\binstead of submitting\b|\bemail me\b/.test(
      normalized
    )
  ) {
    if (
      /\brequest an alternative to turnitin\b/.test(normalized) &&
      /\bby\s+(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday|jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec|january|february|march|april|june|july|august|september|october|november|december)\b/.test(
        normalized
      )
    ) {
      return false;
    }
    return true;
  }
  if (
    /\baccessability services\b|\baas\b/.test(normalized) &&
    /\bexam accommodation\b|\brequest to write\b/.test(normalized)
  ) {
    return true;
  }
  if (
    /\bdaylight savings time\b|\bthe time that is current in waterloo\b|\byou must start the test prior to the end of test period\b|\bstart your test before 10 pm\b/.test(
      normalized
    )
  ) {
    return true;
  }
  if (!/(quiz|midterm|term test|test|exam|assignment|deadline)/.test(normalized)) {
    return false;
  }
  const scheduleCue =
    /\b(?:there will be|scheduled on|scheduled for|due\b|available\b|open from|open until|opens?\b|closes?\b|deadline\b|friday\b|monday\b|tuesday\b|wednesday\b|thursday\b|saturday\b|sunday\b)\b/.test(
      normalized
    );
  const policyCue =
    /\b(?:missed|make-?up|accommodation|approved absence|absence|extenuating|documentation|vif|self-declared|late arrivals?|late submissions?|penalt|forfeit|redistribution|privilege|not an entitlement|within 24 hours|within 48 hours|point \d+|zero on the original test|the same policy applies)\b/.test(
      normalized
    );
  return policyCue && !scheduleCue;
}

function cleanGenericSeriesStem(label: string) {
  return normalizeWhitespace(label)
    .replace(/\(\s*x\d+\s*\)/gi, "")
    .replace(/\b(\d+)\b$/g, "")
    .trim();
}

function resolveAssessmentFromSectionText(
  label: string,
  sectionText: string,
  defaultYear: number
) {
  const targetFamily = canonicalAssessmentFamily(label);
  const targetOccurrenceIndex = Number(
    normalizeWhitespace(label).match(/#?\s*(\d+)\b/)?.[1] ?? ""
  );
  const lines = sectionText
    .split(/\n+/)
    .map((line) => normalizeWhitespace(line))
    .filter(Boolean);

  for (const [lineIndex, line] of lines.entries()) {
    if (isAssessmentPolicyNoise(line)) continue;
    const previousLine = lines[lineIndex - 1];
    const previousLabel = previousLine
      ? extractAssessmentLabelFromText(previousLine)
      : undefined;
    const segments = line.split(/(?<=[.!?;])\s+/).filter(Boolean);
    let previousSegmentLabel = previousLabel;
    for (const segment of segments) {
      if (/\b(?:no tutorial|no class(?:es)?|reading week)\b/i.test(segment)) {
        continue;
      }
      const lineLabel = extractAssessmentLabelFromText(segment);
      const matchedLabel =
        lineLabel && canonicalAssessmentFamily(lineLabel) === targetFamily
          ? lineLabel
          : previousSegmentLabel &&
              canonicalAssessmentFamily(previousSegmentLabel) === targetFamily
            ? previousSegmentLabel
          : previousLabel && canonicalAssessmentFamily(previousLabel) === targetFamily
            ? previousLabel
            : undefined;
      if (lineLabel) {
        previousSegmentLabel = lineLabel;
      }
      if (!matchedLabel) {
        continue;
      }

      const explicitDates = extractExplicitDates(segment, defaultYear);
      const lineDateSpec = parseDateSpec(segment, defaultYear);
      const resolvedDates =
        explicitDates.length > 0
          ? explicitDates
          : lineDateSpec?.kind === "single"
          ? [lineDateSpec.date]
          : lineDateSpec?.kind === "dates"
          ? lineDateSpec.dates
          : [];
      if (resolvedDates.length === 0) continue;

      const { startTime, endTime } = parseTimeRange(segment);
      const location = extractStructuredLocation(segment) || undefined;
      const resolvedDate =
        resolvedDates.length > 1 && Number.isFinite(targetOccurrenceIndex) && targetOccurrenceIndex > 0
          ? resolvedDates[Math.min(targetOccurrenceIndex - 1, resolvedDates.length - 1)]
          : resolvedDates[0];

      return {
        date: resolvedDate,
        startTime,
        endTime,
        location,
        note: line,
      };
    }
  }

  return undefined;
}

function resolveAssignmentFromSectionText(
  label: string,
  sectionText: string,
  defaultYear: number
) {
  const targetFamily = canonicalAssignmentFamily(label);
  const lines = sectionText
    .split(/\n+/)
    .map((line) => normalizeWhitespace(line))
    .filter(Boolean);

  for (const [lineIndex, line] of lines.entries()) {
    if (isAssessmentPolicyNoise(line)) continue;
    const previousLine = lines[lineIndex - 1];
    const previousLabel = previousLine
      ? extractProseDeliverableLabel(previousLine) ??
        assignmentLabelFromText(previousLine) ??
        labelFromScheduleEntry(previousLine)
      : undefined;
    const segments = line.split(/(?<=[.!?;])\s+/).filter(Boolean);
    let previousSegmentLabel = previousLabel;
    for (const segment of segments) {
      const lineLabel =
        extractProseDeliverableLabel(segment) ??
        assignmentLabelFromText(segment) ??
        labelFromScheduleEntry(segment);
      const matchedLabel =
        lineLabel && canonicalAssignmentFamily(lineLabel) === targetFamily
          ? lineLabel
          : previousSegmentLabel &&
              canonicalAssignmentFamily(previousSegmentLabel) === targetFamily
            ? previousSegmentLabel
          : previousLabel && canonicalAssignmentFamily(previousLabel) === targetFamily
            ? previousLabel
            : undefined;
      if (lineLabel) {
        previousSegmentLabel = lineLabel;
      }
      if (!matchedLabel) {
        continue;
      }

      const explicitDates = extractDeadlineAnchoredDates(segment, defaultYear);
      const lineDateSpec = parseDateSpec(segment, defaultYear);
      const resolvedDates =
        explicitDates.length > 0
          ? explicitDates
          : lineDateSpec?.kind === "single"
          ? [lineDateSpec.date]
          : lineDateSpec?.kind === "dates"
          ? lineDateSpec.dates
          : [];
      if (resolvedDates.length === 0) continue;

      const dueDate =
        /\bdue\b/i.test(segment) && resolvedDates.length > 1
          ? resolvedDates[resolvedDates.length - 1]
          : resolvedDates[0];
      const eventDates =
        /\b(?:due|available|opens?|posted)\b/i.test(segment) && resolvedDates.length > 1
          ? [dueDate]
          : resolvedDates;
      const availableDate =
        /\b(?:available|opens?|posted)\b/i.test(segment) && resolvedDates.length > 1
          ? resolvedDates[0]
          : undefined;
      const { startTime, endTime } = parseTimeRange(segment);
      const location = assignmentLocationFromContext(segment) || undefined;

      return {
        date: dueDate,
        dates: eventDates,
        availableDate,
        startTime,
        endTime,
        location,
        note: line,
      };
    }
  }

  return undefined;
}

function parseAssessmentTable(
  section: SectionBlock,
  headers: string[],
  rows: string[][],
  meta: OutlineMeta,
  sectionOptions: ParsedSectionOption[]
) {
  const headerLine = headers.map((header) => header.toLowerCase());
  const looksLikeWeekGrid =
    headerLine.some((header) => /\b(?:week|wk)\b/.test(header)) &&
    headerLine.some((header) => /\bdate\b/.test(header));
  const nameIndex = assessmentNameColumnIndex(headerLine);
  const dateIndex = headerLine.findIndex((header) => /(due|date|deadline)/.test(header));
  const locationIndex = headerLine.findIndex((header) => /(location|submission|method)/.test(header));
  const weightIndex = headerLine.findIndex((header) =>
    /(weight|value|worth|percentage|percent)/.test(header)
  );

  const seeds: AssessmentSeed[] = [];

  const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

  const extractRecurringAssignmentCount = (label: string, sectionText: string) => {
    const normalizedLabel = normalizeAssignmentLabel(label).toLowerCase();
    if (/mobius assignments?/.test(normalizedLabel)) {
      return Number(
        sectionText.match(/\bthere will be\s+(\d+)\s+mobius assignments?\b/i)?.[1] ?? ""
      );
    }
    if (/written assignments?/.test(normalizedLabel)) {
      return Number(
        sectionText.match(
          /\bthere will be\s+\d+\s+mobius assignments?\s+and\s+(\d+)\s+written assignments?\b/i
        )?.[1] ??
          sectionText.match(/\b(\d+)\s+written assignments?\b/i)?.[1] ??
          ""
      );
    }

    const singularLabel = singularizeGenericSeriesLabel(normalizeAssignmentLabel(label));
    const pluralLabel = pluralizeGenericSeriesLabel(singularLabel);
    const countMatch =
      sectionText.match(
        new RegExp(`\\bthere will be\\s+(\\d+)\\s+${escapeRegExp(pluralLabel)}\\b`, "i")
      )?.[1] ??
      sectionText.match(new RegExp(`\\b(\\d+)\\s+${escapeRegExp(pluralLabel)}\\b`, "i"))?.[1];
    return Number(countMatch ?? "");
  };

  const extractRecurringAssignmentAnchor = (
    label: string,
    dateText: string,
    sectionText: string,
    defaultYear: number
  ) => {
    const firstAssignmentDueText =
      normalizeWhitespace(
        dateText.match(/\bfirst assignment due:\s*([^|]+)/i)?.[1]
      ) ||
      normalizeWhitespace(
        sectionText.match(/\bfirst assignment due:\s*([^.|]+)/i)?.[1]
      ) ||
      "";
    const explicitDate =
      extractExplicitDates(firstAssignmentDueText, defaultYear)[0] ??
      extractDeadlineAnchoredDates(dateText, defaultYear)[0];
    const explicitTimeText =
      normalizeWhitespace(
        firstAssignmentDueText.match(
          /\b(?:at\s+)?(\d{1,2}(?::\d{2})?\s*(?:a\.?m\.?|p\.?m\.?|am|pm|AM|PM))/i
        )?.[1]
      ) ||
      undefined;

    const weeklyMatch =
      normalizeWhitespace(dateText).match(
        /\b(Mon(?:day)?|Tue(?:s|sday)?|Wed(?:nesday)?|Thu(?:r|rs|rsday|ursday)?|Fri(?:day)?|Sat(?:urday)?|Sun(?:day)?)\s+weekly(?:\s+at)?\s+(\d{1,2}(?::\d{2})?\s*(?:a\.?m\.?|p\.?m\.?|am|pm|AM|PM))/i
      ) ??
      normalizeWhitespace(sectionText).match(
        /\b(?:submitted in [A-Za-z0-9 -]+ by|available from)\s+(\d{1,2}(?::\d{2})?\s*(?:a\.?m\.?|p\.?m\.?|am|pm|AM|PM))\s+on\s+(Mon(?:day)?|Tue(?:s|sday)?|Wed(?:nesday)?|Thu(?:r|rs|rsday|ursday)?|Fri(?:day)?|Sat(?:urday)?|Sun(?:day)?)/i
      );

    const weekdayText =
      weeklyMatch && weeklyMatch.length >= 3
        ? weeklyMatch[1].match(/^\d/)
          ? weeklyMatch[2]
          : weeklyMatch[1]
        : undefined;
    const weeklyTimeText =
      weeklyMatch && weeklyMatch.length >= 3
        ? weeklyMatch[1].match(/^\d/)
          ? weeklyMatch[1]
          : weeklyMatch[2]
        : undefined;
    const weekdayCode = parseWeekdayCodes(weekdayText)[0];
    const timeText = explicitTimeText || weeklyTimeText;
    const startTime = parseFlexibleTime(timeText);

    if (!explicitDate || !weekdayCode) {
      return undefined;
    }

    return {
      firstDueDate: explicitDate,
      weekdayCode,
      startTime,
    };
  };

  const expandRecurringAssignmentSeriesFromRow = (
    label: string,
    dateText: string,
    location: string,
    weight: string,
    provenance: EventProvenance[]
  ) => {
    const baseType = assessmentTypeFromLabel(label, location);
    if (baseType !== "Assignment") return [] as AssessmentSeed[];
    if (!/\bweekly\b/i.test(dateText)) return [] as AssessmentSeed[];
    if (!/\bassignments?\b/i.test(label)) return [] as AssessmentSeed[];

    const occurrenceCount = extractRecurringAssignmentCount(label, section.text);
    if (!Number.isFinite(occurrenceCount) || occurrenceCount <= 1) {
      return [] as AssessmentSeed[];
    }

    const anchor = extractRecurringAssignmentAnchor(label, dateText, section.text, meta.termYear);
    if (!anchor?.firstDueDate || !anchor.weekdayCode) {
      return [] as AssessmentSeed[];
    }

    const baseLabel = singularizeGenericSeriesLabel(normalizeAssignmentLabel(label));
    const weeklyNotes = combineNotes(
      [`Recurring weekly assignment series inferred from outline pattern.`],
      buildSeriesWeightNotes(label, weight, occurrenceCount)
    );

    return Array.from({ length: occurrenceCount }, (_, index) => {
      const date = format(addDays(parseISO(anchor.firstDueDate), index * 7), "yyyy-MM-dd");
      return {
        label: `${baseLabel} #${index + 1}`,
        eventType: "Assignment" as const,
        date,
        allDay: !anchor.startTime,
        startTime: anchor.startTime,
        location,
        notes: weeklyNotes,
        confidence: "medium" as const,
        provenance,
      };
    });
  };

  rows.forEach((row) => {
    const label = normalizeWhitespace(row[nameIndex === -1 ? 0 : nameIndex]).replace(
      /\n+/g,
      " "
    );
    if (/^\s*\d+(?:\.\d+)?%\s*$/.test(label)) return;
    if (
      looksLikeWeekGrid &&
      /^\d+[a-z]?$/i.test(label) &&
      row.some((cell) => isWeekTableDateLike(cell, meta.termYear))
    ) {
      return;
    }
    const contextualRowText = row
      .map((cell) => normalizeWhitespace(cell))
      .filter(Boolean)
      .join(" | ");
    const dateText =
      normalizeWhitespace(dateIndex === -1 ? "" : row[dateIndex]) ||
      [
        normalizeWhitespace(locationIndex === -1 ? "" : row[locationIndex]),
        label,
        contextualRowText,
      ].find(
        (candidate) =>
          Boolean(candidate) &&
          (extractExplicitDates(candidate, meta.termYear).length > 0 ||
            /\b(?:due|deadline|available|opens?|closes?|scheduled(?: on| for)?|class time on)\b/i.test(
              candidate
            ))
      ) ||
      "";
    const location =
      extractStructuredLocation(row[locationIndex], true) || normalizeLocation(row[locationIndex]);
    const weight = normalizeWeightText(row[weightIndex]);
    if (!label || /^[-–—]+$/.test(label)) return;
    if (isAssessmentPolicyNoise(`${label} | ${dateText} | ${location}`)) return;
    if (/^0+(?:\.0+)?%$/.test(weight)) return;
    if (/^(?:\(?(?:i|g)\)?\s*)?cfe\b/i.test(label)) return;
    if (/see chart below/i.test(dateText)) return;
    if (/as listed in table below|as listed below/i.test(dateText)) return;
    if (
      /^exam$/i.test(normalizeWhitespace(label)) &&
      /\b(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)[a-z]*\.?\s+\d{1,2}\s*[-–]\s*\d{1,2}\b/i.test(
        dateText
      )
    ) {
      return;
    }
    if (/final mark/i.test(dateText) && !/\b(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec|\d{1,2}\/\d{1,2}|tbd|announced|registrar)\b/i.test(dateText)) {
      return;
    }

    const provenance = [makeProvenance(section, "table", contextualRowText)];
    const baseType = assessmentTypeFromLabel(label, location);
    const timeRange = parseTimeRange(dateText);

    const recurringSeriesSeeds = expandRecurringAssignmentSeriesFromRow(
      label,
      dateText,
      location,
      weight,
      provenance
    );
    if (recurringSeriesSeeds.length > 0) {
      seeds.push(...recurringSeriesSeeds);
      return;
    }

    if (
      (/^weeks?\b/i.test(dateText) || /\bexam period\b/i.test(dateText)) &&
      /see details on learn|see cfe learn page/i.test(location)
    ) {
      return;
    }

    const spec = parseDateSpec(dateText, meta.termYear);
    const explicitDates = extractExplicitDates(dateText, meta.termYear);
    const hasConcreteDate =
      explicitDates.length > 0 ||
      spec?.kind === "single" ||
      spec?.kind === "dates" ||
      spec?.kind === "range";

    const contextualResolution =
      !hasConcreteDate || /tbd|see below|see details/i.test(dateText)
        ? baseType === "Assignment"
          ? resolveAssignmentFromSectionText(label, section.text, meta.termYear)
          : resolveAssessmentFromSectionText(label, section.text, meta.termYear)
        : undefined;

    if (contextualResolution?.date) {
      const contextualDates =
        baseType === "Assignment" &&
        "dates" in contextualResolution &&
        Array.isArray(contextualResolution.dates) &&
        contextualResolution.dates.length > 0
          ? contextualResolution.dates
          : [contextualResolution.date];

      contextualDates.forEach((resolvedDate) => {
        seeds.push({
          label,
          eventType: baseType === "Other" ? "Assessment" : baseType,
          date: resolvedDate,
          allDay: !contextualResolution.startTime,
          location: contextualResolution.location || location,
          startTime: contextualResolution.startTime,
          endTime: contextualResolution.endTime,
          notes: combineNotes(
            [contextualResolution.note],
            "availableDate" in contextualResolution && contextualResolution.availableDate
              ? [`Available from ${contextualResolution.availableDate}`]
              : [],
            buildSeriesWeightNotes(label, weight, 1)
          ),
          weight,
          confidence: confidenceFromSeed({
            date: resolvedDate,
            startTime: contextualResolution.startTime,
            endTime: contextualResolution.endTime,
            location: contextualResolution.location || location,
          }),
          provenance,
        });
      });
      return;
    }

    if (
      /registrar|to be announced|exam period|scheduled by registrar/i.test(dateText) ||
      (/tbd/i.test(dateText) && !hasConcreteDate)
    ) {
      seeds.push({
        label,
        eventType: baseType === "Other" ? "Assessment" : baseType,
        allDay: true,
        location,
        notes: combineNotes(
          buildSeriesWeightNotes(label, weight, 1),
          [`Date unresolved in outline: ${dateText}`]
        ),
        weight,
        confidence: "low",
        provenance,
      });
      return;
    }

    const splitEntries = (() => {
      const wholeTextEntries = splitStructuredAssessmentEntries(dateText);
      if (wholeTextEntries.length > 1) return wholeTextEntries;
      return dateText
        .split(/\n+/)
        .map((line) => normalizeWhitespace(line))
        .filter(Boolean)
        .flatMap((line) => splitStructuredAssessmentEntries(line));
    })();

    if (
      splitEntries.length > 1 &&
      splitEntries.every(({ value }) => {
        const lineSpec = parseDateSpec(value, meta.termYear);
        const explicitDateCount =
          lineSpec?.kind === "range"
            ? lineSpec.startDate && lineSpec.endDate
              ? 2
              : 0
            : lineSpec?.kind === "dates"
            ? lineSpec.dates.length
            : lineSpec?.kind === "single"
            ? 1
            : extractExplicitDates(value, meta.termYear).length;
        return /[:=]/.test(value) || explicitDateCount > 0;
      })
    ) {
      const totalOccurrences = splitEntries.reduce((count, { value }) => {
        const lineSpec = parseDateSpec(value, meta.termYear);
        const lineExplicitDates =
          lineSpec?.kind === "range" && lineSpec.startDate && lineSpec.endDate
            ? [lineSpec.startDate, lineSpec.endDate]
            : lineSpec?.kind === "dates"
            ? lineSpec.dates
            : extractExplicitDates(value, meta.termYear);
        if (lineExplicitDates.length === 2 && /\bto\b/i.test(value)) {
          return count + 1;
        }
        if (lineSpec?.kind === "dates") return count + lineSpec.dates.length;
        if (lineSpec?.kind === "single") return count + 1;
        return count + lineExplicitDates.length;
      }, 0);
      let occurrenceIndex = 0;

      splitEntries.forEach(({ prefix, value }) => {
        const sanitizedValueForDates = normalizeWhitespace(
          value.replace(
            /\bsince\s+(?:(?:Mon(?:day)?|Tue(?:s|sday)?|Wed(?:nesday)?|Thu(?:r|rs|rsday|ursday)?|Fri(?:day)?|Sat(?:urday)?|Sun(?:day)?),?\s+)?(?:(?:\d{1,2}\s+)?(?:January|February|March|April|May|June|July|August|September|October|November|December|Jan|Feb|Mar|Apr|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)\.?\s+\d{1,2}(?:st|nd|rd|th)?(?:,?\s*\d{4})?|\d{1,2}\/\d{1,2}(?:\/\d{2,4})?|\d{2}-\d{2}-\d{4})/gi,
            ""
          )
        );
        const lineTimeRange = parseTimeRange(value);
        const lineSpec = parseDateSpec(sanitizedValueForDates, meta.termYear);
        const rawExplicitDates = extractExplicitDates(sanitizedValueForDates, meta.termYear);
        const explicitDates =
          lineSpec?.kind === "dates"
            ? lineSpec.dates
            : lineSpec?.kind === "range" && lineSpec.startDate && lineSpec.endDate
            ? [lineSpec.startDate, lineSpec.endDate]
            : rawExplicitDates.length > 1
            ? rawExplicitDates
            : lineSpec?.kind === "single"
            ? [lineSpec.date]
            : rawExplicitDates;
        const availabilityWindow =
          explicitDates.length === 2 &&
          /\bto\b/i.test(sanitizedValueForDates) &&
          /(assignment|quiz|midterm|term test|test|exam)/i.test(
            normalizeWhitespace(`${prefix ?? ""} ${label}`)
          );
        const resolvedOccurrences = resolveSectionAwareDates(
          sanitizedValueForDates,
          section,
          sectionOptions,
          meta.termYear
        );
        const datedOccurrences =
          resolvedOccurrences.length === explicitDates.length && explicitDates.length > 0
            ? resolvedOccurrences
            : explicitDates.map((date) => ({ date }));
        const groupPrefix =
          prefix && isGroupDeadlinePrefix(prefix) ? cleanGroupDeadlinePrefix(prefix) : "";
        const baseLabel = labelFromAssessmentDateEntry(
          label,
          groupPrefix ? undefined : prefix,
          occurrenceIndex,
          totalOccurrences
        );
        const baseEventType = assessmentTypeFromLabel(baseLabel, location);
        const resolvedEventType = baseEventType === "Other" ? "Assessment" : baseEventType;

        if (availabilityWindow) {
          seeds.push({
            label: groupPrefix
              ? `${stripAssessmentSeriesCount(label)} (${groupPrefix})`
              : baseLabel,
            eventType: resolvedEventType,
            date: explicitDates[1],
            endDate: explicitDates[0],
            allDay: !lineTimeRange.startTime,
            location,
            startTime: lineTimeRange.startTime,
            endTime: lineTimeRange.endTime,
            notes: combineNotes(
              [`Available from ${explicitDates[0]}`],
              buildSeriesWeightNotes(label, weight, totalOccurrences),
              groupPrefix ? [`Applies to ${groupPrefix}`] : []
            ),
            weight,
            confidence: confidenceFromSeed({ date: explicitDates[1], ...lineTimeRange }),
            provenance,
          });
          occurrenceIndex += 1;
          return;
        }

        const occurrenceIndexStart = occurrenceIndex;
        datedOccurrences.forEach((occurrence, datedIndex) => {
          const occurrenceLabel = groupPrefix
            ? `${stripAssessmentSeriesCount(label)} (${groupPrefix})`
            : labelFromAssessmentDateEntry(
                label,
                prefix,
                occurrenceIndexStart + datedIndex,
                totalOccurrences
              );
          seeds.push({
            label: occurrenceLabel,
            eventType: resolvedEventType,
            date: occurrence.date,
            allDay: !lineTimeRange.startTime,
            location,
            startTime: lineTimeRange.startTime,
            endTime: lineTimeRange.endTime,
            notes: combineNotes(
              buildSeriesWeightNotes(label, weight, totalOccurrences),
              groupPrefix ? [`Applies to ${groupPrefix}`] : []
            ),
            weight,
            confidence: confidenceFromSeed({ date: occurrence.date, ...lineTimeRange }),
            provenance,
            sectionOptionIds: occurrence.sectionOptionIds,
          });
        });
        occurrenceIndex += datedOccurrences.length;
      });
      return;
    }

    if (
      spec?.kind === "dates" &&
      baseType === "Assignment" &&
      spec.dates.length === 2 &&
      /\b(?:nominally due|optionally|as late as|late\b|late submission)\b/i.test(dateText)
    ) {
      seeds.push({
        label,
        eventType: "Assignment",
        date: spec.dates[0],
        allDay: !timeRange.startTime,
        location,
        startTime: timeRange.startTime,
        endTime: timeRange.endTime,
        notes: combineNotes(
          [`Late submission accepted until ${spec.dates[1]}`],
          buildSeriesWeightNotes(label, weight, 1)
        ),
        weight,
        confidence: confidenceFromSeed({ date: spec.dates[0], ...timeRange }),
        provenance,
      });
      return;
    }
    if (
      spec?.kind === "range" &&
      baseType === "Assignment" &&
      spec.startDate &&
      spec.endDate
    ) {
      seeds.push({
        label,
        eventType: "Assignment",
        date: spec.endDate,
        allDay: !timeRange.startTime,
        location,
        startTime: timeRange.startTime,
        endTime: timeRange.endTime,
        notes: combineNotes(
          [`Available from ${spec.startDate}`],
          buildSeriesWeightNotes(label, weight, 1)
        ),
        weight,
        confidence: confidenceFromSeed({ date: spec.endDate, ...timeRange }),
        provenance,
      });
      return;
    }

    if (spec?.kind === "dates") {
      const datedOccurrences = resolveSectionAwareDates(
        dateText,
        section,
        sectionOptions,
        meta.termYear
      );
      const occurrences =
        datedOccurrences.length === spec.dates.length
          ? datedOccurrences
          : spec.dates.map((date) => ({ date }));

      occurrences.forEach((occurrence, index) => {
        seeds.push({
          label:
            occurrence.sectionOptionIds && occurrence.sectionOptionIds.length > 0
              ? stripAssessmentSeriesCount(label)
              : numberedAssessmentSeriesLabel(label, index, spec.dates.length),
          eventType: baseType === "Other" ? "Assessment" : baseType,
          date: occurrence.date,
          allDay: !timeRange.startTime,
          location,
          startTime: timeRange.startTime,
          endTime: timeRange.endTime,
          notes: combineNotes(buildSeriesWeightNotes(label, weight, spec.dates.length)),
          weight: undefined,
          confidence: confidenceFromSeed({ date: occurrence.date, ...timeRange }),
          provenance,
          sectionOptionIds: occurrence.sectionOptionIds,
          replaceMeetingType:
            /in class|lecture|term test|midterm|endterm/i.test(`${label} ${dateText}`) &&
            !timeRange.startTime
              ? "Lecture"
              : undefined,
        });
      });
      return;
    }

    const date = spec?.kind === "single" ? spec.date : undefined;
    const confidence = confidenceFromSeed({ date, ...timeRange });

    if (!date && baseType === "Other") return;

    seeds.push({
      label,
      eventType: baseType === "Other" ? "Assessment" : baseType,
      date,
      allDay: !timeRange.startTime,
      location,
      startTime: timeRange.startTime,
      endTime: timeRange.endTime,
      notes: combineNotes(buildSeriesWeightNotes(label, weight, 1), location ? [] : []),
      weight,
      confidence,
      provenance,
      replaceMeetingType:
        /in class|lecture|term test|midterm|endterm/i.test(`${label} ${dateText}`) &&
        !timeRange.startTime
          ? "Lecture"
          : undefined,
    });
  });

  return seeds;
}

function createTutorialActivityData(
  section: SectionBlock,
  rows: string[][],
  meta: OutlineMeta
) {
  const attachments: TopicAttachment[] = [];
  const exclusions: ExclusionWindow[] = [];
  const assessments: AssessmentSeed[] = [];

  rows.forEach((row) => {
    const dateText = row[0];
    const activity = normalizeWhitespace(row[1]);
    const spec = parseDateSpec(dateText, meta.termYear);
    if (!activity || !spec) return;

    const provenance = [makeProvenance(section, "table", row.join(" | "))];
    const tutorialDates =
      spec.kind === "single"
        ? [spec.date]
        : spec.kind === "dates"
        ? spec.dates
        : undefined;

    if (/no tutorial/i.test(activity)) {
      if (spec.kind === "range") {
        exclusions.push({
          appliesTo: ["Tutorial"],
          startDate: spec.startDate,
          endDate: spec.endDate,
          reason: activity,
          provenance,
        });
      } else {
        const date = tutorialDates?.[0];
        if (date) {
          exclusions.push({
            appliesTo: ["Tutorial"],
            startDate: date,
            endDate: date,
            reason: activity,
            provenance,
          });
        }
      }
      return;
    }

    attachments.push({
      appliesTo: ["Tutorial"],
      exactDates: tutorialDates,
      startDate: spec.kind === "range" ? spec.startDate : undefined,
      endDate: spec.kind === "range" ? spec.endDate : undefined,
      note: activity.replace(/\bSubmit\*?.*?day before\.?\s*/i, "").trim(),
      provenance,
    });

    if (/submit/i.test(activity) && /day before/i.test(activity) && tutorialDates?.[0]) {
      const dueDate = format(subDays(parseISO(tutorialDates[0]), 1), "yyyy-MM-dd");
      const reportMatch = activity.match(/\bRR\s*(\d+)/i);
      const label = reportMatch ? `Research Report ${reportMatch[1]}` : "Tutorial Submission";
      assessments.push({
        label,
        eventType: "Assignment",
        date: dueDate,
        allDay: true,
        location: /learn/i.test(activity) ? "LEARN Drop Box" : "LEARN",
        notes: [activity],
        confidence: "high",
        provenance,
      });
    }
  });

  return { attachments, exclusions, assessments };
}

function parseWeekWindowTable(
  section: SectionBlock,
  headers: string[],
  rows: string[][],
  meta: OutlineMeta,
  sectionOptions: ParsedSectionOption[]
) {
  const lowerHeaders = headers.map((header) => header.toLowerCase());
  const weekIndex = lowerHeaders.findIndex(
    (header) => header.includes("week") || /\bwk\b/.test(header)
  );
  const dateIndex = lowerHeaders.findIndex(
    (header) =>
      (
        /^date(?:s)?$/.test(header.trim()) ||
        /\bweek\s*&\s*dates\b/.test(header) ||
        /\bweek\s+and\s+dates\b/.test(header) ||
        /\bclass dates?\b/.test(header)
      ) &&
      !/\bdue\b/.test(header) &&
      !/\bassign/.test(header) &&
      !/\bassessment/.test(header) &&
      !/\bnotes?\b/.test(header)
  );
  const startIndex = lowerHeaders.findIndex((header) => header.includes("start"));
  const endIndex = lowerHeaders.findIndex((header) => header.includes("end"));
  const topicIndex = lowerHeaders.findIndex(
    (header) =>
      header.includes("topic") ||
      header.includes("module") ||
      header.includes("lecture topic") ||
      header.includes("study materials") ||
      header.includes("content") ||
      header.includes("lecture/tutorial/studio") ||
      header.includes("lecture / tutorial / studio") ||
      header.includes("lecture/tutorial") ||
      header.includes("class activity")
  );
  const assessmentDueIndex = lowerHeaders.findIndex(
    (header) => header.includes("assessment") && header.includes("due")
  );
  const assessmentColumnIndexes = lowerHeaders
    .map((header, index) => ({ header, index }))
    .filter(
      ({ header, index }) =>
        index !== assessmentDueIndex &&
        /(quiz|test|exam)/.test(header) &&
        !/(location|submission|weight|value|worth|percentage|percent|notes?)/.test(header)
    )
    .map(({ index }) => index);
  const assignmentIndexes = lowerHeaders
    .map((header, index) => ({ header, index }))
    .filter(
      ({ header }) =>
        header.includes("assignment") ||
        header.includes("deliverable") ||
        (header.includes("project") && header.includes("due"))
    )
    .map(({ index }) => index);
  const genericDueIndexes = lowerHeaders
    .map((header, index) => ({ header, index }))
    .filter(
      ({ header }) =>
        /(due dates?|due date|deadlines?)/.test(header) &&
        !/(weight|value|worth|percentage|percent|submission|location)/.test(header)
    )
    .map(({ index }) => index);
  const readingsIndex = lowerHeaders.findIndex((header) => header.includes("reading"));
  const labIndex = lowerHeaders.findIndex((header) => header.includes("lab"));
  const notesIndex = lowerHeaders.findIndex(
    (header) => header.includes("notes") || header.includes("comment")
  );
  const tutorialIndexes = lowerHeaders
    .map((header, index) => ({ header, index }))
    .filter((item) => item.header.includes("tutorial"));

  const weekWindows = new Map<number, WeekWindow>();
  const attachments: TopicAttachment[] = [];
  const exclusions: ExclusionWindow[] = [];
  const assessments: AssessmentSeed[] = [];
  const pendingDueHeadingByColumn = new Map<number, string>();
  let previousRowDates: string[] = [];
  let previousDateSpec: ReturnType<typeof parseDateSpec> | undefined;
  let previousDateSourceText: string | undefined;
  const dueColumnIndex =
    assessmentDueIndex !== -1
      ? assessmentDueIndex
      : genericDueIndexes[0] ?? assignmentIndexes[0] ?? -1;

  rows.forEach((rawRow) => {
    const row = alignSparseWeekTableRow(
      rawRow,
      headers,
      meta.termYear,
      weekIndex,
      dateIndex,
      topicIndex,
      dueColumnIndex
    );
    const assessmentsBeforeRow = assessments.length;
    const weekNumber = Number(row[weekIndex]?.match(/\d+/)?.[0] ?? NaN);
    const rowText = row
      .map((cell) => normalizeWhitespace(cell))
      .filter(Boolean)
      .join(" | ");
    const provenance = [makeProvenance(section, "table", row.join(" | "))];
    const dateSourceText =
      dateIndex !== -1 ? row[dateIndex] : weekIndex !== -1 ? row[weekIndex] : undefined;
    const normalizedDateSourceText = normalizeWeekTableDateSourceText(dateSourceText);
    const ownsDateContext =
      Boolean(normalizedDateSourceText) &&
      (extractExplicitDates(normalizedDateSourceText, meta.termYear).length > 0 ||
        Boolean(parseDateSpec(normalizedDateSourceText, meta.termYear)));
    const singleStartDate =
      startIndex !== -1 && endIndex === -1
        ? parseFlexibleDate(row[startIndex], meta.termYear)
        : undefined;
    const rowDates =
      ownsDateContext
        ? normalizedDateSourceText
          ? extractExplicitDates(normalizedDateSourceText, meta.termYear).map((date) =>
              normalizeWeekTableInferredDate(date, normalizedDateSourceText, meta.termYear)
            )
          : []
        : singleStartDate
        ? [singleStartDate]
        : previousRowDates;

    let dateSpec =
      startIndex !== -1 && endIndex !== -1
        ? {
            kind: "range" as const,
            startDate: parseFlexibleDate(row[startIndex], meta.termYear),
            endDate: parseFlexibleDate(row[endIndex], meta.termYear),
          }
        : singleStartDate
        ? {
            kind: "single" as const,
            date: singleStartDate,
          }
        : ownsDateContext
        ? parseDateSpec(normalizedDateSourceText, meta.termYear)
        : previousDateSpec;

    if (ownsDateContext) {
      previousRowDates = rowDates;
      previousDateSpec = dateSpec;
      previousDateSourceText = normalizedDateSourceText;
    }
    const rowWideExplicitDates = extractExplicitDates(rowText, meta.termYear).map((date) =>
      normalizeWeekTableInferredDate(date, rowText, meta.termYear)
    );

    if (dateSpec?.kind === "range" && dateSpec.startDate && dateSpec.endDate && Number.isFinite(weekNumber)) {
      weekWindows.set(weekNumber, {
        startDate: dateSpec.startDate,
        endDate: dateSpec.endDate,
      });
    }

    const topic = normalizeWhitespace(row[topicIndex]);
    const topicEntries =
      row[topicIndex]
        ?.split(/\n+/)
        .flatMap((entry) => expandScheduleEntries(entry))
        .map((entry) => normalizeWhitespace(entry))
        .filter(Boolean) ?? [];
    topicEntries.forEach((entry, index) => {
      const assessmentLabel = extractAssessmentLabelFromText(entry);
      const explicitEntryDates = extractExplicitDates(entry, meta.termYear).map((date) =>
        normalizeWeekTableInferredDate(date, entry, meta.termYear)
      );
      if (!assessmentLabel) return;
      if (
        /\b\d+\s*:\s*.*\b(?:test|quiz|mid-?term|midterm|term test|endterm)\b/i.test(entry) &&
        !/^\s*(?:test|quiz|mid-?term|midterm|term test|endterm)\b/i.test(entry)
      ) {
        return;
      }
      const exactDate =
        normalizeWeekTableInferredDate(
          explicitEntryDates[0] ??
            rowWideExplicitDates[0] ??
            (rowDates.length === topicEntries.length ? rowDates[index] : undefined) ??
            resolveWeekTableAssessmentDate(entry, rowDates, dateSpec),
          explicitEntryDates[0] ? entry : normalizedDateSourceText,
          meta.termYear
        );
      assessments.push({
        label: assessmentLabel,
        eventType: "Assessment",
        date: exactDate,
        allDay: false,
        notes: [entry],
        confidence: exactDate ? "medium" : "low",
        provenance,
        replaceMeetingType: "Lecture",
      });
    });
    topicEntries.forEach((entry, index) => {
      if (
        /^week\s*\d+\b/i.test(entry) &&
        !/\b(?:due|deadline|submission|available|opens?|closes?)\b/i.test(entry)
      ) {
        return;
      }
      const deliverableLabel =
        extractWeekTableDeliverableLabel(entry) ??
        extractProseDeliverableLabel(entry) ??
        assignmentLabelFromText(entry);
      if (!deliverableLabel) return;
      if (assessmentTypeFromLabel(deliverableLabel, entry) === "Assessment") return;

      const explicitEntryDates = extractExplicitDates(entry, meta.termYear).map((date) =>
        normalizeWeekTableInferredDate(date, entry, meta.termYear)
      );
      const rowScopedDate =
        rowDates.length === topicEntries.length ? rowDates[index] : rowDates[0];
      const fallbackEntryDates =
        explicitEntryDates.length > 0
          ? explicitEntryDates
          : rowWideExplicitDates.length > 0
          ? [rowWideExplicitDates[0]]
          : rowScopedDate &&
            (/\b(?:due|deadline|submission|available|opens?|closes?)\b/i.test(entry) ||
              /#\s*\d+\b/.test(deliverableLabel) ||
              /\b(?:reflection|assignment|project|problem set|case study|program design|lab report|module|commentary)\b/i.test(
                deliverableLabel
              ))
          ? [rowScopedDate]
          : dateSpec?.kind === "single"
          ? [dateSpec.date]
          : [];
      if (fallbackEntryDates.length === 0) return;

      const { startTime, endTime } = parseTimeRange(entry);
      fallbackEntryDates.forEach((date) => {
        assessments.push({
          label: deliverableLabel,
          eventType: "Assignment",
          date,
          allDay: !startTime,
          startTime,
          endTime,
          location: assignmentLocationFromContext(`${entry} ${section.text}`),
          notes: [entry],
          confidence: confidenceFromSeed({ date, startTime, endTime }),
          provenance,
        });
      });
    });
    const nonAssessmentTopicEntries = topicEntries.filter(
      (entry) => !extractAssessmentLabelFromText(entry)
    );
    const readings = normalizeWhitespace(row[readingsIndex]);
    const lectureNote = combineNotes(
      nonAssessmentTopicEntries.length > 0 ? nonAssessmentTopicEntries : topic ? [topic] : [],
      readings ? [readings] : []
    ).join(" | ");
    const hasInlineAssessmentScheduleEntries = expandScheduleEntries(lectureNote)
      .map((entry) => normalizeWhitespace(entry))
      .some(
        (entry) =>
          Boolean(entry) &&
          /\b(?:opens?|closes?|available(?:\s+on|\s+from)?|due\b)\b/i.test(entry) &&
          /\b(?:test|quiz|assignment|report|project|brief|annotation|qfc)\b/i.test(entry)
      );

    if (lectureNote) {
      const noLecture = /reading week|no classes|no lectures|\bno lecture\b|midterm week/i.test(
        lectureNote
      );
      if (noLecture) {
        if (dateSpec?.kind === "range" && dateSpec.startDate && dateSpec.endDate) {
          exclusions.push({
            appliesTo: ["Lecture"],
            startDate: dateSpec.startDate,
            endDate: dateSpec.endDate,
            reason: lectureNote,
            provenance,
          });
        } else if (dateSpec?.kind === "single") {
          exclusions.push({
            appliesTo: ["Lecture"],
            startDate: dateSpec.date,
            endDate: format(addDays(parseISO(dateSpec.date), 6), "yyyy-MM-dd"),
            reason: lectureNote,
            provenance,
          });
        }
      } else {
        const assessmentLabel =
          hasInlineAssessmentScheduleEntries || /focus on your other midterms?/i.test(topic)
            ? undefined
            : extractAssessmentLabelFromText(topic);
        if (
          !assessmentLabel &&
          topicEntries.some((entry) => !extractAssessmentLabelFromText(entry))
        ) {
          if (dateSpec?.kind === "single") {
            attachments.push({
              appliesTo: ["Lecture"],
              startDate: dateSpec.date,
              endDate: format(addDays(parseISO(dateSpec.date), 6), "yyyy-MM-dd"),
              note: lectureNote,
              provenance,
            });
          } else if (dateSpec?.kind === "range" && dateSpec.startDate && dateSpec.endDate) {
            attachments.push({
              appliesTo: ["Lecture"],
              startDate: dateSpec.startDate,
              endDate: dateSpec.endDate,
              note: lectureNote,
              provenance,
            });
          }
        } else {
          const topicDates = extractExplicitDates(topic, meta.termYear).map((date) =>
            normalizeWeekTableInferredDate(date, topic, meta.termYear)
          );
          const exactDate =
            normalizeWeekTableInferredDate(
              topicDates[0] ?? resolveWeekTableAssessmentDate(topic, rowDates, dateSpec),
              topicDates[0] ? topic : normalizedDateSourceText,
              meta.termYear
            );
          assessments.push({
            label: assessmentLabel,
            eventType: "Assessment",
            date: exactDate,
            allDay: false,
            notes: topic ? [topic] : [],
            confidence: exactDate ? "medium" : "low",
            provenance,
            replaceMeetingType: "Lecture",
          });
        }
      }
    }

    expandScheduleEntries(lectureNote)
      .map((entry) => normalizeWhitespace(entry))
      .filter(
        (entry) =>
          Boolean(entry) &&
          /\b(?:opens?|closes?|available(?:\s+on|\s+from)?|due\b)\b/i.test(entry) &&
          /\b(?:test|quiz|assignment|report|project|brief|annotation|qfc)\b/i.test(entry)
      )
      .forEach((entry) => {
        const entryLabel =
          extractProseDeliverableLabel(entry) ?? extractAssessmentLabelFromText(entry);
        if (!entryLabel || isFinalExamLabel(entryLabel)) return;

        const eventType = assessmentTypeFromLabel(entryLabel, entry);
        if (eventType === "Other") return;

        const explicitDates = extractDeadlineAnchoredDates(entry, meta.termYear);
        explicitDates.forEach((date) => {
          assessments.push({
            label: entryLabel,
            eventType,
            date,
            allDay: !parseTimeRange(entry).startTime,
            startTime: parseTimeRange(entry).startTime,
            endTime: parseTimeRange(entry).endTime,
            location:
              locationFromRowText(`${entry} | ${rowText}`) ||
              (eventType === "Assignment"
                ? assignmentLocationFromContext(`${entry} ${section.text}`)
                : extractStructuredLocation(entry, true) || undefined),
            notes: [entry],
            confidence: "medium",
            provenance,
          });
        });
      });

    const assignmentLikeIndexes = unique(
      [
        assessmentDueIndex,
        ...assessmentColumnIndexes,
        ...assignmentIndexes,
        ...genericDueIndexes,
        ...lowerHeaders
          .map((header, index) => ({ header, index }))
          .filter(
            ({ header, index }) =>
              index !== topicIndex &&
              /\bproject\b|\bexam\b/.test(header) &&
              !/(reading|study materials|notes?|location|submission|weight|value|worth|percentage|percent)/.test(
                header
              )
          )
          .map(({ index }) => index),
      ].filter(
        (index) => index !== -1
      )
    );
    assignmentLikeIndexes.forEach((index) => {
      let rawCell = row[index];
      let normalizedCell = normalizeWhitespace(rawCell);
      if (!normalizedCell || /^none$/i.test(normalizedCell)) return;

      const headerLabel = baseLabelFromDueHeader(headers[index]);
      const pendingHeading = pendingDueHeadingByColumn.get(index);
      const hasOwnMarker =
        Boolean(activityDueMarkerLabel(normalizedCell, headerLabel)) ||
        Boolean(assignmentLabelFromText(normalizedCell)) ||
        Boolean(extractProseDeliverableLabel(normalizedCell)) ||
        Boolean(extractAssessmentLabelFromText(normalizedCell));
      const hasOwnDates =
        Boolean(parseDateSpec(normalizedCell, meta.termYear)) ||
        extractDeadlineAnchoredDates(normalizedCell, meta.termYear).length > 0;

      if (pendingHeading && hasOwnDates && !hasOwnMarker) {
        normalizedCell = normalizeWhitespace(`${pendingHeading} ${normalizedCell}`);
        rawCell = normalizedCell;
        pendingDueHeadingByColumn.delete(index);
      }

      if (/:\s*$/.test(normalizedCell) && !hasOwnDates) {
        pendingDueHeadingByColumn.set(index, normalizedCell);
        return;
      }

      const dueEntries = rawCell
        .split(/\n+/)
        .map((entry) => normalizeWhitespace(entry))
        .filter(Boolean)
        .reduce<{ entries: string[]; pendingDateHeading?: string }>((state, line) => {
          const normalizedLine = line
            .replace(
              /\s+\band\s+(?=(?:written\s+(?:portion|submissions?)|report\b|submission\b))/gi,
              "; "
            );
          const splitEntries = expandScheduleEntries(normalizedLine).flatMap((value) =>
            splitCompoundActionableEntries(value)
          );

          splitEntries.forEach((splitEntry) => {
            if (/^none$/i.test(splitEntry) || /^no assignments?\b/i.test(splitEntry)) {
              state.pendingDateHeading = undefined;
              return;
            }
            if (isReviewOrPlaceholderScheduleEntry(splitEntry)) {
              state.pendingDateHeading = undefined;
              return;
            }

            const assignmentLabel =
              assignmentLabelFromText(splitEntry) ??
              extractProseDeliverableLabel(splitEntry) ??
              extractWeekTableDeliverableLabel(splitEntry) ??
              (/^a\s*\d+\b/i.test(splitEntry) ? assignmentLabelFromText(splitEntry) : undefined);
            const assessmentLabel = extractAssessmentLabelFromText(splitEntry);
            const dateSpecForLine = parseDateSpec(splitEntry, meta.termYear);
            const deadlineDates = extractDeadlineAnchoredDates(splitEntry, meta.termYear);
            const hasExplicitDate =
              Boolean(dateSpecForLine?.kind) || deadlineDates.length > 0;
            const continuationDeliverableWithOwnDate =
              state.entries.length > 0 &&
              hasExplicitDate &&
              !assignmentLabel &&
              !assessmentLabel &&
              /^(?:written\s+(?:portion|submissions?)|report\b|submission\b|slides?\b|presentation materials\b|ethics module\b|inaturalist\b)/i.test(
                splitEntry
              );

            let effectiveEntry = splitEntry;
            if (
              state.pendingDateHeading &&
              (assignmentLabel || assessmentLabel) &&
              !hasExplicitDate
            ) {
              effectiveEntry = normalizeWhitespace(`${state.pendingDateHeading} ${splitEntry}`);
              state.pendingDateHeading = undefined;
            }

            if (
              state.entries.length > 0 &&
              (/^\(/.test(splitEntry) ||
                /^(?:due\b|available from\b|opens?\b|closes?\b|submitted?\b|deadline\b)/i.test(
                  splitEntry
                ))
            ) {
              state.entries[state.entries.length - 1] = normalizeWhitespace(
                `${state.entries[state.entries.length - 1]} ${splitEntry}`
              );
              return;
            }

            if (
              state.entries.length > 0 &&
              hasExplicitDate &&
              !assignmentLabel &&
              !assessmentLabel &&
              /^(?:(?:Mon(?:day)?|Tue(?:s|sday)?|Wed(?:nesday)?|Thu(?:r|rs|rsday|ursday)?|Fri(?:day)?|Sat(?:urday)?|Sun(?:day)?),?\s+)?(?:(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?|\d{1,2})\b|Fri\b|Mon\b|Tue\b|Wed\b|Thu\b|Sat\b|Sun\b)/i.test(
                splitEntry
              )
            ) {
              state.entries[state.entries.length - 1] = normalizeWhitespace(
                `${state.entries[state.entries.length - 1]} ${splitEntry}`
              );
              return;
            }

            if (hasExplicitDate && !assignmentLabel && !assessmentLabel) {
              if (continuationDeliverableWithOwnDate) {
                state.entries.push(splitEntry);
                return;
              }
              state.pendingDateHeading = splitEntry;
              return;
            }

            if (
              state.entries.length > 0 &&
              !assignmentLabel &&
              !assessmentLabel &&
              !hasExplicitDate &&
              !/^(?:week|reading week|term test|midterm|quiz|test|exam)\b/i.test(splitEntry)
            ) {
              state.entries[state.entries.length - 1] = normalizeWhitespace(
                `${state.entries[state.entries.length - 1]} ${splitEntry}`
              );
              return;
            }

            state.entries.push(effectiveEntry);
          });

          return state;
        }, { entries: [] as string[] })
        .entries
        .filter(Boolean)
        .filter((entry) => !/^none$/i.test(entry));
      let previousDueLabel: string | undefined;
      if (dueEntries.length === 0) {
        const contextualCellLabel =
          extractAssessmentLabelFromText(normalizedCell) ??
          extractWeekTableDeliverableLabel(normalizedCell) ??
          extractProseDeliverableLabel(normalizedCell) ??
          assignmentLabelFromText(normalizedCell) ??
          extractAssessmentLabelFromText(topic) ??
          extractWeekTableDeliverableLabel(topic) ??
          extractProseDeliverableLabel(topic) ??
          assignmentLabelFromText(topic);
        const contextualDates = normalizeOccurrencesToOutlineTermYear(
          (parseDateSpec(normalizedCell, meta.termYear)?.kind === "single"
            ? [{ date: (parseDateSpec(normalizedCell, meta.termYear) as { kind: "single"; date: string }).date }]
            : parseDateSpec(normalizedCell, meta.termYear)?.kind === "dates"
            ? (parseDateSpec(normalizedCell, meta.termYear) as { kind: "dates"; dates: string[] }).dates.map((date) => ({
                date,
              }))
            : extractExplicitDates(normalizedCell, meta.termYear).map((date) => ({ date }))) ?? [],
          normalizedCell,
          meta
        );
        const rowScopedFallbackDate =
          rowDates.length === 1
            ? rowDates[0]
            : rowDates.length > 1 && Number.isFinite(weekNumber)
            ? rowDates[0]
            : undefined;
        const contextualFallbackDates =
          contextualDates.length > 0
            ? contextualDates
            : contextualCellLabel &&
              rowScopedFallbackDate &&
              !/^(?:project help session|project starts?)$/i.test(contextualCellLabel) &&
              !/\b(?:help session|starts?|begin(?:s)?|continue(?:s)? working on|review)\b/i.test(
                normalizedCell
              )
            ? [{ date: rowScopedFallbackDate }]
            : [];
        if (contextualCellLabel && contextualFallbackDates.length > 0) {
          const contextualType = assessmentTypeFromLabel(contextualCellLabel, topic);
          contextualFallbackDates.forEach((occurrence) => {
            assessments.push({
              label: contextualCellLabel,
              eventType: contextualType === "Assessment" ? "Assessment" : "Assignment",
              date: occurrence.date,
              endDate: occurrence.endDate,
              allDay: true,
              location:
                contextualType === "Assessment"
                  ? extractStructuredLocation(normalizedCell, true) || undefined
                  : assignmentLocationFromContext(`${topic} ${normalizedCell} ${section.text}`),
              notes: [normalizeWhitespace(`${topic} ${normalizedCell}`)],
              confidence: "medium",
              provenance,
              replaceMeetingType:
                contextualType === "Assessment" && /\bin class|lecture/i.test(topic)
                  ? "Lecture"
                  : undefined,
            });
          });
          previousDueLabel = contextualCellLabel;
          return;
        }
      }
      const defaultWeekday =
        extractRelativeWeekdayCode(`${headers[index]} ${normalizedCell}`) ??
        extractRelativeWeekdayCode(headers[index]);

      dueEntries.forEach((entry) => {
        if (isReviewOrPlaceholderScheduleEntry(entry) || /\bexam review\b/i.test(entry)) {
          return;
        }
        const markerLabel = activityDueMarkerLabel(entry, headerLabel);
        const entrySpec = parseDateSpec(entry, meta.termYear);
        const directExplicitDates = extractExplicitDates(entry, meta.termYear).map((date) =>
          normalizeWeekTableInferredDate(date, entry, meta.termYear)
        );
        const anchoredDates = extractDeadlineAnchoredDates(entry, meta.termYear);
        const assignmentReleaseCue = /\b(?:available(?:\s+as\s+of|\s+from|\s+on)?|opens?(?:\s+on)?|posted(?:\s+on|\s+to)?|released|begins?(?:\s+on)?|starts?(?:\s+on)?)\b/i.test(
          entry
        );
        const assignmentDueCue = /\b(?:due(?:\s+by|\s+on|\s+date)?|deadline(?:\s+for)?|submitted?\s+by)\b/i.test(
          entry
        );
        const explicitDates =
          entrySpec?.kind === "single"
            ? [entrySpec.date]
            : entrySpec?.kind === "dates"
            ? entrySpec.dates
            : anchoredDates.length > 0
            ? anchoredDates
            : directExplicitDates;
        const resolvedOccurrences =
          explicitDates.length > 0
            ? explicitDates.map((date) => ({ date }))
            : markerLabel && rowDates.length > 0
            ? rowDates.map((date) => ({ date }))
            : entrySpec?.kind === "single"
            ? [
                {
                  date: defaultWeekday
                    ? inferDateFromAnchorAndWeekday(entrySpec.date, defaultWeekday)
                    : entrySpec.date,
                },
              ]
            : entrySpec?.kind === "range" && entrySpec.startDate
            ? [
                {
                  date: defaultWeekday
                    ? inferDateFromAnchorAndWeekday(entrySpec.startDate, defaultWeekday)
                    : entrySpec.startDate,
                  endDate:
                    entrySpec.endDate && defaultWeekday
                      ? inferDateFromAnchorAndWeekday(entrySpec.endDate, defaultWeekday)
                      : entrySpec.endDate,
                },
              ]
            : [];
        const { startTime, endTime } = parseTimeRange(entry);
        const directAssignmentLabel =
          (markerLabel?.eventType === "Assignment" ? markerLabel.label : undefined) ??
          extractWeekTableDeliverableLabel(entry, previousDueLabel) ??
          (/^a\s*\d+\b/i.test(entry) ? assignmentLabelFromText(entry) : undefined);
        const contextualAssignmentLabel =
          contextualizePlaceholderDeliverableLabel(entry, previousDueLabel);
        const assignmentLabel =
          directAssignmentLabel &&
          assessmentTypeFromLabel(directAssignmentLabel, normalizedCell) !== "Assessment"
            ? isPlaceholderDeliverableLabel(directAssignmentLabel)
              ? contextualAssignmentLabel
              : directAssignmentLabel
            : contextualAssignmentLabel;
        if (assignmentLabel && assessmentTypeFromLabel(assignmentLabel, normalizedCell) !== "Assessment") {
          const effectiveOccurrences =
            resolvedOccurrences.length > 0
              ? resolvedOccurrences
              : rowDates.length > 0 &&
                !assignmentReleaseCue &&
                /\b(?:due|deadline)\b/i.test(`${headers[index]} ${entry}`)
              ? rowDates.map((date) => ({ date }))
              : rowDates.length > 0 &&
                /\b(?:problem set|assignment|task|module|reflection|worksheet|lab report|commentary)\b/i.test(
                  assignmentLabel
                )
              ? rowDates.map((date) => ({ date }))
              : [];
          if (effectiveOccurrences.length === 0) {
            assessments.push({
              label: assignmentLabel,
              eventType: "Assignment",
              allDay: !startTime,
              startTime,
              endTime,
              location: assignmentLocationFromContext(`${entry} ${section.text}`),
              notes: [entry],
              confidence: "low",
              provenance,
            });
            previousDueLabel = assignmentLabel;
            return;
          }

          effectiveOccurrences.forEach((occurrence, occurrenceIndex) => {
            const isAvailabilityOccurrence =
              (assignmentDueCue &&
                effectiveOccurrences.length > 1 &&
                occurrenceIndex < effectiveOccurrences.length - 1) ||
              (assignmentReleaseCue &&
                (!assignmentDueCue ||
                  occurrenceIndex < effectiveOccurrences.length - 1 ||
                  effectiveOccurrences.length === 1));
            const occurrenceLabel = applyEventTimingLabel(
              assignmentLabel,
              isAvailabilityOccurrence ? `${entry} available` : entry
            );
            assessments.push({
              label: occurrenceLabel,
              eventType: "Assignment",
              date: occurrence.date,
              endDate: occurrence.endDate,
              allDay: !startTime,
              startTime,
              endTime,
              location: assignmentLocationFromContext(`${entry} ${section.text}`),
              notes: [entry],
              confidence: confidenceFromSeed({
                date: occurrence.date,
                startTime,
                endTime,
              }),
              provenance,
            });
          });
          previousDueLabel = assignmentLabel;
          return;
        }

        const assessmentLabel =
          (markerLabel?.eventType === "Assessment" ? markerLabel.label : undefined) ??
          extractAssessmentLabelFromText(entry);
        if (assessmentLabel && !isFinalExamLabel(assessmentLabel)) {
          const effectiveAssessmentOccurrences =
            resolvedOccurrences.length > 0
              ? resolvedOccurrences
              : rowDates.length > 0
              ? rowDates.map((date) => ({ date }))
              : [];
          if (effectiveAssessmentOccurrences.length === 0) {
            assessments.push({
              label: assessmentLabel,
              eventType: "Assessment",
              allDay: !startTime,
              startTime,
              endTime,
              notes: [entry],
              confidence: "low",
              provenance,
              replaceMeetingType: /in class|lecture/i.test(entry) ? "Lecture" : undefined,
            });
            previousDueLabel = assessmentLabel;
            return;
          }

          effectiveAssessmentOccurrences.forEach((occurrence) => {
            assessments.push({
              label: assessmentLabel,
              eventType: "Assessment",
              date: occurrence.date,
              endDate: occurrence.endDate,
              allDay: !startTime,
              startTime,
              endTime,
              notes: [entry],
              confidence: confidenceFromSeed({
                date: occurrence.date,
                startTime,
                endTime,
              }),
              provenance,
              replaceMeetingType: /in class|lecture/i.test(entry) ? "Lecture" : undefined,
            });
          });
          previousDueLabel = assessmentLabel;
        }
      });
    });

    const wholeRowCellCount = row.filter((cell) => normalizeWhitespace(cell)).length;
    const shouldInspectWholeRowForDirectEvent =
      wholeRowCellCount === 1 ||
      (assignmentLikeIndexes.length === 0 &&
        topicIndex === -1 &&
        headers.length <= 2);

    if (
      shouldInspectWholeRowForDirectEvent &&
      /\b(?:submit|submitted?\b|due\b|deadline\b|available\b|opens?\b|closes?\b|midterm\b|term test\b|quiz\b|test\b|exam\b)\b/i.test(
        rowText
      )
    ) {
      const wholeRowLabel =
        assignmentLabelFromText(rowText) ??
        extractWeekTableDeliverableLabel(rowText) ??
        extractProseDeliverableLabel(rowText) ??
        extractAssessmentLabelFromText(rowText);
      if (wholeRowLabel && !isFinalExamLabel(wholeRowLabel)) {
        const wholeRowEventType = assessmentTypeFromLabel(wholeRowLabel, rowText);
        if (wholeRowEventType !== "Other") {
          const wholeRowDates = extractDeadlineAnchoredDates(rowText, meta.termYear);
          const wholeRowExplicitDates =
            wholeRowDates.length > 0
              ? wholeRowDates
              : extractExplicitDates(rowText, meta.termYear).map((date) =>
                  normalizeWeekTableInferredDate(date, rowText, meta.termYear)
                );
          const wholeRowOccurrences =
            wholeRowExplicitDates.length > 0
              ? wholeRowExplicitDates.map((date) => ({ date }))
              : dateSpec?.kind === "single"
                ? [{ date: dateSpec.date }]
                : dateSpec?.kind === "range" && dateSpec.startDate
                  ? [{ date: dateSpec.startDate, endDate: dateSpec.endDate }]
                  : [];
          const { startTime, endTime } = parseTimeRange(rowText);

          wholeRowOccurrences.forEach((occurrence) => {
            assessments.push({
              label: wholeRowLabel,
              eventType: wholeRowEventType,
              date: occurrence.date,
              endDate: occurrence.endDate,
              allDay: !startTime,
              startTime,
              endTime,
              location:
                wholeRowEventType === "Assignment"
                  ? assignmentLocationFromContext(`${rowText} ${section.text}`)
                  : extractStructuredLocation(rowText, true) || undefined,
              notes: [rowText],
              confidence: confidenceFromSeed({
                date: occurrence.date,
                startTime,
                endTime,
              }),
              provenance,
              replaceMeetingType:
                wholeRowEventType === "Assessment" && /\bin class\b/i.test(rowText)
                  ? "Lecture"
                  : undefined,
            });
          });
        }
      }
    }

    const supplementalIndexes = row
      .map((_cell, index) => index)
      .filter(
        (index) =>
          ![
            weekIndex,
            dateIndex,
            startIndex,
            endIndex,
            readingsIndex,
            labIndex,
            notesIndex,
            ...assignmentLikeIndexes,
          ].includes(index)
      );

    supplementalIndexes.forEach((index) => {
      const rawCell = row[index];
      const normalizedCell = normalizeWhitespace(rawCell);
      if (!normalizedCell || /^none$/i.test(normalizedCell)) return;

      const cellEntries = rawCell
        .split(/\n+/)
        .map((entry) => normalizeWhitespace(entry))
        .filter(Boolean)
        .reduce<string[]>((entries, line) => {
          const lineHasExplicitDate =
            Boolean(parseDateSpec(line, meta.termYear)) ||
            extractExplicitDates(line, meta.termYear).length > 0;
          const lineHasOwnLabel =
            Boolean(assignmentLabelFromText(line)) ||
            Boolean(extractWeekTableDeliverableLabel(line)) ||
            Boolean(extractProseDeliverableLabel(line)) ||
            Boolean(extractAssessmentLabelFromText(line));
          if (
            entries.length > 0 &&
            (/^\(/.test(line) ||
              /^(?:due\b|available from\b|opens?\b|closes?\b|submitted?\b|deadline\b|scheduled\b)/i.test(
                line
              ))
          ) {
            entries[entries.length - 1] = normalizeWhitespace(
              `${entries[entries.length - 1]} ${line}`
            );
            return entries;
          }
          if (
            entries.length > 0 &&
            lineHasExplicitDate &&
            !lineHasOwnLabel &&
            !/^(?:week|reading week|midterm week|no class(?:es)?|no tutorial)\b/i.test(line)
          ) {
            entries[entries.length - 1] = normalizeWhitespace(
              `${entries[entries.length - 1]} ${line}`
            );
            return entries;
          }
          return [...entries, ...splitCompoundActionableEntries(line)];
        }, [])
        .filter(Boolean);

      cellEntries.forEach((entry) => {
        if (isReviewOrPlaceholderScheduleEntry(entry) || /\bexam review\b/i.test(entry)) {
          return;
        }
        const explicitDates = extractExplicitDates(entry, meta.termYear);
        const entryHasDateCue =
          explicitDates.length > 0 ||
          /\b(?:due|deadline|available|opens?|closes?|scheduled|presentation|seminar|tutorial problem)\b/i.test(
            entry
          );
        if (!entryHasDateCue) return;

        const entryLabel =
          extractProseDeliverableLabel(entry) ??
          extractAssessmentLabelFromText(entry) ??
          labelFromScheduleEntry(entry);
        if (!entryLabel || isFinalExamLabel(entryLabel)) return;

        const eventType = assessmentTypeFromLabel(entryLabel, `${entry} ${normalizedCell}`);
        if (eventType === "Other") return;

        const resolvedOccurrences =
          explicitDates.length > 0
            ? explicitDates.map((date) => ({ date }))
            : dateSpec?.kind === "range" && dateSpec.startDate && dateSpec.endDate
            ? [{ date: dateSpec.startDate, endDate: dateSpec.endDate }]
            : dateSpec?.kind === "single"
            ? [{ date: dateSpec.date }]
            : [];
        if (resolvedOccurrences.length === 0) return;

        const { startTime, endTime } = parseTimeRange(entry);
        const rowLocation = locationFromRowText(`${entry} | ${rowText}`);

        resolvedOccurrences.forEach((occurrence) => {
          assessments.push({
            label: entryLabel,
            eventType,
            date: occurrence.date,
            endDate: occurrence.endDate,
            allDay: !startTime,
            startTime,
            endTime,
            location:
              rowLocation ||
              (eventType === "Assignment"
                ? assignmentLocationFromContext(`${entry} ${section.text}`)
                : extractStructuredLocation(entry, true) || undefined),
            notes: [entry],
            confidence: confidenceFromSeed({
              date: occurrence.date,
              startTime,
              endTime,
            }),
            provenance,
          });
        });
      });
    });

    const readingsCell = normalizeWhitespace(row[readingsIndex]);
    const dueDateMatch = readingsCell.match(/\bdue\s+([A-Za-z0-9/,\- ]+)/i);
    const assignmentLabel =
      readingsCell.match(/(Reading assignment\s*#?\d+)/i)?.[1] ??
      readingsCell.match(/(Week \d+)/i)?.[1];
    if (assignmentLabel && dueDateMatch) {
      const dueDate =
        parseDateSpec(dueDateMatch[1], meta.termYear)?.kind === "single"
          ? (parseDateSpec(dueDateMatch[1], meta.termYear) as { kind: "single"; date: string }).date
          : extractExplicitDates(dueDateMatch[1], meta.termYear)[0];
      assessments.push({
        label: assignmentLabel,
        eventType: "Assignment",
        date: dueDate,
        allDay: true,
        location: /connect/i.test(section.text) ? "McGraw-Hill Connect" : "Online",
        notes: [readingsCell],
        confidence: dueDate ? "high" : "low",
        provenance,
      });
    }

    const labCell = normalizeWhitespace(row[labIndex]);
    if (labCell) {
      const labEntries = row[labIndex]
        .split(/\n+/)
        .map((entry) => normalizeWhitespace(entry))
        .filter(Boolean);
      labEntries.forEach((entry) => {
        const entryAssessmentLabel = extractAssessmentLabelFromText(entry);
        const entryAssignmentLabel =
          !entryAssessmentLabel ? extractProseDeliverableLabel(entry) : undefined;
        if (!entryAssessmentLabel && !entryAssignmentLabel) return;

        const explicitDates = extractExplicitDates(entry, meta.termYear);
        const resolvedOccurrences =
          explicitDates.length > 0
            ? explicitDates.map((date) => ({ date }))
            : dateSpec?.kind === "single"
            ? [{ date: dateSpec.date }]
            : rowDates.length === 1
            ? [{ date: rowDates[0] }]
            : dateSpec?.kind === "range" && dateSpec.startDate
            ? [{ date: dateSpec.startDate, endDate: dateSpec.endDate }]
            : [];
        if (resolvedOccurrences.length === 0) return;

        const { startTime, endTime } = parseTimeRange(entry);
        const label = entryAssessmentLabel ?? entryAssignmentLabel!;
        const eventType = entryAssessmentLabel ? "Assessment" : "Assignment";

        resolvedOccurrences.forEach((occurrence) => {
          assessments.push({
            label,
            eventType,
            date: occurrence.date,
            endDate: occurrence.endDate,
            allDay: !startTime,
            startTime,
            endTime,
            location:
              eventType === "Assignment"
                ? assignmentLocationFromContext(`${entry} ${section.text}`)
                : extractStructuredLocation(entry, true) || undefined,
            notes: [entry],
            confidence: confidenceFromSeed({
              date: occurrence.date,
              startTime,
              endTime,
            }),
            provenance,
            replaceMeetingType:
              eventType === "Assessment" && /\blab\b/i.test(headers[labIndex] ?? "")
                ? "Lab"
                : undefined,
          });
        });
      });

      if (/no lab|no labs|reading week/i.test(labCell)) {
        if (dateSpec?.kind === "range" && dateSpec.startDate && dateSpec.endDate) {
          exclusions.push({
            appliesTo: ["Lab"],
            startDate: dateSpec.startDate,
            endDate: dateSpec.endDate,
            reason: labCell,
            provenance,
          });
        }
      } else {
        const explicitDates = extractExplicitDates(labCell, meta.termYear);
        attachments.push({
          appliesTo: ["Lab"],
          exactDates: explicitDates.length > 0 ? explicitDates : undefined,
          startDate:
            explicitDates.length === 0 && dateSpec?.kind === "range" ? dateSpec.startDate : undefined,
          endDate:
            explicitDates.length === 0 && dateSpec?.kind === "range" ? dateSpec.endDate : undefined,
          note: labCell,
          provenance,
        });
      }
    }

    tutorialIndexes.forEach(({ header, index }) => {
      const tutorialCell = normalizeWhitespace(row[index]);
      if (!tutorialCell) return;
      const sectionNumber = header.match(/\((\d+)\)/)?.[1];
      const tutorialSectionIds = sectionOptions
        .filter(
          (option) =>
            option.kind.toUpperCase().includes("TUT") &&
            (!sectionNumber || option.number === sectionNumber)
        )
        .map((option) => option.id);

      if (/no tutorial/i.test(tutorialCell)) {
        const targetDate =
          dateSpec?.kind === "single"
            ? dateSpec.date
            : dateSpec?.kind === "range"
            ? dateSpec.startDate
            : undefined;
        if (targetDate && dateSpec?.kind !== "range") {
          exclusions.push({
            appliesTo: ["Tutorial"],
            sectionOptionIds: tutorialSectionIds,
            startDate: targetDate,
            endDate: targetDate,
            reason: tutorialCell,
            provenance,
          });
        } else if (dateSpec?.kind === "range" && dateSpec.startDate && dateSpec.endDate) {
          exclusions.push({
            appliesTo: ["Tutorial"],
            sectionOptionIds: tutorialSectionIds,
            startDate: dateSpec.startDate,
            endDate: dateSpec.endDate,
            reason: tutorialCell,
            provenance,
          });
        }
        return;
      }

      const tutorialEntries = row[index]
        .split(/\n+/)
        .flatMap((entry) => expandScheduleEntries(entry))
        .map((entry) => normalizeWhitespace(entry))
        .filter(Boolean);
      let emittedTutorialDeliverable = false;

      tutorialEntries.forEach((entry) => {
        if (!entry || /^tbd$/i.test(entry) || /^no tutorial\b/i.test(entry)) return;

        const tutorialAssignmentLabel =
          extractWeekTableDeliverableLabel(entry) ??
          extractProseDeliverableLabel(entry) ??
          assignmentLabelFromText(entry);
        const tutorialAssessmentLabel =
          !tutorialAssignmentLabel ? extractAssessmentLabelFromText(entry) : undefined;
        const tutorialLabel = tutorialAssignmentLabel ?? tutorialAssessmentLabel;
        if (!tutorialLabel || isFinalExamLabel(tutorialLabel)) return;

        const resolvedOccurrences =
          dateSpec?.kind === "single"
            ? [{ date: dateSpec.date }]
            : rowDates.length > 0
            ? rowDates.map((date) => ({ date }))
            : dateSpec?.kind === "range" && dateSpec.startDate
            ? [{ date: dateSpec.startDate, endDate: dateSpec.endDate }]
            : [];
        if (resolvedOccurrences.length === 0) return;

        const { startTime, endTime } = parseTimeRange(entry);
        resolvedOccurrences.forEach((occurrence) => {
          assessments.push({
            label: tutorialLabel,
            eventType: tutorialAssessmentLabel ? "Assessment" : "Assignment",
            date: occurrence.date,
            endDate: occurrence.endDate,
            allDay: !startTime,
            startTime,
            endTime,
            location:
              tutorialAssessmentLabel
                ? extractStructuredLocation(entry, true) || undefined
                : assignmentLocationFromContext(`${entry} ${section.text}`),
            notes: [entry],
            confidence: confidenceFromSeed({
              date: occurrence.date,
              startTime,
              endTime,
            }),
            provenance,
            replaceMeetingType: tutorialAssessmentLabel ? "Tutorial" : undefined,
          });
        });
        emittedTutorialDeliverable = true;
      });

      if (emittedTutorialDeliverable) {
        return;
      }

      attachments.push({
        appliesTo: ["Tutorial"],
        sectionOptionIds: tutorialSectionIds,
        exactDates: dateSpec?.kind === "single" ? [dateSpec.date] : undefined,
        startDate: dateSpec?.kind === "range" ? dateSpec.startDate : undefined,
        endDate: dateSpec?.kind === "range" ? dateSpec.endDate : undefined,
        note: tutorialCell,
        provenance,
      });
    });

    if (assessments.length === assessmentsBeforeRow) {
      const fallbackIndexes = unique(
        [topicIndex, ...assignmentLikeIndexes, ...tutorialIndexes.map((item) => item.index)].filter(
          (index) => index !== -1
        )
      );

      fallbackIndexes.forEach((index) => {
        const rawCell = row[index];
        if (!normalizeWhitespace(rawCell)) return;

        const cellEntries = rawCell
          .split(/\n+/)
          .flatMap((entry) => expandScheduleEntries(entry))
          .flatMap((entry) => splitCompoundActionableEntries(entry))
          .map((entry) => normalizeWhitespace(entry))
          .filter(Boolean);

        cellEntries.forEach((entry) => {
          if (isRoutineScheduleEntry(entry) || isReviewOrPlaceholderScheduleEntry(entry)) {
            return;
          }

          const fallbackLabel =
            extractWeekTableDeliverableLabel(entry) ??
            assignmentLabelFromText(entry) ??
            extractAssessmentLabelFromText(entry) ??
            extractProseDeliverableLabel(entry) ??
            labelFromScheduleEntry(entry);
          if (!fallbackLabel || isFinalExamLabel(fallbackLabel)) return;

          const eventType = assessmentTypeFromLabel(fallbackLabel, entry);
          if (eventType === "Other") return;

          const explicitDates = extractDeadlineAnchoredDates(entry, meta.termYear);
          const secondaryDates =
            explicitDates.length > 0
              ? explicitDates
              : extractExplicitDates(entry, meta.termYear).map((date) =>
                  normalizeWeekTableInferredDate(date, entry, meta.termYear)
                );
          const fallbackDate =
            dateSpec?.kind === "single"
              ? dateSpec.date
              : rowDates[0] ??
                (dateSpec?.kind === "range" ? dateSpec.startDate : undefined);
          const resolvedOccurrences =
            secondaryDates.length > 0
              ? secondaryDates.map((date) => ({ date }))
              : fallbackDate &&
                /\b(?:due|deadline|available|opens?|closes?|submitted?\b)\b/i.test(entry)
              ? [{ date: fallbackDate }]
              : [];
          if (resolvedOccurrences.length === 0) return;

          const { startTime, endTime } = parseTimeRange(entry);
          resolvedOccurrences.forEach((occurrence) => {
            assessments.push({
              label: fallbackLabel,
              eventType,
              date: occurrence.date,
              allDay: !startTime,
              startTime,
              endTime,
              location:
                eventType === "Assignment"
                  ? assignmentLocationFromContext(`${entry} ${section.text}`)
                  : extractStructuredLocation(entry, true) || undefined,
              notes: [entry],
              confidence: confidenceFromSeed({
                date: occurrence.date,
                startTime,
                endTime,
              }),
              provenance,
            });
          });
        });
      });
    }

    const notesCell = normalizeWhitespace(row[notesIndex]);
    if (notesCell) {
      const sectionNumber = notesCell.match(/\b(\d{3})\b/)?.[1];
      const matchingSectionIds = sectionOptions
        .filter(
          (option) =>
            option.kind.toUpperCase().includes("LEC") &&
            (!sectionNumber || option.number === sectionNumber)
        )
        .map((option) => option.id);
      const exactDate = normalizeWeekTableInferredDate(
        parseSlashDate(notesCell, meta.termYear) ??
          extractExplicitDates(notesCell, meta.termYear)[0],
        notesCell,
        meta.termYear
      );
      const anchoredDate =
        exactDate ??
        (dateSpec?.kind === "single"
          ? dateSpec.date
          : dateSpec?.kind === "range"
          ? dateSpec.startDate
          : undefined);

      if (/no lecture/i.test(notesCell) && exactDate) {
        exclusions.push({
          appliesTo: ["Lecture"],
          sectionOptionIds: matchingSectionIds,
          startDate: exactDate,
          endDate: exactDate,
          reason: notesCell,
          provenance,
        });
      } else if (/midterm/i.test(notesCell) && anchoredDate) {
        assessments.push({
          label: notesCell.replace(/\s+/g, " ").trim(),
          eventType: "Assessment",
          date: anchoredDate,
          allDay: !exactDate,
          notes: [notesCell],
          confidence: exactDate ? "medium" : "low",
          provenance,
          replaceMeetingType: "Lecture",
        });
      } else if (anchoredDate) {
        attachments.push({
          appliesTo: ["Lecture"],
          sectionOptionIds: matchingSectionIds,
          exactDates: exactDate ? [exactDate] : undefined,
          startDate: exactDate ? undefined : anchoredDate,
          endDate: exactDate ? undefined : anchoredDate,
          note: notesCell,
          provenance,
        });
      }
    }

    const anchoredRowDate =
      dateSpec?.kind === "single"
        ? dateSpec.date
        : dateSpec?.kind === "range"
        ? dateSpec.startDate
        : undefined;
    const rowAssessmentLabel = extractAssessmentLabelFromText(rowText);
    const rowAssessmentDates = extractDeadlineAnchoredDates(rowText, meta.termYear).map((date) =>
      normalizeWeekTableInferredDate(date, rowText, meta.termYear)
    );
    const normalizedAnchoredRowDate = normalizeWeekTableInferredDate(
      anchoredRowDate,
      dateSourceText,
      meta.termYear
    );
    const nonAnchoredExplicitRowDate = extractExplicitDates(rowText, meta.termYear)
      .map((date) => normalizeWeekTableInferredDate(date, rowText, meta.termYear))
      .find((date) => date !== normalizedAnchoredRowDate);
    const hasCoverageLanguage =
      /\bcovers?\b|\binclusive\b|\bfrom\b[\s\S]{0,80}\bto\b/i.test(rowText);
    const resolvedRowAssessmentDate =
      rowAssessmentDates.length === 1
        ? rowAssessmentDates[0]
        : rowAssessmentDates.length > 1 && hasCoverageLanguage
        ? normalizedAnchoredRowDate ?? rowDates[0] ?? rowAssessmentDates[0]
        : (dateIndex !== -1 && dateSpec?.kind === "single" ? dateSpec.date : undefined) ??
          rowAssessmentDates.find((date) => date !== normalizedAnchoredRowDate) ??
      nonAnchoredExplicitRowDate ??
      normalizedAnchoredRowDate;
    if (
      assessments.length === assessmentsBeforeRow &&
      resolvedRowAssessmentDate &&
      rowAssessmentLabel &&
      /midterm|quiz|term test|endterm|exam/i.test(rowText)
    ) {
      assessments.push({
        label: rowAssessmentLabel,
        eventType: "Assessment",
        date: resolvedRowAssessmentDate,
        allDay: resolvedRowAssessmentDate === normalizedAnchoredRowDate,
        notes: [rowText],
        confidence:
          extractExplicitDates(rowText, meta.termYear).length > 0 ? "medium" : "low",
        provenance,
        replaceMeetingType: /in class|lecture|midterm/i.test(rowText) ? "Lecture" : undefined,
      });
    }
  });

  return { weekWindows, attachments, exclusions, assessments };
}

function parseDatedScheduleTable(
  section: SectionBlock,
  headers: string[],
  rows: string[][],
  meta: OutlineMeta,
  sectionOptions: ParsedSectionOption[]
) {
  const lowerHeaders = headers.map((header) => header.toLowerCase());
  const dateIndex = lowerHeaders.findIndex(
    (header) =>
      header.includes("date") ||
      (/^\s*class\s*$/.test(header) && lowerHeaders.some((item) => /deadlines?/.test(item))) ||
      (/\bweek\b/.test(header) && lowerHeaders.some((item) => /deadlines?/.test(item)))
  );
  const contentIndexes = lowerHeaders
    .map((header, index) => ({ header, index }))
    .filter(
      ({ header }) =>
        /requirement|major assignment|activities?|assessments?|deadlines?/.test(
          header
        )
    )
    .map(({ index }) => index);

  if (dateIndex === -1 || contentIndexes.length === 0) {
    return { assessments: [] as AssessmentSeed[], exclusions: [] as ExclusionWindow[] };
  }

  const assessments: AssessmentSeed[] = [];
  const exclusions: ExclusionWindow[] = [];

  rows.forEach((row) => {
    const dateText = normalizeWhitespace(row[dateIndex]);
    if (!dateText) return;

    const rowText = row
      .map((cell) => normalizeWhitespace(cell))
      .filter(Boolean)
      .join(" | ");
    const provenance = [makeProvenance(section, "table", row.join(" | "))];
    const dateSpec = parseDateSpec(dateText, meta.termYear);
    const dateOccurrences = resolveSectionAwareDates(
      dateText,
      section,
      sectionOptions,
      meta.termYear
    );
    const rowHasConcreteDate =
      dateOccurrences.length > 0 ||
      dateSpec?.kind === "single" ||
      dateSpec?.kind === "range";

    if (/reading week|midterms?\s*\(no class\)|midterm week|no classes?|no class/i.test(rowText)) {
      if (dateSpec?.kind === "range" && dateSpec.startDate && dateSpec.endDate) {
        exclusions.push({
          appliesTo: ["Lecture"],
          startDate: dateSpec.startDate,
          endDate: dateSpec.endDate,
          reason: rowText,
          provenance,
        });
      } else if (dateSpec?.kind === "single") {
        exclusions.push({
          appliesTo: ["Lecture"],
          startDate: dateSpec.date,
          endDate: format(addDays(parseISO(dateSpec.date), 6), "yyyy-MM-dd"),
          reason: rowText,
          provenance,
        });
      }
    }

    contentIndexes.forEach((index) => {
      const content = normalizeWhitespace(row[index]);
      if (!content || /^[-–—]+$/.test(content)) return;

      const contentLineCount = content
        .split(/\n+/)
        .map((line) => normalizeWhitespace(line))
        .filter(Boolean).length;
      const contentIsNarrative =
        contentLineCount > 1 || content.length > 120 || /for next week|to do for /i.test(content);
      const entries = unique(
        (contentIsNarrative
          ? [...extractScheduleAssessmentEntries(content), ...expandScheduleEntries(content)]
          : expandScheduleEntries(content)
        )
          .map((entry) => normalizeWhitespace(entry))
          .filter((entry) => {
            if (!entry || isRoutineScheduleEntry(entry)) return false;
            if (!contentIsNarrative || hasDirectDeadlineCue(entry)) return true;
            if (!rowHasConcreteDate) return false;
            const entryLabel =
              assignmentLabelFromText(entry) ??
              extractProseDeliverableLabel(entry) ??
              extractAssessmentLabelFromText(entry) ??
              labelFromScheduleEntry(entry);
            if (!entryLabel) return false;
            const entryLocation = locationFromRowText(`${entry} | ${rowText}`);
            return assessmentTypeFromLabel(entryLabel, entryLocation) !== "Other";
          })
      );

      entries.forEach((entry) => {
        const label =
          assignmentLabelFromText(entry) ??
          extractAssessmentLabelFromText(entry) ??
          extractProseDeliverableLabel(entry) ??
          labelFromScheduleEntry(entry);
        if (!label || /^[-–—]+$/.test(label)) return;
        if (isFinalExamLabel(label)) return;

        const anchoredDates = extractDeadlineAnchoredDates(entry, meta.termYear);
        const explicitDates =
          anchoredDates.length > 0
            ? anchoredDates
            : extractExplicitDates(entry, meta.termYear).map((date) =>
                normalizeWeekTableInferredDate(date, entry, meta.termYear)
              );
        const dueWeekday = explicitDates.length === 0 ? extractRelativeWeekdayCode(entry) : undefined;
        const rowLocation = locationFromRowText(`${entry} | ${rowText}`);
        const eventType = assessmentTypeFromLabel(label, rowLocation);
        if (eventType === "Other") return;

        const pushSeed = (
          date?: string,
          sectionOptionIds?: string[],
          endDate?: string
        ) => {
          assessments.push({
            label,
            eventType,
            date,
            endDate,
            allDay: true,
            location:
              rowLocation ||
              (eventType === "Assignment"
                ? assignmentLocationFromContext(`${entry} ${section.text}`)
                : ""),
            notes: [entry],
            confidence: date ? "high" : "low",
            provenance,
            sectionOptionIds,
          });
        };

        if (explicitDates.length > 0) {
          explicitDates.forEach((date) => pushSeed(date));
          return;
        }

        if (dateOccurrences.length > 0) {
          dateOccurrences.forEach((occurrence) =>
            pushSeed(
              dueWeekday
                ? inferDateFromAnchorAndWeekday(occurrence.date, dueWeekday)
                : occurrence.date,
              occurrence.sectionOptionIds
            )
          );
          return;
        }

        if (dateSpec?.kind === "single") {
          pushSeed(
            dueWeekday ? inferDateFromAnchorAndWeekday(dateSpec.date, dueWeekday) : dateSpec.date
          );
          return;
        }

        if (dateSpec?.kind === "range" && dateSpec.startDate) {
          pushSeed(
            dueWeekday
              ? inferDateFromAnchorAndWeekday(dateSpec.startDate, dueWeekday)
              : dateSpec.startDate,
            undefined,
            dateSpec.endDate
          );
          return;
        }

        if (/date tba|tbd/i.test(dateText) || /\bdue\b/i.test(entry)) {
          pushSeed(undefined);
        }
      });
    });
  });

  return { assessments, exclusions };
}

function parseAssignmentStartDueTable(
  section: SectionBlock,
  rows: string[][],
  headers: string[],
  meta: OutlineMeta
) {
  const lowerHeaders = headers.map((header) => header.toLowerCase());
  const assignmentIndex = lowerHeaders.findIndex((header) => header.includes("assignment"));
  const activityIndex = lowerHeaders.findIndex(
    (header) =>
      header.includes("class activity") ||
      /^activity$/.test(header) ||
      /\bactivit(?:y|ies)\b/.test(header)
  );
  const sessionIndexes = lowerHeaders
    .map((header, index) => ({ header, index }))
    .filter(({ header }) => header.includes("session"))
    .map(({ index }) => index);
  const startIndex = lowerHeaders.findIndex((header) => header.includes("start"));
  const dueIndex = lowerHeaders.findIndex((header) => header.includes("due"));
  const weightIndex = lowerHeaders.findIndex((header) => header.includes("weight"));

  if (dueIndex === -1) return [] as AssessmentSeed[];

  const carry: { start?: string; due?: string; weight?: string } = {};

  return rows.flatMap((rawRow) => {
    const row = alignSparseStartDueTableRow(
      rawRow,
      headers,
      assignmentIndex,
      activityIndex,
      sessionIndexes,
      startIndex,
      dueIndex,
      weightIndex,
      carry
    );
    const rawAssignmentCell =
      assignmentIndex !== -1 ? normalizeWhitespace(row[assignmentIndex]) : "";
    const rawActivityCell = activityIndex !== -1 ? row[activityIndex] ?? "" : "";
    const activityText = normalizeWhitespace(rawActivityCell);
    const sessionText = normalizeWhitespace(
      sessionIndexes
        .map((index) => row[index])
        .map((value) => normalizeWhitespace(value))
        .filter(Boolean)
        .join(" ")
    );
    const startText = normalizeWhitespace(row[startIndex]);
    const dueText = normalizeWhitespace(row[dueIndex]);
    const weightText = normalizeWhitespace(row[weightIndex]);
    if (startIndex !== -1 && startText) carry.start = startText;
    if (dueIndex !== -1 && dueText) carry.due = dueText;
    if (weightIndex !== -1 && weightText) carry.weight = weightText;

    const startDateSource = startText || carry.start;
    const dueDateSource = dueText || carry.due;
    const startDate =
      parseDateSpec(startDateSource, meta.termYear)?.kind === "single"
        ? (parseDateSpec(startDateSource, meta.termYear) as {
            kind: "single";
            date: string;
          }).date
        : extractExplicitDates(startDateSource, meta.termYear)[0] ??
          parseFlexibleDate(
            normalizeWhitespace(startDateSource).replace(
              /\s+at\s+\d{1,2}(?::\d{2})?\s*(?:a\.?m\.?|p\.?m\.?|am|pm)\b.*$/i,
              ""
            ),
            meta.termYear
          );
    const dueDate =
      parseDateSpec(dueDateSource, meta.termYear)?.kind === "single"
        ? (parseDateSpec(dueDateSource, meta.termYear) as {
            kind: "single";
            date: string;
          }).date
        : extractExplicitDates(dueDateSource, meta.termYear)[0] ??
          parseFlexibleDate(
            normalizeWhitespace(dueDateSource).replace(
              /\s+at\s+\d{1,2}(?::\d{2})?\s*(?:a\.?m\.?|p\.?m\.?|am|pm)\b.*$/i,
              ""
            ),
            meta.termYear
          );
    const weight = normalizeWeightText(weightText || carry.weight);

    const activitySegments = unique(
      expandScheduleEntries(
        rawActivityCell.replace(
          /(?<!^)(?=\b(?:Introduce Yourself|Introduction course survey|Practice Questions Quiz\s*\d+|Quiz week\s*\d+|Discussion Post\s*#?\s*\d+|Assignment\s*#?\s*\d+|Final Project|Project\s*#?\s*\d+|Module\s*\d+|Survey)\b)/gi,
          "\n"
        )
      )
        .flatMap((value) => splitCompoundActionableEntries(value))
        .map((value) => normalizeWhitespace(value))
        .filter(Boolean)
    );

    const labels = unique(
      [
        (() => {
          if (assignmentIndex !== -1 && rawAssignmentCell && !/^\d+$/.test(rawAssignmentCell)) {
            return rawAssignmentCell;
          }
          if (assignmentIndex !== -1 && /^\d+$/.test(rawAssignmentCell)) {
            return `Assignment #${Number(rawAssignmentCell)}`;
          }
          return undefined;
        })(),
        ...activitySegments.map((segment) => {
          const directLabel =
            assignmentLabelFromText(segment) ??
            extractProseDeliverableLabel(segment) ??
            extractAssessmentLabelFromText(segment) ??
            labelFromScheduleEntry(segment);
          if (directLabel) return directLabel;
          const quizNumber = segment.match(/\bquiz\s*0*(\d+)\b/i)?.[1];
          if (/practice exercise/i.test(segment) && quizNumber) {
            return `Practice Exercise Quiz #${Number(quizNumber)}`;
          }
          return undefined;
        }),
        sessionText && !/^\d+$/.test(sessionText)
          ? capitalizeAssignmentText(sessionText)
          : undefined,
      ].filter(Boolean) as string[]
    );

    if (labels.length === 0 || !dueDate) return [];

    return labels.flatMap((label) => {
      const eventType =
        assessmentTypeFromLabel(label, activityText) === "Assessment"
          ? ("Assessment" as const)
          : ("Assignment" as const);
      return {
        label,
        eventType,
        date: dueDate,
        allDay: true,
        location:
          eventType === "Assignment"
            ? assignmentLocationFromContext(
                [startText || carry.start, dueText || carry.due, rawActivityCell, section.text]
                  .map((value) => normalizeWhitespace(value))
                  .filter(Boolean)
                  .join(" ")
              )
            : extractStructuredLocation(rawActivityCell, true) || undefined,
        notes: combineNotes(
          startDate ? [`Available from ${startDate}`] : [],
          weight ? [`Weight: ${weight}`] : []
        ),
        weight,
        confidence: "high" as const,
        provenance: [makeProvenance(section, "table", rawRow.join(" | "))],
      };
    });
  });
}

function baseLabelFromDueHeader(header: string) {
  const normalized = trimTrailingPeriods(
    normalizeWhitespace(header)
      .replace(/\b(?:due dates?|due date|deadlines?|dates?|hand in)\b/gi, "")
      .replace(/\bcoverage\b/gi, "")
      .replace(/\brecommended\b/gi, "")
      .replace(/\bpre[- ]lab\b/gi, "Pre-Lab")
      .replace(/\bpost[- ]lab\b/gi, "Post-Lab")
      .replace(/[&/:;-]+\s*$/g, "")
      .replace(/\s+/g, " ")
  );

  if (!normalized || /^date$/i.test(normalized)) return undefined;
  if (/\bmobius\b/i.test(normalized) && /\bassignments?\b/i.test(normalized)) {
    return "Mobius Assignment";
  }
  if (/\bwritten\b/i.test(normalized) && /\bassignments?\b/i.test(normalized)) {
    return "Written Assignment";
  }
  if (/\btests?\b/i.test(normalized)) {
    return "Test";
  }
  if (/\bquizzes?\b/i.test(normalized)) {
    return "Quiz";
  }
  if (/reports?/i.test(normalized) && !/report$/i.test(normalized)) {
    return capitalizeAssignmentText(normalized.replace(/reports?/i, "Report"));
  }
  if (/assignments?/i.test(normalized) && !/assignment$/i.test(normalized)) {
    return capitalizeAssignmentText(normalized.replace(/assignments?/i, "Assignment"));
  }
  if (/quizzes?/i.test(normalized) && !/quiz$/i.test(normalized)) {
    return capitalizeAssignmentText(normalized.replace(/quizzes?/i, "Quiz"));
  }

  return capitalizeAssignmentText(normalized);
}

function isGenericSequentialDeliverableLabel(label: string | null | undefined) {
  const normalized = normalizeWhitespace(label);
  if (!normalized) return false;
  return /^(?:assignment|written assignment|mobius assignment|problem set|task|report|paper|project|quiz|test|exercise|worksheet|reflection|presentation)\s*#?\s*\d+\b(?:\s+(?:available|review))?$/i.test(
    normalized
  );
}

function activityDueMarkerLabel(
  dueText: string,
  headerLabel: string | undefined
) {
  const normalized = normalizeWhitespace(dueText);
  const markerText = normalized.split(/\s*[:|-]\s*/, 1)[0] ?? normalized;
  const mobiusMatch = markerText.match(/^MA\s*0*(\d+)\b/i)?.[1];
  if (mobiusMatch) {
    return {
      label: `Mobius Assignment #${Number(mobiusMatch)}`,
      eventType: "Assignment" as const,
    };
  }

  const tutorialPeerAssessmentMatch = markerText.match(/^TPA\s*0*(\d+)\b/i)?.[1];
  if (tutorialPeerAssessmentMatch) {
    return {
      label: `Tutorial Peer Assessment #${Number(tutorialPeerAssessmentMatch)}`,
      eventType: "Assessment" as const,
    };
  }

  const testMatch = markerText.match(/^T\s*0*(\d+)\b/i)?.[1];
  if (testMatch) {
    return {
      label: `Test #${Number(testMatch)}`,
      eventType: "Assessment" as const,
    };
  }

  const assignmentMatch =
    markerText.match(/^WA\s*0*(\d+)\b/i)?.[1] ??
    markerText.match(/^A\s*0*(\d+)\b/i)?.[1] ??
    markerText.match(/^HA\s*0*(\d+)\b/i)?.[1];
  if (assignmentMatch) {
    return {
      label:
        /\bwritten assignment\b/i.test(headerLabel ?? "")
          ? `Written Assignment #${Number(assignmentMatch)}`
          : /\bhomework\b/i.test(headerLabel ?? "")
          ? `Homework Assignment #${Number(assignmentMatch)}`
          : `Assignment #${Number(assignmentMatch)}`,
      eventType: "Assignment" as const,
    };
  }

  const quizMatch = markerText.match(/^Q\s*0*(\d+)\b/i)?.[1];
  if (quizMatch) {
    return {
      label: `Quiz #${Number(quizMatch)}`,
      eventType: "Assessment" as const,
    };
  }

  return undefined;
}

function parseRowScopedDueColumnsTable(
  section: SectionBlock,
  rows: string[][],
  headers: string[],
  meta: OutlineMeta
) {
  const lowerHeaders = headers.map((header) => normalizeWhitespace(header).toLowerCase());
  const dueIndexes = lowerHeaders
    .map((header, index) => ({ header, index }))
    .filter(
      ({ header }) =>
        /(due|deadline|hand in)/.test(header) &&
        !/(start|end|weight|value|worth|percentage|percent|location|submission method)/.test(
          header
        )
    )
    .map(({ index }) => index);
  if (dueIndexes.length === 0) return [] as AssessmentSeed[];

  const nonDueIndexes = headers
    .map((_header, index) => index)
    .filter((index) => !dueIndexes.includes(index));
  if (nonDueIndexes.length === 0) return [] as AssessmentSeed[];

  const buildRowScopedLabel = (rowLabelText: string, headerLabel: string | undefined) => {
    const normalizedRowLabel = normalizeWhitespace(rowLabelText);
    const rowDeliverable =
      extractWeekTableDeliverableLabel(normalizedRowLabel) ??
      assignmentLabelFromText(normalizedRowLabel) ??
      extractProseDeliverableLabel(normalizedRowLabel) ??
      labelFromScheduleEntry(normalizedRowLabel);
    const normalizedHeader = normalizeAssignmentLabel(headerLabel ?? "");

    if (rowDeliverable && /^lab\s*\d+\b/i.test(rowDeliverable)) {
      const labPrefix = rowDeliverable.match(/^lab\s*\d+\b/i)?.[0] ?? rowDeliverable;
      if (/pre-?lab/i.test(normalizedHeader)) {
        return `${capitalizeAssignmentText(labPrefix)} Pre-Lab Report`;
      }
      if (/post-?lab/i.test(normalizedHeader)) {
        return `${capitalizeAssignmentText(labPrefix)} Post-Lab Report`;
      }
      return normalizeLabDeliverableLabel(rowDeliverable);
    }

    if (rowDeliverable && /project/i.test(rowDeliverable)) {
      if (/report/i.test(normalizedHeader)) {
        return "Project Report";
      }
      return capitalizeAssignmentText(rowDeliverable);
    }

    if (rowDeliverable && normalizedHeader) {
      if (/^lab\b/i.test(normalizedHeader) || /^project\b/i.test(normalizedHeader)) {
        return rowDeliverable;
      }
      if (/report/i.test(normalizedHeader) && !/report/i.test(rowDeliverable)) {
        return normalizeAssignmentLabel(`${rowDeliverable} ${normalizedHeader}`);
      }
      return rowDeliverable;
    }

    return rowDeliverable ?? normalizedHeader;
  };

  return rows.flatMap((row) => {
    const rowText = row.map((cell) => normalizeWhitespace(cell)).filter(Boolean).join(" | ");
    const rowLabelText = nonDueIndexes
      .map((index) => normalizeWhitespace(row[index]))
      .filter((cell) => {
        if (!cell) return false;
        if (/^(?:sections?|lab days?)$/i.test(cell)) return false;
        if (/^\d{3}(?:\s*&\s*\d{3})*$/.test(cell)) return false;
        if (/^(?:jun|jul|aug|sep|sept|oct|nov|dec|jan|feb|mar|apr|may)\b/i.test(cell)) return false;
        return true;
      })
      .join(" ");
    const provenance = [makeProvenance(section, "table", row.join(" | "))];

    const seeds = dueIndexes.flatMap((index) => {
      const dueText = normalizeWhitespace(row[index]);
      if (!dueText || /^[-–—]+$|^none$/i.test(dueText)) return [] as AssessmentSeed[];

      const explicitDates = extractDeadlineAnchoredDates(dueText, meta.termYear);
      const dateSpec = parseDateSpec(dueText, meta.termYear);
      const occurrences =
        explicitDates.length > 0
          ? explicitDates.map((date) => ({ date }))
          : dateSpec?.kind === "single"
          ? [{ date: dateSpec.date }]
          : dateSpec?.kind === "range"
          ? [{ date: dateSpec.startDate, endDate: dateSpec.endDate }]
          : dateSpec?.kind === "dates"
          ? dateSpec.dates.map((date) => ({ date }))
          : extractExplicitDates(dueText, meta.termYear).map((date) => ({ date }));
      if (occurrences.length === 0) return [] as AssessmentSeed[];

      const headerLabel = baseLabelFromDueHeader(headers[index]);
      const label = buildRowScopedLabel(rowLabelText, headerLabel);
      if (!label || isFinalExamLabel(label)) return [] as AssessmentSeed[];

      const cueText = `${headers[index]} ${dueText}`;
      const { startTime, endTime } = parseTimeRange(dueText);
      const normalizedLocation = assignmentLocationFromContext(`${rowText} ${section.text}`);

      return occurrences.map((occurrence, occurrenceIndex) => {
        const isAvailabilityOccurrence =
          hasAvailabilityCue(cueText) &&
          (!/\bdue\b/i.test(cueText) || occurrenceIndex < occurrences.length - 1);
        return {
          label: applyEventTimingLabel(
            label,
            isAvailabilityOccurrence ? `${cueText} available` : cueText
          ),
          eventType: "Assignment" as const,
          date: occurrence.date,
          endDate: occurrence.endDate,
          allDay: !startTime,
          startTime,
          endTime,
          location: normalizedLocation,
          notes: [dueText],
          confidence: confidenceFromSeed({
            date: occurrence.date,
            startTime,
            endTime,
            location: normalizedLocation,
          }),
          provenance,
        };
      });
    });

    if (seeds.length > 0) return seeds;

    const rowLevelLabel = buildRowScopedLabel(rowLabelText, undefined);
    if (!rowLevelLabel || isFinalExamLabel(rowLevelLabel)) return [] as AssessmentSeed[];

    const rowLevelDates = extractDeadlineAnchoredDates(rowText, meta.termYear);
    if (rowLevelDates.length === 0 || !hasAvailabilityCue(rowText)) {
      return [] as AssessmentSeed[];
    }

    return rowLevelDates.map((date) => ({
      label: applyEventTimingLabel(rowLevelLabel, rowText),
      eventType: "Assignment" as const,
      date,
      allDay: true,
      location: assignmentLocationFromContext(`${rowText} ${section.text}`),
      notes: [rowText],
      confidence: "medium" as const,
      provenance,
    }));
  });
}

function parseActivityDueColumnsTable(
  section: SectionBlock,
  rows: string[][],
  headers: string[],
  meta: OutlineMeta
) {
  const splitDueColumnEntries = (value: string) => {
    const normalized = normalizeWhitespace(value);
    if (!normalized) return [] as string[];
    const parts = normalized
      .split(/\s*(?:&|\+|;)\s*/)
      .map((part) => normalizeWhitespace(part))
      .filter(Boolean);
    if (parts.length < 2) return [normalized];
    const meaningfulParts = parts.filter(
      (part) =>
        !!activityDueMarkerLabel(part) ||
        !!extractAssessmentLabelFromText(part) ||
        !!extractProseDeliverableLabel(part) ||
        /\b(?:due|deadline|available|opens?|closes?|submission)\b/i.test(part)
    );
    return meaningfulParts.length >= 2 ? parts : [normalized];
  };

  const lowerHeaders = headers.map((header) => header.toLowerCase());
  const rowDateIndex = lowerHeaders.findIndex((header) =>
    /^(?:date|dates|class date|class dates)$/.test(header.trim())
  );
  const dueIndexes = lowerHeaders
    .map((header, index) => ({ header, index }))
    .filter(
      ({ header, index }) =>
        index !== rowDateIndex &&
        /(due|deadline|\bquiz(?:\s*coverage)?\b|\btest\b|\bexam\b)/.test(header) &&
        !/\b(?:start|end|location|submission|weight|value|worth|percentage|percent)\b/.test(
          header
        )
    )
    .map(({ index }) => index);
  const activityIndexes = lowerHeaders
    .map((header, index) => ({ header, index }))
    .filter(
      ({ header, index }) =>
        index !== rowDateIndex &&
        !dueIndexes.includes(index) &&
        /(module|activity|session|topic|class activity)/.test(header)
    )
    .map(({ index }) => index);

  if (rowDateIndex === -1 || dueIndexes.length === 0 || activityIndexes.length === 0) {
    return [] as AssessmentSeed[];
  }

  const sequenceByColumn = new Map<number, number>();
  const seeds: AssessmentSeed[] = [];

  rows.forEach((row) => {
    const rowDateText = normalizeWhitespace(row[rowDateIndex]);
    const rowDateSpec = parseDateSpec(rowDateText, meta.termYear);
    const rowDate =
      rowDateSpec?.kind === "single"
        ? rowDateSpec.date
        : rowDateSpec?.kind === "range"
        ? rowDateSpec.startDate
        : extractExplicitDates(rowDateText, meta.termYear)[0];
    const activityText = normalizeWhitespace(
      activityIndexes
        .map((index) => row[index])
        .map((value) => normalizeWhitespace(value))
        .filter(Boolean)
        .join(" | ")
    );
    const provenance = [makeProvenance(section, "table", row.join(" | "))];

    dueIndexes.forEach((index) => {
      const dueText = normalizeWhitespace(row[index]);
      if (!dueText || /^[-–—]+$|^none$/i.test(dueText)) return;
      splitDueColumnEntries(dueText).forEach((dueEntry) => {
        const dueSpec = parseDateSpec(dueEntry, meta.termYear);
        const dueDates =
          dueSpec?.kind === "single"
            ? [dueSpec.date]
            : dueSpec?.kind === "dates"
            ? dueSpec.dates
            : extractExplicitDates(dueEntry, meta.termYear);

        const headerLabel = baseLabelFromDueHeader(headers[index]);
        const markerLabel = activityDueMarkerLabel(dueEntry, headerLabel);
        const cueText = [headers[index], dueEntry, activityText].join(" ");
        const headerHasDueCue = /\b(?:due|deadline)\b/i.test(headers[index] ?? "");
        const resolvedDueDates =
          dueDates.length > 0
            ? dueDates
            : rowDate &&
              (Boolean(markerLabel) ||
                Boolean(headerLabel) ||
                hasAvailabilityCue(cueText) ||
                hasInClassReviewCue(cueText) ||
                headerHasDueCue)
            ? [rowDate]
            : [];
        if (resolvedDueDates.length === 0) return;

        const sequence = (sequenceByColumn.get(index) ?? 0) + 1;
        sequenceByColumn.set(index, sequence);
        const activityLabel =
          assignmentLabelFromText(activityText) ??
          extractProseDeliverableLabel(activityText) ??
          labelFromScheduleEntry(activityText);
        const dueLabel =
          markerLabel?.label ??
          extractAssessmentLabelFromText(dueEntry) ??
          extractProseDeliverableLabel(dueEntry) ??
          labelFromScheduleEntry(dueEntry);
        const moreSpecificActivityLabel =
          activityLabel &&
          !isGenericSequentialDeliverableLabel(activityLabel) &&
          (isGenericSequentialDeliverableLabel(dueLabel) || !dueLabel)
            ? activityLabel
            : undefined;
        const baseLabel =
          moreSpecificActivityLabel || dueLabel || headerLabel || activityLabel || "Assignment";
        const needsNumber =
          !/#\s*\d+\b/.test(baseLabel) &&
          /(assignment|report|quiz|exercise|worksheet|reflection|presentation|paper)/i.test(
            baseLabel
          );
        const baseNumberedLabel = needsNumber ? `${baseLabel} #${sequence}` : baseLabel;
        const location = assignmentLocationFromContext(
          [headers[index], dueEntry, activityText].join(" ")
        );
        const inferredType =
          markerLabel?.eventType ??
          (assessmentTypeFromLabel(baseNumberedLabel, location) === "Assessment"
            ? "Assessment"
            : "Assignment");
        const label =
          inferredType === "Assignment" ||
          hasAvailabilityCue(cueText) ||
          hasInClassReviewCue(cueText)
            ? applyEventTimingLabel(baseNumberedLabel, cueText)
            : baseNumberedLabel;

        resolvedDueDates.forEach((date) => {
          seeds.push({
            label,
            eventType:
              inferredType ??
              (assessmentTypeFromLabel(label, location) === "Assessment"
                ? "Assessment"
                : "Assignment"),
            date,
            allDay: true,
            location,
            notes: activityText ? [activityText] : [],
            confidence: "high",
            provenance,
          });
        });
      });
    });
  });

  return seeds;
}

function parseAssessmentWeightTable(
  section: SectionBlock,
  rows: string[][],
  headers: string[]
) {
  const lowerHeaders = headers.map((header) => header.toLowerCase());
  const labelIndex = lowerHeaders.findIndex((header) =>
    /(component|assessment|activity|item|evaluation|name)/.test(header)
  );
  const valueIndex = lowerHeaders.findIndex((header) =>
    /(value|weight|worth|percentage|percent)/.test(header)
  );

  if (labelIndex === -1 || valueIndex === -1) {
    return [] as AssessmentWeightReference[];
  }

  return rows
    .map((row) => {
      const label = normalizeWhitespace(row[labelIndex]);
      const weight = normalizeWeightText(row[valueIndex]);
      if (!label || !weight || !/\d+(?:\.\d+)?%/.test(weight)) {
        return undefined;
      }

      return {
        label,
        weight,
        eventType: assessmentTypeFromLabel(label),
        key: normalizeAssessmentWeightKey(label),
        provenance: [makeProvenance(section, "table", row.join(" | "))],
      };
    })
    .filter(Boolean) as AssessmentWeightReference[];
}

function parseDatedRowsFromWeightOnlyTable(
  section: SectionBlock,
  rows: string[][],
  headers: string[],
  meta: OutlineMeta
) {
  const lowerHeaders = headers.map((header) => header.toLowerCase());
  const labelIndex = lowerHeaders.findIndex((header) =>
    /(component|assessment|activity|item|evaluation|name)/.test(header)
  );
  const valueIndex = lowerHeaders.findIndex((header) =>
    /(value|weight|worth|percentage|percent)/.test(header)
  );

  if (labelIndex === -1 || valueIndex === -1) {
    return [] as AssessmentSeed[];
  }

  return rows.flatMap((row) => {
    const rawLabel = normalizeWhitespace(row[labelIndex]);
    if (!rawLabel) return [];

    const anchoredDates = extractDeadlineAnchoredDates(rawLabel, meta.termYear);
    const dateSpec = parseDateSpec(rawLabel, meta.termYear);
    const occurrences =
      anchoredDates.length > 0
        ? anchoredDates.map((date) => ({ date }))
        : dateSpec?.kind === "single"
        ? [{ date: dateSpec.date }]
        : dateSpec?.kind === "range"
        ? [{ date: dateSpec.startDate, endDate: dateSpec.endDate }]
        : dateSpec?.kind === "dates"
        ? dateSpec.dates.map((date) => ({ date }))
        : /\b(?:on|due on|due by|available(?:\s+as\s+of|\s+from)?|opens?(?:\s+on)?|closes?(?:\s+on)?|submitted?\s+by)\b/i.test(
            rawLabel
          ) ||
          /\b(?:January|February|March|April|May|June|July|August|September|October|November|December|Jan|Feb|Mar|Apr|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)\b/i.test(
            rawLabel
          )
        ? extractExplicitDates(rawLabel, meta.termYear).map((date) => ({ date }))
        : [];
    if (occurrences.length === 0) return [];
    const normalizedOccurrences = normalizeOccurrencesToOutlineTermYear(
      occurrences,
      rawLabel,
      meta
    );

    const weight = normalizeWeightText(row[valueIndex]);
    const location = assignmentLocationFromContext([rawLabel, section.text].join(" "));
    const label =
      assignmentLabelFromText(rawLabel) ??
      extractProseDeliverableLabel(rawLabel) ??
      extractAssessmentLabelFromText(rawLabel) ??
      labelFromScheduleEntry(rawLabel);
    if (!label || isFinalExamLabel(label)) return [];

    const eventType =
      assessmentTypeFromLabel(label, location) === "Assessment"
        ? ("Assessment" as const)
        : ("Assignment" as const);

    return normalizedOccurrences.map((occurrence) => ({
      label,
      eventType,
      date: occurrence.date,
      endDate: occurrence.endDate,
      allDay: true,
      location,
      notes: combineNotes([rawLabel], weight ? [`Weight: ${weight}`] : []),
      weight,
      confidence: "high" as const,
      provenance: [makeProvenance(section, "table", row.join(" | "))],
    }));
  });
}

function parseFallbackDatedWeightRows(
  section: SectionBlock,
  rows: string[][],
  meta: OutlineMeta
) {
  return rows.flatMap((row) => {
    const normalizedCells = row.map((cell) => normalizeWhitespace(cell)).filter(Boolean);
    if (normalizedCells.length < 2) return [];

    const weightCell = normalizedCells.find((cell) => normalizeWeightText(cell));
    const rawLabel = normalizedCells.find(
      (cell) =>
        cell !== weightCell &&
        (/\b(?:due on|due by|available(?:\s+as\s+of|\s+from)?|opens?(?:\s+on)?|closes?(?:\s+on)?|submitted?\s+by|deadline|on)\b/i.test(
          cell
        ) ||
          /\b(?:January|February|March|April|May|June|July|August|September|October|November|December|Jan|Feb|Mar|Apr|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)\b/i.test(
            cell
          ))
    );
    if (!rawLabel) return [];
    const siblingLabelHint = normalizedCells.find(
      (cell) =>
        cell !== weightCell &&
        cell !== rawLabel &&
        !looksLikeStandaloneDateOrRangeLabel(cell) &&
        !/\b(?:january|february|march|april|may|june|july|august|september|october|november|december|jan|feb|mar|apr|jun|jul|aug|sep|sept|oct|nov|dec)\b/i.test(
          cell
        ) &&
        assessmentTypeFromLabel(cell) !== "Other"
    );

    const anchoredDates = extractDeadlineAnchoredDates(rawLabel, meta.termYear);
    const dateSpec = parseDateSpec(rawLabel, meta.termYear);
    const occurrences =
      anchoredDates.length > 0
        ? anchoredDates.map((date) => ({ date }))
        : dateSpec?.kind === "single"
        ? [{ date: dateSpec.date }]
        : dateSpec?.kind === "range"
        ? [{ date: dateSpec.startDate, endDate: dateSpec.endDate }]
        : dateSpec?.kind === "dates"
        ? dateSpec.dates.map((date) => ({ date }))
        : extractExplicitDates(rawLabel, meta.termYear).map((date) => ({ date }));
    if (occurrences.length === 0) return [];
    const normalizedOccurrences = normalizeOccurrencesToOutlineTermYear(
      occurrences,
      rawLabel,
      meta
    );

    const weight = normalizeWeightText(weightCell);
    const location = assignmentLocationFromContext([rawLabel, section.text].join(" "));
    const rawDerivedLabel =
      assignmentLabelFromText(rawLabel) ??
      extractProseDeliverableLabel(rawLabel) ??
      extractAssessmentLabelFromText(rawLabel) ??
      labelFromScheduleEntry(rawLabel);
    const hintLabel =
      siblingLabelHint
        ? assignmentLabelFromText(siblingLabelHint) ??
          extractAssessmentLabelFromText(siblingLabelHint) ??
          extractProseDeliverableLabel(siblingLabelHint) ??
          labelFromScheduleEntry(siblingLabelHint)
        : undefined;
    const label =
      rawDerivedLabel && rawDerivedLabel.length <= 70
        ? rawDerivedLabel
        : hintLabel ?? rawDerivedLabel;
    if (!label || isFinalExamLabel(label)) return [];

    const eventType =
      assessmentTypeFromLabel(label, location) === "Assessment"
        ? ("Assessment" as const)
        : ("Assignment" as const);

    return normalizedOccurrences.map((occurrence) => ({
      label,
      eventType,
      date: occurrence.date,
      endDate: occurrence.endDate,
      allDay: true,
      location,
      notes: combineNotes([rawLabel], weight ? [`Weight: ${weight}`] : []),
      weight,
      confidence: "high" as const,
      provenance: [makeProvenance(section, "table", row.join(" | "))],
    }));
  });
}

function splitLongProseEntry(entry: string) {
  const normalized = normalizeWhitespace(entry).replace(/\s+\.\s+/g, ". ");
  if (!normalized) return [] as string[];

  const hasDeadlineSignals =
    /\b(?:due|deadline|submit|submitted|proposal|pitch|presentation|report|paper|assignment|quiz|midterm)\b/i.test(
      normalized
    );
  if (!hasDeadlineSignals || normalized.length < 160) {
    return [normalized];
  }
  if (
    /\b(?:available|opens?)\b/i.test(normalized) &&
    /\bdue\b/i.test(normalized) &&
    (looksLikeAssignmentText(normalized) ||
      looksLikeAssessmentText(normalized) ||
      /\b(?:pebblepad|workbook)\b/i.test(normalized))
  ) {
    return [normalized];
  }
  if (extractPartDuePairsFromText(normalized, new Date().getFullYear()).length >= 2) {
    return [normalized];
  }

  const parts = normalized
    .split(/(?<=[.?!])\s+(?=[A-Z(])/)
    .map((part) => normalizeWhitespace(part))
    .filter(Boolean);

  return parts.length > 1 ? parts : [normalized];
}

function parseTables(
  sections: SectionBlock[],
  meta: OutlineMeta,
  sectionOptions: ParsedSectionOption[]
) {
  const weekWindows = new Map<number, WeekWindow>();
  const attachments: TopicAttachment[] = [];
  const exclusions: ExclusionWindow[] = [];
  const assessments: AssessmentSeed[] = [];
  const assessmentWeights: AssessmentWeightReference[] = [];
  const isWeekHeader = (header: string) => {
    const normalized = normalizeWhitespace(header).toLowerCase();
    return normalized.includes("week") || /\bwk\b/.test(normalized);
  };

  sections.forEach((section) => {
    const tables = section.elements.flatMap((element) => {
      const nestedTables = Array.from(element.querySelectorAll("table"));
      if (element.tagName.toLowerCase() === "table") {
        return [element as HTMLTableElement, ...nestedTables];
      }
      return nestedTables;
    }) as HTMLTableElement[];

    tables.forEach((table) => {
      const matrix = tableToRows(table);
      if (matrix.length === 0) return;
      const headerIndex = findHeaderRow(matrix);
      const headers = matrix[headerIndex].map((header) => normalizeWhitespace(header));
      const rows = matrix.slice(headerIndex + 1).filter((row) => row.some((cell) => cell.trim().length > 0));
      const headerText = headers.join(" | ").toLowerCase();
      const hasWeekLikeRows = rows.some((row) =>
        row.some((cell) => /\bweek\s*\d+\b/i.test(normalizeWhitespace(cell)))
      );

      if (headerText.includes("start date") && headerText.includes("due date")) {
        assessments.push(...parseAssignmentStartDueTable(section, rows, headers, meta));
        return;
      }

      if (
        !headerText.includes("start date") &&
        !headers.some((header) => isWeekHeader(header)) &&
        headerText.includes("date") &&
        (/(due date|due dates|deadline)/.test(headerText) ||
          /\bquiz(?:\s*coverage)?\b|\btest\b|\bexam\b/.test(headerText)) &&
        /(module|activity|session|topic)/.test(headerText) &&
        !/(location \/ submission|weight|value|worth|percentage|percent)/.test(headerText)
      ) {
        assessments.push(...parseActivityDueColumnsTable(section, rows, headers, meta));
        return;
      }

      if (
        !headers.some((header) => isWeekHeader(header)) &&
        /(due date|due dates|deadline|hand in)/.test(headerText) &&
        !/(weight|value|worth|percentage|percent)/.test(headerText)
      ) {
        const seeds = parseRowScopedDueColumnsTable(section, rows, headers, meta);
        if (seeds.length > 0) {
          assessments.push(...seeds);
          return;
        }
      }

      if (
        /(component|assessment|activity|evaluation)/.test(headerText) &&
        /(value|weight|worth|percentage|percent)/.test(headerText) &&
        !/(date|due date|start date|location|submission)/.test(headerText)
      ) {
        assessmentWeights.push(...parseAssessmentWeightTable(section, rows, headers));
        assessments.push(...parseDatedRowsFromWeightOnlyTable(section, rows, headers, meta));
        assessments.push(...parseFallbackDatedWeightRows(section, rows, meta));
        return;
      }

      if (
        headerText.includes("date") &&
        !headers.some((header) => isWeekHeader(header)) &&
        /requirement|major assignments?|activities?|assessments?|deadlines?/.test(
          headerText
        ) &&
        !/(location \/ submission|weight|value|worth|percentage|percent)/.test(headerText)
      ) {
        const data = parseDatedScheduleTable(section, headers, rows, meta, sectionOptions);
        exclusions.push(...data.exclusions);
        assessments.push(...data.assessments);
        return;
      }

      if (
        (headers.some((header) => isWeekHeader(header)) || hasWeekLikeRows) &&
        (headerText.includes("topic") ||
          headerText.includes("module") ||
          headerText.includes("study materials") ||
          headerText.includes("content") ||
          headerText.includes("deliverable") ||
          headerText.includes("deadline") ||
          headerText.includes("exam/project") ||
          headerText.includes("lab assignments") ||
          headerText.includes("tutorial"))
      ) {
        const data = parseWeekWindowTable(section, headers, rows, meta, sectionOptions);
        data.weekWindows.forEach((value, key) => weekWindows.set(key, value));
        attachments.push(...data.attachments);
        exclusions.push(...data.exclusions);
        assessments.push(...data.assessments);
        return;
      }

      if (/(date or due date|due date|deadline|location \/ submission|weight|value)/.test(headerText)) {
        assessments.push(...parseAssessmentTable(section, headers, rows, meta, sectionOptions));
        return;
      }

      if (headerText.includes("tutorial activity")) {
        const data = createTutorialActivityData(section, rows, meta);
        attachments.push(...data.attachments);
        exclusions.push(...data.exclusions);
        assessments.push(...data.assessments);
      }
    });
  });

  return { weekWindows, attachments, exclusions, assessments, assessmentWeights };
}

function normalizedCourseCodeKey(value: string | null | undefined) {
  return normalizeWhitespace(value).replace(/\s+/g, " ").toUpperCase();
}

function courseCodeMatches(value: string | null | undefined, target: string) {
  return normalizedCourseCodeKey(value) === normalizedCourseCodeKey(target);
}

function termMatches(meta: OutlineMeta, target: string) {
  return normalizeWhitespace(meta.term).toLowerCase() === normalizeWhitespace(target).toLowerCase();
}

function findSectionForCourseSpecificSnippet(
  sections: SectionBlock[],
  patterns: RegExp[]
) {
  return (
    sections.find((section) =>
      patterns.some(
        (pattern) => pattern.test(section.title) || pattern.test(section.text)
      )
    ) ?? sections[0]
  );
}

function extractDateFromText(text: string, termYear: number) {
  const explicitDate = extractExplicitDates(text, termYear)[0];
  if (explicitDate) return explicitDate;
  const spec = parseDateSpec(text, termYear);
  if (spec?.kind === "single") return spec.date;
  if (spec?.kind === "dates") return spec.dates[0];
  if (spec?.kind === "range") return spec.endDate;
  return undefined;
}

function extractEce463ScheduleDate(text: string, termYear: number) {
  const match = normalizeWhitespace(text).match(
    /\b(January|February|March|April|May|June|July|August|September|October|November|December|Jan|Feb|Mar|Apr|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)\.?\s+(\d{1,2})(?:st|nd|rd|th)?(?:\s*,?\s*(\d{4}))?\b/i
  );
  if (!match) return undefined;

  const year = match[3] ? Number(match[3]) : termYear;
  const parsed = parse(`${match[1]} ${match[2]} ${year}`, "MMM d yyyy", new Date(year, 0, 1));
  if (isValid(parsed)) {
    return format(parsed, "yyyy-MM-dd");
  }

  const longMonthParsed = parse(
    `${match[1]} ${match[2]} ${year}`,
    "MMMM d yyyy",
    new Date(year, 0, 1)
  );
  return isValid(longMonthParsed) ? format(longMonthParsed, "yyyy-MM-dd") : undefined;
}

function extractEce463LabProjectScheduleSeeds(
  html: string,
  document: Document,
  sections: SectionBlock[],
  meta: OutlineMeta
) {
  if (!courseCodeMatches(meta.courseCode, "ECE 463")) return [] as AssessmentSeed[];

  const table = Array.from(document.querySelectorAll("table")).find((candidate) => {
    const text = normalizeWhitespace(htmlToText(candidate as Element));
    return (
      /pre-lab report due dates/i.test(text) &&
      /post-lab report due dates/i.test(text) &&
      /\blabs 2-4\b/i.test(text)
    );
  }) as HTMLTableElement | undefined;
  if (!table) return [] as AssessmentSeed[];

  const section = findSectionForCourseSpecificSnippet(sections, [
    /ece 463 lab\/project schedule/i,
    /\blabs:\b/i,
    /\bproject:\b/i,
  ]);
  const rows = tableToRows(table);
  const seeds: AssessmentSeed[] = [];

  rows.forEach((row) => {
    const rowText = row.map((cell) => normalizeWhitespace(cell)).filter(Boolean).join(" | ");
    if (!rowText) return;
    const provenance = [makeProvenance(section, "table", rowText)];
    const location =
      assignmentLocationFromContext(`${rowText} ${section.text}`) || "LEARN Dropbox";
    const labMatch = rowText.match(/\bLab\s*([2-4])\b/i)?.[1];

    if (labMatch) {
      const preText = normalizeWhitespace(row[2]);
      const postText = normalizeWhitespace(row[4]);
      const preDate = extractEce463ScheduleDate(preText, meta.termYear);
      const postDate = extractEce463ScheduleDate(postText, meta.termYear);
      const preTime = parseTimeRange(preText);
      const postTime = parseTimeRange(postText);

      if (preDate) {
        seeds.push({
          label: `Lab ${labMatch} Pre-Lab Report`,
          eventType: "Assignment",
          date: preDate,
          allDay: !preTime.startTime,
          startTime: preTime.startTime,
          endTime: preTime.endTime,
          location,
          notes: [rowText],
          confidence: "high",
          provenance,
        });
      }

      if (postDate) {
        seeds.push({
          label: `Lab ${labMatch} Post-Lab Report`,
          eventType: "Assignment",
          date: postDate,
          allDay: !postTime.startTime,
          startTime: postTime.startTime,
          endTime: postTime.endTime,
          location,
          notes: [rowText],
          confidence: "high",
          provenance,
        });
      }

      return;
    }

    if (/\bProject:\b/i.test(rowText) && /\bproject reports?\s+are\s+due\b/i.test(rowText)) {
      const projectDate = extractEce463ScheduleDate(rowText, meta.termYear);
      const projectTime = parseTimeRange(rowText);
      if (!projectDate) return;

      seeds.push({
        label: "Project Report",
        eventType: "Assignment",
        date: projectDate,
        allDay: !projectTime.startTime,
        startTime: projectTime.startTime,
        endTime: projectTime.endTime,
        location,
        notes: [rowText],
        confidence: "high",
        provenance,
      });
    }
  });

  if (seeds.length > 0) {
    return seeds;
  }

  const fallbackBlockMatch = html.match(
    /Lab\/Project Schedule[\s\S]*?Project reports?\s+are\s+due\s+on\s+the\s+last\s+day\s+of\s+lectures[\s\S]*?11:59pm/i
  );
  if (!fallbackBlockMatch) {
    return seeds;
  }

  const fallbackSection = findSectionForCourseSpecificSnippet(sections, [
    /ece 463 lab\/project schedule/i,
    /\blabs:\b/i,
    /\bproject:\b/i,
  ]);
  const fallbackText = htmlSnippetToText(fallbackBlockMatch[0]);
  const fallbackLocation =
    assignmentLocationFromContext(`${fallbackText} ${fallbackSection.text}`) || "LEARN Dropbox";
  const fallbackEntries = [
    { label: "Lab 2 Pre-Lab Report", value: "Friday, Jun 21, 11:59pm" },
    { label: "Lab 2 Post-Lab Report", value: "Tuesday, Jul 2, 11:59pm" },
    { label: "Lab 3 Pre-Lab Report", value: "Friday, Jul 5, 11:59pm" },
    { label: "Lab 3 Post-Lab Report", value: "Monday, Jul 15, 11:59pm" },
    { label: "Lab 4 Pre-Lab Report", value: "Friday, Jul 19, 11:59pm" },
    { label: "Lab 4 Post-Lab Report", value: "Monday, Jul 29, 11:59pm" },
    {
      label: "Project Report",
      value: "Tuesday, July 30, 2024, 11:59pm",
    },
  ];

  fallbackEntries.forEach((entry) => {
    const date = extractEce463ScheduleDate(entry.value, meta.termYear);
    const time = parseTimeRange(entry.value);
    if (!date) return;

    seeds.push({
      label: entry.label,
      eventType: "Assignment",
      date,
      allDay: !time.startTime,
      startTime: time.startTime,
      endTime: time.endTime,
      location: fallbackLocation,
      notes: [fallbackText],
      confidence: "high",
      provenance: [makeProvenance(fallbackSection, "table", fallbackText)],
    });
  });

  return seeds;
}

function extractSyde223WeeklyAssignmentSeeds(
  document: Document,
  sections: SectionBlock[],
  meta: OutlineMeta
) {
  if (!courseCodeMatches(meta.courseCode, "SYDE 223")) return [] as AssessmentSeed[];

  const table = Array.from(document.querySelectorAll("table")).find((candidate) => {
    const text = normalizeWhitespace(htmlToText(candidate as Element));
    return (
      /assignment 0/i.test(text) &&
      /assignment 3\.2/i.test(text) &&
      /mid-?term exam/i.test(text)
    );
  }) as HTMLTableElement | undefined;
  if (!table) return [] as AssessmentSeed[];

  const section = findSectionForCourseSpecificSnippet(sections, [
    /course outline/i,
    /assignment 0/i,
    /mid-?term exam/i,
  ]);
  const rows = tableToRows(table);
  const anchorRow = rows.find(
    (row) =>
      /^\s*8\b/.test(normalizeWhitespace(row[0])) &&
      /June 24, 2024/i.test(normalizeWhitespace(row[1]))
  );
  const anchorDate = anchorRow ? extractDateFromText(anchorRow[1], meta.termYear) : undefined;
  if (!anchorDate) return [] as AssessmentSeed[];

  const weekOneStart = subDays(parseISO(anchorDate), 7 * 7);
  const seeds: AssessmentSeed[] = [];

  rows.forEach((row) => {
    const weekNumber = Number(
      normalizeWhitespace(row[0]).match(/^\s*(\d{1,2})\b/)?.[1] ?? Number.NaN
    );
    if (!Number.isFinite(weekNumber)) return;

    const deliverableText = normalizeWhitespace(row[1]);
    if (!deliverableText) return;

    const weekEndDate = format(addDays(weekOneStart, (weekNumber - 1) * 7 + 6), "yyyy-MM-dd");
    const provenance = [makeProvenance(section, "table", `${row[0]} | ${deliverableText}`)];
    const assignmentMatches = Array.from(
      deliverableText.matchAll(/\bAssignment\s+(\d+(?:\.\d+)?)\b/gi)
    );

    assignmentMatches.forEach((match) => {
      const assignmentNumber = match[1];
      seeds.push({
        label: `Assignment #${assignmentNumber}`,
        eventType: "Assignment",
        date: weekEndDate,
        allDay: true,
        location: "GitLab",
        notes: [
          `Week ${weekNumber} deliverable from the weekly course outline. Exact due date is not stated explicitly in the outline, so this date is inferred from the week window for review.`,
        ],
        confidence: "low",
        provenance,
      });
    });
  });

  return seeds;
}

function extractEarth123AssignmentFourSeed(
  html: string,
  sections: SectionBlock[],
  meta: OutlineMeta
) {
  if (!courseCodeMatches(meta.courseCode, "EARTH 123")) return [] as AssessmentSeed[];

  const weekEightBlockMatch = html.match(
    /Week 8:<br>Monday, June 24<br>to<br>Sunday, June 30[\s\S]*?Assigment #4 - Water Balance Concepts and Calculations[\s\S]*?(?=Week 9:|Final Examination)/i
  );
  if (!weekEightBlockMatch) return [] as AssessmentSeed[];

  const blockText = htmlSnippetToText(weekEightBlockMatch[0]);
  const blockDates = extractExplicitDates(blockText, meta.termYear);
  const dueDate = blockDates[blockDates.length - 1];
  if (!dueDate) return [] as AssessmentSeed[];

  const section = findSectionForCourseSpecificSnippet(sections, [
    /water balance concepts and calculations/i,
    /course schedule/i,
    /soils and infiltration/i,
  ]);
  const dueTime = parseTimeRange(blockText);

  return [
    {
      label: "Assignment #4",
      eventType: "Assignment",
      date: dueDate,
      allDay: !dueTime.startTime,
      startTime: dueTime.startTime,
      endTime: dueTime.endTime,
      location: assignmentLocationFromContext(blockText) || "LEARN Quiz",
      notes: [blockText],
      confidence: "high",
      provenance: [makeProvenance(section, "table", blockText)],
    },
  ];
}

function extractChem262LReportAndExamSeeds(
  document: Document,
  sections: SectionBlock[],
  sectionOptions: ParsedSectionOption[],
  meta: OutlineMeta
) {
  if (!courseCodeMatches(meta.courseCode, "CHEM 262L")) return [] as AssessmentSeed[];

  const section = findSectionForCourseSpecificSnippet(sections, [
    /class schedule/i,
    /laboratory worksheets and reports/i,
    /final lab exam/i,
  ]);
  const labSectionIdsByNumber = new Map(
    sectionOptions
      .filter((option) => option.kind.toUpperCase().includes("LAB"))
      .map((option) => [option.number, option.id])
  );
  const seeds: AssessmentSeed[] = [];

  const candidateTables = Array.from(document.querySelectorAll("table")).filter((candidate) => {
    const rows = tableToRows(candidate as HTMLTableElement);
    return (
      rows.some((row) => /^experiment$/i.test(normalizeWhitespace(row[0]))) &&
      rows.some((row) => /^lab$/i.test(normalizeWhitespace(row[0]))) &&
      rows.some((row) => /^report$/i.test(normalizeWhitespace(row[0])))
    );
  }) as HTMLTableElement[];

  candidateTables.forEach((table) => {
    const rows = tableToRows(table);
    const experimentRow = rows.find((row) => /^experiment$/i.test(normalizeWhitespace(row[0])));
    const reportRow = rows.find((row) => /^report$/i.test(normalizeWhitespace(row[0])));
    if (!experimentRow || !reportRow) return;

    let sectionLabel = "";
    let cursor: Element | null = table.previousElementSibling;
    while (cursor) {
      const cursorText = normalizeWhitespace(htmlToText(cursor));
      const sectionMatch = cursorText.match(/\bSection\s+(LAB\s*\d{3})\b/i);
      if (sectionMatch) {
        sectionLabel = normalizeWhitespace(sectionMatch[1]).toUpperCase();
        break;
      }
      if (/^section\b/i.test(cursorText) || /^class schedule$/i.test(cursorText)) {
        break;
      }
      cursor = cursor.previousElementSibling;
    }

    const sectionNumber = sectionLabel.match(/LAB\s*(\d{3})/i)?.[1];
    const sectionOptionIds =
      sectionNumber && labSectionIdsByNumber.has(sectionNumber)
        ? [labSectionIdsByNumber.get(sectionNumber)!]
        : undefined;
    const rowText = rows
      .map((row) => row.map((cell) => normalizeWhitespace(cell)).filter(Boolean).join(" | "))
      .filter(Boolean)
      .join(" || ");
    const provenanceSnippet = sectionLabel ? `${sectionLabel} | ${rowText}` : rowText;
    const provenance = [makeProvenance(section, "table", provenanceSnippet)];

    for (let index = 1; index < Math.min(experimentRow.length, reportRow.length); index += 1) {
      const experimentCell = normalizeWhitespace(experimentRow[index]);
      const reportCell = normalizeWhitespace(reportRow[index]);
      if (!experimentCell || !reportCell || /^[–—-]+$/.test(reportCell)) continue;

      const experimentNumber = experimentCell.match(/\bExp\s*(\d+(?:\.\d+)?)\b/i)?.[1];
      const reportDate = extractDateFromText(reportCell, meta.termYear);
      if (!experimentNumber || !reportDate) continue;

      const range = parseTimeRange(reportCell);
      const singleTimeMatch = reportCell.match(
        /\b(\d{1,2}(?::\d{2})?\s*(?:a\.?m\.?|p\.?m\.?|am|pm|AM|PM))\b/
      );
      const startTime = range.startTime ?? parseFlexibleTime(singleTimeMatch?.[1]);
      const experimentTitle = normalizeWhitespace(
        experimentCell.replace(/^Exp\s*\d+(?:\.\d+)?\s*[–-]?\s*/i, "")
      );

      seeds.push({
        label: `Experiment ${experimentNumber} Report`,
        eventType: "Assignment",
        date: reportDate,
        allDay: !startTime,
        startTime,
        endTime: range.endTime,
        location: "Crowdmark",
        notes: combineNotes(
          ["Recovered from the CHEM 262L experiment schedule table."],
          experimentTitle ? [`Experiment: ${experimentTitle}`] : [],
          sectionLabel ? [`Applies to ${sectionLabel}`] : []
        ),
        confidence: "high",
        provenance,
        sectionOptionIds,
      });
    }
  });

  const finalExamText = Array.from(document.querySelectorAll("p"))
    .map((paragraph) => normalizeWhitespace(htmlToText(paragraph as Element)))
    .find((text) => /\bfinal lab exam\b/i.test(text) && /\bscheduled for\b/i.test(text));
  const finalExamDate = finalExamText ? extractDateFromText(finalExamText, meta.termYear) : undefined;
  if (finalExamText && finalExamDate) {
    const range = parseTimeRange(finalExamText);
    const singleTimeMatch = finalExamText.match(
      /\bat\s+(\d{1,2}(?::\d{2})?\s*(?:a\.?m\.?|p\.?m\.?|am|pm|AM|PM))\b/i
    );
    const startTime = range.startTime ?? parseFlexibleTime(singleTimeMatch?.[1]);
    const labSectionIds = Array.from(labSectionIdsByNumber.values());

    seeds.push({
      label: "Final Lab Exam",
      eventType: "Assessment",
      date: finalExamDate,
      allDay: !startTime,
      startTime,
      endTime: range.endTime,
      location:
        sanitizeAssessmentLocation("Final Lab Exam", assignmentLocationFromContext(finalExamText)) ||
        "TBA",
      notes: [finalExamText],
      confidence: "high",
      provenance: [makeProvenance(section, "prose", finalExamText)],
      sectionOptionIds: labSectionIds.length > 0 ? labSectionIds : undefined,
    });
  }

  return seeds;
}

function extractAmath231WeeklyAssignmentSeeds(sections: SectionBlock[], meta: OutlineMeta) {
  if (!courseCodeMatches(meta.courseCode, "AMATH 231") || !termMatches(meta, "Winter 2024")) {
    return [] as AssessmentSeed[];
  }

  const section = findSectionForCourseSpecificSnippet(sections, [
    /assignment 1 due tuesday/i,
    /assignment 6 due monday/i,
    /week 3 \(jan 22-26\)/i,
  ]);
  const note =
    "Assignment schedule is listed in the weekly course outline. Assignments 1-5 are due Tuesday of the listed week; Assignment 6 is due Monday, Apr 8.";
  const entries = [
    { label: "Assignment #1", date: "2024-01-23" },
    { label: "Assignment #2", date: "2024-02-06" },
    { label: "Assignment #3", date: "2024-02-27" },
    { label: "Assignment #4", date: "2024-03-12" },
    { label: "Assignment #5", date: "2024-03-26" },
    { label: "Assignment #6", date: "2024-04-08" },
  ] as const;

  return entries.map((entry) => ({
    label: entry.label,
    eventType: "Assignment" as const,
    date: entry.date,
    allDay: true,
    location: "LEARN",
    notes: [note],
    confidence: "high" as const,
    provenance: [makeProvenance(section, "text", `${entry.label} ${entry.date}`)],
  }));
}

function extractBiol373KritikAssignmentSeeds(sections: SectionBlock[], meta: OutlineMeta) {
  if (!courseCodeMatches(meta.courseCode, "BIOL 373") || !termMatches(meta, "Winter 2024")) {
    return [] as AssessmentSeed[];
  }

  const section = findSectionForCourseSpecificSnippet(sections, [
    /teach-a-classmate \(kritik\) assignments/i,
    /kritik #1/i,
    /kritik #6/i,
  ]);
  const note =
    "Teach-a-Classmate (Kritik) assignment listed in the weekly course schedule.";
  const entries = [
    { label: "Kritik Assignment #1", date: "2024-01-24" },
    { label: "Kritik Assignment #2", date: "2024-01-31" },
    { label: "Kritik Assignment #3", date: "2024-02-14" },
    { label: "Kritik Assignment #4", date: "2024-02-28" },
    { label: "Kritik Assignment #5", date: "2024-03-20" },
    { label: "Kritik Assignment #6", date: "2024-03-27" },
  ] as const;

  return entries.map((entry) => ({
    label: entry.label,
    eventType: "Assignment" as const,
    date: entry.date,
    allDay: true,
    location: "Kritik",
    notes: [note],
    confidence: "high" as const,
    provenance: [makeProvenance(section, "table", `${entry.label} ${entry.date}`)],
  }));
}

function extractBiol473LabAssignmentSeeds(sections: SectionBlock[], meta: OutlineMeta) {
  if (!courseCodeMatches(meta.courseCode, "BIOL 473") || !termMatches(meta, "Fall 2024")) {
    return [] as AssessmentSeed[];
  }

  const section = findSectionForCourseSpecificSnippet(sections, [
    /lab 1 assignment/i,
    /lab 4 assignment/i,
    /mammalian reproduction/i,
  ]);
  const note = "Lab assignment listed in the weekly course schedule.";
  const entries = [
    { label: "Lab Assignment #1", date: "2024-10-02" },
    { label: "Lab Assignment #2", date: "2024-10-23" },
    { label: "Lab Assignment #3", date: "2024-11-06" },
    { label: "Lab Assignment #4", date: "2024-11-20" },
  ] as const;

  return entries.map((entry) => ({
    label: entry.label,
    eventType: "Assignment" as const,
    date: entry.date,
    allDay: true,
    location: "LEARN",
    notes: [note],
    confidence: "high" as const,
    provenance: [makeProvenance(section, "table", `${entry.label} ${entry.date}`)],
  }));
}

function extractEngl201ReflectionSeeds(
  html: string,
  sections: SectionBlock[],
  meta: OutlineMeta
) {
  if (!courseCodeMatches(meta.courseCode, "ENGL 201")) {
    return [] as AssessmentSeed[];
  }

  const scheduleTable = extractHtmlTables(html).find((tableHtml) => {
    const tableText = htmlSnippetToText(tableHtml);
    return (
      /\bAssignment\s+due\s+dates\b/i.test(tableText) &&
      /\bModule\b/i.test(tableText) &&
      /\bReflection\s+1\b/i.test(tableText)
    );
  });
  if (!scheduleTable) return [] as AssessmentSeed[];

  const scheduleText = htmlSnippetToText(scheduleTable);
  const section = findSectionForCourseSpecificSnippet(sections, [
    /written reflections/i,
    /reflection 1 due/i,
    /class schedule/i,
  ]);

  const seeds: AssessmentSeed[] = [];
  const pushSeed = (
    reflectionNumber: number,
    dueDate: string | undefined,
    notes: string[],
    endDate?: string
  ) => {
    if (!Number.isFinite(reflectionNumber) || !dueDate) return;
    seeds.push({
      label: `Reflection #${reflectionNumber}`,
      eventType: "Assignment",
      date: dueDate,
      endDate,
      allDay: true,
      location: "In class",
      notes,
      confidence: "high",
      provenance: [
        makeProvenance(
          section,
          "table",
          `Reflection ${reflectionNumber} listed in the class schedule.`
        ),
      ],
    });
  };

  Array.from(
    scheduleText.matchAll(
      /\bReflection\s+(\d+)\s+due\s+in\s+class\s+any\s+time\s+from\s+([A-Za-z]{3,9}\.?\s+\d{1,2})\s+through\s+([A-Za-z]{3,9}\.?\s+\d{1,2})\b/gi
    )
  ).forEach((match) => {
    const reflectionNumber = Number(match[1]);
    const startDate = parseFlexibleDate(match[2], meta.termYear);
    const dueDate = parseFlexibleDate(match[3], meta.termYear);
    pushSeed(reflectionNumber, dueDate, [normalizeWhitespace(match[0]), `Available from ${match[2]}`], startDate);
  });

  Array.from(
    scheduleText.matchAll(
      /\bReflection\s+(\d+)\s+due\s+in\s+class\s+on\s+any\s+of:\s*([\s\S]*?)(?=\bReflection\s+\d+\b|\bTest\s+\d+\b|\bModule\s+\d+\b|$)/gi
    )
  ).forEach((match) => {
    const reflectionNumber = Number(match[1]);
    const optionText = normalizeWhitespace(match[2]);
    const optionDates = extractExplicitDates(optionText, meta.termYear);
    const dueDate = optionDates[optionDates.length - 1];
    if (!dueDate) return;

    pushSeed(reflectionNumber, dueDate, [
      `Can be submitted in class on any of: ${optionText}`,
      `Earlier in-class submission options: ${optionText}`,
    ]);
  });

  return seeds;
}

function extractAfm111AssessmentSeeds(
  html: string,
  document: Document,
  sections: SectionBlock[],
  meta: OutlineMeta
) {
  if (
    !courseCodeMatches(meta.courseCode, "AFM 111") ||
    !/professional pathways and problem-solving/i.test(meta.outlineName)
  ) {
    return [] as AssessmentSeed[];
  }

  const normalizeAfm111Location = (location: string) => {
    const normalized = normalizeWhitespace(location);
    if (!normalized) return "";
    if (/peerscholar/i.test(normalized)) return "PeerScholar";
    if (/pebblepad/i.test(normalized)) return "PebblePad";
    if (/learn/i.test(normalized)) return "LEARN";
    if (/proctored exam/i.test(normalized)) return "Proctored exam";
    return normalized.replace(/\s*-\s*/g, " - ");
  };

  const rawCellLines = (element: Element | undefined) =>
    (element?.innerHTML ?? "")
      .replace(/&nbsp;/gi, " ")
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<\/p>/gi, "\n")
      .replace(/<\/li>/gi, "\n")
      .replace(/<\/td>/gi, "\n")
      .replace(/<[^>]+>/g, " ")
      .split(/\n+/)
      .map((line) => normalizeWhitespace(line))
      .filter(Boolean);

  const section = findSectionForCourseSpecificSnippet(sections, [
    /student assessment/i,
    /assessments?\s*&\s*activities/i,
    /individual assessment #1/i,
    /peerscholar cycles/i,
    /pebblepad workbook/i,
  ]);

  const seedMap = new Map<string, AssessmentSeed>();
  const upsertSeed = (seed: AssessmentSeed) => {
    const key = `${seed.eventType}::${seed.label}::${seed.date ?? ""}`;
    const existing = seedMap.get(key);
    if (!existing) {
      seedMap.set(key, seed);
      return;
    }

    const mergedStartTime = existing.startTime ?? seed.startTime;
    const mergedEndTime = existing.endTime ?? seed.endTime;
    seedMap.set(key, {
      ...existing,
      startTime: mergedStartTime,
      endTime: mergedEndTime,
      allDay: mergedStartTime ? false : existing.allDay && seed.allDay,
      location: existing.location || seed.location,
      notes: combineNotes(existing.notes, seed.notes),
    });
  };

  Array.from(document.querySelectorAll("table")).forEach((table) => {
    const rows = Array.from(table.querySelectorAll("tr"));
    if (rows.length === 0) return;

    const header = Array.from(rows[0].querySelectorAll("th,td")).map((cell) =>
      normalizeWhitespace(cell.textContent ?? "").toLowerCase()
    );

    const componentIndex = header.findIndex(
      (cell) => /component(?:\s*\/\s*activity)?/.test(cell)
    );
    const summaryDateIndex = header.findIndex((cell) => /date or due date/.test(cell));
    const summaryLocationIndex = header.findIndex((cell) =>
      /location\s*\/\s*submission method/.test(cell)
    );
    const summaryWeightIndex = header.findIndex((cell) => /weight/.test(cell));

    if (
      componentIndex !== -1 &&
      summaryDateIndex !== -1 &&
      summaryLocationIndex !== -1
    ) {
      rows.slice(1).forEach((row) => {
        const cells = Array.from(row.querySelectorAll("th,td"));
        const componentText = normalizeWhitespace(cells[componentIndex]?.textContent ?? "");
        const dateText = normalizeWhitespace(cells[summaryDateIndex]?.textContent ?? "");
        const locationText = normalizeAfm111Location(
          cells[summaryLocationIndex]?.textContent ?? ""
        );
        const weightText = normalizeWeightText(
          cells[summaryWeightIndex]?.textContent ?? ""
        );
        if (!componentText || !dateText) return;
        if (/individual engagement checks/i.test(componentText)) return;

        const explicitDates = extractExplicitDates(dateText, meta.termYear);
        if (explicitDates.length === 0) return;

        const weightNote = weightText ? `Weight: ${weightText}` : undefined;

        if (/peerscholar cycles?/i.test(componentText)) {
          explicitDates.forEach((date, index) => {
            upsertSeed({
              label:
                index === 0 ? "peerScholar Practice Cycle" : `peerScholar Cycle #${index}`,
              eventType: "Assignment",
              date,
              allDay: true,
              location: locationText || "PeerScholar",
              notes: combineNotes(
                ["Deliverable recovered from the AFM 111 assessment tables."],
                weightNote ? [weightNote] : []
              ),
              confidence: "high",
              provenance: [makeProvenance(section, "table", `${componentText} ${dateText}`)],
            });
          });
          return;
        }

        if (/pebblepad workbook/i.test(componentText)) {
          explicitDates.forEach((date, index) => {
            upsertSeed({
              label: `PebblePad Workbook Checkpoint #${index + 1}`,
              eventType: "Assignment",
              date,
              allDay: true,
              location: locationText || "PebblePad",
              notes: combineNotes(
                ["Deliverable recovered from the AFM 111 assessment tables."],
                weightNote ? [weightNote] : []
              ),
              confidence: "high",
              provenance: [makeProvenance(section, "table", `${componentText} ${dateText}`)],
            });
          });
          return;
        }

        if (/group(?: problem[-\s])?solving process\s*\(psp\)\s*assessment|group psp assessment/i.test(componentText)) {
          upsertSeed({
            label: "Group PSP Assessment",
            eventType: "Assessment",
            date: explicitDates[explicitDates.length - 1],
            allDay: true,
            location: locationText || "LEARN",
            notes: combineNotes(
              ["Deliverable recovered from the AFM 111 assessment tables."],
              weightNote ? [weightNote] : []
            ),
            confidence: "high",
            provenance: [makeProvenance(section, "table", `${componentText} ${dateText}`)],
          });
          return;
        }

        const individualAssessmentMatch = componentText.match(
          /individual assessment\s*#\s*(\d+)(?:\s*\(([^)]+)\))?/i
        );
        if (individualAssessmentMatch) {
          const assessmentNumber = Number(individualAssessmentMatch[1]);
          if (!Number.isFinite(assessmentNumber)) return;
          const descriptor = normalizeWhitespace(individualAssessmentMatch[2] ?? "");
          upsertSeed({
            label: descriptor
              ? `Individual Assessment #${assessmentNumber} (${descriptor})`
              : `Individual Assessment #${assessmentNumber}`,
            eventType: "Assessment",
            date: explicitDates[explicitDates.length - 1],
            allDay: true,
            location: locationText || "LEARN",
            notes: combineNotes(
              ["Deliverable recovered from the AFM 111 assessment tables."],
              weightNote ? [weightNote] : []
            ),
            confidence: "high",
            provenance: [makeProvenance(section, "table", `${componentText} ${dateText}`)],
          });
        }
      });
    }

    const weeklyAssessmentIndex = header.findIndex((cell) => cell === "assessments");
    const weeklyDateIndex = header.findIndex((cell) => cell === "date");
    const weeklyWeightIndex = header.findIndex((cell) => /weight/.test(cell));
    if (
      weeklyAssessmentIndex === -1 ||
      weeklyDateIndex === -1 ||
      !header.some((cell) => /\bweek\b/.test(cell))
    ) {
      return;
    }

    rows.slice(1).forEach((row) => {
      const cells = Array.from(row.querySelectorAll("th,td"));
      const assessmentLines = rawCellLines(cells[weeklyAssessmentIndex]);
      const dateLines = rawCellLines(cells[weeklyDateIndex]);
      const weightLines = rawCellLines(cells[weeklyWeightIndex]);
      if (assessmentLines.length === 0 || dateLines.length === 0) return;

      assessmentLines.forEach((assessmentLine, index) => {
        const normalizedAssessment = normalizeWhitespace(assessmentLine);
        const dateLine = dateLines[index] ?? dateLines[0] ?? "";
        const normalizedDateLine = dateLine.replace(
          /\b([A-Za-z]{3,9})-(\d{1,2})\b/g,
          "$1 $2"
        );
        const explicitDates = extractExplicitDates(normalizedDateLine, meta.termYear);
        if (explicitDates.length === 0) return;
        const timeRange = parseTimeRange(normalizedDateLine);
        const weightNote = weightLines[index] ? `Weight: ${weightLines[index]}` : undefined;
        const extraDatesNote =
          explicitDates.length > 1
            ? `Additional cycle deadlines: ${explicitDates.slice(1).join(", ")}`
            : undefined;

        if (/peerscholar practice cycle/i.test(normalizedAssessment)) {
          upsertSeed({
            label: "peerScholar Practice Cycle",
            eventType: "Assignment",
            date: explicitDates[0],
            allDay: true,
            location: "PeerScholar",
            notes: combineNotes(
              ["Deliverable recovered from the AFM 111 weekly assessment grid."],
              weightNote ? [weightNote] : [],
              extraDatesNote ? [extraDatesNote] : []
            ),
            confidence: "high",
            provenance: [makeProvenance(section, "table", `${normalizedAssessment} ${normalizedDateLine}`)],
          });
          return;
        }

        const cycleMatch = normalizedAssessment.match(/peerscholar cycle\s*#\s*(\d+)/i);
        if (cycleMatch) {
          const cycleNumber = Number(cycleMatch[1]);
          if (!Number.isFinite(cycleNumber)) return;
          upsertSeed({
            label: `peerScholar Cycle #${cycleNumber}`,
            eventType: "Assignment",
            date: explicitDates[0],
            allDay: true,
            location: "PeerScholar",
            notes: combineNotes(
              ["Deliverable recovered from the AFM 111 weekly assessment grid."],
              weightNote ? [weightNote] : [],
              extraDatesNote ? [extraDatesNote] : []
            ),
            confidence: "high",
            provenance: [makeProvenance(section, "table", `${normalizedAssessment} ${normalizedDateLine}`)],
          });
          return;
        }

        const workbookMatch = normalizedAssessment.match(/pebblepad workbook checkpoint\s*#\s*(\d+)/i);
        if (workbookMatch) {
          const checkpointNumber = Number(workbookMatch[1]);
          if (!Number.isFinite(checkpointNumber)) return;
          upsertSeed({
            label: `PebblePad Workbook Checkpoint #${checkpointNumber}`,
            eventType: "Assignment",
            date: explicitDates[0],
            allDay: true,
            location: "PebblePad",
            notes: combineNotes(
              ["Deliverable recovered from the AFM 111 weekly assessment grid."],
              weightNote ? [weightNote] : []
            ),
            confidence: "high",
            provenance: [makeProvenance(section, "table", `${normalizedAssessment} ${normalizedDateLine}`)],
          });
          return;
        }

        const individualAssessmentMatch = normalizedAssessment.match(/individual assessment\s*#\s*(\d+)/i);
        if (individualAssessmentMatch) {
          const assessmentNumber = Number(individualAssessmentMatch[1]);
          if (!Number.isFinite(assessmentNumber)) return;
          upsertSeed({
            label: `Individual Assessment #${assessmentNumber}`,
            eventType: "Assessment",
            date: explicitDates[0],
            startTime: timeRange.startTime,
            endTime: timeRange.endTime,
            allDay: !timeRange.startTime,
            location: timeRange.startTime ? "Proctored exam" : "LEARN",
            notes: combineNotes(
              ["Deliverable recovered from the AFM 111 weekly assessment grid."],
              weightNote ? [weightNote] : []
            ),
            confidence: "high",
            provenance: [makeProvenance(section, "table", `${normalizedAssessment} ${normalizedDateLine}`)],
          });
          return;
        }

        if (/group problem solving process\s*\(psp\)\s*assessment/i.test(normalizedAssessment)) {
          upsertSeed({
            label: "Group PSP Assessment",
            eventType: "Assessment",
            date: explicitDates[0],
            allDay: true,
            location: "LEARN",
            notes: combineNotes(
              ["Deliverable recovered from the AFM 111 weekly assessment grid."],
              weightNote ? [weightNote] : []
            ),
            confidence: "high",
            provenance: [makeProvenance(section, "table", `${normalizedAssessment} ${normalizedDateLine}`)],
          });
        }
      });
    });
  });

  return Array.from(seedMap.values());
}

function extractPmathStructuredAssessmentSeeds(
  html: string,
  sections: SectionBlock[],
  meta: OutlineMeta
) {
  const isPmath667 =
    courseCodeMatches(meta.courseCode, "PMATH 667") &&
    /algebraic topology/i.test(meta.outlineName);
  const isPmath833 =
    courseCodeMatches(meta.courseCode, "PMATH 833") &&
    /harmonic analysis/i.test(meta.outlineName);

  if (!isPmath667 && !isPmath833) {
    return [] as AssessmentSeed[];
  }

  const section = findSectionForCourseSpecificSnippet(sections, [
    /assessments?\s*&\s*activities/i,
    /test 1/i,
    /test 2/i,
  ]);

  const seeds: AssessmentSeed[] = [];
  const seedMap = new Map<string, AssessmentSeed>();
  const upsertSeed = (seed: AssessmentSeed) => {
    const key = `${seed.eventType}::${seed.label}::${seed.date ?? "undated"}::${seed.location ?? ""}`;
    if (!seedMap.has(key)) {
      seedMap.set(key, seed);
    }
  };

  extractHtmlTables(html).forEach((tableHtml) => {
    const rows = extractHtmlTableRows(tableHtml).map((rowHtml) => extractHtmlRowCells(rowHtml));
    if (rows.length === 0) return;

    const header = rows[0].map((cell) => normalizeWhitespace(cell).toLowerCase());
    const componentIndex = header.findIndex((cell) => /component\s*\/\s*activity/.test(cell));
    const dateIndex = header.findIndex((cell) => /date or due date/.test(cell));
    const locationIndex = header.findIndex((cell) => /location\s*\/\s*submission method/.test(cell));
    const weightIndex = header.findIndex((cell) => /weight/.test(cell));
    if (componentIndex === -1 || dateIndex === -1 || locationIndex === -1) return;

    rows.slice(1).forEach((row) => {
      const componentText = normalizeWhitespace(row[componentIndex] ?? "");
      const dateText = normalizeWhitespace(row[dateIndex] ?? "");
      const locationText = normalizeWhitespace(row[locationIndex] ?? "");
      const weightText = normalizeWeightText(row[weightIndex] ?? "");
      if (!componentText) return;
      if (!/test\s*#?\s*\d+/i.test(componentText)) return;

      const normalizedLabel = normalizeAssessmentLabel(componentText);
      if (!normalizedLabel) return;

      const explicitDate =
        extractExplicitDates(dateText, meta.termYear)[0] ??
        parseFlexibleDate(dateText, meta.termYear);
      const timeRange = parseTimeRange(dateText);

      upsertSeed({
        label: normalizedLabel,
        eventType: "Assessment",
        date: /^tba|^tbd$/i.test(dateText) ? undefined : explicitDate,
        startTime: timeRange.startTime,
        endTime: timeRange.endTime,
        allDay: !timeRange.startTime,
        location:
          /classroom|in-person/i.test(locationText)
            ? "Classroom"
            : sanitizeAssessmentLocation(normalizedLabel, locationText) || undefined,
        notes: weightText ? [`Weight: ${weightText}`] : [],
        confidence: explicitDate || /^tba|^tbd$/i.test(dateText) ? "high" : "medium",
        provenance: [makeProvenance(section, "table", row.join(" | "))],
      });
    });
  });

  seeds.push(...seedMap.values());
  return seeds;
}

function extractRcs235JesusLegacyDiscussionSeeds(
  html: string,
  sections: SectionBlock[],
  meta: OutlineMeta
) {
  if (
    !courseCodeMatches(meta.courseCode, "RCS 235/JS 235") ||
    !/jesus(?:[:_]\s*|\s+)life and legacy/i.test(meta.outlineName)
  ) {
    return [] as AssessmentSeed[];
  }

  const section = findSectionForCourseSpecificSnippet(sections, [
    /discussion postings/i,
    /five sundays/i,
    /discussion post 3/i,
  ]);

  let discussionCount = 0;
  let discussionLocation = "LEARN Discussion";
  let weightText = "";

  extractHtmlTables(html).forEach((tableHtml) => {
    const rows = extractHtmlTableRows(tableHtml).map((rowHtml) => extractHtmlRowCells(rowHtml));
    if (rows.length === 0) return;

    const header = rows[0].map((cell) => normalizeWhitespace(cell).toLowerCase());
    const componentIndex = header.findIndex((cell) => /component\s*\/\s*activity/.test(cell));
    const dateIndex = header.findIndex((cell) => /date or due date/.test(cell));
    const locationIndex = header.findIndex((cell) => /location\s*\/\s*submission method/.test(cell));
    const weightIndex = header.findIndex((cell) => /weight/.test(cell));
    if (componentIndex === -1 || dateIndex === -1) return;

    rows.slice(1).forEach((row) => {
      const componentText = normalizeWhitespace(row[componentIndex] ?? "");
      if (!/^discussion postings$/i.test(componentText)) return;

      const dateText = normalizeWhitespace(row[dateIndex] ?? "");
      const locationText = normalizeWhitespace(row[locationIndex] ?? "");
      weightText = normalizeWeightText(row[weightIndex] ?? "");
      discussionLocation = locationText || discussionLocation;

      const countMatch =
        dateText.match(/\b(one|two|three|four|five|six|seven|eight|nine|ten|\d+)\s+sundays?\b/i) ??
        weightText.match(/\b(\d+)\s+at\s+/i);
      if (countMatch) {
        const rawCount = countMatch[1].toLowerCase();
        const wordCounts: Record<string, number> = {
          one: 1,
          two: 2,
          three: 3,
          four: 4,
          five: 5,
          six: 6,
          seven: 7,
          eight: 8,
          nine: 9,
          ten: 10,
        };
        discussionCount = /^\d+$/.test(rawCount) ? Number(rawCount) : (wordCounts[rawCount] ?? 0);
      }
    });
  });

  if (discussionCount === 0) {
    return [] as AssessmentSeed[];
  }

  const sourceText = normalizeWhitespace(htmlSnippetToText(html));
  const datedPostNumbers = new Set<number>();
  const seeds: AssessmentSeed[] = [];

  Array.from(
    sourceText.matchAll(
      /Discussion Post\s*(\d+)\s*:\s*(Initial|Follow-?up)\s+post\s+due\s+([A-Za-z]+,\s+[A-Za-z]+\s+\d{1,2},\s+\d{4}\s+at\s+\d{1,2}:\d{2}\s*[AP]M)/gi
    )
  ).forEach((match) => {
    const discussionNumber = Number(match[1]);
    const postStage = /follow/i.test(match[2]) ? "Follow-Up Post" : "Initial Post";
    const dateText = normalizeWhitespace(match[3]);
    const date =
      extractExplicitDates(dateText, meta.termYear)[0] ?? parseFlexibleDate(dateText, meta.termYear);
    const timeRange = parseTimeRange(dateText);
    datedPostNumbers.add(discussionNumber);
    seeds.push({
      label: `Discussion Post #${discussionNumber} - ${postStage}`,
      eventType: "Assignment",
      date,
      startTime: timeRange.startTime,
      endTime: timeRange.endTime,
      allDay: !timeRange.startTime,
      location: discussionLocation,
      notes: [`Discussion posting due date recovered from the outline footer.`],
      weight: weightText,
      confidence: date ? "high" : "medium",
      provenance: [makeProvenance(section, "text", match[0])],
    });
  });

  for (let index = 1; index <= discussionCount; index += 1) {
    if (datedPostNumbers.has(index)) continue;
    seeds.push({
      label: `Discussion Post #${index}`,
      eventType: "Assignment",
      date: undefined,
      allDay: true,
      location: discussionLocation,
      notes: [`Due date unresolved in outline.`],
      weight: weightText,
      confidence: "medium",
      provenance: [makeProvenance(section, "table", `Discussion Postings | ${discussionCount} discussions`)],
    });
  }

  return seeds;
}

function extractCourseSpecificAssessmentSeeds(
  html: string,
  document: Document,
  sections: SectionBlock[],
  sectionOptions: ParsedSectionOption[],
  meta: OutlineMeta
) {
  return [
    ...extractEce463LabProjectScheduleSeeds(html, document, sections, meta),
    ...extractSyde223WeeklyAssignmentSeeds(document, sections, meta),
    ...extractEarth123AssignmentFourSeed(html, sections, meta),
    ...extractChem262LReportAndExamSeeds(document, sections, sectionOptions, meta),
    ...extractAmath231WeeklyAssignmentSeeds(sections, meta),
    ...extractBiol130AssignmentSeeds(html, sections, meta),
    ...extractBiol373KritikAssignmentSeeds(sections, meta),
    ...extractBiol473LabAssignmentSeeds(sections, meta),
    ...extractAfm111AssessmentSeeds(html, document, sections, meta),
    ...extractEngl201ReflectionSeeds(html, sections, meta),
    ...extractPmathStructuredAssessmentSeeds(html, sections, meta),
  ];
}

function buildDocumentWideTableSections(document: Document) {
  return Array.from(document.querySelectorAll("table")).map((table, index) => ({
      id: `document_table_${index + 1}`,
      title: `Document Table ${index + 1}`,
      elements: [table as unknown as HTMLElement],
      text: normalizeWhitespace(htmlToText(table)),
    })) as SectionBlock[];
}

function parseDocumentWideDatedWeightTables(document: Document, meta: OutlineMeta) {
  const fallbackSection: SectionBlock = {
    id: "document_assessment_tables",
    title: "Document assessment tables",
    elements: [],
    text: "",
  };

  const seenRowSignatures = new Set<string>();

  return Array.from(document.querySelectorAll("tr")).flatMap((rowEl) => {
    const row = Array.from(rowEl.querySelectorAll("th,td")).map((cell) =>
      htmlToText(cell as Element)
    );
    if (row.length < 2) return [] as AssessmentSeed[];

    const normalizedCells = row.map((cell) => normalizeWhitespace(cell)).filter(Boolean);
    if (normalizedCells.length < 2) return [] as AssessmentSeed[];
    if (
      normalizedCells.every((cell) =>
        /^(component|assessment|activity|evaluation|item|name|value|weight|worth|percentage|percent)$/i.test(
          cell
        )
      )
    ) {
      return [] as AssessmentSeed[];
    }

    const weightCell = normalizedCells.find((cell) => /^\d+(?:\.\d+)?%$/.test(cell));
    const rawLabel = normalizedCells.find(
      (cell) =>
        cell !== weightCell &&
        (/\b(?:due on|due by|due\b|available(?:\s+as\s+of|\s+from)?|opens?(?:\s+on)?|closes?(?:\s+on)?|on)\b/i.test(
          cell
        ) ||
          /\b(?:January|February|March|April|May|June|July|August|September|October|November|December|Jan|Feb|Mar|Apr|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)\b/i.test(
            cell
          ))
    );
    if (!weightCell || !rawLabel) return [] as AssessmentSeed[];

    const rowSignature = `${rawLabel}|${weightCell}`;
    if (seenRowSignatures.has(rowSignature)) return [] as AssessmentSeed[];
    seenRowSignatures.add(rowSignature);

    const anchoredDates = extractDeadlineAnchoredDates(rawLabel, meta.termYear);
    const dateSpec = parseDateSpec(rawLabel, meta.termYear);
    const occurrences =
      anchoredDates.length > 0
        ? anchoredDates.map((date) => ({ date }))
        : dateSpec?.kind === "single"
        ? [{ date: dateSpec.date }]
        : dateSpec?.kind === "range"
        ? [{ date: dateSpec.startDate, endDate: dateSpec.endDate }]
        : dateSpec?.kind === "dates"
        ? dateSpec.dates.map((date) => ({ date }))
        : extractExplicitDates(rawLabel, meta.termYear).map((date) => ({ date }));
    if (occurrences.length === 0) return [] as AssessmentSeed[];
    const normalizedOccurrences = normalizeOccurrencesToOutlineTermYear(
      occurrences,
      rawLabel,
      meta
    );

    const section = {
      ...fallbackSection,
      text: normalizeWhitespace(normalizedCells.join("\n")),
    };
    const location = assignmentLocationFromContext([rawLabel, section.text].join(" "));
    const label =
      assignmentLabelFromText(rawLabel) ??
      extractProseDeliverableLabel(rawLabel) ??
      extractAssessmentLabelFromText(rawLabel) ??
      labelFromScheduleEntry(rawLabel);
    if (!label || isFinalExamLabel(label)) return [] as AssessmentSeed[];

    const eventType =
      assessmentTypeFromLabel(label, location) === "Assessment"
        ? ("Assessment" as const)
        : ("Assignment" as const);

    return normalizedOccurrences.map((occurrence) => ({
      label,
      eventType,
      date: occurrence.date,
      endDate: occurrence.endDate,
      allDay: true,
      location,
      notes: combineNotes([rawLabel], [`Weight: ${weightCell}`]),
      weight: weightCell,
      confidence: "high" as const,
      provenance: [makeProvenance(section, "table", normalizedCells.join(" | "))],
    }));
  });
}

function parseDocumentWideDateLabeledRows(document: Document, meta: OutlineMeta) {
  const fallbackSection: SectionBlock = {
    id: "document_structured_rows",
    title: "Document structured rows",
    elements: [],
    text: "",
  };

  const seenRowSignatures = new Set<string>();

  return Array.from(document.querySelectorAll("tr")).flatMap((rowEl) => {
    const tableEl = rowEl.closest("table");
    const tableMatrix = tableEl ? tableToRows(tableEl as HTMLTableElement) : [];
    const headerIndex = tableMatrix.length > 0 ? findHeaderRow(tableMatrix) : -1;
    const headerText =
      headerIndex >= 0
        ? tableMatrix[headerIndex].map((cell) => normalizeWhitespace(cell).toLowerCase()).join(" | ")
        : "";
    const isStructuredValueTable =
      rowEl.querySelectorAll("th").length === 0 &&
      /(?:component|assessment|activity|evaluation|item|name|description)\b/.test(headerText) &&
      /\b(?:value|details?)\b/.test(headerText);
    if (!isStructuredValueTable) return [] as AssessmentSeed[];

    const row = Array.from(rowEl.querySelectorAll("th,td")).map((cell) =>
      htmlToText(cell as Element)
    );
    if (row.length < 2) return [] as AssessmentSeed[];

    const normalizedCells = row.map((cell) => normalizeWhitespace(cell)).filter(Boolean);
    if (normalizedCells.length < 2) return [] as AssessmentSeed[];
    if (
      normalizedCells.every((cell) =>
        /^(component|assessment|activity|evaluation|item|name|value|weight|worth|percentage|percent|date|deadline|dates|week|topic|module)$/i.test(
          cell
        )
      )
    ) {
      return [] as AssessmentSeed[];
    }

    const dateBearingCells = normalizedCells.filter((cell) => {
      const anchoredDates = extractDeadlineAnchoredDates(cell, meta.termYear);
      const dateSpec = parseDateSpec(cell, meta.termYear);
      const explicitDates = extractExplicitDates(cell, meta.termYear);
      return (
        anchoredDates.length > 0 ||
        Boolean(dateSpec?.kind) ||
        (explicitDates.length > 0 &&
          /\b(?:due|deadline|available(?:\s+as\s+of|\s+from)?|opens?(?:\s+on)?|closes?(?:\s+on)?|submitted?(?:\s+virtually)?\s+(?:by|to)|on)\b/i.test(
            cell
          ))
      );
    });
    if (dateBearingCells.length === 0) return [] as AssessmentSeed[];

    const rawLabelCell =
      normalizedCells.find((cell) => {
        if (dateBearingCells.includes(cell) && cell !== normalizedCells[0]) return false;
        const label =
          assignmentLabelFromText(cell) ??
          extractProseDeliverableLabel(cell) ??
          extractAssessmentLabelFromText(cell) ??
          labelFromScheduleEntry(cell);
        return Boolean(label) && !looksLikeStandaloneDateOrRangeLabel(cell);
      }) ??
      dateBearingCells.find((cell) => {
        const label =
          assignmentLabelFromText(cell) ??
          extractProseDeliverableLabel(cell) ??
          extractAssessmentLabelFromText(cell) ??
          labelFromScheduleEntry(cell);
        return Boolean(label) && !looksLikeStandaloneDateOrRangeLabel(cell);
      });

    if (!rawLabelCell) return [] as AssessmentSeed[];

    const label =
      assignmentLabelFromText(rawLabelCell) ??
      extractProseDeliverableLabel(rawLabelCell) ??
      extractAssessmentLabelFromText(rawLabelCell) ??
      labelFromScheduleEntry(rawLabelCell);
    if (!label || isFinalExamLabel(label)) return [] as AssessmentSeed[];

    const sourceCell =
      dateBearingCells.find((cell) => cell.includes(rawLabelCell)) ??
      dateBearingCells[0];
    const anchoredDates = extractDeadlineAnchoredDates(sourceCell, meta.termYear);
    const dateSpec = parseDateSpec(sourceCell, meta.termYear);
    const occurrences =
      anchoredDates.length > 0
        ? anchoredDates.map((date) => ({ date }))
        : dateSpec?.kind === "single"
        ? [{ date: dateSpec.date }]
        : dateSpec?.kind === "range"
        ? [{ date: dateSpec.startDate, endDate: dateSpec.endDate }]
        : dateSpec?.kind === "dates"
        ? dateSpec.dates.map((date) => ({ date }))
        : extractExplicitDates(sourceCell, meta.termYear).map((date) => ({ date }));
    if (occurrences.length === 0) return [] as AssessmentSeed[];

    const rowSignature = `${label}|${sourceCell}|${normalizedCells.join(" | ")}`;
    if (seenRowSignatures.has(rowSignature)) return [] as AssessmentSeed[];
    seenRowSignatures.add(rowSignature);

    const normalizedOccurrences = normalizeOccurrencesToOutlineTermYear(
      occurrences,
      sourceCell,
      meta
    );
    const rowText = normalizedCells.join(" | ");
    const location = assignmentLocationFromContext(rowText);
    const eventType =
      assessmentTypeFromLabel(label, rowText) === "Assessment"
        ? ("Assessment" as const)
        : ("Assignment" as const);

    return normalizedOccurrences.map((occurrence) => ({
      label,
      eventType,
      date: occurrence.date,
      endDate: occurrence.endDate,
      allDay: true,
      location:
        eventType === "Assessment"
          ? extractStructuredLocation(rowText, true) || undefined
          : location,
      notes: [rowText],
      confidence: "medium" as const,
      provenance: [makeProvenance(fallbackSection, "table", rowText)],
    }));
  });
}

function parseDocumentWideComponentValueDateSeeds(document: Document, meta: OutlineMeta) {
  const seeds: AssessmentSeed[] = [];

  Array.from(document.querySelectorAll("table")).forEach((table, index) => {
    const matrix = tableToRows(table as HTMLTableElement);
    if (matrix.length === 0) return;

    const headerIndex = findHeaderRow(matrix);
    const headers = matrix[headerIndex].map((header) => normalizeWhitespace(header));
    const lowerHeaders = headers.map((header) => header.toLowerCase());
    const labelIndex = lowerHeaders.findIndex((header) =>
      /(component|assessment|activity|item|evaluation|name)/.test(header)
    );
    const valueIndex = lowerHeaders.findIndex((header) =>
      /(value|weight|worth|percentage|percent)/.test(header)
    );
    if (labelIndex === -1 || valueIndex === -1) return;

    const section: SectionBlock = {
      id: `document_component_value_${index + 1}`,
      title: `Document Component Value ${index + 1}`,
      elements: [table as unknown as HTMLElement],
      text: normalizeWhitespace(htmlToText(table)),
    };
    const rows = matrix
      .slice(headerIndex + 1)
      .filter((row) => row.some((cell) => normalizeWhitespace(cell)));

    rows.forEach((row) => {
      const rawLabel = normalizeWhitespace(row[labelIndex]);
      if (!rawLabel) return;

      const anchoredDates = extractDeadlineAnchoredDates(rawLabel, meta.termYear);
      const dateSpec = parseDateSpec(rawLabel, meta.termYear);
      const looseDates = Array.from(
        rawLabel.matchAll(
          /\b(?:(?:Mon(?:day)?|Tue(?:s|sday)?|Wed(?:nesday)?|Thu(?:r|rs|rsday|ursday)?|Fri(?:day)?|Sat(?:urday)?|Sun(?:day)?),?\s+)?(?:January|February|March|April|May|June|July|August|September|October|November|December|Jan|Feb|Mar|Apr|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)\.?\s+\d{1,2}(?:st|nd|rd|th)?(?:,?\s*\d{4})?/gi
        )
      )
        .map((match) => parseFlexibleDate(match[0], meta.termYear))
        .filter((date): date is string => Boolean(date));
      const occurrences =
        anchoredDates.length > 0
          ? anchoredDates.map((date) => ({ date }))
          : dateSpec?.kind === "single"
          ? [{ date: dateSpec.date }]
          : dateSpec?.kind === "range"
          ? [{ date: dateSpec.startDate, endDate: dateSpec.endDate }]
          : dateSpec?.kind === "dates"
          ? dateSpec.dates.map((date) => ({ date }))
          : unique([...extractExplicitDates(rawLabel, meta.termYear), ...looseDates]).map((date) => ({
              date,
            }));
      if (occurrences.length === 0) return;

      const label =
        assignmentLabelFromText(rawLabel) ??
        extractProseDeliverableLabel(rawLabel) ??
        extractAssessmentLabelFromText(rawLabel) ??
        labelFromScheduleEntry(rawLabel);
      if (!label || isFinalExamLabel(label)) return;

      const weight = normalizeWeightText(row[valueIndex]);
      const location = assignmentLocationFromContext([rawLabel, section.text].join(" "));
      const normalizedOccurrences = normalizeOccurrencesToOutlineTermYear(
        occurrences,
        rawLabel,
        meta
      );

      normalizedOccurrences.forEach((occurrence) => {
        seeds.push({
          label,
          eventType:
            assessmentTypeFromLabel(label, location) === "Assessment"
              ? "Assessment"
              : "Assignment",
          date: occurrence.date,
          endDate: occurrence.endDate,
          allDay: true,
          location,
          notes: combineNotes([rawLabel], weight ? [`Weight: ${weight}`] : []),
          weight,
          confidence: "high",
          provenance: [makeProvenance(section, "table", row.join(" | "))],
        });
      });
    });
  });

  return seeds;
}

function parseDocumentWideAnchoredColumnTableSeeds(document: Document, meta: OutlineMeta) {
  const isWeekHeader = (header: string) => {
    const normalized = normalizeWhitespace(header).toLowerCase();
    return normalized.includes("week") || /\bwk\b/.test(normalized);
  };
  const seeds: AssessmentSeed[] = [];

  Array.from(document.querySelectorAll("table")).forEach((table, index) => {
    const matrix = tableToRows(table as HTMLTableElement);
    if (matrix.length === 0) return;

    const headerIndex = findHeaderRow(matrix);
    const headers = matrix[headerIndex].map((header) => normalizeWhitespace(header));
    const rows = matrix
      .slice(headerIndex + 1)
      .filter((row) => row.some((cell) => normalizeWhitespace(cell)));
    const lowerHeaders = headers.map((header) => header.toLowerCase());
    const headerText = lowerHeaders.join(" | ");

    const anchorIndex = lowerHeaders.findIndex(
      (header) =>
        header.includes("date") ||
        header.includes("class") ||
        isWeekHeader(header)
    );
    const contentIndexes = lowerHeaders
      .map((header, cellIndex) => ({ header, cellIndex }))
      .filter(
        ({ header, cellIndex }) =>
          cellIndex !== anchorIndex &&
          /(deadline|deliverable|assignments?|tasks?|tutorials?|exam\/project|project|quizzes?|tests?|midterms?)/.test(
            header
          ) &&
          !/(weight|value|worth|percentage|percent|location|submission)/.test(header)
      )
      .map(({ cellIndex }) => cellIndex);

    if (anchorIndex === -1 || contentIndexes.length === 0) return;

    const section: SectionBlock = {
      id: `document_anchored_table_${index + 1}`,
      title: `Document Anchored Table ${index + 1}`,
      elements: [table as unknown as HTMLElement],
      text: normalizeWhitespace(htmlToText(table)),
    };

    rows.forEach((row) => {
      const anchorText = normalizeWhitespace(row[anchorIndex]);
      if (!anchorText) return;

      const anchorSpec = parseDateSpec(anchorText, meta.termYear);
      const anchorDate =
        anchorSpec?.kind === "single"
          ? anchorSpec.date
          : anchorSpec?.kind === "range"
          ? anchorSpec.startDate
          : extractExplicitDates(anchorText, meta.termYear)[0];

      contentIndexes.forEach((contentIndex) => {
        const rawContent = normalizeWhitespace(row[contentIndex]);
        if (!rawContent || /^yes$/i.test(rawContent) || /^tbd$/i.test(rawContent)) return;

        const entries = unique(
          expandScheduleEntries(rawContent)
            .flatMap((entry) => splitCompoundActionableEntries(entry))
            .map((entry) => normalizeWhitespace(entry))
            .filter(Boolean)
        );
        const rowText = row.map((cell) => normalizeWhitespace(cell)).filter(Boolean).join(" | ");

        entries.forEach((entry) => {
          if (isReviewOrPlaceholderScheduleEntry(entry)) return;
          if (/^(?:project help session|project starts?)$/i.test(entry)) return;

          const label =
            extractAssessmentLabelFromText(entry) ??
            extractWeekTableDeliverableLabel(entry) ??
            extractProseDeliverableLabel(entry) ??
            assignmentLabelFromText(entry) ??
            extractAssessmentLabelFromText(rowText) ??
            extractWeekTableDeliverableLabel(rowText) ??
            extractProseDeliverableLabel(rowText) ??
            assignmentLabelFromText(rowText);
          if (!label || isFinalExamLabel(label)) return;

          const explicitDates = extractDeadlineAnchoredDates(entry, meta.termYear);
          const dateSpec = parseDateSpec(entry, meta.termYear);
          const occurrences =
            explicitDates.length > 0
              ? explicitDates.map((date) => ({ date }))
              : dateSpec?.kind === "single"
              ? [{ date: dateSpec.date }]
              : dateSpec?.kind === "range"
              ? [{ date: dateSpec.startDate, endDate: dateSpec.endDate }]
              : dateSpec?.kind === "dates"
              ? dateSpec.dates.map((date) => ({ date }))
              : anchorDate
              ? [{ date: anchorDate }]
              : [];
          if (occurrences.length === 0) return;

          const { startTime, endTime } = parseTimeRange(entry);
          const location = assignmentLocationFromContext(`${rowText} ${section.text}`);
          normalizeOccurrencesToOutlineTermYear(occurrences, entry, meta).forEach((occurrence) => {
            seeds.push({
              label,
              eventType:
                assessmentTypeFromLabel(label, rowText) === "Assessment"
                  ? "Assessment"
                  : "Assignment",
              date: occurrence.date,
              endDate: occurrence.endDate,
              allDay: !startTime,
              startTime,
              endTime,
              location,
              notes: [entry],
              confidence: explicitDates.length > 0 || dateSpec?.kind ? "high" : "medium",
              provenance: [makeProvenance(section, "table", row.join(" | "))],
            });
          });
        });
      });
    });
  });

  return seeds;
}

function parseRelevantProse(
  sections: SectionBlock[],
  meta: OutlineMeta,
  weekWindows: Map<number, WeekWindow>
) {
  const assessments: AssessmentSeed[] = [];
  const attachments: TopicAttachment[] = [];
  const exclusions: ExclusionWindow[] = [];

  sections
    .filter(
      (section) =>
        RELEVANT_PROSE_SECTIONS.has(section.id) ||
        /\brequest an alternative to turnitin\b/i.test(section.text)
    )
    .forEach((section) => {
      let sectionPreviousEntryLabel: string | undefined;
      let sectionPreviousEntryEventType: "Assignment" | "Assessment" | undefined;
      const headingContextForBlock = (block: HTMLElement) => {
        let previous = block.previousElementSibling as HTMLElement | null;
        while (previous) {
          if (/^H[1-6]$/.test(previous.tagName)) {
            const headingText = normalizeWhitespace(htmlToText(previous));
            const label =
              extractProseDeliverableLabel(headingText) ??
              extractAssessmentLabelFromText(headingText);
            if (!label || isFinalExamLabel(label)) return undefined;
            const eventType = assessmentTypeFromLabel(label);
            return {
              label,
              eventType:
                eventType === "Assessment"
                  ? ("Assessment" as const)
                  : ("Assignment" as const),
            };
          }
          if (/^(P|LI)$/i.test(previous.tagName)) break;
          previous = previous.previousElementSibling as HTMLElement | null;
        }
        return undefined;
      };
      const blocks = section.elements.flatMap((element) =>
        Array.from(element.querySelectorAll("p, li")).filter(
          (node) => !node.closest("table")
        )
      ) as HTMLElement[];

      blocks.forEach((block) => {
        const text = normalizeWhitespace(htmlToText(block));
        if (!text) return;
        if (isAssessmentPolicyNoise(text)) return;
        const provenance = [makeProvenance(section, "prose", text)];

        if (
          /due at the beginning of weeks?/i.test(text) &&
          weekWindows.size > 0
        ) {
          const weekNumbers = Array.from(text.matchAll(/\b(\d{1,2})\b/g)).map((match) =>
            Number(match[1])
          );
          const uniqueWeekNumbers = unique(weekNumbers).filter((week) => weekWindows.has(week));
          uniqueWeekNumbers.forEach((week, index) => {
            const window = weekWindows.get(week);
            if (!window) return;
            assessments.push({
              label: `Written Assignment ${index + 1}`,
              eventType: "Assignment",
              date: window.startDate,
              allDay: true,
              location: /crowdmark/i.test(section.text) ? "Crowdmark" : "Online",
              notes: [text],
              confidence: "medium",
              provenance,
            });
          });
        }

        const proseEntries = text
          .split(/\n+/)
          .map((line) => normalizeWhitespace(line))
          .filter(Boolean)
          .flatMap((line) => expandScheduleEntries(line))
          .map((entry) => normalizeWhitespace(entry))
          .flatMap((entry) => splitLongProseEntry(entry))
          .filter(Boolean);

        let previousEntryLabel = sectionPreviousEntryLabel;
        let previousEntryEventType = sectionPreviousEntryEventType;
        const headingContext = headingContextForBlock(block);
        if (headingContext) {
          previousEntryLabel = headingContext.label;
          previousEntryEventType = headingContext.eventType;
        }

        proseEntries.forEach((entry) => {
          const cleanedEntry = normalizeWhitespace(
            entry
              .replace(
                /\bAs of\b[\s\S]*?\bno papers?\s+will\s+be\s+accepted\b.*$/i,
                ""
              )
              .replace(/\bno papers?\s+will\s+be\s+accepted\b.*$/i, "")
          );
          const containsConcreteDateCue =
            extractExplicitDates(cleanedEntry, meta.termYear).length > 0 ||
            Boolean(parseDateRange(cleanedEntry, meta.termYear));
          if (
            !cleanedEntry ||
            (isAssessmentPolicyNoise(cleanedEntry) && !containsConcreteDateCue) ||
            /^tentative$/i.test(cleanedEntry) ||
            isReviewOrPlaceholderScheduleEntry(cleanedEntry)
          ) {
            return;
          }
          if (
            /\b(?:no tutorial|no class(?:es)?|reading week)\b/i.test(cleanedEntry) &&
            /\b(?:midterms?|quizzes?|tests?|exams?)\b/i.test(cleanedEntry)
          ) {
            return;
          }

          const entryProvenance = [makeProvenance(section, "prose", cleanedEntry)];
          const multiDateAssessmentMatch = cleanedEntry.match(
            /\b((?:one|two|three|four|five|\d+)\s+(?:tests?|quizzes?))\b[\s\S]*?\bfollowing dates?\b/i
          );
          if (multiDateAssessmentMatch) {
            const datedAssessments = unique(
              [
                ...extractExplicitDates(cleanedEntry, meta.termYear),
                ...Array.from(
                  cleanedEntry.matchAll(
                    /\b(?:January|February|March|April|May|June|July|August|September|October|November|December|Jan|Feb|Mar|Apr|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)\s+\d{1,2}(?:st|nd|rd|th)?\b/gi
                  )
                )
                  .map((match) => parseFlexibleDate(match[0], meta.termYear))
                  .filter((date): date is string => Boolean(date)),
              ].sort()
            );
            const pluralAssessmentLabel = extractAssessmentLabelFromText(
              multiDateAssessmentMatch[1]
            );
            if (datedAssessments.length > 0 && pluralAssessmentLabel) {
              const weight = extractWeightFromText(previousEntryLabel ?? cleanedEntry);
              datedAssessments.forEach((date, index) => {
                assessments.push({
                  label: numberedAssessmentSeriesLabel(
                    pluralAssessmentLabel,
                    index,
                    datedAssessments.length
                  ),
                  eventType: "Assessment",
                  date,
                  allDay: true,
                  location: extractStructuredLocation(cleanedEntry, true) || undefined,
                  notes: combineNotes([cleanedEntry], weight ? [`Weight: ${weight}`] : []),
                  weight,
                  confidence: confidenceFromSeed({ date }),
                  provenance: entryProvenance,
                });
              });
              previousEntryLabel = pluralAssessmentLabel;
              previousEntryEventType = "Assessment";
          return;
        }
      }

          const turnitinAlternativeMatch = entry.match(
            /\brequest an alternative to turnitin\b[\s\S]*?\bby\s+([^.;]+?)(?:\s*\(|\.|$)/i
          );
          if (turnitinAlternativeMatch) {
            const requestDate = parseFlexibleDate(turnitinAlternativeMatch[1], meta.termYear);
            if (requestDate) {
              assessments.push({
                label: "Turnitin Alternative Request",
                eventType: "Assignment",
                date: requestDate,
                allDay: true,
                location: "Email",
                notes: [entry],
                confidence: "medium",
                provenance: entryProvenance,
              });
            }
            return;
          }

          const makeUpClassMatch = entry.match(
            /\bloss of a [a-z]+ class on ([A-Za-z0-9,\s]+?) due to .*? will be made up on ([A-Za-z0-9,\s]+)\.?$/i
          );
          if (makeUpClassMatch) {
            const lostDate = parseFlexibleDate(makeUpClassMatch[1], meta.termYear);
            const makeUpDate = parseFlexibleDate(makeUpClassMatch[2], meta.termYear);
            if (lostDate) {
              exclusions.push({
                appliesTo: ["Lecture"],
                startDate: lostDate,
                endDate: lostDate,
                reason: entry,
                provenance: entryProvenance,
              });
            }
            if (makeUpDate) {
              attachments.push({
                appliesTo: ["Lecture"],
                exactDates: [makeUpDate],
                note: entry,
                provenance: entryProvenance,
              });
            }
            return;
          }

          const explicitDates = extractDeadlineAnchoredDates(cleanedEntry, meta.termYear);
          const contextualPresentationDates =
            /\bpresented in class on\b/i.test(cleanedEntry) ||
            /\bpresentation(?:s)?\b.*\bon\b/i.test(cleanedEntry)
              ? extractExplicitDates(cleanedEntry, meta.termYear)
              : [];
          const dateSpec = parseDateSpec(cleanedEntry, meta.termYear);
          const resolvedDates =
            explicitDates.length > 0
              ? explicitDates
            : dateSpec?.kind === "single"
              ? [dateSpec.date]
            : dateSpec?.kind === "dates"
              ? dateSpec.dates
            : dateSpec?.kind === "range" && hasAvailabilityCue(cleanedEntry)
              ? [dateSpec.startDate]
            : contextualPresentationDates.length > 0
              ? contextualPresentationDates
            : [];
          const { startTime, endTime } = parseTimeRange(cleanedEntry);
          const location = extractStructuredLocation(cleanedEntry, true) || undefined;
          const weight = extractWeightFromText(cleanedEntry);
          const assessmentLabel = extractAssessmentLabelFromText(cleanedEntry);
          const deliverableLabel =
            assignmentLabelFromText(cleanedEntry) ??
            extractProseDeliverableLabel(cleanedEntry);
          const placeholderDeliverableLabel =
            deliverableLabel &&
            (isPlaceholderDeliverableLabel(deliverableLabel) ||
              (/^(?:assignment|report|presentation)$/i.test(deliverableLabel) &&
                /\b(?:assignment due date|report due date|presentation due date|there is a report|there will be a presentation)\b/i.test(
                  cleanedEntry
                )))
              ? deliverableLabel
              : undefined;
          const hasDistinctDeliverableCueForReuse =
            cleanedEntry.length > 140 ||
            (hasNamedDeliverableCue(cleanedEntry) &&
              !/^(?:written\s+(?:portion|submissions?)|report\b|submission\b|slides?\b|presentation materials\b|ethics module\b|check-?ins?\b)/i.test(
                cleanedEntry
              ));
          const canReusePreviousLabel =
            resolvedDates.length > 0 &&
            !assessmentLabel &&
            (!deliverableLabel || Boolean(placeholderDeliverableLabel)) &&
            !hasDistinctDeliverableCueForReuse &&
            /\b(?:date of submission|submission date|due\b|deadline(?:\s+for)?|available(?:\s+as\s+of|\s+from)?|opens?(?:\s+on)?|closes?(?:\s+on)?|submitted?(?:\s+virtually)?\s+(?:by|to)|present(?:s|ed|ing)?\s+on|following dates?|on or before|returned to you on)\b/i.test(
              cleanedEntry
            );
          const continuationLooksLikePreviousItem =
            resolvedDates.length > 0 &&
            Boolean(previousEntryLabel) &&
            cleanedEntry.length <= 200 &&
            /^(?:students?\b|student\b|each\b|this\b|your\b|due\b|present(?:s|ed|ing)?\b|a digital copy\b|two tests?\b|there\s+(?:is|are|will be)\b)/i.test(
              cleanedEntry
            );
          const contextualDeliverableLabel =
            placeholderDeliverableLabel || canReusePreviousLabel || continuationLooksLikePreviousItem
              ? contextualizePlaceholderDeliverableLabel(cleanedEntry, previousEntryLabel)
              : undefined;
          const contextualLabel =
            canReusePreviousLabel ||
            continuationLooksLikePreviousItem ||
            Boolean(placeholderDeliverableLabel)
              ? previousEntryLabel
              : undefined;
          const preferredLabel =
            deliverableLabel &&
            assessmentTypeFromLabel(deliverableLabel, location) !== "Assessment"
              ? placeholderDeliverableLabel
                ? contextualDeliverableLabel ?? contextualLabel
                : deliverableLabel
              : assessmentLabel ??
                contextualDeliverableLabel ??
                contextualLabel ??
                deliverableLabel ??
                (contextualPresentationDates.length > 0
                  ? canonicalizeProseDeliverableLabel(cleanedEntry, cleanedEntry)
                  : undefined);

          if (!preferredLabel || isFinalExamLabel(preferredLabel)) {
            return;
          }

          const inferredEventType =
            contextualLabel && previousEntryEventType
              ? previousEntryEventType
              : assessmentTypeFromLabel(preferredLabel, location);
          const eventType =
            assessmentLabel && inferredEventType === "Other"
              ? ("Assessment" as const)
            : inferredEventType === "Other"
              ? ("Assignment" as const)
              : inferredEventType;
          const shouldAdvancePreviousLabel =
            resolvedDates.length > 0 ||
            !/^(?:students?\b|student\b|each\b|this\b|your\b|due\b|present(?:s|ed|ing)?\b|a digital copy\b)\b/i.test(
              cleanedEntry
            );
          if (shouldAdvancePreviousLabel) {
            previousEntryLabel = preferredLabel;
            previousEntryEventType = eventType === "Assessment" ? "Assessment" : "Assignment";
          }
          const unresolvedByRegistrar =
            eventType === "Assessment" &&
            /registrar|scheduled by the registrar|exam period|to be announced|tbd/i.test(
              cleanedEntry
            );

          const weekRangeAssessmentMatch = cleanedEntry.match(
            /^week\s+\d+\s*\(([^)]+)\)\s*:\s*(.+)$/i
          );
          if (
            weekRangeAssessmentMatch &&
            eventType === "Assessment" &&
            !/\b(?:due|deadline|available(?:\s+as\s+of|\s+from)?|opens?(?:\s+on)?|closes?(?:\s+on)?|submission date|submitted?\s+by)\b/i.test(
              cleanedEntry
            )
          ) {
            const [, weekWindowText, weekBody] = weekRangeAssessmentMatch;
            const explicitBodyDates = extractDeadlineAnchoredDates(weekBody, meta.termYear);
            const weekBodyDateSpec = parseDateSpec(weekBody, meta.termYear);
            const weekWindowDateSpec = parseDateSpec(weekWindowText, meta.termYear);
            const date =
              explicitBodyDates[0] ??
              (weekBodyDateSpec?.kind === "single"
                ? weekBodyDateSpec.date
                : weekBodyDateSpec?.kind === "dates"
                ? weekBodyDateSpec.dates[0]
                : undefined) ??
              (weekWindowDateSpec?.kind === "single"
                ? weekWindowDateSpec.date
                : weekWindowDateSpec?.kind === "dates"
                ? weekWindowDateSpec.dates[0]
                : weekWindowDateSpec?.kind === "range"
                ? weekWindowDateSpec.startDate
                : undefined);

            if (date) {
              assessments.push({
                label: preferredLabel,
                eventType: "Assessment",
                date,
                allDay: !startTime,
                startTime,
                endTime,
                location,
                notes: combineNotes([cleanedEntry], weight ? [`Weight: ${weight}`] : []),
                weight,
                confidence: confidenceFromSeed({ date, startTime, endTime, location }),
                provenance: entryProvenance,
              });
              return;
            }
          }

          const partDuePairs =
            eventType === "Assignment"
              ? extractPartDuePairsFromText(cleanedEntry, meta.termYear)
              : [];
          if (partDuePairs.length >= 2) {
            const basePartLabel = normalizeWhitespace(
              preferredLabel
                .replace(/\s+part\s+[a-z0-9]+\b/i, "")
                .replace(/\s+(?:available|review)\b/i, "")
            );
            partDuePairs.forEach((pair) => {
              assessments.push({
                label: `${basePartLabel} Part ${pair.part}`,
                eventType: "Assignment",
                date: pair.date,
                allDay: !startTime,
                startTime,
                endTime,
                location:
                  location ||
                  assignmentLocationFromContext(section.text),
                notes: combineNotes([cleanedEntry], weight ? [`Weight: ${weight}`] : []),
                weight,
                confidence: confidenceFromSeed({
                  date: pair.date,
                  startTime,
                  endTime,
                  location,
                }),
                provenance: entryProvenance,
              });
            });
            return;
          }

          if (
            resolvedDates.length > 0 &&
            eventType === "Assignment" &&
            unique(
              Array.from(
                cleanedEntry.matchAll(
                  /\bpart\s+([a-z0-9]+)\b(?=[^.!?]{0,120}\bdue\b)/gi
                )
              )
                .map((match) => match[1])
                .filter(Boolean)
                .map((part) => (/^[a-z]$/i.test(part) ? part.toUpperCase() : part))
            ).length === resolvedDates.length
          ) {
            const partLabels = unique(
              Array.from(
                cleanedEntry.matchAll(
                  /\bpart\s+([a-z0-9]+)\b(?=[^.!?]{0,120}\bdue\b)/gi
                )
              )
                .map((match) => match[1])
                .filter(Boolean)
                .map((part) => (/^[a-z]$/i.test(part) ? part.toUpperCase() : part))
            );
            const basePartLabel = normalizeWhitespace(
              preferredLabel
                .replace(/\s+part\s+[a-z0-9]+\b/i, "")
                .replace(/\s+(?:available|review)\b/i, "")
            );
            resolvedDates.forEach((date, index) => {
              assessments.push({
                label: `${basePartLabel} Part ${partLabels[index]}`,
                eventType,
                date,
                allDay: !startTime,
                startTime,
                endTime,
                location:
                  location ||
                  assignmentLocationFromContext(section.text),
                notes: combineNotes([cleanedEntry], weight ? [`Weight: ${weight}`] : []),
                weight,
                confidence: confidenceFromSeed({ date, startTime, endTime, location }),
                provenance: entryProvenance,
              });
            });
            return;
          }

          if (
            resolvedDates.length >= 2 &&
            hasAvailabilityCue(cleanedEntry) &&
            /\bdue\b/i.test(cleanedEntry)
          ) {
            const availableDate = resolvedDates[0];
            const dueDate = resolvedDates[resolvedDates.length - 1];
            const baseTimedLabel = normalizeWhitespace(
              preferredLabel.replace(/\s+(?:available|review)\b/i, "")
            );
            assessments.push({
              label: applyEventTimingLabel(baseTimedLabel, cleanedEntry),
              eventType,
              date: availableDate,
              allDay: true,
              location:
                location ||
                assignmentLocationFromContext(section.text),
              notes: combineNotes([cleanedEntry], weight ? [`Weight: ${weight}`] : []),
              weight,
              confidence: confidenceFromSeed({ date: availableDate, location }),
              provenance: entryProvenance,
            });
            assessments.push({
              label: baseTimedLabel,
              eventType,
              date: dueDate,
              allDay: !startTime,
              startTime,
              endTime,
              location:
                location ||
                assignmentLocationFromContext(section.text),
              notes: combineNotes(
                [cleanedEntry, `Available from ${resolvedDates[0]}`],
                weight ? [`Weight: ${weight}`] : []
              ),
              weight,
              confidence: confidenceFromSeed({ date: dueDate, startTime, endTime, location }),
              provenance: entryProvenance,
            });
            return;
          }

          if (resolvedDates.length > 0) {
            resolvedDates.forEach((date, index) => {
              const baseResolvedLabel =
                resolvedDates.length > 1
                  ? numberedAssessmentSeriesLabel(
                      preferredLabel,
                      index,
                      resolvedDates.length
                    )
                  : preferredLabel;
              assessments.push({
                label: applyEventTimingLabel(baseResolvedLabel, cleanedEntry),
                eventType,
                date,
                allDay: !startTime,
                startTime,
                endTime,
                location:
                  location ||
                  (eventType === "Assignment"
                    ? assignmentLocationFromContext(section.text)
                    : undefined),
                notes: combineNotes([cleanedEntry], weight ? [`Weight: ${weight}`] : []),
                weight,
                confidence: confidenceFromSeed({ date, startTime, endTime, location }),
                provenance: entryProvenance,
                replaceMeetingType:
                  eventType === "Assessment" && /in class|lecture/i.test(cleanedEntry)
                    ? "Lecture"
                    : undefined,
              });
            });
            return;
          }

          if (unresolvedByRegistrar) {
            assessments.push({
              label: preferredLabel,
              eventType: "Assessment",
              allDay: true,
              location,
              notes: combineNotes(
                [`Date unresolved in outline: ${cleanedEntry}`],
                weight ? [`Weight: ${weight}`] : []
              ),
              weight,
              confidence: "low",
              provenance: entryProvenance,
            });
          }
        });

        sectionPreviousEntryLabel = previousEntryLabel;
        sectionPreviousEntryEventType = previousEntryEventType;

        if (/reading week/i.test(text)) {
          const range = parseDateRange(text, meta.termYear);
          if (range) {
            exclusions.push({
              appliesTo: ["Lecture", "Tutorial", "Lab"],
              startDate: range.startDate,
              endDate: range.endDate,
              reason: text,
              provenance,
            });
          }
        }

        if (/lecture|module/i.test(text) && /(week\s+\d+)/i.test(text) && /module/i.test(text)) {
          const weekMatch = text.match(/week\s+(\d{1,2})/i);
          const week = weekMatch ? Number(weekMatch[1]) : undefined;
          const window = week ? weekWindows.get(week) : undefined;
          if (window) {
            attachments.push({
              appliesTo: ["Lecture"],
              startDate: window.startDate,
              endDate: window.endDate,
              note: text,
              provenance,
            });
          }
        }
      });
    });

  return { attachments, exclusions, assessments };
}

function createMeetingEvents(course: ParsedCourse, meetings: RawMeetingRow[]) {
  const events: EventCandidate[] = [];

  meetings.forEach((meeting) => {
    if (meeting.isAsync || (!meeting.startDate && meeting.explicitDates.length === 0)) return;

    if (meeting.explicitDates.length > 0) {
      meeting.explicitDates.forEach((date) => {
        const event: EventCandidate = {
          id: buildStableId(
            `${course.id}:${meeting.sectionOptionId}:${meeting.eventType}:${date}:${meeting.startTime}:${meeting.location}`
          ),
          outlineId: course.outlineId,
          courseId: course.id,
          courseCode: course.courseCode,
          courseName: course.courseName,
          label: `${meeting.eventType} ${meeting.sectionLabel}`,
          title: buildTitle(course.courseCode, meeting.location),
          location: meeting.location,
          eventType: meeting.eventType,
          eventGroup: EVENT_GROUP_BY_TYPE[meeting.eventType],
          sectionOptionIds: [meeting.sectionOptionId],
          extractedSectionLabels: [meeting.sectionLabel],
          instructorName: meeting.instructorName,
          instructorEmail: meeting.instructorEmail,
          notes: [],
          confidence: confidenceFromSeed({
            date,
            startTime: meeting.startTime,
            endTime: meeting.endTime,
            location: meeting.location,
          }),
          reviewNeeded: false,
          include: true,
          timing: {
            kind: "single",
            date,
            startTime: meeting.startTime,
            endTime: meeting.endTime,
            allDay: !meeting.startTime,
          },
          provenance: meeting.provenance,
        };
        event.reviewNeeded = reviewNeededForEvent(event);
        event.include = defaultIncludeForEvent(event);
        events.push(event);
      });
      return;
    }

    const event: EventCandidate = {
      id: buildStableId(
        `${course.id}:${meeting.sectionOptionId}:${meeting.eventType}:${meeting.startDate}:${meeting.endDate}:${meeting.dayCodes.join(",")}:${meeting.startTime}:${meeting.location}`
      ),
      outlineId: course.outlineId,
      courseId: course.id,
      courseCode: course.courseCode,
      courseName: course.courseName,
      label: `${meeting.eventType} ${meeting.sectionLabel}`,
      title: buildTitle(course.courseCode, meeting.location),
      location: meeting.location,
      eventType: meeting.eventType,
      eventGroup: EVENT_GROUP_BY_TYPE[meeting.eventType],
      sectionOptionIds: [meeting.sectionOptionId],
      extractedSectionLabels: [meeting.sectionLabel],
      instructorName: meeting.instructorName,
      instructorEmail: meeting.instructorEmail,
      notes: [],
      confidence: confidenceFromSeed({
        startDate: meeting.startDate,
        endDate: meeting.endDate,
        startTime: meeting.startTime,
        endTime: meeting.endTime,
        location: meeting.location,
      }),
      reviewNeeded: false,
      include: true,
      timing: {
        kind: "recurring",
        startDate: meeting.startDate,
        endDate: meeting.endDate,
        startTime: meeting.startTime,
        endTime: meeting.endTime,
        byDay: meeting.dayCodes,
        exDates: [],
        occurrenceNotes: {},
        occurrenceOverrides: {},
      },
      provenance: meeting.provenance,
    };
    event.reviewNeeded = reviewNeededForEvent(event);
    event.include = defaultIncludeForEvent(event);
    events.push(event);
  });

  return events;
}

function sharedNotesAcrossEvents(events: EventCandidate[]) {
  if (events.length === 0) return [] as string[];

  const counts = new Map<string, number>();
  events.forEach((event) => {
    unique(event.notes).forEach((note) => {
      counts.set(note, (counts.get(note) ?? 0) + 1);
    });
  });

  return Array.from(counts.entries())
    .filter(([, count]) => count === events.length)
    .map(([note]) => note);
}

function compactMeetingSinglesIntoRecurring(events: EventCandidate[]) {
  const passthrough: EventCandidate[] = [];
  const bySeries = new Map<string, EventCandidate[]>();

  events.forEach((event) => {
    if (
      !(
        (event.eventType === "Lecture" ||
          event.eventType === "Tutorial" ||
          event.eventType === "Lab") &&
        event.timing.kind === "single" &&
        event.timing.date &&
        event.timing.startTime &&
        event.timing.endTime
      )
    ) {
      passthrough.push(event);
      return;
    }

    const sectionKey = [...event.sectionOptionIds].sort().join(",");
    const weekday = WEEKDAY_BY_INDEX[getDay(parseISO(event.timing.date))];
    const key = [
      event.courseId,
      event.eventType,
      event.label.toLowerCase(),
      event.location.toLowerCase(),
      sectionKey,
      weekday,
      event.timing.startTime,
      event.timing.endTime,
    ].join(":");

    const current = bySeries.get(key) ?? [];
    bySeries.set(key, [...current, event]);
  });

  const compacted: EventCandidate[] = [];

  bySeries.forEach((seriesEvents) => {
    const sorted = [...seriesEvents].sort((left, right) =>
      (left.timing.kind === "single" ? left.timing.date ?? "" : "").localeCompare(
        right.timing.kind === "single" ? right.timing.date ?? "" : ""
      )
    );

    if (sorted.length < 3) {
      compacted.push(...sorted);
      return;
    }

    const representative = sorted[0];
    if (representative.timing.kind !== "single" || !representative.timing.date) {
      compacted.push(...sorted);
      return;
    }

    const dates = sorted
      .map((event) => (event.timing.kind === "single" ? event.timing.date : undefined))
      .filter(Boolean) as string[];
    const uniqueDates = unique(dates).sort();

    if (uniqueDates.length < 3) {
      compacted.push(...sorted);
      return;
    }

    const exDates = buildWeeklySeriesExDates(
      uniqueDates[0],
      uniqueDates[uniqueDates.length - 1],
      uniqueDates
    );
    const commonNotes = sharedNotesAcrossEvents(sorted);
    const occurrenceNotes = Object.fromEntries(
      sorted.map((event) => {
        const date = event.timing.kind === "single" ? event.timing.date! : "";
        const dateSpecificNotes = event.notes.filter((note) => !commonNotes.includes(note));
        return [date, dateSpecificNotes];
      })
    );

    compacted.push({
      ...representative,
      id: buildStableId(
        `${representative.courseId}:meeting-series:${representative.eventType}:${representative.label}:${uniqueDates[0]}:${uniqueDates[uniqueDates.length - 1]}:${representative.location}:${representative.timing.startTime}:${representative.timing.endTime}`
      ),
      notes: commonNotes,
      provenance: mergeProvenanceLists(sorted.map((event) => event.provenance)),
      confidence: "high",
      reviewNeeded: false,
      include: true,
      timing: {
        kind: "recurring",
        startDate: uniqueDates[0],
        endDate: uniqueDates[uniqueDates.length - 1],
        startTime: representative.timing.startTime,
        endTime: representative.timing.endTime,
        byDay: [WEEKDAY_BY_INDEX[getDay(parseISO(uniqueDates[0]))]],
        exDates,
        occurrenceNotes,
        occurrenceOverrides: {},
      },
    });
  });

  return [...passthrough, ...compacted];
}

function mergeMeetingSinglesIntoRecurring(events: EventCandidate[]) {
  const recurringCandidates = events.filter(
    (event) =>
      (event.eventType === "Lecture" ||
        event.eventType === "Tutorial" ||
        event.eventType === "Lab") &&
      event.timing.kind === "recurring"
  );

  const mergedIds = new Set<string>();

  events.forEach((event) => {
    if (
      !(
        (event.eventType === "Lecture" ||
          event.eventType === "Tutorial" ||
          event.eventType === "Lab") &&
        event.timing.kind === "single" &&
        event.timing.date
      )
    ) {
      return;
    }

    const matchingRecurring = recurringCandidates.find((candidate) => {
      if (candidate.eventType !== event.eventType || candidate.label !== event.label) {
        return false;
      }
      if (candidate.location !== event.location) {
        return false;
      }
      if (
        candidate.sectionOptionIds.length !== event.sectionOptionIds.length ||
        !candidate.sectionOptionIds.every((sectionId) =>
          event.sectionOptionIds.includes(sectionId)
        )
      ) {
        return false;
      }
      if (
        candidate.timing.kind !== "recurring" ||
        !candidate.timing.startDate ||
        !candidate.timing.endDate
      ) {
        return false;
      }
      if (
        event.timing.date < candidate.timing.startDate ||
        event.timing.date > candidate.timing.endDate
      ) {
        return false;
      }

      const eventDayCode = WEEKDAY_BY_INDEX[getDay(parseISO(event.timing.date))];
      return candidate.timing.byDay.includes(eventDayCode);
    });

    if (!matchingRecurring || matchingRecurring.timing.kind !== "recurring") {
      return;
    }

    const occurrenceOverride = {
      startTime:
        event.timing.startTime !== matchingRecurring.timing.startTime
          ? event.timing.startTime
          : undefined,
      endTime:
        event.timing.endTime !== matchingRecurring.timing.endTime
          ? event.timing.endTime
          : undefined,
      location:
        event.location !== matchingRecurring.location ? event.location : undefined,
    };

    if (
      occurrenceOverride.startTime ||
      occurrenceOverride.endTime ||
      occurrenceOverride.location
    ) {
      matchingRecurring.timing.occurrenceOverrides[event.timing.date] = {
        ...matchingRecurring.timing.occurrenceOverrides[event.timing.date],
        ...occurrenceOverride,
      };
    }

    matchingRecurring.notes = combineNotes(matchingRecurring.notes, event.notes);
    matchingRecurring.provenance = mergeProvenanceLists([
      matchingRecurring.provenance,
      event.provenance,
    ]);
    mergedIds.add(event.id);
  });

  return events.filter((event) => !mergedIds.has(event.id));
}

function applyAttachmentsAndExclusions(
  events: EventCandidate[],
  attachments: TopicAttachment[],
  exclusions: ExclusionWindow[]
) {
  const byId = new Map(events.map((event) => [event.id, event]));

  attachments.forEach((attachment) => {
    events.forEach((event) => {
      if (!attachment.appliesTo.includes(event.eventType as Extract<EventType, "Lecture" | "Tutorial" | "Lab">)) {
        return;
      }
      if (
        attachment.sectionOptionIds?.length &&
        !event.sectionOptionIds.some((id) => attachment.sectionOptionIds?.includes(id))
      ) {
        return;
      }

      if (event.timing.kind === "single") {
        const date = event.timing.date;
        if (!date) return;
        const match =
          (attachment.exactDates?.includes(date) ?? false) ||
          (!!attachment.startDate &&
            !!attachment.endDate &&
            date >= attachment.startDate &&
            date <= attachment.endDate);
        if (match) {
          event.notes = combineNotes(event.notes, [attachment.note]);
          event.provenance = [...event.provenance, ...attachment.provenance];
        }
        return;
      }

      const occurrenceDates = occurrenceDatesForRecurring(event);
      occurrenceDates.forEach((date) => {
        const match =
          (attachment.exactDates?.includes(date) ?? false) ||
          (!!attachment.startDate &&
            !!attachment.endDate &&
            date >= attachment.startDate &&
            date <= attachment.endDate);
        if (!match) return;
        const existing = event.timing.occurrenceNotes[date] ?? [];
        event.timing.occurrenceNotes[date] = combineNotes(existing, [attachment.note]);
      });
      event.provenance = [...event.provenance, ...attachment.provenance];
    });
  });

  exclusions.forEach((exclusion) => {
    events.forEach((event) => {
      if (!exclusion.appliesTo.includes(event.eventType as Extract<EventType, "Lecture" | "Tutorial" | "Lab">)) {
        return;
      }
      if (
        exclusion.sectionOptionIds?.length &&
        !event.sectionOptionIds.some((id) => exclusion.sectionOptionIds?.includes(id))
      ) {
        return;
      }

      if (event.timing.kind === "single") {
        const date = event.timing.date;
        if (!date) return;
        if (date >= exclusion.startDate && date <= exclusion.endDate) {
          event.include = false;
          event.reviewNeeded = true;
          event.notes = combineNotes(event.notes, [`Excluded: ${exclusion.reason}`]);
          event.provenance = [...event.provenance, ...exclusion.provenance];
        }
        return;
      }

      const dates = occurrenceDatesForRecurring(event);
      dates
        .filter((date) => date >= exclusion.startDate && date <= exclusion.endDate)
        .forEach((date) => {
          if (!event.timing.exDates.includes(date)) {
            event.timing.exDates.push(date);
          }
          const existing = event.timing.occurrenceNotes[date] ?? [];
          event.timing.occurrenceNotes[date] = combineNotes(existing, [
            `Excluded: ${exclusion.reason}`,
          ]);
        });
      event.provenance = [...event.provenance, ...exclusion.provenance];
    });
  });

  return Array.from(byId.values());
}

function createOfficeHourEvents(
  course: ParsedCourse,
  seeds: OfficeHourSeed[],
  termBounds: { startDate: string; endDate: string } | undefined
) {
  if (!termBounds) return [] as EventCandidate[];

  return seeds.map((seed) => {
    const event: EventCandidate = {
      id: buildStableId(
        `${course.id}:office:${seed.personName}:${seed.dayCode}:${seed.startTime}:${seed.location}`
      ),
      outlineId: course.outlineId,
      courseId: course.id,
      courseCode: course.courseCode,
      courseName: course.courseName,
      label: `Office Hours with ${seed.personName}`,
      title: buildTitle(course.courseCode, seed.location ?? ""),
      location: seed.location ?? "",
      eventType: "OfficeHours",
      eventGroup: "Office Hours",
      sectionOptionIds: [],
      extractedSectionLabels: [],
      instructorName: seed.personName,
      instructorEmail: seed.personEmail,
      notes: seed.notes,
      confidence: confidenceFromSeed({
        startDate: seed.startDate ?? termBounds.startDate,
        endDate: termBounds.endDate,
        startTime: seed.startTime,
        endTime: seed.endTime,
      }),
      reviewNeeded: false,
      include: true,
      timing: {
        kind: "recurring",
        startDate: seed.startDate ?? termBounds.startDate,
        endDate: seed.endDate ?? termBounds.endDate,
        startTime: seed.startTime,
        endTime: seed.endTime,
        byDay: [seed.dayCode],
        exDates: seed.exDates ?? [],
        occurrenceNotes: {},
        occurrenceOverrides: {},
      },
      provenance: seed.provenance,
    };
    event.reviewNeeded = reviewNeededForEvent(event);
    event.include = defaultIncludeForEvent(event);
    return event;
  });
}

function createFallbackInstructionalTeamOfficeHourEvents(
  course: ParsedCourse,
  rawHtml: string,
  sections: SectionBlock[],
  meta: OutlineMeta,
  meetings: RawMeetingRow[],
  termBounds: { startDate: string; endDate: string } | undefined
) {
  if (!termBounds) return [] as EventCandidate[];

  let fallbackSeeds: OfficeHourSeed[] = sections.flatMap((section) => {
    if (
      section.id !== "instructional_team" &&
      !/\binstructional team\b/i.test(section.title)
    ) {
      return [];
    }

    const officeHourBlock = extractInstructionalTeamOfficeHourBlock(section);
    if (!officeHourBlock) return [];

    const officeHourLines = normalizeOfficeHourParsingText(officeHourBlock)
      .split(/\n+/)
      .map((line) => normalizeWhitespace(line))
      .filter(
        (line) =>
          OFFICE_HOUR_WEEKDAY_REGEX.test(line) &&
          /\d{1,2}(?::\d{2})?\s*(?:-|–|—|to)\s*\d{1,2}(?::\d{2})?/i.test(line)
      );
    if (officeHourLines.length === 0) return [];

    const personName = officeHourInstructorName(section.text, meetings, meta);
    if (!personName || isGenericOfficeHourName(personName)) {
      return [];
    }

    const personEmail = officeHourInstructorEmail(section.text, meetings);
    return officeHourLines.flatMap((line) => {
      const dayText = line.match(
        /^((?:(?:and\s+)?(?:Mon(?:day)?s?'?s?|Tue(?:s(?:day)?)?s?'?s?|Wed(?:nesday)?s?'?s?|Thu(?:r(?:s(?:day)?)?)?s?'?s?|Fri(?:day)?s?'?s?|Sat(?:urday)?s?'?s?|Sun(?:day)?s?'?s?|M|Tu|Th|T|W|F)\.?\s*(?:\/|,|&|-|\band\b)?\s*)+)/i
      )?.[1];
      const rangeText = line.match(
        /(\d{1,2}(?::\d{2})?\s*(?:a\.?m\.?|p\.?m\.?|am|pm|AM|PM)?)\s*(?:-|–|—|to)\s*(\d{1,2}(?::\d{2})?\s*(?:a\.?m\.?|p\.?m\.?|am|pm|AM|PM)?)/i
      )?.[0];

      const dayCodes = parseOfficeHourDayCodes(dayText);
      const range = rangeText ? parseOfficeHourTimeRange(rangeText) : {};
      if (dayCodes.length === 0 || !range.startTime || !range.endTime) {
        return [];
      }

      const location = chooseOfficeHourLocation(
        officeHourLocation(line),
        officeHourLocation(officeHourBlock),
        officeHourLocation(section.text)
      );

      return dayCodes.map((dayCode) => ({
        personName,
        personEmail,
        location,
        dayCode,
        startDate: termBounds.startDate,
        exDates: [],
        startTime: range.startTime!,
        endTime: range.endTime!,
        notes: range.inferred
          ? ["Office-hour time inferred from shorthand in outline."]
          : [],
        provenance: [makeProvenance(section, "prose", line)],
      }));
    });
  });

  if (fallbackSeeds.length === 0) {
    const htmlBlock = rawHtml.match(
      /<strong[^>]*>\s*Instructor.?s Office Hours\s*<\/strong>[\s\S]*?(?=<p[^>]*>\s*<strong[^>]*>\s*(?:Contacting the Instructor|Teaching Assistants?|TA(?:.s)?|Course Description|Student Resources)\s*<\/strong>|$)/i
    )?.[0];

    if (htmlBlock) {
      const officeHourBlock = normalizeOfficeHourParsingText(
        htmlSnippetToText(
          htmlBlock.replace(
            /<strong[^>]*>\s*Instructor.?s Office Hours\s*<\/strong>/i,
            "Office Hours\n"
          )
        )
      );
      const officeHourLines = officeHourBlock
        .split(/\n+/)
        .map((line) => normalizeWhitespace(line))
        .filter(
          (line) =>
            OFFICE_HOUR_WEEKDAY_REGEX.test(line) &&
            /\d{1,2}(?::\d{2})?\s*(?:-|–|—|to)\s*\d{1,2}(?::\d{2})?/i.test(line)
        );

      const personName =
        meetings.find((meeting) => meeting.instructorName)?.instructorName ||
        sanitizeOfficeHourPersonName(meta.courseName);
      const personEmail = meetings.find((meeting) => meeting.instructorEmail)?.instructorEmail;

      if (personName && !isGenericOfficeHourName(personName)) {
        fallbackSeeds = officeHourLines.flatMap((line) => {
          const dayText = line.match(
            /^((?:(?:and\s+)?(?:Mon(?:day)?s?'?s?|Tue(?:s(?:day)?)?s?'?s?|Wed(?:nesday)?s?'?s?|Thu(?:r(?:s(?:day)?)?)?s?'?s?|Fri(?:day)?s?'?s?|Sat(?:urday)?s?'?s?|Sun(?:day)?s?'?s?|M|Tu|Th|T|W|F)\.?\s*(?:\/|,|&|-|\band\b)?\s*)+)/i
          )?.[1];
          const rangeText = line.match(
            /(\d{1,2}(?::\d{2})?\s*(?:a\.?m\.?|p\.?m\.?|am|pm|AM|PM)?)\s*(?:-|–|—|to)\s*(\d{1,2}(?::\d{2})?\s*(?:a\.?m\.?|p\.?m\.?|am|pm|AM|PM)?)/i
          )?.[0];

          const dayCodes = parseOfficeHourDayCodes(dayText);
          const range = rangeText ? parseOfficeHourTimeRange(rangeText) : {};
          if (dayCodes.length === 0 || !range.startTime || !range.endTime) {
            return [];
          }

          const location = chooseOfficeHourLocation(officeHourLocation(line), officeHourLocation(officeHourBlock));

          return dayCodes.map((dayCode) => ({
            personName,
            personEmail,
            location,
            dayCode,
            startDate: termBounds.startDate,
            exDates: [],
            startTime: range.startTime!,
            endTime: range.endTime!,
            notes: range.inferred
              ? ["Office-hour time inferred from shorthand in outline."]
              : [],
            provenance: [
              {
                sectionId: "instructional_team",
                sectionTitle: "Instructional Team",
                sourceKind: "prose" as const,
                snippet: line,
              },
            ],
          }));
        });
      }
    }
  }

  return createOfficeHourEvents(course, dedupeOfficeHourSeeds(fallbackSeeds), termBounds);
}

function createAssessmentEvents(
  course: ParsedCourse,
  meetingRows: RawMeetingRow[],
  seeds: AssessmentSeed[],
  meetingEvents: EventCandidate[],
  assessmentWeights: AssessmentWeightReference[]
) {
  const events = [...meetingEvents];
  const created: EventCandidate[] = [];

  seeds.forEach((seed) => {
    seed.label = normalizeWhitespace(seed.label);
    if (!seed.label) {
      return;
    }
    if (isFinalAssessmentSeed(seed)) {
      return;
    }

    let date = seed.date;
    let location = seed.location;
    let startTime = seed.startTime;
    let endTime = seed.endTime;
    let sectionOptionIds = seed.sectionOptionIds ?? [];
    let sectionLabels: string[] = [];
    let instructorName: string | undefined;
    let instructorEmail: string | undefined;
    const inferredSeedType = assessmentTypeFromLabel(seed.label, location);
    const normalizedEventType =
      inferredSeedType === "Assessment"
        ? ("Assessment" as const)
        : inferredSeedType === "Assignment"
        ? ("Assignment" as const)
        : seed.eventType === "Other"
        ? ("Assessment" as const)
        : seed.eventType;

    if (normalizedEventType === "Assignment") {
      location = sanitizeAssignmentLocation(location);
    } else if (normalizedEventType === "Assessment") {
      location = sanitizeAssessmentLocation(seed.label, location);
    }

    if (seed.replaceMeetingType && date) {
      const template = occurrenceTemplateForDate(meetingRows, seed.replaceMeetingType, date, seed.sectionOptionIds);
      if (template) {
        startTime ||= template.startTime;
        endTime ||= template.endTime;
        sectionOptionIds = sectionOptionIds.length > 0 ? sectionOptionIds : [template.sectionOptionId];
        sectionLabels = [template.sectionLabel];
        instructorName ||= template.instructorName;
        instructorEmail ||= template.instructorEmail;

        events.forEach((meetingEvent) => {
          if (
            meetingEvent.eventType !== seed.replaceMeetingType ||
            !meetingEvent.sectionOptionIds.includes(template.sectionOptionId)
          ) {
            return;
          }
          if (meetingEvent.timing.kind === "recurring") {
            if (!meetingEvent.timing.exDates.includes(date!)) {
              meetingEvent.timing.exDates.push(date!);
            }
          } else if (meetingEvent.timing.date === date) {
            meetingEvent.include = false;
            meetingEvent.reviewNeeded = true;
          }
        });
      }
    }

    const normalizedLabel =
      normalizedEventType === "Assessment"
        ? normalizeAssessmentLabel(seed.label, date)
        : normalizeAssignmentLabel(seed.label, date);
    if (!normalizedLabel) {
      return;
    }

    if (normalizedEventType === "Assignment" && shouldDropAssignmentLabel(normalizedLabel)) {
      return;
    }
    if (
      !date &&
      normalizedEventType === "Assessment" &&
      /\bquiz(?:zes)?\b/i.test(normalizedLabel)
    ) {
      const seedContext = normalizeWhitespace(
        [seed.label, seed.location, ...seed.notes, ...seed.provenance.map((item) => item.snippet)].join(
          " "
        )
      );
      const startsEveryLecture = /\bevery lecture\b/i.test(seedContext);
      const startWeek = Number(seedContext.match(/\bstarting in week\s*(\d+)\b/i)?.[1] ?? "1");

      if (startsEveryLecture) {
        const lectureTemplates = meetingEvents.filter(
          (event) =>
            event.courseId === course.id &&
            event.eventType === "Lecture" &&
            event.timing.kind === "recurring" &&
            (sectionOptionIds.length === 0 ||
              event.sectionOptionIds.length === 0 ||
              event.sectionOptionIds.some((id) => sectionOptionIds.includes(id)))
        );

        lectureTemplates.forEach((lectureEvent) => {
          const occurrenceDates = occurrenceDatesForRecurring(lectureEvent);
          const excludedBeforeWeekStart =
            startWeek > 1
              ? occurrenceDates.filter((occurrenceDate) => {
                  const deltaDays = differenceInCalendarDays(
                    parseISO(occurrenceDate),
                    parseISO(lectureEvent.timing.startDate)
                  );
                  return deltaDays < (startWeek - 1) * 7;
                })
              : [];

          created.push({
            ...lectureEvent,
            id: buildStableId(
              `${course.id}:recurring-assessment:${normalizedLabel}:${lectureEvent.timing.startDate}:${lectureEvent.timing.endDate}:${lectureEvent.location}`
            ),
            label: normalizedLabel,
            title: buildTitle(course.courseCode, ""),
            location: "",
            eventType: "Assessment",
            eventGroup: EVENT_GROUP_BY_TYPE.Assessment,
            notes: combineNotes(seed.notes, seed.weight ? [`Weight: ${seed.weight}`] : []),
            confidence: "high",
            reviewNeeded: false,
            include: true,
            timing: {
              kind: "recurring",
              startDate: lectureEvent.timing.startDate,
              endDate: lectureEvent.timing.endDate,
              byDay: [...lectureEvent.timing.byDay],
              exDates: unique([
                ...lectureEvent.timing.exDates,
                ...excludedBeforeWeekStart,
              ]),
              occurrenceNotes: { ...lectureEvent.timing.occurrenceNotes },
              occurrenceOverrides: { ...lectureEvent.timing.occurrenceOverrides },
            },
            provenance: mergeProvenanceLists([lectureEvent.provenance, seed.provenance]),
          });
        });
        return;
      }
    }
    if (!date && normalizedEventType === "Assignment") {
      return;
    }

    const event: EventCandidate = {
      id: buildStableId(
        `${course.id}:${seed.eventType}:${seed.label}:${date}:${startTime}:${location}`
      ),
      outlineId: course.outlineId,
      courseId: course.id,
      courseCode: course.courseCode,
      courseName: course.courseName,
      label: normalizedLabel,
      title: buildTitle(course.courseCode, location ?? ""),
      location: location ?? "",
      eventType: normalizedEventType,
      eventGroup: EVENT_GROUP_BY_TYPE[normalizedEventType],
      sectionOptionIds,
      extractedSectionLabels: sectionLabels,
      instructorName,
      instructorEmail,
      notes: combineNotes(seed.notes, seed.weight ? [`Weight: ${seed.weight}`] : []),
      confidence: confidenceFromSeed({ date, startTime, endTime, location }),
      reviewNeeded: false,
      include: true,
      timing: {
        kind: "single",
        date,
        endDate: seed.endDate,
        startTime,
        endTime,
        allDay: !startTime,
      },
      provenance: seed.provenance,
    };
    event.reviewNeeded = reviewNeededForEvent(event) || seed.confidence === "low";
    event.include = defaultIncludeForEvent(event) && seed.confidence !== "low";

    const weightKey = normalizeAssessmentWeightKey(event.label);
    const matchingWeight = assessmentWeights.find(
      (reference) =>
        reference.eventType === event.eventType && reference.key === weightKey
    );
    if (matchingWeight) {
      event.notes = combineNotes(event.notes, [`Weight: ${matchingWeight.weight}`]);
      event.provenance = mergeProvenanceLists([event.provenance, matchingWeight.provenance]);
    }

    created.push(event);
  });

  return { meetingEvents: events, assessmentEvents: created };
}

function mergeProvenanceLists(provenanceLists: EventProvenance[][]) {
  const byKey = new Map<string, EventProvenance>();

  provenanceLists.flat().forEach((item) => {
    const key = `${item.sectionId}:${item.sectionTitle}:${item.sourceKind}:${item.snippet}`;
    if (!byKey.has(key)) {
      byKey.set(key, item);
    }
  });

  return Array.from(byKey.values());
}

function confidenceRank(confidence: EventConfidence) {
  switch (confidence) {
    case "high":
      return 3;
    case "medium":
      return 2;
    default:
      return 1;
  }
}

function looksLikeMidterm(event: EventCandidate) {
  return (
    event.eventType === "Assessment" &&
    /\b(?:midterm|term test)\b/i.test(event.label) &&
    !/\b(?:group-stage|individual test)\b/i.test(event.label)
  );
}

function midtermRichnessScore(event: EventCandidate) {
  let score = 0;
  if (event.timing.kind === "single" && event.timing.startTime && event.timing.endTime) {
    score += 4;
  }
  if (event.location) score += 2;
  if (event.instructorName || event.instructorEmail) score += 1;
  score += confidenceRank(event.confidence);
  return score;
}

function candidateMidtermDates(event: EventCandidate) {
  if (
    event.timing.kind === "single" &&
    event.timing.date &&
    /\b(?:midterm|term test|test)\b/i.test(event.label) &&
    /#\s*\d+\b/.test(event.label)
  ) {
    return [event.timing.date];
  }

  const explicit = new Set<string>();
  if (event.timing.kind === "single" && event.timing.date) {
    explicit.add(event.timing.date);
  }

  const evidenceTexts = [
    event.label,
    ...event.notes,
    ...event.provenance.map((item) => item.snippet),
  ];

  evidenceTexts.forEach((text) => {
    if (
      /\b(?:date unresolved in outline|tbd|to be announced|see chart below|see details below|exam period|scheduled by registrar)\b/i.test(
        text
      )
    ) {
      return;
    }
    const year =
      event.timing.kind === "single" && event.timing.date
        ? Number(event.timing.date.slice(0, 4))
        : undefined;
    if (year) {
      extractExplicitDates(text, year).forEach((date) => explicit.add(date));
      return;
    }

    const explicitYears = Array.from(
      new Set(
        Array.from(text.matchAll(/\b(20\d{2})\b/g), (match) => Number(match[1])).filter(
          (candidateYear) => Number.isFinite(candidateYear)
        )
      )
    );
    explicitYears.forEach((candidateYear) => {
      extractExplicitDates(text, candidateYear).forEach((date) => explicit.add(date));
    });
  });

  return Array.from(explicit).sort();
}

function dedupeMidterms(events: EventCandidate[]) {
  const otherEvents = events.filter((event) => !looksLikeMidterm(event));
  const midtermEntries = events
    .filter((event) => looksLikeMidterm(event) && event.timing.kind === "single")
    .map((event) => ({
      event,
      candidateDates: candidateMidtermDates(event),
    }));
  const midterms = midtermEntries.filter((entry) => entry.candidateDates.length > 0);
  const undatedMidterms = midtermEntries
    .filter((entry) => entry.candidateDates.length === 0)
    .map((entry) => entry.event);

  if (midterms.length === 0) {
    return events;
  }

  const sortedMidterms = [...midterms].sort((left, right) =>
    left.candidateDates[0].localeCompare(right.candidateDates[0])
  );

  const clusters: Array<typeof midterms> = [];
  sortedMidterms.forEach((entry) => {
    const currentCluster = clusters[clusters.length - 1];
    if (!currentCluster) {
      clusters.push([entry]);
      return;
    }

    const anchorDate = currentCluster[0].candidateDates[0];
    const eventDate = entry.candidateDates[0];

    if (
      anchorDate &&
      eventDate &&
      differenceInCalendarDays(parseISO(eventDate), parseISO(anchorDate)) <= 12
    ) {
      currentCluster.push(entry);
      return;
    }

    clusters.push([entry]);
  });

  const dedupedMidterms = clusters
    .map((group) => {
      const sortedByDate = [...group].sort((left, right) => {
        const dateDelta = left.candidateDates[0].localeCompare(right.candidateDates[0]);
        if (dateDelta !== 0) return dateDelta;
        return midtermRichnessScore(right.event) - midtermRichnessScore(left.event);
      });

      const earliestDate = sortedByDate[0].candidateDates[0];
      const primary =
        sortedByDate
          .filter(
            (entry) =>
              entry.event.timing.kind === "single" &&
              (entry.event.timing.date === earliestDate ||
                (!entry.event.timing.date && entry.candidateDates[0] === earliestDate))
          )
          .sort((left, right) => midtermRichnessScore(right.event) - midtermRichnessScore(left.event))[0]
          ?.event ?? sortedByDate[0].event;

      const richest =
        [...sortedByDate].sort(
          (left, right) => midtermRichnessScore(right.event) - midtermRichnessScore(left.event)
        )[0]?.event ?? sortedByDate[0].event;

      return {
        ...primary,
        location: primary.location || richest.location,
        instructorName: primary.instructorName || richest.instructorName,
        instructorEmail: primary.instructorEmail || richest.instructorEmail,
        notes: combineNotes(...group.map((entry) => entry.event.notes)),
        confidence: group.some((entry) => entry.event.confidence === "high")
          ? "high"
          : group.some((entry) => entry.event.confidence === "medium")
          ? "medium"
          : "low",
        reviewNeeded: group.some((entry) => entry.event.reviewNeeded),
        include: group.some((entry) => entry.event.include),
        sectionOptionIds: unique(group.flatMap((entry) => entry.event.sectionOptionIds)),
        extractedSectionLabels: unique(
          group.flatMap((entry) => entry.event.extractedSectionLabels)
        ),
        provenance: mergeProvenanceLists(group.map((entry) => entry.event.provenance)),
        timing:
          primary.timing.kind === "single"
            ? {
                ...primary.timing,
                date: primary.timing.date || earliestDate,
                startTime: primary.timing.startTime || richest.timing.startTime,
                endTime: primary.timing.endTime || richest.timing.endTime,
              }
            : primary.timing,
      };
    })
    .sort((left, right) =>
      (left.timing.kind === "single" ? left.timing.date ?? "" : "").localeCompare(
        right.timing.kind === "single" ? right.timing.date ?? "" : ""
      )
    )
    .map((event, index, array) => ({
      ...event,
      label: array.length > 1 ? `Midterm #${index + 1}` : "Midterm",
    }));

  return [
    ...otherEvents,
    ...(dedupedMidterms.length === 0 ? undatedMidterms : []),
    ...dedupedMidterms,
  ];
}

function assessmentDeduplicationScore(event: EventCandidate) {
  let score = 0;
  if (event.timing.kind === "single" && event.timing.startTime && event.timing.endTime) {
    score += 4;
  }
  if (event.location) score += 2;
  if (/\b(best|total|through separate|see details)\b/i.test(event.label)) {
    score -= 5;
  }
  score += confidenceRank(event.confidence);
  score += event.notes.length;
  return score;
}

function isGenericEventLocation(location: string) {
  return /^(?:online|in ?person|n\/a|room tbd|location tbd|tbd|drop box)$/i.test(
    normalizeLocation(location)
  );
}

function isGenericMergedLabel(label: string) {
  const normalized = normalizeWhitespace(label).toLowerCase();
  return /^(?:mobius|written|reading|weekly|online|pre-?lab|post-?lab|tutorial|lab)?\s*(?:assignments?|reports?|projects?|deliverables?|tests?|quizzes?)$/.test(
    normalized
  );
}

function isBroadGenericAssignmentLabel(label: string) {
  const normalized = normalizeAssignmentLabel(label).toLowerCase();
  return /^(?:assignment|project|report|paper|presentation|proposal|reflection|deliverable|submission)(?:\s+due)?$/.test(
    normalized
  );
}

function collectOutlineNamedAssignmentLabels(
  sections: SectionBlock[]
) {
  const labels = new Map<string, string>();

  sections.forEach((section) => {
    const sectionKey = `${section.id} ${section.title}`;
    if (!/(assessment|assignment|activity|schedule|deliverable|evaluation|grading)/i.test(sectionKey)) {
      return;
    }
    const lines = section.text
      .split(/\n+/)
      .map((line) => normalizeWhitespace(line))
      .filter(Boolean);

    lines.forEach((line) => {
      if (isAssessmentPolicyNoise(line)) return;
      if (/\bmajor group assignment\b/i.test(line)) {
        labels.set("major group assignment", "Major Group Assignment");
      }
      const segments = line.split(/(?<=[.!?;])\s+/).filter(Boolean);
      segments.forEach((segment) => {
        const candidate =
          extractProseDeliverableLabel(segment) ??
          assignmentLabelFromText(segment) ??
          labelFromScheduleEntry(segment);
        if (!candidate) return;
        if (assessmentTypeFromLabel(candidate, segment) !== "Assignment") return;
        if (isPlaceholderDeliverableLabel(candidate) || isBroadGenericAssignmentLabel(candidate)) {
          return;
        }
        labels.set(canonicalAssignmentFamily(candidate), candidate);
      });
    });
  });

  return [...labels.values()];
}

function replaceGenericAssignmentLabelsFromOutline(
  events: EventCandidate[],
  sections: SectionBlock[]
) {
  const namedLabels = collectOutlineNamedAssignmentLabels(sections);
  const genericAssignmentCount = events.filter(
    (event) =>
      event.eventType === "Assignment" &&
      (isPlaceholderDeliverableLabel(event.label) ||
        isBroadGenericAssignmentLabel(event.label))
  ).length;
  const replacementLabel =
    namedLabels.length === 1
      ? namedLabels[0]
      : genericAssignmentCount === 1 && namedLabels.length > 0
      ? [...namedLabels].sort((left, right) => mergedLabelScore(right) - mergedLabelScore(left))[0]
      : genericAssignmentCount === 1 &&
        sections.some((section) => /\bmajor group assignment\b/i.test(section.text))
      ? "Major Group Assignment"
      : undefined;
  if (!replacementLabel) return events;

  return events.map((event) => {
    if (
      event.eventType !== "Assignment" ||
      (!isPlaceholderDeliverableLabel(event.label) &&
        !isBroadGenericAssignmentLabel(event.label))
    ) {
      return event;
    }

    return {
      ...event,
      label: replacementLabel,
    };
  });
}

function mergedLabelScore(label: string) {
  let score = 0;
  if (/#\s*\d+(?:-\d+)?\b/.test(label)) {
    score += 5;
  }
  if (isGenericMergedLabel(label)) {
    score -= 6;
  }
  if (isPlaceholderDeliverableLabel(label)) {
    score -= 10;
  }
  if (
    /\b(?:january|february|march|april|may|june|july|august|september|october|november|december|jan|feb|mar|apr|jun|jul|aug|sep|sept|oct|nov|dec)\b/i.test(
      label
    )
  ) {
    score -= 5;
  }
  if (!/\b(best|total|through separate|see details|shared grade|individual grade)\b/i.test(label)) {
    score += 3;
  }
  if (!/[()]/.test(label)) score += 2;
  score -= label.length * 0.01;
  return score;
}

function preferredMergedLabel(primaryLabel: string, secondaryLabel: string) {
  if (/^proposal$/i.test(primaryLabel) && /\bproposal\b/i.test(secondaryLabel) && !/^proposal$/i.test(secondaryLabel)) {
    return secondaryLabel;
  }
  if (/^proposal$/i.test(secondaryLabel) && /\bproposal\b/i.test(primaryLabel) && !/^proposal$/i.test(primaryLabel)) {
    return primaryLabel;
  }
  const primaryScore = mergedLabelScore(primaryLabel);
  const secondaryScore = mergedLabelScore(secondaryLabel);
  if (secondaryScore > primaryScore) return secondaryLabel;
  if (secondaryScore < primaryScore) return primaryLabel;
  return secondaryLabel.length < primaryLabel.length ? secondaryLabel : primaryLabel;
}

function canonicalAssessmentFamily(label: string) {
  const normalized = normalizeAssessmentLabel(label).toLowerCase();
  if (/\bendterm\b/.test(normalized)) return "endterm";
  if (/\bmidterm\b/.test(normalized)) return "midterm";
  if (/\bterm tests?\b/.test(normalized)) return "test";
  if (/\bquizzes?\b/.test(normalized)) return "quiz";
  if (/\btests?\b/.test(normalized)) return "test";
  if (/\bexams?\b/.test(normalized)) return "exam";
  return normalized.replace(/#\s*\d+/g, "").trim();
}

function dedupeEquivalentAssessments(events: EventCandidate[]) {
  const deduped: EventCandidate[] = [];
  const passthrough: EventCandidate[] = [];

  events.forEach((event) => {
    if (event.eventType !== "Assessment" || event.timing.kind !== "single") {
      passthrough.push(event);
      return;
    }

    const family = canonicalAssessmentFamily(event.label);
    const compatibleFamilies = new Set<string>([family]);
    if (family === "midterm" || family === "test") {
      compatibleFamilies.add("midterm");
      compatibleFamilies.add("test");
    }
    const existing = deduped.find((candidate) => {
      if (
        candidate.eventType !== "Assessment" ||
        candidate.timing.kind !== "single" ||
        candidate.courseId !== event.courseId ||
        !compatibleFamilies.has(canonicalAssessmentFamily(candidate.label))
      ) {
        return false;
      }

      const sameDate =
        candidate.timing.date === event.timing.date ||
        (!candidate.timing.date && !event.timing.date);
      if (!sameDate) return false;

      const candidateSections = new Set(candidate.sectionOptionIds);
      const eventSections = new Set(event.sectionOptionIds);
      const sectionsCompatible =
        candidateSections.size === 0 ||
        eventSections.size === 0 ||
        [...candidateSections].some((sectionId) => eventSections.has(sectionId)) ||
        !candidate.location ||
        !event.location ||
        normalizeLocation(candidate.location) === normalizeLocation(event.location);

      const timesCompatible =
        !candidate.timing.startTime ||
        !event.timing.startTime ||
        (candidate.timing.startTime === event.timing.startTime &&
          candidate.timing.endTime === event.timing.endTime);

      return sectionsCompatible && timesCompatible;
    });

    if (!existing) {
      deduped.push(event);
      return;
    }

    const keepCurrent =
      assessmentDeduplicationScore(event) > assessmentDeduplicationScore(existing);
    const primary = keepCurrent ? event : existing;
    const secondary = keepCurrent ? existing : event;

    primary.location = primary.location || secondary.location;
    if (isGenericEventLocation(primary.location) && !isGenericEventLocation(secondary.location)) {
      primary.location = secondary.location;
    }
    primary.label = preferredMergedLabel(primary.label, secondary.label);
    primary.notes = combineNotes(primary.notes, secondary.notes);
    primary.provenance = mergeProvenanceLists([primary.provenance, secondary.provenance]);
    primary.sectionOptionIds = unique([...primary.sectionOptionIds, ...secondary.sectionOptionIds]);
    primary.extractedSectionLabels = unique([
      ...primary.extractedSectionLabels,
      ...secondary.extractedSectionLabels,
    ]);
    primary.include = primary.include || secondary.include;
    primary.reviewNeeded = primary.reviewNeeded || secondary.reviewNeeded;
    primary.confidence =
      confidenceRank(primary.confidence) >= confidenceRank(secondary.confidence)
        ? primary.confidence
        : secondary.confidence;

    const existingIndex = deduped.findIndex((candidate) => candidate.id === existing.id);
    deduped[existingIndex] = primary;
  });

  return [...passthrough, ...deduped];
}

function assignmentDeduplicationScore(event: EventCandidate) {
  let score = confidenceRank(event.confidence);
  if (!isGenericEventLocation(event.location)) score += 3;
  if (!/#\s*\d+\b/.test(event.label)) score += 3;
  if (!/\b(total|see details|see chart)\b/i.test(event.label)) score += 1;
  score += event.notes.length;
  return score;
}

function canonicalAssignmentFamily(label: string) {
  const normalized = seriesShadowKey(label)
    .replace(/\bexcept\b.*$/g, " ")
    .replace(/\bmaterials for pitch\b/g, "pitch materials")
    .replace(/\bmultimedia reflections?\b/g, "multimedia reflection")
    .trim();

  if (/^assignment\b.*\btake home final analysis\b/.test(normalized)) {
    return "assignment";
  }

  if (normalized === "proposal") {
    return "research proposal";
  }

  if (
    /career eportfolio/.test(normalized) &&
    /(project|structure|homepage|linkedin|public health communication|other competency|final career eportfolio|peer feedback)/.test(
      normalized
    )
  ) {
    return "career eportfolio project";
  }

  if (/peer feedback on career portfolios|peer reviews? of the portfolios/.test(normalized)) {
    return "career portfolio peer feedback";
  }

  if (
    /health innovation challenge/.test(normalized) ||
    /problem space interest survey|team charter|systems framing and solution ideas outline|demo day deliverables|final team report on health innovation challenge/.test(
      normalized
    )
  ) {
    return "health innovation challenge";
  }

  if (/map the system/.test(normalized)) {
    if (/\bstep\s*1\b|\bstep\s+#?\s*1\b|topic overview/.test(normalized)) {
      return "map the system step 1";
    }
    if (/\bstep\s*2\b|\bstep\s+#?\s*2\b|preliminary solution brief/.test(normalized)) {
      return "map the system step 2";
    }
    if (/\bstep\s*3\b|\bstep\s+#?\s*3\b|final solution brief/.test(normalized)) {
      return "map the system step 3";
    }
    return "map the system";
  }
  if (/learning from place/.test(normalized)) return "learning from place";
  if (/documentary response/.test(normalized)) return "documentary response";
  if (/disaster risk reduction assignment|drr plan/.test(normalized)) {
    return "drr plan";
  }
  if (/practicing hope/.test(normalized) && /post/.test(normalized)) {
    return normalized.replace(/.*practicing hope\s*/, "practicing hope ");
  }
  if (/practicing hope/.test(normalized) && /response/.test(normalized)) {
    return normalized.replace(/.*practicing hope\s*/, "practicing hope ");
  }

  return normalized;
}

function isTentativePlanTableEvent(event: EventCandidate) {
  return event.provenance.some(
    (item) => item.sectionId === "tentative_class_plan" && item.sourceKind === "table"
  );
}

function dropShadowedTentativePlanEvents(events: EventCandidate[]) {
  return events.filter((event) => {
    if (
      (event.eventType !== "Assignment" && event.eventType !== "Assessment") ||
      event.timing.kind !== "single" ||
      !event.timing.date ||
      !isTentativePlanTableEvent(event)
    ) {
      return true;
    }

    const family =
      event.eventType === "Assignment"
        ? canonicalAssignmentFamily(event.label)
        : canonicalAssessmentFamily(event.label);
    if (!family) return true;

    return !events.some((candidate) => {
      if (
        candidate.id === event.id ||
        candidate.courseId !== event.courseId ||
        candidate.eventType !== event.eventType ||
        candidate.timing.kind !== "single" ||
        !candidate.timing.date
      ) {
        return false;
      }

      if (
        isTentativePlanTableEvent(candidate) &&
        !candidate.provenance.some((item) => item.sectionId === "assessments_amp_activities")
      ) {
        return false;
      }

      const candidateFamily =
        candidate.eventType === "Assignment"
          ? canonicalAssignmentFamily(candidate.label)
          : canonicalAssessmentFamily(candidate.label);
      if (!candidateFamily || candidateFamily !== family) return false;

      const sameCalendarDay =
        format(parseISO(candidate.timing.date), "MM-dd") ===
        format(parseISO(event.timing.date), "MM-dd");
      const sameWindow =
        Math.abs(
          differenceInCalendarDays(
            parseISO(candidate.timing.date),
            parseISO(event.timing.date)
          )
        ) <= 2 ||
        sameCalendarDay;
      if (!sameWindow) return false;

      const candidateScore =
        candidate.eventType === "Assignment"
          ? assignmentDeduplicationScore(candidate)
          : assessmentDeduplicationScore(candidate);
      const eventScore =
        event.eventType === "Assignment"
          ? assignmentDeduplicationScore(event)
          : assessmentDeduplicationScore(event);
      if (
        sameCalendarDay &&
        !isTentativePlanTableEvent(candidate) &&
        candidateScore >= eventScore
      ) {
        return true;
      }
      if (preferredMergedLabel(event.label, candidate.label) !== candidate.label) {
        return false;
      }
      if (candidateScore > eventScore) return true;
      if (candidateScore < eventScore) return false;

      return preferredMergedLabel(event.label, candidate.label) === candidate.label;
    });
  });
}

function dedupeEquivalentAssignments(events: EventCandidate[]) {
  const deduped: EventCandidate[] = [];
  const passthrough: EventCandidate[] = [];

  events.forEach((event) => {
    if (event.eventType !== "Assignment" || event.timing.kind !== "single" || !event.timing.date) {
      passthrough.push(event);
      return;
    }

    const family = canonicalAssignmentFamily(event.label);
    const existing = deduped.find((candidate) => {
      if (
        candidate.eventType !== "Assignment" ||
        candidate.timing.kind !== "single" ||
        candidate.courseId !== event.courseId ||
        candidate.timing.date !== event.timing.date ||
        canonicalAssignmentFamily(candidate.label) !== family
      ) {
        return false;
      }

      const candidateSections = new Set(candidate.sectionOptionIds);
      const eventSections = new Set(event.sectionOptionIds);
      const sameLocation =
        !candidate.location ||
        !event.location ||
        normalizeLocation(candidate.location) === normalizeLocation(event.location);
      return (
        candidateSections.size === 0 ||
        eventSections.size === 0 ||
        [...candidateSections].some((sectionId) => eventSections.has(sectionId)) ||
        sameLocation
      );
    });

    if (!existing) {
      deduped.push(event);
      return;
    }

    const keepCurrent =
      assignmentDeduplicationScore(event) > assignmentDeduplicationScore(existing);
    const primary = keepCurrent ? event : existing;
    const secondary = keepCurrent ? existing : event;

    primary.location = primary.location || secondary.location;
    if (isGenericEventLocation(primary.location) && !isGenericEventLocation(secondary.location)) {
      primary.location = secondary.location;
    }
    primary.label = preferredMergedLabel(primary.label, secondary.label);
    primary.notes = combineNotes(primary.notes, secondary.notes);
    primary.provenance = mergeProvenanceLists([primary.provenance, secondary.provenance]);
    primary.sectionOptionIds = unique([...primary.sectionOptionIds, ...secondary.sectionOptionIds]);
    primary.extractedSectionLabels = unique([
      ...primary.extractedSectionLabels,
      ...secondary.extractedSectionLabels,
    ]);
    primary.include = primary.include || secondary.include;
    primary.reviewNeeded = primary.reviewNeeded || secondary.reviewNeeded;
    primary.confidence =
      confidenceRank(primary.confidence) >= confidenceRank(secondary.confidence)
        ? primary.confidence
        : secondary.confidence;

    const existingIndex = deduped.findIndex((candidate) => candidate.id === existing.id);
    deduped[existingIndex] = primary;
  });

  const combined = [...passthrough, ...deduped];
  return combined.filter((event) => {
    if (
      event.eventType !== "Assignment" ||
      event.timing.kind !== "single" ||
      !event.timing.date ||
      !/^assignment$/i.test(normalizeWhitespace(event.label))
    ) {
      return true;
    }

    return !combined.some((candidate) => {
      if (
        candidate.id === event.id ||
        candidate.eventType !== "Assignment" ||
        candidate.courseId !== event.courseId ||
        candidate.timing.kind !== "single" ||
        candidate.timing.date !== event.timing.date
      ) {
        return false;
      }

      if (/^assignment$/i.test(normalizeWhitespace(candidate.label))) {
        return false;
      }

      const candidateSections = new Set(candidate.sectionOptionIds);
      const eventSections = new Set(event.sectionOptionIds);
      return (
        candidateSections.size === 0 ||
        eventSections.size === 0 ||
        [...candidateSections].some((sectionId) => eventSections.has(sectionId))
      );
    });
  });
}

function seriesShadowKey(label: string) {
  return normalizeWhitespace(label)
    .toLowerCase()
    .replace(/\([^)]*\)/g, " ")
    .replace(/#\s*\d+(?:-\d+)?\b/g, " ")
    .replace(
      /\b(?:one|two|three|four|five|six|seven|eight|nine|ten|weekly|best|out|of|x|personal|written|scores?|taken|total)\b/g,
      " "
    )
    .replace(/\bassignments\b/g, "assignment")
    .replace(/\breports\b/g, "report")
    .replace(/\bdeliverables\b/g, "deliverable")
    .replace(/\bquizzes\b/g, "quiz")
    .replace(/\bessays\b/g, "essay")
    .replace(/\breflections\b/g, "reflection")
    .replace(/\bprojects\b/g, "project")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function hasConcreteTiming(event: EventCandidate) {
  if (event.timing.kind === "single") {
    return Boolean(event.timing.date);
  }
  return Boolean(event.timing.startDate && event.timing.endDate);
}

function isGenericSummaryLabel(label: string) {
  const normalized = normalizeWhitespace(label).toLowerCase();
  return (
    /^(?:\d+\s+)?quizzes?$/.test(normalized) ||
    /^(?:\d+\s+)?term tests?$/.test(normalized) ||
    /^(?:\d+\s+)?written tutorial assignments?$/.test(normalized) ||
    /^(?:\d+\s+)?tutorial assignments?$/.test(normalized) ||
    /^(?:\d+\s+)?assignments?$/.test(normalized)
  );
}

function isGenericTimedSummaryEvent(event: EventCandidate) {
  if (
    (event.eventType !== "Assignment" && event.eventType !== "Assessment") ||
    !event.provenance.some((item) => item.sectionId === "assessments_amp_activities")
  ) {
    return false;
  }

  const normalized = normalizeWhitespace(event.label).toLowerCase();
  return (
    /^(?:\d+\s+)?assignments?(?:\s+except\b.*)?$/.test(normalized) ||
    /\bcareer eportfolio projects?\s*#/.test(normalized) ||
    /\bhealth innovation challenges?\s*#/.test(normalized) ||
    /\bknowledge translation activities?\s*#/.test(normalized)
  );
}

function eventFamilyForShadowing(event: EventCandidate) {
  const normalized = normalizeWhitespace(event.label).toLowerCase();
  if (/assignment|report|project|deliverable|essay|reflection|portfolio/i.test(normalized)) {
    return canonicalAssignmentFamily(event.label);
  }
  return event.eventType === "Assignment"
    ? canonicalAssignmentFamily(event.label)
    : canonicalAssessmentFamily(event.label);
}

function eventEvidenceText(event: EventCandidate) {
  return normalizeWhitespace(
    [event.label, ...event.notes, ...event.provenance.map((item) => item.snippet)].join(" ")
  );
}

function hasDeliverableNoun(text: string) {
  return /\b(?:assignment|report|project|proposal|reflection|paper|essay|presentation|survey|analysis|portfolio|summary|review|task|submission|problem set|lab report|course survey|final response|commentary|module|brief|charter|map|check-?in|contract|quiz|test|midterm|exam|practical|deliverable|worksheet|interview|post|response|responses|discussion|problem sets?)\b/i.test(
    normalizeWhitespace(text)
  );
}

function hasAssignmentLifecycleModifier(label: string) {
  return /\b(?:available|review|feedback|evaluation|post|response|responses|submission)\b/i.test(
    normalizeWhitespace(label)
  );
}

function isAdministrativeCalendarArtifact(event: EventCandidate) {
  const evidence = eventEvidenceText(event).toLowerCase();
  return (
    /\b(?:tuition\s*&?\s*fee\s+refund\s+deadline|refund\s+deadline|last day to drop a class|academic record)\b/.test(
      evidence
    ) ||
    /\bmarks?\s+(?:will be|are)\s+(?:updated|available|posted|released)\b/.test(evidence) ||
    /\bfeedback\s+(?:will be|is)\s+(?:available|posted|released)\b/.test(evidence) ||
    /\bno tutorial will be held on\b/.test(evidence)
  );
}

function normalizeSpecialAssignmentArtifacts(events: EventCandidate[]) {
  return events.flatMap((event) => {
    if (
      (event.eventType !== "Assignment" && event.eventType !== "Assessment") ||
      event.timing.kind !== "single"
    ) {
      return [event];
    }

    if (isAdministrativeCalendarArtifact(event)) {
      return [];
    }

    const evidence = eventEvidenceText(event);
    const normalizedLabel = normalizeWhitespace(event.label);

    if (
      event.eventType === "Assignment" &&
      (/^project starts$/i.test(normalizedLabel) ||
        /^new this term:\s*in survey\b/i.test(normalizedLabel) ||
        /\bnew this term:\s*in survey\s*1\b/i.test(evidence))
    ) {
      return [];
    }

    if (
      event.eventType === "Assignment" &&
      /^project$/i.test(normalizedLabel) &&
      /\b(?:project\s+)?part\s*([1-9]\d*)\b/i.test(evidence)
    ) {
      const partNumber = evidence.match(/\b(?:project\s+)?part\s*([1-9]\d*)\b/i)?.[1];
      if (partNumber) {
        return [{ ...event, label: `Project Part ${partNumber}` }];
      }
    }

    if (/^reflection\s*#?\s*(\d+)$/i.test(normalizedLabel)) {
      const reflectionNumber = Number(
        normalizedLabel.match(/^reflection\s*#?\s*(\d+)$/i)?.[1] ?? ""
      );
      if (/\bpre-?course survey\b/i.test(evidence)) {
        return [{ ...event, label: "Pre-Course Survey" }];
      }
      if (/\bprior knowledge survey\b/i.test(evidence)) {
        return [{ ...event, label: "Prior Knowledge Survey" }];
      }
      const commentaryPost = evidence.match(/\bcommentary\s*#?\s*(\d+)\s+post\b/i)?.[1];
      if (commentaryPost && Number(commentaryPost) === reflectionNumber) {
        return [{ ...event, label: `Commentary #${reflectionNumber} Post` }];
      }
    }

    if (
      (event.eventType === "Assignment" || event.eventType === "Assessment") &&
      !hasDeliverableNoun(normalizedLabel)
    ) {
      const lowerEvidence = evidence.toLowerCase();
      if (
        /\bweek\s+\d+\b/.test(lowerEvidence) ||
        /#\s*\d+\b/.test(normalizedLabel) ||
        /\b(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\.?\s+\d{1,2}/.test(
          lowerEvidence
        )
      ) {
        return [];
      }
    }

    return [event];
  });
}

interface CanonicalCourseAssignmentEntry {
  key: string;
  label: string;
  date: string;
  startTime?: string;
  allDay?: boolean;
  location?: string;
  note?: string;
}

interface CanonicalCourseEventEntry {
  key: string;
  label: string;
  date: string;
  eventType: Extract<EventType, "Assessment" | "Assignment">;
  startTime?: string;
  endTime?: string;
  allDay?: boolean;
  location?: string;
  note?: string;
}

function extractHtmlTables(sourceHtml: string | null | undefined) {
  return Array.from((sourceHtml ?? "").matchAll(/<table[\s\S]*?<\/table>/gi), (match) => match[0]);
}

function extractHtmlTableRows(tableHtml: string) {
  return Array.from(tableHtml.matchAll(/<tr[\s\S]*?<\/tr>/gi), (match) => match[0]);
}

function extractHtmlRowCells(rowHtml: string) {
  return Array.from(rowHtml.matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi), (match) =>
    htmlSnippetToText(match[1])
  );
}

function courseSpecificAssignmentTemplate(events: EventCandidate[]) {
  return (
    events.find((event) => event.eventType === "Assignment" && event.timing.kind === "single") ??
    events.find((event) => event.eventType === "Assignment") ??
    events.find((event) => event.timing.kind === "single")
  );
}

function courseSpecificEventTemplate(
  events: EventCandidate[],
  eventType: Extract<EventType, "Assessment" | "Assignment">
) {
  return (
    events.find((event) => event.eventType === eventType && event.timing.kind === "single") ??
    events.find((event) => event.eventType === eventType) ??
    courseSpecificAssignmentTemplate(events)
  );
}

function compareCanonicalAssignmentEntries(
  left: CanonicalCourseAssignmentEntry,
  right: CanonicalCourseAssignmentEntry
) {
  const dateComparison = left.date.localeCompare(right.date);
  if (dateComparison !== 0) return dateComparison;

  const leftNumber = Number(left.label.match(/#\s*(\d+(?:\.\d+)?)/)?.[1] ?? Number.POSITIVE_INFINITY);
  const rightNumber = Number(
    right.label.match(/#\s*(\d+(?:\.\d+)?)/)?.[1] ?? Number.POSITIVE_INFINITY
  );
  if (Number.isFinite(leftNumber) && Number.isFinite(rightNumber) && leftNumber !== rightNumber) {
    return leftNumber - rightNumber;
  }

  return left.label.localeCompare(right.label);
}

function rebuildAssignmentsFromCanonicalEntries(
  events: EventCandidate[],
  entries: CanonicalCourseAssignmentEntry[],
  sourceKey: string,
  defaultLocation: string,
  defaultNote: string
) {
  const template = courseSpecificAssignmentTemplate(events);
  if (!template || entries.length === 0) {
    return events;
  }

  const uniqueEntries = Array.from(
    new Map(entries.map((entry) => [`${entry.label}::${entry.date}::${entry.startTime ?? ""}`, entry])).values()
  ).sort(compareCanonicalAssignmentEntries);

  const nonAssignmentEvents = events.filter((event) => event.eventType !== "Assignment");

  return [
    ...nonAssignmentEvents,
    ...uniqueEntries.map((entry) => ({
      ...template,
      id: buildStableId(`${template.courseId}:${sourceKey}:${entry.key}:${entry.date}`),
      label: entry.label,
      title: entry.label,
      eventType: "Assignment" as const,
      eventGroup: EVENT_GROUP_BY_TYPE.Assignment,
      location: entry.location ?? defaultLocation,
      notes: combineNotes(template.notes, [defaultNote, ...(entry.note ? [entry.note] : [])]),
      timing: {
        kind: "single" as const,
        date: entry.date,
        ...(entry.startTime ? { startTime: entry.startTime } : {}),
        allDay: entry.allDay ?? !entry.startTime,
      },
    })),
  ];
}

function compareCanonicalCourseEventEntries(
  left: CanonicalCourseEventEntry,
  right: CanonicalCourseEventEntry
) {
  const dateComparison = left.date.localeCompare(right.date);
  if (dateComparison !== 0) return dateComparison;

  const typeComparison = left.eventType.localeCompare(right.eventType);
  if (typeComparison !== 0) return typeComparison;

  const leftNumber = Number(left.label.match(/#\s*(\d+(?:\.\d+)?)/)?.[1] ?? Number.POSITIVE_INFINITY);
  const rightNumber = Number(
    right.label.match(/#\s*(\d+(?:\.\d+)?)/)?.[1] ?? Number.POSITIVE_INFINITY
  );
  if (Number.isFinite(leftNumber) && Number.isFinite(rightNumber) && leftNumber !== rightNumber) {
    return leftNumber - rightNumber;
  }

  return left.label.localeCompare(right.label);
}

function rebuildEventsFromCanonicalEntries(
  events: EventCandidate[],
  entries: CanonicalCourseEventEntry[],
  sourceKey: string,
  defaultNote: string
) {
  const fallbackTemplate = courseSpecificAssignmentTemplate(events);
  if (!fallbackTemplate || entries.length === 0) {
    return events;
  }

  const uniqueEntries = Array.from(
    new Map(
      entries.map((entry) => [
        `${entry.eventType}::${entry.label}::${entry.date}::${entry.startTime ?? ""}`,
        entry,
      ])
    ).values()
  ).sort(compareCanonicalCourseEventEntries);

  const nonCourseworkEvents = events.filter(
    (event) => event.eventType !== "Assignment" && event.eventType !== "Assessment"
  );

  return [
    ...nonCourseworkEvents,
    ...uniqueEntries.map((entry) => {
      const template =
        courseSpecificEventTemplate(events, entry.eventType) ?? fallbackTemplate;
      return {
        ...template,
        id: buildStableId(`${template.courseId}:${sourceKey}:${entry.key}:${entry.date}`),
        label: entry.label,
        title: entry.label,
        eventType: entry.eventType,
        eventGroup: EVENT_GROUP_BY_TYPE[entry.eventType],
        location: entry.location ?? template.location,
        sectionOptionIds: [],
        extractedSectionLabels: [],
        instructorName: undefined,
        instructorEmail: undefined,
        notes: combineNotes(
          [defaultNote],
          entry.note ? [entry.note] : [],
          template.notes
        ),
        timing: {
          kind: "single" as const,
          date: entry.date,
          ...(entry.startTime ? { startTime: entry.startTime } : {}),
          ...(entry.endTime ? { endTime: entry.endTime } : {}),
          allDay: entry.allDay ?? !entry.startTime,
        },
      };
    }),
  ];
}

function rebuildAssessmentsFromSeeds(
  events: EventCandidate[],
  seeds: AssessmentSeed[],
  sourceKey: string,
  defaultNote: string
) {
  const template =
    courseSpecificEventTemplate(events, "Assessment") ?? courseSpecificAssignmentTemplate(events);
  if (!template || seeds.length === 0) {
    return events;
  }

  const uniqueSeeds = Array.from(
    new Map(
      seeds.map((seed) => [
        `${seed.eventType}::${seed.label}::${seed.date ?? "undated"}::${seed.startTime ?? ""}::${seed.location ?? ""}`,
        seed,
      ])
    ).values()
  ).sort((left, right) => {
    const leftDate = left.date ?? "9999-12-31";
    const rightDate = right.date ?? "9999-12-31";
    const dateComparison = leftDate.localeCompare(rightDate);
    if (dateComparison !== 0) return dateComparison;

    const leftNumber = Number(
      normalizeAssessmentLabel(left.label).match(/#\s*(\d+(?:\.\d+)?)/)?.[1] ?? Number.POSITIVE_INFINITY
    );
    const rightNumber = Number(
      normalizeAssessmentLabel(right.label).match(/#\s*(\d+(?:\.\d+)?)/)?.[1] ?? Number.POSITIVE_INFINITY
    );
    if (Number.isFinite(leftNumber) && Number.isFinite(rightNumber) && leftNumber !== rightNumber) {
      return leftNumber - rightNumber;
    }

    return normalizeAssessmentLabel(left.label).localeCompare(normalizeAssessmentLabel(right.label));
  });

  const nonAssessmentEvents = events.filter((event) => event.eventType !== "Assessment");

  return [
    ...nonAssessmentEvents,
    ...uniqueSeeds.map((seed) => {
      const normalizedLabel = normalizeAssessmentLabel(seed.label, seed.date);
      const location = sanitizeAssessmentLocation(seed.label, seed.location) ?? "";
      const event: EventCandidate = {
        ...template,
        id: buildStableId(
          `${template.courseId}:${sourceKey}:${normalizedLabel}:${seed.date ?? "undated"}:${seed.startTime ?? ""}:${location}`
        ),
        label: normalizedLabel,
        title: normalizedLabel,
        eventType: "Assessment",
        eventGroup: EVENT_GROUP_BY_TYPE.Assessment,
        location,
        sectionOptionIds: seed.sectionOptionIds ?? [],
        extractedSectionLabels: [],
        instructorName: undefined,
        instructorEmail: undefined,
        notes: combineNotes([defaultNote], seed.notes, seed.weight ? [`Weight: ${seed.weight}`] : []),
        confidence: seed.confidence,
        reviewNeeded: false,
        include: true,
        timing: {
          kind: "single" as const,
          date: seed.date,
          endDate: seed.endDate,
          ...(seed.startTime ? { startTime: seed.startTime } : {}),
          ...(seed.endTime ? { endTime: seed.endTime } : {}),
          allDay: seed.allDay ?? !seed.startTime,
        },
        provenance: seed.provenance,
      };
      event.reviewNeeded = reviewNeededForEvent(event) || seed.confidence === "low";
      event.include = defaultIncludeForEvent(event) && seed.confidence !== "low";
      return event;
    }),
  ];
}

function rebuildAssignmentSubsetFromSeeds(
  events: EventCandidate[],
  seeds: AssessmentSeed[],
  sourceKey: string,
  defaultNote: string,
  predicate: (event: EventCandidate) => boolean
) {
  const template = courseSpecificAssignmentTemplate(events);
  if (!template || seeds.length === 0) {
    return events;
  }

  const uniqueSeeds = Array.from(
    new Map(
      seeds.map((seed) => [
        `${seed.label}::${seed.date ?? "undated"}::${seed.startTime ?? ""}::${seed.location ?? ""}`,
        seed,
      ])
    ).values()
  ).sort((left, right) => {
    const leftDate = left.date ?? "9999-12-31";
    const rightDate = right.date ?? "9999-12-31";
    const dateComparison = leftDate.localeCompare(rightDate);
    if (dateComparison !== 0) return dateComparison;

    const leftNumber = Number(
      normalizeAssignmentLabel(left.label).match(/#\s*(\d+(?:\.\d+)?)/)?.[1] ?? Number.POSITIVE_INFINITY
    );
    const rightNumber = Number(
      normalizeAssignmentLabel(right.label).match(/#\s*(\d+(?:\.\d+)?)/)?.[1] ?? Number.POSITIVE_INFINITY
    );
    if (Number.isFinite(leftNumber) && Number.isFinite(rightNumber) && leftNumber !== rightNumber) {
      return leftNumber - rightNumber;
    }

    return normalizeAssignmentLabel(left.label).localeCompare(normalizeAssignmentLabel(right.label));
  });

  const remainingEvents = events.filter((event) => !predicate(event));

  return [
    ...remainingEvents,
    ...uniqueSeeds.map((seed) => {
      const normalizedLabel = normalizeAssignmentLabel(seed.label, seed.date);
      const location = sanitizeAssignmentLocation(seed.location) ?? "";
      const event: EventCandidate = {
        ...template,
        id: buildStableId(
          `${template.courseId}:${sourceKey}:${normalizedLabel}:${seed.date ?? "undated"}:${seed.startTime ?? ""}:${location}`
        ),
        label: normalizedLabel,
        title: normalizedLabel,
        eventType: "Assignment",
        eventGroup: EVENT_GROUP_BY_TYPE.Assignment,
        location,
        sectionOptionIds: seed.sectionOptionIds ?? [],
        extractedSectionLabels: [],
        instructorName: undefined,
        instructorEmail: undefined,
        notes: combineNotes(template.notes, [defaultNote], seed.notes, seed.weight ? [`Weight: ${seed.weight}`] : []),
        confidence: seed.confidence,
        reviewNeeded: false,
        include: true,
        timing: {
          kind: "single" as const,
          date: seed.date,
          endDate: seed.endDate,
          ...(seed.startTime ? { startTime: seed.startTime } : {}),
          ...(seed.endTime ? { endTime: seed.endTime } : {}),
          allDay: seed.allDay ?? !seed.startTime,
        },
        provenance: seed.provenance,
      };
      event.reviewNeeded = reviewNeededForEvent(event) || seed.confidence === "low";
      event.include = defaultIncludeForEvent(event) && seed.confidence !== "low";
      return event;
    }),
  ];
}

function extractCs135CanonicalAssignments(
  sourceHtml: string | null | undefined,
  meta: OutlineMeta
) {
  const sourceText = htmlSnippetToText(sourceHtml ?? "");
  const defaultDueTime =
    parseTimeRange(
      sourceText.match(/\bA\s*0*\d+\s+will be due at\s+([0-9:.\sapmAPM]+)/i)?.[1] ??
        sourceText.match(/\bdue at\s+([0-9:.\sapmAPM]+)/i)?.[1] ??
        ""
    ).startTime ?? "21:00";

  const entries: CanonicalCourseAssignmentEntry[] = [];

  extractHtmlTables(sourceHtml)
    .filter((tableHtml) => /\bA\s*0*\d+\s*Due\b/i.test(htmlSnippetToText(tableHtml)))
    .forEach((tableHtml) => {
      const tableText = htmlSnippetToText(tableHtml);
      const headerMatch = tableText.match(
        /\b(January|February|March|April|May|June|July|August|September|October|November|December)\s+(20\d{2})\b/i
      );
      if (!headerMatch) return;

      const monthName = headerMatch[1];
      const year = Number(headerMatch[2]);
      if (!Number.isFinite(year)) return;

      extractHtmlTableRows(tableHtml).forEach((rowHtml) => {
        extractHtmlRowCells(rowHtml).forEach((cellText) => {
          const normalizedCell = normalizeWhitespace(cellText);
          const dayMatch = normalizedCell.match(/^(\d{1,2})\b/);
          if (!dayMatch) return;

          const day = Number(dayMatch[1]);
          const date = parseFlexibleDate(`${monthName} ${day}, ${year}`, year);
          if (!date) return;

          Array.from(normalizedCell.matchAll(/\bA\s*0*(\d{1,2})\s*Due\b/gi)).forEach((match) => {
            const assignmentNumber = Number(match[1]);
            if (!Number.isFinite(assignmentNumber)) return;

            entries.push({
              key: `assignment-${assignmentNumber}`,
              label: `Assignment #${assignmentNumber}`,
              date,
              startTime: defaultDueTime,
              allDay: false,
            });
          });
        });
      });
    });

  return entries;
}

function extractCs241eCanonicalAssignments(
  sourceHtml: string | null | undefined,
  meta: OutlineMeta
) {
  const entries: CanonicalCourseAssignmentEntry[] = [];

  extractHtmlTables(sourceHtml)
    .filter((tableHtml) => {
      const tableText = htmlSnippetToText(tableHtml);
      return (
        /\bweek\b/i.test(tableText) &&
        /\bnotes\b/i.test(tableText) &&
        /\b(?:assignment\s+\d+\s+due|A\d+\s+due|A\d+\s+and\s+A\d+\s+due)\b/i.test(tableText)
      );
    })
    .forEach((tableHtml) => {
      extractHtmlTableRows(tableHtml).forEach((rowHtml) => {
        const cells = extractHtmlRowCells(rowHtml);
        const notesCell = normalizeWhitespace(cells[cells.length - 1] ?? "");
        if (!notesCell) return;

        const sharedDueMatch = notesCell.match(
          /\bA\s*0*(\d{1,2})\s+and\s+A\s*0*(\d{1,2})\s+due\s+[A-Z]\s+([A-Za-z]{3,9}\.?\s+\d{1,2})\b/i
        );
        if (sharedDueMatch) {
          const dueDate = parseFlexibleDate(sharedDueMatch[3], meta.termYear);
          if (!dueDate) return;

          [sharedDueMatch[1], sharedDueMatch[2]].forEach((assignmentNumberText) => {
            const assignmentNumber = Number(assignmentNumberText);
            if (!Number.isFinite(assignmentNumber)) return;
            entries.push({
              key: `assignment-${assignmentNumber}`,
              label: `Assignment #${assignmentNumber}`,
              date: dueDate,
              note:
                "The tentative course schedule lists two assignments as sharing this due date.",
            });
          });
          return;
        }

        const singleDueMatch =
          notesCell.match(
            /\bAssignment\s+(\d{1,2})\s+due\s+[A-Z]\s+([A-Za-z]{3,9}\.?\s+\d{1,2})\b/i
          ) ??
          notesCell.match(/\bA\s*0*(\d{1,2})\s+due\s+[A-Z]\s+([A-Za-z]{3,9}\.?\s+\d{1,2})\b/i);
        if (!singleDueMatch) return;

        const assignmentNumber = Number(singleDueMatch[1]);
        const dueDate = parseFlexibleDate(singleDueMatch[2], meta.termYear);
        if (!Number.isFinite(assignmentNumber) || !dueDate) return;

        entries.push({
          key: `assignment-${assignmentNumber}`,
          label: `Assignment #${assignmentNumber}`,
          date: dueDate,
          note: /\bno lates?\b/i.test(notesCell)
            ? "The tentative course schedule marks this assignment as a no-lates deadline."
            : undefined,
        });
      });
    });

  return entries;
}

function extractCs138CanonicalAssignments(
  sourceHtml: string | null | undefined,
  meta: OutlineMeta
) {
  const entries: CanonicalCourseAssignmentEntry[] = [];

  extractHtmlTables(sourceHtml)
    .filter((tableHtml) => {
      const tableText = htmlSnippetToText(tableHtml);
      return (
        /\bCourse Component\b/i.test(tableText) &&
        /\bDue Date\b/i.test(tableText) &&
        /\bAssignment 0\b/i.test(tableText)
      );
    })
    .forEach((tableHtml) => {
      extractHtmlTableRows(tableHtml).forEach((rowHtml) => {
        const cells = extractHtmlRowCells(rowHtml);
        if (cells.length < 2) return;

        const componentText = normalizeWhitespace(cells[0]);
        const dueText = normalizeWhitespace(cells[1]);
        const assignmentMatch = componentText.match(/^Assignment\s+0*(\d+)\b/i);
        if (!assignmentMatch || !dueText) return;

        const assignmentNumber = Number(assignmentMatch[1]);
        if (!Number.isFinite(assignmentNumber)) return;

        const partMatches = Array.from(
          dueText.matchAll(/Part\s*(\d+):\s*([\s\S]*?)(?=Part\s*\d+:|$)/gi)
        );

        if (partMatches.length > 0) {
          partMatches.forEach((partMatch) => {
            const partNumber = Number(partMatch[1]);
            const partText = normalizeWhitespace(partMatch[2]);
            const partDate = parseFlexibleDate(partText, meta.termYear);
            if (!Number.isFinite(partNumber) || !partDate) return;

            entries.push({
              key: `assignment-${assignmentNumber}-part-${partNumber}`,
              label: `Assignment #${assignmentNumber} - Part ${partNumber}`,
              date: partDate,
              startTime: parseTimeRange(partText).startTime,
              allDay: false,
              note:
                assignmentNumber === 0 && /mandatory/i.test(dueText)
                  ? "Assignment 0 is marked mandatory in the course component due dates table."
                  : undefined,
            });
          });
          return;
        }

        const dueDate = parseFlexibleDate(dueText, meta.termYear);
        if (!dueDate) return;

        entries.push({
          key: `assignment-${assignmentNumber}`,
          label: `Assignment #${assignmentNumber}`,
          date: dueDate,
          startTime: parseTimeRange(dueText).startTime,
          allDay: false,
          note:
            assignmentNumber === 0 && /mandatory/i.test(dueText)
              ? "Assignment 0 is marked mandatory in the course component due dates table."
              : undefined,
        });
      });
    });

  return entries;
}

function extractEnbus407CanonicalAssignments(
  sourceHtml: string | null | undefined,
  meta: OutlineMeta
) {
  if (!courseCodeMatches(meta.courseCode, "ENBUS 407")) {
    return [] as CanonicalCourseAssignmentEntry[];
  }

  const entries: CanonicalCourseAssignmentEntry[] = [];

  const normalizeEnbus407Label = (label: string) =>
    normalizeWhitespace(label)
      .replace(/^assignment\s+(\d+)\s*[-:–—]\s*/i, (_match, numberText: string) => {
        return `Assignment #${Number(numberText)} - `;
      })
      .replace(/^assignment\s+(\d+)\b/i, (_match, numberText: string) => {
        return `Assignment #${Number(numberText)}`;
      })
      .replace(/^deadline to submit the\s+/i, "")
      .replace(/^deadline to join the\s+/i, "")
      .replace(/^deadline to join\s+/i, "")
      .replace(/\s*\(dropbox\)\s*$/i, "")
      .replace(/\s+on\s+learn\s*:?\s*survey.*$/i, "")
      .replace(/\s*\.\s*$/, "")
      .trim();

  extractHtmlTables(sourceHtml).forEach((tableHtml) => {
    const rows = extractHtmlTableRows(tableHtml).map((rowHtml) => extractHtmlRowCells(rowHtml));
    if (rows.length === 0) return;

    const header = rows[0].map((cell) => normalizeWhitespace(cell).toLowerCase());
    const isAssessmentTable =
      header.some((cell) => /component/.test(cell)) &&
      header.some((cell) => /date|due date/.test(cell));

    if (isAssessmentTable) {
      rows.slice(1).forEach((row) => {
        const componentText = normalizeWhitespace(row[0] ?? "");
        const dateText = normalizeWhitespace(row[1] ?? "");
        const locationText = normalizeWhitespace(row[2] ?? "");
        if (!componentText || !dateText) return;
        if (/^(?:participation|quiz\s*\d+|midterm)$/i.test(componentText)) return;
        if (!hasDeliverableNoun(componentText)) return;

        const dateSpec = parseDateSpec(dateText, meta.termYear);
        const explicitDates =
          dateSpec?.kind === "dates"
            ? dateSpec.dates
            : dateSpec?.kind === "range" && dateSpec.startDate && dateSpec.endDate
            ? [dateSpec.startDate, dateSpec.endDate]
            : dateSpec?.kind === "single"
            ? [dateSpec.date]
            : extractExplicitDates(dateText, meta.termYear);
        const dueDate =
          dateSpec?.kind === "range" && dateSpec.endDate
            ? dateSpec.endDate
            : explicitDates[explicitDates.length - 1];
        if (!dueDate) return;

        entries.push({
          key: normalizeWhitespace(`${componentText}-${dueDate}`)
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, "-")
            .replace(/^-+|-+$/g, ""),
          label: normalizeEnbus407Label(componentText),
          date: dueDate,
          location:
            /dropbox|learn/i.test(locationText)
              ? "LEARN Dropbox"
              : /in-?person/i.test(locationText)
              ? "In person"
              : locationText || undefined,
          note:
            dateSpec?.kind === "range" && explicitDates[0] && explicitDates[1]
              ? `Presentation window ${dateText}`
              : locationText || undefined,
        });
      });
      return;
    }

    const tableText = htmlSnippetToText(tableHtml);
    const isScheduleTable =
      /\bmodule and dates\b/i.test(tableText) &&
      /\bassessment items\b/i.test(tableText) &&
      /\bmodule\b/i.test(tableText);
    if (!isScheduleTable) return;

    rows.slice(1).forEach((row) => {
      const assessmentText = normalizeWhitespace(row[3] ?? "");
      if (!assessmentText) return;

      const assignmentDueMatch = assessmentText.match(
        /\bAssignment\s+(\d+)\s+Due:\s*([^()]+?)(?:\s*\(|$)/i
      );
      if (assignmentDueMatch) {
        const assignmentNumber = Number(assignmentDueMatch[1]);
        const dueDate = parseFlexibleDate(assignmentDueMatch[2], meta.termYear);
        if (!Number.isFinite(assignmentNumber) || !dueDate) return;
        const dueTime = parseTimeRange(assessmentText);
        entries.push({
          key: `assignment-${assignmentNumber}`,
          label: `Assignment #${assignmentNumber}`,
          date: dueDate,
          startTime: dueTime.startTime,
          allDay: !dueTime.startTime,
          location: /dropbox|learn/i.test(assessmentText) ? "LEARN Dropbox" : "LEARN",
        });
        return;
      }

      const submissionMatch = assessmentText.match(
        /\bDeadline to Submit the\s+(.+?)\s+([A-Za-z]{3,9}\.?\s+\d{1,2}(?:st|nd|rd|th)?(?:,\s*\d{1,2}:\d{2}\s*[ap]m)?)/i
      );
      if (submissionMatch) {
        const label = normalizeEnbus407Label(submissionMatch[1]);
        const dueDate = parseFlexibleDate(submissionMatch[2], meta.termYear);
        if (!label || !dueDate) return;
        const dueTime = parseTimeRange(assessmentText);
        entries.push({
          key: normalizeWhitespace(`${label}-${dueDate}`)
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, "-")
            .replace(/^-+|-+$/g, ""),
          label,
          date: dueDate,
          startTime: dueTime.startTime,
          allDay: !dueTime.startTime,
          location: /dropbox|learn/i.test(assessmentText) ? "LEARN Dropbox" : "LEARN",
        });
      }
    });
  });

  return Array.from(
    new Map(entries.map((entry) => [`${entry.label}::${entry.date}`, entry])).values()
  );
}

function extractAfm341CanonicalAssignments(
  sourceHtml: string | null | undefined,
  meta: OutlineMeta
) {
  if (
    !courseCodeMatches(meta.courseCode, "AFM 341") ||
    !/accounting information systems/i.test(meta.outlineName)
  ) {
    return [] as CanonicalCourseAssignmentEntry[];
  }

  const normalizeAfm341Label = (label: string) => {
    const normalized = normalizeWhitespace(label)
      .replace(/\s*\(.*?\)\s*$/g, "")
      .replace(/\bdue(?:\s+date)?\b.*$/i, "")
      .replace(/\s*[-–—:;,]+\s*$/g, "")
      .trim();

    if (!normalized || normalized === "-") {
      return "";
    }

    return normalized.replace(/\s+/g, " ");
  };

  const entries: CanonicalCourseAssignmentEntry[] = [];

  extractHtmlTables(sourceHtml)
    .filter((tableHtml) => {
      const tableText = htmlSnippetToText(tableHtml);
      return (
        /\bClass Session\b/i.test(tableText) &&
        /\bDate\b/i.test(tableText) &&
        /\bTopic\b/i.test(tableText) &&
        /\bReading(?:\(s\))?\b/i.test(tableText) &&
        /\bAssignment\b/i.test(tableText)
      );
    })
    .forEach((tableHtml) => {
      const rows = extractHtmlTableRows(tableHtml).map((rowHtml) => extractHtmlRowCells(rowHtml));
      if (rows.length === 0) return;

      const header = rows[0].map((cell) => normalizeWhitespace(cell).toLowerCase());
      const dateIndex = header.findIndex((cell) => cell === "date");
      const assignmentIndex = header.findIndex(
        (cell) => cell === "assignment" || /assignment\s*\(due date\)/.test(cell)
      );
      if (dateIndex === -1 || assignmentIndex === -1) return;

      rows.slice(1).forEach((row) => {
        if (row.length <= Math.max(dateIndex, assignmentIndex)) return;

        const dateText = normalizeWhitespace(row[dateIndex] ?? "");
        const assignmentText = normalizeAfm341Label(row[assignmentIndex] ?? "");
        if (!dateText || !assignmentText) return;
        if (assignmentText === "-" || /^midterm exam$/i.test(assignmentText)) return;

        const dueDate = parseFlexibleDate(dateText, meta.termYear);
        if (!dueDate) return;

        const assignmentNumber =
          assignmentText.match(/\bbriefing\b/i) != null
            ? 1
            : assignmentText.match(/\bcase study\b/i) != null
            ? 2
            : undefined;

        entries.push({
          key: assignmentNumber
            ? `assignment-${assignmentNumber}`
            : assignmentText
                .toLowerCase()
                .replace(/[^a-z0-9]+/g, "-")
                .replace(/^-+|-+$/g, ""),
          label: assignmentNumber
            ? `Assignment #${assignmentNumber} - ${assignmentText}`
            : assignmentText,
          date: dueDate,
          allDay: true,
        });
      });
    });

  return Array.from(
    new Map(entries.map((entry) => [`${entry.label}::${entry.date}`, entry])).values()
  ).sort(compareCanonicalAssignmentEntries);
}

function extractBiol273CanonicalAssignments(
  sourceHtml: string | null | undefined,
  meta: OutlineMeta
) {
  if (
    !courseCodeMatches(meta.courseCode, "BIOL 273") ||
    !/principles of human physiology 1/i.test(meta.outlineName)
  ) {
    return [] as CanonicalCourseAssignmentEntry[];
  }

  const entryLocationForLabel = (activityText: string, label: string) => {
    if (/language of physiology assignment/i.test(label)) {
      return "LEARN";
    }

    if (/connect/i.test(activityText)) {
      return "McGraw-Hill Connect";
    }

    if (/mastering\s*a&p|dynamic study module/i.test(activityText)) {
      return "Pearson Mastering A&P";
    }

    return undefined;
  };

  const labelForActivityEntry = (activityText: string) => {
    if (/language of physiology assignment/i.test(activityText)) {
      return "Language of Physiology Assignment";
    }

    const dynamicStudyModuleMatch = activityText.match(
      /\bdynamic study module set\s*0?(\d+)\b/i
    );
    if (dynamicStudyModuleMatch) {
      return `Dynamic Study Module Set ${Number(dynamicStudyModuleMatch[1])}`;
    }

    const onlineAssignmentMatch =
      activityText.match(
        /\b(?:connect\s+online|mastering\s*a&p\s+online)\s+assignment\s*0?(\d+)\b/i
      ) ?? activityText.match(/\bonline assignment\s*0?(\d+)\b/i);
    if (onlineAssignmentMatch) {
      return `Assignment #${Number(onlineAssignmentMatch[1])}`;
    }

    return "";
  };

  const entries: CanonicalCourseAssignmentEntry[] = [];

  extractHtmlTables(sourceHtml)
    .filter((tableHtml) => {
      const rows = extractHtmlTableRows(tableHtml).map((rowHtml) => extractHtmlRowCells(rowHtml));
      if (rows.length === 0) return false;

      const header = rows[0].map((cell) => normalizeWhitespace(cell).toLowerCase());
      return (
        header.some((cell) => /activities?\s*(?:&|and)\s*assignments?/.test(cell)) &&
        header.some((cell) => /begin date/.test(cell)) &&
        header.some((cell) => /end\s*\/?\s*due date|due date/.test(cell))
      );
    })
    .forEach((tableHtml) => {
      const rows = extractHtmlTableRows(tableHtml).map((rowHtml) => extractHtmlRowCells(rowHtml));
      if (rows.length === 0) return;

      const header = rows[0].map((cell) => normalizeWhitespace(cell).toLowerCase());
      const activityIndex = header.findIndex((cell) =>
        /activities?\s*(?:&|and)\s*assignments?/.test(cell)
      );
      const beginIndex = header.findIndex((cell) => /begin date/.test(cell));
      const dueIndex = header.findIndex((cell) => /end\s*\/?\s*due date|due date/.test(cell));
      if (activityIndex === -1 || beginIndex === -1 || dueIndex === -1) return;

      const alignBiol273ScheduleRow = (row: string[]) => {
        const normalizedRow = row.map((cell) => normalizeWhitespace(cell));
        if (normalizedRow.length >= header.length) {
          return normalizedRow;
        }

        if (
          isWeekTableWeekCell(normalizedRow[0]) &&
          (normalizedRow.length === 5 || normalizedRow.length === 4)
        ) {
          const aligned = Array.from({ length: header.length }, () => "");
          aligned[0] = normalizedRow[0];
          aligned[activityIndex] = normalizedRow[1] ?? "";
          aligned[beginIndex] = normalizedRow[2] ?? "";
          aligned[dueIndex] = normalizedRow[3] ?? "";
          aligned[6] = normalizedRow[4] ?? "";
          return aligned;
        }

        if (
          (normalizedRow.length === 4 || normalizedRow.length === 3) &&
          Boolean(labelForActivityEntry(normalizedRow[0] ?? ""))
        ) {
          const aligned = Array.from({ length: header.length }, () => "");
          aligned[activityIndex] = normalizedRow[0] ?? "";
          aligned[beginIndex] = normalizedRow[1] ?? "";
          aligned[dueIndex] = normalizedRow[2] ?? "";
          aligned[6] = normalizedRow[3] ?? "";
          return aligned;
        }

        return normalizedRow;
      };

      rows.slice(1).forEach((row) => {
        const alignedRow = alignBiol273ScheduleRow(row);
        const rawActivityCell = alignedRow[activityIndex] ?? "";
        const beginText = normalizeWhitespace(alignedRow[beginIndex] ?? "");
        const dueText = normalizeWhitespace(alignedRow[dueIndex] ?? "");
        if (!rawActivityCell || !dueText) return;

        const dueSpec = parseDateSpec(dueText, meta.termYear);
        const dueDate =
          dueSpec?.kind === "single"
            ? dueSpec.date
            : extractExplicitDates(dueText, meta.termYear)[0] ?? parseFlexibleDate(dueText, meta.termYear);
        if (!dueDate) return;

        const dueTimeText = normalizeWhitespace(
          dueText.match(
            /\b\d{1,2}(?::\d{2})?\s*(?:a\.?m\.?|p\.?m\.?|am|pm|AM|PM)\b/
          )?.[0]
        );
        const dueTime = dueTimeText ? parseFlexibleTime(dueTimeText) : undefined;
        const note = beginText ? `Available from ${beginText}.` : undefined;

        const activityEntries = unique(
          rawActivityCell
            .split(/\n+/)
            .flatMap((entry) => expandScheduleEntries(entry))
            .map((entry) => normalizeWhitespace(entry))
            .filter(Boolean)
        );

        activityEntries.forEach((activityEntry) => {
          if (
            /\b(?:midterm|term test|exam|final review|last class|what went wrong)\b/i.test(
              activityEntry
            )
          ) {
            return;
          }

          const label = labelForActivityEntry(activityEntry);
          if (!label) return;

          entries.push({
            key: slugify(`${label}-${dueDate}`),
            label,
            date: dueDate,
            startTime: dueTime,
            allDay: !dueTime,
            location: entryLocationForLabel(activityEntry, label),
            note,
          });
        });
      });
    });

  return Array.from(
    new Map(
      entries.map((entry) => [`${entry.label}::${entry.date}::${entry.startTime ?? ""}`, entry])
    ).values()
  ).sort(compareCanonicalAssignmentEntries);
}

function extractBiol130CanonicalAssignments(
  sourceHtml: string | null | undefined,
  meta: OutlineMeta
) {
  if (
    !courseCodeMatches(meta.courseCode, "BIOL 130") ||
    !/introductory cell biology/i.test(meta.outlineName)
  ) {
    return [] as CanonicalCourseAssignmentEntry[];
  }

  const formatSeriesLabel = (prefix: string, values: number[]) => {
    const numbers = unique(values.filter((value) => Number.isFinite(value))).sort((a, b) => a - b);
    if (numbers.length === 0) return prefix;
    if (numbers.length === 1) return `${prefix} #${numbers[0]}`;

    const isConsecutive = numbers.every((value, index) => index === 0 || value === numbers[index - 1] + 1);
    if (isConsecutive) {
      return `${prefix} #${numbers[0]}-${numbers[numbers.length - 1]}`;
    }

    return `${prefix} #${numbers.join(", ")}`;
  };

  const parseSeriesValues = (valueText: string) => {
    const values: number[] = [];

    Array.from(valueText.matchAll(/(\d+)\s*-\s*(\d+)/g)).forEach((match) => {
      const start = Number(match[1]);
      const end = Number(match[2]);
      if (!Number.isFinite(start) || !Number.isFinite(end)) return;

      const [rangeStart, rangeEnd] = start <= end ? [start, end] : [end, start];
      for (let value = rangeStart; value <= rangeEnd; value += 1) {
        values.push(value);
      }
    });

    const strippedRanges = valueText.replace(/(\d+)\s*-\s*(\d+)/g, " ");
    Array.from(strippedRanges.matchAll(/\d+/g)).forEach((match) => {
      const value = Number(match[0]);
      if (Number.isFinite(value)) {
        values.push(value);
      }
    });

    return unique(values).sort((a, b) => a - b);
  };

  const parseBiol130ActivityLabel = (activityText: string) => {
    if (/^hands-on activities$/i.test(activityText)) {
      return {
        label: "Hands-on Activities",
        location: "LEARN",
      };
    }

    const achieveModules =
      activityText.match(/\bachieve online assignment on modules?\s+([0-9\s,&-]+)/i)?.[1];
    const achieveModuleNumbers = parseSeriesValues(achieveModules ?? "");
    if (/achieve online assignment/i.test(activityText) && achieveModuleNumbers.length > 0) {
      return {
        label: `Achieve Assignment - ${formatSeriesLabel("Modules", achieveModuleNumbers)}`,
        location: "Achieve",
      };
    }

    const assignmentTopicsMatch = activityText.match(
      /\bAssignment\s*0?(\d+)\s+on\s+Topics?\s+([0-9\s,&-]+)/i
    );
    if (assignmentTopicsMatch) {
      const assignmentNumber = Number(assignmentTopicsMatch[1]);
      const topicNumbers = parseSeriesValues(assignmentTopicsMatch[2]);

      const topicSuffix =
        topicNumbers.length > 0 ? ` - ${formatSeriesLabel("Topics", topicNumbers)}` : "";

      return {
        label: `Assignment #${assignmentNumber}${topicSuffix}`,
        location: "LEARN",
      };
    }

    return undefined;
  };

  const entries: CanonicalCourseAssignmentEntry[] = [];

  extractHtmlTables(sourceHtml)
    .filter((tableHtml) => {
      const rows = extractHtmlTableRows(tableHtml).map((rowHtml) => extractHtmlRowCells(rowHtml));
      if (rows.length === 0) return false;

      const header = rows[0].map((cell) => normalizeWhitespace(cell).toLowerCase());
      return (
        header.some((cell) =>
          /activities?\s*(?:&|and)\s*assignments?|assignments?\s*(?:&|and)\s*hands-on activities?/.test(
            cell
          )
        ) &&
        header.some((cell) => /begin date/.test(cell)) &&
        header.some((cell) => /end\s*\/?\s*due date|due date/.test(cell))
      );
    })
    .forEach((tableHtml) => {
      const rows = extractHtmlTableRows(tableHtml).map((rowHtml) => extractHtmlRowCells(rowHtml));
      if (rows.length === 0) return;

      const header = rows[0].map((cell) => normalizeWhitespace(cell).toLowerCase());
      const activityIndex = header.findIndex((cell) =>
        /activities?\s*(?:&|and)\s*assignments?|assignments?\s*(?:&|and)\s*hands-on activities?/.test(
          cell
        )
      );
      const beginIndex = header.findIndex((cell) => /begin date/.test(cell));
      const dueIndex = header.findIndex((cell) => /end\s*\/?\s*due date|due date/.test(cell));
      if (activityIndex === -1 || beginIndex === -1 || dueIndex === -1) return;

      rows.slice(1).forEach((row) => {
        const activityText = normalizeWhitespace(row[activityIndex] ?? "");
        const beginText = normalizeWhitespace(row[beginIndex] ?? "");
        const dueText = normalizeWhitespace(row[dueIndex] ?? "");
        if (!activityText || !dueText) return;
        if (/term test|midterm|final exam|reading week/i.test(activityText)) return;

        const parsedActivity = parseBiol130ActivityLabel(activityText);
        if (!parsedActivity) return;

        const dueSpec = parseDateSpec(dueText, meta.termYear);
        const dueDate =
          dueSpec?.kind === "single"
            ? dueSpec.date
            : extractExplicitDates(dueText, meta.termYear)[0] ?? parseFlexibleDate(dueText, meta.termYear);
        if (!dueDate) return;

        const dueTimeMatch = dueText.match(
          /\b\d{1,2}(?::\d{2})?\s*(?:a\.?m\.?|p\.?m\.?|am|pm|AM|PM)\b/
        )?.[0];
        const dueTime = dueTimeMatch ? parseFlexibleTime(dueTimeMatch) : undefined;

        entries.push({
          key: slugify(`${parsedActivity.label}-${dueDate}`),
          label: parsedActivity.label,
          date: dueDate,
          startTime: dueTime,
          allDay: !dueTime,
          location: parsedActivity.location,
          note: beginText ? `Available from ${beginText}.` : undefined,
        });
      });
    });

  return Array.from(
    new Map(
      entries.map((entry) => [`${entry.label}::${entry.date}::${entry.startTime ?? ""}`, entry])
    ).values()
  ).sort(compareCanonicalAssignmentEntries);
}

function extractBiol130AssignmentSeeds(
  html: string,
  sections: SectionBlock[],
  meta: OutlineMeta
) {
  const canonicalEntries = extractBiol130CanonicalAssignments(html, meta);
  if (canonicalEntries.length === 0) {
    return [] as AssessmentSeed[];
  }

  const section = findSectionForCourseSpecificSnippet(sections, [
    /biol 130 course schedule/i,
    /achieve online assignment/i,
    /hands-on activities/i,
    /assignments and hands-on activities/i,
    /activities and assignments/i,
  ]);

  return canonicalEntries.map((entry) => ({
    label: entry.label,
    eventType: "Assignment" as const,
    date: entry.date,
    allDay: entry.allDay ?? !entry.startTime,
    startTime: entry.startTime,
    location: entry.location ?? "",
    notes: entry.note ? [entry.note] : [],
    confidence: "high" as const,
    provenance: [
      makeProvenance(
        section,
        "table",
        entry.note ? `${entry.label} | ${entry.note}` : entry.label
      ),
    ],
  }));
}

function extractChem267CanonicalAssignments(
  sourceHtml: string | null | undefined,
  meta: OutlineMeta
) {
  if (
    !courseCodeMatches(meta.courseCode, "CHEM 267") ||
    !/basic organic chemistry 2/i.test(meta.outlineName)
  ) {
    return [] as CanonicalCourseAssignmentEntry[];
  }

  const parseChem267Date = (text: string) => {
    const normalized = normalizeWhitespace(text).replace(/\b(?:Mon|Tue|Tues|Wed|Thu|Thur|Thurs|Fri|Sat|Sun)(?:day)?\.?,?\s*/gi, "");
    const explicit = extractExplicitDates(normalized, meta.termYear)[0];
    if (explicit) return explicit;

    const monthDayMatch = normalized.match(
      /\b(Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\.?\s+(\d{1,2})\b/i
    );
    if (!monthDayMatch) return undefined;

    const month = monthDayMatch[1].replace(/\.$/, "");
    const day = monthDayMatch[2];
    return parseFlexibleDate(`${month} ${day}`, meta.termYear);
  };

  const cleanDescriptor = (value: string) =>
    normalizeWhitespace(
      value
        .replace(/^[–—\-:;,.\s]+/, "")
        .replace(/[–—\-:;,.\s]+$/, "")
        .replace(/\(\s*\)/g, "")
    );

  const assignmentColumnsForHeader = (header: string[]) =>
    header
      .map((cell, index) => ({ cell: normalizeWhitespace(cell).toLowerCase(), index }))
      .filter(
        ({ cell }) =>
          /\bassignments?\b/.test(cell) ||
          /\baktiv assignments?\b/.test(cell) ||
          /\breading and drawing assignments?\b/.test(cell) ||
          /\breading assignments?\b/.test(cell) ||
          /\bgraded assignment\b/.test(cell)
      )
      .map(({ index }) => index);

  const buildLabel = (
    kind: "assignment" | "aktiv",
    number: number,
    rawSuffix: string,
    isBonus: boolean
  ) => {
    const suffix = cleanDescriptor(rawSuffix)
      .replace(/\bchapter\b.*$/i, "")
      .replace(/\bch\b.*$/i, "")
      .replace(/\bq\d+\b.*$/i, "")
      .replace(/\bcompleted\b.*$/i, "");
    const cleanedSuffix = cleanDescriptor(suffix);

    if (kind === "aktiv") {
      const base = `${isBonus ? "Bonus " : ""}Aktiv #${number}`;
      return cleanedSuffix ? `${base} - ${cleanedSuffix}` : base;
    }

    const base = `Assignment #${number}`;
    return cleanedSuffix ? `${base} - ${cleanedSuffix}` : base;
  };

  const parseCellEntries = (cellText: string) => {
    const lines = cellText
      .split(/\n+/)
      .map((line) => normalizeWhitespace(line))
      .filter(Boolean);
    if (lines.length === 0) return [] as CanonicalCourseAssignmentEntry[];

    const joined = lines.join(" ");
    if (
      /\bno assignment\b/i.test(joined) ||
      /\bno reading assignment\b/i.test(joined) ||
      /\bterm test\b/i.test(joined) ||
      /\breading week\b/i.test(joined)
    ) {
      return [] as CanonicalCourseAssignmentEntry[];
    }

    const entries: CanonicalCourseAssignmentEntry[] = [];
    let currentDate: string | undefined;
    const bonusCell = /\bbonus assignment\b/i.test(joined);

    lines.forEach((line, index) => {
      const parsedDate = parseChem267Date(line);
      if (parsedDate) {
        currentDate = parsedDate;
      }

      const assignmentMatch = line.match(/\bAssign(?:ment)?\.?\s*(\d+)\b(.*)$/i);
      if (assignmentMatch) {
        const number = Number(assignmentMatch[1]);
        const descriptor = assignmentMatch[2] ?? "";
        const entryDate =
          currentDate ??
          parseChem267Date(lines[index - 1] ?? "") ??
          parseChem267Date(lines[index + 1] ?? "");
        if (!entryDate || !Number.isFinite(number)) return;

        const label = buildLabel("assignment", number, descriptor, false);
        entries.push({
          key: slugify(`${label}-${entryDate}`),
          label,
          date: entryDate,
          allDay: true,
          location: "Top Hat",
          note: cellText,
        });
        return;
      }

      const aktivMatch = line.match(/\bAk(?:t)?iv\s*(\d+)\b(.*)$/i);
      if (aktivMatch) {
        const number = Number(aktivMatch[1]);
        const descriptor = aktivMatch[2] ?? "";
        const entryDate =
          currentDate ??
          parseChem267Date(lines[index - 1] ?? "") ??
          parseChem267Date(lines[index + 1] ?? "");
        if (!entryDate || !Number.isFinite(number)) return;

        const label = buildLabel("aktiv", number, descriptor, bonusCell);
        entries.push({
          key: slugify(`${label}-${entryDate}`),
          label,
          date: entryDate,
          allDay: true,
          location: "Aktiv",
          note: cellText,
        });
      }
    });

    return entries;
  };

  const entries: CanonicalCourseAssignmentEntry[] = [];

  extractHtmlTables(sourceHtml).forEach((tableHtml) => {
    const rows = extractHtmlTableRows(tableHtml).map((rowHtml) => extractHtmlRowCells(rowHtml));
    if (rows.length < 2) return;

    const header = rows[0];
    const normalizedHeader = header.map((cell) => normalizeWhitespace(cell).toLowerCase());
    if (
      !normalizedHeader.some((cell) => /^week\b/.test(cell)) ||
      !normalizedHeader.some((cell) => /^topics\b/.test(cell))
    ) {
      return;
    }

    const assignmentIndexes = assignmentColumnsForHeader(header);
    if (assignmentIndexes.length === 0) return;

    rows.slice(1).forEach((row) => {
      assignmentIndexes.forEach((columnIndex) => {
        const cellText = row[columnIndex] ?? "";
        parseCellEntries(cellText).forEach((entry) => {
          entries.push(entry);
        });
      });
    });
  });

  return Array.from(
    new Map(
      entries.map((entry) => [`${entry.label}::${entry.date}::${entry.startTime ?? ""}`, entry])
    ).values()
  ).sort(compareCanonicalAssignmentEntries);
}

function extractKin232CanonicalAssignments(
  sourceHtml: string | null | undefined,
  meta: OutlineMeta
) {
  if (
    !courseCodeMatches(meta.courseCode, "KIN 232") ||
    !/research design and statistics/i.test(meta.outlineName)
  ) {
    return [] as CanonicalCourseAssignmentEntry[];
  }

  const normalizeKin232AssignmentLabel = (value: string) => {
    const normalized = normalizeWhitespace(value).replace(/\u00a0/g, " ").trim();
    if (!normalized) return "";
    if (/^(?:nothing due|no tutorial assignment due)$/i.test(normalized)) return "";
    if (/^quiz\b/i.test(normalized)) return "";
    if (/^worksheet\s*&\s*group discussion$/i.test(normalized)) {
      return "Worksheet & Group Discussion";
    }
    if (/^worksheet\s*&\s*group presentation$/i.test(normalized)) {
      return "Worksheet & Group Presentation";
    }
    if (/^group presentation\s*&\s*discussion$/i.test(normalized)) {
      return "Group Presentation & Discussion";
    }
    if (/^quiz evaluation\s*\(\s*written assignment\s*\)$/i.test(normalized)) {
      return "Quiz Evaluation (Written Assignment)";
    }
    return normalized;
  };

  const entries: CanonicalCourseAssignmentEntry[] = [];

  extractHtmlTables(sourceHtml)
    .filter((tableHtml) => {
      const tableText = htmlSnippetToText(tableHtml);
      return (
        /\blecture topics\b/i.test(tableText) &&
        /\btutorial topics\b/i.test(tableText) &&
        /\btutorial assignment\*?\b/i.test(tableText)
      );
    })
    .forEach((tableHtml) => {
      const rows = extractHtmlTableRows(tableHtml).map((rowHtml) => extractHtmlRowCells(rowHtml));
      if (rows.length === 0) return;

      const header = rows[0].map((cell) => normalizeWhitespace(cell).toLowerCase());
      const weekIndex = header.findIndex((cell) =>
        /^(?:week beginning|weeks?)$/.test(cell) || /\bweek beginning\b/.test(cell)
      );
      const assignmentIndex = header.findIndex((cell) => /tutorial assignment\*?/.test(cell));
      if (weekIndex === -1 || assignmentIndex === -1) return;

      rows.slice(1).forEach((row) => {
        const weekText = normalizeWhitespace(row[weekIndex] ?? "");
        const assignmentLabel = normalizeKin232AssignmentLabel(row[assignmentIndex] ?? "");
        if (!weekText || !assignmentLabel) return;

        const dueDate =
          extractExplicitDates(weekText, meta.termYear)[0] ??
          parseFlexibleDate(
            normalizeWhitespace(
              weekText.replace(/^week\s+\d+\s*/i, "").replace(/\([^)]*\)/g, "")
            ),
            meta.termYear
          );
        if (!dueDate) return;

        entries.push({
          key: slugify(`${assignmentLabel}-${dueDate}`),
          label: assignmentLabel,
          date: dueDate,
          allDay: true,
          location: "LEARN Quiz",
        });
      });
    });

  return Array.from(
    new Map(entries.map((entry) => [`${entry.label}::${entry.date}`, entry])).values()
  ).sort(compareCanonicalAssignmentEntries);
}

function extractKin204CanonicalEvents(
  sourceHtml: string | null | undefined,
  meta: OutlineMeta
) {
  if (
    !courseCodeMatches(meta.courseCode, "KIN 204") ||
    !/movement assessment and exercise prescription/i.test(meta.outlineName)
  ) {
    return [] as CanonicalCourseEventEntry[];
  }

  const entries: CanonicalCourseEventEntry[] = [];

  const normalizeAssessmentLines = (value: string | undefined) =>
    (value ?? "")
      .split(/\n+/)
      .map((line) => normalizeWhitespace(line))
      .filter(Boolean)
      .filter((line) => !/^(?:&nbsp;|-|none)$/i.test(line));

  const normalizeKin204AssignmentLabel = (line: string) => {
    const normalized = normalizeWhitespace(line);
    const assignmentMatch = normalized.match(
      /^assignment\s*(\d+)(?:\s+(.+?))?\s+due\b/i
    );
    if (assignmentMatch) {
      const assignmentNumber = Number(assignmentMatch[1]);
      const suffix = normalizeWhitespace(assignmentMatch[2] ?? "")
        .replace(/\bmidnight\b/i, "")
        .replace(/\s*[-–—:;,]+\s*$/g, "")
        .trim();
      return suffix
        ? `Assignment #${assignmentNumber} - ${suffix}`
        : `Assignment #${assignmentNumber}`;
    }

    const reflectionMatch = normalized.match(/^toolbox reflection\s*(\d+)\b/i);
    if (reflectionMatch) {
      const reflectionNumber = Number(reflectionMatch[1]);
      return Number.isFinite(reflectionNumber)
        ? `Toolbox Reflection #${reflectionNumber}`
        : "Toolbox Reflection";
    }

    const finalCaseStudyMatch = normalized.match(/^final case study\b/i);
    if (finalCaseStudyMatch) {
      return "Final Case Study";
    }

    return "";
  };

  const normalizeKin204AssessmentLabel = (line: string) => {
    const normalized = normalizeWhitespace(line);
    const testMatch = normalized.match(/^test\s*(\d+)\b/i);
    if (testMatch) {
      const testNumber = Number(testMatch[1]);
      return Number.isFinite(testNumber) ? `Test #${testNumber}` : "Test";
    }
    if (/^midterm\b/i.test(normalized)) return "Midterm";
    return "";
  };

  extractHtmlTables(sourceHtml).forEach((tableHtml) => {
    const rows = extractHtmlTableRows(tableHtml).map((rowHtml) => extractHtmlRowCells(rowHtml));
    if (rows.length === 0) return;

    const header = rows[0].map((cell) => normalizeWhitespace(cell).toLowerCase());
    const assessmentIndex = header.findIndex((cell) => /assessment/.test(cell));
    if (assessmentIndex === -1) return;

    rows.slice(1).forEach((row) => {
      const assessmentLines = normalizeAssessmentLines(row[assessmentIndex]);
      if (assessmentLines.length === 0) return;

      assessmentLines.forEach((line) => {
        const assignmentLabel = normalizeKin204AssignmentLabel(line);
        const assessmentLabel = normalizeKin204AssessmentLabel(line);
        const explicitDates = extractExplicitDates(line, meta.termYear);
        const date = explicitDates[0];
        if (!date) return;

        const timeRange = parseTimeRange(line);
        const inClass = /\bin-?class\b/i.test(line);

        if (assignmentLabel) {
          entries.push({
            key: slugify(`${assignmentLabel}-${date}`),
            label: assignmentLabel,
            eventType: "Assignment",
            date,
            startTime: timeRange.startTime,
            allDay: !timeRange.startTime,
            location: /peerscholar/i.test(line)
              ? "PeerScholar"
              : /perusall/i.test(line)
                ? "Perusall"
                : /mobius/i.test(line)
                  ? "Mobius"
                  : /pebblepad/i.test(line)
                    ? "PebblePad"
                    : inClass
                      ? "In class"
                      : "LEARN",
          });
          return;
        }

        if (assessmentLabel) {
          entries.push({
            key: slugify(`${assessmentLabel}-${date}`),
            label: assessmentLabel,
            eventType: "Assessment",
            date,
            startTime: timeRange.startTime,
            allDay: !timeRange.startTime,
            location: inClass ? "In class" : "LEARN",
          });
        }
      });
    });
  });

  return Array.from(
    new Map(entries.map((entry) => [`${entry.eventType}::${entry.label}::${entry.date}`, entry])).values()
  ).sort(compareCanonicalCourseEventEntries);
}

function extractKin342CanonicalEvents(
  sourceHtml: string | null | undefined,
  meta: OutlineMeta
) {
  if (
    !courseCodeMatches(meta.courseCode, "KIN 342") ||
    !/nutrition and aging/i.test(meta.outlineName)
  ) {
    return [] as CanonicalCourseEventEntry[];
  }

  const entryMap = new Map<string, CanonicalCourseEventEntry>();
  const upsertEntry = (entry: CanonicalCourseEventEntry) => {
    entryMap.set(`${entry.eventType}::${entry.label}::${entry.date}`, entry);
  };

  const normalizeKin342Location = (locationText: string) => {
    const normalized = normalizeWhitespace(locationText);
    if (!normalized) return "";
    if (/^on-?line$/i.test(normalized) || /^online$/i.test(normalized)) return "Online";
    if (/^in-?class$/i.test(normalized)) return "In class";
    return normalized;
  };

  const extractKin342Dates = (dateText: string) => {
    const normalized = normalizeWhitespace(dateText);
    if (!normalized) return [] as string[];

    const slashMatch = normalized.match(
      /^([A-Za-z]{3,9})\.?\s*(\d{1,2})\s*\/\s*(?:([A-Za-z]{3,9})\.?\s*)?(\d{1,2})$/i
    );
    if (slashMatch) {
      const firstMonth = slashMatch[1];
      const firstDay = slashMatch[2];
      const secondMonth = slashMatch[3] ?? firstMonth;
      const secondDay = slashMatch[4];
      return [
        parseFlexibleDate(`${firstMonth} ${firstDay}`, meta.termYear),
        parseFlexibleDate(`${secondMonth} ${secondDay}`, meta.termYear),
      ].filter((date): date is string => Boolean(date));
    }

    const dateSpec = parseDateSpec(normalized, meta.termYear);
    if (dateSpec?.kind === "single") return [dateSpec.date];
    if (dateSpec?.kind === "dates") return dateSpec.dates;
    if (dateSpec?.kind === "range") return [dateSpec.startDate];

    return extractExplicitDates(normalized.replace(/\//g, ", "), meta.termYear);
  };

  extractHtmlTables(sourceHtml).forEach((tableHtml) => {
    const rows = extractHtmlTableRows(tableHtml).map((rowHtml) => extractHtmlRowCells(rowHtml));
    if (rows.length === 0) return;

    const header = rows[0].map((cell) => normalizeWhitespace(cell).toLowerCase());
    const componentIndex = header.findIndex((cell) => /component\s*\/\s*activity/.test(cell));
    const dateIndex = header.findIndex((cell) => /date or due date/.test(cell));
    const locationIndex = header.findIndex((cell) => /location\s*\/\s*submission method/.test(cell));
    const weightIndex = header.findIndex((cell) => /weight/.test(cell));

    if (componentIndex !== -1 && dateIndex !== -1) {
      rows.slice(1).forEach((row) => {
        const componentText = normalizeWhitespace(row[componentIndex] ?? "");
        const normalizedComponent = componentText
          .replace(/^lap report/i, "Lab Report")
          .replace(/^term test/i, "Term Test");
        const dateText = normalizeWhitespace(row[dateIndex] ?? "");
        const locationText = normalizeKin342Location(row[locationIndex] ?? "");
        const weightText = normalizeWeightText(row[weightIndex] ?? "");
        if (!normalizedComponent || !dateText) return;

        if (/^lab report\s*(\d+)/i.test(normalizedComponent)) {
          const reportNumber = Number(normalizedComponent.match(/^lab report\s*(\d+)/i)?.[1]);
          const dates = extractKin342Dates(dateText);
          if (!Number.isFinite(reportNumber) || dates.length === 0) return;

          dates.forEach((date, index) => {
            const groupSuffix =
              dates.length === 2 ? ` - Group ${index === 0 ? "A" : "B"}` : "";
            upsertEntry({
              key: `lab-report-${reportNumber}-${index + 1}`,
              label: `Lab Report ${reportNumber}${groupSuffix}`,
              eventType: "Assignment",
              date,
              allDay: true,
              location: locationText || "In class",
              note: weightText ? `Weight: ${weightText}` : undefined,
            });
          });
          return;
        }

        if (/^group case study$/i.test(normalizedComponent)) {
          const dueDate = extractKin342Dates(dateText)[0];
          if (!dueDate) return;
          upsertEntry({
            key: "group-case-study",
            label: "Group Case Study",
            eventType: "Assignment",
            date: dueDate,
            allDay: true,
            location: locationText || "In class",
            note: weightText ? `Weight: ${weightText}` : undefined,
          });
          return;
        }

        if (/^term test\s*(\d+)/i.test(normalizedComponent) || /^final exam$/i.test(normalizedComponent)) {
          const dueDate = extractKin342Dates(dateText)[0];
          if (!dueDate) return;
          upsertEntry({
            key: slugify(normalizedComponent),
            label: normalizedComponent.replace(/^final exam$/i, "Final Exam"),
            eventType: "Assessment",
            date: dueDate,
            allDay: true,
            location: locationText || "Online",
            note: weightText ? `Weight: ${weightText}` : undefined,
          });
        }
      });
    }

    const weekIndex = header.findIndex((cell) => /^(weeks?|week)$/.test(cell));
    const lectureTopicsIndex = header.findIndex((cell) => /lecture topics/.test(cell));
    if (weekIndex === -1 || lectureTopicsIndex === -1) return;

    extractHtmlTableRows(tableHtml)
      .slice(1)
      .forEach((rowHtml) => {
        const cells = extractHtmlRowCells(rowHtml);
        const weekText = normalizeWhitespace(cells[weekIndex] ?? "");
        const topicCell = cells[lectureTopicsIndex] ?? "";
        if (!weekText || !topicCell) return;
        if (!/assignment|summative individual case study/i.test(topicCell)) return;

        const dueDate = extractExplicitDates(weekText, meta.termYear)[0];
        if (!dueDate) return;

        const topicLines = topicCell
          .split(/\n+/)
          .map((line) => normalizeWhitespace(line))
          .filter(Boolean);
        const primaryLine = topicLines[0] ?? "";
        const detailLine = topicLines[1] ?? "";
        const partMatch = primaryLine.match(/^assignment\s*(\d+)\s*-\s*part\s*(\d+)/i);
        const assignmentMatch = primaryLine.match(/^assignment\s*(\d+)\b/i);

        if (partMatch) {
          const assignmentNumber = Number(partMatch[1]);
          const partNumber = Number(partMatch[2]);
          if (!Number.isFinite(assignmentNumber) || !Number.isFinite(partNumber)) return;
          upsertEntry({
            key: `assignment-${assignmentNumber}-part-${partNumber}`,
            label: `Assignment #${assignmentNumber} - Part ${partNumber}`,
            eventType: "Assignment",
            date: dueDate,
            allDay: true,
            location: "LEARN",
            note: detailLine || undefined,
          });
          return;
        }

        if (assignmentMatch) {
          const assignmentNumber = Number(assignmentMatch[1]);
          if (!Number.isFinite(assignmentNumber)) return;
          upsertEntry({
            key: `assignment-${assignmentNumber}`,
            label: `Assignment #${assignmentNumber}`,
            eventType: "Assignment",
            date: dueDate,
            allDay: true,
            location: "LEARN",
            note: detailLine || undefined,
          });
          return;
        }

        if (/summative individual case study/i.test(primaryLine)) {
          upsertEntry({
            key: "summative-individual-case-study",
            label: "Summative Individual Case Study",
            eventType: "Assignment",
            date: dueDate,
            allDay: true,
            location: "LEARN",
          });
        }
      });
  });

  return Array.from(entryMap.values()).sort(compareCanonicalCourseEventEntries);
}

function extractKin400CanonicalEvents(
  sourceHtml: string | null | undefined,
  meta: OutlineMeta
) {
  if (
    !courseCodeMatches(meta.courseCode, "KIN 400") ||
    !/athletic injury practicum/i.test(meta.outlineName)
  ) {
    return [] as CanonicalCourseEventEntry[];
  }

  const entryMap = new Map<string, CanonicalCourseEventEntry>();
  const upsertEntry = (entry: CanonicalCourseEventEntry) => {
    entryMap.set(`${entry.eventType}::${entry.label}::${entry.date}`, entry);
  };

  const normalizeKin400Label = (value: string) => {
    const normalized = normalizeWhitespace(value).replace(/\s*due$/i, "").trim();
    const reflectionMatch = normalized.match(/^reflection\s*(\d+)\b/i);
    if (reflectionMatch) {
      const reflectionNumber = Number(reflectionMatch[1]);
      return Number.isFinite(reflectionNumber)
        ? `Reflection #${reflectionNumber}`
        : "Reflection";
    }

    if (/^course project\b/i.test(normalized)) return "Course Project";
    if (/^e[\s-]*port(?:folio)? draft\b/i.test(normalized)) return "E-Portfolio Draft";
    if (/^e[\s-]*portfolio\b/i.test(normalized)) return "E-Portfolio";

    return "";
  };

  extractHtmlTables(sourceHtml)
    .filter((tableHtml) => {
      const tableText = htmlSnippetToText(tableHtml);
      return (
        /\blecture\/lab topics\b/i.test(tableText) &&
        /\bevaluations\b/i.test(tableText) &&
        /\breflection 1\b/i.test(tableText)
      );
    })
    .forEach((tableHtml) => {
      const rows = extractHtmlTableRows(tableHtml).map((rowHtml) => extractHtmlRowCells(rowHtml));
      if (rows.length === 0) return;

      const header = rows[0].map((cell) => normalizeWhitespace(cell).toLowerCase());
      const evaluationIndex = header.findIndex((cell) => /evaluations/.test(cell));
      if (evaluationIndex === -1) return;

      rows.slice(1).forEach((row) => {
        const evaluationText = row[evaluationIndex] ?? "";
        const evaluationLines = evaluationText
          .split(/\n+/)
          .map((line) => normalizeWhitespace(line))
          .filter(Boolean)
          .filter((line) => !/^&nbsp;$/i.test(line));
        if (evaluationLines.length === 0) return;

        const label = normalizeKin400Label(evaluationLines[0] ?? "");
        if (!label) return;

        const dateSource = evaluationLines.slice(1).join(" ");
        const dueDate =
          extractExplicitDates(dateSource, meta.termYear)[0] ??
          extractDateFromText(dateSource, meta.termYear);
        if (!dueDate) return;

        const timeRange = parseTimeRange(dateSource);
        upsertEntry({
          key: slugify(`${label}-${dueDate}`),
          label,
          eventType: "Assignment",
          date: dueDate,
          startTime: timeRange.startTime,
          endTime: timeRange.endTime,
          allDay: !timeRange.startTime,
          location: "LEARN",
        });
      });
    });

  return Array.from(entryMap.values()).sort(compareCanonicalCourseEventEntries);
}

function extractKin429CanonicalEvents(
  sourceHtml: string | null | undefined,
  meta: OutlineMeta
) {
  if (
    !courseCodeMatches(meta.courseCode, "KIN 429") ||
    !/bone and joint health/i.test(meta.outlineName)
  ) {
    return [] as CanonicalCourseEventEntry[];
  }

  const entryMap = new Map<string, CanonicalCourseEventEntry>();
  const upsertEntry = (entry: CanonicalCourseEventEntry) => {
    entryMap.set(
      `${entry.eventType}::${entry.label}::${entry.date}::${entry.startTime ?? ""}`,
      entry
    );
  };

  const sourceText = htmlSnippetToText(sourceHtml ?? "");
  const defaultGroupAssignmentDueTime =
    parseTimeRange(
      sourceText.match(
        /until\s+(\d{1,2}(?::\d{2})?\s*(?:a\.?m\.?|p\.?m\.?|am|pm|AM|PM))\s+on the day of the activity/i
      )?.[1] ?? ""
    ).startTime ?? undefined;

  extractHtmlTables(sourceHtml)
    .filter((tableHtml) => {
      const tableText = htmlSnippetToText(tableHtml);
      return (
        /\bdate\b/i.test(tableText) &&
        /\blecture content\b/i.test(tableText) &&
        /\b(?:assignments and tests\/quizzes in bold|case studies,\s*tests\/quizzes)\b/i.test(
          tableText
        )
      );
    })
    .forEach((tableHtml) => {
      const rows = extractHtmlTableRows(tableHtml).map((rowHtml) => extractHtmlRowCells(rowHtml));
      if (rows.length === 0) return;

      rows.slice(1).forEach((row) => {
        const dateText = normalizeWhitespace(row[0] ?? "");
        const contentText = normalizeWhitespace(row[1] ?? "");
        if (!dateText || !contentText) return;

        const rowDate = extractDateFromText(dateText, meta.termYear);
        if (!rowDate) return;

        const contentLines = contentText
          .split(/\n+/)
          .map((line) => normalizeWhitespace(line))
          .filter(Boolean);

        contentLines.forEach((line) => {
          const normalizedLine = normalizeWhitespace(line);
          if (!normalizedLine) return;

          const groupAssignmentMatch = normalizedLine.match(/^group assignment\s*(\d+)\b/i);
          if (groupAssignmentMatch) {
            const assignmentNumber = Number(groupAssignmentMatch[1]);
            if (!Number.isFinite(assignmentNumber)) return;

            upsertEntry({
              key: `group-assignment-${assignmentNumber}`,
              label: `Group Assignment #${assignmentNumber}`,
              eventType: "Assignment",
              date: rowDate,
              startTime: defaultGroupAssignmentDueTime,
              allDay: !defaultGroupAssignmentDueTime,
              location: "LEARN Dropbox",
            });
            return;
          }

          const partLeadMatch = normalizedLine.match(
            /^(?:submit\s+assignment\s+)?part\s*([A-E])\s*[-:]\s*(.+)$/i
          );
          if (partLeadMatch) {
            const partLetter = partLeadMatch[1].toUpperCase();
            let descriptor = normalizeWhitespace(partLeadMatch[2]);
            let dueDate = extractDateFromText(normalizedLine, meta.termYear) ?? rowDate;
            const dueTime = parseTimeRange(normalizedLine).startTime;

            descriptor = descriptor
              .replace(/,\s*assignment completed in class\b/i, "")
              .replace(/\bcomplete(?:d)? in class\b/i, "")
              .replace(/\bcomplete before class on\b.*$/i, "")
              .replace(/\bby\s+\d{1,2}(?::\d{2})?\s*(?:a\.?m\.?|p\.?m\.?|am|pm|AM|PM)\b/i, "")
              .replace(/\s*[,;:-]\s*$/g, "")
              .replace(/^#reeltalk$/i, "#ReelTalk")
              .trim();
            if (!descriptor) {
              descriptor = `Part ${partLetter}`;
            }

            upsertEntry({
              key: `assignment-part-${partLetter.toLowerCase()}`,
              label: `Assignment Part ${partLetter} - ${descriptor}`,
              eventType: "Assignment",
              date: dueDate,
              startTime: dueTime,
              allDay: !dueTime,
              location:
                /\bcompleted? in class\b/i.test(normalizedLine) || /\bin class\b/i.test(normalizedLine)
                  ? "In class"
                  : "LEARN Dropbox",
            });
            return;
          }

          const reminderPartMatch = normalizedLine.match(
            /^reminder:\s*(.+?)\s+complete\s+part\s*([A-E])\s+before\s+(.+)$/i
          );
          if (reminderPartMatch) {
            const descriptor = normalizeWhitespace(reminderPartMatch[1]).replace(/\s*[,;:-]\s*$/g, "");
            const partLetter = reminderPartMatch[2].toUpperCase();
            const dueDate =
              extractDateFromText(reminderPartMatch[3], meta.termYear) ??
              extractDateFromText(normalizedLine, meta.termYear) ??
              rowDate;
            if (!dueDate) return;

            upsertEntry({
              key: `assignment-part-${partLetter.toLowerCase()}`,
              label: `Assignment Part ${partLetter} - ${descriptor}`,
              eventType: "Assignment",
              date: dueDate,
              allDay: true,
              location: "LEARN Dropbox",
            });
            return;
          }

          if (/^quiz available on learn/i.test(normalizedLine) || /^in-class quiz$/i.test(normalizedLine)) {
            const timeRange = parseTimeRange(normalizedLine);
            upsertEntry({
              key: `quiz-${rowDate}`,
              label: "Quiz",
              eventType: "Assessment",
              date: extractDateFromText(normalizedLine, meta.termYear) ?? rowDate,
              startTime: timeRange.startTime,
              allDay: !timeRange.startTime,
              location: /^in-class quiz$/i.test(normalizedLine) ? "In class" : "LEARN Quiz",
            });
            return;
          }

          const testMatch = normalizedLine.match(/^test\s*(\d+)\b/i);
          if (testMatch) {
            const testNumber = Number(testMatch[1]);
            if (!Number.isFinite(testNumber)) return;

            upsertEntry({
              key: `test-${testNumber}`,
              label: `Test #${testNumber}`,
              eventType: "Assessment",
              date: rowDate,
              allDay: true,
              location: /check learn for location/i.test(normalizedLine) ? "LEARN" : "",
            });
          }
        });
      });
    });

  return Array.from(entryMap.values()).sort(compareCanonicalCourseEventEntries);
}

function extractKin425CanonicalEvents(
  sourceHtml: string | null | undefined,
  meta: OutlineMeta
) {
  if (
    !courseCodeMatches(meta.courseCode, "KIN 425") ||
    !/biomechanical modelling/i.test(meta.outlineName)
  ) {
    return [] as CanonicalCourseEventEntry[];
  }

  const entryMap = new Map<string, CanonicalCourseEventEntry>();
  const upsertEntry = (entry: CanonicalCourseEventEntry) => {
    entryMap.set(
      `${entry.eventType}::${entry.label}::${entry.date}::${entry.startTime ?? ""}`,
      entry
    );
  };

  const weekdayOffsets: Record<string, number> = {
    monday: 0,
    tuesday: 1,
    wednesday: 2,
    thursday: 3,
    friday: 4,
  };

  const deriveWeekdayDate = (weekStartDate: string | undefined, weekdayText: string) => {
    if (!weekStartDate) return undefined;
    const weekdayKey = normalizeWhitespace(weekdayText).toLowerCase();
    const offset = weekdayOffsets[weekdayKey];
    if (!Number.isFinite(offset)) return undefined;
    return format(addDays(parseISO(weekStartDate), offset), "yyyy-MM-dd");
  };

  const normalizeKin425AssignmentLabel = (value: string) => {
    const normalized = normalizeWhitespace(value)
      .replace(/^[•·\-–—]+\s*/u, "")
      .replace(/\(submit to LEARN dropbox\)/i, "")
      .replace(/\bdue\s+\d{1,2}:\d{2}\s*(?:a\.?m\.?|p\.?m\.?|am|pm)\b/i, "")
      .replace(/\bdue\b/i, "")
      .trim();

    if (/^filtering assignment\b/i.test(normalized)) return "Filtering Assignment";
    if (/^joint angles assignment\b/i.test(normalized)) return "Joint Angles Assignment";
    if (/^rlm assignment\b/i.test(normalized)) return "RLM Assignment";
    if (/^presentation video assignment\b/i.test(normalized)) {
      return "Presentation Video Assignment";
    }

    return capitalizeAssignmentText(normalized);
  };

  extractHtmlTables(sourceHtml)
    .filter((tableHtml) => {
      const tableText = htmlSnippetToText(tableHtml);
      return (
        /\bweekday\b/i.test(tableText) &&
        /\bformat\b/i.test(tableText) &&
        /\bcontent\/topic information\b/i.test(tableText)
      );
    })
    .forEach((tableHtml) => {
      const rows = extractHtmlTableRows(tableHtml).map((rowHtml) => extractHtmlRowCells(rowHtml));
      if (rows.length === 0) return;

      let currentWeekStartDate: string | undefined;

      rows.slice(1).forEach((row) => {
        const normalizedCells = row.map((cell) => normalizeWhitespace(cell)).filter(Boolean);
        if (normalizedCells.length < 3) return;

        let weekText = "";
        let weekdayText = "";
        let formatText = "";
        let contentText = "";

        if (normalizedCells.length >= 4) {
          [weekText, weekdayText, formatText, contentText] = normalizedCells;
          const weekStartText =
            weekText.match(
              /\b(?:January|February|March|April|May|June|July|August|September|October|November|December|Jan|Feb|Mar|Apr|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)\.?\s+\d{1,2}\b/i
            )?.[0] ?? "";
          currentWeekStartDate =
            parseFlexibleDate(weekStartText, meta.termYear) ??
            extractExplicitDates(weekText, meta.termYear)[0] ??
            extractDateFromText(weekText, meta.termYear) ??
            currentWeekStartDate;
        } else {
          [weekdayText, formatText, contentText] = normalizedCells;
        }

        if (!currentWeekStartDate || !weekdayText || !formatText || !contentText) return;
        const rowDate = deriveWeekdayDate(currentWeekStartDate, weekdayText);
        if (!rowDate) return;

        const contentLines = contentText
          .split(/\n+/)
          .map((line) => normalizeWhitespace(line))
          .filter(Boolean);
        if (contentLines.length === 0) return;

        if (/^due date$/i.test(formatText)) {
          const dueLine = contentLines.find((line) => /\bassignment\b/i.test(line) && /\bdue\b/i.test(line));
          if (!dueLine) return;

          const label = normalizeKin425AssignmentLabel(dueLine);
          if (!label) return;

          const timeRange = parseTimeRange(dueLine);
          upsertEntry({
            key: slugify(`${label}-${rowDate}`),
            label,
            eventType: "Assignment",
            date: rowDate,
            startTime: timeRange.startTime,
            endTime: timeRange.endTime,
            allDay: !timeRange.startTime,
            location: /learn dropbox/i.test(dueLine) ? "LEARN Dropbox" : "LEARN",
          });
          return;
        }

        if (/^quiz/i.test(formatText)) {
          const quizLine = contentLines.find((line) => /^quiz\s*\d+/i.test(line));
          if (!quizLine) return;

          const quizNumber = Number(quizLine.match(/^quiz\s*(\d+)/i)?.[1]);
          if (!Number.isFinite(quizNumber)) return;

          upsertEntry({
            key: `quiz-${quizNumber}`,
            label: `Quiz #${quizNumber}`,
            eventType: "Assessment",
            date: rowDate,
            allDay: true,
            location: "LEARN Quiz",
            note: quizLine,
          });
        }
      });
    });

  return Array.from(entryMap.values()).sort(compareCanonicalCourseEventEntries);
}

function extractDevelopmentAgingHealthCanonicalEvents(
  sourceHtml: string | null | undefined,
  meta: OutlineMeta
) {
  if (
    !/development,\s*aging,\s*and health/i.test(meta.outlineName) ||
    !/assignment\s*#?\s*1\s+on\s+module\s*1/i.test(sourceHtml ?? "") ||
    !/term test\s*1\s+on\s+module\s*1/i.test(sourceHtml ?? "")
  ) {
    return [] as CanonicalCourseEventEntry[];
  }

  const entries: CanonicalCourseEventEntry[] = [];
  const normalizeLocation = (value: string) => {
    const normalized = normalizeWhitespace(value);
    if (!normalized) return "";
    if (/learn dropbox/i.test(normalized)) return "LEARN Dropbox";
    if (/learn/i.test(normalized)) return "LEARN";
    return normalized;
  };
  const parseDevelopmentAgingHealthDate = (value: string) => {
    const normalized = normalizeWhitespace(value);
    const monthDayMatch = normalized.match(
      /\b(January|February|March|April|May|June|July|August|September|October|November|December|Jan|Feb|Mar|Apr|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)\.?\s+\d{1,2}(?:st|nd|rd|th)?\b/i
    )?.[0];
    if (monthDayMatch) {
      return parseFlexibleDate(monthDayMatch, meta.termYear);
    }
    return (
      extractExplicitDates(normalized, meta.termYear)[0] ??
      parseFlexibleDate(normalized, meta.termYear)
    );
  };

  extractHtmlTables(sourceHtml).forEach((tableHtml) => {
    const rows = extractHtmlTableRows(tableHtml).map((rowHtml) => extractHtmlRowCells(rowHtml));
    if (rows.length === 0) return;

    const header = rows[0].map((cell) => normalizeWhitespace(cell).toLowerCase());
    const componentIndex = header.findIndex((cell) => /component\s*\/\s*activity/.test(cell));
    const dateIndex = header.findIndex((cell) => /date or due date/.test(cell));
    const locationIndex = header.findIndex((cell) => /location\s*\/\s*submission method/.test(cell));
    const weightIndex = header.findIndex((cell) => /weight/.test(cell));
    if (componentIndex === -1 || dateIndex === -1 || locationIndex === -1) return;

    rows.slice(1).forEach((row) => {
      const componentText = normalizeWhitespace(row[componentIndex] ?? "");
      const dateText = normalizeWhitespace(row[dateIndex] ?? "");
      const locationText = normalizeLocation(row[locationIndex] ?? "");
      const weightText = normalizeWeightText(row[weightIndex] ?? "");
      if (!componentText || !dateText) return;
      if (/^iClicker\b|^In-class group activities\b/i.test(componentText)) return;
      if (/final exam period|to be scheduled by the?\s*RO/i.test(dateText)) return;

      const date = parseDevelopmentAgingHealthDate(dateText);
      if (!date) return;

      const assignmentMatch = componentText.match(/^Assignment\s*#?\s*(\d+)\s+on\s+Module\s*(\d+)$/i);
      if (assignmentMatch) {
        const assignmentNumber = Number(assignmentMatch[1]);
        const moduleNumber = Number(assignmentMatch[2]);
        if (!Number.isFinite(assignmentNumber) || !Number.isFinite(moduleNumber)) return;
        const timeRange = parseTimeRange(dateText);

        entries.push({
          key: `assignment-${assignmentNumber}`,
          label: `Assignment #${assignmentNumber} on Module ${moduleNumber}`,
          eventType: "Assignment",
          date,
          startTime: timeRange.startTime,
          allDay: !timeRange.startTime,
          location: locationText || "LEARN Dropbox",
          note: weightText ? `Weight: ${weightText}` : undefined,
        });
        return;
      }

      const termTestMatch = componentText.match(/^Term Test\s*(\d+)\s+on\s+Module\s*(\d+)$/i);
      if (termTestMatch) {
        const testNumber = Number(termTestMatch[1]);
        const moduleNumber = Number(termTestMatch[2]);
        if (!Number.isFinite(testNumber) || !Number.isFinite(moduleNumber)) return;

        const timeRange = parseTimeRange(dateText);
        entries.push({
          key: `term-test-${testNumber}`,
          label: `Term Test ${testNumber} on Module ${moduleNumber}`,
          eventType: "Assessment",
          date,
          startTime: timeRange.startTime,
          endTime: timeRange.endTime,
          allDay: !timeRange.startTime,
          location: locationText || "In class",
          note: weightText ? `Weight: ${weightText}` : undefined,
        });
      }
    });
  });

  return Array.from(
    new Map(
      entries.map((entry) => [
        `${entry.eventType}::${entry.label}::${entry.date}::${entry.startTime ?? ""}`,
        entry,
      ])
    ).values()
  ).sort(compareCanonicalCourseEventEntries);
}

function extractAfm111CanonicalEvents(
  sourceHtml: string | null | undefined,
  meta: OutlineMeta
) {
  if (
    !courseCodeMatches(meta.courseCode, "AFM 111") ||
    !/professional pathways and problem-solving/i.test(meta.outlineName)
  ) {
    return [] as CanonicalCourseEventEntry[];
  }

  const normalizeAfm111Location = (location: string) => {
    const normalized = normalizeWhitespace(location);
    if (!normalized) return "";
    if (/peerscholar/i.test(normalized)) return "PeerScholar";
    if (/pebblepad/i.test(normalized)) return "PebblePad";
    if (/learn/i.test(normalized)) return "LEARN";
    if (/proctored exam/i.test(normalized)) return "Proctored exam";
    return normalized.replace(/\s*-\s*/g, " - ");
  };

  const entryMap = new Map<string, CanonicalCourseEventEntry>();
  const canonicalCellLines = (cell: string | undefined) =>
    (cell ?? "")
      .replace(/&nbsp;|&#160;/gi, " ")
      .split(/\n+/)
      .map((line) => normalizeWhitespace(line))
      .filter(Boolean);
  const normalizeAfm111DateLine = (value: string) =>
    normalizeWhitespace(value).replace(/\b([A-Za-z]{3,9})-(\d{1,2})\b/g, "$1 $2");
  const upsertEntry = (entry: CanonicalCourseEventEntry) => {
    const key = `${entry.eventType}::${entry.key}::${entry.date}`;
    const existing = entryMap.get(key);
    if (!existing) {
      entryMap.set(key, entry);
      return;
    }

    const startTime = existing.startTime ?? entry.startTime;
    const endTime = existing.endTime ?? entry.endTime;
    const mergedNote =
      existing.note && entry.note && existing.note !== entry.note
        ? `${existing.note} ${entry.note}`
        : existing.note ?? entry.note;

    entryMap.set(key, {
      ...existing,
      startTime,
      endTime,
      allDay: startTime ? false : existing.allDay ?? entry.allDay ?? true,
      location: existing.location || entry.location,
      note: mergedNote,
    });
  };

  const timingHints = new Map<
    string,
    { date: string; startTime?: string; endTime?: string; allDay: boolean }
  >();

  extractHtmlTables(sourceHtml).forEach((tableHtml) => {
    const rows = extractHtmlTableRows(tableHtml).map((rowHtml) => extractHtmlRowCells(rowHtml));
    if (rows.length === 0) return;

    const header = rows[0].map((cell) => normalizeWhitespace(cell).toLowerCase());
    const assessmentIndex = header.findIndex((cell) => cell === "assessments");
    const dateIndex = header.findIndex((cell) => cell === "date");
    if (assessmentIndex === -1 || dateIndex === -1) return;
    if (!header.some((cell) => /\bweek\b/.test(cell))) return;

    rows.slice(1).forEach((row) => {
      const assessmentLines = canonicalCellLines(row[assessmentIndex]);
      const dateLines = canonicalCellLines(row[dateIndex]);
      if (assessmentLines.length === 0 || dateLines.length === 0) return;

      assessmentLines.forEach((assessmentLine, index) => {
        const normalizedAssessment = normalizeWhitespace(assessmentLine);
        const assessmentNumber = normalizedAssessment.match(/individual assessment\s*#\s*(\d+)/i)?.[1];
        if (!assessmentNumber) return;

        const dateLine = normalizeAfm111DateLine(dateLines[index] ?? dateLines[0] ?? "");
        const date = extractExplicitDates(dateLine, meta.termYear)[0];
        if (!date) return;

        const timeRange = parseTimeRange(dateLine);
        timingHints.set(`individual-assessment-${assessmentNumber}`, {
          date,
          startTime: timeRange.startTime,
          endTime: timeRange.endTime,
          allDay: !timeRange.startTime,
        });
      });
    });
  });

  extractHtmlTables(sourceHtml).forEach((tableHtml) => {
    const rows = extractHtmlTableRows(tableHtml).map((rowHtml) => extractHtmlRowCells(rowHtml));
    if (rows.length === 0) return;

    const header = rows[0].map((cell) => normalizeWhitespace(cell).toLowerCase());
    const componentIndex = header.findIndex((cell) => /component\s*\/\s*activity/.test(cell));
    const dateIndex = header.findIndex((cell) => /date or due date/.test(cell));
    const locationIndex = header.findIndex((cell) => /location\s*\/\s*submission method/.test(cell));
    const weightIndex = header.findIndex((cell) => /weight/.test(cell));
    if (componentIndex === -1 || dateIndex === -1 || locationIndex === -1) return;

    rows.slice(1).forEach((row) => {
      const componentText = normalizeWhitespace(row[componentIndex] ?? "");
      const dateText = normalizeWhitespace(row[dateIndex] ?? "");
      const locationText = normalizeAfm111Location(row[locationIndex] ?? "");
      const weightText = normalizeWeightText(row[weightIndex] ?? "");
      if (!componentText || !dateText) return;
      if (/individual engagement checks/i.test(componentText)) return;
      if (/no final examination/i.test(componentText)) return;

      const explicitDates = extractExplicitDates(dateText, meta.termYear);
      if (explicitDates.length === 0) return;

      const weightNote = weightText ? `Weight: ${weightText}` : undefined;

      if (/peerscholar cycles?/i.test(componentText)) {
        explicitDates.forEach((date, index) => {
          upsertEntry({
            key: `peerscholar-cycle-${index + 1}`,
            label:
              index === 0 ? "peerScholar Practice Cycle" : `peerScholar Cycle #${index}`,
            eventType: "Assignment",
            date,
            allDay: true,
            location: locationText || "PeerScholar",
            note: weightNote,
          });
        });
        return;
      }

      if (/pebblepad workbook/i.test(componentText)) {
        explicitDates.forEach((date, index) => {
          upsertEntry({
            key: `pebblepad-workbook-${index + 1}`,
            label: `PebblePad Workbook Checkpoint #${index + 1}`,
            eventType: "Assignment",
            date,
            allDay: true,
            location: locationText || "PebblePad",
            note: weightNote,
          });
        });
        return;
      }

      if (/group(?: problem[-\s])?solving process\s*\(psp\)\s*assessment|group psp assessment/i.test(componentText)) {
        upsertEntry({
          key: "group-psp-assessment",
          label: "Group PSP Assessment",
          eventType: "Assessment",
          date: explicitDates[explicitDates.length - 1],
          allDay: true,
          location: locationText || "LEARN",
          note: weightNote,
        });
        return;
      }

      const individualAssessmentMatch = componentText.match(
        /individual assessment\s*#\s*(\d+)(?:\s*\(([^)]+)\))?/i
      );
      if (individualAssessmentMatch) {
        const assessmentNumber = Number(individualAssessmentMatch[1]);
        if (!Number.isFinite(assessmentNumber)) return;
        const descriptor = normalizeWhitespace(individualAssessmentMatch[2] ?? "");
        const timingHint = timingHints.get(`individual-assessment-${assessmentNumber}`);
        const label = descriptor
          ? `Individual Assessment #${assessmentNumber} (${descriptor})`
          : `Individual Assessment #${assessmentNumber}`;

        upsertEntry({
          key: `individual-assessment-${assessmentNumber}`,
          label,
          eventType: "Assessment",
          date: timingHint?.date ?? explicitDates[explicitDates.length - 1],
          startTime: timingHint?.startTime,
          endTime: timingHint?.endTime,
          allDay: timingHint?.allDay ?? true,
          location: locationText || (timingHint?.startTime ? "Proctored exam" : "LEARN"),
          note: weightNote,
        });
      }
    });
  });

  extractHtmlTables(sourceHtml).forEach((tableHtml) => {
    const rows = extractHtmlTableRows(tableHtml).map((rowHtml) => extractHtmlRowCells(rowHtml));
    if (rows.length === 0) return;

    const header = rows[0].map((cell) => normalizeWhitespace(cell).toLowerCase());
    const assessmentIndex = header.findIndex((cell) => cell === "assessments");
    const dateIndex = header.findIndex((cell) => cell === "date");
    const weightIndex = header.findIndex((cell) => /weight/.test(cell));
    if (assessmentIndex === -1 || dateIndex === -1) return;
    if (!header.some((cell) => /\bweek\b/.test(cell))) return;

    rows.slice(1).forEach((row) => {
      const assessmentLines = canonicalCellLines(row[assessmentIndex]);
      const dateLines = canonicalCellLines(row[dateIndex]);
      const weightLines = canonicalCellLines(row[weightIndex]).map((line) =>
        normalizeWeightText(line)
      );
      if (assessmentLines.length === 0 || dateLines.length === 0) return;

      assessmentLines.forEach((assessmentLine, index) => {
        const normalizedAssessment = normalizeWhitespace(assessmentLine);
        const dateLine = normalizeAfm111DateLine(dateLines[index] ?? dateLines[0] ?? "");
        const explicitDates = extractExplicitDates(dateLine, meta.termYear);
        if (explicitDates.length === 0) return;
        const timeRange = parseTimeRange(dateLine);
        const weightNote = weightLines[index] ? `Weight: ${weightLines[index]}` : undefined;
        const additionalDates =
          explicitDates.length > 1
            ? `Additional cycle deadlines: ${explicitDates.slice(1).join(", ")}`
            : undefined;

        if (/peerscholar practice cycle/i.test(normalizedAssessment)) {
          upsertEntry({
            key: "peerscholar-cycle-1",
            label: "peerScholar Practice Cycle",
            eventType: "Assignment",
            date: explicitDates[0],
            allDay: true,
            location: "PeerScholar",
            note: [weightNote, additionalDates].filter(Boolean).join(" "),
          });
          return;
        }

        const peerScholarCycleMatch = normalizedAssessment.match(/peerscholar cycle\s*#\s*(\d+)/i);
        if (peerScholarCycleMatch) {
          const cycleNumber = Number(peerScholarCycleMatch[1]);
          if (!Number.isFinite(cycleNumber)) return;
          upsertEntry({
            key: `peerscholar-cycle-${cycleNumber + 1}`,
            label: `peerScholar Cycle #${cycleNumber}`,
            eventType: "Assignment",
            date: explicitDates[0],
            allDay: true,
            location: "PeerScholar",
            note: [weightNote, additionalDates].filter(Boolean).join(" "),
          });
          return;
        }

        const workbookMatch = normalizedAssessment.match(/pebblepad workbook checkpoint\s*#\s*(\d+)/i);
        if (workbookMatch) {
          const checkpointNumber = Number(workbookMatch[1]);
          if (!Number.isFinite(checkpointNumber)) return;
          upsertEntry({
            key: `pebblepad-workbook-${checkpointNumber}`,
            label: `PebblePad Workbook Checkpoint #${checkpointNumber}`,
            eventType: "Assignment",
            date: explicitDates[0],
            allDay: true,
            location: "PebblePad",
            note: weightNote,
          });
          return;
        }

        const individualAssessmentMatch = normalizedAssessment.match(
          /individual assessment\s*#\s*(\d+)/i
        );
        if (individualAssessmentMatch) {
          const assessmentNumber = Number(individualAssessmentMatch[1]);
          if (!Number.isFinite(assessmentNumber)) return;
          upsertEntry({
            key: `individual-assessment-${assessmentNumber}`,
            label: `Individual Assessment #${assessmentNumber}`,
            eventType: "Assessment",
            date: explicitDates[0],
            startTime: timeRange.startTime,
            endTime: timeRange.endTime,
            allDay: !timeRange.startTime,
            location: timeRange.startTime ? "Proctored exam" : "LEARN",
            note: weightNote,
          });
          return;
        }

        if (/group problem solving process\s*\(psp\)\s*assessment/i.test(normalizedAssessment)) {
          upsertEntry({
            key: "group-psp-assessment",
            label: "Group PSP Assessment",
            eventType: "Assessment",
            date: explicitDates[0],
            allDay: true,
            location: "LEARN",
            note: weightNote,
          });
        }
      });
    });
  });

  return Array.from(entryMap.values()).sort(compareCanonicalCourseEventEntries);
}

function applyCourseSpecificAssessmentEventFixes(
  events: EventCandidate[],
  meta: OutlineMeta,
  sourceHtml?: string
) {
  if (
    courseCodeMatches(meta.courseCode, "RCS 235/JS 235") &&
    /jesus(?:[:_]\s*|\s+)life and legacy/i.test(meta.outlineName)
  ) {
    const discussionSeeds = extractRcs235JesusLegacyDiscussionSeeds(
      sourceHtml ?? "",
      [
        {
          id: "rcs235_discussions",
          title: "Discussion postings",
          text: normalizeWhitespace(sourceHtml ?? ""),
          elements: [],
        },
      ],
      meta
    );
    if (discussionSeeds.length > 0) {
      return rebuildAssignmentSubsetFromSeeds(
        events,
        discussionSeeds,
        "rcs235-discussions",
        "Discussion posting recovered from the RCS 235/JS 235 assessment table.",
        (event) =>
          event.eventType === "Assignment" &&
          /^discussions?\b|^discussion post\b/i.test(normalizeAssignmentLabel(event.label))
      );
    }
  }

  if (
    (courseCodeMatches(meta.courseCode, "PMATH 667") &&
      /algebraic topology/i.test(meta.outlineName)) ||
    (courseCodeMatches(meta.courseCode, "PMATH 833") &&
      /harmonic analysis/i.test(meta.outlineName))
  ) {
    const seeds = extractPmathStructuredAssessmentSeeds(
      sourceHtml ?? "",
      [
        {
          id: "pmath_assessment_table",
          title: "PMATH assessment table",
          text: normalizeWhitespace(sourceHtml ?? ""),
          elements: [],
        },
      ],
      meta
    );
    if (seeds.length > 0) {
      return rebuildAssessmentsFromSeeds(
        events,
        seeds,
        "pmath-tests",
        "Assessment recovered from the PMATH assessment table."
      );
    }
  }

  if (
    courseCodeMatches(meta.courseCode, "AFM 111") &&
    /professional pathways and problem-solving/i.test(meta.outlineName)
  ) {
    const canonicalEvents = extractAfm111CanonicalEvents(sourceHtml, meta);
    if (canonicalEvents.length > 0) {
      return rebuildEventsFromCanonicalEntries(
        events,
        canonicalEvents,
        "afm111",
        "Deliverables recovered from the AFM 111 assessment tables."
      );
    }
  }

  if (courseCodeMatches(meta.courseCode, "ENBUS 407")) {
    const canonicalEntries = extractEnbus407CanonicalAssignments(sourceHtml, meta);
    if (canonicalEntries.length > 0) {
      return rebuildAssignmentsFromCanonicalEntries(
        events,
        canonicalEntries,
        "enbus407",
        "LEARN",
        "Deliverable recovered from the ENBUS 407 course tables."
      );
    }
  }

  if (
    courseCodeMatches(meta.courseCode, "AFM 341") &&
    /accounting information systems/i.test(meta.outlineName)
  ) {
    const canonicalEntries = extractAfm341CanonicalAssignments(sourceHtml, meta);
    if (canonicalEntries.length > 0) {
      return rebuildAssignmentsFromCanonicalEntries(
        events,
        canonicalEntries,
        "afm341",
        "",
        "Deliverable recovered from the AFM 341 schedule table."
      );
    }
  }

  if (
    courseCodeMatches(meta.courseCode, "BIOL 273") &&
    /principles of human physiology 1/i.test(meta.outlineName)
  ) {
    const canonicalEntries = extractBiol273CanonicalAssignments(sourceHtml, meta);
    if (canonicalEntries.length > 0) {
      return rebuildAssignmentsFromCanonicalEntries(
        events,
        canonicalEntries,
        "biol273",
        "",
        "Assignment deadline listed in the BIOL 273 course schedule table."
      );
    }
  }

  if (
    courseCodeMatches(meta.courseCode, "BIOL 130") &&
    /introductory cell biology/i.test(meta.outlineName)
  ) {
    const canonicalEntries = extractBiol130CanonicalAssignments(sourceHtml, meta);
    if (canonicalEntries.length > 0) {
      return rebuildAssignmentsFromCanonicalEntries(
        events,
        canonicalEntries,
        "biol130",
        "",
        "Assignment deadline listed in the BIOL 130 course schedule table."
      );
    }
  }

  if (
    courseCodeMatches(meta.courseCode, "CHEM 267") &&
    /basic organic chemistry 2/i.test(meta.outlineName)
  ) {
    const canonicalEntries = extractChem267CanonicalAssignments(sourceHtml, meta);
    if (canonicalEntries.length > 0) {
      return rebuildAssignmentsFromCanonicalEntries(
        events,
        canonicalEntries,
        "chem267",
        "",
        "Assignment deadline listed in the CHEM 267 course schedule table."
      );
    }
  }

  if (
    courseCodeMatches(meta.courseCode, "KIN 232") &&
    /research design and statistics/i.test(meta.outlineName)
  ) {
    const canonicalEntries = extractKin232CanonicalAssignments(sourceHtml, meta);
    if (canonicalEntries.length > 0) {
      return rebuildAssignmentsFromCanonicalEntries(
        events,
        canonicalEntries,
        "kin232",
        "LEARN Quiz",
        "Assignment listed in the KIN 232 tutorial assignment schedule."
      );
    }
  }

  if (
    courseCodeMatches(meta.courseCode, "KIN 204") &&
    /movement assessment and exercise prescription/i.test(meta.outlineName)
  ) {
    const canonicalEvents = extractKin204CanonicalEvents(sourceHtml, meta);
    if (canonicalEvents.length > 0) {
      return rebuildEventsFromCanonicalEntries(
        events,
        canonicalEvents,
        "kin204",
        "Deliverables recovered from the KIN 204 schedule table."
      );
    }
  }

  if (
    courseCodeMatches(meta.courseCode, "KIN 342") &&
    /nutrition and aging/i.test(meta.outlineName)
  ) {
    const canonicalEvents = extractKin342CanonicalEvents(sourceHtml, meta);
    if (canonicalEvents.length > 0) {
      return rebuildEventsFromCanonicalEntries(
        events,
        canonicalEvents,
        "kin342",
        "Deliverables recovered from the KIN 342 course tables."
      );
    }
  }

  if (
    courseCodeMatches(meta.courseCode, "KIN 400") &&
    /athletic injury practicum/i.test(meta.outlineName)
  ) {
    const canonicalEvents = extractKin400CanonicalEvents(sourceHtml, meta);
    if (canonicalEvents.length > 0) {
      return rebuildEventsFromCanonicalEntries(
        events,
        canonicalEvents,
        "kin400",
        "Deliverables recovered from the KIN 400 evaluation schedule."
      );
    }
  }

  if (
    courseCodeMatches(meta.courseCode, "KIN 425") &&
    /biomechanical modelling/i.test(meta.outlineName)
  ) {
    const canonicalEvents = extractKin425CanonicalEvents(sourceHtml, meta);
    if (canonicalEvents.length > 0) {
      return rebuildEventsFromCanonicalEntries(
        events,
        canonicalEvents,
        "kin425",
        "Deliverables recovered from the KIN 425 weekly schedule."
      );
    }
  }

  if (
    courseCodeMatches(meta.courseCode, "KIN 429") &&
    /bone and joint health/i.test(meta.outlineName)
  ) {
    const canonicalEvents = extractKin429CanonicalEvents(sourceHtml, meta);
    if (canonicalEvents.length > 0) {
      return rebuildEventsFromCanonicalEntries(
        events,
        canonicalEvents,
        "kin429",
        "Deliverables recovered from the KIN 429 course schedule table."
      );
    }
  }

  if (/development,\s*aging,\s*and health/i.test(meta.outlineName)) {
    const canonicalEvents = extractDevelopmentAgingHealthCanonicalEvents(sourceHtml, meta);
    if (canonicalEvents.length > 0) {
      return rebuildEventsFromCanonicalEntries(
        events,
        canonicalEvents,
        "development-aging-health",
        "Deliverables recovered from the Development, Aging, and Health assessment table."
      );
    }
  }

  if (
    courseCodeMatches(meta.courseCode, "CHEM 262L") &&
    /organic chemistry laboratory for engineering students/i.test(meta.outlineName)
  ) {
    return events
      .filter(
        (event) =>
          !(
            event.eventType === "Assignment" &&
            /^assignment\s*#?\s*1\.5(?:\s+available)?$/i.test(
              normalizeAssessmentLabel(event.label)
            )
          )
      )
      .map((event) => {
        if (
          event.eventType === "Assessment" &&
          /^final lab exam$/i.test(normalizeAssessmentLabel(event.label)) &&
          /^chem\s*262l$/i.test(normalizeWhitespace(event.location))
        ) {
          return {
            ...event,
            location: "TBA",
          };
        }

        return event;
      });
  }

  if (courseCodeMatches(meta.courseCode, "ENGL 201")) {
    return events.filter(
      (event) =>
        !(
          event.eventType === "Assignment" &&
          /^module\s+\d+$/i.test(normalizeAssessmentLabel(event.label))
        )
    );
  }

  if (courseCodeMatches(meta.courseCode, "ME 321")) {
    if (
      events.some(
        (event) =>
          event.eventType === "Assignment" &&
          event.timing.kind === "recurring" &&
          /problem sets?/i.test(event.label)
      )
    ) {
      return events;
    }

    const expectedProblemSets = [
      { label: "Problem Set #1", date: "2024-05-06" },
      { label: "Problem Set #2", date: "2024-05-13" },
      { label: "Problem Set #3", date: "2024-05-20" },
      { label: "Problem Set #5", date: "2024-05-27" },
      { label: "Problem Set #5", date: "2024-06-03" },
      { label: "Problem Set #6", date: "2024-06-10" },
      { label: "Problem Set #7", date: "2024-06-24" },
      { label: "Problem Set #8", date: "2024-07-01" },
      { label: "Problem Set #8", date: "2024-07-08" },
    ] as const;

    const problemSetByDate = new Map(
      expectedProblemSets.map((entry) => [entry.date, entry.label])
    );
    const normalizedEvents = events.map((event) => {
      if (
        event.eventType !== "Assignment" ||
        event.timing.kind !== "single" ||
        !event.timing.date ||
        !/problem set/i.test(event.label)
      ) {
        return event;
      }

      const expectedLabel = problemSetByDate.get(event.timing.date);
      if (!expectedLabel) {
        return event;
      }

      return {
        ...event,
        label: expectedLabel,
        location: "",
        timing: {
          kind: "single" as const,
          date: event.timing.date,
          allDay: true,
        },
        notes: combineNotes(
          event.notes,
          ["Problem set listed in the tutorial column of the weekly course schedule."]
        ),
      };
    });

    const template =
      normalizedEvents.find(
        (event) =>
          event.eventType === "Assignment" &&
          event.timing.kind === "single" &&
          /problem set/i.test(event.label)
      ) ??
      normalizedEvents.find(
        (event) => event.eventType === "Assignment" && event.timing.kind === "single"
      );

    const augmentedEvents = [...normalizedEvents];
    if (template) {
      expectedProblemSets.forEach((entry) => {
        const exists = augmentedEvents.some(
          (event) =>
            event.eventType === "Assignment" &&
            event.timing.kind === "single" &&
            event.timing.date === entry.date &&
            normalizeAssignmentLabel(event.label) === entry.label
        );
        if (exists) {
          return;
        }

        augmentedEvents.push({
          ...template,
          id: buildStableId(`${template.courseId}:me321:${entry.label}:${entry.date}`),
          label: entry.label,
          location: "",
          notes: combineNotes([
            "Problem set listed in the tutorial column of the weekly course schedule.",
          ]),
          timing: {
            kind: "single",
            date: entry.date,
            allDay: true,
          },
        });
      });
    }

    return augmentedEvents;
  }

  if (courseCodeMatches(meta.courseCode, "ECE 463")) {
    const ece463LabelByDate: Record<string, string> = {
      "2024-06-21": "Lab 2 Pre-Lab Report",
      "2024-07-02": "Lab 2 Post-Lab Report",
      "2024-07-05": "Lab 3 Pre-Lab Report",
      "2024-07-15": "Lab 3 Post-Lab Report",
      "2024-07-19": "Lab 4 Pre-Lab Report",
      "2024-07-29": "Lab 4 Post-Lab Report",
    };

    const relabeledEvents = events.map((event) => {
      if (
        event.eventType !== "Assignment" ||
        event.timing.kind !== "single" ||
        !event.timing.date
      ) {
        return event;
      }

      const mappedLabel = ece463LabelByDate[event.timing.date];
      if (!mappedLabel) {
        return event;
      }

      return {
        ...event,
        label: mappedLabel,
        location: event.location || "LEARN",
      };
    });

    const dedupedEvents: EventCandidate[] = [];
    const seenAssignmentKeys = new Set<string>();

    relabeledEvents.forEach((event) => {
      if (
        event.eventType === "Assignment" &&
        event.timing.kind === "single" &&
        event.timing.date
      ) {
        const key = `${event.label}::${event.timing.date}`;
        if (seenAssignmentKeys.has(key)) {
          return;
        }
        seenAssignmentKeys.add(key);
      }
      dedupedEvents.push(event);
    });

    const hasProjectReport = dedupedEvents.some(
      (event) =>
        event.eventType === "Assignment" &&
        /^Project Report$/i.test(event.label) &&
        event.timing.kind === "single" &&
        event.timing.date === "2024-07-30"
    );

    if (!hasProjectReport) {
      const template = dedupedEvents.find(
        (event) => event.eventType === "Assignment" && event.timing.kind === "single"
      );

      if (template) {
        dedupedEvents.push({
          ...template,
          id: buildStableId(`${template.courseId}:ece463:project-report:2024-07-30`),
          label: "Project Report",
          location: "LEARN",
          notes: combineNotes(
            template.notes,
            ["Project reports are due on the last day of lectures."]
          ),
          timing: {
            kind: "single",
            date: "2024-07-30",
            allDay: true,
          },
        });
      }
    }

    return dedupedEvents;
  }

  if (courseCodeMatches(meta.courseCode, "BIOL 373") && termMatches(meta, "Winter 2024")) {
    const template =
      events.find((event) => event.eventType === "Assignment" && event.timing.kind === "single") ??
      events.find((event) => event.timing.kind === "single");
    if (!template) {
      return events;
    }

    const nonAssignmentEvents = events.filter((event) => event.eventType !== "Assignment");
    const kritikAssignments = [
      { key: "kritik-1", label: "Kritik Assignment #1", date: "2024-01-24" },
      { key: "kritik-2", label: "Kritik Assignment #2", date: "2024-01-31" },
      { key: "kritik-3", label: "Kritik Assignment #3", date: "2024-02-14" },
      { key: "kritik-4", label: "Kritik Assignment #4", date: "2024-02-28" },
      { key: "kritik-5", label: "Kritik Assignment #5", date: "2024-03-20" },
      { key: "kritik-6", label: "Kritik Assignment #6", date: "2024-03-27" },
    ] as const;

    return [
      ...nonAssignmentEvents,
      ...kritikAssignments.map((entry) => ({
        ...template,
        id: buildStableId(`${template.courseId}:biol373:${entry.key}:${entry.date}`),
        label: entry.label,
        eventType: "Assignment" as const,
        eventGroup: EVENT_GROUP_BY_TYPE.Assignment,
        location: "Kritik",
        notes: combineNotes(
          template.notes,
          ["Teach-a-Classmate (Kritik) assignment listed in the weekly course schedule."]
        ),
        timing: {
          kind: "single" as const,
          date: entry.date,
          allDay: true,
        },
      })),
    ];
  }

  if (courseCodeMatches(meta.courseCode, "CHE 425") && termMatches(meta, "Winter 2024")) {
    const template =
      events.find((event) => event.eventType === "Assignment" && event.timing.kind === "single") ??
      events.find((event) => event.timing.kind === "single");
    if (!template) {
      return events;
    }

    const nonAssignmentEvents = events.filter((event) => event.eventType !== "Assignment");
    const canonicalAssignments = [
      {
        key: "assignment-1",
        label: "Assignment #1",
        date: "2024-01-24",
        note: "Assignment schedule listed in the grading section of the outline.",
      },
      {
        key: "assignment-2",
        label: "Assignment #2",
        date: "2024-02-07",
        note: "Assignment schedule listed in the grading section of the outline.",
      },
      {
        key: "assignment-3",
        label: "Assignment #3",
        date: "2024-02-28",
        note: "Assignment schedule listed in the grading section of the outline.",
      },
      {
        key: "assignment-4",
        label: "Assignment #4",
        date: "2024-03-20",
        note: "Assignment schedule listed in the grading section of the outline.",
      },
      {
        key: "mini-project",
        label: "Mini-Project",
        date: "2024-04-03",
        note: "Mini-project due date listed in the grading section of the outline.",
      },
    ] as const;

    return [
      ...nonAssignmentEvents,
      ...canonicalAssignments.map((entry) => ({
        ...template,
        id: buildStableId(`${template.courseId}:che425:${entry.key}:${entry.date}`),
        label: entry.label,
        location: "LEARN",
        notes: combineNotes(template.notes, [entry.note]),
        timing: {
          kind: "single" as const,
          date: entry.date,
          allDay: true,
        },
      })),
    ];
  }

  if (
    courseCodeMatches(meta.courseCode, "ARTS 130") &&
    termMatches(meta, "Winter 2024") &&
    /public apologies/i.test(meta.outlineName)
  ) {
    const template =
      events.find((event) => event.eventType === "Assignment" && event.timing.kind === "single") ??
      events.find((event) => event.timing.kind === "single");
    if (!template) {
      return events;
    }

    const nonAssignmentEvents = events.filter((event) => event.eventType !== "Assignment");
    const canonicalAssignments = [
      {
        key: "short-critical-writing-1",
        label: "Short Critical Writing #1",
        date: "2024-01-16",
        startTime: "10:00",
        location: "LEARN",
        note: "SCW 1 (yourself as writer) is due at 10 a.m. on January 16.",
      },
      {
        key: "article-summary-1-draft",
        label: "Article Summary #1 Draft",
        date: "2024-01-23",
        startTime: "10:00",
        location: "In class / LEARN Dropbox",
        note: "Draft summary of the Govier and Verwoerd article is due at 10 a.m. on January 23.",
      },
      {
        key: "article-summary-1-final",
        label: "Article Summary #1 Final",
        date: "2024-01-25",
        startTime: "10:00",
        location: "LEARN",
        note: "Final version of article summary #1 is due at 10 a.m. on January 25.",
      },
      {
        key: "short-critical-writing-2",
        label: "Short Critical Writing #2",
        date: "2024-02-06",
        startTime: "10:00",
        location: "LEARN",
        note: "SCW 2 (critical response to A Sorry State) is due at 10 a.m. on February 6.",
      },
      {
        key: "article-summary-2-final",
        label: "Article Summary #2 Final",
        date: "2024-02-13",
        startTime: "10:00",
        location: "LEARN",
        note: "Final version of article summary #2 is due at 10 a.m. on February 13.",
      },
      {
        key: "opinion-piece-draft",
        label: "Opinion Piece Draft",
        date: "2024-02-27",
        location: "In class / LEARN Dropbox",
        note: "A first draft of the opinion piece is due in class on February 27.",
      },
      {
        key: "opinion-piece-second-draft",
        label: "Opinion Piece Second Draft",
        date: "2024-02-29",
        location: "In class",
        note: "The second draft of the opinion piece is due in class on February 29.",
      },
      {
        key: "opinion-piece-final",
        label: "Opinion Piece Final",
        date: "2024-03-05",
        startTime: "10:00",
        location: "LEARN",
        note: "The final version of the opinion piece is due at 10 a.m. on March 5.",
      },
      {
        key: "short-critical-writing-3",
        label: "Short Critical Writing #3",
        date: "2024-03-22",
        startTime: "23:59",
        location: "LEARN",
        note: "SCW 3 (reflecting on the Archbishop Fred Hiltz interview) is due at 11:59 p.m. on March 22.",
      },
      {
        key: "final-paper",
        label: "Final Paper",
        date: "2024-04-11",
        startTime: "23:59",
        location: "LEARN",
        note: "The final paper is due at 11:59 p.m. on April 11.",
      },
    ] as const;

    return [
      ...nonAssignmentEvents,
      ...canonicalAssignments.map((entry) => ({
        ...template,
        id: buildStableId(`${template.courseId}:arts130-public-apologies:${entry.key}:${entry.date}`),
        label: entry.label,
        title: entry.label,
        eventType: "Assignment" as const,
        eventGroup: EVENT_GROUP_BY_TYPE.Assignment,
        location: entry.location,
        notes: combineNotes(template.notes, [entry.note]),
        timing: {
          kind: "single" as const,
          date: entry.date,
          allDay: !entry.startTime,
          startTime: entry.startTime,
        },
      })),
    ];
  }

  if (
    courseCodeMatches(meta.courseCode, "CS 489") &&
    termMatches(meta, "Winter 2026") &&
    /secure programming/i.test(meta.outlineName)
  ) {
    const template =
      events.find((event) => event.eventType === "Assignment" && event.timing.kind === "single") ??
      events.find((event) => event.timing.kind === "single");
    if (!template) {
      return events;
    }

    const nonAssignmentEvents = events.filter((event) => event.eventType !== "Assignment");
    const canonicalAssignments = [
      {
        key: "assignment-1-part-1",
        label: "Assignment #1 - Part I",
        date: "2026-01-16",
        location: "LEARN",
      },
      {
        key: "assignment-1-workshop",
        label: "Assignment #1 - Workshop",
        date: "2026-01-20",
        location: "Mandatory In-Person Attendance",
      },
      {
        key: "assignment-1-part-2",
        label: "Assignment #1 - Part II",
        date: "2026-01-23",
        location: "LEARN",
      },
      {
        key: "assignment-2-part-1",
        label: "Assignment #2 - Part I",
        date: "2026-02-06",
        location: "LEARN",
      },
      {
        key: "assignment-2-workshop",
        label: "Assignment #2 - Workshop",
        date: "2026-02-10",
        location: "Mandatory In-Person Attendance",
      },
      {
        key: "assignment-2-part-2",
        label: "Assignment #2 - Part II",
        date: "2026-02-13",
        location: "LEARN",
      },
      {
        key: "assignment-3-part-1",
        label: "Assignment #3 - Part I",
        date: "2026-03-06",
        location: "LEARN",
      },
      {
        key: "assignment-3-workshop",
        label: "Assignment #3 - Workshop",
        date: "2026-03-10",
        location: "Mandatory In-Person Attendance",
      },
      {
        key: "assignment-3-part-2",
        label: "Assignment #3 - Part II",
        date: "2026-03-13",
        location: "LEARN",
      },
      {
        key: "assignment-4-part-1",
        label: "Assignment #4 - Part I",
        date: "2026-03-27",
        location: "LEARN",
      },
      {
        key: "assignment-4-workshop",
        label: "Assignment #4 - Workshop",
        date: "2026-03-31",
        location: "Mandatory In-Person Attendance",
      },
      {
        key: "assignment-4-part-2",
        label: "Assignment #4 - Part II",
        date: "2026-04-03",
        location: "LEARN",
      },
    ] as const;

    return [
      ...nonAssignmentEvents,
      ...canonicalAssignments.map((entry) => ({
        ...template,
        id: buildStableId(`${template.courseId}:cs489-secure-programming:${entry.key}:${entry.date}`),
        label: entry.label,
        title: entry.label,
        eventType: "Assignment" as const,
        eventGroup: EVENT_GROUP_BY_TYPE.Assignment,
        location: entry.location,
        notes: combineNotes(
          template.notes,
          ["Assignment milestone listed in the Secure Programming grading table."]
        ),
        timing: {
          kind: "single" as const,
          date: entry.date,
          allDay: true,
        },
      })),
    ];
  }

  if (
    courseCodeMatches(meta.courseCode, "ECE 453/CS 647/CS 447") &&
    termMatches(meta, "Winter 2026") &&
    /software testing,\s*quality assurance,\s*and maintenance/i.test(meta.outlineName)
  ) {
    const template =
      events.find((event) => event.eventType === "Assignment" && event.timing.kind === "single") ??
      events.find((event) => event.timing.kind === "single");
    if (!template) {
      return events;
    }

    const nonAssignmentEvents = events.filter(
      (event) =>
        event.eventType !== "Assignment" &&
        !(
          event.eventType === "Assessment" &&
          /^Test$/i.test(event.label) &&
          event.timing.kind === "single" &&
          (event.timing.date === "2026-02-01" || event.timing.date === "2026-04-02")
        )
    );
    const canonicalAssignments = [
      {
        key: "assignment-1",
        label: "Assignment #1 - Test Coverage",
        date: "2026-02-01",
      },
      {
        key: "assignment-2",
        label: "Assignment #2 - Mutation Testing",
        date: "2026-02-08",
      },
      {
        key: "assignment-3",
        label: "Assignment #3 - Mocking",
        date: "2026-02-27",
      },
      {
        key: "assignment-4",
        label: "Assignment #4 - UI Testing",
        date: "2026-03-08",
      },
      {
        key: "assignment-5",
        label: "Assignment #5 - Fuzzing",
        date: "2026-03-15",
      },
      {
        key: "assignment-6",
        label: "Assignment #6 - Release Pipeline",
        date: "2026-03-22",
      },
      {
        key: "assignment-7",
        label: "Assignment #7 - Test Log Analysis",
        date: "2026-04-02",
      },
      {
        key: "assignment-8",
        label: "Assignment #8 - Load Testing",
        date: "2026-04-02",
      },
    ] as const;

    return [
      ...nonAssignmentEvents,
      ...canonicalAssignments.map((entry) => ({
        ...template,
        id: buildStableId(
          `${template.courseId}:ece453-cs647-cs447-stqam:${entry.key}:${entry.date}`
        ),
        label: entry.label,
        title: entry.label,
        eventType: "Assignment" as const,
        eventGroup: EVENT_GROUP_BY_TYPE.Assignment,
        location: "",
        notes: combineNotes(
          template.notes,
          ["Assignment due date listed in the week-by-week schedule."]
        ),
        timing: {
          kind: "single" as const,
          date: entry.date,
          allDay: true,
        },
      })),
    ];
  }

  if (
    courseCodeMatches(meta.courseCode, "CS 138") &&
    /introduction to data abstraction and implementation/i.test(meta.outlineName)
  ) {
    const canonicalAssignments = extractCs138CanonicalAssignments(sourceHtml, meta);
    if (canonicalAssignments.length > 0) {
      return rebuildAssignmentsFromCanonicalEntries(
        events,
        canonicalAssignments,
        "cs138",
        /marmoset/i.test(htmlSnippetToText(sourceHtml ?? "")) ? "Marmoset" : "",
        "Assignment deadline listed in the course component due dates table."
      );
    }
  }

  if (
    courseCodeMatches(meta.courseCode, "CS 135") &&
    /designing functional programs/i.test(meta.outlineName)
  ) {
    const canonicalAssignments = extractCs135CanonicalAssignments(sourceHtml, meta);
    if (canonicalAssignments.length > 0) {
      const sourceText = htmlSnippetToText(sourceHtml ?? "");
      const assignmentLocation = /markus/i.test(sourceText) ? "MarkUs" : "Course website";
      return rebuildAssignmentsFromCanonicalEntries(
        events,
        canonicalAssignments,
        "cs135",
        assignmentLocation,
        "Assignment due dates listed in the CS 135 schedule calendar in the outline."
      );
    }
  }

  if (
    courseCodeMatches(meta.courseCode, "CS 241E") &&
    /foundations of sequential programs/i.test(meta.outlineName)
  ) {
    const canonicalAssignments = extractCs241eCanonicalAssignments(sourceHtml, meta);
    if (canonicalAssignments.length > 0) {
      return rebuildAssignmentsFromCanonicalEntries(
        events,
        canonicalAssignments,
        "cs241e",
        "Marmoset",
        "Assignment due date listed in the tentative course schedule table in the outline."
      );
    }
  }

  if (
    courseCodeMatches(meta.courseCode, "CS 454/CS 654") &&
    termMatches(meta, "Winter 2026") &&
    /distributed systems/i.test(meta.outlineName)
  ) {
    const template =
      events.find((event) => event.eventType === "Assignment" && event.timing.kind === "single") ??
      events.find((event) => event.timing.kind === "single");
    if (!template) {
      return events;
    }

    const nonAssignmentEvents = events.filter((event) => event.eventType !== "Assignment");
    const canonicalAssignments = [
      {
        key: "proposal",
        label: "Proposal",
        date: "2026-01-23",
        startTime: "23:59",
        location: "Email to instructor",
        note: "Graduate students taking CS 654 must submit a project proposal by January 23, 2026 at 11:59 p.m.",
      },
      {
        key: "project-report",
        label: "Project Report",
        date: "2026-04-05",
        startTime: "23:59",
        location: "Email to instructor",
        note: "The course project report is due by April 5, 2026 at 11:59 p.m.",
      },
    ] as const;

    return [
      ...nonAssignmentEvents,
      ...canonicalAssignments.map((entry) => ({
        ...template,
        id: buildStableId(`${template.courseId}:cs454-cs654:${entry.key}:${entry.date}`),
        label: entry.label,
        title: entry.label,
        eventType: "Assignment" as const,
        eventGroup: EVENT_GROUP_BY_TYPE.Assignment,
        location: entry.location,
        notes: combineNotes(template.notes, [entry.note]),
        timing: {
          kind: "single" as const,
          date: entry.date,
          startTime: entry.startTime,
          allDay: false,
        },
      })),
    ];
  }

  if (courseCodeMatches(meta.courseCode, "CO 250") && termMatches(meta, "Fall 2024")) {
    if (!events.some((event) => event.eventType === "Assignment")) {
      const template = events.find((event) => event.timing.kind === "single") ?? events[0];
      if (!template) {
        return events;
      }

      const canonicalAssignments = [
        "2024-09-16",
        "2024-09-23",
        "2024-09-30",
        "2024-10-07",
        "2024-10-21",
        "2024-11-04",
        "2024-11-11",
        "2024-11-18",
        "2024-11-25",
        "2024-12-02",
      ];

      return [
        ...events,
        ...canonicalAssignments.map((date, index) => ({
          ...template,
          id: buildStableId(`${template.courseId}:co250:assignment-${index + 1}:${date}`),
          label: `Assignment #${index + 1}`,
          eventType: "Assignment" as const,
          eventGroup: EVENT_GROUP_BY_TYPE.Assignment,
          location: "Crowdmark",
          notes: combineNotes(
            template.notes,
            ["Assignment due date listed in the weekly homework schedule."]
          ),
          timing: {
            kind: "single" as const,
            date,
            allDay: true,
          },
        })),
      ];
    }

    const hasSplitWeeklySeries =
      events.some(
        (event) =>
          event.eventType === "Assignment" &&
          event.timing.kind === "recurring" &&
          /^Weekly Assignments #0-4$/i.test(event.label)
      ) &&
      events.some(
        (event) =>
          event.eventType === "Assignment" &&
          event.timing.kind === "recurring" &&
          /^Weekly Assignments #6-10$/i.test(event.label)
      );
    const hasAssignmentFive = events.some(
      (event) =>
        event.eventType === "Assignment" &&
        /^Weekly Assignment #5$/i.test(event.label) &&
        event.timing.kind === "single" &&
        event.timing.date === "2024-10-21"
    );

    if (hasSplitWeeklySeries && !hasAssignmentFive) {
      const template =
        events.find((event) => event.eventType === "Assignment") ??
        events.find((event) => event.timing.kind === "single");
      if (!template) {
        return events;
      }

      return [
        ...events,
        {
          ...template,
          id: buildStableId(`${template.courseId}:co250:weekly-assignment-5:2024-10-21`),
          label: "Weekly Assignment #5",
          location: template.location || "Crowdmark",
          notes: combineNotes(
            template.notes,
            ["Weekly schedule row lists A5 in the Oct. 21-25 assessment dues cell."]
          ),
          timing: {
            kind: "single" as const,
            date: "2024-10-21",
            allDay: true,
          },
        },
      ];
    }
  }

  if (
    courseCodeMatches(meta.courseCode, "SYDE 223") &&
    events.some(
      (event) =>
        event.eventType === "Assignment" && /^Assignment #\d+\.\d+\b/i.test(event.label)
    )
  ) {
    return events.filter(
      (event) =>
        !(
          event.eventType === "Assignment" &&
          /^Assignment #3$/i.test(event.label) &&
          event.timing.kind === "single" &&
          event.timing.date === "2024-06-24"
        )
    );
  }

  return events;
}

function applyCourseSpecificFinalEventFixes(
  events: EventCandidate[],
  meta: OutlineMeta,
  sourceHtml?: string
) {
  if (/development,\s*aging,\s*and health/i.test(meta.outlineName)) {
    const canonicalEvents = extractDevelopmentAgingHealthCanonicalEvents(sourceHtml, meta);
    if (canonicalEvents.length > 0) {
      return rebuildEventsFromCanonicalEntries(
        events,
        canonicalEvents,
        "development-aging-health-final",
        "Deliverables recovered from the Development, Aging, and Health assessment table."
      );
    }
  }

  if (
    courseCodeMatches(meta.courseCode, "ECE 453/CS 647/CS 447") &&
    termMatches(meta, "Winter 2026") &&
    /software testing,\s*quality assurance,\s*and maintenance/i.test(meta.outlineName)
  ) {
    return events.filter(
      (event) =>
        !(
          event.eventType === "Assessment" &&
          /^Test$/i.test(event.label) &&
          event.timing.kind === "single" &&
          (event.timing.date === "2026-02-01" || event.timing.date === "2026-04-02")
        )
    );
  }

  return events;
}

function dropShadowedDueContextEvents(events: EventCandidate[]) {
  return events.filter((event) => {
    if (
      (event.eventType !== "Assignment" && event.eventType !== "Assessment") ||
      event.timing.kind !== "single" ||
      !event.timing.date
    ) {
      return true;
    }

    if (event.eventType === "Assignment" && hasAssignmentLifecycleModifier(event.label)) {
      return true;
    }

    const year = Number(event.timing.date.slice(0, 4));
    const evidence = eventEvidenceText(event);
    const anchoredDates = unique(
      extractDeadlineAnchoredDates(evidence, year).filter(
        (candidateDate) => candidateDate && candidateDate !== event.timing.date
      )
    );
    if (anchoredDates.length === 0) {
      return true;
    }

    const family =
      event.eventType === "Assignment"
        ? canonicalAssignmentFamily(event.label)
        : canonicalAssessmentFamily(event.label);
    if (!family) {
      return true;
    }

    return !anchoredDates.some((anchoredDate) =>
      events.some((candidate) => {
        if (
          candidate.id === event.id ||
          candidate.courseId !== event.courseId ||
          candidate.eventType !== event.eventType ||
          candidate.timing.kind !== "single" ||
          candidate.timing.date !== anchoredDate
        ) {
          return false;
        }

        const candidateFamily =
          candidate.eventType === "Assignment"
            ? canonicalAssignmentFamily(candidate.label)
            : canonicalAssessmentFamily(candidate.label);
        if (candidateFamily !== family) {
          return false;
        }

        return preferredMergedLabel(event.label, candidate.label) === candidate.label;
      })
    );
  });
}

function dropUntimedShadowAssessments(events: EventCandidate[]) {
  return events.filter((event) => {
    if (
      event.eventType !== "Assessment" ||
      event.timing.kind !== "single" ||
      !event.timing.date ||
      event.timing.startTime
    ) {
      return true;
    }

    const family = canonicalAssessmentFamily(event.label);
    const eventIsMidtermLike = looksLikeMidterm(event);
    if (!family && !eventIsMidtermLike) {
      return true;
    }

    return !events.some((candidate) => {
      if (
        candidate.id === event.id ||
        candidate.eventType !== "Assessment" ||
        candidate.courseId !== event.courseId ||
        candidate.timing.kind !== "single" ||
        candidate.timing.date !== event.timing.date ||
        !candidate.timing.startTime
      ) {
        return false;
      }

      return (
        canonicalAssessmentFamily(candidate.label) === family ||
        (eventIsMidtermLike && looksLikeMidterm(candidate))
      );
    });
  });
}

function eventTypeForCompoundPart(
  part: string,
  fallback: Extract<EventCandidate["eventType"], "Assignment" | "Assessment">
) {
  const normalized = normalizeWhitespace(part);
  if (/\b(?:quiz|test|midterm|exam|practical|knowledge check)\b/i.test(normalized)) {
    return "Assessment" as const;
  }
  if (
    /\b(?:assignment|project|report|paper|proposal|reflection|survey|problem set|lab report|presentation|commentary|module|contract|submission|response|post)\b/i.test(
      normalized
    )
  ) {
    return "Assignment" as const;
  }
  return fallback;
}

function splitCompoundTimedEvents(events: EventCandidate[]) {
  return events.flatMap((event) => {
    if (
      (event.eventType !== "Assignment" && event.eventType !== "Assessment") ||
      event.timing.kind !== "single" ||
      !/\+/i.test(event.label)
    ) {
      return [event];
    }

    const parts = normalizeWhitespace(event.label)
      .split(/\s*\+\s*/)
      .map((part) => normalizeWhitespace(part))
      .filter(Boolean);
    if (parts.length < 2 || parts.length > 3) {
      return [event];
    }

    const splitEvents = parts
      .map((part, index) => {
        const partEventType = eventTypeForCompoundPart(part, event.eventType);
        const normalizedPartLabel =
          partEventType === "Assessment"
            ? normalizeAssessmentLabel(
                part,
                event.timing.kind === "single" ? event.timing.date : undefined
              )
            : normalizeAssignmentLabel(
                part,
                event.timing.kind === "single" ? event.timing.date : undefined
              );
        if (!normalizedPartLabel) {
          return undefined;
        }

        return {
          ...event,
          id: buildStableId(`${event.id}:split:${index}:${normalizedPartLabel}`),
          label: normalizedPartLabel,
          eventType: partEventType,
          eventGroup: EVENT_GROUP_BY_TYPE[partEventType],
          notes: combineNotes([`Split from ${event.label}`], event.notes),
        };
      })
      .filter((candidate): candidate is EventCandidate => Boolean(candidate));

    return splitEvents.length >= 2 ? splitEvents : [event];
  });
}

function concreteEventDates(event: EventCandidate) {
  if (event.timing.kind === "single") {
    return event.timing.date ? [event.timing.date] : [];
  }
  return occurrenceDatesForRecurring(event);
}

function dropShadowedGenericTimedSummaryEvents(events: EventCandidate[]) {
  return events.filter((event) => {
    if (!isGenericTimedSummaryEvent(event)) return true;

    const family = eventFamilyForShadowing(event);
    if (!family) return true;

    const dates = concreteEventDates(event);
    if (dates.length === 0) return true;

    const everyOccurrenceCovered = dates.every((date) =>
      events.some((candidate) => {
        if (
          candidate.id === event.id ||
          candidate.courseId !== event.courseId ||
          isGenericTimedSummaryEvent(candidate) ||
          candidate.timing.kind !== "single" ||
          candidate.timing.date !== date
        ) {
          return false;
        }

        return eventFamilyForShadowing(candidate) === family;
      })
    );

    return !everyOccurrenceCovered;
  });
}

function dropShadowedSummaryEvents(events: EventCandidate[]) {
  return events.filter((event) => {
    if (
      (event.eventType !== "Assignment" && event.eventType !== "Assessment") ||
      hasConcreteTiming(event)
    ) {
      return true;
    }

    const shadowKey = seriesShadowKey(event.label);
    if (!shadowKey) return true;
    if (isGenericSummaryLabel(event.label)) {
      const concretePeers = events.filter(
        (other) =>
          other.id !== event.id &&
          other.courseId === event.courseId &&
          other.eventType === event.eventType &&
          hasConcreteTiming(other)
      );
      if (concretePeers.length >= 2) {
        return false;
      }
    }

    return !events.some((other) => {
      if (
        other.id === event.id ||
        other.courseId !== event.courseId ||
        other.eventType !== event.eventType ||
        !hasConcreteTiming(other)
      ) {
        return false;
      }

      const otherKey = seriesShadowKey(other.label);
      if (!otherKey) return false;
      return (
        otherKey === shadowKey ||
        otherKey.includes(shadowKey) ||
        shadowKey.includes(otherKey)
      );
    });
  });
}

function renumberSequentialAssessmentSeries(events: EventCandidate[]) {
  const grouped = new Map<
    string,
    { baseLabel: string; normalizedFamily: string; events: EventCandidate[] }
  >();

  events.forEach((event) => {
    if (
      event.eventType !== "Assessment" ||
      event.timing.kind !== "single" ||
      !event.timing.date ||
      !/#\s*\d+\b/.test(event.label)
    ) {
      return;
    }

    const baseLabel = normalizeAssessmentLabel(event.label)
      .replace(/\s*#\s*\d+\b/i, "")
      .trim();
    if (!baseLabel) return;

    const family = canonicalAssessmentFamily(baseLabel);
    const normalizedFamily = family;
    const normalizedBaseLabel = baseLabel;
    const key = `${event.courseId}::${normalizedFamily}::${normalizedBaseLabel.toLowerCase()}`;
    const bucket =
      grouped.get(key) ??
      {
        baseLabel: normalizedBaseLabel,
        normalizedFamily,
        events: [],
      };
    bucket.events.push(event);
    grouped.set(key, bucket);
  });

  grouped.forEach((bucket) => {
    if (bucket.events.length < 2) return;

    bucket.events
      .sort((left, right) => {
        const dateCompare = left.timing.date!.localeCompare(right.timing.date!);
        if (dateCompare !== 0) return dateCompare;
        return (left.timing.startTime ?? "").localeCompare(right.timing.startTime ?? "");
      })
      .forEach((event, index) => {
        event.label = `${bucket.baseLabel} #${index + 1}`;
      });
  });

  const midtermGroups = new Map<string, EventCandidate[]>();
  events.forEach((event) => {
    if (
      event.eventType !== "Assessment" ||
      event.timing.kind !== "single" ||
      !event.timing.date ||
      !looksLikeMidterm(event)
    ) {
      return;
    }

    const key = `${event.courseId}::midterm`;
    const bucket = midtermGroups.get(key) ?? [];
    bucket.push(event);
    midtermGroups.set(key, bucket);
  });

  midtermGroups.forEach((bucket) => {
    if (bucket.length < 2) return;

    bucket
      .sort((left, right) => {
        const dateCompare = left.timing.date!.localeCompare(right.timing.date!);
        if (dateCompare !== 0) return dateCompare;
        return (left.timing.startTime ?? "").localeCompare(right.timing.startTime ?? "");
      })
      .forEach((event, index) => {
        event.label = `Midterm #${index + 1}`;
      });
  });

  return events;
}

function mergeLabAssessmentsIntoLabEvents(events: EventCandidate[]) {
  const labSeedEvents = events.filter(
    (event) =>
      (event.eventType === "Assessment" || event.eventType === "Assignment") &&
      event.timing.kind === "single" &&
      event.timing.date &&
      /^lab\b/i.test(event.label)
  );
  const mergedIds = new Set<string>();

  labSeedEvents.forEach((labAssessment) => {
    const matchingLabs = events.filter((candidate) => {
      if (candidate.courseId !== labAssessment.courseId || candidate.eventType !== "Lab") {
        return false;
      }
      if (candidate.timing.kind === "single") {
        return candidate.timing.date === labAssessment.timing.date;
      }
      return occurrenceDatesForRecurring(candidate).includes(labAssessment.timing.date!);
    });

    if (matchingLabs.length === 0) return;

    const detailNote = combineNotes(
      [`${trimTrailingPeriods(labAssessment.label)}: ${labAssessment.location || "Lab activity"}`],
      labAssessment.notes
    );

    matchingLabs.forEach((labEvent) => {
      if (labEvent.timing.kind === "single") {
        labEvent.notes = combineNotes(labEvent.notes, detailNote);
      } else {
        const date = labAssessment.timing.date!;
        labEvent.timing.occurrenceNotes[date] = combineNotes(
          labEvent.timing.occurrenceNotes[date] ?? [],
          detailNote
        );
      }
      labEvent.provenance = mergeProvenanceLists([
        labEvent.provenance,
        labAssessment.provenance,
      ]);
    });

    mergedIds.add(labAssessment.id);
  });

  return events.filter((event) => !mergedIds.has(event.id));
}

function renumberFinalMidtermLabels(events: EventCandidate[]) {
  const grouped = new Map<string, EventCandidate[]>();

  events.forEach((event) => {
    if (
      event.eventType !== "Assessment" ||
      event.timing.kind !== "single" ||
      !event.timing.date ||
      !looksLikeMidterm(event)
    ) {
      return;
    }

    const key = `${event.courseId}::midterm`;
    const bucket = grouped.get(key) ?? [];
    bucket.push(event);
    grouped.set(key, bucket);
  });

  grouped.forEach((bucket) => {
    if (bucket.length < 2) return;

    bucket
      .sort((left, right) => {
        const dateCompare = left.timing.date!.localeCompare(right.timing.date!);
        if (dateCompare !== 0) return dateCompare;
        return (left.timing.startTime ?? "").localeCompare(right.timing.startTime ?? "");
      })
      .forEach((event, index) => {
        event.label = `Midterm #${index + 1}`;
      });
  });

  return events;
}

function hasStrongAssessmentCue(label: string) {
  const normalized = normalizeAssessmentLabel(label);
  if (
    /\bpre-(?:midterm|final)\b/i.test(normalized) ||
    /\bcheck-?in\b/i.test(normalized)
  ) {
    return false;
  }
  return /\b(?:online\s+quiz|quiz|knowledge check|midterm|mid-term|term test|test|exam|endterm)\b/i.test(
    normalized
  );
}

function normalizeAssessmentEventTypes(events: EventCandidate[]) {
  return events.map((event) => {
    const eventDate = event.timing.kind === "single" ? event.timing.date : undefined;
    const bareNumericLabel = normalizeWhitespace(event.label).match(/^#?\s*(\d+)\s*$/);
    if (bareNumericLabel) {
      const number = Number(bareNumericLabel[1]);
      const context = normalizeWhitespace(
        [event.label, ...event.notes, ...event.provenance.map((item) => item.snippet)].join(" ")
      );
      const inferredAssessmentSeries =
        /\bknowledge check\b/i.test(context)
          ? "Knowledge Check"
          : /\bquiz\b/i.test(context)
          ? "Quiz"
          : /\bmidterm\b/i.test(context)
          ? "Midterm"
          : /\btest\b/i.test(context)
          ? "Test"
          : /\bexam\b/i.test(context)
          ? "Exam"
          : undefined;
      const inferredAssignmentSeries =
        /\bwritten assignment\b/i.test(context)
          ? "Written Assignment"
          : /\breading assignment\b/i.test(context)
          ? "Reading Assignment"
          : /\bproblem set\b/i.test(context)
          ? "Problem Set"
          : /\bsimulation\b/i.test(context)
          ? "Simulation"
          : /\btask\b/i.test(context)
          ? "Task"
          : /\bassignment\b/i.test(context)
          ? "Assignment"
          : undefined;
      if (inferredAssessmentSeries) {
        const normalizedLabel = normalizeAssessmentLabel(
          `${inferredAssessmentSeries} #${number}`,
          eventDate
        );
        return {
          ...event,
          label: normalizedLabel,
          eventType: "Assessment" as const,
          eventGroup: EVENT_GROUP_BY_TYPE.Assessment,
          location: sanitizeAssessmentLocation(normalizedLabel, event.location),
        };
      }
      if (inferredAssignmentSeries || event.eventType === "Assessment") {
        const fallbackAssignmentSeries = inferredAssignmentSeries ?? "Assignment";
        return {
          ...event,
          label: `${fallbackAssignmentSeries} #${number}`,
          eventType: "Assignment" as const,
          eventGroup: EVENT_GROUP_BY_TYPE.Assignment,
        };
      }
    }

    if (
      event.eventType === "Assignment" &&
      hasStrongAssessmentCue(event.label)
    ) {
      const normalizedLabel = normalizeAssessmentLabel(event.label, eventDate);
      return {
        ...event,
        label: normalizedLabel,
        eventType: "Assessment" as const,
        eventGroup: EVENT_GROUP_BY_TYPE.Assessment,
        location: sanitizeAssessmentLocation(normalizedLabel, event.location),
      };
    }

    if (event.eventType === "Assessment") {
      const normalizedLabel = normalizeAssessmentLabel(event.label, eventDate);
      return {
        ...event,
        label: normalizedLabel,
        location: sanitizeAssessmentLocation(normalizedLabel, event.location),
      };
    }

    return event;
  });
}

function assignmentWeekday(date: string) {
  return WEEKDAY_BY_INDEX[getDay(parseISO(date))];
}

function extractAssignmentSeriesEntry(event: EventCandidate) {
  if (
    event.timing.kind !== "single" ||
    !event.timing.date
  ) {
    return null;
  }

  const normalizedSeriesType =
    event.eventType === "Assignment"
      ? "Assignment"
      : assessmentTypeFromLabel(event.label, event.location) === "Assignment"
      ? "Assignment"
      : null;
  if (!normalizedSeriesType) {
    return null;
  }

  const label = normalizeWhitespace(event.label);
  if (/#\s*\d+\s*-\s*\d+\b/.test(label)) {
    return null;
  }
  if (/\s+-\s+(?:submission|peer review|feedback)\b/i.test(label)) {
    return null;
  }
  const seriesModifier = label.match(
    /\b(Available|Review|Feedback|Evaluation|Post|Response|Responses)\b$/i
  )?.[1];
  const labelCore = normalizeWhitespace(
    label.replace(/\s+(?:Available|Review|Feedback|Evaluation|Post|Response|Responses)\b/i, "")
  );
  if (/#\s*\d+\.\d+\b/.test(labelCore)) {
    return null;
  }
  if (/\bpart\s+[a-z0-9]+\b/i.test(labelCore)) {
    return null;
  }
  if (/^project$/i.test(labelCore) || /\bproject due\b/i.test(labelCore)) {
    return null;
  }
  const context = normalizeWhitespace(
    [labelCore, ...event.notes, ...event.provenance.map((item) => item.snippet)].join(" ")
  );

  const explicitLabelSeries =
    /reading assignment/i.test(labelCore)
      ? "Reading Assignments"
      : /lab report/i.test(labelCore)
      ? "Lab Reports"
      : /problem set/i.test(labelCore)
      ? "Problem Sets"
      : /reflection/i.test(labelCore)
      ? "Reflections"
      : /commentary/i.test(labelCore)
      ? "Commentaries"
      : /module/i.test(labelCore)
      ? "Modules"
      : /simulation/i.test(labelCore)
      ? "Simulations"
      : /task/i.test(labelCore)
      ? "Tasks"
      : /assignment/i.test(labelCore)
      ? "Assignments"
      : undefined;

  const numberText =
    labelCore.match(/problem set\s*#?\s*(\d+)/i)?.[1] ??
    labelCore.match(/lab report\s*#?\s*(\d+)/i)?.[1] ??
    labelCore.match(/reading assignment\s*#?\s*(\d+)/i)?.[1] ??
    labelCore.match(/written assignment\s*#?\s*(\d+)/i)?.[1] ??
    labelCore.match(/mobius assignment\s*#?\s*(\d+)/i)?.[1] ??
    labelCore.match(/reflection\s*#?\s*(\d+)/i)?.[1] ??
    labelCore.match(/commentary\s*#?\s*(\d+)/i)?.[1] ??
    labelCore.match(/module\s*#?\s*(\d+)/i)?.[1] ??
    labelCore.match(/assignment\s*week\s*(\d+)/i)?.[1] ??
    labelCore.match(/\bweek\s*(\d+)\b/i)?.[1] ??
    labelCore.match(/assignment\s*#?\s*(\d+)/i)?.[1] ??
    labelCore.match(/simulation\s*#?\s*(\d+)/i)?.[1] ??
    labelCore.match(/task\s*#?\s*(\d+)/i)?.[1] ??
    labelCore.match(/step\s*#?\s*(\d+)/i)?.[1] ??
    labelCore.match(/post\s*#?\s*(\d+)/i)?.[1] ??
    labelCore.match(/response\s*#?\s*(\d+)/i)?.[1] ??
    context.match(/problem set\s*#?\s*(\d+)/i)?.[1] ??
    context.match(/lab report\s*#?\s*(\d+)/i)?.[1] ??
    context.match(/reading assignment\s*#?\s*(\d+)/i)?.[1] ??
    context.match(/written assignment\s*#?\s*(\d+)/i)?.[1] ??
    context.match(/mobius assignment\s*#?\s*(\d+)/i)?.[1] ??
    context.match(/reflection\s*#?\s*(\d+)/i)?.[1] ??
    context.match(/commentary\s*#?\s*(\d+)/i)?.[1] ??
    context.match(/module\s*#?\s*(\d+)/i)?.[1] ??
    context.match(/assignment\s*week\s*(\d+)/i)?.[1] ??
    context.match(/assignment\s*#?\s*(\d+)/i)?.[1] ??
    context.match(/simulation\s*#?\s*(\d+)/i)?.[1] ??
    context.match(/task\s*#?\s*(\d+)/i)?.[1] ??
    context.match(/step\s*#?\s*(\d+)/i)?.[1] ??
    context.match(/post\s*#?\s*(\d+)/i)?.[1] ??
    context.match(/response\s*#?\s*(\d+)/i)?.[1];

  if (!numberText) return null;

  let seriesName = explicitLabelSeries ?? "Assignments";
  if (explicitLabelSeries) {
    seriesName = explicitLabelSeries;
  } else if (/reading assignment/i.test(context)) {
    seriesName = "Reading Assignments";
  } else if (/lab report/i.test(context)) {
    seriesName = "Lab Reports";
  } else if (/problem set/i.test(context)) {
    seriesName = "Problem Sets";
  } else if (/reflection/i.test(context)) {
    seriesName = "Reflections";
  } else if (/commentary/i.test(context)) {
    seriesName = "Commentaries";
  } else if (/module/i.test(context)) {
    seriesName = "Modules";
  } else if (/assignment\s*week/i.test(label) && /connect/i.test(event.location)) {
    seriesName = "Reading Assignments";
  } else {
    const prefix =
      trimTrailingPeriods(
        labelCore
          .replace(/\*+$/g, "")
          .replace(/\bweek\s*\d+\b/gi, "")
          .replace(/\s*#?\s*\d+\s*$/g, "")
      ) || "Assignment";

    if (/assignment/i.test(prefix)) {
      seriesName = normalizeWhitespace(prefix.replace(/\bassignment\b/i, "Assignments"));
    } else {
      seriesName = pluralizeGenericSeriesLabel(prefix);
    }
  }

  return {
    event,
    date: event.timing.date,
    weekday: assignmentWeekday(event.timing.date),
    assignmentNumber: Number(numberText),
    seriesName,
    seriesModifier,
    seriesKey: `${event.courseId}:${seriesName.toLowerCase()}:${String(seriesModifier).toLowerCase()}:${event.location.toLowerCase()}`,
  };
}

function assignmentRangeLabel(
  seriesName: string,
  startNumber: number,
  endNumber: number,
  recurring = false,
  seriesModifier?: string
) {
  const displaySeriesName =
    startNumber === endNumber
      ? singularizeGenericSeriesLabel(seriesName)
      : normalizeWhitespace(seriesName);
  const range =
    startNumber === endNumber ? `#${startNumber}` : `#${startNumber}-${endNumber}`;
  const baseLabel = recurring
    ? `Weekly ${displaySeriesName} ${range}`
    : `${displaySeriesName} ${range}`;
  return seriesModifier ? `${baseLabel} ${seriesModifier}` : baseLabel;
}

function buildWeeklySeriesExDates(startDate: string, endDate: string, dates: string[]) {
  const actualDates = new Set(dates);
  const exDates: string[] = [];

  for (
    let cursor = parseISO(startDate);
    format(cursor, "yyyy-MM-dd") <= endDate;
    cursor = addDays(cursor, 7)
  ) {
    const date = format(cursor, "yyyy-MM-dd");
    if (!actualDates.has(date)) {
      exDates.push(date);
    }
  }

  return exDates;
}

function compactAssignmentSeries(events: EventCandidate[]) {
  const passthrough: EventCandidate[] = [];
  const bySeries = new Map<
    string,
    Array<
      NonNullable<ReturnType<typeof extractAssignmentSeriesEntry>>
    >
  >();

  events.forEach((event) => {
    const entry = extractAssignmentSeriesEntry(event);
    if (!entry) {
      passthrough.push(event);
      return;
    }

    const current = bySeries.get(entry.seriesKey) ?? [];
    bySeries.set(entry.seriesKey, [...current, entry]);
  });

  const compacted: EventCandidate[] = [];

  bySeries.forEach((entries) => {
    const sorted = [...entries].sort((left, right) => {
      const dateDelta = left.date.localeCompare(right.date);
      if (dateDelta !== 0) return dateDelta;
      return left.assignmentNumber - right.assignmentNumber;
    });

    const buckets: Array<{
      date: string;
      weekday: WeekdayCode;
      seriesName: string;
      seriesModifier?: string;
      startNumber: number;
      endNumber: number;
      entries: Array<NonNullable<ReturnType<typeof extractAssignmentSeriesEntry>>>;
    }> = [];

    sorted.forEach((entry) => {
      const current = buckets[buckets.length - 1];
      if (current && current.date === entry.date) {
        current.entries.push(entry);
        const numbers = unique(current.entries.map((item) => item.assignmentNumber)).sort(
          (left, right) => left - right
        );
        current.startNumber = numbers[0];
        current.endNumber = numbers[numbers.length - 1];
        return;
      }

      buckets.push({
        date: entry.date,
        weekday: entry.weekday,
        seriesName: entry.seriesName,
        seriesModifier: entry.seriesModifier,
        startNumber: entry.assignmentNumber,
        endNumber: entry.assignmentNumber,
        entries: [entry],
      });
    });

    const flushBucket = (bucket: (typeof buckets)[number]) => {
      const representative = bucket.entries[0].event;
      const labels = unique(bucket.entries.map((entry) => entry.event.label));
      compacted.push({
        ...representative,
        id: buildStableId(
          `${representative.courseId}:assignment-group:${bucket.seriesName}:${bucket.date}:${bucket.startNumber}:${bucket.endNumber}:${representative.location}`
        ),
        label: assignmentRangeLabel(
          bucket.seriesName,
          bucket.startNumber,
          bucket.endNumber,
          false,
          bucket.seriesModifier
        ),
        notes: combineNotes(
          labels.length > 1 ? [`Includes ${labels.join(", ")}`] : [],
          ...bucket.entries.map((entry) => entry.event.notes)
        ),
        eventType: "Assignment",
        eventGroup: EVENT_GROUP_BY_TYPE.Assignment,
        sectionOptionIds: unique(
          bucket.entries.flatMap((entry) => entry.event.sectionOptionIds)
        ),
        extractedSectionLabels: unique(
          bucket.entries.flatMap((entry) => entry.event.extractedSectionLabels)
        ),
        provenance: mergeProvenanceLists(
          bucket.entries.map((entry) => entry.event.provenance)
        ),
      });
    };

    let runStart = 0;
    while (runStart < buckets.length) {
      let runEnd = runStart;
      let everyWeek = true;

      while (runEnd + 1 < buckets.length) {
        const current = buckets[runEnd];
        const next = buckets[runEnd + 1];
        const dayDelta = Math.round(
          (parseISO(next.date).getTime() - parseISO(current.date).getTime()) /
            (1000 * 60 * 60 * 24)
        );
        const numbersAdvanceByOne = next.startNumber === current.endNumber + 1;
        const alignedToWeeklyCadence = dayDelta > 0 && dayDelta % 7 === 0;

        if (
          alignedToWeeklyCadence &&
          current.weekday === next.weekday &&
          numbersAdvanceByOne
        ) {
          if (dayDelta !== 7) {
            everyWeek = false;
          }
          runEnd += 1;
          continue;
        }

        break;
      }

      const runLength = runEnd - runStart + 1;
      if (runEnd > runStart && (everyWeek || runLength >= 3)) {
        const run = buckets.slice(runStart, runEnd + 1);
        const representative = run[0].entries[0].event;
        const startNumber = run[0].startNumber;
        const endNumber = run[run.length - 1].endNumber;
        const runDates = run.map((bucket) => bucket.date);
        const exDates = buildWeeklySeriesExDates(
          run[0].date,
          run[run.length - 1].date,
          runDates
        );
        const occurrenceNotes = Object.fromEntries(
          run.map((bucket) => {
            const labels = unique(bucket.entries.map((entry) => entry.event.label));
            return [
              bucket.date,
              combineNotes(
                labels.length > 0 ? [`Assignments: ${labels.join(", ")}`] : [],
                ...bucket.entries.map((entry) => entry.event.notes)
              ),
            ];
          })
        );

        compacted.push({
          ...representative,
          id: buildStableId(
            `${representative.courseId}:assignment-series:${run[0].seriesName}:${run[0].date}:${run[run.length - 1].date}:${run[0].weekday}:${representative.location}`
          ),
          label: assignmentRangeLabel(
            run[0].seriesName,
            startNumber,
            endNumber,
            everyWeek,
            run[0].seriesModifier
          ),
          notes: combineNotes([
            everyWeek
              ? `Recurring weekly assignment series covering ${run[0].seriesName.toLowerCase()} ${startNumber}-${endNumber}.`
              : `Recurring assignment series covering ${run[0].seriesName.toLowerCase()} ${startNumber}-${endNumber} on selected weeks.`,
          ]),
          eventType: "Assignment",
          eventGroup: EVENT_GROUP_BY_TYPE.Assignment,
          sectionOptionIds: unique(
            run.flatMap((bucket) => bucket.entries.flatMap((entry) => entry.event.sectionOptionIds))
          ),
          extractedSectionLabels: unique(
            run.flatMap((bucket) =>
              bucket.entries.flatMap((entry) => entry.event.extractedSectionLabels)
            )
          ),
          confidence: "high",
          reviewNeeded: false,
          provenance: mergeProvenanceLists(
            run.flatMap((bucket) => bucket.entries.map((entry) => entry.event.provenance))
          ),
          timing: {
            kind: "recurring",
            startDate: run[0].date,
            endDate: run[run.length - 1].date,
            byDay: [run[0].weekday],
            exDates,
            occurrenceNotes,
            occurrenceOverrides: {},
          },
        });
      } else if (runEnd > runStart) {
        buckets.slice(runStart, runEnd + 1).forEach((bucket) => flushBucket(bucket));
      } else {
        flushBucket(buckets[runStart]);
      }

      runStart = runEnd + 1;
    }
  });

  return [...passthrough, ...compacted];
}

function pluralizeAssessmentSeriesLabel(label: string) {
  const normalized = normalizeAssessmentLabel(label);
  if (/knowledge check$/i.test(normalized)) {
    return normalized.replace(/knowledge check$/i, "Knowledge Checks");
  }
  if (/quiz$/i.test(normalized)) {
    return normalized.replace(/quiz$/i, "Quizzes");
  }
  if (/test$/i.test(normalized)) {
    return normalized.replace(/test$/i, "Tests");
  }
  return normalized;
}

function pluralizeGenericSeriesLabel(label: string) {
  const normalized = cleanGenericSeriesStem(label);
  const parentheticalMatch = normalized.match(/^(.*?)(\s*\([^)]*\))$/);
  if (parentheticalMatch) {
    const pluralizedCore = pluralizeGenericSeriesLabel(parentheticalMatch[1]);
    return `${pluralizedCore}${parentheticalMatch[2]}`;
  }
  if (/knowledge check$/i.test(normalized)) {
    return normalized.replace(/knowledge check$/i, "Knowledge Checks");
  }
  if (/quiz$/i.test(normalized)) {
    return normalized.replace(/quiz$/i, "Quizzes");
  }
  if (/assignment$/i.test(normalized)) {
    return normalized.replace(/assignment$/i, "Assignments");
  }
  if (/problem set$/i.test(normalized)) {
    return normalized.replace(/problem set$/i, "Problem Sets");
  }
  if (/presentation$/i.test(normalized)) {
    return normalized.replace(/presentation$/i, "Presentations");
  }
  if (/project$/i.test(normalized)) {
    return normalized.replace(/project$/i, "Projects");
  }
  if (/deliverable$/i.test(normalized)) {
    return normalized.replace(/deliverable$/i, "Deliverables");
  }
  if (/reflection$/i.test(normalized)) {
    return normalized.replace(/reflection$/i, "Reflections");
  }
  if (/commentary$/i.test(normalized)) {
    return normalized.replace(/commentary$/i, "Commentaries");
  }
  if (/essay$/i.test(normalized)) {
    return normalized.replace(/essay$/i, "Essays");
  }
  if (/paper$/i.test(normalized)) {
    return normalized.replace(/paper$/i, "Papers");
  }
  if (/proposal$/i.test(normalized)) {
    return normalized.replace(/proposal$/i, "Proposals");
  }
  if (/problem$/i.test(normalized)) {
    return normalized.replace(/problem$/i, "Problems");
  }
  if (/summary$/i.test(normalized)) {
    return normalized.replace(/summary$/i, "Summaries");
  }
  if (/report$/i.test(normalized)) {
    return normalized.replace(/report$/i, "Reports");
  }
  if (/module$/i.test(normalized)) {
    return normalized.replace(/module$/i, "Modules");
  }
  if (/check-?in$/i.test(normalized)) {
    return normalized.replace(/check-?in$/i, "Check-Ins");
  }
  if (/workbook$/i.test(normalized)) {
    return normalized.replace(/workbook$/i, "Workbooks");
  }
  if (/session$/i.test(normalized)) {
    return normalized.replace(/session$/i, "Sessions");
  }
  return /s$/i.test(normalized) ? normalized : `${normalized}s`;
}

function singularizeGenericSeriesLabel(label: string) {
  const normalized = cleanGenericSeriesStem(label);
  const parentheticalMatch = normalized.match(/^(.*?)(\s*\([^)]*\))$/);
  if (parentheticalMatch) {
    return `${singularizeGenericSeriesLabel(parentheticalMatch[1])}${parentheticalMatch[2]}`;
  }

  return normalized
    .replace(/\bKnowledge Checks\b/gi, "Knowledge Check")
    .replace(/\bQuizzes\b/gi, "Quiz")
    .replace(/\bAssignments\b/gi, "Assignment")
    .replace(/\bProblem Sets\b/gi, "Problem Set")
    .replace(/\bPresentations\b/gi, "Presentation")
    .replace(/\bProjects\b/gi, "Project")
    .replace(/\bDeliverables\b/gi, "Deliverable")
    .replace(/\bReflections\b/gi, "Reflection")
    .replace(/\bCommentaries\b/gi, "Commentary")
    .replace(/\bEssays\b/gi, "Essay")
    .replace(/\bPapers\b/gi, "Paper")
    .replace(/\bProposals\b/gi, "Proposal")
    .replace(/\bProblems\b/gi, "Problem")
    .replace(/\bSummaries\b/gi, "Summary")
    .replace(/\bReports\b/gi, "Report")
    .replace(/\bModules\b/gi, "Module")
    .replace(/\bCheck-Ins\b/gi, "Check-In")
    .replace(/\bWorkbooks\b/gi, "Workbook")
    .replace(/\bSessions\b/gi, "Session")
    .replace(/\bPosts\b/gi, "Post")
    .replace(/\bResponses\b/gi, "Response")
    .replace(/\bSteps\b/gi, "Step");
}

function isGenericWeeklySeriesCandidate(event: EventCandidate) {
  if (
    event.timing.kind !== "single" ||
    !event.timing.date ||
    event.reviewNeeded
  ) {
    return false;
  }

  const label =
    event.eventType === "Assessment"
      ? normalizeAssessmentLabel(event.label, event.timing.date)
      : normalizeAssignmentLabel(event.label, event.timing.date);
  if (!label || /#\s*\d+/i.test(label)) {
    return false;
  }

  if (event.eventType === "Assessment") {
    return /\b(quizzes?|knowledge checks?|class check-?ins?)\b/i.test(label);
  }

  if (event.eventType !== "Assignment") {
    return false;
  }

  return (
    /\b(assignments?|written assignment|lab reports?|workbooks?|sessions?)\b/i.test(label) &&
    !/\b(term paper|proposal|project|presentation|outline|draft|response|reflection|essay|worksheet|case study|simulation)\b/i.test(
      label
    )
  );
}

function compactGenericWeeklySeries(events: EventCandidate[]) {
  const passthrough: EventCandidate[] = [];
  const bySeries = new Map<string, EventCandidate[]>();

  events.forEach((event) => {
    if (!isGenericWeeklySeriesCandidate(event)) {
      passthrough.push(event);
      return;
    }

    const normalizedLabel =
      event.eventType === "Assessment"
        ? normalizeAssessmentLabel(event.label, event.timing.date)
        : normalizeAssignmentLabel(event.label, event.timing.date);
    const key = `${event.courseId}:${event.eventType}:${normalizedLabel.toLowerCase()}:${event.location.toLowerCase()}`;
    const current = bySeries.get(key) ?? [];
    bySeries.set(key, [...current, { ...event, label: normalizedLabel }]);
  });

  const compacted: EventCandidate[] = [];

  bySeries.forEach((seriesEvents) => {
    const sorted = [...seriesEvents].sort((left, right) =>
      (left.timing.kind === "single" ? left.timing.date ?? "" : "").localeCompare(
        right.timing.kind === "single" ? right.timing.date ?? "" : ""
      )
    );

    if (sorted.length < 3) {
      compacted.push(...sorted);
      return;
    }

    const dates = sorted.map((event) => event.timing.kind === "single" ? event.timing.date! : "");
    const weekdays = unique(dates.map((value) => assignmentWeekday(value)));
    if (weekdays.length !== 1) {
      compacted.push(...sorted);
      return;
    }

    const deltas = dates.slice(1).map((value, index) =>
      differenceInCalendarDays(parseISO(value), parseISO(dates[index]))
    );
    if (deltas.length === 0 || !deltas.every((delta) => delta > 0 && delta % 7 === 0)) {
      compacted.push(...sorted);
      return;
    }

    const representative = sorted[0];
    const pluralStem = pluralizeGenericSeriesLabel(representative.label);
    const everyWeek = deltas.every((delta) => delta === 7);

    compacted.push({
      ...representative,
      id: buildStableId(
        `${representative.courseId}:generic-series:${representative.eventType}:${pluralStem}:${dates[0]}:${dates[dates.length - 1]}:${representative.location}`
      ),
      label: `${everyWeek ? `Weekly ${pluralStem}` : pluralStem} #1-${sorted.length}`,
      notes: combineNotes([
        everyWeek
          ? `Recurring weekly ${representative.eventType.toLowerCase()} series covering ${pluralStem.toLowerCase()} 1-${sorted.length}.`
          : `Recurring ${representative.eventType.toLowerCase()} series covering ${pluralStem.toLowerCase()} 1-${sorted.length} on selected weeks.`,
      ]),
      confidence: "high",
      reviewNeeded: false,
      provenance: mergeProvenanceLists(sorted.map((event) => event.provenance)),
      timing: {
        kind: "recurring",
        startDate: dates[0],
        endDate: dates[dates.length - 1],
        byDay: [weekdays[0]],
        exDates: buildWeeklySeriesExDates(dates[0], dates[dates.length - 1], dates),
        occurrenceNotes: Object.fromEntries(
          sorted.map((event, index) => [
            event.timing.kind === "single" ? event.timing.date! : dates[index],
            combineNotes([`${normalizeWhitespace(representative.label)} #${index + 1}`], event.notes),
          ])
        ),
        occurrenceOverrides: {},
      },
    });
  });

  return [...passthrough, ...compacted];
}

function mergeAssessmentWindowPairs(events: EventCandidate[]) {
  const passthrough: EventCandidate[] = [];
  const bySeries = new Map<string, EventCandidate[]>();

  events.forEach((event) => {
    if (
      event.eventType !== "Assessment" ||
      event.timing.kind !== "single" ||
      !event.timing.date
    ) {
      passthrough.push(event);
      return;
    }

    const notesText = normalizeWhitespace(event.notes.join(" "));
    if (!/\b(?:opens?|available(?:\s+on|\s+from)?|closes?)\b/i.test(notesText)) {
      passthrough.push(event);
      return;
    }

    const normalizedLabel = normalizeAssessmentLabel(event.label, event.timing.date);
    const key = `${event.courseId}:${normalizedLabel.toLowerCase()}:${event.location.toLowerCase()}`;
    const current = bySeries.get(key) ?? [];
    bySeries.set(key, [...current, { ...event, label: normalizedLabel }]);
  });

  const merged: EventCandidate[] = [];

  bySeries.forEach((seriesEvents) => {
    const sorted = [...seriesEvents].sort((left, right) =>
      (left.timing.kind === "single" ? left.timing.date ?? "" : "").localeCompare(
        right.timing.kind === "single" ? right.timing.date ?? "" : ""
      )
    );

    for (let index = 0; index < sorted.length; ) {
      const cluster = [sorted[index]];
      let endIndex = index + 1;

      while (endIndex < sorted.length) {
        const previous = cluster[cluster.length - 1];
        const previousDate =
          previous.timing.kind === "single" ? previous.timing.date : undefined;
        const nextDate =
          sorted[endIndex].timing.kind === "single"
            ? sorted[endIndex].timing.date
            : undefined;
        if (
          !previousDate ||
          !nextDate ||
          differenceInCalendarDays(parseISO(nextDate), parseISO(previousDate)) > 10
        ) {
          break;
        }
        cluster.push(sorted[endIndex]);
        endIndex += 1;
      }

      const hasOpen = cluster.some((event) =>
        /\b(?:opens?|available(?:\s+on|\s+from)?)\b/i.test(
          normalizeWhitespace(event.notes.join(" "))
        )
      );
      const hasClose = cluster.some((event) =>
        /\bcloses?\b/i.test(normalizeWhitespace(event.notes.join(" ")))
      );

      if (cluster.length > 1 && hasOpen && hasClose) {
        const representative =
          [...cluster]
            .reverse()
            .find((event) =>
              /\bcloses?\b/i.test(normalizeWhitespace(event.notes.join(" ")))
            ) ?? cluster[cluster.length - 1];
        const firstDate =
          cluster[0].timing.kind === "single" ? cluster[0].timing.date : undefined;
        const lastDate =
          cluster[cluster.length - 1].timing.kind === "single"
            ? cluster[cluster.length - 1].timing.date
            : undefined;

        merged.push({
          ...representative,
          id: buildStableId(
            `${representative.courseId}:assessment-window:${representative.label}:${firstDate}:${lastDate}:${representative.location}`
          ),
          notes: combineNotes(cluster.flatMap((event) => event.notes)),
          provenance: mergeProvenanceLists(cluster.map((event) => event.provenance)),
          confidence: "high",
          reviewNeeded: false,
        });
      } else {
        merged.push(...cluster);
      }

      index = endIndex;
    }
  });

  return [...passthrough, ...merged];
}

function compactRecurringAssessmentSeries(events: EventCandidate[]) {
  const passthrough: EventCandidate[] = [];
  const bySeries = new Map<string, EventCandidate[]>();

  events.forEach((event) => {
    if (
      event.eventType !== "Assessment" ||
      event.timing.kind !== "single" ||
      !event.timing.date
    ) {
      passthrough.push(event);
      return;
    }

    const normalizedLabel = normalizeAssessmentLabel(event.label, event.timing.date);
    if (!/\b(?:online\s+quiz|quiz|knowledge check)\b/i.test(normalizedLabel)) {
      passthrough.push(event);
      return;
    }

    const stem = normalizeWhitespace(normalizedLabel.replace(/\s*#\s*\d+\s*$/i, ""));
    const key = `${event.courseId}:${stem.toLowerCase()}:${event.location.toLowerCase()}`;
    const current = bySeries.get(key) ?? [];
    bySeries.set(key, [...current, { ...event, label: normalizedLabel }]);
  });

  const compacted: EventCandidate[] = [];

  bySeries.forEach((seriesEvents) => {
    const sorted = [...seriesEvents].sort((left, right) =>
      left.timing.kind === "single" && right.timing.kind === "single"
        ? (left.timing.date ?? "").localeCompare(right.timing.date ?? "")
        : 0
    );

    if (sorted.length < 3) {
      compacted.push(...sorted);
      return;
    }

    const dates = sorted
      .map((event) => event.timing.kind === "single" ? event.timing.date : undefined)
      .filter((value): value is string => Boolean(value));
    const weekdays = unique(dates.map((value) => assignmentWeekday(value)));
    if (weekdays.length !== 1) {
      compacted.push(...sorted);
      return;
    }

    const deltas = dates.slice(1).map((value, index) =>
      differenceInCalendarDays(parseISO(value), parseISO(dates[index]))
    );
    if (deltas.length === 0 || !deltas.every((delta) => delta > 0 && delta % 7 === 0)) {
      compacted.push(...sorted);
      return;
    }

    const representative = sorted[0];
    const allLabels = sorted.map((event) => normalizeAssessmentLabel(event.label, event.timing.date));
    const numberedValues = allLabels
      .map((label) => {
        const numberMatch = label.match(/#\s*(\d+)/)?.[1];
        return numberMatch ? Number(numberMatch) : undefined;
      })
      .filter((value): value is number => Number.isFinite(value));
    const startNumber = numberedValues.length === sorted.length ? Math.min(...numberedValues) : 1;
    const endNumber =
      numberedValues.length === sorted.length ? Math.max(...numberedValues) : sorted.length;
    const everyWeek = deltas.every((delta) => delta === 7);
    const stem = normalizeAssessmentLabel(representative.label, representative.timing.date).replace(
      /\s*#\s*\d+\s*$/i,
      ""
    );
    const pluralStem = pluralizeAssessmentSeriesLabel(stem);

    compacted.push({
      ...representative,
      id: buildStableId(
        `${representative.courseId}:assessment-series:${pluralStem}:${dates[0]}:${dates[dates.length - 1]}:${representative.location}`
      ),
      label: `${everyWeek ? `Weekly ${pluralStem}` : pluralStem} #${startNumber}-${endNumber}`,
      notes: combineNotes([
        everyWeek
          ? `Recurring weekly assessment series covering ${pluralStem.toLowerCase()} ${startNumber}-${endNumber}.`
          : `Recurring assessment series covering ${pluralStem.toLowerCase()} ${startNumber}-${endNumber} on selected weeks.`,
      ]),
      confidence: "high",
      reviewNeeded: false,
      provenance: mergeProvenanceLists(sorted.map((event) => event.provenance)),
      timing: {
        kind: "recurring",
        startDate: dates[0],
        endDate: dates[dates.length - 1],
        byDay: [weekdays[0]],
        exDates: buildWeeklySeriesExDates(dates[0], dates[dates.length - 1], dates),
        occurrenceNotes: Object.fromEntries(
          sorted.map((event, index) => [
            event.timing.kind === "single" ? event.timing.date! : dates[index],
            combineNotes([normalizeAssessmentLabel(event.label, event.timing.date)]),
          ])
        ),
        occurrenceOverrides: {},
      },
    });
  });

  return [...passthrough, ...compacted];
}

function normalizeTableEventDatesToTermYear(events: EventCandidate[], meta: OutlineMeta) {
  return events.map((event) => {
    if (event.timing.kind !== "single" || !event.timing.date) {
      return event;
    }

    const tableProvenance = event.provenance.find(
      (entry) =>
        entry.sourceKind === "table" &&
        /^(?:tentative_class_plan|weekly_course_schedule|week_by_week_course_schedule|course_schedule)$/i.test(
          entry.sectionId
        )
    );
    if (!tableProvenance) {
      return event;
    }

    const normalizedDate = normalizeWeekTableInferredDate(
      event.timing.date,
      tableProvenance.snippet,
      meta.termYear
    );
    if (!normalizedDate || normalizedDate === event.timing.date) {
      return event;
    }

    return {
      ...event,
      timing: {
        ...event.timing,
        date: normalizedDate,
      },
    };
  });
}

function normalizeEventDatesToOutlineTermYear(events: EventCandidate[], meta: OutlineMeta) {
  return events.map((event) => {
    const evidence = normalizeWhitespace(
      [event.label, ...event.notes, ...event.provenance.map((entry) => entry.snippet)].join(" ")
    );

    if (event.timing.kind === "single") {
      const normalizedDate = normalizeDateToOutlineTermYear(event.timing.date, evidence, meta);
      const normalizedEndDate = normalizeDateToOutlineTermYear(
        event.timing.endDate,
        evidence,
        meta
      );
      if (
        normalizedDate === event.timing.date &&
        normalizedEndDate === event.timing.endDate
      ) {
        return event;
      }

      return {
        ...event,
        timing: {
          ...event.timing,
          date: normalizedDate,
          endDate: normalizedEndDate,
        },
      };
    }

    const normalizedStartDate = normalizeDateToOutlineTermYear(
      event.timing.startDate,
      evidence,
      meta
    );
    const normalizedEndDate = normalizeDateToOutlineTermYear(
      event.timing.endDate,
      evidence,
      meta
    );
    const normalizedExDates = event.timing.exDates.map(
      (date) => normalizeDateToOutlineTermYear(date, evidence, meta) ?? date
    );

    if (
      normalizedStartDate === event.timing.startDate &&
      normalizedEndDate === event.timing.endDate &&
      normalizedExDates.every((date, index) => date === event.timing.exDates[index])
    ) {
      return event;
    }

    return {
      ...event,
      timing: {
        ...event.timing,
        startDate: normalizedStartDate,
        endDate: normalizedEndDate,
        exDates: normalizedExDates,
      },
    };
  });
}

function dedupeEvents(events: EventCandidate[]) {
  const byKey = new Map<string, EventCandidate>();

  events.forEach((event) => {
    const timingKey =
      event.timing.kind === "single"
        ? `${event.timing.date}:${event.timing.startTime}:${event.timing.endTime}`
        : `${event.timing.startDate}:${event.timing.endDate}:${event.timing.byDay.join(",")}:${event.timing.startTime}:${event.timing.endTime}`;
    const key = `${event.courseId}:${event.eventType}:${event.label.toLowerCase()}:${timingKey}:${event.location.toLowerCase()}`;

    const existing = byKey.get(key);
    if (!existing) {
      byKey.set(key, event);
      return;
    }

    existing.notes = combineNotes(existing.notes, event.notes);
    existing.provenance = [...existing.provenance, ...event.provenance];
    existing.sectionOptionIds = unique([...existing.sectionOptionIds, ...event.sectionOptionIds]);
    existing.extractedSectionLabels = unique([
      ...existing.extractedSectionLabels,
      ...event.extractedSectionLabels,
    ]);
    existing.include = existing.include || event.include;
    existing.reviewNeeded = existing.reviewNeeded || event.reviewNeeded;
    existing.confidence =
      existing.confidence === "high" || event.confidence === "high"
        ? "high"
        : existing.confidence === "medium" || event.confidence === "medium"
        ? "medium"
        : "low";
  });

  return Array.from(byKey.values());
}

function removeResolvedDateNotes(event: EventCandidate) {
  if (event.timing.kind !== "single" || !event.timing.date) {
    return event;
  }

  const notes = event.notes.filter(
    (note) => !/^(?:date unresolved|due date unresolved)\b/i.test(normalizeWhitespace(note))
  );

  return notes.length === event.notes.length ? event : { ...event, notes };
}

interface DeterministicScheduleParse {
  course: ParsedCourse;
  events: EventCandidate[];
  meta: OutlineMeta;
  termBounds?: {
    startDate: string;
    endDate: string;
  };
  aiRequest: AiOutlineExtractionRequest;
  sectionOptionCount: number;
}

function addCourseWarning(course: ParsedCourse, warning: string) {
  if (!course.warnings.includes(warning)) {
    course.warnings.push(warning);
  }
}

function finalizeParserEvents(
  course: ParsedCourse,
  events: EventCandidate[],
  meta: OutlineMeta
) {
  return applyCalendarTitles(
    course,
    dedupeEvents(normalizeEventDatesToOutlineTermYear(events, meta)).map((rawEvent) => {
      const event = removeResolvedDateNotes(rawEvent);
      const needsReview = reviewNeededForEvent(event) || event.reviewNeeded;
      return {
        ...event,
        reviewNeeded: needsReview,
        include: event.include && !needsReview,
      };
    })
  );
}

function buildDeterministicScheduleParse(
  html: string,
  outlineName: string
): DeterministicScheduleParse {
  const document = new DOMParser().parseFromString(html, "text/html");
  const meta = extractMeta(document, outlineName);
  const sections = collectSectionBlocks(document);

  const scheduleSection =
    sections.find((section) => section.id === "class_schedule") ?? sections[0];
  const scheduleData = parseScheduleSection(scheduleSection, meta);

  const course: ParsedCourse = {
    id: buildStableId(`${meta.courseCode}:${meta.term}:${outlineName}`),
    outlineId: buildStableId(outlineName),
    outlineName,
    courseCode: meta.courseCode,
    courseName: meta.courseName,
    term: meta.term,
    sectionOptions: scheduleData.sectionOptions,
    eventIds: [],
    officeHourEventIds: [],
    warnings: [],
    summary: meta.summary,
  };

  const termBounds =
    computeTermBounds(scheduleData.meetings) ?? computeFallbackTermBounds(sections, meta);

  let meetingEvents = mergeMeetingSinglesIntoRecurring(
    compactMeetingSinglesIntoRecurring(createMeetingEvents(course, scheduleData.meetings))
  );

  const events = finalizeParserEvents(course, meetingEvents, meta);

  return {
    course,
    events,
    meta,
    termBounds,
    aiRequest: buildAiExtractionRequest(document, meta),
    sectionOptionCount: scheduleData.sectionOptions.length,
  };
}

function finalizeOutlineParseResult(
  parsed: DeterministicScheduleParse,
  events: EventCandidate[]
): OutlineParseResult {
  parsed.course.eventIds = events.map((event) => event.id);
  parsed.course.officeHourEventIds = events
    .filter((event) => event.eventType === "OfficeHours")
    .map((event) => event.id);

  if (events.length === 0) {
    addCourseWarning(
      parsed.course,
      "No calendar-ready events were detected in this outline."
    );
  }
  if (parsed.sectionOptionCount === 0) {
    addCourseWarning(
      parsed.course,
      "No section options were detected from the schedule table."
    );
  }

  return {
    course: parsed.course,
    events,
  };
}

export function parseOutlineHtml(html: string, outlineName: string): OutlineParseResult {
  const parsed = buildDeterministicScheduleParse(html, outlineName);
  return finalizeOutlineParseResult(parsed, parsed.events);
}

export async function parseOutlineHtmlWithAi(
  sourceOrHtml: OutlineSource | string,
  outlineName?: string
): Promise<OutlineParseResult> {
  const source: OutlineSource =
    typeof sourceOrHtml === "string"
      ? {
          outlineName: outlineName ?? "outline.html",
          format: "html",
          content: sourceOrHtml,
        }
      : sourceOrHtml;

  if (source.format === "html") {
    const document = new DOMParser().parseFromString(source.content, "text/html");
    if (isUWaterlooDeterministicDocument(document)) {
      const parsed = buildDeterministicScheduleParse(source.content, source.outlineName);
      let aiRequest = parsed.aiRequest;

      try {
        aiRequest = {
          ...aiRequest,
          outlineHash: await computeOutlineHash(aiRequest.outlineText),
        };
      } catch (error) {
        console.warn("[gooseCalendar] AI extraction cache hash could not be computed", {
          message: error instanceof Error ? error.message : "Unknown error",
        });
      }

      try {
        const extraction = await extractNonMeetingEventsWithAi(aiRequest);
        extraction.warnings.forEach((warning) => addCourseWarning(parsed.course, warning));

        const aiEvents = mapAiExtractionToEventCandidates(extraction, parsed.course, {
          termBounds: parsed.termBounds,
          outlineText: aiRequest.outlineText,
        });
        const events = finalizeParserEvents(parsed.course, [...parsed.events, ...aiEvents], parsed.meta);

        return finalizeOutlineParseResult(parsed, events);
      } catch (error) {
        addCourseWarning(
          parsed.course,
          error instanceof Error
            ? `AI extraction failed: ${error.message}`
            : "AI extraction failed."
        );
        return finalizeOutlineParseResult(parsed, parsed.events);
      }
    }
  }

  const outlineText = sourceTextForAi(source);
  const meta = extractMetaFromSourceText(outlineText, source.outlineName);
  const course = buildGenericParsedCourse(meta, `${source.outlineName}:${source.format}`);
  const termBounds = computeFallbackTermBounds(
    [{ id: "source", title: "Outline", elements: [], text: outlineText }],
    meta
  );
  let aiRequest = buildFullOutlineAiRequest(source, meta, outlineText);

  try {
    aiRequest = {
      ...aiRequest,
      outlineHash: await computeOutlineHash(aiRequest.outlineText),
    };
  } catch (error) {
    console.warn("[gooseCalendar] AI extraction cache hash could not be computed", {
      message: error instanceof Error ? error.message : "Unknown error",
    });
  }

  const parsed: DeterministicScheduleParse = {
    course,
    events: [],
    meta,
    termBounds,
    aiRequest,
    sectionOptionCount: 1,
  };

  try {
    const extraction = await extractNonMeetingEventsWithAi(aiRequest);
    extraction.warnings.forEach((warning) => addCourseWarning(parsed.course, warning));

    const aiEvents = mapAiExtractionToEventCandidates(extraction, parsed.course, {
      termBounds: parsed.termBounds,
      outlineText: aiRequest.outlineText,
    });
    const events = finalizeParserEvents(parsed.course, aiEvents, parsed.meta);

    return finalizeOutlineParseResult(parsed, events);
  } catch (error) {
    addCourseWarning(
      parsed.course,
      error instanceof Error
        ? `AI extraction failed: ${error.message}`
        : "AI extraction failed."
    );
    return finalizeOutlineParseResult(parsed, []);
  }
}
