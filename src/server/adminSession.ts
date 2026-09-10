import { createHash, createHmac, timingSafeEqual } from "node:crypto";

const ADMIN_COOKIE_NAME = "goosecalendar_admin";
const ADMIN_SESSION_DURATION_SECONDS = 8 * 60 * 60;
const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const MAX_LOGIN_ATTEMPTS = 5;
const loginAttempts = new Map<string, { count: number; resetAt: number }>();

function sendJson(response: any, statusCode: number, body: unknown) {
  response.statusCode = statusCode;
  response.setHeader("Cache-Control", "no-store");
  response.setHeader("Content-Type", "application/json");
  response.end(JSON.stringify(body));
}

function readHeader(request: any, name: string) {
  const value = request.headers?.[name];
  if (Array.isArray(value)) return value[0] ?? "";
  return typeof value === "string" ? value : "";
}

function clientKey(request: any) {
  const forwardedFor =
    readHeader(request, "x-vercel-forwarded-for") || readHeader(request, "x-forwarded-for");
  return (
    forwardedFor.split(",")[0]?.trim() ||
    readHeader(request, "x-real-ip").trim() ||
    request.socket?.remoteAddress ||
    "unknown"
  );
}

function stringsMatch(left: string, right: string) {
  const leftHash = createHash("sha256").update(left, "utf8").digest();
  const rightHash = createHash("sha256").update(right, "utf8").digest();
  return timingSafeEqual(leftHash, rightHash);
}

function sessionSignature(expiresAt: string, password: string) {
  return createHmac("sha256", password)
    .update(`goosecalendar-admin:${expiresAt}`, "utf8")
    .digest("base64url");
}

function createSessionToken(password: string) {
  const expiresAt = String(Date.now() + ADMIN_SESSION_DURATION_SECONDS * 1000);
  return `${expiresAt}.${sessionSignature(expiresAt, password)}`;
}

function isValidSessionToken(token: string, password: string) {
  const [expiresAt, signature, ...extraParts] = token.split(".");
  if (!expiresAt || !signature || extraParts.length > 0) return false;
  const expiration = Number(expiresAt);
  if (!Number.isFinite(expiration) || expiration <= Date.now()) return false;
  return stringsMatch(signature, sessionSignature(expiresAt, password));
}

export function isAdminSessionAuthenticated(request: any) {
  const configuredPassword = process.env.GOOSECALENDAR_ADMIN_PASSWORD?.trim() ?? "";
  if (!configuredPassword) return false;
  const token = readCookie(request, ADMIN_COOKIE_NAME);
  return Boolean(token && isValidSessionToken(token, configuredPassword));
}

function readCookie(request: any, name: string) {
  const cookieHeader = readHeader(request, "cookie");
  for (const part of cookieHeader.split(";")) {
    const separatorIndex = part.indexOf("=");
    if (separatorIndex < 0) continue;
    if (part.slice(0, separatorIndex).trim() !== name) continue;
    try {
      return decodeURIComponent(part.slice(separatorIndex + 1).trim());
    } catch {
      return "";
    }
  }
  return "";
}

function cookieSecurityAttribute() {
  return process.env.NODE_ENV === "production" || process.env.VERCEL ? "; Secure" : "";
}

function setSessionCookie(response: any, token: string) {
  response.setHeader(
    "Set-Cookie",
    `${ADMIN_COOKIE_NAME}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${ADMIN_SESSION_DURATION_SECONDS}${cookieSecurityAttribute()}`
  );
}

function clearSessionCookie(response: any) {
  response.setHeader(
    "Set-Cookie",
    `${ADMIN_COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0${cookieSecurityAttribute()}`
  );
}

async function readPassword(request: any) {
  let body: unknown = request.body;
  if (typeof body === "string" || Buffer.isBuffer(body)) {
    const bodyText = Buffer.isBuffer(body) ? body.toString("utf8") : body;
    if (Buffer.byteLength(bodyText, "utf8") > 4096) {
      throw new Error("Request body is too large.");
    }
    body = JSON.parse(bodyText || "{}");
  } else if (typeof body !== "object" || body === null) {
    const chunks: Buffer[] = [];
    let size = 0;
    for await (const chunk of request) {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      size += buffer.length;
      if (size > 4096) throw new Error("Request body is too large.");
      chunks.push(buffer);
    }
    body = JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
  }
  const password = (body as Record<string, unknown>).password;
  return typeof password === "string" ? password : "";
}

function consumeLoginAttempt(request: any) {
  const key = clientKey(request);
  const now = Date.now();
  const current = loginAttempts.get(key);
  if (!current || current.resetAt <= now) {
    loginAttempts.set(key, { count: 1, resetAt: now + LOGIN_WINDOW_MS });
    return true;
  }
  if (current.count >= MAX_LOGIN_ATTEMPTS) return false;
  current.count += 1;
  return true;
}

export async function handleAdminSessionRequest(request: any, response: any) {
  const configuredPassword = process.env.GOOSECALENDAR_ADMIN_PASSWORD?.trim() ?? "";
  if (!configuredPassword) {
    sendJson(response, 503, { authenticated: false, error: "Admin login is not configured." });
    return;
  }

  if (request.method === "GET") {
    sendJson(response, 200, {
      authenticated: isAdminSessionAuthenticated(request),
    });
    return;
  }

  if (request.method === "DELETE") {
    clearSessionCookie(response);
    sendJson(response, 200, { authenticated: false });
    return;
  }

  if (request.method !== "POST") {
    response.setHeader("Allow", "GET, POST, DELETE");
    sendJson(response, 405, { authenticated: false, error: "Method not allowed." });
    return;
  }

  if (!consumeLoginAttempt(request)) {
    sendJson(response, 429, {
      authenticated: false,
      error: "Too many attempts. Try again in 15 minutes.",
    });
    return;
  }

  try {
    const password = await readPassword(request);
    if (!password || !stringsMatch(password, configuredPassword)) {
      sendJson(response, 401, { authenticated: false, error: "Incorrect password." });
      return;
    }

    loginAttempts.delete(clientKey(request));
    setSessionCookie(response, createSessionToken(configuredPassword));
    sendJson(response, 200, { authenticated: true });
  } catch {
    sendJson(response, 400, { authenticated: false, error: "Invalid login request." });
  }
}
