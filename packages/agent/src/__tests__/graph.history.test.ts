import { test } from "node:test";
import assert from "node:assert/strict";
import { MemorySaver } from "@langchain/langgraph";
import { runIris, type IrisDeps } from "../graph.js";
import type { ComposeBrief } from "@iris/types";

test("el historial de getHistory llega al brief del redactor", async () => {
  let recibido: ComposeBrief | null = null;
  const deps: IrisDeps = {
    extract: async () => ({ proposito: "joyeria" }),
    saveLead: async () => ({ id: "x" }),
    notifySeller: async () => {},
    compose: async (b) => { recibido = b; return "ok"; },
    getHistory: async () => [{ rol: "comprador", texto: "mensaje previo" }],
    checkpointer: new MemorySaver(),
  };
  await runIris(deps, { telegramUserId: 1, chatId: 1, text: "hola" });
  assert.ok(recibido);
  assert.equal((recibido as ComposeBrief).history?.[0].texto, "mensaje previo");
});
