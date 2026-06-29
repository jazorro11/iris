/** Forma del corte de una piedra en inventario.
 * Mismo dominio que `corte.forma` del comprador, sin `indiferente`. */
export type PiedraForma =
  | "corte_esmeralda"
  | "oval"
  | "cojin"
  | "gota"
  | "redondo"
  | "otro";

/** Una fila de la tabla `inventario`. */
export interface Piedra {
  id: string;
  nombre: string;
  forma: PiedraForma;
  peso_ct: number;
  precio_usd_ct: number;
  cantidad_piedras: number;
  media_url: string | null;
  disponible: boolean;
  notas: string | null;
  /** Atributos técnicos opcionales (presentación; el match no los usa aún). */
  color?: string | null;
  origen?: string | null;
  claridad?: string | null;
  tratamiento?: string | null;
}
