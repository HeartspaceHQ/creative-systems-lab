/**
 * The web runtime: the renderer's scene on a live page, sized to the visitor's screen.
 *
 * The page holds a tall section with a sticky stage. The stage is the scene's canvas; its shape picks
 * the art-directed photograph and the layout, by the same rule the renderer uses for formats. The
 * scene is the same pure function of t as in the film; only what drives t differs:
 *  - scroll (default): the opening plays by itself so the message is there at once, then the
 *    morning follows the scroll at a fixed pace per second of film;
 *  - time (`data-drive="time"`): plays once when the stage is in view;
 *  - reduced motion: the end state, still, with no scroll length.
 *
 * It exposes the renderer's contract (seek, measure, LANGD, KLAR), so the same checks run on the page.
 * Calling window.seek takes over from the drivers, as a renderer would.
 *
 * Fonts that do not arrive in time are swapped in when they do, with a fresh layout. A photograph that
 * cannot be decoded still gets its words on the stage. If the scene cannot start at all, the page
 * shows the renderer's poster with the copy as real text (the <template id="fallback">).
 */
import { clamp01, loadTypeFaces, type Build, type Built } from "./kit.ts";
import { shapeOf } from "./shape.ts";
import type { SceneData, WebArt, WebScene } from "./types.ts";

/** Longest wait for the web fonts before the scene is built with whatever has arrived. */
const FONT_WAIT_MS = 2000;

export function element<T extends Element>(selector: string, type: new () => T): T {
  const el = document.querySelector(selector);
  if (!(el instanceof type)) throw new Error(`the page has no ${selector}`);
  return el;
}

export function readScene(): WebScene {
  return JSON.parse(element("#scene-data", HTMLScriptElement).text) as WebScene;
}

/**
 * What the screen covers at its edges, in CSS pixels: a phone held sideways has a notch on one side
 * and a home indicator below. The page draws the photograph under them (viewport-fit=cover) and the
 * scene keeps its text clear of them.
 */
function screenInset(stage: HTMLElement): NonNullable<SceneData["inset"]> {
  const probe = document.createElement("div");
  probe.style.cssText = "position:absolute;visibility:hidden;padding:env(safe-area-inset-top) env(safe-area-inset-right) env(safe-area-inset-bottom) env(safe-area-inset-left)";
  stage.append(probe);
  const style = getComputedStyle(probe);
  const inset = { top: parseFloat(style.paddingTop), right: parseFloat(style.paddingRight), bottom: parseFloat(style.paddingBottom), left: parseFloat(style.paddingLeft) };
  probe.remove();
  return inset;
}

const wait = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/** How long the scene waits for its photograph before it starts without it. */
const IMAGE_WAIT_MS = 2500;

/**
 * Let the browser pick the source from srcset and sizes, as it did for the preload, so nothing loads
 * twice. If it cannot be decoded, the scene is built anyway around the first source: the words matter more.
 */
export async function chooseImage(art: WebArt): Promise<string> {
  const img = new Image();
  img.sizes = art.sizes;
  img.srcset = art.srcset;
  const first = art.srcset.split(",")[0]?.trim().split(" ")[0] ?? "";
  // A slow photograph does not hold the words back: after IMAGE_WAIT_MS the scene is built with the
  // source already on its way, and the photograph appears when it arrives.
  await Promise.race([img.decode().catch(() => undefined), wait(IMAGE_WAIT_MS)]);
  return img.currentSrc || first;
}


/** The renderer's poster and the copy as plain text, in place of a scene that could not start. */
function showFallback(stage: HTMLElement, film: HTMLElement): void {
  stage.querySelector(":scope > .scene")?.remove();
  film.style.height = "100svh";
  const fallback = document.getElementById("fallback");
  if (fallback instanceof HTMLTemplateElement && stage.querySelector(":scope > .fallback") === null) {
    stage.append(fallback.content.cloneNode(true));
  }
}

export async function startWeb(build: Build): Promise<void> {
  try {
    await run(build);
  } catch (error) {
    showFallback(element(".stage", HTMLElement), element(".film", HTMLElement));
    performance.mark("scene-failed");
    console.error(error);
  }
}

async function run(build: Build): Promise<void> {
  const web = readScene();
  const film = element(".film", HTMLElement);
  const stage = element(".stage", HTMLElement);
  const length = web.scene.lengthS;
  const reduced = matchMedia("(prefers-reduced-motion: reduce)");
  const asked = new URLSearchParams(location.search).get("drive") ?? film.dataset["drive"];
  const drive: "scroll" | "time" = asked === "time" ? "time" : "scroll";
  film.dataset["drive"] = drive;

  // A font that fails to load is not a reason to show nothing: the scene falls back to system faces.
  const faces = loadTypeFaces(web.scene.tokens).then(() => true, () => false);
  const facesInTime = await Promise.race([faces, wait(FONT_WAIT_MS).then(() => undefined)]);

  let scene: Built | undefined;
  let t = 0;
  let size = "";
  let manual = false;

  const show = (time: number): void => {
    t = time;
    scene?.seek(t);
  };

  async function rebuild(): Promise<void> {
    const w = stage.clientWidth;
    const h = stage.clientHeight;
    const inset = screenInset(stage);
    const key = `${String(w)}x${String(h)} ${Object.values(inset).join(" ")}`;
    if (key === size || w === 0 || h === 0) return;
    size = key;
    const art = web.art[shapeOf(w, h)];
    const imageUrl = await chooseImage(art);
    if (size !== key) return; // resized again while the image loaded
    const data: SceneData = {
      ...web.scene,
      format: { width: w, height: h },
      imageUrl,
      focus: art.focus,
      medium: "web",
      inset,
      ...(art.light === undefined ? {} : { light: art.light }),
      ...(art.alt === undefined ? {} : { alt: art.alt }),
    };
    stage.querySelector(":scope > .scene")?.remove();
    stage.querySelector(":scope > .fallback")?.remove();
    scene = build(data, art.aspect, stage);
    scene.seek(t);
  }

  // Scroll: how far the stage has travelled through its section, as seconds of film. The travel is
  // measured against the current viewport, so a phone whose toolbar has collapsed still reaches the end.
  const scrolled = (): number => {
    const travel = film.offsetHeight - Math.max(stage.offsetHeight, window.innerHeight);
    return travel <= 0 ? length : clamp01(-film.getBoundingClientRect().top / travel) * length;
  };

  let introStarted = 0;
  let frame = 0;
  const tick = (now: number): void => {
    frame = 0;
    if (manual || reduced.matches) return;
    const intro = Math.min(web.introS, (now - introStarted) / 1000);
    if (drive === "time") {
      show(Math.min(length, (now - introStarted) / 1000));
      if (t < length) frame = requestAnimationFrame(tick);
      return;
    }
    show(Math.max(intro, scrolled()));
    if (intro < web.introS) frame = requestAnimationFrame(tick);
  };
  const request = (): void => {
    if (frame === 0 && !manual && !reduced.matches) frame = requestAnimationFrame(tick);
  };

  let observer: IntersectionObserver | undefined;
  const settle = (): void => {
    if (manual) return;
    cancelAnimationFrame(frame);
    frame = 0;
    observer?.disconnect();
    observer = undefined;
    if (reduced.matches) {
      film.style.height = "100svh";
      show(length);
      return;
    }
    film.style.height = drive === "scroll" ? `calc(100svh + ${String(Math.round(length * web.pxPerSecond))}px)` : "100svh";
    introStarted = performance.now();
    if (drive === "time") {
      show(0);
      observer = new IntersectionObserver((entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          observer?.disconnect();
          introStarted = performance.now();
          request();
        }
      }, { threshold: 0.6 });
      observer.observe(stage);
      return;
    }
    request();
  };

  await rebuild();
  settle();
  // Time plays by itself once in view; only the scroll drive listens to scrolling.
  if (drive === "scroll") addEventListener("scroll", request, { passive: true });
  reduced.addEventListener("change", settle);
  // A later rebuild that fails leaves the poster, not a broken stage, and the next size tries again.
  const relayout = (): void => {
    rebuild().catch((error: unknown) => {
      size = "";
      showFallback(stage, film);
      console.error(error);
    });
  };
  new ResizeObserver(relayout).observe(stage);
  // Fonts that arrived after the wait: lay the scene out again with them, at the same moment of film.
  if (facesInTime === undefined) {
    void faces.then((loaded) => {
      if (!loaded) return;
      size = "";
      relayout();
    });
  }

  window.LANGD = length;
  window.seek = (time: number): void => {
    manual = true;
    cancelAnimationFrame(frame);
    frame = 0;
    show(time);
  };
  window.measure = () => {
    if (scene === undefined) throw new Error("the scene is not built");
    return scene.measure();
  };
  performance.mark("scene-ready");
  window.KLAR = true;
}
