import { test } from "node:test";
import assert from "node:assert/strict";
import { MemorySaver } from "@langchain/langgraph";
import { runIris, type IrisDeps } from "../graph.js";
import type { LeadRow, ComposeBrief } from "@iris/types";

test("aclaración: compose recibe el brief correcto y su salida es el reply", async () => {
  let recibido: ComposeBrief | null = null;
  const deps: IrisDeps = {
    extract: async () => ({ proposito: "joyeria" }),
    saveLead: async () => ({ id: "x" }),
    notifySeller: async () => {},
    compose: async (b) => { recibido = b; return "Genial, ¿qué presupuesto manejas?"; },
    checkpointer: new MemorySaver(),
  };
  const { reply, estado } = await runIris(deps, {
    telegramUserId: 1, chatId: 1, text: "quiero una esmeralda de 9 ct",
  });
  assert.equal(estado, "en_aclaracion");
  assert.equal(reply, "Genial, ¿qué presupuesto manejas?");
  assert.ok(recibido);
  const b1 = recibido as ComposeBrief;
  assert.equal(b1.intent, "aclarar");
  assert.equal(b1.userMessage, "quiero una esmeralda de 9 ct");
  assert.ok(b1.missing.includes("presupuesto"));
});

test("completo (sin handoff): compose recibe intent=asesorar y sigue conversando", async () => {
  const saved: LeadRow[] = [];
  let recibido: ComposeBrief | null = null;
  const deps: IrisDeps = {
    extract: async () => ({
      proposito: "joyeria", tipo_pieza: "gema_tallada", color: { tono: "verde" },
      presupuesto: { max: 5000, moneda: "USD" }, peso_quilates: { min: 1 },
      origen: { pais: "colombia" },
    }),
    saveLead: async (r) => { saved.push(r); return { id: "lead-1" }; },
    notifySeller: async () => {},
    compose: async (b) => { recibido = b; return "¡Gracias! Sigo por aquí para lo que necesites."; },
    checkpointer: new MemorySaver(),
  };
  const { reply, estado } = await runIris(deps, {
    telegramUserId: 2, chatId: 2, text: "esmeralda verde de Colombia, 1ct, hasta 5000",
  });
  assert.equal(estado, "completo");
  assert.equal(saved.length, 1);
  assert.equal(reply, "¡Gracias! Sigo por aquí para lo que necesites.");
  assert.equal(recibido!.intent, "asesorar");
  assert.equal(recibido!.cierre, undefined);
});

test("fallback: si compose lanza, usa la plantilla y el lead igual se guarda", async () => {
  const saved: LeadRow[] = [];
  const deps: IrisDeps = {
    extract: async () => ({
      proposito: "joyeria", tipo_pieza: "gema_tallada", color: { tono: "verde" },
      presupuesto: { max: 5000, moneda: "USD" }, peso_quilates: { min: 1 },
      origen: { pais: "colombia" },
    }),
    saveLead: async (r) => { saved.push(r); return { id: "lead-1" }; },
    notifySeller: async () => {},
    compose: async () => { throw new Error("LLM caído"); },
    checkpointer: new MemorySaver(),
  };
  const { reply, estado } = await runIris(deps, {
    telegramUserId: 3, chatId: 3, text: "esmeralda verde de Colombia, 1ct, hasta 5000",
  });
  assert.equal(estado, "completo");
  assert.equal(saved.length, 1);
  assert.match(reply, /sigo ayudándote/i); // cayó a la plantilla de "asesorar"
});
