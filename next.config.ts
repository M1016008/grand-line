import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  images: {
    // Bandai serves card art from /images/cardlist/card/<id>.png on the
    // public cardlist domain. We allow next/image to optimize them by
    // listing the remote pattern explicitly (Next 16 deprecates the
    // legacy `images.domains` array).
    remotePatterns: [
      {
        protocol: "https",
        hostname: "www.onepiece-cardgame.com",
        pathname: "/images/cardlist/**",
      },
      {
        protocol: "https",
        hostname: "en.onepiece-cardgame.com",
        pathname: "/images/cardlist/**",
      },
    ],
  },
};

export default nextConfig;
