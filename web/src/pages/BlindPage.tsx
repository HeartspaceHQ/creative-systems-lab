import { useCallback, useEffect, useState } from "react";
import { api, imageUrl } from "../api";
import { Async } from "../components/Async";
import { useResource } from "../hooks";
import type { BlindItem, Verdict } from "../types";

function Rater({ set, items, reload }: { set: string; items: readonly BlindItem[]; reload: () => void }) {
  const firstOpen = items.findIndex((item) => item.verdict === null);
  const [index, setIndex] = useState(Math.max(firstOpen, 0));
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const item = items[index];
  const done = items.filter((i) => i.verdict !== null).length;

  const rate = useCallback(
    (verdict: Verdict): void => {
      if (!item) return;
      api.rate(set, item.id, verdict, note).then(
        () => {
          setNote("");
          setError(null);
          setIndex((i) => Math.min(i + 1, items.length - 1));
          reload();
        },
        (failure: unknown) => {
          setError(failure instanceof Error ? failure.message : "request failed");
        },
      );
    },
    [item, items.length, note, reload, set],
  );

  useEffect(() => {
    const onKey = (event: globalThis.KeyboardEvent): void => {
      const target = event.target;
      if (target instanceof HTMLTextAreaElement || target instanceof HTMLInputElement) return;
      if (event.key === "a") rate("approve");
      else if (event.key === "r") rate("reject");
      else if (event.key === "ArrowRight") setIndex((i) => Math.min(i + 1, items.length - 1));
      else if (event.key === "ArrowLeft") setIndex((i) => Math.max(i - 1, 0));
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
    };
  }, [rate, items.length]);

  if (!item) return <p>This set has no images.</p>;
  return (
    <>
      <h1>Blind review</h1>
      <p className="muted" role="status">
        Image {String(index + 1)} of {String(items.length)}, {String(done)} rated.
      </p>
      <p>
        Would you approve this image for the brief: a single tea leaf and a ceramic cup seen from above on a plain
        table, flat vector style, warm limited palette, calm empty area in the lower right?
      </p>
      <figure className="blind">
        <img src={imageUrl.blind(set, item.id)} alt={`Image ${String(index + 1)} of ${String(items.length)}`} />
      </figure>
      <label>
        Comment (optional)
        <textarea rows={2} value={note} onChange={(e) => { setNote(e.target.value); }} />
      </label>
      {error !== null && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      <div className="actions">
        <button type="button" className="primary" onClick={() => { rate("approve"); }}>
          Approve (A)
        </button>
        <button type="button" onClick={() => { rate("reject"); }}>
          Reject (R)
        </button>
        <button type="button" onClick={() => { setIndex((i) => Math.max(i - 1, 0)); }} disabled={index === 0}>
          Previous
        </button>
        <button type="button" onClick={() => { setIndex((i) => Math.min(i + 1, items.length - 1)); }} disabled={index >= items.length - 1}>
          Next
        </button>
      </div>
      <p className="muted">
        This image: {item.verdict === null ? "not rated yet" : item.verdict === "approve" ? "approved" : "rejected"}.
        Shortcuts: A approve, R reject, arrow keys move.
      </p>
    </>
  );
}

export function BlindPage({ set }: { set: string }) {
  const load = useCallback(() => api.blind(set), [set]);
  const { resource, reload } = useResource(load);
  return <Async resource={resource}>{(items) => <Rater set={set} items={items} reload={reload} />}</Async>;
}
