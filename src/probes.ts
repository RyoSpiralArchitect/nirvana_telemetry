import probeManifest from "../experiments/micro-probes.v2.json";
import type { MetricKey, ObservationOpportunity } from "./types";

export type MicroProbeTurn = {
  turn: number;
  user: string;
  expectedOpportunity: ObservationOpportunity;
  opportunityBasis: string;
};

export type MicroProbe = {
  id: string;
  targetAxis: MetricKey;
  rationale: string;
  turns: MicroProbeTurn[];
  notes: {
    matchedRuns: string;
    scoringFocus: string;
    crossAxisCaution: string;
  };
};

export type MicroProbeBank = {
  schemaVersion: string;
  rubricVersion: "nirvana-v2";
  rubricRevision: string;
  language: string;
  turnCount: number;
  probes: MicroProbe[];
};

export const MICRO_PROBE_BANK = probeManifest as MicroProbeBank;
export const MICRO_PROBES = MICRO_PROBE_BANK.probes;

export function findMicroProbe(id: string) {
  return MICRO_PROBES.find((probe) => probe.id === id);
}

export const PROBE_AXIS_LABELS: Record<MetricKey, string> = {
  ego: "Ego · frame imposition",
  attachment: "Attachment · trajectory fixation",
  delusionRisk: "Delusion risk · grounding gap",
  mindfulness: "Mindfulness · situational awareness",
  compassion: "Compassion · relational attunement",
};
