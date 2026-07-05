import { z } from "zod";
import type { StructuredModel } from "./extractor.js";

export const IntentSchema = z.object({
  handoff: z.boolean(),
  preguntaProfunda: z.boolean(),
  idioma: z.enum(["es", "en"]),
});

export type IntentFlags = z.infer<typeof IntentSchema>;

export const DEFAULT_INTENT: IntentFlags = { handoff: false, preguntaProfunda: false, idioma: "es" };

export const INTENT_SYSTEM_PROMPT = `Clasificas el mensaje de un comprador de esmeraldas de la casa Méraldi en tres banderas. El mensaje puede estar en español o inglés.

- handoff: true SOLO si el cliente quiere avanzar a un cierre humano: comprar/pagar ahora, pedir un certificado (GIA/internacional), pedir una joya a medida o montaje, coordinar envío/pago, o pedir explícitamente hablar con una persona. false si solo pregunta, explora, pide fotos o información.
- preguntaProfunda: true si hace una pregunta de gemología de DETALLE que excede lo común: geología de depósitos, pleocroísmo, índices de refracción/espectros, cristalografía, historia, diferencias finas de determinación de origen entre laboratorios. false para preguntas comunes: precio, color, tratamiento/aceite/perma, jardín/inclusiones, origen general (Muzo/Chivor), certificación básica, cuidado.
- idioma: "en" si el mensaje del cliente está escrito en inglés; "es" si está en español (u otro idioma latino por defecto).

Responde solo con las tres banderas.`;

export async function classifyIntent(model: StructuredModel, text: string): Promise<IntentFlags> {
  const structured = model.withStructuredOutput(IntentSchema, { name: "intent" });
  const raw = await structured.invoke([
    { role: "system", content: INTENT_SYSTEM_PROMPT },
    { role: "user", content: text },
  ]);
  return IntentSchema.parse(raw);
}
