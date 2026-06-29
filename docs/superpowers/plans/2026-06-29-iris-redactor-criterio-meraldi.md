# Iris — Redactor con criterio Méraldi — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Convertir la capa del redactor (composer) de Iris en una asesora que educa, responde preguntas, presenta la piedra con riqueza técnica creciente y avanza al cierre con naturalidad — anclada en la Guía Méraldi, sin muletillas ni forcejeos — dejando intacto el cerebro determinista (extractor/validador/match).

**Architecture:** Toda la mejora vive en la capa de redacción y sus insumos: un módulo de conocimiento estático (`guia.ts`) inyectado al system prompt; un `ComposeBrief` enriquecido (piedra completa + precio total + presupuesto + historial); un prompt reescrito; columnas técnicas opcionales en inventario (presentación); envío de fotos en el webhook. El grafo solo recibe cambios aditivos (deps opcionales, campo de estado `mediaUrl`); sus tests existentes no se tocan y siguen verdes = no-regresión.

**Tech Stack:** TypeScript (ESM, imports `.js`), LangGraph JS, Next.js (webhook), Supabase/Postgres, `node:test` vía `tsx --test`, OpenRouter (gpt-4o-mini).

## Global Constraints

- Node `>=20`. Monorepo npm workspaces + Turborepo.
- ESM puro: **todos los imports internos terminan en `.js`** (aunque el archivo sea `.ts`).
- Versiones LangChain **fijas** (no cambiar): `@langchain/core` 1.1.41, `@langchain/langgraph` 1.2.7, override `@langchain/langgraph-checkpoint` 1.0.1. No instalar dependencias nuevas en este plan.
- Tests: `node:test` + `assert/strict`, ejecutados con `tsx --test`. Comandos por paquete:
  - Agent: `npm run test --workspace=@iris/agent`
  - DB: `npm run test --workspace=@iris/db`
  - Type-check global: `npm run type-check`
- **No tocar** `packages/agent/src/__tests__/graph.test.ts` ni `graph.compose.test.ts` (red de no-regresión del cerebro determinista). Si un cambio los rompe, el cambio está mal.
- Git: trabajar en la rama ya creada `feat/redactor-criterio-meraldi`. **No** `git push` directo a `main`. Commit guard activo → usar `git -c skill.commit=true commit`.
- Aplicar migraciones a la BD viva (`scripts/apply-migration.mjs`) es una acción sobre datos reales: **no** forma parte de los pasos de test; se ejecuta aparte, con confirmación del usuario.
- Marca/honestidad (de la guía): nunca prometer rentabilidad ni retornos; esmeraldas = "belleza, colección y patrimonio tangible", no activos líquidos. Méraldi = casa de esmeralda colombiana.

---

## File Structure

- `packages/agent/src/guia.ts` *(crear)* — constante `GUIA_HECHOS` (conocimiento técnico destilado de la guía). Responsabilidad: única fuente de hechos técnicos para el redactor.
- `packages/agent/src/__tests__/guia.test.ts` *(crear)* — asserts de hechos clave presentes.
- `packages/db/supabase/migrations/00003_inventario_tecnico.sql` *(crear)* — columnas técnicas nullable.
- `packages/types/src/inventario.ts` *(modificar)* — `Piedra` + 4 campos técnicos opcionales.
- `packages/types/src/compose.ts` *(modificar)* — `ComposeBrief` + `presupuesto` e `history`.
- `packages/agent/src/brief.ts` *(modificar)* — `buildComposeBrief` puebla `presupuesto`/`history`.
- `packages/agent/src/composer.ts` *(modificar)* — `renderBriefForPrompt` (piedra completa + total + historial) y `COMPOSE_SYSTEM_PROMPT` reescrito con `GUIA_HECHOS`.
- `packages/db/src/queries/leads.ts` *(modificar)* — `getRecentMessages`.
- `packages/agent/src/graph.ts` *(modificar)* — dep opcional `getHistory`, paso de historial al brief, `mediaUrl` en retorno.
- `packages/agent/src/state.ts` *(modificar)* — anotación `mediaUrl`.
- `packages/agent/src/index.ts` *(modificar)* — export de `GUIA_HECHOS`.
- `packages/db/src/index.ts` — ya re-exporta `queries/leads.js` con `export *` (sin cambio).
- `apps/web/src/lib/telegram/send.ts` *(modificar)* — `sendTelegramPhoto`.
- `apps/web/src/app/api/telegram/webhook/route.ts` *(modificar)* — historial + envío de foto.
- `scripts/eval-conversaciones.mjs` *(crear)* — harness manual que reproduce las 3 conversaciones.

---

## Task 1: Módulo de conocimiento `guia.ts`

**Files:**
- Create: `packages/agent/src/guia.ts`
- Create test: `packages/agent/src/__tests__/guia.test.ts`
- Modify: `packages/agent/src/index.ts`

**Interfaces:**
- Produces: `export const GUIA_HECHOS: string` (texto factual multilínea).

- [ ] **Step 1: Escribir el test que falla**

Crear `packages/agent/src/__tests__/guia.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { GUIA_HECHOS } from "../guia.js";

test("GUIA_HECHOS cubre los hechos clave para responder al cliente", () => {
  assert.match(GUIA_HECHOS, /quilate/i);                       // qué son los quilates
  assert.match(GUIA_HECHOS, /patrimonio tangible/i);           // postura de valorización
  assert.match(GUIA_HECHOS, /no son activos l[ií]quidos/i);    // sin promesas de rentabilidad
  assert.match(GUIA_HECHOS, /Muzo/);                           // orígenes/minas
  assert.match(GUIA_HECHOS, /tratamiento/i);                   // escala de tratamiento
  assert.match(GUIA_HECHOS, /jard[ií]n/i);                     // claridad / inclusiones
  assert.match(GUIA_HECHOS, /colombian/i);                     // identidad de marca
});
```

- [ ] **Step 2: Correr el test y verlo fallar**

Run: `npm run test --workspace=@iris/agent`
Expected: FAIL — `Cannot find module '../guia.js'`.

- [ ] **Step 3: Crear `packages/agent/src/guia.ts`**

```ts
/** Conocimiento técnico destilado de la "Guía Méraldi de Esmeraldas Colombianas"
 * (Santiago Díaz, 2026). Hechos verificados que el redactor puede usar para educar
 * al cliente y enriquecer la presentación de una piedra. NO es narrativa de venta. */
export const GUIA_HECHOS = `Las 6 variables Méraldi para entender una esmeralda: peso, color, claridad, corte, origen y tratamiento. La belleza emociona; la información construye confianza.

Peso (quilates): el quilate es la unidad de peso de las gemas (1 ct = 0,2 g). A mayor tamaño, mayor rareza cuando la calidad acompaña; el precio no se explica solo por el peso.

Color: la esmeralda es la variedad verde a verde azulada del berilo (cromo, vanadio, hierro). El color es el factor más determinante: las más buscadas tienen verde puro a ligeramente azulado, saturación vívida y tono equilibrado (ni muy claro ni tan oscuro que pierda vida). Es el corazón visual de la piedra.

Claridad / jardín: las inclusiones naturales (el "jardín") no son un defecto absoluto; son parte de la identidad de la esmeralda siempre que conserve transparencia, brillo y durabilidad. Dureza 7,5–8 en Mohs, con cuidado por fracturas.

Corte: proporciones, simetría, brillo y protección de zonas sensibles. El "corte esmeralda" es la talla rectangular/cuadrada de esquinas cortadas y facetas escalonadas.

Origen: aporta contexto geológico y reputación, no determina por sí solo el valor; conviene documentarlo cuando es relevante. Colombia (Muzo, Coscuez, Chivor, La Pita/Maripí, Gachalá) es referente histórico de alto color; también Zambia (Kafubu/Kagem), Brasil, y otros (Afganistán/Pakistán, Madagascar, Etiopía). Las colombianas se asocian a depósitos sedimentarios singulares (lutitas negras).

Tratamiento: la mayoría de esmeraldas comerciales tienen fisuras naturales; es común el relleno con aceites o resinas para mejorar la apariencia. Lo importante es declararlo. Escala comercial: sin tratamiento/sin indicios, insignificante, menor, moderado, significativo. Menos tratamiento (con buena calidad) suele significar mayor valor. Cuidado: evitar ultrasonido, vapor, calor y químicos fuertes; limpieza suave.

Tipos de pieza: gema tallada (joyería), cristal en bruto (espécimen, se valora por morfología/terminaciones/matriz/rareza, no solo por lo que pesaría tallado), joya terminada y espécimen mineral de colección.

Valorización e inversión: las esmeraldas excepcionales pueden conservar valor y demanda (color sobresaliente, bajo tratamiento, origen reconocido, tamaño, documentación, rareza real). PERO no son activos líquidos como una divisa o una acción: el precio de reventa depende del comprador correcto, el tiempo, la confianza y el mercado. Méraldi las comunica como belleza, colección y patrimonio tangible, evitando promesas de rentabilidad.

Precio: la pregunta correcta no es solo "¿cuánto por quilate?", sino qué calidad, tratamiento, origen, rareza y confianza se está comprando. El precio se explica desde la calidad y la comparabilidad, no solo desde el peso.

Documentación: para piezas de alto valor, un reporte de laboratorio (GIA, Gübelin, SSEF, AGL, Guild) confirma naturaleza, peso, tratamiento y, cuando aplica, opinión de origen. Esta guía no reemplaza un dictamen de laboratorio.

Identidad: Méraldi es una casa de esmeralda colombiana. Si alguien pide otra gema distinta a la esmeralda, se aclara con cariño y se reconduce.`;
```

- [ ] **Step 4: Exportar `GUIA_HECHOS` desde el índice del paquete**

En `packages/agent/src/index.ts`, agregar al final:

```ts
export { GUIA_HECHOS } from "./guia.js";
```

- [ ] **Step 5: Correr el test y verlo pasar**

Run: `npm run test --workspace=@iris/agent`
Expected: PASS (incluye `guia.test.ts` verde; el resto sin cambios).

- [ ] **Step 6: Commit**

```bash
git add packages/agent/src/guia.ts packages/agent/src/__tests__/guia.test.ts packages/agent/src/index.ts
git -c skill.commit=true commit -m "feat(agent): módulo de conocimiento GUIA_HECHOS (guía Méraldi)"
```

---

## Task 2: Inventario — columnas técnicas opcionales

**Files:**
- Create: `packages/db/supabase/migrations/00003_inventario_tecnico.sql`
- Modify: `packages/types/src/inventario.ts`
- Test: `packages/db/src/__tests__/inventario.test.ts` (agregar un caso)

**Interfaces:**
- Produces: `Piedra` con `color?: string | null`, `origen?: string | null`, `claridad?: string | null`, `tratamiento?: string | null`. `matchInventory` los propaga vía `...r` (sin cambio de lógica).

- [ ] **Step 1: Escribir el test que falla**

En `packages/db/src/__tests__/inventario.test.ts`, agregar al final (antes de cerrar el archivo):

```ts
test("matchInventory propaga columnas técnicas nuevas (color/origen/claridad/tratamiento)", async () => {
  const fakeDb = {
    from: () => ({ select: () => ({ eq: async () => ({
      data: [
        { id: "a", nombre: "A", forma: "redondo", peso_ct: "3.09", precio_usd_ct: "1500",
          cantidad_piedras: "1", media_url: "http://x/a.jpg", disponible: true, notas: "verde Muzo",
          color: "verde vívido", origen: "Muzo", claridad: "jardín leve", tratamiento: "menor" },
      ],
      error: null,
    }) }) }),
  } as unknown as DbClient;
  const r = await matchInventory(fakeDb, { corte: { forma: "redondo" } });
  assert.equal(r[0].color, "verde vívido");
  assert.equal(r[0].origen, "Muzo");
  assert.equal(r[0].claridad, "jardín leve");
  assert.equal(r[0].tratamiento, "menor");
});
```

- [ ] **Step 2: Correr el test y verlo fallar**

Run: `npm run test --workspace=@iris/db`
Expected: FAIL — TypeScript rechaza `r[0].color` (la propiedad no existe en `Piedra`), o el assert falla.

- [ ] **Step 3: Agregar los campos opcionales a `Piedra`**

En `packages/types/src/inventario.ts`, dentro de `interface Piedra`, después de `notas: string | null;`:

```ts
  /** Atributos técnicos opcionales (presentación; el match no los usa aún). */
  color?: string | null;
  origen?: string | null;
  claridad?: string | null;
  tratamiento?: string | null;
```

- [ ] **Step 4: Crear la migración**

Crear `packages/db/supabase/migrations/00003_inventario_tecnico.sql`:

```sql
-- Iris — atributos técnicos opcionales por piedra (presentación del redactor)

alter table public.inventario add column if not exists color text;
alter table public.inventario add column if not exists origen text;
alter table public.inventario add column if not exists claridad text;
alter table public.inventario add column if not exists tratamiento text;
```

- [ ] **Step 5: Correr los tests y verlos pasar**

Run: `npm run test --workspace=@iris/db`
Expected: PASS (el nuevo caso verde; los 18 casos previos de `filtrarPiedras`/`matchInventory` siguen verdes — `matchInventory` propaga los campos por el spread `...r`, sin tocar la lógica de filtrado).

- [ ] **Step 6: Commit**

```bash
git add packages/types/src/inventario.ts packages/db/supabase/migrations/00003_inventario_tecnico.sql packages/db/src/__tests__/inventario.test.ts
git -c skill.commit=true commit -m "feat(db): columnas técnicas opcionales en inventario (color/origen/claridad/tratamiento)"
```

> Nota: la migración se aplica a Supabase con `node scripts/apply-migration.mjs` como paso aparte (toca la BD viva), fuera de este flujo de tests.

---

## Task 3: Brief enriquecido (piedra completa + total + presupuesto + historial)

**Files:**
- Modify: `packages/types/src/compose.ts`
- Modify: `packages/agent/src/brief.ts`
- Modify: `packages/agent/src/composer.ts` (solo `renderBriefForPrompt`)
- Test: `packages/agent/src/__tests__/composer.test.ts` (agregar casos), `packages/agent/src/__tests__/brief.test.ts` (agregar un caso)

**Interfaces:**
- Consumes: `Piedra` con campos técnicos (Task 2).
- Produces:
  - `ComposeBrief` con `presupuesto?: Solicitud["presupuesto"]` e `history?: { rol: "comprador" | "agente"; texto: string }[]`.
  - `buildComposeBrief(input)` acepta `history?` y rellena `presupuesto` desde `solicitud.presupuesto`.
  - `renderBriefForPrompt(b)` serializa: por piedra `nombre (peso ct, precio USD/ct, total ≈ N USD)` + atributos técnicos/notas/foto; bloque `presupuesto`; bloque `historial`.

- [ ] **Step 1: Escribir los tests que fallan**

En `packages/agent/src/__tests__/composer.test.ts`, agregar al final:

```ts
test("renderBriefForPrompt incluye precio total, atributos técnicos e historial", () => {
  const piedraRica: Piedra = {
    id: "z", nombre: "Esmeralda Muzo 1.26 ct", forma: "corte_esmeralda",
    peso_ct: 1.26, precio_usd_ct: 5800, cantidad_piedras: 1,
    media_url: "http://x/z.jpg", disponible: true, notas: "selección Muzo",
    color: "verde vívido", origen: "Muzo", claridad: "jardín leve", tratamiento: "menor",
  };
  const txt = renderBriefForPrompt({
    intent: "aclarar",
    userMessage: "¿se valoriza?",
    known: { proposito: "inversion_patrimonio" },
    missing: ["color"],
    stones: [piedraRica],
    presupuesto: { max: 8000, moneda: "USD" },
    history: [
      { rol: "comprador", texto: "quiero una esmeralda de 1 a 2 ct" },
      { rol: "agente", texto: "te recomiendo la de 1.26 ct" },
    ],
  });
  assert.match(txt, /Esmeralda Muzo 1\.26/);
  assert.match(txt, /7308/);                 // 1.26 * 5800 = 7308 (total)
  assert.match(txt, /Muzo/);                 // origen
  assert.match(txt, /verde v[ií]vido/);      // color
  assert.match(txt, /foto: s[ií]/i);         // hay media_url
  assert.match(txt, /quiero una esmeralda de 1 a 2 ct/); // historial
  assert.match(txt, /8000/);                 // presupuesto
});
```

En `packages/agent/src/__tests__/brief.test.ts`, agregar al final:

```ts
test("buildComposeBrief copia presupuesto e historial", () => {
  const brief = buildComposeBrief({
    intent: "aclarar",
    userMessage: "hola",
    solicitud: { presupuesto: { max: 8000, moneda: "USD" } },
    missing: ["proposito"],
    stones: [],
    history: [{ rol: "comprador", texto: "hola" }],
  });
  assert.deepEqual(brief.presupuesto, { max: 8000, moneda: "USD" });
  assert.equal(brief.history?.length, 1);
  assert.equal(brief.history?.[0].texto, "hola");
});
```

- [ ] **Step 2: Correr los tests y verlos fallar**

Run: `npm run test --workspace=@iris/agent`
Expected: FAIL — `renderBriefForPrompt` no incluye total/historial; `buildComposeBrief` no acepta `history` (TS) y `brief.presupuesto` es `undefined`.

- [ ] **Step 3: Extender el tipo `ComposeBrief`**

En `packages/types/src/compose.ts`, dentro de `interface ComposeBrief`, antes de la línea de `cierre`:

```ts
  /** Presupuesto conocido del cliente (para conectar la recomendación). */
  presupuesto?: Solicitud["presupuesto"];
  /** Últimos mensajes de la conversación, en orden cronológico. */
  history?: { rol: "comprador" | "agente"; texto: string }[];
```

(`Solicitud` ya está importado en ese archivo.)

- [ ] **Step 4: Extender `buildComposeBrief`**

En `packages/agent/src/brief.ts`, en la firma del `input` de `buildComposeBrief` agregar tras `stones: Piedra[];`:

```ts
  history?: { rol: "comprador" | "agente"; texto: string }[];
```

Y en el objeto de retorno, antes de la línea `...(input.cierre ...)`:

```ts
    presupuesto: input.solicitud.presupuesto,
    history: input.history ?? [],
```

- [ ] **Step 5: Reescribir `renderBriefForPrompt`**

En `packages/agent/src/composer.ts`, reemplazar la función `renderBriefForPrompt` completa por:

```ts
/** Serializa el brief en un bloque de texto legible para el LLM. Determinístico. */
export function renderBriefForPrompt(b: ComposeBrief): string {
  const known = Object.keys(b.known).length ? JSON.stringify(b.known) : "(nada aún)";
  const missing = b.missing.length ? b.missing.join(", ") : "(nada)";
  const presupuesto = b.presupuesto && Object.keys(b.presupuesto).length
    ? JSON.stringify(b.presupuesto)
    : "(no dado)";
  const stones = b.stones.length
    ? b.stones.map((p) => {
        const total = Math.round(p.peso_ct * p.precio_usd_ct);
        const attrs = [
          p.color ? `color: ${p.color}` : null,
          p.origen ? `origen: ${p.origen}` : null,
          p.claridad ? `claridad: ${p.claridad}` : null,
          p.tratamiento ? `tratamiento: ${p.tratamiento}` : null,
          p.notas ? `notas: ${p.notas}` : null,
          `foto: ${p.media_url ? "sí" : "no"}`,
        ].filter(Boolean).join("; ");
        return `- ${p.nombre} (${p.peso_ct} ct, ${p.precio_usd_ct} USD/ct, total ≈ ${total} USD) — ${attrs}`;
      }).join("\n")
    : "(ninguna)";
  const history = b.history && b.history.length
    ? b.history.map((m) => `${m.rol === "comprador" ? "Cliente" : "Iris"}: ${m.texto}`).join("\n")
    : "(sin historial)";
  return [
    `intent: ${b.intent}`,
    `cliente_dijo: ${b.userMessage}`,
    `ya_sabemos: ${known}`,
    `presupuesto: ${presupuesto}`,
    `falta_por_preguntar (prioridad): ${missing}`,
    `piedras_que_encajan:\n${stones}`,
    `historial_reciente:\n${history}`,
    b.cierre ? `cierre: ${b.cierre}` : null,
  ].filter(Boolean).join("\n");
}
```

- [ ] **Step 6: Correr los tests y verlos pasar**

Run: `npm run test --workspace=@iris/agent`
Expected: PASS. Los tests previos de `composer.test.ts` siguen verdes (la línea de cada piedra aún contiene `Esmeralda cuadrada 9.04` y `4300`). Los de `brief.test.ts` y `graph.compose.test.ts` siguen verdes (campos aditivos).

- [ ] **Step 7: Type-check de `@iris/types`**

Run: `npm run type-check --workspace=@iris/types`
Expected: sin errores.

- [ ] **Step 8: Commit**

```bash
git add packages/types/src/compose.ts packages/agent/src/brief.ts packages/agent/src/composer.ts packages/agent/src/__tests__/composer.test.ts packages/agent/src/__tests__/brief.test.ts
git -c skill.commit=true commit -m "feat(agent): brief enriquecido (precio total, atributos técnicos, presupuesto, historial)"
```

---

## Task 4: Reescribir el system prompt del redactor

**Files:**
- Modify: `packages/agent/src/composer.ts` (solo `COMPOSE_SYSTEM_PROMPT` + import de `GUIA_HECHOS`)
- Test: `packages/agent/src/__tests__/composer.test.ts` (agregar casos)

**Interfaces:**
- Consumes: `GUIA_HECHOS` (Task 1).
- Produces: `COMPOSE_SYSTEM_PROMPT` que incluye la guía y las reglas de conducta (educa/responde, cascada de datos, honestidad de valorización/precio, reserva del "asesor").

- [ ] **Step 1: Escribir los tests que fallan**

En `packages/agent/src/__tests__/composer.test.ts`, agregar al final (y al import del topo, añadir `GUIA_HECHOS`):

```ts
import { GUIA_HECHOS } from "../guia.js";

test("COMPOSE_SYSTEM_PROMPT incorpora la guía y las reglas clave", () => {
  assert.ok(COMPOSE_SYSTEM_PROMPT.includes(GUIA_HECHOS), "debe inyectar GUIA_HECHOS");
  assert.match(COMPOSE_SYSTEM_PROMPT, /responde|respónde/i);          // educar/responder
  assert.match(COMPOSE_SYSTEM_PROMPT, /patrimonio tangible/i);        // honestidad valorización
  assert.match(COMPOSE_SYSTEM_PROMPT, /total/i);                      // cotiza total de la piedra
  assert.match(COMPOSE_SYSTEM_PROMPT, /asesor/i);                     // regla de reserva del asesor
  assert.match(COMPOSE_SYSTEM_PROMPT, /dato t[eé]cnico NUEVO|nuevo/i);// insistir con dato nuevo
});
```

- [ ] **Step 2: Correr el test y verlo fallar**

Run: `npm run test --workspace=@iris/agent`
Expected: FAIL — el prompt actual no incluye `GUIA_HECHOS` ni "patrimonio tangible".

- [ ] **Step 3: Reescribir el prompt**

En `packages/agent/src/composer.ts`:

1. Al inicio del archivo, junto a los imports, agregar:

```ts
import { GUIA_HECHOS } from "./guia.js";
```

2. Reemplazar la constante `COMPOSE_SYSTEM_PROMPT` completa por:

```ts
export const COMPOSE_SYSTEM_PROMPT = `Eres Iris, asesora de Méraldi, casa de esmeraldas colombianas. Hablas por chat con un comprador como lo haría una asesora real: cálida, cercana, con criterio y breve (máximo ~4 frases).

Recibes un BRIEF con hechos verificados y, al final, una GUÍA con conocimiento técnico que puedes usar para educar y enriquecer. Redactas el siguiente mensaje de Iris.

En cada mensaje, en este orden y dentro de un texto fluido (NUNCA en viñetas, NUNCA el encabezado "Para ayudarte mejor, cuéntame"):
1. Acusa recibo de lo que el cliente acaba de decir (cliente_dijo), con naturalidad, sin repetirlo como loro.
2. Si el cliente hizo una PREGUNTA o planteó una DUDA/objeción, respóndela DE VERDAD usando la GUÍA y los datos de la piedra. Nunca la dejes sin responder ni la sustituyas por derivar a un asesor. Ejemplos: "¿qué son los quilates?" → explícalo; "¿se valoriza?" → responde con honestidad (ver reglas); "¿precio total?" → da el cálculo de la piedra; "¿tienes fotos?" → confirma que se la compartes; "¿otras opciones?" → ofrece otra de piedras_que_encajan.
3. Si hay piedras_que_encajan, refuerza la que mejor encaja conectándola con lo que el cliente dijo (presupuesto, peso, propósito) y aporta UN dato técnico NUEVO respecto a lo que ya dijiste antes (revisa historial_reciente): color, origen, claridad, tratamiento, por qué su valor, o el precio total. Varía el enfoque y el fraseo en cada turno; nunca repitas la misma frase.
4. Avanza UN paso hacia el cierre: si falta info, pide solo 1 dato (máx 2) de falta_por_preguntar, el más relevante; si ya hay match y datos suficientes, propón el siguiente paso (cotizar el total, compartir la foto, afinar el montaje).

Fuente de los datos de la piedra, en cascada (usa el primero que exista): el campo del brief (color/origen/claridad/tratamiento/notas) → si está vacío, el conocimiento general de la GUÍA. NO inventes un atributo concreto de ESA piedra si no aparece en su línea del brief; para eso habla en términos generales de la guía.

Reglas de honestidad:
- Valorización/inversión: las esmeraldas son belleza, colección y patrimonio tangible; NO prometas rentabilidad ni retornos, y aclara que no son activos líquidos como una divisa o una acción.
- Precio: puedes dar el precio por quilate y el precio total de la PIEDRA (ya viene calculado como "total ≈ N USD" en el brief). El precio de la joya terminada (montaje, metal, talla) lo afina un asesor; NO lo inventes.
- No inventes piedras, precios, orígenes, quilates, descuentos, tiempos ni disponibilidad que no estén en el brief.
- Fuera de catálogo (otra gema, p. ej. un diamante): aclara con cariño que Méraldi es casa de esmeralda colombiana y reconduce.

Menciona que "un asesor de Méraldi lo contactará" SOLO cuando el cliente pida explícitamente hablar con una persona o cuando se cierre un acuerdo de compra (cierre="completo"). NO lo uses como muletilla ni para evitar responder.

Responde solo con el mensaje para el cliente, en español, sin comillas.

=== GUÍA (conocimiento técnico) ===
${GUIA_HECHOS}`;
```

- [ ] **Step 4: Correr los tests y verlos pasar**

Run: `npm run test --workspace=@iris/agent`
Expected: PASS. Nota: `composer.test.ts` ya asserta `visto[0].content === COMPOSE_SYSTEM_PROMPT` comparando contra la constante exportada → sigue verde. `graph.compose.test.ts` (camino de fallback con "asesor de Méraldi") no depende del prompt → verde.

- [ ] **Step 5: Commit**

```bash
git add packages/agent/src/composer.ts packages/agent/src/__tests__/composer.test.ts
git -c skill.commit=true commit -m "feat(agent): prompt del redactor reescrito (educa/responde/cierra sin muletillas)"
```

---

## Task 5: Historial de conversación al brief

**Files:**
- Modify: `packages/db/src/queries/leads.ts`
- Modify: `packages/agent/src/graph.ts`
- Create test: `packages/db/src/__tests__/messages.test.ts`
- Create test: `packages/agent/src/__tests__/graph.history.test.ts`

**Interfaces:**
- Produces: `getRecentMessages(db, telegramUserId, limit?): Promise<{ rol: "comprador" | "agente"; texto: string }[]>` (orden cronológico ascendente).
- Produces: `IrisDeps.getHistory?: () => Promise<{ rol: "comprador" | "agente"; texto: string }[]>` — los nodos `preguntar`/`persistir` lo invocan y pasan el resultado a `buildComposeBrief({ history })`.

- [ ] **Step 1: Escribir el test que falla (db)**

Crear `packages/db/src/__tests__/messages.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { getRecentMessages } from "../queries/leads.js";
import type { DbClient } from "../client.js";

test("getRecentMessages devuelve en orden cronológico ascendente", async () => {
  let capturado: { col: string; asc?: boolean; lim?: number } = { col: "" };
  const fakeDb = {
    from: () => ({
      select: () => ({
        eq: () => ({
          order: (col: string, opts: { ascending: boolean }) => {
            capturado.col = col; capturado.asc = opts.ascending;
            return {
              limit: (n: number) => {
                capturado.lim = n;
                // el driver devuelve descendente (más reciente primero)
                return Promise.resolve({
                  data: [
                    { rol: "agente", texto: "segundo" },
                    { rol: "comprador", texto: "primero" },
                  ],
                  error: null,
                });
              },
            };
          },
        }),
      }),
    }),
  } as unknown as DbClient;

  const r = await getRecentMessages(fakeDb, 7, 6);
  assert.equal(capturado.col, "created_at");
  assert.equal(capturado.asc, false);
  assert.equal(capturado.lim, 6);
  assert.deepEqual(r, [
    { rol: "comprador", texto: "primero" },
    { rol: "agente", texto: "segundo" },
  ]); // invertido a cronológico
});
```

- [ ] **Step 2: Correr el test y verlo fallar**

Run: `npm run test --workspace=@iris/db`
Expected: FAIL — `getRecentMessages` no existe.

- [ ] **Step 3: Implementar `getRecentMessages`**

En `packages/db/src/queries/leads.ts`, agregar al final:

```ts
/** Últimos `limit` mensajes del thread, en orden cronológico ascendente. */
export async function getRecentMessages(
  db: DbClient,
  telegramUserId: number,
  limit = 6
): Promise<{ rol: "comprador" | "agente"; texto: string }[]> {
  const { data, error } = await db
    .from("lead_messages")
    .select("rol, texto")
    .eq("telegram_user_id", telegramUserId)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw error;
  const rows = (data ?? []) as { rol: "comprador" | "agente"; texto: string }[];
  return rows.reverse();
}
```

- [ ] **Step 4: Correr el test de db y verlo pasar**

Run: `npm run test --workspace=@iris/db`
Expected: PASS.

- [ ] **Step 5: Escribir el test que falla (graph)**

Crear `packages/agent/src/__tests__/graph.history.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { MemorySaver } from "@langchain/langgraph";
import { runIris, type IrisDeps } from "../graph.js";
import type { ComposeBrief } from "@iris/types";

test("el historial de getHistory llega al brief del redactor", async () => {
  let recibido: ComposeBrief | null = null;
  const deps: IrisDeps = {
    extract: async () => ({ proposito: "joyeria" }),
    saveLead: async () => ({ id: "x" }),
    notifySeller: async () => {},
    compose: async (b) => { recibido = b; return "ok"; },
    getHistory: async () => [{ rol: "comprador", texto: "mensaje previo" }],
    checkpointer: new MemorySaver(),
  };
  await runIris(deps, { telegramUserId: 1, chatId: 1, text: "hola" });
  assert.ok(recibido);
  assert.equal((recibido as ComposeBrief).history?.[0].texto, "mensaje previo");
});
```

- [ ] **Step 6: Correr el test y verlo fallar**

Run: `npm run test --workspace=@iris/agent`
Expected: FAIL — `getHistory` no existe en `IrisDeps` (TS) y `brief.history` llega vacío.

- [ ] **Step 7: Cablear `getHistory` en el grafo**

En `packages/agent/src/graph.ts`:

1. En `interface IrisDeps`, después de la línea de `compose?`:

```ts
  /** Opcional: últimos mensajes de la conversación, en orden cronológico. */
  getHistory?: () => Promise<{ rol: "comprador" | "agente"; texto: string }[]>;
```

2. En `preguntarNode`, después de obtener `piedras` y antes de construir el `brief`, agregar `const history = ...` y pasarlo al brief:

```ts
  const history = deps.getHistory ? await deps.getHistory() : [];
  const brief = buildComposeBrief({
    intent: "aclarar",
    userMessage: state.inputText,
    solicitud: state.solicitud,
    missing: state.camposFaltantes,
    stones: piedras,
    history,
  });
```

3. En `persistirNode`, igual: tras `const propuesta = ...;` (donde ya hay `piedras`), agregar el `history` y pasarlo al `buildComposeBrief` de cierre:

```ts
  const history = deps.getHistory ? await deps.getHistory() : [];
  const brief = buildComposeBrief({
    intent: "cerrar",
    userMessage: state.inputText,
    solicitud: state.solicitud,
    missing: state.camposFaltantes,
    stones: piedras,
    history,
    cierre: estadoFinal,
  });
```

- [ ] **Step 8: Correr los tests y verlos pasar**

Run: `npm run test --workspace=@iris/agent`
Expected: PASS. `graph.test.ts` y `graph.compose.test.ts` no proveen `getHistory` → `history = []`, siguen verdes.

- [ ] **Step 9: Commit**

```bash
git add packages/db/src/queries/leads.ts packages/db/src/__tests__/messages.test.ts packages/agent/src/graph.ts packages/agent/src/__tests__/graph.history.test.ts
git -c skill.commit=true commit -m "feat(agent): inyectar historial de conversación al brief del redactor"
```

---

## Task 6: Envío de fotos de la piedra en Telegram

**Files:**
- Modify: `packages/agent/src/state.ts`
- Modify: `packages/agent/src/graph.ts`
- Create test: `packages/agent/src/__tests__/graph.media.test.ts`
- Modify: `apps/web/src/lib/telegram/send.ts`
- Modify: `apps/web/src/app/api/telegram/webhook/route.ts`

**Interfaces:**
- Produces: `State.mediaUrl: string | null`; `runIris(...)` retorna `{ reply: string; estado: EstadoLead; mediaUrl: string | null }`.
- Produces: `sendTelegramPhoto(chatId: number, photoUrl: string, caption?: string): Promise<void>`.

- [ ] **Step 1: Escribir el test que falla (graph)**

Crear `packages/agent/src/__tests__/graph.media.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { MemorySaver } from "@langchain/langgraph";
import { runIris, type IrisDeps } from "../graph.js";
import type { Piedra } from "@iris/types";

const piedraFoto: Piedra = {
  id: "a", nombre: "Cuadrada 3.61 ct", forma: "corte_esmeralda",
  peso_ct: 3.61, precio_usd_ct: 1750, cantidad_piedras: 1,
  media_url: "http://x/a.jpg", disponible: true, notas: null,
};

test("runIris expone media_url de la piedra propuesta", async () => {
  const deps: IrisDeps = {
    extract: async () => ({ corte: { forma: "corte_esmeralda" }, peso_quilates: { min: 3, max: 4 } }),
    saveLead: async () => ({ id: "x" }),
    notifySeller: async () => {},
    matchInventory: async () => [piedraFoto],
    checkpointer: new MemorySaver(),
  };
  const out = await runIris(deps, { telegramUserId: 1, chatId: 1, text: "cuadrada de 3-4 ct" });
  assert.equal(out.mediaUrl, "http://x/a.jpg");
});

test("sin piedra con foto, mediaUrl es null", async () => {
  const deps: IrisDeps = {
    extract: async () => ({ proposito: "joyeria" }),
    saveLead: async () => ({ id: "x" }),
    notifySeller: async () => {},
    checkpointer: new MemorySaver(),
  };
  const out = await runIris(deps, { telegramUserId: 2, chatId: 2, text: "hola" });
  assert.equal(out.mediaUrl, null);
});
```

- [ ] **Step 2: Correr el test y verlo fallar**

Run: `npm run test --workspace=@iris/agent`
Expected: FAIL — `out.mediaUrl` no existe en el retorno de `runIris`.

- [ ] **Step 3: Agregar `mediaUrl` al estado**

En `packages/agent/src/state.ts`, dentro de `IrisState`, tras la línea de `reply`:

```ts
  mediaUrl: Annotation<string | null>(lastWrite<string | null>(null)),
```

- [ ] **Step 4: Setear y retornar `mediaUrl` en el grafo**

En `packages/agent/src/graph.ts`:

1. En `preguntarNode`, cambiar el `return` final por:

```ts
  return { reply, mediaUrl: piedras[0]?.media_url ?? null };
```

2. En `persistirNode`, cambiar el `return` final por:

```ts
  return { reply, estado: estadoFinal, mediaUrl: piedras[0]?.media_url ?? null };
```

3. En `runIris`, cambiar la firma de retorno y el objeto retornado:

```ts
export async function runIris(
  deps: IrisDeps,
  input: { telegramUserId: number; chatId: number; telegramUsername?: string; text: string }
): Promise<{ reply: string; estado: EstadoLead; mediaUrl: string | null }> {
```

y al final:

```ts
  return { reply: final.reply, estado: final.estado, mediaUrl: final.mediaUrl };
```

- [ ] **Step 5: Correr los tests del agente y verlos pasar**

Run: `npm run test --workspace=@iris/agent`
Expected: PASS. `graph.test.ts`/`graph.compose.test.ts` destructuran `{ reply, estado }` → ignorar `mediaUrl` extra no rompe nada.

- [ ] **Step 6: Implementar `sendTelegramPhoto`**

En `apps/web/src/lib/telegram/send.ts`, agregar al final:

```ts
export async function sendTelegramPhoto(
  chatId: number,
  photoUrl: string,
  caption?: string
): Promise<void> {
  if (!BOT_TOKEN) {
    console.warn("[telegram] TELEGRAM_BOT_TOKEN no configurado, se omite el envío");
    return;
  }
  const res = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendPhoto`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, photo: photoUrl, ...(caption ? { caption } : {}) }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    console.error("[telegram] sendPhoto falló:", res.status, body);
  }
}
```

- [ ] **Step 7: Usar la foto en el webhook**

En `apps/web/src/app/api/telegram/webhook/route.ts`:

1. En el import de `@/lib/telegram/send`, agregar `sendTelegramPhoto`:

```ts
import { sendTelegramMessage, sendTelegramPhoto } from "@/lib/telegram/send";
```

2. En el bloque `try` del pipeline normal, reemplazar:

```ts
    const { reply } = await runIris(deps, parsed);
    await addLeadMessage(db, parsed.telegramUserId, "agente", reply);
    await sendTelegramMessage(parsed.chatId, reply);
```

por:

```ts
    const { reply, mediaUrl } = await runIris(deps, parsed);
    await addLeadMessage(db, parsed.telegramUserId, "agente", reply);
    if (mediaUrl) await sendTelegramPhoto(parsed.chatId, mediaUrl, reply);
    else await sendTelegramMessage(parsed.chatId, reply);
```

- [ ] **Step 8: Type-check del webhook (app web)**

Run: `npm run type-check --workspace=web`
Expected: sin errores. (Si el nombre del workspace difiere, usar `npm run type-check` global.)

- [ ] **Step 9: Commit**

```bash
git add packages/agent/src/state.ts packages/agent/src/graph.ts packages/agent/src/__tests__/graph.media.test.ts apps/web/src/lib/telegram/send.ts apps/web/src/app/api/telegram/webhook/route.ts
git -c skill.commit=true commit -m "feat(web): enviar foto de la piedra propuesta por Telegram (sendPhoto)"
```

---

## Task 7: Conectar el historial real en el webhook

**Files:**
- Modify: `apps/web/src/app/api/telegram/webhook/route.ts`

**Interfaces:**
- Consumes: `getRecentMessages` (Task 5), `IrisDeps.getHistory` (Task 5).

- [ ] **Step 1: Importar `getRecentMessages`**

En `apps/web/src/app/api/telegram/webhook/route.ts`, agregar `getRecentMessages` al import de `@iris/db`:

```ts
import { createServerClient, upsertLead, addLeadMessage, matchInventory, getRecentMessages } from "@iris/db";
```

- [ ] **Step 2: Cargar el historial previo y pasarlo por `getHistory`**

En el webhook, tras `const sellerChatId = ...;` y antes de `const deps: IrisDeps = {`, agregar:

```ts
  // Historial ANTES de guardar el mensaje actual (para que getHistory no lo incluya).
  const previas = await getRecentMessages(db, parsed.telegramUserId, 6);
```

Y dentro del objeto `deps`, agregar la propiedad:

```ts
    getHistory: async () => previas,
```

(El `addLeadMessage(... "comprador" ...)` dentro del `try` sigue ejecutándose después, así que `previas` solo contiene mensajes anteriores al actual.)

- [ ] **Step 3: Type-check**

Run: `npm run type-check`
Expected: sin errores en ningún workspace.

- [ ] **Step 4: Suite completa de tests**

Run: `npm test`
Expected: todos los paquetes verdes (turbo corre @iris/agent y @iris/db).

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/app/api/telegram/webhook/route.ts
git -c skill.commit=true commit -m "feat(web): cargar historial de conversación y pasarlo al redactor"
```

---

## Task 8: Harness manual — reproducir las 3 conversaciones

**Files:**
- Create: `scripts/eval-conversaciones.mjs`

**Interfaces:**
- Consumes: `runIris` (subpath directo, porque `tsx` no surfacea el barrel `export *` cuando el `main` apunta a build), `getRecentMessages` no se usa (historial en memoria).

> Contexto: script de **eval manual** (no corre en CI). Necesita `OPENROUTER_API_KEY`. Usa LLM real + `MemorySaver` + inventario en memoria; imprime las respuestas para inspección y hace chequeos blandos (warn, no fail) porque la salida del LLM varía.

- [ ] **Step 1: Crear el harness**

Crear `scripts/eval-conversaciones.mjs`:

```js
// Eval manual de conversaciones completas. Uso:
//   OPENROUTER_API_KEY=... npx tsx scripts/eval-conversaciones.mjs
// Importa por subpath directo (tsx no surfacea el barrel export *).
import { MemorySaver } from "@langchain/langgraph";
import { runIris } from "../packages/agent/src/graph.ts";
import { extractRequest, createChatModel } from "../packages/agent/src/extractor.ts";
import { createComposerModel, composeReply } from "../packages/agent/src/composer.ts";
import { matchInventory } from "../packages/db/src/queries/inventario.ts";

// Inventario en memoria (con atributos técnicos + foto), envuelto como un DbClient falso.
const STOCK = [
  { id: "1", nombre: "Esmeralda Muzo 1.26 ct", forma: "corte_esmeralda", peso_ct: 1.26,
    precio_usd_ct: 5800, cantidad_piedras: 1, media_url: "https://example.com/muzo126.jpg",
    disponible: true, notas: "selección Muzo, brillo alto",
    color: "verde vívido", origen: "Muzo", claridad: "jardín leve", tratamiento: "menor" },
  { id: "2", nombre: "Esmeralda oval 1.80 ct", forma: "oval", peso_ct: 1.80,
    precio_usd_ct: 4200, cantidad_piedras: 1, media_url: "https://example.com/oval180.jpg",
    disponible: true, notas: "verde medio, muy limpia",
    color: "verde medio", origen: "Coscuez", claridad: "limpia", tratamiento: "insignificante" },
];
const fakeDb = {
  from: () => ({ select: () => ({ eq: async () => ({ data: STOCK, error: null }) }) }),
};

const model = createChatModel();
const composerModel = createComposerModel();

function nuevaSesion(telegramUserId) {
  const log = [];
  const checkpointer = new MemorySaver();
  let previas = [];
  const deps = {
    extract: (text) => extractRequest(model, text),
    saveLead: async () => ({ id: "x" }),
    notifySeller: async () => {},
    matchInventory: (s) => matchInventory(fakeDb, s),
    compose: (brief) => composeReply(composerModel, brief),
    getHistory: async () => previas,
    checkpointer,
  };
  return {
    async turn(text) {
      previas = [...log];
      log.push({ rol: "comprador", texto: text });
      const out = await runIris(deps, { telegramUserId, chatId: telegramUserId, text });
      log.push({ rol: "agente", texto: out.reply });
      return out;
    },
  };
}

const conversaciones = {
  "C2 — esmeralda inversión": [
    "Quiero una esmeralda de 1 a 2 ct aproximadamente tienes algo interesante?",
    "Me gustaría guardar y saber si se va a valorizar con el tiempo",
    "Y cuál es el mejor precio que me puedes dar para eso?",
    "Qué otras opciones tienes?",
    "Tienes fotos?",
    "Mi presupuesto es de 8.000 usd",
    "Me gustaría en oro amarillo, talla 7 US",
    "Por cuánto saldría la pieza total?",
  ],
  "C1 — anillo elegante": [
    "Hola quisiera comprar una piedra pero no sé cuál quede mejor en mi",
    "La quiero para que mi mano se vea estilizada y elegante, pero que no sea tan llamativa",
    "Podría estar en un presupuesto bajo-medio",
    "Vale pero quisiera saber qué opciones tienes",
    "Y que son quilates? No entiendo bien ese mundo",
  ],
};

const ROJO = /asesor de M[eé]raldi.*(contact|comunic|pondr[áa])/i;
let userId = 1000;
for (const [titulo, mensajes] of Object.entries(conversaciones)) {
  console.log(`\n\n########## ${titulo} ##########`);
  const ses = nuevaSesion(userId++);
  for (const m of mensajes) {
    const out = await ses.turn(m);
    console.log(`\n🧑 ${m}`);
    console.log(`💚 ${out.reply}`);
    if (out.mediaUrl) console.log(`   📷 (enviaría foto: ${out.mediaUrl})`);
    if (ROJO.test(out.reply)) console.log(`   ⚠️  MULETILLA: deriva a asesor`);
  }
}
console.log("\n\nRevisar manualmente: ¿explica quilates? ¿responde valorización sin prometer rentabilidad? ¿ofrece alternativa? ¿cotiza total? ¿sin muletilla salvo cierre real?");
```

- [ ] **Step 2: Verificar que el harness corre (manual, requiere API key)**

Run: `OPENROUTER_API_KEY=<clave> npx tsx scripts/eval-conversaciones.mjs`
Expected: imprime ambas conversaciones; inspeccionar que: explica qué son los quilates; responde la valorización con honestidad (sin prometer rentabilidad); ofrece una alternativa ante "¿otras opciones?"; aporta el total (≈ 7308 USD para la de 1.26 ct); marca 📷 al pedir fotos; y `⚠️ MULETILLA` no aparece salvo en un cierre legítimo.

> Si el modelo no provee la clave, el paso se documenta como pendiente de correr por el usuario; no bloquea el merge de la feature (los tests automáticos sí deben estar verdes).

- [ ] **Step 3: Commit**

```bash
git add scripts/eval-conversaciones.mjs
git -c skill.commit=true commit -m "chore(agent): harness manual de conversaciones (reproduce las capturas)"
```

---

## Self-Review

**Spec coverage:**
- §4.1 módulo de conocimiento → Task 1. ✅
- §4.2 columnas técnicas nullable + `Piedra` + cascada → Task 2 (columnas+tipo) y Task 4 (cascada en el prompt). ✅
- §4.3 brief enriquecido (piedra completa + total + presupuesto + historial) → Task 3 (estructura) + Task 5 (historial real). ✅
- §4.4 prompt reescrito (educa/responde/presenta/avanza, honestidad, reserva del asesor) → Task 4. ✅
- §4.5 sin cierre-muerto → Task 4 (reserva del "asesor" en el prompt) — la persistencia del lead se mantiene (graph.test.ts intacto). ✅
- §4.6 envío de fotos → Task 6. ✅
- §4.7 historial desde `lead_messages` → Task 5 (+ Task 7 webhook). ✅
- §6 pruebas (composer unit, no-regresión, guía, migración, harness) → Tasks 1–8. ✅

**Placeholder scan:** sin TBD/TODO; cada paso trae código o comando concreto. ✅

**Type consistency:** `getHistory(): Promise<{ rol: "comprador" | "agente"; texto: string }[]>` idéntico en `IrisDeps` (Task 5), `getRecentMessages` (Task 5) y `ComposeBrief.history` (Task 3). `mediaUrl: string | null` idéntico en `State`, retorno de `runIris` y nodos (Task 6). `GUIA_HECHOS` exportado en Task 1 y consumido en Task 4. ✅

**No-regresión:** `graph.test.ts` y `graph.compose.test.ts` no se modifican; todos los cambios al grafo son aditivos (deps opcionales, campo de estado extra). El test de MAX_RONDAS verifica persistencia (no el texto del reply), así que la eliminación de la muletilla vía prompt no lo afecta. ✅
