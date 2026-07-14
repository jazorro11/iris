import { test } from "node:test";
import assert from "node:assert/strict";
import { buildConversacionRow, contarConversacionesPorPersona } from "../harvest.js";
import type { DbClient } from "../../client.js";

test("buildConversacionRow arma la fila inicial en estado activa", () => {
  const row = buildConversacionRow("inversionista", 12345);
  assert.equal(row.persona_key, "inversionista");
  assert.equal(row.estado, "activa");
  assert.equal(row.turno_actual, 0);
  assert.equal(row.owner_chat_id, 12345);
});

test("contarConversacionesPorPersona agrupa y cuenta por persona_key", async () => {
  const rows = [
    { persona_key: "inversionista" },
    { persona_key: "inversionista" },
    { persona_key: "tecnico" },
  ];
  const db = { from: () => ({ select: async () => ({ data: rows, error: null }) }) } as unknown as DbClient;
  const counts = await contarConversacionesPorPersona(db);
  const byKey = Object.fromEntries(counts.map((c) => [c.persona_key, c.count]));
  assert.equal(byKey["inversionista"], 2);
  assert.equal(byKey["tecnico"], 1);
});

test("contarConversacionesPorPersona sin filas → arreglo vacío", async () => {
  const db = { from: () => ({ select: async () => ({ data: [], error: null }) }) } as unknown as DbClient;
  assert.deepEqual(await contarConversacionesPorPersona(db), []);
});
