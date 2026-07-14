import type { Persona } from "./types.js";

export const PERSONAS: Persona[] = [
  {
    key: "inversionista",
    arquetipo: "Compra para valorización patrimonial",
    objetivo: "Saber si la esmeralda se revaloriza y cerrar el mejor precio por una pieza de 1-2 ct",
    presupuesto: "hasta 8.000 USD",
    nivelConocimiento: "medio: entiende inversión pero no gemología",
    primerMensaje: "Hola, estoy buscando una esmeralda de 1 a 2 ct como inversión. ¿Tienes algo interesante?",
    objeciones: ["¿esto se revaloriza con el tiempo?", "¿cuál es el mejor precio que me das?", "¿por cuánto sale la pieza total montada?"],
    idioma: "es",
  },
  {
    key: "novata_anillo",
    arquetipo: "Anillo de compromiso, sabe poco",
    objetivo: "Que la asesoren sobre qué piedra le queda bien para un anillo, pidiendo fotos",
    presupuesto: "no lo tiene claro, medio",
    nivelConocimiento: "bajo: no sabe qué son los quilates",
    primerMensaje: "Hola, quiero comprar una esmeralda para un anillo pero no sé cuál me quedaría mejor. ¿Me ayudas?",
    objeciones: ["no sé qué me quedaría bien en la mano", "¿qué son los quilates? no entiendo bien eso", "¿me puedes mostrar fotos?"],
    idioma: "es",
  },
  {
    key: "cazador_ganga",
    arquetipo: "Presupuesto duro, regatea",
    objetivo: "Conseguir una colombiana de 5-6 ct por 2000 USD, presionando el precio",
    presupuesto: "2.000 USD, firme",
    nivelConocimiento: "bajo-medio",
    primerMensaje: "Buenas, busco una esmeralda colombiana de unos 5 a 6 quilates. Mi presupuesto es 2000 USD, ¿qué tienes?",
    objeciones: ["está muy caro para lo que busco", "solo tengo 2000 USD, no más", "¿me puedes hacer un descuento?"],
    idioma: "es",
  },
  {
    key: "tecnico",
    arquetipo: "Pregunta datos duros de gemología",
    objetivo: "Extraer detalles técnicos: tratamiento, origen, certificado, jardín",
    presupuesto: "flexible si la calidad convence",
    nivelConocimiento: "alto: conoce terminología gemológica",
    primerMensaje: "Hola, me interesa una esmeralda de buena calidad. ¿Qué tratamiento tienen tus piedras y de qué mina vienen?",
    objeciones: ["¿el tratamiento es menor o significativo?", "¿es Muzo o Coscuez? ¿cómo lo garantizas?", "¿viene con certificado gemológico?"],
    idioma: "es",
  },
  {
    key: "turista_en",
    arquetipo: "Comprador extranjero en inglés",
    objetivo: "Comprar una esmeralda colombiana y saber si es natural y si hacen envío",
    presupuesto: "up to 5,000 USD",
    nivelConocimiento: "medio",
    primerMensaje: "Hi! I'm looking for a natural Colombian emerald, around 2 carats. What do you have available?",
    objeciones: ["is it a natural stone or treated?", "can you ship internationally?", "does it come with a certificate?"],
    idioma: "en",
  },
  {
    key: "apurado_cierre",
    arquetipo: "Quiere comprar ya",
    objetivo: "Presionar hacia el cierre para ver cómo maneja pago/logística el dueño",
    presupuesto: "listo para pagar hoy",
    nivelConocimiento: "medio",
    primerMensaje: "Hola, ya me decidí, quiero comprar una esmeralda hoy mismo. ¿Cómo hacemos?",
    objeciones: ["quiero pagar ya, ¿cómo te transfiero?", "¿me la puedes guardar mientras pago?", "¿en cuánto tiempo me llega?"],
    idioma: "es",
  },
];

export function getPersona(key: string): Persona {
  const p = PERSONAS.find((x) => x.key === key);
  if (!p) throw new Error(`Persona desconocida: ${key}. Opciones: ${PERSONAS.map((x) => x.key).join(", ")}`);
  return p;
}

/** Resuelve el argumento de `/nuevo`: número 1-N (posición en PERSONAS) o key exacta. `null` si no resuelve. */
export function resolverPersona(arg: string): Persona | null {
  const n = Number(arg);
  if (Number.isInteger(n) && n >= 1 && n <= PERSONAS.length) return PERSONAS[n - 1];
  return PERSONAS.find((p) => p.key === arg) ?? null;
}

/**
 * Elige el perfil menos usado dado el conteo de conversaciones por persona.
 * Perfiles sin conversaciones cuentan 0. Empates se rompen por el orden de PERSONAS.
 */
export function elegirPersonaMenosUsada(counts: { persona_key: string; count: number }[]): string {
  const byKey = new Map(counts.map((c) => [c.persona_key, c.count]));
  let mejor = PERSONAS[0];
  let mejorCount = byKey.get(mejor.key) ?? 0;
  for (const p of PERSONAS) {
    const c = byKey.get(p.key) ?? 0;
    if (c < mejorCount) { mejor = p; mejorCount = c; }
  }
  return mejor.key;
}
