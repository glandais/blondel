/**
 * Inspecteur « sans sélection » (maquette 2d, ADR-0009) : fiche du projet (nom, 9 chiffres
 * clés), coût estimé ou lien vers le profil d'atelier, contrôle de conception, ligne du
 * prédimensionnement (ADR-0009 point 8) et mention indicative en pied, toujours visible.
 *
 * Coût : l'inspecteur ne lance jamais de comparaison (le comparateur calcule toutes les
 * variantes) ; barème complet, il mène au comparateur, le coût affiché sur place arrivant avec
 * le mode Fabrication (vague 4).
 */
import { useId, useMemo, useState } from "react";
import { useT } from "../../i18n/useT.js";
import { executionClassInfo, precheckSummary, type PrecheckSummary } from "../../lib/precheck.js";
import { COST_FIELDS, effectiveRates, missingRequiredRates } from "../../lib/workshopRates.js";
import { appStore, useApp, useModel, useWorkshop } from "../../store/appStore.js";
import { openWorkshopDialog, switchWorkspace } from "../../store/uiStore.js";
import { PrecheckPanel } from "../PrecheckPanel.js";
import { ControlSummary } from "./ControlSummary.js";
import { ProjectFigures } from "./ProjectFigures.js";

/**
 * Limons vérifiés et limons qui satisfont les critères bloquants (flèche L/200, contrainte,
 * fréquence) : dénombrement des booléens rendus par `precheckSummary`, aucun critère ici.
 */
export function precheckCounts(summary: PrecheckSummary | null): {
  readonly count: number;
  readonly passed: number;
} {
  const rows = summary?.rows ?? [];
  return {
    count: rows.length,
    passed: rows.filter((r) => r.ok.deflection && r.ok.stress && r.ok.frequency).length,
  };
}

/** Ligne « Coût estimé » : lien vers le profil d'atelier, ou vers le comparateur. */
function CostLine() {
  const t = useT();
  const project = useApp((s) => s.project);
  const rates = useWorkshop((s) => s.rates);
  const applied = useMemo(() => effectiveRates(project, rates).rates, [project, rates]);
  const incomplete = missingRequiredRates(applied).length > 0;
  const filled = COST_FIELDS.filter((f) => applied[f.key] !== undefined).length;
  return (
    <div className="inspector-cost">
      <span className="inspector-cost__label">{t.t("ui.inspector.cost.label")}</span>
      {incomplete ? (
        <button type="button" className="link" onClick={openWorkshopDialog}>
          {t.t("ui.inspector.cost.completeProfile", {
            applied: String(filled),
            total: String(COST_FIELDS.length),
          })}
        </button>
      ) : (
        <button
          type="button"
          className="link"
          onClick={() => {
            switchWorkspace("fabrication");
            appStore.getState().setView("compare");
          }}
        >
          {t.t("ui.inspector.cost.openComparator")}
        </button>
      )}
    </div>
  );
}

/** Ligne repliable du prédimensionnement ; masquée sans limon vérifié ni classe d'exécution. */
function PrecheckLine() {
  const t = useT();
  const id = useId();
  const [open, setOpen] = useState(false);
  const { model } = useModel();
  const summary = useMemo(() => precheckSummary(model), [model]);
  const exc = executionClassInfo(model);
  const { count, passed } = precheckCounts(summary);
  if (!model || (count === 0 && !exc)) return null;
  const allOk = passed === count;
  const parts = [
    ...(exc ? [exc.value] : []),
    ...(count > 0 ? [t.t("ui.inspector.precheck.beams", { count, passed: String(passed) })] : []),
  ];
  return (
    <>
      <button
        type="button"
        className="precheck-line"
        aria-expanded={open}
        aria-controls={open ? `${id}-panel` : undefined}
        onClick={() => setOpen((o) => !o)}
      >
        <span className="precheck-line__title">{t.t("ui.inspector.precheck.title")}</span>
        <span
          className={`precheck-line__summary${count > 0 ? (allOk ? " pc-ok" : " pc-bad") : ""}`}
        >
          {parts.join(" · ")}
          {count > 0 ? (
            <>
              <span aria-hidden="true">{allOk ? " ✓" : " ✗"}</span>
              <span className="visually-hidden">
                {" "}
                {t.t(allOk ? "ui.precheck.status.ok" : "ui.precheck.status.bad")}
              </span>
            </>
          ) : null}
          <span aria-hidden="true">{open ? " ▾" : " ▸"}</span>
        </span>
      </button>
      {open ? <PrecheckPanel id={`${id}-panel`} /> : null}
    </>
  );
}

export function ProjectInspector() {
  const t = useT();
  const name = useApp((s) => s.project.name);
  return (
    <div className="project-inspector">
      <header className="project-inspector__head">
        <span className="eyebrow project-inspector__eyebrow">
          {t.t("ui.inspector.project.eyebrow")}
        </span>
        <h3 className="project-inspector__name">
          {name.trim() === "" ? t.t("ui.topbar.project.untitled") : name}
        </h3>
      </header>
      <ProjectFigures />
      <CostLine />
      <ControlSummary />
      <PrecheckLine />
      <span className="project-inspector__spacer" aria-hidden="true" />
      <p className="inspector-disclaimer">{t.t("ui.compliance.disclaimer")}</p>
    </div>
  );
}
