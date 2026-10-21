import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
export default defineConfig({
  plugins: [react()],
  build: { rollupOptions: { output: { manualChunks: { math: ["katex"] } } } },
  server: {
    port: 5173,
    strictPort: true,
    proxy: { "/api": {
      target: "http://127.0.0.1:4318",
      changeOrigin: true,
      configure(proxy) {
        proxy.on("proxyReq", (upstream, request) => {
          // Vite is a same-origin dev gateway. Never rewrite a foreign origin.
          const origin = request.headers.origin;
          if (!origin) return;
          try {
            const parsed = new URL(origin);
            if (["localhost", "127.0.0.1", "[::1]"].includes(parsed.hostname) && parsed.host === request.headers.host && parsed.protocol === "http:")
              upstream.setHeader("Origin", "http://127.0.0.1:4318");
          } catch { /* The backend rejects malformed origins. */ }
        });
      },
    } },
  },
});
