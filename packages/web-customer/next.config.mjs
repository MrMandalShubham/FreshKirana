/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,

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
