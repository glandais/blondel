/**
 * Rail des 8 sections du parcours libre (ADR-0009, maquette 1b) : une entrée par section (icône
 * Lucide, libellé, compteur ◆ des valeurs à valider), dans l'ordre de `SECTION_IDS`.
 *
 * Modèle ARIA des onglets à activation **manuelle** : les flèches (haut / bas et gauche /
 * droite), Début et Fin déplacent le focus sans ouvrir ; Entrée ou Espace (clic) ouvrent le
 * panneau de la section, ou le referment si c'est la section ouverte (`panelEvent` « rail »).
 * Un seul arrêt de tabulation : l'entrée ouverte, sinon la première disponible. Sans tournant,
 * « Balancement » est désactivé (`aria-disabled`, sauté par les flèches, clic sans effet).
 *
 * Aucun calcul : les compteurs ◆ viennent du dictionnaire des niveaux (`toValidateCountBySection`).
 */
import type { MessageKey } from "@blondel/i18n";
import { useId, useMemo, useRef, type KeyboardEvent } from "react";
import { useT } from "../../i18n/useT.js";
import { toValidateCountBySection } from "../../lib/paramTiers.js";
import { SECTION_IDS, type SectionId } from "../../lib/sectionIds.js";
import { journeyStore, useApp, useJourney, useModel } from "../../store/appStore.js";
import { SECTION_TITLE_KEYS } from "../sections/index.js";
import { Icon } from "../ui/Icon.js";
import { SECTION_ICONS } from "../ui/sectionIcons.js";
import { nextIndex } from "../ui/Segmented.js";
import "./free.css";

/** Libellé court du rail (« Contexte » au lieu de « Contexte de contrôle »). */
export const RAIL_LABEL_KEYS: Readonly<Record<SectionId, MessageKey>> = {
  ...SECTION_TITLE_KEYS,
  compliance: "ui.rail.compliance",
};

/** Identifiant de l'onglet du rail d'une section (nomme le panneau, reçoit le focus rendu). */
export function railTabId(section: SectionId): string {
  return `rail-tab-${section}`;
}

/** Sections indisponibles : le balancement sans tournant. */
export function disabledSections(turnCount: number): ReadonlySet<SectionId> {
  return new Set<SectionId>(turnCount === 0 ? ["balancing"] : []);
}

/** Entrée qui porte l'arrêt de tabulation : l'ouverte si disponible, sinon la première disponible. */
export function railTabStop(open: SectionId | null, disabled: ReadonlySet<SectionId>): number {
  if (open !== null && !disabled.has(open)) return SECTION_IDS.indexOf(open);
  return SECTION_IDS.findIndex((s) => !disabled.has(s));
}

/** Entrée atteinte depuis `current` par une touche (flèches, Début, Fin), `null` sinon. */
export function railKeyTarget(
  current: number,
  key: string,
  disabled: ReadonlySet<SectionId>,
): number | null {
  return nextIndex(
    current,
    key,
    SECTION_IDS.map((s) => disabled.has(s)),
  );
}

export function Rail() {
  const t = useT();
  const project = useApp((s) => s.project);
  const { model } = useModel();
  const open = useJourney((s) => s.freePanel);
  const turnCount = project.stair.layout.turns.length;
  const disabled = useMemo(() => disabledSections(turnCount), [turnCount]);
  const counts = useMemo(() => toValidateCountBySection(project, model), [project, model]);
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const uid = useId();
  const stop = railTabStop(open, disabled);

  const onKeyDown = (e: KeyboardEvent<HTMLButtonElement>, index: number): void => {
    const next = railKeyTarget(index, e.key, disabled);
    if (next === null) return;
    e.preventDefault();
    refs.current[next]?.focus();
  };

  return (
    <nav className="rail" aria-label={t.t("ui.rail.label")}>
      <div
        className="rail__list"
        role="tablist"
        aria-label={t.t("ui.rail.tablist")}
        aria-orientation="vertical"
      >
        {SECTION_IDS.map((id, i) => {
          const off = disabled.has(id);
          const selected = open === id;
          const count = counts[id];
          const countId = `${uid}-${id}-count`;
          return (
            <button
              key={id}
              ref={(el) => {
                refs.current[i] = el;
              }}
              type="button"
              role="tab"
              id={railTabId(id)}
              className="rail__tab"
              aria-controls={selected ? "free-panel" : undefined}
              aria-selected={selected}
              aria-disabled={off ? true : undefined}
              aria-describedby={count > 0 ? countId : undefined}
              title={off ? t.t("ui.rail.balancingDisabled") : undefined}
              tabIndex={i === stop ? 0 : -1}
              onClick={() => {
                if (off) return;
                journeyStore.getState().panelEvent({ type: "rail", section: id });
              }}
              onKeyDown={(e) => onKeyDown(e, i)}
            >
              <Icon icon={SECTION_ICONS[id]} size={20} />
              <span className="rail__label">{t.t(RAIL_LABEL_KEYS[id])}</span>
              <span className="rail__count tv-mark num" aria-hidden="true">
                {count > 0 ? `◆ ${count}` : null}
              </span>
            </button>
          );
        })}
      </div>
      {/* Descriptions des compteurs, hors des onglets : leur nom reste le libellé seul. */}
      {SECTION_IDS.map((id) =>
        counts[id] > 0 ? (
          <span key={id} id={`${uid}-${id}-count`} className="visually-hidden">
            {t.t("ui.sections.toValidateCount", { count: counts[id] })}
          </span>
        ) : null,
      )}
    </nav>
  );
}
