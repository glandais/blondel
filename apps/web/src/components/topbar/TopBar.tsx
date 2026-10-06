/**
 * Barre du haut (ADR-0009), 52 px. Parcours libre (maquette 1b), de gauche à droite :
 *
 * - marque « Blondel » (mise en majuscules par CSS) et filet vertical ;
 * - menu du projet (`ProjectMenu` : renommage, Nouveau, Ouvrir…, démos, préréglages,
 *   Assistant…) ; étiquette « Démo » quand le projet vient d'une démo ;
 * - état de l'autosauvegarde (« ✓ Enregistré », sinon « suspendue » / « indisponible ») ;
 * - petit segmenté Guidé | Libre ;
 * - au centre, segmenté Conception | Fabrication (`switchWorkspace` : la vue suit, le projet,
 *   l'historique et la sélection ne changent pas) ;
 * - badge « Contrôle », Annuler / Rétablir, Importer, Exporter (en Conception seulement), menu ⋯
 *   (unité, thème, langue, profil d'atelier).
 *
 * En Fabrication, « Exporter » quitte la barre : les sorties (« Générer… », dossier PDF, fiche de
 * pose, liste de débit, autres exports) sont en bas de la colonne de droite (`FabricationAside`).
 *
 * Parcours guidé (maquette 1a) : marque, menu du projet, « Démo », état d'enregistrement, puis à
 * droite le grand segmenté Guidé | Libre, Annuler / Rétablir et ⋯. Ni Conception | Fabrication,
 * ni badge « Contrôle » (le pied du guidé porte les comptes), ni Importer, ni Exporter : l'étape 7
 * en tient lieu, et « Ouvrir… » du menu du projet importe un projet.
 *
 * La bascule de parcours (`journeyStore.setJourney`) ne touche ni au projet, ni à l'historique,
 * ni à la sélection, ni à la vue, ni à l'unité, ni au thème. Les deux variantes partagent le même
 * arbre (rien n'est remonté) : le focus clavier reste sur le segmenté Guidé | Libre.
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

/** Marque, menu du projet, étiquette « Démo » et état d'enregistrement (communs aux parcours). */
function ProjectIdentity() {
  const t = useT();
  const demo = useApp((s) => s.lastOpened?.origin === "demo");
  return (
    <>
      <span className="topbar__brand">Blondel</span>
      <span className="topbar__rule" aria-hidden="true" />
      <ProjectMenu />
      {demo ? <span className="tag tag-accent topbar__demo">{t.t("ui.topbar.demo")}</span> : null}
      <AutosaveState />
    </>
  );
}

/** Segmenté Guidé | Libre : petit en libre, grand en guidé (maquette 1a). */
function JourneySwitch({ guided }: { readonly guided: boolean }) {
  const t = useT();
  const journey = useJourney((s) => s.journey);
  return (
    <Segmented<Journey>
      label={t.t("ui.topbar.journey.label")}
      size={guided ? "md" : "sm"}
      className={guided ? "journey-switch journey-switch--guided" : "journey-switch"}
      value={journey}
      options={[
        { value: "guided", label: t.t("ui.topbar.journey.guided") },
        { value: "free", label: t.t("ui.topbar.journey.free") },
      ]}
      onChange={(v) => journeyStore.getState().setJourney(v)}
    />
  );
}

/** Annuler / Rétablir (boutons icônes 36 × 36, secondaires). */
function HistoryButtons() {
  const t = useT();
  const canUndo = useApp((s) => s.history.past.length > 0);
  const canRedo = useApp((s) => s.history.future.length > 0);
  const st = appStore.getState;
  return (
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
  );
}

export function TopBar() {
  const t = useT();
  useThemeSync();
  const journey = useJourney((s) => s.journey);
  const workspace = useJourney((s) => s.workspace);
  const guided = journey === "guided";

  // Même arbre dans les deux parcours : chaque enfant garde sa place, les éléments propres au
  // libre étant remplacés par `null` à la même position. La bascule Guidé ↔ Libre ne remonte
  // donc ni le segmenté Guidé | Libre (le focus clavier reste sur l'option choisie), ni les
  // actions, ni les menus ouverts. En guidé, le segmenté est poussé à droite par la CSS.
  return (
    <header
      className={guided ? "topbar topbar--guided" : "topbar"}
      role="toolbar"
      aria-label={t.t("ui.toolbar.label")}
    >
      {/* Libre : groupes de gauche et de droite de même base (flex 1 1 0), le segmenté
          Conception | Fabrication est centré dans la barre, quel que soit le nom du projet. */}
      <div className="topbar__start">
        <ProjectIdentity />
        <JourneySwitch guided={guided} />
      </div>
      {guided ? null : (
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
      )}
      <div className="topbar__actions">
        {guided ? null : <ControlBadge />}
        <HistoryButtons />
        {guided ? null : <ImportMenu />}
        {!guided && workspace === "design" ? <ExportMenu /> : null}
        <MoreMenu />
      </div>
      <WorkshopDialog />
    </header>
  );
}
