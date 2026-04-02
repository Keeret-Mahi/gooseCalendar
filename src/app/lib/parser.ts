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
import { normalizeCourseNameCapitalization } from "./courseNames";
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
    .replace(/([A-Za-z])(\d{1,2}:\d{2}\s*(?:a\.?m\.?|p\.?m\.?|am|pm|AM|PM)?)/g, "$1 $2")
    .replace(/([A-Za-z])(\d{3,4}[A-Za-z]?)/g, "$1 $2")
    .replace(/\ba\.?\s*m\.?\b/gi, "AM")
    .replace(/\bp\.?\s*m\.?\b/gi, "PM")
    .replace(/\bofice hours?\b/gi, "Office hours")
    .replace(/\bMc\s+([A-Z])/g, "Mc$1");
}

function officeHourBlockStartRegex() {
  return /^(?:(?:(?:Prof\.?|Professor|Dr\.?)\s+)?[\p{L}][\p{L}'’.-]*(?:\s+[\p{L}][\p{L}'’.-]*){0,4}'s\s+)?(?:office hours?|office location (?:and|&) hours?|student(?:\s*\(office\))?\s*hours?|open student hours?|my office hours are|drop-in ta office hours)\b/iu;
}

function officeHourSectionBoundaryRegex() {
  return /^(?:instructor|course instructor|lab instructor|lecture instructor|tutorial instructor|lectures?|tutorials?|labs?|teaching assistants?|teaching assistant|lead teaching assistant|lead ta|tas?|instructional support coordinator|instructional support assistant|instructional assistants?|instructional apprentices?|piazza|contact details|technical support|student resources|who and why)\b/i;
}

function splitOfficeHourAwareLines(text: string) {
  return normalizeOfficeHourParsingText(text)
    .replace(
      /\s*(Instructor:|Course Instructor:|Teaching Assistants?:|Teaching Assistant:|Lead Teaching Assistant(?:\s*\(TA\))?:|Lead TA:|TA:|Piazza:|Lectures?:|Tutorials?:|Labs?:|Instructional Support Coordinator(?:\s*\(ISC\))?:|Instructional Support Assistant(?:\s*\(ISA\))?:|Instructional Assistants?(?:\s*\(IA\))?:|Instructional Apprentices?(?:\s*\(IA\))?:)/gi,
      "\n$1"
    )
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
  if (/kritik/i.test(normalized)) return "Kritik";
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

  if (event.eventType === "Assignment" || event.eventType === "Other") {
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

function canonicalizeProseDeliverableLabel(label: string, contextText?: string) {
  const normalized = trimTrailingClauses(normalizeWhitespace(label));
  if (!normalized) return undefined;
  if (/^(?:the )?reflection is$|^(?:this|the) assignment is$|^(?:this|the) assessment is$/i.test(normalized)) {
    return undefined;
  }

  const search = normalizeWhitespace([normalized, contextText].filter(Boolean).join(" ")).toLowerCase();
  const tutorialProblemMatch = search.match(/\btutorial problem\s*#?\s*(\d+)/i)?.[1];
  if (tutorialProblemMatch) {
    return `Tutorial Problem ${tutorialProblemMatch}`;
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
    [/\bproject presentation materials\b|\bpresentation materials\b|\bslides?\b.*\bpresentations?\b/, "Project Presentation Materials"],
    [/\bfinal project presentation\b|\bproject presentation\b|\bpresent their (?:work|project)\b/, "Project Presentation"],
    [/\bproject peer review\b|\bpeer review\b.*\bproject\b/, "Project Peer Review"],
    [/\bproject summary report\b|\bproject paper\b|\bworkshop-quality paper\b|\bfinal project deliverables\b/, "Project Report"],
    [/\bwritten assignment\b/, "Written Assignment"],
    [/\bwritten report\b/, "Written Report"],
    [/\bliterature survey\b/, "Literature Survey"],
    [/\bjournal prompts?\b|\bmonday journals?\b/, "Journal Prompts"],
    [/\bcritical reflection\b/, "Critical Reflection"],
    [/\bread(?:ing)? responses?\b/, "Reading Response"],
    [/\bperusall annotations?\b|\bannotations?\s+\(on readings\)\b/, "Perusall Annotation"],
    [/\bqfc\b/, "QFC"],
    [/\bself-assessment\b/, "Self-Assessment"],
    [/\bpassage analysis\b/, "Passage Analysis"],
    [/\bterm paper\b/, "Term Paper"],
    [/\bthe final\b.*\bpebblepad workbook\b/, "Final Assignment"],
    [/\bextra credit\b.*\b(?:present|discussion leader|lead discussion)\b/, "Extra Credit Paper Presentation or Discussion"],
    [/\bfive critical concepts project\b/, "Five Critical Concepts Project"],
    [/\bstudent presentations?\b/, "Student Presentation"],
    [/\bpaper presentations?\b/, "Paper Presentation"],
    [/\bpaper summaries?\b/, "Paper Summary"],
    [/\bparticipation in paper discussions?\b/, "Paper Discussion Participation"],
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
  return /\b(project pitch|project proposal|proposal|team charter|written assignment|written report|literature survey|critical reflection|term paper|workshop assignment|paper presentations?|student presentations?|team case presentation|case presentation|paper summaries?|journal prompts?|monday journals?|presentation materials|slides? for the presentations?|project summary report|project paper|project abstract|project delivery|project presentation upload|group presentations?|research paper discussion|tutorial problem|paper assignment|peer review|annotations?|perusall|qfc|brief|self-assessment|passage analysis|choose a reading)\b/i.test(
    text
  );
}

function stripLeadingSchedulePrefix(label: string, date?: string) {
  let normalized = stripLeadingBulletPrefix(label).replace(/[–—]/g, "-");
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
  if (/^\d+(?:\.\d+)?%$/i.test(normalized)) return "";
  if (!/(quiz|midterm|endterm|term test|test|exam|final)/i.test(normalized)) {
    return capitalizeAssessmentText(normalized);
  }

  const match = normalized.match(
    /^(?:(?:Mon(?:day)?|Tue(?:s|sday)?|Wed(?:nesday)?|Thu(?:r|rs|rsday|ursday)?|Fri(?:day)?|Sat(?:urday)?|Sun(?:day)?),?\s+)?((?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:t|tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\.?\s+\d{1,2}(?:st|nd|rd|th)?(?:,\s*\d{4})?)(?:,?\s+)(.+)$/i
  );
  if (!match) return capitalizeAssessmentText(normalized);

  const [, prefixDate, remainder] = match;
  if (!/(quiz|midterm|endterm|term test|test|exam|final)/i.test(remainder)) {
    return capitalizeAssessmentText(normalized);
  }

  if (!date) return capitalizeAssessmentText(remainder);

  const inferredDate = parseFlexibleDate(prefixDate, Number(date.slice(0, 4)));
  if (inferredDate !== date) return capitalizeAssessmentText(normalized);

  return capitalizeAssessmentText(remainder);
}

function normalizeAssignmentLabel(label: string, date?: string) {
  let normalized = trimTrailingPeriods(
    stripTrailingDateParenthetical(
      stripLeadingSeriesCount(stripLeadingSchedulePrefix(label, date)).replace(
        /^[^A-Za-z0-9]+/,
        ""
      ),
      date
    )
  );
  if (!normalized) return normalized;

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
    .replace(/([,&]\s*)#(\d+)/g, "$1$2")
    .replace(/^deadline for\s+/i, "")
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
  return canonicalizeProseDeliverableLabel(normalized, normalized) ?? capitalizeAssignmentText(normalized);
}

function extractAssessmentLabelFromText(text: string) {
  const normalized = normalizeWhitespace(text);
  if (/\bquiz(?:\s*\d+)?\s+prep\b/i.test(normalized)) {
    return undefined;
  }
  if (/\btest preparation\b/i.test(normalized)) {
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
  const directMatch = normalized.match(
    /\b(Module\s*\d+\s+Exam|Module\s*\d+\s+Quiz|Knowledge Checks?(?:\s*#\s*\d+)?|Mid-?term Exam(?:\s*#\s*\d+)?|Mid-?term Test(?:\s*#\s*\d+)?|Mid-?term(?:\s*#\s*\d+)?|Endterm Test(?:\s*#\s*\d+)?|Term Test(?:\s*#\s*\d+)?|Final Exam|Online Quiz(?:\s*#\s*\d+)?|Quiz(?:\s*#\s*\d+)?|Test(?:\s*#\s*\d+)?)\b/i
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
  return normalizeWhitespace(label).length > 70;
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
      /\b(?:due by|due on|due\b|deadline(?:\s+for)?|available(?:\s+as\s+of|\s+from)?|opens?(?:\s+on)?|closes?(?:\s+on)?|submitted?\s+by|class time on)\b[\s\S]*$/i
    )?.[0] ?? normalized;
  return extractExplicitDates(anchoredClause, year);
}

function assignmentLabelFromText(text: string) {
  const normalized = stripLeadingSchedulePrefix(text);
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

  const assignmentCode =
    normalized.match(/^\s*A\s*0*(\d+)\b/i)?.[1] ??
    normalized.match(/^\s*(?:homework|hw)\s*#?\s*0*(\d+)\b/i)?.[1];
  if (assignmentCode) {
    return `Assignment #${Number(assignmentCode)}`;
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

function extractProseDeliverableLabel(text: string) {
  const normalized = stripLeadingNumbering(stripLeadingSchedulePrefix(text));
  if (!normalized || isFinalExamLabel(normalized)) {
    return undefined;
  }
  const candidates = [
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
  ]
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

  const extracted = candidates.find((candidate) => {
    if (!candidate) return false;
    if (/^module\s*\d+$/i.test(candidate)) return false;
    return looksLikeAssignmentText(candidate);
  });

  if (extracted) {
    return extracted;
  }

  if (hasNamedDeliverableCue(normalized)) {
    return canonicalizeProseDeliverableLabel(normalized, normalized);
  }

  return undefined;
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

function expandScheduleEntries(content: string) {
  const lines = normalizeWhitespace(content)
    .split(/\n+/)
    .map((line) => normalizeWhitespace(line))
    .filter(Boolean);

  return lines.flatMap((line) => {
    const duePrefixMatch = line.match(/^((?:due by|due on|deadline(?:\s+for)?|submission due date|review of peers due date|feedback(?: review)? due date)[^:]*):\s*(.+)$/i);
    if (duePrefixMatch) {
      return duePrefixMatch[2]
        .split(/\s*;\s*/)
        .map((item) => normalizeWhitespace(item))
        .filter(Boolean)
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

    const datedPrefixMatch = line.match(/^((?:(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)[a-z]*\.?\s+\d{1,2}|(?:Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday),?\s+(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)[a-z]*\.?\s+\d{1,2}).{0,40}?\bby\b[^:]*):\s*(.+)$/i);
    if (datedPrefixMatch) {
      return datedPrefixMatch[2]
        .split(/\s*;\s*/)
        .map((item) => normalizeWhitespace(item))
        .filter(Boolean)
        .map((item) => `${datedPrefixMatch[1]}: ${item}`);
    }

    const repeatedDateBoundedEntries = Array.from(
      line.matchAll(
        /([^.;]*?\b(?:due by|due on|submission due date|review of peers due date|feedback(?: review)? due date)\b[^.;]*?(?:(?:Mon(?:day)?|Tue(?:s|sday)?|Wed(?:nesday)?|Thu(?:r|rs|rsday|ursday)?|Fri(?:day)?|Sat(?:urday)?|Sun(?:day)?),?\s+)?(?:\d{1,2}\s+)?(?:January|February|March|April|May|June|July|August|September|October|November|December|Jan|Feb|Mar|Apr|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)\.?\s+\d{1,2}(?:st|nd|rd|th)?(?:,?\s*\d{4})?)/gi
      )
    )
      .map((match) => normalizeWhitespace(match[1]))
      .filter(Boolean);
    if (repeatedDateBoundedEntries.length > 1) {
      return repeatedDateBoundedEntries;
    }

    return line
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
  if (isRoutineScheduleEntry(normalized)) return undefined;
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
    /\b(January|February|March|April|May|June|July|August|September|October|November|December|Jan|Feb|Mar|Apr|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)\.?\s*(\d{1,2}(?:st|nd|rd|th)?)(?=\b)/gi,
    (_match, month: string, day: string) => `${month} ${day}`
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
  return /\b(?:assignments?|reports?|essays?|analysis|analyses|reflections?|portfolios?|projects?|deliverables?|surveys?|charters?|homepage|linkedin|bibliography|papers?|communication assignments?|posts?\b|responses?\b|peer assessment|peer feedback|learning from place|map the system|presentations?|applications?|packets?|worksheets?|speeches?|scripts?|briefing note|brief\b|deck|proposals?|videos?|review workshop|review comments?|rough drafts?|author['’]s statement|group contract|goal statement|outlines?|annotations?\b|perusall\b|qfc\b|self-assessment\b|passage analysis)\b/i.test(
    normalizeWhitespace(value)
  );
}

function parseFlexibleTime(value: string | null | undefined) {
  const normalized = normalizeWhitespace(value)
    .replace(/[–—]/g, "-")
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
  const directStart = startExplicit ? parseFlexibleTime(startRaw) : undefined;
  const directEnd = endExplicit ? parseFlexibleTime(endRaw) : undefined;

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

function parseFlexibleDate(rawValue: string | null | undefined, defaultYear: number) {
  const value = normalizeLooseMonthDaySpacing(
    normalizeWhitespace(rawValue)
      .replace(/,/g, "")
      .replace(/\./g, "")
      .replace(/\bof\b/gi, " ")
      .replace(/\s+/g, " ")
  );
  if (!value) return undefined;

  const sanitized = stripOrdinals(stripLeadingWeekdayText(value));
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
      return format(withYear, "yyyy-MM-dd");
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

function extractExplicitDates(value: string | null | undefined, defaultYear: number) {
  const normalized = normalizeLooseMonthDaySpacing(
    stripLeadingWeekdayText(normalizeWhitespace(value))
  );
  if (!normalized) return [];
  const withoutTimes = normalizeWhitespace(
    normalized
      .replace(
        /\b\d{1,2}(?::\d{2})?\s*-\s*\d{1,2}(?::\d{2})?\s*(?:a\.?m\.?|p\.?m\.?|am|pm|AM|PM)\b/gi,
        " "
      )
      .replace(/\b\d{1,2}:\d{2}\s*-\s*\d{1,2}(?::\d{2})?\b/gi, " ")
      .replace(/\b\d{1,2}:\d{2}\s*(?:a\.?m\.?|p\.?m\.?|am|pm|AM|PM)?\b/gi, " ")
      .replace(/\b\d{1,2}\s*(?:a\.?m\.?|p\.?m\.?|am|pm|AM|PM)\b/gi, " ")
  );

  const explicit = new Set<string>();

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
    const year = match[3] ? Number(match[3]) : defaultYear;
    const parsed = parseFlexibleDate(`${match[1]} ${match[2]} ${year}`, year);
    if (parsed) explicit.add(parsed);
  }

  for (const match of withoutTimes.matchAll(/\b\d{1,2}-[A-Za-z]{3}\b/g)) {
    const parsed = parseFlexibleDate(match[0], defaultYear);
    if (parsed) explicit.add(parsed);
  }

  for (const match of withoutDualDayMonth.matchAll(/\b\d{1,2}\/\d{1,2}(?:\/\d{2,4})?\b/g)) {
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

function parseOfficeHourDayCodes(value: string | null | undefined) {
  const normalized = normalizeWhitespace(value);
  const weekdayOnly = normalized
    .replace(/\b\d{1,2}(?::\d{2})?\s*(?:a\.?m\.?|p\.?m\.?|am|pm|AM|PM)\b/g, " ")
    .replace(/\b\d{1,2}:\d{2}\b/g, " ")
    .replace(/\b(?:a\.?m\.?|p\.?m\.?|am|pm|AM|PM)\b/g, " ")
    .replace(/\b[A-Z](?:\.?[A-Z0-9]){0,3}\.?(?:-|\s*)\d{3,4}[A-Za-z]?\b/g, " ")
    .replace(/\([^)]*\)/g, " ");
  const cuesByCode: Array<[WeekdayCode, RegExp]> = [
    ["MO", /\b(?:m|mon(?:day)?s?'?s?)\b/gi],
    ["TU", /\b(?:tu|tue(?:s(?:day)?)?s?'?s?)\b/gi],
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

  let bestIndex = 0;
  let bestScore = -1;
  rows.forEach((row, index) => {
    const score = row.reduce((sum, cell) => {
      const normalized = cell.toLowerCase();
      return sum + Number(keywords.some((keyword) => normalized.includes(keyword)));
    }, 0);
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
      /^(?:Instructor|Course Instructor|Teaching Assistant|Lead Teaching Assistant|Lead TA|TA)\s*:?\s*/i.test(
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

function normalizeOfficeHoursSnippet(line: string) {
  return normalizeOfficeHourParsingText(
    line
      .replace(/^.*?\bdrop-in ta office hours\b[:\s-]*/i, "")
      .replace(/^.*?\bopen student hours?\b(?:\s+with\s+[^-:]+)?\s*[-:]\s*/i, "")
      .replace(/^.*?\bmy office hours are\b[:\s]*/i, "")
      .replace(/^.*?\boffice hours?\b[:\s]*/i, "")
      .replace(/^.*?\boffice location (?:and|&) hours?\b[:\s]*/i, "")
      .replace(/^.*?\bstudent(?:\s*\(office\))?\s*hours?(?:\s*\(office hours\))?\b[:\s]*/i, "")
      .replace(
        /^((?:(?:Dr\.?|Prof\.?|Professor)\s+)?[\p{L}][\p{L}'’.-]+(?:\s+[\p{L}][\p{L}'’.-]+){0,4})(?:\s+[A-Z0-9._%+-]+@uwaterloo\.ca)?\s+(?=(?:Mon(?:day)?|Tue(?:s(?:day)?)?|Wed(?:nesday)?|Thu(?:r(?:s(?:day)?)?)?|Fri(?:day)?|Sat(?:urday)?|Sun(?:day)?))/iu,
        ""
      )
      .replace(/\bnoon\b/gi, "12:00 PM")
      .replace(/\bmidnight\b/gi, "12:00 AM")
      .replace(/\bor\s+e-?mail\s+for\s+appointment\b.*$/i, "")
  );
}

function normalizeWeekTableDateSourceText(value: string | null | undefined) {
  return normalizeLooseMonthDaySpacing(
    normalizeWhitespace(value)
      .replace(/^\s*(?:week\s+\d+|reading week|week of)\b[:\s-]*/i, "")
      .replace(/\bweek\s+\d+\b[:\s-]*/gi, " ")
  );
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
    rawText.match(/\bLocation:\s*([A-Z]{1,5}(?:-|\s*)\d{3,4}[A-Za-z]?)\b/i)?.[1]?.trim() ||
    rawText.match(/\bOffice:\s*([A-Z]{1,5}(?:-|\s*)\d{3,4}[A-Za-z]?)\b/i)?.[1]?.trim() ||
    rawText.match(/\b([A-Z]{2,5}\s*-\s*[A-Z]{2,5}\s+\d{3,4}[A-Za-z]?)\b/i)?.[1]?.trim() ||
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
    return explicitPhysicalLocation;
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
    .replace(/^note\s*:?\s*/i, "")
    .replace(/\b(?:Office|Tutorials?|Lectures?|Consulting Hours?)\b.*$/i, "")
    .replace(/\s*\([^)]*$/g, "")
    .replace(/\b(?:course staff|teaching assistants?|tas?)['’]?\s*$/i, "")
    .replace(/\s+[a-z]{2,}$/g, "")
    .replace(/\n+/g, " ")
    .replace(/\s*[-,:]\s*$/g, "")
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
  return extractOfficeHourEmail(text) || meetings.find((meeting) => meeting.instructorEmail)?.instructorEmail;
}

function isLikelyInstructionalSection(section: SectionBlock) {
  if (OFFICE_HOUR_ALLOWED_SECTION_IDS.has(section.id)) {
    return true;
  }

  return /\b(instructional team|course staff|instructor|personnel)\b/i.test(
    `${section.id} ${section.title}`
  );
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
  const normalizedSnippet = normalizeOfficeHoursSnippet(snippet);
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
      const snippetIsSingleOnlineSeries =
        sequentialDayTimeMatches.length === 1 &&
        /\bonline\b/i.test(normalizedSnippet) &&
        /\b(?:teams?|zoom)\b/i.test(normalizedSnippet);
      const resolvedLocation =
        /virtual|online|teams?|zoom/i.test(locationHint)
          ? "Online"
          : snippetIsSingleOnlineSeries
          ? "Online"
          : officeHourLocation(locationHint) ||
            officeHourLocation(match[0]) ||
            fallbackLocation ||
            officeHourLocation(snippet);
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
      const resolvedLocation = officeHourLocation(snippet) || fallbackLocation;
      const location = isClearlyInvalidOfficeHourLocation(resolvedLocation)
        ? undefined
        : resolvedLocation;
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

        if (officeHoursIndex !== -1) {
          rows.slice(headerIndex + 1).forEach((row) => {
          const rowText = row.join("\n");
          const personName = sanitizeOfficeHourPersonName(
            row[nameIndex] ||
              context.personName ||
              rowText.match(
                /\b((?:(?:Dr\.?|Prof\.?|Professor)\s+)?[\p{L}][\p{L}'’.-]+(?:\s+[\p{L}][\p{L}'’.-]+){0,5})\b/iu
              )?.[1] ||
              officeHourInstructorName(rowText, meetings, meta)
          );
          if (!personName || isGenericOfficeHourName(personName)) return;

          const personEmail =
              extractOfficeHourEmail(row[contactIndex] || rowText) ||
              tableEmail ||
              context.personEmail ||
              officeHourInstructorEmail(rowText, meetings);
          const officeHoursCell = row[officeHoursIndex] || "";
          const officeCell = officeIndex === -1 ? "" : row[officeIndex] || "";
          const combinedSnippet = [officeHoursCell, officeCell].filter(Boolean).join("\n");
          const explicitDayCodes = parseWeekdayCodes(officeHoursCell);
          const explicitRange = parseOfficeHourTimeRange(officeHoursCell);
          if (
            explicitDayCodes.length > 1 &&
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
                startDate: termBounds.startDate,
                exDates: [],
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
          seeds.push(...structuredSeeds);
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
      let activeInstructorName = officeHourInstructorName(section.text, meetings, meta);
      let activeInstructorEmail = officeHourInstructorEmail(section.text, meetings);
      let activeLocation = officeHourLocation(section.text);
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
        seeds.push(
          ...createOfficeHourSeedsFromStructuredSnippet(
            section,
            snippet,
            personName,
            pendingInstructorEmail,
            pendingLocation,
            termBounds
          )
        );
        pendingSnippetLines = [];
      };

      const handlePotentialIdentityLine = (line: string) => {
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
        const bareNameMatch = line.match(
          /^((?:(?:Dr\.?|Prof\.?|Professor)\s+)?[\p{L}][\p{L}'’.-]+(?:\s+[\p{L}][\p{L}'’.-]+){1,4})$/u
        )?.[1];
        const lineEmail = extractOfficeHourEmail(line);

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
          });
        });

      flushPendingSnippet();
    });

  return seeds;
}

function isGenericOfficeHourName(value: string | null | undefined) {
  const normalized = normalizeWhitespace(value)
    .replace(/^[•*-]\s*/, "")
    .replace(/:+$/, "")
    .trim();
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
    /\b(?:course staff|teaching assistants?|tas?)\b/i.test(normalized) ||
    /^(?:name|contact|name contact)$/i.test(normalized) ||
    /^(?:email address|phone number|contact details|who and why|technical support|student resources)$/i.test(
      normalized
    ) ||
    /^include your full name\b/i.test(normalized) ||
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
    normalized.includes("regular business hours")
  );
}

function hasMeridiem(value: string) {
  return /\b(a\.?m\.?|p\.?m\.?|am|pm)\b/i.test(value);
}

function parseLooseClock(value: string) {
  const normalized = normalizeWhitespace(value).replace(/\./g, "").toUpperCase();
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

  const meridiem = value.meridiem ?? fallbackMeridiem;
  if (!meridiem) {
    if (value.hour > 23 || value.minute > 59) return undefined;
    return `${String(value.hour).padStart(2, "0")}:${String(value.minute).padStart(2, "0")}`;
  }

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
  const directStart = startExplicit ? parseFlexibleTime(startRaw) : undefined;
  const directEnd = endExplicit ? parseFlexibleTime(endRaw) : undefined;

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

  return {
    startTime: directStart ?? to24HourTime(startClock, startMeridiem),
    endTime: directEnd ?? to24HourTime(endClock, endMeridiem),
    inferred,
  };
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

  const timeLeadMatches = Array.from(
    normalized.matchAll(
      /(\d{1,2}(?::\d{2})?\s*(?:a\.?m\.?|p\.?m\.?|am|pm|AM|PM)?\s*(?:-|–|—|to)\s*\d{1,2}(?::\d{2})?\s*(?:a\.?m\.?|p\.?m\.?|am|pm|AM|PM)?)\s+(?:on\s+)?((?:(?:Mon(?:day)?s?'?s?|Tue(?:s(?:day)?)?s?'?s?|Wed(?:nesday)?s?'?s?|Thu(?:r(?:s(?:day)?)?)?s?'?s?|Fri(?:day)?s?'?s?|Sat(?:urday)?s?'?s?|Sun(?:day)?s?'?s?|M|Tu|Th|T|W|F(?![a-z]))\.?\s*(?:,|&|and|\/|\s+)?\s*)+)/gi
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
        /\([A-Z][A-Z0-9]{0,3}(?:-|\s*)\d{3,4}[A-Za-z]?\)/.test(normalizedCandidateLine) ||
        /\bin\s+[A-Z][A-Z0-9]{0,3}(?:-|\s*)\d{3,4}[A-Za-z]?\b/i.test(normalizedCandidateLine);
      const officeHoursOnlySnippet =
        normalizeOfficeHoursSnippet(
          normalizedCandidateLine.match(
            /\b(?:office hours?|office location (?:and|&) hours?|student(?:\s*\(office\))?\s*hours?|open student hours?|my office hours are|drop-in ta office hours)\b[:\s-]*.*$/i
          )?.[0] ?? normalizedCandidateLine
        ) || normalizedCandidateLine;
      const lineLocation = canUpdateLocationFromLine
        ? officeHourLocation(officeHoursOnlySnippet)
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
    const explicitDayCodes = parseOfficeHourDayCodes(officeHoursSnippet);
    if (explicitDayCodes.length > 1 && !explicitDayCodes.includes(seed.dayCode)) {
      return;
    }
    if (
      extractOfficeHourSlots(officeHoursSnippet).length === 0 &&
      /\bby appointment\b/i.test(officeHoursSnippet)
    ) {
      return;
    }
    const key = `${seed.personName}:${seed.personEmail ?? ""}:${seed.dayCode}:${seed.startTime ?? ""}:${seed.endTime ?? ""}`;
    const existing = deduped.get(key);
    if (!existing) {
      deduped.set(key, seed);
      return;
    }
    const mergedLocation =
      existing.location && !isClearlyInvalidOfficeHourLocation(existing.location)
        ? existing.location
        : seed.location;
    deduped.set(key, {
      ...existing,
      location: mergedLocation,
      notes: combineNotes(existing.notes, seed.notes),
      provenance: mergeProvenanceLists([existing.provenance, seed.provenance]),
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
        /(?=\b(?:Instructor|Course Instructor|Teaching Assistant|Lead Teaching Assistant|TA)\s*:)/i
      )
      .map((segment) => normalizeWhitespace(normalizeOfficeHourParsingText(segment)))
      .filter(Boolean);

    return inlineSegments.flatMap((segment) => {
      if (isAdministrativeOfficeHourNoiseSnippet(segment)) {
        return [];
      }
      const segmentLines = splitOfficeHourAwareLines(segment)
        .map((line) => normalizeWhitespace(line))
        .filter(Boolean);
      const officeHoursLineIndex = segmentLines.findIndex((line) =>
        /\b(?:office hours?|student(?:\s*\(office\))?\s*hours?)\b/i.test(line)
      );
      const officeSnippet = normalizeOfficeHoursSnippet(
        officeHoursLineIndex === -1
          ? segment
          : segmentLines.slice(officeHoursLineIndex).join("\n")
      );
      const extractedOfficeSnippetSlots = extractOfficeHourSlots(officeSnippet);
      if (
        !/\boffice hours?\b/i.test(segment) ||
        isAdministrativeOfficeHourNoiseSnippet(officeSnippet) ||
        ((/by appointment|upon appointment|tbd|to be determined/i.test(officeSnippet) ||
          /\boffice hours?\s*\(\s*by appointment\s*\)/i.test(segment)) &&
          extractedOfficeSnippetSlots.length === 0)
      ) {
        return [];
      }

        const personName =
          sanitizeOfficeHourPersonName(
            segment.match(
              /\b(?:Instructor|Course Instructor|Teaching Assistant|Lead Teaching Assistant|TA)\s*:?\s*((?:(?:Dr\.?|Prof\.?|Professor)\s+)?[\p{L}][\p{L}'’.-]+(?:\s+[\p{L}][\p{L}'’.-]+){0,4})(?=\s*(?:Email(?: Address)?\s*:|[A-Z0-9._%+-]+@uwaterloo\.ca\b|Office hours?\b))/iu
            )?.[1]
          ) || fallbackInstructorName;
        const personEmail =
          segment.match(/[A-Z0-9._%+-]+@uwaterloo\.ca/i)?.[0] || fallbackInstructorEmail;
        const location =
          officeHourLocation(officeSnippet) &&
          !isClearlyInvalidOfficeHourLocation(officeHourLocation(officeSnippet))
            ? officeHourLocation(officeSnippet)
            : officeHourLocation(segment) &&
              !isClearlyInvalidOfficeHourLocation(officeHourLocation(segment))
            ? officeHourLocation(segment)
            : fallbackLocation;
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
  });

  return dedupeOfficeHourSeeds(seeds);
}

function assessmentTypeFromLabel(label: string | null | undefined, location?: string) {
  const normalizedLabel = normalizeWhitespace(label);
  if (!normalizedLabel) {
    return "Other" as const;
  }
  const labelOnly = normalizedLabel.toLowerCase().trim();
  const normalized = `${normalizedLabel} ${location ?? ""}`.toLowerCase();
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
    return true;
  }
  if (
    /\baccessability services\b|\baas\b/.test(normalized) &&
    /\bexam accommodation\b|\brequest to write\b/.test(normalized)
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
    const segments = line.split(/(?<=[.!?])\s+/).filter(Boolean);
    for (const segment of segments) {
      const lineLabel = extractAssessmentLabelFromText(segment);
      const matchedLabel =
        lineLabel && canonicalAssessmentFamily(lineLabel) === targetFamily
          ? lineLabel
          : previousLabel && canonicalAssessmentFamily(previousLabel) === targetFamily
          ? previousLabel
          : undefined;
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

      return {
        date: resolvedDates[0],
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
    const segments = line.split(/(?<=[.!?])\s+/).filter(Boolean);
    for (const segment of segments) {
      const lineLabel =
        extractProseDeliverableLabel(segment) ??
        assignmentLabelFromText(segment) ??
        labelFromScheduleEntry(segment);
      const matchedLabel =
        lineLabel && canonicalAssignmentFamily(lineLabel) === targetFamily
          ? lineLabel
          : previousLabel && canonicalAssignmentFamily(previousLabel) === targetFamily
          ? previousLabel
          : undefined;
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
      const availableDate =
        /\b(?:available|opens?|posted)\b/i.test(segment) && resolvedDates.length > 1
          ? resolvedDates[0]
          : undefined;
      const { startTime, endTime } = parseTimeRange(segment);
      const location = assignmentLocationFromContext(segment) || undefined;

      return {
        date: dueDate,
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
      seeds.push({
        label,
        eventType: baseType === "Other" ? "Assessment" : baseType,
        date: contextualResolution.date,
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
          date: contextualResolution.date,
          startTime: contextualResolution.startTime,
          endTime: contextualResolution.endTime,
          location: contextualResolution.location || location,
        }),
        provenance,
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
      splitEntries.every(({ value }) => /[:=]/.test(value) || extractExplicitDates(value, meta.termYear).length > 0)
    ) {
      const totalOccurrences = splitEntries.reduce((count, { value }) => {
        const lineSpec = parseDateSpec(value, meta.termYear);
        if (
          lineSpec?.kind === "dates" &&
          lineSpec.dates.length === 2 &&
          /\bto\b/i.test(value)
        ) {
          return count + 1;
        }
        if (lineSpec?.kind === "dates") return count + lineSpec.dates.length;
        if (lineSpec?.kind === "single") return count + 1;
        return count + extractExplicitDates(value, meta.termYear).length;
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
        const explicitDates =
          lineSpec?.kind === "dates"
            ? lineSpec.dates
            : lineSpec?.kind === "single"
            ? [lineSpec.date]
            : extractExplicitDates(sanitizedValueForDates, meta.termYear);
        const availabilityWindow =
          explicitDates.length === 2 &&
          /\bto\b/i.test(sanitizedValueForDates) &&
          /(assignment|quiz|midterm|term test|test|exam)/i.test(prefix || label);
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
  const weekIndex = lowerHeaders.findIndex((header) => header.includes("week"));
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
      header.includes("content")
  );
  const assessmentDueIndex = lowerHeaders.findIndex(
    (header) => header.includes("assessment") && header.includes("due")
  );
  const assignmentIndexes = lowerHeaders
    .map((header, index) => ({ header, index }))
    .filter(
      ({ header }) =>
        header.includes("assignment") ||
        header.includes("deliverable") ||
        (header.includes("project") && header.includes("due"))
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

  rows.forEach((row) => {
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
    const rowDates =
      normalizedDateSourceText
        ? extractExplicitDates(normalizedDateSourceText, meta.termYear)
        : [];

    let dateSpec =
      startIndex !== -1 && endIndex !== -1
        ? {
            kind: "range" as const,
            startDate: parseFlexibleDate(row[startIndex], meta.termYear),
            endDate: parseFlexibleDate(row[endIndex], meta.termYear),
          }
        : parseDateSpec(normalizedDateSourceText, meta.termYear);

    if (dateSpec?.kind === "range" && dateSpec.startDate && dateSpec.endDate && Number.isFinite(weekNumber)) {
      weekWindows.set(weekNumber, {
        startDate: dateSpec.startDate,
        endDate: dateSpec.endDate,
      });
    }

    const topic = normalizeWhitespace(row[topicIndex]);
    const topicEntries = row[topicIndex]
      ?.split(/\n+/)
      .map((entry) => normalizeWhitespace(entry))
      .filter(Boolean) ?? [];
    topicEntries.forEach((entry, index) => {
      const assessmentLabel = extractAssessmentLabelFromText(entry);
      if (!assessmentLabel) return;
      if (
        /\b\d+\s*:\s*.*\b(?:test|quiz|mid-?term|midterm|term test|endterm)\b/i.test(entry) &&
        !/^\s*(?:test|quiz|mid-?term|midterm|term test|endterm)\b/i.test(entry)
      ) {
        return;
      }
      const explicitDates = extractExplicitDates(entry, meta.termYear);
      const exactDate =
        explicitDates[0] ??
        (rowDates.length === topicEntries.length ? rowDates[index] : undefined) ??
        resolveWeekTableAssessmentDate(entry, rowDates, dateSpec);
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
              exactDates: [dateSpec.date],
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
          const topicDates = extractExplicitDates(topic, meta.termYear);
          const exactDate =
            topicDates[0] ?? resolveWeekTableAssessmentDate(topic, rowDates, dateSpec);
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
          extractAssessmentLabelFromText(entry) ?? extractProseDeliverableLabel(entry);
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
      [assessmentDueIndex, ...assignmentIndexes].filter((index) => index !== -1)
    );
    assignmentLikeIndexes.forEach((index) => {
      const rawCell = row[index];
      const normalizedCell = normalizeWhitespace(rawCell);
      if (!normalizedCell || /^none$/i.test(normalizedCell)) return;

      const dueEntries = rawCell
        .split(/\n+/)
        .map((entry) => normalizeWhitespace(entry))
        .filter(Boolean)
        .reduce<string[]>((entries, line) => {
          if (
            entries.length > 0 &&
            (/^\(/.test(line) ||
              /^(?:due\b|available from\b|opens?\b|closes?\b|submitted?\b|deadline\b)/i.test(
                line
              ))
          ) {
            entries[entries.length - 1] = normalizeWhitespace(
              `${entries[entries.length - 1]} ${line}`
            );
            return entries;
          }
          return [...entries, ...line.split(/\s*;\s*/).map((entry) => normalizeWhitespace(entry))];
        }, [])
        .filter(Boolean)
        .filter((entry) => !/^none$/i.test(entry));
      const defaultWeekday =
        extractRelativeWeekdayCode(`${headers[index]} ${normalizedCell}`) ??
        extractRelativeWeekdayCode(headers[index]);

      dueEntries.forEach((entry) => {
        const entrySpec = parseDateSpec(entry, meta.termYear);
        const explicitDates =
          entrySpec?.kind === "single"
            ? [entrySpec.date]
            : entrySpec?.kind === "dates"
            ? entrySpec.dates
            : extractDeadlineAnchoredDates(entry, meta.termYear);
        const resolvedOccurrences =
          explicitDates.length > 0
            ? explicitDates.map((date) => ({ date }))
            : dateSpec?.kind === "single"
            ? [
                {
                  date: defaultWeekday
                    ? inferDateFromAnchorAndWeekday(dateSpec.date, defaultWeekday)
                    : dateSpec.date,
                },
              ]
            : dateSpec?.kind === "range" && dateSpec.startDate
            ? [
                {
                  date: defaultWeekday
                    ? inferDateFromAnchorAndWeekday(dateSpec.startDate, defaultWeekday)
                    : dateSpec.startDate,
                },
              ]
            : [];
        const { startTime, endTime } = parseTimeRange(entry);
        const assignmentLabel =
          assignmentLabelFromText(entry) ??
          extractProseDeliverableLabel(entry) ??
          (/^a\s*\d+\b/i.test(entry) ? assignmentLabelFromText(entry) : undefined);
        if (assignmentLabel && assessmentTypeFromLabel(assignmentLabel, normalizedCell) !== "Assessment") {
          if (resolvedOccurrences.length === 0) {
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
            return;
          }

          resolvedOccurrences.forEach((occurrence) => {
            assessments.push({
              label: assignmentLabel,
              eventType: "Assignment",
              date: occurrence.date,
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
          return;
        }

        const assessmentLabel = extractAssessmentLabelFromText(entry);
        if (assessmentLabel && !isFinalExamLabel(assessmentLabel)) {
          if (resolvedOccurrences.length === 0) {
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
            return;
          }

          resolvedOccurrences.forEach((occurrence) => {
            assessments.push({
              label: assessmentLabel,
              eventType: "Assessment",
              date: occurrence.date,
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
        }
      });
    });

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
          return [...entries, ...line.split(/\s*;\s*/).map((entry) => normalizeWhitespace(entry))];
        }, [])
        .filter(Boolean);

      cellEntries.forEach((entry) => {
        const explicitDates = extractExplicitDates(entry, meta.termYear);
        const entryHasDateCue =
          explicitDates.length > 0 ||
          /\b(?:due|deadline|available|opens?|closes?|scheduled|presentation|seminar|tutorial problem)\b/i.test(
            entry
          );
        if (!entryHasDateCue) return;

        const entryLabel =
          extractAssessmentLabelFromText(entry) ??
          extractProseDeliverableLabel(entry) ??
          labelFromScheduleEntry(entry);
        if (!entryLabel || isFinalExamLabel(entryLabel)) return;

        const eventType = assessmentTypeFromLabel(entryLabel, `${entry} ${normalizedCell}`);
        if (eventType === "Other") return;

        const resolvedOccurrences =
          explicitDates.length > 0
            ? explicitDates.map((date) => ({ date }))
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
      const exactDate =
        parseSlashDate(notesCell, meta.termYear) ??
        extractExplicitDates(notesCell, meta.termYear)[0];
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
    const rowAssessmentDates = extractDeadlineAnchoredDates(rowText, meta.termYear);
    const nonAnchoredExplicitRowDate = extractExplicitDates(rowText, meta.termYear).find(
      (date) => date !== anchoredRowDate
    );
    const resolvedRowAssessmentDate =
      rowAssessmentDates.find((date) => date !== anchoredRowDate) ??
      nonAnchoredExplicitRowDate ??
      anchoredRowDate;
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
        allDay: resolvedRowAssessmentDate === anchoredRowDate,
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
  const dateIndex = lowerHeaders.findIndex((header) => header.includes("date"));
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
      const entries = (contentIsNarrative
        ? extractScheduleAssessmentEntries(content)
        : expandScheduleEntries(content)
      ).filter((entry) => !isRoutineScheduleEntry(entry));

      entries.forEach((entry) => {
        if (contentIsNarrative && !hasDirectDeadlineCue(entry)) return;
        const label = labelFromScheduleEntry(entry);
        if (!label || /^[-–—]+$/.test(label)) return;
        if (isFinalExamLabel(label)) return;

        const explicitDates = extractDeadlineAnchoredDates(entry, meta.termYear);
        const dueWeekday = explicitDates.length === 0 ? extractRelativeWeekdayCode(entry) : undefined;
        const rowLocation = locationFromRowText(`${entry} | ${rowText}`);
        const eventType = assessmentTypeFromLabel(label, rowLocation);
        if (eventType === "Other") return;

        const pushSeed = (date?: string, sectionOptionIds?: string[]) => {
          assessments.push({
            label,
            eventType,
            date,
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
              : undefined
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
    (header) => header.includes("class activity") || /^activity$/.test(header) || header.includes("activity")
  );
  const sessionIndexes = lowerHeaders
    .map((header, index) => ({ header, index }))
    .filter(({ header }) => header.includes("session"))
    .map(({ index }) => index);
  const startIndex = lowerHeaders.findIndex((header) => header.includes("start"));
  const dueIndex = lowerHeaders.findIndex((header) => header.includes("due"));
  const weightIndex = lowerHeaders.findIndex((header) => header.includes("weight"));

  if (dueIndex === -1) return [] as AssessmentSeed[];

  return rows
    .map((row) => {
      const rawLabel = normalizeWhitespace(row[assignmentIndex === -1 ? 0 : assignmentIndex]);
      const activityText = normalizeWhitespace(row[activityIndex]);
      const sessionText = normalizeWhitespace(
        sessionIndexes
          .map((index) => row[index])
          .map((value) => normalizeWhitespace(value))
          .filter(Boolean)
          .join(" ")
      );
      const label = (() => {
        if (assignmentIndex !== -1 && rawLabel && !/^\d+$/.test(rawLabel)) {
          return rawLabel;
        }
        if (activityText) {
          const quizNumber = activityText.match(/\bquiz\s*0*(\d+)\b/i)?.[1];
          if (/practice exercise/i.test(activityText) && quizNumber) {
            return `Practice Exercise Quiz #${Number(quizNumber)}`;
          }
          return capitalizeAssignmentText(activityText);
        }
        if (sessionText && !/^\d+$/.test(sessionText)) {
          return capitalizeAssignmentText(sessionText);
        }
        return rawLabel;
      })();
      const startDate =
        parseDateSpec(row[startIndex], meta.termYear)?.kind === "single"
          ? (parseDateSpec(row[startIndex], meta.termYear) as { kind: "single"; date: string }).date
          : undefined;
      const dueDate =
        parseDateSpec(row[dueIndex], meta.termYear)?.kind === "single"
          ? (parseDateSpec(row[dueIndex], meta.termYear) as { kind: "single"; date: string }).date
          : undefined;
      const weight = normalizeWeightText(row[weightIndex]);
      if (!label || !dueDate) return undefined;

      return {
        label,
        eventType: "Assignment" as const,
        date: dueDate,
        allDay: true,
        location: assignmentLocationFromContext(
          [row[startIndex], row[dueIndex], row[activityIndex], section.text]
            .map((value) => normalizeWhitespace(value))
            .filter(Boolean)
            .join(" ")
        ),
        notes: combineNotes(
          startDate ? [`Available from ${startDate}`] : [],
          weight ? [`Weight: ${weight}`] : []
        ),
        weight,
        confidence: "high" as const,
        provenance: [makeProvenance(section, "table", row.join(" | "))],
      };
    })
    .filter(Boolean) as AssessmentSeed[];
}

function baseLabelFromDueHeader(header: string) {
  const normalized = trimTrailingPeriods(
    normalizeWhitespace(header)
      .replace(/\b(?:due dates?|due date|deadlines?|dates?)\b/gi, "")
      .replace(/\bcoverage\b/gi, "")
      .replace(/\bpre[- ]lab\b/gi, "Pre-Lab")
      .replace(/\bpost[- ]lab\b/gi, "Post-Lab")
      .replace(/\s+/g, " ")
  );

  if (!normalized || /^date$/i.test(normalized)) return undefined;
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

function parseActivityDueColumnsTable(
  section: SectionBlock,
  rows: string[][],
  headers: string[],
  meta: OutlineMeta
) {
  const lowerHeaders = headers.map((header) => header.toLowerCase());
  const rowDateIndex = lowerHeaders.findIndex((header) => /^date|dates/.test(header));
  const dueIndexes = lowerHeaders
    .map((header, index) => ({ header, index }))
    .filter(
      ({ header, index }) =>
        index !== rowDateIndex &&
        /(due|deadline|\bquiz(?:\s*coverage)?\b|\btest\b|\bexam\b)/.test(header) &&
        !/(start|end|location|submission|weight|value|worth|percentage|percent)/.test(header)
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

      const dueSpec = parseDateSpec(dueText, meta.termYear);
      const dueDates =
        dueSpec?.kind === "single"
          ? [dueSpec.date]
          : dueSpec?.kind === "dates"
          ? dueSpec.dates
          : extractExplicitDates(dueText, meta.termYear);
      if (dueDates.length === 0) return;

      const sequence = (sequenceByColumn.get(index) ?? 0) + 1;
      sequenceByColumn.set(index, sequence);

      const headerLabel = baseLabelFromDueHeader(headers[index]);
      const activityLabel =
        extractProseDeliverableLabel(activityText) ?? labelFromScheduleEntry(activityText);
      const dueLabel =
        extractAssessmentLabelFromText(dueText) ??
        extractProseDeliverableLabel(dueText) ??
        labelFromScheduleEntry(dueText);
      const baseLabel = dueLabel || headerLabel || activityLabel || "Assignment";
      const needsNumber =
        !/#\s*\d+\b/.test(baseLabel) &&
        /(assignment|report|quiz|exercise|worksheet|reflection|presentation|paper)/i.test(
          baseLabel
        );
      const label = needsNumber ? `${baseLabel} #${sequence}` : baseLabel;
      const location = assignmentLocationFromContext(
        [dueText, activityText, section.text].join(" ")
      );

      dueDates.forEach((date) => {
        seeds.push({
          label,
          eventType:
            assessmentTypeFromLabel(label, location) === "Assessment"
              ? "Assessment"
              : "Assignment",
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

  sections.forEach((section) => {
    const tables = section.elements.flatMap((element) =>
      Array.from(element.querySelectorAll("table"))
    ) as HTMLTableElement[];

    tables.forEach((table) => {
      const matrix = tableToRows(table);
      if (matrix.length === 0) return;
      const headerIndex = findHeaderRow(matrix);
      const headers = matrix[headerIndex].map((header) => normalizeWhitespace(header));
      const rows = matrix.slice(headerIndex + 1).filter((row) => row.some((cell) => cell.trim().length > 0));
      const headerText = headers.join(" | ").toLowerCase();

      if (headerText.includes("start date") && headerText.includes("due date")) {
        assessments.push(...parseAssignmentStartDueTable(section, rows, headers, meta));
        return;
      }

      if (
        !headerText.includes("start date") &&
        !headerText.includes("week") &&
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
        /(component|assessment|activity|evaluation)/.test(headerText) &&
        /(value|weight|worth|percentage|percent)/.test(headerText) &&
        !/(date|due date|start date|location|submission)/.test(headerText)
      ) {
        assessmentWeights.push(...parseAssessmentWeightTable(section, rows, headers));
        return;
      }

      if (
        headerText.includes("date") &&
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
        headerText.includes("week") &&
        (headerText.includes("topic") ||
          headerText.includes("module") ||
          headerText.includes("content") ||
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

function parseRelevantProse(
  sections: SectionBlock[],
  meta: OutlineMeta,
  weekWindows: Map<number, WeekWindow>
) {
  const assessments: AssessmentSeed[] = [];
  const attachments: TopicAttachment[] = [];
  const exclusions: ExclusionWindow[] = [];

  sections
    .filter((section) => RELEVANT_PROSE_SECTIONS.has(section.id))
    .forEach((section) => {
      const blocks = section.elements.flatMap((element) =>
        Array.from(element.querySelectorAll("p, li"))
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

        proseEntries.forEach((entry) => {
          if (isAssessmentPolicyNoise(entry) || /^tentative$/i.test(entry)) return;

          const entryProvenance = [makeProvenance(section, "prose", entry)];
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

          const explicitDates = extractDeadlineAnchoredDates(entry, meta.termYear);
          const contextualPresentationDates =
            /\bpresented in class on\b/i.test(entry) || /\bpresentation(?:s)?\b.*\bon\b/i.test(entry)
              ? extractExplicitDates(entry, meta.termYear)
              : [];
          const dateSpec = parseDateSpec(entry, meta.termYear);
          const resolvedDates =
            explicitDates.length > 0
              ? explicitDates
            : dateSpec?.kind === "single"
              ? [dateSpec.date]
            : dateSpec?.kind === "dates"
              ? dateSpec.dates
            : contextualPresentationDates.length > 0
              ? contextualPresentationDates
            : [];
          const { startTime, endTime } = parseTimeRange(entry);
          const location = extractStructuredLocation(entry, true) || undefined;
          const weight = extractWeightFromText(entry);
          const assessmentLabel = extractAssessmentLabelFromText(entry);
          const deliverableLabel = extractProseDeliverableLabel(entry);
          const preferredLabel =
            deliverableLabel &&
            assessmentTypeFromLabel(deliverableLabel, location) !== "Assessment"
              ? deliverableLabel
              : assessmentLabel ??
                deliverableLabel ??
                (contextualPresentationDates.length > 0
                  ? canonicalizeProseDeliverableLabel(entry, entry)
                  : undefined);

          if (!preferredLabel || isFinalExamLabel(preferredLabel)) {
            return;
          }

          const inferredEventType = assessmentTypeFromLabel(preferredLabel, location);
          const eventType =
            assessmentLabel && inferredEventType === "Other"
              ? ("Assessment" as const)
              : inferredEventType === "Other"
              ? ("Assignment" as const)
              : inferredEventType;
          const unresolvedByRegistrar =
            eventType === "Assessment" &&
            /registrar|scheduled by the registrar|exam period|to be announced|tbd/i.test(
              entry
            );

          if (
            eventType === "Assignment" &&
            resolvedDates.length >= 2 &&
            /\b(?:available|opens?|posted)\b/i.test(entry) &&
            /\bdue\b/i.test(entry)
          ) {
            const dueDate = resolvedDates[resolvedDates.length - 1];
            assessments.push({
              label: preferredLabel,
              eventType,
              date: dueDate,
              allDay: !startTime,
              startTime,
              endTime,
              location:
                location ||
                assignmentLocationFromContext(section.text),
              notes: combineNotes(
                [entry, `Available from ${resolvedDates[0]}`],
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
              assessments.push({
                label:
                  resolvedDates.length > 1
                    ? numberedAssessmentSeriesLabel(
                        preferredLabel,
                        index,
                        resolvedDates.length
                      )
                    : preferredLabel,
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
                notes: combineNotes([entry], weight ? [`Weight: ${weight}`] : []),
                weight,
                confidence: confidenceFromSeed({ date, startTime, endTime, location }),
                provenance: entryProvenance,
                replaceMeetingType:
                  eventType === "Assessment" && /in class|lecture/i.test(entry)
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
                [`Date unresolved in outline: ${entry}`],
                weight ? [`Weight: ${weight}`] : []
              ),
              weight,
              confidence: "low",
              provenance: entryProvenance,
            });
          }
        });

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
        endDate: termBounds.endDate,
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
    /\bmidterm\b/i.test(event.label) &&
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
    extractExplicitDates(text, year ?? new Date().getFullYear()).forEach((date) =>
      explicit.add(date)
    );
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

function mergedLabelScore(label: string) {
  let score = 0;
  if (!/#\s*\d+\b/.test(label)) score += 4;
  if (!/\b(best|total|through separate|see details|shared grade|individual grade)\b/i.test(label)) {
    score += 3;
  }
  if (!/[()]/.test(label)) score += 2;
  score -= label.length * 0.01;
  return score;
}

function preferredMergedLabel(primaryLabel: string, secondaryLabel: string) {
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
  if (/\bterm test\b/.test(normalized)) return "term test";
  if (/\bquiz\b/.test(normalized)) return "quiz";
  if (/\btest\b/.test(normalized)) return "test";
  if (/\bexam\b/.test(normalized)) return "exam";
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
    const existing = deduped.find((candidate) => {
      if (
        candidate.eventType !== "Assessment" ||
        candidate.timing.kind !== "single" ||
        candidate.courseId !== event.courseId ||
        canonicalAssessmentFamily(candidate.label) !== family
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
        [...candidateSections].some((sectionId) => eventSections.has(sectionId));

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

      const sameWindow =
        Math.abs(
          differenceInCalendarDays(
            parseISO(candidate.timing.date),
            parseISO(event.timing.date)
          )
        ) <= 2;
      if (!sameWindow) return false;

      const candidateScore =
        candidate.eventType === "Assignment"
          ? assignmentDeduplicationScore(candidate)
          : assessmentDeduplicationScore(candidate);
      const eventScore =
        event.eventType === "Assignment"
          ? assignmentDeduplicationScore(event)
          : assessmentDeduplicationScore(event);
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
      return (
        candidateSections.size === 0 ||
        eventSections.size === 0 ||
        [...candidateSections].some((sectionId) => eventSections.has(sectionId))
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

function hasStrongAssessmentCue(label: string) {
  return /\b(?:online\s+quiz|quiz|knowledge check|midterm|mid-term|term test|test|exam|endterm)\b/i.test(
    normalizeAssessmentLabel(label)
  );
}

function normalizeAssessmentEventTypes(events: EventCandidate[]) {
  return events.map((event) => {
    if (
      event.eventType === "Assignment" &&
      hasStrongAssessmentCue(event.label)
    ) {
      const eventDate = event.timing.kind === "single" ? event.timing.date : undefined;
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
      const eventDate = event.timing.kind === "single" ? event.timing.date : undefined;
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
  if (/\s+-\s+(?:submission|peer review|feedback)\b/i.test(label)) {
    return null;
  }
  const context = normalizeWhitespace(
    [label, ...event.notes, ...event.provenance.map((item) => item.snippet)].join(" ")
  );

  const numberText =
    label.match(/reading assignment\s*#?\s*(\d+)/i)?.[1] ??
    label.match(/assignment\s*week\s*(\d+)/i)?.[1] ??
    label.match(/\bweek\s*(\d+)\b/i)?.[1] ??
    label.match(/assignment\s*#?\s*(\d+)/i)?.[1] ??
    label.match(/#\s*(\d+)/)?.[1] ??
    label.match(/\b(\d+)\s*$/)?.[1];

  if (!numberText) return null;

  let seriesName = "Assignments";
  if (/reading assignment/i.test(context)) {
    seriesName = "Reading Assignments";
  } else if (/assignment\s*week/i.test(label) && /connect/i.test(event.location)) {
    seriesName = "Reading Assignments";
  } else {
    const prefix =
      trimTrailingPeriods(
        label
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
    seriesKey: `${event.courseId}:${seriesName.toLowerCase()}:${event.location.toLowerCase()}`,
  };
}

function assignmentRangeLabel(
  seriesName: string,
  startNumber: number,
  endNumber: number,
  recurring = false
) {
  const displaySeriesName =
    startNumber === endNumber
      ? singularizeGenericSeriesLabel(seriesName)
      : normalizeWhitespace(seriesName);
  const range =
    startNumber === endNumber ? `#${startNumber}` : `#${startNumber}-${endNumber}`;
  return recurring
    ? `Weekly ${displaySeriesName} ${range}`
    : `${displaySeriesName} ${range}`;
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
          bucket.endNumber
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

      if (runEnd > runStart) {
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
            everyWeek
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
  if (/knowledge check$/i.test(normalized)) {
    return normalized.replace(/knowledge check$/i, "Knowledge Checks");
  }
  if (/quiz$/i.test(normalized)) {
    return normalized.replace(/quiz$/i, "Quizzes");
  }
  if (/assignment$/i.test(normalized)) {
    return normalized.replace(/assignment$/i, "Assignments");
  }
  if (/report$/i.test(normalized)) {
    return normalized.replace(/report$/i, "Reports");
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
  return cleanGenericSeriesStem(label)
    .replace(/\bKnowledge Checks\b/gi, "Knowledge Check")
    .replace(/\bQuizzes\b/gi, "Quiz")
    .replace(/\bAssignments\b/gi, "Assignment")
    .replace(/\bReports\b/gi, "Report")
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

export function parseOutlineHtml(html: string, outlineName: string): OutlineParseResult {
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

  const tableData = parseTables(sections, meta, scheduleData.sectionOptions);
  const proseData = parseRelevantProse(sections, meta, tableData.weekWindows);
  const structuredOfficeHourTableSeeds = parseStructuredOfficeHourTables(
    sections,
    meta,
    scheduleData.meetings
  );
  const structuredOfficeHourTableSectionIds = new Set(
    structuredOfficeHourTableSeeds.flatMap((seed) =>
      seed.provenance.map((entry) => entry.sectionId).filter(Boolean)
    )
  );
  const structuredOfficeHourLineSeeds = parseStructuredOfficeHourLines(
    sections,
    meta,
    scheduleData.meetings
  ).filter(
    (seed) =>
      !seed.provenance.some((entry) =>
        structuredOfficeHourTableSectionIds.has(entry.sectionId)
      )
  );
  const structuredOfficeHourSectionIds = new Set(
    [...structuredOfficeHourTableSeeds, ...structuredOfficeHourLineSeeds].flatMap((seed) =>
      seed.provenance.map((entry) => entry.sectionId).filter(Boolean)
    )
  );
  const structuredOfficeHourLineSectionIds = new Set(
    structuredOfficeHourLineSeeds.flatMap((seed) =>
      seed.provenance.map((entry) => entry.sectionId).filter(Boolean)
    )
  );
  const inlineInstructionalOfficeHourSeeds = parseInlineInstructionalTeamOfficeHours(
    sections,
    meta,
    scheduleData.meetings
  ).filter(
    (seed) =>
      !seed.provenance.some(
        (entry) =>
          structuredOfficeHourSectionIds.has(entry.sectionId) ||
          structuredOfficeHourLineSectionIds.has(entry.sectionId)
      )
  );
  const officeHourSeeds = dedupeOfficeHourSeeds([
    ...structuredOfficeHourTableSeeds,
    ...structuredOfficeHourLineSeeds,
    ...parseOfficeHours(sections, meta, scheduleData.meetings),
    ...inlineInstructionalOfficeHourSeeds,
  ]);
  const termBounds =
    computeTermBounds(scheduleData.meetings) ?? computeFallbackTermBounds(sections, meta);

  let meetingEvents = mergeMeetingSinglesIntoRecurring(
    compactMeetingSinglesIntoRecurring(createMeetingEvents(course, scheduleData.meetings))
  );
  meetingEvents = applyAttachmentsAndExclusions(
    meetingEvents,
    [...tableData.attachments, ...proseData.attachments],
    [...tableData.exclusions, ...proseData.exclusions]
  );

  const officeHourEvents = createOfficeHourEvents(course, officeHourSeeds, termBounds);
  const assessmentResult = createAssessmentEvents(
    course,
    scheduleData.meetings,
    [...tableData.assessments, ...proseData.assessments],
    meetingEvents,
    tableData.assessmentWeights
  );
  const normalizedAssessmentEvents = normalizeAssessmentEventTypes(
    assessmentResult.assessmentEvents
  );
  const compactedAssessmentEvents = dropShadowedSummaryEvents(
    dropShadowedGenericTimedSummaryEvents(
      dropShadowedTentativePlanEvents(
        dedupeEquivalentAssessments(
          compactGenericWeeklySeries(
            compactRecurringAssessmentSeries(
              compactAssignmentSeries(
                mergeAssessmentWindowPairs(dedupeEquivalentAssignments(dedupeMidterms(normalizedAssessmentEvents)))
              )
            )
          )
        )
      )
    )
  );
  const mergedEvents = mergeLabAssessmentsIntoLabEvents([
    ...assessmentResult.meetingEvents,
    ...officeHourEvents,
    ...compactedAssessmentEvents,
  ]);

  const events = applyCalendarTitles(
    course,
    dedupeEvents(mergedEvents).map((event) => ({
      ...event,
      label:
        event.eventType === "Assessment"
          ? normalizeAssessmentLabel(
              event.label,
              event.timing.kind === "single" ? event.timing.date : undefined
            )
          : event.eventType === "Assignment" || event.eventType === "Other"
          ? normalizeAssignmentLabel(
              event.label,
              event.timing.kind === "single" ? event.timing.date : undefined
            )
          : event.label,
      reviewNeeded: reviewNeededForEvent(event) || event.reviewNeeded,
      include: event.include && !reviewNeededForEvent(event),
    }))
  );

  course.eventIds = events.map((event) => event.id);
  course.officeHourEventIds = officeHourEvents.map((event) => event.id);

  if (events.length === 0) {
    course.warnings.push("No calendar-ready events were detected in this outline.");
  }
  if (scheduleData.sectionOptions.length === 0) {
    course.warnings.push("No section options were detected from the schedule table.");
  }

  return { course, events };
}
