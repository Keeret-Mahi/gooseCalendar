import {
  EMPTY_AI_EXTRACTION,
  validateAiExtractionResponse,
  type AiExtractionResponse,
  type AiOutlineExtractionRequest,
} from "./aiExtractionSchema";

interface AiExtractionApiResponse {
  extraction?: unknown;
  warnings?: unknown;
}

const AI_CLIENT_ID_STORAGE_KEY = "goosecalendar:ai-client-id";

function getAnonymousAiClientId() {
  if (typeof window === "undefined") return "";

  try {
    const stored = window.localStorage.getItem(AI_CLIENT_ID_STORAGE_KEY);
    if (stored) return stored;

    const generated = globalThis.crypto?.randomUUID?.() ??
      `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
    window.localStorage.setItem(AI_CLIENT_ID_STORAGE_KEY, generated);
    return generated;
  } catch {
    return "";
  }
}

function normalizeWarning(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

async function readProxyResponse(response: Response) {
  const text = await response.text();
  if (!text) {
    return {
      body: {} as AiExtractionApiResponse,
      warnings: ["AI extraction proxy returned an empty response."],
    };
  }

  try {
    return {
      body: JSON.parse(text) as AiExtractionApiResponse,
      warnings: [],
    };
  } catch {
    return {
      body: {} as AiExtractionApiResponse,
      warnings: [
        "AI extraction proxy did not return JSON. Restart the Vite dev server and make sure you are using the Vite app URL, not a static file/build.",
      ],
    };
  }
}

export async function extractNonMeetingEventsWithAi(
  request: AiOutlineExtractionRequest
): Promise<AiExtractionResponse> {
  console.info("[gooseCalendar] Sending outline to AI extraction proxy", {
    outlineName: request.outlineName,
    courseCode: request.courseCode,
    extractionMode: request.extractionMode,
    sourceFormat: request.sourceFormat,
    hasOutlineHash: Boolean(request.outlineHash),
  });

  let response: Response;
  try {
    response = await fetch("/api/extract-outline-events", {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        "X-GooseCalendar-Client": getAnonymousAiClientId(),
      },
      body: JSON.stringify(request),
    });
  } catch (error) {
    const warning =
      error instanceof Error
        ? `AI extraction proxy request failed: ${error.message}`
        : "AI extraction proxy request failed.";
    console.warn("[gooseCalendar]", warning);
    return {
      ...EMPTY_AI_EXTRACTION,
      warnings: [warning],
    };
  }

  const { body, warnings: responseWarnings } = await readProxyResponse(response);
  const serverWarnings = Array.isArray(body.warnings)
    ? body.warnings.map(normalizeWarning).filter(Boolean)
    : [];
  const missingProxyShapeWarnings =
    !("extraction" in body) && !("warnings" in body)
      ? [
          "AI extraction proxy response was missing extraction data. The request probably did not reach the Vite proxy middleware.",
        ]
      : [];

  if (!response.ok) {
    const errorMessage =
      serverWarnings[0] ??
      responseWarnings[0] ??
      `AI extraction failed with HTTP ${response.status}.`;
    console.warn("[gooseCalendar] AI extraction proxy returned an error", {
      status: response.status,
      warnings: [...responseWarnings, ...serverWarnings],
    });
    throw new Error(errorMessage);
  }

  const validation = validateAiExtractionResponse(
    body.extraction ?? EMPTY_AI_EXTRACTION
  );

  return {
    events: validation.data.events,
    warnings: [
      ...responseWarnings,
      ...missingProxyShapeWarnings,
      ...serverWarnings,
      ...validation.data.warnings,
      ...validation.warnings,
    ],
  };
}
