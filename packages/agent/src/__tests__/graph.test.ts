import { test } from "node:test";
import assert from "node:assert/strict";
import { MemorySaver } from "@langchain/langgraph";
import { runIris, buildSellerSummary, buildPiedrasPropuestas, type IrisDeps } from "../graph.js";
import type { LeadRow, Solicitud, Piedra } from "@iris/types";

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

test("tras MAX_RONDAS turnos incompletos persiste como incompleto y notifica", async () => {
  // rondas acumula +1 por llamada; MAX_RONDAS=4; route dispara persistir cuando rondas >= 4
  // → la persistencia ocurre exactamente en la 4ª llamada a runIris
  const saved: LeadRow[] = [];
  const seller: string[] = [];
  const cp = new MemorySaver();
  const deps: IrisDeps = {
    extract: async () => ({ proposito: "joyeria" }),
    saveLead: async (r) => { saved.push(r); return { id: "x" }; },
    notifySeller: async (t) => { seller.push(t); },
    checkpointer: cp,
  };
  // Turns 1-3: must NOT persist yet
  for (let i = 0; i < 3; i++) {
    await runIris(deps, { telegramUserId: 99, chatId: 99, text: "..." });
    assert.equal(saved.length, 0, `no debería persistir antes de la vuelta ${i + 1}`);
  }
  // Turn 4: rondas reaches MAX_RONDAS (4), triggers persistir
  const last = await runIris(deps, { telegramUserId: 99, chatId: 99, text: "..." });
  assert.equal(saved.length, 1);
  assert.equal(saved[0].estado, "incompleto");
  assert.equal(seller.length, 1);
  assert.equal(last.estado, "incompleto");
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

test("buildPiedrasPropuestas vacío cuando no hay piedras", () => {
  assert.equal(buildPiedrasPropuestas([]), "");
});

test("buildPiedrasPropuestas lista nombre, peso y precio", () => {
  const piedras: Piedra[] = [{
    id: "a", nombre: "Cushion 6.72 ct - 440 usd-ct", forma: "cojin",
    peso_ct: 6.72, precio_usd_ct: 440, cantidad_piedras: 1,
    media_url: null, disponible: true, notas: null,
  }];
  const txt = buildPiedrasPropuestas(piedras);
  assert.match(txt, /Cushion 6\.72/);
  assert.match(txt, /440/);
});

test("al completar, propone piedras del inventario en reply y al vendedor", async () => {
  const seller: string[] = [];
  const piedra: Piedra = {
    id: "a", nombre: "Redonda 3.09 ct - 1.500 usd-ct", forma: "redondo",
    peso_ct: 3.09, precio_usd_ct: 1500, cantidad_piedras: 1,
    media_url: null, disponible: true, notas: null,
  };
  const deps: IrisDeps = {
    extract: async () => ({
      proposito: "joyeria", tipo_pieza: "gema_tallada", color: { tono: "verde" },
      presupuesto: { max: 5000, moneda: "USD" }, peso_quilates: { min: 1 },
      origen: { pais: "colombia" },
    }),
    saveLead: async () => ({ id: "lead-1" }),
    notifySeller: async (t) => { seller.push(t); },
    matchInventory: async () => [piedra],
    checkpointer: new MemorySaver(),
  };
  const { reply, estado } = await runIris(deps, {
    telegramUserId: 55, chatId: 55, text: "esmeralda verde de Colombia, 1ct, hasta 5000",
  });
  assert.equal(estado, "completo");
  assert.match(reply, /Redonda 3\.09/);
  assert.match(seller[0], /Redonda 3\.09/);
});
