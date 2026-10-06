/**
 * Section « Site » : hauteur à monter, plancher haut, trémie (Rectangulaire | Tracée | Aucune),
 * murs, revêtements des sols, calque de fond. Contenu seulement (titre et enveloppe :
 * conteneur). Répartition par niveau : `Tiered`.
 *
 * La trémie tracée, les murs et le calque se saisissent sur le plan « Site et saisie » : la
 * section en montre l'état, les actions simples (supprimer un mur, importer un calque) et un
 * lien « Modifier sur le plan ». Toute modification du projet est annulable.
 */
import {
  defaultOpening,
  openingPolygon,
  withOpeningPolygon,
  withoutWall,
  type Opening,
  type Project,
} from "@blondel/core";
import { useRef } from "react";
import { formatNumber } from "../../i18n/locale.js";
import { useT } from "../../i18n/useT.js";
import { appStore, useApp } from "../../store/appStore.js";
import { requestUnderlayImport, type UnderlayImportKind } from "../../store/importQueue.js";
import type { Path } from "../../store/setIn.js";
import { IntField } from "../fields.js";
import { Segmented } from "../ui/Segmented.js";
import { Tiered, type SectionProps, type TieredGroup } from "./Tiered.js";

const set = (path: Path) => (value: unknown) => appStore.getState().setField(path, value);

/** Modification du projet en une entrée d'historique (annulable). */
function commit(recipe: (p: Project) => Project): void {
  appStore.getState().update(recipe);
  appStore.getState().endGroup();
}

/** Ouvre le plan « Site et saisie », où se tracent trémie, murs et calibrage du calque. */
export function showSitePlan(): void {
  appStore.getState().setView("plan");
  appStore.getState().setPlanMode("site");
}

/** Retire un mur (une entrée d'historique, annulable). */
export function removeWall(id: string): void {
  commit((p) => withoutWall(p, id));
}

/** Choix de trémie de la section. */
export type OpeningKind = "rect" | "polygon" | "none";

export function openingKindOf(o: Opening | undefined): OpeningKind {
  if (o === undefined) return "none";
  return o.kind === "rect" ? "rect" : "polygon";
}

/**
 * Trémie rectangulaire proposée quand aucune n'est mémorisée : celle du préréglage
 * (`defaultOpening` du cœur : échappée et jeu latéral des préréglages) ; si le cœur n'en
 * propose pas (dalle assez haute, tracé impossible), valeur provisoire à ajuster : carré de côté
 * E au départ, ou carré circonscrit au cercle R_e d'un hélicoïdal.
 */
export function proposedRectOpening(project: Project): Opening {
  const fromCore = defaultOpening(project);
  if (fromCore !== null) return fromCore;
  const layout = project.stair.layout;
  const origin = project.stair.placement.origin;
  const r = layout.kind === "helical" ? layout.outerRadius : 0;
  return {
    kind: "rect",
    x: layout.kind === "helical" ? Math.round(origin.x) - r : 0,
    y: layout.kind === "helical" ? Math.round(origin.y) - r : 0,
    sizeX: layout.kind === "helical" ? 2 * r : layout.width,
    sizeY: layout.kind === "helical" ? 2 * r : layout.width,
  };
}

/** Trémies quittées, restaurées au retour d'un choix. */
export interface OpeningMemory {
  rect: Opening | null;
  polygon: Opening | null;
}

/**
 * Mémoire des trémies du projet ouvert, hors du composant : la section n'est montée que tant
 * que le panneau libre est ouvert (un clic dans la vue le ferme), la mémoire doit survivre à sa
 * fermeture. Remise à zéro à chaque projet chargé (`lastOpened.seq`).
 */
let openingMemory: { seq: number; memory: OpeningMemory } = {
  seq: -1,
  memory: { rect: null, polygon: null },
};

export function openingMemoryFor(seq: number): OpeningMemory {
  if (openingMemory.seq !== seq) {
    openingMemory = { seq, memory: { rect: null, polygon: null } };
  }
  return openingMemory.memory;
}

/**
 * Applique un choix de trémie ; rend vrai s'il faut montrer le plan « Site et saisie » (trémie
 * convertie en polygone, à reprendre sur le plan).
 *
 * - Aucune : retire la trémie (mémorisée) ;
 * - Rectangulaire : dernière rectangulaire, sinon `proposedRectOpening` ;
 * - Tracée : dernière tracée retirée, sinon conversion de la rectangulaire courante (ou de la
 *   dernière, ou de la proposée) en polygone (`openingPolygon` + `withOpeningPolygon` du cœur).
 */
export function chooseOpeningKind(kind: OpeningKind, memory: OpeningMemory): boolean {
  const project = appStore.getState().project;
  const o = project.site.opening;
  if (openingKindOf(o) === kind) return false;
  if (o !== undefined) memory[o.kind === "rect" ? "rect" : "polygon"] = o;
  switch (kind) {
    case "none":
      set(["site", "opening"])(undefined);
      appStore.getState().endGroup();
      return false;
    case "rect": {
      const restored = memory.rect ?? proposedRectOpening(project);
      set(["site", "opening"])(restored);
      appStore.getState().endGroup();
      return false;
    }
    case "polygon": {
      if (o === undefined && memory.polygon !== null) {
        set(["site", "opening"])(memory.polygon);
        appStore.getState().endGroup();
        return false;
      }
      const source = o ?? memory.rect ?? proposedRectOpening(project);
      const points = openingPolygon(source);
      if (points === null) return false;
      commit((p) => withOpeningPolygon(p, points));
      return true;
    }
  }
}

export function SiteSection({ display }: SectionProps) {
  const site = useApp((s) => s.project.site);
  // Dernières trémies quittées du projet ouvert : restaurées si l'on y revient.
  const openedSeq = useApp((s) => s.lastOpened?.seq ?? 0);
  const dxfInput = useRef<HTMLInputElement>(null);
  const imageInput = useRef<HTMLInputElement>(null);
  const o = site.opening;
  const t = useT();
  const rect: TieredGroup = {
    id: "opening-rect",
    render: (children) => (
      <fieldset className="grid-2">
        <legend>{t.t("ui.params.site.opening.rect")}</legend>
        {children}
      </fieldset>
    ),
  };

  const editOnPlan = (
    <button type="button" className="link site-section__plan-link" onClick={showSitePlan}>
      {t.t("ui.params.site.editOnPlan")}
    </button>
  );

  const importUnderlay = (kind: UnderlayImportKind, file: File | undefined): void => {
    if (!file) return;
    showSitePlan();
    requestUnderlayImport(kind, file);
  };

  const underlay = site.underlay;
  const openingLabel = t.t("ui.label.opening");

  return (
    <Tiered
      display={display}
      items={[
        {
          key: "site.floorToFloor",
          node: (
            <IntField
              label={t.t("ui.label.site.floorToFloor")}
              hint={t.t("ui.label.site.floorToFloor.hint")}
              value={site.floorToFloor}
              min={1}
              onCommit={set(["site", "floorToFloor"])}
            />
          ),
        },
        {
          key: "site.upperSlabThickness",
          node: (
            <IntField
              label={t.t("ui.label.site.upperSlabThickness")}
              hint={t.t("ui.label.site.upperSlabThickness.hint")}
              value={site.upperSlabThickness}
              min={1}
              onCommit={set(["site", "upperSlabThickness"])}
            />
          ),
        },
        // Ordre de la spécification de contenu (§ 3, tableau Site) : revêtements avant la trémie.
        {
          key: "site.lowerFinish",
          node: (
            <IntField
              label={t.t("ui.params.site.lowerFinish")}
              value={site.lowerFinish}
              min={0}
              onCommit={set(["site", "lowerFinish"])}
            />
          ),
        },
        {
          key: "site.upperFinish",
          node: (
            <IntField
              label={t.t("ui.params.site.upperFinish")}
              value={site.upperFinish}
              min={0}
              onCommit={set(["site", "upperFinish"])}
            />
          ),
        },
        {
          key: "site.opening",
          node: (
            <div className="site-section__opening">
              <span className="site-section__label" aria-hidden="true">
                {openingLabel}
              </span>
              <Segmented<OpeningKind>
                label={openingLabel}
                value={openingKindOf(o)}
                size="sm"
                options={[
                  { value: "rect", label: t.t("ui.params.site.opening.kind.rect") },
                  { value: "polygon", label: t.t("ui.params.site.opening.kind.polygon") },
                  { value: "none", label: t.t("ui.params.site.opening.kind.none") },
                ]}
                onChange={(kind) => {
                  if (chooseOpeningKind(kind, openingMemoryFor(openedSeq))) showSitePlan();
                }}
              />
            </div>
          ),
        },
        ...(o?.kind === "rect"
          ? [
              {
                key: "site.opening.x",
                group: rect,
                node: (
                  <IntField
                    label={t.t("ui.label.opening.cornerX")}
                    value={o.x}
                    onCommit={set(["site", "opening", "x"])}
                  />
                ),
              },
              {
                key: "site.opening.y",
                group: rect,
                node: (
                  <IntField
                    label={t.t("ui.label.opening.cornerY")}
                    value={o.y}
                    onCommit={set(["site", "opening", "y"])}
                  />
                ),
              },
              {
                key: "site.opening.sizeX",
                group: rect,
                node: (
                  <IntField
                    label={t.t("ui.label.opening.sizeX")}
                    value={o.sizeX}
                    min={1}
                    onCommit={set(["site", "opening", "sizeX"])}
                  />
                ),
              },
              {
                key: "site.opening.sizeY",
                group: rect,
                node: (
                  <IntField
                    label={t.t("ui.label.opening.sizeY")}
                    value={o.sizeY}
                    min={1}
                    onCommit={set(["site", "opening", "sizeY"])}
                  />
                ),
              },
            ]
          : []),
        o?.kind === "polygon" && {
          key: "ui:site.openingPolygon",
          node: (
            <p className="muted site-section__traced">
              {t.t("ui.params.site.opening.traced", { count: o.points.length })} {editOnPlan}
            </p>
          ),
        },
        {
          key: "ui:site.walls",
          node: (
            <fieldset className="site-section__walls">
              <legend>{t.t("ui.plan.site.walls", { count: site.walls.length })}</legend>
              {site.walls.length === 0 ? (
                <p className="muted">{t.t("ui.plan.site.walls.none")}</p>
              ) : (
                <ul className="site-section__list">
                  {site.walls.map((w) => (
                    <li key={w.id}>
                      <span className="num">
                        {t.t("ui.plan.site.walls.item", {
                          id: w.id,
                          length: formatNumber(
                            t.locale,
                            Math.round(Math.hypot(w.b.x - w.a.x, w.b.y - w.a.y)),
                          ),
                          thickness: String(w.thickness),
                        })}
                      </span>
                      <button
                        type="button"
                        className="btn btn-ghost"
                        onClick={() => removeWall(w.id)}
                        aria-label={t.t("ui.plan.site.walls.delete.label", { id: w.id })}
                      >
                        {t.t("ui.plan.site.walls.delete")}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              {editOnPlan}
            </fieldset>
          ),
        },
        {
          key: "ui:site.underlay",
          node: (
            <fieldset className="site-section__underlay">
              <legend>{t.t("ui.underlay.title")}</legend>
              {underlay?.dxf === undefined && underlay?.image === undefined ? (
                <p className="muted">{t.t("ui.params.site.underlay.none")}</p>
              ) : null}
              {underlay?.dxf !== undefined ? (
                <p className="muted">
                  {t.t("ui.params.site.underlay.dxf", {
                    name: underlay.dxf.name || t.t("ui.underlay.unnamed"),
                  })}
                </p>
              ) : null}
              {underlay?.image !== undefined ? (
                <p className="muted">
                  {t.t("ui.params.site.underlay.image", {
                    name: underlay.image.name || t.t("ui.underlay.unnamed"),
                  })}{" "}
                  <button type="button" className="link" onClick={showSitePlan}>
                    {t.t("ui.params.site.underlay.calibrate")}
                  </button>
                </p>
              ) : null}
              <div className="site-section__actions">
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={() => dxfInput.current?.click()}
                >
                  {t.t("ui.underlay.importDxf")}
                </button>
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={() => imageInput.current?.click()}
                >
                  {t.t("ui.underlay.importImage")}
                </button>
              </div>
              <input
                ref={dxfInput}
                type="file"
                accept=".dxf,application/dxf,image/vnd.dxf"
                hidden
                aria-label={t.t("ui.import.dxfFile")}
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  e.target.value = "";
                  importUnderlay("dxf", file);
                }}
              />
              <input
                ref={imageInput}
                type="file"
                accept="image/png,image/jpeg"
                hidden
                aria-label={t.t("ui.import.imageFile")}
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  e.target.value = "";
                  importUnderlay("image", file);
                }}
              />
            </fieldset>
          ),
        },
      ]}
    />
  );
}
