import { BrandPanel } from "./brief/BrandPanel";
import { BriefPanel } from "./brief/BriefPanel";

export function BriefArea() {
  return (
    <div className="two-col">
      <BriefPanel />
      <BrandPanel />
    </div>
  );
}
