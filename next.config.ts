import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "media.api-sports.io" },
      { protocol: "https", hostname: "*.api-sports.io" },
      { protocol: "https", hostname: "crests.football-data.org" },
      { protocol: "https", hostname: "www.thesportsdb.com" },
    ],
  },
};

export default nextConfig;
