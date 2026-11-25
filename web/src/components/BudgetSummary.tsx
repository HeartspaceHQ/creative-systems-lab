import { useState, type SyntheticEvent } from "react";
import { usd } from "../format";
import { studioApi } from "../studio/api";
import type { BudgetStatus } from "../types";
import { Field } from "./Field";

type Line = "approvedUsd" | "chargedUsd" | "uncertainUsd" | "heldUsd" | "remainingUsd";

const LINES: readonly { key: Line; label: string; text: string }[] = [
  { key: "approvedUsd", label: "Approved", text: "The most that may be spent on generating images." },
  {
    key: "chargedUsd",
    label: "Reported",
    text: "Calls that finished, at the cost the provider reported, or its published price where it reports none.",
  },
  {
    key: "uncertainUsd",
    label: "Uncertain",
    text: "Calls that failed where a charge cannot be ruled out. The amount set aside for them stays counted.",
  },
  { key: "heldUsd", label: "Reserved", text: "Set aside for calls still running, until each one answers." },
  { key: "remainingUsd", label: "Left", text: "What new images can still use." },
];

/** The most a limit set here may be, so a slip of the keyboard cannot approve a large sum. */
const MAX_LIMIT_USD = 1000;

interface Props {
  readonly budget: BudgetStatus | null;
  /** Called after a limit was approved, so models and the quote can be read again. */
  readonly onChanged: () => void;
}

function LimitForm({ replacing, onDone, onCancel }: { replacing: boolean; onDone: () => void; onCancel?: () => void }) {
  const [amount, setAmount] = useState("");
  const [name, setName] = useState("");
  const [errors, setErrors] = useState<{ amount?: string; name?: string; form?: string }>({});
  const [busy, setBusy] = useState(false);

  const submit = (event: SyntheticEvent): void => {
    event.preventDefault();
    const value = Number(amount.replace(",", "."));
    const found: { amount?: string; name?: string } = {};
    if (!Number.isFinite(value) || value <= 0) found.amount = "Write an amount in dollars, for example 5.";
    else if (value > MAX_LIMIT_USD) found.amount = `Set at most ${usd(MAX_LIMIT_USD)} here.`;
    if (name.trim() === "") found.name = "Write your name: the limit is approved by you.";
    setErrors(found);
    if (found.amount !== undefined || found.name !== undefined) return;
    setBusy(true);
    studioApi.approveBudget(value, name.trim()).then(
      () => {
        setBusy(false);
        onDone();
      },
      (failure: unknown) => {
        setBusy(false);
        setErrors({ form: failure instanceof Error ? failure.message : "The limit could not be saved." });
      },
    );
  };

  return (
    <form className="limit-form" onSubmit={submit} noValidate>
      <p className="fine">
        {replacing
          ? "A new limit replaces the current one. What is left of the current limit no longer counts."
          : "Paid models only run within a limit you approve. It takes effect at once, no restart needed."}
      </p>
      <Field label="Limit in US dollars" error={errors.amount}>
        {(props) => (
          <input
            {...props}
            inputMode="decimal"
            autoComplete="off"
            value={amount}
            onChange={(e) => {
              setAmount(e.target.value);
            }}
          />
        )}
      </Field>
      <Field label="Approved by" error={errors.name}>
        {(props) => (
          <input
            {...props}
            autoComplete="name"
            value={name}
            onChange={(e) => {
              setName(e.target.value);
            }}
          />
        )}
      </Field>
      {errors.form !== undefined && (
        <p role="alert" className="error">
          {errors.form}
        </p>
      )}
      <div className="actions">
        <button type="submit" className="primary" disabled={busy}>
          {busy ? "Approving…" : "Approve limit"}
        </button>
        {onCancel !== undefined && (
          <button type="button" onClick={onCancel}>
            Cancel
          </button>
        )}
      </div>
    </form>
  );
}

export function BudgetSummary({ budget, onChanged }: Props) {
  const [changing, setChanging] = useState(false);
  if (budget === null) {
    return (
      <>
        <p className="note">No spending limit is set, so paid models are switched off. Local models stay free.</p>
        <LimitForm replacing={false} onDone={onChanged} />
      </>
    );
  }
  return (
    <>
      <dl className="budget">
        {LINES.map((line) => (
          <div key={line.key} className={line.key === "remainingUsd" ? "budget-line budget-left" : "budget-line"}>
            <dt>{line.label}</dt>
            <dd className="num">{usd(budget[line.key])}</dd>
            <dd className="fine">{line.text}</dd>
          </div>
        ))}
      </dl>
      {changing ? (
        <LimitForm
          replacing
          onDone={() => {
            setChanging(false);
            onChanged();
          }}
          onCancel={() => {
            setChanging(false);
          }}
        />
      ) : (
        <button
          type="button"
          onClick={() => {
            setChanging(true);
          }}
        >
          Set a new limit
        </button>
      )}
    </>
  );
}
