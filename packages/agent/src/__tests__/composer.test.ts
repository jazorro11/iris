import { test } from "node:test";
import assert from "node:assert/strict";
import { renderBriefForPrompt, composeReply, COMPOSE_SYSTEM_PROMPT, type ChatModel } from "../composer.js";
import type { ComposeBrief, Piedra } from "@iris/types";
import { GUIA_HECHOS } from "../guia.js";
import { BIBLIA_COMPLETA } from "../knowledge/biblia.js";

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

test("COMPOSE_SYSTEM_PROMPT incorpora la guía y las reglas clave", () => {
  assert.ok(COMPOSE_SYSTEM_PROMPT.includes(GUIA_HECHOS), "debe inyectar GUIA_HECHOS");
  assert.match(COMPOSE_SYSTEM_PROMPT, /responde|respónde/i);          // educar/responder
  assert.match(COMPOSE_SYSTEM_PROMPT, /patrimonio tangible/i);        // honestidad valorización
  assert.match(COMPOSE_SYSTEM_PROMPT, /total/i);                      // cotiza total de la piedra
  assert.match(COMPOSE_SYSTEM_PROMPT, /asesor/i);                     // regla de reserva del asesor
  assert.match(COMPOSE_SYSTEM_PROMPT, /dato t[eé]cnico NUEVO|nuevo/i);// insistir con dato nuevo
});

test("renderBriefForPrompt incluye precio total, atributos técnicos e historial", () => {
  const piedraRica: Piedra = {
    id: "z", nombre: "Esmeralda Muzo 1.26 ct", forma: "corte_esmeralda",
    peso_ct: 1.26, precio_usd_ct: 5800, cantidad_piedras: 1,
    media_url: "http://x/z.jpg", disponible: true, notas: "selección Muzo",
    color: "verde vívido", origen: "Muzo", claridad: "jardín leve", tratamiento: "menor",
  };
  const txt = renderBriefForPrompt({
    intent: "aclarar",
    userMessage: "¿se valoriza?",
    known: { proposito: "inversion_patrimonio" },
    missing: ["color"],
    stones: [piedraRica],
    presupuesto: { max: 8000, moneda: "USD" },
    history: [
      { rol: "comprador", texto: "quiero una esmeralda de 1 a 2 ct" },
      { rol: "agente", texto: "te recomiendo la de 1.26 ct" },
    ],
  });
  assert.match(txt, /Esmeralda Muzo 1\.26/);
  assert.match(txt, /7308/);                 // 1.26 * 5800 = 7308 (total)
  assert.match(txt, /Muzo/);                 // origen
  assert.match(txt, /verde v[ií]vido/);      // color
  assert.match(txt, /foto: s[ií]/i);         // hay media_url
  assert.match(txt, /quiero una esmeralda de 1 a 2 ct/); // historial
  assert.match(txt, /8000/);                 // presupuesto
});

test("COMPOSE_SYSTEM_PROMPT incluye la sección de VOZ y la regla de idioma", () => {
  assert.match(COMPOSE_SYSTEM_PROMPT, /VOZ|voz de M[eé]raldi/i);
  assert.match(COMPOSE_SYSTEM_PROMPT, /idioma|inglés|español|language/i);
  assert.match(COMPOSE_SYSTEM_PROMPT, /asesorar/i);   // instrucción para modo asesor
  assert.match(COMPOSE_SYSTEM_PROMPT, /handoff|cerrar el trato|finaliza/i);
});

test("composeReply inyecta la biblia cuando preguntaProfunda=true", async () => {
  let visto: Array<{ role: string; content: string }> = [];
  const fake: ChatModel = {
    invoke: async (input) => { visto = input as Array<{ role: string; content: string }>; return { content: "ok" }; },
  };
  await composeReply(fake, { ...brief, preguntaProfunda: true });
  assert.ok(visto[0].content.includes(BIBLIA_COMPLETA), "el system debe incluir la biblia");
});

test("composeReply NO inyecta la biblia por defecto", async () => {
  let visto: Array<{ role: string; content: string }> = [];
  const fake: ChatModel = {
    invoke: async (input) => { visto = input as Array<{ role: string; content: string }>; return { content: "ok" }; },
  };
  await composeReply(fake, brief); // sin preguntaProfunda
  assert.equal(visto[0].content, COMPOSE_SYSTEM_PROMPT);
});

test("composeReply antepone directiva dura de idioma inglés al mensaje de usuario cuando brief.idioma='en'", async () => {
  let visto: Array<{ role: string; content: string }> = [];
  const fake: ChatModel = {
    invoke: async (input) => { visto = input as Array<{ role: string; content: string }>; return { content: "ok" }; },
  };
  await composeReply(fake, { ...brief, idioma: "en" });
  assert.equal(visto[0].content, COMPOSE_SYSTEM_PROMPT);
  assert.match(visto[1].content, /ENGLISH/);
  assert.match(visto[1].content, /busco una esmeralda de 9 quilates/);
});
