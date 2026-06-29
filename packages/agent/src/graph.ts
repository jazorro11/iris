import { StateGraph, START, END, type BaseCheckpointSaver } from "@langchain/langgraph";
import type { Solicitud, EstadoLead, LeadRow, Piedra, ComposeBrief } from "@iris/types";
import { buildLeadRow } from "@iris/db";
import { IrisState, type State } from "./state.js";
import { evaluarEstado, MAX_RONDAS } from "./request.js";
import { buildClarificationMessage } from "./questions.js";
import { getCheckpointer } from "./checkpointer.js";
import { buildComposeBrief } from "./brief.js";

export interface IrisDeps {
  extract: (text: string) => Promise<Solicitud>;
  saveLead: (row: LeadRow) => Promise<{ id: string }>;
  notifySeller: (text: string) => Promise<void>;
  /** Opcional: propone piedras del inventario que coincidan. */
  matchInventory?: (solicitud: Solicitud) => Promise<Piedra[]>;
  /** Opcional: redacta el mensaje al cliente desde el brief. Si falta o falla, se usan plantillas. */
  compose?: (brief: ComposeBrief) => Promise<string>;
  /** Opcional: últimos mensajes de la conversación, en orden cronológico. */
  getHistory?: () => Promise<{ rol: "comprador" | "agente"; texto: string }[]>;
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

export function buildPiedrasPropuestas(piedras: Piedra[]): string {
  if (piedras.length === 0) return "";
  const items = piedras.map((p) => {
    const link = p.media_url ? ` — ${p.media_url}` : "";
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

function route(state: State): "preguntar" | "persistir" {
  if (state.estado === "completo") return "persistir";
  if (state.rondas >= MAX_RONDAS) return "persistir";
  return "preguntar";
}

async function preguntarNode(state: State, deps: IrisDeps): Promise<Partial<State>> {
  const piedras = deps.matchInventory ? await deps.matchInventory(state.solicitud) : [];
  const fallback = buildClarificationMessage(state.camposFaltantes) + buildPiedrasPropuestas(piedras);
  const history = deps.getHistory ? await deps.getHistory() : [];
  const brief = buildComposeBrief({
    intent: "aclarar",
    userMessage: state.inputText,
    solicitud: state.solicitud,
    missing: state.camposFaltantes,
    stones: piedras,
    history,
  });
  const reply = await composeOrFallback(deps, brief, fallback);
  return { reply };
}

async function persistirNode(state: State, deps: IrisDeps): Promise<Partial<State>> {
  const estadoFinal: EstadoLead = state.estado === "completo" ? "completo" : "incompleto";
  const row = buildLeadRow({
    telegramUserId: state.telegramUserId,
    telegramUsername: state.telegramUsername,
    solicitud: state.solicitud,
    estado: estadoFinal,
    camposFaltantes: state.camposFaltantes,
  });
  await deps.saveLead(row);
  const piedras = deps.matchInventory ? await deps.matchInventory(state.solicitud) : [];
  const propuesta = buildPiedrasPropuestas(piedras);
  await deps.notifySeller(buildSellerSummary(row) + propuesta);
  const fallbackBase = estadoFinal === "completo"
    ? "¡Gracias! Registré tu solicitud y un asesor de Méraldi te contactará pronto. 💚"
    : "Gracias por la información. Un asesor de Méraldi continuará contigo para afinar los detalles.";
  const history = deps.getHistory ? await deps.getHistory() : [];
  const brief = buildComposeBrief({
    intent: "cerrar",
    userMessage: state.inputText,
    solicitud: state.solicitud,
    missing: state.camposFaltantes,
    stones: piedras,
    history,
    cierre: estadoFinal,
  });
  const reply = await composeOrFallback(deps, brief, fallbackBase + propuesta);
  return { reply, estado: estadoFinal };
}

export async function buildGraph(deps: IrisDeps) {
  const checkpointer = deps.checkpointer ?? (await getCheckpointer());
  const graph = new StateGraph(IrisState)
    .addNode("extractor", (s: State) => extractorNode(s, deps))
    .addNode("validador", validadorNode)
    .addNode("preguntar", (s: State) => preguntarNode(s, deps))
    .addNode("persistir", (s: State) => persistirNode(s, deps))
    .addEdge(START, "extractor")
    .addEdge("extractor", "validador")
    .addConditionalEdges("validador", route, { preguntar: "preguntar", persistir: "persistir" })
    .addEdge("preguntar", END)
    .addEdge("persistir", END);
  return graph.compile({ checkpointer });
}

export async function runIris(
  deps: IrisDeps,
  input: { telegramUserId: number; chatId: number; telegramUsername?: string; text: string }
): Promise<{ reply: string; estado: EstadoLead }> {
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
  return { reply: final.reply, estado: final.estado };
}
