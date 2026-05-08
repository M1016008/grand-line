import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Bandai serves card art with `Cross-Origin-Resource-Policy: same-site`,
  // which blocks browser hot-linking from any other origin. We proxy
  // through `/api/img` (see src/app/api/img/route.ts) and never embed the
  // Bandai URL directly, so `next/image` doesn't see it.
};

export default nextConfig;
