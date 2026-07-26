import {
  DEFAULT_RUBRIC_VERSION,
  DEFAULT_TELEMETRY,
  RUBRIC_VERSIONS,
  TELEMETRY_DIMENSIONS,
  normalizeTelemetryValues,
} from "./telemetry.mjs";

export const REQUEST_LIMITS = Object.freeze({
  bodyBytes: 512 * 1024,
  messages: 48,
  messageChars: 16_000,
  totalMessageChars: 80_000,
  candidateChars: 30_000,
  modelChars: 160,
  objectiveChars: 300,
});

export const PROVIDER_IDS = Object.freeze(["mock", "openai", "anthropic"]);
export const INTERVENTION_MODES = Object.freeze([
  "feedback",
  "control",
  "shadow",
]);

export class HttpError extends Error {
  constructor(status, code, message) {
    super(message);
    this.name = "HttpError";
    this.status = status;
    this.code = code;
  }
}

function isPlainObject(value) {
  return (
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    (Object.getPrototypeOf(value) === Object.prototype ||
      Object.getPrototypeOf(value) === null)
  );
}

export function requirePlainObject(value, label = "Request body") {
  if (!isPlainObject(value)) {
    throw new HttpError(400, "invalid_request", `${label} must be a JSON object.`);
  }
  return value;
}

const SENSITIVE_KEYS = new Set([
  "apikey",
  "api_key",
  "authorization",
  "token",
  "access_token",
  "secret",
]);

export function rejectClientCredentials(value, depth = 0) {
  if (depth > 4 || value === null || typeof value !== "object") return;
  if (Array.isArray(value)) {
    for (const item of value) rejectClientCredentials(item, depth + 1);
    return;
  }
  for (const [key, nested] of Object.entries(value)) {
    if (SENSITIVE_KEYS.has(key.toLowerCase())) {
      throw new HttpError(
        400,
        "client_credentials_forbidden",
        "Provider credentials must be configured on the server, not sent by the client.",
      );
    }
    rejectClientCredentials(nested, depth + 1);
  }
}

export function validateMessages(input, { requireFinalUser = false } = {}) {
  if (!Array.isArray(input) || input.length === 0) {
    throw new HttpError(400, "invalid_messages", "messages must be a non-empty array.");
  }
  if (input.length > REQUEST_LIMITS.messages) {
    throw new HttpError(
      413,
      "messages_too_large",
      `messages may contain at most ${REQUEST_LIMITS.messages} entries.`,
    );
  }

  let totalChars = 0;
  const messages = input.map((message, index) => {
    if (!isPlainObject(message)) {
      throw new HttpError(
        400,
        "invalid_messages",
        `messages[${index}] must be an object.`,
      );
    }
    if (message.role !== "user" && message.role !== "assistant") {
      throw new HttpError(
        400,
        "invalid_messages",
        `messages[${index}].role must be user or assistant.`,
      );
    }
    if (typeof message.content !== "string" || !message.content.trim()) {
      throw new HttpError(
        400,
        "invalid_messages",
        `messages[${index}].content must be a non-empty string.`,
      );
    }
    if (message.content.length > REQUEST_LIMITS.messageChars) {
      throw new HttpError(
        413,
        "messages_too_large",
        `Each message may contain at most ${REQUEST_LIMITS.messageChars} characters.`,
      );
    }
    totalChars += message.content.length;
    return { role: message.role, content: message.content };
  });

  if (totalChars > REQUEST_LIMITS.totalMessageChars) {
    throw new HttpError(
      413,
      "messages_too_large",
      `Message content may total at most ${REQUEST_LIMITS.totalMessageChars} characters.`,
    );
  }
  if (requireFinalUser && messages.at(-1)?.role !== "user") {
    throw new HttpError(
      400,
      "invalid_messages",
      "The final message must have role user when requesting a response.",
    );
  }
  return messages;
}

export function validateModelRef(input, fallback, label = "model reference") {
  const source = input === undefined || input === null ? fallback : input;
  if (!isPlainObject(source)) {
    throw new HttpError(400, "invalid_model_ref", `${label} must be an object.`);
  }
  const provider = source.provider ?? fallback?.provider;
  const model = source.model ?? fallback?.model;

  if (!PROVIDER_IDS.includes(provider)) {
    throw new HttpError(
      400,
      "invalid_provider",
      `${label}.provider must be one of: ${PROVIDER_IDS.join(", ")}.`,
    );
  }
  if (
    typeof model !== "string" ||
    !model.trim() ||
    model.length > REQUEST_LIMITS.modelChars ||
    /[\u0000-\u001f\u007f]/.test(model)
  ) {
    throw new HttpError(
      400,
      "invalid_model",
      `${label}.model must be a non-empty model name of at most ${REQUEST_LIMITS.modelChars} characters.`,
    );
  }
  return { provider, model: model.trim() };
}

export function validateTelemetryInput(input) {
  if (input === undefined || input === null) return { ...DEFAULT_TELEMETRY };
  const source = input?.values && isPlainObject(input.values) ? input.values : input;
  if (!isPlainObject(source)) {
    throw new HttpError(400, "invalid_telemetry", "telemetry must be an object.");
  }
  for (const dimension of TELEMETRY_DIMENSIONS) {
    if (!(dimension in source)) continue;
    if (
      typeof source[dimension] !== "number" ||
      !Number.isFinite(source[dimension]) ||
      source[dimension] < 0 ||
      source[dimension] > 1
    ) {
      throw new HttpError(
        400,
        "invalid_telemetry",
        `telemetry.${dimension} must be a finite number from 0 to 1.`,
      );
    }
  }
  return normalizeTelemetryValues(source);
}

function inlineModelRef(body, name) {
  if (body[name] !== undefined) return body[name];
  if (name === "target" && (body.provider !== undefined || body.model !== undefined)) {
    return { provider: body.provider, model: body.model };
  }
  return undefined;
}

export function validateRespondBody(input, defaults) {
  const body = requirePlainObject(input);
  rejectClientCredentials(body);
  if (body.feedState !== undefined && typeof body.feedState !== "boolean") {
    throw new HttpError(400, "invalid_feed_state", "feedState must be a boolean.");
  }
  if (
    body.interventionMode !== undefined &&
    !INTERVENTION_MODES.includes(body.interventionMode)
  ) {
    throw new HttpError(
      400,
      "invalid_intervention_mode",
      `interventionMode must be one of: ${INTERVENTION_MODES.join(", ")}.`,
    );
  }
  const legacyInterventionMode =
    body.feedState === undefined
      ? undefined
      : body.feedState
        ? "feedback"
        : "control";
  if (
    body.interventionMode !== undefined &&
    body.feedState !== undefined &&
    body.interventionMode !== legacyInterventionMode
  ) {
    throw new HttpError(
      400,
      "conflicting_intervention_mode",
      "interventionMode conflicts with the legacy feedState value.",
    );
  }
  const interventionMode =
    body.interventionMode ?? legacyInterventionMode ?? "feedback";
  if (
    body.objective !== undefined &&
    (typeof body.objective !== "string" ||
      body.objective.length > REQUEST_LIMITS.objectiveChars)
  ) {
    throw new HttpError(
      400,
      "invalid_objective",
      `objective must be a string of at most ${REQUEST_LIMITS.objectiveChars} characters.`,
    );
  }
  return {
    messages: validateMessages(body.messages, { requireFinalUser: true }),
    telemetry: validateTelemetryInput(body.telemetry),
    target: validateModelRef(inlineModelRef(body, "target"), defaults.target, "target"),
    interventionMode,
    // Retain the normalized legacy field for callers that have not migrated.
    feedState: interventionMode === "feedback",
    objective: body.objective?.trim() ?? "",
  };
}

export function validateAssessBody(input, defaults) {
  const body = requirePlainObject(input);
  rejectClientCredentials(body);

  const rubricVersion = body.rubricVersion ?? DEFAULT_RUBRIC_VERSION;
  if (!RUBRIC_VERSIONS.includes(rubricVersion)) {
    throw new HttpError(
      400,
      "invalid_rubric_version",
      `rubricVersion must be one of: ${RUBRIC_VERSIONS.join(", ")}.`,
    );
  }

  const mode = body.mode ?? "self";
  if (mode !== "self" && mode !== "judge") {
    throw new HttpError(400, "invalid_mode", "mode must be self or judge.");
  }
  if (
    typeof body.candidateAnswer !== "string" ||
    !body.candidateAnswer.trim() ||
    body.candidateAnswer.length > REQUEST_LIMITS.candidateChars
  ) {
    throw new HttpError(
      body.candidateAnswer?.length > REQUEST_LIMITS.candidateChars ? 413 : 400,
      "invalid_candidate",
      `candidateAnswer must be a non-empty string of at most ${REQUEST_LIMITS.candidateChars} characters.`,
    );
  }

  const target = validateModelRef(
    inlineModelRef(body, "target"),
    defaults.target,
    "target",
  );
  const judge = validateModelRef(body.judge, defaults.judge, "judge");

  return {
    mode,
    rubricVersion,
    messages: validateMessages(body.messages),
    candidateAnswer: body.candidateAnswer,
    previousTelemetry: validateTelemetryInput(
      body.previousTelemetry ?? body.telemetry,
    ),
    target,
    judge,
  };
}
