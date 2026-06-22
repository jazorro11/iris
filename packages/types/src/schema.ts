import { z } from "zod";

export const PresupuestoSchema = z.object({
  min: z.number().nullable().optional(),
  max: z.number().nullable().optional(),
  moneda: z.enum(["USD", "COP"]).nullable().optional(),
  base: z.enum(["total", "por_quilate"]).nullable().optional(),
});

export const ColorSchema = z.object({
  tono: z.enum(["verde", "verde_azulado", "indiferente"]).nullable().optional(),
  saturacion: z.enum(["vivida", "media", "clara", "oscura"]).nullable().optional(),
  descripcion_libre: z.string().nullable().optional(),
});

export const CorteSchema = z.object({
  forma: z.enum(["corte_esmeralda", "oval", "cojin", "gota", "redondo", "otro", "indiferente"]).nullable().optional(),
  calidad: z.enum(["alta", "media", "indiferente"]).nullable().optional(),
});

export const OrigenSchema = z.object({
  pais: z.enum(["colombia", "zambia", "brasil", "afganistan_pakistan", "otro", "indiferente"]).nullable().optional(),
  mina_zona: z.string().nullable().optional(),
});

export const PesoSchema = z.object({
  min: z.number().nullable().optional(),
  max: z.number().nullable().optional(),
});

export const SolicitudSchema = z.object({
  // B. Intención comercial
  tipo_solicitud: z.enum(["compra", "cotizacion", "exploracion"]).nullable().optional(),
  proposito: z.enum(["joyeria", "coleccion", "inversion_patrimonio", "regalo", "reventa", "desconocido"]).nullable().optional(),
  presupuesto: PresupuestoSchema.nullable().optional(),
  cantidad_piezas: z.number().nullable().optional(),
  urgencia: z.enum(["inmediato", "semanas", "sin_prisa"]).nullable().optional(),
  requiere_certificado: z.boolean().nullable().optional(),
  laboratorio_preferido: z.enum(["GIA", "Gubelin", "SSEF", "AGL", "Guild", "otro"]).nullable().optional(),
  // C. Especificación de la piedra
  tipo_pieza: z.enum(["gema_tallada", "cristal_bruto", "joya_terminada", "especimen_mineral"]).nullable().optional(),
  peso_quilates: PesoSchema.nullable().optional(),
  color: ColorSchema.nullable().optional(),
  claridad: z.enum(["limpia", "inclusiones_aceptables", "jardin_aceptable", "indiferente"]).nullable().optional(),
  corte: CorteSchema.nullable().optional(),
  origen: OrigenSchema.nullable().optional(),
  tratamiento_max_aceptable: z.enum(["sin_tratamiento", "insignificante", "menor", "moderado", "significativo", "indiferente"]).nullable().optional(),
  caracteristicas_especiales: z.array(z.enum(["trapiche", "macla", "canutillo", "doble_terminacion", "matriz"])).nullable().optional(),
});

export type Solicitud = z.infer<typeof SolicitudSchema>;

export const CAMPOS_CRITICOS = [
  "proposito", "presupuesto", "tipo_pieza", "peso_quilates", "color", "origen",
] as const;

export type CampoCritico = (typeof CAMPOS_CRITICOS)[number];
