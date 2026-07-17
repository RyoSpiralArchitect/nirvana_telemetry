import type {
  AppConfig,
  AssessResult,
  ExperimentSettings,
  Message,
  RespondResult,
  TelemetryValues,
} from "./types";

export class ApiError extends Error {
  status: number;
  code: string;

  constructor(message: string, status: number, code = "api_error") {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...init,
    headers: {
      "content-type": "application/json",
      ...init?.headers,
    },
  });
  const payload = (await response.json().catch(() => ({}))) as {
    error?: string;
    code?: string;
  };
  if (!response.ok) {
    throw new ApiError(
      payload.error ?? `Request failed with status ${response.status}.`,
      response.status,
      payload.code,
    );
  }
  return payload as T;
}

export function getConfig(signal?: AbortSignal): Promise<AppConfig> {
  return request<AppConfig>("/api/config", { signal });
}

export function requestAnswer(args: {
  settings: ExperimentSettings;
  messages: Message[];
  telemetry: TelemetryValues;
  signal?: AbortSignal;
}): Promise<RespondResult> {
  return request<RespondResult>("/api/respond", {
    method: "POST",
    signal: args.signal,
    body: JSON.stringify({
      provider: args.settings.targetProvider,
      model: args.settings.targetModel,
      messages: args.messages.map(({ role, content }) => ({ role, content })),
      telemetry: args.telemetry,
      feedState: args.settings.feedState,
      objective: args.settings.objective,
    }),
  });
}

export function requestAssessment(args: {
  settings: ExperimentSettings;
  messages: Message[];
  candidateAnswer: string;
  telemetry: TelemetryValues;
  signal?: AbortSignal;
}): Promise<AssessResult> {
  return request<AssessResult>("/api/assess", {
    method: "POST",
    signal: args.signal,
    body: JSON.stringify({
      mode: args.settings.mode,
      target: {
        provider: args.settings.targetProvider,
        model: args.settings.targetModel,
      },
      judge: {
        provider: args.settings.judgeProvider,
        model: args.settings.judgeModel,
      },
      messages: args.messages.map(({ role, content }) => ({ role, content })),
      candidateAnswer: args.candidateAnswer,
      previousTelemetry: args.telemetry,
    }),
  });
}
