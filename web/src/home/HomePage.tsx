import { useCallback, useState } from "react";
import { Async } from "../components/Async";
import { since } from "../format";
import { useResource } from "../hooks";
import { projectHref } from "../route";
import { studioApi } from "../studio/api";
import type { Brand, ProjectSummary } from "../studio/types";
import { NewProject } from "./NewProject";

function ProjectCard({ project, brandName }: { project: ProjectSummary; brandName: string }) {
  return (
    <li className="project-card">
      <a href={projectHref(project.id, "brief")}>
        <span className="project-cover">
          {project.coverUrl === null ? (
            <span className="project-cover-empty">No images yet</span>
          ) : (
            <img src={project.coverUrl} alt="" loading="lazy" />
          )}
        </span>
        <span className="project-name">{project.name}</span>
        <span className="run-facts">
          <span>{brandName}</span>
          <span>Changed {since(project.updatedAt) || "recently"}</span>
        </span>
      </a>
    </li>
  );
}

function Projects(props: { projects: readonly ProjectSummary[]; brands: readonly Brand[]; fonts: readonly string[] }) {
  const { projects, brands, fonts } = props;
  const [creating, setCreating] = useState(projects.length === 0);
  const nameOf = (id: string): string => brands.find((b) => b.id === id)?.name ?? "Unknown brand";
  return (
    <>
      <header className="page-head home-head">
        <div>
          <h1>Projects</h1>
          <p>Each project takes one post from brief to finished files. Open one to carry on where you left off.</p>
        </div>
        <div className="home-actions">
          {!creating && (
            <button
              type="button"
              className="primary"
              onClick={() => {
                setCreating(true);
              }}
            >
              New project
            </button>
          )}
        </div>
      </header>
      {creating && (
        <NewProject
          brands={brands}
          fonts={fonts}
          onCancel={
            projects.length === 0
              ? null
              : () => {
                  setCreating(false);
                }
          }
        />
      )}
      {projects.length > 0 && (
        <ul className="run-grid project-grid">
          {projects.map((project) => (
            <ProjectCard key={project.id} project={project} brandName={nameOf(project.brand)} />
          ))}
        </ul>
      )}
    </>
  );
}

export function HomePage() {
  const load = useCallback(async () => {
    const [projects, brands, fonts] = await Promise.all([studioApi.projects(), studioApi.brands(), studioApi.fonts()]);
    return { projects, brands, fonts: fonts.map((f) => f.family) };
  }, []);
  const { resource } = useResource(load);
  return <Async resource={resource}>{(data) => <Projects {...data} />}</Async>;
}
