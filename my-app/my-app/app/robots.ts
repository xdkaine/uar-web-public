import { MetadataRoute } from 'next';

/**
 * Generates robots.txt dynamically
 * Tells search engines which pages to crawl and index
 */
export default function robots(): MetadataRoute.Robots {
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://portal.calpolysoc.org';

  return {
    rules: [
      {
        userAgent: '*',
        allow: [
          '/',
          '/request',
          '/login',
          '/forgot-password',
          '/instructions',
        ],
        disallow: [
          '/api/',
          '/admin/',
          '/profile/',
          '/verify/',
          '/account/',
          '/support/',
          '/reset-password/',
        ],
      },
      // Allow Google to access static assets
      {
        userAgent: 'Googlebot',
        allow: [
          '/',
          '/request',
          '/login',
          '/forgot-password', 
          '/instructions',
        ],
        disallow: [
          '/api/',
          '/admin/',
          '/profile/',
          '/verify/',
          '/account/',
          '/support/',
          '/reset-password/',
        ],
      },
    ],
    sitemap: `${baseUrl}/sitemap.xml`,
  };
}
