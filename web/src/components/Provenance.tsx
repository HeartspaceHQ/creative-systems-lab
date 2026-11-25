import { dateTime, percent, seconds, usd } from "../format";
import type { Candidate, PaletteColour } from "../types";

function cost(candidate: Candidate): string {
  if (candidate.costUsd === null) return "No charge (runs locally)";
  return `${usd(candidate.costUsd)}${candidate.costEstimated === true ? " (estimate)" : " (reported by the provider)"}`;
}

export function Provenance({ candidate }: { candidate: Candidate }) {
  return (
    <section className="inspector-section" aria-labelledby="provenance-title">
      <h3 id="provenance-title">How it was made</h3>
      <dl className="facts">
        <dt>Model</dt>
        <dd>
          {candidate.modelLabel}
          <span className="fine"> {candidate.modelId}</span>
        </dd>
        <dt>Seed</dt>
        <dd className="num">{String(candidate.seed)}</dd>
        <dt>Size</dt>
        <dd className="num">
          {String(candidate.width)} × {String(candidate.height)} px, {String(candidate.steps)}{" "}
          {candidate.steps === 1 ? "step" : "steps"}
        </dd>
        <dt>Made</dt>
        <dd>
          {dateTime(candidate.createdAt)}, in {seconds(candidate.seconds)}
        </dd>
        <dt>Cost</dt>
        <dd>{cost(candidate)}</dd>
        {candidate.sourceRun !== null && (
          <>
            <dt>First run</dt>
            <dd className="wrap">{candidate.sourceRun}</dd>
          </>
        )}
        <dt>Image hash</dt>
        <dd className="hash" title={candidate.sha256}>
          sha256 {candidate.sha256.slice(0, 16)}…
        </dd>
      </dl>
      <details className="prompt">
        <summary>Prompt sent to the model</summary>
        <p>{candidate.prompt}</p>
      </details>
    </section>
  );
}

export function ColourTable({ candidate, palette }: { candidate: Candidate; palette: readonly PaletteColour[] }) {
  const hexOf = new Map(palette.map((c) => [c.name, c.hex]));
  return (
    <section className="inspector-section" aria-labelledby="colours-title">
      <h3 id="colours-title">Colour evidence</h3>
      <table className="colours">
        <thead>
          <tr>
            <th scope="col">In the image</th>
            <th scope="col">Nearest brand colour</th>
            <th scope="col" className="num">
              ΔE
            </th>
            <th scope="col" className="num">
              Area
            </th>
          </tr>
        </thead>
        <tbody>
          {candidate.colours.map((colour) => (
            <tr key={colour.hex} className={colour.within ? undefined : "outside"}>
              <td>
                <span className="swatch" style={{ background: colour.hex }} aria-hidden="true" />
                {colour.hex}
              </td>
              <td>
                <span className="swatch" style={{ background: hexOf.get(colour.nearest) ?? "transparent" }} aria-hidden="true" />
                {colour.nearest}
                {colour.neutral && <span className="fine"> (neutral)</span>}
              </td>
              <td className="num">{colour.deltaE.toFixed(1)}</td>
              <td className="num">{percent(colour.share)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="fine">
        ΔE is the colour distance (CIE76). Neutral, low-chroma colours count as within the palette when
        the brand allows neutrals.
      </p>
    </section>
  );
}
