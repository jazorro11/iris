import type { Persona } from "./types.js";

/** Dependencias de I/O inyectadas (permiten testear la lógica sin DB ni red). */
export interface IniciarDeps {
  hayActiva(): Promise<boolean>;
  crear(personaKey: string): Promise<{ id: string }>;
  guardarPrimerMensaje(conversationId: string, texto: string): Promise<void>;
  enviar(texto: string, replyMarkup?: unknown): Promise<void>;
}

export type IniciarResultado =
  | { estado: "iniciada"; conversationId: string; primerMensaje: string }
  | { estado: "ya-activa" };

/**
 * Arranca una conversación de cosecha: guard de concurrencia → crea → primer mensaje del
 * comprador (turno 1) → envío. Compartida por el webhook y el script `cosechar-iniciar`.
 * Si ya hay una activa, rehúsa sin tocar nada.
 */
export async function iniciarConversacion(
  deps: IniciarDeps, persona: Persona, replyMarkup?: unknown
): Promise<IniciarResultado> {
  if (await deps.hayActiva()) return { estado: "ya-activa" };
  const { id } = await deps.crear(persona.key);
  await deps.guardarPrimerMensaje(id, persona.primerMensaje);
  await deps.enviar(persona.primerMensaje, replyMarkup);
  return { estado: "iniciada", conversationId: id, primerMensaje: persona.primerMensaje };
}
