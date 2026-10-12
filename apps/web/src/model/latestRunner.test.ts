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

describe("aperçu : résultats obsolètes publiés (publishStale), abandon (cancel)", () => {
  it("demandes à chaque image : chaque résultat reçu est publié s'il est plus récent, les intermédiaires jamais calculés", async () => {
    const { calls, exec } = manualExec();
    const published: string[] = [];
    const runner = createLatestRunner<object, string>({
      exec,
      onResult: (_i, o) => published.push(o),
      onError: () => "erreur",
      publishStale: true,
      cacheSize: 0,
    });
    const inputs = Array.from({ length: 6 }, (_, n) => ({ n }));
    runner.submit(inputs[0]!);
    runner.submit(inputs[1]!);
    runner.submit(inputs[2]!);
    calls[0]!.resolve("0");
    await flush();
    // 0 est obsolète mais rien n'était affiché : publié (dernier aperçu reçu). 1 abandonné.
    expect(published).toEqual(["0"]);
    expect(calls.map((c) => c.input)).toEqual([inputs[0], inputs[2]]);
    runner.submit(inputs[3]!);
    calls[1]!.resolve("2");
    await flush();
    expect(published).toEqual(["0", "2"]);
    calls[2]!.resolve("3");
    await flush();
    expect(published).toEqual(["0", "2", "3"]);
    expect(runner.started).toBe(3);
    expect(runner.published).toBe(3);
  });

  it("un résultat obsolète plus ancien que le dernier publié (cache) n'est pas publié", async () => {
    const { calls, exec } = manualExec();
    const published: string[] = [];
    const runner = createLatestRunner<object, string>({
      exec,
      onResult: (_i, o) => published.push(o),
      onError: () => "erreur",
      publishStale: true,
    });
    const a = {};
    const b = {};
    runner.submit(a);
    calls[0]!.resolve("A");
    await flush();
    runner.submit(b);
    runner.submit(a); // cache : publié tout de suite
    expect(published).toEqual(["A", "A"]);
    calls[1]!.resolve("B");
    await flush();
    expect(published).toEqual(["A", "A"]); // B plus ancien que A republié
  });

  it("cancel : rien n'est plus publié, la demande en attente n'est pas lancée", async () => {
    const { calls, exec } = manualExec();
    const published: string[] = [];
    const pending: boolean[] = [];
    const runner = createLatestRunner<object, string>({
      exec,
      onResult: (_i, o) => published.push(o),
      onPending: (p) => pending.push(p),
      onError: () => "erreur",
      publishStale: true,
    });
    runner.submit({ n: 1 });
    runner.submit({ n: 2 });
    runner.cancel();
    expect(runner.pending).toBe(false);
    calls[0]!.resolve("1");
    await flush();
    expect(published).toEqual([]);
    expect(calls).toHaveLength(1);
    // Une nouvelle demande reprend normalement.
    const c = { n: 3 };
    runner.submit(c);
    calls[1]!.resolve("3");
    await flush();
    expect(published).toEqual(["3"]);
    expect(pending).toEqual([true, false, true, false]);
  });

  it("cancel puis nouvelle demande pendant le calcul abandonné : celui-ci n'est jamais publié", async () => {
    const { calls, exec } = manualExec();
    const published: string[] = [];
    const runner = createLatestRunner<object, string>({
      exec,
      onResult: (_i, o) => published.push(o),
      onError: () => "erreur",
      publishStale: true,
    });
    runner.submit({ n: 1 }); // geste annulé : calcul en cours
    runner.cancel();
    runner.submit({ n: 2 }); // nouveau geste : en attente derrière le calcul abandonné
    calls[0]!.resolve("1");
    await flush();
    expect(published).toEqual([]);
    expect(calls).toHaveLength(2);
    calls[1]!.resolve("2");
    await flush();
    expect(published).toEqual(["2"]);
  });

  it("propriété : publications dans l'ordre des demandes, la dernière toujours publiée, jamais d'exception", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(fc.oneof(fc.constant("submit"), fc.constant("resolve"), fc.constant("fail")), {
          minLength: 1,
          maxLength: 30,
        }),
        async (ops) => {
          const { calls, exec } = manualExec();
          const published: number[] = [];
          const runner = createLatestRunner<{ n: number }, string>({
            exec: (i) => exec(i),
            onResult: (i) => published.push(i.n),
            onError: () => "erreur",
            publishStale: true,
            cacheSize: 0,
          });
          let n = 0;
          let done = 0;
          for (const op of ops) {
            if (op === "submit") runner.submit({ n: n++ });
            else if (done < calls.length) {
              const c = calls[done++]!;
              if (op === "resolve") c.resolve("ok");
              else c.reject(new Error("panne"));
              await flush();
            }
          }
          while (done < calls.length) {
            calls[done++]!.resolve("ok");
            await flush();
          }
          for (let k = 1; k < published.length; k++)
            expect(published[k]!).toBeGreaterThan(published[k - 1]!);
          if (n > 0) expect(published[published.length - 1]).toBe(n - 1);
        },
      ),
      { numRuns: 100 },
    );
  });
});
