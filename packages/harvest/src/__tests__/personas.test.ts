import { test } from "node:test";
import assert from "node:assert/strict";
import { PERSONAS, getPersona } from "../personas.js";

const KEYS = ["inversionista", "novata_anillo", "cazador_ganga", "tecnico", "turista_en", "apurado_cierre"];

test("hay exactamente 6 personas con las keys esperadas", () => {
  assert.equal(PERSONAS.length, 6);
  assert.deepEqual(PERSONAS.map((p) => p.key).sort(), [...KEYS].sort());
});

test("cada persona tiene primerMensaje no vacío y >=2 objeciones", () => {
  for (const p of PERSONAS) {
    assert.ok(p.primerMensaje.trim().length > 0, `${p.key}: primerMensaje vacío`);
    assert.ok(p.objeciones.length >= 2, `${p.key}: pocas objeciones`);
  }
});

test("turista_en habla inglés; el resto español", () => {
  assert.equal(getPersona("turista_en").idioma, "en");
  assert.equal(getPersona("inversionista").idioma, "es");
});

test("getPersona lanza con key desconocida", () => {
  assert.throws(() => getPersona("no_existe"));
});
