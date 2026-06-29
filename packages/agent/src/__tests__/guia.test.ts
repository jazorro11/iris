import { test } from "node:test";
import assert from "node:assert/strict";
import { GUIA_HECHOS } from "../guia.js";

test("GUIA_HECHOS cubre los hechos clave para responder al cliente", () => {
  assert.match(GUIA_HECHOS, /quilate/i);                       // qué son los quilates
  assert.match(GUIA_HECHOS, /patrimonio tangible/i);           // postura de valorización
  assert.match(GUIA_HECHOS, /no son activos l[ií]quidos/i);    // sin promesas de rentabilidad
  assert.match(GUIA_HECHOS, /Muzo/);                           // orígenes/minas
  assert.match(GUIA_HECHOS, /tratamiento/i);                   // escala de tratamiento
  assert.match(GUIA_HECHOS, /jard[ií]n/i);                     // claridad / inclusiones
  assert.match(GUIA_HECHOS, /colombian/i);                     // identidad de marca
});
