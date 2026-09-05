import Link from "next/link";

export default function HomePage() {
  return (
    <section className="landing">
      <div className="eyebrow">Phase 0/1 foundation</div>
      <h1>Move from job discovery to a careful, human-reviewed application.</h1>
      <p>
        ApplyPilot keeps candidate facts local, makes eligibility decisions explainable, and never
        invents experience. This build uses fictional fixtures only.
      </p>
      <div className="button-row">
        <Link className="button button--primary" href="/dashboard">
          Open dashboard
        </Link>
        <Link className="button button--secondary" href="/profile">
          Review truth store
        </Link>
      </div>
      <div className="guardrail">
        <strong>Human in the loop</strong>
        <span>No live scraping, automated submission, or browser-session storage is active.</span>
      </div>
    </section>
  );
}
