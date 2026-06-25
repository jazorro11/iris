# Iris — Capa de voz humana

**Fecha:** 2026-06-24
**Estado:** Aprobado (diseño)
**Branch:** `test/harness-recomendacion`

## Problema

En las pruebas reales, Iris (agente de venta de esmeraldas de Méraldi) se siente
"poco humana": responde como un formulario, no como una asesora. Síntomas
observados en la transcripción del 24-Jun-26:

- No acusa recibo de lo que el cliente acaba de decir. El cliente dijo "para
  joyería, ~3000 USD, sin preferencia de color" e Iris disparó la siguiente
  viñeta sin reconocer nada.
- Repite el encabezado robótico `"Para ayudarte mejor, cuéntame:"` + viñetas en
  cada turno.
- El cierre es una frase enlatada y no reacciona al contexto (había una piedra de
  ~9 ct cerca del presupuesto del cliente y Iris no la conectó).

### Causa raíz

El agente es **casi 100% determinístico**. El LLM (gpt-4o-mini, temp 0.1) se usa
*solo* en el nodo `extractor` para parsear el mensaje del cliente a JSON. Todo lo
que el cliente *lee* —preguntas, propuesta de piedras, cierre— son **plantillas
hardcodeadas** (`packages/agent/src/questions.ts`, `packages/agent/src/graph.ts`).
De ahí el tono de formulario.

## Objetivo

Hacer que el flujo se sienta como una conversación real, **sin sacrificar** la
fiabilidad del cerebro determinístico (extracción de datos, decisión de preguntar
vs. cerrar, match de inventario, captura de leads).

## Decisiones de diseño (acordadas)

1. **Enfoque: capa de voz.** Mantener el cerebro determinístico intacto y añadir
   un nodo LLM "redactor" que convierte el estado en prosa natural. (Descartado:
   reescribir como agente conversacional completo con tools — pierde determinismo
   y arriesga regresiones; descartado: solo mejorar plantillas — techo bajo.)
2. **Cadencia: 1-2 datos en prosa.** El validador decide *qué* falta; el redactor
   pide solo lo más relevante (1, máximo 2) dentro de una frase, nunca en viñetas,
   y acusa recibo antes de preguntar.
3. **Piedras: tono asesora.** Cuando hay match, Iris conecta la piedra que mejor
   encaja con lo que dijo el cliente ("la cuadrada de 9 ct entra justo en tu
   rango"), usando solo datos reales del match. Nunca inventa precios/piedras.

## Arquitectura

El cerebro determinístico **no se toca**. Los nodos `preguntar` y `persistir`
siguen haciendo todo su trabajo determinístico, pero en vez de formatear el
mensaje con plantillas, ensamblan un **brief de hechos** y lo pasan a un nuevo
nodo redactor `deps.compose(brief)` que devuelve la prosa.

```
[extractor] → [validador] → route()
                              ├─ "preguntar" → arma brief(aclarar) → compose() → reply
                              └─ "persistir" → guarda+notifica → brief(cerrar) → compose() → reply
```

### El brief (única fuente de hechos del redactor)

```ts
type ComposeBrief = {
  intent: "aclarar" | "cerrar";
  userMessage: string;          // lo último que dijo el cliente → para acusar recibo
  known: Partial<Solicitud>;    // lo ya capturado → "perfecto, joyería y ~3000 USD"
  missing: CampoCritico[];      // faltantes priorizados; el redactor pide 1-2
  stones: PiedraMatch[];        // matches reales {nombre, peso, precioUsdCt, url}; puede ir vacío
  cierre?: "completo" | "incompleto";
};
```

El redactor **nunca decide** qué falta, qué piedras hay, ni si cerrar — eso ya
viene resuelto y verificado por el cerebro. Solo elige *cómo decirlo* y *cuáles
1-2 datos* pedir de `missing`.

## El redactor

Nuevo módulo `packages/agent/src/composer.ts`, con su propia instancia de modelo,
separada del extractor:

- **Extractor:** sin cambios (gpt-4o-mini, temp 0.1, structured output).
- **Redactor:** gpt-4o-mini, temp ~0.6, texto libre (no structured output).

### System prompt del redactor

```
Eres Iris, asesora de Méraldi, casa de esmeraldas colombianas. Hablas por chat
con un comprador, como lo haría una asesora real: cálida, cercana y breve.

Recibes un BRIEF con hechos verificados. Tu única tarea es redactar el siguiente
mensaje de Iris usando EXCLUSIVAMENTE esos hechos.

Cómo conversas:
- Primero acusa recibo de lo que el cliente acaba de decir (known/userMessage),
  con naturalidad, sin repetírselo como loro.
- Si intent="aclarar": pide solo 1 dato (máximo 2) de `missing`, el más relevante,
  dentro de una frase fluida. NUNCA en lista de viñetas. NUNCA el encabezado
  "Para ayudarte mejor, cuéntame". Varía el fraseo en cada turno.
- Si hay `stones`: menciona la que mejor encaja conectándola con lo que el cliente
  dijo (p. ej. presupuesto/peso), como recomendación de asesora. Usa solo nombre,
  peso y precio TAL CUAL vienen en el brief.
- Si intent="cerrar": agradece y avísale que un asesor de Méraldi lo contactará.
  Si cierre="incompleto", dilo de forma natural (faltan detalles por afinar).

Prohibido:
- Inventar piedras, precios, orígenes, quilates o datos que no estén en el brief.
- Prometer tiempos, descuentos o disponibilidad concretos.
- Pedir datos que ya están en `known`.
- Sonar a formulario. Máximo ~3-4 frases.

Responde solo con el mensaje para el cliente, en español, sin comillas.
```

### Formato de piedras

Hoy se duplica feo:
`Lote 4 esmeraldas 8.82 ct - 1.500 usd-ct (8.82 ct, 1500 USD/ct)`. El brief pasa
los campos limpios y el redactor los teje en prosa, eliminando la duplicación. Se
mantiene mostrar precio en USD/ct (comportamiento actual).

## Confiabilidad: fallback

El redactor es no-determinístico y depende de un LLM externo. Si `compose()` lanza
error o no hay API key, el nodo **cae automáticamente a las plantillas actuales**
(`buildClarificationMessage` / cierre hardcodeado). Las plantillas no se borran:
pasan a ser la red de seguridad. El sistema nunca se rompe por el redactor.

## Testing

1. **Brief-builder = función pura, test determinístico.** `state → ComposeBrief`.
   Aquí se esconderían las regresiones (qué falta, qué piedras, intent, known).
   Asserts exactos.
2. **Tests del grafo con `compose` falso.** Inyectar un `deps.compose` falso
   (mismo patrón de inyección que `extract`/`matchInventory`/`saveLead`). La
   lógica del grafo sigue 100% testeable sin tocar el LLM; verifica que `compose`
   se llama con el brief correcto.
3. **Test del fallback.** `deps.compose` que lanza → confirmar que el reply cae a
   la plantilla y el lead igual se guarda.
4. **Eval de tono (manual, ligero).** Casos "golden" (incluida la transcripción de
   prueba) contra el redactor real para revisar voz. No bloqueante en CI.

## Alcance

**Archivos a tocar:**

- `packages/agent/src/composer.ts` (nuevo) — modelo + prompt + `compose()`
- `packages/agent/src/brief.ts` (nuevo) — builder puro `state → ComposeBrief`
- `packages/agent/src/graph.ts` — `preguntar`/`persistir` arman brief y llaman
  `compose`, con fallback a plantillas
- `packages/types` — tipo `ComposeBrief`
- `packages/agent/src/questions.ts` / templates — se conservan como fallback
- Tests nuevos: brief-builder, grafo con compose falso, fallback

**Fuera de alcance (YAGNI):** extractor, match de inventario, `route()`,
`MAX_RONDAS`, esquema de datos, memoria conversacional nueva, cambio de modelo a
uno más caro.
