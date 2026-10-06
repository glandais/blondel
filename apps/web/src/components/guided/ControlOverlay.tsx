/**
 * Liste du contrôle de conception du parcours guidé, superposée à droite du cadre de la vue
 * (maquette 1a : « ouvrent la liste du contrôle par-dessus la vue »), rendue tant que
 * `uiStore.guidedControlOpen` est vrai (boutons du pied, `revealControl`).
 *
 * - fenêtre non modale (`role="dialog"`, `aria-modal="false"`) titrée « Contrôle de
 *   conception », croix « Fermer le contrôle » ; Échap la ferme (`App`, chaîne d'Échap) ;
 * - en tête, le repli « Contexte de contrôle » (le Contexte n'a pas d'étape guidée : on le
 *   modifie ici), déplié par `openSection("compliance")` (`guidedControlContext`) ;
 * - puis l'inspecteur du parcours libre, tel quel : « sans sélection » (2d, avec le contrôle),
 *   et Règle (2c), Marche (2a) ou Pièce (2b) selon la sélection ; ses liens « Pour corriger »
 *   mènent à l'étape correspondante (`openSection`, conscient du parcours).
 *
 * À l'ouverture, le focus va au titre, sauf si le bloc de contrôle de l'inspecteur l'a déjà pris.
 * Une demande « Contexte » (lien « Profil » du bloc de contrôle) ramène le repli en tête de la
 * liste et lui donne le focus, même s'il était déjà déplié.
 */
import { X } from "lucide-react";
import { useEffect, useId, useRef } from "react";
import { useT } from "../../i18n/useT.js";
import { closeGuidedControl, setGuidedControlContext, useUi } from "../../store/uiStore.js";
import { Inspector } from "../inspector/Inspector.js";
import { ContextSection } from "../sections/ContextSection.js";
import { Icon } from "../ui/Icon.js";
import { focusControlOpener } from "./GuidedFooter.js";
import "./guided.css";

const FREE_DISPLAY = { kind: "free" } as const;

export function ControlOverlay() {
  const t = useT();
  const open = useUi((s) => s.guidedControlOpen);
  const context = useUi((s) => s.guidedControlContext);
  const contextSeq = useUi((s) => s.guidedControlContextSeq);
  const titleId = useId();
  const rootRef = useRef<HTMLElement>(null);
  const titleRef = useRef<HTMLHeadingElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const contextRef = useRef<HTMLDetailsElement>(null);
  // Dernière demande « montrer le Contexte » traitée (le composant reste monté, liste fermée).
  const handledContextSeq = useRef(contextSeq);

  // Effet du parent : il passe après ceux de l'inspecteur (enfant), dont le bloc de contrôle
  // peut avoir fait défiler la liste. Demande « Contexte » (lien « Profil », `openSection`) :
  // repli ramené en tête de la liste et focalisé ; sinon, focus au titre à l'ouverture.
  useEffect(() => {
    if (!open) return;
    if (contextSeq !== handledContextSeq.current) {
      handledContextSeq.current = contextSeq;
      if (bodyRef.current) bodyRef.current.scrollTop = 0;
      contextRef.current?.querySelector("summary")?.focus({ preventScroll: true });
      return;
    }
    const root = rootRef.current;
    if (root === null || root.contains(document.activeElement)) return;
    titleRef.current?.focus({ preventScroll: true });
  }, [open, contextSeq]);

  if (!open) return null;
  return (
    <section
      ref={rootRef}
      className="control-overlay"
      role="dialog"
      aria-modal="false"
      aria-labelledby={titleId}
    >
      <div className="control-overlay__head">
        <h2 id={titleId} ref={titleRef} className="control-overlay__title" tabIndex={-1}>
          {t.t("ui.compliance.title")}
        </h2>
        <button
          type="button"
          className="btn btn-ghost btn-icon"
          aria-label={t.t("ui.guided.control.close")}
          title={t.t("ui.guided.control.close")}
          onClick={() => {
            closeGuidedControl();
            focusControlOpener();
          }}
        >
          <Icon icon={X} size={16} />
        </button>
      </div>
      <div ref={bodyRef} className="control-overlay__body">
        <details
          ref={contextRef}
          className="control-overlay__context"
          open={context}
          onToggle={(e) => {
            const next = e.currentTarget.open;
            if (next !== context) setGuidedControlContext(next);
          }}
        >
          <summary>{t.t("ui.params.compliance.title")}</summary>
          <div className="control-overlay__context-body">
            <ContextSection display={FREE_DISPLAY} />
          </div>
        </details>
        <Inspector />
      </div>
    </section>
  );
}
