import { test } from "node:test";
import assert from "node:assert/strict";
import { renderBriefForPrompt, composeReply, COMPOSE_SYSTEM_PROMPT, type ChatModel } from "../composer.js";
import type { ComposeBrief, Piedra } from "@iris/types";

const piedra: Piedra = {
  id: "a", nombre: "Esmeralda cuadrada 9.04 ct", forma: "corte_esmeralda",
  peso_ct: 9.04, precio_usd_ct: 4300, cantidad_piedras: 1,
  media_url: null, disponible: true, notas: null,
};

const brief: ComposeBrief = {
  intent: "aclarar",
  userMessage: "busco una esmeralda de 9 quilates",
  known: { proposito: "joyeria" },
  missing: ["presupuesto", "origen"],
  stones: [piedra],
};

test("renderBriefForPrompt incluye mensaje, faltantes y datos reales de la piedra", () => {
  const txt = renderBriefForPrompt(brief);
  assert.match(txt, /busco una esmeralda de 9 quilates/);
  assert.match(txt, /presupuesto, origen/);
  assert.match(txt, /Esmeralda cuadrada 9\.04/);
  assert.match(txt, /4300/);
});

test("renderBriefForPrompt marca cuando no hay piedras", () => {
  const txt = renderBriefForPrompt({ ...brief, stones: [] });
  assert.match(txt, /\(ninguna\)/);
});

test("composeReply pasa el system prompt y devuelve el texto recortado", async () => {
  let visto: Array<{ role: string; content: string }> = [];
  const fake: ChatModel = {
    invoke: async (input) => {
      visto = input as Array<{ role: string; content: string }>;
      return { content: "  Hola, con gusto te ayudo.  " };
    },
  };
  const out = await composeReply(fake, brief);
  assert.equal(out, "Hola, con gusto te ayudo.");
  assert.equal(visto[0].role, "system");
  assert.equal(visto[0].content, COMPOSE_SYSTEM_PROMPT);
  assert.match(visto[1].content, /busco una esmeralda de 9 quilates/);
});

test("composeReply tolera content no-string", async () => {
  const fake: ChatModel = { invoke: async () => ({ content: 123 }) };
  const out = await composeReply(fake, brief);
  assert.equal(out, "123");
});
