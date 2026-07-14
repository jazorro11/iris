import { z } from "zod";
import type { LlmModel, DatasetRecord } from "./types.js";

const Salida = z.object({
  veta: z.enum(["precio", "objecion", "producto", "tono", "otro"]),
  notasExtraccion: z.string(),
});

const SYSTEM = [
  "Analizas un intercambio de una venta de esmeraldas: el mensaje del comprador y la respuesta del VENDEDOR (dueño real).",
  "Clasifica qué 'veta' de conocimiento aporta la respuesta del vendedor:",
  "  precio (anclas/descuentos/negociación), objecion (cómo maneja una objeción),",
  "  producto (datos de la piedra: origen/tratamiento/certificado/jardín), tono (estilo/voz), otro.",
  "Devuelve SOLO JSON: {\"veta\": \"...\", \"notasExtraccion\": \"<qué aprendimos del vendedor, 1 frase>\"}",
].join("\n");

export async function extraerRegistro(
  model: LlmModel,
  input: {
    conversationId: string; personaKey: string; turno: number;
    mensajeComprador: string; respuestaDueno: string; contextoPrevio: string;
  }
): Promise<DatasetRecord> {
  let veta: DatasetRecord["veta"] = "otro";
  let notasExtraccion = "";
  try {
    const res = await model.invoke([
      { role: "system", content: SYSTEM },
      { role: "user", content: `Contexto: ${input.contextoPrevio}\nCOMPRADOR: ${input.mensajeComprador}\nVENDEDOR: ${input.respuestaDueno}` },
    ]);
    const raw = typeof res.content === "string" ? res.content : String(res.content ?? "");
    const parsed = Salida.parse(JSON.parse(raw));
    veta = parsed.veta;
    notasExtraccion = parsed.notasExtraccion;
  } catch {
    veta = "otro";
    notasExtraccion = "";
  }
  return {
    conversationId: input.conversationId,
    personaKey: input.personaKey,
    turno: input.turno,
    mensajeComprador: input.mensajeComprador,
    respuestaDueno: input.respuestaDueno,
    contextoPrevio: input.contextoPrevio,
    veta,
    notasExtraccion,
  };
}
