import type { Metadata, Viewport } from "next";
import { GeistSans } from "geist/font/sans";
import { GeistMono } from "geist/font/mono";
import "./globals.css";
import Navbar from "@/components/Navbar";
import Footer from "@/components/Footer";
import NotificationBanner from "@/components/NotificationBanner";
import { StructuredData, getOrganizationStructuredData, getWebApplicationStructuredData } from "@/components/seo/StructuredData";

export const metadata: Metadata = {
  metadataBase: new URL(process.env.NEXT_PUBLIC_APP_URL || 'https://portal.calpolysoc.org'),
  title: {
    default: "User Access Request (UAR) Portal - Cal Poly Pomona SOC",
    template: "%s | User Access Request (UAR) Portal"
  },
  description: "Official User Access Request Portal managed by Cal Poly Pomona Student-led Security Operations Center (SOC) and Mitchell C. Hill Student Data Center (SDC).",
  keywords: [
    "Cal Poly Pomona SOC",
    "Cal Poly Security Operations Center",
    "Cal Poly Student Data Center",
    "Cal Poly SDC",
    "Cal Poly cybersecurity",
    "Cal Poly Pomona security",
    "Mitchell C. Hill Student Data Center",
    "Cal Poly VPN access",
    "Cal Poly server access",
    "Cal Poly IT security",
    "CPP SOC",
    "CPP cybersecurity",
    "student security operations",
    "university security operations center"
  ],
  authors: [{ name: "Cal Poly Pomona Security Operations Center" }],
  creator: "Cal Poly Pomona SOC",
  publisher: "Cal Poly Pomona",
  openGraph: {
    type: "website",
    locale: "en_US",
    url: "/",
    siteName: "User Access Request (UAR) Portal - Cal Poly Pomona SOC",
    title: "User Access Request Portal - Cal Poly Pomona Security Operations Center",
    description: "Request secure access to Cal Poly Pomona's Mitchell C. Hill Student Data Center resources. Managed by the Security Operations Center student directors.",
    images: [
      {
        url: "/logo3.png",
        width: 1200,
        height: 630,
        alt: "Cal Poly Pomona SOC - User Access Request Portal"
      }
    ]
  },
  twitter: {
    card: "summary_large_image",
    title: "User Access Request (UAR) Portal - Cal Poly Pomona SOC",
    description: "Request access to Cal Poly Pomona Student Data Center resources",
    images: ["/logo3.png"]
  },
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      'max-video-preview': -1,
      'max-image-preview': 'large',
      'max-snippet': -1,
    },
  },
  verification: {
  },
  alternates: {
    canonical: "/",
  },
  category: "technology",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <head>
        <StructuredData data={getOrganizationStructuredData()} />
        <StructuredData data={getWebApplicationStructuredData()} />
      </head>
      <body
        className={`${GeistSans.variable} ${GeistMono.variable} antialiased flex flex-col min-h-screen`}
        suppressHydrationWarning
      >
        <a
          href="#main-content"
          className="sr-only focus:not-sr-only focus:absolute focus:z-50 focus:top-4 focus:left-4 focus:px-6 focus:py-3 focus:bg-background focus:text-foreground focus:border focus:border-border focus:shadow-lg focus:rounded-md focus:font-medium transition-colors"
        >
          Skip to main content
        </a>
        <Navbar />
        <NotificationBanner />
        <main id="main-content" className="grow">
          {children}
        </main>
        <Footer />
      </body>
    </html>
  );
}
