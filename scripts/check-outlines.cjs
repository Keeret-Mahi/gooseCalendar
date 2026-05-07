const fs = require("node:fs/promises");
const path = require("node:path");
const { JSDOM } = require("jsdom");
const parserBundle = require("../tmp-parser-bundle.cjs");

const { parseOutlineHtml } = parserBundle;

const dom = new JSDOM("");
global.DOMParser = dom.window.DOMParser;

function timingSummary(event) {
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
