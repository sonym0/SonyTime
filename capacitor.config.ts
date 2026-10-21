import type { CapacitorConfig } from '@capacitor/cli';

const isTestBuild = (globalThis as any).process?.env?.SONYTIME_TEST_BUILD === '1';

const config: CapacitorConfig = {
  appId: isTestBuild ? 'com.sonytime.app.test' : 'com.sonytime.app',
  appName: isTestBuild ? 'Sony Time Test' : 'Sony time',
  webDir: 'dist',
  bundledWebRuntime: false,
  android: {
    allowMixedContent: false
  }
};

export default config;
