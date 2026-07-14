import type { Persona, HistItem, LlmModel } from "./types.js";

export type TurnoResult = { fin: false; texto: string } | { fin: true };

export function buildPersonaSystemPrompt(p: Persona): string {
  const lang = p.idioma === "en" ? "Write ONLY in English." : "Escribe SOLO en español.";
  return [
    `Eres un comprador simulado escribiéndole a un vendedor de esmeraldas por chat.`,
    `Arquetipo: ${p.arquetipo}. Objetivo: ${p.objetivo}.`,
    `Presupuesto: ${p.presupuesto}. Nivel de conocimiento: ${p.nivelConocimiento}.`,
    `A lo largo de la conversación DEBES plantear, de forma natural y una a una, estas inquietudes:`,
    ...p.objeciones.map((o) => `  - ${o}`),
    `Escribe como una persona real por WhatsApp: 1-2 frases, informal, sin sonar a bot.`,
    lang,
    `Cuando ya hayas planteado tus inquietudes y obtenido respuesta, o la conversación llegue a un cierre natural, responde EXACTAMENTE con la palabra: FIN`,
    `Devuelve SOLO tu próximo mensaje (o FIN). Sin comillas ni prefijos.`,
  ].join("\n");
}

function renderHistorial(historial: HistItem[]): string {
  if (historial.length === 0) return "(aún no hay mensajes)";
  return historial.map((h) => `${h.rol === "comprador" ? "TÚ" : "VENDEDOR"}: ${h.texto}`).join("\n");
}

export async function siguienteTurno(model: LlmModel, persona: Persona, historial: HistItem[]): Promise<TurnoResult> {
  const res = await model.invoke([
    { role: "system", content: buildPersonaSystemPrompt(persona) },
    { role: "user", content: `Conversación hasta ahora:\n${renderHistorial(historial)}\n\nTu próximo mensaje:` },
  ]);
  const texto = (typeof res.content === "string" ? res.content : String(res.content ?? "")).trim();
  if (/^fin\b/i.test(texto) || texto.toUpperCase() === "FIN") return { fin: true };
  return { fin: false, texto };
}
