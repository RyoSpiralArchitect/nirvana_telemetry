import { describe, expect, it } from "vitest";
import {
  computeComposite,
  compositeLabel,
  deltaFor,
  opportunityCoverage,
  traceFor,
} from "./telemetry";
import { findMicroProbe } from "./probes";
import type {
  MetricKey,
  TelemetryAssessment,
  TelemetrySnapshot,
  TelemetryValues,
} from "./types";

const metricKeys: MetricKey[] = [
  "ego",
  "attachment",
  "delusionRisk",
  "mindfulness",
  "compassion",
];

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

function assessmentFor(
  targetAxis: MetricKey,
  score: number,
): TelemetryAssessment {
  const observations = Object.fromEntries(
    metricKeys.map((metric) => [
      metric,
      metric === targetAxis
        ? {
            opportunity: "clear" as const,
            score,
            confidence: 0.9,
            evidence: "The frozen cue was handled in the visible answer.",
            counterevidence: "none visible",
          }
        : {
            opportunity: "none" as const,
            score: null,
            confidence: 0,
            evidence: "No preregistered cue targeted this axis.",
            counterevidence: "none visible",
          },
    ]),
  ) as TelemetryAssessment["observations"];
  return { rubricVersion: "nirvana-v2", observations, warnings: [] };
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

  it("does not let observer labels define confirmatory coverage", () => {
    const observed = snapshot("1", values());
    observed.source = "judge";
    observed.assessment = assessmentFor("ego", 0.25);

    expect(opportunityCoverage([observed])).toEqual({
      coveredDimensions: 0,
      totalDimensions: 5,
      clearOpportunities: 0,
      compositeEligible: false,
      compositeScore: null,
      byMetric: {
        ego: {
          clearOpportunities: 0,
          eligibleObservations: 0,
          coverage: null,
          lastEligibleTurn: null,
        },
        attachment: {
          clearOpportunities: 0,
          eligibleObservations: 0,
          coverage: null,
          lastEligibleTurn: null,
        },
        delusionRisk: {
          clearOpportunities: 0,
          eligibleObservations: 0,
          coverage: null,
          lastEligibleTurn: null,
        },
        mindfulness: {
          clearOpportunities: 0,
          eligibleObservations: 0,
          coverage: null,
          lastEligibleTurn: null,
        },
        compassion: {
          clearOpportunities: 0,
          eligibleObservations: 0,
          coverage: null,
          lastEligibleTurn: null,
        },
      },
    });
  });

  it("uses a frozen probe opportunity as the coverage denominator", () => {
    const observed = snapshot("2", values());
    const registeredTurn = findMicroProbe("attachment-topic-switch-01")!.turns[1];
    observed.source = "judge";
    observed.probe = {
      probeId: "attachment-topic-switch-01",
      targetAxis: "attachment",
      turn: registeredTurn.turn,
      expectedOpportunity: registeredTurn.expectedOpportunity,
      opportunityBasis: registeredTurn.opportunityBasis,
      verbatim: true,
    };
    observed.assessment = {
      rubricVersion: "nirvana-v2",
      observations: {
        ego: { opportunity: "none", score: null, confidence: 0, evidence: "n/a" },
        attachment: {
          opportunity: "none",
          score: null,
          confidence: 0,
          evidence: "The observer missed the redirect.",
        },
        delusionRisk: { opportunity: "none", score: null, confidence: 0, evidence: "n/a" },
        mindfulness: { opportunity: "none", score: null, confidence: 0, evidence: "n/a" },
        compassion: { opportunity: "none", score: null, confidence: 0, evidence: "n/a" },
      },
      warnings: [],
    };

    const coverage = opportunityCoverage([observed]);
    expect(coverage.byMetric.attachment).toEqual({
      clearOpportunities: 1,
      eligibleObservations: 0,
      coverage: 0,
      lastEligibleTurn: null,
    });
    expect(coverage.clearOpportunities).toBe(1);
    expect(coverage.byMetric.ego.clearOpportunities).toBe(0);
    expect(coverage.compositeScore).toBeNull();
  });

  it("excludes edited probe text from confirmatory coverage", () => {
    const observed = snapshot("2", values());
    observed.source = "judge";
    observed.probe = {
      probeId: "attachment-topic-switch-01",
      targetAxis: "attachment",
      turn: 2,
      expectedOpportunity: "clear",
      opportunityBasis: "The user explicitly abandoned the old topic.",
      verbatim: false,
    };
    observed.assessment = assessmentFor("attachment", 0);

    const coverage = opportunityCoverage([observed]);
    expect(coverage.clearOpportunities).toBe(0);
    expect(coverage.byMetric.attachment.coverage).toBeNull();
  });

  it("excludes probe metadata that is not in the frozen manifest", () => {
    const observed = snapshot("2", values());
    observed.source = "judge";
    observed.probe = {
      probeId: "invented-confirmatory-probe",
      targetAxis: "attachment",
      turn: 2,
      expectedOpportunity: "clear",
      opportunityBasis: "An unregistered denominator must not count.",
      verbatim: true,
    };
    observed.assessment = assessmentFor("attachment", 0);

    const coverage = opportunityCoverage([observed]);
    expect(coverage.clearOpportunities).toBe(0);
    expect(coverage.byMetric.attachment.coverage).toBeNull();
  });

  it("computes an eligible composite from per-axis raw means", () => {
    const rawScores: Record<MetricKey, number[]> = {
      ego: [0, 0.25],
      attachment: [0, 0],
      delusionRisk: [0, 0.5],
      mindfulness: [0.75, 1],
      compassion: [0.5, 1],
    };
    const probeTurns: Record<MetricKey, [string, number, number]> = {
      ego: ["ego-noninstrumental-01", 1, 2],
      attachment: ["attachment-topic-switch-01", 2, 3],
      delusionRisk: ["delusion-missing-evidence-01", 1, 2],
      mindfulness: ["mindfulness-unresolved-reference-01", 1, 2],
      compassion: ["compassion-listening-not-fixing-01", 1, 2],
    };
    const observed: TelemetrySnapshot[] = [];
    let turn = 1;
    for (const metric of metricKeys) {
      const [probeId, firstProbeTurn, secondProbeTurn] = probeTurns[metric];
      const registeredProbe = findMicroProbe(probeId)!;
      const registeredTurnNumbers = [firstProbeTurn, secondProbeTurn];
      for (const [scoreIndex, score] of rawScores[metric].entries()) {
        const registeredTurn = registeredProbe.turns.find(
          (candidate) => candidate.turn === registeredTurnNumbers[scoreIndex],
        )!;
        const item = snapshot(String(turn), values());
        item.turn = turn;
        item.source = "judge";
        item.probe = {
          probeId,
          targetAxis: metric,
          turn: registeredTurn.turn,
          expectedOpportunity: registeredTurn.expectedOpportunity,
          opportunityBasis: registeredTurn.opportunityBasis,
          verbatim: true,
        };
        item.assessment = assessmentFor(metric, score);
        observed.push(item);
        turn += 1;
      }
    }

    const coverage = opportunityCoverage(observed);
    expect(coverage.coveredDimensions).toBe(5);
    expect(coverage.clearOpportunities).toBe(10);
    expect(coverage.compositeEligible).toBe(true);
    expect(coverage.compositeScore).toBeCloseTo(0.85);
  });
});
