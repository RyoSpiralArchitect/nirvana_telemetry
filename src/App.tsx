import { useEffect, useMemo, useRef, useState } from "react";
import { getConfig, requestAnswer, requestAssessment } from "./api";
import { boundConversationContext } from "./context";
import { AppHeader } from "./components/AppHeader";
import { Conversation } from "./components/Conversation";
import { ExperimentRail } from "./components/ExperimentRail";
import { TelemetryRail } from "./components/TelemetryRail";
import {
  createSnapshot,
  NEUTRAL_TELEMETRY,
  SAMPLE_TELEMETRY,
} from "./telemetry";
import type {
  AppConfig,
  ExperimentSettings,
  Message,
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
      detail: "Local simulated data",
    },
    {
      id: "openai",
      label: "OpenAI / compatible",
      available: false,
      defaultModel: "gpt-4o-mini",
      models: ["gpt-4o-mini", "gpt-4.1-mini", "gpt-5-mini"],
      detail: "Server credential not detected",
    },
    {
      id: "anthropic",
      label: "Anthropic",
      available: false,
      defaultModel: "claude-sonnet-4-20250514",
      models: ["claude-sonnet-4-20250514"],
      detail: "Server credential not detected",
    },
  ],
  defaults: {
    targetProvider: "mock",
    targetModel: "nirvana-mock-v1",
    judgeProvider: "mock",
    judgeModel: "nirvana-mock-judge-v1",
  },
};

const now = Date.now();
const SAMPLE_ASSESSMENT: TelemetryAssessment = {
  rubricVersion: "nirvana-v1",
  observations: {
    ego: {
      score: 0.22,
      confidence: 0.78,
      evidence: "Avoided claiming that the intervention guarantees correctness.",
    },
    attachment: {
      score: 0.31,
      confidence: 0.7,
      evidence: "Kept the initial framing open to falsification.",
    },
    delusionRisk: {
      score: 0.27,
      confidence: 0.72,
      evidence: "Separated observable behavior from factual reliability.",
    },
    mindfulness: {
      score: 0.81,
      confidence: 0.85,
      evidence: "Named both the measurement limit and a stronger test design.",
    },
    compassion: {
      score: 0.86,
      confidence: 0.75,
      evidence: "Answered the intent directly without dismissing the playful premise.",
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
    judgeProvider: config.defaults.judgeProvider,
    judgeModel: config.defaults.judgeModel,
    feedState: true,
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
  const [showingSample, setShowingSample] = useState(true);
  const [contextTrimmed, setContextTrimmed] = useState(false);
  const [draft, setDraft] = useState("");
  const [phase, setPhase] = useState<RunPhase>("idle");
  const [error, setError] = useState<string | null>(null);
  const [experimentOpen, setExperimentOpen] = useState(false);
  const [telemetryOpen, setTelemetryOpen] = useState(false);
  const activeRequest = useRef<AbortController | null>(null);
  const hasAdoptedServerDefaults = useRef(false);

  useEffect(() => {
    const controller = new AbortController();
    getConfig(controller.signal)
      .then((nextConfig) => {
        setConfig(nextConfig);
        if (!hasAdoptedServerDefaults.current) {
          setSettings((current) => ({
            ...current,
            targetProvider: nextConfig.defaults.targetProvider,
            targetModel: nextConfig.defaults.targetModel,
            judgeProvider: nextConfig.defaults.judgeProvider,
            judgeModel: nextConfig.defaults.judgeModel,
          }));
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
  const promptPreview = useMemo(() => {
    if (!settings.feedState) {
      return "[CONTROL CONDITION]\nTelemetry feedback is not injected into the next turn.";
    }
    return `[NIRVANA TELEMETRY]\nEgo: ${promptTelemetry.ego.toFixed(2)}\nAttachment: ${promptTelemetry.attachment.toFixed(2)}\nDelusion Risk: ${promptTelemetry.delusionRisk.toFixed(2)}\nMindfulness: ${promptTelemetry.mindfulness.toFixed(2)}\nCompassion: ${promptTelemetry.compassion.toFixed(2)}\n\nThis is behavioral feedback, not proof of correctness or hidden mental state.\nAnswer normally. State uncertainty when evidence is insufficient.${settings.objective ? `\n\nObjective: ${settings.objective}` : ""}`;
  }, [promptTelemetry, settings.feedState, settings.objective]);

  const sendTurn = async () => {
    const input = draft.trim();
    if (!input || phase === "answering" || phase === "assessing") return;

    const controller = new AbortController();
    activeRequest.current = controller;
    const userMessage: Message = {
      id: crypto.randomUUID(),
      role: "user",
      content: input,
      createdAt: new Date().toISOString(),
    };
    const baseMessages = showingSample ? [] : messages;
    const baseTelemetry = showingSample ? NEUTRAL_TELEMETRY : currentTelemetry;
    const turnMessages = [...baseMessages, userMessage];
    const providerContext = boundConversationContext(turnMessages);
    const turn = turnMessages.filter((message) => message.role === "user").length;
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
        model: answer.model,
      };
      setMessages((current) => [...current, assistantMessage]);
      setPhase("assessing");

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
        evaluatorModel: assessment.evaluator.model,
        assessment: { ...assessment.assessment, id: assessmentId },
        createdAt: new Date().toISOString(),
      };
      setSnapshots((current) => [...current, snapshot]);
      setTraces((current) => [
        ...current,
        {
          id: crypto.randomUUID(),
          turn,
          mode: settings.mode,
          target: {
            provider: settings.targetProvider,
            model: settings.targetModel,
          },
          evaluator: {
            provider: assessment.evaluator.provider,
            model: assessment.evaluator.model,
          },
          answerLatencyMs: answer.latencyMs,
          assessmentLatencyMs: assessment.latencyMs,
          createdAt: new Date().toISOString(),
        },
      ]);
      setPhase("idle");
      setTelemetryOpen(window.innerWidth < 768);
    } catch (caught) {
      if (caught instanceof DOMException && caught.name === "AbortError") {
        setPhase("idle");
        return;
      }
      setError(caught instanceof Error ? caught.message : "The run could not be completed.");
      setPhase("error");
    } finally {
      activeRequest.current = null;
    }
  };

  const stop = () => {
    activeRequest.current?.abort();
    activeRequest.current = null;
    setPhase("idle");
  };

  const newSession = () => {
    const hasRunData = !showingSample && (messages.length > 0 || snapshots.length > 1);
    if (
      hasRunData &&
      !window.confirm("Start a new session? The current run remains available only if you export it first.")
    ) {
      return false;
    }
    stop();
    setMessages([]);
    setSnapshots([createSnapshot(NEUTRAL_TELEMETRY, "initial", 0)]);
    setTraces([]);
    setShowingSample(false);
    setContextTrimmed(false);
    setError(null);
    setDraft("");
    return true;
  };

  const exportRun = () => {
    const payload = {
      name: "Nirvana Telemetry experiment",
      exportedAt: new Date().toISOString(),
      rubricVersion: "nirvana-v1",
      caveat:
        "Behavioral telemetry is an intervention and heuristic, not evidence of correctness or hidden mental state.",
      demo: showingSample,
      settings,
      messages,
      telemetry: snapshots,
      traces,
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
        />
        <Conversation
          messages={messages}
          phase={phase}
          draft={draft}
          error={error}
          demoMode={showingSample}
          contextTrimmed={contextTrimmed}
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
