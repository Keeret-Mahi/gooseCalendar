import { getApps, initializeApp } from "firebase/app";
import { getAnalytics, isSupported, logEvent } from "firebase/analytics";

type AnalyticsParams = Record<string, string | number | boolean>;

export const ANALYTICS_EVENT_NAMES = [
  "home_page_view",
  "outline_upload_attempted",
  "outline_upload_accepted",
  "upload_next_sections_clicked",
  "sections_review_clicked",
  "review_export_clicked",
  "export_ics_clicked",
  "export_ics_downloaded",
  "export_google_clicked",
  "export_google_succeeded",
  "export_google_failed",
] as const;

export type AnalyticsEventName = (typeof ANALYTICS_EVENT_NAMES)[number];

const EVENT_NAME_PATTERN = /^[A-Za-z][A-Za-z0-9_]{0,39}$/;
const PARAMETER_NAME_PATTERN = /^[A-Za-z][A-Za-z0-9_]{0,39}$/;
const RESERVED_PREFIX_PATTERN = /^(?:firebase_|ga_|google_)/;
const RESERVED_EVENT_NAMES = new Set([
  "app_remove",
  "app_store_refund",
  "app_store_subscription_cancel",
  "app_store_subscription_renew",
  "click",
  "error",
  "file_download",
  "first_open",
  "first_visit",
  "form_start",
  "form_submit",
  "in_app_purchase",
  "page_view",
  "scroll",
  "session_start",
  "user_engagement",
  "video_progress",
  "video_start",
  "view_complete",
  "view_search_results",
]);

function isValidEventName(name: string) {
  return EVENT_NAME_PATTERN.test(name) &&
    !RESERVED_PREFIX_PATTERN.test(name) &&
    !RESERVED_EVENT_NAMES.has(name);
}

function sanitizeAnalyticsParams(params: AnalyticsParams, maximumCount: number) {
  return Object.fromEntries(
    Object.entries(params)
      .filter(([name]) =>
        PARAMETER_NAME_PATTERN.test(name) &&
        !RESERVED_PREFIX_PATTERN.test(name) &&
        !name.startsWith("_") &&
        !name.startsWith("gtag.")
      )
      .slice(0, maximumCount)
      .map(([name, value]) => [
        name,
        typeof value === "string" ? value.slice(0, 100) : value,
      ])
  );
}

const firebaseAnalyticsConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY?.trim() ?? "",
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN?.trim() ?? "",
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID?.trim() ?? "",
  appId: import.meta.env.VITE_FIREBASE_APP_ID?.trim() ?? "",
  measurementId: import.meta.env.VITE_FIREBASE_MEASUREMENT_ID?.trim() ?? "",
};

let analyticsPromise: Promise<ReturnType<typeof getAnalytics> | null> | null = null;
let hasWarnedMissingConfig = false;

function isAnalyticsDebugSession() {
  return typeof window !== "undefined" &&
    new URLSearchParams(window.location.search).get("analytics_debug") === "1";
}

function hasAnalyticsConfig() {
  return Boolean(
    firebaseAnalyticsConfig.apiKey &&
      firebaseAnalyticsConfig.projectId &&
      firebaseAnalyticsConfig.appId &&
      firebaseAnalyticsConfig.measurementId
  );
}

async function getFirebaseAnalytics() {
  if (!hasAnalyticsConfig() || typeof window === "undefined") {
    if (typeof window !== "undefined" && !hasWarnedMissingConfig) {
      console.warn("[gooseCalendar] Analytics is not configured in this build. Set VITE_FIREBASE_* before building and redeploy.");
      hasWarnedMissingConfig = true;
    }
    return null;
  }

  analyticsPromise ??= isSupported()
    .then((supported) => {
      if (!supported) return null;
      const app = getApps()[0] ?? initializeApp(firebaseAnalyticsConfig);
      return getAnalytics(app);
    })
    .catch((error) => {
      console.warn("[gooseCalendar] Firebase Analytics unavailable", {
        message: error instanceof Error ? error.message : String(error),
      });
      return null;
    });

  return analyticsPromise;
}

export async function trackAnalyticsEvent(name: AnalyticsEventName, params: AnalyticsParams = {}) {
  try {
    if (!isValidEventName(name)) {
      console.warn("[gooseCalendar] Invalid Firebase Analytics event name", { event: name });
      return;
    }

    const analytics = await getFirebaseAnalytics();
    if (!analytics) return;
    const debugMode = isAnalyticsDebugSession();
    // Opt-in test visits appear in GA4 DebugView without enabling debug mode for everyone.
    logEvent(analytics, name, {
      ...sanitizeAnalyticsParams(params, debugMode ? 24 : 25),
      ...(debugMode ? { debug_mode: true } : {}),
    });
  } catch (error) {
    // Analytics must not interrupt uploads or exports, including when blocked by the browser.
    console.warn("[gooseCalendar] Analytics event could not be recorded", {
      event: name,
      message: error instanceof Error ? error.message : String(error),
    });
  }
}
