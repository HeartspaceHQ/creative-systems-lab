import { useCallback, useEffect, useState } from "react";
import { api } from "../api";
import { Async } from "../components/Async";
import { KIND_LABELS, plural, usd } from "../format";
import { useResource } from "../hooks";
import { modelName } from "../studio/models";
import type { BriefOption, Job, ModelOption, Quote } from "../types";

const MAX_CANDIDATES = 16;

/** The one reason a model cannot be chosen, phrased as what to do about it. */
function blockedBy(model: ModelOption): string | null {
  const own = model.excludedReason !== null && model.excludedReason !== model.unavailableReason;
  const reason = own ? model.excludedReason : model.unavailableReason;
  if (reason === null) return null;
  const key = /^([A-Z_]+_API_KEY) is not set$/.exec(reason);
  if (key) return `Add ${key[1] ?? "its key"} to use it`;
  if (reason.includes("--budget")) return "Needs a spending limit";
  if (reason.includes("mflux") || reason.includes("Hugging Face cache")) return "Not installed on this machine";
  if (reason.startsWith("does not support kind")) return "Cannot make this kind of image";
  if (reason.includes("does not allow commercial use")) return "Licence does not allow commercial use";
  return reason;
}

function price(model: ModelOption): string {
  if (model.location === "local") return "free";
  if (model.perImageUsd === null) return "";
  return `${usd(model.perImageUsd)} per image${model.priceConfirmed ? "" : ", estimate"}`;
}

function ModelRow(props: { model: ModelOption; checked: boolean; onToggle: (key: string) => void }) {
  const { model, checked, onToggle } = props;
  const blocked = blockedBy(model);
  const id = `model-${model.key}`;
  return (
    <li className={blocked === null ? "model" : "model model-blocked"}>
      <input
        id={id}
        type="checkbox"
        checked={checked}
        disabled={blocked !== null}
        onChange={() => {
          onToggle(model.key);
        }}
        aria-describedby={`${id}-note`}
      />
      <label htmlFor={id} className="model-name">
        {modelName(model.key, model.description)}
      </label>
      <span id={`${id}-note`} className="model-note">
        {blocked ?? price(model)}
        {blocked !== null && model.location === "hosted" && <span className="model-price">{price(model)}</span>}
      </span>
    </li>
  );
}

function ModelGroup(props: {
  title: string;
  models: readonly ModelOption[];
  chosen: readonly string[];
  onToggle: (key: string) => void;
}) {
  const { title, models, chosen, onToggle } = props;
  if (models.length === 0) return null;
  const ready = models.filter((m) => blockedBy(m) === null);
  const waiting = models.filter((m) => blockedBy(m) !== null);
  const row = (model: ModelOption) => (
    <ModelRow key={model.key} model={model} checked={chosen.includes(model.key)} onToggle={onToggle} />
  );
  return (
    <fieldset className="model-group">
      <legend>{title}</legend>
      {ready.length > 0 && <ul>{ready.map(row)}</ul>}
      {waiting.length > 0 && (
        <details className="model-waiting">
          <summary>
            {ready.length > 0 ? `${String(waiting.length)} more` : plural(waiting.length, "model", "models")} not
            available for this brief yet
          </summary>
          <ul>{waiting.map(row)}</ul>
        </details>
      )}
    </fieldset>
  );
}

function costLine(quote: Quote): string {
  if (quote.images === 0) return "Choose at least one model.";
  const images = plural(quote.images, "image", "images");
  if (quote.totalHeldUsd === 0) return `${images}, free: everything runs on this machine.`;
  return `${images}, up to ${usd(quote.totalHeldUsd)} held from the budget.`;
}

function Summary(props: { quote: Quote; running: boolean; onStart: () => void }) {
  const { quote, running, onStart } = props;
  const { budget } = quote;
  const paid = quote.totalHeldUsd > 0;
  return (
    <div className="run-summary">
      <h3>This run</h3>
      <p className="run-cost">{costLine(quote)}</p>
      {paid && budget !== null && (
        <p className="fine">
          {usd(budget.remainingUsd)} of {usd(budget.approvedUsd)} left in <code>{budget.id}</code>. What the provider
          reports is settled after each call.
          {quote.lines.some((line) => !line.free && !line.confirmed) &&
            " Estimated prices are held at one and a half times the estimate."}
        </p>
      )}
      {!quote.fits && (
        <p role="alert" className="error">
          {budget === null ? "Hosted models need a spending limit first." : "This run does not fit in what is left."}
        </p>
      )}
      <button
        type="button"
        className="primary"
        onClick={onStart}
        disabled={running || quote.images === 0 || !quote.fits}
      >
        {running ? "Generating…" : "Start run"}
      </button>
    </div>
  );
}

function usableKeys(models: readonly ModelOption[]): Set<string> {
  return new Set(models.filter((m) => blockedBy(m) === null).map((m) => m.key));
}

function Workbench(props: { briefs: readonly BriefOption[]; onStarted: () => void }) {
  const { briefs, onStarted } = props;
  // Illustration briefs come first: the procedural renderer answers them with no setup at all.
  const [briefFile, setBriefFile] = useState((briefs.find((b) => b.kind === "illustration") ?? briefs[0])?.file ?? "");
  const brief = briefs.find((b) => b.file === briefFile);
  const [candidates, setCandidates] = useState(brief?.candidates ?? 2);
  const [picked, setPicked] = useState<readonly string[]>(["procedural"]);
  const [job, setJob] = useState<Job | null>(null);
  const [error, setError] = useState<string | null>(null);

  const loadModels = useCallback(() => api.models(briefFile), [briefFile]);
  const { resource: models } = useResource(loadModels);
  const usable = models.state === "ready" ? usableKeys(models.value) : new Set<string>();
  const chosen = picked.filter((key) => usable.has(key));
  const chosenKey = chosen.join(",");
  const loadQuote = useCallback(
    () => api.quote(briefFile, chosenKey === "" ? [] : chosenKey.split(","), candidates),
    [briefFile, chosenKey, candidates],
  );
  const { resource: quote } = useResource(loadQuote);

  useEffect(() => {
    if (job?.state !== "running") return undefined;
    const timer = window.setInterval(() => {
      api.job(job.id).then(
        (next) => {
          setJob(next);
          if (next.state === "done") onStarted();
        },
        (failure: unknown) => {
          setJob(null);
          setError(failure instanceof Error ? failure.message : "request failed");
        },
      );
    }, 1000);
    return () => {
      window.clearInterval(timer);
    };
  }, [job, onStarted]);

  const start = (): void => {
    setError(null);
    api.startJob(briefFile, chosen, candidates).then(setJob, (failure: unknown) => {
      setError(failure instanceof Error ? failure.message : "request failed");
    });
  };

  const toggle = (key: string): void => {
    setPicked((current) => (current.includes(key) ? current.filter((k) => k !== key) : [...current, key]));
  };

  const chooseBrief = (file: string): void => {
    setBriefFile(file);
    setCandidates(briefs.find((b) => b.file === file)?.candidates ?? candidates);
  };

  return (
    <div className="workbench">
      <div className="workbench-form">
        <label>
          Brief
          <select
            value={briefFile}
            onChange={(e) => {
              chooseBrief(e.target.value);
            }}
          >
            {briefs.map((b) => (
              <option key={b.file} value={b.file}>
                {KIND_LABELS[b.kind]}: {b.subject.length > 72 ? `${b.subject.slice(0, 72)}…` : b.subject}
              </option>
            ))}
          </select>
        </label>
        <label className="candidates">
          Candidates per model
          <input
            type="number"
            min={1}
            max={MAX_CANDIDATES}
            value={candidates}
            onChange={(e) => {
              const value = Math.round(Number(e.target.value));
              if (value >= 1 && value <= MAX_CANDIDATES) setCandidates(value);
            }}
          />
        </label>
        <Async resource={models}>
          {(options) => (
            <>
              <ModelGroup
                title="On this machine"
                models={options.filter((m) => m.location === "local")}
                chosen={chosen}
                onToggle={toggle}
              />
              <ModelGroup
                title="Hosted, with your key"
                models={options.filter((m) => m.location === "hosted")}
                chosen={chosen}
                onToggle={toggle}
              />
              {usable.size === 0 && (
                <p className="note">
                  No model here can make a {brief ? KIND_LABELS[brief.kind].toLowerCase() : "image"} for this brief yet.
                  Add a key or install a local model, as described under <a href="#setup">Models on this machine</a>.
                </p>
              )}
            </>
          )}
        </Async>
      </div>
      <div className="workbench-side">
        <Async resource={quote}>
          {(value) => <Summary quote={value} running={job?.state === "running"} onStart={start} />}
        </Async>
        <p role="status" className="job-status">
          {job?.state === "running" && "Generating and checking the candidates. This page updates when they are ready."}
          {job?.state === "done" && job.runId !== null && (
            <>
              Ready to review: <a href={`#/run/${job.runId}`}>open {job.runId}</a>
            </>
          )}
        </p>
        {job?.state === "failed" && (
          <p role="alert" className="error">
            The run stopped: {job.error ?? "unknown error"}
          </p>
        )}
        {error !== null && (
          <p role="alert" className="error">
            {error}
          </p>
        )}
      </div>
    </div>
  );
}

export function NewRun({ onStarted }: { onStarted: () => void }) {
  const loadBriefs = useCallback(() => api.briefs(), []);
  const { resource: briefs } = useResource(loadBriefs);
  return (
    <section className="new-run" aria-labelledby="new-run-title">
      <h2 id="new-run-title">Start a new run</h2>
      <p className="setup-lead">
        Pick a brief and the models that should answer it. Each candidate is checked against the brand before it reaches
        you.
      </p>
      <Async resource={briefs}>{(items) => <Workbench briefs={items} onStarted={onStarted} />}</Async>
    </section>
  );
}
