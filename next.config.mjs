/** @type {import('next').NextConfig} */
const nextConfig = {
  // Traces only the files a production server actually needs into
  // .next/standalone (including its own minimal server.js) — what
  // Dockerfile.web's runtime stage copies, so the final image doesn't
  // need node_modules at all.
  output: "standalone",
};

export default nextConfig;
