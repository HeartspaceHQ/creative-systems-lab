import { useState } from "react";
import { suggestPalette } from "../../studio/colour";
import type { ColourRole, Colours } from "../../studio/types";
import { useWorkspace } from "../../workspace/context";
import { ColourField } from "./ColourField";

const ROLES: readonly { role: ColourRole; label: string; description: string }[] = [
  { role: "ground", label: "Background", description: "The colour behind everything" },
  { role: "text", label: "Text", description: "Headlines and body copy" },
  { role: "quiet", label: "Quiet text", description: "Labels and small print" },
  { role: "accent", label: "Accent", description: "Call to action and highlights" },
];

export function ColourSection() {
  const { brandDraft } = useWorkspace();
  const { draft, edit, fieldErrors } = brandDraft;
  const [before, setBefore] = useState<Colours | null>(null);
  const setColour = (role: ColourRole, hex: string): void => {
    edit({ ...draft, colours: { ...draft.colours, [role]: hex } });
  };
  const suggest = (): void => {
    setBefore(draft.colours);
    edit({ ...draft, colours: suggestPalette(draft.colours.accent) });
  };
  const undo = (): void => {
    if (before === null) return;
    edit({ ...draft, colours: before });
    setBefore(null);
  };
  return (
    <fieldset className="colours-set">
      <legend>Colours</legend>
      <div className="colour-grid">
        {ROLES.map(({ role, label, description }) => (
          <ColourField
            key={role}
            label={label}
            description={description}
            value={draft.colours[role]}
            serverError={fieldErrors[`colours.${role}`]}
            {...(role === "ground" ? {} : { ground: draft.colours.ground })}
            onChange={(hex) => {
              setColour(role, hex);
            }}
          />
        ))}
      </div>
      <div className="actions inline-actions">
        <button type="button" onClick={suggest}>
          Suggest a palette from the accent
        </button>
        {before !== null && (
          <button type="button" className="link-button" onClick={undo}>
            Undo
          </button>
        )}
      </div>
    </fieldset>
  );
}
