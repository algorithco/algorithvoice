import { SiteFooter } from "../../components/SiteFooter";
import { SiteNav } from "../../components/SiteNav";

export default function RegisterLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-screen bg-canvas text-ink">
      <SiteNav />
      <main>{children}</main>
      <SiteFooter />
    </div>
  );
}
