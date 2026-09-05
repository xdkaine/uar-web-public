interface StructuredDataProps {
  data: Record<string, unknown>;
}

/**
 * Component for adding JSON-LD structured data to pages
 * Helps search engines understand the content and context of the page
 */
export function StructuredData({ data }: StructuredDataProps) {
  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{
        __html: JSON.stringify(data)
          .replace(/</g, '\\u003c')
          .replace(/>/g, '\\u003e')
          .replace(/&/g, '\\u0026')
          .replace(/\u2028/g, '\\u2028')
          .replace(/\u2029/g, '\\u2029'),
      }}
    />
  );
}
