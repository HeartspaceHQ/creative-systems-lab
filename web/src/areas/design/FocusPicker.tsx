import { useRef, type KeyboardEvent, type PointerEvent } from "react";
import type { Asset, Focus } from "../../studio/types";

interface Props {
  readonly asset: Asset;
  readonly focus: Focus;
  readonly onChange: (focus: Focus) => void;
}

const STEP = 0.02;
const clamp = (value: number): number => Math.min(1, Math.max(0, value));
const percent = (value: number): string => `${String(Math.round(value * 100))}%`;

/** A small copy of the image: drag the dot to the part that must stay in view when the picture is cropped. */
export function FocusPicker({ asset, focus, onChange }: Props) {
  const box = useRef<HTMLDivElement>(null);

  const move = (event: PointerEvent): void => {
    const rect = box.current?.getBoundingClientRect();
    if (rect === undefined || rect.width === 0) return;
    onChange({ x: clamp((event.clientX - rect.left) / rect.width), y: clamp((event.clientY - rect.top) / rect.height) });
  };

  const onKey = (event: KeyboardEvent): void => {
    const delta = { ArrowLeft: [-STEP, 0], ArrowRight: [STEP, 0], ArrowUp: [0, -STEP], ArrowDown: [0, STEP] }[event.key];
    if (delta === undefined) return;
    event.preventDefault();
    onChange({ x: clamp(focus.x + (delta[0] ?? 0)), y: clamp(focus.y + (delta[1] ?? 0)) });
  };

  return (
    <div className="focus-picker">
      <div
        ref={box}
        className="focus-box"
        style={{ aspectRatio: `${String(asset.width)} / ${String(asset.height)}` }}
        tabIndex={0}
        role="group"
        aria-label={`Focus point, ${percent(focus.x)} across and ${percent(focus.y)} down. Use the arrow keys to move it.`}
        onKeyDown={onKey}
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId);
          move(e);
        }}
        onPointerMove={(e) => {
          if (e.currentTarget.hasPointerCapture(e.pointerId)) move(e);
        }}
      >
        <img src={asset.url} alt="" draggable={false} />
        <span className="focus-dot" style={{ left: percent(focus.x), top: percent(focus.y) }} aria-hidden="true" />
      </div>
    </div>
  );
}
