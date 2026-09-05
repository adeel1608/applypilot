import type { Metadata } from "next";

import { ImportWorkspace } from "@web/components/job-import/import-workspace";

export const metadata: Metadata = { title: "Import jobs" };
export const dynamic = "force-dynamic";
export const revalidate = 0;

export default function ImportJobsPage() {
  return (
    <div className="page-stack">
      <section className="page-heading">
        <div className="eyebrow">Local real-world intake</div>
        <h1>Import jobs</h1>
        <p>
          Paste or upload job advertisements, review detected records, and confirm what is stored.
        </p>
      </section>
      <section className="safety-banner">
        <div>
          <span className="section-kicker">Local retention</span>
          <h2>Raw content stays on this computer.</h2>
        </div>
        <p>
          Accepted raw job content is retained in the local ignored database for provenance and
          reprocessing. Phase 2.5 has no automatic cleanup, export, delete, or purge control.
        </p>
      </section>
      <ImportWorkspace />
    </div>
  );
}
