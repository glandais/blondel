/**
 * Panneau « Garde-corps » (jalon 4) : activation, côtés (jour, extérieur : automatique selon
 * les murs du site, vide ou mur), garde-corps de volée et de trémie, remplissage et ses
 * paramètres, poteaux, main courante, matériau. Édite `Project.guards` ; les valeurs par défaut
 * sont celles du schéma du cœur (`lib/guardsForm.ts`), la validation celle du store.
 *
 * Champs répartis par niveau (`Tiered`, mode d'affichage `display`, tout par défaut) ; les
 * groupes (volée, trémie, remplissage, poteaux, main courante) restent regroupés dans chaque
 * zone. L'aide « à valider » d'un champ vient du dictionnaire des niveaux (`isToValidate`) ;
 * elle disparaît quand la valeur est validée (`Project.validatedValues`).
 */
import type { GuardInfill, GuardSection, GuardsSpec } from "@blondel/core";
import { useRef } from "react";
import {
  GUARD_MATERIAL_OPTIONS,
  INFILL_KINDS,
  INFILL_LABELS,
  SECTION_KIND_LABELS,
  SIDE_MODE_LABELS,
  WALL_SIDES_LABELS,
  defaultGuards,
  infillHasSection,
  infillIsPanel,
  switchInfill,
  switchSection,
} from "../lib/guardsForm.js";
import { isToValidate, paramKey } from "../lib/paramTiers.js";
import { formatDecimal, parseDecimal } from "../lib/units.js";
import { useT } from "../i18n/useT.js";
import type { MessageKey, Translator } from "@blondel/i18n";
import { appStore, useApp, useModel } from "../store/appStore.js";
import { useValidatedKeys } from "./fabrication/useToValidate.js";
import type { Path } from "../store/setIn.js";
import { AutoIntField, CheckField, IntField, NumberField, SelectField } from "./fields.js";
import {
  DISPLAY_ALL,
  Tiered,
  type SectionProps,
  type TieredGroup,
  type TieredItem,
} from "./sections/Tiered.js";

const set = (path: Path) => (value: unknown) => appStore.getState().setField(path, value);
const G: Path = ["guards"];

const options = <K extends string>(labels: Readonly<Record<K, MessageKey>>, t: Translator) =>
  (Object.entries(labels) as [K, MessageKey][]).map(([value, label]) => ({
    value,
    label: t.t(label),
  }));

/**
 * Aide « valeur par défaut à valider » d'un champ ◆ (dictionnaire des niveaux), retirée quand
 * la valeur est validée (`validated` : clés validées du projet, ADR-0009 point 9).
 */
function toValidateHint(
  path: Path,
  t: Translator,
  validated: ReadonlySet<string>,
): { hint?: string } {
  const key = paramKey(path);
  return isToValidate(key) && !validated.has(key) ? { hint: t.t("ui.guards.toValidate") } : {};
}

function SectionEditor({
  legend,
  section,
  path,
}: {
  legend: string;
  section: GuardSection;
  path: Path;
}) {
  const t = useT();
  return (
    <fieldset className="grid-2">
      <legend>{legend}</legend>
      <SelectField
        label={t.t("ui.guards.section.shape")}
        value={section.kind}
        options={options(SECTION_KIND_LABELS, t)}
        onCommit={(kind) => set(path)(switchSection(section, kind))}
      />
      {section.kind === "round" ? (
        <IntField
          label={t.t("ui.guards.section.diameter")}
          value={section.diameter}
          min={1}
          onCommit={set([...path, "diameter"])}
        />
      ) : (
        <>
          <IntField
            label={t.t("ui.guards.section.width")}
            value={section.width}
            min={1}
            onCommit={set([...path, "width"])}
          />
          <IntField
            label={t.t("ui.guards.section.height")}
            value={section.height}
            min={1}
            onCommit={set([...path, "height"])}
          />
        </>
      )}
    </fieldset>
  );
}

/** Élément d'un champ des garde-corps : clé du dictionnaire déduite du chemin. */
function field(path: Path, node: TieredItem["node"], group?: TieredGroup): TieredItem {
  return { key: paramKey(path), node, ...(group === undefined ? {} : { group }) };
}

function infillItems(
  infill: GuardInfill,
  t: Translator,
  g: TieredGroup,
  validated: ReadonlySet<string>,
): (TieredItem | false)[] {
  const base: Path = [...G, "infill"];
  return [
    field(
      [...base, "kind"],
      <SelectField
        label={t.t("ui.guards.infill.kind")}
        value={infill.kind}
        options={INFILL_KINDS.map((k) => ({ value: k, label: t.t(INFILL_LABELS[k]) }))}
        onCommit={(kind) => set(base)(switchInfill(infill, kind))}
      />,
      g,
    ),
    infill.kind === "balusters" &&
      field(
        [...base, "spacing"],
        <IntField
          label={t.t("ui.guards.infill.balusterSpacing")}
          {...toValidateHint([...base, "spacing"], t, validated)}
          value={infill.spacing}
          min={1}
          onCommit={set([...base, "spacing"])}
        />,
        g,
      ),
    (infill.kind === "rails" || infill.kind === "cables") &&
      field(
        [...base, "count"],
        <IntField
          label={
            infill.kind === "rails"
              ? t.t("ui.guards.infill.railCount")
              : t.t("ui.guards.infill.cableCount")
          }
          unit=""
          value={infill.count}
          min={1}
          max={infill.kind === "rails" ? 30 : 40}
          onCommit={set([...base, "count"])}
        />,
        g,
      ),
    infill.kind === "cables" &&
      field(
        [...base, "diameter"],
        <IntField
          label={t.t("ui.guards.infill.cableDiameter")}
          value={infill.diameter}
          min={1}
          onCommit={set([...base, "diameter"])}
        />,
        g,
      ),
    infillHasSection(infill) &&
      field(
        [...base, "section"],
        <SectionEditor
          legend={
            infill.kind === "balusters"
              ? t.t("ui.guards.infill.balusterSection")
              : t.t("ui.guards.infill.railSection")
          }
          section={infill.section}
          path={[...base, "section"]}
        />,
        g,
      ),
    infillIsPanel(infill) &&
      field(
        [...base, "thickness"],
        <IntField
          label={
            infill.kind === "glass"
              ? t.t("ui.guards.infill.glassThickness")
              : t.t("ui.guards.infill.panelThickness")
          }
          {...toValidateHint([...base, "thickness"], t, validated)}
          value={infill.thickness}
          min={1}
          onCommit={set([...base, "thickness"])}
        />,
        g,
      ),
    infillIsPanel(infill) &&
      field(
        [...base, "panelGap"],
        <IntField
          label={t.t("ui.guards.infill.panelGap")}
          value={infill.panelGap}
          min={0}
          onCommit={set([...base, "panelGap"])}
        />,
        g,
      ),
    infill.kind === "perforated" &&
      field(
        [...base, "holeDiameter"],
        <IntField
          label={t.t("ui.guards.infill.holeDiameter")}
          value={infill.holeDiameter}
          min={1}
          onCommit={set([...base, "holeDiameter"])}
        />,
        g,
      ),
    field(
      [...base, "bottomGap"],
      <IntField
        label={t.t("ui.guards.infill.bottomGap.label")}
        hint={t.t("ui.guards.infill.bottomGap.hint")}
        value={infill.bottomGap}
        min={0}
        onCommit={set([...base, "bottomGap"])}
      />,
      g,
    ),
    // Remarque du verre : au niveau du type de remplissage.
    infill.kind === "glass" && {
      key: paramKey([...base, "kind"]),
      id: "infill-glass-note",
      group: g,
      node: <p className="muted">{t.t("ui.guards.infill.glassNote")}</p>,
    },
  ];
}

/** Champs des garde-corps présents, groupés par fieldset (volée, trémie, remplissage…). */
function guardsItems(
  guards: GuardsSpec,
  going: number | undefined,
  walls: number,
  t: Translator,
  validated: ReadonlySet<string>,
): (TieredItem | false)[] {
  const { flight, opening, posts, handrail } = guards;
  const fieldset = (id: string, legend: MessageKey): TieredGroup => ({
    id,
    render: (children) => (
      <fieldset>
        <legend>{t.t(legend)}</legend>
        {children}
      </fieldset>
    ),
  });
  const gFlight = fieldset("flight", "ui.guards.flight.legend");
  const gOpening = fieldset("opening", "ui.guards.opening.legend");
  const gInfill = fieldset("infill", "ui.guards.infill.legend");
  const gPosts = fieldset("posts", "ui.guards.posts.legend");
  const gHandrail = fieldset("handrail", "ui.guards.handrail.legend");
  const F: Path = [...G, "flight"];
  const O: Path = [...G, "opening"];
  const P: Path = [...G, "posts"];
  const H: Path = [...G, "handrail"];
  return [
    // Garde-corps de volée
    field(
      [...F, "enabled"],
      <CheckField
        label={t.t("ui.guards.flight.enabled")}
        checked={flight.enabled}
        onCommit={set([...F, "enabled"])}
      />,
      gFlight,
    ),
    field(
      [...F, "inner"],
      <SelectField
        label={t.t("ui.guards.flight.inner")}
        value={flight.inner}
        options={options(SIDE_MODE_LABELS, t)}
        onCommit={set([...F, "inner"])}
      />,
      gFlight,
    ),
    field(
      [...F, "outer"],
      <SelectField
        label={t.t("ui.guards.flight.outer")}
        value={flight.outer}
        options={options(SIDE_MODE_LABELS, t)}
        onCommit={set([...F, "outer"])}
      />,
      gFlight,
    ),
    {
      // Murs du site pris en compte par les côtés « automatique » : au niveau des côtés.
      key: paramKey([...F, "inner"]),
      id: "flight-walls",
      group: gFlight,
      node: (
        <p className="muted">
          {walls === 0
            ? t.t("ui.guards.flight.noWalls")
            : t.t("ui.guards.flight.walls", { count: walls })}
        </p>
      ),
    },
    field(
      [...F, "height"],
      <IntField
        label={t.t("ui.guards.flight.height.label")}
        hint={t.t("ui.guards.flight.height.hint")}
        value={flight.height}
        min={1}
        onCommit={set([...F, "height"])}
      />,
      gFlight,
    ),
    field(
      [...F, "edgeOffset"],
      <IntField
        label={t.t("ui.guards.flight.edgeOffset")}
        {...toValidateHint([...F, "edgeOffset"], t, validated)}
        value={flight.edgeOffset}
        min={0}
        onCommit={set([...F, "edgeOffset"])}
      />,
      gFlight,
    ),
    // Garde-corps de trémie
    field(
      [...O, "enabled"],
      <CheckField
        label={t.t("ui.guards.opening.enabled")}
        checked={opening.enabled}
        onCommit={set([...O, "enabled"])}
      />,
      gOpening,
    ),
    field(
      [...O, "height"],
      <IntField
        label={t.t("ui.guards.opening.height.label")}
        hint={t.t("ui.guards.opening.height.hint")}
        value={opening.height}
        min={1}
        onCommit={set([...O, "height"])}
      />,
      gOpening,
    ),
    field(
      [...O, "setback"],
      <IntField
        label={t.t("ui.guards.opening.setback")}
        {...toValidateHint([...O, "setback"], t, validated)}
        value={opening.setback}
        min={0}
        onCommit={set([...O, "setback"])}
      />,
      gOpening,
    ),
    // Remplissage
    ...infillItems(guards.infill, t, gInfill, validated),
    // Poteaux
    field(
      [...P, "size"],
      <IntField
        label={t.t("ui.guards.posts.size")}
        {...toValidateHint([...P, "size"], t, validated)}
        value={posts.size}
        min={1}
        onCommit={set([...P, "size"])}
      />,
      gPosts,
    ),
    field(
      [...P, "maxSpacing"],
      <IntField
        label={t.t("ui.guards.posts.maxSpacing")}
        {...toValidateHint([...P, "maxSpacing"], t, validated)}
        value={posts.maxSpacing}
        min={1}
        onCommit={set([...P, "maxSpacing"])}
      />,
      gPosts,
    ),
    field(
      [...P, "cornerAngle"],
      <NumberField
        label={t.t("ui.guards.posts.cornerAngle")}
        unit="°"
        {...toValidateHint([...P, "cornerAngle"], t, validated)}
        value={posts.cornerAngle}
        min={0}
        max={180}
        parse={parseDecimal}
        format={(v) => formatDecimal(v, t.locale)}
        onCommit={set([...P, "cornerAngle"])}
      />,
      gPosts,
    ),
    // Main courante
    field(
      [...H, "section"],
      <SectionEditor
        legend={t.t("ui.guards.handrail.section")}
        section={handrail.section}
        path={[...H, "section"]}
      />,
      gHandrail,
    ),
    field(
      [...H, "height"],
      <IntField
        label={t.t("ui.guards.handrail.height.label")}
        hint={t.t("ui.guards.handrail.height.hint")}
        value={handrail.height}
        min={1}
        onCommit={set([...H, "height"])}
      />,
      gHandrail,
    ),
    field(
      [...H, "wallSides"],
      <SelectField
        label={t.t("ui.guards.handrail.wallSides")}
        value={handrail.wallSides}
        options={options(WALL_SIDES_LABELS, t)}
        onCommit={set([...H, "wallSides"])}
      />,
      gHandrail,
    ),
    field(
      [...H, "extensions", "bottom"],
      <AutoIntField
        label={t.t("ui.guards.handrail.extensionBottom")}
        value={handrail.extensions.bottom}
        computed={going}
        fallback={going ?? 0}
        hint={t.t("ui.guards.handrail.extensionHint")}
        min={0}
        onCommit={set([...H, "extensions", "bottom"])}
      />,
      gHandrail,
    ),
    field(
      [...H, "extensions", "top"],
      <AutoIntField
        label={t.t("ui.guards.handrail.extensionTop")}
        value={handrail.extensions.top}
        computed={going}
        fallback={going ?? 0}
        hint={t.t("ui.guards.handrail.extensionHint")}
        min={0}
        onCommit={set([...H, "extensions", "top"])}
      />,
      gHandrail,
    ),
    field(
      [...H, "wallClearance"],
      <IntField
        label={t.t("ui.guards.handrail.wallClearance")}
        value={handrail.wallClearance}
        min={0}
        onCommit={set([...H, "wallClearance"])}
      />,
      gHandrail,
    ),
    // Matériau et tolérance de détection des murs
    field(
      [...G, "material"],
      <SelectField
        label={t.t("ui.guards.material")}
        {...toValidateHint([...G, "material"], t, validated)}
        value={guards.material}
        options={GUARD_MATERIAL_OPTIONS.map((o) => ({ value: o.value, label: t.t(o.label) }))}
        onCommit={set([...G, "material"])}
      />,
    ),
    field(
      [...G, "wallTolerance"],
      <IntField
        label={t.t("ui.guards.wallTolerance")}
        {...toValidateHint([...G, "wallTolerance"], t, validated)}
        value={guards.wallTolerance}
        min={0}
        onCommit={set([...G, "wallTolerance"])}
      />,
    ),
  ];
}

export function GuardsSection({ display = DISPLAY_ALL }: Partial<SectionProps> = {}) {
  const t = useT();
  const guards = useApp((s) => s.project.guards);
  const walls = useApp((s) => s.project.site.walls.length);
  const { model } = useModel();
  const validated = useValidatedKeys();
  // Derniers garde-corps retirés : restaurés si on les réactive.
  const last = useRef<GuardsSpec | null>(null);
  // Prolongements automatiques de la main courante : un giron nominal (calcul du cœur, lu dans
  // le modèle) ; inconnu sans modèle.
  const modelGoing = model?.stepping.going;
  const going =
    modelGoing !== undefined && Number.isFinite(modelGoing)
      ? Math.max(0, Math.round(modelGoing))
      : undefined;
  return (
    <Tiered
      display={display}
      items={[
        {
          key: "guards",
          node: (
            <CheckField
              label={t.t("ui.guards.enabled")}
              checked={guards !== undefined}
              onCommit={(checked) => {
                if (!checked) {
                  last.current = guards ?? null;
                  return set(G)(undefined);
                }
                return set(G)(last.current ?? defaultGuards());
              }}
            />
          ),
        },
        ...(guards
          ? guardsItems(guards, going, walls, t, validated)
          : [
              {
                key: "guards",
                id: "guards-none",
                node: <p className="muted">{t.t("ui.guards.none")}</p>,
              },
            ]),
      ]}
    />
  );
}
