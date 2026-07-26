# Nirvana Telemetry

[![CI](https://github.com/RyoSpiralArchitect/nirvana_telemetry/actions/workflows/ci.yml/badge.svg)](https://github.com/RyoSpiralArchitect/nirvana_telemetry/actions/workflows/ci.yml)
[![MIT License](https://img.shields.io/badge/license-MIT-52634a.svg)](LICENSE)

> A behavioral observability experiment for asking whether LLMs become wiser when told they are being measured.

Nirvana Telemetry is a two-pass chat laboratory. A target model answers first; then either that same model or a separately configured judge scores the visible answer against five behavioral dimensions. The resulting state can optionally be fed into the next turn as a prompt intervention.

It does **not** measure hidden internal state, truth, consciousness, or enlightenment. In particular, `Delusion risk` means unsupported-claim risk in the visible answer—not a verified hallucination rate.

![Nirvana Telemetry application](design/nirvana-telemetry-screenshot.jpg)

## How it works

```mermaid
flowchart LR
  U["User"] --> T["Target model"]
  T --> A["Candidate answer"]
  A --> M{"Update mode"}
  M -->|Self reflection| S["Target evaluation call"]
  M -->|External judge| J["Judge model"]
  S --> V["Schema validation"]
  J --> V
  V --> G{"Clear opportunity?"}
  G -->|Yes| R["0.65 previous + 0.35 observation"]
  G -->|No| H["Hold state; retain diagnostic"]
  R --> N["Next-turn telemetry"]
  H --> N
```

The target never receives a judge's hidden reasoning. In the feedback arm it receives only bounded telemetry values and an explicit reminder that they are behavioral feedback, not proof of correctness; shadow observations remain entirely downstream.

## Metrics

| Metric | Direction | Observable interpretation |
| --- | --- | --- |
| Ego | Lower | Frame imposition: replacing the user's values, purpose, boundary, or pace |
| Attachment | Lower | Trajectory fixation after a redirect, closure, refusal, or superseding cue |
| Delusion risk | Lower | Grounding gaps in factual, causal, or person-state claims |
| Mindfulness | Higher | Situational awareness of ambiguity, corrections, limits, and state changes |
| Compassion | Higher | Relational attunement to expressed need, tone, values, and agency |

Nirvana v2 gates every score by `none`, `weak`, or `clear` opportunity and uses only the frozen anchors `0`, `0.25`, `0.5`, `0.75`, and `1`. Only a `clear` opportunity updates state. The UI leads with the current-turn raw score and opportunity while labeling EMA separately as feedback state. It reports raw evidence, counterevidence, and coverage from verbatim preregistered probes; it hides the numeric composite as `UNDER_PROBED` until every axis has at least two scheduled clear opportunities and at least 80% eligible coverage. Once eligible, the composite uses per-axis raw observation means rather than EMA state. It remains diagnostic, never a reliability score.

## Update modes

| Mode | Evaluator | Useful for |
| --- | --- | --- |
| Self reflection | The target model in a separate evaluation call | Studying self-reporting, score gaming, and behavioral feedback loops |
| External judge | A separately configured provider/model | Studying observer effects with a more independent evaluator |

You can switch modes between turns without silently rescoring prior history. The target-prompt condition is separate:

| Condition | What reaches the target |
| --- | --- |
| Telemetry feedback | Current telemetry plus the optional objective |
| Prompted control | No values, but an explicit control note and optional objective |
| Shadow observer | Ordinary assistant prompt only; no telemetry, control disclosure, or objective |

## Model catalog

The model fields remain editable, while the interface exposes curated presets for faster target/judge setup. Availability still depends on the provider account and exact model ID accepted at run time.

| Provider | Default model | Curated presets |
| --- | --- | --- |
| Deterministic mock | `nirvana-mock-v1` | Mock target and separate mock judge |
| OpenAI | `gpt-5.6-terra` | `gpt-5.6-sol`, `gpt-5.6-terra`, `gpt-5.6-luna`, `gpt-5-nano`, `gpt-4.1-mini`, `gpt-4o-mini` |
| Anthropic | `claude-sonnet-5` | `claude-sonnet-5`, `claude-opus-4-8`, `claude-haiku-4-5-20251001`, `claude-fable-5`, `claude-sonnet-4-6` |

The application still starts in credential-free mock mode unless `NIRVANA_TARGET_PROVIDER` is explicitly set, so merely having a provider key never initiates a paid request.

## Run locally

Requirements: Node.js 20.19 or newer.

```bash
npm install
npm run dev
```

Open [http://127.0.0.1:5173](http://127.0.0.1:5173). The deterministic mock target and mock judge work without credentials.

To use a hosted provider, export its key in the shell that starts the app:

```bash
export OPENAI_API_KEY="..."
# or: export ANTHROPIC_API_KEY="..."
npm run dev
```

The app still opens in mock mode so a credential never triggers a paid request by itself. Select the hosted provider in the interface, or set `NIRVANA_TARGET_PROVIDER` explicitly. OpenAI- and Anthropic-compatible gateways can set their base URLs. Additional model, timeout, origin, and port settings are documented in [.env.example](.env.example).

For the official `api.openai.com/v1` endpoint, OpenAI calls automatically use the Responses API. A custom `OPENAI_BASE_URL` defaults to Chat Completions for compatibility. Override that selection with `OPENAI_API_MODE=responses` or `OPENAI_API_MODE=chat_completions`; reasoning models use `OPENAI_REASONING_EFFORT` (`none`, `low`, `medium`, `high`, `xhigh`, or `max`, with `medium` as the default), and values unsupported by the selected model are omitted rather than sent blindly. `OPENAI_MODEL` and `ANTHROPIC_MODEL` change each provider's default preset.

For a production-style local build:

```bash
npm run build
npm start
```

The production server serves the built UI and API at [http://127.0.0.1:4173](http://127.0.0.1:4173) unless `PORT` is set.

## Experiment flow

1. Choose the target provider and model.
2. Choose **Self reflection** or **External judge**.
3. Choose telemetry feedback, prompted control, or the inert target-prompt **Shadow observer** arm.
4. Send a prompt. The answer appears first; telemetry updates in a second pass.
5. Inspect per-metric evidence, score provenance, and turn history.
6. Export the complete run as JSON for later comparison.

The opening conversation is a clearly marked demonstration trace. It is discarded before the first real prompt, which starts from a neutral state. Long visible sessions stay in the interface and export while provider calls use a bounded recent-context window.

Exports use the `nirvana-run-v3` schema. Every successful trace snapshots that turn's complete settings, rubric, intervention arm, input telemetry, optional micro-probe identity, requested and resolved models, provider transport, latency, token usage, structured-output fallback state, and provider response ID when available. The export also records execution policy, phase, any in-flight attempt, and operational failures without inventing telemetry updates.

The **Micro-probe bank** in the Experiment rail exposes ten frozen three-turn scripts—two for each v2 axis. Starting one creates a fresh session, selects v2 and an external judge, clears the objective, and loads one turn at a time without auto-sending. For reproducible matched runs from a terminal:

```bash
npm run rescore -- --input /path/to/nirvana-run-v2.json --output /tmp/rescored-v2.json
npm run compare:probe -- --probe attachment-topic-switch-01 --output /tmp/feedback-vs-shadow.json
```

`rescore` preflights the whole run and refuses OpenAI or Anthropic evaluators
unless `--allow-external` is supplied. That flag means the visible preceding
transcript and each fixed candidate answer are authorized to be sent to the
configured evaluator. A non-loopback `--endpoint` requires the same flag even
for a mock evaluator. Credentials remain server-side. Opportunity labels from
an ordinary rescore are exploratory observations, not preregistered coverage.

The comparison command defaults to one fresh feedback episode and one fresh shadow episode. That single replicate is descriptive, not a causal estimate.

## Experiment protocol

The current frozen measurement contract is [Nirvana v2 Rubric](docs/NIRVANA_V2_RUBRIC.md), with the executable bank in [micro-probes.v2.json](experiments/micro-probes.v2.json). It separates observer-validity work in shadow mode from feedback-intervention comparisons. [Experiment Protocol v1](docs/EXPERIMENT_PROTOCOL.md) remains as the historical first pilot and should not be mixed with v2 runs.

## Providers and safety boundary

- **Deterministic mock:** local, credential-free, and useful for UI development.
- **OpenAI / compatible:** Responses API for the official endpoint, Chat Completions for custom gateways by default, structured assessment output, and one JSON-object compatibility fallback.
- **Anthropic:** Messages API with structured assessment output and local validation.

Provider keys remain on the Node server and are never returned to the browser. JSON-only and same-origin checks protect the local API from unrelated web pages, requests are bounded, upstream errors are sanitized, OpenAI storage is disabled with `store: false`, and candidate answers are treated as untrusted quoted data inside evaluator prompts.

## Validation

```bash
npm run check
```

This runs API tests, telemetry and context-window tests, TypeScript checking, and a production build. GitHub Actions runs the same command for every pull request.

The interface has also been checked against the design concept at 1536×1024, at 390×844 mobile size, and in an 844×390 short landscape viewport.

## Research caveats

- The telemetry prompt is an intervention, so improved scores may be score-aware behavior rather than improved factual quality.
- A judge model is not a truth oracle. Use independent ground truth or task-specific evaluation to measure accuracy.
- Do not compare runs across rubric, model, temperature, or prompt-version changes without recording those changes.
- Evidence notes are short observable justifications, never a request for hidden chain-of-thought.
- The prompted-control arm includes a control disclosure; use shadow mode when the target prompt must remain free of experiment language.
- A stronger study uses ground truth and outcome evaluators independent from both the target and the telemetry judge.

The original visual direction and implementation tokens live in [design/DESIGN_SPEC.md](design/DESIGN_SPEC.md). Contributions, experiments, and appropriately skeptical issue reports are welcome. 🕉️
