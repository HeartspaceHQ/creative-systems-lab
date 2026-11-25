import { useCallback, useState } from "react";
import { Async } from "../../components/Async";
import { BudgetSummary } from "../../components/BudgetSummary";
import { ProviderKeys } from "../../components/ProviderKeys";
import { plural, usd } from "../../format";
import { useResource } from "../../hooks";
import { studioApi } from "../../studio/api";
import { blockedBy, isTestModel } from "../../studio/models";
import type { ModelOption, Quote } from "../../types";
import { useWorkspace } from "../../workspace/context";
import { ModelList } from "./ModelList";

const KIND_WORDS = { photo: "photo", illustration: "illustration" } as const;
const SHAPE_WORDS = { square: "square", portrait: "portrait", landscape: "landscape" } as const;

function quoteLine(quote: Quote): string {
  if (quote.images === 0) return "Choose at least one model.";
  const images = plural(quote.images, "image", "images");
  if (quote.totalHeldUsd === 0) return `${images}. Free: everything runs on this computer.`;
  return `${images}. Up to ${usd(quote.totalHeldUsd)} is set aside from your budget while it runs, and you are charged what the provider reports.`;
}

function QuoteBox(props: { quote: Quote }) {
  const { quote } = props;
  const paid = quote.totalHeldUsd > 0;
  return (
    <div className="quote">
      <p className="quote-main">{quoteLine(quote)}</p>
      {paid && quote.budget !== null && (
        <p className="fine">
          {usd(quote.budget.remainingUsd)} of {usd(quote.budget.approvedUsd)} will be left to spend before this run.
          {quote.lines.some((line) => !line.free && !line.confirmed) &&
            " Some prices are estimates, so a little extra is set aside."}
        </p>
      )}
      {!quote.fits && (
        <p role="alert" className="error">
          {quote.budget === null
            ? "Paid models need a spending limit first. Set one under Budget."
            : "This run costs more than what is left in your budget. Choose fewer models or fewer images."}
        </p>
      )}
    </div>
  );
}

interface Props {
  readonly newCount: number;
  readonly onReview: () => void;
  /** Keeps this panel open while the run goes on, even when the first images arrive. */
  readonly onStart: () => void;
}

function Progress({ models, images }: { models: number; images: number }) {
  return (
    <div className="progress" role="status">
      <progress aria-label="Making images" />
      <p>
        Making {plural(images, "image", "images")} with {plural(models, "model", "models")}. You can work in other areas
        meanwhile; the images show up here when they are ready.
      </p>
    </div>
  );
}

export function GeneratePanel({ newCount, onReview, onStart }: Props) {
  const { project, brief, generation } = useWorkspace();
  const [picked, setPicked] = useState<readonly string[] | null>(null);
  const [connectFor, setConnectFor] = useState<string | null>(null);
  const { kind, shape, candidates } = brief.draft;
  const { flush } = brief;

  const loadModels = useCallback(async (): Promise<ModelOption[]> => {
    await flush();
    return studioApi.models(project.id);
  }, [flush, project.id]);
  const loadSetup = useCallback(() => studioApi.setup(), []);
  const { resource: models, reload: reloadModels } = useResource(loadModels);
  const { resource: setup, reload: reloadSetup } = useResource(loadSetup);
  const providers = setup.state === "ready" ? setup.value.providers : [];

  const all = models.state === "ready" ? models.value : [];
  const usable = all.filter((m) => blockedBy(m, providers) === null);
  // Nothing paid is ever pre-selected: the first free model that can serve the brief is.
  const firstFree = usable.find((m) => m.location === "local" && !isTestModel(m));
  const chosen = (picked ?? (firstFree === undefined ? [] : [firstFree.key])).filter((key) =>
    usable.some((m) => m.key === key),
  );
  const chosenKey = chosen.join(",");

  const loadQuote = useCallback(async (): Promise<Quote> => {
    await flush();
    return studioApi.quote(project.id, chosenKey === "" ? [] : chosenKey.split(","), candidates);
  }, [flush, project.id, chosenKey, candidates]);
  const { resource: quote, reload: reloadQuote } = useResource(loadQuote);

  const changed = (): void => {
    reloadModels();
    reloadSetup();
    reloadQuote();
  };
  const toggle = (key: string): void => {
    setPicked(chosen.includes(key) ? chosen.filter((k) => k !== key) : [...chosen, key]);
  };

  const canStart = quote.state === "ready" && quote.value.images > 0 && quote.value.fits && !generation.running;
  const subject = brief.draft.subject.trim();
  return (
    <div className="generate">
      <div className="generate-main">
        <h2>Generate images</h2>
        <p className="recap">
          {subject === "" ? "The brief is empty." : `“${subject}”`}{" "}
          <span className="fine">
            A {SHAPE_WORDS[shape]} {KIND_WORDS[kind]}, {plural(candidates, "image", "images")} per model.{" "}
            <a href={`#/project/${project.id}/brief`}>Edit the brief</a>
          </span>
        </p>
        {subject === "" && (
          <p className="note">
            Describe what the image should show in <a href={`#/project/${project.id}/brief`}>Brief &amp; brand</a> first.
          </p>
        )}
        <Async resource={models}>
          {(options) => (
            <ModelList models={options} providers={providers} chosen={chosen} onToggle={toggle} onConnect={setConnectFor} />
          )}
        </Async>
        <Async resource={quote}>{(value) => <QuoteBox quote={value} />}</Async>
        {generation.running ? (
          <Progress models={chosen.length} images={chosen.length * candidates} />
        ) : (
          <div className="actions">
            <button
              type="button"
              className="primary"
              disabled={!canStart || subject === ""}
              onClick={() => {
                onStart();
                void generation.start(chosen, candidates);
              }}
            >
              {quote.state === "ready" && quote.value.images > 0
                ? `Generate ${plural(quote.value.images, "image", "images")}`
                : "Generate"}
            </button>
          </div>
        )}
        {generation.job?.state === "failed" && (
          <p role="alert" className="error">
            The run stopped: {generation.job.error ?? "something went wrong"}. A call the provider refused is counted as not
            charged. For other failed calls a charge cannot be ruled out, so their reserved amount stays counted as uncertain
            in the budget. You can try again.
          </p>
        )}
        {generation.error !== null && (
          <p role="alert" className="error">
            {generation.error}
          </p>
        )}
        {newCount > 0 && !generation.running && generation.finishedRun !== null && (
          <p role="status" className="ready-note">
            {plural(newCount, "new image is", "new images are")} ready.{" "}
            <button type="button" className="primary" onClick={onReview}>
              Review them
            </button>
          </p>
        )}
      </div>
      <aside className="generate-side">
        <section className="panel flat">
          <h3>Connect a provider</h3>
          <Async resource={setup}>
            {(value) => <ProviderKeys providers={value.providers} openFor={connectFor} onChanged={changed} />}
          </Async>
        </section>
        <section className="panel flat">
          <h3>Budget</h3>
          <Async resource={setup}>{(value) => <BudgetSummary budget={value.budget} onChanged={changed} />}</Async>
        </section>
      </aside>
    </div>
  );
}
