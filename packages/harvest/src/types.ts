export type HistItem = { rol: "comprador" | "dueño"; texto: string };
export type Idioma = "es" | "en";
export type Veta = "precio" | "objecion" | "producto" | "tono" | "otro";

export interface Persona {
  key: string;
  arquetipo: string;
  objetivo: string;
  presupuesto: string;
  nivelConocimiento: string;
  primerMensaje: string;
  objeciones: string[];
  idioma: Idioma;
}

/** Modelo LLM mínimo que necesitamos; en tests se inyecta un fake. */
export interface LlmModel {
  invoke(msgs: { role: string; content: string }[]): Promise<{ content: unknown }>;
}

export interface DatasetRecord {
  conversationId: string;
  personaKey: string;
  turno: number;
  mensajeComprador: string;
  respuestaDueno: string;
  contextoPrevio: string;
  veta: Veta;
  notasExtraccion: string;
}
