// Eval manual de conversaciones completas. Uso:
//   OPENROUTER_API_KEY=... npx tsx scripts/eval-conversaciones.mjs
// Importa por subpath directo (tsx no surfacea el barrel export *).
import { MemorySaver } from "@langchain/langgraph";
import { runIris } from "../packages/agent/src/graph.ts";
import { extractRequest, createChatModel } from "../packages/agent/src/extractor.ts";
import { createComposerModel, composeReply } from "../packages/agent/src/composer.ts";
import { matchInventory } from "../packages/db/src/queries/inventario.ts";

// Inventario en memoria (con atributos técnicos + foto), envuelto como un DbClient falso.
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
const fakeDb = {
  from: () => ({ select: () => ({ eq: async () => ({ data: STOCK, error: null }) }) }),
};

const model = createChatModel();
const composerModel = createComposerModel();

function nuevaSesion(telegramUserId) {
  const log = [];
  const checkpointer = new MemorySaver();
  let previas = [];
  const deps = {
    extract: (text) => extractRequest(model, text),
    saveLead: async () => ({ id: "x" }),
    notifySeller: async () => {},
    matchInventory: (s) => matchInventory(fakeDb, s),
    compose: (brief) => composeReply(composerModel, brief),
    getHistory: async () => previas,
    checkpointer,
  };
  return {
    async turn(text) {
      previas = [...log];
      log.push({ rol: "comprador", texto: text });
      const out = await runIris(deps, { telegramUserId, chatId: telegramUserId, text });
      log.push({ rol: "agente", texto: out.reply });
      return out;
    },
  };
}

const conversaciones = {
  "C2 — esmeralda inversión": [
    "Quiero una esmeralda de 1 a 2 ct aproximadamente tienes algo interesante?",
    "Me gustaría guardar y saber si se va a valorizar con el tiempo",
    "Y cuál es el mejor precio que me puedes dar para eso?",
    "Qué otras opciones tienes?",
    "Tienes fotos?",
    "Mi presupuesto es de 8.000 usd",
    "Me gustaría en oro amarillo, talla 7 US",
    "Por cuánto saldría la pieza total?",
  ],
  "C1 — anillo elegante": [
    "Hola quisiera comprar una piedra pero no sé cuál quede mejor en mi",
    "La quiero para que mi mano se vea estilizada y elegante, pero que no sea tan llamativa",
    "Podría estar en un presupuesto bajo-medio",
    "Vale pero quisiera saber qué opciones tienes",
    "Y que son quilates? No entiendo bien ese mundo",
  ],
};

const ROJO = /asesor de M[eé]raldi.*(contact|comunic|pondr[áa])/i;
let userId = 1000;
for (const [titulo, mensajes] of Object.entries(conversaciones)) {
  console.log(`\n\n########## ${titulo} ##########`);
  const ses = nuevaSesion(userId++);
  for (const m of mensajes) {
    const out = await ses.turn(m);
    console.log(`\n🧑 ${m}`);
    console.log(`💚 ${out.reply}`);
    if (out.mediaUrl) console.log(`   📷 (enviaría foto: ${out.mediaUrl})`);
    if (ROJO.test(out.reply)) console.log(`   ⚠️  MULETILLA: deriva a asesor`);
  }
}
console.log("\n\nRevisar manualmente: ¿explica quilates? ¿responde valorización sin prometer rentabilidad? ¿ofrece alternativa? ¿cotiza total? ¿sin muletilla salvo cierre real?");
