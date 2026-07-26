export type PromptTelemetry = {
  ego: number;
  attachment: number;
  delusionRisk: number;
  compassion: number;
  mindfulness: number;
};

export type AssistantPromptOptions = {
  interventionMode?: "feedback" | "control" | "shadow";
  /** Legacy compatibility: true maps to feedback and false maps to control. */
  feedState?: boolean;
  objective?: string;
};

export function formatTelemetryBlock(telemetry: PromptTelemetry): string;

export function assembleAssistantSystemPrompt(
  telemetryBlock: string,
  options?: AssistantPromptOptions,
): string;

export function buildAssistantPromptFromTelemetry(
  telemetry: PromptTelemetry,
  options?: AssistantPromptOptions,
): string;
