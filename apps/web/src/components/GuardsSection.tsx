/**
 * Panneau « Garde-corps » (jalon 4) : activation, côtés (jour, extérieur : automatique selon
 * les murs du site, vide ou mur), garde-corps de volée et de trémie, remplissage et ses
 * paramètres, poteaux, main courante, matériau. Édite `Project.guards` ; les valeurs par défaut
 * sont celles du schéma du cœur (`lib/guardsForm.ts`), la validation celle du store.
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
import { formatDecimal, parseDecimal } from "../lib/units.js";
import { appStore, useApp, useModel } from "../store/appStore.js";
import type { Path } from "../store/setIn.js";
import { AutoIntField, CheckField, IntField, NumberField, SelectField } from "./fields.js";

const set = (path: Path) => (value: unknown) => appStore.getState().setField(path, value);
const G: Path = ["guards"];

const options = <K extends string>(labels: Readonly<Record<K, string>>) =>
  (Object.entries(labels) as [K, string][]).map(([value, label]) => ({ value, label }));

const TO_VALIDATE = "Valeur par défaut à valider";

function SectionEditor({
  legend,
  section,
  path,
}: {
  legend: string;
  section: GuardSection;
  path: Path;
}) {
  return (
    <fieldset className="grid-2">
      <legend>{legend}</legend>
      <SelectField
        label="Forme"
        value={section.kind}
        options={options(SECTION_KIND_LABELS)}
        onCommit={(kind) => set(path)(switchSection(section, kind))}
      />
      {section.kind === "round" ? (
        <IntField
          label="Diamètre"
          value={section.diameter}
          min={1}
          onCommit={set([...path, "diameter"])}
        />
      ) : (
        <>
          <IntField
            label="Largeur"
            value={section.width}
            min={1}
            onCommit={set([...path, "width"])}
          />
          <IntField
            label="Hauteur"
            value={section.height}
            min={1}
            onCommit={set([...path, "height"])}
          />
        </>
      )}
    </fieldset>
  );
}

function InfillEditor({ infill }: { infill: GuardInfill }) {
  const base: Path = [...G, "infill"];
  return (
    <fieldset>
      <legend>Remplissage</legend>
      <SelectField
        label="Type"
        value={infill.kind}
        options={INFILL_KINDS.map((k) => ({ value: k, label: INFILL_LABELS[k] }))}
        onCommit={(kind) => set(base)(switchInfill(infill, kind))}
      />
      {infill.kind === "balusters" ? (
        <IntField
          label="Entraxe maximal des balustres"
          hint={TO_VALIDATE}
          value={infill.spacing}
          min={1}
          onCommit={set([...base, "spacing"])}
        />
      ) : null}
      {infill.kind === "rails" || infill.kind === "cables" ? (
        <IntField
          label={infill.kind === "rails" ? "Nombre de lisses" : "Nombre de câbles"}
          unit=""
          value={infill.count}
          min={1}
          max={infill.kind === "rails" ? 30 : 40}
          onCommit={set([...base, "count"])}
        />
      ) : null}
      {infill.kind === "cables" ? (
        <IntField
          label="Diamètre des câbles"
          value={infill.diameter}
          min={1}
          onCommit={set([...base, "diameter"])}
        />
      ) : null}
      {infillHasSection(infill) ? (
        <SectionEditor
          legend={infill.kind === "balusters" ? "Section des balustres" : "Section des lisses"}
          section={infill.section}
          path={[...base, "section"]}
        />
      ) : null}
      {infillIsPanel(infill) ? (
        <>
          <IntField
            label={infill.kind === "glass" ? "Épaisseur du verre" : "Épaisseur du panneau"}
            hint={TO_VALIDATE}
            value={infill.thickness}
            min={1}
            onCommit={set([...base, "thickness"])}
          />
          <IntField
            label="Jeu entre panneaux et poteaux"
            value={infill.panelGap}
            min={0}
            onCommit={set([...base, "panelGap"])}
          />
        </>
      ) : null}
      {infill.kind === "perforated" ? (
        <IntField
          label="Diamètre des perforations"
          value={infill.holeDiameter}
          min={1}
          onCommit={set([...base, "holeDiameter"])}
        />
      ) : null}
      <IntField
        label="Vide sous le remplissage"
        hint="Au-dessus de la ligne des nez (volée) ou du sol fini (trémie)"
        value={infill.bottomGap}
        min={0}
        onCommit={set([...base, "bottomGap"])}
      />
      {infill.kind === "glass" ? (
        <p className="muted">
          Verre : produit (feuilleté, NF DTU 39 P5) et fixations non vérifiés par Blondel.
        </p>
      ) : null}
    </fieldset>
  );
}

function GuardsEditor({ guards, going }: { guards: GuardsSpec; going: number }) {
  const { flight, opening, posts, handrail } = guards;
  const walls = useApp((s) => s.project.site.walls.length);
  return (
    <>
      <fieldset>
        <legend>Garde-corps de volée</legend>
        <CheckField
          label="Garde-corps côté vide"
          checked={flight.enabled}
          onCommit={set([...G, "flight", "enabled"])}
        />
        <SelectField
          label="Côté jour"
          value={flight.inner}
          options={options(SIDE_MODE_LABELS)}
          onCommit={set([...G, "flight", "inner"])}
        />
        <SelectField
          label="Côté extérieur"
          value={flight.outer}
          options={options(SIDE_MODE_LABELS)}
          onCommit={set([...G, "flight", "outer"])}
        />
        <p className="muted">
          {walls === 0
            ? "Aucun mur dans le site : en automatique, les deux côtés sont vides."
            : `${walls} mur(s) dans le site (à tracer dans Plan 2D › « Site et saisie »).`}
        </p>
        <IntField
          label="Hauteur"
          hint="Au-dessus de la ligne des nez, à la verticale du nez"
          value={flight.height}
          min={1}
          onCommit={set([...G, "flight", "height"])}
        />
        <IntField
          label="Axe depuis le bord de l'emmarchement"
          hint={TO_VALIDATE}
          value={flight.edgeOffset}
          min={0}
          onCommit={set([...G, "flight", "edgeOffset"])}
        />
      </fieldset>
      <fieldset>
        <legend>Garde-corps de trémie</legend>
        <CheckField
          label="Garde-corps sur les côtés libres de la trémie"
          checked={opening.enabled}
          onCommit={set([...G, "opening", "enabled"])}
        />
        <IntField
          label="Hauteur"
          hint="Au-dessus du sol fini haut"
          value={opening.height}
          min={1}
          onCommit={set([...G, "opening", "height"])}
        />
        <IntField
          label="Recul depuis le nu de la trémie"
          hint={TO_VALIDATE}
          value={opening.setback}
          min={0}
          onCommit={set([...G, "opening", "setback"])}
        />
      </fieldset>
      <InfillEditor infill={guards.infill} />
      <fieldset>
        <legend>Poteaux</legend>
        <IntField
          label="Côté du poteau carré"
          hint={TO_VALIDATE}
          value={posts.size}
          min={1}
          onCommit={set([...G, "posts", "size"])}
        />
        <IntField
          label="Entraxe maximal"
          hint={TO_VALIDATE}
          value={posts.maxSpacing}
          min={1}
          onCommit={set([...G, "posts", "maxSpacing"])}
        />
        <NumberField
          label="Déviation pour un poteau d'angle"
          unit="°"
          hint={TO_VALIDATE}
          value={posts.cornerAngle}
          min={0}
          max={180}
          parse={parseDecimal}
          format={formatDecimal}
          onCommit={set([...G, "posts", "cornerAngle"])}
        />
      </fieldset>
      <fieldset>
        <legend>Main courante</legend>
        <SectionEditor
          legend="Section"
          section={handrail.section}
          path={[...G, "handrail", "section"]}
        />
        <IntField
          label="Hauteur (main courante murale)"
          hint="Dessus au-dessus du nez ; sur un garde-corps : hauteur du garde-corps"
          value={handrail.height}
          min={1}
          onCommit={set([...G, "handrail", "height"])}
        />
        <SelectField
          label="Mains courantes murales"
          value={handrail.wallSides}
          options={options(WALL_SIDES_LABELS)}
          onCommit={set([...G, "handrail", "wallSides"])}
        />
        <AutoIntField
          label="Prolongement en bas"
          value={handrail.extensions.bottom}
          fallback={going}
          hint="Automatique : un giron"
          min={0}
          onCommit={set([...G, "handrail", "extensions", "bottom"])}
        />
        <AutoIntField
          label="Prolongement en haut"
          value={handrail.extensions.top}
          fallback={going}
          hint="Automatique : un giron"
          min={0}
          onCommit={set([...G, "handrail", "extensions", "top"])}
        />
        <IntField
          label="Dégagement au mur"
          value={handrail.wallClearance}
          min={0}
          onCommit={set([...G, "handrail", "wallClearance"])}
        />
      </fieldset>
      <SelectField
        label="Matériau"
        hint={TO_VALIDATE}
        value={guards.material}
        options={GUARD_MATERIAL_OPTIONS}
        onCommit={set([...G, "material"])}
      />
      <IntField
        label="Tolérance de détection des murs"
        hint={TO_VALIDATE}
        value={guards.wallTolerance}
        min={0}
        onCommit={set([...G, "wallTolerance"])}
      />
    </>
  );
}

export function GuardsSection() {
  const guards = useApp((s) => s.project.guards);
  const { model } = useModel();
  // Derniers garde-corps retirés : restaurés si on les réactive.
  const last = useRef<GuardsSpec | null>(null);
  const going = Math.max(0, Math.round(model?.stepping.going ?? 0));
  return (
    <>
      <CheckField
        label="Garde-corps et mains courantes"
        checked={guards !== undefined}
        onCommit={(checked) => {
          if (!checked) {
            last.current = guards ?? null;
            return set(G)(undefined);
          }
          return set(G)(last.current ?? defaultGuards());
        }}
      />
      {guards ? (
        <GuardsEditor guards={guards} going={Number.isFinite(going) ? going : 0} />
      ) : (
        <p className="muted">
          Aucun garde-corps décrit : les règles de garde-corps et de main courante ne sont pas
          évaluées.
        </p>
      )}
    </>
  );
}
