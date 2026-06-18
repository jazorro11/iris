import type { NextConfig } from "next";

const config: NextConfig = {
  transpilePackages: ["@iris/agent", "@iris/db", "@iris/types"],
  webpack: (config) => {
    config.resolve.extensionAlias = {
      ".js": [".ts", ".tsx", ".js"],
      ".mjs": [".mts", ".mjs"],
    };
    return config;
  },
};

export default config;
