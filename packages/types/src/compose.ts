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
  /** Idioma detectado del mensaje del cliente (clasificador determinista). Por defecto "es". */
  idioma?: "es" | "en";
  /** true si alguna piedra cumple LITERALMENTE lo pedido; false → las stones son "lo más cercano". */
  hayExactas?: boolean;
  /** Campos ya preguntados en turnos anteriores; el redactor no debe repetirlos. */
  yaPreguntado?: CampoCritico[];
  /** Nombres de piedras ya mostradas; no re-mostrar la misma. */
  piedrasMostradas?: string[];
  /** Resumen rodante de la conversación (memoria ligera). */
  resumen?: string;
}
