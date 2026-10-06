/**
 * Section « Contexte de contrôle » : usage (liste, mêmes usages que l'assistant, libellé court du
 * contexte principal et sa description longue en aide), autres
 * contextes cumulés (hors usages et contextes déduits par le moteur de règles ; libellé court du
 * contexte, description longue en aide sous la case), profil, date de
 * référence, nombre de surcharges de règles (toujours affiché ; dès une surcharge, lien vers la
 * liste des surcharges de l'inspecteur, `revealOverrides`). Pas d'étape guidée : réglé par
 * l'assistant, modifiable depuis le contrôle. Répartition par niveau : `Tiered`.
 */
import { contextLabel, contextShortLabel, DEDUCED_ONLY_CONTEXTS, RULE_TABLE } from "@blondel/core";
import { useT } from "../../i18n/useT.js";
import type { Translator } from "@blondel/i18n";
import {
  PRIMARY_USAGE_CONTEXTS,
  USAGES,
  usageOf,
  withUsage,
  type UsageId,
} from "../../lib/assistant.js";
import { appStore, useApp } from "../../store/appStore.js";
import { revealOverrides } from "../../store/uiStore.js";
import type { Path } from "../../store/setIn.js";
import { CheckField, SelectField, TextField } from "../fields.js";
import { Tiered, type SectionProps } from "./Tiered.js";

const set = (path: Path) => (value: unknown) => appStore.getState().setField(path, value);

/** Contextes saisissables par une case : ceux de la table des règles, hors usages et déduits. */
const EDITABLE_CONTEXTS = Object.keys(RULE_TABLE.contextes).filter(
  (k) => !DEDUCED_ONLY_CONTEXTS.has(k) && !PRIMARY_USAGE_CONTEXTS.has(k),
);

/**
 * Aide sous la liste « Usage » : description longue du contexte principal de l'usage choisi
 * (`contextLabel`), comme sous les cases des autres contextes ; aucune pour « Autre ».
 */
function usageHint(usage: UsageId, t: Translator): { hint?: string } {
  const primary = USAGES.find((u) => u.id === usage)?.contexts[0];
  return primary === undefined ? {} : { hint: t.t(contextLabel(primary)) };
}

export function ContextSection({ display }: SectionProps) {
  const c = useApp((s) => s.project.compliance);
  const t = useT();
  return (
    <Tiered
      display={display}
      items={[
        {
          key: "ui:compliance.usage",
          node: (
            <SelectField
              label={t.t("ui.params.compliance.usage.label")}
              {...usageHint(usageOf(c.contexts).usage, t)}
              value={usageOf(c.contexts).usage}
              options={USAGES.map((u) => ({ value: u.id, label: t.t(u.labelKey) }))}
              onCommit={(usage) => set(["compliance", "contexts"])(withUsage(c.contexts, usage))}
            />
          ),
        },
        {
          key: "compliance.contexts",
          node: (
            <fieldset>
              <legend>{t.t("ui.params.compliance.otherContexts")}</legend>
              {EDITABLE_CONTEXTS.map((key) => (
                <CheckField
                  key={key}
                  label={t.t(contextShortLabel(key))}
                  hint={t.t(contextLabel(key))}
                  checked={c.contexts.includes(key)}
                  onCommit={(checked) =>
                    set(["compliance", "contexts"])(
                      checked ? [...c.contexts, key] : c.contexts.filter((x) => x !== key),
                    )
                  }
                />
              ))}
            </fieldset>
          ),
        },
        {
          key: "compliance.profile",
          node: (
            <SelectField
              label={t.t("ui.params.compliance.profile.label")}
              value={c.profile}
              options={[
                { value: "strict", label: t.t("ui.params.compliance.profile.strict") },
                { value: "souple", label: t.t("ui.params.compliance.profile.souple") },
              ]}
              onCommit={set(["compliance", "profile"])}
            />
          ),
        },
        {
          key: "compliance.referenceDate",
          node: (
            <TextField
              label={t.t("ui.params.compliance.referenceDate.label")}
              type="date"
              value={c.referenceDate ?? ""}
              hint={t.t("ui.params.compliance.referenceDate.hint")}
              onCommit={(v) => set(["compliance", "referenceDate"])(v === "" ? undefined : v)}
            />
          ),
        },
        {
          // Compteur toujours présent ; dès une surcharge, c'est un lien vers la liste des
          // surcharges de l'inspecteur « sans sélection » (dépliée, montrée, focalisée).
          key: "compliance.overrides",
          node:
            c.overrides.length > 0 ? (
              <p className="muted">
                <button
                  type="button"
                  className="link context-overrides-link"
                  onClick={revealOverrides}
                >
                  {t.t("ui.params.compliance.overrides", { count: c.overrides.length })}
                </button>
              </p>
            ) : (
              <p className="muted">
                {t.t("ui.params.compliance.overrides", { count: c.overrides.length })}
              </p>
            ),
        },
      ]}
    />
  );
}
