import { promises as fs } from "node:fs";
import path from "node:path";
import { JSDOM } from "jsdom";
import { parseOutlineHtml } from "../src/app/lib/parser.ts";

const batchName = process.argv[2] ?? "batch1";
const batchDir = path.resolve(`sample_outlines/${batchName}`);
const outputPath = path.resolve(`sample_outlines/${batchName}-audit.json`);

const dom = new JSDOM("");
globalThis.DOMParser = dom.window.DOMParser as typeof DOMParser;

function sortEvents(left: { label: string; eventType: string }, right: { label: string; eventType: string }) {
  const typeDelta = left.eventType.localeCompare(right.eventType);
  if (typeDelta !== 0) return typeDelta;
  return left.label.localeCompare(right.label);
}

function serializeEvent(event: ReturnType<typeof parseOutlineHtml>["events"][number]) {
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

async function main() {
  const batchStat = await fs.stat(batchDir).catch(() => undefined);
  if (!batchStat?.isDirectory()) {
    throw new Error(`Batch folder not found: ${batchDir}`);
  }

  const entries = await fs.readdir(batchDir, { withFileTypes: true });
  const files = entries
    .filter((entry) => entry.isFile() && /\.html?$/i.test(entry.name))
    .map((entry) => entry.name)
    .sort();

  const report = [];

  for (const fileName of files) {
    const fullPath = path.join(batchDir, fileName);
    const html = await fs.readFile(fullPath, "utf8");
    const result = parseOutlineHtml(html, fileName);
    const events = [...result.events].sort(sortEvents).map(serializeEvent);

    const countsByGroup = events.reduce<Record<string, number>>((accumulator, event) => {
      accumulator[event.eventGroup] = (accumulator[event.eventGroup] ?? 0) + 1;
      return accumulator;
    }, {});

    report.push({
      fileName,
      courseCode: result.course.courseCode,
      courseName: result.course.courseName,
      term: result.course.term,
      warnings: result.course.warnings,
      sectionOptions: result.course.sectionOptions,
      countsByGroup,
      events,
    });
  }

  await fs.writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  console.log(`Wrote ${report.length} outline audits for ${batchName} to ${outputPath}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
