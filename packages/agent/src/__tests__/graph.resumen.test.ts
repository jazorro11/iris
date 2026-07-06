import { test } from "node:test";
import assert from "node:assert/strict";
import { MemorySaver } from "@langchain/langgraph";
import { runIris, type IrisDeps } from "../graph.js";
import type { ComposeBrief } from "@iris/types";

test("el resumen del turno previo llega al brief del turno siguiente", async () => {
  const briefs: ComposeBrief[] = [];
  const cp = new MemorySaver();
  const deps: IrisDeps = {
    extract: async () => ({}),
    saveLead: async () => ({ id: "x" }),
    notifySeller: async () => {},
    matchInventory: async () => ({ piedras: [], hayExactas: false }),
    compose: async (b) => { briefs.push(b); return "ok"; },
    summarize: async ({ userMessage }) => `resumen tras: ${userMessage}`,
    checkpointer: cp,
  };
  await runIris(deps, { telegramUserId: 88, chatId: 88, text: "primero" });
  await runIris(deps, { telegramUserId: 88, chatId: 88, text: "segundo" });
  assert.equal(briefs[1].resumen, "resumen tras: primero");
});

test("si summarize lanza, la conversación continúa", async () => {
  const deps: IrisDeps = {
    extract: async () => ({}),
    saveLead: async () => ({ id: "x" }),
    notifySeller: async () => {},
    matchInventory: async () => ({ piedras: [], hayExactas: false }),
    compose: async () => "ok",
    summarize: async () => { throw new Error("boom"); },
    checkpointer: new MemorySaver(),
  };
  const out = await runIris(deps, { telegramUserId: 89, chatId: 89, text: "hola" });
  assert.equal(out.reply, "ok");
});
