export type ProviderId = "mock" | "openai" | "anthropic";
export type ProviderTransport =
  | "mock"
  | "responses"
  | "chat_completions"
  | "messages";
export type TokenUsage = { inputTokens?: number; outputTokens?: number };
export type ReasoningEffort =
  | "none"
  | "low"
  | "medium"
  | "high"
  | "xhigh"
  | "max";
export type UpdateMode = "self" | "judge";
export type RubricVersion = "nirvana-v1" | "nirvana-v2";
export type InterventionMode = "feedback" | "control" | "shadow";
export type ObservationOpportunity = "none" | "weak" | "clear";
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
  probe?: ProbeTurnReference;
};

export type ProbeTurnReference = {
  probeId: string;
  targetAxis: MetricKey;
  turn: number;
  expectedOpportunity: ObservationOpportunity;
  opportunityBasis: string;
  verbatim: boolean;
};

export type Observation = {
  score: number | null;
  confidence: number;
  evidence: string;
  opportunity?: ObservationOpportunity;
  counterevidence?: string;
};

export type TelemetryAssessment = {
  id?: string;
  rubricVersion: RubricVersion;
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
  probe?: ProbeTurnReference;
};

export type ProviderConfig = {
  id: ProviderId;
  label: string;
  available: boolean;
  defaultModel: string;
  models?: string[];
  modelOptions?: ModelOption[];
  detail?: string;
};

export type ModelOption = {
  id: string;
  label: string;
  role: string;
  transport: ProviderTransport;
  featured: boolean;
};

export type ExecutionConfig = {
  maxOutputTokens: number;
  openai: {
    apiMode: "responses" | "chat_completions";
    reasoningEffort: ReasoningEffort;
  };
  temperaturePolicy: {
    responses: { kind: "omitted" };
    chat_completions: {
      kind: "request_value";
      answer: number;
      assessment: number;
      reasoningModels: "omitted";
    };
    messages: { kind: "omitted" };
    mock: { kind: "deterministic" };
  };
};

export type AppConfig = {
  providers: ProviderConfig[];
  execution: ExecutionConfig;
  defaults: {
    targetProvider: ProviderId;
    targetModel: string;
    judgeProvider: ProviderId;
    judgeModel: string;
  };
  telemetry?: {
    rubricVersion: RubricVersion;
    supportedRubricVersions?: RubricVersion[];
  };
};

export type ExperimentSettings = {
  targetProvider: ProviderId;
  targetModel: string;
  mode: UpdateMode;
  rubricVersion: RubricVersion;
  judgeProvider: ProviderId;
  judgeModel: string;
  interventionMode: InterventionMode;
  objective: string;
};

export type RespondResult = {
  answer: string;
  model: string;
  resolvedModel?: string;
  provider: ProviderId;
  transport?: ProviderTransport;
  reasoningEffort?: ReasoningEffort;
  responseId?: string;
  usage?: TokenUsage;
  latencyMs: number;
};

export type AssessResult = {
  assessment: TelemetryAssessment;
  telemetry: TelemetryValues;
  evaluator: {
    provider: ProviderId;
    model: string;
    resolvedModel?: string;
    source: UpdateMode;
    transport?: ProviderTransport;
    reasoningEffort?: ReasoningEffort;
    responseId?: string;
  };
  usage?: TokenUsage;
  latencyMs: number;
  fallbackUsed?: boolean;
};

export type TurnTrace = {
  id: string;
  turn: number;
  mode: UpdateMode;
  settings: ExperimentSettings;
  inputTelemetry: TelemetryValues;
  target: {
    provider: ProviderId;
    model: string;
    resolvedModel?: string;
    transport?: ProviderTransport;
    reasoningEffort?: ReasoningEffort;
    responseId?: string;
    usage?: TokenUsage;
  };
  evaluator: {
    provider: ProviderId;
    model: string;
    resolvedModel?: string;
    transport?: ProviderTransport;
    reasoningEffort?: ReasoningEffort;
    responseId?: string;
    usage?: TokenUsage;
    fallbackUsed?: boolean;
  };
  answerLatencyMs: number;
  assessmentLatencyMs: number;
  createdAt: string;
  probe?: ProbeTurnReference;
};

export type RunAttempt = {
  id: string;
  turn: number;
  stage: "answer" | "assessment";
  settings: ExperimentSettings;
  inputTelemetry: TelemetryValues;
  target: { provider: ProviderId; model: string };
  evaluator?: { provider: ProviderId; model: string };
  targetResponse?: {
    resolvedModel?: string;
    transport?: ProviderTransport;
    reasoningEffort?: ReasoningEffort;
    responseId?: string;
    latencyMs: number;
    usage?: TokenUsage;
  };
  startedAt: string;
  probe?: ProbeTurnReference;
};

export type RunFailure = RunAttempt & {
  code: string;
  message: string;
  createdAt: string;
};
