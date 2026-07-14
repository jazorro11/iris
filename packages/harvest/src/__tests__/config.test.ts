import { test } from "node:test";
import assert from "node:assert/strict";
import { MAX_TURNOS, STOP_WORDS, RESPONSE_DELAY_MS } from "../config.js";

test("MAX_TURNOS es 10", () => {
  assert.equal(MAX_TURNOS, 10);
});

test("STOP_WORDS detecta las palabras de pausa del dueño", () => {
  for (const t of ["pausa", "¿eres un bot?", "basta ya", "detente", "PAUSA"]) {
    assert.match(t, STOP_WORDS, `debería detectar: ${t}`);
  }
  for (const t of ["hola", "me interesa", "cuánto cuesta", "es para un anillo", "una esmeralda para regalo"]) {
    assert.doesNotMatch(t, STOP_WORDS, `no debería detectar: ${t}`);
  }
});

test("RESPONSE_DELAY_MS es positivo", () => {
  assert.ok(RESPONSE_DELAY_MS > 0);
});
