import { GROUPS, type LibraryItem } from "./items";

export type Mode = "item" | "generate" | "import";

interface Props {
  readonly items: readonly LibraryItem[];
  readonly selected: string | null;
  readonly mode: Mode;
  readonly onSelect: (key: string) => void;
  readonly onMode: (mode: Mode) => void;
}

const STATE_WORDS = { review: "to review", approved: "approved", rejected: "rejected" } as const;

export function Library({ items, selected, mode, onSelect, onMode }: Props) {
  return (
    <aside className="library" aria-label="Images">
      <div className="add-images">
        <button type="button" aria-pressed={mode === "generate"} onClick={() => { onMode("generate"); }}>
          Generate
        </button>
        <button type="button" aria-pressed={mode === "import"} onClick={() => { onMode("import"); }}>
          Import
        </button>
      </div>
      {items.length === 0 && <p className="fine">No images yet. Generate some, or import your own.</p>}
      {GROUPS.map((group) => {
        const inGroup = items.filter((item) => item.state === group.state);
        if (inGroup.length === 0) return null;
        return (
          <section key={group.state} aria-label={group.title}>
            <h3>
              {group.title} <span className="count">{inGroup.length}</span>
            </h3>
            <ul className="tiles">
              {inGroup.map((item) => (
                <li key={item.key}>
                  <button
                    type="button"
                    className={`tile tile-${item.state}`}
                    aria-pressed={mode === "item" && item.key === selected}
                    aria-label={`${item.title}, ${STATE_WORDS[item.state]}`}
                    onClick={() => { onSelect(item.key); }}
                  >
                    <img src={item.src} alt="" loading="lazy" />
                  </button>
                </li>
              ))}
            </ul>
          </section>
        );
      })}
    </aside>
  );
}
