import { createServer as createHttpServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { extname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

import {
  ASSESSMENT_JSON_SCHEMA,
  DEFAULT_TELEMETRY,
  EMA_OBSERVATION_WEIGHT,
  EMA_PREVIOUS_WEIGHT,
  RUBRIC_VERSION,
  TELEMETRY_DIMENSIONS,
  TELEMETRY_RUBRIC,
  buildAssessmentMessages,
  buildAssistantSystemPrompt,
  normalizeAssessment,
  reduceTelemetry,
} from "./lib/telemetry.mjs";
import {
  ProviderError,
  createProvider,
  getPublicConfig,
  getRuntimeConfig,
} from "./lib/providers.mjs";
import {
  HttpError,
  REQUEST_LIMITS,
  validateAssessBody,
  validateRespondBody,
} from "./lib/validation.mjs";

const SERVER_DIR = fileURLToPath(new URL(".", import.meta.url));
const DEFAULT_DIST_DIR = resolve(SERVER_DIR, "..", "dist");
const SERVICE_NAME = "nirvana-telemetry";
const SERVICE_VERSION = "0.1.0";

const MIME_TYPES = Object.freeze({
  ".css": "text/css; charset=utf-8",
  ".gif": "image/gif",
  ".html": "text/html; charset=utf-8",
  ".ico": "image/x-icon",
  ".jpeg": "image/jpeg",
  ".jpg": "image/jpeg",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".map": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".webp": "image/webp",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
});

function setSecurityHeaders(response) {
  response.setHeader("x-content-type-options", "nosniff");
  response.setHeader("referrer-policy", "no-referrer");
  response.setHeader("x-frame-options", "DENY");
}

export function sendJson(response, status, payload) {
  const body = JSON.stringify(payload);
  response.statusCode = status;
  response.setHeader("content-type", "application/json; charset=utf-8");
  response.setHeader("content-length", Buffer.byteLength(body));
  response.setHeader("cache-control", "no-store");
  setSecurityHeaders(response);
  response.end(body);
}

function firstHeaderValue(value) {
  return Array.isArray(value) ? value[0] : value;
}

function configuredOrigins(env) {
  return String(env.NIRVANA_ALLOWED_ORIGINS || "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean)
    .flatMap((value) => {
      try {
        return [new URL(value).origin];
      } catch {
        return [];
      }
    });
}

/** Blocks browser cross-origin POSTs from spending server-held provider credits. */
export function assertBrowserOrigin(request, env = process.env) {
  const origin = firstHeaderValue(request.headers.origin);
  if (!origin) return;

  let parsedOrigin;
  try {
    parsedOrigin = new URL(origin);
  } catch {
    throw new HttpError(403, "origin_forbidden", "The request origin is not allowed.");
  }

  const host = firstHeaderValue(request.headers.host);
  const sameHost = Boolean(host) && parsedOrigin.host === host;
  const explicitlyAllowed = configuredOrigins(env).includes(parsedOrigin.origin);
  if (!sameHost && !explicitlyAllowed) {
    throw new HttpError(403, "origin_forbidden", "The request origin is not allowed.");
  }
}

export async function readJsonBody(request, maxBytes = REQUEST_LIMITS.bodyBytes) {
  const contentType = firstHeaderValue(request.headers["content-type"]) || "";
  const mediaType = contentType.split(";", 1)[0].trim().toLowerCase();
  const isJson =
    mediaType === "application/json" ||
    (mediaType.startsWith("application/") && mediaType.endsWith("+json"));
  if (!isJson) {
    throw new HttpError(
      415,
      "unsupported_media_type",
      "The request Content-Type must be application/json.",
    );
  }

  const declaredLength = Number.parseInt(request.headers["content-length"], 10);
  if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
    throw new HttpError(413, "request_too_large", "The request body is too large.");
  }

  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > maxBytes) {
      throw new HttpError(413, "request_too_large", "The request body is too large.");
    }
    chunks.push(chunk);
  }
  if (size === 0) {
    throw new HttpError(400, "invalid_json", "A JSON request body is required.");
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new HttpError(400, "invalid_json", "The request body is not valid JSON.");
  }
}

function publicConfigPayload(env) {
  return {
    ...getPublicConfig(env),
    telemetry: {
      rubricVersion: RUBRIC_VERSION,
      dimensions: TELEMETRY_DIMENSIONS.map((id) => ({ id, ...TELEMETRY_RUBRIC[id] })),
      initialValues: DEFAULT_TELEMETRY,
      reducer: {
        kind: "ema",
        previousWeight: EMA_PREVIOUS_WEIGHT,
        observationWeight: EMA_OBSERVATION_WEIGHT,
      },
    },
    limits: {
      maxMessages: REQUEST_LIMITS.messages,
      maxMessageChars: REQUEST_LIMITS.messageChars,
      maxCandidateChars: REQUEST_LIMITS.candidateChars,
    },
  };
}

function safeUsage(usage) {
  if (!usage) return undefined;
  const result = {};
  if (Number.isFinite(usage.inputTokens)) result.inputTokens = usage.inputTokens;
  if (Number.isFinite(usage.outputTokens)) result.outputTokens = usage.outputTokens;
  return Object.keys(result).length ? result : undefined;
}

async function runResponse(body, env) {
  const startedAt = performance.now();
  const runtime = getRuntimeConfig(env);
  const request = validateRespondBody(body, runtime);
  const provider = createProvider(request.target.provider, env, runtime);
  const completion = await provider.complete({
    model: request.target.model,
    messages: [
      {
        role: "system",
        content: buildAssistantSystemPrompt(request.telemetry, {
          feedState: request.feedState,
          objective: request.objective,
        }),
      },
      ...request.messages,
    ],
    temperature: 0.4,
    maxOutputTokens: runtime.maxOutputTokens,
    metadata: { purpose: "answer" },
  });

  const answer = completion.text.trim();
  if (!answer) {
    throw new ProviderError(
      "invalid_provider_response",
      "The provider returned an empty answer.",
    );
  }
  return {
    answer,
    provider: request.target.provider,
    model: request.target.model,
    resolvedModel: completion.resolvedModel,
    transport: completion.transport,
    reasoningEffort: completion.reasoningEffort,
    responseId: completion.responseId,
    target: request.target,
    usage: safeUsage(completion.usage),
    latencyMs: Math.max(0, Math.round(performance.now() - startedAt)),
    simulated: request.target.provider === "mock",
  };
}

function canUseOpenAIFallback(error) {
  return (
    error instanceof SyntaxError ||
    (error instanceof ProviderError && error.fallbackEligible)
  );
}

async function requestAssessment({ provider, request, evaluator, runtime }) {
  const baseRequest = {
    model: evaluator.model,
    messages: buildAssessmentMessages(request),
    temperature: 0,
    maxOutputTokens: Math.min(runtime.maxOutputTokens, 4_096),
    metadata: {
      purpose: "assessment",
      candidateAnswer: request.candidateAnswer,
      mode: request.mode,
    },
  };

  let completion;
  let fallbackUsed = false;
  try {
    completion = await provider.complete({
      ...baseRequest,
      responseFormat: {
        kind: "json_schema",
        schema: ASSESSMENT_JSON_SCHEMA,
      },
    });
    return {
      assessment: normalizeAssessment(completion.text),
      usage: completion.usage,
      transport: completion.transport,
      reasoningEffort: completion.reasoningEffort,
      responseId: completion.responseId,
      resolvedModel: completion.resolvedModel,
      fallbackUsed,
    };
  } catch (error) {
    if (provider.id === "openai" && canUseOpenAIFallback(error)) {
      // Continue to the single compatibility fallback below.
    } else if (error instanceof SyntaxError) {
      throw new ProviderError(
        "invalid_provider_response",
        "The evaluator returned an incomplete or invalid assessment.",
        { cause: error },
      );
    } else {
      throw error;
    }
  }

  // OpenAI-compatible gateways vary in json_schema support. Use exactly one
  // json_object retry for schema rejection or malformed structured output.
  fallbackUsed = true;
  completion = await provider.complete({
    ...baseRequest,
    responseFormat: { kind: "json_object" },
  });
  try {
    return {
      assessment: normalizeAssessment(completion.text),
      usage: completion.usage,
      transport: completion.transport,
      reasoningEffort: completion.reasoningEffort,
      responseId: completion.responseId,
      resolvedModel: completion.resolvedModel,
      fallbackUsed,
    };
  } catch (cause) {
    throw new ProviderError(
      "invalid_provider_response",
      "The evaluator returned invalid JSON.",
      { cause },
    );
  }
}

async function runAssessment(body, env) {
  const startedAt = performance.now();
  const runtime = getRuntimeConfig(env);
  const request = validateAssessBody(body, runtime);
  const evaluator = request.mode === "self" ? request.target : request.judge;
  const provider = createProvider(evaluator.provider, env, runtime);
  const result = await requestAssessment({ provider, request, evaluator, runtime });
  const telemetry = reduceTelemetry(request.previousTelemetry, result.assessment);

  return {
    mode: request.mode,
    evaluator: {
      ...evaluator,
      source: request.mode,
      resolvedModel: result.resolvedModel,
      transport: result.transport,
      reasoningEffort: result.reasoningEffort,
      responseId: result.responseId,
    },
    assessment: result.assessment,
    previousTelemetry: request.previousTelemetry,
    telemetry,
    reducer: {
      kind: "ema",
      previousWeight: EMA_PREVIOUS_WEIGHT,
      observationWeight: EMA_OBSERVATION_WEIGHT,
    },
    usage: safeUsage(result.usage),
    latencyMs: Math.max(0, Math.round(performance.now() - startedAt)),
    fallbackUsed: result.fallbackUsed,
    simulated: evaluator.provider === "mock",
  };
}

function contentType(path) {
  return MIME_TYPES[extname(path).toLowerCase()] || "application/octet-stream";
}

async function existingFile(path) {
  try {
    const info = await stat(path);
    return info.isFile() ? path : null;
  } catch (error) {
    if (error?.code === "ENOENT" || error?.code === "ENOTDIR") return null;
    throw error;
  }
}

/** Resolve a URL path inside dist without permitting traversal. */
export function resolveStaticPath(distDir, pathname) {
  let decoded;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    throw new HttpError(400, "invalid_path", "The request path is invalid.");
  }
  if (decoded.includes("\0")) {
    throw new HttpError(400, "invalid_path", "The request path is invalid.");
  }
  const root = resolve(distDir);
  const relative = decoded.replace(/^\/+/, "") || "index.html";
  const candidate = resolve(root, relative);
  if (candidate !== root && !candidate.startsWith(`${root}${sep}`)) {
    throw new HttpError(403, "path_forbidden", "The request path is forbidden.");
  }
  return candidate;
}

async function serveStatic(request, response, pathname, distDir) {
  if (request.method !== "GET" && request.method !== "HEAD") return false;

  const requestedPath = resolveStaticPath(distDir, pathname);
  let filePath = await existingFile(requestedPath);

  // Extensionless routes use the frontend entrypoint; asset misses remain 404.
  if (!filePath && !extname(pathname)) {
    filePath = await existingFile(resolve(distDir, "index.html"));
  }
  if (!filePath) return false;

  const body = await readFile(filePath);
  response.statusCode = 200;
  response.setHeader("content-type", contentType(filePath));
  response.setHeader("content-length", body.length);
  response.setHeader(
    "cache-control",
    filePath.endsWith("index.html") ? "no-cache" : "public, max-age=3600",
  );
  response.setHeader(
    "content-security-policy",
    "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'",
  );
  setSecurityHeaders(response);
  response.end(request.method === "HEAD" ? undefined : body);
  return true;
}

function errorPayload(error) {
  if (error instanceof HttpError) {
    return {
      status: error.status,
      body: { error: error.message, code: error.code },
    };
  }
  if (error instanceof ProviderError) {
    return {
      status: error.status,
      body: {
        error: error.message,
        code: error.code,
      },
    };
  }
  return {
    status: 500,
    body: {
      error: "The server could not complete the request.",
      code: "internal_error",
    },
  };
}

export function createRequestHandler({
  env = process.env,
  distDir = DEFAULT_DIST_DIR,
  logger = console,
} = {}) {
  return async function requestHandler(request, response) {
    try {
      const url = new URL(request.url || "/", "http://localhost");
      const pathname = url.pathname.replace(/\/+$/, "") || "/";

      if (request.method === "OPTIONS" && pathname.startsWith("/api/")) {
        response.statusCode = 204;
        response.setHeader("allow", "GET, POST, OPTIONS");
        setSecurityHeaders(response);
        response.end();
        return;
      }

      if (request.method === "GET" && pathname === "/api/health") {
        sendJson(response, 200, {
          ok: true,
          service: SERVICE_NAME,
          version: SERVICE_VERSION,
          time: new Date().toISOString(),
          uptimeSeconds: Math.floor(process.uptime()),
        });
        return;
      }

      if (request.method === "GET" && pathname === "/api/config") {
        sendJson(response, 200, publicConfigPayload(env));
        return;
      }

      if (request.method === "POST" && pathname === "/api/respond") {
        assertBrowserOrigin(request, env);
        const body = await readJsonBody(request);
        sendJson(response, 200, await runResponse(body, env));
        return;
      }

      if (request.method === "POST" && pathname === "/api/assess") {
        assertBrowserOrigin(request, env);
        const body = await readJsonBody(request);
        sendJson(response, 200, await runAssessment(body, env));
        return;
      }

      if (pathname.startsWith("/api/")) {
        sendJson(response, 404, {
          error: "The API route was not found.",
          code: "not_found",
        });
        return;
      }

      if (await serveStatic(request, response, url.pathname, distDir)) return;

      sendJson(response, 404, {
        error: "The requested resource was not found.",
        code: "not_found",
      });
    } catch (error) {
      const payload = errorPayload(error);
      if (!(error instanceof HttpError)) {
        logger.error?.("Nirvana Telemetry request failed", {
          code: error?.code || "internal_error",
          status: error?.status || 500,
          upstreamStatus: error?.upstreamStatus,
        });
      }
      if (!response.headersSent) sendJson(response, payload.status, payload.body);
      else response.destroy();
    }
  };
}

export function createNirvanaServer(options = {}) {
  return createHttpServer(createRequestHandler(options));
}

export function parsePort(value) {
  const port = Number.parseInt(value, 10);
  return Number.isFinite(port) && port >= 0 && port <= 65_535 ? port : 4173;
}

export async function startServer({ env = process.env, logger = console } = {}) {
  const server = createNirvanaServer({ env, logger });
  const port = parsePort(env.PORT ?? "4173");
  const host = env.HOST || "127.0.0.1";
  await new Promise((resolveListen, rejectListen) => {
    server.once("error", rejectListen);
    server.listen(port, host, () => {
      server.off("error", rejectListen);
      resolveListen();
    });
  });
  const address = server.address();
  logger.log?.(
    `Nirvana Telemetry listening on http://${host}:${typeof address === "object" ? address.port : port}`,
  );
  return server;
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))
) {
  startServer().catch((error) => {
    console.error("Nirvana Telemetry failed to start", {
      code: error?.code || "startup_error",
    });
    process.exitCode = 1;
  });
}
