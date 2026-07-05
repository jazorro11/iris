import { test } from "node:test";
import assert from "node:assert/strict";
import { MemorySaver } from "@langchain/langgraph";
import { runIris, buildSellerSummary, buildPiedrasPropuestas, type IrisDeps } from "../graph.js";
import type { LeadRow, Solicitud, Piedra } from "@iris/types";
import { DEFAULT_INTENT } from "../intent.js";

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

test("propone piedras durante la aclaración (solicitud aún incompleta)", async () => {
  const piedra: Piedra = {
    id: "a", nombre: "Cuadrada 3.61 ct - 1.750 usd-ct", forma: "corte_esmeralda",
    peso_ct: 3.61, precio_usd_ct: 1750, cantidad_piedras: 1,
    media_url: null, disponible: true, notas: null,
  };
  let pasoSolicitud: Solicitud | null = null;
  const deps: IrisDeps = {
    // forma + peso + presupuesto, pero faltan proposito/tipo_pieza/color/origen → incompleto
    extract: async () => ({
      corte: { forma: "corte_esmeralda" }, peso_quilates: { min: 3, max: 4 },
      presupuesto: { max: 2000, base: "por_quilate" },
    }),
    saveLead: async () => ({ id: "x" }),
    notifySeller: async () => {},
    matchInventory: async (s) => { pasoSolicitud = s; return [piedra]; },
    checkpointer: new MemorySaver(),
  };
  const { reply, estado } = await runIris(deps, {
    telegramUserId: 33, chatId: 33, text: "cuadrada de 3-4 ct, hasta 2000 por quilate",
  });
  assert.equal(estado, "en_aclaracion");           // sigue incompleta
  assert.match(reply, /Cuadrada 3\.61/);           // pero ya propone
  assert.notEqual(pasoSolicitud, null);            // matchInventory recibió la solicitud
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

test("no cierra ni persiste tras muchos turnos incompletos (sin guillotina)", async () => {
  const saved: LeadRow[] = [];
  const seller: string[] = [];
  const cp = new MemorySaver();
  const deps: IrisDeps = {
    extract: async () => ({ proposito: "joyeria" }),
    saveLead: async (r) => { saved.push(r); return { id: "x" }; },
    notifySeller: async (t) => { seller.push(t); },
    checkpointer: cp,
  };
  for (let i = 0; i < 6; i++) {
    const { estado } = await runIris(deps, { telegramUserId: 99, chatId: 99, text: "hmm" });
    assert.equal(estado, "en_aclaracion", `turno ${i + 1} no debe cerrar`);
  }
  assert.equal(saved.length, 0, "nunca persiste un lead incompleto sin handoff");
  assert.equal(seller.length, 0, "nunca notifica sin captura ni handoff");
});

test("tras completar, sigue conversando y NO re-notifica al vendedor", async () => {
  const saved: LeadRow[] = [];
  const seller: string[] = [];
  const cp = new MemorySaver();
  const completa = {
    proposito: "joyeria", tipo_pieza: "gema_tallada", color: { tono: "verde" },
    presupuesto: { max: 5000, moneda: "USD" }, peso_quilates: { min: 1 }, origen: { pais: "colombia" },
  } as const;
  const deps: IrisDeps = {
    extract: async () => ({ ...completa }),
    saveLead: async (r) => { saved.push(r); return { id: "lead-1" }; },
    notifySeller: async (t) => { seller.push(t); },
    checkpointer: cp,
  };
  await runIris(deps, { telegramUserId: 7, chatId: 7, text: "esmeralda verde tallada de Colombia, 1ct, 5000 USD" });
  await runIris(deps, { telegramUserId: 7, chatId: 7, text: "¿y el jardín le resta valor?" });
  assert.equal(seller.length, 1, "el vendedor se notifica una sola vez");
});

test("handoff notifica al vendedor con aviso distinto", async () => {
  const seller: string[] = [];
  const deps: IrisDeps = {
    extract: async () => ({ proposito: "joyeria" }),
    saveLead: async () => ({ id: "x" }),
    notifySeller: async (t) => { seller.push(t); },
    classifyIntent: async () => ({ handoff: true, preguntaProfunda: false, idioma: "es" }),
    checkpointer: new MemorySaver(),
  };
  await runIris(deps, { telegramUserId: 12, chatId: 12, text: "quiero comprarla, ¿cómo pago?" });
  assert.equal(seller.length, 1);
  assert.match(seller[0], /cerrar|compra|certificado|joya/i);
});

test("sin classifyIntent, el intent cae a DEFAULT (fallback determinista)", async () => {
  let vistoBrief = false;
  const deps: IrisDeps = {
    extract: async () => ({ proposito: "joyeria" }),
    saveLead: async () => ({ id: "x" }),
    notifySeller: async () => {},
    compose: async (brief) => { vistoBrief = brief.preguntaProfunda !== true; return "ok"; },
    checkpointer: new MemorySaver(),
  };
  const { reply } = await runIris(deps, { telegramUserId: 13, chatId: 13, text: "hola" });
  assert.equal(reply, "ok");
  assert.ok(vistoBrief, "sin clasificador, preguntaProfunda no debe activarse");
  assert.deepEqual(DEFAULT_INTENT, { handoff: false, preguntaProfunda: false, idioma: "es" });
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
