import type { NextConfig } from "next";
import { validateEnvironment, logEnvironmentStatus } from "./lib/env-validator";

try {
  validateEnvironment();
  logEnvironmentStatus();
} catch (error) {
  console.error(error instanceof Error ? error.message : 'Environment validation failed');
  process.exit(1);
}

const isDevelopment = process.env.NODE_ENV !== 'production';

// CSP directives - removed unsafe-inline from production for better XSS protection
const cspDirectives = [
  "default-src 'self';",
  isDevelopment 
    ? "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://challenges.cloudflare.com;" 
    : "script-src 'self' 'unsafe-inline' https://challenges.cloudflare.com;",  // Added 'unsafe-inline' for Turnstile
  "style-src 'self' 'unsafe-inline';",  // Keep for CSS-in-JS libraries
  "img-src 'self' data: blob:;",
  // Allow fonts from same origin, data URIs, and any HTTPS source
  "font-src 'self' data: https: http:;",
  isDevelopment 
    ? "connect-src 'self' ws: wss:;" 
    : "connect-src 'self';",
  "frame-src 'self' https://challenges.cloudflare.com;",
  "frame-ancestors 'none';",
  "base-uri 'self';",
  "form-action 'self';",
  // Removed upgrade-insecure-requests to prevent mixed content blocking
].filter(Boolean);

const securityHeaders = [
  {
    key: 'Content-Security-Policy',
    value: cspDirectives.join(' '),
  },
  {
    key: 'Strict-Transport-Security',
    value: 'max-age=63072000; includeSubDomains; preload',
  },
  {
    key: 'X-Frame-Options',
    value: 'DENY',
  },
  {
    key: 'X-Content-Type-Options',
    value: 'nosniff',
  },
  {
    key: 'Referrer-Policy',
    value: 'no-referrer',
  },
  {
    key: 'Permissions-Policy',
    value: 'camera=(), microphone=(), geolocation=()',
  },
  {
    key: 'X-XSS-Protection',
    value: '1; mode=block',
  },
  {
    key: 'Cross-Origin-Embedder-Policy',
    value: 'require-corp',
  },
  {
    key: 'Cross-Origin-Opener-Policy',
    value: 'same-origin',
  },
  {
    key: 'Cross-Origin-Resource-Policy',
    value: 'same-origin',
  },
];

const nextConfig: NextConfig = {
  output: 'standalone',
  
  // Disable sourcemaps in production to obscure code
  productionBrowserSourceMaps: false,
  
  // Disable image optimization for standalone builds
  images: {
    unoptimized: true,
  },
  
  async headers() {
    return [
      {
        source: '/(.*)',
        headers: securityHeaders,
      },
      {
        // Allow CORS for all static assets (fonts, images, etc.)
        source: '/_next/static/:path*',
        headers: [
          {
            key: 'Access-Control-Allow-Origin',
            value: '*',
          },
          {
            key: 'Access-Control-Allow-Methods',
            value: 'GET, HEAD, OPTIONS',
          },
          {
            key: 'Access-Control-Allow-Headers',
            value: 'X-Requested-With, Content-Type',
          },
          {
            key: 'Cache-Control',
            value: 'public, max-age=31536000, immutable',
          },
        ],
      },
      {
        // Allow CORS for fonts specifically
        source: '/_next/static/media/:path*.woff2',
        headers: [
          {
            key: 'Access-Control-Allow-Origin',
            value: '*',
          },
          {
            key: 'Access-Control-Allow-Methods',
            value: 'GET',
          },
          {
            key: 'Cache-Control',
            value: 'public, max-age=31536000, immutable',
          },
        ],
      },
    ];
  },
};

export default nextConfig;
