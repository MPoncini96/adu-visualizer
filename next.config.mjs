/** @type {import('next').NextConfig} */
const nextConfig = {
  async headers() {
    return [{ source: "/models/:path*", headers: [{ key: "Access-Control-Allow-Origin", value: "*" }, { key: "Cache-Control", value: "public, max-age=86400" }] }];
  },
};
export default nextConfig;
