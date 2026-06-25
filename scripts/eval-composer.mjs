// Eval manual del redactor. Uso: OPENROUTER_API_KEY=... npx tsx scripts/eval-composer.mjs
// Importa por subpath directo (tsx no surfacea el barrel export *).
import { buildComposeBrief } from "../packages/agent/src/brief.ts";
import { createComposerModel, composeReply } from "../packages/agent/src/composer.ts";

const model = createComposerModel();

const casos = [
  {
    nombre: "aclaración con piedras",
    brief: buildComposeBrief({
      intent: "aclarar",
      userMessage: "Hola estoy buscando una esmeralda de 9 quilates",
      solicitud: {},
      missing: ["proposito", "presupuesto", "color"],
      stones: [
        { id: "1", nombre: "Lote 4 esmeraldas 8.82 ct", forma: "corte_esmeralda", peso_ct: 8.82, precio_usd_ct: 1500, cantidad_piedras: 4, media_url: null, disponible: true, notas: null },
        { id: "2", nombre: "Esmeralda cuadrada 9.04 ct", forma: "corte_esmeralda", peso_ct: 9.04, precio_usd_ct: 4300, cantidad_piedras: 1, media_url: null, disponible: true, notas: null },
      ],
    }),
  },
  {
    nombre: "cierre completo",
    brief: buildComposeBrief({
      intent: "cerrar",
      userMessage: "No tengo preferencia de lugar desde que sea colombiana",
      solicitud: { proposito: "joyeria", presupuesto: { max: 3000, moneda: "USD" }, origen: { pais: "colombia" } },
      missing: [],
      stones: [],
      cierre: "completo",
    }),
  },
];

for (const c of casos) {
  const reply = await composeReply(model, c.brief);
  console.log(`\n=== ${c.nombre} ===\n${reply}\n`);
}
