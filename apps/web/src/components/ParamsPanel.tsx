/**
 * Panneau de paramètres de l'ancienne interface en trois colonnes : compose les huit sections
 * autonomes (`components/sections/`) dans l'ordre de `SECTION_IDS`, chacune dans une section
 * repliable titrée, en mode « tout afficher ». Aucune valeur n'est calculée ici.
 */
import type { ReactNode } from "react";
import { useT } from "../i18n/useT.js";
import { SECTION_IDS, type SectionId } from "../lib/sectionIds.js";
import { useApp } from "../store/appStore.js";
import { DISPLAY_ALL, SECTION_COMPONENTS, SECTION_TITLE_KEYS } from "./sections/index.js";

function Section({
  title,
  children,
  open = true,
}: {
  title: string;
  children: ReactNode;
  open?: boolean;
}) {
  return (
    <details className="section" open={open}>
      <summary>
        <h2>{title}</h2>
      </summary>
      <div className="section__body">{children}</div>
    </details>
  );
}

/** Sections repliées à l'ouverture (le balancement l'est sans tournant). */
const CLOSED: ReadonlySet<SectionId> = new Set(["guards", "compliance"]);

export function ParamsPanel() {
  const t = useT();
  const hasTurns = useApp((s) => s.project.stair.layout.turns.length > 0);
  return (
    <div className="params">
      {SECTION_IDS.map((id) => {
        const Content = SECTION_COMPONENTS[id];
        const open = id === "balancing" ? hasTurns : !CLOSED.has(id);
        return (
          <Section key={id} title={t.t(SECTION_TITLE_KEYS[id])} open={open}>
            <Content display={DISPLAY_ALL} />
          </Section>
        );
      })}
    </div>
  );
}
