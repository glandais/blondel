/**
 * Fiche du projet de l'inspecteur sans sélection (maquette 2d) : grille de 9 chiffres clés lus
 * dans le projet (H, E) et dans le modèle calculé (hauteurs, 2h + g, reculement, échappée,
 * masse, pièces, classe d'exécution). Aucun calcul métier : lecture et mise en forme seulement ;
 * un chiffre indisponible affiche « – ».
 */
import { fabricatedParts } from "@blondel/core";
import { massNoteFor } from "@blondel/exports";
import type { MessageKey } from "@blondel/i18n";
import { useMemo } from "react";
import { numberFormat } from "../../i18n/locale.js";
import { useT } from "../../i18n/useT.js";
import { bomSummary } from "../../lib/parts.js";
import { executionClassInfo } from "../../lib/precheck.js";
import { formatFigureLength as lengthValue } from "../../lib/units.js";
import { useApp, useModel } from "../../store/appStore.js";

const DASH = "–";

export interface Figure {
  readonly id: string;
  readonly value: string;
  readonly label: string;
}

/** Les 9 chiffres, dans l'ordre de la maquette. */
export function useProjectFigures(): readonly Figure[] {
  const t = useT();
  const locale = t.locale;
  const unit = useApp((s) => s.displayUnit);
  const floorToFloor = useApp((s) => s.project.site.floorToFloor);
  const width = useApp((s) => s.project.stair.layout.width);
  // Profil d'atelier du projet dont le modèle est issu (masses volumiques renseignées).
  const { model, project } = useModel();
  const workshop = project?.workshop;
  const mass = useMemo(
    () => (model ? bomSummary(model.parts, locale, massNoteFor(workshop)).mass : undefined),
    [model, locale, workshop],
  );
  // Pièces fabriquées (`fabricatedParts`) : une poutre en couches empilées compte pour ses
  // couches, une couche composée pour ses planches (QUESTIONS A36 (9)), comme la nomenclature et
  // la masse ; aucun double compte.
  const partCount = useMemo(
    () => (model ? fabricatedParts(model.parts).length : undefined),
    [model],
  );
  const st = model?.stepping;
  const exc = executionClassInfo(model);
  // Symbole d'unité (mm, cm) : invariant, identique dans les deux langues.
  const u = { unit };
  const fig = (id: string, value: string, key: MessageKey, withUnit = false): Figure => ({
    id,
    value,
    label: withUnit ? t.t(key, u) : t.t(key),
  });
  return [
    fig(
      "floorToFloor",
      lengthValue(floorToFloor, unit, locale),
      "ui.inspector.figure.floorToFloor",
      true,
    ),
    fig("width", lengthValue(width, unit, locale), "ui.inspector.figure.width", true),
    fig("riserCount", st ? String(st.riserCount) : DASH, "ui.inspector.figure.riserCount"),
    fig("blondel", lengthValue(st?.blondel, unit, locale), "ui.inspector.figure.blondel", true),
    fig("run", lengthValue(st?.run, unit, locale), "ui.inspector.figure.run", true),
    fig(
      "headroom",
      model?.headroomUnlimited?.walkline
        ? t.t("ui.inspector.figure.unlimited")
        : lengthValue(model?.headroom?.min, unit, locale),
      "ui.inspector.figure.headroom",
      true,
    ),
    fig(
      "mass",
      mass === undefined || !Number.isFinite(mass)
        ? DASH
        : t.t("ui.inspector.figure.massValue", {
            value: numberFormat(locale, { maximumFractionDigits: 0 }).format(mass),
          }),
      "ui.inspector.figure.mass",
    ),
    fig("parts", partCount !== undefined ? String(partCount) : DASH, "ui.inspector.figure.parts"),
    fig("executionClass", exc?.value ?? DASH, "ui.inspector.figure.executionClass"),
  ];
}

export function ProjectFigures() {
  const t = useT();
  const figures = useProjectFigures();
  return (
    <dl className="project-figures" aria-label={t.t("ui.inspector.figures.label")}>
      {figures.map((f) => (
        <div key={f.id} className="project-figures__cell" data-figure={f.id}>
          <dt>{f.label}</dt>
          <dd>{f.value}</dd>
        </div>
      ))}
    </dl>
  );
}
