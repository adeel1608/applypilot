import Link from "next/link";

export default function NotFoundPage() {
  return (
    <section className="landing">
      <div className="eyebrow">Not found</div>
      <h1>This job is not in the local fixture set.</h1>
      <p>No external source was contacted.</p>
      <Link className="button button--primary" href="/jobs">
        Return to jobs
      </Link>
    </section>
  );
}
