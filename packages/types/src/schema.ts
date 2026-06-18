import { z } from "zod";

export const PresupuestoSchema = z.object({
  min: z.number().optional(),
  max: z.number().optional(),
  moneda: z.enum(["USD", "COP"]).optional(),
  base: z.enum(["total", "por_quilate"]).optional(),
});

export const ColorSchema = z.object({
  tono: z.enum(["verde", "verde_azulado", "indiferente"]).optional(),
  saturacion: z.enum(["vivida", "media", "clara", "oscura"]).optional(),
  descripcion_libre: z.string().optional(),
});

export const CorteSchema = z.object({
  forma: z.enum(["corte_esmeralda", "oval", "cojin", "gota", "redondo", "otro", "indiferente"]).optional(),
  calidad: z.enum(["alta", "media", "indiferente"]).optional(),
});

export const OrigenSchema = z.object({
  pais: z.enum(["colombia", "zambia", "brasil", "afganistan_pakistan", "otro", "indiferente"]).optional(),
  mina_zona: z.string().optional(),
});

export const PesoSchema = z.object({
  min: z.number().optional(),
  max: z.number().optional(),
});

export const SolicitudSchema = z.object({
  // B. Intención comercial
  tipo_solicitud: z.enum(["compra", "cotizacion", "exploracion"]).optional(),
  proposito: z.enum(["joyeria", "coleccion", "inversion_patrimonio", "regalo", "reventa", "desconocido"]).optional(),
  presupuesto: PresupuestoSchema.optional(),
  cantidad_piezas: z.number().optional(),
  urgencia: z.enum(["inmediato", "semanas", "sin_prisa"]).optional(),
  requiere_certificado: z.boolean().optional(),
  laboratorio_preferido: z.enum(["GIA", "Gubelin", "SSEF", "AGL", "Guild", "otro"]).optional(),
  // C. Especificación de la piedra
  tipo_pieza: z.enum(["gema_tallada", "cristal_bruto", "joya_terminada", "especimen_mineral"]).optional(),
  peso_quilates: PesoSchema.optional(),
  color: ColorSchema.optional(),
  claridad: z.enum(["limpia", "inclusiones_aceptables", "jardin_aceptable", "indiferente"]).optional(),
  corte: CorteSchema.optional(),
  origen: OrigenSchema.optional(),
  tratamiento_max_aceptable: z.enum(["sin_tratamiento", "insignificante", "menor", "moderado", "significativo", "indiferente"]).optional(),
  caracteristicas_especiales: z.array(z.enum(["trapiche", "macla", "canutillo", "doble_terminacion", "matriz"])).optional(),
});

export type Solicitud = z.infer<typeof SolicitudSchema>;

export const CAMPOS_CRITICOS = [
  "proposito", "presupuesto", "tipo_pieza", "peso_quilates", "color", "origen",
] as const;

export type CampoCritico = (typeof CAMPOS_CRITICOS)[number];
