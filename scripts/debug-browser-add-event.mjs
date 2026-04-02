const outlinePath = process.argv[2];

if (!outlinePath) {
  console.error("Usage: node scripts/debug-browser-add-event.mjs <outline-path>");
  process.exit(1);
}

async function getJson(url) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Request failed: ${url} (${response.status})`);
  }
  return response.json();
}

class CdpClient {
  constructor(wsUrl) {
    this.ws = new WebSocket(wsUrl);
    this.id = 0;
    this.pending = new Map();
    this.ready = new Promise((resolve, reject) => {
      this.ws.addEventListener("open", resolve, { once: true });
      this.ws.addEventListener("error", reject, { once: true });
    });

    this.ws.addEventListener("message", (event) => {
      const message = JSON.parse(event.data);
      if (!("id" in message)) return;
      const pending = this.pending.get(message.id);
      if (!pending) return;
      this.pending.delete(message.id);
      if (message.error) {
        pending.reject(new Error(message.error.message));
      } else {
        pending.resolve(message.result);
      }
    });
  }

  async send(method, params = {}) {
    await this.ready;
    const id = ++this.id;
    const payload = JSON.stringify({ id, method, params });
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(payload);
    });
  }

  async evaluate(expression) {
    const result = await this.send("Runtime.evaluate", {
      expression,
      awaitPromise: true,
      returnByValue: true,
    });
    return result.result?.value;
  }

  close() {
    this.ws.close();
  }
}

async function waitFor(fn, timeoutMs = 10000, intervalMs = 100) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const value = await fn();
    if (value) return value;
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  throw new Error("Timed out waiting for condition");
}

function pageExpression(source) {
  return `(() => { ${source} })()`;
}

function containsBodyTextSnippet(snippet) {
  return pageExpression(`
    return document.body.textContent.toLowerCase().includes(${JSON.stringify(
      snippet.toLowerCase()
    )});
  `);
}

const targets = await getJson("http://127.0.0.1:9222/json/list");
const page = targets.find((target) => target.url.startsWith("http://127.0.0.1:4173"));

if (!page) {
  throw new Error("Could not find GooseCalendar tab in Chrome");
}

const client = new CdpClient(page.webSocketDebuggerUrl);

try {
  await client.send("Page.enable");
  await client.send("Runtime.enable");
  await client.send("DOM.enable");

  await client.send("Page.navigate", { url: "http://127.0.0.1:4173/" });
  await waitFor(() =>
    client.evaluate(pageExpression(`
      return document.readyState === "complete" &&
        document.body.textContent.includes("Upload");
    `))
  );

  const { root } = await client.send("DOM.getDocument", { depth: -1, pierce: true });
  const { nodeId } = await client.send("DOM.querySelector", {
    nodeId: root.nodeId,
    selector: 'input[type="file"]',
  });

  if (!nodeId) {
    throw new Error("Could not find file input on upload page");
  }

  await client.send("DOM.setFileInputFiles", {
    nodeId,
    files: [outlinePath],
  });

  await waitFor(() =>
    client.evaluate(pageExpression(`
      return document.body.textContent.includes("Parsed") &&
        !document.body.textContent.includes("Parsing outlines...");
    `)),
    20000
  );

  await client.evaluate(pageExpression(`
    const button = Array.from(document.querySelectorAll("button")).find((node) =>
      node.textContent?.includes("Next: Select Sections")
    );
    if (!button) return false;
    button.click();
    return true;
  `));

  await waitFor(() =>
    client.evaluate(containsBodyTextSnippet("Select Date Types to Add"))
  );

  await client.evaluate(pageExpression(`
    const button = Array.from(document.querySelectorAll("button")).find((node) =>
      node.textContent?.includes("Next: Review Classes")
    );
    if (!button) return false;
    button.click();
    return true;
  `));

  await waitFor(() =>
    client.evaluate(containsBodyTextSnippet("Review Classes Overview"))
  );

  await client.evaluate(pageExpression(`
    const button = Array.from(document.querySelectorAll("button")).find((node) =>
      node.textContent?.includes("Ready to Export")
    );
    if (!button) return false;
    button.click();
    return true;
  `));

  await waitFor(() =>
    client.evaluate(containsBodyTextSnippet("Add an event"))
  );

  await client.evaluate(pageExpression(`
    const button = Array.from(document.querySelectorAll("button")).find((node) =>
      node.textContent?.trim() === "Add Event"
    );
    if (!button) return false;
    button.click();
    return true;
  `));

  await waitFor(() =>
    client.evaluate(pageExpression(`
      return Array.from(document.querySelectorAll("button")).some((node) =>
        node.textContent?.trim() === "Assignment"
      );
    `))
  );

  const clickedType = await client.evaluate(pageExpression(`
    const button = Array.from(document.querySelectorAll("button")).find((node) =>
      node.textContent?.trim() === "Assignment"
    );
    if (!button) return false;
    button.click();
    return true;
  `));

  const modalOpen = await waitFor(() =>
    client.evaluate(
      containsBodyTextSnippet("Enter the event details, then add it to this course.")
    ),
    5000
  ).catch(() => false);

  const bodyText = await client.evaluate(pageExpression(`
    return document.body.textContent.replace(/\\s+/g, " ").trim();
  `));

  console.log(
    JSON.stringify(
      {
        clickedType,
        modalOpen,
        bodyText,
      },
      null,
      2
    )
  );
} finally {
  client.close();
}
