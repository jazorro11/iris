import { test } from "node:test";
import assert from "node:assert/strict";
import { extraerRegistro } from "../harvester.js";
import type { LlmModel } from "../types.js";

const fakeModel = (reply: string): LlmModel => ({ invoke: async () => ({ content: reply }) });
const base = {
  conversationId: "c1", personaKey: "cazador_ganga", turno: 2,
  mensajeComprador: "¿me haces descuento?", respuestaDueno: "Te puedo dejar en 1900 si cierras hoy",
  contextoPrevio: "Cliente busca colombiana 5-6ct por 2000 USD",
};

test("clasifica la veta y conserva los textos", async () => {
  const r = await extraerRegistro(fakeModel('{"veta":"precio","notasExtraccion":"cede 100 USD por cierre hoy"}'), base);
  assert.equal(r.veta, "precio");
  assert.equal(r.mensajeComprador, base.mensajeComprador);
  assert.equal(r.respuestaDueno, base.respuestaDueno);
  assert.equal(r.personaKey, "cazador_ganga");
  assert.equal(r.turno, 2);
});

test("cae a 'otro' si el modelo devuelve basura", async () => {
  const r = await extraerRegistro(fakeModel("no soy json"), base);
  assert.equal(r.veta, "otro");
});
