import { test } from "node:test";
import assert from "node:assert/strict";
import { BIBLIA_COMPLETA } from "../knowledge/biblia.js";

test("BIBLIA_COMPLETA está cargada y tiene los módulos", () => {
  assert.ok(BIBLIA_COMPLETA.length > 50000, "la biblia debe tener contenido sustancial");
  assert.match(BIBLIA_COMPLETA, /BIBLIA DEL CONOCIMIENTO MERALDI/);
  assert.match(BIBLIA_COMPLETA, /Módulo 05/); // minas colombianas
});
