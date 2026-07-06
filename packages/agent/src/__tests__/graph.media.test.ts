import { test } from "node:test";
import assert from "node:assert/strict";
import { MemorySaver } from "@langchain/langgraph";
import { runIris, type IrisDeps } from "../graph.js";
import type { Piedra } from "@iris/types";

const piedraFoto: Piedra = {
  id: "a", nombre: "Cuadrada 3.61 ct", forma: "corte_esmeralda",
  peso_ct: 3.61, precio_usd_ct: 1750, cantidad_piedras: 1,
  media_url: "http://x/a.jpg", disponible: true, notas: null,
};

test("runIris expone media_url de la piedra propuesta", async () => {
  const deps: IrisDeps = {
    extract: async () => ({ corte: { forma: "corte_esmeralda" }, peso_quilates: { min: 3, max: 4 } }),
    saveLead: async () => ({ id: "x" }),
    notifySeller: async () => {},
    matchInventory: async () => ({ piedras: [piedraFoto], hayExactas: true }),
    checkpointer: new MemorySaver(),
  };
  const out = await runIris(deps, { telegramUserId: 1, chatId: 1, text: "cuadrada de 3-4 ct" });
  assert.equal(out.mediaUrl, "http://x/a.jpg");
});

test("sin piedra con foto, mediaUrl es null", async () => {
  const deps: IrisDeps = {
    extract: async () => ({ proposito: "joyeria" }),
    saveLead: async () => ({ id: "x" }),
    notifySeller: async () => {},
    checkpointer: new MemorySaver(),
  };
  const out = await runIris(deps, { telegramUserId: 2, chatId: 2, text: "hola" });
  assert.equal(out.mediaUrl, null);
});
