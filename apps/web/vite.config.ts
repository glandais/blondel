import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  // Chemin de base de l'application : « / » en local, « /blondel/ » pour GitHub Pages
  // (fourni par la CI via la variable d'environnement BASE_PATH).
  base: process.env.BASE_PATH ?? "/",
  plugins: [react()],
  build: {
    // La vue 3D (three.js, react-three-fiber, drei) est chargée à la demande dans son propre
    // morceau, d'environ 1 Mo non compressé.
    chunkSizeWarningLimit: 1200,
  },
});
