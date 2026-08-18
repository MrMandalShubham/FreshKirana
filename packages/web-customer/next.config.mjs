import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,

  // Bundles only the files actually reached, producing a container an order of
  // magnitude smaller than shipping node_modules.
  output: 'standalone',

  // In a workspace, tracing must start at the monorepo root or the hoisted
  // dependencies are missed and the standalone server fails to boot.
  outputFileTracingRoot: join(here, '..', '..'),

  // The contracts package ships TypeScript source; Next compiles it rather than
  // requiring a separate build step in the web workflow.
  transpilePackages: ['@freshkirana/contracts'],

  // Shrinks the served payload, which matters more here than anywhere: §4.1
  // targets a mid-range Android on 4G, not a laptop on wifi.
  compress: true,
  poweredByHeader: false,

  images: {
    formats: ['image/avif', 'image/webp'],
  },

  // typedRoutes is deliberately off. Every route here is locale-prefixed and
  // built at runtime (`/${locale}/product/${slug}`), which it cannot type
  // without casts at each call site — that trades real readability for
  // checking that TypeScript already does on the params.
};

export default nextConfig;
