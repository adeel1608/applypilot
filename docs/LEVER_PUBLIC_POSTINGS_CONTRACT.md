# Lever public Postings API contract boundary

Last audited: 2026-09-12

ApplyPilot's Lever reader is aligned only to the current official public [Lever Postings API
documentation](https://github.com/lever/postings-api). This document does not use, quote, reconstruct,
or infer any private response.

## Rule classes

- **A - Lever contract:** an explicitly documented public JSON type, shape, format, or enum.
- **B - product semantic:** an ApplyPilot requirement applied after provider structure is valid.
- **C - resource/security:** a local safety bound independent of Lever's per-field contract.
- **D - undocumented assumption:** a former rejection rule not supported by the public contract. All
  D rules identified in this audit were removed from response parsing.

## Current field matrix

| JSON field                | Official public contract                        | ApplyPilot boundary and use                                                                                                                                     | Class |
| ------------------------- | ----------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----- |
| posting response          | JSON array of posting objects                   | Array shape is validated; the approved capability/page budget separately caps persisted records                                                                 | A/C   |
| `id`                      | String unique posting ID                        | Any string is accepted structurally; empty/whitespace-only identity stops as locally unusable                                                                   | A/B   |
| `text`                    | String posting name                             | Any string is accepted structurally, converted to inert text, and must then be usable as a local title                                                          | A/B/C |
| `categories`              | Object containing posting categories            | Object shape is checked when present; unknown extensions remain raw provenance only                                                                             | A     |
| `categories.location`     | String                                          | Optional compatible string; inert text when mapped                                                                                                              | A/C   |
| `categories.commitment`   | String                                          | Optional compatible string; inert text when mapped                                                                                                              | A/C   |
| `categories.team`         | String                                          | Optional compatible string; inert text when mapped                                                                                                              | A/C   |
| `categories.department`   | String                                          | Optional compatible string; inert text when mapped                                                                                                              | A/C   |
| `categories.level`        | Official category dimension/filter              | Optional string is modeled but is not promoted into eligibility or scoring                                                                                      | A/B   |
| `categories.allLocations` | Array of strings                                | Array/member types are checked with no undocumented element limit; values become inert text                                                                     | A/C   |
| `country`                 | ISO 3166-1 alpha-2 string or `null`             | Two-letter string format or null; absence remains compatibility-normalized to internal null                                                                     | A     |
| `opening`                 | Styled HTML string                              | Optional string is typed and retained only in immutable raw provenance                                                                                          | A/B   |
| `openingPlain`            | Plain-text string                               | Optional string is typed and retained only in immutable raw provenance                                                                                          | A/B   |
| `description`             | Combined styled HTML string                     | Optional string; preferred only when plain combined description is absent, then converted to inert text                                                         | A/C   |
| `descriptionPlain`        | Combined plain-text string                      | Optional-compatible string with empty default; converted to inert text                                                                                          | A/C   |
| `descriptionBody`         | Styled HTML body string                         | Optional string is typed and retained only in immutable raw provenance                                                                                          | A/B   |
| `descriptionBodyPlain`    | Plain-text body string                          | Optional string is typed and retained only in immutable raw provenance                                                                                          | A/B   |
| `lists`                   | Array of list objects                           | Array shape is checked with no undocumented element limit; absence is accepted as empty                                                                         | A     |
| `lists[].text`            | String list name                                | Required when a list item exists; converted to inert section heading                                                                                            | A/C   |
| `lists[].content`         | String unstyled HTML content                    | Required when a list item exists; converted to inert section text and never rendered                                                                            | A/C   |
| `additional`              | Optional styled HTML string; may be empty       | String when present; used only as inert closing text when plain text is absent                                                                                  | A/C   |
| `additionalPlain`         | Optional plain-text string; may be empty        | String when present; converted to inert closing text                                                                                                            | A/C   |
| `hostedUrl`               | URL string                                      | Required URL validation; the value remains inert and is never visited by discovery                                                                              | A/C   |
| `applyUrl`                | URL string                                      | Required URL validation; the value remains inert and grants no employer interaction authority                                                                   | A/C   |
| `workplaceType`           | `on-site`, `remote`, `hybrid`, or `unspecified` | Official values retain exact semantics; absence is unknown; null or an undocumented string is non-critical drift normalized to unknown; other types fail closed | A/B   |
| `salaryRange`             | Optional object                                 | Object shape is checked when present; unknown extensions remain raw provenance only                                                                             | A     |
| `salaryRange.currency`    | String                                          | String when present, with no undocumented character limit; converted to inert text                                                                              | A/C   |
| `salaryRange.interval`    | String                                          | String when present, with no undocumented character limit; converted to inert text                                                                              | A/C   |
| `salaryRange.min`         | Number                                          | Number when present; no undocumented non-negative constraint                                                                                                    | A     |
| `salaryRange.max`         | Number                                          | Number when present; no undocumented non-negative constraint                                                                                                    | A     |
| `salaryDescription`       | Optional styled HTML string                     | String when present; retained only in immutable raw provenance                                                                                                  | A/B   |
| `salaryDescriptionPlain`  | Optional plain-text string                      | String when present; retained only in immutable raw provenance                                                                                                  | A/B   |
| unknown extension         | Not part of the named contract                  | Accepted through object passthrough, bounded by the whole response, deeply frozen in raw provenance, and never promoted to evidence                             | B/C   |

## Removed undocumented rejection assumptions

| Former rule                                                    | Audit result                                                                                                      | Class                      |
| -------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- | -------------------------- |
| job ID matched `[A-Za-z0-9_-]` and was at most 100 characters  | Lever documents an opaque string ID, not this syntax or length                                                    | D - removed                |
| title was non-empty and at most 1,000 characters in Zod        | String type is provider structure; usability is now a separate local semantic and no public maximum is documented | D/B - parser bound removed |
| list heading at most 5,000 characters                          | No public per-field maximum documented                                                                            | D - removed                |
| description/list/additional strings at most 500,000 characters | No public per-field maximum documented; whole response remains capped                                             | D - removed                |
| at most 100 lists or all-location entries                      | No public collection maximum documented; whole response and page authority remain capped                          | D - removed                |
| country string at most 100 characters                          | Replaced by the documented nullable ISO alpha-2 contract                                                          | D -> A                     |
| salary minimum/maximum non-negative                            | Public contract says number and does not document a sign restriction                                              | D - removed                |
| currency at most 10 and interval at most 50 characters         | No public per-field maximum documented                                                                            | D - removed                |
| parsed response array at most 100 records                      | Redundant undocumented parser bound; approved query/page/record budgets remain authoritative                      | D -> C                     |

## Independent safety boundaries

The production transport still enforces the immutable capability's whole-response byte limit (two
megabytes for the approved smoke profile), exact HTTPS host/path/query semantics, DNS and pinned-IP
checks, zero redirects/retries, single concurrency, request/page/record budgets, and strict expiry.
HTML-like provider strings are parsed only into inert normalized text. Raw parsed postings are deeply
frozen. None of these controls grants employer-form, upload, or submission authority.

## Provider-page and local-record accounting

Provider-contract failures are page-fatal. ApplyPilot validates the entire provider array against
the documented structural contract before applying product semantics, so one malformed field shape,
required URL, or structurally corrupt workplace value prevents partial persistence of that page.

After that structural boundary succeeds, local product usability is a per-record disposition and
does not discard valid sibling records. Each posting is either accepted or assigned one fixed,
value-free reason:

```json
{
  "reasonCode": "MISSING_EFFECTIVE_LOCATION",
  "recordIndex": 0
}
```

The allowed reasons are `UNUSABLE_IDENTITY`, `UNUSABLE_TITLE`, `MISSING_EFFECTIVE_LOCATION`, and
`MISSING_USABLE_DESCRIPTION`. The diagnostic cannot contain a title, location value, description,
URL, raw provider value, arbitrary key, stack, or parser message. Accepted records alone proceed to
observation persistence, normalization, versioning, R2 evaluation, and queueing. The page transaction
also records safe unusable and provider-drift audits; a structurally valid page with zero accepted
records is still accounted as a completed page rather than a persistence failure.

Pagination and source budgets count provider/wire records, including locally unusable records. A
25-record response therefore advances the cursor by 25 and consumes 25 records even when fewer are
accepted. The private page digest is deterministic over the ordered provider dispositions: accepted
entries contribute hashed local identity/content material, while unusable entries contribute only
their index and fixed reason. This prevents distinct unusable accounting from appearing identical
without placing provider values in public diagnostics.

## Redacted schema diagnostic

Only a stopped `SCHEMA_CHANGED / RESPONSE_BODY` run may carry this optional audit member:

```json
{
  "field": "salaryRange.min",
  "expectedStructuralType": "number",
  "issueCategory": "FIELD_TYPE_MISMATCH",
  "recordIndex": 0
}
```

Every member is validated against a fixed enum except the bounded non-negative record index. Field
identifiers come from a hardcoded documented-field allowlist. Unknown paths collapse to
`UNKNOWN_CONTRACT_BOUNDARY`. Values, raw fragments, arbitrary provider keys, Zod messages, stack
traces, titles, employer text, URLs, descriptions, candidate data, and private payloads cannot enter
the diagnostic or owner view.

## Non-fatal provider enum drift

Unknown values in non-critical provider enums are treated as provider drift and normalized to
unknown; they are never promoted to supported semantics. For `workplaceType`, the four official
strings retain their existing mappings and documented `unspecified` remains distinct from unknown.
An absent field becomes internal null without a warning. Provider null or an undocumented string
becomes internal null and emits only this fixed value-free warning shape:

```json
{
  "issueCategory": "PROVIDER_ENUM_DRIFT",
  "field": "workplaceType",
  "expectedStructuralType": "enum",
  "recordIndex": 0
}
```

Object, array, number, boolean, and other non-string/non-null values remain fatal structural contract
errors. The private sixth response was not inspected and its actual value remains unknown. This
policy is resilience against provider contract drift; it is not evidence that any guessed value
exists. A drifted raw value remains only in the existing immutable private observation payload and
cannot become eligibility or fit evidence, diagnostic content, public output, or supported semantics.
