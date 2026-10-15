/**
 * Panneau « Profil d'atelier » (QUESTIONS A14, décision du 2026-09-29 ; CHALLENGE A8) : barème
 * de coût de l'atelier (taux horaire, temps unitaires, prix matière, finition), **séparé du
 * projet** : mémorisé dans ce navigateur (`store/workshopStore.ts`), importé ou exporté en JSON,
 * jamais enregistré dans le `.blondel.json`. Aucune valeur par défaut ; aucun montant n'est
 * affiché ici, et le comparateur ne montre les euros qu'avec un barème complet (règle du cœur).
 *
 * Fenêtre modale native (`<dialog>` : arrière-plan inerte, Échap ferme, focus rendu à l'élément
 * actif à l'ouverture). Sans bouton déclencheur propre : l'ouverture est pilotée par
 * `uiStore.workshopOpen` (`openWorkshopDialog` : menu ⋯ de la barre du haut, lien de
 * l'inspecteur) ; toute fermeture (bouton, Échap, événement `close`) appelle
 * `closeWorkshopDialog`. Monté une seule fois, dans la barre du haut.
 *
 * Réglage du profil d'atelier **du projet** (décision F10 (21), lot « attribution des repères ») :
 * sous le barème, un fieldset distinct « Repérage des pièces (enregistré dans le projet) » porte
 * la tolérance d'identité des pièces repérées (`workshop.identicalPartTolerance`, même champ que
 * la section Structure, `IdenticalToleranceField` : `setField`, une entrée d'historique,
 * annulable), présent sur tout projet (T règle aussi le compte des pièces uniques du comparateur
 * et du chiffrage, bois compris). Seulement quand le modèle a des pièces repérées par identité
 * (mêmes conditions que les lignes de la liste ◆, question (38)) : marque ◆ tant que la valeur
 * effective n'est pas validée (lue sur le projet) et renvoi à la section Structure ; un rappel du
 * représentant d'un repère par règle appliquée dans le modèle (G-Q7, règles lues sur le cœur).
 * L'aide de la tolérance avertit des garde-corps cintrés comparés sur des facettes (G-Q9).
 * Effacer, importer, exporter et l'état du barème ne le touchent pas.
 */
import type { CostRates } from "@blondel/core";
import { useEffect, useId, useRef, useState } from "react";
import { downloadFile } from "../lib/download.js";
import {
  COST_FIELDS,
  ratesFileName,
  effectiveRates,
  missingRequiredRates,
  parseRateInput,
  parseRatesJson,
  ratesToJson,
  withRate,
  type CostFieldInfo,
} from "../lib/workshopRates.js";
import { useApp, useModel, useWorkshop, workshopStore } from "../store/appStore.js";
import { closeWorkshopDialog, useUi } from "../store/uiStore.js";
import { msg, type Locale, type Message } from "@blondel/i18n";
import { numberFormat } from "../i18n/locale.js";
import { useLocale, useT } from "../i18n/useT.js";
import { IdenticalToleranceField, MarkRepresentativeNote } from "./PartMarksFields.js";
import { TvMark } from "./ui/TvMark.js";
import {
  identicalToleranceValidated,
  markRepresentativeRulesInModel,
  partMarksInModel,
} from "../lib/partMarks.js";
import "./workshop.css";

const RATE_FORMAT: Intl.NumberFormatOptions = { maximumFractionDigits: 4, useGrouping: false };
/** Valeur du champ dans la langue d'affichage (relue par `parseRateInput`, virgule ou point). */
const shown = (v: number | undefined, locale: Locale): string =>
  v === undefined ? "" : numberFormat(locale, RATE_FORMAT).format(v);

function RateField({ field, rates }: { field: CostFieldInfo; rates: CostRates }) {
  const id = useId();
  const t = useT();
  const locale = useLocale();
  const value = rates[field.key];
  const [text, setText] = useState(shown(value, locale));
  const [invalid, setInvalid] = useState(false);
  // Valeur changée ailleurs (import, effacement) : champ resynchronisé.
  useEffect(() => {
    setText(shown(value, locale));
    setInvalid(false);
  }, [value, locale]);
  const commit = (): void => {
    const r = parseRateInput(text);
    if (!r.ok) {
      setInvalid(true);
      return;
    }
    setInvalid(false);
    if (r.value !== value) {
      workshopStore
        .getState()
        .setRates(withRate(workshopStore.getState().rates, field.key, r.value));
    }
  };
  return (
    <div className="field">
      <label htmlFor={id}>
        {field.always
          ? t.t(field.labelKey)
          : t.t("ui.workshop.field.byMaterial", { label: msg(field.labelKey) })}
      </label>
      <div className="input-unit">
        <input
          id={id}
          type="text"
          inputMode="decimal"
          value={text}
          placeholder={t.t("ui.workshop.field.empty")}
          aria-invalid={invalid || undefined}
          onChange={(e) => setText(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === "Enter") commit();
          }}
        />
        <span className="input-unit__unit">{t.t(field.unitKey)}</span>
      </div>
      {invalid ? (
        <small className="field__error" role="alert">
          {t.t("ui.workshop.field.invalid")}
        </small>
      ) : null}
    </div>
  );
}

export function WorkshopDialog() {
  const t = useT();
  const rates = useWorkshop((s) => s.rates);
  const project = useApp((s) => s.project);
  const saveFailed = useWorkshop((s) => s.saveFailed);
  const dialog = useRef<HTMLDialogElement>(null);
  const file = useRef<HTMLInputElement>(null);
  const titleId = useId();
  const open = useUi((s) => s.workshopOpen);
  const [message, setMessage] = useState<{ kind: "info" | "error"; text: Message } | null>(null);
  const { model } = useModel();
  // ◆ seulement quand la liste ◆ porte la ligne (pièces repérées par identité, question (38)),
  // un rappel du représentant par règle appliquée dans le modèle (G-Q7) ; validation lue sur le
  // projet (valeur effective courante).
  const marked = partMarksInModel(model);
  const rules = markRepresentativeRulesInModel(model);
  const toleranceTv = marked && !identicalToleranceValidated(project);

  useEffect(() => {
    const d = dialog.current;
    if (!d) return;
    if (open && !d.open) {
      setMessage(null);
      d.showModal();
    } else if (!open && d.open) d.close();
  }, [open]);

  // État lu sur le barème appliqué au comparateur : celui du panneau, complété par un barème
  // porté par le projet ouvert (fichier importé), signalé à part.
  const effective = effectiveRates(project, rates);
  const missing = missingRequiredRates(effective.rates);
  const filled = COST_FIELDS.filter((f) => rates[f.key] !== undefined).length;
  const applied = COST_FIELDS.filter((f) => effective.rates[f.key] !== undefined).length;

  const importFile = async (f: File): Promise<void> => {
    const r = parseRatesJson(await f.text());
    if (!r.ok) {
      setMessage({ kind: "error", text: msg("ui.workshop.importRefused", { error: r.error }) });
      return;
    }
    workshopStore.getState().setRates(r.rates);
    setMessage({
      kind: "info",
      text: msg("ui.workshop.imported", { count: Object.keys(r.rates).length }),
    });
  };

  return (
    <dialog
      ref={dialog}
      className="workshop"
      aria-labelledby={titleId}
      onClose={closeWorkshopDialog}
    >
      {/* Contenu monté seulement fenêtre ouverte : pas de `.notice` ni de `role="status"`
            fantômes dans la page (barre d'erreurs, lecteurs d'écran, sélecteurs e2e). */}
      {open ? (
        <>
          <header className="workshop__header">
            <h2 id={titleId}>{t.t("ui.workshop.title")}</h2>
            <button type="button" onClick={closeWorkshopDialog}>
              {t.t("ui.workshop.close")}
            </button>
          </header>
          <p className="muted">
            {t.t("ui.workshop.intro.before")} <strong>{t.t("ui.workshop.intro.strong")}</strong>{" "}
            {t.t("ui.workshop.intro.after")}
          </p>
          <p className="notice notice--info" role="status" aria-label={t.t("ui.workshop.state")}>
            {missing.length > 0
              ? t.t("ui.workshop.incomplete", {
                  applied: String(applied),
                  total: String(COST_FIELDS.length),
                  fields: missing.map((f) => t.t(f.labelKey).toLowerCase()).join(", "),
                })
              : t.t("ui.workshop.complete")}
          </p>
          {effective.fromProject.length > 0 ? (
            <p
              className="notice notice--info"
              role="note"
              aria-label={t.t("ui.workshop.fromProject.label")}
            >
              {t.t("ui.workshop.fromProject.text", {
                fields: effective.fromProject.map((f) => t.t(f.labelKey).toLowerCase()).join(", "),
              })}
            </p>
          ) : null}
          <form
            className="workshop__fields"
            aria-label={t.t("ui.workshop.form")}
            onSubmit={(e) => e.preventDefault()}
          >
            {COST_FIELDS.map((f) => (
              <RateField key={f.key} field={f} rates={rates} />
            ))}
          </form>
          <fieldset className="part-marks workshop__project" data-testid="workshop-part-marks">
            <legend>{t.t("ui.workshop.marks.legend")}</legend>
            <p className="muted part-marks__hint">
              {t.t("ui.workshop.marks.intro")}
              {marked ? <> {t.t("ui.workshop.marks.alsoInStructure")}</> : null}
            </p>
            <div className={`tiered__item${toleranceTv ? " tiered__item--tv" : ""}`}>
              <IdenticalToleranceField />
              {toleranceTv ? <TvMark className="tiered__mark" /> : null}
            </div>
            {rules.map((rule) => (
              <MarkRepresentativeNote key={rule} rule={rule} />
            ))}
          </fieldset>
          {message ? (
            <p
              className={`notice ${message.kind === "error" ? "notice--error" : "notice--info"}`}
              role={message.kind === "error" ? "alert" : "status"}
            >
              {t.t(message.text)}
            </p>
          ) : null}
          {saveFailed ? (
            <p className="notice notice--error" role="alert">
              {t.t("ui.workshop.saveFailed")}
            </p>
          ) : null}
          <div className="button-row">
            <button type="button" onClick={() => file.current?.click()}>
              {t.t("ui.workshop.import")}
            </button>
            <button
              type="button"
              disabled={filled === 0}
              onClick={() =>
                downloadFile({
                  filename: ratesFileName(t),
                  mime: "application/json",
                  content: ratesToJson(rates),
                })
              }
            >
              {t.t("ui.workshop.export")}
            </button>
            <button
              type="button"
              disabled={filled === 0}
              onClick={() => {
                workshopStore.getState().setRates({});
                setMessage({ kind: "info", text: msg("ui.workshop.cleared") });
              }}
            >
              {t.t("ui.workshop.clear")}
            </button>
            <input
              ref={file}
              type="file"
              accept=".json,application/json"
              hidden
              aria-label={t.t("ui.workshop.file")}
              onChange={(e) => {
                const f = e.target.files?.[0];
                e.target.value = "";
                if (f) void importFile(f);
              }}
            />
          </div>
        </>
      ) : null}
    </dialog>
  );
}
