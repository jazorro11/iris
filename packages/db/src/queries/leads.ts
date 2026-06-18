import type { DbClient } from "../client.js";
import type { Solicitud, LeadRow, EstadoLead, Lead } from "@iris/types";

export function buildLeadRow(input: {
  telegramUserId: number;
  telegramUsername?: string | null;
  solicitud: Solicitud;
  estado: EstadoLead;
  camposFaltantes: string[];
}): LeadRow {
  return {
    telegram_user_id: input.telegramUserId,
    telegram_username: input.telegramUsername ?? null,
    estado: input.estado,
    campos_faltantes: input.camposFaltantes,
    solicitud: input.solicitud,
    proposito: input.solicitud.proposito ?? null,
    tipo_pieza: input.solicitud.tipo_pieza ?? null,
    origen_pais: input.solicitud.origen?.pais ?? null,
  };
}

export async function upsertLead(db: DbClient, row: LeadRow): Promise<{ id: string }> {
  const { data, error } = await db
    .from("leads")
    .upsert({ ...row, updated_at: new Date().toISOString() }, { onConflict: "telegram_user_id" })
    .select("id")
    .single();
  if (error) throw error;
  if (!data) throw new Error("upsertLead: no se devolvió ninguna fila");
  return data as { id: string };
}

export async function getLead(db: DbClient, telegramUserId: number): Promise<Lead | null> {
  const { data, error } = await db
    .from("leads")
    .select("*")
    .eq("telegram_user_id", telegramUserId)
    .maybeSingle();
  if (error) throw error;
  return (data as Lead | null);
}

export async function addLeadMessage(
  db: DbClient,
  telegramUserId: number,
  rol: "comprador" | "agente",
  texto: string
): Promise<void> {
  const { error } = await db
    .from("lead_messages")
    .insert({ telegram_user_id: telegramUserId, rol, texto });
  if (error) throw error;
}
