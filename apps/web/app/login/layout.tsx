import { SiteFooter } from "../../components/SiteFooter";
import { SiteNav } from "../../components/SiteNav";
import { SonarGrid } from "../../components/SonarGrid";

export default function LoginLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-screen bg-canvas text-ink">
      <SiteNav />
      {/* Sonar field only on the login route — not global, not on other pages. */}
      <SonarGrid
        baseOpacity={0.14}
        interactive={false}
        className="flex min-h-[calc(100vh-8rem)] flex-col"
      >
        <main className="flex flex-1 flex-col">{children}</main>
      </SonarGrid>
      <SiteFooter />
    </div>
  );
}
