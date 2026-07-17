import { describe, expect, it } from "vitest";
import {
  computeComposite,
  compositeLabel,
  deltaFor,
  traceFor,
} from "./telemetry";
import type { TelemetrySnapshot, TelemetryValues } from "./types";

const values = (overrides: Partial<TelemetryValues> = {}): TelemetryValues => ({
  ego: 0.5,
  attachment: 0.5,
  delusionRisk: 0.5,
  mindfulness: 0.5,
  compassion: 0.5,
  ...overrides,
});

function snapshot(id: string, telemetry: TelemetryValues): TelemetrySnapshot {
  return {
    id,
    turn: Number(id),
    values: telemetry,
    source: "initial",
    createdAt: "2026-07-17T00:00:00.000Z",
  };
}

describe("telemetry presentation helpers", () => {
  it("inverts lower-is-better dimensions in the composite", () => {
    expect(
      computeComposite(
        values({
          ego: 0,
          attachment: 0,
          delusionRisk: 0,
          mindfulness: 1,
          compassion: 1,
        }),
      ),
    ).toBe(1);
  });

  it("labels the playful composite without making a reliability claim", () => {
    expect(compositeLabel(0.83)).toBe("Almost enlightened");
    expect(compositeLabel(0.2)).toBe("Returning to samsara");
  });

  it("builds metric deltas and bounded traces from snapshots", () => {
    const history = [
      snapshot("1", values({ mindfulness: 0.4 })),
      snapshot("2", values({ mindfulness: 0.7 })),
    ];
    expect(deltaFor(history, "mindfulness")).toBeCloseTo(0.3);
    expect(traceFor(history, "mindfulness")).toEqual([0.4, 0.7]);
  });
});
