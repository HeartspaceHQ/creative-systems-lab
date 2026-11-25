import { useCallback } from "react";
import { go, projectHref } from "../route";
import { EditNotValid, useAutosave, type Autosaved } from "../studio/autosave";
import { studioApi } from "../studio/api";
import { normaliseHex } from "../studio/colour";
import { newDesign } from "../studio/defaults";
import type { Area, Brand, BrandDraft, Brief, Design, FontOption, Format, Project } from "../studio/types";
import { draftOf } from "../studio/wire";
import type { Generation } from "./generation";
import { WorkspaceContext, type WorkspaceValue } from "./context";
import { Shell } from "./Shell";

interface Props {
  readonly area: Area;
  readonly project: Project;
  readonly applyProject: (next: Project) => void;
  readonly refresh: () => Promise<Project>;
  readonly name: Autosaved<string>;
  readonly brief: Autosaved<Brief>;
  readonly design: Autosaved<Design | null>;
  readonly brand: Brand;
  readonly generation: Generation;
  readonly brands: readonly Brand[];
  readonly upsertBrand: (next: Brand) => void;
  readonly createBrand: (name: string) => Promise<Brand>;
  readonly chooseBrand: (id: string) => Promise<void>;
  readonly fonts: readonly FontOption[];
  readonly addFont: (file: File, family: string) => Promise<FontOption>;
  readonly formats: readonly Format[];
}

const validColours = (draft: BrandDraft): boolean =>
  Object.values(draft.colours).every((hex) => normaliseHex(hex) !== null) && draft.name.trim() !== "";

/** Keyed by brand id: a brand's draft is its own, and a switch to another brand starts a fresh one. */
export function BrandSession(props: Props) {
  const { area, project, brand, brief, design, upsertBrand } = props;
  const brandDraft = useAutosave<BrandDraft>({
    initial: draftOf(brand),
    save: async (value) => {
      upsertBrand({ ...(await studioApi.saveBrand(brand.id, value)), references: brand.references });
    },
    canSave: validColours,
  });

  const applyBrand = props.upsertBrand;
  const goTo = useCallback(
    (next: Area): void => {
      go(projectHref(project.id, next));
    },
    [project.id],
  );

  const { edit: editDesign, flush: flushDesign } = design;
  const designDraft = design.draft;
  const sender = brandDraft.draft.name;
  const placeInDesign = useCallback(
    async (assetId: string): Promise<void> => {
      editDesign({ ...(designDraft ?? newDesign(assetId, sender)), asset: assetId });
      try {
        await flushDesign();
      } catch (failure) {
        // A design just started has no headline yet, so it waits to be saved; the Design area says so.
        if (!(failure instanceof EditNotValid)) throw failure;
      }
      goTo("design");
    },
    [designDraft, editDesign, flushDesign, goTo, sender],
  );

  const value: WorkspaceValue = {
      project,
      applyProject: props.applyProject,
      refresh: props.refresh,
      name: props.name,
      brief,
      design,
      brandDraft,
      brand,
      generation: props.generation,
      applyBrand,
      brands: props.brands,
      createBrand: props.createBrand,
      chooseBrand: props.chooseBrand,
      fonts: props.fonts,
      addFont: props.addFont,
      formats: props.formats,
      placeInDesign,
      goTo,
  };

  return (
    <WorkspaceContext.Provider value={value}>
      <Shell area={area} />
    </WorkspaceContext.Provider>
  );
}
