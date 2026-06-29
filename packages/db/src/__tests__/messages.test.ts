import { test } from "node:test";
import assert from "node:assert/strict";
import { getRecentMessages } from "../queries/leads.js";
import type { DbClient } from "../client.js";

test("getRecentMessages devuelve en orden cronológico ascendente", async () => {
  let capturado: { col: string; asc?: boolean; lim?: number } = { col: "" };
  const fakeDb = {
    from: () => ({
      select: () => ({
        eq: () => ({
          order: (col: string, opts: { ascending: boolean }) => {
            capturado.col = col; capturado.asc = opts.ascending;
            return {
              limit: (n: number) => {
                capturado.lim = n;
                // el driver devuelve descendente (más reciente primero)
                return Promise.resolve({
                  data: [
                    { rol: "agente", texto: "segundo" },
                    { rol: "comprador", texto: "primero" },
                  ],
                  error: null,
                });
              },
            };
          },
        }),
      }),
    }),
  } as unknown as DbClient;

  const r = await getRecentMessages(fakeDb, 7, 6);
  assert.equal(capturado.col, "created_at");
  assert.equal(capturado.asc, false);
  assert.equal(capturado.lim, 6);
  assert.deepEqual(r, [
    { rol: "comprador", texto: "primero" },
    { rol: "agente", texto: "segundo" },
  ]); // invertido a cronológico
});
