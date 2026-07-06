import type { DbClient } from "../client.js";
import type { Piedra, Solicitud } from "@iris/types";

const dentro = (v: number, min?: number | null, max?: number | null): boolean =>
  (min == null || v >= min) && (max == null || v <= max);

/** Un comprador que da un solo número de peso ("10 ct") llega como min==max.
 * Con intervalo cerrado eso exige el valor exacto y no casa con pesos continuos:
 * expandir el punto a una banda ±15%. */
function bandaPeso(min: number | null, max: number | null): [number | null, number | null] {
  if (min != null && max != null && min === max) return [min * 0.85, max * 1.15];
  return [min, max];
}

/** Un presupuesto de un solo valor ("2000 USD") llega como min==max; se interpreta
 * como tope (máximo), no como precio exacto. */
function topePresupuesto(min: number | null, max: number | null): [number | null, number | null] {
  if (min != null && max != null && min === max) return [null, max];
  return [min, max];
}

/** Filtra el stock contra la solicitud. Solo usa forma + peso + precio/ct.
 * Devuelve [] si el comprador no dio ninguno de esos tres criterios. */
export function filtrarPiedras(piedras: Piedra[], s: Solicitud): Piedra[] {
  const forma = s.corte?.forma;
  const peso = s.peso_quilates;
  const pres = s.presupuesto;
  const hayForma = forma != null && forma !== "indiferente";
  const hayPeso = peso != null && (peso.min != null || peso.max != null);
  // ponytail: presupuesto en COP no es comparable con precios USD/ct → se omite el filtro de precio
  const hayPres = pres != null && (pres.min != null || pres.max != null) && pres.moneda !== "COP";
  if (!hayForma && !hayPeso && !hayPres) return [];

  const [pesoMin, pesoMax] = bandaPeso(peso?.min ?? null, peso?.max ?? null);
  const [presMin, presMax] = topePresupuesto(pres?.min ?? null, pres?.max ?? null);

  return piedras
    .filter((p) => p.disponible)
    .filter((p) => !hayForma || p.forma === forma)
    .filter((p) => !hayPeso || dentro(p.peso_ct, pesoMin, pesoMax))
    .filter((p) => {
      if (!hayPres) return true;
      // ponytail: base ausente → por_quilate (los precios del inventario son por quilate)
      if (pres!.base === "total") return dentro(p.precio_usd_ct * p.peso_ct, presMin, presMax);
      return dentro(p.precio_usd_ct, presMin, presMax);
    })
    .sort((a, b) => a.precio_usd_ct - b.precio_usd_ct)
    .slice(0, 3);
}

/** Un typo al pegar el link a mano en el Table Editor (p. ej. host truncado
 * `https://driid=...`) produce una URL que Telegram no puede descargar y el envío
 * falla en silencio. Normalizar a null cualquier valor que no sea una URL http(s)
 * con host real, para que el brief/envío la traten como "sin foto". */
/** Formatos que Telegram NO renderiza vía sendPhoto (fallan con "failed to get
 * HTTP URL content"). HEIC/HEIF es el caso real de las fotos de iPhone. */
const FORMATOS_NO_SOPORTADOS = /\.(heic|heif)$/i;

export function normalizeMediaUrl(v: unknown): string | null {
  if (typeof v !== "string" || !v.trim()) return null;
  const s = v.trim();
  try {
    const u = new URL(s);
    if (u.protocol !== "http:" && u.protocol !== "https:") return null;
    if (!u.hostname.includes(".")) return null; // host mutilado por copy-paste
    if (FORMATOS_NO_SOPORTADOS.test(u.pathname)) return null; // Telegram no lo muestra
    return s;
  } catch {
    return null;
  }
}

/** Trae el stock disponible y lo filtra contra la solicitud. */
export async function matchInventory(db: DbClient, solicitud: Solicitud): Promise<Piedra[]> {
  const { data, error } = await db.from("inventario").select("*").eq("disponible", true);
  if (error) throw error;
  // Supabase devuelve columnas numeric como string; coercionar a number en el borde.
  const piedras = (data ?? []).map((r: any) => ({
    ...r,
    peso_ct: Number(r.peso_ct),
    precio_usd_ct: Number(r.precio_usd_ct),
    cantidad_piedras: Number(r.cantidad_piedras),
    media_url: normalizeMediaUrl(r.media_url),
  })) as Piedra[];
  return filtrarPiedras(piedras, solicitud);
}
