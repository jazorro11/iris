import { SolicitudSchema, type Solicitud } from "@iris/types";
import type { BaseLanguageModelInput } from "@langchain/core/language_models/base";

/** Interfaz mínima de un modelo capaz de salida estructurada (satisfecha por ChatOpenAI). */
export interface StructuredModel {
  withStructuredOutput(
    schema: unknown,
    opts?: { name?: string }
  ): { invoke: (input: BaseLanguageModelInput) => Promise<unknown> };
}

export const EXTRACTION_SYSTEM_PROMPT = `Eres un asistente de Méraldi, casa de esmeraldas colombianas.
Tu tarea es leer el mensaje de un comprador (en lenguaje natural) y extraer SOLO la información
que el comprador menciona EXPLÍCITAMENTE, a la estructura indicada.

Reglas:
- No inventes ni asumas valores que el comprador no dijo. Si un dato no aparece, omítelo.
- Usa exclusivamente los valores de enumeración permitidos por el esquema.
- "sin preferencia", "me da igual", "el que recomiendes", "no importa" sobre un atributo → usa el valor "indiferente" de ese campo (color.tono, corte.forma, origen.pais, claridad, tratamiento_max_aceptable). Es un valor lleno, NO lo omitas.
- "verde esmeralda intenso" → color.tono=verde, color.saturacion=vivida.
- "anillo de compromiso" / "para un anillo" / "para engastar" → el comprador busca la GEMA para montar: tipo_pieza=gema_tallada, proposito=regalo. "anillo ya hecho" / "joya terminada" → tipo_pieza=joya_terminada.
- Presupuesto: detecta moneda (USD/COP) y si es total o por quilate. Un monto único para "un anillo"/"una piedra" sin decir "por quilate" es total (base=total).
- Orígenes Méraldi: Colombia (Muzo, Coscuez, Chivor, La Pita/Maripí, Gachalá), Zambia (Kafubu/Kagem), Brasil.
- Tratamiento según la guía: sin_tratamiento, insignificante, menor, moderado, significativo.
- Tipo de pieza: gema tallada, cristal en bruto, joya terminada o espécimen mineral.`;

export async function extractRequest(model: StructuredModel, text: string): Promise<Solicitud> {
  const structured = model.withStructuredOutput(SolicitudSchema, { name: "solicitud" });
  const raw = await structured.invoke([
    { role: "system", content: EXTRACTION_SYSTEM_PROMPT },
    { role: "user", content: text },
  ]);
  return SolicitudSchema.parse(raw);
}
