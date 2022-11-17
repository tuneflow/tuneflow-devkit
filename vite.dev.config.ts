import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import EnvironmentPlugin from 'vite-plugin-environment';

// https://vitejs.dev/config/
export default defineConfig({
  server: {
    host: true,
    port: 8899,
  },
  plugins: [
    vue(),
    EnvironmentPlugin({
      NODE_ENV: 'development',
    }),
  ],
});
