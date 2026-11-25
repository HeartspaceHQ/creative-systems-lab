import { useCallback, useState } from "react";
import { useAutosave } from "../studio/autosave";
import { studioApi } from "../studio/api";
import { newBrandDraft } from "../studio/defaults";
import { useFontFaces } from "../studio/fonts";
import type { Area, Brand, FontOption, Format, Project } from "../studio/types";
import { BrandSession } from "./BrandSession";
import { useGeneration } from "./generation";

interface Props {
  readonly area: Area;
  readonly initialProject: Project;
  readonly initialBrands: readonly Brand[];
  readonly fonts: readonly FontOption[];
  readonly formats: readonly Format[];
}

/** Everything one project keeps while the designer moves between its areas. */
export function Workspace({ area, initialProject, initialBrands, fonts: initialFonts, formats }: Props) {
  const [project, setProject] = useState(initialProject);
  const [fonts, setFonts] = useState(initialFonts);
  useFontFaces(fonts);
  const [brands, setBrands] = useState(initialBrands);
  const { id } = initialProject;

  const name = useAutosave<string>({
    initial: initialProject.name,
    save: async (value) => {
      await studioApi.renameProject(id, value);
    },
    canSave: (value) => value.trim() !== "",
  });
  const brief = useAutosave({
    initial: initialProject.brief,
    save: async (value) => {
      await studioApi.saveBrief(id, value);
    },
  });
  const design = useAutosave({
    initial: initialProject.design,
    save: async (value) => {
      if (value !== null) await studioApi.saveDesign(id, value);
    },
    canSave: (value) => value?.copy.headline.trim() !== "",
  });

  const refresh = useCallback(async (): Promise<Project> => {
    const next = await studioApi.project(id);
    setProject(next);
    return next;
  }, [id]);

  const { flush: flushBrief } = brief;
  const onFinished = useCallback((): void => {
    void refresh();
  }, [refresh]);
  const generation = useGeneration(id, flushBrief, onFinished);

  const upsertBrand = useCallback((next: Brand): void => {
    setBrands((current) => (current.some((b) => b.id === next.id) ? current.map((b) => (b.id === next.id ? next : b)) : [...current, next]));
  }, []);

  const createBrand = useCallback(
    async (brandName: string): Promise<Brand> => {
      const created = await studioApi.createBrand(newBrandDraft(brandName, fonts.map((f) => f.family)));
      upsertBrand(created);
      return created;
    },
    [fonts, upsertBrand],
  );

  const addFont = useCallback(async (file: File, family: string): Promise<FontOption> => {
    const added = await studioApi.addFont(file, family);
    setFonts((current) => [...current, added]);
    return added;
  }, []);

  const chooseBrand = useCallback(
    async (brandId: string): Promise<void> => {
      setProject(await studioApi.setProjectBrand(id, brandId));
    },
    [id],
  );

  const current = brands.find((b) => b.id === project.brand);
  if (current === undefined) {
    return <p role="alert" className="error">This project uses a brand that no longer exists. Pick another brand in Brief &amp; brand.</p>;
  }
  return (
    <BrandSession
      key={current.id}
      area={area}
      project={project}
      applyProject={setProject}
      refresh={refresh}
      name={name}
      brief={brief}
      design={design}
      brand={current}
      generation={generation}
      brands={brands}
      upsertBrand={upsertBrand}
      createBrand={createBrand}
      chooseBrand={chooseBrand}
      fonts={fonts}
      addFont={addFont}
      formats={formats}
    />
  );
}
