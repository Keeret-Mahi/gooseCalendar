// Explicit, bounded smoke evaluation. Uses synthetic course text, never production credentials.
// Run: node --env-file=.env.local scripts/compare-extraction-models.cjs --live
const { buildSync } = require("esbuild");
const path = require("node:path");
const vm = require("node:vm");

function load(entry) {
  const module = { exports: {} };
  const result = buildSync({
    entryPoints: [path.resolve(__dirname, "..", entry)], bundle: true,
    platform: "node", format: "cjs", packages: "external", write: false,
  });
  vm.runInNewContext(result.outputFiles[0].text, {
    module, exports: module.exports, require, process, console, Buffer, setTimeout, clearTimeout,
  });
  return module.exports;
}

async function main() {
  if (!process.argv.includes("--live")) throw new Error("Pass --live to authorize two small paid API requests.");
  if (!process.env.OPENAI_API_KEY) throw new Error("OPENAI_API_KEY is missing.");
  const { AI_EXTRACTOR_SYSTEM_PROMPT, buildAiExtractorUserPrompt } = load("src/server/openaiOutlineExtractor.ts");
  const { AI_EXTRACTION_JSON_SCHEMA, validateAiExtractionResponse } = load("src/app/lib/aiExtractionSchema.ts");
  const request = {
    outlineName: "model-smoke-test.html", courseCode: "TEST 101", courseName: "Extraction Evaluation",
    term: "Fall 2026", termYear: 2026, extractionMode: "nonMeeting", sourceFormat: "html",
    outlineText: `Fall 2026 course outline. Classes run September 8 to December 4, 2026.
Lecture: Mondays and Wednesdays 10:00-11:20, MC 100. The schedule table was already parsed.
Assignment schedule (all deadlines are 11:59 PM):
Assignment | Published | Due
Assignment 1 | September 10 | September 17
Assignment 2 | September 24 | October 1
Assignment 3 | October 8 | October 22
The research report is due November 12.
The weekly project is due November 19.
MID-Term: October 15, 18:00-19:30, MC 200.
Final exam: date to be announced by the registrar.
There will be 4 reflections; their dates will be posted on LEARN. Do not infer dates from the count.
Office hours, September 8 through December 4:
Professor Alex Example: Mondays 14:00-15:00 in MC 300; Thursdays 09:00-10:00 on Zoom.
Teaching assistant Sam Example: by appointment only.
Reading week: October 12-16. No lecture meetings during reading week.`,
  };
  const requestedModel = process.argv.find((value) => value.startsWith("--model="))?.slice(8);
  const models = [
    { model: "gpt-4.1-mini", inputPrice: 0.40, cachedPrice: 0.10, outputPrice: 1.60 },
    { model: "gpt-5.6-luna", inputPrice: 0.20, cachedPrice: 0.02, outputPrice: 1.20, reasoning_effort: "none" },
    { model: "gpt-5.6-terra", inputPrice: 2.00, cachedPrice: 0.20, outputPrice: 12.00, reasoning_effort: "none" },
  ].filter((candidate) => !requestedModel || candidate.model === requestedModel);
  if (models.length === 0) throw new Error(`Unknown comparison model: ${requestedModel}`);
  for (const candidate of models) {
    const start = Date.now();
    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}`, "Content-Type": "application/json" },
      signal: AbortSignal.timeout(120_000),
      body: JSON.stringify({
        model: candidate.model, store: false,
        ...(candidate.reasoning_effort ? { reasoning_effort: candidate.reasoning_effort } : {}),
        messages: [{ role: "system", content: AI_EXTRACTOR_SYSTEM_PROMPT }, { role: "user", content: buildAiExtractorUserPrompt(request) }],
        max_completion_tokens: 6000,
        response_format: { type: "json_schema", json_schema: { name: "outline_evaluation", strict: true, schema: AI_EXTRACTION_JSON_SCHEMA } },
      }),
    });
    const data = await response.json();
    if (!response.ok) {
      console.log(JSON.stringify({ model: candidate.model, httpStatus: response.status, errorCode: data.error?.code }));
      continue;
    }
    const validation = validateAiExtractionResponse(JSON.parse(data.choices[0].message.content));
    const events = validation.data.events;
    const assignmentDates = ["2026-09-10", "2026-09-17", "2026-09-24", "2026-10-01", "2026-10-08", "2026-10-22"];
    const checks = {
      validSchema: validation.ok,
      completed: data.choices[0].finish_reason === "stop",
      allAssignmentMilestones: assignmentDates.every((date) => events.some((event) => /assignment/i.test(event.label) && event.timing.date === date)),
      reportDate: events.some((event) => /report/i.test(event.label) && event.timing.date === "2026-11-12"),
      projectDate: events.some((event) => /project/i.test(event.label) && event.timing.date === "2026-11-19"),
      midtermTime: events.some((event) => /mid.?term/i.test(event.label) && event.timing.date === "2026-10-15" && event.timing.startTime === "18:00" && event.timing.endTime === "19:30"),
      twoDistinctOfficeHours: events.filter((event) => event.eventType === "OfficeHours" && event.timing.kind === "recurring").length === 2,
      undatedReflectionsKept: events.some((event) => /reflection/i.test(event.label) && event.timing.date === null),
      noInventedReflectionDates: !events.some((event) => /reflection/i.test(event.label) && event.timing.date !== null),
      noDuplicateClassMeetings: !events.some((event) => ["Lecture", "Tutorial", "Lab"].includes(event.eventType)),
      publishedDueLabels: events.filter((event) => /assignment/i.test(event.label) && event.timing.date).every((event) => /published|due|open|closed/i.test(event.label)),
    };
    const input = data.usage.prompt_tokens;
    const cached = data.usage.prompt_tokens_details?.cached_tokens ?? 0;
    const output = data.usage.completion_tokens;
    console.log(JSON.stringify({
      model: candidate.model, reasoningEffort: candidate.reasoning_effort ?? "not applicable",
      seconds: +((Date.now() - start) / 1000).toFixed(1), events: events.length,
      checks, passed: Object.values(checks).filter(Boolean).length, total: Object.keys(checks).length,
      usage: { input, cached, output },
      estimatedUsd: +(((input - cached) * candidate.inputPrice + cached * candidate.cachedPrice + output * candidate.outputPrice) / 1e6).toFixed(6),
      labels: events.map((event) => event.label),
    }, null, 2));
  }
}
main().catch((error) => { console.error(error.message); process.exitCode = 1; });
