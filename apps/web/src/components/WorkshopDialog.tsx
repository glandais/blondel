/**
 * Panneau « Profil d'atelier » (QUESTIONS A14, décision du 2026-09-29 ; CHALLENGE A8) : barème
 * de coût de l'atelier (taux horaire, temps unitaires, prix matière, finition), **séparé du
 * projet** : mémorisé dans ce navigateur (`store/workshopStore.ts`), importé ou exporté en JSON,
 * jamais enregistré dans le `.blondel.json`. Aucune valeur par défaut ; aucun montant n'est
 * affiché ici, et le comparateur ne montre les euros qu'avec un barème complet (règle du cœur).
 *
 * Fenêtre modale native (`<dialog>` : arrière-plan inerte, Échap ferme, focus rendu au bouton).
 */
import type { CostRates } from "@blondel/core";
import { useEffect, useId, useRef, useState } from "react";
import { downloadFile } from "../lib/download.js";
import {
  COST_FIELDS,
  RATES_FILE_NAME,
  effectiveRates,
  missingRequiredRates,
  parseRateInput,
  parseRatesJson,
  ratesToJson,
  withRate,
  type CostFieldInfo,
} from "../lib/workshopRates.js";
import { useApp, useWorkshop, workshopStore } from "../store/appStore.js";
import "./workshop.css";

const nf = new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 4, useGrouping: false });
const shown = (v: number | undefined): string => (v === undefined ? "" : nf.format(v));

function RateField({ field, rates }: { field: CostFieldInfo; rates: CostRates }) {
  const id = useId();
  const value = rates[field.key];
  const [text, setText] = useState(shown(value));
  const [invalid, setInvalid] = useState(false);
  // Valeur changée ailleurs (import, effacement) : champ resynchronisé.
  useEffect(() => {
    setText(shown(value));
    setInvalid(false);
  }, [value]);
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
        {field.label}
        {field.always ? "" : " (selon les matériaux)"}
      </label>
      <div className="input-unit">
        <input
          id={id}
          type="text"
          inputMode="decimal"
          value={text}
          placeholder="non renseigné"
          aria-invalid={invalid || undefined}
          onChange={(e) => setText(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === "Enter") commit();
          }}
        />
        <span className="input-unit__unit">{field.unit}</span>
      </div>
      {invalid ? (
        <small className="field__error" role="alert">
          Nombre positif ou nul attendu (vide : non renseigné).
        </small>
      ) : null}
    </div>
  );
}

export function WorkshopDialog() {
  const rates = useWorkshop((s) => s.rates);
  const project = useApp((s) => s.project);
  const saveFailed = useWorkshop((s) => s.saveFailed);
  const dialog = useRef<HTMLDialogElement>(null);
  const file = useRef<HTMLInputElement>(null);
  const titleId = useId();
  const [open, setOpen] = useState(false);
  const [message, setMessage] = useState<{ kind: "info" | "error"; text: string } | null>(null);

  useEffect(() => {
    const d = dialog.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    else if (!open && d.open) d.close();
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
      setMessage({ kind: "error", text: `Import refusé : ${r.error}` });
      return;
    }
    workshopStore.getState().setRates(r.rates);
    setMessage({
      kind: "info",
      text: `Barème importé (${Object.keys(r.rates).length} champ(s)) : il remplace le précédent.`,
    });
  };

  return (
    <>
      <button
        type="button"
        onClick={() => {
          setMessage(null);
          setOpen(true);
        }}
        title="Barème de coût de l'atelier (hors projet) : taux horaire, temps, prix matière"
      >
        Atelier…
      </button>
      <dialog
        ref={dialog}
        className="workshop"
        aria-labelledby={titleId}
        onClose={() => setOpen(false)}
      >
        {/* Contenu monté seulement fenêtre ouverte : pas de `.notice` ni de `role="status"`
            fantômes dans la page (barre d'erreurs, lecteurs d'écran, sélecteurs e2e). */}
        {open ? (
          <>
            <header className="workshop__header">
              <h2 id={titleId}>Profil d'atelier</h2>
              <button type="button" onClick={() => setOpen(false)}>
                Fermer
              </button>
            </header>
            <p className="muted">
              Barème de coût de votre atelier, gardé dans ce navigateur et{" "}
              <strong>séparé du projet</strong> (il n'est pas enregistré dans le fichier du projet).
              Aucune valeur par défaut : Blondel n'a pas de temps d'atelier sourcé. Les euros
              n'apparaissent dans le comparateur qu'avec un barème complet.
            </p>
            <p className="notice notice--info" role="status" aria-label="État du barème">
              {missing.length > 0
                ? `Barème incomplet (${applied} / ${COST_FIELDS.length}) : coûts masqués. À renseigner : ${missing
                    .map((f) => f.label.toLowerCase())
                    .join(", ")}.`
                : "Taux horaire et temps renseignés : coûts affichés dans le comparateur pour les variantes dont les prix matière et de finition sont aussi renseignés."}
            </p>
            {effective.fromProject.length > 0 ? (
              <p className="notice notice--info" role="note" aria-label="Barème du projet ouvert">
                Le projet ouvert porte aussi un barème (fichier importé) : champs vides ici repris
                de ce barème ({effective.fromProject.map((f) => f.label.toLowerCase()).join(", ")}).
              </p>
            ) : null}
            <form
              className="workshop__fields"
              aria-label="Barème de coût"
              onSubmit={(e) => e.preventDefault()}
            >
              {COST_FIELDS.map((f) => (
                <RateField key={f.key} field={f} rates={rates} />
              ))}
            </form>
            {message ? (
              <p
                className={`notice ${message.kind === "error" ? "notice--error" : "notice--info"}`}
                role={message.kind === "error" ? "alert" : "status"}
              >
                {message.text}
              </p>
            ) : null}
            {saveFailed ? (
              <p className="notice notice--error" role="alert">
                Stockage du navigateur indisponible : le barème sera perdu à la fermeture
                (l'exporter).
              </p>
            ) : null}
            <div className="button-row">
              <button type="button" onClick={() => file.current?.click()}>
                Importer (JSON)…
              </button>
              <button
                type="button"
                disabled={filled === 0}
                onClick={() =>
                  downloadFile({
                    filename: RATES_FILE_NAME,
                    mime: "application/json",
                    content: ratesToJson(rates),
                  })
                }
              >
                Exporter (JSON)
              </button>
              <button
                type="button"
                disabled={filled === 0}
                onClick={() => {
                  workshopStore.getState().setRates({});
                  setMessage({ kind: "info", text: "Barème effacé." });
                }}
              >
                Effacer le barème
              </button>
              <input
                ref={file}
                type="file"
                accept=".json,application/json"
                hidden
                aria-label="Fichier de barème d'atelier"
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
    </>
  );
}
