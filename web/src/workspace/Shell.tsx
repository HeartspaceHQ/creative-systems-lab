import { projectHref } from "../route";
import { BriefArea } from "../areas/BriefArea";
import { DeliverArea } from "../areas/DeliverArea";
import { DesignArea } from "../areas/DesignArea";
import { ImagesArea } from "../areas/ImagesArea";
import type { Area } from "../studio/types";
import { useWorkspace } from "./context";
import { SaveIndicator } from "./SaveIndicator";
import { nextStep, summaries } from "./summary";

function AreaView({ area }: { area: Area }) {
  if (area === "brief") return <BriefArea />;
  if (area === "images") return <ImagesArea />;
  if (area === "design") return <DesignArea />;
  return <DeliverArea />;
}

/** The project's frame: its name, the four areas (always reachable) and whichever area is open. */
export function Shell({ area }: { area: Area }) {
  const { project, name, brief, design, brandDraft, generation } = useWorkspace();
  const inputs = { project, brief: brief.draft, design: design.draft, brandName: brandDraft.draft.name, generating: generation.running };
  const next = nextStep(inputs);
  return (
    <div className="project">
      <header className="project-head">
        <a className="back" href="#/">
          Projects
        </a>
        <h1>{name.draft.trim() === "" ? "Untitled project" : name.draft}</h1>
        <SaveIndicator />
      </header>
      <div className="areas-bar">
        <nav className="areas" aria-label="Project areas">
          {summaries(inputs).map((item) => (
            <a
              key={item.area}
              className="area-tab"
              href={projectHref(project.id, item.area)}
              aria-current={item.area === area ? "page" : undefined}
            >
              <span className="area-title">{item.title}</span>
              <span className="area-state">{item.state}</span>
            </a>
          ))}
        </nav>
        {next !== null && next.area !== area && (
          <a className="next-step" href={projectHref(project.id, next.area)}>
            <span className="next-label">Next</span> {next.text}
          </a>
        )}
      </div>
      <div className={`area area-${area}`} id="area">
        <AreaView area={area} />
      </div>
    </div>
  );
}
