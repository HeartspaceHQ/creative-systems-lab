import { useCallback } from "react";
import { Async } from "../components/Async";
import { useResource } from "../hooks";
import { studioApi } from "../studio/api";
import type { Area, Brand, FontOption, Format, Project } from "../studio/types";
import { Workspace } from "./Workspace";

interface Loaded {
  readonly project: Project;
  readonly brands: readonly Brand[];
  readonly fonts: readonly FontOption[];
  readonly formats: readonly Format[];
}

async function loadAll(id: string): Promise<Loaded> {
  const [project, brands, fonts, formats] = await Promise.all([
    studioApi.project(id),
    studioApi.brands(),
    studioApi.fonts(),
    studioApi.formats(),
  ]);
  return { project, brands, fonts, formats };
}

export function ProjectPage({ id, area }: { id: string; area: Area }) {
  const load = useCallback(() => loadAll(id), [id]);
  const { resource } = useResource(load);
  return (
    <Async resource={resource}>
      {(loaded) => (
        <Workspace
          key={id}
          area={area}
          initialProject={loaded.project}
          initialBrands={loaded.brands}
          fonts={loaded.fonts}
          formats={loaded.formats}
        />
      )}
    </Async>
  );
}
