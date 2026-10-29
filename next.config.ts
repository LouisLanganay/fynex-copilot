import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // unpdf ships a bundled pdf.js build that must not be re-bundled by Next.
  serverExternalPackages: ["unpdf"],
  // The sample run and recorded documents are read from disk at runtime.
  outputFileTracingIncludes: {
    "/api/**": ["./fixtures/**/*", "./samples/**/*"],
  },
};

export default nextConfig;
