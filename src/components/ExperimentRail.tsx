import { ChevronDown, Download, Info, Plus, X } from "lucide-react";
import { useRef } from "react";
import { useFocusTrap } from "../hooks/useFocusTrap";
import { useMediaQuery } from "../hooks/useMediaQuery";
import type {
  AppConfig,
  ExperimentSettings,
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
        <label className="sr-only" htmlFor="target-model">
          Target model
        </label>
        <input
          id="target-model"
          className="model-input"
          value={settings.targetModel}
          list="target-models"
          onChange={(event) => update("targetModel", event.target.value)}
          autoComplete="off"
          aria-describedby="target-availability"
        />
        <datalist id="target-models">
          {provider?.models?.map((model) => <option key={model} value={model} />)}
        </datalist>
        <p id="target-availability" className="availability-line">
          <span className={provider?.available ? "available" : "unavailable"} />
          {provider?.available
            ? provider.detail ?? "Server credential available"
            : provider?.detail ?? "Credential not configured"}
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
          <label className="sr-only" htmlFor="judge-model">
            Judge model
          </label>
          <input
            id="judge-model"
            className="model-input"
            value={settings.judgeModel}
            list="judge-models"
            onChange={(event) => update("judgeModel", event.target.value)}
            autoComplete="off"
          />
          <datalist id="judge-models">
            {judgeProvider?.models?.map((model) => (
              <option key={model} value={model} />
            ))}
          </datalist>
          {settings.targetProvider === settings.judgeProvider &&
          settings.targetModel === settings.judgeModel ? (
            <p className="warning-line">
              <Info size={14} aria-hidden="true" /> Not independent: target and
              judge are the same model.
            </p>
          ) : null}
        </div>
      ) : null}

      <div className="switch-row">
        <span>Feed state into next turn</span>
        <label className="switch">
          <span className="sr-only">Feed state into next turn</span>
          <input
            type="checkbox"
            checked={settings.feedState}
            onChange={(event) => update("feedState", event.target.checked)}
          />
          <span className="switch-track" aria-hidden="true" />
        </label>
      </div>

      <div className="field-group objective-field">
        <label htmlFor="objective">Objective <span>(optional)</span></label>
        <textarea
          id="objective"
          value={settings.objective}
          maxLength={300}
          onChange={(event) => update("objective", event.target.value)}
          placeholder="What behavior should this run explore?"
        />
        <small>{settings.objective.length} / 300</small>
      </div>

      <details className="prompt-preview">
        <summary>
          <span>Injected prompt</span>
          <ChevronDown size={17} aria-hidden="true" />
        </summary>
        <pre>{promptPreview}</pre>
      </details>

      <p className="intervention-note">
        {settings.mode === "self"
          ? "Self-reported telemetry is an intervention, not independent evidence."
          : "Judge telemetry describes observable behavior, not hidden mental state."}
      </p>
    </aside>
  );
}
