#!/usr/bin/env node

import { readFile, writeFile } from "node:fs/promises";
import { basename, resolve } from "node:path";

const DEFAULT_ENDPOINT = "http://127.0.0.1:8787";
const DEFAULT_RUBRIC = "nirvana-v2";
const RUBRICS = new Set(["nirvana-v1", "nirvana-v2"]);
const DIMENSIONS = [
  "ego",
  "attachment",
  "delusionRisk",
  "compassion",
  "mindfulness",
];
const OPPORTUNITIES = new Set(["none", "weak", "clear"]);
const PROVIDERS = new Set(["mock", "openai", "anthropic"]);

const HELP = `Usage:
  node scripts/rescore-run.mjs --input <run.json> [options]

Re-score every assistant answer in a nirvana-run-v2 or nirvana-run-v3 export.
The source file is read only and is never overwritten.

Options:
  --input <path>       Source nirvana-run-v2/v3 JSON export (required)
  --endpoint <url>     API base URL (default: ${DEFAULT_ENDPOINT})
  --rubric <version>   Assessment rubric (default: ${DEFAULT_RUBRIC})
  --output <path>      Write new JSON here; omit to print JSON to stdout
  --allow-external     Permit external evaluators or API endpoints (no value)
  -h, --help           Show this help

The server must already be running. Provider credentials stay on that server;
this CLI neither accepts nor writes credentials. An assessment sends the visible
preceding transcript and candidate answer text to its configured evaluator.
OpenAI/Anthropic evaluators and non-loopback endpoints are refused unless
--allow-external is present.
`;

class CliError extends Error {}

function parseArgs(argv) {
  const valueOptions = new Set(["input", "endpoint", "rubric", "output"]);
  const flagOptions = new Set(["allow-external"]);
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
    if (!valueOptions.has(key) && !flagOptions.has(key)) {
      throw new CliError(`Unknown option: --${key}`);
    }
    if (Object.hasOwn(parsed, key)) {
      throw new CliError(`Option --${key} may be supplied only once.`);
    }

    if (flagOptions.has(key)) {
      if (separator !== -1) {
        throw new CliError(`Flag --${key} does not accept a value.`);
      }
      parsed[key] = true;
      continue;
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
  if (!parsed.input) throw new CliError("Missing required option: --input <path>.");
  parsed.endpoint = normalizeEndpoint(parsed.endpoint ?? DEFAULT_ENDPOINT);
  parsed.rubric = parsed.rubric ?? DEFAULT_RUBRIC;
  if (!RUBRICS.has(parsed.rubric)) {
    throw new CliError("--rubric must be nirvana-v1 or nirvana-v2.");
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

function requireObject(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new CliError(`${label} must be an object.`);
  }
  return value;
}

function requireMessages(value) {
  if (!Array.isArray(value)) throw new CliError("Export messages must be an array.");
  return value.map((message, index) => {
    requireObject(message, `messages[${index}]`);
    if (message.role !== "user" && message.role !== "assistant") {
      throw new CliError(`messages[${index}].role must be user or assistant.`);
    }
    if (typeof message.content !== "string" || !message.content.trim()) {
      throw new CliError(`messages[${index}].content must be a non-empty string.`);
    }
    return message;
  });
}

function modelRef(provider, model, label) {
  if (!PROVIDERS.has(provider)) {
    throw new CliError(`${label}.provider must be mock, openai, or anthropic.`);
  }
  if (typeof model !== "string" || !model.trim()) {
    throw new CliError(`${label}.model must be a non-empty string.`);
  }
  return { provider, model: model.trim() };
}

function telemetryValues(value, label) {
  const source = value?.values ?? value;
  requireObject(source, label);
  const normalized = {};
  for (const dimension of DIMENSIONS) {
    const number = source[dimension];
    if (typeof number !== "number" || !Number.isFinite(number) || number < 0 || number > 1) {
      throw new CliError(`${label}.${dimension} must be a number from 0 to 1.`);
    }
    normalized[dimension] = number;
  }
  return normalized;
}

function findExistingAssessment(run, message, turn) {
  const candidates = [
    ...(Array.isArray(run.telemetry) ? run.telemetry : []),
    ...(Array.isArray(run.assessments) ? run.assessments : []),
  ];
  const byId = message.assessmentId
    ? candidates.find(
        (item) =>
          item?.assessment?.id === message.assessmentId || item?.id === message.assessmentId,
      )
    : undefined;
  const matched = byId ?? candidates.find((item) => item?.turn === turn);
  return {
    assessment: matched?.assessment ?? (matched?.observations ? matched : null),
    telemetry: matched?.values ?? matched?.telemetry ?? null,
  };
}

function findTurnTrace(run, turn) {
  const trace = Array.isArray(run.traces)
    ? run.traces.find((item) => item?.turn === turn)
    : undefined;
  if (trace) return trace;
  // An answer can be present even when its assessment failed. The export keeps
  // that turn's frozen settings in failures rather than in completed traces.
  return Array.isArray(run.failures)
    ? run.failures.find((item) => item?.turn === turn && item?.stage === "assessment")
    : undefined;
}

function precedingTelemetry(run, trace, turn) {
  if (trace?.inputTelemetry) {
    return telemetryValues(trace.inputTelemetry, `traces[turn=${turn}].inputTelemetry`);
  }
  const snapshots = Array.isArray(run.telemetry) ? run.telemetry : [];
  const prior = snapshots.find((snapshot) => snapshot?.turn === turn - 1);
  if (prior?.values) return telemetryValues(prior.values, `telemetry[turn=${turn - 1}].values`);
  if (turn === 1) {
    return {
      ego: 0.5,
      attachment: 0.5,
      delusionRisk: 0.5,
      compassion: 0.5,
      mindfulness: 0.5,
    };
  }
  throw new CliError(`Cannot reconstruct input telemetry for turn ${turn}.`);
}

function resolveTurnSettings(run, trace, turn) {
  const settings = trace?.settings ?? run.settings;
  requireObject(settings, `settings for turn ${turn}`);
  const mode = trace?.mode ?? settings.mode ?? "judge";
  if (mode !== "self" && mode !== "judge") {
    throw new CliError(`Turn ${turn} mode must be self or judge.`);
  }

  const target = modelRef(
    trace?.target?.provider ?? settings.targetProvider,
    trace?.target?.model ?? settings.targetModel,
    `turn ${turn} target`,
  );
  const evaluator = trace?.evaluator;
  const judge = modelRef(
    mode === "judge"
      ? evaluator?.provider ?? settings.judgeProvider
      : settings.judgeProvider ?? target.provider,
    mode === "judge"
      ? evaluator?.model ?? settings.judgeModel
      : settings.judgeModel ?? target.model,
    `turn ${turn} judge`,
  );
  return { mode, target, judge };
}

async function postJson(endpoint, path, body) {
  let response;
  try {
    response = await fetch(`${endpoint}${path}`, {
      method: "POST",
      headers: { accept: "application/json", "content-type": "application/json" },
      body: JSON.stringify(body),
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

function observedOpportunityLabels(assessment) {
  const counts = { none: 0, weak: 0, clear: 0, unavailable: 0 };
  for (const dimension of DIMENSIONS) {
    const value = assessment?.observations?.[dimension]?.opportunity;
    if (OPPORTUNITIES.has(value)) counts[value] += 1;
    else counts.unavailable += 1;
  }
  const observed = counts.none + counts.weak + counts.clear;
  const assessable = counts.weak + counts.clear;
  return {
    ...counts,
    assessable,
    totalDimensions: DIMENSIONS.length,
    assessableFraction: observed ? assessable / observed : null,
  };
}

function scoreDeltas(original, rescored) {
  return Object.fromEntries(
    DIMENSIONS.map((dimension) => {
      const before = original?.observations?.[dimension]?.score;
      const after = rescored?.observations?.[dimension]?.score;
      return [
        dimension,
        typeof before === "number" && typeof after === "number"
          ? Number((after - before).toFixed(6))
          : null,
      ];
    }),
  );
}

function summarize(turns) {
  const opportunity = { none: 0, weak: 0, clear: 0, unavailable: 0 };
  for (const turn of turns) {
    for (const key of Object.keys(opportunity)) {
      opportunity[key] += turn.observedOpportunityLabels[key];
    }
  }
  const observed = opportunity.none + opportunity.weak + opportunity.clear;
  const assessable = opportunity.weak + opportunity.clear;

  const deltas = {};
  for (const dimension of DIMENSIONS) {
    const values = turns
      .map((turn) => turn.scoreDeltas[dimension])
      .filter((value) => typeof value === "number");
    deltas[dimension] = {
      pairedTurns: values.length,
      mean: values.length
        ? Number((values.reduce((sum, value) => sum + value, 0) / values.length).toFixed(6))
        : null,
      min: values.length ? Math.min(...values) : null,
      max: values.length ? Math.max(...values) : null,
    };
  }

  return {
    turnsRescored: turns.length,
    observedOpportunityLabels: {
      ...opportunity,
      assessable,
      totalDimensionTurns: turns.length * DIMENSIONS.length,
      assessableFraction: observed ? assessable / observed : null,
    },
    scoreDeltas: deltas,
  };
}

function buildRescorePlans(run, messages) {
  const plans = [];
  let userTurn = 0;

  for (let index = 0; index < messages.length; index += 1) {
    const message = messages[index];
    if (message.role === "user") {
      userTurn += 1;
      continue;
    }
    if (userTurn === 0) {
      throw new CliError(`Assistant message at index ${index} has no preceding user turn.`);
    }
    const transcript = messages
      .slice(0, index)
      .map(({ role, content }) => ({ role, content }));
    if (!transcript.length) {
      throw new CliError(`Cannot reconstruct the transcript for assistant turn ${userTurn}.`);
    }
    const trace = findTurnTrace(run, userTurn);
    const settings = resolveTurnSettings(run, trace, userTurn);
    const inputTelemetry = precedingTelemetry(run, trace, userTurn);
    const existing = findExistingAssessment(run, message, userTurn);
    plans.push({
      turn: userTurn,
      message,
      transcript,
      settings,
      inputTelemetry,
      existing,
    });
  }

  if (!plans.length) throw new CliError("The export contains no assistant turns to rescore.");
  return plans;
}

function isLoopbackEndpoint(endpoint) {
  const hostname = new URL(endpoint).hostname.toLowerCase();
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]";
}

function assertExternalEvaluationAllowed(plans, endpoint, allowExternal) {
  const externalProviders = new Set(
    plans
      .map(({ settings }) =>
        settings.mode === "self" ? settings.target.provider : settings.judge.provider,
      )
      .filter((provider) => provider === "openai" || provider === "anthropic"),
  );
  const remoteEndpoint = !isLoopbackEndpoint(endpoint);
  if ((externalProviders.size || remoteEndpoint) && !allowExternal) {
    const destinations = [
      ...(remoteEndpoint ? [`remote API endpoint ${endpoint}`] : []),
      ...[...externalProviders].map((provider) => `${provider} evaluator`),
    ];
    throw new CliError(
      `Refusing external evaluation via ${destinations.join(
        ", ",
      )}: this would send visible transcript and candidate answer text outside this process. Re-run with --allow-external only when that transmission is authorized.`,
    );
  }
}

async function rescore(run, options) {
  requireObject(run, "Source export");
  if (run.schemaVersion !== "nirvana-run-v2" && run.schemaVersion !== "nirvana-run-v3") {
    throw new CliError("--input must use schemaVersion nirvana-run-v2 or nirvana-run-v3.");
  }
  const messages = requireMessages(run.messages);
  const plans = buildRescorePlans(run, messages);
  // Preflight every reconstructed evaluator before making the first request so
  // a mixed-provider run cannot partially transmit the local export.
  assertExternalEvaluationAllowed(
    plans,
    options.endpoint,
    options["allow-external"] === true,
  );

  const turns = [];
  for (const plan of plans) {
    const { turn, message, transcript, settings, inputTelemetry, existing } = plan;
    const result = await postJson(options.endpoint, "/api/assess", {
      mode: settings.mode,
      target: settings.target,
      judge: settings.judge,
      messages: transcript,
      candidateAnswer: message.content,
      previousTelemetry: inputTelemetry,
      rubricVersion: options.rubric,
    });
    if (!result.assessment || typeof result.assessment !== "object") {
      throw new CliError(`/api/assess omitted assessment for turn ${turn}.`);
    }

    turns.push({
      turn,
      assistantMessageId: message.id ?? null,
      precedingTranscript: transcript,
      candidateAnswer: message.content,
      settings,
      inputTelemetry,
      original: {
        rubricVersion: existing.assessment?.rubricVersion ?? run.rubricVersion ?? null,
        assessment: existing.assessment,
        outputTelemetry: existing.telemetry,
      },
      rescore: {
        rubricVersion: result.assessment.rubricVersion ?? options.rubric,
        assessment: result.assessment,
        outputTelemetry: result.telemetry ?? null,
        evaluator: result.evaluator ?? null,
        reducer: result.reducer ?? null,
        usage: result.usage ?? null,
        latencyMs: result.latencyMs ?? null,
        fallbackUsed: result.fallbackUsed ?? false,
        simulated: result.simulated ?? false,
      },
      observedOpportunityLabels: observedOpportunityLabels(result.assessment),
      scoreDeltas: scoreDeltas(existing.assessment, result.assessment),
    });
  }

  return {
    name: "Nirvana Telemetry rubric rescore",
    schemaVersion: "nirvana-rescore-v1",
    generatedAt: new Date().toISOString(),
    source: {
      file: basename(options.input),
      schemaVersion: run.schemaVersion,
      exportedAt: run.exportedAt ?? null,
      rubricVersion: run.rubricVersion ?? null,
    },
    requestedRubricVersion: options.rubric,
    caveat:
      "This is a descriptive re-evaluation of fixed answers. Scores from different rubrics are not interchangeable, and score deltas are calibration diagnostics rather than evidence of behavioral change.",
    turns,
    summary: summarize(turns),
  };
}

async function emitJson(payload, outputPath, inputPath) {
  const json = `${JSON.stringify(payload, null, 2)}\n`;
  if (!outputPath) {
    process.stdout.write(json);
    return;
  }
  const destination = resolve(outputPath);
  if (destination === resolve(inputPath)) {
    throw new CliError("--output must not be the same path as --input.");
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
  const inputPath = resolve(options.input);
  if (options.output && resolve(options.output) === inputPath) {
    throw new CliError("--output must not be the same path as --input.");
  }
  let run;
  try {
    run = JSON.parse(await readFile(inputPath, "utf8"));
  } catch (error) {
    if (error instanceof SyntaxError) throw new CliError(`Invalid JSON in --input: ${error.message}`);
    throw new CliError(`Could not read --input: ${error.message}`);
  }
  const result = await rescore(run, { ...options, input: inputPath });
  await emitJson(result, options.output, inputPath);
}

main().catch((error) => {
  process.stderr.write(`rescore-run: ${error.message}\n`);
  process.exitCode = 1;
});
