import { test } from "node:test";
import assert from "node:assert/strict";
import { siguienteTurno, buildPersonaSystemPrompt } from "../personaEngine.js";
import { getPersona } from "../personas.js";
import type { LlmModel } from "../types.js";

const fakeModel = (reply: string): LlmModel => ({ invoke: async () => ({ content: reply }) });

test("el system prompt incluye presupuesto y las objeciones de la persona", () => {
  const p = getPersona("cazador_ganga");
  const sp = buildPersonaSystemPrompt(p);
  assert.match(sp, /2\.000 USD|2000 USD/);
  for (const o of p.objeciones) assert.ok(sp.includes(o), `falta objeción: ${o}`);
});

test("devuelve texto cuando el modelo responde una línea normal", async () => {
  const r = await siguienteTurno(fakeModel("¿me haces un descuento?"), getPersona("cazador_ganga"), []);
  assert.equal(r.fin, false);
  assert.equal(r.fin === false ? r.texto : "", "¿me haces un descuento?");
});

test("termina cuando el modelo emite el centinela FIN", async () => {
  const r = await siguienteTurno(fakeModel("FIN"), getPersona("cazador_ganga"), [
    { rol: "comprador", texto: "hola" },
    { rol: "dueño", texto: "hola, dime" },
  ]);
  assert.equal(r.fin, true);
});
