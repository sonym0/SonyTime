import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.esraa.app',
  appName: 'Esraa ♥🦌',
  webDir: 'dist',
  
  android: {
    allowMixedContent: false
  }
};

export default config;
