/**
 * Analyseur XML minimal pour les tests : vérifie la bonne formation (balises équilibrées,
 * attributs entre guillemets et uniques, entités connues, un seul élément racine) et rend un
 * arbre simple. Réservé aux tests ; ne gère ni DTD, ni CDATA, ni instructions de traitement
 * autres que la déclaration XML.
 */

export interface XmlElement {
  readonly name: string;
  readonly attrs: Readonly<Record<string, string>>;
  readonly children: XmlElement[];
  text: string;
}

const NAME = /^[A-Za-z_:][-A-Za-z0-9_:.]*/;
const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };

function decode(raw: string, where: string): string {
  return raw.replace(/&([^;&\s]*);?/g, (m, name: string) => {
    if (!m.endsWith(";")) throw new Error(`XML : « & » non échappé ${where}`);
    if (name in ENTITIES) return ENTITIES[name]!;
    const num = /^#(x[0-9a-fA-F]+|[0-9]+)$/.exec(name);
    if (num) {
      const v = num[1]!;
      return String.fromCodePoint(v.startsWith("x") ? parseInt(v.slice(1), 16) : parseInt(v, 10));
    }
    throw new Error(`XML : entité inconnue &${name}; ${where}`);
  });
}

export function parseXml(src: string): XmlElement {
  let i = 0;
  const stack: XmlElement[] = [];
  let root: XmlElement | undefined;
  const at = (): string => `(position ${i})`;
  if (src.startsWith("<?xml")) {
    const end = src.indexOf("?>");
    if (end < 0) throw new Error("XML : déclaration non fermée");
    i = end + 2;
  }
  while (i < src.length) {
    const lt = src.indexOf("<", i);
    const textEnd = lt < 0 ? src.length : lt;
    const raw = src.slice(i, textEnd);
    if (raw.includes(">")) throw new Error(`XML : « > » isolé ${at()}`);
    const txt = decode(raw, at());
    const top = stack[stack.length - 1];
    if (top) top.text += txt;
    else if (txt.trim() !== "") throw new Error(`XML : texte hors racine ${at()}`);
    if (lt < 0) break;
    i = lt;
    if (src.startsWith("<!--", i)) {
      const end = src.indexOf("-->", i);
      if (end < 0) throw new Error("XML : commentaire non fermé");
      i = end + 3;
      continue;
    }
    if (src.startsWith("</", i)) {
      const m = NAME.exec(src.slice(i + 2));
      if (!m) throw new Error(`XML : balise fermante invalide ${at()}`);
      const close = src.indexOf(">", i);
      if (src.slice(i + 2 + m[0].length, close).trim() !== "") {
        throw new Error(`XML : balise fermante invalide ${at()}`);
      }
      const open = stack.pop();
      if (!open || open.name !== m[0]) {
        throw new Error(`XML : </${m[0]}> ne ferme pas <${open?.name ?? "?"}> ${at()}`);
      }
      i = close + 1;
      continue;
    }
    const m = NAME.exec(src.slice(i + 1));
    if (!m) throw new Error(`XML : balise invalide ${at()}`);
    i += 1 + m[0].length;
    const attrs: Record<string, string> = {};
    for (;;) {
      const ws = /^\s*/.exec(src.slice(i))![0];
      i += ws.length;
      if (src.startsWith("/>", i) || src.startsWith(">", i)) break;
      if (ws === "") throw new Error(`XML : espace manquant avant un attribut ${at()}`);
      const an = NAME.exec(src.slice(i));
      if (!an) throw new Error(`XML : attribut invalide ${at()}`);
      i += an[0].length;
      const eq = /^\s*=\s*(["'])/.exec(src.slice(i));
      if (!eq) throw new Error(`XML : valeur d'attribut sans guillemets ${at()}`);
      i += eq[0].length;
      const quote = eq[1]!;
      const end = src.indexOf(quote, i);
      if (end < 0) throw new Error(`XML : attribut non fermé ${at()}`);
      const value = src.slice(i, end);
      if (value.includes("<")) throw new Error(`XML : « < » dans un attribut ${at()}`);
      if (an[0] in attrs) throw new Error(`XML : attribut dupliqué ${an[0]} ${at()}`);
      attrs[an[0]] = decode(value, at());
      i = end + 1;
    }
    const el: XmlElement = { name: m[0], attrs, children: [], text: "" };
    const parent = stack[stack.length - 1];
    if (parent) parent.children.push(el);
    else if (root) throw new Error("XML : plusieurs éléments racine");
    else root = el;
    if (src.startsWith("/>", i)) {
      i += 2;
    } else {
      i += 1;
      stack.push(el);
    }
  }
  if (stack.length > 0) throw new Error(`XML : <${stack[stack.length - 1]!.name}> non fermé`);
  if (!root) throw new Error("XML : document vide");
  return root;
}

/** Tous les éléments descendants (préfixe), filtrés par nom. */
export function findAll(el: XmlElement, name?: string): XmlElement[] {
  const out: XmlElement[] = [];
  const walk = (e: XmlElement): void => {
    if (name === undefined || e.name === name) out.push(e);
    e.children.forEach(walk);
  };
  walk(el);
  return out;
}
