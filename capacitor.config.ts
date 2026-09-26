import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.gamingshell.app',
  appName: 'Gaming Shell',
  webDir: 'dist',
  server: {
    androidScheme: 'https'
  }
};

export default config;
