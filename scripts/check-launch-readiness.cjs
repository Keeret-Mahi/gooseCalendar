// Local checks only: Firebase and OpenAI are stubbed. No credentials or paid calls are used.
const assert = require("node:assert/strict");
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
  return {
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
  };
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
  const trustsForgedClientHash = paidCalls === 1;
  const beforeConcurrent = paidCalls;
  await Promise.all([invoke({ ...request, outlineHash: "b".repeat(64) }), invoke({ ...request, outlineHash: "b".repeat(64) })]);
  const concurrentPaidCalls = paidCalls - beforeConcurrent;

  env.OPENAI_OUTLINE_TEXT_LIMIT = "10";
  await invoke({ ...request, outlineHash: "c".repeat(64) });
  const truncatedReplyCached = [...db.documents.values()].some((data) => data.warnings?.some((warning) => /truncated/.test(warning)));
  delete env.OPENAI_API_KEY;
  const failed = await invoke({ ...request, outlineHash: "d".repeat(64) });

  console.log(JSON.stringify({ baselineServerChecks: {
    renamedReusesCache, trustsForgedClientHash, concurrentPaidCalls,
    truncatedReplyCached, missingApiKeyHttpStatus: failed.statusCode,
    providerStorageExplicitlyDisabled: lastAiBody.store === false,
  } }, null, 2));
}

async function analyticsChecks() {
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
    await analytics.trackAnalyticsEvent("home_page_view", { page_path: "/" });
    if (scenario === "missing" || scenario === "blocked") {
      assert.equal(events.length, 0);
      assert.equal(warnings.length, 1);
    } else {
      assert.equal(events.length, 1);
      assert.equal(events[0].params.debug_mode, scenario === "debug" ? true : undefined);
    }
  }
  console.log("PASS: analytics configuration, opt-in DebugView, missing config, blocked analytics.");
}

(async () => { await baselineServerChecks(); await analyticsChecks(); })().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
