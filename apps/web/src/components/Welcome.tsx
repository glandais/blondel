/**
 * Accueil de la première visite (aucune autosauvegarde) : bandeau non modal au-dessus des vues,
 * qui propose l'assistant d'initialisation, une démo (escalier complet, ouvert en 3D ;
 * `lib/presetChoice.ts`), un préréglage ou l'import d'un projet. Masqué dès
 * que le projet est modifié, que l'assistant est ouvert ou sur « Fermer » (mémorisé dans le
 * navigateur).
 */
import { useState } from "react";
import { DEMO_GROUP_LABEL, PRESET_GROUPS, applyPresetChoice } from "../lib/presetChoice.js";
import { appStore, firstVisit, useApp } from "../store/appStore.js";

const DEMOS = PRESET_GROUPS.find((g) => g.label === DEMO_GROUP_LABEL)?.items ?? [];

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
      {DEMOS.length > 0 ? (
        <div className="welcome__demos" role="group" aria-label="Démos">
          <span className="muted">Ou découvrir une démo :</span>
          {DEMOS.map((d) => (
            <button
              key={d.id}
              type="button"
              className="link"
              title={d.description}
              onClick={() => applyPresetChoice(appStore.getState(), d.id)}
            >
              {d.label}
            </button>
          ))}
        </div>
      ) : null}
    </section>
  );
}
