import { SiteFooter } from "../../components/SiteFooter";
import { SiteNav } from "../../components/SiteNav";

export default function LoginLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-screen bg-canvas text-ink">
      <SiteNav />
      <main className="flex flex-1 flex-col">{children}</main>
      <SiteFooter />
    </div>
  );
}
