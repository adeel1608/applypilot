import fixture01 from "./01-retail-casual.json";
import fixture02 from "./02-restaurant-part-time.json";
import fixture03 from "./03-receptionist-full-time.json";
import fixture04 from "./04-customer-service-remote.json";
import fixture05 from "./05-engineering-internship.json";
import fixture06 from "./06-warehouse-casual.json";
import fixture07 from "./07-delivery-contract.json";
import fixture08 from "./08-healthcare-part-time.json";
import fixture09 from "./09-unrestricted-rights.json";
import fixture10 from "./10-missing-salary.json";
import fixture11 from "./11-missing-company.json";
import fixture12 from "./12-missing-requirements.json";
import fixture13 from "./13-malformed-description.json";
import fixture14 from "./14-removed-job.json";
import fixture15 from "./15-duplicate-page.json";

import {
  createSeekRawJobRecord,
  SeekFixtureFileSchema,
  type SeekFixtureEntry,
} from "@applypilot/job-sources";

const importedFixtures: unknown[] = [
  fixture01,
  fixture02,
  fixture03,
  fixture04,
  fixture05,
  fixture06,
  fixture07,
  fixture08,
  fixture09,
  fixture10,
  fixture11,
  fixture12,
  fixture13,
  fixture14,
  fixture15,
];

export const seekFixtureCases = importedFixtures.map((fixture) => {
  const parsed = SeekFixtureFileSchema.parse(fixture);
  return { ...parsed, record: createSeekRawJobRecord(parsed.record) };
});

export const seekFixtureEntries: SeekFixtureEntry[] = seekFixtureCases.map(
  ({ record, distanceKmFrom3072 }) => ({ record, distanceKmFrom3072 }),
);
