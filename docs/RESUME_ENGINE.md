# Resume Engine

## Categories

The engine exposes `casual-general`, `retail-customer-service`, `hospitality-front-of-house`, `admin-reception`, `warehouse-operations`, `technical-casual`, `engineering-general`, `robotics-mechatronics`, `automation-controls`, and `embedded-systems`. Selection is deterministic from normalized title/category/description.

Phase 0/1 renders one common ATS layout while using category selection and page-limit metadata. Category-specific copy/layout refinement belongs to Phase 9.

## Truth boundary

`generateResumeDocument` requires a validated profile and job. It includes only verified identity/contact facts, verified skills, verified employment, verified education, and verified achievements. Each candidate claim carries profile fact references. `validateResumeTruth` rejects missing/unverified references and forbidden claims before HTML or PDF rendering.

Target role and employer are job context, not assertions of prior candidate experience.

## Design rules

The renderer uses A4 CSS and Chromium/Playwright PDF output. The demonstration uses black Times New Roman text, a 10.5 pt body, professional bullet points, no images/icons/graphics/sidebars/skill bars/photo, no layout tables, and selectable HTML text. Casual categories target one page; engineering categories allow two.

Filenames come from the candidate template, for example `JORDAN CV (Northside Homewares).pdf`. Generated PDFs are private ignored artifacts.

## Validation

Unit tests check template selection, claim provenance, forbidden-text exclusion, A4 CSS, font size, black text, and prohibited elements. The full phase audit generates a fixture PDF with Playwright, inspects PDF metadata/text, renders every page to PNG with Poppler, and visually checks margins, typography, clipping, and page count.
