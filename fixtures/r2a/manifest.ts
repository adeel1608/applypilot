export interface R2AGoldenFixture {
  id: string;
  roleFamily: string;
  text: string;
  location: string;
  structured?: Record<string, unknown>;
  expectedFamilies: string[];
  expectedModalities?: string[];
}

export const r2aGoldenFixtures: R2AGoldenFixture[] = [
  {
    id: "hospitality-roster",
    roleFamily: "hospitality",
    location: "Carlton VIC 3053",
    text: `Title: Evening Venue Host
Company: Lantern Table Group
Location: Carlton VIC 3053
Employment type: Part-time
Hours
18-24 hours per week
Roster
Fixed Friday and Saturday 17:00-23:30 AEST, including overnight shifts where scheduled
What you'll need
- Customer service experience preferred
- RSA must be obtained within 30 days where applicable
- No cover letter required
What we offer
Training provided
Salary: A$28-$32 per hour plus super and bonus`,
    expectedFamilies: [
      "GEOGRAPHY",
      "EMPLOYMENT",
      "HOURS",
      "SCHEDULE",
      "CERTIFICATIONS",
      "DOCUMENTS",
      "TRAINING",
      "COMPENSATION",
    ],
    expectedModalities: ["PREFERRED", "CONDITIONAL", "NEGATED"],
  },
  {
    id: "retail-no-experience",
    roleFamily: "retail",
    location: "Geelong Victoria 3220",
    text: `Title: Store Team Assistant
Company: Southern Shelf Co
Location: Geelong Victoria 3220
The role is casual.
About you
- No experience necessary
- Communication skills are desirable but not essential
- A CV is required`,
    expectedFamilies: ["GEOGRAPHY", "EMPLOYMENT", "EXPERIENCE", "SKILLS", "DOCUMENTS"],
    expectedModalities: ["NEGATED", "PREFERRED", "REQUIRED"],
  },
  {
    id: "admin-selection-criteria",
    roleFamily: "admin/reception",
    location: "Canberra ACT 2601",
    text: `Title: Reception Coordinator
Company: Civic Lantern Services
Location: Canberra ACT 2601
Employment Type: Full-time
Qualifications
Diploma preferred or equivalent experience
Documents
Selection criteria must be submitted
Cover letter may be required depending on the hiring panel`,
    expectedFamilies: ["IDENTITY", "GEOGRAPHY", "EMPLOYMENT", "EDUCATION", "DOCUMENTS"],
    expectedModalities: ["PREFERRED", "REQUIRED", "CONDITIONAL"],
  },
  {
    id: "warehouse-vehicle",
    roleFamily: "warehouse",
    location: "Brisbane QLD 4000",
    text: `Title: Warehouse Dispatch Worker
Company: Paper Crane Logistics
Location: Brisbane QLD 4000
The position is temporary.
Role requirements
- Current Australian forklift licence required
- Access to a vehicle preferred
- Ability to travel to two depots may be required
Hours: 76 hours per fortnight`,
    expectedFamilies: ["GEOGRAPHY", "EMPLOYMENT", "LICENCES", "VEHICLE", "HOURS"],
    expectedModalities: ["REQUIRED", "PREFERRED", "CONDITIONAL"],
  },
  {
    id: "engineering-fixed-term",
    roleFamily: "engineering",
    location: "Adelaide South Australia 5000",
    text: `Title: Graduate Controls Engineer
Company: Kestrel Circuit Works
Location: Adelaide South Australia 5000
This role is fixed-term.
Qualifications
Degree in electrical engineering required or equivalent experience
Experience
1-2 years automation experience preferred
Skills
PLC programming knowledge is essential
Salary: AUD 82000 per year excluding super`,
    expectedFamilies: [
      "GEOGRAPHY",
      "EMPLOYMENT",
      "EDUCATION",
      "EXPERIENCE",
      "SKILLS",
      "COMPENSATION",
    ],
    expectedModalities: ["REQUIRED", "PREFERRED"],
  },
  {
    id: "robotics-internship",
    roleFamily: "robotics",
    location: "Hobart TAS 7000",
    text: `Title: Robotics Test Intern
Company: Harbour Motion Lab
Location: Hobart TAS 7000
The job is an internship.
About you
- Currently studying engineering accepted
- Robotics or automation experience an advantage
- Portfolio preferred`,
    expectedFamilies: ["GEOGRAPHY", "EMPLOYMENT", "EDUCATION", "EXPERIENCE", "DOCUMENTS"],
    expectedModalities: ["PREFERRED"],
  },
  {
    id: "embedded-apprenticeship",
    roleFamily: "embedded",
    location: "Darwin Northern Territory 0800",
    text: `Title: Embedded Systems Apprentice
Company: Northern Signal Studio
Location: Darwin Northern Territory 0800
This position is an apprenticeship.
Requirements
- Basic C programming knowledge preferred
- White Card must be obtained within 60 days
- Valid Australian work rights required`,
    expectedFamilies: ["GEOGRAPHY", "EMPLOYMENT", "SKILLS", "LICENCES", "WORK_RIGHTS"],
    expectedModalities: ["PREFERRED", "CONDITIONAL", "REQUIRED"],
  },
  {
    id: "health-licensed",
    roleFamily: "health/licensed",
    location: "Perth WA 6000",
    text: `Title: Community Health Assistant
Company: West Arc Health Collective
Location: Perth WA 6000
The role is part-time.
Qualifications
Certificate IV required
Licence / certification
Current First Aid certification required
An overseas driver licence is preferred
Role requirements
Ability to stand for extended periods may be required`,
    expectedFamilies: [
      "GEOGRAPHY",
      "EMPLOYMENT",
      "EDUCATION",
      "CERTIFICATIONS",
      "LICENCES",
      "PHYSICAL_REQUIREMENTS",
    ],
    expectedModalities: ["REQUIRED", "PREFERRED", "CONDITIONAL"],
  },
  {
    id: "remote-sponsorship",
    roleFamily: "remote",
    location: "Remote across Australia",
    text: `Title: Remote Support Specialist
Company: Quiet River Software
Location: Remote across Australia
The position is full-time.
Work rights
Valid Australian work rights required
Visa sponsorship is not available
Roster
Flexible weekday roster AEDT
Salary: $90000`,
    expectedFamilies: ["GEOGRAPHY", "EMPLOYMENT", "WORK_RIGHTS", "SCHEDULE", "COMPENSATION"],
    expectedModalities: ["REQUIRED"],
  },
  {
    id: "multi-location-field",
    roleFamily: "multi-location",
    location: "Sydney NSW 2000 or Melbourne VIC 3000",
    text: `Title: Field Automation Technician
Company: Two Coast Controls
Location: Sydney NSW 2000 or Melbourne VIC 3000
This role is contract.
Duties
Travel to customer facilities up to 25% may be required
Role requirements
Own vehicle is not required
Australian driver licence required`,
    expectedFamilies: ["GEOGRAPHY", "EMPLOYMENT", "VEHICLE", "LICENCES"],
    expectedModalities: ["CONDITIONAL", "NEGATED", "REQUIRED"],
  },
  {
    id: "structured-conflict",
    roleFamily: "automation",
    location: "Newcastle NSW 2300",
    structured: {
      title: "Automation Service Associate",
      company: "Wattle Logic Systems",
      location: "Newcastle NSW 2300",
      employmentType: "PART_TIME",
    },
    text: `Automation Service Associate
Wattle Logic Systems
Newcastle NSW 2300
PART_TIME
The role is full-time.
Requirements
Unrestricted work rights required`,
    expectedFamilies: ["IDENTITY", "GEOGRAPHY", "EMPLOYMENT", "WORK_RIGHTS"],
    expectedModalities: ["REQUIRED"],
  },
  {
    id: "postcode-state-conflict",
    roleFamily: "retail",
    location: "Fictional Plaza NSW 3000",
    text: `Title: Customer Greeter
Company: Example Plaza Stores
Location: Fictional Plaza NSW 3000
This role is volunteer.
Documents
CV not required`,
    expectedFamilies: ["GEOGRAPHY", "EMPLOYMENT", "DOCUMENTS"],
    expectedModalities: ["NEGATED"],
  },
];
