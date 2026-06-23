import type { DbClient } from "../client.js";
import type { Piedra, Solicitud } from "@iris/types";

const dentro = (v: number, min?: number | null, max?: number | null): boolean =>
  (min == null || v >= min) && (max == null || v <= max);

/** Filtra el stock contra la solicitud. Solo usa forma + peso + precio/ct.
 * Devuelve [] si el comprador no dio ninguno de esos tres criterios. */
export function filtrarPiedras(piedras: Piedra[], s: Solicitud): Piedra[] {
  const forma = s.corte?.forma;
  const peso = s.peso_quilates;
  const pres = s.presupuesto;
  const hayForma = forma != null && forma !== "indiferente";
  const hayPeso = peso != null && (peso.min != null || peso.max != null);
  const hayPres = pres != null && (pres.min != null || pres.max != null);
  if (!hayForma && !hayPeso && !hayPres) return [];

  return piedras
    .filter((p) => p.disponible)
    .filter((p) => !hayForma || p.forma === forma)
    .filter((p) => !hayPeso || dentro(p.peso_ct, peso!.min, peso!.max))
    .filter((p) => {
      if (!hayPres) return true;
      // ponytail: base ausente → por_quilate (los precios del inventario son por quilate)
      if (pres!.base === "total") return dentro(p.precio_usd_ct * p.peso_ct, pres!.min, pres!.max);
      return dentro(p.precio_usd_ct, pres!.min, pres!.max);
    })
    .sort((a, b) => a.precio_usd_ct - b.precio_usd_ct)
    .slice(0, 3);
}

/** Trae el stock disponible y lo filtra contra la solicitud. */
export async function matchInventory(db: DbClient, solicitud: Solicitud): Promise<Piedra[]> {
  const { data, error } = await db.from("inventario").select("*").eq("disponible", true);
  if (error) throw error;
  return filtrarPiedras((data ?? []) as Piedra[], solicitud);
}
