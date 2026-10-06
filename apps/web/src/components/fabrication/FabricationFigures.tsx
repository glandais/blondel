/**
 * Bande de chiffres du mode Fabrication (wireframe « Parcours libre · Fabrication ») :
 * « {n} pièces · {masse} kg · {EXC} · ◆ {n} restantes ». Même lecture du modèle que la fiche du
 * projet de l'inspecteur (`ProjectFigures`) : nombre de pièces, masse totale de la nomenclature,
 * classe d'exécution ; aucun calcul métier. Le dernier élément est un bouton qui ouvre l'onglet
 * « À valider » (sobre quand il ne reste rien à valider). Pendant un calcul, « Calcul… » suit la
 * bande, comme dans la ligne de chiffres de la Conception.
 */
import { massNoteFor } from "@blondel/exports";
import { msg } from "@blondel/i18n";
import { useMemo } from "react";
import { numberFormat } from "../../i18n/locale.js";
import { useT } from "../../i18n/useT.js";
import { bomSummary } from "../../lib/parts.js";
import { executionClassInfo } from "../../lib/precheck.js";
import { appStore, useModel } from "../../store/appStore.js";
import { TvMark } from "../ui/TvMark.js";
import { useRemainingCount } from "./useToValidate.js";

const DASH = "–";

/** Séparateur « · » de la bande : texte réel (lu tel quel, « 102 pièces · 412 kg »). */
function Separator() {
  return (
    <span className="fab-figures__sep" aria-hidden="true">
      {" · "}
    </span>
  );
}

export function FabricationFigures() {
  const t = useT();
  const locale = t.locale;
  // Profil d'atelier du projet dont le modèle est issu (masses volumiques renseignées).
  const { model, project, pending } = useModel();
  const workshop = project?.workshop;
  const mass = useMemo(
    () => (model ? bomSummary(model.parts, locale, massNoteFor(workshop)).mass : undefined),
    [model, locale, workshop],
  );
  const remaining = useRemainingCount();
  const exc = executionClassInfo(model);
  const items: { readonly id: string; readonly text: string }[] = [
    {
      id: "parts",
      text: model ? t.t(msg("ui.fab.figures.parts", { count: model.parts.length })) : DASH,
    },
    {
      id: "mass",
      text:
        mass === undefined || !Number.isFinite(mass)
          ? DASH
          : t.t("ui.fab.figures.mass", {
              mass: numberFormat(locale, { maximumFractionDigits: 0 }).format(mass),
            }),
    },
    { id: "executionClass", text: exc?.value ?? DASH },
  ];
  return (
    <ul className="fab-figures" aria-label={t.t("ui.fab.figures.label")}>
      {items.map((i) => (
        <li key={i.id} data-figure={i.id}>
          {i.text}
          <Separator />
        </li>
      ))}
      <li data-figure="remaining">
        <button
          type="button"
          className={`fab-figures__remaining${remaining > 0 ? " is-pending" : ""}`}
          title={t.t("ui.fab.figures.remaining.open")}
          onClick={() => appStore.getState().setView("validate")}
        >
          <TvMark silent tone="inherit" />{" "}
          {t.t(msg("ui.fab.figures.remaining", { count: remaining }))}
        </button>
      </li>
      {pending ? (
        // Calcul en cours : même texte et même rôle que la ligne de chiffres de la Conception.
        <li className="fab-figures__pending" role="status">
          {t.t("ui.status.pending")}
        </li>
      ) : null}
    </ul>
  );
}
