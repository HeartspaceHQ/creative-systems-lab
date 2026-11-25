import { useCallback } from "react";
import { api, imageUrl } from "../api";
import { Async } from "../components/Async";
import { GenerationSetup } from "../components/GenerationSetup";
import { KIND_LABELS, dateTime, plural } from "../format";
import { useResource } from "../hooks";
import type { RunSummary } from "../types";
import { NewRun } from "./NewRun";

function RunCard({ run }: { run: RunSummary }) {
  const tallies = [
    run.pending > 0 ? `${String(run.pending)} to review` : null,
    run.approved > 0 ? `${String(run.approved)} approved` : null,
    run.rejected > 0 ? `${String(run.rejected)} rejected` : null,
    run.heldBack > 0 ? `${String(run.heldBack)} flagged by checks` : null,
  ].filter((t) => t !== null);
  return (
    <li className="run-card">
      <a href={`#/run/${run.id}`}>
        <span className="run-cover">
          {run.cover !== null && <img src={imageUrl.candidate(run.id, run.cover)} alt="" loading="lazy" />}
          {run.pending > 0 && <span className="run-badge">{String(run.pending)} to review</span>}
        </span>
        <span className="run-subject">{run.subject}</span>
        <span className="run-facts">
          <span>{KIND_LABELS[run.kind]}</span>
          <span>{plural(run.candidates, "candidate", "candidates")}</span>
          <span>{dateTime(run.startedAt)}</span>
        </span>
        <span className="run-facts">{tallies.join(", ")}</span>
        <span className="run-id">
          {run.id}
          {run.rechecked && " (rechecked)"}
        </span>
      </a>
    </li>
  );
}

export function RunsPage() {
  const loadRuns = useCallback(() => api.runs(), []);
  const loadSetup = useCallback(() => api.setup(), []);
  const loadSets = useCallback(() => api.validationSets(), []);
  const { resource: runs, reload } = useResource(loadRuns);
  const { resource: setup, reload: reloadSetup } = useResource(loadSetup);
  const { resource: sets } = useResource(loadSets);

  return (
    <div className="runs-page">
      <header className="page-head">
        <h1>Runs</h1>
        <p>Each run is one brief answered by one or more models. Open a run to review its candidates.</p>
      </header>
      <Async resource={runs}>
        {(items) =>
          items.length === 0 ? (
            <p className="empty">
              Nothing to review yet. Start a run below: the procedural renderer needs no key and finishes in seconds.
            </p>
          ) : (
            <ul className="run-grid">
              {items.map((run) => (
                <RunCard key={run.id} run={run} />
              ))}
            </ul>
          )
        }
      </Async>
      <div className="start-area">
        <NewRun onStarted={reload} />
        <Async resource={setup}>{(value) => <GenerationSetup setup={value} onChanged={reloadSetup} />}</Async>
      </div>
      <Async resource={sets}>
        {(items) =>
          items.length > 0 && (
            <section className="blind-sets" aria-labelledby="blind-title">
              <h2 id="blind-title">Blind quality validation</h2>
              <p className="fine">Rate images without seeing the system&apos;s scores or the intended category.</p>
              <ul>
                {items.map((set) => (
                  <li key={set}>
                    <a href={`#/blind/${set}`}>{set}</a>
                  </li>
                ))}
              </ul>
            </section>
          )
        }
      </Async>
    </div>
  );
}
