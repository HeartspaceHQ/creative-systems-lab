import { percent } from "../format";
import type { ColourMatch, PaletteColour } from "../types";

interface Props {
  readonly colours: readonly ColourMatch[];
  readonly palette: readonly PaletteColour[];
  /** Names the measured image when another image is shown beside it. */
  readonly subject: string | null;
}

/**
 * The image's main colours as one band, each as wide as its share of the image, with the brand
 * colour it was matched to beneath it. Colours outside the palette tolerance are hatched.
 */
export function ColourBand({ colours, palette, subject }: Props) {
  const hexOf = new Map(palette.map((c) => [c.name, c.hex]));
  const outside = colours.filter((c) => !c.within).reduce((sum, c) => sum + c.share, 0);
  return (
    <figure className="band" aria-label="Main colours of the image and their nearest brand colours">
      <div className="band-row" aria-hidden="true">
        {colours.map((colour) => (
          <span
            key={colour.hex}
            className={colour.within ? "band-cell" : "band-cell band-outside"}
            style={{ flexGrow: colour.share, background: colour.hex }}
            title={`${colour.hex}, ${percent(colour.share)} of the image`}
          />
        ))}
      </div>
      <div className="band-row band-brand" aria-hidden="true">
        {colours.map((colour) => (
          <span
            key={colour.hex}
            className="band-cell"
            style={{ flexGrow: colour.share, background: hexOf.get(colour.nearest) ?? "transparent" }}
            title={`nearest brand colour: ${colour.nearest}`}
          />
        ))}
      </div>
      <figcaption>
        {subject !== null && `Colours of ${subject}. `}Top: the image&apos;s main colours by area. Bottom: the nearest brand colour.{" "}
        {outside > 0 ? `${percent(outside)} of the area is outside the palette tolerance (hatched).` : "All of it is within the palette tolerance."}
      </figcaption>
    </figure>
  );
}
