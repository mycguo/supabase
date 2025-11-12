/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    serverActions: true,
  },
  webpack: (config, { isServer }) => {
    config.resolve.alias = {
      ...config.resolve.alias,
      sharp$: false,
      'onnxruntime-node$': false,
    };

    // Prevent Transformers.js from being processed on the server
    if (isServer) {
      config.resolve.fallback = {
        ...config.resolve.fallback,
        '@xenova/transformers': false,
      };
      
      // Ignore Transformers.js during server-side bundling
      config.externals = config.externals || [];
      config.externals.push('@xenova/transformers');
    }

    return config;
  },
};

module.exports = nextConfig;
