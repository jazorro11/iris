import { Annotation } from "@langchain/langgraph";
import type { Solicitud, CampoCritico, EstadoLead } from "@iris/types";
import { mergeRequest } from "./request.js";
import { type IntentFlags, DEFAULT_INTENT } from "./intent.js";

const lastWrite = <T>(def: T) => ({ reducer: (_p: T, n: T) => n, default: () => def });

const unionArr = <T>(def: T[]) => ({
  reducer: (p: T[], n: T[]) => Array.from(new Set([...(p ?? []), ...(n ?? [])])),
  default: () => def,
});

export const IrisState = Annotation.Root({
  inputText: Annotation<string>(lastWrite("")),
  telegramUserId: Annotation<number>(lastWrite(0)),
  telegramUsername: Annotation<string | null>(lastWrite<string | null>(null)),
  chatId: Annotation<number>(lastWrite(0)),
  solicitud: Annotation<Solicitud>({
    reducer: (p, n) => mergeRequest(p ?? {}, n ?? {}),
    default: () => ({}),
  }),
  rondas: Annotation<number>({
    reducer: (p, n) => (p ?? 0) + (n ?? 0),
    default: () => 0,
  }),
  estado: Annotation<EstadoLead>(lastWrite<EstadoLead>("incompleto")),
  camposFaltantes: Annotation<CampoCritico[]>(lastWrite<CampoCritico[]>([])),
  reply: Annotation<string>(lastWrite("")),
  mediaUrl: Annotation<string | null>(lastWrite<string | null>(null)),
  intent: Annotation<IntentFlags>(lastWrite<IntentFlags>(DEFAULT_INTENT)),
  vendedorNotificado: Annotation<boolean>(lastWrite(false)),
  handoffNotificado: Annotation<boolean>(lastWrite(false)),
  preguntadas: Annotation<CampoCritico[]>(unionArr<CampoCritico>([])),
  piedras_mostradas: Annotation<string[]>(unionArr<string>([])),
  resumen: Annotation<string>(lastWrite("")),
});

export type State = typeof IrisState.State;
