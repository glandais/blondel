# ADR-0001 — Noyau géométrique : couche analytique TS, pas de noyau CAO au MVP

- Statut : accepté (jalon 0, 2026-09-28)
- Contexte : prompt 2 §4 demande de choisir entre manifold-3d et OpenCascade.js/replicad. SPEC §5 et [D §4.1].

## Décision

1. **Source de vérité = couche analytique TypeScript** (`@blondel/core`) : tracé, découpage, balancement, pièces décrites par `SolidDesc` (extrusion de profil plan, surface réglée épaissie, balayage), développés `FlatPattern` calculés analytiquement.
2. **Maillage d'aperçu** (`@blondel/geometry`) : triangulation maison (earcut intégré, extrusion, surfaces réglées, balayage). Aucune dépendance wasm au MVP.
3. **manifold-3d** (Apache-2.0, ≈ 0,2 Mo) : introduit seulement quand un booléen devient nécessaire (mortaises visibles en 3D, entailles de crémaillère, vue en coupe) — jalon 3 au plus tôt, derrière une interface `BooleanBackend`.
4. **replicad + OCCT** (LGPL, ≈ 4,8 Mo) : seulement pour l'export STEP (V1, jalon 6), dans un Web Worker chargé à la demande. Question juridique Q21 ouverte.

## Justification

- Les développés, cotes et contrôles doivent être exacts et testables : aucune bibliothèque web ne les fournit [D §2.2].
- < 100 ms : un escalier standard compte < 200 pièces simples ; l'extrusion analytique est en O(sommets).
- Un noyau B-Rep au chemin critique ajouterait 5 Mo et une latence de démarrage pour un gain nul au MVP.

## Conséquences

- Les pièces à géométrie complexe (débillardé) sont décrites en surfaces réglées/balayages dès la couche métier.
- Les exports 2D (DXF, SVG, PDF) partent des `FlatPattern` et du tracé, jamais d'une projection du maillage.
