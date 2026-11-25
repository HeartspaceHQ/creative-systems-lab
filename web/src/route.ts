import { useEffect, useState } from "react";
import type { Area } from "./studio/types";

export type Route =
  | { readonly page: "home" }
  | { readonly page: "runs" }
  | { readonly page: "run"; readonly id: string }
  | { readonly page: "blind"; readonly set: string }
  | { readonly page: "project"; readonly id: string; readonly area: Area };

export const AREAS: readonly Area[] = ["brief", "images", "design", "deliver"];

export const projectHref = (id: string, area: Area): string => `#/project/${encodeURIComponent(id)}/${area}`;

function areaOf(value: string | undefined): Area {
  return AREAS.find((area) => area === value) ?? "brief";
}

export function parse(hash: string): Route {
  const parts = hash.replace(/^#\/?/, "").split("/").filter(Boolean);
  const [head, arg, area] = parts;
  if (head === "runs") return { page: "runs" };
  if (head === "run" && arg) return { page: "run", id: decodeURIComponent(arg) };
  if (head === "blind" && arg) return { page: "blind", set: decodeURIComponent(arg) };
  if (head === "project" && arg) return { page: "project", id: decodeURIComponent(arg), area: areaOf(area) };
  return { page: "home" };
}

export function useRoute(): Route {
  const [hash, setHash] = useState(window.location.hash);
  useEffect(() => {
    const onChange = (): void => {
      setHash(window.location.hash);
    };
    window.addEventListener("hashchange", onChange);
    return () => {
      window.removeEventListener("hashchange", onChange);
    };
  }, []);
  return parse(hash);
}

export function go(href: string): void {
  window.location.hash = href.replace(/^#/, "");
}
