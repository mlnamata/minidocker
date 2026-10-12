/** @type {import('next').NextConfig} */

// WebContainers potřebují SharedArrayBuffer → stránka musí být
// cross-origin isolated. Stejné hlavičky jsou i ve vercel.json.
const isolationHeaders = [
  { key: 'Cross-Origin-Embedder-Policy', value: 'require-corp' },
  { key: 'Cross-Origin-Opener-Policy', value: 'same-origin' },
];

const nextConfig = {
  // StrictMode v dev režimu dvakrát spouští efekty → xterm i boot
  // WebContaineru by se inicializovaly dvakrát.
  reactStrictMode: false,
  async headers() {
    return [{ source: '/:path*', headers: isolationHeaders }];
  },
};

module.exports = nextConfig;
