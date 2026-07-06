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

export function hasCriteriosRelevantes(s: Solicitud): boolean {
  const forma = s.corte?.forma;
  const peso = s.peso_quilates;
  const pres = s.presupuesto;
  const hayForma = forma != null && forma !== "indiferente";
  const hayPeso = peso != null && (peso.min != null || peso.max != null);
  const hayPres = pres != null && (pres.min != null || pres.max != null) && pres.moneda !== "COP";
  return hayForma || hayPeso || hayPres;
}

/** ¿La piedra cumple LITERALMENTE lo pedido (forma + banda de peso + tope de presupuesto)? */
export function cumpleEstricto(p: Piedra, s: Solicitud): boolean {
  if (!p.disponible) return false;
  const forma = s.corte?.forma;
  const hayForma = forma != null && forma !== "indiferente";
  if (hayForma && p.forma !== forma) return false;
  const peso = s.peso_quilates;
  const hayPeso = peso != null && (peso.min != null || peso.max != null);
  if (hayPeso) {
    const [pMin, pMax] = bandaPeso(peso!.min ?? null, peso!.max ?? null);
    if (!dentro(p.peso_ct, pMin, pMax)) return false;
  }
  const pres = s.presupuesto;
  const hayPres = pres != null && (pres.min != null || pres.max != null) && pres.moneda !== "COP";
  if (hayPres) {
    const [, presMax] = topePresupuesto(pres!.min ?? null, pres!.max ?? null);
    const precio = pres!.base === "total" ? p.precio_usd_ct * p.peso_ct : p.precio_usd_ct;
    if (!dentro(precio, null, presMax)) return false;
  }
  return true;
}

export function hayMatchExacto(piedras: Piedra[], s: Solicitud): boolean {
  if (!hasCriteriosRelevantes(s)) return false;
  return piedras.some((p) => cumpleEstricto(p, s));
}

function penaltyPeso(p: Piedra, s: Solicitud): number {
  const peso = s.peso_quilates;
  if (!peso || (peso.min == null && peso.max == null)) return 0;
  const min = peso.min ?? peso.max!;
  const max = peso.max ?? peso.min!;
  if (p.peso_ct >= min && p.peso_ct <= max) return 0;
  const d = p.peso_ct < min ? min - p.peso_ct : p.peso_ct - max;
  return d / ((min + max) / 2); // distancia relativa al centro pedido
}

function penaltyPres(p: Piedra, s: Solicitud): number {
  const pres = s.presupuesto;
  if (!pres || pres.moneda === "COP") return 0;
  const tope = pres.max ?? pres.min;
  if (tope == null) return 0;
  const precio = pres.base === "total" ? p.precio_usd_ct * p.peso_ct : p.precio_usd_ct;
  if (precio <= tope) return 0; // por debajo del presupuesto no penaliza
  return (precio - tope) / tope; // exceso relativo
}

function penaltyForma(p: Piedra, s: Solicitud): number {
  const forma = s.corte?.forma;
  if (forma == null || forma === "indiferente") return 0;
  return p.forma === forma ? 0 : 0.5;
}

/** Ranking por cercanía: nunca vacío si hay criterios y stock disponible. */
export function rankearPiedras(piedras: Piedra[], s: Solicitud): Piedra[] {
  if (!hasCriteriosRelevantes(s)) return [];
  return piedras
    .filter((p) => p.disponible)
    .map((p) => ({ p, score: penaltyPeso(p, s) + penaltyPres(p, s) + penaltyForma(p, s) }))
    .sort((a, b) => a.score - b.score || a.p.precio_usd_ct - b.p.precio_usd_ct)
    .slice(0, 3)
    .map((x) => x.p);
}

/** Trae el stock disponible y devuelve las piedras más cercanas + si hubo match exacto. */
export async function matchInventory(
  db: DbClient,
  solicitud: Solicitud
): Promise<{ piedras: Piedra[]; hayExactas: boolean }> {
  const { data, error } = await db.from("inventario").select("*").eq("disponible", true);
  if (error) throw error;
  // Supabase devuelve columnas numeric como string; coercionar a number en el borde.
  const piedras = (data ?? []).map((r: any) => ({
    ...r,
    peso_ct: Number(r.peso_ct),
    precio_usd_ct: Number(r.precio_usd_ct),
    cantidad_piedras: Number(r.cantidad_piedras),
  })) as Piedra[];
  return { piedras: rankearPiedras(piedras, solicitud), hayExactas: hayMatchExacto(piedras, solicitud) };
}
