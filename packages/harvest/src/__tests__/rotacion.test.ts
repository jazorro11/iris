import { test } from "node:test";
import assert from "node:assert/strict";
import { resolverPersona, elegirPersonaMenosUsada, PERSONAS } from "../personas.js";

test("resolverPersona por número 1-6", () => {
  assert.equal(resolverPersona("1")?.key, PERSONAS[0].key);
  assert.equal(resolverPersona("6")?.key, PERSONAS[5].key);
});

test("resolverPersona por key exacta", () => {
  assert.equal(resolverPersona("inversionista")?.key, "inversionista");
});

test("resolverPersona con arg inválido → null", () => {
  assert.equal(resolverPersona("0"), null);
  assert.equal(resolverPersona("7"), null);
  assert.equal(resolverPersona("no_existe"), null);
});

test("elegirPersonaMenosUsada: perfil ausente (count 0) gana", () => {
  // Todos usados salvo el primero (no aparece) → ese (count 0) es el menos usado.
  const counts = PERSONAS.slice(1).map((p) => ({ persona_key: p.key, count: 5 }));
  assert.equal(elegirPersonaMenosUsada(counts), PERSONAS[0].key);
});

test("elegirPersonaMenosUsada: empate se rompe por orden de PERSONAS", () => {
  const counts = PERSONAS.map((p) => ({ persona_key: p.key, count: 2 }));
  assert.equal(elegirPersonaMenosUsada(counts), PERSONAS[0].key);
});

test("elegirPersonaMenosUsada: elige el de menor conteo", () => {
  const counts = PERSONAS.map((p, i) => ({ persona_key: p.key, count: i === 3 ? 0 : 10 }));
  assert.equal(elegirPersonaMenosUsada(counts), PERSONAS[3].key);
});

test("elegirPersonaMenosUsada: sin conteos → primer perfil", () => {
  assert.equal(elegirPersonaMenosUsada([]), PERSONAS[0].key);
});
