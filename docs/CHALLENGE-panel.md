# Panel critique de la conception — texte intégral

> Produit le 2026-09-28 par trois agents relecteurs indépendants (architecture, géométrie, produit) à partir de `docs/prompts/02-conception-dev.md`, `docs/SPEC.md` et `docs/research/`. Synthèse et décisions : [`CHALLENGE.md`](CHALLENGE.md).

## Angle archi

### [majeur] « Millimètres entiers en interne » contredit la géométrie et les invariants testés

**Constat** Prompt 2 §3 impose des mm entiers, alors que presque tout le cœur est en réels. h = H/n n'est entier que par chance : H = 2 700 et n = 15 donnent 180, mais H = 2 650 et n = 15 donnent 176,667. Avec des entiers, « somme des hauteurs = H » oblige à mélanger 10 × 177 et 5 × 176 mm, ce qui viole l'invariant « girons exactement égaux » (SPEC §2.3) et fait réagir `H_TOLERANCE_DTU`. Même problème ailleurs : M3 inverse F par Newton (collets de 184,6 / 138,7 / 126,7 mm, B §3.5), les rives sont échantillonnées tous les 5 mm puis ramenées en B-splines à 0,1 mm (B §5.2), et les abscisses développées valent (1 ∓ κe/2)·Δσ. Arrondir à chaque étape cumule l'erreur : 14 girons arrondis donnent jusqu'à 7 mm d'écart sur le reculement.

**Risque** Tests par propriétés rouges ou affaiblis en permanence, développés DXF faux de quelques mm, dérive entre plan 2D et 3D.

**Proposition** Distinguer trois types. (1) `Mm = number` en float64 pour tout le calcul, sans arrondi intermédiaire. (2) Les paramètres saisis par l'utilisateur, validés comme entiers (ou au 0,5 mm) par zod à l'entrée. (3) Une étape explicite d'« arrondi de fabrication » en sortie seulement (DXF, PDF, nomenclature), qui répartit le reste par la méthode du plus fort reste et le signale dans le rapport (« 10 × 177 + 5 × 176 »). Une constante `EPS_MM = 1e-6` et des helpers `approxEq`. Les angles en radians en interne, les degrés seulement pour la saisie et l'affichage. Ce choix mérite un ADR, puisqu'il contredit la stack imposée.

_Réf._ 02-conception-dev §3 Unités ; SPEC §2.3 invariants ; B §3.5, §5.2 ; rules.yaml H_TOLERANCE_DTU

### [majeur] rules.yaml n'est pas un langage de formules exécutable : seule la moitié des règles s'évalue mécaniquement

**Constat** Sur les 100 règles, les `formule` mêlent plusieurs genres. Des comparaisons simples (`h <= 210`). Des implications et ternaires (`volees_meme_sens => L_palier > 1000`, `D_mc >= (logement_individuel ? 30 : 50)`). Des quantificateurs (`pour tout appui a X in [100 ; 600[ : H_gc >= 1000 + X`, `vide < 110 sur [0 ; 800]`). Des tables externes non fournies (`table_FCBA(essence, epaisseur)`, `h_table(E_gc)`, `table_6_12_NF_A1`). Du langage naturel (`g_collet[i] monotone vers l'angle`). Des définitions qui ne vérifient rien (`R = (n - 1) * g`, `d_lf = 600`). Et même `⚠️ non vérifié` (GC_DENIVELES_2024). Les variables sont ambiguës : `g` désigne « la ligne de foulée ou la ligne de mesure », alors que SPEC §8.2 les découple. Enfin, « la plus contraignante l'emporte » ne veut rien dire entre deux règles de sévérités, natures ou profils différents : fusionner H_MAX_DTU (210) et H_MAX_LOGEMENT (180) ferait perdre la traçabilité exigée par le critère n° 6.

**Risque** Un DSL maison qui gonfle sans fin, ou un eval() dangereux et non testable, et de fausses conformités silencieuses.

**Proposition** Le YAML porte les métadonnées et les seuils (id, min/max/recommande, contexte, nature, confiance, source, sévérité, source_secondaire), et `formule` reste de la documentation. Chaque id pointe vers un évaluateur TypeScript typé, déclaré dans un registre : `evaluate(ctx: RuleContext, params: {min,max,...}) => RuleResult[]` (plusieurs résultats localisés par marche ou par pièce). Les grandeurs mesurées (`h_i`, `g_i@ligneMesure`, `e(s)`, `vide`, etc.) sont produites une seule fois par une couche `Measurements` dont les identifiants sont typés. Un test de CI vérifie que chaque règle du YAML a un évaluateur ou porte `statut: non_implementee | definition | information`, et l'inverse. Toutes les règles actives sont évaluées sans fusion, et l'UI regroupe par grandeur en montrant la plus contraignante. Les règles « définition » (RECULEMENT, LF_*) passent dans le pipeline, pas dans le moteur. Le YAML est compilé au build (plugin Vite ou script) en JSON avec ses types générés : pas de parseur YAML ni d'`eval` à l'exécution.

_Réf._ rules.yaml (GC_GABARIT_B_2024, G_COLLET_MONOTONE, CREMAILLERE_REGLE_MOYENS, GC_HAUTEUR_2024, RECULEMENT, GC_DENIVELES_2024) ; SPEC §3.1 ; A §4

### [majeur] Le pipeline n'est pas linéaire : dépendances inverses Structure → Découpage et Conformité → Découpage

**Constat** Prompt 2 §2 dessine une chaîne Site → Tracé → Découpage → Structure. Mais Q7 (validée) fait dépendre la variante M3 de la structure : cubique pour un limon à la française, quintique pour un débillardé. L'emmarchement E se mesure entre faces internes des limons, donc dépend de leur épaisseur. K8 fait pivoter une marche pour gagner de l'échappée, ce qui renvoie un résultat de conformité vers le découpage. Le choix automatique du nombre de balancées boucle sur c_min. Et le critère n° 2 (« même tracé », UPN contre débillardé) devient contradictoire : les deux variantes n'ont pas le même balancement.

**Risque** Cycles implicites codés en dur, modèle incohérent après changement de structure, comparateur trompeur.

**Proposition** Modéliser un DAG d'intentions de conception plutôt qu'une chaîne. Les choix structurants (famille de structure, épaisseurs de limon, variante de balancement) sont des paramètres d'entrée lus par le Découpage, pas des sorties de Structure. Les boucles automatiques (nombre de balancées, pivot pour l'échappée) sont des solveurs locaux bornés (≤ N itérations) qui renvoient un diagnostic, jamais de rétroaction globale. Pour le comparateur, préciser que « même tracé » signifie « même Site et même ligne de foulée », avec un balancement recalculé par variante et affiché comme différence.

_Réf._ 02-conception-dev §2, §6 critère 2 ; SPEC §7bis Q7 ; B §3.1 K8, §3.5

### [majeur] Mode expert : les retouches manuelles n'ont ni identité stable ni politique d'invalidation

**Constat** « Édition directe des points de la ligne de foulée et des marches dans le plan 2D » (MVP, jalon 2) suppose des surcharges posées sur des sorties du pipeline, par exemple `u_k` d'une marche. Si l'utilisateur change H, n passe de 15 à 16 et l'indice k ne désigne plus la même marche. La localisation des règles, la nomenclature (repères de pièce), la sélection 3D et les retouches ont toutes besoin d'identifiants qui survivent à une régénération.

**Risque** Retouches perdues ou appliquées à la mauvaise marche, sélection 3D et alertes qui sautent à chaque frappe.

**Proposition** Des identifiants sémantiques dérivés du chemin plutôt que des index de tableau, par exemple `flight:1/winder-zone:A/step:+2` relatif à la marche fixe, ou `stringer:inner/segment:2`. Stocker les surcharges comme contraintes du document d'entrée (`marchesFixes`, `nosingOverrides: {anchor, angle}`), jamais comme sorties modifiées. Définir la politique quand l'ancre disparaît : surcharge « orpheline » affichée, jamais appliquée en silence. Tester par propriétés qu'une régénération sans changement d'entrée garde tous les ids.

_Réf._ 02-conception-dev §3 Modes ; SPEC §2.3 (marches fixes, édition directe) ; B §1.3

### [majeur] Trois représentations géométriques (analytique, manifold, OCCT) : un triplement de code à différer

**Constat** SPEC §5 retient une couche analytique (vérité, développés, DXF), manifold-3d pour les booléens d'aperçu et replicad/OCCT (4,8 Mo brotli) pour STEP et HLR. Chaque pièce devrait alors être construite deux ou trois fois, avec un risque de divergence entre le DXF (analytique) et le STEP (OCCT). Or au MVP les entailles et mortaises du limon à la française sont cachées par les marches : un booléen d'aperçu n'apporte presque rien. Les plans 2D et élévations peuvent venir de la couche analytique, sans HLR. Le prompt place pourtant les « développés » dans `packages/geometry` alors que SPEC §4.6 les met dans la couche métier.

**Risque** Double maintenance et incohérence entre fichier d'atelier et modèle 3D, poids wasm sur le chemin critique.

**Proposition** Une représentation intermédiaire unique par pièce, `PartDescriptor` : profil 2D, loi de balayage (extrusion droite / surface réglée / hélice / B-spline), liste de `Feature` d'usinage (perçage, entaille, pli, ligne de roulage), matériau, repère. Des backends interchangeables la consomment : `mesh-analytic` (MVP, TS pur, sans wasm), `dxf-flat` (développés), puis `occt` (V1, STEP). manifold n'entre qu'en cas de besoin visuel démontré (vue coupe, découpes visibles des crémaillères), derrière la même interface. Test de parité en CI : volume et boîte englobante du maillage analytique contre ceux d'OCCT à 0,1 % près sur les escaliers de référence.

_Réf._ SPEC §5 (Architecture géométrique), §4.6 ; D §4.1 ; 02-conception-dev §4 packages/geometry

### [moyen] « < 100 ms » : ni périmètre, ni budget par étape, ni mesure

**Constat** « Escalier standard » n'est pas défini, pas plus que ce qui tient dans les 100 ms : cœur, solides, conformité, tessellation, réconciliation React, envoi GPU ? Un quart tournant de 15 marches avec limons, 40 balustres et une main courante représente environ 60 pièces et 50 à 150 k triangles. En non indexé, cela fait déjà 3,6 à 11 Mo de positions et normales à produire et envoyer. Avec un worker, la copie structurée d'un gros graphe d'objets coûte plusieurs ms, et le partage mémoire (SharedArrayBuffer) exige COOP/COEP, qui gênent l'intégration en iframe chez un fabricant (D §4.2). Le comparateur exécute N pipelines complets.

**Risque** Objectif invérifiable, UI saccadée découverte tard, choix du worker fait sans mesure.

**Proposition** Définir trois escaliers de référence (droit, quart tournant balancé bois, hélicoïdal métal) et un budget chiffré. Par exemple : cœur et découpage ≤ 5 ms, conformité ≤ 10 ms, descripteurs de pièces ≤ 10 ms, tessellation ≤ 30 ms, mise à jour de la scène ≤ 16 ms. Ajouter un `vitest bench` en CI avec un seuil de régression de 20 %. Mémoïser chaque étape sur un hash structurel de ses entrées pour qu'un changement de garde-corps ne relance pas le découpage. En glissement (drag) : aperçu dégradé (sans balustres ni textures) et calcul complet au relâchement. Worker avec politique « le dernier gagne » (annulation par génération) et buffers transférables, sans SharedArrayBuffer au MVP.

_Réf._ 02-conception-dev §3 Paramétrique et réactif ; SPEC §5 Performance ; D §4.2

### [moyen] Tests par propriétés : générateurs non contraints et invariants mal posés

**Constat** Tirer au hasard (H, trémie, murs) donne surtout des escaliers infaisables, et fast-check gaspillera ses essais en filtres (`pre`/`filter`), jusqu'à s'arrêter. « Absence d'intersection entre pièces » est mal posé : marche encastrée dans une mortaise, marche posée sur une cornière, soudure bout à bout sont des contacts voulus. Il faut une tolérance, une liste de contacts permis et un calcul de volume d'intersection coûteux. « Girons exactement égaux » et « Σh = H » en flottants demandent une tolérance. Les snapshots de cotes en float seront instables.

**Risque** Tests lents, faux positifs d'intersection, invariants désactivés « temporairement » puis pour toujours.

**Proposition** Des générateurs constructifs : partir de (h, g, n, typologie) valides, en déduire H et la trémie, puis perturber dans les marges. Et des générateurs « frontière » ciblés : collet proche de 0, E = 1 200 mm (bascule de d_lf), S proche de m/3 (perte de monotonie de la cubique, B §3.5). Remplacer l'intersection de solides par un test sur les descripteurs : boîtes orientées puis distance entre profils, avec une matrice `allowedContacts`. Un sérialiseur de snapshot qui arrondit à 0,01 mm. Les exemples chiffrés de la recherche servent d'oracles : collets 184,6 / 138,7 / 126,7 (cubique) et 202,6 / 133,7 / 113,8 (quintique).

_Réf._ 02-conception-dev §4 Tests ; SPEC §2.3 invariants ; B §3.5 exemples

### [moyen] Persistance : ce qu'on stocke, ce qu'on annule, où vivent barèmes et capacités, lien partageable sans serveur

**Constat** L'undo/redo illimité ne dit pas s'il porte sur le document d'entrée ou sur l'état dérivé : il faut le document seul. Un glissement de souris produit 60 états par seconde. Les barèmes de prix et tables de capacités machines sont « par atelier » (SPEC §8.5) : les mettre dans le projet les duplique, les mettre ailleurs rend le projet non reproductible. La version de `rules.yaml` est enregistrée (SPEC §2.8), mais rien ne dit si l'on réévalue à la réouverture avec l'ancienne ou la nouvelle. Le « lien partageable » n'a pas de backend dans la stack : un JSON compressé dans l'URL devient vite trop long une fois les polygones, surcharges et barèmes inclus.

**Risque** Pile d'undo énorme, devis non reproductibles, rapports de conformité qui changent sans prévenir.

**Proposition** Le document projet (zod, `schemaVersion`, migrations pures `vN → vN+1` testées sur des fixtures figées) ne contient que des intentions. Undo par patches (immer `produceWithPatches`), regroupés par transaction UI (début et fin de glissement). `WorkshopProfile` (capacités, temps, barèmes) forme une bibliothèque séparée, référencée par id et hash, avec un instantané embarqué à l'export. Le projet enregistre `rulesetVersion` et son hash ; à la réouverture, afficher un écart (« 3 règles ont changé ») et proposer de réévaluer, sans le faire en silence. Lien partageable : fragment d'URL compressé au MVP avec un seuil de taille, puis stockage serveur en V1 (ADR).

_Réf._ 02-conception-dev §3 Persistance ; SPEC §2.8, §8.5, §7bis profils

### [moyen] Découpage en packages : responsabilités floues et dépendances à fixer dès le jalon 0

**Constat** Le prompt met les développés dans `geometry`, la SPEC dans la couche métier. Aucun package n'accueille le schéma zod, le jeu de règles compilé, le catalogue de profilés (UPN/IPE/HEA) ni les coûts. Si `exports` dépend de `geometry` (OCCT), le DXF de tôle pliée tire le wasm. « Aucun calcul métier dans les composants UI » (critère n° 4) reste invérifiable sans règle d'import.

**Risque** Dépendances circulaires, wasm dans le bundle initial, logique métier qui glisse dans React.

**Proposition** `packages/model` : types, zod, migrations, ids, sans dépendance. `packages/rules-data` : YAML compilé en JSON avec types générés, capacités d'exemple, catalogue de profilés. `packages/core` : pipeline, balancement, mesures, moteur de règles, développés analytiques, nomenclature et coûts ; dépend de model et rules-data seulement. `packages/geometry` : tessellation analytique ; `geometry-occt` à part, chargé paresseusement. `packages/exports` : DXF, SVG, PDF et CSV depuis core, STEP seulement via geometry-occt en import dynamique. `apps/web`. Imposer le sens des dépendances (dependency-cruiser ou références de projet TS, `no-restricted-imports` sur three et react dans core) et tester core sous Node en CI.

_Réf._ 02-conception-dev §4 ; SPEC §4.6, §5, §3.1 capabilities.yaml

### [mineur] React 19 / r3f : contrainte de version, fuites GPU et état dérivé dans zustand

**Constat** r3f 9.8 exige React ≥ 19 et < 19.4 (SPEC §5) : un `pnpm up` peut tout casser. Régénérer les maillages à chaque frappe sans `dispose()` fait fuir des BufferGeometry en mémoire GPU, un piège classique de r3f. Mettre l'état dérivé (maillages, résultats) dans zustand provoque des rendus en cascade. Le lien entre alerte, pièce et maillage (surbrillance 2D et 3D) exige les ids stables du défi n° 4.

**Risque** Fuite mémoire après quelques minutes d'édition, montée de version bloquée.

**Proposition** Épingler react, react-dom, three et @react-three/fiber dans le catalogue pnpm, avec Renovate groupé. Zustand ne contient que le document et l'état d'UI ; le dérivé sort d'un sélecteur mémoïsé ou du worker, stocké hors de React (ref ou store externe via `useSyncExternalStore`). Un cache de géométries indexé par (partId, hash du descripteur), qui réutilise et libère explicitement ; un test de non-fuite en Playwright compare `renderer.info.memory.geometries` après 100 modifications. Plan 2D en SVG par composants purs recevant les primitives calculées par core (le calcul des cotations reste dans core).

_Réf._ SPEC §5 Contrainte de version ; D §2.1, §4.2

### [mineur] Modèle de coût et comparateur : pas de valeurs par défaut, donc critère d'acceptation n° 2 non démontrable

**Constat** SPEC §2.7 impose des temps d'atelier « sans valeur par défaut non sourcée » (Q13 : aucune donnée publique). Pourtant le critère n° 2 demande un comparateur qui affiche un coût estimé. Sans barème, il affichera « — » ou des chiffres inventés. Côté architecture, un coût doit rester un calcul pur sur la nomenclature, et non sur la géométrie maillée.

**Risque** Critère d'acceptation impossible à tenir honnêtement, chiffres sans source présentés comme des estimations.

**Proposition** Séparer les quantités (masse, m³, longueur de cordon, nombre de plis, de coupes, de gabarits, pièces uniques), calculables et testables sans barème, de la valorisation, qui applique un `WorkshopProfile`. Le comparateur montre toujours les quantités, et le coût seulement si un profil est défini, avec un profil de démonstration marqué « fictif, à calibrer ». Reformuler le critère n° 2 en conséquence (point en suspens pour l'utilisateur).

_Réf._ SPEC §2.7, §7.3 Q13 ; 02-conception-dev §6 critère 2 ; C §5

### Recommandations modèle

Recommandations pour les interfaces TypeScript du cœur (packages/model et core).

1. Unités et types

- `type Mm = number & {__u:'mm'}` (float64), `type Rad = number & {__u:'rad'}`.
- Saisies : `MmInput` entier, validé par zod.
- Sortie de fabrication : `roundForFab(values: Mm[], step=1): {values:number[], remainderReport}`.
- `EPS_MM = 1e-6`, plus `approxEq(a, b, eps)`.

2. Document projet (seule source de l'undo)

```ts
interface ProjectDoc {
  schemaVersion: number;
  rulesetRef: { version: string; hash: string };
  compliance: {
    contexts: ContextId[];
    profile: "strict" | "souple";
    permitDate?: string;
    ruleOverrides: RuleOverride[];
  };
  site: Site;
  intent: DesignIntent;
  overrides: Override[];
  workshopRef?: { id: string; hash: string; snapshot?: WorkshopProfile };
}

interface DesignIntent {
  typology: TypologyId;
  walkline: WalklineIntent;
  landings: LandingIntent[];
  fixedSteps: FixedStep[];
  balancing: { zoneId: string; strategy: BalancingStrategyId; params: unknown }[];
  structure: { family: StructureKindId; params: unknown };
  guards: GuardIntent[];
}
```

- La famille de structure appartient à l'intention, lue par le Découpage : elle choisit la variante M3 et fixe E.

3. Identifiants stables

- `type EntityId = string` sémantique, par exemple `flight:1/step:fixed-a+2`, `stringer:inner/seg:2`, `guard:tremie/post:3`.
- Jamais d'index de tableau.
- `Override = {anchor: EntityId; kind: 'nosingAngle'|'walklinePoint'|...; value; status?: 'orphan'}`.

4. Pipeline en DAG mémoïsé

- `Stage<I, O> = {id; deps: StageId[]; run(input: I): O; hash(input: I): string}`.
- Chaque sortie est immuable et porte des `EntityId`.
- Les solveurs locaux (nombre de balancées, pivot d'échappée) sont bornés et renvoient `Diagnostic[]`.

5. Balancement

```ts
interface BalancingStrategy {
  id;
  paramsSchema: ZodType;
  solve(
    zone: WinderZone,
    ctx,
  ): { nosings: { id: EntityId; P: Vec2; u: Vec2 }[]; innerStringLaw?: Curve1D; diagnostics };
  estimateMinCollet(zone): Mm;
}
```

- `estimateMinCollet` sert au choix automatique du nombre de balancées (formule propre à chaque variante, B §3.5).

6. Mesures et règles

- `Measurements` : grandeurs nommées et localisées, par exemple `{key: 'h_i'|'g_i'|'e'|'g_collet'|..., line?: 'walkline'|'measure:dtu'|'measure:access', at: EntityId, value: Mm}`.
- `RuleDef` : issue du YAML compilé, avec métadonnées et seuils. `formula` n'est que de la documentation. `status: 'implemented'|'definition'|'information'|'not_implemented'`.
- `RuleEvaluator = (m: Measurements, params, ctx) => RuleResult[]`.
- `RuleResult = {ruleId; at: EntityId[]; measured; threshold; severity (après profil et override); nature; confidence; source; downgradedBy?: 'profile'|'user'}`.
- Toutes les règles actives sont évaluées ; l'UI agrège par grandeur, sans fusion dans le moteur.
- Test de CI : couverture YAML ↔ registre.

7. Pièces et géométrie

```ts
interface PartDescriptor {
  id: EntityId;
  mark: string;
  material: MaterialRef;
  section?: SectionRef;
  body: Extrusion | RuledSurface | HelicalSweep | BSplineSweep;
  features: Feature[];
  flat?: FlatPattern;
}
```

- `Feature` : perçage, entaille, mortaise, pli, ligne de roulage, joint.
- `FlatPattern` : développé analytique calculé dans core, avec contours, lignes de pli et de roulage, repères.
- Backends : `toMesh(part)` (TS pur), `toDxf(flat)`, `toOcct(part)` (V1).
- `allowedContacts: [EntityId, EntityId, ContactKind][]` pour les tests de non-intersection.

8. Coûts

- `Quantities` par pièce (masse, volume, cordon, plis, coupes, gabarits, surface à traiter), calcul pur.
- `valuate(q, WorkshopProfile | undefined)` renvoie `Cost | 'unpriced'`.

9. Données compilées

- `rules.yaml`, `capabilities.yaml` et le catalogue de profilés sont compilés au build en JSON avec types et hash.
- core ne parse jamais de YAML à l'exécution.

Points en suspens à noter dans le ledger :

- ADR unités (float plutôt qu'entiers, contraire à la stack imposée).
- Sens de « même tracé » dans le critère n° 2.
- Coût sans barème dans le critère n° 2.
- Hébergement du lien partageable.
- Politique de réévaluation quand la version des règles change.
- Définition chiffrée de « escalier standard » pour les 100 ms.

## Angle geometrie

### [majeur] Le tracé « bords composés puis Γ = offset(C_i, d_f) » ne tient pas comme représentation générique

**Constat** B §1.2-1.3 et SPEC §2.3 proposent de saisir deux courbes libres (bordJour, bordMur) et d'en déduire Γ par décalage du bord intérieur. Quatre cas cassent cette approche. (1) En deux quarts en S/Z, le côté jour change de côté entre les deux tournants : il n'existe pas de bord intérieur global, et la règle « 0,60 m de la rampe intérieure » (E > 1 200) fait sauter Γ de 600 mm à gauche à 600 mm à droite dans la volée intermédiaire. Le DTU ne dit rien de cette transition. (2) Avec un emmarchement variable (multi-volées hétérogènes, cage non parallèle), offset(C_i, E/2) n'est plus le milieu. (3) L'offset d'une clothoïde n'est pas une clothoïde, et l'offset d'un raccord concave (mur extérieur en arc, côté intérieur du S) s'auto-intersecte : il faut un vrai noyau d'offset avec découpage des boucles. (4) Un poteau ou un pan coupé crée des coins convexes multiples, et Γ devient une suite d'arcs centrés sur chaque sommet, ce qui n'est pas forcément voulu. Enfin, deux courbes libres ne disent pas où sont les volées ni les tournants, alors que les zones de balancement, la marche virtuelle et les paliers en ont besoin.

**Risque** Sans topologie explicite, le jalon 2 bute sur l'offset générique (auto-intersections, clothoïdes) et sur l'identification des zones de balancement. Le mode expert « édition libre des points » produit aussi des tracés que les algorithmes de balancement ne savent pas traiter.

**Proposition** Rendre la topologie explicite au lieu de la déduire. Le modèle devient une CAGE = suite de TRONÇONS (axe droit ou arc, largeur utile gauche/droite, éventuellement variable linéairement) reliés par des JONCTIONS {angle signé ±90/±180, mode : palier | balancé | rayonnant, raccord côté jour : vif | poteau(section) | arc(r) | panCoupé(retraitHaut, retraitBas) | [clothoïde V1], raccord côté mur : vif | arc(R)}. Le côté jour d'une jonction se déduit du signe de l'angle. Pour chaque jonction, C_i, C_e et Γ se calculent en forme fermée, sans algorithme d'offset générique : droite, puis arc de rayon r_j + d_f centré sur le coin ou sur le centre du raccord, puis droite. Les primitives restent ligne et arc au MVP ; la clothoïde vient en V1 avec un offset évalué numériquement. Les typologies deviennent des générateurs de CAGE : droit = 1 tronçon ; quart = 2 tronçons et 1 jonction ; U/S = 3 tronçons et 2 jonctions ; demi-tournant = 2 jonctions de 90° avec une volée intermédiaire de longueur = jour, ou une jonction de 180° ; hélicoïdal = 1 tronçon à axe en arc. Le mode expert édite les paramètres de tronçons et de jonctions, plus des surcharges ponctuelles (marche fixe, φ_k imposé), et non une polyligne libre. La transition de Γ dans un S avec E > 1 200 est à ajouter aux questions ouvertes. Défaut proposé : raccord linéaire de d_f sur la volée intermédiaire, signalé à l'utilisateur.

_Réf._ B §1.2, §1.3, §2.1, §3.11 ; SPEC §2.3 (raccords de jour, ligne de foulée par décalage)

### [majeur] « Millimètres entiers en interne » est incompatible avec l'équipartition exacte

**Constat** Le prompt 2 §3 impose des mm entiers en interne. La SPEC §2.3 exige des girons exactement égaux sur Γ et une somme des hauteurs exactement égale à H. Or 2 750 / 16 = 171,875 mm, et les points P_k sur un arc de Γ ont des coordonnées irrationnelles. En entiers, il faut répartir un reste : les hauteurs diffèrent alors de 1 mm, ce qui viole l'invariant d'égalité. Les intersections ℓ_k ∩ C_e, les collets et les développés perdent aussi en précision par arrondis successifs. Le test par propriété « somme des h = H » devient soit trivialement vrai par construction, soit faux.

**Risque** Des arrondis dispersés dans le cœur produisent des écarts de 1 à 2 mm cumulés sur les développés DXF. Les snapshots de non-régression deviennent aussi instables d'une plateforme à l'autre.

**Proposition** Stocker les entrées utilisateur (H, trémie, E, épaisseurs) en mm entiers dans le JSON projet, qui est la seule chose sérialisée. Tout le calcul dérivé (h, P_k, φ_k, Q_k, F, développés) se fait en flottants double précision, en mm. On arrondit seulement à l'affichage, et à l'export avec une résolution paramétrable (0,1 mm en DXF). Les invariants se testent avec une tolérance explicite (1e-6 mm). Il faut consigner cette dérogation dans un ADR.

_Réf._ Prompt 2 §3 (Unités) ; SPEC §2.3 (invariants), §2.8

### [majeur] M3 est encore sous-spécifié pour une implémentation : conditions aux limites, asymétrie, U/S, côté du collet

**Constat** L'algorithme de B §3.5 suppose deux marches fixes perpendiculaires a et b, avec F'(σ_a) = F'(σ_b) = m = h/g. Plusieurs cas ne sont pas traités. (a) Quart tournant bas ou haut : il y a souvent moins de marches droites que nécessaire avant l'angle, et a = départ (ou b = arrivée/palier). Il n'existe pas de partie droite à raccorder, et imposer F' = m y gaspille du collet. (b) Asymétrie : K6 (bissectrice) et la recherche « nb de chaque côté » supposent un tournant centré. (c) En U/S, les deux zones se chevauchent quand la volée intermédiaire est courte. Si elle fait moins d'un giron, aucune marche virtuelle perpendiculaire n'y tient. (d) En S, le « limon intérieur » change de côté. (e) Le collet de F est une longueur d'arc sur C_i, alors que G_COLLET_MIN se mesure en corde à la limite de l'emmarchement. Avec un jour à angle vif et une marche d'angle à cheval sur le coin, l'exemple de B (126,7 mm d'arc répartis de part et d'autre du coin) donne une corde de 89,6 mm. M3 annonce donc 126 mm alors que la conformité déclenche l'avertissement des 100 mm. (f) Le symbole m désigne à la fois la pente h/g (M3) et le nombre de marches (M1).

**Risque** Si on implémente le pseudo-code tel quel, les quarts tournants bas ou haut serrés échouent faute de marches droites. Les U/S à volée intermédiaire courte donnent des marches qui se croisent. L'assistant affiche aussi un collet conforme que le moteur de règles contredit.

**Proposition** Implémentation proposée, par zone Z = [a, b] :

1. La zone porte `collarSide` (déduit du signe de la jonction) et C = courbe du bord jour de cette jonction. On précalcule σ_a = σ(Q_a) et σ_b = σ(Q_b), avec Q = intersection de la perpendiculaire à Γ en P avec C.
2. Chaque extrémité reçoit une condition `tangent` (pente m, partie droite qui continue) ou `free` (départ, arrivée, palier). Si elle est libre, on utilise un Hermite cubique à dérivée libre, obtenue en minimisant ∫F''² (spline naturelle : F'' = 0 à l'extrémité libre). En quintique, on garde F' et F'' à l'extrémité tangente seulement.
3. On calcule F'_max. Il est analytique pour A et B symétriques, et obtenu par échantillonnage de F' sur 200 points dans les autres cas. c_est = h/F'_max.
4. On inverse σ_k = F⁻¹(z_k) par dichotomie sur t ∈ [0, 1] (50 itérations, sans risque puisque F est strictement croissante et contrôlée). Il faut z_k général, pour que la hauteur de la première marche puisse différer.
5. Q_k = C(σ_k) ; φ_k = angle(Q_k − P_k) ; R_k = ℓ_k ∩ C_e (première intersection au-delà de P_k).
6. On mesure les collets en arc et en corde sur la ligne de mesure (offset de C) et on vérifie K2, K3, K5 et g_ext.
7. Le choix de zone énumère (n_avant, n_après) indépendamment, sous les contraintes a ≥ premier indice libre et b ≤ dernier, et retient la paire qui maximise le collet en corde mesuré, non l'estimation. Le coût reste négligeable : au plus environ 25 évaluations.
8. En U/S : si la volée intermédiaire contient au moins un giron entier entre les deux zones, on y place une marche virtuelle fixe perpendiculaire (la plus proche du milieu). Sinon, les deux jonctions forment une seule zone de 180° avec tangentes aux deux bouts. En S, les deux zones ont des côtés de collet opposés : il n'y a jamais de zone unique, et une volée intermédiaire trop courte (moins d'un giron) doit bloquer.
9. Renommer : `slope = h/g`, `nWinders` pour le nombre de marches.

_Réf._ B §3.1 (K2-K8), §3.5, §3.11, §2.3 ; SPEC §2.3, §4.2 ; rules.yaml G_COLLET_MIN (mesure en corde)

### [moyen] M1 : la formule par demi-zone est ambiguë au droit de la marche d'angle ; reformuler en profil de collets en V dans le même cadre que M3

**Constat** B §3.3 calcule chaque demi-zone jusqu'au point d'angle A « ou au milieu de la marche d'angle ». Dans le second cas, la marche d'angle reçoit deux demi-collets issus de deux progressions différentes, et rien ne garantit leur égalité ni la monotonie K3. Dans le premier cas, une ligne de nez passe exactement par le coin. Avec un jour à angle vif, cela donne un collet en corde égal à l'arc, mais une marche sur deux dépend alors de la parité du nombre de marches. Le saut en entrée de zone est aussi nettement plus fort qu'en M3 : sur l'exemple de B (N = 6, jour 900 mm, g = 250), M1 donne 200/150/100/100/150/200, soit un premier collet à 200 contre 184,6 en M3, et un minimum de 100 contre 126,7.

**Risque** Les résultats dépendent de la parité de N, et des collets non monotones apparaissent au centre. Les tests par propriété K3 échouent alors de façon aléatoire.

**Proposition** Implémenter M1 comme une stratégie qui produit directement σ_k, comme M3. On connaît N = b − a et L = σ_b − σ_a. Le point d'angle σ_A se trouve à l'indice j* tel que la marche j* contienne σ_A. Profil de collets : c_j = g − δ₁·j pour j ≤ j*, et c_j = g − δ₂·(N + 1 − j) pour j > j*, avec δ₁ = 2(n₁·g − L₁)/(n₁(n₁ + 1)) sur chaque côté (L₁ = σ_A − σ_a, n₁ = j*). La marche d'angle est coupée proportionnellement en σ_A. Cas symétrique : T = Σ min(j, N + 1 − j) = (p + 1)² si N = 2p + 1 et p(p + 1) si N = 2p, et δ = (N·g − L)/T. Si δ < 0, on revient à l'équipartition. Si min c_j < c_min, on augmente N. Le post-traitement (Q, R, contrôles) est ensuite commun à toutes les stratégies. M1 reste une option « tracé traditionnel », avec un avertissement de jarret égal à g − c₁.

_Réf._ B §3.3, §3.12 ; SPEC §2.3 (M1 au MVP)

### [majeur] Échappée : la mesure sur Γ rend K8 (pivot de marche pour gagner de l'échappée) sans effet, et néglige les recouvrements du tracé lui-même

**Constat** Décision Q4 : mesure verticale au-dessus de la ligne de pente, sur Γ. Or les P_k sont équirépartis sur Γ avec z_k = k·h, donc la ligne de pente vue sur Γ est exactement z(s) = z₀ + (h/g)·s, même dans les tournants. Faire pivoter une marche autour de P_k (K8, qui est justement défini comme conservant P_k) ne change donc rien à l'échappée mesurée sur Γ. L'exemple StairDesigner (1 975 → 2 150 mm) n'est reproductible que si l'échappée est évaluée sur toute la largeur de la marche. Par ailleurs, la SPEC ne dit rien de l'escalier qui passe sous lui-même. En hélicoïdal, la tête passe sous la marche du tour suivant : pour e ≥ 1 900 + épaisseur de marche (40 à 60 mm) avec h = 180, il faut au moins 11 marches par tour, soit Δθ ≤ 32,7°. C'est une contrainte forte de l'assistant. Cela vaut aussi pour les volées superposées d'un escalier multi-étages.

**Risque** Une fonctionnalité du MVP (pivot K8) resterait sans effet. Un hélicoïdal ou un escalier superposé serait aussi déclaré conforme alors que la tête heurte la marche du tour suivant.

**Proposition** Deux grandeurs, calculées sur le même modèle de « plafonds ». Les plafonds sont une liste de prismes : dalle haute moins la trémie, avec l'épaisseur ep ; poutres et obstacles ; sous-face des pièces du tracé lui-même, marches et limons générés au-dessus. (1) `echappee_reglementaire(s)` sur Γ, en forme exacte. Le long de Γ, z(s) est linéaire et le plafond est constant par morceaux, donc le minimum est atteint aux points où Γ sort d'une zone couverte (intersection Γ ∩ bord de trémie, calculée analytiquement segment par segment et arc par arc) et aux extrémités des obstacles. Pas d'échantillonnage. (2) `echappee_largeur` : le minimum sur les segments de nez Q_k–R_k et sur une bande de ±300 mm autour de Γ, évalué en avertissement et utilisé comme objectif de K8. Pour l'hélicoïdal, ajouter une règle dérivée N_tour·h − e_marche ≥ e_min, pour que l'assistant filtre les Δθ avant de générer quoi que ce soit.

_Réf._ A §1.7 ; SPEC §2.3 (échappée point par point, marche pivotée K8), §7bis Q4 ; B §3.1 K8, §1.1 hélicoïdal ; rules.yaml ECHAPPEE_MIN_DTU, TREMIE_LONGUEUR

### [majeur] Dépendances à rebours dans le pipeline : le découpage dépend de la structure, et la ligne de foulée dépend du garde-corps

**Constat** Selon Q7, la variante de M3 (cubique ou quintique) dépend de la structure (étape 4), mais le balancement a lieu à l'étape 3. B §2.1 mesure d_f « depuis la main courante intérieure » et A/rules.yaml « de la rampe », alors que la main courante n'existe qu'à l'étape 5. E est défini « entre faces internes des limons », ce qui suppose que l'épaisseur de limon, choix de structure, n'influence pas le tracé : c'est vrai seulement si les limons sont placés à l'extérieur de l'emprise utile. Or la trémie fixe l'emprise hors tout. Exemple de l'acceptation : trémie de 900 mm moins 2 limons de 40 à 60 mm donne E de 780 à 820 mm, pour un minimum de 800 mm en logement. La faisabilité dépend donc de la structure dès l'assistant.

**Risque** Sans cela, soit on crée une boucle Structure → Découpage qui casse le modèle « fonctions pures chaînées », soit l'assistant propose des tracés irréalisables une fois les limons posés dans la trémie.

**Proposition** (1) Faire de l'ÉPURE la référence : C_i et C_e sont les bords de l'emmarchement utile (faces internes des limons, ou extrémités de marche s'il n'y a pas de limon), et Γ et toutes les lignes de mesure s'y rapportent. d_f se mesure depuis C_i. La main courante devient un contrôle a posteriori (règle séparée « position LF / main courante », en avertissement). (2) Introduire une petite `StructureIntent`, saisie dans l'assistant avant le tracé : {famille : français | anglais | central | débillardé | profilé, épaisseurCôtéJour, épaisseurCôtéMur}. Elle sert seulement à : convertir l'emprise hors tout (trémie) en emprise utile ; choisir la variante M3 par défaut ; imposer des préconditions (débillardé ⇒ raccord de jour en arc). Le plugin `StructureKind` complet reste à l'étape 4 et relit l'intention. Pas de boucle dans le graphe de calcul.

_Réf._ Prompt 2 §2 (pipeline), §6 critère 1 ; SPEC §7bis Q7, §2.3 ; B §2.1 ; rules.yaml LF_POSITION_*

### [majeur] Développé de tôle pliée : aucune loi de déduction de pli dans la recherche, alors que le critère d'acceptation n° 3 exige des cotes réelles

**Constat** C §2.6 donne le rayon intérieur minimal et le bord minimal, mais aucune longueur développée (facteur K, déduction au pli, compensation). Sans elle, le DXF d'une marche en Z ou en U est faux de plusieurs millimètres par pli. Selon DIN 6935 (k = 0,65 + 0,5·log₁₀(r/t) si r/t < 5), un pli à 90° en t = 5 mm avec r = 6,5 mm donne une déduction v ≈ −10 mm par rapport à la somme des cotes extérieures. Une marche en Z à 2 plis est donc trop longue de 20 mm si l'on déroule les cotes extérieures. Autres manques : la convention de cote (intérieure, extérieure ou fibre neutre), l'angle (pli ou angle inclus) et le retour élastique. En zone balancée, chaque marche en tôle a des lignes de pli non parallèles (nez k et contremarche k+1) : ce sont des pièces toutes différentes, avec une aile de profondeur variable à contrôler contre le bord minimal aux deux extrémités.

**Risque** C'est le critère d'acceptation n° 3 (« directement exploitable en atelier ») qui échoue. La première tôle découpée serait fausse de 10 à 20 mm.

**Proposition** Ajouter à `capabilities.yaml` (par atelier, par matière et épaisseur) une loi de pli : {méthode : kFactor | DIN6935 | tableDéduction, k ou table, r_int outil, angle mini/maxi, springback optionnel}. Le développé se calcule en fibre neutre : L = Σ ailes droites + Σ θ·(r_int + k·t). Le DXF porte les lignes de pli sur un calque dédié avec sens (haut/bas), angle, r_int et un repère. Tests : snapshots d'une marche en Z de référence dont les cotes sont validées par un plieur pilote (question à ajouter en §7.3). Pour les marches balancées : le contrôle bord ≥ L_min se fait au point le plus court de chaque aile, et la nomenclature regroupe par géométrie identique (tolérance 0,5 mm) pour compter les pièces uniques.

_Réf._ C §2.6 (tableaux r_int / L_int, lignes 346-359), C-M-02, C-M-03 ; prompt 2 §6 critère 3 ; SPEC §2.4, §2.6

### [moyen] Développés de limons : préciser la courbe développée (face ou fibre neutre), la largeur variable en zone balancée et le calcul en forme fermée

**Constat** (1) B §5.2 intègre σ± par pas de 5 mm. Sur des arcs, la forme fermée σ = (R ∓ e/2)·θ est exacte, alors que l'intégration par pas cumule de l'erreur. (2) En métal roulé, le flan se trace en fibre neutre, mais les reports (supports, nez) se font sur la face. Pour R = 200 mm et e = 10 mm, l'écart est de 25 mm par mètre d'arc : il faut dire quelle abscisse porte chaque trait. (3) Avec d_h et d_b constants en vertical, la largeur perpendiculaire W = (d_h + d_b)·cos α varie : pente de 0,72 en partie droite (α = 35,8°, cos = 0,81) contre F'_max = 1,44 au collet (α = 55,2°, cos = 0,57). Le limon est donc 30 % plus étroit perpendiculairement au collet, là où les mortaises sont les plus rapprochées (collet de 127 mm pour h = 180). La largeur de débit et le « bois entre mortaises » doivent se dimensionner sur la zone la plus raide. (4) Un limon à la française droit en plan qui borde une zone balancée a une rive courbe (crosse), pas une droite de pente m : B §4.1 ne traite que le cas droit.

**Risque** Des développés justes à 1 mm en droit peuvent être faux de 2 à 3 cm sur un débillardé roulé, et un limon peut casser au collet parce que le bois restant entre deux mortaises n'a pas été contrôlé.

**Proposition** Représenter chaque face développée comme un profil (σ_face, z) construit par morceaux exacts : segment ou arc en plan ⇒ σ en forme fermée ; clothoïde ⇒ quadrature de Gauss. Les rives z_h(σ) = F(σ) + d_h, z_b(σ) = F(σ) − d_b s'échantillonnent de façon adaptative (erreur de corde ≤ 0,1 mm), puis sont converties en polylignes ou en splines pour le DXF. Chaque développé déclare `referenceFibre : 'faceInt' | 'faceExt' | 'neutre'`, et les reports sont transformés de la face à la fibre par σ_n = σ_f·(R_n/R_f) sur chaque arc. Les rives peuvent se définir en vertical ou à largeur perpendiculaire constante (option). Contrôles de fabrication ajoutés : largeur mini perpendiculaire et distance mini entre mortaises consécutives, mesurée sur le développé.

_Réf._ B §4.1, §4.2, §5.1, §5.2, §5.5 ; C lignes 300-303

### [moyen] Débillardé : préconditions géométriques et découpage par programmation dynamique à ramener à des règles simples en V1

**Constat** (1) Un débillardé suppose un raccord de jour courbe. Avec un angle vif ou un poteau, C_i a un coin, et il n'existe ni axe continu ni rive lisse ; la SPEC ne l'interdit nulle part. (2) Q7 prescrit la quintique C2 pour les débillardés, mais B §5.3 montre qu'avec un saut de courbure en plan, même F C2 laisse une cassure de pente de κ·e/2 sur les faces (arc sans clothoïde), et au mieux du G1 avec clothoïde. Le choix de la quintique coûte environ 10 % de collet (111 contre 125 mm) pour un gain qui n'existe que sur l'axe. (3) Le découpage en tronçons par programmation dynamique avec coût (B §5.4) dépend de coûts et de capacités d'atelier non sourcés (Q13, Q14) : c'est de l'optimisation sur des données absentes.

**Risque** Sinon, on consacre le jalon 5 à un optimiseur dont les poids sont arbitraires, et on génère des débillardés sur des jours à angle vif, qui sont géométriquement impossibles.

**Proposition** (1) Précondition au niveau des typologies : structure débillardée ⇒ raccord de jour en arc (r_j ≥ r_min de roulage ou de lamellé) ou en clothoïde ; l'assistant refuse sinon. (2) Défaut : variante cubique partout, plus un raccord « S2 » sur l'axe ; quintique en option. Il faut mesurer et afficher la cassure résiduelle sur chaque face (Δpente à la naissance), plutôt que promettre un C2 théorique. (3) Découpage V1 à base de règles : une coupe à chaque naissance, décalée de δ (paramètre, pour tomber dans la partie droite et hors support) ; si un tronçon dépasse le format de tôle ou de plateau, on le coupe au milieu de l'arc ; on vérifie les interdits (supports ± marge). La programmation dynamique vient en V2 une fois les coûts calibrés.

_Réf._ B §5.1, §5.3, §5.4 ; SPEC §2.4, §4.4-4.5, §7bis Q7, §7.3 Q13-Q16 ; C §1.6, §2.4

### [mineur] Tests par propriétés : certaines propriétés annoncées sont mal posées, d'autres manquent

**Constat** Le prompt 2 §4 cite « giron monotone sur la ligne de foulée » ; la SPEC exige des girons égaux, ce qui rend la propriété triviale ou fausse. K5 n'est vérifié que « après coup ». Côté mur, rien ne borne g_ext : dans un quart tournant, les R_k tombent sur un C_e en L rentrant, et la marche de l'angle extérieur devient un pentagone dont le giron extérieur peut dépasser 500 mm (K9 n'a pas de seuil chiffré). Les générateurs fast-check doivent aussi produire des sites valides : un générateur aléatoire de trémie et de hauteur produira surtout des cas infaisables, qui testeront le chemin d'échec.

**Risque** Une suite verte qui ne vérifie rien d'utile, et des marches d'angle extérieures démesurées non signalées.

**Proposition** Propriétés du cœur, sur des générateurs contraints (H ∈ [2 200, 3 500], E ∈ [700, 1 200], jour ∈ {vif, poteau, arc r ∈ [50, 400]}, typologie × position du tournant) : Σh = H (à 1e-6 près) ; |P_{k+1} − P_k|_Γ = g (à 1e-6 près) ; K5 des deux côtés (ordre strict des Q_k sur C_i et des R_k sur C_e, et aucun croisement de segment Q_k R_k) ; collets en arc et en corde > 0 et monotones vers l'angle (K3) pour M1 et M3 ; F strictement croissante (F' > 0 échantillonné) ; échappée_Γ(s) ≥ e_min ⇔ résultat du moteur de règles ; le recalcul après sérialisation JSON est identique ; stabilité à ε près (une variation de 1 mm de H ne fait pas sauter le nombre de marches balancées de plus d'une unité). Ajouter à rules.yaml une règle g_ext_max (avertissement, seuil paramétrable, à inscrire aux questions ouvertes).

_Réf._ Prompt 2 §4 (tests) ; SPEC §2.3 (invariants) ; B §3.1 K5, K9

### [moyen] L'assistant d'initialisation est un problème inverse : il faut l'énumérer explicitement, et l'exemple d'acceptation est à la limite

**Constat** Données de l'exemple : H = 2 700 mm, trémie de 2 800 × 900. En droit, h = 180 (n = 15) et g = 250 donnent L_tremie ≥ (1 900 + ep)·g/h = 2 829 mm pour ep = 250, soit plus que 2 800. Le droit est donc éliminé et le quart tournant devient nécessaire, ce qui est cohérent. Mais la position du tournant (bas, haut ou médian), le nombre de marches dans la volée hors trémie, le côté, le nombre de balancées et E (780 à 820 mm selon les limons) interagissent avec l'échappée et la conformité. La SPEC dit « proposer les typologies compatibles classées par score » sans dire comment l'espace est exploré.

**Risque** L'assistant resterait une boîte noire, et le critère n° 1 (moins de 2 minutes, conforme) dépendrait du hasard des valeurs par défaut.

**Proposition** L'assistant énumère un produit fini : typologie × sens × position de jonction (indice de marche) × n ∈ {⌈H/h_max⌉ … ⌈H/h_min⌉} × g sur une grille de 5 mm dans [g_min, 2h_max + g ≤ 660]. Pour chaque candidat, il génère la cage calée sur la trémie (arrivée au nez du bord de trémie), lance le découpage M3 avec choix automatique de zone, puis l'échappée exacte et les règles bloquantes, et élimine les échecs. Le score est une combinaison pondérée et affichée : |2h + g − 630|, collet mini en corde, marge d'échappée, nombre de balancées. Budget : quelques centaines de candidats × moins de 1 ms en couche analytique, dans un Web Worker. Ajouter l'exemple d'acceptation comme test de bout en bout, avec les attentes « au moins un quart tournant conforme trouvé » et « droit rejeté pour échappée ».

_Réf._ Prompt 2 §3 (assistant), §6 critère 1 ; SPEC §2.2 ; A §1.7 (L_tremie) ; rules.yaml TREMIE_LONGUEUR, ECHAPPEE_MIN_DTU

### Recommandations modèle

Principes : topologie explicite, primitives exactes, sorties canoniques communes à toutes les stratégies, entrées en mm entiers et calcul en double précision.

```ts
// ---- Géométrie 2D exacte (packages/core/geom2d)
type Vec2 = { x: number; y: number }; // mm, float
type Prim =
  | { kind: "line"; a: Vec2; b: Vec2 }
  | { kind: "arc"; c: Vec2; r: number; a0: number; sweep: number } // sweep signé (rad)
  | { kind: "clothoid"; p0: Vec2; theta0: number; k0: number; k1: number; len: number }; // V1
interface Path2D {
  prims: Prim[]; // G0 garanti, G1 aux jonctions déclarées
  length(): number;
  at(s: number): Vec2;
  tangent(s: number): Vec2;
  curvature(s: number): number;
  project(p: Vec2): number;
  intersectLine(p: Vec2, u: Vec2): number[];
}

// ---- Projet sérialisé (zod), entrées en mm entiers
interface CageInput {
  sections: Section[]; // n tronçons
  junctions: Junction[]; // n-1 jonctions
  start: { origin: Vec2; heading: number }; // ou calage sur la trémie
}
interface Section {
  axis: "straight" | { arc: { radius: number; sweepDeg: number } };
  length?: number; // droit ; dérivé si non fixé
  widthLeft: number;
  widthRight: number;
  widthEndLeft?: number;
  widthEndRight?: number;
}
interface Junction {
  angleDeg: 90 | -90 | 180 | -180 | number;
  mode: "landing" | "winders" | "radiating";
  innerJoin:
    | { kind: "sharp" }
    | { kind: "newel"; size: number }
    | { kind: "arc"; r: number }
    | { kind: "chamfer"; setbackLow: number; setbackHigh: number }
    | { kind: "clothoid"; len: number; r: number };
  outerJoin: { kind: "sharp" } | { kind: "arc"; r: number };
  landingDepth?: number;
}
interface StructureIntent {
  family: "french" | "english" | "central" | "debillarde" | "profile" | "none";
  sideThicknessInner: number;
  sideThicknessOuter: number;
} // pour convertir l'emprise trémie en emprise utile
interface SteppingInput {
  risers?: number;
  hTarget?: number;
  firstRiserDelta?: number;
  walkline: { rule: "DTU" } | { offsetFromInner: number };
  zones?: ZoneOverride[]; // surcharges expert : marches fixes, φ imposé, stratégie par zone
  defaultStrategy: StrategyRef;
}
type StrategyRef =
  | {
      id: "M3";
      variant: "cubic" | "quintic";
      endConditions?: ["tangent" | "free", "tangent" | "free"];
    }
  | { id: "M1" }
  | { id: "M0" }
  | { id: "M2"; alphaDeg: number }
  | { id: "M6"; lambda: number; p: number };

// ---- Épure dérivée (non sérialisée, fonctions pures)
interface Epure {
  inner: Path2D;
  outer: Path2D; // bords de l'emmarchement utile (C_i/C_e globaux pour l'affichage)
  walkline: Path2D; // Γ construit en forme fermée par jonction
  measureLines: { id: string; path: Path2D }[]; // lignes de mesure réglementaires découplées
  flights: { sStart: number; sEnd: number }[];
  landings: { sStart: number; sEnd: number }[];
  turns: {
    junctionIdx: number;
    collarSide: "left" | "right";
    collarPath: Path2D;
    sCorner: number;
  }[];
}
interface Nosing {
  k: number;
  z: number;
  P: Vec2;
  s: number;
  phi: number; // canonique
  Q: Vec2;
  sigmaQ: number;
  R: Vec2;
  sigmaR: number;
  fixed: boolean;
}
interface BalancingZone {
  a: number;
  b: number;
  turnIdx: number;
  collarSide: "left" | "right";
  ends: ["tangent" | "free", "tangent" | "free"];
}
interface BalancingStrategy {
  // toutes les stratégies rendent σ_k OU φ_k
  id: string;
  solve(ctx: {
    zone: BalancingZone;
    epure: Epure;
    nosings: Nosing[];
    h: number;
    g: number;
  }):
    | { kind: "sigma"; sigma: number[] }
    | { kind: "phi"; phi: number[] }
    | { kind: "fail"; reason: string };
  estimateMinCollar?(zone: BalancingZone, S: number, slope: number): number; // A : 2h/(3S−slope), B : h/(slope+1.875(S−slope))
}
// post-traitement commun : sigma|phi → Q, R, collets arc/corde par ligne de mesure, contrôles K2/K3/K5/g_ext
interface Stepping {
  h: number[];
  g: number;
  nosings: Nosing[];
  zones: BalancingZone[];
  collars: { k: number; arc: number; chord: Record<string, number> }[];
  riseCurves: Record<"inner" | "outer", DevCurve>;
}
interface DevCurve {
  pieces: { kind: "hermite3" | "hermite5" | "line"; s0: number; s1: number; coeffs: number[] }[];
} // F(σ) exacte

// ---- Échappée
interface Ceiling {
  polygon: Vec2[];
  zUnderside: number;
  source: "slab" | "beam" | "self";
}
interface HeadroomResult {
  minOnWalkline: { s: number; value: number }; // exact aux croisements
  minOnTreadWidth: { k: number; value: number };
} // K8 / avertissement

// ---- Développés (packages/geometry, calcul analytique)
interface Development {
  partId: string;
  fibre: "faceIn" | "faceOut" | "neutral";
  outline: Polyline2D;
  marks: {
    kind: "nosing" | "support" | "birth" | "joint" | "level" | "bend" | "roll";
    geom: Polyline2D;
    data?: any;
  }[];
}
interface BendLaw {
  method: "kFactor" | "DIN6935" | "table";
  k?: number;
  rInt: number;
  table?: [t: number, deduction: number][];
} // capabilities.yaml
```

Règles d'implémentation :

1. Γ, C_i et C_e se construisent par jonction en forme fermée (droite / arc r_j + d_f / droite). Pas de noyau d'offset générique avant l'import de plan (V2).
2. Toutes les stratégies passent par le même post-traitement et les mêmes contrôles.
3. z_k est une liste générale (pour la première marche distincte et les interpaliers).
4. Le collet se mesure en arc (fabrication) et en corde, sur chaque ligne de mesure.
5. `StructureIntent` est saisie dans l'assistant, ce qui évite la dépendance Découpage → Structure.
6. Les capacités d'atelier et les lois de pli sont des entrées versionnées, pas des constantes.
7. Tolérances des tests : 1e-6 mm pour les invariants ; arrondi seulement à l'affichage et à l'export.

Fichiers de référence : /home/glandais/code/perso/blondel/docs/research/B-geometrie.md (§1.3, §2, §3.3, §3.5, §4, §5), /home/glandais/code/perso/blondel/docs/SPEC.md (§2.3, §7bis), /home/glandais/code/perso/blondel/docs/research/C-structures.md (§2.6), /home/glandais/code/perso/blondel/docs/research/rules.yaml (G_COLLET_MIN, ECHAPPEE__, LF_POSITION__).

## Angle produit

### [majeur] Le critère d'acceptation n° 1 (quart tournant bois, conforme, PDF + DXF) ne peut être validé qu'à la fin du jalon 4, et reste ambigu sur le limon de jour

**Constat** Un quart tournant de H = 2 700 mm a forcément un côté vide avec une hauteur de chute > 1 m (GC_OBLIGATOIRE). Le mot « conforme » exige donc le garde-corps (jalon 4). Il exige aussi les tournants et le balancement (jalon 2) et le limon bois avec son DXF (jalon 3). Autre point : un quart tournant balancé en bois se fait côté jour soit avec un poteau d'angle et deux limons droits, soit avec un limon débillardé. Or le débillardé est classé V1 (jalon 5). Le critère ne dit pas laquelle des deux solutions est attendue. La SPEC §2.1 avance bien PDF et DXF aux jalons 1 et 3, mais elle ne corrige pas la dépendance au jalon 4.

**Risque** Le MVP est « terminé » sans pouvoir démontrer son critère phare, ou l'équipe avance le débillardé bois (le plus risqué) dans le MVP.

**Proposition** Réécrire le critère 1 ainsi : « quart tournant bas, limon à la française avec poteau d'angle (raccord de jour = poteau), H 2 700, trémie 2 800 × 900, E 800, profil maison individuelle + bois_dtu, garde-corps barreaudage côté vide ». Le déclarer jalon de validation « fin du jalon 4 ». Ajouter un critère intermédiaire par jalon (J1 : escalier droit exporté en PDF et DXF en moins de 60 s ; J2 : quart tournant sans structure, plan coté exact ; J3 : limons droits et poteau exportés). Mesurer les « 2 minutes » avec un test Playwright scripté, qui compte les clics et les saisies (par exemple ≤ 12 interactions), et non au chronomètre.

_Réf._ 02-conception-dev §6 crit. 1 ; SPEC §2.1, §2.4 ; rules.yaml GC_OBLIGATOIRE ; C §1.9

### [majeur] Le comparateur UPN / débillardé soudé ne compare pas « un même tracé » et ne peut pas chiffrer sans temps d'atelier

**Constat** (1) Un UPN est exclu en limon de jour à petit rayon : rayons de cintrage minimaux de 200 à 650 mm selon le sens [C §2.3]. La variante UPN d'un quart tournant balancé impose donc un angle vif ou un poteau côté jour, alors que le débillardé impose un arc ou un raccord courbe. Ce sont deux tracés de jour différents, et donc deux balancements et deux collets différents. (2) La SPEC interdit toute valeur par défaut de temps d'atelier non sourcée (Q13 : aucune donnée publique). Or la matière des limons ne pèse que quelques centaines d'euros (181 kg d'UPN, soit environ 220 à 330 €), face à des prix de marché de 3 500 à 15 000 €, et la main-d'œuvre représente 40 à 55 % d'un devis. Sans temps, le comparateur afficherait un débillardé presque aussi cher qu'un UPN. C'est faux d'un facteur 2 à 3 (« à partir de 8 000 € »).

**Risque** Un chiffre en euros faux mais crédible, qui décrédibilise l'outil auprès des artisans dès la première utilisation.

**Proposition** Définir la comparaison sur une même épure (Site + ligne de foulée + nombre de marches). Le raccord de jour et le balancement sont recalculés par variante, et les écarts de collet et d'échappée s'affichent. Le comparateur montre d'abord les grandeurs physiques qu'il sait calculer : kg, m², nombre de pièces, pièces uniques, nombre de gabarits, m de cordon (dont bout à bout), nombre de plis et de coupes, classe EXC. Il n'affiche un coût en euros que si un « profil d'atelier » est renseigné. Pour ce profil, fournir un assistant de calibration : l'artisan saisit 2 ou 3 chantiers passés (heures réelles), puis une régression simple estime les min/opération. En l'absence de profil, montrer des bandes de vraisemblance C §5.2, étiquetées « prix de marché, pas coût de revient ».

_Réf._ 02-conception-dev §6 crit. 2 ; SPEC §2.7, Q13 ; C §2.3, §5.2, §5.3, §5.4

### [majeur] « Mm entiers en interne » est incompatible avec les invariants « Σh = H » et « girons exactement égaux »

**Constat** Avec H = 2 700 et n = 16, h = 168,75 mm. Avec g réparti sur une ligne de foulée courbe, les longueurs d'arc sont irrationnelles. Les tests de propriétés demandent à la fois Σh_i = H et g_i strictement égaux, ce qui est impossible en entiers. Les angles « en degrés » en interne posent le même problème, puisque toute la trigonométrie travaille en radians.

**Risque** Des tests de propriétés rouges dès le jalon 1, ou des arrondis dispersés dans le code qui cassent la traçabilité des cotes.

**Proposition** Séparer les types : saisies utilisateur et cotes de fabrication en `Mm` entier (ou 0,1 mm), géométrie dérivée en `number` flottant (mm), angles en radians en interne et en degrés seulement à l'affichage. Arrondir une seule fois, en sortie (plans, DXF, débit), avec une répartition du reste (par exemple 169/168/169… qui respecte |h_i − h_nom| ≤ 5). Les propriétés fast-check portent sur les flottants avec une tolérance de 1e-6 mm, puis sur les cotes arrondies (Σ arrondie = H exactement, écart ≤ 1 mm).

_Réf._ 02-conception-dev §3 Unités, §4 Tests ; SPEC §2.3 invariants ; rules.yaml H_REGULARITE (abs(h_i - h_nom) <= 5)

### [majeur] Le moteur de règles ne peut pas être « alimenté directement » par rules.yaml

**Constat** Sur 100 règles, une bonne partie des champs `formule` ne sont pas évaluables : langage naturel (« g_collet[i] monotone vers l'angle », « ⚠️ non vérifié »), tables externes (`h_table(E_gc)`, `table_FCBA(essence, epaisseur)`, `table_6_12_NF_A1`), quantificateurs géométriques (« pour tout appui a X in [100 ; 600[ », « vide < 110 sur [0 ; 800] ») et implications de conception qui ne sont pas des contrôles (`E <= 1200 => d_lf = E/2`). Les règles de garde-corps 2024 (T1/T2/gabarit B) exigent une analyse géométrique du remplissage (passage de sphère, recherche d'appuis), et non une comparaison de nombres.

**Risque** Un parseur de formules ad hoc sans fin, ou des règles silencieusement ignorées alors que le rapport les affiche « OK ».

**Proposition** Garder le YAML comme source des métadonnées (id, seuils, nature, confiance, source, source_secondaire, contextes), mais écrire un évaluateur TypeScript par règle (`RuleEvaluator`, registre id → fonction). Un test CI vérifie que chaque id du YAML a un évaluateur ou porte explicitement `implemented: false`. Seuls les seuils viennent du YAML, jamais la logique. Classer les règles en « contrôle », « défaut de conception » (d_lf) et « information » (charges). Au jalon 4, limiter le contrôle des remplissages aux remplissages paramétriques (vide calculé analytiquement à partir de l'entraxe, de la section et des lisses), et reporter le gabarit B générique aux remplissages libres.

_Réf._ rules.yaml (formules l. 413, 454-510, 1191, 1218-1274, 1315-1370) ; SPEC §3.1 ; 02-conception-dev §3 Conformité

### [majeur] Le mot « conforme » est juridiquement exposé : 53 règles viennent de normes non lues, 28 d'entre elles bloquantes

**Constat** La décision 7bis refuse l'achat des normes. Le profil `strict` garde bloquantes des valeurs reprises de sources secondaires. Un rapport intitulé « conformité », exporté en PDF et remis à un client ou à un contrôleur, engage l'artisan, et peut-être l'éditeur. Cas concret : un escalier métal en rénovation de maison individuelle. `bois_dtu` ne s'applique pas (métal), `logement_interieur` vise le neuf, et une maison construite pour son propre usage échappe aux règles d'accessibilité (à vérifier). Il ne reste presque aucune règle : le rapport dirait « conforme » par vacuité.

**Risque** Un faux sentiment de conformité, et une mise en cause de l'artisan ou de l'éditeur en cas de litige.

**Proposition** (1) Renommer la sortie en « contrôle de conception » ou « pré-vérification ». Chaque ligne affiche nature, confiance et `source_secondaire`, et le PDF porte un avertissement. (2) Ajouter un contexte `regles_de_l_art`, actif par défaut quel que soit le matériau, qui applique les valeurs DTU en nature `metier` et sévérité `avertissement`. Ainsi un escalier métal en rénovation est contrôlé (Blondel, h, g, échappée). (3) Afficher la liste des règles non évaluées ou hors champ, pour qu'un rapport vide ne passe pas pour un succès.

_Réf._ SPEC §0.3, §7bis ; rules.yaml `profils`, `contextes` ; A §3.4

### [majeur] Les jalons 3 et 5 sont surchargés : chacun vaut au moins trois jalons

**Constat** Le jalon 3 réunit 2 limons bois, le plat laser, un catalogue UPN/IPN/IPE/HEA, les supports (cornières, platines, consoles), la tôle pliée Z/U, le caillebotis et la tôle larmée, le mixte, les contremarches et les nez, les développés, la nomenclature, le chiffrage et le DXF. Le jalon 5 réunit le débillardé bois (massif et lamellé) et métal, l'hélicoïdal (fût et à jour), les multi-volées hétérogènes, les mains courantes hélicoïdales et le comparateur. Or les questions Q14 à Q17 (capacités, joints, clothoïde, couronne) ne sont validées par aucun atelier.

**Risque** Des jalons qui ne se terminent jamais, et un MVP livré sans aucune structure réellement exploitable en atelier.

**Proposition** Découper : J3a « métal droit et quart tournant avec poteau » (plat laser + UPN + cornières + tôle pliée, développés, DXF, nomenclature) ; J3b « bois » (française, anglaise, poteau). J5a hélicoïdal : géométrie exacte et simple (B §4.3), fréquent en kit, à avancer juste après J4, voire avant. J5b débillardé soudé métal : c'est le différenciateur selon D §1.5. J5c débillardé bois et lamellé, repoussé en V2 tant que Q15 à Q17 ne sont pas levées. Choisir un persona MVP : je recommande le métallier (créneau vide, développés de tôle calculables), le bois venant ensuite.

_Réf._ 02-conception-dev §5 ; SPEC §2.4, §7.3 ; D §1.5 ; B §4.3, §5

### [moyen] Aucun prédimensionnement structurel, alors que c'est la première question de l'artisan (« UPN 120 ou 160 ? plat de 8 ou de 10 ? »)

**Constat** Le catalogue de sections est « choisi par l'utilisateur », et la règle de flèche L/200 est « bloquante si calcul », mais aucun jalon ne prévoit de calcul. Or un contrôle simple coûte peu et change le choix. Exemple : E = 0,9 m, q = 2,5 kN/m² + G ≈ 0,8 kN/m², soit ≈ 1,5 kN/m par limon, sur une portée horizontale de 3,5 m. On obtient M ≈ 2,3 kN·m et une flèche ≈ 1,5 mm pour un UPN 160 (I ≈ 925 cm⁴) : l'UPN 160 est très surdimensionné en flexion. Pour un plat de 300 × 10, c'est le déversement et la vibration (f₁ ≥ 5 Hz) qui dimensionnent, pas la flèche.

**Risque** Un outil qui dessine mais laisse l'artisan dimensionner à l'œil, ce qui annule la promesse « du paramétrique à l'atelier » et incite à surdimensionner (coût, poids).

**Proposition** Ajouter au J3 un module `precheck` indicatif : poutre inclinée sur deux appuis, charges de l'annexe nationale (2,5 kN/m², 2 kN), flèche, contrainte, f₁ simplifiée et déversement simplifié pour les plats. Proposer automatiquement la plus petite section du catalogue qui passe, avec le libellé « prédimensionnement, ne remplace pas une note de calcul ». Porte-à-faux et suspendu : aucun calcul, justification obligatoire (déjà prévu).

_Réf._ SPEC §2.4 exigences transverses, X16, X17 ; C §1.2, §1.3, §2.3 ; rules.yaml FLECHE_*

### [moyen] Des DXF « directement exploitables en atelier » : critère invérifiable sans paramètres de pliage ni atelier pilote

**Constat** Le développé d'une tôle pliée dépend du facteur K ou de la déduction de pli, donc de l'outillage (ouverture de V, rayon du poinçon, épaisseur). L'erreur atteint 1 à 3 mm par pli en 4 à 8 mm, et une marche en Z a 2 plis. Par ailleurs, la décision X14 fixe AC1021 au MVP, alors que plusieurs ateliers et logiciels de FAO laser demandent du R12 ou du 2000. Q14 et Q18 sont ouvertes : aucun atelier n'est prévu dans la boucle.

**Risque** Des pièces découpées fausses, un rebut coûteux, et une perte de confiance immédiate du métallier.

**Proposition** (1) Profil d'atelier dès le J3 : facteur K ou table de déduction par épaisseur, rayon intérieur, formats de tôle et longueur de presse (capabilities.yaml). (2) Écrivain DXF R12 minimal (LINE, ARC, CIRCLE, TEXT, calques ; environ 200 lignes) par défaut pour les pièces, AC1021 réservé aux plans cotés. C'est moins cher que le risque de rejet. (3) Critère testable automatiquement : contours fermés, un calque par fonction, relecture par un second parseur (dxf-parser) avec comparaison des cotes à ±0,01 mm. (4) Critère humain : un atelier pilote découpe et plie une marche et un tronçon avant de clore le J3.

_Réf._ 02-conception-dev §6 crit. 3 ; SPEC §2.6, X14, §7bis, Q14, Q18 ; C §2.6 ; D §3.1

### [moyen] « Absence d'intersection entre pièces » : une propriété mal définie, puisque les assemblages s'interpénètrent volontairement

**Constat** Marches encastrées de 15 à 20 mm dans les mortaises d'un limon à la française, tenons, cornières soudées, platines : l'interpénétration est la norme. Un test booléen global est aussi coûteux (manifold sur 50 à 100 pièces) et inutilisable pour distinguer un défaut d'un assemblage.

**Risque** Des tests instables ou désactivés, ou un modèle de pièces sans notion de liaison, qu'il faudra refaire pour la nomenclature (cordons, boulons).

**Proposition** Modéliser explicitement les liaisons (`Joint { kind: 'mortaise'|'soudure'|'boulon'|'appui', parts, volume_autorisé }`) et tester : interférence hors volumes de liaison = 0 (tolérance 0,1 mm³), jeu minimal marche–mur ≥ paramètre. En test de propriété, se limiter à des invariants analytiques (lignes de nez sans croisement K5, collet > 0, échappée), et réserver le test booléen à quelques escaliers de référence.

_Réf._ 02-conception-dev §4 Tests ; B §3.1 K5 ; C §1.4

### [moyen] L'édition libre des lignes de nez en plan au J2 entre en conflit avec les algorithmes de balancement et l'undo

**Constat** Si l'utilisateur tire une ligne de nez, qu'est-ce qui reste fixe ? Le pivot P_k sur la ligne de foulée (invariant B §3.1) ? Les marches voisines sont-elles re-balancées ? Et si l'on change ensuite H ou la trémie, l'édition manuelle survit-elle ? Sans ces règles, l'édition directe casse K3, K5 et la régénération paramétrique.

**Risque** Un modèle hybride non reproductible (le JSON projet ne régénère plus le même escalier), et des bugs d'undo/redo difficiles à corriger.

**Proposition** Au J2, restreindre l'édition directe à des surcharges typées et persistées : `override angle φ_k` (glisser autour de P_k), `marche fixe`, `pivot pour échappée` (K8). Les recalculs respectent les surcharges, les autres marches sont re-balancées, et une surcharge qui viole K5 est signalée puis gelée. Le déplacement libre des points de la ligne de foulée passe en V1.

_Réf._ 02-conception-dev §3 Modes ; SPEC §2.3 ; B §3.1 K3, K5, K8

### [mineur] Ce que l'artisan attend en premier : relevé fiable, plan de pose et débit, avant la 3D et l'import de plan

**Constat** Sur un chantier réel, trémie et murs sont rarement d'équerre, et la tolérance de gros œuvre est de [0 ; +7] mm. L'artisan relève les cotes au laser ou au mètre, avec les diagonales. La trémie polygonale est au J2 mais les murs non d'équerre ne sont pas spécifiés. L'import DXF ou image (J7) sert surtout aux bureaux d'études. Le lien partageable suppose un backend, qui n'est mentionné nulle part.

**Risque** Un outil qui modélise des chantiers idéaux, et des escaliers qui ne rentrent pas à la pose.

**Proposition** Avancer au J1-J2 une saisie de relevé : 4 côtés de trémie + 2 diagonales qui déduisent le polygone, faux-équerrage des murs, hauteur relevée en plusieurs points. Garder l'import DXF ou image en V2. Au J1, sortir une fiche de pose PDF (traçage au sol du départ, cotes d'implantation). Pour le lien partageable sans serveur, encoder le JSON projet compressé dans le fragment d'URL (quelques Ko pour un escalier), sinon le déclarer V1 avec backend.

_Réf._ SPEC §2.2, §2.8 ; A §1.7 TREMIE_TOLERANCE ; D §1.3 (relevé Flexijet, Disto)

### [mineur] Budget de performance < 100 ms à définir, et au bon endroit

**Constat** « Escalier standard » et le matériel de référence ne sont pas définis. La régénération complète inclut des booléens manifold (entailles, trous) et la conformité, ce qui est coûteux (échappée point par point, gabarits de garde-corps). Un Web Worker ajoute 5 à 20 ms de sérialisation aller-retour par recalcul.

**Risque** Une exigence invérifiable, puis une optimisation tardive et coûteuse, ou un worker introduit trop tôt qui complique le débogage.

**Proposition** Fixer par écrit une référence (quart tournant, 16 marches, 2 limons, garde-corps de 30 barreaux ; ordinateur portable de milieu de gamme, 4× CPU throttle dans Playwright) et un budget par étage : cœur analytique ≤ 15 ms (thread principal, sans worker), maillage d'aperçu sans booléens ≤ 30 ms, booléens et conformité lourde en asynchrone et incrémentaux (mise à jour sous 300 ms). Ajouter un benchmark en CI (vitest bench) avec un seuil de régression. Mémoïser par étage du pipeline (hash d'entrée), ce qui rend la pureté des fonctions rentable.

_Réf._ 02-conception-dev §3 Paramétrique ; SPEC §5 Performance ; D §4.1

### Recommandations modèle

1. Deux types numériques explicites : `type Mm = number & {__brand:'Mm'}` pour les cotes saisies ou fabriquées (entières), les flottants mm pour la géométrie dérivée, `Rad` en interne et degrés seulement à l'affichage. Une fonction unique `roundForOutput(values, total)` répartit le reste.
2. Séparer Épure et Constituants : `Project { schemaVersion, rulesetVersion, site: Site, epure: Epure, variants: Variant[], activeVariantId, workshopProfileId?, overrides: Override[] }`. Une `Variant { id, structure: StructureSpec, railing: RailingSpec, jourJoint: 'angle'|'poteau'|'arc'|'clothoide' }` partage l'Épure. Le raccord de jour appartient à la variante, pour permettre la comparaison UPN / débillardé.
3. `Site { H: Mm, floorFinishes, slabThickness, opening: Polygon | SurveyedOpening{sides, diagonals}, walls: Wall{segment, bearing: boolean, outOfSquare?}[], obstacles[], date: {permitDate?, contractDate?} }` : la date pilote le régime garde-corps 1988 ou 2024.
4. Overrides typés et persistés : `{kind:'fixedStep', k} | {kind:'nosingAngle', k, phi: Rad} | {kind:'pivotForHeadroom', k}` ; le balancement doit les respecter.
5. Pièces et liaisons : `Part { id, mark, material, section?, ops: Op[], solid: SolidRef, flatPattern?: FlatPattern }` et `Joint { kind, parts: [id,id], allowedOverlap?: VolumeRef, weld?: {length, type:'bout_a_bout'|'angle'} }`. La classe EXC se déduit des joints et des matériaux.
6. Profil d'atelier séparé et versionné : `WorkshopProfile { capabilities: {pressBrake:{maxLength, maxThickness, kFactorTable}, rolling, bending:{minRadiusBySection}, sheetFormats, barLengths}, times?: {perCut, perBend, perWeldMeter, perJig, ...}, rates?, calibration?: PastJob[] }` ; le coût en euros n'est calculé que si `times` et `rates` sont définis.
7. Règles : `RuleMeta` (issu du YAML : id, seuils, nature, confiance, source, source_secondaire, contextes, kind: 'check'|'designDefault'|'info') + `RuleEvaluator = (ctx: EvalContext) => RuleResult[]` dans un registre TS ; `RuleResult { ruleId, status:'ok'|'warn'|'block'|'notEvaluated'|'outOfScope', measured, threshold, location:{stepIndex?|partId?|point3d?}, downgradedBy?: {user, reason} }`. Ajouter un contexte `regles_de_l_art` actif par défaut.
8. Sorties de comparaison : `VariantMetrics { massKg, surfaceM2, partCount, uniquePartCount, jigCount, weldLengthM, buttWeldLengthM, bendCount, cutCount, exc: 'EXC1'|'EXC2', cost?: {material, labour?, subcontract?, confidence} }`.
9. Préparer dès le jalon 0 les champs IFC `Pset_StairFlightCommon` (nombre de hauteurs, girons, etc.) en propriétés dérivées plutôt qu'en champs stockés, pour éviter les désynchronisations.
10. Chaque étage du pipeline est une fonction pure `stage(input, deps) => output`, mémoïsée par hash structurel, pour tenir le budget de temps et faciliter les snapshots des escaliers de référence.
