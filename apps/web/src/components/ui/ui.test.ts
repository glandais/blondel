/**
 * Composants de base du système Industry (ADR-0009) : cadre blueprint, contrôle segmenté
 * (rôles ARIA, focus itinérant, navigation au clavier), icônes au trait 1,5 et icônes du rail.
 */
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { Box, Ruler } from "lucide-react";
import { describe, expect, it } from "vitest";
import { SECTION_IDS } from "../../lib/sectionIds.js";
import { Blueprint, Corners } from "./Blueprint.js";
import { Icon } from "./Icon.js";
import { nextIndex, rovingIndex, Segmented } from "./Segmented.js";
import { SECTION_ICONS } from "./sectionIcons.js";

const count = (html: string, re: RegExp) => html.match(re)?.length ?? 0;

describe("Blueprint", () => {
  it("rend la classe .blueprint et quatre repères de coin décoratifs", () => {
    const html = renderToStaticMarkup(
      createElement(Blueprint, { as: "section", className: "x", id: "b" }, "contenu"),
    );
    expect(html.startsWith('<section id="b" class="blueprint x">')).toBe(true);
    expect(count(html, /<i class="corner (tl|tr|bl|br)" aria-hidden="true"><\/i>/g)).toBe(4);
    for (const c of ["tl", "tr", "bl", "br"]) expect(html).toContain(`corner ${c}`);
    expect(html).toContain("contenu");
  });

  it("Corners rend les quatre repères seuls", () => {
    const html = renderToStaticMarkup(createElement(Corners));
    expect(count(html, /class="corner /g)).toBe(4);
  });
});

type V = "plan" | "3d" | "elev";
const OPTIONS = [
  { value: "plan", label: "Plan" },
  { value: "3d", label: "3D", icon: Box },
  { value: "elev", label: "Élévation", disabled: true, title: "Indisponible" },
] as const;

function seg(semantics?: "radio" | "tabs", value: V = "3d"): string {
  return renderToStaticMarkup(
    createElement(Segmented<V>, {
      label: "Vue",
      value,
      options: OPTIONS,
      onChange: () => {},
      ...(semantics ? { semantics } : {}),
      size: "lg",
      idPrefix: "vue",
    }),
  );
}

describe("Segmented", () => {
  it("radio (défaut) : radiogroup nommé, radios avec aria-checked", () => {
    const html = seg();
    expect(html).toContain('role="radiogroup" aria-label="Vue" class="seg seg--lg"');
    expect(count(html, /role="radio"/g)).toBe(3);
    expect(count(html, /aria-checked="true"/g)).toBe(1);
    expect(count(html, /aria-checked="false"/g)).toBe(2);
    expect(html).not.toContain("aria-selected");
    expect(html).toContain('id="vue-3d"');
    expect(html).toContain('title="Indisponible"');
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>Élévation/);
  });

  it("onglets : tablist nommé, onglets avec aria-selected", () => {
    const html = seg("tabs");
    expect(html).toContain('role="tablist" aria-label="Vue"');
    expect(count(html, /role="tab"/g)).toBe(3);
    expect(count(html, /aria-selected="true"/g)).toBe(1);
    expect(html).not.toContain("aria-checked");
  });

  it("focus itinérant : un seul tabIndex 0, sur l'option choisie", () => {
    const html = seg("radio", "3d");
    expect(count(html, /tabindex="0"/g)).toBe(1);
    expect(count(html, /tabindex="-1"/g)).toBe(2);
    expect(html).toMatch(/<button[^>]*aria-checked="true"[^>]*tabindex="0"/);
  });

  it("option choisie désactivée : le focus itinérant va à la première option active", () => {
    expect(rovingIndex(OPTIONS, "elev")).toBe(0);
    expect(rovingIndex(OPTIONS, "3d")).toBe(1);
  });

  it("icône d'option décorative, au trait 1,5", () => {
    const html = seg();
    expect(html).toMatch(/<svg[^>]*aria-hidden="true"/);
    expect(html).toContain('stroke-width="1.5"');
  });

  it("description du groupe (aria-describedby) seulement si elle est fournie", () => {
    expect(seg()).not.toContain("aria-describedby");
    const html = renderToStaticMarkup(
      createElement(Segmented<string>, {
        label: "Parcours",
        value: "a",
        options: [
          { value: "a", label: "A" },
          { value: "b", label: "B", disabled: true, title: "Indisponible ici" },
        ],
        onChange: () => {},
        describedBy: "note-1",
      }),
    );
    expect(html).toContain('role="radiogroup" aria-label="Parcours" aria-describedby="note-1"');
  });
});

describe("nextIndex", () => {
  const none = [false, false, false, false];

  it("flèches : suivante et précédente, en boucle", () => {
    expect(nextIndex(0, "ArrowRight", none)).toBe(1);
    expect(nextIndex(0, "ArrowDown", none)).toBe(1);
    expect(nextIndex(3, "ArrowRight", none)).toBe(0);
    expect(nextIndex(2, "ArrowLeft", none)).toBe(1);
    expect(nextIndex(2, "ArrowUp", none)).toBe(1);
    expect(nextIndex(0, "ArrowLeft", none)).toBe(3);
  });

  it("Début et Fin : extrémités", () => {
    expect(nextIndex(2, "Home", none)).toBe(0);
    expect(nextIndex(1, "End", none)).toBe(3);
  });

  it("options désactivées sautées", () => {
    const d = [true, false, true, false];
    expect(nextIndex(1, "ArrowRight", d)).toBe(3);
    expect(nextIndex(3, "ArrowRight", d)).toBe(1);
    expect(nextIndex(1, "ArrowLeft", d)).toBe(3);
    expect(nextIndex(3, "Home", d)).toBe(1);
    expect(nextIndex(1, "End", d)).toBe(3);
  });

  it("touche non gérée, liste vide ou tout désactivé : null", () => {
    expect(nextIndex(0, "Enter", none)).toBeNull();
    expect(nextIndex(0, "a", none)).toBeNull();
    expect(nextIndex(0, "ArrowRight", [])).toBeNull();
    expect(nextIndex(0, "Home", [true, true])).toBeNull();
  });
});

describe("Icon", () => {
  it("décorative sans libellé : aria-hidden, trait 1,5, taille 20 par défaut", () => {
    const html = renderToStaticMarkup(createElement(Icon, { icon: Ruler }));
    expect(html).toContain('stroke-width="1.5"');
    expect(html).toContain('aria-hidden="true"');
    expect(html).toContain('focusable="false"');
    expect(html).toContain('width="20"');
    expect(html).not.toContain('role="img"');
  });

  it("avec libellé : role img et nom accessible", () => {
    const html = renderToStaticMarkup(
      createElement(Icon, { icon: Ruler, label: "Découpage", size: 16, className: "k" }),
    );
    expect(html).toContain('role="img"');
    expect(html).toContain('aria-label="Découpage"');
    expect(html).toContain('width="16"');
    expect(html).toContain('stroke-width="1.5"');
    expect(html).not.toContain("aria-hidden");
  });
});

describe("SECTION_ICONS", () => {
  it("une icône par section du rail, toutes distinctes", () => {
    expect(Object.keys(SECTION_ICONS).sort()).toEqual([...SECTION_IDS].sort());
    expect(new Set(Object.values(SECTION_ICONS)).size).toBe(SECTION_IDS.length);
    for (const id of SECTION_IDS) {
      const html = renderToStaticMarkup(createElement(Icon, { icon: SECTION_ICONS[id] }));
      expect(html, id).toContain("<svg");
    }
  });
});
