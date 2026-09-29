import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { createLatestRunner } from "./latestRunner.js";

interface Deferred {
  input: object;
  resolve: (v: string) => void;
  reject: (e: unknown) => void;
}

/** Exécutant asynchrone contrôlé par le test. */
function manualExec() {
  const calls: Deferred[] = [];
  const exec = (input: object) =>
    new Promise<string>((resolve, reject) => calls.push({ input, resolve, reject }));
  return { calls, exec };
}

const flush = () => new Promise((r) => setTimeout(r, 0));

describe("exécution « dernier demandé seulement »", () => {
  it("calcule seulement la dernière demande faite pendant un calcul et écarte le résultat obsolète", async () => {
    const { calls, exec } = manualExec();
    const published: [object, string][] = [];
    const pending: boolean[] = [];
    const runner = createLatestRunner<object, string>({
      exec,
      onResult: (i, o) => published.push([i, o]),
      onPending: (p) => pending.push(p),
      onError: () => "erreur",
    });
    const [a, b, c] = [{ n: 1 }, { n: 2 }, { n: 3 }];
    runner.submit(a);
    runner.submit(b); // remplacée par c avant d'avoir démarré : jamais calculée
    runner.submit(c);
    expect(calls.map((x) => x.input)).toEqual([a]);
    calls[0]!.resolve("A");
    await flush();
    // A est obsolète (c demandé depuis) : non publié ; c démarre.
    expect(published).toEqual([]);
    expect(calls.map((x) => x.input)).toEqual([a, c]);
    calls[1]!.resolve("C");
    await flush();
    expect(published).toEqual([[c, "C"]]);
    expect(runner.started).toBe(2);
    expect(pending).toEqual([true, false]);
    expect(runner.pending).toBe(false);
  });

  it("republie aussitôt un résultat en cache (annuler / rétablir) sans recalcul", async () => {
    const { calls, exec } = manualExec();
    const published: string[] = [];
    const runner = createLatestRunner<object, string>({
      exec,
      onResult: (_i, o) => published.push(o),
      onError: () => "erreur",
    });
    const a = {};
    const b = {};
    runner.submit(a);
    calls[0]!.resolve("A");
    await flush();
    runner.submit(b);
    runner.submit(a); // retour à a pendant le calcul de b : publié tout de suite
    expect(published).toEqual(["A", "A"]);
    expect(runner.pending).toBe(false);
    calls[1]!.resolve("B");
    await flush();
    expect(published).toEqual(["A", "A"]); // b obsolète
    runner.submit(b); // b a été mis en cache malgré tout
    expect(published).toEqual(["A", "A", "B"]);
    expect(calls).toHaveLength(2);
  });

  it("ne relance pas une demande identique déjà en cours ; exécutant synchrone publié tout de suite", async () => {
    const { calls, exec } = manualExec();
    const runner = createLatestRunner<object, string>({
      exec,
      onResult: () => undefined,
      onError: () => "erreur",
    });
    const a = {};
    runner.submit(a);
    runner.submit(a);
    calls[0]!.resolve("A");
    await flush();
    expect(calls).toHaveLength(1);

    const out: string[] = [];
    const sync = createLatestRunner<number, string>({
      exec: (n) => `r${n}`,
      onResult: (_i, o) => out.push(o),
      onError: () => "erreur",
    });
    sync.submit(1);
    sync.submit(2);
    expect(out).toEqual(["r1", "r2"]);
    expect(sync.pending).toBe(false);
  });

  it("un échec (exception ou rejet) publie le résultat de repli", async () => {
    const out: string[] = [];
    const throwing = createLatestRunner<number, string>({
      exec: () => {
        throw new Error("boum");
      },
      onResult: (_i, o) => out.push(o),
      onError: (_i, e) => `repli : ${(e as Error).message}`,
    });
    throwing.submit(1);
    const rejecting = createLatestRunner<number, string>({
      exec: () => Promise.reject(new Error("rejet")),
      onResult: (_i, o) => out.push(o),
      onError: (_i, e) => `repli : ${(e as Error).message}`,
    });
    rejecting.submit(2);
    await flush();
    expect(out).toEqual(["repli : boum", "repli : rejet"]);
  });

  it("un échec n'est pas mis en cache : revenir à l'entrée relance le calcul", async () => {
    // Revue adverse A21 : un calcul abandonné par le chien de garde (machine chargée, délai
    // dépassé) restait en cache ; annuler / rétablir vers ce projet republiait l'erreur sans
    // jamais relancer le calcul.
    const { calls, exec } = manualExec();
    const out: string[] = [];
    const runner = createLatestRunner<object, string>({
      exec,
      onResult: (_i, o) => out.push(o),
      onError: (_i, e) => `repli : ${(e as Error).message}`,
    });
    const a = {};
    const b = {};
    runner.submit(a);
    calls[0]!.reject(new Error("délai dépassé"));
    await flush();
    expect(out).toEqual(["repli : délai dépassé"]);
    runner.submit(b);
    calls[1]!.resolve("B");
    await flush();
    runner.submit(a); // pas de republication de l'erreur : nouveau calcul
    expect(calls).toHaveLength(3);
    expect(runner.pending).toBe(true);
    calls[2]!.resolve("A");
    await flush();
    expect(out).toEqual(["repli : délai dépassé", "B", "A"]);
  });

  it("propriété : la dernière publication est toujours celle de la dernière demande", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(fc.tuple(fc.integer({ min: 0, max: 5 }), fc.boolean()), {
          minLength: 1,
          maxLength: 30,
        }),
        async (ops) => {
          const inputs = Array.from({ length: 6 }, (_, i) => ({ i }));
          const { calls, exec } = manualExec();
          const published: [object, string][] = [];
          const runner = createLatestRunner<object, string>({
            exec,
            onResult: (i, o) => published.push([i, o]),
            onError: () => "erreur",
            cacheSize: 3,
          });
          let resolved = 0;
          for (const [k, settle] of ops) {
            runner.submit(inputs[k]!);
            if (settle) {
              while (resolved < calls.length) {
                const c = calls[resolved++]!;
                c.resolve(`r${(c.input as { i: number }).i}`);
                await flush();
              }
            }
          }
          while (resolved < calls.length) {
            const c = calls[resolved++]!;
            c.resolve(`r${(c.input as { i: number }).i}`);
            await flush();
          }
          const last = inputs[ops[ops.length - 1]![0]]!;
          const lastPub = published[published.length - 1];
          expect(lastPub?.[0]).toBe(last);
          expect(lastPub?.[1]).toBe(`r${last.i}`);
          // Toute publication correspond à son entrée.
          for (const [i, o] of published) expect(o).toBe(`r${(i as { i: number }).i}`);
          expect(runner.pending).toBe(false);
        },
      ),
      { numRuns: 200 },
    );
  });
});
