import { getApps, initializeApp } from "firebase/app";
import { getAnalytics, isSupported, logEvent } from "firebase/analytics";

type AnalyticsParams = Record<string, string | number | boolean>;

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

export async function trackAnalyticsEvent(name: string, params: AnalyticsParams = {}) {
  try {
    const analytics = await getFirebaseAnalytics();
    if (!analytics) return;
    // Opt-in test visits appear in GA4 DebugView without enabling debug mode for everyone.
    logEvent(analytics, name, {
      ...params,
      ...(isAnalyticsDebugSession() ? { debug_mode: true } : {}),
    });
  } catch (error) {
    // Analytics must not interrupt uploads or exports, including when blocked by the browser.
    console.warn("[gooseCalendar] Analytics event could not be recorded", {
      event: name,
      message: error instanceof Error ? error.message : String(error),
    });
  }
}
