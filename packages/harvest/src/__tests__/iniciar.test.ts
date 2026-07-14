import { test } from "node:test";
import assert from "node:assert/strict";
import { iniciarConversacion, type IniciarDeps } from "../iniciar.js";
import { getPersona } from "../personas.js";

const persona = getPersona("inversionista");

function fakeDeps(overrides: Partial<IniciarDeps> = {}) {
  const calls: string[] = [];
  const deps: IniciarDeps = {
    hayActiva: async () => false,
    crear: async () => { calls.push("crear"); return { id: "conv-1" }; },
    guardarPrimerMensaje: async () => { calls.push("guardar"); },
    enviar: async () => { calls.push("enviar"); },
    ...overrides,
  };
  return { deps, calls };
}

test("rehúsa si ya hay conversación activa (no crea ni envía)", async () => {
  const { deps, calls } = fakeDeps({ hayActiva: async () => true });
  const r = await iniciarConversacion(deps, persona);
  assert.deepEqual(r, { estado: "ya-activa" });
  assert.deepEqual(calls, []);
});

test("sin activa: crea, guarda primer mensaje y lo envía", async () => {
  const { deps, calls } = fakeDeps();
  const r = await iniciarConversacion(deps, persona);
  assert.equal(r.estado, "iniciada");
  assert.equal(r.estado === "iniciada" && r.conversationId, "conv-1");
  assert.equal(r.estado === "iniciada" && r.primerMensaje, persona.primerMensaje);
  assert.deepEqual(calls, ["crear", "guardar", "enviar"]);
});

test("pasa el replyMarkup a enviar", async () => {
  let recibido: unknown = "no-llamado";
  const { deps } = fakeDeps({ enviar: async (_t, rm) => { recibido = rm; } });
  await iniciarConversacion(deps, persona, { keyboard: [] });
  assert.deepEqual(recibido, { keyboard: [] });
});
