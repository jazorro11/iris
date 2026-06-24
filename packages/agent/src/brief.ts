import type { Solicitud, CampoCritico, Piedra, ComposeBrief } from "@iris/types";

const CRITICOS: CampoCritico[] = [
  "proposito", "presupuesto", "tipo_pieza", "peso_quilates", "color", "origen",
];

/** Devuelve solo los campos críticos presentes en la solicitud. */
export function pickKnownCriticos(s: Solicitud): Partial<Solicitud> {
  const out: Record<string, unknown> = {};
  for (const k of CRITICOS) {
    const v = (s as Record<string, unknown>)[k];
    if (v != null) out[k] = v;
  }
  return out as Partial<Solicitud>;
}

/** Ensambla el brief de solo-hechos para el redactor. `known` excluye lo que sigue faltando. */
export function buildComposeBrief(input: {
  intent: "aclarar" | "cerrar";
  userMessage: string;
  solicitud: Solicitud;
  missing: CampoCritico[];
  stones: Piedra[];
  cierre?: "completo" | "incompleto";
}): ComposeBrief {
  const missingSet = new Set<CampoCritico>(input.missing);
  const knownAll = pickKnownCriticos(input.solicitud);
  const known: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(knownAll)) {
    if (!missingSet.has(k as CampoCritico)) known[k] = v;
  }
  return {
    intent: input.intent,
    userMessage: input.userMessage,
    known: known as Partial<Solicitud>,
    missing: input.missing,
    stones: input.stones,
    ...(input.cierre ? { cierre: input.cierre } : {}),
  };
}
