import 'dotenv/config';
import type { CapacitorConfig } from '@capacitor/cli';

const hostedUrl = process.env.CAPACITOR_SERVER_URL?.trim().replace(/\/$/, '');
const useDevServer = process.env.CAPACITOR_DEV_SERVER === 'true';
const serverUrl = hostedUrl || (useDevServer ? 'http://localhost:5173' : undefined);

const config: CapacitorConfig = {
  appId: 'com.truthoracle.app',
  appName: 'TruthOracle',
  webDir: 'dist',
  ...(serverUrl
    ? {
        server: {
          url: serverUrl,
          ...(serverUrl.startsWith('http://') ? { cleartext: true } : {}),
        },
      }
    : {}),
  ios: {
    contentInset: 'automatic',
  },
};

export default config;
