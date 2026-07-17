import {
  Download,
  FlaskConical,
  Gauge,
  Menu,
  Plus,
} from "lucide-react";
import type { RunPhase } from "../types";

const PHASE_COPY: Record<RunPhase, string> = {
  idle: "The instrument is quiet.",
  answering: "The model is answering…",
  assessing: "Observing the observer…",
  error: "Returning to samsara. Retry.",
};

type Props = {
  phase: RunPhase;
  hasObservations: boolean;
  backgroundInert?: boolean;
  onExport: () => void;
  onNew: () => void;
  onOpenExperiment: () => void;
  onOpenTelemetry: () => void;
};

export function AppHeader({
  phase,
  hasObservations,
  backgroundInert = false,
  onExport,
  onNew,
  onOpenExperiment,
  onOpenTelemetry,
}: Props) {
  const statusCopy =
    phase === "idle" && hasObservations ? "Telemetry updated." : PHASE_COPY[phase];

  return (
    <header
      className="app-header"
      inert={backgroundInert ? true : undefined}
      aria-hidden={backgroundInert ? true : undefined}
    >
      <div className="brand-block">
        <button
          className="icon-button rail-trigger experiment-trigger"
          type="button"
          onClick={onOpenExperiment}
          aria-label="Open experiment settings"
        >
          <Menu size={20} aria-hidden="true" />
        </button>
        <div className="brand-mark" aria-hidden="true">
          <FlaskConical size={17} />
        </div>
        <strong>NIRVANA TELEMETRY</strong>
        <span>Behavioral observability for measured minds.</span>
      </div>

      <div className="run-status" aria-live="polite">
        <span className={`status-dot status-${phase}`} aria-hidden="true" />
        {statusCopy}
      </div>

      <div className="header-actions">
        <button
          className="button button-quiet"
          type="button"
          onClick={onExport}
          aria-label="Export current experiment as JSON"
        >
          <Download size={17} aria-hidden="true" />
          <span>Export JSON</span>
        </button>
        <button
          className="button button-primary"
          type="button"
          onClick={onNew}
          aria-label="Start a new experiment session"
        >
          <Plus size={18} aria-hidden="true" />
          <span>New session</span>
        </button>
        <button
          className="icon-button rail-trigger telemetry-trigger"
          type="button"
          onClick={onOpenTelemetry}
          aria-label="Open telemetry"
        >
          <Gauge size={20} aria-hidden="true" />
        </button>
      </div>
    </header>
  );
}
