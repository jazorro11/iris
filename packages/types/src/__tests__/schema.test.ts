import { test } from "node:test";
import assert from "node:assert/strict";
import { SolicitudSchema, CAMPOS_CRITICOS } from "../schema.js";

test("SolicitudSchema acepta una solicitud parcial válida", () => {
  const parsed = SolicitudSchema.parse({
    proposito: "joyeria",
    color: { tono: "verde", saturacion: "vivida" },
    origen: { pais: "colombia", mina_zona: "muzo" },
    peso_quilates: { min: 1, max: 3 },
  });
  assert.equal(parsed.proposito, "joyeria");
  assert.equal(parsed.color?.tono, "verde");
});

test("SolicitudSchema acepta objeto vacío (todo opcional)", () => {
  assert.deepEqual(SolicitudSchema.parse({}), {});
});

test("SolicitudSchema rechaza un enum inválido", () => {
  assert.throws(() => SolicitudSchema.parse({ proposito: "lavado_de_dinero" }));
});

test("CAMPOS_CRITICOS son los seis acordados", () => {
  assert.deepEqual([...CAMPOS_CRITICOS], [
    "proposito", "presupuesto", "tipo_pieza", "peso_quilates", "color", "origen",
  ]);
});
