"use client";

import Link from "next/link";
import { useMemo, useState } from "react";

import { demoJobs, pipelineStages, type DemoJob } from "@showcase/lib/demo-data";

type Filter = "ALL" | "RECOMMENDED" | "REVIEW_REQUIRED" | "PREPARING";
type Sort = "FIT_DESC" | "FIT_ASC" | "TITLE";

const stateLabel = (value: string) => value.replaceAll("_", " ");

function matchesFilter(job: DemoJob, filter: Filter) {
  if (filter === "ALL") return true;
  if (filter === "RECOMMENDED") return job.recommendation === "RECOMMENDED";
  if (filter === "REVIEW_REQUIRED") return job.eligibility === "REVIEW_REQUIRED";
  return job.queueState === "PREPARING";
}

export function DemoWorkspace() {
  const [filter, setFilter] = useState<Filter>("ALL");
  const [sort, setSort] = useState<Sort>("FIT_DESC");
  const [selectedId, setSelectedId] = useState<string>(demoJobs[0].id);
  const [stage, setStage] = useState<(typeof pipelineStages)[number]["id"]>("evaluate");

  const visibleJobs = useMemo(() => {
    const jobs = demoJobs.filter((job) => matchesFilter(job, filter));
    return [...jobs].sort((left, right) => {
      if (sort === "TITLE") return left.title.localeCompare(right.title);
      return sort === "FIT_ASC" ? left.fitScore - right.fitScore : right.fitScore - left.fitScore;
    });
  }, [filter, sort]);
  const selected = visibleJobs.find(({ id }) => id === selectedId) ?? visibleJobs[0] ?? demoJobs[0];
  const selectedStage = pipelineStages.find(({ id }) => id === stage)!;

  return (
    <div className="demo-layout">
      <section className="demo-list-panel" aria-labelledby="opportunities-heading">
        <div className="panel-heading">
          <div>
            <p className="mono-label">Opportunity queue / 08 records</p>
            <h2 id="opportunities-heading">Fictional roles</h2>
          </div>
          <span className="live-marker">
            <i /> static demo
          </span>
        </div>

        <div className="demo-controls">
          <label>
            Filter
            <select value={filter} onChange={(event) => setFilter(event.target.value as Filter)}>
              <option value="ALL">All roles</option>
              <option value="RECOMMENDED">Recommended</option>
              <option value="REVIEW_REQUIRED">Review required</option>
              <option value="PREPARING">Packet preparing</option>
            </select>
          </label>
          <label>
            Sort
            <select value={sort} onChange={(event) => setSort(event.target.value as Sort)}>
              <option value="FIT_DESC">Fit · high to low</option>
              <option value="FIT_ASC">Fit · low to high</option>
              <option value="TITLE">Role · A to Z</option>
            </select>
          </label>
        </div>

        <div className="demo-job-list" aria-live="polite">
          {visibleJobs.map((job) => (
            <button
              className="demo-job"
              data-selected={job.id === selected.id}
              key={job.id}
              onClick={() => setSelectedId(job.id)}
              type="button"
            >
              <span className="demo-job__score">{job.fitScore}</span>
              <span className="demo-job__identity">
                <strong>{job.title}</strong>
                <span>
                  {job.company} · {job.location}
                </span>
              </span>
              <span
                className={`state state--${job.eligibility === "ELIGIBLE" ? "match" : "review"}`}
              >
                {job.eligibility === "ELIGIBLE" ? "Eligible" : "Review"}
              </span>
            </button>
          ))}
          {visibleJobs.length === 0 ? (
            <p className="empty-copy">No roles match this view.</p>
          ) : null}
        </div>
      </section>

      <section className="demo-detail-panel" aria-labelledby="selected-role-heading">
        <div className="detail-signal">
          <span>FIT / 100</span>
          <strong>{selected.fitScore}</strong>
          <i style={{ "--score": `${selected.fitScore}%` } as React.CSSProperties} />
        </div>
        <p className="mono-label">Selected opportunity</p>
        <h2 id="selected-role-heading">{selected.title}</h2>
        <p className="role-meta">
          {selected.company} · {selected.location} · {selected.workMode}
        </p>
        <p className="role-summary">{selected.summary}</p>

        <dl className="decision-grid">
          <div>
            <dt>Evidence coverage</dt>
            <dd>{selected.evidenceCoverage}%</dd>
          </div>
          <div>
            <dt>Eligibility</dt>
            <dd>{stateLabel(selected.eligibility)}</dd>
          </div>
          <div>
            <dt>Recommendation</dt>
            <dd>{stateLabel(selected.recommendation)}</dd>
          </div>
          <div>
            <dt>Queue</dt>
            <dd>{stateLabel(selected.queueState)}</dd>
          </div>
        </dl>

        <div className="evidence-stack">
          <div className="panel-heading panel-heading--small">
            <h3>Evidence ledger</h3>
            <span>{selected.evidence.length} requirement links</span>
          </div>
          {selected.evidence.map((item) => (
            <article className="evidence-row" key={item.requirement}>
              <span className={`state state--${item.state === "MATCH" ? "match" : "review"}`}>
                {stateLabel(item.state)}
              </span>
              <div>
                <strong>{item.requirement}</strong>
                <p>{item.evidence}</p>
                <small>{item.source}</small>
              </div>
            </article>
          ))}
        </div>

        <div className="stage-console">
          <div className="stage-tabs" aria-label="Pipeline stage" role="group">
            {pipelineStages.map((item) => (
              <button
                aria-pressed={stage === item.id}
                key={item.id}
                onClick={() => setStage(item.id)}
                type="button"
              >
                {item.label}
              </button>
            ))}
          </div>
          <p aria-live="polite">
            <strong>{selectedStage.label}:</strong> {selectedStage.detail}
          </p>
        </div>

        <div className="detail-actions">
          <Link className="button button--primary" href="/demo/evidence">
            Inspect evidence model
          </Link>
          <Link className="button button--secondary" href="/demo/application-packet">
            View packet
          </Link>
        </div>
      </section>
    </div>
  );
}
