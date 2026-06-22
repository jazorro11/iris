import { test } from "node:test";
import assert from "node:assert/strict";
import { buildClarificationMessage, clarificationTargets, PREGUNTAS } from "../questions.js";

test("clarificationTargets devuelve los críticos faltantes", () => {
  assert.deepEqual(clarificationTargets({ proposito: "joyeria" }), [
    "presupuesto", "tipo_pieza", "peso_quilates", "color", "origen",
  ]);
});

test("buildClarificationMessage limita a 3 preguntas", () => {
  const msg = buildClarificationMessage(["presupuesto", "tipo_pieza", "peso_quilates", "color", "origen"]);
  const bullets = msg.split("\n").filter((l) => l.trim().startsWith("•"));
  assert.equal(bullets.length, 3);
  assert.ok(msg.includes(PREGUNTAS.presupuesto));
});

test("buildClarificationMessage maneja lista vacía con un fallback", () => {
  const msg = buildClarificationMessage([]);
  assert.ok(msg.length > 0);
  assert.ok(!msg.includes("•"));
});
