import { test } from "node:test";
import assert from "node:assert/strict";
import { mergeRequest, missingCriticalFields, isComplete, evaluarEstado } from "../request.js";

test("mergeRequest combina campos de dos turnos sin pisar lo previo", () => {
  const prior = { color: { tono: "verde" as const }, proposito: "joyeria" as const };
  const partial = { origen: { pais: "colombia" as const } };
  const merged = mergeRequest(prior, partial);
  assert.equal(merged.color?.tono, "verde");
  assert.equal(merged.proposito, "joyeria");
  assert.equal(merged.origen?.pais, "colombia");
});

test("mergeRequest hace merge dentro de objetos anidados", () => {
  const prior = { presupuesto: { max: 5000, moneda: "USD" as const } };
  const partial = { presupuesto: { min: 1000 } };
  const merged = mergeRequest(prior, partial);
  assert.deepEqual(merged.presupuesto, { max: 5000, moneda: "USD", min: 1000 });
});

test("mergeRequest ignora undefined/null entrantes", () => {
  const prior = { color: { tono: "verde" as const } };
  const partial = { color: { tono: undefined } } as never;
  const merged = mergeRequest(prior, partial);
  assert.equal(merged.color?.tono, "verde");
});

test("mergeRequest une características especiales sin duplicar", () => {
  const prior = { caracteristicas_especiales: ["trapiche" as const] };
  const partial = { caracteristicas_especiales: ["trapiche" as const, "macla" as const] };
  const merged = mergeRequest(prior, partial);
  assert.deepEqual(merged.caracteristicas_especiales, ["trapiche", "macla"]);
});

test("missingCriticalFields detecta los seis críticos en vacío", () => {
  assert.deepEqual(missingCriticalFields({}), [
    "proposito", "presupuesto", "tipo_pieza", "peso_quilates", "color", "origen",
  ]);
});

test("missingCriticalFields trata 'desconocido' y rangos vacíos como faltantes", () => {
  const s = { proposito: "desconocido" as const, presupuesto: {}, peso_quilates: {} };
  const faltan = missingCriticalFields(s);
  assert.ok(faltan.includes("proposito"));
  assert.ok(faltan.includes("presupuesto"));
  assert.ok(faltan.includes("peso_quilates"));
});

test("isComplete / evaluarEstado con solicitud completa", () => {
  const s = {
    proposito: "joyeria" as const,
    presupuesto: { max: 5000 },
    tipo_pieza: "gema_tallada" as const,
    peso_quilates: { min: 1 },
    color: { tono: "verde" as const },
    origen: { pais: "colombia" as const },
  };
  assert.equal(isComplete(s), true);
  assert.deepEqual(evaluarEstado(s), { estado: "completo", camposFaltantes: [] });
});

test("evaluarEstado marca en_aclaracion si falta algo", () => {
  assert.equal(evaluarEstado({ proposito: "joyeria" }).estado, "en_aclaracion");
});
