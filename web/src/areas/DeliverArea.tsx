import { useCallback, useState } from "react";
import { ApiError } from "../http";
import { dateTime } from "../format";
import { studioApi } from "../studio/api";
import { MIN_CONTRAST, contrast, normaliseHex } from "../studio/colour";
import type { Brand, Extra } from "../studio/types";
import { useWorkspace } from "../workspace/context";
import { ExtraPicker } from "./deliver/ExtraPicker";
import { FormatPicker } from "./deliver/FormatPicker";
import { Results } from "./deliver/Results";
import { useDeliveryPolling } from "./deliver/useDeliveryPolling";

const DEFAULT_FORMAT = "linkedin-portrait";

/** Large type (labels, rules) may be lighter than body text, as in WCAG. */
const MIN_CONTRAST_LARGE = 3;
const EXTRAS: readonly Extra[] = ["mp4", "gif", "pdf"];

/** A sentence for each brand colour too faint to read on the background, so delivery is not tried in vain. */
function unreadable(brand: Brand): string[] {
  const ground = normaliseHex(brand.colours.ground);
  if (ground === null) return [];
  const roles = [
    { label: "Text", hex: brand.colours.text, min: MIN_CONTRAST },
    { label: "Quiet text", hex: brand.colours.quiet, min: MIN_CONTRAST_LARGE },
  ];
  return roles.flatMap(({ label, hex, min }) => {
    const colour = normaliseHex(hex);
    if (colour === null) return [];
    const ratio = contrast(colour, ground);
    return ratio >= min ? [] : [`${label} is too faint on the background (${ratio.toFixed(1)} to 1, needs ${min.toFixed(1)}).`];
  });
}

const toggled = <T extends string>(list: readonly T[], item: T): T[] =>
  list.includes(item) ? list.filter((x) => x !== item) : [...list, item];

export function DeliverArea() {
  const { project, design, brandDraft, formats, refresh, goTo, brand } = useWorkspace();
  // The last delivery's choices, so a second round starts where the first one ended.
  const last = project.deliveries.at(-1);
  const [chosen, setChosen] = useState<readonly string[]>(() => (last === undefined || last.formats.length === 0 ? [DEFAULT_FORMAT] : last.formats));
  const [extras, setExtras] = useState<readonly Extra[]>(() => EXTRAS.filter((e) => last?.extras.includes(e) === true));
  const [shown, setShown] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<Readonly<Record<string, string>>>({});
  const [message, setMessage] = useState<string | null>(null);

  const deliveries = [...project.deliveries].reverse();
  const current = deliveries.find((d) => d.id === shown) ?? deliveries[0];
  const onChange = useCallback((): void => {
    void refresh();
  }, [refresh]);
  useDeliveryPolling(project.id, deliveries.find((d) => d.state === "running"), onChange);

  const draft = design.draft;
  const ready = draft !== null && draft.copy.headline.trim() !== "";
  const firstSize = formats.find((f) => f.key === chosen[0])?.label ?? null;

  const create = (): void => {
    setBusy(true);
    setErrors({});
    setMessage(null);
    // Files are made from what the server holds, so both drafts must be saved first, or nothing starts.
    Promise.all([brandDraft.flush(), design.flush()])
      .then(() => studioApi.createDelivery(project.id, chosen, extras))
      .then(async (created) => {
        setShown(created.id);
        await refresh();
      })
      .catch((failure: unknown) => {
        setErrors(failure instanceof ApiError ? failure.fields : {});
        setMessage(failure instanceof Error ? failure.message : "The files could not be created.");
      })
      .finally(() => {
        setBusy(false);
      });
  };

  if (!ready) {
    return (
      <div className="empty">
        <h2>Finish the design first</h2>
        <p>Files are made from your design, so it needs an image and a headline.</p>
        <button type="button" className="primary" onClick={() => { goTo("design"); }}>
          Go to Design
        </button>
      </div>
    );
  }

  const running = current?.state === "running";
  const faint = unreadable(brand);
  return (
    <div className="deliver-area">
      <section className="deliver-options panel" aria-label="What to create">
        <h2>Create files</h2>
        <FormatPicker formats={formats} chosen={chosen} error={errors["formats"]} onToggle={(key) => { setChosen(toggled(chosen, key)); }} />
        <ExtraPicker chosen={extras} firstSize={firstSize} error={errors["extras"]} onToggle={(extra) => { setExtras(toggled(extras, extra)); }} />
        {message !== null && (
          <p role="alert" className="error">
            {message}
          </p>
        )}
        {faint.length > 0 && (
          <div className="note" role="status">
            <p>The files cannot be made yet: the text would be hard to read.</p>
            <ul>
              {faint.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
            <button type="button" onClick={() => { goTo("design"); }}>
              Change the colours
            </button>
          </div>
        )}
        <div className="actions">
          <button type="button" className="primary" disabled={busy || running || chosen.length === 0 || faint.length > 0} onClick={create}>
            {busy || running ? "Creating…" : "Create files"}
          </button>
          {chosen.length === 0 && <span className="fine">Pick at least one size.</span>}
        </div>
      </section>
      <section className="deliver-results" aria-label="Files">
        {current === undefined ? (
          <div className="empty">
            <h2>No files yet</h2>
            <p>Pick the sizes you need and choose Create files. They appear here, ready to download.</p>
          </div>
        ) : (
          <Results projectId={project.id} delivery={current} />
        )}
        {deliveries.length > 1 && (
          <section className="earlier" aria-label="Earlier deliveries">
            <h3>Earlier</h3>
            <ul>
              {deliveries.map((d) => (
                <li key={d.id}>
                  <button
                    type="button"
                    className="link-button"
                    aria-current={d.id === current?.id ? "true" : undefined}
                    onClick={() => { setShown(d.id); }}
                  >
                    {dateTime(d.createdAt)}
                  </button>
                  <span className="fine">
                    {" "}
                    {d.state === "done" ? `${String(d.outputs.length)} files` : d.state === "running" ? "creating" : "failed"}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        )}
      </section>
    </div>
  );
}
