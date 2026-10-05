/**
 * Section « Marches » : épaisseur, débord de nez, contremarches et leur épaisseur ; puis, quand
 * le plugin de structure courant les a, ses paramètres de marche (essence, matériau des marches,
 * rayon d'arrondi du nez) : même chemin du projet, même validation que dans la section
 * Structure, où ils restent aussi (ADR-0009 point 5). Marches bois sans essence propre au
 * plugin (structure « aucune », acier à marches bois, hélicoïdal à marches bois) : essence du
 * projet `stair.treads.material` (`treadsMaterialApplies`). Répartition par niveau : `Tiered`.
 */
import { DEFAULT_WOOD_MATERIAL, WOOD_MATERIALS, type WoodMaterialId } from "@blondel/core";
import { MATERIAL_KEYS } from "@blondel/exports";
import { useT } from "../../i18n/useT.js";
import { structureParamEntry, treadsMaterialApplies } from "../../lib/paramTiers.js";
import { appStore, useApp } from "../../store/appStore.js";
import type { Path } from "../../store/setIn.js";
import { IntField, SelectField } from "../fields.js";
import {
  NO_STRUCTURE,
  StructureParamError,
  structureParamItem,
  useStructureParamForm,
} from "../StructureSection.js";
import { Tiered, type SectionProps } from "./Tiered.js";

const set = (path: Path) => (value: unknown) => appStore.getState().setField(path, value);

export function TreadsSection({ display }: SectionProps) {
  const treads = useApp((s) => s.project.stair.treads);
  const form = useStructureParamForm();
  const kind = form.plugin?.kind ?? NO_STRUCTURE;
  const t = useT();
  // Paramètres de structure repris ici : ceux que le dictionnaire place aussi dans « Marches »,
  // dans l'ordre de la spécification (matériau / essence, puis rayon de nez).
  const structureFields = form.fields.filter(
    (f) => structureParamEntry(kind, f.path).alsoIn?.includes("treads") === true,
  );
  const isNose = (path: readonly string[]): boolean => path.join(".") === "noseRadius";
  const woodTreads = treadsMaterialApplies(form.plugin ? form.params : undefined);
  return (
    <>
      <Tiered
        display={display}
        items={[
          {
            key: "stair.treads.thickness",
            node: (
              <IntField
                label={t.t("ui.params.treads.thickness")}
                value={treads.thickness}
                min={1}
                onCommit={set(["stair", "treads", "thickness"])}
              />
            ),
          },
          {
            key: "stair.treads.nosing",
            node: (
              <IntField
                label={t.t("ui.params.treads.nosing")}
                value={treads.nosing}
                min={0}
                onCommit={set(["stair", "treads", "nosing"])}
              />
            ),
          },
          {
            key: "stair.treads.risers",
            node: (
              <SelectField
                label={t.t("ui.params.treads.risers.label")}
                value={treads.risers}
                options={[
                  { value: "full", label: t.t("ui.params.treads.risers.full") },
                  { value: "open", label: t.t("ui.params.treads.risers.open") },
                  { value: "none", label: t.t("ui.params.treads.risers.none") },
                ]}
                onCommit={set(["stair", "treads", "risers"])}
              />
            ),
          },
          treads.risers !== "none" && {
            key: "stair.treads.riserThickness",
            node: (
              <IntField
                label={t.t("ui.params.treads.riserThickness")}
                value={treads.riserThickness}
                min={1}
                onCommit={set(["stair", "treads", "riserThickness"])}
              />
            ),
          },
          ...structureFields.filter((f) => !isNose(f.path)).map((f) => structureParamItem(form, f)),
          woodTreads && {
            key: "stair.treads.material",
            node: (
              <SelectField<WoodMaterialId>
                label={t.t("ui.param.material.label")}
                value={treads.material ?? (DEFAULT_WOOD_MATERIAL as WoodMaterialId)}
                options={WOOD_MATERIALS.map((m) => ({ value: m, label: t.t(MATERIAL_KEYS[m]) }))}
                onCommit={set(["stair", "treads", "material"])}
              />
            ),
          },
          ...structureFields.filter((f) => isNose(f.path)).map((f) => structureParamItem(form, f)),
        ]}
      />
      <StructureParamError error={form.error} />
    </>
  );
}
