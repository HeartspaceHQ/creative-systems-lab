/** What each area says about itself on the tab, and the next thing worth doing. */
import { plural, since } from "../format";
import type { Area, Brief, Design, Project } from "../studio/types";

export interface AreaSummary {
  readonly area: Area;
  readonly title: string;
  readonly state: string;
}

export interface NextStep {
  readonly area: Area;
  readonly text: string;
}

interface Inputs {
  readonly project: Project;
  readonly brief: Brief;
  readonly design: Design | null;
  readonly brandName: string;
  readonly generating: boolean;
}

const approvedCount = (project: Project): number => project.assets.filter((a) => a.status === "approved").length;
const pendingCount = (project: Project): number => project.assets.filter((a) => a.status === "pending").length;

function imagesState(project: Project, generating: boolean): string {
  if (generating) return "Generating…";
  const approved = approvedCount(project);
  const pending = pendingCount(project);
  if (approved > 0 && pending > 0) return `${plural(approved, "approved image", "approved images")}, ${String(pending)} to review`;
  if (approved > 0) return plural(approved, "approved image", "approved images");
  if (pending > 0) return `${String(pending)} to review`;
  return project.runs.length > 0 ? "Generated images to review" : "No images yet";
}

function designState(inputs: Inputs): string {
  const { design, project } = inputs;
  if (design === null || !project.assets.some((a) => a.id === design.asset && a.status === "approved")) {
    return "No image chosen yet";
  }
  return design.layout === "editorial" ? "Editorial layout" : "Cinematic layout";
}

function deliverState(project: Project): string {
  const last = project.deliveries.find((d) => d.state === "done");
  return last === undefined ? "Not delivered yet" : `Delivered ${since(last.createdAt)}`;
}

export function summaries(inputs: Inputs): readonly AreaSummary[] {
  const { project, brief, brandName } = inputs;
  return [
    {
      area: "brief",
      title: "Brief & brand",
      state: brief.subject.trim() === "" ? "Describe the image" : brandName,
    },
    { area: "images", title: "Images", state: imagesState(project, inputs.generating) },
    { area: "design", title: "Design", state: designState(inputs) },
    { area: "deliver", title: "Deliver", state: deliverState(project) },
  ];
}

export function nextStep(inputs: Inputs): NextStep | null {
  const { project, brief } = inputs;
  if (brief.subject.trim() === "" && project.assets.length === 0) return { area: "brief", text: "Describe the image you need" };
  if (approvedCount(project) === 0) {
    return { area: "images", text: pendingCount(project) > 0 ? "Review your images" : "Add images" };
  }
  if (designState(inputs) === "No image chosen yet") return { area: "design", text: "Design the post" };
  if (!project.deliveries.some((d) => d.state === "done")) return { area: "deliver", text: "Create the files" };
  return null;
}
