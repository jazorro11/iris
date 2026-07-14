import { PERSONAS } from "./personas.js";

/** Comando del dueño (botón o slash-command) reconocido por el webhook. */
export type HarvestCommand =
  | { tipo: "nuevo"; arg: string | null }
  | { tipo: "detener" }
  | { tipo: "perfiles" }
  | { tipo: "ayuda" }
  | { tipo: "estado" }
  | { tipo: "start" };

export const BTN_NUEVO = "🆕 Nuevo comprador";
export const BTN_DETENER = "⏹ Detener";
export const BTN_PERFILES = "📋 Perfiles";
export const BTN_AYUDA = "❓ Ayuda";

/** Reply keyboard persistente 2×2 (no inline). Se adjunta en saludos/confirmaciones. */
export const HARVEST_KEYBOARD = {
  keyboard: [
    [{ text: BTN_NUEVO }, { text: BTN_DETENER }],
    [{ text: BTN_PERFILES }, { text: BTN_AYUDA }],
  ],
  resize_keyboard: true,
  is_persistent: true,
};

/**
 * Mapea labels de botón y slash-commands a un `HarvestCommand`.
 * Tolera espacios, mayúsculas y el sufijo `@bot` de los grupos.
 * Devuelve `null` si no es un comando (→ el webhook lo trata como respuesta del dueño).
 */
export function parseHarvestCommand(text: string | undefined): HarvestCommand | null {
  if (!text) return null;
  const t = text.trim();

  // Labels de botón (comparación case-insensitive; los emojis no cambian con toLowerCase).
  const low = t.toLowerCase();
  if (low === BTN_NUEVO.toLowerCase()) return { tipo: "nuevo", arg: null };
  if (low === BTN_DETENER.toLowerCase()) return { tipo: "detener" };
  if (low === BTN_PERFILES.toLowerCase()) return { tipo: "perfiles" };
  if (low === BTN_AYUDA.toLowerCase()) return { tipo: "ayuda" };

  // Slash-commands: /cmd[@bot] [arg]
  const m = low.match(/^\/(nuevo|detener|perfiles|ayuda|estado|start)(?:@\w+)?(?:\s+(.*))?$/);
  if (!m) return null;
  const cmd = m[1];
  const arg = (m[2] ?? "").trim();
  if (cmd === "nuevo") return { tipo: "nuevo", arg: arg.length ? arg : null };
  return { tipo: cmd as "detener" | "perfiles" | "ayuda" | "estado" | "start" };
}

/** Lista numerada de los arquetipos (el número coincide con `resolverPersona`). */
export function listarPerfiles(): string {
  const filas = PERSONAS.map((p, i) => `${i + 1}. ${p.arquetipo}`).join("\n");
  return `Perfiles de práctica:\n${filas}\n\nElige uno con /nuevo <número>, ej: /nuevo 3.`;
}

export const GREETING_TEXT =
  "¡Hola! Soy tu compañero de práctica de ventas. 🟢\n" +
  "Toca 🆕 Nuevo comprador para que un cliente ficticio te escriba; respóndele como lo harías por WhatsApp.\n" +
  "Usa ⏹ Detener para cerrar, 📋 Perfiles para ver los tipos de cliente y ❓ Ayuda cuando la necesites.";

export const AYUDA_TEXT =
  "Así funciona:\n" +
  "🆕 Nuevo comprador — un cliente ficticio te escribe; respóndele normal.\n" +
  "⏹ Detener — cierra la práctica actual (no borra nada).\n" +
  "📋 Perfiles — muestra los tipos de cliente (elige uno con /nuevo 3).";
