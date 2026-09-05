import type { Metadata } from "next";
import Link from "next/link";

import "./globals.css";

export const metadata: Metadata = {
  title: { default: "ApplyPilot", template: "%s | ApplyPilot" },
  description: "Local-first job matching and application preparation.",
};

const navigation = [
  ["Dashboard", "/dashboard"],
  ["Jobs", "/jobs"],
  ["Applications", "/applications"],
  ["Profile", "/profile"],
  ["Settings", "/settings"],
] as const;

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en-AU">
      <body>
        <div className="app-shell">
          <header className="topbar">
            <Link className="brand" href="/dashboard" aria-label="ApplyPilot dashboard">
              <span className="brand-mark" aria-hidden="true">
                A
              </span>
              <span>ApplyPilot</span>
              <small>Local foundation</small>
            </Link>
            <nav aria-label="Primary navigation">
              {navigation.map(([label, href]) => (
                <Link href={href} key={href}>
                  {label}
                </Link>
              ))}
            </nav>
          </header>
          <main>{children}</main>
          <footer>
            <span>Fixture mode · no live job-board connections</span>
            <span>Final submission always requires human confirmation</span>
          </footer>
        </div>
      </body>
    </html>
  );
}
