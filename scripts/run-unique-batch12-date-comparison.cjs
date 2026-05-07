const fs = require("node:fs/promises");
const path = require("node:path");
const { JSDOM } = require("jsdom");
const { eachDayOfInterval, format, getDay, isValid, parse, parseISO } = require("date-fns");
const { parseOutlineHtml } = require("../tmp-parser-bundle.cjs");

const SAMPLE_ROOT = path.resolve("sample_outlines");
const OUTPUT_PATH = path.resolve("sample_outlines/batch1-batch2-unique-date-comparison.json");
const PRIMARY_BATCHES = ["batch1", "batch2"];
const COMPARISON_BATCHES = ["batch3", "batch4", "batch5_cs"];
const COURSE_BASED_ROOT = path.resolve("sample_outlines/course_based_outlines");

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
    /\b(?:e\.g\.|for example)\b/i.test(normalized) ||
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

async function listHtmlFiles(dirPath) {
  const entries = await fs.readdir(dirPath, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile() && /\.html?$/i.test(entry.name))
    .map((entry) => path.join(dirPath, entry.name))
    .sort();
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

async function getUniqueBatchFiles() {
  const primaryFiles = (
    await Promise.all(PRIMARY_BATCHES.map((batch) => listHtmlFiles(path.resolve("sample_outlines", batch))))
  ).flat();

  const comparisonFiles = (
    await Promise.all(COMPARISON_BATCHES.map((batch) => listHtmlFiles(path.resolve("sample_outlines", batch))))
  ).flat();
  comparisonFiles.push(...(await walkHtmlFiles(COURSE_BASED_ROOT)));

  const comparisonBasenames = new Set(comparisonFiles.map((filePath) => path.basename(filePath)));

  return primaryFiles.filter((filePath) => !comparisonBasenames.has(path.basename(filePath)));
}

async function main() {
  const files = await getUniqueBatchFiles();
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
    const officeHoursEventCount = parsed.events.filter(
      (event) => event.eventType === "OfficeHours" || event.eventGroup === "Office Hours"
    ).length;
    const officeHoursHints = extractOfficeHoursHints(sourceLines);
    const officeHoursHintDayCount = countExpectedOfficeHourDays(officeHoursHints);

    report.push({
      fileName: path.basename(fullPath),
      relativePath,
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
    });
  }

  await fs.writeFile(OUTPUT_PATH, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  console.log(
    `Wrote unique batch1/batch2 source-vs-parser comparison for ${report.length} outlines to ${OUTPUT_PATH}`
  );
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
