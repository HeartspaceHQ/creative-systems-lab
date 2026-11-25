import type { Asset } from "../../studio/types";

interface Props {
  readonly assets: readonly Asset[];
  readonly value: string | null;
  readonly onChange: (id: string) => void;
}

export function ImagePicker({ assets, value, onChange }: Props) {
  return (
    <fieldset className="image-picker">
      <legend>Image</legend>
      <ul className="tiles">
        {assets.map((asset) => (
          <li key={asset.id}>
            <button
              type="button"
              className="tile"
              aria-pressed={asset.id === value}
              aria-label={asset.origin === "imported" ? `Imported image ${asset.source.fileName ?? ""}` : "Generated image"}
              onClick={() => {
                onChange(asset.id);
              }}
            >
              <img src={asset.url} alt="" loading="lazy" />
            </button>
          </li>
        ))}
      </ul>
    </fieldset>
  );
}
