export type ProviderId = "mock" | "openai" | "anthropic";
export type UpdateMode = "self" | "judge";
export type RunPhase = "idle" | "answering" | "assessing" | "error";

export type MetricKey =
  | "ego"
  | "attachment"
  | "delusionRisk"
  | "mindfulness"
  | "compassion";

export type TelemetryValues = Record<MetricKey, number>;

export type Message = {
  id: string;
  role: "user" | "assistant";
  content: string;
  createdAt: string;
  source?: "self" | "judge" | "sample";
  model?: string;
  assessmentId?: string;
};

export type Observation = {
  score: number | null;
  confidence: number;
  evidence: string;
};

export type TelemetryAssessment = {
  id?: string;
  rubricVersion: "nirvana-v1";
  observations: Record<MetricKey, Observation>;
  warnings: string[];
};

export type TelemetrySnapshot = {
  id: string;
  turn: number;
  values: TelemetryValues;
  source: "initial" | "self" | "judge" | "sample";
  evaluatorModel?: string;
  createdAt: string;
  assessment?: TelemetryAssessment;
};

export type ProviderConfig = {
  id: ProviderId;
  label: string;
  available: boolean;
  defaultModel: string;
  models?: string[];
  detail?: string;
};

export type AppConfig = {
  providers: ProviderConfig[];
  defaults: {
    targetProvider: ProviderId;
    targetModel: string;
    judgeProvider: ProviderId;
    judgeModel: string;
  };
};

export type ExperimentSettings = {
  targetProvider: ProviderId;
  targetModel: string;
  mode: UpdateMode;
  judgeProvider: ProviderId;
  judgeModel: string;
  feedState: boolean;
  objective: string;
};

export type RespondResult = {
  answer: string;
  model: string;
  provider: ProviderId;
  usage?: { inputTokens?: number; outputTokens?: number };
  latencyMs: number;
};

export type AssessResult = {
  assessment: TelemetryAssessment;
  telemetry: TelemetryValues;
  evaluator: { provider: ProviderId; model: string; source: UpdateMode };
  usage?: { inputTokens?: number; outputTokens?: number };
  latencyMs: number;
};

export type TurnTrace = {
  id: string;
  turn: number;
  mode: UpdateMode;
  target: { provider: ProviderId; model: string };
  evaluator: { provider: ProviderId; model: string };
  answerLatencyMs: number;
  assessmentLatencyMs: number;
  createdAt: string;
};
