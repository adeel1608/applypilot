import type { NextConfig } from "next";

const validationDistDir = process.env.APPLYPILOT_VALIDATION_DIST_DIR;

if (validationDistDir && !/^\.next-validation-[A-Za-z0-9-]+$/.test(validationDistDir)) {
  throw new Error("APPLYPILOT_VALIDATION_DIST_DIR must be a .next-validation-* directory name");
}

const nextConfig: NextConfig = {
  distDir: validationDistDir ?? ".next",
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
