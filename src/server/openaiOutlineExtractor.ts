import {
  AI_EXTRACTION_JSON_SCHEMA,
  EMPTY_AI_EXTRACTION,
  validateAiExtractionResponse,
  type AiOutlineExtractionRequest,
} from "../app/lib/aiExtractionSchema.js";
import {
  readAiExtractionCache,
  writeAiExtractionCache,
} from "./firebaseExtractionCache.js";

const DEFAULT_MODEL = "gpt-4.1-mini";
const DEFAULT_OUTLINE_TEXT_LIMIT = 45_000;
const DEFAULT_OPENAI_TIMEOUT_MS = 90_000;
const GPT_55_TIMEOUT_MS = 240_000;
const DEFAULT_OPENAI_MAX_OUTPUT_TOKENS = 6_000;
const GPT_55_MAX_OUTPUT_TOKENS = 8_000;
const GPT_55_PRO_MAX_OUTPUT_TOKENS = 12_000;

type OpenAiUsage = {
  prompt_tokens?: number;
  completion_tokens?: number;
  total_tokens?: number;
  prompt_tokens_details?: {
    cached_tokens?: number;
  };
  input_tokens?: number;
  output_tokens?: number;
  input_tokens_details?: {
    cached_tokens?: number;
  };
};

type OpenAiPricing = {
  modelPrefix: string;
  inputUsdPerMillion: number;
  cachedInputUsdPerMillion: number;
  outputUsdPerMillion: number;
};

const OPENAI_MODEL_PRICING: OpenAiPricing[] = [
  {
    modelPrefix: "gpt-5.5-pro",
    inputUsdPerMillion: 30,
    cachedInputUsdPerMillion: 30,
    outputUsdPerMillion: 180,
  },
  {
    modelPrefix: "gpt-5.5",
    inputUsdPerMillion: 5,
    cachedInputUsdPerMillion: 0.5,
    outputUsdPerMillion: 30,
  },
  {
    modelPrefix: "gpt-5.4-nano",
    inputUsdPerMillion: 0.2,
    cachedInputUsdPerMillion: 0.02,
    outputUsdPerMillion: 1.25,
  },
  {
    modelPrefix: "gpt-5.4-mini",
    inputUsdPerMillion: 0.75,
    cachedInputUsdPerMillion: 0.075,
    outputUsdPerMillion: 4.5,
  },
  {
    modelPrefix: "gpt-5.4",
    inputUsdPerMillion: 2.5,
    cachedInputUsdPerMillion: 0.25,
    outputUsdPerMillion: 15,
  },
  {
    modelPrefix: "gpt-4.1-nano",
    inputUsdPerMillion: 0.1,
    cachedInputUsdPerMillion: 0.025,
    outputUsdPerMillion: 0.4,
  },
  {
    modelPrefix: "gpt-4.1-mini",
    inputUsdPerMillion: 0.4,
    cachedInputUsdPerMillion: 0.1,
    outputUsdPerMillion: 1.6,
  },
  {
    modelPrefix: "gpt-4.1",
    inputUsdPerMillion: 2,
    cachedInputUsdPerMillion: 0.5,
    outputUsdPerMillion: 8,
  },
];

export const AI_EXTRACTOR_SYSTEM_PROMPT = `You are extracting structured non-meeting calendar events from a University of Waterloo course outline.

Context:
- The lecture/tutorial/lab schedule has already been parsed elsewhere.
- Do NOT return lecture, tutorial, or lab meeting events.
- Your job is only to extract non-meeting items from the remaining outline content.

You must identify and categorize:
- Assignment
- Assessment
- OfficeHours
- Other

You must return JSON only.
Do not return prose.
Do not include markdown.
Do not guess missing facts.

Rules:
1. Never invent dates, times, locations, instructors, or weights.
2. If an item has no explicit date, keep it as an undated single event.
3. If an item clearly has two milestones such as published/opened and due/closed, return two separate events.
4. If an item is recurring office hours, return recurring timing.
5. If something is ambiguous, preserve it with lower confidence instead of guessing.
6. Use short clean event labels, not full sentences.
7. Remove redundant date text from labels.
8. Preserve useful qualifiers like:
   - Published
   - Due
   - Initial Post
   - Follow-Up Post
   - Part 1
   - Part 2
9. Keep weights when explicitly stated.
10. Include a short source snippet for each event so the local app can store provenance.
11. Do not omit assignment or assessment series just because individual dates are not listed.
    - Scan prose, tables, bullet lists, grading summaries, tentative schedules, and policy-adjacent course-specific text for assignments, quizzes, exams, discussions, labs, projects, papers, reports, presentations, and other coursework.
    - Tentative class plans, weekly schedules, course schedules, and topic schedules are valid sources for assignment/assessment deadlines. Extract only the assignment/assessment/deadline cells from those rows; do not return lecture/topic/meeting events from those tables.
    - If a schedule table lists exact items such as "Assignment 1 due Wed Jan 14", return those exact items with dates.
    - If month/day dates omit a year, use the course metadata termYear.
    - If one section gives a common due time or submission method for a series and another table gives exact dates for the individual items, combine those explicit facts.
    - If the outline says there are multiple assignments, quizzes, posts, labs, or similar items but only gives a weekday/time pattern, return one undated single event for the series.
    - If the outline names individual items such as Assignment 1, Assignment 2, Quiz 1, Quiz 2, etc. without dates, return those items as separate undated single events.
    - Put "Date unresolved" in notes when the item exists but no exact date is known.
    - Put the count, weekday/time pattern, submission method, and other useful known facts in notes.
    - Do not create numbered events for a series unless the outline explicitly lists those item numbers/names.
    - Ignore generic university policy mentions of assignments unless they refer to this course's actual coursework.
12. For location, prefer the specific platform over generic online phrasing.
    - If an item says it is online through/via/on/using a named platform, set location to only that platform name.
    - Example: use "Crowdmark", not "online, through Crowdmark".
    - Example: use "LEARN Dropbox", not "online via LEARN Dropbox".
    - If no specific platform is named and only "online" is known, use "Online".
13. If the source explicitly says what an assignment is about, add one short note in the form "Description: ...".
    - Keep it to one concise sentence fragment or sentence.
    - Use only assignment-specific content from the source, such as topic, task, deliverable, reading/problem range, or submission focus.
    - Do not summarize generic policy, late rules, academic integrity, platform instructions, or grading rubrics as the description.
    - Do not invent a description when the outline only names the assignment.

Return exactly this JSON shape:

{
  "events": [
    {
      "label": "string",
      "eventType": "Assignment | Assessment | OfficeHours | Other",
      "location": "string | null",
      "instructorName": "string | null",
      "instructorEmail": "string | null",
      "notes": ["string"],
      "weight": "string | null",
      "confidence": "high | medium | low",
      "sourceKind": "table | prose | topic",
      "sourceSectionTitle": "string | null",
      "sourceSnippet": "string",
      "timing": {
        "kind": "single | recurring",

        "date": "YYYY-MM-DD | null",
        "endDate": "YYYY-MM-DD | null",
        "startTime": "HH:MM | null",
        "endTime": "HH:MM | null",
        "allDay": true,

        "startDate": "YYYY-MM-DD | null",
        "recurringEndDate": "YYYY-MM-DD | null",
        "byDay": ["MO","TU","WE","TH","FR","SA","SU"],
        "exDates": ["YYYY-MM-DD"]
      }
    }
  ],
  "warnings": ["string"]
}

Timing rules:
- For single events:
  - use \`kind = "single"\`
  - use \`date\` if known
  - use \`allDay = true\` if no explicit time
  - for assignment due/deadline times, set \`allDay = true\`, put the due time in \`endTime\`, leave \`startTime = null\`, and do not invent a start time
  - if a due/deadline time is exactly 11:59 PM / 23:59, treat it as an all-day deadline and set \`startTime = null\` and \`endTime = null\`
- For recurring office hours:
  - use \`kind = "recurring"\`
  - use \`startDate\` / \`recurringEndDate\` if known
  - use \`byDay\`
  - include \`startTime\` / \`endTime\` when known
- If an item is undated:
  - use \`kind = "single"\`
  - \`date = null\`
  - \`allDay = true\`
  - include \`Date unresolved\` in notes

Labeling examples:
- good: \`Assignment #2\`
- good: \`Assignment #2 Published\`
- good: \`Assignments\` for a series like "10 assignments due Wednesdays at 5:00pm" when exact dates are not listed
- good: \`Discussion Post #3 - Initial Post\`
- good: \`Midterm\`
- good: \`Quiz #2\`
- bad: \`This assignment is due on Friday\`
- bad: \`The report is\`
- bad: \`Assignment due September 12\`

Important:
- Do not emit lecture/tutorial/lab meetings.
- Do not merge two distinct milestones into one event.
- Do not throw away undated events just because they cannot be exported yet.`;

export function buildAiExtractorUserPrompt(request: AiOutlineExtractionRequest) {
  return `Course metadata:
- outlineName: ${request.outlineName}
- courseCode: ${request.courseCode}
- courseName: ${request.courseName}
- term: ${request.term}
- termYear: ${request.termYear}

Extract non-meeting calendar candidates from the remaining outline text below.

Remember:
- Do not extract lectures, tutorials, labs, or class schedule rows.
- Return JSON only.

Remaining outline text:
${request.outlineText}`;
}

function sendJson(response: any, statusCode: number, body: unknown) {
  response.statusCode = statusCode;
  response.setHeader("Content-Type", "application/json");
  response.end(JSON.stringify(body));
}

async function readBody(request: any, limitBytes = 2_000_000) {
  if (typeof request.body === "string") {
    if (Buffer.byteLength(request.body, "utf8") > limitBytes) {
      throw new Error("Request body is too large.");
    }
    return request.body;
  }

  if (Buffer.isBuffer(request.body)) {
    if (request.body.length > limitBytes) {
      throw new Error("Request body is too large.");
    }
    return request.body.toString("utf8");
  }

  if (typeof request.body === "object" && request.body !== null) {
    const bodyText = JSON.stringify(request.body);
    if (Buffer.byteLength(bodyText, "utf8") > limitBytes) {
      throw new Error("Request body is too large.");
    }
    return bodyText;
  }

  const chunks: Buffer[] = [];
  let size = 0;

  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > limitBytes) {
      throw new Error("Request body is too large.");
    }
    chunks.push(buffer);
  }

  return Buffer.concat(chunks).toString("utf8");
}

function readString(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function validateRequest(value: unknown) {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return undefined;
  }

  const raw = value as Record<string, unknown>;
  const outlineName = readString(raw.outlineName);
  const courseCode = readString(raw.courseCode);
  const courseName = readString(raw.courseName);
  const term = readString(raw.term);
  const outlineText = readString(raw.outlineText);
  const outlineHash = readString(raw.outlineHash).toLowerCase();
  const termYear =
    typeof raw.termYear === "number" && Number.isFinite(raw.termYear)
      ? raw.termYear
      : Number.NaN;

  if (!outlineName || !courseCode || !courseName || !term || !outlineText || !Number.isFinite(termYear)) {
    return undefined;
  }

  return {
    outlineName,
    courseCode,
    courseName,
    term,
    termYear,
    outlineText,
    ...(outlineHash ? { outlineHash } : {}),
  } satisfies AiOutlineExtractionRequest;
}

function parseOpenAiContent(content: unknown) {
  if (typeof content !== "string") {
    return {
      data: EMPTY_AI_EXTRACTION,
      warnings: ["AI extraction returned no text content."],
    };
  }
  try {
    return {
      data: JSON.parse(content),
      warnings: [] as string[],
    };
  } catch {
    return {
      data: EMPTY_AI_EXTRACTION,
      warnings: [
        "AI extraction returned invalid or truncated JSON. Try increasing OPENAI_MAX_OUTPUT_TOKENS or using a faster non-pro model.",
      ],
    };
  }
}

function normalizeOpenAiModelName(model: string) {
  const trimmed = model.trim();
  if (/^gpt[-\s]/i.test(trimmed)) {
    return trimmed.toLowerCase().replace(/\s+/g, "-");
  }
  return trimmed;
}

function readTokenCount(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function normalizeOpenAiUsage(value: unknown): OpenAiUsage | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return undefined;
  }

  const raw = value as OpenAiUsage;
  const cachedTokens =
    raw.prompt_tokens_details?.cached_tokens ?? raw.input_tokens_details?.cached_tokens;

  return {
    prompt_tokens: raw.prompt_tokens ?? raw.input_tokens,
    completion_tokens: raw.completion_tokens ?? raw.output_tokens,
    total_tokens: raw.total_tokens,
    prompt_tokens_details: {
      cached_tokens: cachedTokens,
    },
  };
}

function findModelPricing(model: string) {
  const normalizedModel = model.toLowerCase();
  return OPENAI_MODEL_PRICING.find((pricing) =>
    normalizedModel.startsWith(pricing.modelPrefix),
  );
}

function formatUsd(value: number) {
  if (value < 0.0001) return "<$0.0001";
  if (value < 0.01) return `$${value.toFixed(4)}`;
  return `$${value.toFixed(3)}`;
}

function estimateOpenAiCost(model: string, usage: OpenAiUsage | undefined) {
  const pricing = findModelPricing(model);
  if (!pricing || !usage) {
    return undefined;
  }

  const inputTokens = readTokenCount(usage.prompt_tokens);
  const outputTokens = readTokenCount(usage.completion_tokens);
  const cachedInputTokens = Math.min(
    inputTokens,
    readTokenCount(usage.prompt_tokens_details?.cached_tokens),
  );
  const uncachedInputTokens = Math.max(inputTokens - cachedInputTokens, 0);
  const inputCost =
    (uncachedInputTokens / 1_000_000) * pricing.inputUsdPerMillion +
    (cachedInputTokens / 1_000_000) * pricing.cachedInputUsdPerMillion;
  const outputCost = (outputTokens / 1_000_000) * pricing.outputUsdPerMillion;
  const totalCost = inputCost + outputCost;

  return {
    pricingModelPrefix: pricing.modelPrefix,
    inputTokens,
    cachedInputTokens,
    outputTokens,
    totalTokens: readTokenCount(usage.total_tokens),
    estimatedCostUsd: Number(totalCost.toFixed(6)),
    estimatedCostDisplay: formatUsd(totalCost),
  };
}

function shouldPreferResponsesApi(model: string) {
  return model.startsWith("gpt-5.5");
}

function defaultTimeoutForModel(model: string) {
  return model.startsWith("gpt-5.5") ? GPT_55_TIMEOUT_MS : DEFAULT_OPENAI_TIMEOUT_MS;
}

function configuredTimeoutForModel(model: string) {
  const configured = Number(process.env.OPENAI_TIMEOUT_MS);
  if (Number.isFinite(configured) && configured >= 10_000) {
    return Math.round(configured);
  }
  return defaultTimeoutForModel(model);
}

function defaultMaxOutputTokensForModel(model: string) {
  if (model.startsWith("gpt-5.5-pro")) return GPT_55_PRO_MAX_OUTPUT_TOKENS;
  if (model.startsWith("gpt-5.5")) return GPT_55_MAX_OUTPUT_TOKENS;
  return DEFAULT_OPENAI_MAX_OUTPUT_TOKENS;
}

function configuredMaxOutputTokensForModel(model: string) {
  const configured = Number(process.env.OPENAI_MAX_OUTPUT_TOKENS);
  if (Number.isFinite(configured) && configured >= 1_000) {
    return Math.round(Math.min(configured, 32_000));
  }
  return defaultMaxOutputTokensForModel(model);
}

function isChatEndpointMismatch(status: number, message: string) {
  return status === 404 && /not a chat model|chat model|chat\/completions/i.test(message);
}

function isAbortError(error: unknown) {
  return (
    error instanceof Error &&
    (error.name === "AbortError" || /aborted/i.test(error.message))
  );
}

function extractResponsesContent(data: any) {
  if (typeof data?.output_text === "string") {
    return data.output_text;
  }

  const output = Array.isArray(data?.output) ? data.output : [];
  for (const item of output) {
    const content = Array.isArray(item?.content) ? item.content : [];
    for (const part of content) {
      if (typeof part?.text === "string") {
        return part.text;
      }
    }
  }

  return undefined;
}

function openAiCompletionWarnings({
  endpoint,
  data,
  maxOutputTokens,
}: {
  endpoint: "chat.completions" | "responses";
  data: any;
  maxOutputTokens: number;
}) {
  const warnings: string[] = [];

  if (endpoint === "responses") {
    const status = typeof data?.status === "string" ? data.status : "";
    const reason =
      typeof data?.incomplete_details?.reason === "string"
        ? data.incomplete_details.reason
        : "";
    if (status === "incomplete" || reason) {
      warnings.push(
        `OpenAI response was incomplete${reason ? ` (${reason})` : ""}. The ${maxOutputTokens}-token output cap may be too low.`
      );
    }
    return warnings;
  }

  const finishReason =
    typeof data?.choices?.[0]?.finish_reason === "string"
      ? data.choices[0].finish_reason
      : "";
  if (finishReason === "length") {
    warnings.push(
      `OpenAI response hit the ${maxOutputTokens}-token output cap before finishing.`
    );
  }

  return warnings;
}

async function requestChatCompletions({
  apiKey,
  baseUrl,
  model,
  request,
  maxOutputTokens,
  signal,
}: {
  apiKey: string;
  baseUrl: string;
  model: string;
  request: AiOutlineExtractionRequest;
  maxOutputTokens: number;
  signal: AbortSignal;
}) {
  const response = await fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    signal,
    body: JSON.stringify({
      model,
      messages: [
        {
          role: "system",
          content: AI_EXTRACTOR_SYSTEM_PROMPT,
        },
        {
          role: "user",
          content: buildAiExtractorUserPrompt(request),
        },
      ],
      response_format: {
        type: "json_schema",
        json_schema: {
          name: "goose_calendar_non_meeting_events",
          strict: true,
          schema: AI_EXTRACTION_JSON_SCHEMA,
        },
      },
      max_completion_tokens: maxOutputTokens,
    }),
  });

  return {
    endpoint: "chat.completions",
    response,
    data: await response.json().catch(() => undefined),
  } as const;
}

async function requestResponses({
  apiKey,
  baseUrl,
  model,
  request,
  maxOutputTokens,
  signal,
}: {
  apiKey: string;
  baseUrl: string;
  model: string;
  request: AiOutlineExtractionRequest;
  maxOutputTokens: number;
  signal: AbortSignal;
}) {
  const response = await fetch(`${baseUrl}/responses`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    signal,
    body: JSON.stringify({
      model,
      instructions: AI_EXTRACTOR_SYSTEM_PROMPT,
      input: buildAiExtractorUserPrompt(request),
      text: {
        format: {
          type: "json_schema",
          name: "goose_calendar_non_meeting_events",
          strict: true,
          schema: AI_EXTRACTION_JSON_SCHEMA,
        },
      },
      max_output_tokens: maxOutputTokens,
    }),
  });

  return {
    endpoint: "responses",
    response,
    data: await response.json().catch(() => undefined),
  } as const;
}

async function callOpenAi(request: AiOutlineExtractionRequest) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey || apiKey === "undefined") {
    console.warn("[gooseCalendar] AI extraction skipped: OPENAI_API_KEY is not configured.");
    return {
      extraction: EMPTY_AI_EXTRACTION,
      warnings: [
        "AI extraction skipped because OPENAI_API_KEY is not configured on the local server.",
      ],
      cacheable: false,
      model: DEFAULT_MODEL,
    };
  }

  const configuredModel =
    process.env.OPENAI_MODEL && process.env.OPENAI_MODEL !== "undefined"
      ? process.env.OPENAI_MODEL
      : DEFAULT_MODEL;
  const model = normalizeOpenAiModelName(configuredModel);
  if (model !== configuredModel) {
    console.info("[gooseCalendar] Normalized OpenAI model name", {
      configuredModel,
      model,
    });
  }

  const baseUrl = (
    process.env.OPENAI_API_BASE_URL && process.env.OPENAI_API_BASE_URL !== "undefined"
      ? process.env.OPENAI_API_BASE_URL
      : "https://api.openai.com/v1"
  ).replace(/\/+$/, "");
  const timeoutMs = configuredTimeoutForModel(model);
  const maxOutputTokens = configuredMaxOutputTokensForModel(model);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    console.info("[gooseCalendar] Calling OpenAI for outline extraction", {
      model,
      endpoint: shouldPreferResponsesApi(model) ? "responses" : "chat.completions",
      courseCode: request.courseCode,
      outlineName: request.outlineName,
      inputChars: request.outlineText.length,
      timeoutMs,
      maxOutputTokens,
    });

    let openAiResult = shouldPreferResponsesApi(model)
      ? await requestResponses({
          apiKey,
          baseUrl,
          model,
          request,
          maxOutputTokens,
          signal: controller.signal,
        })
      : await requestChatCompletions({
          apiKey,
          baseUrl,
          model,
          request,
          maxOutputTokens,
          signal: controller.signal,
        });

    if (!openAiResult.response.ok && openAiResult.endpoint === "chat.completions") {
      const message =
        typeof openAiResult.data?.error?.message === "string"
          ? openAiResult.data.error.message
          : `OpenAI request failed with HTTP ${openAiResult.response.status}.`;

      if (isChatEndpointMismatch(openAiResult.response.status, message)) {
        console.info("[gooseCalendar] Retrying OpenAI extraction with Responses API", {
          model,
          reason: message,
        });
        openAiResult = await requestResponses({
          apiKey,
          baseUrl,
          model,
          request,
          maxOutputTokens,
          signal: controller.signal,
        });
      }
    }

    const { response, data, endpoint } = openAiResult;
    if (!response.ok) {
      const message =
        typeof data?.error?.message === "string"
          ? data.error.message
          : `OpenAI request failed with HTTP ${response.status}.`;
      console.warn("[gooseCalendar] OpenAI extraction request failed", {
        endpoint,
        status: response.status,
        message,
      });
      return {
        extraction: EMPTY_AI_EXTRACTION,
        warnings: [message],
        cacheable: false,
        model,
      };
    }

    const content =
      endpoint === "responses"
        ? extractResponsesContent(data)
        : data?.choices?.[0]?.message?.content;
    const completionWarnings = openAiCompletionWarnings({
      endpoint,
      data,
      maxOutputTokens,
    });
    const parsedContent = parseOpenAiContent(content);
    const validation = validateAiExtractionResponse(parsedContent.data);
    const usage = normalizeOpenAiUsage(data?.usage);
    const cost = estimateOpenAiCost(model, usage);
    const warnings = [
      ...completionWarnings,
      ...parsedContent.warnings,
      ...validation.warnings,
    ];
    const cacheSkipReasons = [
      completionWarnings.length > 0 ? "openai_response_incomplete" : "",
      parsedContent.warnings.length > 0 ? "openai_response_unparseable" : "",
      !validation.ok ? "schema_validation_failed" : "",
    ].filter(Boolean);
    const cacheable = cacheSkipReasons.length === 0;
    console.info("[gooseCalendar] OpenAI extraction completed", {
      courseCode: request.courseCode,
      model,
      endpoint,
      eventCount: validation.data.events.length,
      warningCount: warnings.length + validation.data.warnings.length,
      cacheable,
      cacheSkipReasons,
      promptTokens: cost?.inputTokens ?? usage?.prompt_tokens,
      cachedPromptTokens: cost?.cachedInputTokens ?? usage?.prompt_tokens_details?.cached_tokens,
      completionTokens: cost?.outputTokens ?? usage?.completion_tokens,
      totalTokens: cost?.totalTokens ?? usage?.total_tokens,
      estimatedCostUsd: cost?.estimatedCostUsd ?? null,
      estimatedCostDisplay: cost?.estimatedCostDisplay ?? "unknown model pricing",
      pricingModelPrefix: cost?.pricingModelPrefix,
      maxOutputTokens,
      responseStatus: data?.status,
      incompleteReason: data?.incomplete_details?.reason,
    });

    return {
      extraction: validation.data,
      warnings,
      cacheable,
      model,
    };
  } catch (error) {
    if (isAbortError(error)) {
      const message = `AI extraction timed out after ${Math.round(
        timeoutMs / 1000
      )} seconds. Try again, increase OPENAI_TIMEOUT_MS, or use a faster model such as gpt-4.1-mini.`;
      console.warn("[gooseCalendar] AI extraction timed out", {
        model,
        timeoutMs,
      });
      return {
        extraction: EMPTY_AI_EXTRACTION,
        warnings: [message],
        cacheable: false,
        model,
      };
    }

    console.warn("[gooseCalendar] AI extraction failed before completion", {
      message: error instanceof Error ? error.message : "Unknown error",
    });
    return {
      extraction: EMPTY_AI_EXTRACTION,
      warnings: [
        error instanceof Error
          ? `AI extraction failed: ${error.message}`
          : "AI extraction failed.",
      ],
      cacheable: false,
      model,
    };
  } finally {
    clearTimeout(timeout);
  }
}

export async function handleOutlineExtractionRequest(request: any, response: any) {
  if (request.method !== "POST") {
    sendJson(response, 405, {
      extraction: EMPTY_AI_EXTRACTION,
      warnings: ["Use POST for outline extraction."],
    });
    return;
  }

  try {
    const bodyText = await readBody(request);
    const parsed = validateRequest(JSON.parse(bodyText));

    if (!parsed) {
      sendJson(response, 400, {
        extraction: EMPTY_AI_EXTRACTION,
        warnings: ["Invalid outline extraction request."],
      });
      return;
    }

    console.info("[gooseCalendar] AI extraction proxy received request", {
      courseCode: parsed.courseCode,
      outlineName: parsed.outlineName,
      inputChars: parsed.outlineText.length,
      hasOutlineHash: Boolean(parsed.outlineHash),
    });

    const cached = await readAiExtractionCache(parsed);
    if (cached.status === "hit") {
      sendJson(response, 200, {
        extraction: cached.extraction,
        warnings: cached.warnings,
      });
      return;
    }

    const textLimit = Number(process.env.OPENAI_OUTLINE_TEXT_LIMIT ?? DEFAULT_OUTLINE_TEXT_LIMIT);
    const outlineText =
      parsed.outlineText.length > textLimit
        ? parsed.outlineText.slice(0, textLimit)
        : parsed.outlineText;
    const truncationWarnings =
      outlineText.length < parsed.outlineText.length
        ? [
            `Outline text was truncated to ${textLimit} characters before AI extraction.`,
          ]
        : [];

    const result = await callOpenAi({
      ...parsed,
      outlineText,
    });
    if (result.cacheable) {
      await writeAiExtractionCache({
        request: parsed,
        model: result.model,
        extraction: result.extraction,
        warnings: [...truncationWarnings, ...result.warnings],
      });
    } else {
      console.info("[gooseCalendar] Skipping AI extraction cache write", {
        courseCode: parsed.courseCode,
        reason: "OpenAI result was not cacheable.",
        warnings: result.warnings.slice(0, 5),
      });
    }

    sendJson(response, 200, {
      extraction: result.extraction,
      warnings: [...truncationWarnings, ...result.warnings],
    });
  } catch (error) {
    sendJson(response, 400, {
      extraction: EMPTY_AI_EXTRACTION,
      warnings: [
        error instanceof Error
          ? `Outline extraction request failed: ${error.message}`
          : "Outline extraction request failed.",
      ],
    });
  }
}
