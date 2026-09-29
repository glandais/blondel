/**
 * Accueil de la première visite (aucune autosauvegarde) : bandeau non modal au-dessus des vues,
 * qui propose l'assistant d'initialisation, un préréglage ou l'import d'un projet. Masqué dès
 * que le projet est modifié, que l'assistant est ouvert ou sur « Fermer » (mémorisé dans le
 * navigateur).
 */
import { useState } from "react";
import { appStore, firstVisit, useApp } from "../store/appStore.js";

const DISMISSED_KEY = "blondel.welcome.dismissed";

function wasDismissed(): boolean {
  try {
    return globalThis.localStorage?.getItem(DISMISSED_KEY) === "1";
  } catch {
    return false;
  }
}

export function Welcome() {
  const [hidden, setHidden] = useState(() => !firstVisit || wasDismissed());
  const edited = useApp((s) => s.history.past.length > 0);
  if (hidden || edited) return null;
  const dismiss = (): void => {
    setHidden(true);
    try {
      globalThis.localStorage?.setItem(DISMISSED_KEY, "1");
    } catch {
      // Stockage indisponible : l'accueil reviendra à la prochaine visite.
    }
  };
  return (
    <section className="welcome" aria-label="Accueil">
      <h2>Bienvenue dans Blondel</h2>
      <p>
        L'assistant propose des escaliers conformes à partir de la hauteur à monter, de la trémie et
        des murs. On peut aussi partir d'un préréglage ou importer un projet.
      </p>
      <div className="button-row">
        <button
          type="button"
          onClick={() => {
            setHidden(true);
            appStore.getState().setAssistantOpen(true);
          }}
        >
          Démarrer avec l'assistant
        </button>
        <button type="button" onClick={dismiss}>
          Fermer
        </button>
      </div>
    </section>
  );
}
