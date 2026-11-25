import { ChoiceGroup } from "../../components/ChoiceGroup";
import type { Layout } from "../../studio/types";

interface Props {
  readonly value: Layout;
  readonly onChange: (layout: Layout) => void;
}

const OPTIONS = [
  {
    value: "editorial" as const,
    label: "Editorial",
    hint: "Picture with a text column beside it",
    visual: (
      <span className="layout-thumb layout-editorial" aria-hidden="true">
        <i className="lt-photo" />
        <i className="lt-line lt-1" />
        <i className="lt-line lt-2" />
        <i className="lt-line lt-3" />
      </span>
    ),
  },
  {
    value: "cinema" as const,
    label: "Cinematic",
    hint: "Full picture with the text over it",
    visual: (
      <span className="layout-thumb layout-cinema" aria-hidden="true">
        <i className="lt-line lt-1" />
        <i className="lt-line lt-2" />
      </span>
    ),
  },
];

export function LayoutChoice({ value, onChange }: Props) {
  return <ChoiceGroup legend="Layout" value={value} options={OPTIONS} onChange={onChange} compact />;
}
