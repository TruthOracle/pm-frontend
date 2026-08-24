import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.truthoracle.app',
  appName: 'TruthOracle',
  webDir: 'dist',
  ...(process.env.CAPACITOR_DEV_SERVER === 'true'
    ? {
        server: {
          url: 'http://localhost:5173',
          cleartext: true,
        },
      }
    : {}),
  ios: {
    contentInset: 'automatic',
  },
};

export default config;
