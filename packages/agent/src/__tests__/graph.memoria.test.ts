import { test } from "node:test";
import assert from "node:assert/strict";
import { MemorySaver } from "@langchain/langgraph";
import { runIris, type IrisDeps } from "../graph.js";
import type { ComposeBrief } from "@iris/types";

test("no repite un campo ya preguntado en turnos sucesivos", async () => {
  const briefs: ComposeBrief[] = [];
  const deps: IrisDeps = {
    extract: async () => ({}), // nunca completa → siempre aclarar
    saveLead: async () => ({ id: "x" }),
    notifySeller: async () => {},
    matchInventory: async () => ({ piedras: [], hayExactas: false }),
    compose: async (brief) => { briefs.push(brief); return "ok"; },
    checkpointer: new MemorySaver(),
  };
  await runIris(deps, { telegramUserId: 77, chatId: 77, text: "hola" });
  await runIris(deps, { telegramUserId: 77, chatId: 77, text: "sigo sin saber" });
  // El 1er campo priorizado del turno 2 debe diferir del preguntado en el turno 1.
  assert.equal(briefs.length, 2);
  assert.ok(briefs[1].yaPreguntado && briefs[1].yaPreguntado.length >= 1);
  assert.notEqual(briefs[1].missing[0], briefs[0].missing[0]);
});
