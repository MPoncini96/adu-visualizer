/** @type {import('next').NextConfig} */
// Built as plain static files and hosted on GitHub Pages (.github/workflows/pages.yml).
// Static exports can't use redirects() or headers():
// - old "/?model=..&ar=1" links and printed QR codes are forwarded by components/LegacyRedirect.jsx
// - GitHub Pages already sends Access-Control-Allow-Origin: * on /models/* files
const nextConfig = {
  output: "export",
  images: { unoptimized: true },
};
export default nextConfig;
