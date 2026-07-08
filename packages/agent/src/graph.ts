import { StateGraph, START, END, type BaseCheckpointSaver } from "@langchain/langgraph";
import type { Solicitud, EstadoLead, LeadRow, Piedra, ComposeBrief } from "@iris/types";
import { buildLeadRow } from "@iris/db";
import { IrisState, type State } from "./state.js";
import { evaluarEstado, MAX_RONDAS } from "./request.js";
import { buildClarificationMessage } from "./questions.js";
import { getCheckpointer } from "./checkpointer.js";
import { buildComposeBrief } from "./brief.js";
import { type IntentFlags, DEFAULT_INTENT } from "./intent.js";

export interface IrisDeps {
  extract: (text: string) => Promise<Solicitud>;
  saveLead: (row: LeadRow) => Promise<{ id: string }>;
  notifySeller: (text: string) => Promise<void>;
  /** Opcional: propone piedras del inventario que coincidan. */
  matchInventory?: (solicitud: Solicitud) => Promise<{ piedras: Piedra[]; hayExactas: boolean }>;
  /** Opcional: redacta el mensaje al cliente desde el brief. Si falta o falla, se usan plantillas. */
  compose?: (brief: ComposeBrief) => Promise<string>;
  /** Opcional: últimos mensajes de la conversación, en orden cronológico. */
  getHistory?: () => Promise<{ rol: "comprador" | "agente"; texto: string }[]>;
  /** Opcional: clasifica el mensaje en {handoff, preguntaProfunda}. Sin ella, se usa DEFAULT_INTENT. */
  classifyIntent?: (text: string) => Promise<IntentFlags>;
  /** Opcional: actualiza el resumen rodante (best-effort). Si falta o falla, se conserva el previo. */
  summarize?: (a: { previo: string; userMessage: string; reply: string }) => Promise<string>;
  /** Por defecto PostgresSaver; en tests se inyecta MemorySaver. */
  checkpointer?: BaseCheckpointSaver;
}

export function buildSellerSummary(row: LeadRow): string {
  const s = row.solicitud;
  const linea = (k: string, v: unknown) => (v != null && v !== "" ? `${k}: ${typeof v === "object" ? JSON.stringify(v) : v}` : null);
  const partes = [
    `Nuevo lead (Telegram ${row.telegram_user_id}${row.telegram_username ? ` @${row.telegram_username}` : ""}) — estado: ${row.estado}`,
    linea("Propósito", s.proposito),
    linea("Tipo de pieza", s.tipo_pieza),
    linea("Peso (qt)", s.peso_quilates),
    linea("Color", s.color),
    linea("Origen", s.origen),
    linea("Presupuesto", s.presupuesto),
    linea("Tratamiento máx.", s.tratamiento_max_aceptable),
    row.campos_faltantes.length ? `Faltan: ${row.campos_faltantes.join(", ")}` : null,
  ].filter(Boolean);
  return partes.join("\n");
}

export function buildPiedrasPropuestas(piedras: Piedra[], { includeUrls = false } = {}): string {
  if (piedras.length === 0) return "";
  const items = piedras.map((p) => {
    const link = includeUrls && p.media_url ? ` — ${p.media_url}` : "";
    return `• ${p.nombre} (${p.peso_ct} ct, ${p.precio_usd_ct} USD/ct)${link}`;
  });
  return `\n\nTengo estas piedras que podrían encajar:\n${items.join("\n")}`;
}

async function composeOrFallback(deps: IrisDeps, brief: ComposeBrief, fallback: string): Promise<string> {
  if (!deps.compose) return fallback;
  try {
    const out = await deps.compose(brief);
    return out && out.trim() ? out : fallback;
  } catch (err) {
    console.error("[iris] compose falló, usando plantilla:", err);
    return fallback;
  }
}

async function extractorNode(state: State, deps: IrisDeps): Promise<Partial<State>> {
  const partial = await deps.extract(state.inputText);
  return { solicitud: partial };
}

function validadorNode(state: State): Partial<State> {
  return evaluarEstado(state.solicitud);
}

async function clasificadorNode(state: State, deps: IrisDeps): Promise<Partial<State>> {
  if (!deps.classifyIntent) return { intent: DEFAULT_INTENT };
  try {
    return { intent: await deps.classifyIntent(state.inputText) };
  } catch (err) {
    console.error("[iris] classifyIntent falló, usando DEFAULT:", err);
    return { intent: DEFAULT_INTENT };
  }
}

async function efectosNode(state: State, deps: IrisDeps): Promise<Partial<State>> {
  const debePersistir = state.estado === "completo" || state.intent.handoff;
  if (!debePersistir) return {};
  const estadoFinal: EstadoLead = state.estado === "completo" ? "completo" : "incompleto";
  const row = buildLeadRow({
    telegramUserId: state.telegramUserId,
    telegramUsername: state.telegramUsername,
    solicitud: state.solicitud,
    estado: estadoFinal,
    camposFaltantes: state.camposFaltantes,
  });
  await deps.saveLead(row);
  const updates: Partial<State> = {};
  if (state.estado === "completo" && !state.vendedorNotificado) {
    const { piedras } = deps.matchInventory ? await deps.matchInventory(state.solicitud) : { piedras: [] as Piedra[] };
    await deps.notifySeller(buildSellerSummary(row) + buildPiedrasPropuestas(piedras, { includeUrls: true }));
    updates.vendedorNotificado = true;
  }
  if (state.intent.handoff && !state.handoffNotificado) {
    await deps.notifySeller("🤝 Cliente quiere cerrar el trato (compra / certificado / joya a medida):\n" + buildSellerSummary(row));
    updates.handoffNotificado = true;
  }
  return updates;
}

export function decideBriefIntent(a: {
  handoff: boolean; estado: EstadoLead; tieneStones: boolean; rondas: number;
}): "handoff" | "asesorar" | "aclarar" {
  if (a.handoff) return "handoff";
  if (a.estado === "completo" || a.tieneStones || a.rondas >= MAX_RONDAS) return "asesorar";
  return "aclarar";
}

/** El cliente pide ver la foto explícitamente (ES/EN). En ese caso el dedup no
 * aplica: una petición directa no es una recomendación proactiva repetida. */
const RE_PIDE_FOTO = /\bfotos?\b|\bfotograf|\bim[aá]gen(?:es)?\b|\bph?otos?\b|\bpict/i;
export function pideFoto(text: string): boolean {
  return RE_PIDE_FOTO.test(text ?? "");
}

async function responderNode(state: State, deps: IrisDeps): Promise<Partial<State>> {
  const { piedras: matches, hayExactas } = deps.matchInventory
    ? await deps.matchInventory(state.solicitud)
    : { piedras: [] as Piedra[], hayExactas: false };
  // Nunca reenviar una piedra ya recomendada al cliente EN UNA RECOMENDACIÓN PROACTIVA.
  // Si el cliente pide la foto explícitamente, se reenvía (se salta el dedup).
  const yaRecomendadas = new Set(state.piedrasRecomendadas);
  const piedras = pideFoto(state.inputText)
    ? matches
    : matches.filter((p) => !yaRecomendadas.has(p.id));
  const briefIntent = decideBriefIntent({
    handoff: state.intent.handoff,
    estado: state.estado,
    tieneStones: piedras.length > 0,
    rondas: state.rondas,
  });
  const fallback =
    briefIntent === "handoff"
      ? "¡Perfecto! Un asesor de Méraldi te contactará para finalizar. 💚" + buildPiedrasPropuestas(piedras)
      : briefIntent === "asesorar"
        ? "Con gusto sigo ayudándote. ¿Qué más te gustaría saber?" + buildPiedrasPropuestas(piedras)
        : buildClarificationMessage(state.camposFaltantes) + buildPiedrasPropuestas(piedras);
  const history = deps.getHistory ? await deps.getHistory() : [];
  const yaPreguntado = state.preguntadas;
  const target = state.camposFaltantes.find((c) => !yaPreguntado.includes(c)) ?? null;
  const missingPrioritizado = target
    ? [target, ...state.camposFaltantes.filter((c) => c !== target)]
    : state.camposFaltantes;
  const fotoAdjunta = (piedras[0]?.media_url ?? null) != null;
  const brief = buildComposeBrief({
    intent: briefIntent,
    userMessage: state.inputText,
    solicitud: state.solicitud,
    missing: missingPrioritizado,
    stones: piedras,
    history,
    preguntaProfunda: state.intent.preguntaProfunda,
    idioma: state.intent.idioma,
    hayExactas,
    yaPreguntado,
    piedrasMostradas: state.piedras_mostradas,
    resumen: state.resumen,
    fotoAdjunta,
  });
  const reply = await composeOrFallback(deps, brief, fallback);
  let resumen = state.resumen;
  if (deps.summarize) {
    try {
      resumen = await deps.summarize({ previo: state.resumen, userMessage: state.inputText, reply });
    } catch (err) {
      console.error("[iris] summarize falló, conservo resumen previo:", err);
    }
  }
  return {
    reply,
    mediaUrl: piedras[0]?.media_url ?? null,
    preguntadas: target ? [target] : [],
    piedras_mostradas: piedras.map((p) => p.nombre),
    resumen,
    piedrasRecomendadas: piedras.map((p) => p.id),
  };
}

export async function buildGraph(deps: IrisDeps) {
  const checkpointer = deps.checkpointer ?? (await getCheckpointer());
  const graph = new StateGraph(IrisState)
    .addNode("extractor", (s: State) => extractorNode(s, deps))
    .addNode("validador", validadorNode)
    .addNode("clasificador", (s: State) => clasificadorNode(s, deps))
    .addNode("efectos", (s: State) => efectosNode(s, deps))
    .addNode("responder", (s: State) => responderNode(s, deps))
    .addEdge(START, "extractor")
    .addEdge("extractor", "validador")
    .addEdge("validador", "clasificador")
    .addEdge("clasificador", "efectos")
    .addEdge("efectos", "responder")
    .addEdge("responder", END);
  return graph.compile({ checkpointer });
}

export async function runIris(
  deps: IrisDeps,
  input: { telegramUserId: number; chatId: number; telegramUsername?: string; text: string }
): Promise<{ reply: string; estado: EstadoLead; mediaUrl: string | null }> {
  const app = await buildGraph(deps);
  const final = (await app.invoke(
    {
      inputText: input.text,
      telegramUserId: input.telegramUserId,
      chatId: input.chatId,
      telegramUsername: input.telegramUsername ?? null,
      rondas: 1,
    },
    { configurable: { thread_id: String(input.telegramUserId) } }
  )) as State;
  return { reply: final.reply, estado: final.estado, mediaUrl: final.mediaUrl };
}
