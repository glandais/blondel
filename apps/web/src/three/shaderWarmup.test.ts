import {
  BoxGeometry,
  Group,
  Mesh,
  MeshBasicMaterial,
  PerspectiveCamera,
  Scene,
  type Camera,
  type Object3D,
} from "three";
import { describe, expect, it } from "vitest";
import {
  drawAlone,
  shaderRepresentatives,
  warmUpShaders,
  type WarmupRenderer,
} from "./shaderWarmup.js";

/** Faux moteur de rendu : note les maillages visibles à chaque tracé. */
function fakeRenderer(
  options: { parallel?: boolean; lostAtStart?: boolean; compile?: () => Promise<unknown> } = {},
) {
  const listeners = new Set<() => void>();
  let lost = options.lostAtStart ?? false;
  const draws: string[][] = [];
  const gl = {
    draws,
    scissor: false,
    extensions: { has: (name: string) => !!options.parallel && name.startsWith("KHR_parallel") },
    domElement: {
      addEventListener: (_type: string, l: () => void) => listeners.add(l),
      removeEventListener: (_type: string, l: () => void) => listeners.delete(l),
    },
    listeners,
    getContext: () => ({ isContextLost: () => lost }),
    loseContext() {
      lost = true;
      for (const l of [...listeners]) l();
    },
    compileAsync: (options.compile ?? (() => Promise.resolve())) as never,
    setScissor: () => {},
    setScissorTest(on: boolean) {
      gl.scissor = on;
    },
    render(scene: Object3D) {
      if (!gl.scissor) throw new Error("tracé hors ciseau");
      const visible: string[] = [];
      scene.traverseVisible((o) => {
        if ((o as Mesh).isMesh) visible.push(o.name);
      });
      draws.push(visible);
    },
  };
  return gl as typeof gl & WarmupRenderer;
}

function sceneOf(): { scene: Scene; camera: Camera } {
  const a = new MeshBasicMaterial();
  const b = new MeshBasicMaterial();
  const geo = new BoxGeometry();
  const scene = new Scene();
  const mesh = (name: string, m: MeshBasicMaterial, receive = false): Mesh => {
    const o = new Mesh(geo, m);
    o.name = name;
    o.receiveShadow = receive;
    return o;
  };
  const group = new Group();
  group.add(mesh("a1", a), mesh("a2", a), mesh("a-ombre", a, true));
  const hiddenGroup = new Group();
  hiddenGroup.visible = false;
  hiddenGroup.add(mesh("b-cache", b));
  scene.add(group, hiddenGroup, mesh("b1", b));
  return { scene, camera: new PerspectiveCamera() };
}

describe("préparation des shaders de la vue 3D", () => {
  it("un représentant par couple (matériau, ombre reçue), objets masqués ignorés", () => {
    const { scene } = sceneOf();
    expect(shaderRepresentatives(scene).map((o) => o.name)).toEqual(["a1", "a-ombre", "b1"]);
  });

  it("rendu logiciel : chaque représentant dessiné seul, dans le ciseau, visibilités rétablies", async () => {
    const { scene, camera } = sceneOf();
    const gl = fakeRenderer();
    await warmUpShaders(gl, scene, camera, () => true);
    expect(gl.draws).toEqual([["a1"], ["a-ombre"], ["b1"]]);
    const visible: string[] = [];
    scene.traverseVisible((o) => visible.push(o.name));
    expect(visible.filter(Boolean)).toEqual(["a1", "a2", "a-ombre", "b1"]);
    expect(gl.scissor).toBe(false);
    expect(gl.listeners.size).toBe(0);
  });

  it("tracé qui lève : visibilités et ciseau rétablis", () => {
    const { scene, camera } = sceneOf();
    const gl = fakeRenderer();
    gl.render = () => {
      throw new Error("contexte perdu");
    };
    const target = scene.getObjectByName("b1")!;
    expect(() => drawAlone(gl, scene, camera, target)).toThrow("contexte perdu");
    expect(scene.getObjectByName("a1")!.visible).toBe(true);
    expect(gl.scissor).toBe(false);
  });

  it("vue démontée pendant la préparation : arrêt sans tracé", async () => {
    const { scene, camera } = sceneOf();
    const gl = fakeRenderer();
    await warmUpShaders(gl, scene, camera, () => false);
    expect(gl.draws).toEqual([]);
  });

  it("compilation parallèle : `compileAsync` attendu", async () => {
    const { scene, camera } = sceneOf();
    let compiled = 0;
    const gl = fakeRenderer({
      parallel: true,
      compile: async () => {
        compiled++;
      },
    });
    await warmUpShaders(gl, scene, camera, () => true);
    expect(compiled).toBe(1);
    expect(gl.draws).toEqual([]);
    expect(gl.listeners.size).toBe(0);
  });

  it("contexte perdu pendant `compileAsync` (jamais résolu) : la préparation se termine", async () => {
    const { scene, camera } = sceneOf();
    const gl = fakeRenderer({ parallel: true, compile: () => new Promise(() => {}) });
    const warm = warmUpShaders(gl, scene, camera, () => true);
    await new Promise((resolve) => setTimeout(resolve, 5));
    gl.loseContext();
    await expect(warm).resolves.toBeUndefined();
    expect(gl.listeners.size).toBe(0);
  });

  it("contexte déjà perdu : rendu logiciel sans aucun tracé", async () => {
    const { scene, camera } = sceneOf();
    const gl = fakeRenderer({ lostAtStart: true });
    await warmUpShaders(gl, scene, camera, () => true);
    expect(gl.draws).toEqual([]);
  });
});
