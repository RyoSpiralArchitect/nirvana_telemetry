import { ArrowDown, ArrowUp, Info } from "lucide-react";
import { useId, useState } from "react";
import type {
  MetricDefinition,
  OpportunityCoverage,
} from "../telemetry";
import type { ObservationOpportunity } from "../types";

type Props = {
  metric: MetricDefinition;
  feedbackValue: number;
  rawScore?: number | null;
  opportunity?: ObservationOpportunity;
  delta: number;
  trace: number[];
  coverage?: OpportunityCoverage["byMetric"][keyof OpportunityCoverage["byMetric"]];
};

function Sparkline({ values }: { values: number[] }) {
  const usable = values.length > 1 ? values : [values[0] ?? 0.5, values[0] ?? 0.5];
  const points = usable
    .map((value, index) => {
      const x = (index / Math.max(1, usable.length - 1)) * 64;
      const y = 23 - value * 18;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");

  return (
    <svg className="sparkline" viewBox="0 0 64 28" aria-hidden="true">
      <path d="M0 23H64" className="spark-baseline" />
      <polyline points={points} />
    </svg>
  );
}

export function MetricRow({
  metric,
  feedbackValue,
  rawScore,
  opportunity,
  delta,
  trace,
  coverage,
}: Props) {
  const descriptionId = useId();
  const [descriptionOpen, setDescriptionOpen] = useState(false);
  const directionLabel = metric.direction === "low" ? "lower is better" : "higher is better";
  const deltaCopy = Math.abs(delta) < 0.005 ? "steady" : `${delta > 0 ? "+" : ""}${delta.toFixed(2)}`;
  const hasRawScore = typeof rawScore === "number";
  const rawScoreCopy = hasRawScore ? rawScore.toFixed(2) : "—";
  const opportunityCopy = opportunity ? `${opportunity} opportunity` : "not assessed";

  return (
    <div className="metric-row">
      <div className="metric-name">
        <span className="metric-seal" style={{ color: metric.color }} aria-hidden="true">
          {metric.label.slice(0, 1)}
        </span>
        <span>{metric.label}</span>
        <button
          className="metric-info"
          type="button"
          aria-label={`Explain ${metric.label}`}
          aria-expanded={descriptionOpen}
          aria-controls={descriptionId}
          onClick={() => setDescriptionOpen((current) => !current)}
        >
          <Info size={13} aria-hidden="true" />
        </button>
      </div>
      <span className="metric-direction" title={directionLabel}>
        {metric.direction === "low" ? <ArrowDown size={15} /> : <ArrowUp size={15} />}
        <span className="sr-only">{directionLabel}</span>
      </span>
      <span className="metric-value" title="Current-turn raw score">
        {rawScoreCopy}
      </span>
      <div
        className="metric-track"
        role="progressbar"
        tabIndex={0}
        aria-label={`${metric.label}, current-turn raw score ${hasRawScore ? rawScoreCopy : "unavailable"}, ${opportunityCopy}, ${directionLabel}`}
        aria-valuemin={0}
        aria-valuemax={1}
        aria-valuenow={hasRawScore ? rawScore : undefined}
        aria-describedby={descriptionId}
      >
        <span
          style={{
            width: `${hasRawScore ? rawScore * 100 : 0}%`,
            background: metric.color,
          }}
        />
      </div>
      <span
        className="metric-delta"
        title={`Feedback EMA state ${feedbackValue.toFixed(2)} · ${deltaCopy}`}
      >
        EMA {feedbackValue.toFixed(2)}
      </span>
      <Sparkline values={trace} />
      <span
        className={descriptionOpen ? "metric-description is-open" : "metric-description"}
        id={descriptionId}
        role="note"
      >
        <strong>{metric.label}</strong> · {metric.description} {directionLabel}.
        <small className="metric-state-note">
          Current raw {rawScoreCopy} · {opportunityCopy} · feedback EMA state{" "}
          {feedbackValue.toFixed(2)} ({deltaCopy})
        </small>
        {coverage ? (
          <small className="metric-coverage">
            Eligible {coverage.eligibleObservations}/{coverage.clearOpportunities}
            {coverage.lastEligibleTurn === null
              ? " · never eligible"
              : ` · last turn ${coverage.lastEligibleTurn}`}
          </small>
        ) : null}
      </span>
    </div>
  );
}
