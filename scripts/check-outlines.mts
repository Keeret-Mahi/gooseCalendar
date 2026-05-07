import { promises as fs } from "node:fs";
import path from "node:path";
import { JSDOM } from "jsdom";
import parserBundle from "../tmp-parser-bundle.cjs";

const { parseOutlineHtml } = parserBundle as {
  parseOutlineHtml: (html: string, outlineName: string) => {
    course: { courseCode: string };
    events: Array<{
      eventType: string;
      label: string;
      location?: string;
      instructorName?: string;
      instructorEmail?: string;
      timing:
        | {
            kind: "single";
            date?: string;
            startTime?: string;
            endTime?: string;
          }
        | {
            kind: "recurring";
            byDay: string[];
            startDate?: string;
            endDate?: string;
          };
    }>;
  };
};

const dom = new JSDOM("");
globalThis.DOMParser = dom.window.DOMParser as typeof DOMParser;

function timingSummary(event: ReturnType<typeof parseOutlineHtml>["events"][number]) {
  if (event.timing.kind === "single") {
    return [event.timing.date, event.timing.startTime, event.timing.endTime]
      .filter(Boolean)
      .join(" ");
  }

  return `${event.timing.byDay.join("/") || "-"} ${event.timing.startDate} -> ${event.timing.endDate}`;
}

async function main() {
  for (const filePath of process.argv.slice(2)) {
    const html = await fs.readFile(filePath, "utf8");
    const parsed = parseOutlineHtml(html, path.basename(filePath));

    console.log(`\n=== ${parsed.course.courseCode} | ${path.basename(filePath)} ===`);
    for (const event of parsed.events) {
      const extra = [event.location, event.instructorName, event.instructorEmail]
        .filter(Boolean)
        .join(" | ");
      console.log(
        `${event.eventType}\t${event.label}\t${timingSummary(event)}${extra ? `\t${extra}` : ""}`
      );
    }
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
