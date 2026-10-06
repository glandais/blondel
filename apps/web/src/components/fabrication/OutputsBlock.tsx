/**
 * Pied « Sorties » de la colonne de droite du mode Fabrication (wireframe « Parcours libre ·
 * Fabrication » : « Exporter » est remplacé par « Générer… », les sorties font partie de
 * l'écran ; étape 7 de la spécification de contenu) :
 *
 * - « Dossier PDF » et son bouton « Générer… » (primaire tant que le formulaire est replié,
 *   l'action primaire devient ensuite « Générer le dossier »), qui déplie le formulaire : Format
 *   A4 | A3, Gabarits 1:1 (Tous | Limons et structure | Marches | Garde-corps | Aucun ; une
 *   famille sans développé est désactivée avec son motif), « Générer le dossier ». Le nombre de
 *   valeurs ◆ restantes est mentionné, sans jamais bloquer (ADR-0009 point 9) ;
 * - « Fiche de pose (PDF) » et « Liste de débit (CSV) » ;
 * - « Autres exports » (menu `ExportMenu`, tous les exports) ;
 * - « Coût estimé » (`CostEstimate`).
 *
 * Génération : même chemin que le menu « Exporter » (mise en page dans le worker,
 * téléchargement, notification d'erreur en `Message`, état occupé), avec le modèle du projet
 * courant seulement (pendant un calcul, les boutons attendent le résultat).
 */
import type { Model } from "@blondel/core";
import { errorMessage, msg, type MessageKey } from "@blondel/i18n";
import { useId, useState } from "react";
import { useT } from "../../i18n/useT.js";
import {
  buildDossierPdf,
  buildExport,
  dossierPdfJob,
  exportAvailability,
  type DossierTemplates,
  type ExportFile,
  type ExportId,
} from "../../lib/exportFiles.js";
import { useApp, useModel } from "../../store/appStore.js";
import { EXPORT_DEPS, ExportMenu, deliverFiles, notify } from "../ExportMenu.js";
import { Corners } from "../ui/Blueprint.js";
import { Segmented } from "../ui/Segmented.js";
import { CostEstimate } from "./CostEstimate.js";
import { TvMark } from "../ui/TvMark.js";
import { useRemainingCount } from "./useToValidate.js";

/** Format de page du dossier. */
export type DossierFormat = "a4" | "a3";

export const FORMAT_CHOICES: readonly {
  readonly value: DossierFormat;
  readonly label: MessageKey;
}[] = [
  { value: "a4", label: "ui.fabAside.dossier.format.a4" },
  { value: "a3", label: "ui.fabAside.dossier.format.a3" },
];

/** Choix des gabarits 1:1 ; une famille reprend la disponibilité de son dossier filtré. */
export const TEMPLATE_CHOICES: readonly {
  readonly value: DossierTemplates;
  readonly label: MessageKey;
  readonly exportId?: ExportId;
}[] = [
  { value: "all", label: "ui.fabAside.dossier.templates.all" },
  {
    value: "stringers",
    label: "ui.fabAside.dossier.templates.stringers",
    exportId: "pdf-stringers",
  },
  { value: "treads", label: "ui.fabAside.dossier.templates.treads", exportId: "pdf-treads" },
  { value: "guards", label: "ui.fabAside.dossier.templates.guards", exportId: "pdf-guards" },
  { value: "none", label: "ui.fabAside.dossier.templates.none" },
];

/**
 * Motif d'indisponibilité d'un choix de gabarits (`exportAvailability` du dossier filtré : une
 * famille sans développé), `undefined` s'il est disponible. Sans modèle, tous les choix restent
 * ouverts : c'est le bouton « Générer le dossier » qui attend le calcul.
 */
export function templateChoiceReason(
  value: DossierTemplates,
  model: Model | null,
): MessageKey | undefined {
  const id = TEMPLATE_CHOICES.find((c) => c.value === value)?.exportId;
  if (id === undefined || model === null) return undefined;
  const a = exportAvailability(id, model);
  return a.ok ? undefined : a.reason;
}

export function OutputsBlock() {
  const t = useT();
  const formId = useId();
  const [open, setOpen] = useState(false);
  const [format, setFormat] = useState<DossierFormat>("a4");
  const [templates, setTemplates] = useState<DossierTemplates>("all");
  const [busy, setBusy] = useState(false);
  const remaining = useRemainingCount();
  const project = useApp((s) => s.project);
  const view = useModel();
  // Modèle d'un projet antérieur pendant un calcul : les sorties attendent le résultat.
  const model = view.project === project ? view.model : null;
  const computing = view.project !== project;

  const run = async (produce: () => Promise<ExportFile[]>): Promise<void> => {
    setBusy(true);
    try {
      deliverFiles(await produce());
    } catch (e) {
      notify("error", msg("ui.export.failed", { error: errorMessage(e) }));
    } finally {
      setBusy(false);
    }
  };

  /** Motif d'indisponibilité d'une sortie du modèle (calcul en cours, modèle absent…). */
  const reasonOf = (id: ExportId): string | undefined => {
    if (computing) return t.t("ui.export.computing");
    const a = exportAvailability(id, model);
    return a.ok ? undefined : t.t(a.reason);
  };

  const templatesReason = templateChoiceReason(templates, model);
  const dossierReason =
    reasonOf("pdf") ?? (templatesReason === undefined ? undefined : t.t(templatesReason));
  const installationReason = reasonOf("installation-pdf");
  const cutlistReason = reasonOf("cutlist-csv");

  return (
    <section className="fab-outputs" aria-label={t.t("ui.fabAside.outputs")}>
      <div className="fab-outputs__dossier">
        <span className="fab-outputs__title">{t.t("ui.fabAside.dossier.title")}</span>
        <button
          type="button"
          className={`btn ${open ? "btn-secondary" : "btn-primary blueprint"} fab-outputs__open`}
          aria-expanded={open}
          aria-controls={formId}
          onClick={() => setOpen((o) => !o)}
        >
          {open ? null : <Corners />}
          {t.t("ui.fabAside.dossier.open")}
        </button>
      </div>
      {open ? (
        <div
          id={formId}
          role="group"
          className="fab-outputs__form"
          aria-label={t.t("ui.fabAside.dossier.form")}
        >
          <div className="fab-outputs__row">
            <span className="fab-outputs__label" aria-hidden="true">
              {t.t("ui.fabAside.dossier.format")}
            </span>
            <Segmented
              label={t.t("ui.fabAside.dossier.format")}
              size="sm"
              value={format}
              options={FORMAT_CHOICES.map((c) => ({ value: c.value, label: t.t(c.label) }))}
              onChange={setFormat}
            />
          </div>
          <div className="fab-outputs__row fab-outputs__row--wrap">
            <span className="fab-outputs__label" aria-hidden="true">
              {t.t("ui.fabAside.dossier.templates")}
            </span>
            <Segmented
              label={t.t("ui.fabAside.dossier.templates")}
              size="sm"
              className="fab-outputs__templates"
              value={templates}
              options={TEMPLATE_CHOICES.map((c) => {
                const reason = templateChoiceReason(c.value, model);
                return {
                  value: c.value,
                  label: t.t(c.label),
                  ...(reason === undefined ? {} : { disabled: true, title: t.t(reason) }),
                };
              })}
              onChange={setTemplates}
            />
          </div>
          <p className="fab-outputs__remaining" data-remaining={remaining}>
            {remaining > 0 ? (
              <>
                <TvMark silent tone="inherit" />{" "}
                {t.t("ui.fabAside.dossier.remaining", { count: remaining })}
              </>
            ) : (
              t.t("ui.fabAside.dossier.validated")
            )}
          </p>
          <button
            type="button"
            className="btn btn-primary fab-outputs__generate"
            disabled={busy || dossierReason !== undefined}
            title={dossierReason}
            onClick={() =>
              void run(() =>
                buildDossierPdf(
                  project,
                  model,
                  dossierPdfJob(format, templates),
                  EXPORT_DEPS,
                  t.locale,
                ),
              )
            }
          >
            {busy ? t.t("ui.export.busy") : t.t("ui.fabAside.dossier.generate")}
          </button>
        </div>
      ) : null}
      <div className="fab-outputs__buttons">
        <button
          type="button"
          className="btn btn-secondary"
          disabled={busy || installationReason !== undefined}
          title={installationReason}
          onClick={() =>
            void run(() => buildExport("installation-pdf", project, model, EXPORT_DEPS, t.locale))
          }
        >
          {t.t("ui.label.export.installationPdf")}
        </button>
        <button
          type="button"
          className="btn btn-secondary"
          disabled={busy || cutlistReason !== undefined}
          title={cutlistReason}
          onClick={() =>
            void run(() => buildExport("cutlist-csv", project, model, EXPORT_DEPS, t.locale))
          }
        >
          {t.t("ui.label.export.cutlistCsv")}
        </button>
        <ExportMenu label={t.t("ui.fabAside.otherExports")} variant="secondary" />
      </div>
      <CostEstimate />
    </section>
  );
}
