// Local checks only: Firebase and OpenAI are stubbed. No credentials or paid calls are used.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { buildSync } = require("esbuild");

const root = path.resolve(__dirname, "..");
const quietConsole = { info() {}, warn() {}, error() {}, log() {} };
function loadModule(entry, options = {}) {
  const { outputFiles } = buildSync({
    entryPoints: [path.join(root, entry)], bundle: true, platform: "node",
    format: "cjs", packages: "external", write: false,
    define: options.define ?? {}, logLevel: "silent",
  });
  const module = { exports: {} };
  const context = {
    module, exports: module.exports,
    require: (name) => options.modules?.[name] ?? require(name),
    console: quietConsole, Buffer, URLSearchParams, AbortController, setTimeout, clearTimeout,
    process: { env: options.env ?? {} },
    ...options.globals,
  };
  vm.runInNewContext(outputFiles[0].text, context, { filename: entry });
  return module.exports;
}

function fakeFirestore() {
  const documents = new Map();
  const database = {
    documents,
    collection: (collection) => ({
      doc: (id) => ({
        async get() { return { exists: documents.has(`${collection}/${id}`), data: () => documents.get(`${collection}/${id}`) }; },
        async set(value, options) {
          const key = `${collection}/${id}`;
          documents.set(key, options?.merge ? { ...documents.get(key), ...value } : value);
        },
      }),
    }),
    runTransaction: async (callback) => callback({
      get: (reference) => reference.get(),
      set: (reference, value, options) => reference.set(value, options),
    }),
  };
  return database;
}

const request = {
  outlineName: "outline.html", courseCode: "TEST 101", courseName: "Test Course",
  term: "Fall 2026", termYear: 2026, extractionMode: "nonMeeting", sourceFormat: "html",
  outlineText: "Assignment 1 is due September 12.", outlineHash: "a".repeat(64),
};

async function baselineServerChecks() {
  const db = fakeFirestore();
  let paidCalls = 0;
  let lastAiBody;
  const env = {
    OPENAI_API_KEY: "test-not-a-real-key", OPENAI_MODEL: "gpt-4.1-mini", FIREBASE_PROJECT_ID: "test",
    FIREBASE_CLIENT_EMAIL: "test@example.invalid", FIREBASE_PRIVATE_KEY: "test",
  };
  const server = loadModule("src/server/openaiOutlineExtractor.ts", {
    env,
    modules: {
      "firebase-admin/app": { cert: (value) => value, getApps: () => [], initializeApp: () => ({}) },
      "firebase-admin/firestore": {
        getFirestore: () => db,
        FieldValue: { increment: () => 1, serverTimestamp: () => "test-timestamp" },
      },
    },
    globals: {
      fetch: async (_url, input) => {
        paidCalls += 1;
        lastAiBody = JSON.parse(input.body);
        await new Promise((resolve) => setTimeout(resolve, 10));
        return { ok: true, json: async () => ({ choices: [{ finish_reason: "stop", message: { content: '{"events":[],"warnings":[]}' } }] }) };
      },
    },
  });
  async function invoke(body) {
    const response = { setHeader() {}, end(text) { this.body = JSON.parse(text); } };
    await server.handleOutlineExtractionRequest({ method: "POST", body }, response);
    return response;
  }

  await invoke(request);
  await invoke({ ...request, outlineName: "renamed-file.html" });
  const renamedReusesCache = paidCalls === 1;
  await invoke({ ...request, outlineText: "Different content with the same supplied hash." });
  const trustsForgedClientHash = paidCalls !== 2;
  const beforeConcurrent = paidCalls;
  const concurrentRequest = {
    ...request,
    outlineText: "Assignment 2 is due October 20.",
    outlineHash: "b".repeat(64),
  };
  await Promise.all([invoke(concurrentRequest), invoke(concurrentRequest)]);
  const concurrentPaidCalls = paidCalls - beforeConcurrent;

  env.OPENAI_OUTLINE_TEXT_LIMIT = "10";
  await invoke({
    ...request,
    outlineText: "A deliberately long unique outline with Assignment 3 due November 15.",
    outlineHash: "c".repeat(64),
  });
  const truncatedReplyCached = [...db.documents.values()].some((data) => data.warnings?.some((warning) => /truncated/.test(warning)));
  delete env.OPENAI_API_KEY;
  const failed = await invoke({
    ...request,
    outlineText: "A unique outline that cannot reach OpenAI.",
    outlineHash: "d".repeat(64),
  });

  assert.equal(renamedReusesCache, true);
  assert.equal(trustsForgedClientHash, false);
  assert.equal(concurrentPaidCalls, 1);
  assert.equal(truncatedReplyCached, false);
  assert.equal(lastAiBody.store, false);
  assert.equal(failed.statusCode, 503);

  console.log(JSON.stringify({ baselineServerChecks: {
    renamedReusesCache, trustsForgedClientHash, concurrentPaidCalls,
    truncatedReplyCached, missingApiKeyHttpStatus: failed.statusCode,
    providerStorageExplicitlyDisabled: lastAiBody.store === false,
  } }, null, 2));
}

async function rateLimitChecks() {
  const db = fakeFirestore();
  let paidCalls = 0;
  const env = {
    OPENAI_API_KEY: "test-not-a-real-key",
    OPENAI_MODEL: "gpt-4.1-mini",
    FIREBASE_PROJECT_ID: "test",
    FIREBASE_CLIENT_EMAIL: "test@example.invalid",
    FIREBASE_PRIVATE_KEY: "test",
    AI_EXTRACTION_PER_CLIENT_DAILY_LIMIT: "1",
    AI_EXTRACTION_GLOBAL_DAILY_LIMIT: "10",
  };
  const server = loadModule("src/server/openaiOutlineExtractor.ts", {
    env,
    modules: {
      "firebase-admin/app": { cert: (value) => value, getApps: () => [], initializeApp: () => ({}) },
      "firebase-admin/firestore": {
        getFirestore: () => db,
        FieldValue: { increment: () => 1, serverTimestamp: () => "test-timestamp" },
      },
    },
    globals: {
      fetch: async () => {
        paidCalls += 1;
        return { ok: true, json: async () => ({ choices: [{ finish_reason: "stop", message: { content: '{"events":[],"warnings":[]}' } }] }) };
      },
    },
  });
  async function invoke(body) {
    const response = { headers: {}, setHeader(name, value) { this.headers[name] = value; }, end(text) { this.body = JSON.parse(text); } };
    await server.handleOutlineExtractionRequest({
      method: "POST",
      body,
      headers: {
        "x-forwarded-for": "203.0.113.10",
        "x-goosecalendar-client": "test-browser-client-1234",
      },
    }, response);
    return response;
  }

  const first = await invoke({ ...request, outlineText: "First new outline." });
  const second = await invoke({ ...request, outlineText: "Second new outline." });
  assert.equal(first.statusCode, 200);
  assert.equal(second.statusCode, 429);
  assert.equal(paidCalls, 1);
  assert.ok(Number(second.headers["Retry-After"]) > 0);
  console.log("PASS: uncached AI extraction requests are rate limited before a paid call.");
}

async function analyticsChecks() {
  let catalog = [];
  for (const scenario of ["configured", "debug", "missing", "blocked"]) {
    const events = [];
    const warnings = [];
    const analytics = loadModule("src/app/lib/analytics.ts", {
      define: { "import.meta.env": JSON.stringify(scenario === "missing" ? {} : {
        VITE_FIREBASE_API_KEY: "test", VITE_FIREBASE_PROJECT_ID: "test",
        VITE_FIREBASE_APP_ID: "test", VITE_FIREBASE_MEASUREMENT_ID: "G-TEST123456",
      }) },
      globals: {
        window: { location: { search: scenario === "debug" ? "?analytics_debug=1" : "" } },
        console: { ...quietConsole, warn: (...values) => warnings.push(values) },
      },
      modules: {
        "firebase/app": { getApps: () => [], initializeApp: () => ({}) },
        "firebase/analytics": {
          isSupported: async () => true, getAnalytics: () => ({}),
          logEvent: (_analytics, name, params) => {
            if (scenario === "blocked") throw new Error("blocked");
            events.push({ name, params });
          },
        },
      },
    });
    catalog = Array.from(analytics.ANALYTICS_EVENT_NAMES);
    const eventNames = scenario === "configured" || scenario === "debug"
      ? catalog
      : ["home_page_view"];
    for (const eventName of eventNames) {
      await analytics.trackAnalyticsEvent(eventName, {
        page_path: "/",
        message: "x".repeat(150),
      });
    }
    if (scenario === "missing" || scenario === "blocked") {
      assert.equal(events.length, 0);
      assert.equal(warnings.length, 1);
    } else {
      assert.equal(events.length, catalog.length);
      assert.ok(events.every((event) => event.params.message.length === 100));
      assert.ok(events.every((event) =>
        event.params.debug_mode === (scenario === "debug" ? true : undefined)
      ));
    }
  }

  assert.equal(catalog.length, 11);
  const analyticsCallSites = [
    "src/app/components/AppContext.tsx",
    "src/app/components/ExportPage.tsx",
    "src/app/components/ReviewClassesPage.tsx",
    "src/app/components/SelectSectionsPage.tsx",
    "src/app/components/UploadPage.tsx",
  ].map((file) => fs.readFileSync(path.join(root, file), "utf8")).join("\n");
  const usedEventNames = Array.from(
    new Set(Array.from(analyticsCallSites.matchAll(/trackAnalyticsEvent\(\s*"([a-z0-9_]+)"/g), (match) => match[1]))
  ).sort();
  assert.deepEqual(usedEventNames, [...catalog].sort());

  console.log("PASS: all 11 analytics events are valid, used, delivered, and parameter-safe.");
}

(async () => {
  await baselineServerChecks();
  await rateLimitChecks();
  await analyticsChecks();
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
