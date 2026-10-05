/**
 * Section « Site » : hauteur à monter, plancher haut, revêtements des sols, trémie. Contenu
 * seulement (titre et enveloppe : conteneur). Répartition par niveau : `Tiered`.
 */
import { defaultOpening, type Opening } from "@blondel/core";
import { useRef } from "react";
import { useT } from "../../i18n/useT.js";
import { appStore, useApp } from "../../store/appStore.js";
import type { Path } from "../../store/setIn.js";
import { CheckField, IntField } from "../fields.js";
import { Tiered, type SectionProps, type TieredGroup } from "./Tiered.js";

const set = (path: Path) => (value: unknown) => appStore.getState().setField(path, value);

export function SiteSection({ display }: SectionProps) {
  const site = useApp((s) => s.project.site);
  const layout = useApp((s) => s.project.stair.layout);
  const origin = useApp((s) => s.project.stair.placement.origin);
  // Dernière trémie retirée : restaurée si l'on réactive la trémie.
  const lastOpening = useRef<Opening | null>(null);
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
  return (
    <Tiered
      display={display}
      items={[
        {
          key: "site.floorToFloor",
          node: (
            <IntField
              label={t.t("ui.params.site.floorToFloor.label")}
              hint={t.t("ui.params.site.floorToFloor.hint")}
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
              label={t.t("ui.params.site.slab.label")}
              hint={t.t("ui.params.site.slab.hint")}
              value={site.upperSlabThickness}
              min={1}
              onCommit={set(["site", "upperSlabThickness"])}
            />
          ),
        },
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
            <CheckField
              label={t.t("ui.params.site.opening.label")}
              checked={o !== undefined}
              onCommit={(checked) => {
                if (!checked) {
                  lastOpening.current = o ?? null;
                  return set(["site", "opening"])(undefined);
                }
                // Trémie précédente de la session, sinon celle que proposerait le préréglage
                // (`defaultOpening` du cœur : échappée et jeu latéral des préréglages). Si le
                // cœur n'en propose pas (dalle assez haute, tracé impossible), valeur
                // provisoire à ajuster : carré de côté E au départ, ou carré circonscrit au
                // cercle R_e d'un hélicoïdal.
                const r = layout.kind === "helical" ? layout.outerRadius : 0;
                const restored: Opening = lastOpening.current ??
                  defaultOpening(appStore.getState().project) ?? {
                    kind: "rect",
                    x: layout.kind === "helical" ? Math.round(origin.x) - r : 0,
                    y: layout.kind === "helical" ? Math.round(origin.y) - r : 0,
                    sizeX: layout.kind === "helical" ? 2 * r : layout.width,
                    sizeY: layout.kind === "helical" ? 2 * r : layout.width,
                  };
                return set(["site", "opening"])(restored);
              }}
            />
          ),
        },
        ...(o?.kind === "rect"
          ? [
              {
                key: "site.opening.x",
                group: rect,
                node: (
                  <IntField
                    label={t.t("ui.params.site.opening.x")}
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
                    label={t.t("ui.params.site.opening.y")}
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
                    label={t.t("ui.params.site.opening.sizeX")}
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
                    label={t.t("ui.params.site.opening.sizeY")}
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
            <p className="muted">
              {t.t("ui.params.site.opening.polygon", { count: o.points.length })}
            </p>
          ),
        },
      ]}
    />
  );
}
