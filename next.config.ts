import type { NextConfig } from "next";
import { withSentryConfig } from "@sentry/nextjs";

const nextConfig: NextConfig = {
  serverExternalPackages: ["knex", "pg", "pg-native"],

  // Redirect /docs to /docs/index.html so the TypeDoc static site loads.
  // Redirecting to /docs/ would loop: Next.js (trailingSlash: false) strips
  // the trailing slash back to /docs, which hits this rule again.
  // Pointing directly at the file avoids the loop, and all relative asset
  // paths in the TypeDoc HTML still resolve correctly (base dir stays /docs/).
  async redirects() {
    return [
      {
        source: "/docs",
        destination: "/docs/index.html",
        permanent: false,
      },
    ];
  },

  images: {
    remotePatterns: [
      { protocol: "https", hostname: "picsum.photos" },
      // Google account profile pictures
      { protocol: "https", hostname: "lh3.googleusercontent.com" },
      { protocol: "https", hostname: "lh4.googleusercontent.com" },
      { protocol: "https", hostname: "lh5.googleusercontent.com" },
      { protocol: "https", hostname: "lh6.googleusercontent.com" },
      // Instagram video thumbnails (from oEmbed)
      { protocol: "https", hostname: "**.cdninstagram.com" },
      { protocol: "https", hostname: "**.fbcdn.net" },
    ],
  },
};

export default withSentryConfig(nextConfig, {
  org: "allaboard",
  project: "javascript-nextjs",

  // Auth token for uploading source maps (stored in env, never committed)
  authToken: process.env.SENTRY_AUTH_TOKEN,

  // Suppress Sentry CLI output during builds
  silent: !process.env.CI,

  // Upload source maps to Sentry so stack traces show original code
  widenClientFileUpload: true,

  // Automatically instrument Next.js's server-side data fetching methods
  autoInstrumentServerFunctions: true,

  // Upload source maps and hide them from the browser bundle
  sourcemaps: {
    disable: false,
  },

  // Reduces bundle size by tree-shaking debug logging in production
  disableLogger: true,
});
