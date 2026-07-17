import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";

import { createRequestHandler, parsePort } from "../index.mjs";

async function withHandler(run, env = {}) {
  const distDir = await mkdtemp(join(tmpdir(), "nirvana-dist-"));
  await writeFile(join(distDir, "index.html"), "<!doctype html><title>Nirvana</title>");
  const handler = createRequestHandler({
    env,
    distDir,
    logger: { log() {}, error() {} },
  });
  try {
    await run(handler);
  } finally {
    await rm(distDir, { recursive: true, force: true });
  }
}

async function invoke(
  handler,
  { method = "GET", url = "/", json, body, headers = {} } = {},
) {
  const encoded =
    json !== undefined
      ? Buffer.from(JSON.stringify(json))
      : body !== undefined
        ? Buffer.from(body)
        : null;
  const request = Readable.from(encoded ? [encoded] : []);
  request.method = method;
  request.url = url;
  request.headers = {
    ...(encoded
      ? { "content-type": "application/json", "content-length": String(encoded.length) }
      : {}),
    ...headers,
  };
  const response = {
    statusCode: 200,
    headers: {},
    headersSent: false,
    body: Buffer.alloc(0),
    setHeader(name, value) {
      this.headers[name.toLowerCase()] = value;
    },
    end(chunk) {
      this.headersSent = true;
      this.body = chunk === undefined ? Buffer.alloc(0) : Buffer.from(chunk);
    },
    destroy() {
      this.destroyed = true;
    },
  };
  await handler(request, response);
  return {
    status: response.statusCode,
    headers: response.headers,
    text: response.body.toString("utf8"),
    json: () => JSON.parse(response.body.toString("utf8")),
  };
}

test("health, config, static files, and the deterministic two-pass API work", async () => {
  await withHandler(async (handler) => {
    const healthResponse = await invoke(handler, { url: "/api/health" });
    assert.equal(healthResponse.status, 200);
    assert.equal(healthResponse.json().ok, true);

    const configResponse = await invoke(handler, { url: "/api/config" });
    const config = configResponse.json();
    assert.equal(config.defaults.targetProvider, "mock");
    assert.equal(config.defaults.judgeModel, "nirvana-mock-judge-v1");
    assert.equal(config.telemetry.reducer.observationWeight, 0.35);

    const respondResponse = await invoke(handler, {
      method: "POST",
      url: "/api/respond",
      json: {
        messages: [{ role: "user", content: "今日は何が最新？" }],
        target: { provider: "mock", model: "nirvana-mock-v1" },
      },
    });
    assert.equal(respondResponse.status, 200);
    const responseBody = respondResponse.json();
    assert.equal(responseBody.simulated, true);
    assert.equal(responseBody.provider, "mock");
    assert.equal(responseBody.model, "nirvana-mock-v1");
    assert.equal(typeof responseBody.latencyMs, "number");
    assert.match(responseBody.answer, /外部情報/);

    const assessResponse = await invoke(handler, {
      method: "POST",
      url: "/api/assess",
      json: {
        mode: "self",
        messages: [{ role: "user", content: "今日は何が最新？" }],
        candidateAnswer: responseBody.answer,
        previousTelemetry: {
          ego: 0.5,
          attachment: 0.5,
          delusionRisk: 0.5,
          compassion: 0.5,
          mindfulness: 0.5,
        },
        target: { provider: "mock", model: "nirvana-mock-v1" },
      },
    });
    assert.equal(assessResponse.status, 200);
    const assessmentBody = assessResponse.json();
    assert.equal(assessmentBody.mode, "self");
    assert.equal(assessmentBody.evaluator.source, "self");
    assert.equal(typeof assessmentBody.latencyMs, "number");
    assert.equal(assessmentBody.simulated, true);
    assert.equal(assessmentBody.assessment.rubricVersion, "nirvana-v1");
    assert.ok(assessmentBody.telemetry.mindfulness > 0.5);

    const pageResponse = await invoke(handler, { url: "/some/client/route" });
    assert.equal(pageResponse.status, 200);
    assert.match(pageResponse.text, /Nirvana/);
  });
});

test("API errors are bounded and do not echo rejected credential values", async () => {
  await withHandler(async (handler) => {
    const secret = "do-not-echo-this-secret";
    const response = await invoke(handler, {
      method: "POST",
      url: "/api/respond",
      json: {
        apiKey: secret,
        messages: [{ role: "user", content: "hello" }],
      },
    });
    const text = response.text;
    assert.equal(response.status, 400);
    assert.equal(text.includes(secret), false);
    assert.match(text, /client_credentials_forbidden/);
  });
});

test("browser POSTs require JSON and an allowed origin", async () => {
  const validBody = {
    messages: [{ role: "user", content: "hello" }],
    target: { provider: "mock", model: "nirvana-mock-v1" },
  };

  await withHandler(async (handler) => {
    const wrongType = await invoke(handler, {
      method: "POST",
      url: "/api/respond",
      body: JSON.stringify(validBody),
      headers: { "content-type": "text/plain" },
    });
    assert.equal(wrongType.status, 415);
    assert.equal(wrongType.json().code, "unsupported_media_type");

    const foreignOrigin = await invoke(handler, {
      method: "POST",
      url: "/api/respond",
      json: validBody,
      headers: {
        host: "127.0.0.1:8787",
        origin: "https://malicious.example",
      },
    });
    assert.equal(foreignOrigin.status, 403);
    assert.equal(foreignOrigin.json().code, "origin_forbidden");
  });

  await withHandler(
    async (handler) => {
      const allowedDevOrigin = await invoke(handler, {
        method: "POST",
        url: "/api/respond",
        json: validBody,
        headers: {
          host: "127.0.0.1:8787",
          origin: "http://127.0.0.1:5173",
        },
      });
      assert.equal(allowedDevOrigin.status, 200);
    },
    { NIRVANA_ALLOWED_ORIGINS: "http://127.0.0.1:5173" },
  );
});

test("ambient provider credentials do not opt into paid defaults", async () => {
  await withHandler(
    async (handler) => {
      const configResponse = await invoke(handler, { url: "/api/config" });
      const config = configResponse.json();
      assert.equal(config.defaults.targetProvider, "mock");
      assert.equal(config.defaults.judgeProvider, "mock");
      assert.equal(
        config.providers.find((provider) => provider.id === "openai").available,
        true,
      );
    },
    { OPENAI_API_KEY: "configured-but-not-selected" },
  );
});

test("production port defaults to 4173", () => {
  assert.equal(parsePort(undefined), 4173);
  assert.equal(parsePort("not-a-port"), 4173);
  assert.equal(parsePort("8787"), 8787);
});

test("missing assessment dimensions trigger exactly one OpenAI json_object fallback", async () => {
  const originalFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (_url, init) => {
    calls.push(JSON.parse(init.body));
    if (calls.length === 1) {
      return new Response(
        JSON.stringify({
          choices: [{ message: { content: "{}" } }],
          usage: { prompt_tokens: 5, completion_tokens: 1 },
        }),
        {
          status: 200,
          headers: { "content-type": "application/json" },
        },
      );
    }
    return new Response(
      JSON.stringify({
        choices: [
          {
            message: {
              content: `Assessment follows:\n\`\`\`json\n${JSON.stringify({
                rubricVersion: "nirvana-v1",
                observations: {
                  ego: { score: 0.2, confidence: 0.8, evidence: "qualified" },
                  attachment: { score: null, confidence: 0, evidence: "" },
                  delusionRisk: { score: 0.3, confidence: 0.7, evidence: "limited" },
                  compassion: { score: 0.7, confidence: 0.6, evidence: "patient" },
                  mindfulness: { score: 0.8, confidence: 0.9, evidence: "uncertainty" },
                },
                warnings: [],
              })}\n\`\`\``,
            },
          },
        ],
        usage: { prompt_tokens: 25, completion_tokens: 15 },
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    );
  };

  const handler = createRequestHandler({
    env: {
      OPENAI_API_KEY: "test-key-never-returned",
      NIRVANA_JUDGE_PROVIDER: "openai",
      NIRVANA_JUDGE_MODEL: "test-judge",
    },
    logger: { log() {}, error() {} },
  });

  try {
    const response = await invoke(handler, {
      method: "POST",
      url: "/api/assess",
      json: {
        mode: "judge",
        messages: [{ role: "user", content: "Is that verified?" }],
        candidateAnswer: "I cannot verify it from the supplied evidence.",
        previousTelemetry: {
          ego: 0.5,
          attachment: 0.5,
          delusionRisk: 0.5,
          compassion: 0.5,
          mindfulness: 0.5,
        },
        target: { provider: "mock", model: "nirvana-mock-v1" },
        judge: { provider: "openai", model: "test-judge" },
      },
    });
    assert.equal(response.status, 200);
    assert.equal(response.json().fallbackUsed, true);
    assert.equal(calls.length, 2);
    assert.equal(calls.every((call) => call.store === false), true);
    assert.equal(calls[0].response_format.type, "json_schema");
    assert.equal(calls[1].response_format.type, "json_object");
    assert.equal(response.text.includes("test-key-never-returned"), false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
