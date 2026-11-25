/**
 * The scrubber in the page's technical section: a second, small instance of the same scene, drawn
 * at whatever moment the visitor picks. It shows the claim the section makes, that every medium is
 * the one function of time, without a second code path. Built only when the section comes near the
 * screen, so a visitor who never scrolls there pays nothing for it.
 */
import type { Build, Built } from "./kit.ts";
import { shapeOf } from "./shape.ts";
import type { SceneData } from "./types.ts";
import { chooseImage, element, readScene } from "./web.ts";

export function startDemo(build: Build): void {
  const found = document.querySelector(".demo-stage");
  // A page exported without the technical section has nothing to scrub.
  if (!(found instanceof HTMLElement)) return;
  const host: HTMLElement = found;
  const range = element("#demo-t", HTMLInputElement);
  const readout = element("#demo-readout", HTMLOutputElement);
  const web = readScene();
  let scene: Built | undefined;
  let size = "";

  const show = (): void => {
    const t = Number(range.value);
    scene?.seek(t);
    readout.value = `t = ${t.toFixed(1)} s`;
  };

  async function rebuild(): Promise<void> {
    const w = host.clientWidth;
    const h = host.clientHeight;
    const key = `${String(w)}x${String(h)}`;
    if (key === size || w === 0 || h === 0) return;
    size = key;
    const art = web.art[shapeOf(w, h)];
    const imageUrl = await chooseImage(art);
    const data: SceneData = {
      ...web.scene,
      format: { width: w, height: h },
      imageUrl,
      focus: art.focus,
      medium: "web",
      ...(art.light === undefined ? {} : { light: art.light }),
    };
    host.replaceChildren();
    scene = build(data, art.aspect, host);
    show();
  }

  const fail = (error: unknown): void => {
    host.closest("figure")?.setAttribute("hidden", "");
    console.error(error);
  };
  range.max = String(web.scene.lengthS);
  range.value = range.max;
  range.addEventListener("input", show);
  const near = new IntersectionObserver((entries) => {
    if (!entries.some((e) => e.isIntersecting)) return;
    near.disconnect();
    new ResizeObserver(() => { rebuild().catch(fail); }).observe(host);
  }, { rootMargin: "50% 0px" });
  near.observe(host);
}
