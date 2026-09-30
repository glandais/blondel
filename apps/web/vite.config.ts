import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  // Chemin de base de l'application : « / » en local, « /blondel/ » pour GitHub Pages
  // (fourni par la CI via la variable d'environnement BASE_PATH).
  base: process.env.BASE_PATH ?? "/",
  plugins: [react()],
  // Web Worker de calcul (src/model/model.worker.ts) : module ES, comme l'application.
  worker: { format: "es" },
  build: {
    // La vue 3D (three.js, react-three-fiber, drei) est chargée à la demande dans son propre
    // morceau, d'environ 1 Mo non compressé.
    chunkSizeWarningLimit: 1200,
    rolldownOptions: {
      output: {
        // Dictionnaires de l'interface (`@blondel/i18n`, français et anglais, ≈ 475 ko non
        // compressés) dans leur propre morceau, chargé au démarrage avec l'application : le
        // morceau principal reste sous la limite. Les workers (bundles séparés) les embarquent.
        codeSplitting: {
          groups: [
            { name: "i18n-locales", test: /[\\/]packages[\\/]i18n[\\/]src[\\/]locales[\\/]/ },
          ],
        },
      },
    },
  },
});
