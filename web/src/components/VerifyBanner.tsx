import type { Verification } from "../types";

function state(verification: Verification): { tone: string; title: string; body: string } {
  if (!verification.intact) {
    return {
      tone: "bad",
      title: "Record altered",
      body: "The stored history of this run no longer matches what was sealed.",
    };
  }
  if (!verification.sealed) {
    return {
      tone: "warn",
      title: "Record not sealed",
      body: "This run has no integrity seal, so later changes to its files or decisions cannot be detected. The images still match their manifests.",
    };
  }
  return {
    tone: "ok",
    title: "Record intact",
    body: "Images, manifests, evaluations and the decision chain match their seal. This detects change; it does not prevent it.",
  };
}

/** The run's integrity in one line, with the details a click away; open when something is wrong. */
export function VerifyBanner({ verification }: { verification: Verification }) {
  const { tone, title, body } = state(verification);
  const lines = [...verification.problems, ...verification.warnings];
  return (
    <details className={`verify verify-${tone}`} open={!verification.intact}>
      <summary role={verification.intact ? undefined : "alert"}>
        <span className="verify-mark" aria-hidden="true" />
        <h2 className="verify-title">{title}</h2>
      </summary>
      <div className="verify-body">
        <p>{body}</p>
        {lines.length > 0 && (
          <ul>
            {lines.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        )}
      </div>
    </details>
  );
}
