import { test } from "node:test";
import assert from "node:assert/strict";
import { buildConversacionRow } from "../harvest.js";

test("buildConversacionRow arma la fila inicial en estado activa", () => {
  const row = buildConversacionRow("inversionista", 12345);
  assert.equal(row.persona_key, "inversionista");
  assert.equal(row.estado, "activa");
  assert.equal(row.turno_actual, 0);
  assert.equal(row.owner_chat_id, 12345);
});
