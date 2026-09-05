import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  typedRoutes: true,
  transpilePackages: [
    "@applypilot/candidate-profile",
    "@applypilot/job-model",
    "@applypilot/eligibility-engine",
    "@applypilot/fit-scorer",
    "@applypilot/resume-engine",
    "@applypilot/application-tracker",
  ],
};

export default nextConfig;
