import type { Metadata } from "next";

import { DemoWorkspace } from "@showcase/components/demo-workspace";
import { demoMetrics } from "@showcase/lib/demo-data";

export const metadata: Metadata = { title: "Fictional opportunity dashboard" };

export default function DemoPage() {
  return (
    <div className="page-shell">
      <section className="page-heading page-heading--dashboard">
        <div>
          <p className="demo-flag">
            <span aria-hidden="true" /> Public demo — fictional data
          </p>
          <p className="mono-label">Opportunity intelligence / local-first model</p>
          <h1>
            Review the evidence.
            <br />
            <em>Then decide.</em>
          </h1>
        </div>
        <p>
          This dashboard is a static demonstration. Filters and selections stay in this browser tab;
          no data is sent or stored.
        </p>
      </section>
      <section
        className="metric-strip metric-strip--dashboard"
        aria-label="Fictional dashboard metrics"
      >
        {demoMetrics.map((metric) => (
          <div key={metric.label}>
            <span>{metric.label}</span>
            <strong>{metric.value}</strong>
            <small>{metric.detail}</small>
          </div>
        ))}
      </section>
      <DemoWorkspace />
    </div>
  );
}
