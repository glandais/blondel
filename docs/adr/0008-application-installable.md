# ADR-0008 — Application web progressive (installable, hors ligne)

- Statut : accepté le 2026-10-01 (demande de l'utilisateur : « faire de Blondel une PWA »)

## Constat

Blondel tourne entièrement dans le navigateur (calcul dans des Web Workers, aucun serveur, projet sauvegardé dans le stockage local), mais il faut le réseau pour l'ouvrir : sans connexion, un atelier ou un chantier ne peut ni consulter ni modifier un projet. L'application ne s'installe pas non plus comme un logiciel (icône, fenêtre propre).

## Décision

- **`vite-plugin-pwa`** (Workbox, mode `generateSW`) dans `apps/web/vite.config.ts` : manifeste `manifest.webmanifest`, service worker `sw.js` généré au build. Aucun service worker en `pnpm dev`.
- **Tout en cache dès l'installation** (`globPatterns` : js, css, html, svg, png, wasm, woff2 ; plafond par fichier de 5 Mio) : morceaux chargés à la demande (vue 3D, PDF, DXF) et workers compris, ≈ 6 Mio. Une fois installée, l'application s'ouvre, calcule et exporte hors ligne. Aucune ressource externe n'est chargée.
- **Mise à jour sur proposition** (`registerType: "prompt"`) : quand une nouvelle version est publiée, un encart (`apps/web/src/components/UpdatePrompt.tsx`) propose « Recharger » ou « Plus tard » ; jamais de rechargement imposé pendant une saisie. Un onglet resté ouvert cherche une nouvelle version toutes les heures. À la première installation, l'encart signale que Blondel est prêt hors ligne.
- **Manifeste** : textes lus dans `fr.json` (`ui.pwa.name`, `ui.pwa.shortName`, `ui.pwa.description`), langue `fr`. Le manifeste n'a qu'une langue (la traduction des manifestes n'est pas prise en charge par les navigateurs) : le français, langue de référence (ADR-0007). `start_url` et `scope` relatifs (`./`) : fonctionne sous `/` comme sous `/blondel/` (GitHub Pages). Affichage `standalone`, couleurs reprises de `styles.css`.
- **Icône** : `apps/web/public/favicon.svg` (profil d'escalier sur fond plein, motif dans la zone sûre des icônes « maskable »), source des PNG 192, 512 et `apple-touch-icon` 180 régénérés par `pnpm pwa:icons` (`rsvg-convert`) et versionnés.
- **E2E** : service worker bloqué par défaut (`serviceWorkers: "block"`, `playwright.config.ts`) pour ne pas fausser les mesures de tâches longues ; `apps/web/e2e/pwa.spec.ts` l'autorise et vérifie le manifeste, les icônes, puis un rechargement hors ligne (calcul du modèle et vue 3D).

## Conséquences

- Premier chargement : le service worker télécharge en arrière-plan tout le cache (≈ 6 Mio, ≈ 1,8 Mio compressés), y compris des morceaux que la session n'ouvre pas.
- Une version publiée n'est vue qu'après « Recharger » (ou à la fermeture de tous les onglets) : une correction urgente n'est pas imposée.
- Non traités, possibles ensuite : ouverture des fichiers `.blondel.json` depuis le système (`file_handlers`, Launch Queue), raccourcis du manifeste, captures d'écran pour la fenêtre d'installation enrichie.
