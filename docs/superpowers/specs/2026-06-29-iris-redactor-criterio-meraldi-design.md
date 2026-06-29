# Diseño — Iris: redactor con criterio Méraldi

**Fecha:** 2026-06-29
**Autor:** Julio (kausai.ai) con Claude Code
**Estado:** Aprobado para planificación

## 1. Propósito

Convertir la capa conversacional de Iris de un **llenador de formularios que deriva**
("un asesor de Méraldi se pondrá en contacto contigo") en una **asesora que educa,
responde, presenta la piedra con riqueza técnica creciente y avanza al cierre con
naturalidad** — anclada en la *Guía Méraldi de Esmeraldas Colombianas*, sin muletillas
ni forcejeos.

**Restricción dura:** el "cerebro" determinista (extractor → validador → match) queda
**intacto**. Toda la mejora se concentra en la capa del redactor (composer). Esto sigue
el patrón ya validado en la sesión de voz humana (2026-06-24): la suite existente
(`graph.test.ts`) no se toca y pasa a probar el camino de fallback = no-regresión
demostrada.

## 2. Motivación — fallos observados (conversaciones reales)

Tres conversaciones de producción (Telegram) evidencian el problema:

| Síntoma | Causa raíz en el código |
| --- | --- |
| "¿Qué son quilates?" → no lo explica, deriva a "asesor" | No existe base de conocimiento técnico que el redactor pueda usar para educar. |
| "¿Se va a valorizar?" → evade | Sin la guía, no tiene la postura de marca (patrimonio tangible, sin promesas de rentabilidad). |
| "¿Otras opciones?" → repite la misma piedra | El brief presenta solo la mejor; no se ofrecen alternativas. |
| "¿Tienes fotos?" → "no" (pero `media_url` existe) | El webhook nunca envía la imagen. |
| "¿Por cuánto sale la pieza total?" → deriva | El brief no calcula `peso_ct × precio_usd_ct`. |
| Muletilla constante "un asesor te contactará" | Es el cierre por defecto del nodo `persistir` + instrucción del prompt; `MAX_RONDAS=4` fuerza el cierre. |
| Insiste sobre la piedra repitiendo el MISMO texto | El redactor solo recibe `nombre, peso_ct, precio_usd_ct` y el último mensaje (sin historial ni datos técnicos). |

**Lo que el usuario pidió:** insistir sobre la misma piedra = aportar **datos técnicos
NUEVOS** de la guía en cada reaparición, conversación natural hacia el cierre, sin
muletillas ni forcejeos.

## 3. Decisiones de diseño (brainstorming)

| Decisión | Elección | Razón |
| --- | --- | --- |
| Dónde mejorar | **Capa del redactor (composer)**, cerebro intacto | Sin regresión; concentra el cambio donde está el déficit (voz/conocimiento). |
| Conocimiento técnico | **Guía destilada a constante TS en el system prompt** | Guía de ~2 páginas → embeber es lo más simple que funciona; descartado RAG/embeddings (over-engineering). |
| Datos técnicos por piedra | **Cascada columna estructurada → `notas` → guía** | Combinación opt 1+2: rico cuando el dato existe, degrada con gracia. Columnas nullable = sin captura forzada. |
| Flujo del grafo | **Sin reescritura agéntica; tweak a `persistir`** | Reescribir como agente con tools = riesgo de regresión (va contra aprendizaje previo). |
| Cierre / handoff | **Reservar "asesor te contactará" para handoff real** | La derivación deja de ser el comportamiento por defecto. |

**Alternativas descartadas:** (a) reescribir el grafo como agente con catálogo de tools
(riesgo de regresión del cerebro determinista); (b) RAG con embeddings sobre la guía
(over-engineering para 2 páginas).

## 4. Arquitectura — componentes

### 4.1 Módulo de conocimiento — `packages/agent/src/guia.ts`

Constante TS (`GUIA_HECHOS: string`) destilada de la *Guía Méraldi* (archivo fuente:
`Guia_Meraldi_Esmeraldas_Santiago_Diaz.docx`). Contenido factual, en prosa breve, que
el redactor puede citar:

- **Las 6 variables** (peso, color, claridad, corte, origen, tratamiento) y cómo se lee
  cada una.
- **Quilates:** el peso se mide en quilates; el tamaño aumenta la rareza cuando la
  calidad acompaña. (Responde "¿qué son quilates?").
- **Color:** verde a verde azulado; saturación vívida y tono equilibrado = corazón del
  valor.
- **Claridad / jardín:** las inclusiones no son defecto absoluto; el "jardín" es parte
  de la identidad si conserva transparencia y brillo.
- **Escala de tratamiento** (5 niveles: sin tratamiento / insignificante / menor /
  moderado / significativo) con su lectura comercial.
- **Orígenes/minas** (Colombia: Muzo, Coscuez, Chivor, La Pita/Maripí, Gachalá; Zambia:
  Kafubu/Kagem; Brasil; etc.) — el origen aporta contexto y reputación, no determina por
  sí solo el valor.
- **Valorización (§10):** comunicar como **belleza, colección y patrimonio tangible**,
  **evitando promesas de rentabilidad**; las piedras **no son activos líquidos**.
  (Respuesta honesta a "¿se valoriza?").
- **Marco de precio (§9):** la pregunta no es solo "¿cuánto por quilate?" sino qué
  calidad, tratamiento, origen, rareza y confianza se compra.
- **Fuera de catálogo:** Méraldi es casa de **esmeralda colombiana**; otras gemas
  (p. ej. diamante) se reconducen con cariño.
- **Disclaimer:** la guía no reemplaza dictamen de laboratorio; para piezas de alto
  valor, confirmar con laboratorios reconocidos (GIA, Gübelin, SSEF, AGL, Guild).

Se inyecta **estática** en el system prompt del composer (no por brief). Costo ~1–1.5k
tokens/llamada, aceptable.

### 4.2 Inventario enriquecido — migración `00003_inventario_tecnico.sql`

Columnas **nullable** en `public.inventario`:

```sql
alter table public.inventario add column if not exists color text;
alter table public.inventario add column if not exists origen text;
alter table public.inventario add column if not exists claridad text;
alter table public.inventario add column if not exists tratamiento text;
```

- Sin captura forzada (nullable). El vendedor las llena progresivamente.
- El **match no cambia** en esta fase (sigue por forma/peso/presupuesto). Las columnas
  son de **presentación**.
- `Piedra` (en `packages/types/src/inventario.ts`) suma los 4 campos opcionales.
- `matchInventory` / coerción: incluir las columnas nuevas en el `select` y mapeo.

**Cascada de presentación** que aplica el redactor por atributo: columna estructurada →
si null, `notas` → si no, conocimiento general de la guía. (La cascada se expresa en el
prompt; el brief entrega ambos: columnas + `notas`).

### 4.3 Brief enriquecido — `ComposeBrief` (`packages/types/src/compose.ts`)

El brief que recibe el redactor suma:

- `stones`: `Piedra` **completa** (color/origen/claridad/tratamiento/`notas`/`media_url`
  + `peso_ct` + `precio_usd_ct`) **+ `precio_total_usd` calculado** (`peso_ct ×
  precio_usd_ct`). Se pasan **todas** las coincidencias (hasta 3) para poder ofrecer
  alternativas cuando las pidan.
- `presupuesto`: el presupuesto conocido del cliente (para decir "cabe en lo tuyo").
- `history`: últimos ~6 mensajes (rol + texto) de la conversación, para no repetirse y
  responder follow-ups.

`renderBriefForPrompt` se actualiza para serializar estos campos.

### 4.4 Prompt del redactor reescrito — `packages/agent/src/composer.ts`

Nuevo system prompt (Iris, asesora Méraldi). En cada turno:

1. **Acusa recibo** de lo que el cliente dijo, con naturalidad.
2. **Responde la pregunta u objeción** del cliente usando `GUIA_HECHOS` + datos de la
   piedra. **Nunca deriva a "asesor" en lugar de responder.** Cubre explícitamente:
   "¿qué son quilates?", "¿se valoriza?", "¿precio total?", "¿fotos?", "¿otras
   opciones?".
3. **Refuerza la misma piedra con un ángulo técnico NUEVO** cada vez (color → origen →
   claridad → tratamiento → valor → total), variando el fraseo; nunca repite la misma
   frase. Usa la **cascada** de §4.2 y **no inventa** atributos que no estén en los datos
   ni en la guía.
4. **Avanza un paso** hacia el cierre: pide a lo sumo 1 dato faltante, o propone el
   siguiente paso (cotizar total, enviar foto, agendar). Sin listas de viñetas, sin
   "Para ayudarte mejor, cuéntame".
5. **Honestidad:** no promete rentabilidad (dice patrimonio tangible); cotiza la
   **piedra** (por ct + total) y aclara que el **montaje/talla** los afina un asesor
   (no inventa precio de joya terminada); fuera de catálogo → reconduce a esmeralda.
6. La frase **"un asesor de Méraldi te contactará"** se **reserva** para: (a) petición
   explícita de hablar con un humano, (b) el cierre transaccional real, (c) fallback sin
   LLM.

Temperatura ~0.6 (sin cambio). Sigue devolviendo texto libre.

### 4.5 Flujo — `packages/agent/src/graph.ts`

- **No más cierre-muerto** en `MAX_RONDAS`: una conversación viva no se corta con la
  plantilla de "asesor".
- El **lead se persiste como efecto colateral** (la captura sigue ocurriendo, ANTES de
  la llamada al LLM, como hoy), pero el **mensaje** se genera con el mismo composer
  enriquecido (presenta + avanza), no con la plantilla de cierre.
- El match ya corre cuando hay forma/peso/presupuesto; se mantiene, de modo que una
  piedra puede presentarse temprano.

### 4.6 Webhook — fotos reales — `apps/web/src/app/api/telegram/webhook/route.ts`

- Nuevo helper `sendTelegramPhoto(chatId, photoUrl, caption?)` (junto a
  `sendTelegramMessage`).
- Cuando la piedra presentada tiene `media_url`, se envía la imagen (con el mensaje como
  caption o seguido del texto). Resuelve "¿tienes fotos?" de verdad.

### 4.7 Historial — `lead_messages`

Los mensajes ya se persisten en `lead_messages` (comprador y agente). El brief lee los
últimos ~6 del thread (`telegram_user_id`) y los inyecta. Ordenar cronológicamente;
incluir el mensaje actual del comprador como `cliente_dijo` y los previos como
`history`.

## 5. Flujo end-to-end (resultante)

1. Comprador escribe → webhook → `runIris`.
2. extractor (intacto) → validador (intacto) → match (intacto, +columnas nuevas en el
   select).
3. Se arma el brief enriquecido (piedra completa + total + presupuesto + historial).
4. composer redacta UN mensaje: acusa recibo → responde la pregunta → refuerza la piedra
   con ángulo técnico nuevo → avanza un paso. Sin muletilla.
5. Si la piedra tiene `media_url`, el webhook envía la foto.
6. El lead se persiste como efecto colateral. La conversación continúa hasta handoff
   real o petición explícita de humano.

## 6. Estrategia de pruebas

- **Composer (unit, modelo falso):** `renderBriefForPrompt` incluye guía/piedra
  completa/`precio_total_usd`/historial/presupuesto; el system prompt incluye
  `GUIA_HECHOS`.
- **No-regresión:** `graph.test.ts` **no se toca** y sigue verde (prueba el camino de
  fallback determinista).
- **Módulo de guía:** asserts de que hechos clave están presentes (quilates,
  valorización-sin-promesas, escala de tratamiento, orígenes).
- **Migración:** columnas nullable; `Piedra` y `matchInventory` mapean los 4 campos.
- **Harness de escenarios:** reproduce las 3 conversaciones de las capturas (LLM real,
  como el eval del redactor existente) y verifica: explica quilates; responde
  valorización con honestidad (sin prometer rentabilidad); ofrece alternativas cuando se
  piden; cotiza total de la piedra; envía/menciona foto; **sin** "asesor te contactará"
  salvo handoff explícito.

## 7. Alcance

**Dentro:** módulo de conocimiento (`guia.ts`), migración de columnas técnicas
(nullable, presentación), brief enriquecido (piedra completa + total + presupuesto +
historial), prompt del redactor reescrito, tweak de flujo (sin cierre-muerto), envío de
fotos, lectura de historial, pruebas + harness.

**Fuera (fases futuras):**
- Cablear las columnas técnicas (color/origen/claridad/tratamiento) al **match**
  (filtrado), no solo a la presentación.
- Tasación/grading de la piedra.
- Conversión de presupuesto COP→USD para filtrar (hoy COP omite filtro de precio).
- Cotización real de joya terminada (montaje/metal/talla).

## 8. Riesgos y mitigaciones

- **El redactor inventa atributos por piedra** → prompt estricto "no inventes lo que no
  esté en los datos ni en la guía"; cascada explícita; harness lo verifica.
- **Promesas de rentabilidad** (riesgo legal/marca) → regla dura en el prompt + assert
  en el harness ("se valoriza" no debe prometer retorno).
- **Crecimiento del prompt** (guía estática) → mantener `GUIA_HECHOS` condensado
  (~1–1.5k tokens); es factual, no narrativo.
- **Historial infla tokens/latencia** → límite duro de ~6 mensajes.
- **Regresión del cerebro** → no se toca extractor/validador/match salvo el `select` de
  columnas; `graph.test.ts` intacto como red de no-regresión.
