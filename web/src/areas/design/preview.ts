import { useEffect, useRef, useState, type RefObject } from "react";

/** What the preview page needs to draw one frame; the same shapes the server keeps. */
export interface PreviewScene {
  readonly brand: Record<string, unknown>;
  readonly design: Record<string, unknown>;
  readonly imageUrl: string;
  readonly format: string;
  /** Every font on offer, so the engine can load the brand's two from where the studio serves them. */
  readonly fonts: readonly Record<string, unknown>[];
}

export type PreviewStatus =
  | { readonly state: "loading" }
  | { readonly state: "ready"; readonly overflow: readonly string[] }
  | { readonly state: "error"; readonly message: string };

const PREVIEW_URL = "/engine/studio.html";
/** How long the preview page gets to say it is listening before the studio is blamed. */
const START_WAIT_MS = 8000;

function reply(data: unknown): { type: string; id: unknown; overflow: readonly string[]; message: string } | null {
  if (typeof data !== "object" || data === null) return null;
  const raw = data as Record<string, unknown>;
  const type = raw["type"];
  if (typeof type !== "string") return null;
  const overflow = Array.isArray(raw["overflow"]) ? raw["overflow"].filter((n): n is string => typeof n === "string") : [];
  const message = typeof raw["message"] === "string" ? raw["message"] : "The preview could not be drawn.";
  return { type, id: raw["id"], overflow, message };
}

/**
 * Drives the preview page in an iframe: every change of the scene is posted straight away, and the
 * page answers with which text does not fit, or why it could not draw.
 */
export function usePreview(scene: PreviewScene, playing: boolean): { frame: RefObject<HTMLIFrameElement | null>; status: PreviewStatus; url: string } {
  const frame = useRef<HTMLIFrameElement>(null);
  const lastId = useRef(0);
  const [listening, setListening] = useState(false);
  const [status, setStatus] = useState<PreviewStatus>({ state: "loading" });
  const payload = JSON.stringify({ ...scene, time: playing ? "play" : "end" });

  useEffect(() => {
    const onMessage = (event: MessageEvent<unknown>): void => {
      if (event.origin !== window.location.origin || event.source !== frame.current?.contentWindow) return;
      const answer = reply(event.data);
      if (answer === null) return;
      if (answer.type === "hello") setListening(true);
      else if (answer.id === lastId.current && answer.type === "ready") setStatus({ state: "ready", overflow: answer.overflow });
      else if (answer.id === lastId.current && answer.type === "error") setStatus({ state: "error", message: answer.message });
    };
    window.addEventListener("message", onMessage);
    return () => {
      window.removeEventListener("message", onMessage);
    };
  }, []);

  useEffect(() => {
    if (!listening) return undefined;
    lastId.current += 1;
    const body: unknown = JSON.parse(payload);
    frame.current?.contentWindow?.postMessage({ type: "scene", id: lastId.current, ...(body as Record<string, unknown>) }, window.location.origin);
    return undefined;
  }, [listening, payload]);

  useEffect(() => {
    if (listening) return undefined;
    const timer = window.setTimeout(() => {
      setStatus({ state: "error", message: "The preview could not start. Restart the studio and try again." });
    }, START_WAIT_MS);
    return () => {
      window.clearTimeout(timer);
    };
  }, [listening]);

  return { frame, status, url: PREVIEW_URL };
}
