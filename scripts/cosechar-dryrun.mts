// Corre una conversación de cosecha completa SIN Telegram ni Supabase reales:
// el "dueño" lo simula otro LLM. Uso:
//   npx tsx --env-file=apps/web/.env scripts/cosechar-dryrun.mts <persona_key>
// El barrel de @iris/harvest (export *) no surfacea sus re-exports bajo tsx; subpath directo.
import { getPersona } from "../packages/harvest/src/personas.ts";
import { siguienteTurno } from "../packages/harvest/src/personaEngine.ts";
import { evaluarGuardrails } from "../packages/harvest/src/guardrails.ts";
import { extraerRegistro } from "../packages/harvest/src/harvester.ts";
import { MAX_TURNOS } from "../packages/harvest/src/config.ts";
import { createChatModel } from "../packages/agent/src/model.ts";
import type { HistItem } from "../packages/harvest/src/types.ts";

const persona = getPersona(process.argv[2] ?? "inversionista");
const comprador = createChatModel({ temperature: 0.7 });
const cosechador = createChatModel({ temperature: 0.1 });
const dueno = createChatModel({ temperature: 0.6 });

const DUENO_SYS =
  "Eres el dueño real de Meraldi, vendedor experto de esmeraldas colombianas. Responde a un cliente por chat, " +
  "1-3 frases, cálido y concreto: da precios de ejemplo, maneja objeciones, describe piedras. Español natural.";

async function responderDueno(historial: HistItem[]): Promise<string> {
  const conv = historial.map((h) => `${h.rol === "comprador" ? "CLIENTE" : "TÚ"}: ${h.texto}`).join("\n");
  const res = await dueno.invoke([
    { role: "system", content: DUENO_SYS },
    { role: "user", content: `${conv}\nTÚ:` },
  ]);
  return (typeof res.content === "string" ? res.content : String(res.content ?? "")).trim();
}

const historial: HistItem[] = [{ rol: "comprador", texto: persona.primerMensaje }];
console.log(`\n🧑 [${persona.key}] ${persona.primerMensaje}`);

for (let turno = 1; turno <= MAX_TURNOS; turno++) {
  const respuestaDueno = await responderDueno(historial);
  historial.push({ rol: "dueño", texto: respuestaDueno });
  console.log(`💚 ${respuestaDueno}`);

  const ultimoComprador = [...historial].reverse().find((h) => h.rol === "comprador")!.texto;
  const rec = await extraerRegistro(cosechador, {
    conversationId: "dryrun", personaKey: persona.key, turno,
    mensajeComprador: ultimoComprador, respuestaDueno, contextoPrevio: "",
  });
  console.log(`   🏷️  veta=${rec.veta} — ${rec.notasExtraccion}`);

  const g = evaluarGuardrails({ turnosComprador: turno, ultimoTextoDueno: respuestaDueno });
  if (g.accion === "detener") { console.log(`   ⛔ ${g.motivo}`); break; }

  const next = await siguienteTurno(comprador, persona, historial);
  if (next.fin) { console.log(`   ✅ persona finalizó`); break; }
  historial.push({ rol: "comprador", texto: next.texto });
  console.log(`\n🧑 ${next.texto}`);
}
