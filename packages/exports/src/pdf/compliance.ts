/**
 * Pages du contrôle de conception (CHALLENGE P3) : avertissement « indicatif », résultats
 * groupés (violations par sévérité, non évaluées, respectées) avec nature, confiance, source et
 * source secondaire ; l'avertissement est rappelé en tête de chaque page de suite.
 */
import type { Model, RuleResult, Severity } from "@blondel/core";
import type { PdfCanvas, Rgb } from "./canvas.js";
import { INK, MUTED, fr, wrapText, type Frame, type PageDraft } from "./layout.js";

/** Avertissement imprimé en tête du contrôle de conception (CHALLENGE P3). */
export const COMPLIANCE_DISCLAIMER =
  "Contrôle de conception indicatif, ne vaut pas attestation de conformité.";

export const SEVERITY_COLOR: Readonly<Record<Severity, Rgb>> = {
  bloquant: [209, 36, 47],
  avertissement: [232, 134, 12],
  conseil: [191, 135, 0],
};

const NATURE_LABELS: Readonly<Record<string, string>> = {
  reglementaire: "réglementaire",
  normatif: "normatif",
  metier: "métier",
};
const CONFIDENCE_LABELS: Readonly<Record<string, string>> = {
  eleve: "élevée",
  moyen: "moyenne",
  faible: "faible",
};

export interface CompliancePageInfo {
  readonly kind: "compliance";
  readonly title: string;
}

interface Line {
  readonly text: string;
  readonly size: number;
  readonly bold?: boolean;
  readonly color?: Rgb;
  readonly indent?: number;
  /** Espace avant la ligne, mm. */
  readonly before?: number;
}

function measuredText(r: RuleResult): string | undefined {
  const u = r.unit !== undefined && r.unit !== "" ? ` ${r.unit}` : "";
  const parts: string[] = [];
  if (r.measured !== undefined && Number.isFinite(r.measured))
    parts.push(`mesuré ${fr(r.measured, 1)}${u}`);
  if (r.min !== undefined && r.min !== null) parts.push(`min ${fr(r.min, 1)}${u}`);
  if (r.max !== undefined && r.max !== null) parts.push(`max ${fr(r.max, 1)}${u}`);
  return parts.length > 0 ? parts.join(" — ") : undefined;
}

function provenance(r: RuleResult): string {
  const nature = NATURE_LABELS[r.nature] ?? r.nature;
  const conf = CONFIDENCE_LABELS[r.confidence] ?? r.confidence;
  return `Nature : ${nature} — confiance : ${conf} — source : ${r.source}${r.secondarySource ? " (source secondaire : norme payante non lue)" : ""}`;
}

const SEVERITY_TITLES: Readonly<Record<Severity, string>> = {
  bloquant: "Violations bloquantes",
  avertissement: "Avertissements",
  conseil: "Conseils",
};

/** Lignes du contrôle de conception (avant découpage en pages). */
export function complianceLines(
  model: Model,
  c: Pick<PdfCanvas, "textWidth">,
  width: number,
): Line[] {
  const rep = model.compliance;
  const body = 3;
  const small = 2.6;
  const out: Line[] = [];
  const push = (text: string, style: Omit<Line, "text">): void => {
    const indent = style.indent ?? 0;
    wrapText(c, text, style.size, width - indent, style.bold).forEach((t, i) =>
      out.push({ ...style, text: t, ...(i > 0 ? { before: 0 } : {}) }),
    );
  };
  push(COMPLIANCE_DISCLAIMER, { size: 3.4, bold: true, color: SEVERITY_COLOR.bloquant });
  push(
    `Profil ${rep.profile} — règles v${rep.rulesVersion} — contextes : ${rep.contexts.join(", ") || "—"} — ` +
      `${rep.summary.bloquant} bloquant(s), ${rep.summary.avertissement} avertissement(s), ${rep.summary.conseil} conseil(s)`,
    { size: body, color: INK, before: 2 },
  );
  for (const n of rep.notes ?? []) push(`Remarque : ${n}`, { size: small, color: MUTED });
  for (const e of model.errors)
    push(`Erreur de génération : ${e}`, { size: small, color: SEVERITY_COLOR.bloquant });

  const results = rep.results;
  const block = (r: RuleResult, color: Rgb, detailed: boolean): void => {
    push(`${r.ruleId} — ${r.description}`, {
      size: body,
      bold: true,
      color,
      indent: 2,
      before: 1.5,
    });
    if (r.message !== "") push(r.message, { size: body, color: INK, indent: 4 });
    const m = measuredText(r);
    if (detailed && m !== undefined) push(m, { size: small, color: INK, indent: 4 });
    if (r.downgradeReason !== undefined) {
      push(`Sévérité déclarée ${r.declaredSeverity}, rétrogradée : ${r.downgradeReason}`, {
        size: small,
        color: MUTED,
        indent: 4,
      });
    }
    push(provenance(r), { size: small, color: MUTED, indent: 4 });
  };
  for (const s of ["bloquant", "avertissement", "conseil"] as const) {
    const group = results.filter((r) => r.status === "violation" && r.severity === s);
    if (group.length === 0) continue;
    push(`${SEVERITY_TITLES[s]} (${group.length})`, {
      size: 3.6,
      bold: true,
      color: INK,
      before: 4,
    });
    for (const r of group) block(r, SEVERITY_COLOR[s], true);
  }
  const pending = results.filter((r) => r.status === "non-evaluee");
  if (pending.length > 0) {
    push(`Règles non évaluées (${pending.length})`, {
      size: 3.6,
      bold: true,
      color: INK,
      before: 4,
    });
    for (const r of pending) block(r, MUTED, false);
  }
  const ok = results.filter((r) => r.status === "ok");
  if (ok.length > 0) {
    push(`Règles respectées (${ok.length})`, { size: 3.6, bold: true, color: INK, before: 4 });
    for (const r of ok) {
      const m = measuredText(r);
      push(`${r.ruleId} — ${r.description}${m !== undefined ? ` (${m})` : ""}`, {
        size: small,
        color: INK,
        indent: 2,
      });
      push(provenance(r), { size: 2.2, color: MUTED, indent: 4 });
    }
  }
  if (results.length === 0) push("Aucune règle évaluée.", { size: body, color: MUTED, before: 2 });
  return out;
}

const lineHeight = (l: Line): number => l.size * 1.35 + (l.before ?? 0);

/** Hauteur réservée à l'avertissement rappelé en tête des pages de suite, mm. */
const REPEATED_DISCLAIMER_H = 3.4 * 1.35;

export function compliancePages(
  c: Pick<PdfCanvas, "textWidth">,
  model: Model,
  frame: Frame,
): PageDraft<CompliancePageInfo>[] {
  const lines = complianceLines(model, c, frame.w);
  const chunks: Line[][] = [[]];
  let used = 0;
  for (const l of lines) {
    const h = lineHeight(l);
    if (used + h > frame.h && chunks[chunks.length - 1]!.length > 0) {
      chunks.push([]);
      // Pages de suite : l'avertissement rappelé en tête occupe sa hauteur.
      used = REPEATED_DISCLAIMER_H;
    }
    chunks[chunks.length - 1]!.push(l);
    used += h;
  }
  return chunks.map((chunk, i) => ({
    info: {
      kind: "compliance" as const,
      title:
        chunks.length > 1
          ? `Contrôle de conception (${i + 1}/${chunks.length})`
          : "Contrôle de conception",
    },
    draw(cv, f) {
      let y = f.y;
      // L'avertissement est rappelé en tête de chaque page de suite.
      if (i > 0) {
        y += REPEATED_DISCLAIMER_H;
        cv.text(COMPLIANCE_DISCLAIMER, f.x, y - 1, {
          size: 2.6,
          bold: true,
          color: SEVERITY_COLOR.bloquant,
        });
      }
      for (const l of chunk) {
        y += lineHeight(l);
        cv.text(l.text, f.x + (l.indent ?? 0), y - l.size * 0.35, {
          size: l.size,
          color: l.color ?? INK,
          ...(l.bold ? { bold: true } : {}),
        });
      }
    },
  }));
}
