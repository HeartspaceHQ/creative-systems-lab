import { HomePage } from "./home/HomePage";
import { BlindPage } from "./pages/BlindPage";
import { RunPage } from "./pages/RunPage";
import { RunsPage } from "./pages/RunsPage";
import { useRoute } from "./route";
import { ProjectPage } from "./workspace/ProjectPage";

export function App() {
  const route = useRoute();
  const wide = route.page === "run" || route.page === "project";
  return (
    <>
      <a className="skip" href="#main">
        Skip to content
      </a>
      <header className="top">
        <a className="brand" href="#/">
          Creative Systems Lab
        </a>
        <span className="brand-sub">Studio</span>
        <nav className="top-nav" aria-label="Main">
          <a href="#/" aria-current={route.page === "home" || route.page === "project" ? "page" : undefined}>
            Projects
          </a>
          <a href="#/runs" aria-current={route.page === "runs" || route.page === "run" ? "page" : undefined}>
            All runs
          </a>
        </nav>
      </header>
      <main id="main" tabIndex={-1} className={wide ? "main-wide" : undefined}>
        {route.page === "home" && <HomePage />}
        {route.page === "runs" && <RunsPage />}
        {route.page === "run" && <RunPage key={route.id} id={route.id} />}
        {route.page === "blind" && <BlindPage key={route.set} set={route.set} />}
        {route.page === "project" && <ProjectPage key={route.id} id={route.id} area={route.area} />}
      </main>
    </>
  );
}
