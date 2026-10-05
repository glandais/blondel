/**
 * Messages de l'application, affichés au-dessus de la vue centrale (rendus par la vue, pas par la
 * barre du haut) : notification du store (`notice` : export, import, refus d'une saisie…) et
 * autosauvegarde refusée (copie de secours : Restaurer, Exporter ou Télécharger, Supprimer,
 * Oublier ou Reprendre). Mêmes rôles, mêmes clés et mêmes classes `.notice` que l'ancienne barre
 * d'outils.
 */
import { msg } from "@blondel/i18n";
import { useT } from "../../i18n/useT.js";
import { downloadFile } from "../../lib/download.js";
import { appStore, useApp } from "../../store/appStore.js";
import { rejectedAutosaveFile } from "../../store/persistence.js";
import "./topbar.css";

export function Notices() {
  const t = useT();
  const notice = useApp((s) => s.notice);
  const rejected = useApp((s) => s.rejectedAutosave);
  const st = appStore.getState;
  if (!notice && !rejected) return null;

  return (
    <div className="notices">
      {notice ? (
        <div
          className={`notice notice--${notice.kind}`}
          role={notice.kind === "error" ? "alert" : "status"}
        >
          <span>{t.t(notice.msg)}</span>
          {notice.details && notice.details.length > 0 ? (
            <ul>
              {notice.details.slice(0, 8).map((d, i) => (
                <li key={i}>{t.t(d)}</li>
              ))}
            </ul>
          ) : null}
          <button type="button" className="link" onClick={() => st().clearNotice()}>
            {t.t("ui.toolbar.notice.close")}
          </button>
        </div>
      ) : null}

      {rejected ? (
        <div
          className="notice notice--error"
          role="group"
          aria-label={
            rejected.since === "earlier"
              ? t.t("ui.toolbar.rejected.earlier.label")
              : t.t("ui.toolbar.rejected.startup.label")
          }
        >
          <span>
            {rejected.since === "earlier"
              ? t.t("ui.toolbar.rejected.earlier.text")
              : t.t("ui.toolbar.rejected.startup.text")}
          </span>
          {rejected.since === "earlier" ? (
            <button
              type="button"
              className="link"
              disabled={rejected.restorable !== true}
              title={
                rejected.restorable === true
                  ? t.t("ui.toolbar.rejected.restore.title")
                  : t.t("ui.toolbar.rejected.unreadable", {
                      reason: rejected.reason ?? msg("ui.toolbar.rejected.unknownFormat"),
                    })
              }
              onClick={() => st().restoreRejectedAutosave()}
            >
              {t.t("ui.toolbar.rejected.restore.label")}
            </button>
          ) : null}
          <button
            type="button"
            className="link"
            onClick={() => {
              const f = rejectedAutosaveFile(rejected.text, t);
              downloadFile({ filename: f.filename, mime: "application/json", content: f.text });
            }}
          >
            {rejected.since === "earlier"
              ? t.t("ui.toolbar.rejected.export")
              : t.t("ui.toolbar.rejected.download")}
          </button>
          <button
            type="button"
            className="link"
            onClick={() => {
              st().dismissRejectedAutosave();
              st().clearNotice();
            }}
          >
            {rejected.since === "earlier"
              ? t.t("ui.toolbar.rejected.delete")
              : rejected.preserved
                ? t.t("ui.toolbar.rejected.forget")
                : t.t("ui.toolbar.rejected.resume")}
          </button>
        </div>
      ) : null}
    </div>
  );
}
