import { defineConfig } from 'vite';

const BUILD = new Date().toISOString();

export default defineConfig(({ command }) => ({
  base: './',
  define: { __BUILD__: JSON.stringify(command === 'build' ? BUILD : 'dev') },
  build: { outDir: 'docs', emptyOutDir: true },
  test: { include: ['tests/**/*.test.js'] },
  plugins: [{
    name: 'version-json',
    apply: 'build',
    generateBundle() {
      // Die App vergleicht das mit ihrem eigenen Stand und lädt neu, wenn es eine neue Version gibt.
      this.emitFile({ type: 'asset', fileName: 'version.json', source: JSON.stringify({ build: BUILD }) });
    },
  }],
}));
