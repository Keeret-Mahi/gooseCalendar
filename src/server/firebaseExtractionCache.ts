import { cert, getApps, initializeApp } from "firebase-admin/app";
import { FieldValue, getFirestore } from "firebase-admin/firestore";
import {
  validateAiExtractionResponse,
  type AiExtractionResponse,
  type AiOutlineExtractionRequest,
} from "../app/lib/aiExtractionSchema";

export const AI_CACHE_VERSION = "v1";

const CACHE_COLLECTION = "outlineAiExtractionCache";
const HASH_PATTERN = /^[a-f0-9]{64}$/i;
let hasLoggedMissingFirebaseConfig = false;

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
  return value.replace(/\\n/g, "\n");
}

function isCacheEnabled() {
  return process.env.AI_EXTRACTION_CACHE_ENABLED?.toLowerCase() !== "false";
}

function getFirebaseConfig() {
  const projectId = process.env.FIREBASE_PROJECT_ID;
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
  const privateKey = process.env.FIREBASE_PRIVATE_KEY;

  if (!projectId || !clientEmail || !privateKey) {
    return undefined;
  }

  return {
    projectId,
    clientEmail,
    privateKey: normalizePrivateKey(privateKey),
  };
}

function getCacheDb() {
  if (!isCacheEnabled()) {
    return undefined;
  }

  const firebaseConfig = getFirebaseConfig();
  if (!firebaseConfig) {
    if (!hasLoggedMissingFirebaseConfig) {
      console.warn(
        "[gooseCalendar] AI extraction cache disabled: Firebase Admin env vars are incomplete."
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
