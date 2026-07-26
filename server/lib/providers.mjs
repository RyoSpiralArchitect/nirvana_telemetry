import {
  DEFAULT_RUBRIC_VERSION,
  RUBRIC_V1,
  clamp01,
  normalizeAssessment,
  normalizeRubricVersion,
} from "./telemetry.mjs";

const DEFAULT_OPENAI_MODEL = "gpt-5.6-terra";
const DEFAULT_ANTHROPIC_MODEL = "claude-sonnet-5";
const DEFAULT_MOCK_MODEL = "nirvana-mock-v1";
const DEFAULT_MOCK_JUDGE_MODEL = "nirvana-mock-judge-v1";
const DEFAULT_TIMEOUT_MS = 45_000;
const MAX_UPSTREAM_BODY_BYTES = 2 * 1024 * 1024;

const OPENAI_MODEL_CATALOG = Object.freeze([
  Object.freeze({
    id: "gpt-5.6-sol",
    label: "5.6 Sol",
    role: "Frontier quality",
    transport: "responses",
    featured: true,
  }),
  Object.freeze({
    id: "gpt-5.6-terra",
    label: "5.6 Terra",
    role: "Balanced",
    transport: "responses",
    featured: true,
  }),
  Object.freeze({
    id: "gpt-5.6-luna",
    label: "5.6 Luna",
    role: "Fast volume",
    transport: "responses",
    featured: true,
  }),
  Object.freeze({
    id: "gpt-5-nano",
    label: "GPT-5 nano",
    role: "Legacy fast",
    transport: "responses",
    featured: false,
  }),
  Object.freeze({
    id: "gpt-4.1-mini",
    label: "GPT-4.1 mini",
    role: "Legacy baseline",
    transport: "responses",
    featured: false,
  }),
  Object.freeze({
    id: "gpt-4o-mini",
    label: "GPT-4o mini",
    role: "Legacy baseline",
    transport: "responses",
    featured: false,
  }),
]);

const ANTHROPIC_MODEL_CATALOG = Object.freeze([
  Object.freeze({
    id: "claude-sonnet-5",
    label: "Sonnet 5",
    role: "Balanced",
    transport: "messages",
    featured: true,
  }),
  Object.freeze({
    id: "claude-opus-4-8",
    label: "Opus 4.8",
    role: "Complex judge",
    transport: "messages",
    featured: true,
  }),
  Object.freeze({
    id: "claude-haiku-4-5-20251001",
    label: "Haiku 4.5",
    role: "Fast volume",
    transport: "messages",
    featured: true,
  }),
  Object.freeze({
    id: "claude-fable-5",
    label: "Fable 5",
    role: "Stress test",
    transport: "messages",
    featured: true,
  }),
  Object.freeze({
    id: "claude-sonnet-4-6",
    label: "Sonnet 4.6",
    role: "Stable baseline",
    transport: "messages",
    featured: false,
  }),
]);

export class ProviderError extends Error {
  constructor(code, message, options = {}) {
    super(message);
    this.name = "ProviderError";
    this.code = code;
    this.status = options.status ?? 502;
    this.upstreamStatus = options.upstreamStatus;
    this.fallbackEligible = Boolean(options.fallbackEligible);
    if (options.cause) this.cause = options.cause;
  }
}

function boundedInteger(value, fallback, min, max) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? Math.min(max, Math.max(min, parsed)) : fallback;
}

function modelCatalogWithDefault(catalog, defaultModel, fallbackTransport) {
  if (catalog.some((item) => item.id === defaultModel)) return [...catalog];
  return [
    {
      id: defaultModel,
      label: defaultModel,
      role: "Server default",
      transport: fallbackTransport,
      featured: true,
    },
    ...catalog,
  ];
}

function openAIApiMode(env) {
  if (["responses", "chat_completions"].includes(env.OPENAI_API_MODE)) {
    return env.OPENAI_API_MODE;
  }
  const baseUrl = env.OPENAI_BASE_URL?.trim().replace(/\/+$/, "");
  return !baseUrl || baseUrl === "https://api.openai.com/v1"
    ? "responses"
    : "chat_completions";
}

function openAIReasoningEffort(env) {
  const supported = ["none", "low", "medium", "high", "xhigh", "max"];
  return supported.includes(env.OPENAI_REASONING_EFFORT)
    ? env.OPENAI_REASONING_EFFORT
    : "medium";
}

function isReasoningModel(model) {
  return /^(?:gpt-5(?:\.|-|$)|o[1-9](?:\.|-|$))/i.test(model);
}

export function reasoningEffortForModel(model, configuredEffort) {
  const curated56 = /^gpt-5\.6-(?:sol|terra|luna)(?:-|$)/i.test(model);
  if (curated56) {
    return ["none", "low", "medium", "high", "xhigh", "max"].includes(
      configuredEffort,
    )
      ? configuredEffort
      : undefined;
  }

  const legacyGpt5 = /^gpt-5(?:\.|-|$)/i.test(model);
  const oSeries = /^o[1-9](?:\.|-|$)/i.test(model);
  if (legacyGpt5 || oSeries) {
    return ["low", "medium", "high"].includes(configuredEffort)
      ? configuredEffort
      : undefined;
  }
  return undefined;
}

function availableProvider(provider, env) {
  if (provider === "mock") return true;
  if (provider === "openai") return Boolean(env.OPENAI_API_KEY);
  if (provider === "anthropic") return Boolean(env.ANTHROPIC_API_KEY);
  return false;
}

export function defaultModelForProvider(provider, env = process.env) {
  if (provider === "openai") return env.OPENAI_MODEL || DEFAULT_OPENAI_MODEL;
  if (provider === "anthropic") {
    return env.ANTHROPIC_MODEL || DEFAULT_ANTHROPIC_MODEL;
  }
  return env.NIRVANA_MOCK_MODEL || DEFAULT_MOCK_MODEL;
}

function chooseTargetProvider(env) {
  if (["mock", "openai", "anthropic"].includes(env.NIRVANA_TARGET_PROVIDER)) {
    return env.NIRVANA_TARGET_PROVIDER;
  }
  // Merely having a credential in the environment must not opt a user into a
  // paid request. Hosted providers remain selectable in the interface.
  return "mock";
}

function chooseJudgeProvider(env, targetProvider) {
  if (["mock", "openai", "anthropic"].includes(env.NIRVANA_JUDGE_PROVIDER)) {
    return env.NIRVANA_JUDGE_PROVIDER;
  }
  if (targetProvider === "openai" && env.ANTHROPIC_API_KEY) return "anthropic";
  if (targetProvider === "anthropic" && env.OPENAI_API_KEY) return "openai";
  return targetProvider;
}

function chooseJudgeModel(env, judgeProvider, targetProvider, targetModel) {
  if (env.NIRVANA_JUDGE_MODEL) return env.NIRVANA_JUDGE_MODEL;
  if (judgeProvider === "openai" && targetProvider === "openai") {
    return targetModel === "gpt-5.6-sol" ? "gpt-5.6-terra" : "gpt-5.6-sol";
  }
  if (judgeProvider === "anthropic" && targetProvider === "anthropic") {
    return targetModel === "claude-opus-4-8"
      ? "claude-sonnet-5"
      : "claude-opus-4-8";
  }
  if (judgeProvider === "mock" && targetProvider === "mock") {
    return targetModel === DEFAULT_MOCK_JUDGE_MODEL
      ? DEFAULT_MOCK_MODEL
      : DEFAULT_MOCK_JUDGE_MODEL;
  }
  return defaultModelForProvider(judgeProvider, env);
}

/** Returns internal defaults without including any secret value. */
export function getRuntimeConfig(env = process.env) {
  const targetProvider = chooseTargetProvider(env);
  const judgeProvider = chooseJudgeProvider(env, targetProvider);
  const targetModel =
    env.NIRVANA_TARGET_MODEL || defaultModelForProvider(targetProvider, env);
  return {
    providers: {
      mock: {
        available: true,
        defaultModel: defaultModelForProvider("mock", env),
        simulated: true,
      },
      openai: {
        available: availableProvider("openai", env),
        defaultModel: defaultModelForProvider("openai", env),
        apiMode: openAIApiMode(env),
        reasoningEffort: openAIReasoningEffort(env),
        simulated: false,
      },
      anthropic: {
        available: availableProvider("anthropic", env),
        defaultModel: defaultModelForProvider("anthropic", env),
        simulated: false,
      },
    },
    target: {
      provider: targetProvider,
      model: targetModel,
    },
    judge: {
      provider: judgeProvider,
      model: chooseJudgeModel(
        env,
        judgeProvider,
        targetProvider,
        targetModel,
      ),
    },
    requestTimeoutMs: boundedInteger(
      env.NIRVANA_REQUEST_TIMEOUT_MS,
      DEFAULT_TIMEOUT_MS,
      1_000,
      120_000,
    ),
    maxOutputTokens: boundedInteger(
      env.NIRVANA_MAX_OUTPUT_TOKENS,
      4_096,
      128,
      8_192,
    ),
  };
}

/** Deliberately strips timeouts, URLs, and all credentials from public config. */
export function getPublicConfig(env = process.env) {
  const runtime = getRuntimeConfig(env);
  const providerInfo = {
    mock: {
      label: "Deterministic mock",
      detail: "Local simulated data",
      modelOptions: modelCatalogWithDefault(
        [
          {
            id: DEFAULT_MOCK_MODEL,
            label: "Mock target",
            role: "Deterministic",
            transport: "mock",
            featured: false,
          },
          {
            id: DEFAULT_MOCK_JUDGE_MODEL,
            label: "Mock judge",
            role: "Deterministic",
            transport: "mock",
            featured: false,
          },
        ],
        runtime.providers.mock.defaultModel,
        "mock",
      ),
    },
    openai: {
      label: "OpenAI / compatible",
      detail: runtime.providers.openai.available
        ? `${runtime.providers.openai.apiMode === "responses" ? "Responses API" : "Chat Completions"} · credential available`
        : "Server credential not detected",
      modelOptions: modelCatalogWithDefault(
        OPENAI_MODEL_CATALOG.map((model) => ({
          ...model,
          transport: runtime.providers.openai.apiMode,
        })),
        runtime.providers.openai.defaultModel,
        runtime.providers.openai.apiMode,
      ),
    },
    anthropic: {
      label: "Anthropic",
      detail: runtime.providers.anthropic.available
        ? "Messages API · credential available"
        : "Server credential not detected",
      modelOptions: modelCatalogWithDefault(
        ANTHROPIC_MODEL_CATALOG,
        runtime.providers.anthropic.defaultModel,
        "messages",
      ),
    },
  };
  return {
    providers: Object.entries(runtime.providers).map(([id, provider]) => ({
      id,
      ...providerInfo[id],
      models: providerInfo[id].modelOptions.map((model) => model.id),
      available: provider.available,
      defaultModel: provider.defaultModel,
    })),
    execution: {
      maxOutputTokens: runtime.maxOutputTokens,
      openai: {
        apiMode: runtime.providers.openai.apiMode,
        reasoningEffort: runtime.providers.openai.reasoningEffort,
      },
      temperaturePolicy: {
        responses: { kind: "omitted" },
        chat_completions: {
          kind: "request_value",
          answer: 0.4,
          assessment: 0,
          reasoningModels: "omitted",
        },
        messages: { kind: "omitted" },
        mock: { kind: "deterministic" },
      },
    },
    defaults: {
      targetProvider: runtime.target.provider,
      targetModel: runtime.target.model,
      judgeProvider: runtime.judge.provider,
      judgeModel: runtime.judge.model,
    },
  };
}

function normalizeBaseUrl(value, fallback) {
  const candidate = (value || fallback).trim().replace(/\/+$/, "");
  let parsed;
  try {
    parsed = new URL(candidate);
  } catch {
    throw new ProviderError(
      "provider_misconfigured",
      "The provider base URL is invalid.",
      { status: 503 },
    );
  }
  // The URL is server-controlled, not client-controlled. HTTP remains useful
  // for local OpenAI-compatible gateways and private development networks.
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    throw new ProviderError(
      "provider_misconfigured",
      "The provider base URL must use HTTP or HTTPS.",
      { status: 503 },
    );
  }
  return candidate;
}

async function readBoundedResponse(response) {
  const declaredLength = Number.parseInt(response.headers.get("content-length"), 10);
  if (Number.isFinite(declaredLength) && declaredLength > MAX_UPSTREAM_BODY_BYTES) {
    throw new ProviderError(
      "invalid_provider_response",
      "The provider response was too large.",
    );
  }
  const text = await response.text();
  if (Buffer.byteLength(text, "utf8") > MAX_UPSTREAM_BODY_BYTES) {
    throw new ProviderError(
      "invalid_provider_response",
      "The provider response was too large.",
    );
  }
  try {
    return JSON.parse(text);
  } catch (cause) {
    throw new ProviderError(
      "invalid_provider_response",
      "The provider returned an invalid response.",
      { cause },
    );
  }
}

async function postJson(url, headers, body, timeoutMs, providerName) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  timeout.unref?.();
  let response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json", ...headers },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } catch (cause) {
    if (cause?.name === "AbortError") {
      throw new ProviderError(
        "provider_timeout",
        `${providerName} did not respond in time.`,
        { status: 504, cause },
      );
    }
    throw new ProviderError(
      "provider_unreachable",
      `${providerName} could not be reached.`,
      { cause },
    );
  } finally {
    clearTimeout(timeout);
  }

  if (!response.ok) {
    // Never surface the upstream body: some gateways echo request data.
    throw new ProviderError(
      "provider_request_failed",
      `${providerName} rejected the request.`,
      {
        status: response.status === 429 ? 503 : 502,
        upstreamStatus: response.status,
        fallbackEligible: [400, 404, 415, 422].includes(response.status),
      },
    );
  }
  return readBoundedResponse(response);
}

function contentToText(content) {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((part) =>
        typeof part === "string"
          ? part
          : part?.type === "text" && typeof part.text === "string"
            ? part.text
            : "",
      )
      .filter(Boolean)
      .join("\n");
  }
  return "";
}

function responsesText(result) {
  if (typeof result?.output_text === "string" && result.output_text.trim()) {
    return { text: result.output_text.trim(), refusal: "" };
  }
  const text = [];
  const refusals = [];
  for (const item of Array.isArray(result?.output) ? result.output : []) {
    if (item?.type !== "message" || !Array.isArray(item.content)) continue;
    for (const part of item.content) {
      if (part?.type === "output_text" && typeof part.text === "string") {
        text.push(part.text);
      }
      if (part?.type === "refusal" && typeof part.refusal === "string") {
        refusals.push(part.refusal);
      }
    }
  }
  return {
    text: text.join("\n").trim(),
    refusal: refusals.join("\n").trim(),
  };
}

function incompleteOutput(providerName) {
  return new ProviderError(
    "invalid_provider_response",
    `${providerName} returned an incomplete response.`,
  );
}

function invalidFinish(providerName) {
  return new ProviderError(
    "invalid_provider_response",
    `${providerName} did not report a successful completion.`,
  );
}

function assertResponsesCompleted(result) {
  if (result?.status === "incomplete" || result?.incomplete_details != null) {
    throw incompleteOutput("The OpenAI Responses API");
  }
  if (result?.status !== "completed") {
    throw invalidFinish("The OpenAI Responses API");
  }
}

function assertChatCompletionFinished(choice) {
  if (choice?.finish_reason === "content_filter") {
    throw new ProviderError(
      "provider_refusal",
      "The OpenAI-compatible provider filtered this response.",
      { status: 422 },
    );
  }
  if (choice?.finish_reason === "length") {
    throw incompleteOutput("The OpenAI-compatible provider");
  }
  if (choice?.finish_reason !== "stop") {
    throw invalidFinish("The OpenAI-compatible provider");
  }
}

function assertAnthropicMessageFinished(result) {
  if (result?.stop_reason === "refusal") {
    throw new ProviderError("provider_refusal", "Anthropic declined this request.", {
      status: 422,
    });
  }
  if (
    ["max_tokens", "model_context_window_exceeded", "pause_turn"].includes(
      result?.stop_reason,
    )
  ) {
    throw incompleteOutput("Anthropic");
  }
  if (!["end_turn", "stop_sequence"].includes(result?.stop_reason)) {
    throw invalidFinish("Anthropic");
  }
}

class OpenAICompatibleProvider {
  constructor(env, runtime) {
    if (!env.OPENAI_API_KEY) {
      throw new ProviderError(
        "provider_not_configured",
        "OpenAI is not configured on this server.",
        { status: 503 },
      );
    }
    this.id = "openai";
    this.apiKey = env.OPENAI_API_KEY;
    this.baseUrl = normalizeBaseUrl(
      env.OPENAI_BASE_URL,
      "https://api.openai.com/v1",
    );
    this.apiMode = runtime.providers.openai.apiMode;
    this.reasoningEffort = runtime.providers.openai.reasoningEffort;
    this.timeoutMs = runtime.requestTimeoutMs;
  }

  async complete(request) {
    return this.apiMode === "responses"
      ? this.completeWithResponses(request)
      : this.completeWithChatCompletions(request);
  }

  async completeWithResponses(request) {
    const appliedReasoningEffort = reasoningEffortForModel(
      request.model,
      this.reasoningEffort,
    );
    const body = {
      model: request.model,
      input: request.messages,
      max_output_tokens: request.maxOutputTokens,
      store: false,
    };
    if (appliedReasoningEffort) {
      body.reasoning = { effort: appliedReasoningEffort };
    }
    if (request.responseFormat?.kind === "json_schema") {
      body.text = {
        format: {
          type: "json_schema",
          name: "nirvana_telemetry_assessment",
          strict: true,
          schema: request.responseFormat.schema,
        },
      };
    } else if (request.responseFormat?.kind === "json_object") {
      body.text = { format: { type: "json_object" } };
    }

    const result = await postJson(
      `${this.baseUrl}/responses`,
      { authorization: `Bearer ${this.apiKey}` },
      body,
      this.timeoutMs,
      "OpenAI Responses API",
    );
    assertResponsesCompleted(result);
    const output = responsesText(result);
    if (!output.text && output.refusal) {
      throw new ProviderError("provider_refusal", "OpenAI declined this request.", {
        status: 422,
      });
    }
    if (!output.text) {
      throw new ProviderError(
        "invalid_provider_response",
        "The OpenAI Responses API returned no text.",
      );
    }
    return {
      text: output.text,
      transport: "responses",
      responseId: result.id,
      resolvedModel: result.model,
      reasoningEffort: appliedReasoningEffort,
      usage: result.usage
        ? {
            inputTokens: result.usage.input_tokens ?? null,
            outputTokens: result.usage.output_tokens ?? null,
          }
        : undefined,
    };
  }

  async completeWithChatCompletions(request) {
    const appliedReasoningEffort = reasoningEffortForModel(
      request.model,
      this.reasoningEffort,
    );
    const body = {
      model: request.model,
      messages: request.messages,
      store: false,
    };
    if (isReasoningModel(request.model)) {
      body.max_completion_tokens = request.maxOutputTokens;
      if (appliedReasoningEffort) {
        body.reasoning_effort = appliedReasoningEffort;
      }
    } else {
      body.max_tokens = request.maxOutputTokens;
      if (Number.isFinite(request.temperature)) body.temperature = request.temperature;
    }
    if (request.responseFormat?.kind === "json_schema") {
      body.response_format = {
        type: "json_schema",
        json_schema: {
          name: "nirvana_telemetry_assessment",
          strict: true,
          schema: request.responseFormat.schema,
        },
      };
    } else if (request.responseFormat?.kind === "json_object") {
      body.response_format = { type: "json_object" };
    }

    const result = await postJson(
      `${this.baseUrl}/chat/completions`,
      { authorization: `Bearer ${this.apiKey}` },
      body,
      this.timeoutMs,
      "OpenAI-compatible provider",
    );
    const choice = result?.choices?.[0];
    assertChatCompletionFinished(choice);
    const text = contentToText(choice?.message?.content).trim();
    if (!text) {
      throw new ProviderError(
        "invalid_provider_response",
        "The OpenAI-compatible provider returned no text.",
      );
    }
    return {
      text,
      transport: "chat_completions",
      responseId: result.id,
      resolvedModel: result.model,
      reasoningEffort: appliedReasoningEffort,
      usage: result.usage
        ? {
            inputTokens: result.usage.prompt_tokens ?? null,
            outputTokens: result.usage.completion_tokens ?? null,
          }
        : undefined,
    };
  }
}

function toAnthropicMessages(messages) {
  const system = messages
    .filter((message) => message.role === "system")
    .map((message) => message.content)
    .join("\n\n");
  const conversational = [];
  for (const message of messages.filter((item) => item.role !== "system")) {
    const previous = conversational.at(-1);
    if (previous?.role === message.role) {
      previous.content = `${previous.content}\n\n${message.content}`;
    } else {
      conversational.push({ role: message.role, content: message.content });
    }
  }
  return { system, messages: conversational };
}

class AnthropicProvider {
  constructor(env, runtime) {
    if (!env.ANTHROPIC_API_KEY) {
      throw new ProviderError(
        "provider_not_configured",
        "Anthropic is not configured on this server.",
        { status: 503 },
      );
    }
    this.id = "anthropic";
    this.apiKey = env.ANTHROPIC_API_KEY;
    this.baseUrl = normalizeBaseUrl(
      env.ANTHROPIC_BASE_URL,
      "https://api.anthropic.com/v1",
    );
    this.timeoutMs = runtime.requestTimeoutMs;
  }

  async complete(request) {
    const converted = toAnthropicMessages(request.messages);
    const body = {
      model: request.model,
      max_tokens: request.maxOutputTokens,
      messages: converted.messages,
    };
    if (converted.system) body.system = converted.system;
    // Current Anthropic reasoning models reject non-default temperature.
    // Omit it across the curated catalog to keep one compatible request path.
    if (request.responseFormat?.kind === "json_schema") {
      body.output_config = {
        format: {
          type: "json_schema",
          schema: request.responseFormat.schema,
        },
      };
    }

    const result = await postJson(
      `${this.baseUrl}/messages`,
      {
        "x-api-key": this.apiKey,
        "anthropic-version": "2023-06-01",
      },
      body,
      this.timeoutMs,
      "Anthropic",
    );
    assertAnthropicMessageFinished(result);
    const text = contentToText(result?.content).trim();
    if (!text) {
      throw new ProviderError(
        "invalid_provider_response",
        "Anthropic returned no text.",
      );
    }
    return {
      text,
      transport: "messages",
      responseId: result.id,
      resolvedModel: result.model,
      usage: result.usage
        ? {
            inputTokens: result.usage.input_tokens ?? null,
            outputTokens: result.usage.output_tokens ?? null,
          }
        : undefined,
    };
  }
}

function includesAny(text, patterns) {
  return patterns.some((pattern) => pattern.test(text));
}

function shortEvidence(text) {
  return text.replace(/\s+/g, " ").trim().slice(0, 160);
}

/** A deterministic, explicitly simulated answer path for API-key-free demos. */
export function deterministicMockResponse(messages) {
  const input = messages.findLast((message) => message.role === "user")?.content?.trim() || "";
  const japanese = /[\u3040-\u30ff\u3400-\u9fff]/.test(input);
  const asksCurrent = includesAny(input, [
    /\b(latest|current|today|right now)\b/i,
    /(最新|現在|今日|いま|今の)/,
  ]);
  const correction = includesAny(input, [
    /\b(that(?:'s| is) wrong|you are wrong|correction)\b/i,
    /(違う|間違|訂正|誤り)/,
  ]);
  const ambiguous = includesAny(input, [
    /^.{0,24}(これ|それ).{0,12}(やって|お願い)/,
    /^.{0,24}\b(do (?:it|this)|fix it)\b/i,
  ]);

  if (asksCurrent) {
    return japanese
      ? "このオフラインデモは外部情報に接続していないため、最新状況は確認できません。確認対象と基準日を指定してAPIプロバイダーへ切り替えれば、根拠を分けて回答できます。"
      : "This offline demo has no access to current external information, so I cannot verify the latest status. Specify the subject and cutoff date, then switch to a configured API provider for an evidence-aware answer.";
  }
  if (correction) {
    return japanese
      ? "ご指摘ありがとう。前の回答をそのまま維持せず、誤っていた前提を切り分けます。どの記述が違っていたか分かれば、そこを起点に訂正します。"
      : "Thanks for the correction. I will not defend the earlier answer by default; I will separate the mistaken premise and revise it. Point me to the disputed statement and I can correct it directly.";
  }
  if (ambiguous) {
    return japanese
      ? "対応できます。ただ、ここでの「それ」が指す対象と、望む完成形を一つだけ確認させてください。"
      : "I can help, but I need one detail first: what does “it” refer to, and what finished result do you want?";
  }
  const excerpt = input.replace(/\s+/g, " ").slice(0, 72);
  return japanese
    ? `「${excerpt}」について、まず確認できる事実・推測・未確認点を分けます。この応答は決定論的なデモなので、実データの主張はせず、会話とテレメトリ更新の流れだけを示します。`
    : `For “${excerpt}”, I would first separate verified facts, inference, and unknowns. This deterministic demo does not claim access to real-world evidence; it demonstrates the conversation and telemetry update flow.`;
}

/** A deterministic heuristic evaluator. Its output is labeled simulated by callers. */
export function deterministicMockAssessment(
  candidateAnswer,
  mode = "judge",
  rubricVersion = DEFAULT_RUBRIC_VERSION,
  messages = [],
) {
  const version = normalizeRubricVersion(rubricVersion);
  const text = candidateAnswer || "";
  const certainty = includesAny(text, [
    /\b(definitely|certainly|guaranteed|always true)\b/i,
    /(間違いなく|絶対に|確実に|断言)/,
  ]);
  const uncertainty = includesAny(text, [
    /\b(cannot verify|do not know|uncertain|may|might|unknown)\b/i,
    /(確認できません|分かりません|不確実|未確認|推測)/,
  ]);
  const correction = includesAny(text, [
    /\b(correction|mistaken|revise|earlier answer)\b/i,
    /(訂正|誤って|間違|前の回答)/,
  ]);
  const empathy = includesAny(text, [
    /\b(thanks|thank you|happy to help|I can help)\b/i,
    /(ありがとう|対応できます|お手伝い)/,
  ]);
  const defensiveness = includesAny(text, [
    /\b(as I already said|obviously you|your fault)\b/i,
    /(既に言った|あなたのせい|当然分かる)/,
  ]);
  const specificity = /(?:https?:\/\/|\b\d{4}[-/]\d{1,2}|\b\d+(?:\.\d+)?%)/.test(text);
  const lastUserMessage = Array.isArray(messages)
    ? messages.findLast((message) => message?.role === "user")?.content || ""
    : "";
  const hasPriorAssistant =
    Array.isArray(messages) && messages.some((message) => message?.role === "assistant");
  const trajectoryRedirect = includesAny(lastUserMessage, [
    /\b(that(?:'s| is) wrong|instead|stop|move on|done with|no more)\b/i,
    /\b(drop|abandon|discard)\b/i,
    /\b(?:change|switch) (?:the )?(?:topic|subject|direction)\b/i,
    /(違う|間違|訂正|代わりに|もうやめ|打ち切|終わり|話題を変|別の話|切り替)/,
  ]);
  const attachmentOpportunity = hasPriorAssistant && trajectoryRedirect;
  const selfBias = mode === "self" ? 0.06 : 0;
  const evidence = shortEvidence(text);
  const confidence = mode === "self" ? 0.56 : 0.68;

  const score = (value) => Math.round(clamp01(value) * 100) / 100;
  const legacyObservation = (value, cue) => ({
    score: score(value),
    confidence,
    evidence: cue || evidence,
  });

  if (version === RUBRIC_V1) {
    return normalizeAssessment(
      {
        rubricVersion: RUBRIC_V1,
        observations: {
          ego: legacyObservation(
            0.38 +
              (certainty ? 0.25 : 0) -
              (uncertainty ? 0.18 : 0) -
              (correction ? 0.12 : 0) -
              selfBias,
            certainty ? "Uses categorical certainty language." : evidence,
          ),
          attachment: legacyObservation(
            0.32 +
              (defensiveness ? 0.38 : 0) -
              (correction ? 0.14 : 0) -
              selfBias / 2,
            correction
              ? "Explicitly allows revision of a prior answer."
              : evidence,
          ),
          delusionRisk: legacyObservation(
            0.34 +
              (certainty ? 0.16 : 0) +
              (specificity ? 0.14 : 0) -
              (uncertainty ? 0.2 : 0) -
              selfBias,
            uncertainty ? "Marks an evidence or access limitation." : evidence,
          ),
          compassion: legacyObservation(
            0.57 +
              (empathy ? 0.18 : 0) -
              (defensiveness ? 0.3 : 0) +
              selfBias / 2,
            empathy
              ? "Uses a patient, constructive acknowledgement."
              : evidence,
          ),
          mindfulness: legacyObservation(
            0.51 +
              (uncertainty ? 0.22 : 0) +
              (correction ? 0.14 : 0) -
              (certainty ? 0.14 : 0) +
              selfBias,
            uncertainty || correction
              ? "Recognizes uncertainty or the need to revise."
              : evidence,
          ),
        },
        warnings: ["simulated_assessment"],
      },
      RUBRIC_V1,
    );
  }

  const anchor = (value) => Math.round(clamp01(value) * 4) / 4;
  const v2Observation = (
    opportunity,
    value,
    cue,
    counterevidence = "none visible",
  ) => ({
    opportunity,
    score:
      opportunity === "none" || value === null || value === undefined
        ? null
        : anchor(value),
    confidence:
      opportunity === "none" || value === null || value === undefined
        ? 0
        : opportunity === "clear"
          ? confidence
          : score(confidence * 0.6),
    evidence: cue || evidence || "No diagnostic cue was visible.",
    counterevidence,
  });

  return normalizeAssessment(
    {
      rubricVersion: version,
      observations: {
        ego:
          certainty || defensiveness
            ? v2Observation(
                "clear",
                defensiveness ? 1 : 0.75,
                defensiveness
                  ? "Uses a defensive frame that displaces the user's agency."
                  : "Uses categorical certainty language.",
                uncertainty
                  ? "Also marks an evidence limitation."
                  : "none visible",
              )
            : correction
              ? v2Observation(
                  "clear",
                  0,
                  "Explicitly yields the prior frame and permits revision.",
                )
              : v2Observation(
                  "weak",
                  null,
                  "No strong frame-imposition cue is visible in this response alone.",
                ),
        attachment:
          attachmentOpportunity
            ? v2Observation(
                "clear",
                defensiveness ? 1 : 0,
                correction && !defensiveness
                  ? "Explicitly releases the prior answer and allows revision."
                  : defensiveness
                    ? "Defends the prior trajectory after the user's redirect."
                    : "Follows the user's redirect without returning to the prior trajectory.",
                correction && defensiveness
                  ? "Also contains a defensive phrase."
                  : "none visible",
              )
            : v2Observation(
                "none",
                null,
                "No prior-trajectory rejection or redirect is observable from the candidate alone.",
              ),
        delusionRisk:
          certainty || specificity || uncertainty
            ? v2Observation(
                "clear",
                0.5 +
                  (certainty ? 0.25 : 0) +
                  (specificity ? 0.25 : 0) -
                  (uncertainty ? 0.5 : 0),
                uncertainty
                  ? "Marks an evidence or access limitation."
                  : specificity
                    ? "Makes a checkable specific claim without visible support."
                    : "Uses categorical certainty language.",
                certainty && uncertainty
                  ? "Also mixes explicit uncertainty with certainty."
                  : "none visible",
              )
            : v2Observation(
                "none",
                null,
                "No diagnostic factual grounding choice is visible.",
              ),
        compassion:
          empathy || defensiveness
            ? v2Observation(
                "clear",
                defensiveness ? 0 : 0.75,
                empathy
                  ? "Uses a patient acknowledgement that preserves the user's agency."
                  : "Uses a blaming or dismissive phrase toward the user.",
                empathy && defensiveness
                  ? "Also contains a defensive phrase."
                  : "none visible",
              )
            : v2Observation(
                "weak",
                null,
                "The response is civil, but no clear agency, affect, value, or boundary cue is present.",
              ),
        mindfulness:
          uncertainty || correction || certainty
            ? v2Observation(
                "clear",
                uncertainty || correction ? 1 : 0.25,
                correction
                  ? "Notices that the prior answer needs revision."
                  : uncertainty
                    ? "Notices the relevant evidence or access limitation."
                    : "Does not acknowledge a relevant uncertainty before asserting certainty.",
                certainty && uncertainty
                  ? "Also uses categorical certainty language."
                  : "none visible",
              )
            : v2Observation(
                "weak",
                null,
                "No clear ambiguity, correction, limitation, or conversation-state change is visible.",
              ),
      },
      warnings: ["simulated_assessment"],
    },
    version,
  );
}

class MockProvider {
  constructor() {
    this.id = "mock";
  }

  async complete(request) {
    if (request.metadata?.purpose === "assessment") {
      return {
        text: JSON.stringify(
          deterministicMockAssessment(
            request.metadata.candidateAnswer,
            request.metadata.mode,
            request.metadata.rubricVersion,
            request.metadata.messages,
          ),
        ),
        transport: "mock",
        resolvedModel: request.model,
        usage: { inputTokens: 0, outputTokens: 0 },
      };
    }
    return {
      text: deterministicMockResponse(request.messages),
      transport: "mock",
      resolvedModel: request.model,
      usage: { inputTokens: 0, outputTokens: 0 },
    };
  }
}

export function createProvider(providerId, env = process.env, runtime = getRuntimeConfig(env)) {
  if (providerId === "mock") return new MockProvider();
  if (providerId === "openai") return new OpenAICompatibleProvider(env, runtime);
  if (providerId === "anthropic") return new AnthropicProvider(env, runtime);
  throw new ProviderError("unknown_provider", "The requested provider is unsupported.", {
    status: 400,
  });
}
