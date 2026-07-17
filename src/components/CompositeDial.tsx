import type { CSSProperties } from "react";
import { computeComposite, compositeLabel } from "../telemetry";
import type { TelemetryValues } from "../types";

type Props = {
  values: TelemetryValues;
  provenance?: string;
};

export function CompositeDial({ values, provenance }: Props) {
  const value = computeComposite(values);
  const percentage = Math.round(value * 100);
  const saffronPercentage = Math.round(percentage * 0.28);
  const label = compositeLabel(value);

  return (
    <div className="composite-block">
      <div
        className="composite-dial"
        role="img"
        aria-label={`Composite behavioral heuristic ${value.toFixed(2)}, ${label}`}
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
          <strong>{value.toFixed(2)}</strong>
          <span>· {label}</span>
        </div>
      </div>
      {provenance ? <p className="score-provenance">{provenance}</p> : null}
      <p>A playful heuristic — not a reliability claim.</p>
      <strong className="enlightenment-line">
        {value >= 0.82 ? "Almost enlightened" : "Still observing"}
      </strong>
    </div>
  );
}
