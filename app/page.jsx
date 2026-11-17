import Landing, { FAQ } from "../components/Landing.jsx";
import { SITE, CITIES } from "../lib/site.js";

export const metadata = {
  title: { absolute: `ADU Builder in the 209 & Central Valley · Free Consultation | ${SITE.name}` },
  description:
    "Backyard ADUs, garage conversions and farm worker housing from Lodi to Fresno. Find out what your lot allows, what it costs and how long it takes, with a free consultation.",
  alternates: { canonical: "/" },
};

// Structured data for search: the business and the FAQ on this page.
const jsonLd = [
  {
    "@context": "https://schema.org",
    "@type": "HomeAndConstructionBusiness",
    name: SITE.name,
    url: SITE.url,
    image: `${SITE.url}/landing/adu-hero.jpg`,
    description: "ADU design, permitting and construction, garage conversions and farm worker housing in the San Joaquin Valley.",
    ...(SITE.phone ? { telephone: SITE.phone } : {}),
    areaServed: CITIES.map((c) => ({ "@type": "City", name: `${c}, CA` })),
  },
  {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: FAQ.map((f) => ({ "@type": "Question", name: f.q, acceptedAnswer: { "@type": "Answer", text: f.a } })),
  },
];

export default function Page() {
  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd).replace(/</g, "\\u003c") }} />
      <Landing />
    </>
  );
}
