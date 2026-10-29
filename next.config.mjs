/** @type {import('next').NextConfig} */
const nextConfig = {
  // The planner used to live at "/". Old links and printed QR codes carry these query keys.
  async redirects() {
    return ["model", "ar", "tour", "style"].map((key) => ({
      source: "/", has: [{ type: "query", key }], destination: "/visualizer", permanent: false,
    }));
  },
  async headers() {
    return [{ source: "/models/:path*", headers: [{ key: "Access-Control-Allow-Origin", value: "*" }, { key: "Cache-Control", value: "public, max-age=86400" }] }];
  },
};
export default nextConfig;
