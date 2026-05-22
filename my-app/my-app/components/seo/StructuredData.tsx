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
      dangerouslySetInnerHTML={{ __html: JSON.stringify(data) }}
    />
  );
}

/**
 * Generates organization structured data for Cal Poly Pomona SOC
 */
export function getOrganizationStructuredData() {
  return {
    '@context': 'https://schema.org',
    '@type': 'Organization',
    name: 'Cal Poly Pomona Security Operations Center',
    alternateName: ['Cal Poly SOC', 'CPP SOC', 'Cal Poly Student Data Center'],
    url: process.env.NEXT_PUBLIC_APP_URL || 'https://portal.calpolysoc.org',
    logo: `${process.env.NEXT_PUBLIC_APP_URL || 'https://portal.calpolysoc.org'}/logo3.png`,
    description: 'Security Operations Center and Student Data Center at California State Polytechnic University, Pomona, managed by student directors providing cybersecurity infrastructure and services.',
    address: {
      '@type': 'PostalAddress',
      addressLocality: 'Pomona',
      addressRegion: 'CA',
      addressCountry: 'US'
    },
    parentOrganization: {
      '@type': 'CollegeOrUniversity',
      name: 'California State Polytechnic University, Pomona',
      alternateName: 'Cal Poly Pomona',
      url: 'https://www.cpp.edu'
    },
    department: {
      '@type': 'Organization',
      name: 'Mitchell C. Hill Student Data Center',
      url: 'https://www.cpp.edu/cba/digital-innovation/index.shtml'
    }
  };
}

/**
 * Generates WebApplication structured data for the UAR portal
 */
export function getWebApplicationStructuredData() {
  return {
    '@context': 'https://schema.org',
    '@type': 'WebApplication',
    name: 'UAR Portal - User Access Request Portal',
    applicationCategory: 'SecurityApplication',
    operatingSystem: 'Web Browser',
    offers: {
      '@type': 'Offer',
      price: '0',
      priceCurrency: 'USD'
    },
    description: 'Official portal for requesting access to Cal Poly Pomona Security Operations Center and Student Data Center resources. Request VPN access, server infrastructure, and cybersecurity tools.',
    provider: {
      '@type': 'Organization',
      name: 'Cal Poly Pomona Security Operations Center'
    },
    featureList: [
      'VPN Access Request',
      'Server Access Management',
      'Account Activation',
      'Password Reset',
      'Support Ticket System',
      'Access Verification'
    ]
  };
}

/**
 * Generates BreadcrumbList structured data for improved navigation in search results
 */
export function getBreadcrumbStructuredData(items: Array<{ name: string; url: string }>) {
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://portal.calpolysoc.org';
  
  return {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: items.map((item, index) => ({
      '@type': 'ListItem',
      position: index + 1,
      name: item.name,
      item: `${baseUrl}${item.url}`
    }))
  };
}
