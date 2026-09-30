/**
 * Barre d'erreurs au-dessus des vues : erreurs de génération du modèle (paramètres impossibles,
 * modèle partiel) et **corrections proposées** par le cœur (`suggestFixes`), chacune en bouton.
 * Appliquer une correction fusionne son patch dans le projet (une entrée d'historique : « Annuler »
 * revient en arrière). Les corrections ne sont proposées que pour le projet dont le modèle affiché
 * est issu (pas pendant un calcul).
 */
import type { FixSuggestion } from "@blondel/core";
import { msg, type Message } from "@blondel/i18n";
import { useMemo, useState } from "react";
import { useT } from "../i18n/useT.js";
import { applyFix, fixesFor } from "../lib/fixes.js";
import { appStore, useApp, useModel } from "../store/appStore.js";

/** Nombre d'erreurs affichées avant « … et N autres ». */
const MAX_ERRORS = 4;

/** Motif d'un refus : message traduit à l'affichage (il suit un changement de langue). */
type Failure = Message;

function apply(fix: FixSuggestion): Failure | null {
  const r = appStore.getState().update((p) => applyFix(p, fix));
  appStore.getState().endGroup();
  if (!r.ok) return r.issues[0] ?? msg("ui.errors.fixRefused");
  appStore.setState({
    notice: { kind: "info", msg: msg("ui.errors.fixApplied", { label: fix.label }) },
  });
  return null;
}

export function ErrorsBar() {
  const t = useT();
  const project = useApp((s) => s.project);
  const { model, errors, pending, project: modelProject } = useModel();
  const [failure, setFailure] = useState<Failure | null>(null);
  const current = modelProject === project && !pending;
  const fixes = useMemo(
    () => (current && model ? fixesFor(project, model) : []),
    [current, model, project],
  );
  if (errors.length === 0 && fixes.length === 0 && failure === null) return null;
  const shown = errors.slice(0, MAX_ERRORS);
  return (
    <section className="errors-bar" aria-label={t.t("ui.errors.label")}>
      {errors.length > 0 ? (
        <div className="errors-bar__errors" role="status">
          <strong>{t.t("ui.errors.title", { count: errors.length })}</strong>
          <ul>
            {shown.map((e, i) => (
              <li key={i}>{t.t(e)}</li>
            ))}
            {errors.length > shown.length ? (
              <li
                className="muted"
                title={errors
                  .slice(MAX_ERRORS)
                  .map((e) => t.t(e))
                  .join("\n")}
              >
                {t.t("ui.errors.more", { count: errors.length - shown.length })}
              </li>
            ) : null}
          </ul>
        </div>
      ) : null}
      {fixes.length > 0 ? (
        <div className="errors-bar__fixes">
          <strong id="fixes-title">{t.t("ui.errors.fixes")}</strong>
          <ul aria-labelledby="fixes-title">
            {fixes.map((f) => (
              <li key={f.id}>
                <button
                  type="button"
                  data-fix={f.id}
                  title={t.t(f.reason)}
                  onClick={() => setFailure(apply(f))}
                >
                  {t.t(f.label)}
                </button>
                <small className="muted">{t.t(f.reason)}</small>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {failure ? (
        <p className="field__error" role="alert">
          {t.t("ui.errors.failure", {
            reason: failure,
          })}{" "}
          <button type="button" className="link" onClick={() => setFailure(null)}>
            {t.t("ui.errors.close")}
          </button>
        </p>
      ) : null}
    </section>
  );
}
