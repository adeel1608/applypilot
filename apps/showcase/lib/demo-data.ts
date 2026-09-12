export type DemoEligibility = "ELIGIBLE" | "REVIEW_REQUIRED";
export type DemoRecommendation = "RECOMMENDED" | "REVIEW";
export type DemoQueueState = "REVIEWING" | "SHORTLISTED" | "PREPARING";
export type EvidenceState = "MATCH" | "REVIEW_REQUIRED" | "PARTIAL";

export interface DemoEvidence {
  requirement: string;
  evidence: string;
  state: EvidenceState;
  source: string;
}

export interface DemoJob {
  fictional: true;
  id: string;
  title: string;
  company: string;
  location: string;
  workMode: string;
  fitScore: number;
  evidenceCoverage: number;
  eligibility: DemoEligibility;
  recommendation: DemoRecommendation;
  queueState: DemoQueueState;
  summary: string;
  reviewReasons: readonly string[];
  strengths: readonly string[];
  evidence: readonly DemoEvidence[];
}

export const demoJobs = [
  {
    fictional: true,
    id: "robotics-engineer-melbourne",
    title: "Robotics Engineer",
    company: "Northstar Motion Labs",
    location: "Melbourne, VIC",
    workMode: "Hybrid",
    fitScore: 92,
    evidenceCoverage: 94,
    eligibility: "ELIGIBLE",
    recommendation: "RECOMMENDED",
    queueState: "SHORTLISTED",
    summary: "Build and validate motion-control software for collaborative robotics systems.",
    reviewReasons: ["Final working-hours schedule requires owner confirmation."],
    strengths: ["C++", "Robotics project evidence", "Systems testing"],
    evidence: [
      {
        requirement: "C++ experience",
        evidence: "Verified robotics project — motion planner and control loop",
        state: "MATCH",
        source: "Project evidence · verified",
      },
      {
        requirement: "Robotics systems experience",
        evidence: "Verified mechatronics capstone with integrated sensing and actuation",
        state: "MATCH",
        source: "Education evidence · verified",
      },
      {
        requirement: "Occasional after-hours testing",
        evidence: "Availability detail not yet confirmed for this schedule",
        state: "REVIEW_REQUIRED",
        source: "Candidate fact · unknown",
      },
    ],
  },
  {
    fictional: true,
    id: "junior-automation-engineer",
    title: "Junior Automation Engineer",
    company: "Relay Works",
    location: "Melbourne, VIC",
    workMode: "On-site",
    fitScore: 86,
    evidenceCoverage: 91,
    eligibility: "ELIGIBLE",
    recommendation: "RECOMMENDED",
    queueState: "SHORTLISTED",
    summary:
      "Commission small automation cells and improve test coverage for production equipment.",
    reviewReasons: ["Travel frequency should be confirmed before packet preparation."],
    strengths: ["PLC fundamentals", "Test discipline", "Hands-on prototyping"],
    evidence: [
      {
        requirement: "Automation or mechatronics degree",
        evidence: "Verified mechatronics education",
        state: "MATCH",
        source: "Education evidence · verified",
      },
      {
        requirement: "Commissioning exposure",
        evidence: "Related lab commissioning evidence; production context not established",
        state: "PARTIAL",
        source: "Project evidence · verified",
      },
    ],
  },
  {
    fictional: true,
    id: "computer-vision-engineer",
    title: "Computer Vision Engineer",
    company: "Lumen Dynamics",
    location: "Melbourne, VIC",
    workMode: "Hybrid",
    fitScore: 82,
    evidenceCoverage: 78,
    eligibility: "REVIEW_REQUIRED",
    recommendation: "REVIEW",
    queueState: "REVIEWING",
    summary: "Develop perception pipelines for inspection and autonomous navigation prototypes.",
    reviewReasons: [
      "Required commercial vision experience is not established by current evidence.",
    ],
    strengths: ["Python", "Computer vision project", "Sensor integration"],
    evidence: [
      {
        requirement: "Computer vision development",
        evidence: "Verified visual inspection project",
        state: "MATCH",
        source: "Project evidence · verified",
      },
      {
        requirement: "Three years commercial experience",
        evidence: "No verified duration evidence",
        state: "REVIEW_REQUIRED",
        source: "Experience evidence · unknown",
      },
    ],
  },
  {
    fictional: true,
    id: "mechatronics-graduate",
    title: "Mechatronics Graduate",
    company: "Aster Motion",
    location: "Dandenong, VIC",
    workMode: "On-site",
    fitScore: 79,
    evidenceCoverage: 96,
    eligibility: "ELIGIBLE",
    recommendation: "RECOMMENDED",
    queueState: "PREPARING",
    summary: "Rotate through controls, mechanical design, validation, and production engineering.",
    reviewReasons: ["Graduate intake start date remains owner-confirmed before application."],
    strengths: ["Mechatronics degree", "CAD", "Embedded systems"],
    evidence: [
      {
        requirement: "Recent mechatronics graduate",
        evidence: "Verified mechatronics qualification",
        state: "MATCH",
        source: "Education evidence · verified",
      },
      {
        requirement: "Practical design project",
        evidence: "Verified integrated robotics capstone",
        state: "MATCH",
        source: "Project evidence · verified",
      },
    ],
  },
  {
    fictional: true,
    id: "controls-engineer",
    title: "Controls Engineer",
    company: "Southern Loop Systems",
    location: "Melbourne, VIC",
    workMode: "On-site",
    fitScore: 76,
    evidenceCoverage: 74,
    eligibility: "REVIEW_REQUIRED",
    recommendation: "REVIEW",
    queueState: "REVIEWING",
    summary: "Design safety-focused controls for automated material-handling equipment.",
    reviewReasons: ["Industrial safety-standard experience is not present in verified evidence."],
    strengths: ["Control systems", "C++", "Technical documentation"],
    evidence: [
      {
        requirement: "Control-system fundamentals",
        evidence: "Verified university control project",
        state: "MATCH",
        source: "Project evidence · verified",
      },
      {
        requirement: "Machine-safety standards",
        evidence: "No verified standard-specific experience",
        state: "REVIEW_REQUIRED",
        source: "Skill evidence · unknown",
      },
    ],
  },
  {
    fictional: true,
    id: "embedded-systems-engineer",
    title: "Embedded Systems Engineer",
    company: "CircuitFoundry",
    location: "Geelong, VIC",
    workMode: "Hybrid",
    fitScore: 74,
    evidenceCoverage: 87,
    eligibility: "ELIGIBLE",
    recommendation: "RECOMMENDED",
    queueState: "REVIEWING",
    summary: "Prototype embedded sensing modules and harden firmware test workflows.",
    reviewReasons: ["Geelong commute preference requires an explicit owner decision."],
    strengths: ["Embedded C", "Sensor interfaces", "Hardware-in-the-loop testing"],
    evidence: [
      {
        requirement: "Embedded C or C++",
        evidence: "Verified embedded-systems project",
        state: "MATCH",
        source: "Project evidence · verified",
      },
      {
        requirement: "Geelong hybrid attendance",
        evidence: "Commute preference not verified for this location",
        state: "REVIEW_REQUIRED",
        source: "Preference evidence · unknown",
      },
    ],
  },
  {
    fictional: true,
    id: "test-validation-engineer",
    title: "Test & Validation Engineer",
    company: "Vector Yard Labs",
    location: "Melbourne, VIC",
    workMode: "Hybrid",
    fitScore: 71,
    evidenceCoverage: 90,
    eligibility: "ELIGIBLE",
    recommendation: "RECOMMENDED",
    queueState: "PREPARING",
    summary: "Create traceable verification plans for electromechanical products and test rigs.",
    reviewReasons: ["One optional certification is unverified and excluded from claims."],
    strengths: ["Verification planning", "Python tooling", "Technical reporting"],
    evidence: [
      {
        requirement: "Structured test plans",
        evidence: "Verified systems-testing project",
        state: "MATCH",
        source: "Project evidence · verified",
      },
      {
        requirement: "ISTQB preferred",
        evidence: "Certification not recorded",
        state: "PARTIAL",
        source: "Certification evidence · unknown",
      },
    ],
  },
  {
    fictional: true,
    id: "autonomy-software-engineer",
    title: "Autonomy Software Engineer",
    company: "Wattle Autonomous",
    location: "Melbourne, VIC",
    workMode: "On-site",
    fitScore: 68,
    evidenceCoverage: 69,
    eligibility: "REVIEW_REQUIRED",
    recommendation: "REVIEW",
    queueState: "REVIEWING",
    summary: "Integrate localisation, planning, and vehicle-control software for field robotics.",
    reviewReasons: ["Australian citizenship requirement has no candidate evidence."],
    strengths: ["C++", "Path planning", "Robotics integration"],
    evidence: [
      {
        requirement: "C++ robotics software",
        evidence: "Verified robotics project",
        state: "MATCH",
        source: "Project evidence · verified",
      },
      {
        requirement: "Australian citizenship required",
        evidence: "UNKNOWN — no candidate evidence available",
        state: "REVIEW_REQUIRED",
        source: "Candidate fact · unknown",
      },
    ],
  },
] as const satisfies readonly DemoJob[];

export const demoMetrics = [
  { label: "Jobs reviewed", value: 24, detail: "fictional pipeline total" },
  { label: "Recommended", value: 7, detail: "evidence gate passed" },
  { label: "Review required", value: 5, detail: "unknown stays visible" },
  { label: "Application packets", value: 3, detail: "frozen for review" },
] as const;

export const pipelineStages = [
  { id: "discover", label: "Discover", detail: "A bounded source capability defines the read." },
  { id: "evaluate", label: "Evaluate", detail: "Requirements are matched only to verified facts." },
  { id: "rank", label: "Rank", detail: "Fit scores retain their positive and negative evidence." },
  { id: "prepare", label: "Prepare", detail: "Documents and answers are version-bound." },
  { id: "review", label: "Review", detail: "Unknowns and disclosures remain explicit." },
  { id: "apply", label: "Apply", detail: "A fresh human consent is required for final action." },
] as const;
