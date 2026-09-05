/** Fictional/reconstructed Phase 2.5 fixtures. Reserved .example.test hosts never resolve publicly. */
export const importFixtureContent = {
  singleText: `Title: Service Assistant
Company: Fictional Harbour Co
Location: Sydney NSW 2000
Employment type: Part time
Description: Help visitors and maintain accurate service records.`,
  markdown: `# Fictional Operations Assistant

Company: Example Southern Services
Location: Melbourne VIC 3000
Description: Coordinate a fictional local service roster and update records.`,
  multiText: `Title: Service Assistant
Company: Fictional Harbour Co
Location: Sydney NSW 2000
Description: Help visitors and maintain accurate service records.
--- JOB ---
Title: Cafe Assistant
Company: Example Garden Cafe
Location: Brisbane QLD 4000
Description: Welcome guests and support a small fictional cafe team.`,
  schemaOrgHtml: `<script type="application/ld+json">{"@type":"JobPosting","title":"Fictional Analyst","hiringOrganization":{"name":"Example Systems"},"jobLocation":{"address":{"addressLocality":"Melbourne","addressRegion":"VIC"}},"description":"Review fictional operational records.","url":"https://careers.example.test/jobs/analyst"}</script>`,
  ordinarySecurityText:
    "Email recruiter@example.test. Maintain API token authentication and password policy documentation. Reference ID JOB-123.",
  credentialHeader: "Authorization: Bearer abcdefghijklmnopqrstuvwxyz.123456",
} as const;

export const adversarialJobHosts = [
  "https://indeed.example-attacker.test/viewjob?jk=1",
  "https://boards.greenhouse.io.attacker.test/jobs/1",
  "https://lever.co.attacker.test/job/1",
  "https://boards.greenhouse.io@attacker.test/jobs/1",
] as const;
