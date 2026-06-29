import type { ComposeBrief } from "@iris/types";
import { createChatModel } from "./model.js";

/** Interfaz mínima de un modelo de chat de texto libre (satisfecha por ChatOpenAI). */
export interface ChatModel {
  invoke(input: unknown): Promise<{ content: unknown }>;
}

export const COMPOSE_SYSTEM_PROMPT = `Eres Iris, asesora de Méraldi, casa de esmeraldas colombianas. Hablas por chat con un comprador, como lo haría una asesora real: cálida, cercana y breve.

Recibes un BRIEF con hechos verificados. Tu única tarea es redactar el siguiente mensaje de Iris usando EXCLUSIVAMENTE esos hechos.

Cómo conversas:
- Primero acusa recibo de lo que el cliente acaba de decir (cliente_dijo / ya_sabemos), con naturalidad, sin repetírselo como loro.
- Si intent="aclarar": pide solo 1 dato (máximo 2) de falta_por_preguntar, el más relevante, dentro de una frase fluida. NUNCA en lista de viñetas. NUNCA el encabezado "Para ayudarte mejor, cuéntame". Varía el fraseo en cada turno.
- Si hay piedras_que_encajan: menciona la que mejor encaja conectándola con lo que el cliente dijo (p. ej. presupuesto o peso), como recomendación de asesora. Usa solo nombre, peso y precio TAL CUAL vienen en el brief.
- Si intent="cerrar": agradece y avísale que un asesor de Méraldi lo contactará. Si cierre="incompleto", dilo de forma natural (faltan detalles por afinar).

Prohibido:
- Inventar piedras, precios, orígenes, quilates o datos que no estén en el brief.
- Prometer tiempos, descuentos o disponibilidad concretos.
- Pedir datos que ya están en ya_sabemos.
- Sonar a formulario. Máximo ~3-4 frases.

Responde solo con el mensaje para el cliente, en español, sin comillas.`;

/** Serializa el brief en un bloque de texto legible para el LLM. Determinístico. */
export function renderBriefForPrompt(b: ComposeBrief): string {
  const known = Object.keys(b.known).length ? JSON.stringify(b.known) : "(nada aún)";
  const missing = b.missing.length ? b.missing.join(", ") : "(nada)";
  const presupuesto = b.presupuesto && Object.keys(b.presupuesto).length
    ? JSON.stringify(b.presupuesto)
    : "(no dado)";
  const stones = b.stones.length
    ? b.stones.map((p) => {
        const total = Math.round(p.peso_ct * p.precio_usd_ct);
        const attrs = [
          p.color ? `color: ${p.color}` : null,
          p.origen ? `origen: ${p.origen}` : null,
          p.claridad ? `claridad: ${p.claridad}` : null,
          p.tratamiento ? `tratamiento: ${p.tratamiento}` : null,
          p.notas ? `notas: ${p.notas}` : null,
          `foto: ${p.media_url ? "sí" : "no"}`,
        ].filter(Boolean).join("; ");
        return `- ${p.nombre} (${p.peso_ct} ct, ${p.precio_usd_ct} USD/ct, total ≈ ${total} USD) — ${attrs}`;
      }).join("\n")
    : "(ninguna)";
  const history = b.history && b.history.length
    ? b.history.map((m) => `${m.rol === "comprador" ? "Cliente" : "Iris"}: ${m.texto}`).join("\n")
    : "(sin historial)";
  return [
    `intent: ${b.intent}`,
    `cliente_dijo: ${b.userMessage}`,
    `ya_sabemos: ${known}`,
    `presupuesto: ${presupuesto}`,
    `falta_por_preguntar (prioridad): ${missing}`,
    `piedras_que_encajan:\n${stones}`,
    `historial_reciente:\n${history}`,
    b.cierre ? `cierre: ${b.cierre}` : null,
  ].filter(Boolean).join("\n");
}

/** Redacta el mensaje al cliente a partir del brief. Lanza si el modelo falla. */
export async function composeReply(model: ChatModel, brief: ComposeBrief): Promise<string> {
  const res = await model.invoke([
    { role: "system", content: COMPOSE_SYSTEM_PROMPT },
    { role: "user", content: renderBriefForPrompt(brief) },
  ]);
  const text = typeof res.content === "string" ? res.content : String(res.content ?? "");
  return text.trim();
}

/** Instancia del modelo redactor (temp alta para calidez). */
export function createComposerModel(): ChatModel {
  return createChatModel({ temperature: 0.6 });
}
