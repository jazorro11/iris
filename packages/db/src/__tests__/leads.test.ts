import { test } from "node:test";
import assert from "node:assert/strict";
import { buildLeadRow } from "../queries/leads.js";

test("buildLeadRow mapea columnas tipadas + JSONB", () => {
  const row = buildLeadRow({
    telegramUserId: 42,
    telegramUsername: "comprador1",
    solicitud: {
      proposito: "joyeria",
      tipo_pieza: "gema_tallada",
      origen: { pais: "colombia", mina_zona: "muzo" },
    },
    estado: "completo",
    camposFaltantes: [],
  });
  assert.equal(row.telegram_user_id, 42);
  assert.equal(row.telegram_username, "comprador1");
  assert.equal(row.estado, "completo");
  assert.equal(row.proposito, "joyeria");
  assert.equal(row.tipo_pieza, "gema_tallada");
  assert.equal(row.origen_pais, "colombia");
  assert.equal(row.solicitud.origen?.mina_zona, "muzo");
});

test("buildLeadRow usa null cuando faltan columnas tipadas", () => {
  const row = buildLeadRow({
    telegramUserId: 7,
    solicitud: {},
    estado: "incompleto",
    camposFaltantes: ["proposito"],
  });
  assert.equal(row.telegram_username, null);
  assert.equal(row.proposito, null);
  assert.equal(row.origen_pais, null);
});
