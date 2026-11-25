/** Colour maths for the brand editor: hex checks, contrast, and a palette proposal. */
import type { Colours } from "./types";

const HEX = /^#[0-9a-f]{6}$/i;
const SHORT_HEX = /^#[0-9a-f]{3}$/i;

export const MIN_CONTRAST = 4.5;

/** A full `#rrggbb` colour, or null for anything that is not one (a short `#abc` is expanded). */
export function normaliseHex(value: string): string | null {
  const text = value.trim();
  const full = SHORT_HEX.test(text) ? `#${text.slice(1).replaceAll(/./g, (c) => c + c)}` : text;
  return HEX.test(full) ? full.toLowerCase() : null;
}

type Rgb = readonly [number, number, number];

function toRgb(hex: string): Rgb {
  const n = Number.parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function channel(value: number): number {
  const s = value / 255;
  return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
}

function luminance(hex: string): number {
  const [r, g, b] = toRgb(hex);
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

export function contrast(foreground: string, background: string): number {
  const a = luminance(foreground);
  const b = luminance(background);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

function toHex([r, g, b]: Rgb): string {
  return `#${[r, g, b].map((v) => Math.round(v).toString(16).padStart(2, "0")).join("")}`;
}

function fromHsl(h: number, s: number, l: number): string {
  const k = (n: number): number => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n: number): number => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  return toHex([f(0) * 255, f(8) * 255, f(4) * 255]);
}

function hueOf(hex: string): number {
  const [r, g, b] = toRgb(hex).map((v) => v / 255) as [number, number, number];
  const max = Math.max(r, g, b);
  const delta = max - Math.min(r, g, b);
  if (delta === 0) return 30;
  const raw = max === r ? ((g - b) / delta) % 6 : max === g ? (b - r) / delta + 2 : (r - g) / delta + 4;
  return (raw * 60 + 360) % 360;
}

/** Darken `hue` until it reads on `ground` at the minimum contrast. */
function readable(hue: number, saturation: number, lightness: number, ground: string): string {
  let l = lightness;
  let colour = fromHsl(hue, saturation, l);
  while (contrast(colour, ground) < MIN_CONTRAST && l > 0.04) {
    l -= 0.02;
    colour = fromHsl(hue, saturation, l);
  }
  return colour;
}

/** A calm palette around the accent: a pale tint of its hue, dark text and quieter text that stay readable. */
export function suggestPalette(accent: string): Colours {
  const hue = hueOf(accent);
  const ground = fromHsl(hue, 0.3, 0.95);
  return {
    ground,
    text: readable(hue, 0.3, 0.16, ground),
    quiet: readable(hue, 0.14, 0.4, ground),
    accent,
  };
}
