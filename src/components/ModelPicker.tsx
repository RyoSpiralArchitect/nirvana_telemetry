import type { ModelOption, ProviderConfig } from "../types";

type Props = {
  id: string;
  label: string;
  value: string;
  provider?: ProviderConfig;
  describedBy?: string;
  onChange: (value: string) => void;
};

function transportLabel(option: ModelOption) {
  if (option.transport === "responses") return "Responses API";
  if (option.transport === "chat_completions") return "Chat Completions";
  if (option.transport === "messages") return "Messages API";
  return "Local simulation";
}

export function ModelPicker({
  id,
  label,
  value,
  provider,
  describedBy,
  onChange,
}: Props) {
  const options = provider?.modelOptions ?? [];
  const featured = options.filter((option) => option.featured);
  const selected = options.find((option) => option.id === value);
  const modelIds = Array.from(
    new Set([...(provider?.models ?? []), ...options.map((option) => option.id)]),
  );
  const metaId = `${id}-meta`;
  const describedByIds = [describedBy, selected ? metaId : undefined]
    .filter(Boolean)
    .join(" ");

  return (
    <>
      <label className="sr-only" htmlFor={id}>
        {label}
      </label>
      <input
        id={id}
        className="model-input"
        value={value}
        list={`${id}-options`}
        onChange={(event) => onChange(event.target.value)}
        autoComplete="off"
        aria-describedby={describedByIds || undefined}
      />
      <datalist id={`${id}-options`}>
        {modelIds.map((model) => {
          const option = options.find((item) => item.id === model);
          return (
            <option key={model} value={model}>
              {option ? `${option.label} — ${option.role}` : model}
            </option>
          );
        })}
      </datalist>
      {featured.length > 1 ? (
        <div className="model-presets" role="group" aria-label={`${label} presets`}>
          {featured.map((option) => (
            <button
              key={option.id}
              type="button"
              className={`model-preset ${value === option.id ? "is-selected" : ""}`}
              aria-pressed={value === option.id}
              title={`${option.id} · ${option.role} · ${transportLabel(option)}`}
              onClick={() => onChange(option.id)}
            >
              {option.label}
            </button>
          ))}
        </div>
      ) : null}
      {selected ? (
        <p id={metaId} className="model-meta">
          <span>{selected.role}</span>
          <span aria-hidden="true">·</span>
          <span>{transportLabel(selected)}</span>
        </p>
      ) : null}
    </>
  );
}
