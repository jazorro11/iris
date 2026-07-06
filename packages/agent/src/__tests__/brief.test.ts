import { test } from "node:test";
import assert from "node:assert/strict";
import { buildComposeBrief, pickKnownCriticos } from "../brief.js";
import { renderBriefForPrompt } from "../composer.js";
import type { Piedra } from "@iris/types";

test("pickKnownCriticos deja solo críticos presentes", () => {
  const known = pickKnownCriticos({
    proposito: "joyeria",
    presupuesto: { max: 3000, moneda: "USD" },
    claridad: "limpia", // no es crítico → se descarta
  });
  assert.deepEqual(Object.keys(known).sort(), ["presupuesto", "proposito"]);
});

test("buildComposeBrief excluye de known los campos que están en missing", () => {
  const brief = buildComposeBrief({
    intent: "aclarar",
    userMessage: "hola",
    solicitud: { proposito: "joyeria", presupuesto: { base: "por_quilate" } },
    missing: ["presupuesto", "tipo_pieza"],
    stones: [],
  });
  assert.deepEqual(Object.keys(brief.known), ["proposito"]); // presupuesto está en missing
  assert.deepEqual(brief.missing, ["presupuesto", "tipo_pieza"]);
  assert.equal(brief.cierre, undefined);
});

test("buildComposeBrief incluye cierre y stones cuando se pasan", () => {
  const piedra: Piedra = {
    id: "a", nombre: "Cuadrada 9.04 ct", forma: "corte_esmeralda",
    peso_ct: 9.04, precio_usd_ct: 4300, cantidad_piedras: 1,
    media_url: null, disponible: true, notas: null,
  };
  const brief = buildComposeBrief({
    intent: "cerrar",
    userMessage: "listo",
    solicitud: { proposito: "joyeria" },
    missing: [],
    stones: [piedra],
    cierre: "completo",
  });
  assert.equal(brief.intent, "cerrar");
  assert.equal(brief.cierre, "completo");
  assert.equal(brief.stones[0].nombre, "Cuadrada 9.04 ct");
});

test("buildComposeBrief copia presupuesto e historial", () => {
  const brief = buildComposeBrief({
    intent: "aclarar",
    userMessage: "hola",
    solicitud: { presupuesto: { max: 8000, moneda: "USD" } },
    missing: ["proposito"],
    stones: [],
    history: [{ rol: "comprador", texto: "hola" }],
  });
  assert.deepEqual(brief.presupuesto, { max: 8000, moneda: "USD" });
  assert.equal(brief.history?.length, 1);
  assert.equal(brief.history?.[0].texto, "hola");
});

test("buildComposeBrief soporta intent asesorar y copia preguntaProfunda", () => {
  const brief = buildComposeBrief({
    intent: "asesorar",
    userMessage: "¿qué es el pleocroísmo?",
    solicitud: { proposito: "coleccion" },
    missing: [],
    stones: [],
    preguntaProfunda: true,
  });
  assert.equal(brief.intent, "asesorar");
  assert.equal(brief.preguntaProfunda, true);
  assert.equal(brief.cierre, undefined);
});

test("render incluye hayExactas, ya_preguntado, ya_mostrado y memoria", () => {
  const brief = buildComposeBrief({
    intent: "asesorar", userMessage: "de 10 quilates?", solicitud: { peso_quilates: { min: 10, max: 10 } },
    missing: ["proposito"], stones: [],
    hayExactas: false, yaPreguntado: ["color"], piedrasMostradas: ["Esmeralda X"], resumen: "Cliente busca 10ct.",
  });
  const txt = renderBriefForPrompt(brief);
  assert.match(txt, /match_exacto: no/);
  assert.match(txt, /ya_preguntado: color/);
  assert.match(txt, /ya_mostrado: Esmeralda X/);
  assert.match(txt, /memoria_conversacion: Cliente busca 10ct\./);
});
