/** Comando de Telegram reconocido por el bot. */
export type Command = { name: "olvidar"; confirm: boolean };

/**
 * Detecta comandos en el texto de un mensaje.
 *
 * Soporta el sufijo `@NombreDelBot` que Telegram añade en grupos
 * (ej: `/olvidar@iris_bot confirmar`).
 *
 * Devuelve `null` si el texto no es un comando conocido.
 */
export function parseCommand(text: string): Command | null {
  const m = text.trim().toLowerCase().match(/^\/olvidar(?:@\w+)?(?:\s+(.*))?$/);
  if (!m) return null;
  const arg = (m[1] ?? "").trim();
  return { name: "olvidar", confirm: arg === "confirmar" };
}
