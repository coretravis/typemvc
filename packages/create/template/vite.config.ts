import { defineConfig, type PluginOption } from 'vite';
import { typemvcPlugin } from '@typemvc/core/vite';

// typemvcPlugin() compiles .tmvc view documents. The framework does not depend
// on vite's types, so cast its structural plugin to vite's PluginOption.
export default defineConfig({
  plugins: [typemvcPlugin() as PluginOption],
  appType: 'spa',
});
