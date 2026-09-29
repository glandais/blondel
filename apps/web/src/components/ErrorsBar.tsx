/**
 * Barre d'erreurs au-dessus des vues : erreurs de génération du modèle (paramètres impossibles,
 * modèle partiel) et **corrections proposées** par le cœur (`suggestFixes`), chacune en bouton.
 * Appliquer une correction fusionne son patch dans le projet (une entrée d'historique : « Annuler »
 * revient en arrière). Les corrections ne sont proposées que pour le projet dont le modèle affiché
 * est issu (pas pendant un calcul).
 */
import type { FixSuggestion } from "@blondel/core";
import { useMemo, useState } from "react";
import { applyFix, fixesFor } from "../lib/fixes.js";
import { appStore, useApp, useModel } from "../store/appStore.js";

/** Nombre d'erreurs affichées avant « … et N autres ». */
const MAX_ERRORS = 4;

function apply(fix: FixSuggestion): string | null {
  const r = appStore.getState().update((p) => applyFix(p, fix));
  appStore.getState().endGroup();
  if (!r.ok) return r.issues[0] ?? "Correction refusée.";
  appStore.setState({
    notice: {
      kind: "info",
      text: `Correction appliquée : ${fix.label}. « Annuler » (Ctrl+Z) pour revenir en arrière.`,
    },
  });
  return null;
}

export function ErrorsBar() {
  const project = useApp((s) => s.project);
  const { model, errors, pending, project: modelProject } = useModel();
  const [failure, setFailure] = useState<string | null>(null);
  const current = modelProject === project && !pending;
  const fixes = useMemo(
    () => (current && model ? fixesFor(project, model) : []),
    [current, model, project],
  );
  if (errors.length === 0 && fixes.length === 0 && failure === null) return null;
  const shown = errors.slice(0, MAX_ERRORS);
  return (
    <section className="errors-bar" aria-label="Erreurs et corrections proposées">
      {errors.length > 0 ? (
        <div className="errors-bar__errors" role="status">
          <strong>
            {errors.length === 1
              ? "Erreur de génération"
              : `${errors.length} erreurs de génération`}
          </strong>
          <ul>
            {shown.map((e) => (
              <li key={e}>{e}</li>
            ))}
            {errors.length > shown.length ? (
              <li className="muted" title={errors.slice(MAX_ERRORS).join("\n")}>
                … et {errors.length - shown.length} autre(s)
              </li>
            ) : null}
          </ul>
        </div>
      ) : null}
      {fixes.length > 0 ? (
        <div className="errors-bar__fixes">
          <strong id="fixes-title">Corrections proposées</strong>
          <ul aria-labelledby="fixes-title">
            {fixes.map((f) => (
              <li key={f.id}>
                <button
                  type="button"
                  data-fix={f.id}
                  title={f.reason}
                  onClick={() => setFailure(apply(f))}
                >
                  {f.label}
                </button>
                <small className="muted">{f.reason}</small>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {failure ? (
        <p className="field__error" role="alert">
          Correction impossible : {failure}{" "}
          <button type="button" className="link" onClick={() => setFailure(null)}>
            Fermer
          </button>
        </p>
      ) : null}
    </section>
  );
}
