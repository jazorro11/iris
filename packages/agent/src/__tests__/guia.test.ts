import { test } from "node:test";
import assert from "node:assert/strict";
import { GUIA_HECHOS } from "../guia.js";

test("GUIA_HECHOS cubre los temas comunes y es sustancial", () => {
  assert.ok(GUIA_HECHOS.length > 4000, "la guía curada debe ser sustancial");
  for (const term of [/quilate/i, /color/i, /jard[ií]n|inclusion/i, /tratamiento|aceite/i, /Muzo/i, /Chivor/i, /certificad|GIA/i, /patrimonio tangible/i]) {
    assert.match(GUIA_HECHOS, term, `falta el tema ${term}`);
  }
});

test("GUIA_HECHOS incluye apoyo bilingüe (marcas EN:)", () => {
  assert.match(GUIA_HECHOS, /EN:/);
});
