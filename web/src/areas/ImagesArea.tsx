import { useState } from "react";
import { Async } from "../components/Async";
import { useWorkspace } from "../workspace/context";
import { GeneratePanel } from "./images/GeneratePanel";
import { ImportPanel } from "./images/ImportPanel";
import { Inspector } from "./images/Inspector";
import { Library, type Mode } from "./images/Library";
import { buildLibrary, type LibraryItem } from "./images/items";
import { useRunDetails } from "./images/useRunDetails";

function Stage({ item }: { item: LibraryItem }) {
  return (
    <section className="stage" aria-label="Selected image">
      <figure className="plate">
        <img src={item.src} alt={item.title} />
        <figcaption>
          <span className="plate-title">{item.title}</span>
          <span className="num">
            {String(item.width)} × {String(item.height)} px
          </span>
        </figcaption>
      </figure>
    </section>
  );
}

export function ImagesArea() {
  const { project, generation } = useWorkspace();
  const { resource: runs, reload } = useRunDetails(project.runs);
  const [chosenMode, setChosenMode] = useState<Mode | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  /** Said on the generate panel when the designer arrives there by rejecting the last image to review. */
  const [arrival, setArrival] = useState<string | null>(null);
  const details = runs.state === "ready" ? runs.value : [];
  const items = buildLibrary(project.assets, details);
  const first = items.find((i) => i.state === "review") ?? items[0];
  const item = items.find((i) => i.key === selected) ?? first;
  const mode: Mode = chosenMode ?? (item === undefined ? "generate" : "item");
  const fresh = items.filter((i) => i.origin?.run.id === generation.finishedRun && i.state === "review");

  const show = (key: string): void => {
    setArrival(null);
    setSelected(key);
    setChosenMode("item");
  };

  /** After a rejection, the next image to review; with none left, back to generating. */
  const afterReject = (decided: string): void => {
    const next = items.find((i) => i.state === "review" && i.key !== decided);
    if (next !== undefined) {
      show(next.key);
      return;
    }
    const approved = items.some((i) => i.state === "approved");
    setArrival(
      approved
        ? "Every image has been reviewed. Generate more, or open an approved image to use it."
        : "None of the images were approved. Change the brief or the models, then generate new ones.",
    );
    setChosenMode("generate");
  };

  return (
    <div className={mode === "item" ? "images-area" : "images-area images-wide"}>
      <Library
        items={items}
        selected={item?.key ?? null}
        mode={mode}
        onSelect={show}
        onMode={(next) => {
          setArrival(null);
          setChosenMode(next);
        }}
      />
      {mode === "generate" && (
        <div className="images-main">
          {arrival !== null && (
            <p role="status" className="note arrival">
              {arrival}
            </p>
          )}
          <GeneratePanel
            newCount={fresh.length}
            onStart={() => {
              setArrival(null);
              setChosenMode("generate");
            }}
            onReview={() => {
              if (fresh[0] !== undefined) show(fresh[0].key);
            }}
          />
        </div>
      )}
      {mode === "import" && (
        <div className="images-main">
          <ImportPanel
            onImported={(asset) => {
              show(`asset:${asset.id}`);
            }}
          />
        </div>
      )}
      {mode === "item" && item !== undefined && (
        <>
          <Stage item={item} />
          <Inspector
            item={item}
            onDecided={(key, verdict) => {
              reload();
              if (verdict === "reject") afterReject(key);
              else show(key);
            }}
          />
        </>
      )}
      {runs.state === "error" && (
        <Async resource={runs}>{() => null}</Async>
      )}
    </div>
  );
}
