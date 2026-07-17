import test from "node:test";
import assert from "node:assert/strict";

import {
  DEFAULT_TELEMETRY,
  extractJson,
  normalizeAssessment,
  reduceTelemetry,
} from "../lib/telemetry.mjs";
import {
  deterministicMockAssessment,
  deterministicMockResponse,
  getPublicConfig,
} from "../lib/providers.mjs";
import {
  HttpError,
  validateAssessBody,
  validateRespondBody,
} from "../lib/validation.mjs";

const defaults = {
  target: { provider: "mock", model: "nirvana-mock-v1" },
  judge: { provider: "mock", model: "nirvana-mock-judge-v1" },
};

test("extractJson recovers fenced and prose-wrapped objects", () => {
  assert.deepEqual(extractJson('Result:\n```json\n{"ego":{"score":0.2}}\n```'), {
    ego: { score: 0.2 },
  });
  assert.deepEqual(extractJson('prefix {"note":"a } brace","ok":true} suffix'), {
    note: "a } brace",
    ok: true,
  });
});

test("normalizeAssessment accepts aliases, percentages, and explicit null observations", () => {
  const assessment = normalizeAssessment({
    scores: {
      ego_level: { value: 20, certainty: 75, reason: "qualified claim" },
      attachment: null,
      hallucination_risk: 0.3,
      compassion: null,
      mindfulness: null,
    },
  });
  assert.equal(assessment.observations.ego.score, 0.2);
  assert.equal(assessment.observations.ego.confidence, 0.75);
  assert.equal(assessment.observations.ego.evidence, "qualified claim");
  assert.equal(assessment.observations.delusionRisk.score, 0.3);
  assert.equal(assessment.observations.compassion.score, null);
});

test("normalizeAssessment rejects empty, incomplete, and malformed dimensions", () => {
  assert.throws(
    () => normalizeAssessment({}),
    (error) =>
      error instanceof SyntaxError &&
      /missing required dimension: ego/.test(error.message),
  );
  assert.throws(
    () => normalizeAssessment({ observations: { ego: null } }),
    (error) =>
      error instanceof SyntaxError &&
      /missing required dimension: attachment/.test(error.message),
  );
  assert.throws(
    () =>
      normalizeAssessment({
        observations: {
          ego: {},
          attachment: null,
          delusionRisk: null,
          compassion: null,
          mindfulness: null,
        },
      }),
    (error) =>
      error instanceof SyntaxError && /does not contain an explicit score/.test(error.message),
  );
});

test("reduceTelemetry applies a 0.65/0.35 EMA and holds null observations", () => {
  const assessment = normalizeAssessment({
    observations: {
      ego: { score: 0.3, confidence: 1, evidence: "" },
      attachment: { score: null, confidence: 0, evidence: "" },
      delusionRisk: { score: 0.1, confidence: 1, evidence: "" },
      compassion: { score: 0.9, confidence: 1, evidence: "" },
      mindfulness: { score: 0.8, confidence: 1, evidence: "" },
    },
  });
  const next = reduceTelemetry(DEFAULT_TELEMETRY, assessment);
  assert.deepEqual(next, {
    ego: 0.43,
    attachment: 0.5,
    delusionRisk: 0.36,
    compassion: 0.64,
    mindfulness: 0.605,
  });
  assert.throws(
    () =>
      reduceTelemetry(DEFAULT_TELEMETRY, {
        rubricVersion: "nirvana-v1",
        observations: {},
      }),
    SyntaxError,
  );
});

test("request validation rejects client credentials and out-of-range telemetry", () => {
  assert.throws(
    () =>
      validateRespondBody(
        {
          apiKey: "must-not-cross-the-browser-boundary",
          messages: [{ role: "user", content: "hello" }],
        },
        defaults,
      ),
    (error) => error instanceof HttpError && error.code === "client_credentials_forbidden",
  );
  assert.throws(
    () =>
      validateAssessBody(
        {
          mode: "judge",
          messages: [{ role: "user", content: "hello" }],
          candidateAnswer: "hi",
          telemetry: { ego: 2 },
        },
        defaults,
      ),
    (error) => error instanceof HttpError && error.code === "invalid_telemetry",
  );
});

test("mock response and assessment are deterministic but mode-sensitive", () => {
  const messages = [{ role: "user", content: "What is the latest result?" }];
  assert.equal(deterministicMockResponse(messages), deterministicMockResponse(messages));
  const candidate = "I cannot verify that result, so it may be uncertain.";
  const self = deterministicMockAssessment(candidate, "self");
  const judge = deterministicMockAssessment(candidate, "judge");
  assert.ok(self.observations.ego.score < judge.observations.ego.score);
  assert.ok(self.warnings.includes("simulated_assessment"));
});

test("public config reports availability without exposing credentials or URLs", () => {
  const env = {
    OPENAI_API_KEY: "test-openai-secret-value",
    OPENAI_BASE_URL: "https://private.example/v1",
    ANTHROPIC_API_KEY: "anthropic-secret",
  };
  const serialized = JSON.stringify(getPublicConfig(env));
  const providers = getPublicConfig(env).providers;
  assert.equal(providers.find((provider) => provider.id === "openai").available, true);
  assert.equal(providers.find((provider) => provider.id === "anthropic").available, true);
  assert.equal(serialized.includes("ultra-secret"), false);
  assert.equal(serialized.includes("private.example"), false);
  assert.equal(serialized.includes("anthropic-secret"), false);
});
