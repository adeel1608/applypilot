import type { Metadata } from "next";

import { SiteHeader } from "@showcase/components/site-header";

import "./globals.css";

const description =
  "A fictional public demonstration of ApplyPilot, a local-first AI job discovery and application assistant with evidence-based matching and human-controlled external actions.";

export const metadata: Metadata = {
  metadataBase: new URL("https://applypilot.qss-ai-robot-7121.chatgpt.site"),
  title: { default: "ApplyPilot — Find better jobs. Prove the fit.", template: "%s · ApplyPilot" },
  description,
  applicationName: "ApplyPilot",
  keywords: ["local-first", "job search", "evidence-based matching", "human in the loop"],
  openGraph: {
    title: "ApplyPilot — Local-first AI job application assistant",
    description,
    type: "website",
    images: [
      "https://raw.githubusercontent.com/adeel1608/applypilot/main/docs/assets/applypilot-social-preview.png",
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "ApplyPilot — Local-first AI job application assistant",
    description,
    images: [
      "https://raw.githubusercontent.com/adeel1608/applypilot/main/docs/assets/applypilot-social-preview.png",
    ],
  },
  alternates: { canonical: "/" },
};

export default function ShowcaseLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en-AU">
      <body>
        <a className="skip-link" href="#main-content">
          Skip to content
        </a>
        <div className="site-frame">
          <SiteHeader />
          <main id="main-content">{children}</main>
          <footer className="site-footer">
            <div>
              <strong>ApplyPilot</strong>
              <span>Public showcase · fictional data only</span>
            </div>
            <p>
              Private candidate data and external actions remain in the owner-controlled local
              workspace.
            </p>
            <a href="https://github.com/adeel1608/applypilot">View source on GitHub</a>
          </footer>
        </div>
      </body>
    </html>
  );
}
