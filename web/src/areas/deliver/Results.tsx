import { fileSize } from "../../format";
import { downloadUrl, zipUrl } from "../../studio/api";
import type { Delivery, Output } from "../../studio/types";

/** Stills first, the size LinkedIn needs most at the top; then film, animation and print. */
const KIND_ORDER: Readonly<Record<Output["kind"], number>> = { png: 0, mp4: 1, gif: 2, pdf: 3 };

function ordered(outputs: readonly Output[], formats: readonly string[]): Output[] {
  const rank = (o: Output): number => {
    const at = formats.indexOf(o.format);
    return at === -1 ? formats.length : at;
  };
  return [...outputs].sort((a, b) => KIND_ORDER[a.kind] - KIND_ORDER[b.kind] || rank(a) - rank(b));
}

function Preview({ output, poster }: { output: Output; poster: string | undefined }) {
  if (output.kind === "mp4") {
    return <video src={output.url} controls muted loop preload="metadata" {...(poster === undefined ? {} : { poster })} />;
  }
  if (output.kind === "pdf") {
    return (
      <div className="pdf-tile" aria-hidden="true">
        PDF
      </div>
    );
  }
  return <img src={output.url} alt={`Preview of ${output.name}`} loading="lazy" />;
}

function OutputCard({ output, poster }: { output: Output; poster: string | undefined }) {
  return (
    <li className="output">
      <div className="output-preview">
        <Preview output={output} poster={poster} />
      </div>
      <p className="output-name">{output.name}</p>
      <p className="fine num">
        {String(output.width)} × {String(output.height)} px · {fileSize(output.bytes)}
      </p>
      <a className="button" href={downloadUrl(output.url)} download={output.name}>
        Download
      </a>
    </li>
  );
}

function CheckRow({ check }: { check: Delivery["checks"][number] }) {
  return (
    <li className={check.passed ? "check-ok" : "check-bad"}>
      <span className="check-mark" aria-hidden="true">
        {check.passed ? "✓" : "!"}
      </span>
      <span>
        <strong>{check.name}</strong>
        <span className="visually-hidden">{check.passed ? ": passed." : ": needs a look."}</span>
        {check.detail !== "" && <span className="fine"> {check.detail}</span>}
      </span>
    </li>
  );
}

/** One plain sentence first; the full list, with its measurements, only on request. */
function Checks({ delivery }: { delivery: Delivery }) {
  const { checks } = delivery;
  if (checks.length === 0) return null;
  const failed = checks.filter((c) => !c.passed);
  return (
    <section className="delivery-checks" aria-label="Checks">
      <h3>Checks</h3>
      {failed.length === 0 ? (
        <p className="note note-ok">All {String(checks.length)} automatic checks passed: colours, readability, fonts and layout.</p>
      ) : (
        <>
          <p className="note">
            {failed.length === 1 ? "One check needs a look." : `${String(failed.length)} checks need a look.`}
          </p>
          <ul>
            {failed.map((check, index) => (
              <CheckRow key={`${check.name}-${String(index)}`} check={check} />
            ))}
          </ul>
        </>
      )}
      <details>
        <summary>Technical details</summary>
        <ul>
          {checks.map((check, index) => (
            <CheckRow key={`${check.name}-${String(index)}`} check={check} />
          ))}
        </ul>
      </details>
    </section>
  );
}

export function Results({ projectId, delivery }: { projectId: string; delivery: Delivery }) {
  if (delivery.state === "running") {
    return (
      <div className="progress" role="status">
        <progress aria-label="Creating files" />
        <p>Creating your files. A film or animation takes a little longer than a still image.</p>
      </div>
    );
  }
  if (delivery.state === "failed") {
    return (
      <p role="alert" className="error">
        {delivery.error ?? "The files could not be created."} Your design is saved, so you can try again.
      </p>
    );
  }
  return (
    <div className="results">
      <div className="results-head">
        <h3>Your files</h3>
        {delivery.outputs.length > 1 && (
          <a className="button primary" href={zipUrl(projectId, delivery.id)} download>
            Download all
          </a>
        )}
      </div>
      <ul className="output-grid">
        {ordered(delivery.outputs, delivery.formats).map((output) => (
          <OutputCard
            key={output.name}
            output={output}
            poster={delivery.outputs.find((o) => o.kind === "png" && o.format === output.format)?.url}
          />
        ))}
      </ul>
      <Checks delivery={delivery} />
    </div>
  );
}
