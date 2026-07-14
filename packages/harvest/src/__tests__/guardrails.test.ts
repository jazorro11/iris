import { test } from "node:test";
import assert from "node:assert/strict";
import { evaluarGuardrails } from "../guardrails.js";

test("continúa en condiciones normales", () => {
  const r = evaluarGuardrails({ turnosComprador: 3, ultimoTextoDueno: "Claro, tengo varias opciones" });
  assert.equal(r.accion, "continuar");
});

test("detiene al alcanzar MAX_TURNOS (10)", () => {
  const r = evaluarGuardrails({ turnosComprador: 10, ultimoTextoDueno: "aquí va otra" });
  assert.equal(r.accion, "detener");
  assert.match(r.accion === "detener" ? r.motivo : "", /turnos/i);
});

test("detiene ante stop-word del dueño", () => {
  const r = evaluarGuardrails({ turnosComprador: 2, ultimoTextoDueno: "oye, ¿eres un bot?" });
  assert.equal(r.accion, "detener");
  assert.match(r.accion === "detener" ? r.motivo : "", /stop-word|pausa|bot/i);
});
