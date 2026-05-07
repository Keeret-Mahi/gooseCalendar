import {
  AI_EXTRACTION_JSON_SCHEMA,
  EMPTY_AI_EXTRACTION,
  validateAiExtractionResponse,
  type AiOutlineExtractionRequest,
} from "../app/lib/aiExtractionSchema";

const DEFAULT_MODEL = "gpt-4.1-mini";
const DEFAULT_OUTLINE_TEXT_LIMIT = 45_000;

type OpenAiUsage = {
  prompt_tokens?: number;
  completion_tokens?: number;
  total_tokens?: number;
  prompt_tokens_details?: {
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

Labeling examples:
- good: \`Assignment #2\`
- good: \`Assignment #2 Published\`
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
  } satisfies AiOutlineExtractionRequest;
}

function parseOpenAiContent(content: unknown) {
  if (typeof content !== "string") {
    return EMPTY_AI_EXTRACTION;
  }
  try {
    return JSON.parse(content);
  } catch {
    return EMPTY_AI_EXTRACTION;
  }
}

function readTokenCount(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
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

async function callOpenAi(request: AiOutlineExtractionRequest) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey || apiKey === "undefined") {
    console.warn("[gooseCalendar] AI extraction skipped: OPENAI_API_KEY is not configured.");
    return {
      extraction: EMPTY_AI_EXTRACTION,
      warnings: [
        "AI extraction skipped because OPENAI_API_KEY is not configured on the local server.",
      ],
    };
  }

  const model =
    process.env.OPENAI_MODEL && process.env.OPENAI_MODEL !== "undefined"
      ? process.env.OPENAI_MODEL
      : DEFAULT_MODEL;
  const baseUrl =
    process.env.OPENAI_API_BASE_URL && process.env.OPENAI_API_BASE_URL !== "undefined"
      ? process.env.OPENAI_API_BASE_URL
      : "https://api.openai.com/v1";
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 60_000);

  try {
    console.info("[gooseCalendar] Calling OpenAI for outline extraction", {
      model,
      courseCode: request.courseCode,
      outlineName: request.outlineName,
      inputChars: request.outlineText.length,
    });

    const response = await fetch(`${baseUrl.replace(/\/+$/, "")}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      signal: controller.signal,
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
        max_completion_tokens: 3000,
      }),
    });

    const data = await response.json().catch(() => undefined);
    if (!response.ok) {
      const message =
        typeof data?.error?.message === "string"
          ? data.error.message
          : `OpenAI request failed with HTTP ${response.status}.`;
      console.warn("[gooseCalendar] OpenAI extraction request failed", {
        status: response.status,
        message,
      });
      return {
        extraction: EMPTY_AI_EXTRACTION,
        warnings: [message],
      };
    }

    const content = data?.choices?.[0]?.message?.content;
    const validation = validateAiExtractionResponse(parseOpenAiContent(content));
    const cost = estimateOpenAiCost(model, data?.usage);
    console.info("[gooseCalendar] OpenAI extraction completed", {
      courseCode: request.courseCode,
      model,
      eventCount: validation.data.events.length,
      warningCount: validation.warnings.length + validation.data.warnings.length,
      promptTokens: cost?.inputTokens ?? data?.usage?.prompt_tokens,
      cachedPromptTokens: cost?.cachedInputTokens ?? data?.usage?.prompt_tokens_details?.cached_tokens,
      completionTokens: cost?.outputTokens ?? data?.usage?.completion_tokens,
      totalTokens: cost?.totalTokens ?? data?.usage?.total_tokens,
      estimatedCostUsd: cost?.estimatedCostUsd ?? null,
      estimatedCostDisplay: cost?.estimatedCostDisplay ?? "unknown model pricing",
      pricingModelPrefix: cost?.pricingModelPrefix,
    });

    return {
      extraction: validation.data,
      warnings: validation.warnings,
    };
  } catch (error) {
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
    });

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
