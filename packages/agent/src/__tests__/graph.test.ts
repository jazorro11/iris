import { test } from "node:test";
import assert from "node:assert/strict";
import { MemorySaver } from "@langchain/langgraph";
import { runIris, buildSellerSummary, type IrisDeps } from "../graph.js";
import type { LeadRow, Solicitud } from "@iris/types";

test("mensaje incompleto pide aclaración y no persiste", async () => {
  const saved: LeadRow[] = [];
  const deps: IrisDeps = {
    extract: async () => ({ proposito: "joyeria" }),
    saveLead: async (r) => { saved.push(r); return { id: "x" }; },
    notifySeller: async () => {},
    checkpointer: new MemorySaver(),
  };
  const { reply, estado } = await runIris(deps, {
    telegramUserId: 1, chatId: 1, text: "quiero una esmeralda para un anillo",
  });
  assert.equal(estado, "en_aclaracion");
  assert.equal(saved.length, 0);
  assert.match(reply, /presupuesto|quilates|origen|tipo|color/i);
});

test("la solicitud se completa en el segundo turno → persiste y notifica", async () => {
  const saved: LeadRow[] = [];
  const seller: string[] = [];
  const cp = new MemorySaver();
  let call = 0;
  const turnos: Solicitud[] = [
    { proposito: "joyeria", tipo_pieza: "gema_tallada", color: { tono: "verde" } },
    { presupuesto: { max: 5000, moneda: "USD" }, peso_quilates: { min: 1 }, origen: { pais: "colombia" } },
  ];
  const deps: IrisDeps = {
    extract: async () => turnos[call++],
    saveLead: async (r) => { saved.push(r); return { id: "lead-1" }; },
    notifySeller: async (t) => { seller.push(t); },
    checkpointer: cp,
  };
  await runIris(deps, { telegramUserId: 7, chatId: 7, text: "esmeralda verde tallada para joyería" });
  const r2 = await runIris(deps, { telegramUserId: 7, chatId: 7, text: "hasta 5000 USD, 1 quilate, de Colombia" });

  assert.equal(r2.estado, "completo");
  assert.equal(saved.length, 1);
  assert.equal(saved[0].solicitud.color?.tono, "verde"); // mergeado del turno 1
  assert.equal(saved[0].origen_pais, "colombia");
  assert.equal(seller.length, 1);
});

test("buildSellerSummary incluye el id de Telegram y el estado", () => {
  const summary = buildSellerSummary({
    telegram_user_id: 99, telegram_username: "ana", estado: "completo",
    campos_faltantes: [], solicitud: { proposito: "joyeria" },
    proposito: "joyeria", tipo_pieza: null, origen_pais: null,
  });
  assert.match(summary, /99/);
  assert.match(summary, /completo/i);
});
