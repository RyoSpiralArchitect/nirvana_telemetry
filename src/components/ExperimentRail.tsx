import { ChevronDown, Download, Info, Plus, TestTube2, X } from "lucide-react";
import { useRef } from "react";
import { useFocusTrap } from "../hooks/useFocusTrap";
import { useMediaQuery } from "../hooks/useMediaQuery";
import { MICRO_PROBES, PROBE_AXIS_LABELS } from "../probes";
import { ModelPicker } from "./ModelPicker";
import type {
  AppConfig,
  ExperimentSettings,
  InterventionMode,
  ProviderId,
  UpdateMode,
} from "../types";

type Props = {
  settings: ExperimentSettings;
  config: AppConfig;
  promptPreview: string;
  open: boolean;
  backgroundInert?: boolean;
  onChange: (next: ExperimentSettings) => void;
  onClose: () => void;
  onExport: () => void;
  onNew: () => boolean;
  selectedProbeId: string;
  activeProbeId: string | null;
  nextProbeTurnIndex: number;
  probeTurnLoaded: boolean;
  probeControlsDisabled: boolean;
  probeContractLocked: boolean;
  onProbeSelect: (probeId: string) => void;
  onStartProbe: () => void;
  onLoadNextProbeTurn: () => void;
};

function FieldChevron() {
  return <ChevronDown className="field-chevron" size={17} aria-hidden="true" />;
}

export function ExperimentRail({
  settings,
  config,
  promptPreview,
  open,
  backgroundInert = false,
  onChange,
  onClose,
  onExport,
  onNew,
  selectedProbeId,
  activeProbeId,
  nextProbeTurnIndex,
  probeTurnLoaded,
  probeControlsDisabled,
  probeContractLocked,
  onProbeSelect,
  onStartProbe,
  onLoadNextProbeTurn,
}: Props) {
  const railRef = useRef<HTMLElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const isResponsiveSheet = useMediaQuery("(max-width: 1199px)");
  const isDialogOpen = open && isResponsiveSheet;
  const isInactive = backgroundInert || (isResponsiveSheet && !open);

  useFocusTrap({
    active: isDialogOpen,
    containerRef: railRef,
    initialFocusRef: closeButtonRef,
    onEscape: onClose,
  });

  const update = <K extends keyof ExperimentSettings>(
    key: K,
    value: ExperimentSettings[K],
  ) => onChange({ ...settings, [key]: value });

  const provider = config.providers.find(
    (item) => item.id === settings.targetProvider,
  );
  const judgeProvider = config.providers.find(
    (item) => item.id === settings.judgeProvider,
  );
  const selectedProbe = MICRO_PROBES.find(
    (probe) => probe.id === selectedProbeId,
  );
  const probeIsActive = activeProbeId === selectedProbeId;
  const probeIsComplete = Boolean(
    probeIsActive && selectedProbe && nextProbeTurnIndex >= selectedProbe.turns.length,
  );
  const nextProbeTurn = selectedProbe?.turns[nextProbeTurnIndex];

  return (
    <aside
      ref={railRef}
      className={`experiment-rail rail-sheet ${open ? "is-open" : ""}`}
      role={isDialogOpen ? "dialog" : undefined}
      aria-modal={isDialogOpen ? true : undefined}
      aria-labelledby={isDialogOpen ? "experiment-rail-title" : undefined}
      aria-label={isDialogOpen ? undefined : "Experiment settings"}
      tabIndex={isDialogOpen ? -1 : undefined}
      inert={isInactive ? true : undefined}
      aria-hidden={isInactive ? true : undefined}
    >
      <div className="rail-heading">
        <h2 id="experiment-rail-title">Experiment</h2>
        <button
          ref={closeButtonRef}
          type="button"
          className="icon-button sheet-close"
          onClick={onClose}
          aria-label="Close experiment settings"
        >
          <X size={19} aria-hidden="true" />
        </button>
      </div>

      <div className="mobile-experiment-actions" aria-label="Session actions">
        <button className="button button-quiet" type="button" onClick={onExport}>
          <Download size={16} aria-hidden="true" /> Export JSON
        </button>
        <button
          className="button button-primary"
          type="button"
          onClick={() => {
            if (onNew()) onClose();
          }}
        >
          <Plus size={17} aria-hidden="true" /> New session
        </button>
      </div>

      <div className="field-group">
        <label htmlFor="target-provider">Target provider</label>
        <div className="select-wrap">
          <select
            id="target-provider"
            value={settings.targetProvider}
            disabled={probeContractLocked}
            onChange={(event) => {
              const id = event.target.value as ProviderId;
              const next = config.providers.find((item) => item.id === id);
              onChange({
                ...settings,
                targetProvider: id,
                targetModel: next?.defaultModel ?? settings.targetModel,
              });
            }}
          >
            {config.providers.map((item) => (
              <option key={item.id} value={item.id}>
                {item.label}{item.available ? "" : " · unavailable"}
              </option>
            ))}
          </select>
          <FieldChevron />
        </div>
        <ModelPicker
          id="target-model"
          label="Target model"
          value={settings.targetModel}
          provider={provider}
          disabled={probeContractLocked}
          describedBy="target-availability"
          onChange={(model) => update("targetModel", model)}
        />
        <p id="target-availability" className="availability-line">
          <span className={provider?.available ? "available" : "unavailable"} />
          {provider?.available
            ? provider.detail ?? "Server credential available"
            : provider?.detail ?? "Credential not configured"}
        </p>
      </div>

      <div className="field-group rubric-field">
        <span className="field-label">Behavioral rubric</span>
        <div className="rubric-readout" id="rubric-version">
          <strong>Nirvana v2</strong>
          <span>opportunity anchored · revision 2.0.0</span>
        </div>
        <p className="availability-line">
          Imposition · fixation · grounding · awareness · attunement. V1 remains
          available through the rescore CLI and API.
        </p>
      </div>

      <fieldset className="mode-fieldset">
        <legend>WHO UPDATES THE STATE?</legend>
        {(
          [
            {
              id: "self",
              label: "Self reflection",
              description: "The target scores its own answer.",
            },
            {
              id: "judge",
              label: "External judge",
              description: "The configured judge scores each visible answer.",
            },
          ] as const
        ).map((option) => (
          <label className="mode-option" key={option.id}>
            <input
              type="radio"
              name="update-mode"
              value={option.id}
              disabled={probeContractLocked}
              checked={settings.mode === option.id}
              onChange={() => update("mode", option.id as UpdateMode)}
            />
            <span className="radio-mark" aria-hidden="true" />
            <span>
              <strong>{option.label}</strong>
              <small>{option.description}</small>
            </span>
          </label>
        ))}
        <p className="next-turn-note">Observer changes apply to the next turn.</p>
      </fieldset>

      {settings.mode === "judge" ? (
        <div className="field-group judge-fields">
          <label htmlFor="judge-provider">Judge provider</label>
          <div className="select-wrap">
            <select
              id="judge-provider"
              value={settings.judgeProvider}
              disabled={probeContractLocked}
              onChange={(event) => {
                const id = event.target.value as ProviderId;
                const next = config.providers.find((item) => item.id === id);
                onChange({
                  ...settings,
                  judgeProvider: id,
                  judgeModel: next?.defaultModel ?? settings.judgeModel,
                });
              }}
            >
              {config.providers.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.label}{item.available ? "" : " · unavailable"}
                </option>
              ))}
            </select>
            <FieldChevron />
          </div>
          <ModelPicker
            id="judge-model"
            label="Judge model"
            value={settings.judgeModel}
            provider={judgeProvider}
            disabled={probeContractLocked}
            onChange={(model) => update("judgeModel", model)}
          />
          {settings.targetProvider === settings.judgeProvider &&
          settings.targetModel === settings.judgeModel ? (
            <p className="warning-line">
              <Info size={14} aria-hidden="true" /> Not independent: target and
              judge are the same model.
            </p>
          ) : null}
        </div>
      ) : null}

      <fieldset className="mode-fieldset condition-fieldset">
        <legend>WHAT REACHES THE TARGET?</legend>
        {(
          [
            {
              id: "feedback",
              label: "Telemetry feedback",
              description: "Scores and the objective reach the next target turn.",
            },
            {
              id: "control",
              label: "Prompted control",
              description: "No scores, but an explicit control note and objective remain.",
            },
            {
              id: "shadow",
              label: "Shadow observer",
              description: "The judge runs, but no experiment block or objective reaches the target.",
            },
          ] as const
        ).map((option) => (
          <label className="mode-option" key={option.id}>
            <input
              type="radio"
              name="intervention-mode"
              value={option.id}
              disabled={probeContractLocked}
              checked={settings.interventionMode === option.id}
              onChange={() =>
                update("interventionMode", option.id as InterventionMode)
              }
            />
            <span className="radio-mark" aria-hidden="true" />
            <span>
              <strong>{option.label}</strong>
              <small>{option.description}</small>
            </span>
          </label>
        ))}
      </fieldset>

      <section className="probe-field" aria-labelledby="probe-field-title">
        <div className="probe-heading">
          <div>
            <span className="probe-kicker">V2 DIAGNOSTIC</span>
            <h3 id="probe-field-title">Micro-probe bank</h3>
          </div>
          <TestTube2 size={18} aria-hidden="true" />
        </div>
        <div className="select-wrap">
          <select
            id="micro-probe"
            aria-label="Micro-probe"
            value={selectedProbeId}
            disabled={probeControlsDisabled || probeContractLocked}
            onChange={(event) => onProbeSelect(event.target.value)}
          >
            {MICRO_PROBES.map((probe) => (
              <option key={probe.id} value={probe.id}>
                {PROBE_AXIS_LABELS[probe.targetAxis]} · {probe.id.split("-").at(-1)}
              </option>
            ))}
          </select>
          <FieldChevron />
        </div>
        {selectedProbe ? (
          <>
            <p className="probe-rationale">{selectedProbe.rationale}</p>
            {probeIsComplete ? (
              <p className="probe-turn-meta probe-complete">
                All {selectedProbe.turns.length} frozen turns completed.
              </p>
            ) : nextProbeTurn ? (
              <p className="probe-turn-meta">
                <span>Turn {nextProbeTurn.turn} / {selectedProbe.turns.length}</span>
                <span className={`opportunity-pill is-${nextProbeTurn.expectedOpportunity}`}>
                  expected {nextProbeTurn.expectedOpportunity}
                </span>
              </p>
            ) : null}
            <button
              className="button button-probe"
              type="button"
              disabled={probeControlsDisabled || probeTurnLoaded}
              onClick={
                !probeIsActive || probeIsComplete
                  ? onStartProbe
                  : onLoadNextProbeTurn
              }
            >
              <TestTube2 size={15} aria-hidden="true" />
              {probeTurnLoaded
                ? `Turn ${nextProbeTurn?.turn ?? ""} loaded in composer`
                : !probeIsActive
                  ? "Start fresh probe"
                  : probeIsComplete
                    ? "Restart fresh probe"
                    : `Load frozen turn ${nextProbeTurn?.turn ?? ""}`}
            </button>
            <p className="probe-policy">
              Starting clears the session and locks v2, external judge, and an empty
              objective. The selected feedback/control/shadow arm is preserved.
            </p>
          </>
        ) : null}
      </section>

      <div className="field-group objective-field">
        <label htmlFor="objective">Objective <span>(optional)</span></label>
        <textarea
          id="objective"
          value={settings.objective}
          maxLength={300}
          disabled={settings.interventionMode === "shadow" || probeContractLocked}
          onChange={(event) => update("objective", event.target.value)}
          placeholder={
            settings.interventionMode === "shadow"
              ? "Held out from the target in shadow mode."
              : "What behavior should this run explore?"
          }
        />
        <small>
          {probeContractLocked
            ? "Locked for this probe episode"
            : settings.interventionMode === "shadow"
            ? "Not injected"
            : `${settings.objective.length} / 300`}
        </small>
      </div>

      {probeContractLocked ? (
        <p className="probe-lock-note">
          Probe contract locked. Start a new session to change models, observer,
          rubric, or intervention arm.
        </p>
      ) : null}

      <details className="prompt-preview">
        <summary>
          <span>Target system prompt</span>
          <ChevronDown size={17} aria-hidden="true" />
        </summary>
        <pre>{promptPreview}</pre>
      </details>

      <p className="intervention-note">
        {settings.interventionMode === "shadow"
          ? "Shadow scores are observed after the answer and never influence the target."
          : settings.mode === "self"
            ? "Self-reported telemetry is an intervention, not independent evidence."
            : "Judge telemetry describes observable behavior, not hidden mental state."}
      </p>
    </aside>
  );
}
