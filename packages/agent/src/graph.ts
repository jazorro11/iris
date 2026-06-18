import { StateGraph, START, END, type BaseCheckpointSaver } from "@langchain/langgraph";
import type { Solicitud, EstadoLead, LeadRow } from "@iris/types";
import { buildLeadRow } from "@iris/db";
import { IrisState, type State } from "./state.js";
import { evaluarEstado, MAX_RONDAS } from "./request.js";
import { buildClarificationMessage } from "./questions.js";
import { getCheckpointer } from "./checkpointer.js";

export interface IrisDeps {
  extract: (text: string) => Promise<Solicitud>;
  saveLead: (row: LeadRow) => Promise<{ id: string }>;
  notifySeller: (text: string) => Promise<void>;
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

function preguntarNode(state: State): Partial<State> {
  return { reply: buildClarificationMessage(state.camposFaltantes) };
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
  await deps.notifySeller(buildSellerSummary(row));
  const reply = estadoFinal === "completo"
    ? "¡Gracias! Registré tu solicitud y un asesor de Méraldi te contactará pronto. 💚"
    : "Gracias por la información. Un asesor de Méraldi continuará contigo para afinar los detalles.";
  return { reply, estado: estadoFinal };
}

export async function buildGraph(deps: IrisDeps) {
  const checkpointer = deps.checkpointer ?? (await getCheckpointer());
  const graph = new StateGraph(IrisState)
    .addNode("extractor", (s: State) => extractorNode(s, deps))
    .addNode("validador", validadorNode)
    .addNode("preguntar", preguntarNode)
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
