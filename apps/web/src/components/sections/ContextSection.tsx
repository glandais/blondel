/**
 * Section « Contexte de contrôle » : usage (liste, mêmes usages que l'assistant), autres
 * contextes cumulés (hors usages et contextes déduits par le moteur de règles), profil, date de
 * référence, nombre de surcharges de règles (toujours affiché). Pas d'étape guidée : réglé par
 * l'assistant, modifiable depuis le contrôle. Répartition par niveau : `Tiered`.
 */
import { contextLabel, DEDUCED_ONLY_CONTEXTS, RULE_TABLE } from "@blondel/core";
import { useT } from "../../i18n/useT.js";
import { PRIMARY_USAGE_CONTEXTS, USAGES, usageOf, withUsage } from "../../lib/assistant.js";
import { appStore, useApp } from "../../store/appStore.js";
import type { Path } from "../../store/setIn.js";
import { CheckField, SelectField, TextField } from "../fields.js";
import { Tiered, type SectionProps } from "./Tiered.js";

const set = (path: Path) => (value: unknown) => appStore.getState().setField(path, value);

/** Contextes saisissables par une case : ceux de la table des règles, hors usages et déduits. */
const EDITABLE_CONTEXTS = Object.keys(RULE_TABLE.contextes).filter(
  (k) => !DEDUCED_ONLY_CONTEXTS.has(k) && !PRIMARY_USAGE_CONTEXTS.has(k),
);

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
                  label={key.replace(/_/g, " ")}
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
          // Compteur toujours présent ; le lien vers la liste (inspecteur Règle) vient avec les
          // inspecteurs (vague 3).
          key: "compliance.overrides",
          node: (
            <p className="muted">
              {t.t("ui.params.compliance.overrides", { count: c.overrides.length })}
            </p>
          ),
        },
      ]}
    />
  );
}
