import { createContext, useContext } from "react";
import type { Autosaved } from "../studio/autosave";
import type { Generation } from "./generation";
import type { Area, Brand, BrandDraft, Brief, Design, FontOption, Format, Project } from "../studio/types";

export interface WorkspaceValue {
  readonly project: Project;
  /** Replace the server's view of the project (after an import, a decision, a delivery). */
  readonly applyProject: (next: Project) => void;
  readonly refresh: () => Promise<Project>;
  readonly name: Autosaved<string>;
  readonly brief: Autosaved<Brief>;
  readonly design: Autosaved<Design | null>;
  readonly brandDraft: Autosaved<BrandDraft>;
  /** The saved brand, with its visual references. */
  readonly brand: Brand;
  readonly applyBrand: (next: Brand) => void;
  readonly brands: readonly Brand[];
  readonly createBrand: (name: string) => Promise<Brand>;
  readonly chooseBrand: (id: string) => Promise<void>;
  readonly fonts: readonly FontOption[];
  /** Upload a font file under a family name; it is offered at once in every brand. */
  readonly addFont: (file: File, family: string) => Promise<FontOption>;
  readonly formats: readonly Format[];
  /** Put an approved image into the design (starting one if needed) and open the Design area. */
  readonly placeInDesign: (assetId: string) => Promise<void>;
  readonly generation: Generation;
  readonly goTo: (area: Area) => void;
}

export const WorkspaceContext = createContext<WorkspaceValue | null>(null);

export function useWorkspace(): WorkspaceValue {
  const value = useContext(WorkspaceContext);
  if (value === null) throw new Error("useWorkspace must be used inside a project");
  return value;
}
