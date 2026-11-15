import "./globals.css";
import SiteNav from "../components/SiteNav.jsx";
import { SITE } from "../lib/site.js";

export const metadata = {
  metadataBase: new URL(SITE.url),
  title: { default: `${SITE.name} · ADUs in the San Joaquin Valley`, template: `%s | ${SITE.name}` },
  description: "Backyard ADUs, garage conversions and farm worker housing from Lodi to Fresno. Free consultation, 3D plan walk-throughs and a lot-fit visualizer.",
  openGraph: {
    type: "website",
    siteName: SITE.name,
    url: "/",
    title: "Thinking about an ADU? Find out what you can build, free.",
    description: "ADUs, garage conversions and farm worker housing from Lodi to Fresno. Free lot and permit check.",
    images: [{ url: "/landing/hero-exterior.jpg", width: 1600, height: 1000, alt: "A backyard ADU with a covered porch" }],
  },
  twitter: { card: "summary_large_image" },
};

export const viewport = { width: "device-width", initialScale: 1, themeColor: "#f6f3ec" };

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        <link href="https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,600;9..144,700&family=Inter:wght@400;500;600&display=swap" rel="stylesheet" />
      </head>
      <body>
        <SiteNav />
        {children}
      </body>
    </html>
  );
}
