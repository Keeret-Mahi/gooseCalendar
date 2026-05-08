import { cert, getApps, initializeApp } from "firebase-admin/app";
import { FieldValue, getFirestore } from "firebase-admin/firestore";
import {
  validateAiExtractionResponse,
  type AiExtractionResponse,
  type AiOutlineExtractionRequest,
} from "../app/lib/aiExtractionSchema.js";

export const AI_CACHE_VERSION = "v1";

const CACHE_COLLECTION = "outlineAiExtractionCache";
const HASH_PATTERN = /^[a-f0-9]{64}$/i;
let hasLoggedMissingFirebaseConfig = false;
let hasLoggedFirebaseConfigSource = false;

interface CacheWriteInput {
  request: AiOutlineExtractionRequest;
  model: string;
  extraction: AiExtractionResponse;
  warnings: string[];
}

interface CacheHit {
  status: "hit";
  cacheKey: string;
  extraction: AiExtractionResponse;
  warnings: string[];
}

interface CacheMiss {
  status: "disabled" | "miss" | "invalid" | "error";
  cacheKey?: string;
}

type CacheReadResult = CacheHit | CacheMiss;

function normalizeWarning(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function normalizePrivateKey(value: string) {
  let normalized = value.trim();

  try {
    const parsed = JSON.parse(normalized);
    if (typeof parsed === "string") {
      normalized = parsed;
    } else if (
      typeof parsed === "object" &&
      parsed !== null &&
      "private_key" in parsed &&
      typeof parsed.private_key === "string"
    ) {
      normalized = parsed.private_key;
    }
  } catch {
    if (
      (normalized.startsWith('"') && normalized.endsWith('"')) ||
      (normalized.startsWith("'") && normalized.endsWith("'"))
    ) {
      normalized = normalized.slice(1, -1);
    }
  }

  normalized = normalized
    .replace(/\\\\r\\\\n/g, "\n")
    .replace(/\\\\n/g, "\n")
    .replace(/\\r\\n/g, "\n")
    .replace(/\\n/g, "\n")
    .replace(/\r\n/g, "\n");

  const beginMarker = "-----BEGIN PRIVATE KEY-----";
  const endMarker = "-----END PRIVATE KEY-----";
  const beginIndex = normalized.indexOf(beginMarker);
  const endIndex = normalized.indexOf(endMarker);
  if (beginIndex >= 0 && endIndex >= beginIndex) {
    normalized = normalized.slice(beginIndex, endIndex + endMarker.length);
  }

  return normalized.endsWith("\n") ? normalized : `${normalized}\n`;
}

function isCacheEnabled() {
  return process.env.AI_EXTRACTION_CACHE_ENABLED?.toLowerCase() !== "false";
}

function readServiceAccountJson() {
  const raw =
    process.env.FIREBASE_SERVICE_ACCOUNT_JSON ||
    process.env.FIREBASE_ADMIN_CREDENTIALS ||
    "";
  const trimmed = raw.trim();
  if (!trimmed) {
    return undefined;
  }

  try {
    return JSON.parse(trimmed) as Record<string, unknown>;
  } catch (error) {
    console.warn("[gooseCalendar] Firebase service account JSON could not be parsed", {
      message: error instanceof Error ? error.message : "Unknown error",
    });
    return undefined;
  }
}

function getFirebaseConfig() {
  const serviceAccount = readServiceAccountJson();
  const projectId =
    process.env.FIREBASE_PROJECT_ID ||
    (typeof serviceAccount?.project_id === "string" ? serviceAccount.project_id : "");
  const clientEmail =
    process.env.FIREBASE_CLIENT_EMAIL ||
    (typeof serviceAccount?.client_email === "string" ? serviceAccount.client_email : "");
  const privateKey =
    process.env.FIREBASE_PRIVATE_KEY ||
    (typeof serviceAccount?.private_key === "string" ? serviceAccount.private_key : "");

  if (!projectId || !clientEmail || !privateKey) {
    return undefined;
  }

  const normalizedPrivateKey = normalizePrivateKey(privateKey);

  if (!hasLoggedFirebaseConfigSource) {
    console.info("[gooseCalendar] Firebase Admin config loaded", {
      hasProjectId: Boolean(projectId),
      hasClientEmail: Boolean(clientEmail),
      hasPrivateKey: Boolean(privateKey),
      privateKeyHasPemMarkers: privateKey.includes("BEGIN PRIVATE KEY"),
      privateKeyHasEscapedNewlines: privateKey.includes("\\n"),
      privateKeyHasActualNewlines: privateKey.includes("\n"),
      normalizedPrivateKeyStartsWithPem: normalizedPrivateKey.startsWith(
        "-----BEGIN PRIVATE KEY-----"
      ),
      normalizedPrivateKeyEndsWithPem: normalizedPrivateKey
        .trim()
        .endsWith("-----END PRIVATE KEY-----"),
      normalizedPrivateKeyLineCount: normalizedPrivateKey.split("\n").length,
      source: serviceAccount ? "service_account_json_or_env" : "individual_env_vars",
    });
    hasLoggedFirebaseConfigSource = true;
  }

  return {
    projectId,
    clientEmail,
    privateKey: normalizedPrivateKey,
  };
}

function getCacheDb() {
  if (!isCacheEnabled()) {
    console.info("[gooseCalendar] AI extraction cache disabled by env", {
      AI_EXTRACTION_CACHE_ENABLED: process.env.AI_EXTRACTION_CACHE_ENABLED,
    });
    return undefined;
  }

  const firebaseConfig = getFirebaseConfig();
  if (!firebaseConfig) {
    if (!hasLoggedMissingFirebaseConfig) {
      const missingKeys = [
        !process.env.FIREBASE_PROJECT_ID ? "FIREBASE_PROJECT_ID" : "",
        !process.env.FIREBASE_CLIENT_EMAIL ? "FIREBASE_CLIENT_EMAIL" : "",
        !process.env.FIREBASE_PRIVATE_KEY ? "FIREBASE_PRIVATE_KEY" : "",
      ].filter(Boolean);
      console.warn(
        "[gooseCalendar] AI extraction cache disabled: Firebase Admin env vars are incomplete.",
        { missingKeys }
      );
      hasLoggedMissingFirebaseConfig = true;
    }
    return undefined;
  }

  const app =
    getApps().find((candidate) => candidate.name === "goosecalendar-cache") ??
    initializeApp(
      {
        credential: cert(firebaseConfig),
        projectId: firebaseConfig.projectId,
      },
      "goosecalendar-cache"
    );

  return getFirestore(app);
}

function buildCacheKey(request: AiOutlineExtractionRequest) {
  if (!request.outlineHash || !HASH_PATTERN.test(request.outlineHash)) {
    return undefined;
  }

  return `${AI_CACHE_VERSION}_${request.termYear}_${request.outlineHash.toLowerCase()}`;
}

export async function readAiExtractionCache(
  request: AiOutlineExtractionRequest
): Promise<CacheReadResult> {
  const cacheKey = buildCacheKey(request);
  if (!cacheKey) {
    console.info("[gooseCalendar] AI extraction cache skipped: no valid outline hash", {
      courseCode: request.courseCode,
      termYear: request.termYear,
      hasOutlineHash: Boolean(request.outlineHash),
      outlineHashLength: request.outlineHash?.length ?? 0,
    });
    return { status: "disabled" };
  }

  try {
    const db = getCacheDb();
    if (!db) {
      return { status: "disabled", cacheKey };
    }

    const ref = db.collection(CACHE_COLLECTION).doc(cacheKey);
    const snapshot = await ref.get();
    if (!snapshot.exists) {
      console.info("[gooseCalendar] AI extraction cache miss", {
        cacheKey,
        courseCode: request.courseCode,
      });
      return { status: "miss", cacheKey };
    }

    const data = snapshot.data() ?? {};
    const expectedHash = request.outlineHash?.toLowerCase();
    if (
      data.outlineHash !== expectedHash ||
      data.termYear !== request.termYear ||
      data.cacheVersion !== AI_CACHE_VERSION
    ) {
      console.warn("[gooseCalendar] AI extraction cache metadata is invalid", {
        cacheKey,
      });
      return { status: "invalid", cacheKey };
    }

    const validation = validateAiExtractionResponse(data.extraction);
    if (!validation.ok) {
      console.warn("[gooseCalendar] AI extraction cache entry is invalid", {
        cacheKey,
        warnings: validation.warnings,
      });
      return { status: "invalid", cacheKey };
    }

    await ref
      .set(
        {
          hitCount: FieldValue.increment(1),
          lastUsedAt: FieldValue.serverTimestamp(),
          updatedAt: FieldValue.serverTimestamp(),
        },
        { merge: true }
      )
      .catch((error) => {
        console.warn("[gooseCalendar] Failed to update AI extraction cache hit stats", {
          cacheKey,
          message: error instanceof Error ? error.message : "Unknown error",
        });
      });

    const cachedWarnings = Array.isArray(data.warnings)
      ? data.warnings.map(normalizeWarning).filter(Boolean)
      : [];

    console.info("[gooseCalendar] AI extraction cache hit", {
      cacheKey,
      courseCode: request.courseCode,
      eventCount: validation.data.events.length,
      skippedOpenAi: true,
      estimatedCostDisplay: "$0.000",
    });

    return {
      status: "hit",
      cacheKey,
      extraction: validation.data,
      warnings: cachedWarnings,
    };
  } catch (error) {
    console.warn("[gooseCalendar] AI extraction cache read failed; falling back to OpenAI", {
      cacheKey,
      message: error instanceof Error ? error.message : "Unknown error",
    });
    return { status: "error", cacheKey };
  }
}

export async function writeAiExtractionCache(input: CacheWriteInput) {
  const cacheKey = buildCacheKey(input.request);
  if (!cacheKey) {
    console.info("[gooseCalendar] Skipping AI extraction cache write: no valid outline hash", {
      courseCode: input.request.courseCode,
      termYear: input.request.termYear,
      hasOutlineHash: Boolean(input.request.outlineHash),
      outlineHashLength: input.request.outlineHash?.length ?? 0,
    });
    return;
  }

  try {
    const db = getCacheDb();
    if (!db) {
      return;
    }

    const validation = validateAiExtractionResponse(input.extraction);
    if (!validation.ok) {
      console.warn("[gooseCalendar] Skipping AI extraction cache write: invalid extraction", {
        cacheKey,
        warnings: validation.warnings,
      });
      return;
    }

    await db
      .collection(CACHE_COLLECTION)
      .doc(cacheKey)
      .set(
        {
          outlineHash: input.request.outlineHash?.toLowerCase(),
          termYear: input.request.termYear,
          cacheVersion: AI_CACHE_VERSION,
          courseCode: input.request.courseCode,
          courseName: input.request.courseName,
          outlineName: input.request.outlineName,
          model: input.model,
          extraction: validation.data,
          warnings: input.warnings.map(normalizeWarning).filter(Boolean),
          eventCount: validation.data.events.length,
          hitCount: 0,
          createdAt: FieldValue.serverTimestamp(),
          updatedAt: FieldValue.serverTimestamp(),
        },
        { merge: true }
      );

    console.info("[gooseCalendar] AI extraction cache write completed", {
      cacheKey,
      courseCode: input.request.courseCode,
      eventCount: validation.data.events.length,
    });
  } catch (error) {
    console.warn("[gooseCalendar] AI extraction cache write failed", {
      cacheKey,
      message: error instanceof Error ? error.message : "Unknown error",
    });
  }
}
