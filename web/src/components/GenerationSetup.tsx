import type { Setup } from "../types";
import { BudgetSummary } from "./BudgetSummary";
import { ProviderKeys } from "./ProviderKeys";

/** What this machine can generate with. Keys are pasted here and stay in memory until the studio stops. */
export function GenerationSetup({ setup, onChanged }: { setup: Setup; onChanged: () => void }) {
  const localReady = setup.local.filter((m) => m.reason === null);
  return (
    <section id="setup" className="setup" aria-labelledby="setup-title">
      <h2 id="setup-title">Models on this computer</h2>
      <p className="setup-lead">
        The built-in shape drawing always works, so every illustration brief can be tried at no cost. Photographs need a
        local FLUX.2 model or a paid model with your own key.
      </p>
      <div className="setup-item">
        <div className="setup-row">
          <h3>Local models</h3>
          <span className={localReady.length > 0 ? "setup-state setup-ready" : "setup-state setup-missing"}>
            {localReady.length > 0 ? `${String(localReady.length)} ready` : "Built-in drawing only"}
          </span>
        </div>
        {localReady.length === 0 && (
          <details>
            <summary>How to add FLUX.2 Klein (Apple silicon, about 24 GB of memory)</summary>
            <p>
              Install <code>mflux</code> and download the weights once, then restart the studio. The steps are in{" "}
              <code>docs/image-providers.md</code>.
            </p>
          </details>
        )}
      </div>
      <div className="setup-item">
        <h3>Connect a provider</h3>
        <ProviderKeys providers={setup.providers} onChanged={onChanged} />
      </div>
      <div className="setup-item">
        <h3>Budget</h3>
        <BudgetSummary budget={setup.budget} onChanged={onChanged} />
      </div>
    </section>
  );
}
