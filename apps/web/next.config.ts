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
    "@applypilot/job-importer",
    "@applypilot/database",
  ],
  experimental: {
    serverActions: {
      bodySizeLimit: "2mb",
    },
  },
  async headers() {
    return [
      {
        source: "/import",
        headers: [{ key: "Cache-Control", value: "no-store, private, max-age=0" }],
      },
    ];
  },
};

export default nextConfig;
