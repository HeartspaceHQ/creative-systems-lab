import { checkLabel, checkLimit, checkValue, meterPositions } from "../format";
import type { Check, Kind } from "../types";

const NO_REFERENCES = "no reference set: drift not evaluated";

function verdict(check: Check): string {
  if (check.passed) return "Within limit";
  return check.hard ? "Needs a closer look" : "Worth a glance";
}

function CheckRow({ check }: { check: Check }) {
  const tone = check.passed ? "ok" : check.hard ? "bad" : "warn";
  const position = meterPositions(check);
  return (
    <li className={`check check-${tone}`}>
      <div className="check-head">
        <span className="check-name">{checkLabel(check.name)}</span>
        <span className="check-value">{checkValue(check)}</span>
      </div>
      <div
        className="meter"
        role="img"
        aria-label={`${checkValue(check)}, limit ${checkLimit(check)}`}
      >
        <span className="meter-fill" style={{ width: `${String(position.value * 100)}%` }} />
        <span className="meter-limit" style={{ left: `${String(position.threshold * 100)}%` }} />
      </div>
      <div className="check-foot">
        <span>Limit {checkLimit(check)}</span>
        <span className="check-verdict">{verdict(check)}</span>
      </div>
      <details>
        <summary>What this measures</summary>
        <dl>
          <dt>Measured</dt>
          <dd>{check.explanation.measured}</dd>
          <dt>Result</dt>
          <dd>{check.explanation.outcome}</dd>
          <dt>Consequence</dt>
          <dd>{check.explanation.consequence}</dd>
          <dt>Cannot see</dt>
          <dd>{check.explanation.blindSpot}</dd>
        </dl>
      </details>
    </li>
  );
}

function warningText(warning: string, kind: Kind): string {
  if (warning === NO_REFERENCES) {
    const noun = kind === "photo" ? "photographs" : "illustrations";
    return `Drift is not measured: the brand has no approved reference ${noun} yet. Approve a candidate and add it with csl reference to start the set.`;
  }
  return warning;
}

export function CheckList(props: { checks: readonly Check[]; warnings: readonly string[]; kind: Kind }) {
  const { checks, warnings, kind } = props;
  return (
    <section className="inspector-section" aria-labelledby="checks-title">
      <h3 id="checks-title">Measured checks</h3>
      <ul className="checks">
        {checks.map((check) => (
          <CheckRow key={check.name} check={check} />
        ))}
      </ul>
      {warnings.map((warning) => (
        <p key={warning} className="note">
          {warningText(warning, kind)}
        </p>
      ))}
      <p className="fine">
        The checks measure colour and tone with numbers. Whether the image is right for the brand is
        your call.
      </p>
    </section>
  );
}
