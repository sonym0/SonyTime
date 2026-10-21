import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.sonytime.app.test',
  appName: 'Sony time',
  webDir: 'dist',
  
  android: {
    allowMixedContent: false
  }
};

export default config;
