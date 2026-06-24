// Harness de prueba: ¿el agente recomienda piedras según una descripción libre?
//
// Para cada caso: corre el EXTRACTOR real (LLM) + matchInventory real (inventario
// de Supabase), e imprime la solicitud extraída y las piedras propuestas.
// Así puedes ver si una recomendación vacía es culpa de la extracción o del match.
//
// Uso:  npx tsx scripts/probar-recomendacion.mts
//       npx tsx scripts/probar-recomendacion.mts D   (corre solo el caso D; o 1..6)
//
// Requiere apps/web/.env con OPENROUTER_API_KEY, NEXT_PUBLIC_SUPABASE_URL y
// SUPABASE_SERVICE_ROLE_KEY (los mismos que usa el webhook en producción).

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { createServerClient } from "@iris/db";
// El barrel de @iris/db (export *) no surfacea sus re-exports bajo tsx; subpath directo.
import { matchInventory } from "@iris/db/src/queries/inventario.js";
import { createChatModel, extractRequest } from "@iris/agent";
import type { Solicitud, Piedra } from "@iris/types";

// --- Cargar apps/web/.env a process.env (createChatModel/createServerClient leen de ahí) ---
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
for (const line of readFileSync(path.join(root, "apps/web/.env"), "utf8").split(/\r?\n/)) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && process.env[m[1]] === undefined) {
    process.env[m[1]] = m[2].replace(/^["']|["']$/g, "").replace(/^﻿/, "");
  }
}

// --- Los 6 casos (ver tabla en la conversación) ---
const CASOS: { id: string; texto: string; esperado: string }[] = [
  {
    id: "A",
    texto: "Quiero una esmeralda redonda",
    esperado: "filtro de forma → Redonda 3.09 ct (1500 USD/ct)",
  },
  {
    id: "B",
    texto: "Busco corte esmeralda, máximo 2000 USD por quilate",
    esperado:
      "tope de precio + orden + corte a 3 → Pareja esmeraldas 4.52 (250), Esmeralda 2.04 (1050), Lote 4 esmeraldas 8.82 (1500)",
  },
  {
    id: "C",
    texto: "Una esmeralda de entre 6 y 7 quilates",
    esperado:
      "rango de peso cruzando formas → Cushion 6.72 (440), Cuadrada 6.21 (27000)",
  },
  {
    id: "D",
    texto: "Quiero una esmeralda de 9 quilates",
    esperado:
      "banda ±15% (regresión del match degenerado) → Lote 4 esmeraldas 8.82 (1500), Esmeralda cuadrada 9.04 (4300)",
  },
  {
    id: "E",
    texto: "Esmeralda redonda, tengo 5 millones de pesos colombianos",
    esperado: "COP no filtra precio → Redonda 3.09 sigue apareciendo",
  },
  {
    id: "F",
    texto: "Quiero una esmeralda bonita para mi esposa",
    esperado: "caso negativo → ninguna piedra (el agente debe preguntar, no proponer)",
  },
];

// --- Formato ---
function resumenSolicitud(s: Solicitud): string {
  const partes: string[] = [];
  const forma = s.corte?.forma;
  if (forma) partes.push(`forma=${forma}`);
  if (s.peso_quilates && (s.peso_quilates.min != null || s.peso_quilates.max != null)) {
    partes.push(`peso=[${s.peso_quilates.min ?? "·"}, ${s.peso_quilates.max ?? "·"}]`);
  }
  if (s.presupuesto && (s.presupuesto.min != null || s.presupuesto.max != null)) {
    const p = s.presupuesto;
    partes.push(`presupuesto=[${p.min ?? "·"}, ${p.max ?? "·"}] ${p.moneda ?? "?"}/${p.base ?? "?"}`);
  }
  if (s.proposito) partes.push(`proposito=${s.proposito}`);
  return partes.length ? partes.join("  ") : "(sin forma/peso/presupuesto → match devuelve [])";
}

function lineaPiedra(p: Piedra): string {
  return `   • ${p.nombre}  —  ${p.peso_ct} ct, ${p.precio_usd_ct} USD/ct`;
}

// --- Correr ---
const filtro = process.argv[2]; // opcional: "4" o "D" para un solo caso
const idsPorNumero = ["A", "B", "C", "D", "E", "F"];
const casos = filtro
  ? CASOS.filter(
      (c, i) => c.id.toLowerCase() === filtro.toLowerCase() || idsPorNumero[i] === filtro || String(i + 1) === filtro
    )
  : CASOS;

const db = createServerClient();
const model = createChatModel();

console.log("\n=== Prueba de recomendación de piedras (extractor + matchInventory reales) ===\n");

for (const caso of casos) {
  console.log(`── Caso ${caso.id} ──────────────────────────────────────────────`);
  console.log(`Comprador: "${caso.texto}"`);
  console.log(`Esperado:  ${caso.esperado}`);
  try {
    const solicitud = await extractRequest(model, caso.texto);
    console.log(`Extraído:  ${resumenSolicitud(solicitud)}`);
    const piedras = await matchInventory(db, solicitud);
    if (piedras.length === 0) {
      console.log("Propuesta: (ninguna)");
    } else {
      console.log(`Propuesta: ${piedras.length} piedra(s)`);
      for (const p of piedras) console.log(lineaPiedra(p));
    }
  } catch (err) {
    console.log(`ERROR:     ${err instanceof Error ? err.message : String(err)}`);
  }
  console.log("");
}

console.log("=== Fin ===\n");
