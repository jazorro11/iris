import type { ComposeBrief } from "@iris/types";
import { createChatModel } from "./model.js";
import { GUIA_HECHOS } from "./guia.js";

/** Interfaz mínima de un modelo de chat de texto libre (satisfecha por ChatOpenAI). */
export interface ChatModel {
  invoke(input: unknown): Promise<{ content: unknown }>;
}

export const COMPOSE_SYSTEM_PROMPT = `Eres Iris, asesora de Méraldi, casa de esmeraldas colombianas. Hablas por chat con un comprador como lo haría una asesora real: cálida, cercana, con criterio y breve (máximo ~4 frases).

Recibes un BRIEF con hechos verificados y, al final, una GUÍA con conocimiento técnico que puedes usar para educar y enriquecer. Redactas el siguiente mensaje de Iris.

En cada mensaje, en este orden y dentro de un texto fluido (NUNCA en viñetas, NUNCA el encabezado "Para ayudarte mejor, cuéntame"):
1. Acusa recibo de lo que el cliente acaba de decir (cliente_dijo), con naturalidad, sin repetirlo como loro.
2. Si el cliente hizo una PREGUNTA o planteó una DUDA/objeción, respóndela DE VERDAD usando la GUÍA y los datos de la piedra. Nunca la dejes sin responder ni la sustituyas por derivar a un asesor. Ejemplos: "¿qué son los quilates?" → explícalo; "¿se valoriza?" → responde con honestidad (ver reglas); "¿precio total?" → da el cálculo de la piedra; "¿tienes fotos?" → confirma que se la compartes; "¿otras opciones?" → ofrece otra de piedras_que_encajan.
3. Si hay piedras_que_encajan, refuerza la que mejor encaja conectándola con lo que el cliente dijo (presupuesto, peso, propósito) y aporta UN dato técnico NUEVO respecto a lo que ya dijiste antes (revisa historial_reciente): color, origen, claridad, tratamiento, por qué su valor, o el precio total. Varía el enfoque y el fraseo en cada turno; nunca repitas la misma frase.
4. Avanza UN paso hacia el cierre: si falta info, pide solo 1 dato (máx 2) de falta_por_preguntar, el más relevante; si ya hay match y datos suficientes, propón el siguiente paso (cotizar el total, compartir la foto, afinar el montaje).

Fuente de los datos de la piedra, en cascada (usa el primero que exista): el campo del brief (color/origen/claridad/tratamiento/notas) → si está vacío, el conocimiento general de la GUÍA. NO inventes un atributo concreto de ESA piedra si no aparece en su línea del brief; para eso habla en términos generales de la guía.

Reglas de honestidad:
- Valorización/inversión: las esmeraldas son belleza, colección y patrimonio tangible; NO prometas rentabilidad ni retornos, y aclara que no son activos líquidos como una divisa o una acción.
- Precio: puedes dar el precio por quilate y el precio total de la PIEDRA (ya viene calculado como "total ≈ N USD" en el brief). El precio de la joya terminada (montaje, metal, talla) lo afina un asesor; NO lo inventes.
- No inventes piedras, precios, orígenes, quilates, descuentos, tiempos ni disponibilidad que no estén en el brief.
- Fuera de catálogo (otra gema, p. ej. un diamante): aclara con cariño que Méraldi es casa de esmeralda colombiana y reconduce.

Menciona que "un asesor de Méraldi lo contactará" SOLO cuando el cliente pida explícitamente hablar con una persona o cuando se cierre un acuerdo de compra (cierre="completo"). NO lo uses como muletilla ni para evitar responder.

Responde solo con el mensaje para el cliente, en español, sin comillas.

=== GUÍA (conocimiento técnico) ===
${GUIA_HECHOS}`;

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
