const fs = require("node:fs/promises");
const path = require("node:path");
const { JSDOM } = require("jsdom");
const { eachDayOfInterval, format, getDay, isValid, parse, parseISO } = require("date-fns");
const { parseOutlineHtml } = require("../tmp-parser-bundle.cjs");

const rootArg = process.argv[2];
const labelArg = process.argv[3];
const subjectsArg = process.argv[4] ?? "";

if (!rootArg) {
  console.error(
    "Usage: node scripts/run-outline-slice-audit.cjs <rootDir> <label> [comma-separated-subjects]"
  );
  process.exit(1);
}

const ROOT_DIR = path.resolve(rootArg);
const LABEL = (labelArg || path.basename(ROOT_DIR))
  .toLowerCase()
  .replace(/[^a-z0-9]+/g, "-")
  .replace(/^-+|-+$/g, "");
const SUBJECTS = subjectsArg
  .split(",")
  .map((value) => value.trim())
  .filter(Boolean);
const OUTPUT_DIR = path.resolve("all_outlines_2024_to_2026/audits");
const COMPARISON_PATH = path.join(OUTPUT_DIR, `${LABEL}-date-comparison.json`);
const AUDIT_PATH = path.join(OUTPUT_DIR, `${LABEL}-audit.json`);

const dom = new JSDOM("");
global.DOMParser = dom.window.DOMParser;

const MONTH_FORMATS = [
  "MMMM d yyyy",
  "MMMM d, yyyy",
  "MMM d yyyy",
  "MMM d, yyyy",
  "MMMM d",
  "MMM d",
  "d MMMM yyyy",
  "d MMM yyyy",
];

const WEEKDAY_CODES = {
  SU: 0,
  MO: 1,
  TU: 2,
  WE: 3,
  TH: 4,
  FR: 5,
  SA: 6,
};

const EVENT_KEYWORDS =
  /\b(lecture|lectures|tutorial|tutorials|lab|labs|seminar|office hours|student hours|assignment|assignments|quiz|quizzes|midterm|term test|test|exam|paper|report|reports|reflection|project|presentation|check-?in|workbook|workshop|session|proposal|due|submit|submission|presentation file|dropbox)\b/i;

const EXCLUDED_KEYWORDS =
  /\b(final exam|final examination|exam period|registrar|published|last updated|copyright|policy|citation|doi|reading week|no class|no lectures|no labs|booked appointments|by appointment|tbd|to be determined|per agreed upon schedule|refer to website|posted on edx|roughly biweekly|weekly\b(?!.*(?:quiz|assignment|lecture|tutorial|lab|office hours|student hours|paper|report|reflection|workbook|check-?in))|classes begin|class begins|classes end|class ends)\b/i;

const DATE_PATTERN =
  /\b(?:(Mon(?:day)?|Tue(?:s(?:day)?)?|Wed(?:nesday)?|Thu(?:r(?:s(?:day)?)?)?|Fri(?:day)?|Sat(?:urday)?|Sun(?:day)?),?\s+)?((?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:t|tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\.?\s+\d{1,2}(?:st|nd|rd|th)?(?:,\s*\d{4})?|\d{1,2}\s+(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:t|tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)(?:\s+\d{4})?|\d{1,2}\/\d{1,2}(?:\/\d{2,4})?|\d{4}-\d{2}-\d{2})\b/g;

const WEEKDAY_PATTERN =
  /\b(mon(?:day)?s?|tue(?:s(?:day)?)?s?|wed(?:nesday)?s?|thu(?:r(?:s(?:day)?)?)?s?|fri(?:day)?s?|sat(?:urday)?s?|sun(?:day)?s?)\b/i;

const TIME_RANGE_PATTERN =
  /\b\d{1,2}(?::\d{2})?\s*(?:a\.?m?\.?|p\.?m?\.?)?\s*(?:-|–|—|to|--)\s*\d{1,2}(?::\d{2})?\s*(?:a\.?m?\.?|p\.?m?\.?)?\b/i;

const GENERIC_ASSESSMENT_LABELS = new Set([
  "assessment",
  "exam",
  "midterm",
  "quiz",
  "quizzes",
  "term test",
  "test",
  "tests",
]);

const GENERIC_ASSIGNMENT_LABELS = new Set([
  "assignment",
  "assignments",
  "deliverable",
  "paper",
  "papers",
  "project",
  "proposal",
  "reflection",
  "report",
  "reports",
  "submission",
  "workbook",
]);

function normalizeWhitespace(value) {
  return (value ?? "")
    .replace(/&nbsp;|&#160;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/\u00a0/g, " ")
    .replace(/[\u200b-\u200d\ufeff\u2060\u00ad]/g, "")
    .replace(/[ \t]+/g, " ")
    .replace(/\s*\n\s*/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function htmlToLines(html) {
  return normalizeWhitespace(
    html
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<\/p>/gi, "\n")
      .replace(/<\/li>/gi, "\n")
      .replace(/<li[^>]*>/gi, "\n")
      .replace(/<\/tr>/gi, "\n")
      .replace(/<\/td>/gi, "\n")
      .replace(/<\/th>/gi, "\n")
      .replace(/<[^>]+>/g, " ")
  )
    .split("\n")
    .map((line) => normalizeWhitespace(line))
    .filter(Boolean);
}

function inferYearFromFileName(fileName) {
  const matchedYear = fileName.match(/(20\d{2})/)?.[1];
  return matchedYear ? Number(matchedYear) : new Date().getFullYear();
}

function parseDateToken(token, fallbackYear) {
  const normalized = normalizeWhitespace(token)
    .replace(/\b(\d{1,2})(st|nd|rd|th)\b/gi, "$1")
    .replace(/\s+/g, " ")
    .replace(/\.$/g, "");

  if (/^\d{4}-\d{2}-\d{2}$/.test(normalized)) {
    return normalized;
  }

  const withFallbackYear = /\b20\d{2}\b/.test(normalized)
    ? normalized
    : `${normalized} ${fallbackYear}`;

  for (const formatPattern of MONTH_FORMATS) {
    const parsed = parse(withFallbackYear, formatPattern, new Date(fallbackYear, 0, 1));
    if (isValid(parsed)) {
      return format(parsed, "yyyy-MM-dd");
    }
  }

  if (/^\d{1,2}\/\d{1,2}(?:\/\d{2,4})?$/.test(normalized)) {
    const [month, day, year] = normalized.split("/");
    const resolvedMonth = Number(month);
    const resolvedDay = Number(day);
    if (
      !Number.isFinite(resolvedMonth) ||
      !Number.isFinite(resolvedDay) ||
      resolvedMonth < 1 ||
      resolvedMonth > 12 ||
      resolvedDay < 1 ||
      resolvedDay > 31
    ) {
      return undefined;
    }
    const resolvedYear = year ? Number(year.length === 2 ? `20${year}` : year) : fallbackYear;
    const parsed = new Date(resolvedYear, resolvedMonth - 1, resolvedDay);
    if (
      isValid(parsed) &&
      parsed.getFullYear() === resolvedYear &&
      parsed.getMonth() === resolvedMonth - 1 &&
      parsed.getDate() === resolvedDay
    ) {
      return format(parsed, "yyyy-MM-dd");
    }
  }

  return undefined;
}

function extractDatesFromText(text, fallbackYear) {
  return Array.from(text.matchAll(DATE_PATTERN))
    .map((match) => parseDateToken(match[2], fallbackYear))
    .filter(Boolean);
}

function isAncillaryDateLine(line) {
  const normalized = normalizeWhitespace(line);
  return (
    (/^(?=.*;)(?=.*\(\d{1,2}\/\d{1,2}\))(?!.*\b(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec|Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)\b)/i.test(
      normalized
    )) ||
    /^https?:\/\//i.test(normalized) ||
    /https?:\/\//i.test(normalized) ||
    /\b(?:e\.g\.|for example)\b/i.test(normalized) ||
    /^\s*\d+\/\d+\s*=/.test(normalized) ||
    /\b\d+\.\d+\/\d+(?:\.\d+)?\b/.test(normalized) ||
    /\b\d+\/\d+\s*\*/.test(normalized) ||
    /\b\d+\/\d+\s+of\b/i.test(normalized) ||
    /\bmodule\s+\d+\/\d+\b/i.test(normalized) ||
    /\b(?:Labs?|Tutorial Problems?)\s+\d+\/\d+\b/i.test(normalized) ||
    /\bcapped at\s+\d+\/\d+\b/i.test(normalized) ||
    /\bdeduction of\s+\d+\/\d+\b/i.test(normalized) ||
    /\bgrace period\b/i.test(normalized) ||
    /\blate submissions?\b|\bsubmissions? (?:received|submitted) after\b|\blast day to submit\b|\bwill not be accepted\b/i.test(
      normalized
    ) ||
    /\bif you miss\b/i.test(normalized) ||
    /\balternative\b.*\bopportunity\b/i.test(normalized) ||
    /\bmake-?up assignment days?\b/i.test(normalized) ||
    /\bthe following make-?up days have been scheduled\b/i.test(normalized) ||
    /\bloss of a [a-z]+ class on\b.*\bwill be made up on\b/i.test(normalized) ||
    /\bwill be emailed to the class\b/i.test(normalized) ||
    /\bstarting the week of\b|\bduring your regular lab time\b|\bweek of\b/i.test(normalized) ||
    /\bweek n\b.*\bweek n\+1\b.*\bexception:/i.test(normalized) ||
    /\bmobius assignments?\b.*\bexception:.*\bweek 1\b/i.test(normalized) ||
    /\bexam schedule released\b|\btime zone\b|\btimezone\b/i.test(normalized) ||
    /^\s*optional:\s*/i.test(normalized) ||
    /\byou will receive one grade\b.*\binterim grade\b/i.test(normalized) ||
    /\binterim grade has no weight\b/i.test(normalized) ||
    /\bthe calendar lists when assessments will be available and when they are due\b/i.test(
      normalized
    ) ||
    /^(?:[A-Za-z]+\s+\d{1,2}\s*[-–]\s*[A-Za-z]+\s+\d{1,2}|[A-Za-z]+\s+\d{1,2}\s*-\s*\d{1,2})(?:,?\s+\d{4})?:.*\bdue\b.*\b(?:mondays?|tuesdays?|wednesdays?|thursdays?|fridays?|saturdays?|sundays?)\b/i.test(
      normalized
    )
  );
}

function extractRelevantSourceDates(lines, fallbackYear) {
  const entries = [];

  for (const line of lines) {
    if (!EVENT_KEYWORDS.test(line)) continue;
    if (EXCLUDED_KEYWORDS.test(line)) continue;
    if (isAncillaryDateLine(line)) continue;

    const dates = extractDatesFromText(line, fallbackYear);
    if (dates.length === 0) continue;

    entries.push({
      line,
      dates: Array.from(new Set(dates)),
    });
  }

  return entries;
}

function occurrenceDatesForEvent(event) {
  if (event.timing.kind === "single") {
    return event.timing.date ? [event.timing.date] : [];
  }

  const weekdayIndexes = event.timing.byDay
    .map((code) => WEEKDAY_CODES[code])
    .filter((value) => value !== undefined);
  const excluded = new Set(event.timing.exDates);
  const dates = [];

  for (const day of eachDayOfInterval({
    start: parseISO(event.timing.startDate),
    end: parseISO(event.timing.endDate),
  })) {
    const dateKey = format(day, "yyyy-MM-dd");
    if (weekdayIndexes.includes(getDay(day)) && !excluded.has(dateKey)) {
      dates.push(dateKey);
    }
  }

  return dates;
}

function collectParserKnownDates(parsed, fallbackYear) {
  const parserDates = new Set();

  parsed.events.forEach((event) => {
    occurrenceDatesForEvent(event).forEach((date) => parserDates.add(date));
    if (event.timing.kind === "single" && event.timing.endDate) {
      parserDates.add(event.timing.endDate);
    }
    if (event.timing.kind === "recurring") {
      event.timing.exDates.forEach((date) => parserDates.add(date));
    }
    event.notes
      .flatMap((note) => extractDatesFromText(note, fallbackYear))
      .forEach((date) => parserDates.add(date));

    if (event.timing.kind === "recurring") {
      Object.entries(event.timing.occurrenceNotes).forEach(([date, notes]) => {
        parserDates.add(date);
        notes
          .flatMap((note) => extractDatesFromText(note, fallbackYear))
          .forEach((noteDate) => parserDates.add(noteDate));
      });
    }
  });

  return parserDates;
}

function extractOfficeHoursHints(lines) {
  return lines.filter((line) => {
    if (!/\b(office hours|student hours)\b/i.test(line)) return false;
    if (/\bby appointment\b/i.test(line) && !TIME_RANGE_PATTERN.test(line)) return false;
    return TIME_RANGE_PATTERN.test(line) && WEEKDAY_PATTERN.test(line);
  });
}

function countExpectedOfficeHourDays(hints) {
  const patterns = [
    /\bmon(?:day)?s?\b/gi,
    /\btue(?:s(?:day)?)?s?\b/gi,
    /\bwed(?:nesday)?s?\b/gi,
    /\bthu(?:r(?:s(?:day)?)?)?s?\b/gi,
    /\bfri(?:day)?s?\b/gi,
    /\bsat(?:urday)?s?\b/gi,
    /\bsun(?:day)?s?\b/gi,
  ];

  return hints.reduce((total, hint) => {
    const normalized = normalizeWhitespace(hint)
      .replace(/\bMWF\b/gi, "Mon Wed Fri")
      .replace(/\bMW\b/gi, "Mon Wed")
      .replace(/\bWF\b/gi, "Wed Fri")
      .replace(/\bTTh\b/gi, "Tue Thu")
      .replace(/\bTuTh\b/gi, "Tue Thu")
      .replace(/\bT\/Th\b/gi, "Tue Thu");
    const count = patterns.filter((pattern) => pattern.test(normalized)).length;
    return total + count;
  }, 0);
}

function normalizeLabel(value) {
  return normalizeWhitespace(value).replace(/\s+/g, " ").trim();
}

function suspiciousEventNameReasons(event) {
  const reasons = [];
  const label = normalizeLabel(event.label);
  const title = normalizeLabel(event.title);
  const lowerLabel = label.toLowerCase();
  const lowerTitle = title.toLowerCase();
  const isSectionStyleInstructionalLabel =
    /^(?:lecture|tutorial|lab|seminar|discussion)\s+(?:lec|tut|lab|sem|dis|prj|pra)\s+[a-z0-9-]+$/i.test(
      label
    );

  if (!label) reasons.push("empty_label");
  if (/name:/i.test(label) || /name:/i.test(title)) reasons.push("contains_field_prefix");
  if (/\bundefined\b|\bnull\b/i.test(label) || /\bundefined\b|\bnull\b/i.test(title)) {
    reasons.push("contains_placeholder_text");
  }
  if (!isSectionStyleInstructionalLabel && /\b([a-z]{3,})\s+\1\b/i.test(label)) {
    reasons.push("duplicate_word_label");
  }

  if (
    event.eventType === "Assessment" &&
    GENERIC_ASSESSMENT_LABELS.has(lowerLabel) &&
    !/\d/.test(label)
  ) {
    reasons.push("generic_assessment_label");
  }

  if (
    event.eventType === "Assignment" &&
    GENERIC_ASSIGNMENT_LABELS.has(lowerLabel) &&
    !/\d/.test(label)
  ) {
    reasons.push("generic_assignment_label");
  }

  if (
    (event.eventType === "Assignment" || event.eventType === "Assessment") &&
    /\b(?:is|are)$/i.test(label)
  ) {
    reasons.push("trailing_sentence_fragment");
  }

  if (/^lab schedule and$/i.test(label) || /^term term$/i.test(label)) {
    reasons.push("known_malformed_label_shape");
  }

  return reasons;
}

function serializeEvent(event) {
  const suspiciousReasons = suspiciousEventNameReasons(event);

  return {
    id: event.id,
    label: event.label,
    title: event.title,
    eventType: event.eventType,
    eventGroup: event.eventGroup,
    location: event.location,
    include: event.include,
    reviewNeeded: event.reviewNeeded,
    confidence: event.confidence,
    notes: event.notes,
    suspiciousNameReasons: suspiciousReasons,
    timing:
      event.timing.kind === "single"
        ? {
            kind: "single",
            date: event.timing.date,
            endDate: event.timing.endDate,
            startTime: event.timing.startTime,
            endTime: event.timing.endTime,
            allDay: event.timing.allDay,
          }
        : {
            kind: "recurring",
            startDate: event.timing.startDate,
            endDate: event.timing.endDate,
            startTime: event.timing.startTime,
            endTime: event.timing.endTime,
            byDay: event.timing.byDay,
            exDates: event.timing.exDates,
            occurrenceNotes: event.timing.occurrenceNotes,
          },
    provenance: event.provenance,
  };
}

async function walkHtmlFiles(root) {
  const results = [];
  const entries = await fs.readdir(root, { withFileTypes: true });

  for (const entry of entries) {
    const fullPath = path.join(root, entry.name);
    if (entry.isDirectory()) {
      results.push(...(await walkHtmlFiles(fullPath)));
      continue;
    }
    if (entry.isFile() && /\.html?$/i.test(entry.name)) {
      results.push(fullPath);
    }
  }

  return results.sort();
}

async function collectFiles() {
  if (SUBJECTS.length === 0) {
    return walkHtmlFiles(ROOT_DIR);
  }

  const files = [];
  for (const subject of SUBJECTS) {
    const subjectDir = path.join(ROOT_DIR, subject);
    try {
      const stat = await fs.stat(subjectDir);
      if (!stat.isDirectory()) continue;
      files.push(...(await walkHtmlFiles(subjectDir)));
    } catch {
      // Ignore missing subject folders in the selected slice.
    }
  }

  return files.sort();
}

async function main() {
  await fs.mkdir(OUTPUT_DIR, { recursive: true });

  const files = await collectFiles();
  const comparisonReport = [];
  const auditReport = [];

  for (const fullPath of files) {
    const html = await fs.readFile(fullPath, "utf8");
    const parsed = parseOutlineHtml(html, path.basename(fullPath));
    const fallbackYear = inferYearFromFileName(parsed.course.term || path.basename(fullPath));
    const sourceLines = htmlToLines(html);
    const sourceDateEntries = extractRelevantSourceDates(sourceLines, fallbackYear);
    const parserDates = collectParserKnownDates(parsed, fallbackYear);
    const unmatched = sourceDateEntries
      .map((entry) => ({
        ...entry,
        missingDates: entry.dates.filter((value) => !parserDates.has(value)),
      }))
      .filter((entry) => entry.missingDates.length > 0);
    const officeHoursEventCount = parsed.events.filter(
      (event) => event.eventType === "OfficeHours" || event.eventGroup === "Office Hours"
    ).length;
    const officeHoursHints = extractOfficeHoursHints(sourceLines);
    const officeHoursHintDayCount = countExpectedOfficeHourDays(officeHoursHints);
    const relativePath = path.relative(ROOT_DIR, fullPath);
    const subject = relativePath.split(path.sep)[0] || "";
    const serializedEvents = parsed.events.map(serializeEvent);
    const suspiciousEvents = serializedEvents.filter(
      (event) => Array.isArray(event.suspiciousNameReasons) && event.suspiciousNameReasons.length > 0
    );

    comparisonReport.push({
      fileName: path.basename(fullPath),
      relativePath,
      subject,
      courseCode: parsed.course.courseCode,
      courseName: parsed.course.courseName,
      parserEventCount: parsed.events.length,
      sourceDateEntryCount: sourceDateEntries.length,
      unmatchedCount: unmatched.length,
      unmatched,
      officeHoursEventCount,
      officeHoursHints,
      officeHoursHintDayCount,
      officeHoursDayMismatch:
        officeHoursHintDayCount > 0 && officeHoursEventCount < officeHoursHintDayCount,
      suspiciousEventNameCount: suspiciousEvents.length,
    });

    auditReport.push({
      fileName: path.basename(fullPath),
      relativePath,
      subject,
      courseCode: parsed.course.courseCode,
      courseName: parsed.course.courseName,
      term: parsed.course.term,
      warnings: parsed.course.warnings,
      sectionOptions: parsed.course.sectionOptions,
      parserEventCount: parsed.events.length,
      suspiciousEventNameCount: suspiciousEvents.length,
      suspiciousEvents,
      events: serializedEvents,
    });
  }

  await fs.writeFile(COMPARISON_PATH, `${JSON.stringify(comparisonReport, null, 2)}\n`, "utf8");
  await fs.writeFile(AUDIT_PATH, `${JSON.stringify(auditReport, null, 2)}\n`, "utf8");

  const flaggedFiles = comparisonReport.filter(
    (entry) =>
      entry.unmatchedCount > 0 ||
      entry.officeHoursDayMismatch ||
      entry.suspiciousEventNameCount > 0
  );

  console.log(
    JSON.stringify(
      {
        root: ROOT_DIR,
        label: LABEL,
        subjects: SUBJECTS,
        totalFiles: comparisonReport.length,
        flaggedFiles: flaggedFiles.length,
        comparisonPath: COMPARISON_PATH,
        auditPath: AUDIT_PATH,
      },
      null,
      2
    )
  );
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
