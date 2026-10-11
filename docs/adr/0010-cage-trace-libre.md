# ADR-0010 — Tracé libre : modèle CAGE et éditeur 2D unifié

- Statut : accepté le 2026-10-11 (décisions de l'utilisateur du même jour) ; amende ADR-0002 (tracé générique) ; mise en œuvre par lots dans le worktree `feat/free-2d` (journal : `docs/ledger/LEDGER-free-2d.md`) ; **amendé le 2026-10-11** (décisions F4, F8 et F9, sous-lot 0b, voir « Amendement (2026-10-11) »)

## Constat

- **Tracé** : un escalier à volées est fait de N volées droites reliées par N−1 tournants à ±90°, avec un seul emmarchement pour tout l'escalier (`FlightsLayoutSpecSchema`, `model/project.ts` ; `computeLayout`, `layout/layout.ts`, qui propage le repère de volée par permutation des axes). L'hélicoïdal est un tracé à part (`HelicalLayoutSpecSchema`, `layout/helical.ts`). Ni angle quelconque, ni largeur propre à une volée ou variable, ni axe en arc, ni palier droit intermédiaire.
- **Site** : murs, trémie et calque de fond (`SiteSchema`), saisis au clic dans `apps/web/src/views/PlanSiteEditor.tsx`, sans sélection ni glisser. Le placement de l'escalier (`stair.placement`) n'a aucune interface ; le tracé ne se règle que par formulaires.
- **Adéquation au site** : les contrôles « l'escalier tient-il dans le site » (murs, dégagement d'arrivée, dalle) n'existent que dans le crible de l'assistant (`assistant/placement.ts` : `wallPolygon`, `convexOverlap`, `discOverlap`, `wallCollision`, `arrivalPlacements` ; `assistant/propose.ts`).
- **Références** :
  - `docs/CHALLENGE-panel.md`, « Angle geometrie », premier constat : un tracé « bords libres puis Γ = offset(C_i, d_f) » ne tient pas comme représentation générique (S/Z, emmarchement variable, auto-intersections des décalés, coins multiples) ; proposition d'une **CAGE** = suite de **tronçons** reliés par des **jonctions**, C_i, C_e et Γ en forme fermée par jonction, les typologies devenant des générateurs de CAGE.
  - `docs/CHALLENGE.md` G1 : arbitrage d'origine, topologie explicite (« volées + tournants typés »), C_i, C_e et Γ **en forme fermée par tournant**, sans offset générique. La CAGE en est le prolongement : même principe, angle et largeur libérés.
  - `docs/research/B-geometrie.md` §1.1 (typologie « multi-volées hétérogènes » : volées d'emmarchement, d'angle ou de sens différents, cage à bords non parallèles ; StairDesigner les saisit volée par volée, longueur, largeur, angle) et §1.2 (raccords de jour : poteau, raccord circulaire, pan coupé à retraits haut et bas).

## Décision

Décisions de l'utilisateur du 2026-10-11 (points 1, 2, 5, 6 et 7) et choix du plan qu'il a validé le même jour (points 3, 4 et 8, issus de l'« approche retenue » du plan, sans arbitrage explicite) :

1. **Modèle CAGE** (CHALLENGE-panel, « Angle geometrie ») dès la première version : une suite de **tronçons** reliés par des **jonctions**, avec un **angle signé quelconque**, une **largeur propre à chaque tronçon**, éventuellement **variable** (trapèze), un **axe droit ou en arc** et des **paliers droits** intermédiaires.
2. **Tout migrer** : un seul chemin de calcul. Les volées deviennent un générateur de CAGE.
3. _(choix du plan validé)_ **Entrée à volées gardée** : le tracé à volées reste une entrée sérialisée ; `computeLayout` le normalise par `flightsToCage` puis appelle le moteur de CAGE. Pas de schéma v2 : `PROJECT_MIGRATIONS` reste vide et `examples/*.blondel.json` restent identiques à l'octet près. Le passage des volées à la CAGE est explicite (`toCageLayout`, annulable) ; l'éditeur le déclenche dès qu'une modification ne s'exprime plus en volées.
4. _(choix du plan validé)_ **L'hélicoïdal garde son `kind`** et son calcul (balayage au-delà de 360°, recouvrement de l'escalier sur lui-même, une quarantaine de fichiers hors tests qui le distinguent). L'unification est reportée, sous condition d'un test de parité (question F10).
5. **Structures progressives** : le premier lot sort avec la structure « aucune » ; un plugin qui ne sait pas traiter une fonction de la cage rend une erreur claire (garde-fou `cageFeatures`), puis les plugins sont généralisés un par un (limon à la française d'abord).
6. **Contraintes** : retour visuel et accroches, pas de solveur. Les conflits avec le site sont calculés **dans le cœur**.
7. **Site** : édition directe des murs et de la trémie, **contour de pièce**, **obstacles**.
8. _(choix du plan validé, au service du but de l'utilisateur : un éditeur 2D simple qui compose les volées et montre en direct si l'escalier tient dans le site)_ **Éditeur 2D unifié** : un seul éditeur de plan pour le site et l'escalier (sélection, poignées, inspecteur).

### Schéma (`model/project.ts`)

- Nouvelle variante `kind: "cage"` de `LayoutSpecSchema` :
  - `sections[]` (tronçons) : `axis` droit `{ length | auto }` ou en arc `{ radius, sweep }`, `width`, `widthEnd?` (largeur variable, axe droit seulement), `anchor?` ;
  - `junctions[]` : `angle` (degrés signés, 0 = palier droit ; le côté du jour se déduit du signe), `mode` (`winders`, `landing`, `radiating`), `depth?` (palier droit) ;
  - raccord côté jour (`well`) : vif, arc, poteau, pan coupé (`setbackIn`, `setbackOut`, B §1.2) ; raccord côté mur (`wall`) : vif ou arc ;
  - messages de validation par `params.message` dans `superRefine`, comme l'hélicoïdal ;
  - champs dérivés non sérialisés (`width`, `legs: []`, `turns: []`), sur le modèle de `HelicalLayoutSpecSchema` ;
  - utilitaires `isCageLayout` et `cageFeatures(spec)` (`anyAngle`, `variableWidth`, `arcAxis`, `straightLanding`, `wallArc`, `chamfer`, `radiating`, `oppositeTurns`).
- `SiteSchema` gagne des champs facultatifs : `room` (contour de pièce, `points`) et `obstacles[]` (poteau, poteau rond, porte avec gonds et sens d'ouverture, fenêtre avec allège et linteau, zone). `serializeProject` omet les champs absents.
- Sortie `Layout` (`model/derived.ts`) : `sections?` (lignes de départ et d'arrivée, largeurs, `sStart` / `sEnd`, arc éventuel de chaque tronçon) ; `TurnZone` gagne `angle?`, `well?`, `wall?` et le mode `radiating` ; les paliers droits y figurent.

### Moteur (`layout/cage/`)

- **Repères** : le repère (u, r) d'un tronçon se propage par rotation de θ ; θ ∈ {0, ±90°, 180°} est traité **exactement** (permutations, comme aujourd'hui dans `layout/layout.ts`), pour l'égalité numérique avec le moteur actuel.
- **Jonction d'angle θ, en forme fermée** (CHALLENGE.md G1) : K = intersection des bords côté jour, W = côté mur. Raccord vif ou pan coupé : Γ est un arc de centre K, de rayon d_f, de balayage θ. (pour le pan coupé, proposition de F6, à valider.) Raccord en arc de rayon r : centre sur la bissectrice, tangence à r·tan(|θ|/2) de K, Γ de rayon r + d_f. Poteau seulement à ±90° tant que F5 n'est pas tranchée. Côté mur, l'arc R est un congé tangent. Palier droit : rectangle de profondeur `depth`, Γ droite.
- **Largeur variable** (axe droit seulement) : bords rectilignes interpolés ; d_f de chaque jonction selon le DTU à partir de la plus petite largeur à la jonction (F1) ; entre deux jonctions, Γ est le segment qui relie les points de tangence, généralisation de `Layout.walklineTransitions` (S / Z). Axe en arc et largeur variable ensemble : erreur.
- **Recouvrement en plan** : `degenerateFootprint` (boîte englobante alignée sur les axes, `layout/layout.ts`) est remplacé par un découpage de l'emprise en pièces convexes testées deux à deux ; `wallPolygon`, `convexOverlap`, `discOverlap` et `wallCollision` passent de `assistant/placement.ts` à `geom2d/`.
- **Erreurs** : `LayoutError`, converties par `attempt` (`pipeline/build.ts`) en `Model.errors` ; `buildModel` ne lève jamais.
- **Parité** : au lot de bascule, le moteur actuel est gardé en copie de test et comparé au moteur de CAGE segment par segment (égalité stricte sur `examples/` et les préréglages, 1e-9 en propriétés) ; les instantanés de `pipeline/build.test.ts` restent inchangés **sans `-u`**.

### En aval, adéquation au site, éditeur

- **Aval** : découpage (`stepping/`), balancement (`balancing/`, M6 sur `zone.angle`), échappée (`headroom/`, `selfCoveredHeadroom` pour une cage qui se recouvre), garde-corps, règles, exports et `project/` lisent `Layout.sections` et `TurnZone.angle` au lieu de supposer ±90° et une largeur unique.
- **Garde-fou des structures** : `StructureCapabilities` déclare les fonctions de cage prises en charge (sur le modèle de `structureAcceptsLayout`, `structures/registry.ts`) ; sinon le pipeline émet un `Message` et saute le plugin, les marches restant produites. `none` accepte tout ; une cage issue de volées passe comme aujourd'hui. Le garde-fou couvre aussi les limons centraux (`wood-central`, `steel-central`), qui lisent le tracé par `structures/centralTrace.ts`.
- **Adéquation au site** : module du cœur (`site/fit.ts`) qui rend des conflits typés (mur, hors pièce, obstacle et débattement de porte, dégagement d'arrivée, empiètement sur la dalle, échappée, recouvrement de l'escalier sur lui-même), chacun avec un `Message` ; nouvelle étape du pipeline après l'échappée (`Model.siteFit`) ; le crible de l'assistant est réécrit sur les mêmes fonctions. Aucun seuil en dur : `rules.yaml` s'il est sourcé, sinon paramètre du profil d'atelier « à valider » (F7).
- **Mutateurs purs** dans le cœur (`site/edit.ts`, complété ; `layout/cageEdit.ts`) : édition du site et du tracé, et traduction d'un glisser en paramètre. Accroches (`site/stairSnap.ts`) pures, autorisées dans l'interface.
- **Éditeur 2D** (`apps/web`) : `PlanSiteEditor` devient un éditeur en calques (fond, site, escalier, conflits, poignées) avec sélection, poignées et inspecteur ; un glisser = une entrée d'historique ; aperçu rapide par une voie du worker (tracé et conflits seulement), `buildModel` complet au relâchement. Aucun calcul métier dans l'interface (`architecture.test.ts`).

## Conséquences

- Un seul chemin de calcul du tracé à volées et à cage ; l'hélicoïdal reste à part tant que F10 n'est pas tranchée.
- Évolution rétrocompatible du `ProjectSchema` (variante et champs facultatifs), sans migration ; projets et exemples existants relus et réécrits à l'octet près.
- Le premier lot livré n'offre la CAGE qu'avec la structure « aucune » ; chaque structure est ensuite généralisée dans son propre lot (limon à la française, acier plat, plié et profilé, limons centraux, acier cintré pour l'axe en arc).
- Les angles quelconques et la largeur variable posent des questions métier ouvertes (ligne de foulée, collet, herse, poteau, paliers, dégagements) : `docs/QUESTIONS.md`, section F (F1 à F10), présentées une par une avant le lot qui en dépend.
- Libellés nouveaux en français et en anglais (ADR-0007) ; les textes français existants ne changent pas.

## Alternatives écartées

- **Deux courbes libres (bord de jour, bord de mur) et Γ par décalage** (B §1.2, proposition d'origine) : écartée par CHALLENGE.md G1 et CHALLENGE-panel (pas de bord intérieur global en S / Z, décalé faux avec un emmarchement variable, auto-intersections, volées et tournants non identifiés pour le balancement).
- **Polyligne libre éditée point par point** : même défaut (topologie à déduire) ; le mode expert édite des paramètres de tronçons et de jonctions (CHALLENGE-panel).
- **Moteur de CAGE à côté du moteur à volées** : deux chemins de calcul à tenir alignés ; écarté par la décision 2.
- **Schéma v2 avec migration des projets vers `cage`** : changerait tous les exemples et projets enregistrés sans gain de calcul ; écarté par le point 3 de la décision.
- **Hélicoïdal converti en tronçon à axe en arc** : reporté (point 4 de la décision, F10).
- **Solveur de contraintes** (placement ou dimensions déduits des contraintes du site) : écarté par la décision 6, au profit du retour visuel et des accroches.

## Amendement (2026-10-11) — décisions F4, F8 et F9 (sous-lot 0b)

- **F4** : l'angle d'une jonction vérifie |θ| < 180° strictement (refus du schéma, `layout.cage.angleOutOfRange`). Un demi-tour se modélise par **deux jonctions de 90°** et un tronçon intermédiaire (de longueur 0 admise). Le repère θ = 180° de la section « Moteur, Repères » est donc **hors domaine** : seuls θ ∈ {0, ±90°} sont traités exactement. Au-delà de 135° avec un raccord côté mur vif : avertissement produit par le moteur (lot 2), seuil = paramètre « à valider ».
- **F8** : au plus 16 tronçons (`CAGE_MAX_SECTIONS`), borne de calcul et non métier (`layout.cage.sectionCount`).
- **F9** : `depth` d'un palier droit (angle 0 seulement, `layout.cage.depthStraightLandingOnly`) : strictement positive, défaut = emmarchement du tronçon, appliqué par le moteur ; le minimum métier relève de la règle PALIER_LONGUEUR_METIER.
- Complément du schéma (relecture du sous-lot 0b) : un palier droit (angle 0) n'a ni coin K ni coin W ; ses raccords `well` et `wall` sont vifs seulement (`layout.cage.straightJunctionSharp`).
