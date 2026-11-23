import { SITE } from "../lib/site.js";

export const dynamic = "force-static";

export default function sitemap() {
  const now = new Date();
  return [
    { url: `${SITE.url}/`, lastModified: now, changeFrequency: "weekly", priority: 1 },
    { url: `${SITE.url}/visualizer`, lastModified: now, changeFrequency: "monthly", priority: 0.7 },
    { url: `${SITE.url}/walk`, lastModified: now, changeFrequency: "monthly", priority: 0.7 },
  ];
}
