import { Fragment, useId, useState } from "react";
import type { ProviderStatus } from "../types";

/** One shell command with a button that copies it. It wraps between words only, never inside a flag. */
function Command({ text }: { text: string }) {
  const [copied, setCopied] = useState<boolean | null>(null);
  const copy = (): void => {
    navigator.clipboard.writeText(text).then(
      () => {
        setCopied(true);
      },
      () => {
        setCopied(false);
      },
    );
  };
  return (
    <div className="command">
      <pre>
        <code>
          {text.split(" ").map((word, index) => (
            <Fragment key={index}>
              {index > 0 && " "}
              <span>{word}</span>
            </Fragment>
          ))}
        </code>
      </pre>
      <button type="button" onClick={copy}>
        {copied === true ? "Copied" : "Copy"}
      </button>
      {copied === false && (
        <p role="alert" className="field-error">
          Could not copy. Select the command and copy it yourself.
        </p>
      )}
    </div>
  );
}

/** How to give the studio a key from the terminal, so it is never pasted in the browser. */
export function TerminalKeys({ providers }: { providers: readonly ProviderStatus[] }) {
  const picker = useId();
  const [chosen, setChosen] = useState<string | null>(null);
  const variable = chosen ?? providers.find((provider) => !provider.set)?.variable ?? providers[0]?.variable;
  if (variable === undefined) return null;
  const keychain = `"$(security find-generic-password -a "$USER" -s ${variable} -w)"`;
  return (
    <details className="terminal-keys">
      <summary>Keep the key in your terminal instead</summary>
      <p className="fine">
        Start the studio with the key already set. It is connected every time the studio starts, and the key is never typed
        into the browser.
      </p>
      <label className="terminal-pick" htmlFor={picker}>
        Commands for
        <select
          id={picker}
          value={variable}
          onChange={(e) => {
            setChosen(e.target.value);
          }}
        >
          {providers.map((provider) => (
            <option key={provider.variable} value={provider.variable}>
              {provider.name}
            </option>
          ))}
        </select>
      </label>
      <h4>Asked for when the studio starts</h4>
      <p className="fine">The terminal asks for the key and shows nothing as you paste it. Nothing is saved.</p>
      <Command text={`csl serve --ask-key ${variable}`} />
      <h4>From the macOS Keychain</h4>
      <p className="fine">
        Copy the key, then save it once from the clipboard. The Keychain prompt keeps only 128 characters and would cut a
        longer key, so the command reads the clipboard instead. Clear the clipboard afterwards.
      </p>
      <Command text={`security add-generic-password -U -a "$USER" -s ${variable} -w "$(pbpaste)"`} />
      <p className="fine">Then start the studio with the key from the Keychain:</p>
      <Command text={`${variable}=${keychain} csl serve`} />
      <h4>From a password manager</h4>
      <p className="fine">
        A tool that puts secrets in environment variables works too. The studio reads the key from <code>{variable}</code>.
      </p>
      <p className="fine">
        Do not write the key itself in a command or in a file such as <code>~/.zshrc</code>: it would stay in plain text in
        your shell history or on disk.
      </p>
    </details>
  );
}
