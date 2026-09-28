import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  build: {
    // La vue 3D (three.js, react-three-fiber, drei) est chargée à la demande dans son propre
    // morceau, d'environ 1 Mo non compressé.
    chunkSizeWarningLimit: 1200,
  },
});
