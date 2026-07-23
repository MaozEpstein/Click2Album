import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  optimizeDeps: {
    // onnxruntime-web טוען wasm בזמן ריצה — ה-pre-bundling של Vite שובר את הנתיבים
    exclude: ['onnxruntime-web', 'onnxruntime-web/wasm'],
  },
});
