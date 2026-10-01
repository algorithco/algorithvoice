// Single-page section model for the dashboard shell. No sub-routes exist,
// so the sidebar/header navigate to in-page anchors (shadcn sidebar
// structure, this project's own anchors).
export const SECTION_LINKS = [
  { id: "overview", href: "#overview", label: "Overview" },
  { id: "usage", href: "#usage", label: "Usage" },
  { id: "activity", href: "#activity", label: "Activity" },
  { id: "devices", href: "#devices", label: "Devices" },
  { id: "billing", href: "#billing", label: "Billing & account" },
] as const;

export type SectionId = (typeof SECTION_LINKS)[number]["id"];

export function sectionLabel(id: string): string {
  return SECTION_LINKS.find((l) => l.id === id)?.label ?? "Overview";
}
