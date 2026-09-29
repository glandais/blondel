/**
 * Mesures de performance affichées dans la barre d'état (ADR-0006) : le temps du cœur est
 * porté par le résultat du modèle ; le temps de maillage est publié ici par la vue 3D (le
 * maillage n'est calculé que lorsqu'elle est affichée).
 */
import { useStore } from "zustand";
import { createStore } from "zustand/vanilla";

export interface MeshTiming {
  readonly timeMs: number;
  readonly hits: number;
  readonly misses: number;
}

export interface PerfState {
  /** Dernier maillage d'aperçu ; `null` tant que la vue 3D n'a pas été affichée. */
  readonly mesh: MeshTiming | null;
}

export const perfStore = createStore<PerfState>()(() => ({ mesh: null }));

export function publishMeshTiming(t: MeshTiming): void {
  const cur = perfStore.getState().mesh;
  if (cur && cur.timeMs === t.timeMs && cur.hits === t.hits && cur.misses === t.misses) return;
  perfStore.setState({ mesh: t });
}

/**
 * Vue 3D démontée : plus de maillage mesuré. Sans cela, la barre d'état afficherait le temps
 * d'un maillage ancien alors que le projet a changé depuis (valeur périmée).
 */
export function clearMeshTiming(): void {
  if (perfStore.getState().mesh !== null) perfStore.setState({ mesh: null });
}

export function useMeshTiming(): MeshTiming | null {
  return useStore(perfStore, (s) => s.mesh);
}
