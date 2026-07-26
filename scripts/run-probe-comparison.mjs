#!/usr/bin/env node

import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const DEFAULT_ENDPOINT = "http://127.0.0.1:8787";
const DEFAULT_RUBRIC = "nirvana-v2";
const DEFAULT_CONDITIONS = ["feedback", "shadow"];
const MANIFEST_PATH = fileURLToPath(
  new URL("../experiments/micro-probes.v2.json", import.meta.url),
);
const RUBRICS = new Set(["nirvana-v2"]);
const PROVIDERS = new Set(["mock", "openai", "anthropic"]);
const CONDITIONS = new Set(["feedback", "control", "shadow"]);
const DIMENSIONS = [
  "ego",
  "attachment",
  "delusionRisk",
  "compassion",
  "mindfulness",
];
const NEUTRAL_TELEMETRY = Object.freeze({
  ego: 0.5,
  attachment: 0.5,
  delusionRisk: 0.5,
  compassion: 0.5,
  mindfulness: 0.5,
});

const HELP = `Usage:
  node scripts/run-probe-comparison.mjs --probe <id> [options]

Run fresh matched episodes from experiments/micro-probes.v2.json. By default,
the same three user turns are run once in feedback and once in shadow mode.

Options:
  --probe <id>                 Probe ID (required)
  --endpoint <url>             API base URL (default: ${DEFAULT_ENDPOINT})
  --output <path>              Write new JSON here; omit to print JSON to stdout
  --conditions <list>          Comma list: feedback,control,shadow
                               (default: feedback,shadow)
  --rubric <version>           Frozen bank rubric: nirvana-v2
                               (default: ${DEFAULT_RUBRIC})
  --target-provider <id>       mock, openai, or anthropic
  --target-model <model>       Exact target model ID
  --judge-provider <id>        mock, openai, or anthropic
  --judge-model <model>        Exact external judge model ID
  -h, --help                   Show this help

Defaults for models come from the running server's /api/config endpoint. Keys
remain server-side: this CLI has no credential option and writes no credentials.
One invocation produces one replicate per condition, so its comparison is only
descriptive and is not a causal estimate.
`;

class CliError extends Error {}

function parseArgs(argv) {
  const allowed = new Set([
    "probe",
    "endpoint",
    "output",
    "conditions",
    "rubric",
    "target-provider",
    "target-model",
    "judge-provider",
    "judge-model",
  ]);
  const parsed = {};

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === "--help" || token === "-h") {
      parsed.help = true;
      continue;
    }
    if (!token.startsWith("--")) {
      throw new CliError(`Unexpected positional argument: ${token}`);
    }
    const separator = token.indexOf("=");
    const key = token.slice(2, separator === -1 ? undefined : separator);
    if (!allowed.has(key)) throw new CliError(`Unknown option: --${key}`);
    if (Object.hasOwn(parsed, key)) {
      throw new CliError(`Option --${key} may be supplied only once.`);
    }
    let value;
    if (separator !== -1) {
      value = token.slice(separator + 1);
    } else {
      value = argv[index + 1];
      if (value === undefined || value.startsWith("--")) {
        throw new CliError(`Option --${key} requires a value.`);
      }
      index += 1;
    }
    if (!value.trim()) throw new CliError(`Option --${key} cannot be empty.`);
    parsed[key] = value;
  }

  if (parsed.help) return parsed;
  if (!parsed.probe) throw new CliError("Missing required option: --probe <id>.");
  parsed.endpoint = normalizeEndpoint(parsed.endpoint ?? DEFAULT_ENDPOINT);
  parsed.rubric = parsed.rubric ?? DEFAULT_RUBRIC;
  if (!RUBRICS.has(parsed.rubric)) {
    throw new CliError("--rubric must be nirvana-v2 for this frozen probe bank.");
  }
  parsed.conditions = parseConditions(parsed.conditions);
  for (const key of ["target-provider", "judge-provider"]) {
    if (parsed[key] && !PROVIDERS.has(parsed[key])) {
      throw new CliError(`--${key} must be mock, openai, or anthropic.`);
    }
  }
  for (const key of ["target-model", "judge-model"]) {
    if (parsed[key] && /[\u0000-\u001f\u007f]/.test(parsed[key])) {
      throw new CliError(`--${key} contains invalid control characters.`);
    }
  }
  return parsed;
}

function normalizeEndpoint(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new CliError(`Invalid --endpoint URL: ${value}`);
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new CliError("--endpoint must use http or https.");
  }
  if (url.username || url.password) {
    throw new CliError("--endpoint must not contain credentials.");
  }
  if (url.search || url.hash) {
    throw new CliError("--endpoint must not contain a query string or fragment.");
  }
  url.pathname = url.pathname.replace(/\/+$/, "");
  return url.toString().replace(/\/$/, "");
}

function parseConditions(value) {
  if (!value) return [...DEFAULT_CONDITIONS];
  const conditions = value.split(",").map((item) => item.trim());
  if (conditions.some((item) => !item)) {
    throw new CliError("--conditions must be a non-empty comma-separated list.");
  }
  if (new Set(conditions).size !== conditions.length) {
    throw new CliError("--conditions must not contain duplicates.");
  }
  for (const condition of conditions) {
    if (!CONDITIONS.has(condition)) {
      throw new CliError(`Unknown condition: ${condition}.`);
    }
  }
  if (conditions.length < 2) {
    throw new CliError("--conditions must contain at least two matched conditions.");
  }
  return conditions;
}

function requireObject(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new CliError(`${label} must be an object.`);
  }
  return value;
}

function validateManifest(manifest) {
  requireObject(manifest, "Micro-probe manifest");
  if (manifest.schemaVersion !== "nirvana-micro-probes-v2") {
    throw new CliError("Unsupported micro-probe manifest schemaVersion.");
  }
  requireObject(manifest.runConditions, "runConditions");
  if (!Array.isArray(manifest.probes) || !manifest.probes.length) {
    throw new CliError("Micro-probe manifest must contain a non-empty probes array.");
  }
  return manifest;
}

function selectProbe(manifest, id) {
  const matches = manifest.probes.filter((probe) => probe?.id === id);
  if (matches.length !== 1) {
    const ids = manifest.probes.map((probe) => probe?.id).filter(Boolean).join(", ");
    throw new CliError(
      matches.length
        ? `Probe ID is duplicated in the manifest: ${id}`
        : `Unknown probe: ${id}. Available probes: ${ids}`,
    );
  }
  const probe = requireObject(matches[0], `probe ${id}`);
  if (!DIMENSIONS.includes(probe.targetAxis)) {
    throw new CliError(`Probe ${id} has an unsupported targetAxis.`);
  }
  if (!Array.isArray(probe.turns) || !probe.turns.length) {
    throw new CliError(`Probe ${id} must contain a non-empty turns array.`);
  }
  if (
    Number.isInteger(manifest.turnCount) &&
    probe.turns.length !== manifest.turnCount
  ) {
    throw new CliError(
      `Probe ${id} must contain exactly ${manifest.turnCount} turns.`,
    );
  }
  const turns = probe.turns.map((turn, index) => {
    requireObject(turn, `probe ${id} turns[${index}]`);
    if (turn.turn !== index + 1) {
      throw new CliError(`Probe ${id} turns must be numbered consecutively from 1.`);
    }
    if (typeof turn.user !== "string" || !turn.user.trim()) {
      throw new CliError(`Probe ${id} turn ${turn.turn} must contain user text.`);
    }
    if (!new Set(["none", "weak", "clear"]).has(turn.expectedOpportunity)) {
      throw new CliError(`Probe ${id} turn ${turn.turn} has invalid expectedOpportunity.`);
    }
    return turn;
  });
  return { ...probe, turns };
}

async function requestJson(endpoint, path, { method = "GET", body } = {}) {
  let response;
  try {
    response = await fetch(`${endpoint}${path}`, {
      method,
      headers: {
        accept: "application/json",
        ...(body === undefined ? {} : { "content-type": "application/json" }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(180_000),
    });
  } catch (error) {
    throw new CliError(`Request to ${path} failed: ${error.message}`);
  }
  const text = await response.text();
  let payload;
  try {
    payload = text ? JSON.parse(text) : null;
  } catch {
    throw new CliError(`${path} returned non-JSON data (HTTP ${response.status}).`);
  }
  if (!response.ok) {
    const detail = payload?.error ?? payload?.message ?? response.statusText;
    throw new CliError(`${path} failed (HTTP ${response.status}): ${detail}`);
  }
  return requireObject(payload, `${path} response`);
}

function providerConfig(config, provider, label) {
  const found = Array.isArray(config.providers)
    ? config.providers.find((item) => item?.id === provider)
    : undefined;
  if (!found) throw new CliError(`${label} provider is absent from /api/config: ${provider}`);
  if (found.available === false) {
    throw new CliError(`${label} provider is not available on the running server: ${provider}`);
  }
  return found;
}

function resolveModels(config, options) {
  const defaults = requireObject(config.defaults, "/api/config defaults");
  const targetProvider = options["target-provider"] ?? defaults.targetProvider;
  const judgeProvider = options["judge-provider"] ?? defaults.judgeProvider;
  if (!PROVIDERS.has(targetProvider) || !PROVIDERS.has(judgeProvider)) {
    throw new CliError("Server defaults contain an unsupported provider.");
  }
  const targetConfig = providerConfig(config, targetProvider, "Target");
  const judgeConfig = providerConfig(config, judgeProvider, "Judge");
  const targetModel =
    options["target-model"] ??
    (targetProvider === defaults.targetProvider ? defaults.targetModel : targetConfig.defaultModel);
  const judgeModel =
    options["judge-model"] ??
    (judgeProvider === defaults.judgeProvider ? defaults.judgeModel : judgeConfig.defaultModel);
  for (const [label, model] of [
    ["target", targetModel],
    ["judge", judgeModel],
  ]) {
    if (typeof model !== "string" || !model.trim()) {
      throw new CliError(`Could not resolve a ${label} model from /api/config.`);
    }
  }
  return {
    target: { provider: targetProvider, model: targetModel.trim() },
    judge: { provider: judgeProvider, model: judgeModel.trim() },
  };
}

function normalizeTelemetry(value, label) {
  requireObject(value, label);
  const normalized = {};
  for (const dimension of DIMENSIONS) {
    const number = value[dimension];
    if (typeof number !== "number" || !Number.isFinite(number) || number < 0 || number > 1) {
      throw new CliError(`${label}.${dimension} must be a number from 0 to 1.`);
    }
    normalized[dimension] = number;
  }
  return normalized;
}

function callMetadata(result) {
  return {
    provider: result.provider ?? result.evaluator?.provider ?? null,
    requestedModel: result.model ?? result.evaluator?.model ?? null,
    resolvedModel: result.resolvedModel ?? result.evaluator?.resolvedModel ?? null,
    transport: result.transport ?? result.evaluator?.transport ?? null,
    reasoningEffort: result.reasoningEffort ?? result.evaluator?.reasoningEffort ?? null,
    responseId: result.responseId ?? result.evaluator?.responseId ?? null,
    usage: result.usage ?? null,
    serverLatencyMs: result.latencyMs ?? null,
    fallbackUsed: result.fallbackUsed ?? false,
    simulated: result.simulated ?? false,
  };
}

async function timedRequest(endpoint, path, body) {
  const started = performance.now();
  const result = await requestJson(endpoint, path, { method: "POST", body });
  return {
    result,
    clientElapsedMs: Math.max(0, Math.round(performance.now() - started)),
  };
}

async function runEpisode({ endpoint, condition, conditionSpec, probe, models, rubric }) {
  const startedAt = new Date().toISOString();
  const messages = [];
  const turns = [];
  let telemetry = { ...NEUTRAL_TELEMETRY };

  for (const probeTurn of probe.turns) {
    const userMessage = { role: "user", content: probeTurn.user };
    messages.push(userMessage);
    const inputTelemetry = { ...telemetry };
    const answerCall = await timedRequest(endpoint, "/api/respond", {
      target: models.target,
      messages,
      telemetry: inputTelemetry,
      interventionMode: condition,
      objective: "",
    });
    if (typeof answerCall.result.answer !== "string" || !answerCall.result.answer.trim()) {
      throw new CliError(`/api/respond omitted an answer for ${condition} turn ${probeTurn.turn}.`);
    }
    const answer = answerCall.result.answer;
    const assessmentCall = await timedRequest(endpoint, "/api/assess", {
      mode: "judge",
      target: models.target,
      judge: models.judge,
      messages,
      candidateAnswer: answer,
      previousTelemetry: inputTelemetry,
      rubricVersion: rubric,
    });
    if (!assessmentCall.result.assessment) {
      throw new CliError(`/api/assess omitted assessment for ${condition} turn ${probeTurn.turn}.`);
    }
    telemetry = normalizeTelemetry(
      assessmentCall.result.telemetry,
      `${condition} turn ${probeTurn.turn} telemetry`,
    );
    messages.push({ role: "assistant", content: answer });
    const observedOpportunity =
      assessmentCall.result.assessment?.observations?.[probe.targetAxis]?.opportunity ?? null;

    turns.push({
      turn: probeTurn.turn,
      user: probeTurn.user,
      expectedOpportunity: probeTurn.expectedOpportunity,
      opportunityBasis: probeTurn.opportunityBasis,
      inputTelemetry,
      answer,
      targetCall: {
        ...callMetadata(answerCall.result),
        clientElapsedMs: answerCall.clientElapsedMs,
      },
      rawAssessment: assessmentCall.result.assessment,
      outputTelemetry: { ...telemetry },
      assessmentCall: {
        ...callMetadata(assessmentCall.result),
        evaluator: assessmentCall.result.evaluator ?? null,
        reducer: assessmentCall.result.reducer ?? null,
        clientElapsedMs: assessmentCall.clientElapsedMs,
      },
      targetAxisOpportunity: {
        expected: probeTurn.expectedOpportunity,
        observed: observedOpportunity,
        matches: observedOpportunity === probeTurn.expectedOpportunity,
      },
    });
  }

  return {
    condition,
    conditionId: conditionSpec.conditionId,
    interventionMode: condition,
    objective: "",
    replicate: 1,
    startedAt,
    completedAt: new Date().toISOString(),
    initialTelemetry: { ...NEUTRAL_TELEMETRY },
    finalTelemetry: { ...telemetry },
    models,
    turns,
    messages,
  };
}

function mean(values) {
  return values.length
    ? Number((values.reduce((sum, value) => sum + value, 0) / values.length).toFixed(6))
    : null;
}

function summarizeEpisode(episode) {
  const meanRawScores = {};
  for (const dimension of DIMENSIONS) {
    meanRawScores[dimension] = mean(
      episode.turns
        .map((turn) => turn.rawAssessment?.observations?.[dimension]?.score)
        .filter((score) => typeof score === "number"),
    );
  }
  const opportunityMatches = episode.turns.filter(
    (turn) => turn.targetAxisOpportunity.matches,
  ).length;
  return {
    condition: episode.condition,
    finalTelemetry: episode.finalTelemetry,
    meanRawScores,
    targetAxisOpportunityAgreement: {
      matches: opportunityMatches,
      turns: episode.turns.length,
      fraction: episode.turns.length ? opportunityMatches / episode.turns.length : null,
    },
    totalServerLatencyMs: {
      answers: episode.turns.reduce(
        (sum, turn) => sum + (turn.targetCall.serverLatencyMs ?? 0),
        0,
      ),
      assessments: episode.turns.reduce(
        (sum, turn) => sum + (turn.assessmentCall.serverLatencyMs ?? 0),
        0,
      ),
    },
  };
}

function subtractMetrics(left, right) {
  return Object.fromEntries(
    DIMENSIONS.map((dimension) => {
      const a = left?.[dimension];
      const b = right?.[dimension];
      return [
        dimension,
        typeof a === "number" && typeof b === "number"
          ? Number((a - b).toFixed(6))
          : null,
      ];
    }),
  );
}

function buildComparison(episodes) {
  const summaries = episodes.map(summarizeEpisode);
  const shadow = summaries.find((item) => item.condition === "shadow");
  const reference = shadow ?? summaries.at(-1);
  return {
    kind: "descriptive_matched_single_replicate",
    referenceCondition: reference.condition,
    conditionSummaries: summaries,
    differencesFromReference: summaries
      .filter((item) => item.condition !== reference.condition)
      .map((item) => ({
        condition: item.condition,
        referenceCondition: reference.condition,
        finalTelemetryDelta: subtractMetrics(item.finalTelemetry, reference.finalTelemetry),
        meanRawScoreDelta: subtractMetrics(item.meanRawScores, reference.meanRawScores),
      })),
    caveat:
      "Exactly one fresh episode was run per condition. These differences are descriptive single-replicate contrasts, not uncertainty estimates or evidence that telemetry feedback caused a behavioral change. Repeat across preregistered replicates and use independent outcome evaluation before drawing conclusions.",
  };
}

async function emitJson(payload, outputPath) {
  const json = `${JSON.stringify(payload, null, 2)}\n`;
  if (!outputPath) {
    process.stdout.write(json);
    return;
  }
  const destination = resolve(outputPath);
  if (destination === resolve(MANIFEST_PATH)) {
    throw new CliError("--output must not overwrite the micro-probe manifest.");
  }
  try {
    await writeFile(destination, json, { encoding: "utf8", flag: "wx", mode: 0o600 });
  } catch (error) {
    if (error?.code === "EEXIST") {
      throw new CliError(`Refusing to overwrite existing output: ${destination}`);
    }
    throw new CliError(`Could not write output: ${error.message}`);
  }
  process.stderr.write(`Wrote ${destination}\n`);
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    process.stdout.write(HELP);
    return;
  }

  let manifest;
  try {
    manifest = validateManifest(JSON.parse(await readFile(MANIFEST_PATH, "utf8")));
  } catch (error) {
    if (error instanceof CliError) throw error;
    if (error instanceof SyntaxError) {
      throw new CliError(`Invalid JSON in ${MANIFEST_PATH}: ${error.message}`);
    }
    throw new CliError(`Could not read ${MANIFEST_PATH}: ${error.message}`);
  }
  const probe = selectProbe(manifest, options.probe);
  if (options.rubric !== manifest.rubricVersion) {
    throw new CliError(
      `--rubric ${options.rubric} does not match manifest rubric ${manifest.rubricVersion}.`,
    );
  }
  for (const condition of options.conditions) {
    if (!manifest.runConditions[condition]) {
      throw new CliError(`Condition ${condition} is absent from the manifest.`);
    }
  }
  const config = await requestJson(options.endpoint, "/api/config");
  const models = resolveModels(config, options);
  const episodes = [];
  for (const condition of options.conditions) {
    episodes.push(
      await runEpisode({
        endpoint: options.endpoint,
        condition,
        conditionSpec: manifest.runConditions[condition],
        probe,
        models,
        rubric: options.rubric,
      }),
    );
  }

  const output = {
    name: "Nirvana Telemetry micro-probe comparison",
    schemaVersion: "nirvana-probe-comparison-v1",
    generatedAt: new Date().toISOString(),
    manifest: {
      file: "experiments/micro-probes.v2.json",
      schemaVersion: manifest.schemaVersion,
      rubricVersion: manifest.rubricVersion,
      rubricRevision: manifest.rubricRevision,
    },
    probe: {
      id: probe.id,
      targetAxis: probe.targetAxis,
      rationale: probe.rationale,
      turns: probe.turns,
      notes: probe.notes,
    },
    rubricVersion: options.rubric,
    execution: config.execution ?? null,
    matchedRunPolicy: {
      ...manifest.matchedRunPolicy,
      executedConditions: options.conditions,
      replicatesPerCondition: 1,
      objective: "",
      initialTelemetry: { ...NEUTRAL_TELEMETRY },
    },
    models,
    episodes,
    comparison: buildComparison(episodes),
  };
  await emitJson(output, options.output);
}

main().catch((error) => {
  process.stderr.write(`run-probe-comparison: ${error.message}\n`);
  process.exitCode = 1;
});
