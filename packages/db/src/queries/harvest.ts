import type { DbClient } from "../client.js";

export interface DatasetRecord {
  conversationId: string; personaKey: string; turno: number;
  mensajeComprador: string; respuestaDueno: string; contextoPrevio: string;
  veta: "precio" | "objecion" | "producto" | "tono" | "otro"; notasExtraccion: string;
}

export function buildConversacionRow(personaKey: string, ownerChatId: number) {
  return { persona_key: personaKey, estado: "activa" as const, turno_actual: 0, owner_chat_id: ownerChatId };
}

export async function crearConversacion(db: DbClient, personaKey: string, ownerChatId: number): Promise<{ id: string }> {
  const { data, error } = await db
    .from("harvest_conversations")
    .insert(buildConversacionRow(personaKey, ownerChatId))
    .select("id")
    .single();
  if (error) throw error;
  return data as { id: string };
}

export async function getConversacionActiva(
  db: DbClient
): Promise<{ id: string; persona_key: string; turno_actual: number } | null> {
  const { data, error } = await db
    .from("harvest_conversations")
    .select("id, persona_key, turno_actual")
    .eq("estado", "activa")
    .maybeSingle();
  if (error) throw error;
  return (data as { id: string; persona_key: string; turno_actual: number } | null) ?? null;
}

export async function addHarvestMessage(
  db: DbClient, conversationId: string, rol: "comprador" | "dueño", texto: string, turno: number
): Promise<void> {
  const { error } = await db.from("harvest_messages").insert({ conversation_id: conversationId, rol, texto, turno });
  if (error) throw error;
}

export async function getHarvestMessages(
  db: DbClient, conversationId: string
): Promise<{ rol: "comprador" | "dueño"; texto: string }[]> {
  const { data, error } = await db
    .from("harvest_messages")
    .select("rol, texto")
    .eq("conversation_id", conversationId)
    .order("created_at", { ascending: true });
  if (error) throw error;
  return (data ?? []) as { rol: "comprador" | "dueño"; texto: string }[];
}

export async function guardarDatasetRecord(db: DbClient, rec: DatasetRecord, langfuseItemId: string | null): Promise<void> {
  const { error } = await db.from("harvest_dataset").insert({
    conversation_id: rec.conversationId, persona_key: rec.personaKey, turno: rec.turno,
    mensaje_comprador: rec.mensajeComprador, respuesta_dueno: rec.respuestaDueno,
    contexto_previo: rec.contextoPrevio, veta: rec.veta, notas_extraccion: rec.notasExtraccion,
    langfuse_dataset_item_id: langfuseItemId,
  });
  if (error) throw error;
}

export async function cerrarConversacion(
  db: DbClient, id: string, estado: "terminada" | "detenida", motivo: string
): Promise<void> {
  const { error } = await db
    .from("harvest_conversations")
    .update({ estado, motivo_fin: motivo, updated_at: new Date().toISOString() })
    .eq("id", id);
  if (error) throw error;
}

export async function bumpTurno(db: DbClient, id: string, turno: number): Promise<void> {
  const { error } = await db
    .from("harvest_conversations")
    .update({ turno_actual: turno, updated_at: new Date().toISOString() })
    .eq("id", id);
  if (error) throw error;
}

export async function marcarTodasDetenidas(db: DbClient, motivo: string): Promise<number> {
  const { data, error } = await db
    .from("harvest_conversations")
    .update({ estado: "detenida", motivo_fin: motivo, updated_at: new Date().toISOString() })
    .eq("estado", "activa")
    .select("id");
  if (error) throw error;
  return (data ?? []).length;
}

/** Devuelve true si el update_id ya había sido visto (procesar y salir). */
export async function updateYaVisto(db: DbClient, updateId: number): Promise<boolean> {
  const { error } = await db.from("harvest_updates_vistos").insert({ update_id: updateId });
  if (error) {
    if ((error as { code?: string }).code === "23505") return true; // unique_violation
    throw error;
  }
  return false;
}
