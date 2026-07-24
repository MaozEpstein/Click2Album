import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  // GitHub Pages מגיש מתת-נתיב של הריפו
  base: '/Click2Album/',
  plugins: [react()],
  optimizeDeps: {
    // onnxruntime-web טוען wasm בזמן ריצה — ה-pre-bundling של Vite שובר את הנתיבים
    exclude: ['onnxruntime-web', 'onnxruntime-web/wasm'],
  },
});
