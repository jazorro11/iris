import type { Solicitud, CampoCritico, EstadoLead } from "@iris/types";

export const MAX_RONDAS = 4;

function clean<T extends object>(o: T): Partial<T> {
  const r: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(o)) {
    if (v !== undefined && v !== null) r[k] = v;
  }
  return r as Partial<T>;
}

const SCALAR_KEYS: (keyof Solicitud)[] = [
  "tipo_solicitud", "proposito", "cantidad_piezas", "urgencia",
  "requiere_certificado", "laboratorio_preferido", "tipo_pieza",
  "claridad", "tratamiento_max_aceptable",
];

/** Combina una extracción parcial sobre el estado previo, sin pisar datos ya capturados. */
export function mergeRequest(prior: Solicitud, partial: Solicitud): Solicitud {
  const out: Solicitud = { ...prior };
  for (const k of SCALAR_KEYS) {
    const v = partial[k];
    if (v !== undefined && v !== null) (out as Record<string, unknown>)[k] = v;
  }
  if (partial.presupuesto) out.presupuesto = { ...prior.presupuesto, ...clean(partial.presupuesto) };
  if (partial.peso_quilates) out.peso_quilates = { ...prior.peso_quilates, ...clean(partial.peso_quilates) };
  if (partial.color) out.color = { ...prior.color, ...clean(partial.color) };
  if (partial.corte) out.corte = { ...prior.corte, ...clean(partial.corte) };
  if (partial.origen) out.origen = { ...prior.origen, ...clean(partial.origen) };
  if (partial.caracteristicas_especiales?.length) {
    out.caracteristicas_especiales = Array.from(
      new Set([...(prior.caracteristicas_especiales ?? []), ...partial.caracteristicas_especiales])
    );
  }
  return out;
}

/** Campos críticos ausentes, en orden de prioridad. */
export function missingCriticalFields(s: Solicitud): CampoCritico[] {
  const out: CampoCritico[] = [];
  if (!s.proposito || s.proposito === "desconocido") out.push("proposito");
  if (!s.presupuesto || (s.presupuesto.min == null && s.presupuesto.max == null)) out.push("presupuesto");
  if (!s.tipo_pieza) out.push("tipo_pieza");
  if (!s.peso_quilates || (s.peso_quilates.min == null && s.peso_quilates.max == null)) out.push("peso_quilates");
  if (!s.color || !s.color.tono) out.push("color");
  if (!s.origen || !s.origen.pais) out.push("origen");
  return out;
}

export function isComplete(s: Solicitud): boolean {
  return missingCriticalFields(s).length === 0;
}

export function evaluarEstado(s: Solicitud): { estado: EstadoLead; camposFaltantes: CampoCritico[] } {
  const camposFaltantes = missingCriticalFields(s);
  return {
    estado: camposFaltantes.length === 0 ? "completo" : "en_aclaracion",
    camposFaltantes,
  };
}
