import { blockedBy, isTestModel, modelBlurb, modelName, priceText } from "../../studio/models";
import type { ModelOption, ProviderStatus } from "../../types";

interface Props {
  readonly models: readonly ModelOption[];
  readonly providers: readonly ProviderStatus[];
  readonly chosen: readonly string[];
  readonly onToggle: (key: string) => void;
  readonly onConnect: (variable: string) => void;
}

function ModelRow({ model, providers, checked, onToggle, onConnect }: Omit<Props, "models" | "chosen"> & { model: ModelOption; checked: boolean }) {
  const blocked = blockedBy(model, providers);
  const id = `model-${model.key}`;
  const blurb = modelBlurb(model.key);
  return (
    <li className={blocked === null ? "model" : "model model-blocked"}>
      <input
        id={id}
        type="checkbox"
        checked={checked && blocked === null}
        disabled={blocked !== null}
        aria-describedby={`${id}-note`}
        onChange={() => {
          onToggle(model.key);
        }}
      />
      <label htmlFor={id} className="model-name">
        {modelName(model.key, model.description)}
      </label>
      <span className="model-price">{priceText(model)}</span>
      <span id={`${id}-note`} className="model-note">
        {blocked === null ? blurb : blocked.text}
        {blocked?.provider != null && (
          <>
            {" "}
            <button
              type="button"
              className="link-button"
              onClick={() => {
                if (blocked.provider !== null) onConnect(blocked.provider.variable);
              }}
            >
              Connect
            </button>
          </>
        )}
      </span>
    </li>
  );
}

export function ModelList({ models, providers, chosen, onToggle, onConnect }: Props) {
  const real = models.filter((m) => !isTestModel(m));
  const tests = models.filter(isTestModel);
  const rows = (list: readonly ModelOption[]) => (
    <ul className="model-list">
      {list.map((model) => (
        <ModelRow
          key={model.key}
          model={model}
          providers={providers}
          checked={chosen.includes(model.key)}
          onToggle={onToggle}
          onConnect={onConnect}
        />
      ))}
    </ul>
  );
  const usable = real.filter((m) => blockedBy(m, providers) === null);
  const waiting = real.filter((m) => blockedBy(m, providers) !== null);
  return (
    <fieldset className="models">
      <legend>Models</legend>
      {rows(usable)}
      {usable.length === 0 && <p className="note">No model can make this brief right now. See why below.</p>}
      {waiting.length > 0 && (
        <details className="model-waiting" open={usable.length === 0}>
          <summary>{waiting.length} not available yet</summary>
          {rows(waiting)}
        </details>
      )}
      {tests.length > 0 && (
        <details className="model-waiting">
          <summary>Technical details</summary>
          <p className="fine">Models that exist to test the colour checks. They are not for making project images.</p>
          {rows(tests)}
        </details>
      )}
    </fieldset>
  );
}
