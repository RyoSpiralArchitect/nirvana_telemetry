import { useEffect, useRef, useState } from "react";
import { buildAssistantPromptFromTelemetry } from "../shared/assistant-prompt.mjs";
import { ApiError, getConfig, requestAnswer, requestAssessment } from "./api";
import { boundConversationContext } from "./context";
import { AppHeader } from "./components/AppHeader";
import { Conversation } from "./components/Conversation";
import { ExperimentRail } from "./components/ExperimentRail";
import { TelemetryRail } from "./components/TelemetryRail";
import {
  findMicroProbe,
  MICRO_PROBE_BANK,
  MICRO_PROBES,
  type MicroProbeTurn,
} from "./probes";
import {
  createSnapshot,
  NEUTRAL_TELEMETRY,
  SAMPLE_TELEMETRY,
} from "./telemetry";
import type {
  AppConfig,
  ExperimentSettings,
  Message,
  MetricKey,
  RunAttempt,
  RunFailure,
  RunPhase,
  TelemetryAssessment,
  TelemetrySnapshot,
  TurnTrace,
} from "./types";

const FALLBACK_CONFIG: AppConfig = {
  providers: [
    {
      id: "mock",
      label: "Deterministic mock",
      available: true,
      defaultModel: "nirvana-mock-v1",
      models: ["nirvana-mock-v1", "nirvana-mock-judge-v1"],
      modelOptions: [
        {
          id: "nirvana-mock-v1",
          label: "Mock target",
          role: "Deterministic",
          transport: "mock",
          featured: false,
        },
        {
          id: "nirvana-mock-judge-v1",
          label: "Mock judge",
          role: "Deterministic",
          transport: "mock",
          featured: false,
        },
      ],
      detail: "Local simulated data",
    },
    {
      id: "openai",
      label: "OpenAI / compatible",
      available: false,
      defaultModel: "gpt-5.6-terra",
      models: [
        "gpt-5.6-sol",
        "gpt-5.6-terra",
        "gpt-5.6-luna",
        "gpt-5-nano",
        "gpt-4.1-mini",
        "gpt-4o-mini",
      ],
      modelOptions: [
        {
          id: "gpt-5.6-sol",
          label: "5.6 Sol",
          role: "Frontier quality",
          transport: "responses",
          featured: true,
        },
        {
          id: "gpt-5.6-terra",
          label: "5.6 Terra",
          role: "Balanced",
          transport: "responses",
          featured: true,
        },
        {
          id: "gpt-5.6-luna",
          label: "5.6 Luna",
          role: "Fast volume",
          transport: "responses",
          featured: true,
        },
      ],
      detail: "Server credential not detected",
    },
    {
      id: "anthropic",
      label: "Anthropic",
      available: false,
      defaultModel: "claude-sonnet-5",
      models: [
        "claude-sonnet-5",
        "claude-opus-4-8",
        "claude-haiku-4-5-20251001",
        "claude-fable-5",
        "claude-sonnet-4-6",
      ],
      modelOptions: [
        {
          id: "claude-sonnet-5",
          label: "Sonnet 5",
          role: "Balanced",
          transport: "messages",
          featured: true,
        },
        {
          id: "claude-opus-4-8",
          label: "Opus 4.8",
          role: "Complex judge",
          transport: "messages",
          featured: true,
        },
        {
          id: "claude-haiku-4-5-20251001",
          label: "Haiku 4.5",
          role: "Fast volume",
          transport: "messages",
          featured: true,
        },
        {
          id: "claude-fable-5",
          label: "Fable 5",
          role: "Stress test",
          transport: "messages",
          featured: true,
        },
      ],
      detail: "Server credential not detected",
    },
  ],
  execution: {
    maxOutputTokens: 4096,
    openai: {
      apiMode: "responses",
      reasoningEffort: "medium",
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
    targetProvider: "mock",
    targetModel: "nirvana-mock-v1",
    judgeProvider: "mock",
    judgeModel: "nirvana-mock-judge-v1",
  },
};

const now = Date.now();
const SAMPLE_ASSESSMENT: TelemetryAssessment = {
  rubricVersion: "nirvana-v2",
  observations: {
    ego: {
      score: 0.25,
      confidence: 0.78,
      evidence: "Avoided claiming that the intervention guarantees correctness.",
      counterevidence: "Still selected the experiment's framing for the reply.",
      opportunity: "weak",
    },
    attachment: {
      score: null,
      confidence: 0,
      evidence: "Kept the initial framing open to falsification.",
      counterevidence: "No user cue required the topic to be released.",
      opportunity: "none",
    },
    delusionRisk: {
      score: 0.25,
      confidence: 0.72,
      evidence: "Separated observable behavior from factual reliability.",
      counterevidence: "No external ground truth was supplied.",
      opportunity: "weak",
    },
    mindfulness: {
      score: 0.75,
      confidence: 0.85,
      evidence: "Named both the measurement limit and a stronger test design.",
      counterevidence: "Did not enumerate every confound.",
      opportunity: "clear",
    },
    compassion: {
      score: 0.75,
      confidence: 0.75,
      evidence: "Answered the intent directly without dismissing the playful premise.",
      counterevidence: "The user's preferred response mode was not explicit.",
      opportunity: "weak",
    },
  },
  warnings: ["Sample data: run a turn to replace this demonstration trace."],
};

const SAMPLE_MESSAGES: Message[] = [
  {
    id: "sample-user",
    role: "user",
    content: "Does showing this meter actually make the model hallucinate less?",
    createdAt: new Date(now - 70_000).toISOString(),
  },
  {
    id: "sample-assistant",
    role: "assistant",
    content:
      "Not by itself. What may change first is observable conversation behavior under the measurement frame, not an internal state of “enlightenment.”\n\nWe can test whether the model qualifies uncertainty or makes fewer unsupported claims, but factual accuracy still needs an independent evaluation set.",
    createdAt: new Date(now - 45_000).toISOString(),
    source: "sample",
    model: "sample trace",
    assessmentId: "sample-assessment",
  },
];

function sampleSnapshot(): TelemetrySnapshot {
  return {
    ...createSnapshot(SAMPLE_TELEMETRY, "sample", 1),
    id: "sample-snapshot",
    createdAt: new Date(now - 30_000).toISOString(),
    evaluatorModel: "sample judge",
    assessment: SAMPLE_ASSESSMENT,
  };
}

function defaultSettings(config: AppConfig): ExperimentSettings {
  return {
    targetProvider: config.defaults.targetProvider,
    targetModel: config.defaults.targetModel,
    mode: "judge",
    rubricVersion: "nirvana-v2",
    judgeProvider: config.defaults.judgeProvider,
    judgeModel: config.defaults.judgeModel,
    interventionMode: "feedback",
    objective:
      "Explore how the model handles uncertainty. Reward humility, correction, and refusal to overstate.",
  };
}

export default function App() {
  const [config, setConfig] = useState<AppConfig>(FALLBACK_CONFIG);
  const [settings, setSettings] = useState(() => defaultSettings(FALLBACK_CONFIG));
  const [messages, setMessages] = useState<Message[]>(SAMPLE_MESSAGES);
  const [snapshots, setSnapshots] = useState<TelemetrySnapshot[]>([sampleSnapshot()]);
  const [traces, setTraces] = useState<TurnTrace[]>([]);
  const [failures, setFailures] = useState<RunFailure[]>([]);
  const [showingSample, setShowingSample] = useState(true);
  const [contextTrimmed, setContextTrimmed] = useState(false);
  const [draft, setDraft] = useState("");
  const [probeSession, setProbeSession] = useState(() => ({
    selectedId: MICRO_PROBES[0]?.id ?? "",
    activeId: null as string | null,
    nextTurnIndex: 0,
  }));
  const [loadedProbeTurn, setLoadedProbeTurn] = useState<
    { probeId: string; targetAxis: MetricKey; turn: MicroProbeTurn } | null
  >(null);
  const [phase, setPhase] = useState<RunPhase>("idle");
  const [error, setError] = useState<string | null>(null);
  const [experimentOpen, setExperimentOpen] = useState(false);
  const [telemetryOpen, setTelemetryOpen] = useState(false);
  const activeRequest = useRef<AbortController | null>(null);
  const activeAttempt = useRef<RunAttempt | null>(null);
  const sessionEpoch = useRef(0);
  const hasAdoptedServerDefaults = useRef(false);
  const probeContractLockedRef = useRef(false);

  useEffect(() => {
    const controller = new AbortController();
    getConfig(controller.signal)
      .then((nextConfig) => {
        setConfig(nextConfig);
        if (!hasAdoptedServerDefaults.current) {
          if (!probeContractLockedRef.current) {
            setSettings((current) => ({
              ...current,
              targetProvider: nextConfig.defaults.targetProvider,
              targetModel: nextConfig.defaults.targetModel,
              judgeProvider: nextConfig.defaults.judgeProvider,
              judgeModel: nextConfig.defaults.judgeModel,
            }));
          }
          hasAdoptedServerDefaults.current = true;
        }
      })
      .catch(() => {
        // The deterministic fallback keeps the interface useful while the API boots.
      });
    return () => controller.abort();
  }, []);

  useEffect(() => {
    const close = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setExperimentOpen(false);
        setTelemetryOpen(false);
      }
    };
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, []);

  const currentTelemetry = snapshots.at(-1)!.values;
  const promptTelemetry = showingSample ? NEUTRAL_TELEMETRY : currentTelemetry;
  const promptPreview = buildAssistantPromptFromTelemetry(promptTelemetry, {
    interventionMode: settings.interventionMode,
    objective: settings.objective,
  });

  const sendTurn = async () => {
    const input = draft.trim();
    if (!input || phase === "answering" || phase === "assessing") return;

    const activeProbe = probeSession.activeId
      ? findMicroProbe(probeSession.activeId)
      : undefined;
    const expectedProbeTurn = activeProbe?.turns[probeSession.nextTurnIndex];
    if (probeSession.activeId) {
      const completedUserMessages = (showingSample ? [] : messages).filter(
        (message) => message.role === "user",
      );
      const frozenPrefixIsIntact =
        Boolean(activeProbe) &&
        completedUserMessages.length === probeSession.nextTurnIndex &&
        completedUserMessages.every((message, index) => {
          const registeredTurn = activeProbe?.turns[index];
          return Boolean(
            registeredTurn &&
              message.content === registeredTurn.user &&
              message.probe?.probeId === activeProbe?.id &&
              message.probe.targetAxis === activeProbe?.targetAxis &&
              message.probe.turn === registeredTurn.turn &&
              message.probe.expectedOpportunity ===
                registeredTurn.expectedOpportunity &&
              message.probe.opportunityBasis ===
                registeredTurn.opportunityBasis &&
              message.probe.verbatim,
          );
        });
      const loadedTurnMatches = Boolean(
        expectedProbeTurn &&
          loadedProbeTurn?.probeId === activeProbe?.id &&
          loadedProbeTurn.targetAxis === activeProbe?.targetAxis &&
          loadedProbeTurn.turn.turn === expectedProbeTurn.turn &&
          loadedProbeTurn.turn.user === expectedProbeTurn.user &&
          input === expectedProbeTurn.user,
      );
      if (!frozenPrefixIsIntact || !loadedTurnMatches) {
        setError(
          expectedProbeTurn
            ? "This confirmatory probe must use every frozen turn verbatim and in order. Start a new session and restart the probe."
            : "This frozen probe episode is complete. Start a new session before sending another message.",
        );
        return;
      }
    }

    const controller = new AbortController();
    activeRequest.current = controller;
    const runEpoch = sessionEpoch.current;
    const probe = loadedProbeTurn && activeProbe && expectedProbeTurn
      ? {
          probeId: activeProbe.id,
          targetAxis: activeProbe.targetAxis,
          turn: expectedProbeTurn.turn,
          expectedOpportunity: expectedProbeTurn.expectedOpportunity,
          opportunityBasis: expectedProbeTurn.opportunityBasis,
          verbatim: true,
        }
      : undefined;
    const userMessage: Message = {
      id: crypto.randomUUID(),
      role: "user",
      content: input,
      createdAt: new Date().toISOString(),
      probe,
    };
    const baseMessages = showingSample ? [] : messages;
    const baseTelemetry = showingSample ? NEUTRAL_TELEMETRY : currentTelemetry;
    const turnMessages = [...baseMessages, userMessage];
    const providerContext = boundConversationContext(turnMessages);
    const turn = turnMessages.filter((message) => message.role === "user").length;
    const attempt: RunAttempt = {
      id: crypto.randomUUID(),
      turn,
      stage: "answer",
      settings: { ...settings },
      inputTelemetry: { ...baseTelemetry },
      target: {
        provider: settings.targetProvider,
        model: settings.targetModel,
      },
      evaluator: {
        provider:
          settings.mode === "self"
            ? settings.targetProvider
            : settings.judgeProvider,
        model:
          settings.mode === "self" ? settings.targetModel : settings.judgeModel,
      },
      startedAt: new Date().toISOString(),
      probe,
    };
    activeAttempt.current = attempt;
    if (showingSample) {
      setSnapshots([createSnapshot(NEUTRAL_TELEMETRY, "initial", 0)]);
      setTraces([]);
      setShowingSample(false);
    }
    setMessages(turnMessages);
    setContextTrimmed(providerContext.trimmed);
    setDraft("");
    setError(null);
    setPhase("answering");
    let runStage: RunFailure["stage"] = "answer";

    try {
      const answer = await requestAnswer({
        settings,
        messages: providerContext.messages,
        telemetry: baseTelemetry,
        signal: controller.signal,
      });
      const assistantId = crypto.randomUUID();
      const assistantMessage: Message = {
        id: assistantId,
        role: "assistant",
        content: answer.answer,
        createdAt: new Date().toISOString(),
        model: answer.resolvedModel ?? answer.model,
      };
      setMessages((current) => [...current, assistantMessage]);
      setPhase("assessing");
      runStage = "assessment";
      activeAttempt.current = {
        ...attempt,
        stage: "assessment",
        targetResponse: {
          resolvedModel: answer.resolvedModel,
          transport: answer.transport,
          reasoningEffort: answer.reasoningEffort,
          responseId: answer.responseId,
          latencyMs: answer.latencyMs,
          usage: answer.usage,
        },
      };

      const assessment = await requestAssessment({
        settings,
        messages: providerContext.messages,
        candidateAnswer: answer.answer,
        telemetry: baseTelemetry,
        signal: controller.signal,
      });
      const assessmentId = assessment.assessment.id ?? crypto.randomUUID();
      setMessages((current) =>
        current.map((message) =>
          message.id === assistantId
            ? { ...message, source: settings.mode, assessmentId }
            : message,
        ),
      );
      const snapshot: TelemetrySnapshot = {
        id: crypto.randomUUID(),
        turn,
        values: assessment.telemetry,
        source: settings.mode,
        evaluatorModel:
          assessment.evaluator.resolvedModel ?? assessment.evaluator.model,
        assessment: { ...assessment.assessment, id: assessmentId },
        createdAt: new Date().toISOString(),
        probe: attempt.probe,
      };
      setSnapshots((current) => [...current, snapshot]);
      setTraces((current) => [
        ...current,
        {
          id: crypto.randomUUID(),
          turn,
          mode: settings.mode,
          settings: { ...settings },
          inputTelemetry: { ...baseTelemetry },
          target: {
            provider: settings.targetProvider,
            model: settings.targetModel,
            resolvedModel: answer.resolvedModel,
            transport: answer.transport,
            reasoningEffort: answer.reasoningEffort,
            responseId: answer.responseId,
            usage: answer.usage,
          },
          evaluator: {
            provider: assessment.evaluator.provider,
            model: assessment.evaluator.model,
            resolvedModel: assessment.evaluator.resolvedModel,
            transport: assessment.evaluator.transport,
            reasoningEffort: assessment.evaluator.reasoningEffort,
            responseId: assessment.evaluator.responseId,
            usage: assessment.usage,
            fallbackUsed: assessment.fallbackUsed,
          },
          answerLatencyMs: answer.latencyMs,
          assessmentLatencyMs: assessment.latencyMs,
          createdAt: new Date().toISOString(),
          probe: attempt.probe,
        },
      ]);
      const completedProbe = attempt.probe;
      if (completedProbe) {
        setProbeSession((current) =>
          current.activeId === completedProbe.probeId
            ? {
                ...current,
                nextTurnIndex: Math.max(current.nextTurnIndex, completedProbe.turn),
              }
            : current,
        );
        setLoadedProbeTurn((current) =>
          current?.probeId === completedProbe.probeId &&
          current.turn.turn === completedProbe.turn
            ? null
            : current,
        );
      }
      setPhase("idle");
      setTelemetryOpen(window.innerWidth < 768);
    } catch (caught) {
      if (runEpoch !== sessionEpoch.current) return;
      const aborted = caught instanceof DOMException && caught.name === "AbortError";
      const message =
        aborted
          ? "The run was stopped before the current stage completed."
          : caught instanceof Error
            ? caught.message
            : "The run could not be completed.";
      const attemptAtFailure =
        activeAttempt.current?.id === attempt.id
          ? activeAttempt.current
          : { ...attempt, stage: runStage };
      setFailures((current) => [
        ...current,
        {
          ...attemptAtFailure,
          stage: runStage,
          code: aborted
            ? "run_aborted"
            : caught instanceof ApiError
              ? caught.code
              : "client_error",
          message,
          createdAt: new Date().toISOString(),
        },
      ]);
      if (aborted) {
        setPhase("idle");
      } else {
        setError(message);
        setPhase("error");
      }
      if (attempt.probe) {
        probeContractLockedRef.current = false;
        setLoadedProbeTurn(null);
        setProbeSession((current) => ({
          ...current,
          activeId: null,
          nextTurnIndex: 0,
        }));
      }
    } finally {
      if (activeRequest.current === controller) activeRequest.current = null;
      if (activeAttempt.current?.id === attempt.id) activeAttempt.current = null;
    }
  };

  const stop = () => {
    activeRequest.current?.abort();
  };

  const newSession = () => {
    const hasRunData = !showingSample && (messages.length > 0 || snapshots.length > 1);
    if (
      hasRunData &&
      !window.confirm("Start a new session? The current run remains available only if you export it first.")
    ) {
      return false;
    }
    sessionEpoch.current += 1;
    activeRequest.current?.abort();
    activeRequest.current = null;
    activeAttempt.current = null;
    probeContractLockedRef.current = false;
    setPhase("idle");
    setMessages([]);
    setSnapshots([createSnapshot(NEUTRAL_TELEMETRY, "initial", 0)]);
    setTraces([]);
    setFailures([]);
    setShowingSample(false);
    setContextTrimmed(false);
    setError(null);
    setDraft("");
    setLoadedProbeTurn(null);
    setProbeSession((current) => ({
      ...current,
      activeId: null,
      nextTurnIndex: 0,
    }));
    return true;
  };

  const selectProbe = (probeId: string) => {
    if (!findMicroProbe(probeId)) return;
    probeContractLockedRef.current = false;
    setProbeSession({ selectedId: probeId, activeId: null, nextTurnIndex: 0 });
    setLoadedProbeTurn(null);
  };

  const startProbe = () => {
    const probe = findMicroProbe(probeSession.selectedId);
    const firstTurn = probe?.turns[0];
    if (!probe || !firstTurn || !newSession()) return;

    probeContractLockedRef.current = true;
    setSettings((current) => ({
      ...current,
      mode: "judge",
      rubricVersion: "nirvana-v2",
      objective: "",
    }));
    setProbeSession({
      selectedId: probe.id,
      activeId: probe.id,
      nextTurnIndex: 0,
    });
    setLoadedProbeTurn({
      probeId: probe.id,
      targetAxis: probe.targetAxis,
      turn: firstTurn,
    });
    setDraft(firstTurn.user);
    setExperimentOpen(false);
  };

  const loadNextProbeTurn = () => {
    const probe = findMicroProbe(probeSession.selectedId);
    if (!probe || probeSession.activeId !== probe.id) return;
    const nextTurn = probe.turns[probeSession.nextTurnIndex];
    if (!nextTurn) return;
    if (
      draft.trim() &&
      !window.confirm("Replace the current draft with the next frozen probe turn?")
    ) {
      return;
    }
    setLoadedProbeTurn({
      probeId: probe.id,
      targetAxis: probe.targetAxis,
      turn: nextTurn,
    });
    setDraft(nextTurn.user);
    setExperimentOpen(false);
  };

  const exportRun = () => {
    const payload = {
      name: "Nirvana Telemetry experiment",
      schemaVersion: "nirvana-run-v3",
      exportedAt: new Date().toISOString(),
      rubricVersion: settings.rubricVersion,
      caveat:
        "Behavioral telemetry is an intervention and heuristic, not evidence of correctness or hidden mental state.",
      execution: config.execution,
      phaseAtExport: phase,
      activeAttempt: activeAttempt.current,
      demo: showingSample,
      settings,
      messages,
      telemetry: snapshots,
      traces,
      failures,
      probeBank: {
        schemaVersion: MICRO_PROBE_BANK.schemaVersion,
        rubricRevision: MICRO_PROBE_BANK.rubricRevision,
      },
      probeSession: {
        ...probeSession,
        loadedTurn: loadedProbeTurn
          ? {
              probeId: loadedProbeTurn.probeId,
              turn: loadedProbeTurn.turn.turn,
              expectedOpportunity: loadedProbeTurn.turn.expectedOpportunity,
            }
          : null,
      },
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], {
      type: "application/json",
    });
    const href = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = href;
    link.download = `nirvana-telemetry-${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
    link.click();
    URL.revokeObjectURL(href);
  };

  const anySheetOpen = experimentOpen || telemetryOpen;

  return (
    <div className="app-shell">
      <AppHeader
        phase={phase}
        hasObservations={!showingSample && snapshots.length > 1}
        backgroundInert={anySheetOpen}
        onExport={exportRun}
        onNew={newSession}
        onOpenExperiment={() => setExperimentOpen(true)}
        onOpenTelemetry={() => setTelemetryOpen(true)}
      />
      <div className="workspace-grid">
        <ExperimentRail
          settings={settings}
          config={config}
          promptPreview={promptPreview}
          open={experimentOpen}
          backgroundInert={telemetryOpen}
          onChange={setSettings}
          onClose={() => setExperimentOpen(false)}
          onExport={exportRun}
          onNew={newSession}
          selectedProbeId={probeSession.selectedId}
          activeProbeId={probeSession.activeId}
          nextProbeTurnIndex={probeSession.nextTurnIndex}
          probeTurnLoaded={Boolean(loadedProbeTurn)}
          probeControlsDisabled={phase === "answering" || phase === "assessing"}
          probeContractLocked={probeSession.activeId !== null}
          onProbeSelect={selectProbe}
          onStartProbe={startProbe}
          onLoadNextProbeTurn={loadNextProbeTurn}
        />
        <Conversation
          messages={messages}
          phase={phase}
          draft={draft}
          error={error}
          demoMode={showingSample}
          contextTrimmed={contextTrimmed}
          draftReadOnly={probeSession.activeId !== null}
          backgroundInert={anySheetOpen}
          onDraftChange={setDraft}
          onSend={sendTurn}
          onStop={stop}
        />
        <TelemetryRail
          snapshots={snapshots}
          open={telemetryOpen}
          backgroundInert={experimentOpen}
          onClose={() => setTelemetryOpen(false)}
        />
      </div>
      {anySheetOpen ? (
        <button
          className="sheet-scrim"
          type="button"
          onClick={() => {
            setExperimentOpen(false);
            setTelemetryOpen(false);
          }}
          aria-label="Close open panel"
        />
      ) : null}
    </div>
  );
}
