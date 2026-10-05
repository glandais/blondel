/**
 * Section « Découpage » : nombre de hauteurs, hauteur et giron cibles, correction de la
 * première hauteur. Les valeurs affichées en mode automatique (et imposées d'un clic) sont
 * lues dans le modèle rendu par le cœur. Répartition par niveau : `Tiered`.
 */
import { useT } from "../../i18n/useT.js";
import { appStore, useApp, useModel } from "../../store/appStore.js";
import type { Path } from "../../store/setIn.js";
import { AutoIntField, IntField } from "../fields.js";
import { Tiered, type SectionProps } from "./Tiered.js";

const set = (path: Path) => (value: unknown) => appStore.getState().setField(path, value);

const finite = (v: number | undefined): number | undefined =>
  v !== undefined && Number.isFinite(v) ? v : undefined;

export function SteppingSection({ display }: SectionProps) {
  const st = useApp((s) => s.project.stair.stepping);
  const helical = useApp((s) => s.project.stair.layout.kind === "helical");
  const { model } = useModel();
  const t = useT();
  // Valeurs retenues par le calcul en mode Auto (modèle rendu par le cœur) ; inconnues sans
  // modèle.
  const riserCount = finite(model?.stepping.riserCount);
  const goingRaw = finite(model?.stepping.going);
  const going = goingRaw === undefined ? undefined : Math.max(1, Math.round(goingRaw));
  return (
    <Tiered
      display={display}
      items={[
        {
          key: "stair.stepping.riserCount",
          node: (
            <AutoIntField
              label={t.t("ui.params.stepping.riserCount")}
              unit=""
              value={st.riserCount}
              computed={riserCount}
              autoText={
                riserCount === undefined
                  ? undefined
                  : t.t("ui.params.stepping.riserCountComputed", { count: riserCount })
              }
              fallback={2}
              min={2}
              max={60}
              onCommit={set(["stair", "stepping", "riserCount"])}
            />
          ),
        },
        {
          key: "stair.stepping.targetRise",
          node: (
            <IntField
              label={t.t("ui.params.stepping.targetRise")}
              value={st.targetRise}
              min={1}
              onCommit={set(["stair", "stepping", "targetRise"])}
            />
          ),
        },
        {
          key: "stair.stepping.targetGoing",
          node: (
            <AutoIntField
              label={t.t("ui.params.stepping.targetGoing.label")}
              value={st.targetGoing}
              computed={going}
              fallback={1}
              min={1}
              hint={
                helical
                  ? t.t("ui.params.stepping.targetGoing.hintHelical")
                  : t.t("ui.params.stepping.targetGoing.hint")
              }
              onCommit={set(["stair", "stepping", "targetGoing"])}
            />
          ),
        },
        {
          key: "stair.stepping.firstRiseOffset",
          node: (
            <IntField
              label={t.t("ui.params.stepping.firstRise.label")}
              hint={t.t("ui.params.stepping.firstRise.hint")}
              value={st.firstRiseOffset}
              onCommit={set(["stair", "stepping", "firstRiseOffset"])}
            />
          ),
        },
      ]}
    />
  );
}
