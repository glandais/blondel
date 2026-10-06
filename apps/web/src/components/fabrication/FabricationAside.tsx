/**
 * Colonne de droite du mode Fabrication (wireframe « Parcours libre · Fabrication, avec retour
 * vers la Conception », ADR-0009) pour la pièce choisie (sélection partagée : la pièce choisie
 * dans l'inspecteur 2b est celle-ci, et inversement) :
 *
 * - « Réglages d'atelier de la pièce » modifiables sur place (`PartWorkshopSettings`, variante
 *   Fabrication : mêmes chemins du projet que la section Structure, annulables) ;
 * - encart « Forme du … » : ce qui change la forme relève de la Conception ; « ← Ouvrir dans
 *   Conception » repasse en Conception et ouvre le panneau concerné, la pièce restant
 *   sélectionnée (l'inspecteur 2b la montre) ;
 * - sans pièce : invitation à en choisir une ;
 * - « Sorties » (`OutputsBlock`) à la suite, dans la même zone de défilement (les réglages et
 *   l'encart restent entièrement lisibles, même formulaire du dossier ouvert) : dossier PDF,
 *   fiche de pose, liste de débit, autres exports, coût estimé ;
 * - mention « Contrôle de conception indicatif… » toujours visible en pied (la bande de chiffres
 *   affiche la classe d'exécution, issue du contrôle).
 *
 * La place dans la grille vient de styles.css ; aside.css règle l'intérieur (colonne défilante,
 * mention collée en bas).
 */
import { msg } from "@blondel/i18n";
import type { Part } from "@blondel/core";
import { ArrowLeft } from "lucide-react";
import { useT } from "../../i18n/useT.js";
import { partDesignSection, partSettingsFor, partShapeFor } from "../../lib/partSettings.js";
import { selectedPart } from "../../lib/parts.js";
import { journeyStore, useApp, useModel } from "../../store/appStore.js";
import { switchWorkspace } from "../../store/uiStore.js";
import { PartWorkshopSettings } from "../inspector/PartWorkshopSettings.js";
import { SECTION_TITLE_KEYS } from "../sections/index.js";
import { OutputsBlock } from "./OutputsBlock.js";
import "./aside.css";

/**
 * « ← Ouvrir dans Conception » : bascule en Conception puis ouvre le panneau de la section qui
 * porte la forme de la pièce. La sélection n'est pas touchée.
 */
export function openPartInDesign(part: Pick<Part, "category" | "family">): void {
  switchWorkspace("design");
  journeyStore.getState().openFreePanel(partDesignSection(part));
}

/** Encart « Forme du … » et retour vers la Conception. */
function PartShapeCard({ part }: { part: Part }) {
  const t = useT();
  const shape = partShapeFor(part);
  const section = partDesignSection(part);
  return (
    <section className="fab-shape" aria-label={t.t(shape.title)}>
      <h3 className="fab-shape__title">{t.t(shape.title)}</h3>
      <p className="fab-shape__help">{t.t(shape.help)}</p>
      <button
        type="button"
        className="btn btn-ghost fab-shape__open"
        title={t.t("ui.fabAside.openDesign.title", {
          section: msg(SECTION_TITLE_KEYS[section]),
          mark: part.mark,
        })}
        onClick={() => openPartInDesign(part)}
      >
        <ArrowLeft size={13} aria-hidden="true" />
        {t.t("ui.fabAside.openDesign")}
      </button>
    </section>
  );
}

export function FabricationAside() {
  const t = useT();
  const { model } = useModel();
  const selection = useApp((s) => s.selection);
  const part = model ? selectedPart(model, selection?.location) : undefined;
  const settings = part ? partSettingsFor(part) : null;
  return (
    <aside className="fab-aside" aria-label={t.t("ui.fabAside.label")}>
      <div className="fab-aside__body" data-part={part?.id}>
        {part ? (
          <>
            {settings ? (
              <PartWorkshopSettings
                key={part.id}
                part={part}
                settings={settings}
                variant="fabrication"
              />
            ) : null}
            <PartShapeCard part={part} />
          </>
        ) : (
          <p className="fab-aside__empty">{t.t("ui.fabAside.empty")}</p>
        )}
      </div>
      <div className="fab-aside__foot">
        <OutputsBlock />
      </div>
      <p className="fab-aside__disclaimer">{t.t("ui.compliance.disclaimer")}</p>
    </aside>
  );
}
