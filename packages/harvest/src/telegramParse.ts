export interface HarvestOwnerMessage {
  respuestaDueno: string;
  fotoFileId: string | null;
}

/** Interpreta el mensaje del dueño (texto, foto+caption, o foto sola). Devuelve null si no hay nada procesable. */
export function parseHarvestMessage(message: {
  text?: string;
  caption?: string;
  photo?: { file_id: string }[];
}): HarvestOwnerMessage | null {
  const text = message.text?.trim();
  const caption = message.caption?.trim();
  const photo = message.photo;
  // Telegram envía varios tamaños; el último es el de mayor resolución.
  const fotoFileId = photo && photo.length ? photo[photo.length - 1].file_id : null;
  if (text) return { respuestaDueno: text, fotoFileId };
  if (fotoFileId) return { respuestaDueno: caption ? `[foto] ${caption}` : "[foto sin texto]", fotoFileId };
  if (caption) return { respuestaDueno: caption, fotoFileId: null };
  return null;
}
