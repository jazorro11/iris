// Eval en vivo (LLM real, DB en memoria) del modo asesora conversacional.
// Uso:  npx tsx --env-file=apps/web/.env scripts/eval-asesora.mjs
// Sin escrituras a Supabase: fakeDb + MemorySaver + notifySeller capturado.
// Importa por subpath directo (tsx no surfacea el barrel export *).
import { MemorySaver } from "@langchain/langgraph";
import { runIris } from "../packages/agent/src/graph.ts";
import { extractRequest } from "../packages/agent/src/extractor.ts";
import { classifyIntent } from "../packages/agent/src/intent.ts";
import { createChatModel } from "../packages/agent/src/model.ts";
import { createComposerModel, composeReply } from "../packages/agent/src/composer.ts";
import { matchInventory } from "../packages/db/src/queries/inventario.ts";

const STOCK = [
  { id: "1", nombre: "Esmeralda Muzo 1.26 ct", forma: "corte_esmeralda", peso_ct: 1.26,
    precio_usd_ct: 5800, cantidad_piedras: 1, media_url: "https://example.com/muzo126.jpg",
    disponible: true, notas: "selección Muzo, brillo alto",
    color: "verde vívido", origen: "Muzo", claridad: "jardín leve", tratamiento: "menor" },
  { id: "2", nombre: "Esmeralda oval 1.80 ct", forma: "oval", peso_ct: 1.80,
    precio_usd_ct: 4200, cantidad_piedras: 1, media_url: "https://example.com/oval180.jpg",
    disponible: true, notas: "verde medio, muy limpia",
    color: "verde medio", origen: "Coscuez", claridad: "limpia", tratamiento: "insignificante" },
];
const fakeDb = { from: () => ({ select: () => ({ eq: async () => ({ data: STOCK, error: null }) }) }) };

const model = createChatModel();
const composerModel = createComposerModel();
const ROJO = /asesor de M[eé]raldi.*(contact|comunic|pondr[áa]|finaliz)/i;

function nuevaSesion(telegramUserId) {
  const log = [];
  const checkpointer = new MemorySaver();
  const sellerMsgs = [];
  let previas = [];
  let ultimoIntent = null;
  const deps = {
    extract: (text) => extractRequest(model, text),
    classifyIntent: async (text) => { ultimoIntent = await classifyIntent(model, text); return ultimoIntent; },
    saveLead: async () => ({ id: "x" }),
    notifySeller: async (t) => { sellerMsgs.push(t); },
    matchInventory: (s) => matchInventory(fakeDb, s),
    compose: (brief) => composeReply(composerModel, brief),
    getHistory: async () => previas,
    summarize: async ({ previo, userMessage, reply }) => {
      const res = await model.invoke([
        { role: "system", content: "Actualiza en 2-4 frases el resumen de una conversación de venta de esmeraldas: qué pidió el cliente, qué se le mostró, sus preferencias y el próximo paso. Devuelve solo el resumen." },
        { role: "user", content: `Resumen previo: ${previo || "(vacío)"}\nCliente dijo: ${userMessage}\nIris respondió: ${reply}` },
      ]);
      return typeof res.content === "string" ? res.content.trim() : String(res.content ?? "").trim();
    },
    checkpointer,
  };
  return {
    sellerMsgs,
    async turn(text) {
      previas = [...log];
      log.push({ rol: "comprador", texto: text });
      const out = await runIris(deps, { telegramUserId, chatId: telegramUserId, text });
      log.push({ rol: "agente", texto: out.reply });
      return { ...out, intent: ultimoIntent };
    },
  };
}

// Caso completo en un turno (para escenarios post-captura).
const COMPLETA = "Busco una esmeralda tallada de Colombia, verde, de 1 a 2 quilates, para joyería, hasta 8000 USD.";

const escenarios = [
  { titulo: "1) >5 turnos incompletos → NO debe cerrar",
    turnos: [
      "Hola, estoy mirando esmeraldas pero no sé mucho",
      "¿Qué me recomiendas?",
      "Mmm no sé, algo bonito",
      "¿Y de dónde vienen?",
      "Interesante, cuéntame más",
      "¿Cuál es la diferencia entre Muzo y Coscuez?",
    ] },
  { titulo: "2) Lead completo + pregunta común (jardín) → educa, no cierra",
    turnos: [ COMPLETA, "¿el jardín le resta valor a la piedra?" ] },
  { titulo: "3) Pregunta profunda → debe activar biblia (preguntaProfunda=true)",
    turnos: [ COMPLETA, "¿qué es el pleocroísmo del berilo y cómo se ve en una esmeralda?" ] },
  { titulo: "4) Quiere comprar/pagar → handoff (aviso distinto al vendedor)",
    turnos: [ COMPLETA, "Perfecto, quiero comprar la Muzo. ¿Cómo te pago?" ] },
  { titulo: "5) Cliente en inglés → responde en inglés",
    turnos: [ "Hi! I'm looking for a 2 carat Muzo emerald for an engagement ring. What do you have?" ] },
];

let userId = 5000;
for (const { titulo, turnos } of escenarios) {
  console.log(`\n\n########## ${titulo} ##########`);
  const ses = nuevaSesion(userId++);
  for (const m of turnos) {
    const out = await ses.turn(m);
    const flags = out.intent ? `handoff=${out.intent.handoff} profunda=${out.intent.preguntaProfunda}` : "(sin intent)";
    console.log(`\n🧑 ${m}`);
    console.log(`💚 ${out.reply}`);
    console.log(`   🏷️  ${flags}${ROJO.test(out.reply) ? "   ⚠️ deriva/finaliza-asesor" : ""}`);
  }
  if (ses.sellerMsgs.length) {
    console.log(`\n   📨 avisos al vendedor (${ses.sellerMsgs.length}):`);
    ses.sellerMsgs.forEach((s, i) => console.log(`      [${i + 1}] ${s.split("\n")[0]}${/cerrar|compra|certificado|joya/i.test(s) ? "  «HANDOFF»" : ""}`));
  }
}
console.log("\n\nRevisar: (1) sin cierre en turnos largos; (2) educa el jardín; (3) profunda=true; (4) handoff=true + aviso «HANDOFF»; (5) respuesta en inglés.");
