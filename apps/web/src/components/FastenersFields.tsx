/**
 * Réglages ◆ de la visserie du profil d'atelier (QUESTIONS A27, décision du 2026-10-06), montés
 * dans la section Structure (zone « Réglages d'atelier » du parcours libre, à plat à l'étape 7 du
 * guidé) : un groupe par assemblage présent dans le modèle (`Model.fasteners`), titré par
 * `fastenerJointLabel`, avec nature et classe (listes libellées par le cœur), diamètre (si aucun
 * perçage ne le donne), longueur et quantité par point de fixation ; jeu de perçage, série des
 * diamètres nominaux, entraxe des supports de main courante murale et mur non décrit supposé
 * porteur quand ils servent (`lib/fasteners.ts`).
 *
 * Valeur affichée : valeur effective du profil (`resolveFastenerProfile`, défauts « à valider »
 * compris). Modification : `setField` sur `workshop.fasteners.*` (une entrée d'historique,
 * annulable, validée par le schéma du cœur). Tous ces réglages sont ◆ (`lib/paramTiers.ts`).
 * Sans visserie dans le modèle : rien n'est rendu.
 */
import {
  FASTENER_GRADES,
  FASTENER_KINDS,
  fastenerGradeLabel,
  fastenerJointLabel,
  fastenerKindLabel,
  type FastenerJointKind,
  type FastenerSettingField,
} from "@blondel/core";
import type { ReactNode } from "react";
import { useT } from "../i18n/useT.js";
import {
  BRACKET_SPACING_PATH,
  HOLE_CLEARANCE_PATH,
  NOMINAL_DIAMETERS_INVALID,
  NOMINAL_DIAMETERS_PATH,
  UNKNOWN_WALL_PATH,
  fastenerSettingPath,
  fastenerSettingValue,
  fastenerSettingsInModel,
  parseNominalDiameters,
} from "../lib/fasteners.js";
import { paramKey } from "../lib/paramTiers.js";
import { FASTENER_FIELD_LABELS } from "../lib/toValidate.js";
import { appStore, useApp, useModel } from "../store/appStore.js";
import type { UpdateResult } from "../store/projectStore.js";
import { CheckField, NumberField, SelectField, TextField } from "./fields.js";
import { hasVisibleItems, Tiered, type SectionProps, type TieredItem } from "./sections/Tiered.js";
import "./fasteners.css";

const commit =
  (path: readonly string[]) =>
  (value: unknown): UpdateResult =>
    appStore.getState().setField(path, value);

export function FastenersFields({ display }: SectionProps) {
  const t = useT();
  const project = useApp((s) => s.project);
  const { model } = useModel();
  const settings = fastenerSettingsInModel(model);
  const value = (path: readonly string[]): string | number | boolean | undefined =>
    fastenerSettingValue(project, path);
  const num = (path: readonly string[]): number => {
    const v = value(path);
    return typeof v === "number" ? v : Number.NaN;
  };

  const field = (joint: FastenerJointKind, f: FastenerSettingField) => {
    const path = fastenerSettingPath(joint, f);
    const label = t.t(FASTENER_FIELD_LABELS[f]);
    switch (f) {
      case "kind":
        return (
          <SelectField
            label={label}
            value={String(value(path))}
            options={FASTENER_KINDS.map((k) => ({ value: k, label: t.t(fastenerKindLabel(k)) }))}
            onCommit={commit(path)}
          />
        );
      case "grade":
        return (
          <SelectField
            label={label}
            value={String(value(path))}
            options={FASTENER_GRADES.map((g) => ({ value: g, label: t.t(fastenerGradeLabel(g)) }))}
            onCommit={commit(path)}
          />
        );
      case "perPoint":
        return (
          <NumberField label={label} value={num(path)} unit="" min={1} onCommit={commit(path)} />
        );
      default:
        return <NumberField label={label} value={num(path)} min={1} onCommit={commit(path)} />;
    }
  };

  const items: TieredItem[] = [
    ...(settings.holeClearance
      ? [
          {
            key: paramKey(HOLE_CLEARANCE_PATH),
            node: (
              <NumberField
                label={t.t("ui.fasteners.holeClearance")}
                value={num(HOLE_CLEARANCE_PATH)}
                min={0}
                onCommit={commit(HOLE_CLEARANCE_PATH)}
              />
            ),
          },
        ]
      : []),
    ...(settings.holeClearance
      ? [
          {
            key: paramKey(NOMINAL_DIAMETERS_PATH),
            node: (
              <TextField
                label={t.t("ui.fasteners.nominalDiameters")}
                value={String(value(NOMINAL_DIAMETERS_PATH) ?? "")}
                hint={t.t("ui.fasteners.nominalDiameters.hint")}
                onCommit={(text) => {
                  const series = parseNominalDiameters(text);
                  return series === null
                    ? { ok: false, issues: [NOMINAL_DIAMETERS_INVALID] }
                    : appStore.getState().setField(NOMINAL_DIAMETERS_PATH, series);
                }}
              />
            ),
          },
        ]
      : []),
    ...(settings.bracketSpacing
      ? [
          {
            key: paramKey(BRACKET_SPACING_PATH),
            node: (
              <NumberField
                label={t.t("ui.fasteners.bracketSpacing")}
                value={num(BRACKET_SPACING_PATH)}
                min={1}
                onCommit={commit(BRACKET_SPACING_PATH)}
              />
            ),
          },
        ]
      : []),
    ...(settings.unknownWall
      ? [
          {
            key: paramKey(UNKNOWN_WALL_PATH),
            node: (
              <CheckField
                label={t.t("ui.fasteners.unknownWallLoadBearing")}
                hint={t.t("ui.fasteners.unknownWallLoadBearing.hint")}
                checked={value(UNKNOWN_WALL_PATH) === true}
                onCommit={commit(UNKNOWN_WALL_PATH)}
              />
            ),
          },
        ]
      : []),
    ...settings.joints.flatMap(({ joint, fields }) => {
      const group = {
        id: `fasteners-${joint}`,
        render: (children: ReactNode) => (
          <fieldset className="fasteners__joint" data-joint={joint}>
            <legend>{t.t(fastenerJointLabel(joint))}</legend>
            {children}
          </fieldset>
        ),
      };
      return fields.map((f): TieredItem => ({
        key: paramKey(fastenerSettingPath(joint, f)),
        group,
        node: field(joint, f),
      }));
    }),
  ];

  if (!hasVisibleItems(items, display)) return null;
  return (
    <fieldset className="fasteners" data-testid="fasteners-settings">
      <legend>{t.t("ui.fasteners.title")}</legend>
      <p className="muted fasteners__hint">{t.t("ui.fasteners.hint")}</p>
      <Tiered display={display} items={items} />
    </fieldset>
  );
}
