import { useState, type SyntheticEvent } from "react";
import { studioApi } from "../studio/api";
import type { ProviderStatus } from "../types";
import { Field } from "./Field";
import { TerminalKeys } from "./TerminalKeys";

function keyState(provider: ProviderStatus): string {
  if (provider.source === "terminal") return "From the terminal";
  return provider.set ? "Pasted here" : "Not connected";
}

interface Props {
  readonly providers: readonly ProviderStatus[];
  /** Called after a key was added or forgotten, so models and the budget can be read again. */
  readonly onChanged: () => void;
  /** A provider whose form should be open, for example one a blocked model asked for. */
  readonly openFor?: string | null;
}

function KeyForm({ provider, onDone }: { provider: ProviderStatus; onDone: () => void }) {
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | undefined>(undefined);
  const [busy, setBusy] = useState(false);

  const submit = (event: SyntheticEvent): void => {
    event.preventDefault();
    if (value.trim() === "") {
      setError("Paste the key from your provider's account page.");
      return;
    }
    setBusy(true);
    setError(undefined);
    const key = value.trim();
    setValue("");
    studioApi.setKey(provider.variable, key).then(
      () => {
        setBusy(false);
        onDone();
      },
      (failure: unknown) => {
        setBusy(false);
        setError(failure instanceof Error ? failure.message : "The key could not be saved.");
      },
    );
  };

  return (
    <form className="key-form" onSubmit={submit} noValidate>
      <Field label={`${provider.name} API key`} error={error}>
        {(props) => (
          <input
            {...props}
            type="password"
            name={`api-key-${provider.variable}`}
            autoComplete="off"
            spellCheck={false}
            data-1p-ignore
            data-lpignore="true"
            value={value}
            onChange={(e) => {
              setValue(e.target.value);
            }}
          />
        )}
      </Field>
      <div className="actions">
        <button type="submit" className="primary" disabled={busy}>
          {busy ? "Connecting…" : "Connect"}
        </button>
        <button type="button" onClick={onDone}>
          Cancel
        </button>
      </div>
    </form>
  );
}

export function ProviderKeys({ providers, onChanged, openFor = null }: Props) {
  const [opened, setOpened] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const open = opened ?? openFor;
  const forget = (provider: ProviderStatus): void => {
    setError(null);
    studioApi.forgetKey(provider.variable).then(onChanged, (failure: unknown) => {
      setError(failure instanceof Error ? failure.message : "Could not forget the key.");
    });
  };
  return (
    <div className="providers">
      <p className="fine">Paste an API key to use that provider&apos;s models.</p>
      <ul className="fine key-facts">
        <li>The key is kept only by the studio program running on this computer, in its memory.</li>
        <li>It is not saved to disk and never shown again. It leaves this computer only for the provider, when you generate.</li>
        <li>It is gone when the studio stops or restarts, so you paste it again. To skip that, keep it in your terminal.</li>
      </ul>
      <ul className="provider-list">
        {providers.map((provider) => (
          <li key={provider.variable}>
            <div className="provider-row">
              <span className="provider-name">{provider.name}</span>
              <span className={provider.set ? "key-set" : "key-missing"}>{keyState(provider)}</span>
              {provider.set ? (
                <button type="button" onClick={() => { forget(provider); }}>
                  Forget key
                </button>
              ) : (
                <button type="button" aria-expanded={open === provider.variable} onClick={() => { setOpened(open === provider.variable ? "" : provider.variable); }}>
                  Connect
                </button>
              )}
            </div>
            {!provider.set && open === provider.variable && (
              <KeyForm
                provider={provider}
                onDone={() => {
                  setOpened("");
                  onChanged();
                }}
              />
            )}
          </li>
        ))}
      </ul>
      <TerminalKeys providers={providers} />
      {error !== null && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
    </div>
  );
}
