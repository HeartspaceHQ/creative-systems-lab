import { useCallback, useState, type KeyboardEvent } from "react";
import { api, imageUrl } from "../api";
import { Async } from "../components/Async";
import { CheckList } from "../components/CheckList";
import { ColourBand } from "../components/ColourBand";
import { DecisionForm } from "../components/DecisionForm";
import { ColourTable, Provenance } from "../components/Provenance";
import { StatusChip } from "../components/StatusChip";
import { VerifyBanner } from "../components/VerifyBanner";
import { KIND_LABELS, dateTime, plural } from "../format";
import { useResource } from "../hooks";
import type { Candidate, RunDetail } from "../types";

type Other = { readonly kind: "candidate"; readonly id: string } | { readonly kind: "reference"; readonly name: string };

function step(key: string): number {
  if (key === "ArrowRight" || key === "ArrowDown") return 1;
  if (key === "ArrowLeft" || key === "ArrowUp") return -1;
  return 0;
}

function Filmstrip(props: {
  run: string;
  candidates: readonly Candidate[];
  selected: string;
  onSelect: (id: string) => void;
}) {
  const { run, candidates, selected, onSelect } = props;
  const onKeyDown = (event: KeyboardEvent): void => {
    const delta = step(event.key);
    if (delta === 0) return;
    event.preventDefault();
    const index = candidates.findIndex((c) => c.id === selected);
    const next = candidates[(index + delta + candidates.length) % candidates.length];
    if (next) {
      onSelect(next.id);
      document.getElementById(`cand-${next.id}`)?.focus();
    }
  };
  return (
    <div role="radiogroup" aria-label="Candidates" className="filmstrip" onKeyDown={onKeyDown}>
      {candidates.map((candidate, index) => (
        <button
          key={candidate.id}
          id={`cand-${candidate.id}`}
          type="button"
          role="radio"
          aria-checked={candidate.id === selected}
          aria-label={`${String(index + 1)}: ${candidate.modelLabel}, seed ${String(candidate.seed)}, ${candidate.status.replace("_", " ")}`}
          tabIndex={candidate.id === selected ? 0 : -1}
          className={`frame frame-${candidate.status}`}
          onClick={() => { onSelect(candidate.id); }}
        >
          <img src={imageUrl.candidate(run, candidate.id)} alt="" loading="lazy" />
          <span className="frame-number">{String(index + 1)}</span>
        </button>
      ))}
    </div>
  );
}

function otherSource(detail: RunDetail, other: Other): { src: string; caption: string } {
  if (other.kind === "reference") {
    return { src: imageUrl.reference(other.name), caption: `Approved reference ${other.name}` };
  }
  const index = detail.candidates.findIndex((c) => c.id === other.id);
  const match = detail.candidates[index];
  const caption = match ? `${String(index + 1)}. ${match.modelLabel}, seed ${String(match.seed)}` : other.id;
  return { src: imageUrl.candidate(detail.id, other.id), caption };
}

function Stage(props: { detail: RunDetail; candidate: Candidate; index: number }) {
  const { detail, candidate, index } = props;
  const [other, setOther] = useState<Other | null>(null);
  const others: { value: string; label: string; other: Other }[] = [
    ...detail.candidates
      .filter((c) => c.id !== candidate.id)
      .map((c) => ({
        value: `c:${c.id}`,
        label: `Candidate ${String(detail.candidates.indexOf(c) + 1)}: ${c.modelLabel}, seed ${String(c.seed)}`,
        other: { kind: "candidate", id: c.id } as const,
      })),
    ...detail.references
      .filter((r) => r.available)
      .map((r) => ({ value: `r:${r.name}`, label: `Reference: ${r.name}`, other: { kind: "reference", name: r.name } as const })),
  ];
  const current = other === null ? "" : other.kind === "candidate" ? `c:${other.id}` : `r:${other.name}`;
  const shown = other === null ? null : otherSource(detail, other);
  return (
    <section className="stage" aria-label="Selected candidate">
      <div className="stage-tools">
        <label className="compare-picker">
          Compare with
          <select
            value={current}
            onChange={(e) => {
              setOther(others.find((o) => o.value === e.target.value)?.other ?? null);
            }}
          >
            <option value="">Nothing, show one image</option>
            {others.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className={shown === null ? "light-table" : "light-table light-table-pair"}>
        <figure className="plate">
          <img
            src={imageUrl.candidate(detail.id, candidate.id)}
            alt={`Candidate ${String(index + 1)}, made by ${candidate.modelLabel}`}
          />
          <figcaption>
            <span className="plate-title">
              {String(index + 1)}. {candidate.modelLabel}
            </span>
            <span>seed {String(candidate.seed)}</span>
          </figcaption>
        </figure>
        {shown !== null && (
          <figure className="plate">
            <img src={shown.src} alt={shown.caption} />
            <figcaption>
              <span className="plate-title">{shown.caption}</span>
            </figcaption>
          </figure>
        )}
      </div>
      <ColourBand
        colours={candidate.colours}
        palette={detail.palette}
        subject={shown === null ? null : `candidate ${String(index + 1)} (left)`}
      />
    </section>
  );
}

function History({ detail, candidate }: { detail: RunDetail; candidate: Candidate }) {
  const items = detail.decisions.filter((d) => d.candidateId === candidate.id);
  if (items.length === 0) return null;
  return (
    <section className="inspector-section" aria-labelledby="history-title">
      <h3 id="history-title">Decision log</h3>
      <ol className="history">
        {items.map((d) => (
          <li key={d.decidedAt}>
            <strong>
              {d.verdict === "approve" ? "Approved" : "Rejected"} by {d.reviewer}
              {d.override && " (override)"}
            </strong>
            <span className="fine"> {dateTime(d.decidedAt)}</span>
            {d.note && <p>{d.note}</p>}
          </li>
        ))}
      </ol>
    </section>
  );
}

function RunHeader({ detail }: { detail: RunDetail }) {
  const counts = {
    pending: detail.candidates.filter((c) => c.status === "pending").length,
    approved: detail.candidates.filter((c) => c.status === "approved").length,
  };
  return (
    <header className="run-head">
      <a className="back" href="#/runs">
        All runs
      </a>
      <div className="run-title">
        <h1 title={detail.subject}>{detail.subject}</h1>
        <p className="run-meta">
          <span>{KIND_LABELS[detail.kind]}</span>
          <span>{detail.brandName}, version {detail.brandVersion}</span>
          <span>{dateTime(detail.startedAt)}</span>
          <span>
            {plural(detail.candidates.length, "candidate", "candidates")}, {String(counts.pending)} to review,{" "}
            {String(counts.approved)} approved
          </span>
          {detail.rechecked.length > 0 && (
            <span title="The images and their records are unchanged; only the evaluation is new.">
              Rechecked under the current brand from {plural(detail.rechecked.length, "earlier run", "earlier runs")}
            </span>
          )}
        </p>
      </div>
      <VerifyBanner verification={detail.verification} />
    </header>
  );
}

function RunView({ detail, reload }: { detail: RunDetail; reload: () => void }) {
  const [selected, setSelected] = useState(detail.candidates[0]?.id ?? "");
  const index = detail.candidates.findIndex((c) => c.id === selected);
  const candidate = detail.candidates[index];
  return (
    <div className="run">
      <RunHeader detail={detail} />
      <div className="desk">
        <Filmstrip run={detail.id} candidates={detail.candidates} selected={selected} onSelect={setSelected} />
        {candidate && <Stage key={candidate.id} detail={detail} candidate={candidate} index={index} />}
        {candidate && (
          <aside className="inspector" aria-label="Review">
            <div className="inspector-status">
              <h2>
                Candidate {String(index + 1)} of {String(detail.candidates.length)}
              </h2>
              <StatusChip status={candidate.status} />
            </div>
            <DecisionForm key={candidate.id} run={detail.id} candidate={candidate} onDecided={reload} />
            <History detail={detail} candidate={candidate} />
            <CheckList checks={candidate.checks} warnings={candidate.warnings} kind={detail.kind} />
            <ColourTable candidate={candidate} palette={detail.palette} />
            <Provenance candidate={candidate} />
          </aside>
        )}
      </div>
    </div>
  );
}

export function RunPage({ id }: { id: string }) {
  const load = useCallback(() => api.run(id), [id]);
  const { resource, reload } = useResource(load);
  return <Async resource={resource}>{(detail) => <RunView detail={detail} reload={reload} />}</Async>;
}
