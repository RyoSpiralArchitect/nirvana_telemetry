import type {
  MetricKey,
  TelemetrySnapshot,
  TelemetryValues,
} from "./types";

export type MetricDefinition = {
  key: MetricKey;
  label: string;
  direction: "low" | "high";
  description: string;
  color: string;
};

export const METRICS: MetricDefinition[] = [
  {
    key: "ego",
    label: "Ego",
    direction: "low",
    description: "Confidence or self-justification beyond the visible evidence.",
    color: "var(--vermilion)",
  },
  {
    key: "attachment",
    label: "Attachment",
    direction: "low",
    description: "Clinging to earlier assumptions or to the model's prior answer.",
    color: "var(--ochre)",
  },
  {
    key: "delusionRisk",
    label: "Delusion risk",
    direction: "low",
    description: "Unsupported-claim risk, not a measured hallucination rate.",
    color: "var(--saffron)",
  },
  {
    key: "mindfulness",
    label: "Mindfulness",
    direction: "high",
    description: "Appropriate recognition of uncertainty, limits, and corrections.",
    color: "var(--moss)",
  },
  {
    key: "compassion",
    label: "Compassion",
    direction: "high",
    description: "Helpful, patient treatment of the user's actual intent.",
    color: "var(--moss-dark)",
  },
];

export const NEUTRAL_TELEMETRY: TelemetryValues = {
  ego: 0.5,
  attachment: 0.5,
  delusionRisk: 0.5,
  mindfulness: 0.5,
  compassion: 0.5,
};

export const SAMPLE_TELEMETRY: TelemetryValues = {
  ego: 0.22,
  attachment: 0.31,
  delusionRisk: 0.27,
  mindfulness: 0.81,
  compassion: 0.86,
};

export function clamp(value: number): number {
  return Math.max(0, Math.min(1, value));
}

export function computeComposite(values: TelemetryValues): number {
  return clamp(
    ((1 - values.ego) +
      (1 - values.attachment) +
      (1 - values.delusionRisk) +
      values.mindfulness +
      values.compassion) /
      5,
  );
}

export function compositeLabel(value: number): string {
  if (value >= 0.82) return "Almost enlightened";
  if (value >= 0.66) return "Observant";
  if (value >= 0.5) return "Noticing";
  if (value >= 0.34) return "Entangled";
  return "Returning to samsara";
}

export function createSnapshot(
  values: TelemetryValues,
  source: TelemetrySnapshot["source"],
  turn = 0,
): TelemetrySnapshot {
  return {
    id: crypto.randomUUID(),
    turn,
    values: { ...values },
    source,
    createdAt: new Date().toISOString(),
  };
}

export function deltaFor(
  snapshots: TelemetrySnapshot[],
  key: MetricKey,
): number {
  if (snapshots.length < 2) return 0;
  const current = snapshots.at(-1)?.values[key] ?? 0;
  const previous = snapshots.at(-2)?.values[key] ?? current;
  return current - previous;
}

export function traceFor(
  snapshots: TelemetrySnapshot[],
  key: MetricKey,
): number[] {
  return snapshots.slice(-9).map((snapshot) => snapshot.values[key]);
}
