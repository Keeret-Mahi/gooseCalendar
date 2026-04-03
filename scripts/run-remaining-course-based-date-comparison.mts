import { promises as fs } from "node:fs";
import path from "node:path";
import { JSDOM } from "jsdom";
import {
  addDays,
  eachDayOfInterval,
  format,
  getDay,
  isValid,
  parse,
  parseISO,
} from "date-fns";
import { parseOutlineHtml } from "../src/app/lib/parser.ts";

const SAMPLE_ROOT = path.resolve("sample_outlines");
const COURSE_BASED_ROOT = path.resolve("sample_outlines/course_based_outlines");
const OUTPUT_PATH = path.resolve(
  "sample_outlines/course_based_outlines/remaining-folders-date-comparison.json"
);
const INCLUDED_FOLDERS = new Set([
  "ece_courses",
  "econ_courses",
  "geog_courses",
  "gsj_courses",
  "phil_courses",
  "pmath_courses",
  "rcs_courses",
]);

const dom = new JSDOM("");
globalThis.DOMParser = dom.window.DOMParser as typeof DOMParser;

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

const WEEKDAY_CODES: Record<string, number> = {
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

function normalizeWhitespace(value: string | null | undefined) {
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

function htmlToLines(html: string) {
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

function inferYearFromFileName(fileName: string) {
  const matchedYear = fileName.match(/(20\d{2})/)?.[1];
  return matchedYear ? Number(matchedYear) : new Date().getFullYear();
}

function parseDateToken(token: string, fallbackYear: number) {
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

function extractDatesFromText(text: string, fallbackYear: number) {
  return Array.from(text.matchAll(DATE_PATTERN))
    .map((match) => parseDateToken(match[2], fallbackYear))
    .filter((value): value is string => Boolean(value));
}

function isAncillaryDateLine(line: string) {
  const normalized = normalizeWhitespace(line);
  return (
    (/^(?=.*;)(?=.*\(\d{1,2}\/\d{1,2}\))(?!.*\b(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec|Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)\b)/i.test(
      normalized
    )) ||
    /^https?:\/\//i.test(normalized) ||
    /\b(?:e\.g\.|for example)\b/i.test(normalized) ||
    /\bgrace period\b/i.test(normalized) ||
    /\blate submissions?\b|\bsubmissions? (?:received|submitted) after\b|\blast day to submit\b|\bwill not be accepted\b/i.test(
      normalized
    ) ||
    /\bif you miss\b/i.test(normalized) ||
    /\balternative\b.*\bopportunity\b/i.test(normalized) ||
    /\bmake-?up assignment days?\b/i.test(normalized) ||
    /\bwill be emailed to the class\b/i.test(normalized) ||
    /\bstarting the week of\b|\bduring your regular lab time\b|\bweek of\b/i.test(normalized) ||
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

function extractRelevantSourceDates(lines: string[], fallbackYear: number) {
  const entries: Array<{ line: string; dates: string[] }> = [];

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

function occurrenceDatesForEvent(event: ReturnType<typeof parseOutlineHtml>["events"][number]) {
  if (event.timing.kind === "single") {
    return event.timing.date ? [event.timing.date] : [];
  }

  const weekdayIndexes = event.timing.byDay
    .map((code) => WEEKDAY_CODES[code])
    .filter((value) => value !== undefined);
  const excluded = new Set(event.timing.exDates);
  const dates: string[] = [];

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

async function walkIncludedHtmlFiles(root: string) {
  const results: string[] = [];
  const entries = await fs.readdir(root, { withFileTypes: true });

  for (const entry of entries) {
    const fullPath = path.join(root, entry.name);
    if (entry.isDirectory()) {
      if (INCLUDED_FOLDERS.has(entry.name)) {
        const nestedEntries = await fs.readdir(fullPath, { withFileTypes: true });
        for (const nested of nestedEntries) {
          if (nested.isFile() && /\.html?$/i.test(nested.name)) {
            results.push(path.join(fullPath, nested.name));
          }
        }
      }
      continue;
    }
  }

  return results.sort();
}

function collectParserKnownDates(
  parsed: ReturnType<typeof parseOutlineHtml>,
  fallbackYear: number
) {
  const parserDates = new Set<string>();

  parsed.events.forEach((event) => {
    occurrenceDatesForEvent(event).forEach((date) => parserDates.add(date));
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

async function main() {
  const files = await walkIncludedHtmlFiles(COURSE_BASED_ROOT);
  const report = [];

  for (const fullPath of files) {
    const html = await fs.readFile(fullPath, "utf8");
    const relativePath = path.relative(SAMPLE_ROOT, fullPath);
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

    report.push({
      fileName: path.basename(fullPath),
      relativePath,
      courseCode: parsed.course.courseCode,
      courseName: parsed.course.courseName,
      sourceDateEntryCount: sourceDateEntries.length,
      parserEventCount: parsed.events.length,
      unmatchedCount: unmatched.length,
      unmatched,
    });
  }

  await fs.writeFile(OUTPUT_PATH, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  console.log(
    `Wrote remaining course-based source-vs-parser comparison for ${report.length} outlines to ${OUTPUT_PATH}`
  );
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
