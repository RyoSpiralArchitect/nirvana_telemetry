import { ArrowDown, ArrowUp, Info } from "lucide-react";
import { useId, useState } from "react";
import type { MetricDefinition } from "../telemetry";

type Props = {
  metric: MetricDefinition;
  value: number;
  delta: number;
  trace: number[];
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

export function MetricRow({ metric, value, delta, trace }: Props) {
  const descriptionId = useId();
  const [descriptionOpen, setDescriptionOpen] = useState(false);
  const directionLabel = metric.direction === "low" ? "lower is better" : "higher is better";
  const deltaCopy = Math.abs(delta) < 0.005 ? "steady" : `${delta > 0 ? "+" : ""}${delta.toFixed(2)}`;

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
      <span className="metric-value">{value.toFixed(2)}</span>
      <div
        className="metric-track"
        role="progressbar"
        tabIndex={0}
        aria-label={`${metric.label}, ${value.toFixed(2)}, ${directionLabel}`}
        aria-valuemin={0}
        aria-valuemax={1}
        aria-valuenow={value}
        aria-describedby={descriptionId}
      >
        <span style={{ width: `${value * 100}%`, background: metric.color }} />
      </div>
      <span className="metric-delta">{deltaCopy}</span>
      <Sparkline values={trace} />
      <span
        className={descriptionOpen ? "metric-description is-open" : "metric-description"}
        id={descriptionId}
        role="note"
      >
        <strong>{metric.label}</strong> · {metric.description} {directionLabel}.
      </span>
    </div>
  );
}
