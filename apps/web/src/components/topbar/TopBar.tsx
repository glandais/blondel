/**
 * Barre du haut du parcours libre (ADR-0009, maquette 1b), 52 px, de gauche à droite :
 *
 * - marque « Blondel » (mise en majuscules par CSS) et filet vertical ;
 * - menu du projet (`ProjectMenu` : renommage, Nouveau, Ouvrir…, démos, préréglages,
 *   Assistant…) ; étiquette « Démo » quand le projet vient d'une démo ;
 * - état de l'autosauvegarde (« ✓ Enregistré », sinon « suspendue » / « indisponible ») ;
 * - segmenté Guidé | Libre (le guidé arrive en vague 5 : option désactivée) ;
 * - au centre, segmenté Conception | Fabrication (`switchWorkspace` : la vue suit, le projet,
 *   l'historique et la sélection ne changent pas) ;
 * - badge « Contrôle », Annuler / Rétablir, Importer, Exporter (en Conception seulement), menu ⋯
 *   (unité, thème, langue, profil d'atelier).
 *
 * En Fabrication, « Exporter » quitte la barre : les sorties (« Générer… », dossier PDF, fiche de
 * pose, liste de débit, autres exports) sont en bas de la colonne de droite (`FabricationAside`).
 *
 * La barre monte aussi la fenêtre du profil d'atelier (pilotée par `uiStore.workshopOpen`) et
 * synchronise le thème (`useThemeSync`), menu ⋯ fermé compris. Les notifications sont rendues
 * au-dessus de la vue (`Notices`).
 */
import { Redo2, Undo2 } from "lucide-react";
import { useT } from "../../i18n/useT.js";
import type { Journey, Workspace } from "../../lib/journey.js";
import { appStore, journeyStore, useApp, useJourney } from "../../store/appStore.js";
import { switchWorkspace } from "../../store/uiStore.js";
import { ExportMenu } from "../ExportMenu.js";
import { ImportMenu } from "../ImportMenu.js";
import { useThemeSync } from "../ThemeToggle.js";
import { Icon } from "../ui/Icon.js";
import { Segmented } from "../ui/Segmented.js";
import { WorkshopDialog } from "../WorkshopDialog.js";
import { ControlBadge } from "./ControlBadge.js";
import { MoreMenu } from "./MoreMenu.js";
import { ProjectMenu } from "./ProjectMenu.js";
import "./topbar.css";

/** Le parcours guidé n'existe qu'à partir de la vague 5 : option visible mais désactivée. */
const GUIDED_AVAILABLE = false;

function AutosaveState() {
  const t = useT();
  const autosaveFailed = useApp((s) => s.autosaveFailed);
  const rejected = useApp((s) => s.rejectedAutosave);
  const suspended = rejected !== null && !rejected.preserved;
  if (!suspended && !autosaveFailed) {
    return (
      <span className="topbar__saved" title={t.t("ui.topbar.saved.title")}>
        {t.t("ui.topbar.saved.label")}
      </span>
    );
  }
  return (
    <>
      {suspended ? (
        <span className="badge badge--warn" role="status">
          {t.t("ui.toolbar.autosave.suspended")}
        </span>
      ) : null}
      {autosaveFailed ? (
        <span className="badge badge--warn" role="status">
          {t.t("ui.toolbar.autosave.unavailable")}
        </span>
      ) : null}
    </>
  );
}

export function TopBar() {
  const t = useT();
  useThemeSync();
  const canUndo = useApp((s) => s.history.past.length > 0);
  const canRedo = useApp((s) => s.history.future.length > 0);
  const demo = useApp((s) => s.lastOpened?.origin === "demo");
  const journey = useJourney((s) => s.journey);
  const workspace = useJourney((s) => s.workspace);
  const st = appStore.getState;

  return (
    <header className="topbar" role="toolbar" aria-label={t.t("ui.toolbar.label")}>
      {/* Groupes de gauche et de droite de même base (flex 1 1 0) : le segmenté Conception |
          Fabrication est centré dans la barre, quel que soit le nom du projet. */}
      <div className="topbar__start">
        <span className="topbar__brand">Blondel</span>
        <span className="topbar__rule" aria-hidden="true" />
        <ProjectMenu />
        {demo ? <span className="tag tag-accent topbar__demo">{t.t("ui.topbar.demo")}</span> : null}
        <AutosaveState />
        <Segmented<Journey>
          label={t.t("ui.topbar.journey.label")}
          size="sm"
          className="journey-switch"
          value={journey}
          options={[
            {
              value: "guided",
              label: t.t("ui.topbar.journey.guided"),
              disabled: !GUIDED_AVAILABLE,
              title: GUIDED_AVAILABLE ? undefined : t.t("ui.topbar.journey.guidedSoon"),
            },
            { value: "free", label: t.t("ui.topbar.journey.free") },
          ]}
          onChange={(v) => journeyStore.getState().setJourney(v)}
        />
      </div>
      <Segmented<Workspace>
        label={t.t("ui.topbar.workspace.label")}
        size="lg"
        className="workspace-switch"
        value={workspace}
        options={[
          { value: "design", label: t.t("ui.topbar.workspace.design") },
          { value: "fabrication", label: t.t("ui.topbar.workspace.fabrication") },
        ]}
        onChange={switchWorkspace}
      />
      <div className="topbar__actions">
        <ControlBadge />
        <div className="topbar__history">
          <button
            type="button"
            className="btn btn-secondary btn-icon"
            onClick={() => st().undo()}
            disabled={!canUndo}
            aria-label={t.t("ui.toolbar.undo.title")}
            title={t.t("ui.toolbar.undo.title")}
          >
            <Icon icon={Undo2} size={18} />
          </button>
          <button
            type="button"
            className="btn btn-secondary btn-icon"
            onClick={() => st().redo()}
            disabled={!canRedo}
            aria-label={t.t("ui.toolbar.redo.title")}
            title={t.t("ui.toolbar.redo.title")}
          >
            <Icon icon={Redo2} size={18} />
          </button>
        </div>
        <ImportMenu />
        {workspace === "design" ? <ExportMenu /> : null}
        <MoreMenu />
      </div>
      <WorkshopDialog />
    </header>
  );
}
