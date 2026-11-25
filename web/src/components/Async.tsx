import type { ReactNode } from "react";
import type { Resource } from "../hooks";

export function Async<T>(props: { resource: Resource<T>; children: (value: T) => ReactNode }) {
  const { resource, children } = props;
  if (resource.state === "loading") {
    return <p role="status">Loading…</p>;
  }
  if (resource.state === "error") {
    return (
      <p role="alert" className="error">
        {resource.message}
      </p>
    );
  }
  return <>{children(resource.value)}</>;
}
