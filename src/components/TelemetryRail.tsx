import { ChevronDown, FileText, X } from "lucide-react";
import { useRef } from "react";
import { useFocusTrap } from "../hooks/useFocusTrap";
import { useMediaQuery } from "../hooks/useMediaQuery";
import {
  deltaFor,
  METRICS,
  traceFor,
} from "../telemetry";
import type { TelemetrySnapshot } from "../types";
import { CompositeDial } from "./CompositeDial";
import { MetricRow } from "./MetricRow";

type Props = {
  snapshots: TelemetrySnapshot[];
  open: boolean;
  backgroundInert?: boolean;
  onClose: () => void;
};

function sourceName(source: TelemetrySnapshot["source"]) {
  if (source === "self") return "Self reflected";
  if (source === "judge") return "Judge evaluated";
  if (source === "sample") return "Sample trace";
  return "Instrument initialized";
}

function scoreProvenance(snapshot: TelemetrySnapshot) {
  if (snapshot.source === "sample") return "Demo sample · discarded before turn 1";
  if (snapshot.source === "initial") return "Neutral baseline · turn 0";
  const observer = snapshot.source === "self" ? "Self" : "Judge";
  return `${observer} · turn ${snapshot.turn} · ${snapshot.evaluatorModel ?? "unknown model"}`;
}

export function TelemetryRail({
  snapshots,
  open,
  backgroundInert = false,
  onClose,
}: Props) {
  const railRef = useRef<HTMLElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const isResponsiveSheet = useMediaQuery("(max-width: 767px)");
  const isDialogOpen = open && isResponsiveSheet;
  const isInactive = backgroundInert || (isResponsiveSheet && !open);

  useFocusTrap({
    active: isDialogOpen,
    containerRef: railRef,
    initialFocusRef: closeButtonRef,
    onEscape: onClose,
  });

  const current = snapshots.at(-1)!;
  const evidence = current.assessment
    ? METRICS.map((metric) => ({
        label: metric.label,
        text: current.assessment?.observations[metric.key].evidence,
      })).filter((item) => item.text)
    : [];

  return (
    <aside
      ref={railRef}
      className={`telemetry-rail rail-sheet ${open ? "is-open" : ""}`}
      role={isDialogOpen ? "dialog" : undefined}
      aria-modal={isDialogOpen ? true : undefined}
      aria-labelledby={isDialogOpen ? "telemetry-rail-title" : undefined}
      aria-label={isDialogOpen ? undefined : "Nirvana telemetry"}
      tabIndex={isDialogOpen ? -1 : undefined}
      inert={isInactive ? true : undefined}
      aria-hidden={isInactive ? true : undefined}
    >
      <div className="mobile-rail-title">
        <h2 id="telemetry-rail-title">Telemetry</h2>
        <button ref={closeButtonRef} className="icon-button sheet-close" type="button" onClick={onClose} aria-label="Close telemetry">
          <X size={19} aria-hidden="true" />
        </button>
      </div>

      <CompositeDial
        values={current.values}
        provenance={scoreProvenance(current)}
      />

      <section className="metric-list" aria-label="Behavioral metrics">
        {METRICS.map((metric) => (
          <MetricRow
            key={metric.key}
            metric={metric}
            value={current.values[metric.key]}
            delta={deltaFor(snapshots, metric.key)}
            trace={traceFor(snapshots, metric.key)}
          />
        ))}
      </section>

      <section className="history-section">
        <div className="section-title-row">
          <h2>Turn history</h2>
          <span>{snapshots.length} states</span>
        </div>
        <ol className="turn-history">
          {snapshots.slice(-5).reverse().map((snapshot, index) => (
            <li key={snapshot.id} className={index === 0 ? "current" : ""}>
              <span className="timeline-dot" aria-hidden="true" />
              <span className="turn-number">{snapshot.turn}</span>
              <div>
                <strong>{sourceName(snapshot.source)}</strong>
                <small>
                  {snapshot.evaluatorModel ?? "nirvana-v1"} · {new Intl.DateTimeFormat(undefined, { hour: "2-digit", minute: "2-digit" }).format(new Date(snapshot.createdAt))}
                </small>
              </div>
            </li>
          ))}
        </ol>
      </section>

      <details className="evidence-section" open={evidence.length > 0}>
        <summary>
          <span>Evidence notes</span>
          <ChevronDown size={17} aria-hidden="true" />
        </summary>
        {evidence.length ? (
          <ul>
            {evidence.map((item) => (
              <li key={item.label}>
                <FileText size={15} aria-hidden="true" />
                <span><strong>{item.label}</strong>{item.text}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p>No observable evidence has been recorded yet.</p>
        )}
      </details>
    </aside>
  );
}
