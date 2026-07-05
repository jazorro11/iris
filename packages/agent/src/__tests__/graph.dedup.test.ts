import { test } from "node:test";
import assert from "node:assert/strict";
import { MemorySaver } from "@langchain/langgraph";
import { runIris, type IrisDeps } from "../graph.js";
import type { Piedra } from "@iris/types";

const piedra: Piedra = {
  id: "a", nombre: "Cuadrada 3.61 ct", forma: "corte_esmeralda",
  peso_ct: 3.61, precio_usd_ct: 1750, cantidad_piedras: 1,
  media_url: "http://x/a.jpg", disponible: true, notas: null,
};

function deps(): IrisDeps {
  return {
    extract: async () => ({ corte: { forma: "corte_esmeralda" }, peso_quilates: { min: 3, max: 4 } }),
    saveLead: async () => ({ id: "x" }),
    notifySeller: async () => {},
    matchInventory: async () => [piedra],
    checkpointer: new MemorySaver(),
  };
}

test("no repite la recomendación de una misma piedra en turnos siguientes", async () => {
  const d = deps();
  const t1 = await runIris(d, { telegramUserId: 1, chatId: 1, text: "cuadrada de 3-4 ct" });
  const t2 = await runIris(d, { telegramUserId: 1, chatId: 1, text: "sigo interesada" });

  // Turno 1: sí recomienda (foto + piedra en el texto).
  assert.equal(t1.mediaUrl, "http://x/a.jpg");
  assert.ok(t1.reply.includes("Cuadrada 3.61 ct"), "turno 1 debe recomendar la piedra");

  // Turno 2: la piedra ya se recomendó → no se reenvía (ni foto ni en el texto).
  assert.equal(t2.mediaUrl, null, "turno 2 no debe reenviar la foto de la piedra ya recomendada");
  assert.ok(!t2.reply.includes("Cuadrada 3.61 ct"), "turno 2 no debe volver a listar la piedra");
});

test("una piedra nueva que aparece después sí se recomienda (no se sobre-suprime)", async () => {
  const piedraB: Piedra = { ...piedra, id: "b", nombre: "Oval 4.10 ct", media_url: "http://x/b.jpg" };
  let stock: Piedra[] = [piedra];
  const d: IrisDeps = {
    extract: async () => ({ corte: { forma: "corte_esmeralda" }, peso_quilates: { min: 3, max: 4 } }),
    saveLead: async () => ({ id: "x" }),
    notifySeller: async () => {},
    matchInventory: async () => stock,
    checkpointer: new MemorySaver(),
  };

  await runIris(d, { telegramUserId: 2, chatId: 2, text: "cuadrada de 3-4 ct" });
  stock = [piedra, piedraB]; // llega nuevo stock que también encaja
  const t2 = await runIris(d, { telegramUserId: 2, chatId: 2, text: "algo más?" });

  assert.equal(t2.mediaUrl, "http://x/b.jpg", "debe recomendar la piedra nueva");
  assert.ok(t2.reply.includes("Oval 4.10 ct"), "la piedra nueva debe listarse");
  assert.ok(!t2.reply.includes("Cuadrada 3.61 ct"), "la piedra ya recomendada no debe repetirse");
});
