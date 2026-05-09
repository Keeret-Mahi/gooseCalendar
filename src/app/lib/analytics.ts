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
  const analytics = await getFirebaseAnalytics();
  if (!analytics) return;
  logEvent(analytics, name, params);
}
