import type { NextConfig } from "next";

const config: NextConfig = {
  output: "standalone",
  images: { unoptimized: true },
  poweredByHeader: false,
};

export default config;
