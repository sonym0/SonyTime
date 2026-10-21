import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.sonytime.app.v2',
  appName: 'Sony time',
  webDir: 'dist',
  
  android: {
    allowMixedContent: false
  }
};

export default config;
