import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";
// Textes du manifeste (application installable) : dictionnaire de référence, ADR-0008.
import fr from "../../packages/i18n/src/locales/fr.json" with { type: "json" };

export default defineConfig({
  // Chemin de base de l'application : « / » en local, « /blondel/ » pour GitHub Pages
  // (fourni par la CI via la variable d'environnement BASE_PATH).
  base: process.env.BASE_PATH ?? "/",
  plugins: [
    react(),
    // Application web progressive (ADR-0008) : manifeste, icônes et service worker (Workbox)
    // qui met en cache toute l'application (morceaux chargés à la demande et workers compris)
    // pour qu'elle s'ouvre et calcule hors ligne. Mise à jour sur proposition (`UpdatePrompt`),
    // jamais de rechargement imposé pendant une saisie. Aucun service worker en `pnpm dev`.
    VitePWA({
      registerType: "prompt",
      injectRegister: false,
      manifest: {
        id: "./",
        name: fr["ui.pwa.name"],
        short_name: fr["ui.pwa.shortName"],
        description: fr["ui.pwa.description"],
        lang: "fr",
        start_url: "./",
        scope: "./",
        display: "standalone",
        // `--accent` (thème clair) et `--bg` (thème sombre) de styles.css.
        theme_color: "#2f6fb3",
        background_color: "#15181b",
        icons: [
          { src: "pwa-192.png", sizes: "192x192", type: "image/png" },
          { src: "pwa-512.png", sizes: "512x512", type: "image/png" },
          { src: "pwa-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
          { src: "favicon.svg", sizes: "any", type: "image/svg+xml" },
        ],
      },
      workbox: {
        globPatterns: ["**/*.{js,css,html,svg,png,wasm,woff2}"],
        // Vue 3D (≈ 1 Mo) et PDF (jsPDF) en cache dès l'installation, sous ce plafond.
        maximumFileSizeToCacheInBytes: 5 * 1024 * 1024,
        cleanupOutdatedCaches: true,
      },
    }),
  ],
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
