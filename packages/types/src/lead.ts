import type { Solicitud } from "./schema.js";

export type EstadoLead = "incompleto" | "completo" | "en_aclaracion";

/** Forma de inserción/upsert en la tabla `leads`. */
export interface LeadRow {
  telegram_user_id: number;
  telegram_username: string | null;
  estado: EstadoLead;
  campos_faltantes: string[];
  solicitud: Solicitud;
  proposito: Solicitud["proposito"] | null;
  tipo_pieza: Solicitud["tipo_pieza"] | null;
  origen_pais: NonNullable<Solicitud["origen"]>["pais"] | null;
}

/** Fila leída de `leads` (incluye columnas generadas por la BD). */
export interface Lead extends LeadRow {
  id: string;
  created_at: string;
  updated_at: string;
}
