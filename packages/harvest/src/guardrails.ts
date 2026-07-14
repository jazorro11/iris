import { MAX_TURNOS, STOP_WORDS } from "./config.js";

export type GuardrailResult = { accion: "continuar" } | { accion: "detener"; motivo: string };

export function evaluarGuardrails(input: { turnosComprador: number; ultimoTextoDueno: string }): GuardrailResult {
  if (STOP_WORDS.test(input.ultimoTextoDueno)) {
    return { accion: "detener", motivo: "stop-word del dueño (pausa/bot/basta)" };
  }
  if (input.turnosComprador >= MAX_TURNOS) {
    return { accion: "detener", motivo: `alcanzado el máximo de ${MAX_TURNOS} turnos` };
  }
  return { accion: "continuar" };
}
