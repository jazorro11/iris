import type { Solicitud, CampoCritico } from "@iris/types";
import { missingCriticalFields } from "./request.js";

export const PREGUNTAS: Record<CampoCritico, string> = {
  proposito: "¿La esmeralda es para joyería, colección o inversión?",
  presupuesto: "¿Qué presupuesto manejas y en qué moneda?",
  tipo_pieza: "¿Buscas una gema tallada, un cristal en bruto o una joya terminada?",
  peso_quilates: "¿Qué peso en quilates te interesa (aprox.)?",
  color: "¿Tienes preferencia de color (verde intenso, verde azulado…)?",
  origen: "¿Prefieres algún origen en particular (Colombia: Muzo, Coscuez, Chivor…)?",
};

export function clarificationTargets(s: Solicitud): CampoCritico[] {
  return missingCriticalFields(s);
}

/** Mensaje al comprador pidiendo hasta 3 datos críticos faltantes. */
export function buildClarificationMessage(targets: CampoCritico[]): string {
  if (targets.length === 0) {
    return "¿Podrías darme un poco más de detalle sobre la esmeralda que buscas?";
  }
  const preguntas = targets.slice(0, 3).map((t) => `• ${PREGUNTAS[t]}`).join("\n");
  return `Para ayudarte mejor, cuéntame:\n${preguntas}`;
}
