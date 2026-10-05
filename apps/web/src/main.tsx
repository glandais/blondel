import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
// Polices du système Industry, embarquées (aucun appel externe : l'application reste utilisable
// hors ligne, ADR-0008 et ADR-0009). Sous-ensemble latin seul : il couvre le français (accents,
// « œ », guillemets, tirets, €). Les feuilles par sous-ensemble de @fontsource n'ont pas de
// `unicode-range` : en importer deux pour un même poids ferait gagner la dernière. Les glyphes
// hors sous-ensemble (≥, ≈…) passent par la police système de repli.
import "@fontsource/barlow/latin-400.css";
import "@fontsource/barlow/latin-500.css";
import "@fontsource/barlow/latin-700.css";
import "@fontsource/barlow-condensed/latin-400.css";
import "@fontsource/barlow-condensed/latin-600.css";
// Couleurs fonctionnelles (`--fn-*`) avant les jetons et styles qui s'en servent.
import "./palette.css";
import "./styles.css";
// Application après les feuilles globales : à spécificité égale, les feuilles des composants
// (importées par eux) priment sur les classes communes (`.btn`, `.seg`…) de `styles.css`.
import { App } from "./App.js";

const root = document.getElementById("root");
if (!root) throw new Error("Élément #root introuvable.");

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
