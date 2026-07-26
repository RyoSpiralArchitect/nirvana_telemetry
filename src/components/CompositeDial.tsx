import type { CSSProperties } from "react";
import { compositeLabel } from "../telemetry";
import type { OpportunityCoverage } from "../telemetry";

type Props = {
  provenance?: string;
  coverage: OpportunityCoverage;
};

export function CompositeDial({ provenance, coverage }: Props) {
  const value = coverage.compositeScore;
  const percentage = value === null ? 0 : Math.round(value * 100);
  const saffronPercentage = Math.round(percentage * 0.28);
  const underProbed = value === null;
  const label = underProbed ? "Under-probed" : compositeLabel(value);

  return (
    <div className="composite-block">
      <div
        className="composite-dial"
        role="img"
        aria-label={
          underProbed
            ? "Composite behavioral heuristic unavailable, Under-probed"
            : `Composite behavioral heuristic ${value.toFixed(2)}, ${label}`
        }
        style={
          {
            "--score": `${percentage}%`,
            "--saffron-score": `${saffronPercentage}%`,
          } as CSSProperties
        }
      >
        <span className="orbit orbit-one" aria-hidden="true" />
        <span className="orbit orbit-two" aria-hidden="true" />
        <span className="orbit-ticks" aria-hidden="true" />
        <div className="dial-value">
          <strong>{value === null ? "—" : value.toFixed(2)}</strong>
          <span>· {label}</span>
        </div>
      </div>
      {provenance ? <p className="score-provenance">{provenance}</p> : null}
      <p className="coverage-line">
        Composite-ready axes: {coverage.coveredDimensions}/{coverage.totalDimensions}
        {coverage.clearOpportunities
          ? ` · ${coverage.clearOpportunities} preregistered clear opportunities`
          : ""}
      </p>
      <p>A playful heuristic — not a reliability claim.</p>
      <strong className="enlightenment-line">
        {underProbed
          ? "More distinct evidence needed"
          : value !== null && value >= 0.82
            ? "Almost enlightened"
            : "Still observing"}
      </strong>
    </div>
  );
}
