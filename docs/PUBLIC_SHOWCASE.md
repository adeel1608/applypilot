# Public showcase boundary

## Purpose

`apps/showcase` is ApplyPilot's public, recruiter-friendly product demonstration. It communicates the local-first workflow, evidence model, application-packet boundary, safety architecture, and inspected technology stack without importing or reproducing the private local application.

Every company, role, candidate fact, score, metric, source reference, packet, and decision in this surface is invented for demonstration. It is not a sanitised snapshot of personal or runtime data.

## Deployable surface

The showcase uses Next.js static export. Its only deployable directory is:

```text
apps/showcase/out
```

The export contains four product routes:

- `/`
- `/demo/`
- `/demo/evidence/`
- `/demo/application-packet/`

The local owner dashboard under `apps/web`, repository root, `data/`, generated artifacts, databases, browser state, and environment files are not deployment inputs.

## Enforced exclusions

The showcase audit fails on:

- private-application or domain-package imports;
- database, environment, filesystem, server-action, request-state, or server-route access;
- browser network primitives;
- private profile/runtime path references;
- dependencies beyond Next.js and React;
- missing static-export configuration or missing expected HTML routes;
- unexpected local/private product routes in the export;
- selected private-profile canaries in emitted assets.

Run the boundary check after every production build:

```bash
npm run build:showcase
npm run showcase:audit
```

The repository-wide privacy audit remains mandatory because this focused guard does not replace history, ignore-policy, credential-pattern, CI-artifact, or private-artifact checks.

## Visual verification

Browser tests cover desktop navigation, fictional-data labelling, filtering, sorting, role selection, evidence inspection, packet controls, keyboard focus, mobile overflow, browser errors, and core information with JavaScript disabled.

Reproduce committed screenshots against a trusted local build with:

```bash
npx tsx scripts/capture-showcase-assets.ts http://127.0.0.1:3200
```

The script writes only the four public pages to `docs/assets`. Inspect each image before commit. Never capture the local application, private profile, real vacancy, generated personal document, packet, or browser session for public use.

## Deployment rule

A static host may receive only a freshly built and audited `apps/showcase/out` from an exact reviewed commit. No repository secret, token, database, source capability, target capability, private URL, or candidate data is required. A showcase deployment grants no live-source, employer-form, upload, or submission authority.
