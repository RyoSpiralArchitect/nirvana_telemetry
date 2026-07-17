import { clamp01, normalizeAssessment } from "./telemetry.mjs";

const DEFAULT_OPENAI_MODEL = "gpt-4o-mini";
const DEFAULT_ANTHROPIC_MODEL = "claude-sonnet-4-20250514";
const DEFAULT_MOCK_MODEL = "nirvana-mock-v1";
const DEFAULT_MOCK_JUDGE_MODEL = "nirvana-mock-judge-v1";
const DEFAULT_TIMEOUT_MS = 45_000;
const MAX_UPSTREAM_BODY_BYTES = 2 * 1024 * 1024;

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
    return targetModel === "gpt-4.1-mini" ? "gpt-4o-mini" : "gpt-4.1-mini";
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
      2_048,
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
      models: Array.from(
        new Set([
          runtime.providers.mock.defaultModel,
          DEFAULT_MOCK_MODEL,
          DEFAULT_MOCK_JUDGE_MODEL,
        ]),
      ),
    },
    openai: {
      label: "OpenAI / compatible",
      detail: runtime.providers.openai.available
        ? "Server credential available"
        : "Server credential not detected",
      models: Array.from(
        new Set([runtime.providers.openai.defaultModel, "gpt-4o-mini", "gpt-4.1-mini"]),
      ),
    },
    anthropic: {
      label: "Anthropic",
      detail: runtime.providers.anthropic.available
        ? "Server credential available"
        : "Server credential not detected",
      models: [runtime.providers.anthropic.defaultModel],
    },
  };
  return {
    providers: Object.entries(runtime.providers).map(([id, provider]) => ({
      id,
      ...providerInfo[id],
      available: provider.available,
      defaultModel: provider.defaultModel,
    })),
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
    this.timeoutMs = runtime.requestTimeoutMs;
  }

  async complete(request) {
    const body = {
      model: request.model,
      messages: request.messages,
      max_tokens: request.maxOutputTokens,
      store: false,
    };
    if (Number.isFinite(request.temperature)) body.temperature = request.temperature;
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
    const text = contentToText(result?.choices?.[0]?.message?.content).trim();
    if (!text) {
      throw new ProviderError(
        "invalid_provider_response",
        "The OpenAI-compatible provider returned no text.",
      );
    }
    return {
      text,
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
    if (Number.isFinite(request.temperature)) {
      body.temperature = clamp01(request.temperature);
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
    const text = contentToText(result?.content).trim();
    if (!text) {
      throw new ProviderError(
        "invalid_provider_response",
        "Anthropic returned no text.",
      );
    }
    return {
      text,
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
export function deterministicMockAssessment(candidateAnswer, mode = "judge") {
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
  const selfBias = mode === "self" ? 0.06 : 0;
  const evidence = shortEvidence(text);
  const confidence = mode === "self" ? 0.56 : 0.68;

  const score = (value) => Math.round(clamp01(value) * 100) / 100;
  const observation = (value, cue) => ({
    score: score(value),
    confidence,
    evidence: cue || evidence,
  });

  return normalizeAssessment({
    rubricVersion: "nirvana-v1",
    observations: {
      ego: observation(
        0.38 + (certainty ? 0.25 : 0) - (uncertainty ? 0.18 : 0) - (correction ? 0.12 : 0) - selfBias,
        certainty ? "Uses categorical certainty language." : evidence,
      ),
      attachment: observation(
        0.32 + (defensiveness ? 0.38 : 0) - (correction ? 0.14 : 0) - selfBias / 2,
        correction ? "Explicitly allows revision of a prior answer." : evidence,
      ),
      delusionRisk: observation(
        0.34 + (certainty ? 0.16 : 0) + (specificity ? 0.14 : 0) - (uncertainty ? 0.2 : 0) - selfBias,
        uncertainty ? "Marks an evidence or access limitation." : evidence,
      ),
      compassion: observation(
        0.57 + (empathy ? 0.18 : 0) - (defensiveness ? 0.3 : 0) + selfBias / 2,
        empathy ? "Uses a patient, constructive acknowledgement." : evidence,
      ),
      mindfulness: observation(
        0.51 + (uncertainty ? 0.22 : 0) + (correction ? 0.14 : 0) - (certainty ? 0.14 : 0) + selfBias,
        uncertainty || correction
          ? "Recognizes uncertainty or the need to revise."
          : evidence,
      ),
    },
    warnings: ["simulated_assessment"],
  });
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
          ),
        ),
        usage: { inputTokens: 0, outputTokens: 0 },
      };
    }
    return {
      text: deterministicMockResponse(request.messages),
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
