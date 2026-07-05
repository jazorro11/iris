import type { Solicitud, CampoCritico } from "./schema.js";
import type { Piedra } from "./inventario.js";

/** Hechos verificados que el redactor (LLM) tiene permitido usar. */
export interface ComposeBrief {
  intent: "aclarar" | "cerrar" | "asesorar" | "handoff";
  /** Último mensaje del cliente, para acusar recibo. */
  userMessage: string;
  /** Solo los campos críticos ya capturados (para reconocer lo dicho). */
  known: Partial<Solicitud>;
  /** Campos críticos faltantes, priorizados; el redactor pide 1-2. */
  missing: CampoCritico[];
  /** Piedras reales que encajan (puede ir vacío). */
  stones: Piedra[];
  /** Presupuesto conocido del cliente (para conectar la recomendación). */
  presupuesto?: Solicitud["presupuesto"];
  /** Últimos mensajes de la conversación, en orden cronológico. */
  history?: { rol: "comprador" | "agente"; texto: string }[];
  /** Presente solo cuando intent="cerrar". */
  cierre?: "completo" | "incompleto";
  /** true → el redactor debe apoyarse en la biblia completa (pregunta gemológica profunda). */
  preguntaProfunda?: boolean;
}
