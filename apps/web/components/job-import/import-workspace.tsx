"use client";

import { useActionState, useState } from "react";

import {
  confirmImportAction,
  prepareImportAction,
  type ImportActionState,
} from "@web/app/import/actions";

const initialImportActionState: ImportActionState = { status: "IDLE" };

const sources = [
  ["", "Auto-detect"],
  ["SEEK", "SEEK"],
  ["INDEED", "Indeed"],
  ["EMPLOYMENT_HERO", "Employment Hero"],
  ["GREENHOUSE", "Greenhouse"],
  ["LEVER", "Lever"],
  ["WORKDAY", "Workday"],
  ["GENERIC_COMPANY_SITE", "Generic employer site"],
  ["UNKNOWN", "Unknown"],
] as const;

export function ImportWorkspace() {
  const [mode, setMode] = useState("PASTED_SINGLE");
  const [prepareState, prepareAction, preparePending] = useActionState(
    prepareImportAction,
    initialImportActionState,
  );
  const [confirmState, confirmAction, confirmPending] = useActionState(
    confirmImportAction,
    initialImportActionState,
  );

  return (
    <div className="page-stack">
      <form action={prepareAction} className="panel import-form">
        <div className="form-grid">
          <label>
            Import method
            <select name="inputType" value={mode} onChange={(event) => setMode(event.target.value)}>
              <option value="PASTED_SINGLE">Paste one job</option>
              <option value="PASTED_MULTI">Paste multiple/search results</option>
              <option value="PASTED_HTML">Paste HTML</option>
              <option value="FILE_UPLOAD">Upload a file</option>
              <option value="URL">Job URL</option>
            </select>
          </label>
          {mode !== "URL" && (
            <label>
              Source hint
              <select name="sourceHint" defaultValue="">
                {sources.map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
          )}
        </div>
        {mode === "FILE_UPLOAD" ? (
          <label>
            Job file
            <input
              name="file"
              type="file"
              accept=".txt,.md,.html,.htm,.json,text/plain,text/markdown,text/html,application/json"
              required
            />
            <small>UTF-8 .txt, .md, .html, .htm, or .json · maximum 1 MiB</small>
          </label>
        ) : mode === "URL" ? (
          <label>
            Job URL
            <input name="url" type="url" maxLength={2048} placeholder="https://…" required />
          </label>
        ) : (
          <label>
            Job content
            <textarea
              name="content"
              rows={14}
              placeholder="Title: Fictional Service Assistant&#10;Company: Example Harbour Co&#10;Location: Sydney NSW&#10;Description: …"
              required
            />
          </label>
        )}
        <button className="button button--primary" type="submit" disabled={preparePending}>
          {preparePending
            ? "Preparing…"
            : mode === "URL"
              ? "Check URL policy"
              : "Preview detected jobs"}
        </button>
        {prepareState.message && (
          <p
            className={
              prepareState.status === "ERROR" ? "form-message form-message--error" : "form-message"
            }
            role="status"
          >
            {prepareState.message}
          </p>
        )}
        {prepareState.urlPolicy && (
          <dl className="fact-list compact-facts">
            <div>
              <dt>Decision</dt>
              <dd>{prepareState.urlPolicy.decision.replaceAll("_", " ")}</dd>
            </div>
            <div>
              <dt>Detected source</dt>
              <dd>{prepareState.urlPolicy.detectedSource.replaceAll("_", " ")}</dd>
            </div>
          </dl>
        )}
      </form>

      {prepareState.preview && (
        <form action={confirmAction} className="page-stack" aria-label="Import preview">
          <input type="hidden" name="importId" value={prepareState.preview.importId} />
          <input type="hidden" name="previewToken" value={prepareState.preview.previewToken} />
          <section className="panel">
            <div className="panel-heading">
              <div>
                <span className="section-kicker">Import preview</span>
                <h2>{prepareState.preview.records.length} detected jobs</h2>
              </div>
              <span className="source-pill">Explicit confirmation required</span>
            </div>
            <p>
              Detected origin: {prepareState.preview.detectedSource.replaceAll("_", " ")} ·
              Acquisition: {prepareState.preview.acquisitionMethod.replaceAll("_", " ")}
            </p>
            <div className="selection-row">
              <button
                className="button button--quiet"
                type="button"
                onClick={(event) => {
                  event.currentTarget.form
                    ?.querySelectorAll<HTMLInputElement>('input[data-import-selection="true"]')
                    .forEach((checkbox) => {
                      checkbox.checked = checkbox.dataset.confident === "true";
                    });
                }}
              >
                Select confident
              </button>
              <button
                className="button button--quiet"
                type="button"
                onClick={(event) => {
                  event.currentTarget.form
                    ?.querySelectorAll<HTMLInputElement>(
                      'input[data-import-selection="true"]:checked',
                    )
                    .forEach((checkbox) => {
                      checkbox.checked = false;
                    });
                }}
              >
                Skip checked
              </button>
            </div>
          </section>
          {prepareState.preview.records.map((record) => (
            <article className="panel import-record" key={record.recordId}>
              <input type="hidden" name="recordId" value={record.recordId} />
              <div className="panel-heading">
                <div>
                  <span className="section-kicker">Detected job {record.ordinal}</span>
                  <h2>{record.title || "Title required"}</h2>
                </div>
                <span className="source-pill">{record.splitStatus.replaceAll("_", " ")}</span>
              </div>
              <div className="source-summary-grid">
                <div>
                  <span>Detected source</span>
                  <strong>{record.detectedSource.replaceAll("_", " ")}</strong>
                </div>
                <div>
                  <span>Acquisition method</span>
                  <strong>{record.acquisitionMethod.replaceAll("_", " ")}</strong>
                </div>
                <div>
                  <span>Source confidence</span>
                  <strong>{record.sourceConfidence}</strong>
                </div>
                <div>
                  <span>Duplicate status</span>
                  <strong>{record.duplicateDecision.replaceAll("_", " ")}</strong>
                </div>
              </div>
              <div className="form-grid">
                <label>
                  Title
                  <input name={`title:${record.recordId}`} defaultValue={record.title} required />
                  <small>Extracted: {record.title || "Missing"}</small>
                </label>
                <label>
                  Company
                  <input
                    name={`company:${record.recordId}`}
                    defaultValue={record.company}
                    required
                  />
                  <small>Extracted: {record.company || "Missing"}</small>
                </label>
                <label>
                  Location
                  <input
                    name={`location:${record.recordId}`}
                    defaultValue={record.location}
                    required
                  />
                  <small>Extracted: {record.location || "Missing"}</small>
                </label>
                <label>
                  Category
                  <input name={`category:${record.recordId}`} defaultValue={record.category} />
                </label>
                <label>
                  External ID
                  <input name={`externalId:${record.recordId}`} defaultValue={record.externalId} />
                </label>
                <label>
                  Source URL
                  <input
                    name={`sourceUrl:${record.recordId}`}
                    type="url"
                    defaultValue={record.sourceUrl}
                  />
                </label>
              </div>
              <p className="import-excerpt">{record.excerpt}</p>
              <label>
                Replacement description (optional)
                <textarea
                  name={`description:${record.recordId}`}
                  rows={5}
                  placeholder="Leave empty to retain the extracted description."
                />
              </label>
              {record.warnings.length > 0 && (
                <ul className="reason-list">
                  {record.warnings.map((warning) => (
                    <li
                      className="reason reason--warning"
                      key={`${warning.code}-${warning.field ?? "record"}`}
                    >
                      <strong>{warning.code.replaceAll("_", " ")}</strong>
                      <span>{warning.message}</span>
                    </li>
                  ))}
                </ul>
              )}
              <div className="selection-row">
                <label>
                  <input
                    type="checkbox"
                    name={`selected:${record.recordId}`}
                    defaultChecked={record.splitStatus === "CONFIDENT"}
                    data-import-selection="true"
                    data-confident={record.splitStatus === "CONFIDENT"}
                  />{" "}
                  Import this job
                </label>
                <button
                  className="button button--quiet"
                  type="button"
                  onClick={(event) => {
                    const checkbox = event.currentTarget.form?.elements.namedItem(
                      `selected:${record.recordId}`,
                    );
                    if (checkbox instanceof HTMLInputElement) checkbox.checked = false;
                  }}
                >
                  Skip
                </button>
                {record.splitStatus === "REVIEW_REQUIRED" && (
                  <label>
                    <input type="checkbox" name={`acknowledge:${record.recordId}`} /> I reviewed the
                    inferred boundary and warnings
                  </label>
                )}
                {record.duplicateDecision === "UPDATE_REVIEW_REQUIRED" && (
                  <label>
                    <input type="checkbox" name={`allowUpdate:${record.recordId}`} /> Confirm
                    updating the existing job
                  </label>
                )}
              </div>
            </article>
          ))}
          <section className="action-bar">
            <div>
              <strong>Confirm selected records</strong>
              <span>This persists jobs locally; it does not apply or submit.</span>
            </div>
            <button className="button button--primary" type="submit" disabled={confirmPending}>
              {confirmPending ? "Confirming…" : "Import selected"}
            </button>
          </section>
        </form>
      )}
      {confirmState.message && (
        <section
          className={confirmState.status === "ERROR" ? "panel form-message--error" : "panel"}
          role="status"
        >
          <h2>
            {confirmState.status === "CONFIRMED" ? "Import complete" : "Import not completed"}
          </h2>
          <p>{confirmState.message}</p>
          {confirmState.result && (
            <p>
              Imported {confirmState.result.imported} · Updated {confirmState.result.updated} ·
              Duplicates {confirmState.result.duplicates} · Skipped {confirmState.result.skipped}
            </p>
          )}
        </section>
      )}
    </div>
  );
}
