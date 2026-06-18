import type { NextConfig } from "next";

const config: NextConfig = {
  transpilePackages: ["@iris/agent", "@iris/db", "@iris/types"],
};

export default config;
