# Iris asesora conversacional bilingüe con voz Méraldi — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Convertir a Iris de embudo de captura (que cierra abruptamente y deriva al asesor) en una asesora que conversa indefinidamente, responde preguntas sobre esmeraldas (guía curada + fallback a la biblia completa), adopta la voz real de Méraldi y solo entrega a un humano para cerrar el trato.

**Architecture:** Grafo LangGraph lineal (`extractor → validador → clasificador → efectos → responder`), sin la guillotina `MAX_RONDAS`. El branching vive en el valor de `intent` (no en aristas). Conocimiento en dos niveles: GUÍA curada bilingüe siempre en el prompt + biblia completa inyectada solo cuando el clasificador marca `preguntaProfunda`. Las capas LLM nuevas (clasificador, biblia) son dependencias opcionales con fallback determinista, para que la suite existente pruebe no-regresión.

**Tech Stack:** TypeScript, LangGraph 1.2.7, `@langchain/openai` (ChatOpenAI vía OpenRouter, `gpt-4o-mini`), zod, node:test + tsx, monorepo turbo/npm-workspaces.

## Global Constraints

- **Modelo:** `openai/gpt-4o-mini` vía OpenRouter (`createChatModel`), no cambiar.
- **Versiones LangChain pineadas** (no tocar): `@langchain/core@1.1.41`, `@langchain/langgraph@1.2.7`. No usar `--legacy-peer-deps`.
- **Imports con extensión `.js`** en todo el código TS (ESM/NodeNext), aunque el archivo sea `.ts`.
- **`@iris/agent` y `@iris/types` tienen `main` → `src/index.ts`** (TS fuente) → `tsx` SÍ surfacea valores de barrels `export *`. Importar desde el barrel `@iris/types` funciona; `@iris/db` apunta a build → importar por subpath.
- **Persistencia/efectos van ANTES de la llamada al redactor** (un fallo del LLM no debe saltarlos).
- **Guardarraíl de honestidad (preservar):** Iris solo usa datos del brief/inventario; NUNCA inventa precios, piedras, orígenes, quilates, descuentos ni disponibilidad.
- **Comando de test por paquete:** `npm test --workspace=@iris/<pkg>` (equivale a `tsx --test "src/**/__tests__/**/*.test.ts"`). Un archivo suelto: `cd packages/<pkg> && npx tsx --test src/__tests__/<archivo>.test.ts`.
- **Type-check:** `npm run type-check --workspace=@iris/<pkg>`.
- **Commit con guard:** si `git commit` es bloqueado, usar `git -c skill.commit=true commit`. Trabajar en la rama `docs/iris-asesora-conversacional` (ya creada) o una feature branch; NUNCA push directo a `main`.
- **Smoke-run obligatorio** de cualquier script nuevo antes de darlo por bueno (`node --check` o import dry-run). Un script committeado pero nunca corrido es código no verificado.

---

## Task 1: Expandir el tipo `ComposeBrief` (nuevos intents + preguntaProfunda)

**Files:**
- Modify: `packages/types/src/compose.ts`
- Test: `packages/types/src/__tests__/schema.test.ts` (no requiere cambio; es de tipos)

**Interfaces:**
- Produces: `ComposeBrief.intent: "aclarar" | "cerrar" | "asesorar" | "handoff"`; `ComposeBrief.preguntaProfunda?: boolean`.

- [ ] **Step 1: Editar el tipo**

En `packages/types/src/compose.ts`, cambiar la línea del `intent` y añadir `preguntaProfunda`:

```ts
export interface ComposeBrief {
  intent: "aclarar" | "cerrar" | "asesorar" | "handoff";
  /** Último mensaje del cliente, para acusar recibo. */
  userMessage: string;
  /** Solo los campos críticos ya capturados (para reconocer lo dicho). */
  known: Partial<Solicitud>;
  /** Campos críticos faltantes, priorizados; el redactor pide 1-2. */
  missing: CampoCritico[];
  /** Piedras reales que encajan (puede ir vacío). */
  stones: Piedra[];
  /** Presupuesto conocido del cliente (para conectar la recomendación). */
  presupuesto?: Solicitud["presupuesto"];
  /** Últimos mensajes de la conversación, en orden cronológico. */
  history?: { rol: "comprador" | "agente"; texto: string }[];
  /** Presente solo cuando intent="cerrar". */
  cierre?: "completo" | "incompleto";
  /** true → el redactor debe apoyarse en la biblia completa (pregunta gemológica profunda). */
  preguntaProfunda?: boolean;
}
```

- [ ] **Step 2: Type-check del paquete types**

Run: `npm run type-check --workspace=@iris/types`
Expected: sin errores.

- [ ] **Step 3: Type-check del paquete agent (consumidor)**

Run: `npm run type-check --workspace=@iris/agent`
Expected: sin errores (la unión es compatible hacia atrás; `"aclarar"`/`"cerrar"` siguen siendo válidos).

- [ ] **Step 4: Commit**

```bash
git add packages/types/src/compose.ts
git -c skill.commit=true commit -m "feat(types): ComposeBrief admite intents asesorar/handoff y preguntaProfunda"
```

---

## Task 2: Módulo de clasificación de intención (`intent.ts`)

**Files:**
- Create: `packages/agent/src/intent.ts`
- Create: `packages/agent/src/__tests__/intent.test.ts`
- Modify: `packages/agent/src/index.ts`

**Interfaces:**
- Consumes: `StructuredModel` de `./extractor.js`.
- Produces: `type IntentFlags = { handoff: boolean; preguntaProfunda: boolean }`; `IntentSchema` (zod); `DEFAULT_INTENT: IntentFlags`; `classifyIntent(model: StructuredModel, text: string): Promise<IntentFlags>`; `INTENT_SYSTEM_PROMPT: string`.

- [ ] **Step 1: Escribir el test que falla**

Crear `packages/agent/src/__tests__/intent.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { classifyIntent, INTENT_SYSTEM_PROMPT, DEFAULT_INTENT, type IntentFlags } from "../intent.js";
import type { StructuredModel } from "../extractor.js";

function fakeModel(fixture: unknown, captured: { input?: unknown }): StructuredModel {
  return {
    withStructuredOutput() {
      return { invoke: async (input: unknown) => { captured.input = input; return fixture; } };
    },
  };
}

test("classifyIntent devuelve las banderas validadas y pasa el system prompt", async () => {
  const captured: { input?: unknown } = {};
  const model = fakeModel({ handoff: true, preguntaProfunda: false }, captured);
  const out = await classifyIntent(model, "quiero comprar esta, ¿cómo pago?");
  assert.deepEqual(out, { handoff: true, preguntaProfunda: false });
  const msgs = captured.input as Array<{ role: string; content: string }>;
  assert.equal(msgs[0].role, "system");
  assert.equal(msgs[0].content, INTENT_SYSTEM_PROMPT);
  assert.equal(msgs[1].content, "quiero comprar esta, ¿cómo pago?");
});

test("classifyIntent rechaza salidas mal formadas", async () => {
  const model = fakeModel({ handoff: "sí" }, {});
  await assert.rejects(() => classifyIntent(model, "texto"));
});

test("DEFAULT_INTENT es todo-false", () => {
  assert.deepEqual(DEFAULT_INTENT, { handoff: false, preguntaProfunda: false } satisfies IntentFlags);
});

test("INTENT_SYSTEM_PROMPT describe handoff y preguntaProfunda", () => {
  assert.match(INTENT_SYSTEM_PROMPT, /handoff/i);
  assert.match(INTENT_SYSTEM_PROMPT, /profunda|profund/i);
});
```

- [ ] **Step 2: Correr el test para verificar que falla**

Run: `cd packages/agent && npx tsx --test src/__tests__/intent.test.ts`
Expected: FAIL (`Cannot find module '../intent.js'`).

- [ ] **Step 3: Implementar `intent.ts`**

Crear `packages/agent/src/intent.ts`:

```ts
import { z } from "zod";
import type { StructuredModel } from "./extractor.js";

export const IntentSchema = z.object({
  handoff: z.boolean(),
  preguntaProfunda: z.boolean(),
});

export type IntentFlags = z.infer<typeof IntentSchema>;

export const DEFAULT_INTENT: IntentFlags = { handoff: false, preguntaProfunda: false };

export const INTENT_SYSTEM_PROMPT = `Clasificas el mensaje de un comprador de esmeraldas de la casa Méraldi en dos banderas booleanas. El mensaje puede estar en español o inglés.

- handoff: true SOLO si el cliente quiere avanzar a un cierre humano: comprar/pagar ahora, pedir un certificado (GIA/internacional), pedir una joya a medida o montaje, coordinar envío/pago, o pedir explícitamente hablar con una persona. false si solo pregunta, explora, pide fotos o información.
- preguntaProfunda: true si hace una pregunta de gemología de DETALLE que excede lo común: geología de depósitos, pleocroísmo, índices de refracción/espectros, cristalografía, historia, diferencias finas de determinación de origen entre laboratorios. false para preguntas comunes: precio, color, tratamiento/aceite/perma, jardín/inclusiones, origen general (Muzo/Chivor), certificación básica, cuidado.

Responde solo con las dos banderas.`;

export async function classifyIntent(model: StructuredModel, text: string): Promise<IntentFlags> {
  const structured = model.withStructuredOutput(IntentSchema, { name: "intent" });
  const raw = await structured.invoke([
    { role: "system", content: INTENT_SYSTEM_PROMPT },
    { role: "user", content: text },
  ]);
  return IntentSchema.parse(raw);
}
```

- [ ] **Step 4: Exportar desde el barrel**

En `packages/agent/src/index.ts`, añadir tras la línea del extractor:

```ts
export { classifyIntent, IntentSchema, DEFAULT_INTENT, INTENT_SYSTEM_PROMPT, type IntentFlags } from "./intent.js";
```

- [ ] **Step 5: Correr el test para verificar que pasa**

Run: `cd packages/agent && npx tsx --test src/__tests__/intent.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 6: Commit**

```bash
git add packages/agent/src/intent.ts packages/agent/src/__tests__/intent.test.ts packages/agent/src/index.ts
git -c skill.commit=true commit -m "feat(agent): clasificador de intención (handoff / preguntaProfunda)"
```

---

## Task 3: Estado del grafo — intent y flags de notificación

**Files:**
- Modify: `packages/agent/src/state.ts`

**Interfaces:**
- Consumes: `IntentFlags`, `DEFAULT_INTENT` de `./intent.js`.
- Produces: `State.intent: IntentFlags`; `State.vendedorNotificado: boolean`; `State.handoffNotificado: boolean` (todos last-write).

- [ ] **Step 1: Editar `state.ts`**

En `packages/agent/src/state.ts`, añadir el import y los tres campos al `Annotation.Root`:

```ts
import { Annotation } from "@langchain/langgraph";
import type { Solicitud, CampoCritico, EstadoLead } from "@iris/types";
import { mergeRequest } from "./request.js";
import { type IntentFlags, DEFAULT_INTENT } from "./intent.js";

const lastWrite = <T>(def: T) => ({ reducer: (_p: T, n: T) => n, default: () => def });

export const IrisState = Annotation.Root({
  inputText: Annotation<string>(lastWrite("")),
  telegramUserId: Annotation<number>(lastWrite(0)),
  telegramUsername: Annotation<string | null>(lastWrite<string | null>(null)),
  chatId: Annotation<number>(lastWrite(0)),
  solicitud: Annotation<Solicitud>({
    reducer: (p, n) => mergeRequest(p ?? {}, n ?? {}),
    default: () => ({}),
  }),
  rondas: Annotation<number>({
    reducer: (p, n) => (p ?? 0) + (n ?? 0),
    default: () => 0,
  }),
  estado: Annotation<EstadoLead>(lastWrite<EstadoLead>("incompleto")),
  camposFaltantes: Annotation<CampoCritico[]>(lastWrite<CampoCritico[]>([])),
  reply: Annotation<string>(lastWrite("")),
  mediaUrl: Annotation<string | null>(lastWrite<string | null>(null)),
  intent: Annotation<IntentFlags>(lastWrite<IntentFlags>(DEFAULT_INTENT)),
  vendedorNotificado: Annotation<boolean>(lastWrite(false)),
  handoffNotificado: Annotation<boolean>(lastWrite(false)),
});

export type State = typeof IrisState.State;
```

- [ ] **Step 2: Type-check**

Run: `npm run type-check --workspace=@iris/agent`
Expected: sin errores.

- [ ] **Step 3: Correr la suite del agente (aún verde salvo lo que cambiaremos luego)**

Run: `npm test --workspace=@iris/agent`
Expected: PASS excepto que aún no tocamos el grafo; todo verde en este punto.

- [ ] **Step 4: Commit**

```bash
git add packages/agent/src/state.ts
git -c skill.commit=true commit -m "feat(agent): estado con intent y flags de notificación (vendedor/handoff)"
```

---

## Task 4: Ingestar la biblia completa como asset (`knowledge/biblia.ts`)

**Files:**
- Create: `packages/agent/src/knowledge/biblia-completa.md` (copia fuente)
- Create: `scripts/generate-biblia.mjs` (generador)
- Create: `packages/agent/src/knowledge/biblia.ts` (generado; export string)
- Create: `packages/agent/src/__tests__/biblia.test.ts`
- Modify: `packages/agent/src/index.ts`

**Interfaces:**
- Produces: `BIBLIA_COMPLETA: string` (export desde `./knowledge/biblia.js`).

- [ ] **Step 1: Copiar la biblia fuente al repo**

```bash
mkdir -p packages/agent/src/knowledge
cp "/c/Users/jzorr/Downloads/BIBLIA_COMPLETA.md" packages/agent/src/knowledge/biblia-completa.md
```

- [ ] **Step 2: Escribir el generador**

Crear `scripts/generate-biblia.mjs` (usa `JSON.stringify` para escapado seguro de backticks/`${}`):

```js
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const src = join(here, "..", "packages", "agent", "src", "knowledge", "biblia-completa.md");
const out = join(here, "..", "packages", "agent", "src", "knowledge", "biblia.ts");

const md = readFileSync(src, "utf8");
const content = `/** Generado por scripts/generate-biblia.mjs desde biblia-completa.md. NO editar a mano. */
export const BIBLIA_COMPLETA = ${JSON.stringify(md)};
`;
writeFileSync(out, content, "utf8");
console.log(`biblia.ts generado (${md.length} chars)`);
```

- [ ] **Step 3: Correr el generador (smoke-run)**

Run: `node scripts/generate-biblia.mjs`
Expected: imprime `biblia.ts generado (~137000 chars)` y crea `packages/agent/src/knowledge/biblia.ts`.

- [ ] **Step 4: Escribir el test**

Crear `packages/agent/src/__tests__/biblia.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { BIBLIA_COMPLETA } from "../knowledge/biblia.js";

test("BIBLIA_COMPLETA está cargada y tiene los módulos", () => {
  assert.ok(BIBLIA_COMPLETA.length > 50000, "la biblia debe tener contenido sustancial");
  assert.match(BIBLIA_COMPLETA, /BIBLIA DEL CONOCIMIENTO MERALDI/);
  assert.match(BIBLIA_COMPLETA, /Módulo 05/); // minas colombianas
});
```

- [ ] **Step 5: Exportar desde el barrel**

En `packages/agent/src/index.ts`, añadir:

```ts
export { BIBLIA_COMPLETA } from "./knowledge/biblia.js";
```

- [ ] **Step 6: Correr el test**

Run: `cd packages/agent && npx tsx --test src/__tests__/biblia.test.ts`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/agent/src/knowledge/ scripts/generate-biblia.mjs packages/agent/src/__tests__/biblia.test.ts packages/agent/src/index.ts
git -c skill.commit=true commit -m "feat(agent): biblia completa como asset (nivel 2 de conocimiento)"
```

---

## Task 5: GUÍA Méraldi curada y bilingüe (nivel 1)

**Files:**
- Modify: `packages/agent/src/guia.ts`
- Test: `packages/agent/src/__tests__/guia.test.ts` (crear si no existe / ampliar)

**Interfaces:**
- Produces: `GUIA_HECHOS: string` (mismo nombre de export; contenido ampliado y bilingüe). Se conserva el nombre para no romper `composer.ts` ni `index.ts`.

**Nota de ejecución:** el contenido curado se destila de `biblia-completa.md`. Durante la ejecución, **despachar un subagente** con esta instrucción: *"Lee `packages/agent/src/knowledge/biblia-completa.md`. Destila una GUÍA de conocimiento común para un asesor de esmeraldas, en ~3000-4500 palabras, cubriendo SOLO temas frecuentes del comprador: las 6 variables (peso/color/claridad/corte/origen/tratamiento), precio y cómo se explica, tratamiento/aceite/perma, jardín/inclusiones, orígenes (Muzo, Chivor, Coscuez, La Pita, Gachalá; comparación Zambia/Brasil), certificación (local vs GIA), valorización con honestidad (sin prometer rentabilidad), cuidado de la piedra, identidad de casa colombiana. Prioriza las secciones FAQ, 'Mitos y cómo responderlos' y 'voz Méraldi' de la biblia. Formato: hechos declarativos, NO narrativa de venta. Añade en cada bloque una línea 'EN:' con el equivalente esencial en inglés para que el redactor pueda responder bilingüe. Devuelve solo el texto de la guía."* Revisar el resultado a mano antes de pegarlo.

- [ ] **Step 1: Escribir/ampliar el test**

Crear o reemplazar `packages/agent/src/__tests__/guia.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { GUIA_HECHOS } from "../guia.js";

test("GUIA_HECHOS cubre los temas comunes y es sustancial", () => {
  assert.ok(GUIA_HECHOS.length > 4000, "la guía curada debe ser sustancial");
  for (const term of [/quilate/i, /color/i, /jard[ií]n|inclusion/i, /tratamiento|aceite/i, /Muzo/i, /Chivor/i, /certificad|GIA/i, /patrimonio tangible/i]) {
    assert.match(GUIA_HECHOS, term, `falta el tema ${term}`);
  }
});

test("GUIA_HECHOS incluye apoyo bilingüe (marcas EN:)", () => {
  assert.match(GUIA_HECHOS, /EN:/);
});
```

- [ ] **Step 2: Correr el test para verificar que falla**

Run: `cd packages/agent && npx tsx --test src/__tests__/guia.test.ts`
Expected: FAIL (la guía actual es corta y sin marcas `EN:`).

- [ ] **Step 3: Reemplazar el contenido de `guia.ts`**

Sustituir la constante `GUIA_HECHOS` en `packages/agent/src/guia.ts` por el texto curado bilingüe producido por el subagente. Mantener la firma:

```ts
export const GUIA_HECHOS = `...(texto curado bilingüe, ~3000-4500 palabras, con líneas EN: por bloque)...`;
```

Requisitos verificables del contenido (los cubre el test): >4000 chars; menciona quilate, color, jardín/inclusiones, tratamiento/aceite, Muzo, Chivor, certificado/GIA, "patrimonio tangible"; incluye al menos una marca `EN:`. Debe preservar las reglas de honestidad (valorización sin promesas, precio total de la piedra sí / joya terminada la afina un asesor).

- [ ] **Step 4: Correr el test para verificar que pasa**

Run: `cd packages/agent && npx tsx --test src/__tests__/guia.test.ts`
Expected: PASS.

- [ ] **Step 5: Verificar que composer.test.ts sigue verde** (usa `GUIA_HECHOS`)

Run: `cd packages/agent && npx tsx --test src/__tests__/composer.test.ts`
Expected: PASS (el prompt sigue incluyendo `GUIA_HECHOS`).

- [ ] **Step 6: Commit**

```bash
git add packages/agent/src/guia.ts packages/agent/src/__tests__/guia.test.ts
git -c skill.commit=true commit -m "feat(agent): GUIA Méraldi curada y bilingüe (nivel 1 de conocimiento)"
```

---

## Task 6: Redactor — voz Méraldi, intents nuevos, idioma auto y fallback a biblia

**Files:**
- Modify: `packages/agent/src/composer.ts`
- Test: `packages/agent/src/__tests__/composer.test.ts` (ampliar; NO romper lo existente)

**Interfaces:**
- Consumes: `GUIA_HECHOS` de `./guia.js`; `BIBLIA_COMPLETA` de `./knowledge/biblia.js`; `ComposeBrief` (con `intent` ampliado y `preguntaProfunda`).
- Produces: `COMPOSE_SYSTEM_PROMPT` (constante, común, sin biblia); `composeReply` inyecta la biblia solo si `brief.preguntaProfunda`.

**Diseño:** `COMPOSE_SYSTEM_PROMPT` se mantiene como constante (para no romper `composer.test.ts`, que compara `visto[0].content === COMPOSE_SYSTEM_PROMPT` con un brief sin `preguntaProfunda`). Se le AÑADE: sección VOZ + few-shot, instrucción de idioma auto, e instrucciones para los intents `asesorar`/`handoff`. `composeReply` antepone la biblia solo cuando `brief.preguntaProfunda === true`.

- [ ] **Step 1: Escribir los tests nuevos (además de los existentes)**

Añadir a `packages/agent/src/__tests__/composer.test.ts`:

```ts
import { BIBLIA_COMPLETA } from "../knowledge/biblia.js";

test("COMPOSE_SYSTEM_PROMPT incluye la sección de VOZ y la regla de idioma", () => {
  assert.match(COMPOSE_SYSTEM_PROMPT, /VOZ|voz de M[eé]raldi/i);
  assert.match(COMPOSE_SYSTEM_PROMPT, /idioma|inglés|español|language/i);
  assert.match(COMPOSE_SYSTEM_PROMPT, /asesorar/i);   // instrucción para modo asesor
  assert.match(COMPOSE_SYSTEM_PROMPT, /handoff|cerrar el trato|finaliza/i);
});

test("composeReply inyecta la biblia cuando preguntaProfunda=true", async () => {
  let visto: Array<{ role: string; content: string }> = [];
  const fake: ChatModel = {
    invoke: async (input) => { visto = input as Array<{ role: string; content: string }>; return { content: "ok" }; },
  };
  await composeReply(fake, { ...brief, preguntaProfunda: true });
  assert.ok(visto[0].content.includes(BIBLIA_COMPLETA), "el system debe incluir la biblia");
});

test("composeReply NO inyecta la biblia por defecto", async () => {
  let visto: Array<{ role: string; content: string }> = [];
  const fake: ChatModel = {
    invoke: async (input) => { visto = input as Array<{ role: string; content: string }>; return { content: "ok" }; },
  };
  await composeReply(fake, brief); // sin preguntaProfunda
  assert.equal(visto[0].content, COMPOSE_SYSTEM_PROMPT);
});
```

- [ ] **Step 2: Correr para ver fallar los nuevos**

Run: `cd packages/agent && npx tsx --test src/__tests__/composer.test.ts`
Expected: FAIL en los 3 tests nuevos; los 6 existentes siguen PASS.

- [ ] **Step 3: Editar `composer.ts`**

(a) Añadir el import de la biblia al inicio:

```ts
import { GUIA_HECHOS } from "./guia.js";
import { BIBLIA_COMPLETA } from "./knowledge/biblia.js";
```

(b) Ampliar `COMPOSE_SYSTEM_PROMPT`: (1) reemplazar la línea de intro para permitir bilingüe; (2) insertar la sección VOZ + few-shot antes del bloque de reglas de honestidad; (3) añadir instrucciones de intent. Insertar este bloque VOZ dentro del template (por ejemplo, tras el párrafo de "Fuente de los datos de la piedra"):

```
Detecta el idioma del cliente (cliente_dijo) y responde SIEMPRE en ese idioma (español o inglés).

Según el campo intent del brief:
- "aclarar": aún faltan datos. Responde dudas y pide 1 dato (máx 2) de falta_por_preguntar.
- "asesorar": ya tenemos lo esencial. Sigue conversando: responde, educa, refuerza la piedra que encaja y propone el siguiente paso. NO cierres ni derives.
- "handoff": el cliente quiere cerrar el trato (comprar, certificado o joya a medida). Confírmalo con calidez y dile que un asesor de Méraldi lo contactará para finalizar.
- "cerrar": cierre del lead (compatibilidad).

=== VOZ de Méraldi (imítala) ===
Cálida, consultiva, de par a par; nunca presiona. El precio se da directo y sin rodeos, anclado a calidad/origen. Al presentar una piedra, usa el origen/región como gancho, luego quilates/medidas, luego precio. Mensajes breves. Ante objeción de precio, no defiendas el número: ofrece otra opción de piedras_que_encajan o agrega valor. Palancas de confianza: trazabilidad, honestidad de tratamiento (aceite/perma), rareza. En español usa un tono colombiano cercano ("con gusto", "de una", "te la comparto"); modera los emojis. NUNCA inventes precios, piedras, orígenes, quilates ni descuentos: usa solo el brief.
Ejemplos de tono (no copiar literal, solo el estilo):
ES: "Esta viene de la región de Muzo, conocida por su verde intenso; su valor está en el color y el bajo tratamiento."
ES: "Con gusto te la comparto. Si quieres, te muestro otra opción que se ajusta más a tu presupuesto."
EN: "This one comes from the Muzo region, known for its deep green. The price is USD 2,200; when you see it in person it looks even better than in photos."
```

(c) Reemplazar `composeReply` para inyectar la biblia condicionalmente:

```ts
export async function composeReply(model: ChatModel, brief: ComposeBrief): Promise<string> {
  const system = brief.preguntaProfunda
    ? `${COMPOSE_SYSTEM_PROMPT}\n\n=== BIBLIA (conocimiento profundo, úsala para responder con fidelidad) ===\n${BIBLIA_COMPLETA}`
    : COMPOSE_SYSTEM_PROMPT;
  const res = await model.invoke([
    { role: "system", content: system },
    { role: "user", content: renderBriefForPrompt(brief) },
  ]);
  const text = typeof res.content === "string" ? res.content : String(res.content ?? "");
  return text.trim();
}
```

- [ ] **Step 4: Correr toda la suite del composer**

Run: `cd packages/agent && npx tsx --test src/__tests__/composer.test.ts`
Expected: PASS (9 tests: 6 existentes + 3 nuevos).

- [ ] **Step 5: Commit**

```bash
git add packages/agent/src/composer.ts packages/agent/src/__tests__/composer.test.ts
git -c skill.commit=true commit -m "feat(agent): redactor con voz Méraldi, intents asesorar/handoff, idioma auto y fallback a biblia"
```

---

## Task 7: `buildComposeBrief` admite intents nuevos y pasa preguntaProfunda

**Files:**
- Modify: `packages/agent/src/brief.ts`
- Test: `packages/agent/src/__tests__/brief.test.ts` (ampliar)

**Interfaces:**
- Produces: `buildComposeBrief` acepta `intent: "aclarar" | "cerrar" | "asesorar" | "handoff"` y `preguntaProfunda?: boolean`, y los copia al `ComposeBrief`.

- [ ] **Step 1: Añadir el test**

Añadir a `packages/agent/src/__tests__/brief.test.ts`:

```ts
test("buildComposeBrief soporta intent asesorar y copia preguntaProfunda", () => {
  const brief = buildComposeBrief({
    intent: "asesorar",
    userMessage: "¿qué es el pleocroísmo?",
    solicitud: { proposito: "coleccion" },
    missing: [],
    stones: [],
    preguntaProfunda: true,
  });
  assert.equal(brief.intent, "asesorar");
  assert.equal(brief.preguntaProfunda, true);
  assert.equal(brief.cierre, undefined);
});
```

- [ ] **Step 2: Correr para ver fallar (tipo/valor)**

Run: `cd packages/agent && npx tsx --test src/__tests__/brief.test.ts`
Expected: FAIL de compilación de tipos (`intent: "asesorar"` no asignable) y/o `preguntaProfunda` ausente.

- [ ] **Step 3: Editar `brief.ts`**

Cambiar la firma de `input.intent` y añadir el passthrough de `preguntaProfunda`:

```ts
export function buildComposeBrief(input: {
  intent: "aclarar" | "cerrar" | "asesorar" | "handoff";
  userMessage: string;
  solicitud: Solicitud;
  missing: CampoCritico[];
  stones: Piedra[];
  cierre?: "completo" | "incompleto";
  history?: { rol: "comprador" | "agente"; texto: string }[];
  preguntaProfunda?: boolean;
}): ComposeBrief {
  const missingSet = new Set<CampoCritico>(input.missing);
  const knownAll = pickKnownCriticos(input.solicitud);
  const known: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(knownAll)) {
    if (!missingSet.has(k as CampoCritico)) known[k] = v;
  }
  return {
    intent: input.intent,
    userMessage: input.userMessage,
    known: known as Partial<Solicitud>,
    missing: input.missing,
    stones: input.stones,
    presupuesto: input.solicitud.presupuesto,
    history: input.history ?? [],
    ...(input.cierre ? { cierre: input.cierre } : {}),
    ...(input.preguntaProfunda ? { preguntaProfunda: true } : {}),
  };
}
```

- [ ] **Step 4: Correr el test**

Run: `cd packages/agent && npx tsx --test src/__tests__/brief.test.ts`
Expected: PASS (los 4 existentes + el nuevo).

- [ ] **Step 5: Commit**

```bash
git add packages/agent/src/brief.ts packages/agent/src/__tests__/brief.test.ts
git -c skill.commit=true commit -m "feat(agent): buildComposeBrief soporta intents asesorar/handoff y preguntaProfunda"
```

---

## Task 8: Refactor del grafo — flujo lineal, sin guillotina, con efectos idempotentes

**Files:**
- Modify: `packages/agent/src/graph.ts`
- Test: `packages/agent/src/__tests__/graph.test.ts` (reemplazar el test de MAX_RONDAS; añadir nuevos)

**Interfaces:**
- Consumes: `classifyIntent` opcional (dep); `DEFAULT_INTENT`; `IntentFlags`; `buildComposeBrief`; `composeReply` (vía `deps.compose`).
- Produces: `IrisDeps.classifyIntent?: (text: string) => Promise<IntentFlags>`. `runIris` mantiene su firma `{ reply, estado, mediaUrl }`. Nodos `clasificador`, `efectos`, `responder`; se elimina `route`/`preguntar`/`persistir`.

- [ ] **Step 1: Reemplazar el test de MAX_RONDAS y añadir los nuevos**

En `packages/agent/src/graph.test.ts`: **borrar** el test `"tras MAX_RONDAS turnos incompletos persiste como incompleto y notifica"` (líneas 74-97) y añadir:

```ts
import { DEFAULT_INTENT } from "../intent.js";

test("no cierra ni persiste tras muchos turnos incompletos (sin guillotina)", async () => {
  const saved: LeadRow[] = [];
  const seller: string[] = [];
  const cp = new MemorySaver();
  const deps: IrisDeps = {
    extract: async () => ({ proposito: "joyeria" }),
    saveLead: async (r) => { saved.push(r); return { id: "x" }; },
    notifySeller: async (t) => { seller.push(t); },
    checkpointer: cp,
  };
  for (let i = 0; i < 6; i++) {
    const { estado } = await runIris(deps, { telegramUserId: 99, chatId: 99, text: "hmm" });
    assert.equal(estado, "en_aclaracion", `turno ${i + 1} no debe cerrar`);
  }
  assert.equal(saved.length, 0, "nunca persiste un lead incompleto sin handoff");
  assert.equal(seller.length, 0, "nunca notifica sin captura ni handoff");
});

test("tras completar, sigue conversando y NO re-notifica al vendedor", async () => {
  const saved: LeadRow[] = [];
  const seller: string[] = [];
  const cp = new MemorySaver();
  const completa = {
    proposito: "joyeria", tipo_pieza: "gema_tallada", color: { tono: "verde" },
    presupuesto: { max: 5000, moneda: "USD" }, peso_quilates: { min: 1 }, origen: { pais: "colombia" },
  } as const;
  const deps: IrisDeps = {
    extract: async () => ({ ...completa }),
    saveLead: async (r) => { saved.push(r); return { id: "lead-1" }; },
    notifySeller: async (t) => { seller.push(t); },
    checkpointer: cp,
  };
  await runIris(deps, { telegramUserId: 7, chatId: 7, text: "esmeralda verde tallada de Colombia, 1ct, 5000 USD" });
  await runIris(deps, { telegramUserId: 7, chatId: 7, text: "¿y el jardín le resta valor?" });
  assert.equal(seller.length, 1, "el vendedor se notifica una sola vez");
});

test("handoff notifica al vendedor con aviso distinto", async () => {
  const seller: string[] = [];
  const deps: IrisDeps = {
    extract: async () => ({ proposito: "joyeria" }),
    saveLead: async () => ({ id: "x" }),
    notifySeller: async (t) => { seller.push(t); },
    classifyIntent: async () => ({ handoff: true, preguntaProfunda: false }),
    checkpointer: new MemorySaver(),
  };
  await runIris(deps, { telegramUserId: 12, chatId: 12, text: "quiero comprarla, ¿cómo pago?" });
  assert.equal(seller.length, 1);
  assert.match(seller[0], /cerrar|compra|certificado|joya/i);
});

test("sin classifyIntent, el intent cae a DEFAULT (fallback determinista)", async () => {
  let vistoBrief = false;
  const deps: IrisDeps = {
    extract: async () => ({ proposito: "joyeria" }),
    saveLead: async () => ({ id: "x" }),
    notifySeller: async () => {},
    compose: async (brief) => { vistoBrief = brief.preguntaProfunda !== true; return "ok"; },
    checkpointer: new MemorySaver(),
  };
  const { reply } = await runIris(deps, { telegramUserId: 13, chatId: 13, text: "hola" });
  assert.equal(reply, "ok");
  assert.ok(vistoBrief, "sin clasificador, preguntaProfunda no debe activarse");
  assert.deepEqual(DEFAULT_INTENT, { handoff: false, preguntaProfunda: false });
});
```

- [ ] **Step 2: Correr para ver fallar**

Run: `cd packages/agent && npx tsx --test src/__tests__/graph.test.ts`
Expected: FAIL (comportamiento viejo aún cierra por rondas; `classifyIntent` no existe en `IrisDeps`).

- [ ] **Step 3: Reescribir `graph.ts`**

Reemplazar el bloque de nodos y wiring. Cambios concretos:

(a) Imports (añadir):

```ts
import { IrisState, type State } from "./state.js";
import { evaluarEstado } from "./request.js";
import { buildClarificationMessage } from "./questions.js";
import { getCheckpointer } from "./checkpointer.js";
import { buildComposeBrief } from "./brief.js";
import { type IntentFlags, DEFAULT_INTENT } from "./intent.js";
```

(Se elimina el uso de `MAX_RONDAS` en el routing; ya no se importa aquí.)

(b) En `IrisDeps`, añadir:

```ts
  /** Opcional: clasifica el mensaje en {handoff, preguntaProfunda}. Sin ella, se usa DEFAULT_INTENT. */
  classifyIntent?: (text: string) => Promise<IntentFlags>;
```

(c) Reemplazar `route`, `preguntarNode` y `persistirNode` por `clasificadorNode`, `efectosNode`, `responderNode`. Mantener `extractorNode`, `validadorNode`, `buildSellerSummary`, `buildPiedrasPropuestas`, `composeOrFallback` como están.

```ts
async function clasificadorNode(state: State, deps: IrisDeps): Promise<Partial<State>> {
  if (!deps.classifyIntent) return { intent: DEFAULT_INTENT };
  try {
    return { intent: await deps.classifyIntent(state.inputText) };
  } catch (err) {
    console.error("[iris] classifyIntent falló, usando DEFAULT:", err);
    return { intent: DEFAULT_INTENT };
  }
}

async function efectosNode(state: State, deps: IrisDeps): Promise<Partial<State>> {
  const debePersistir = state.estado === "completo" || state.intent.handoff;
  if (!debePersistir) return {};
  const estadoFinal: EstadoLead = state.estado === "completo" ? "completo" : "incompleto";
  const row = buildLeadRow({
    telegramUserId: state.telegramUserId,
    telegramUsername: state.telegramUsername,
    solicitud: state.solicitud,
    estado: estadoFinal,
    camposFaltantes: state.camposFaltantes,
  });
  await deps.saveLead(row);
  const updates: Partial<State> = {};
  if (state.estado === "completo" && !state.vendedorNotificado) {
    const piedras = deps.matchInventory ? await deps.matchInventory(state.solicitud) : [];
    await deps.notifySeller(buildSellerSummary(row) + buildPiedrasPropuestas(piedras));
    updates.vendedorNotificado = true;
  }
  if (state.intent.handoff && !state.handoffNotificado) {
    await deps.notifySeller("🤝 Cliente quiere cerrar el trato (compra / certificado / joya a medida):\n" + buildSellerSummary(row));
    updates.handoffNotificado = true;
  }
  return updates;
}

async function responderNode(state: State, deps: IrisDeps): Promise<Partial<State>> {
  const piedras = deps.matchInventory ? await deps.matchInventory(state.solicitud) : [];
  const briefIntent = state.intent.handoff
    ? "handoff" as const
    : state.estado === "completo" ? "asesorar" as const : "aclarar" as const;
  const fallback =
    briefIntent === "handoff"
      ? "¡Perfecto! Un asesor de Méraldi te contactará para finalizar. 💚" + buildPiedrasPropuestas(piedras)
      : briefIntent === "asesorar"
        ? "Con gusto sigo ayudándote. ¿Qué más te gustaría saber?" + buildPiedrasPropuestas(piedras)
        : buildClarificationMessage(state.camposFaltantes) + buildPiedrasPropuestas(piedras);
  const history = deps.getHistory ? await deps.getHistory() : [];
  const brief = buildComposeBrief({
    intent: briefIntent,
    userMessage: state.inputText,
    solicitud: state.solicitud,
    missing: state.camposFaltantes,
    stones: piedras,
    history,
    preguntaProfunda: state.intent.preguntaProfunda,
  });
  const reply = await composeOrFallback(deps, brief, fallback);
  return { reply, mediaUrl: piedras[0]?.media_url ?? null };
}
```

(d) Reemplazar `buildGraph` por el wiring lineal:

```ts
export async function buildGraph(deps: IrisDeps) {
  const checkpointer = deps.checkpointer ?? (await getCheckpointer());
  const graph = new StateGraph(IrisState)
    .addNode("extractor", (s: State) => extractorNode(s, deps))
    .addNode("validador", validadorNode)
    .addNode("clasificador", (s: State) => clasificadorNode(s, deps))
    .addNode("efectos", (s: State) => efectosNode(s, deps))
    .addNode("responder", (s: State) => responderNode(s, deps))
    .addEdge(START, "extractor")
    .addEdge("extractor", "validador")
    .addEdge("validador", "clasificador")
    .addEdge("clasificador", "efectos")
    .addEdge("efectos", "responder")
    .addEdge("responder", END);
  return graph.compile({ checkpointer });
}
```

`runIris` no cambia. Verificar que el import de `EstadoLead` siga presente (lo usa `efectosNode`).

- [ ] **Step 4: Correr toda la suite del grafo**

Run: `cd packages/agent && npx tsx --test src/__tests__/graph.test.ts`
Expected: PASS. Los tests existentes que sobreviven: "incompleto pide aclaración y no persiste", "propone piedras durante la aclaración", "se completa en el segundo turno → persiste y notifica", "al completar propone piedras", los unit de `buildSellerSummary`/`buildPiedrasPropuestas`, y los 4 nuevos.

- [ ] **Step 5: Correr la suite completa del agente**

Run: `npm test --workspace=@iris/agent`
Expected: PASS (incluye graph.compose/history/media, questions, request, forget, extractor, composer, brief, intent, biblia, guia).

- [ ] **Step 6: Type-check**

Run: `npm run type-check --workspace=@iris/agent`
Expected: sin errores.

- [ ] **Step 7: Commit**

```bash
git add packages/agent/src/graph.ts packages/agent/src/__tests__/graph.test.ts
git -c skill.commit=true commit -m "feat(agent): grafo lineal sin guillotina; modo asesor post-captura + handoff (arregla cierre abrupto)"
```

---

## Task 9: Cablear `classifyIntent` en el webhook de producción

**Files:**
- Modify: `apps/web/src/app/api/telegram/webhook/route.ts`

**Interfaces:**
- Consumes: `classifyIntent` de `@iris/agent`; `createChatModel`.

- [ ] **Step 1: Editar el webhook**

En `apps/web/src/app/api/telegram/webhook/route.ts`:

(a) Añadir `classifyIntent` al import de `@iris/agent`:

```ts
import { runIris, createChatModel, extractRequest, createComposerModel, composeReply, classifyIntent, forgetUser, type IrisDeps } from "@iris/agent";
```

(b) En el objeto `deps`, añadir la línea (reutiliza `model`, temperatura baja ya por defecto en `createChatModel`):

```ts
    extract: (text) => extractRequest(model, text),
    classifyIntent: (text) => classifyIntent(model, text),
    saveLead: (row) => upsertLead(db, row),
```

- [ ] **Step 2: Type-check del app web**

Run: `npm run type-check --workspace=web`
Expected: sin errores. (Si el workspace no se llama `web`, usar el `name` de `apps/web/package.json`.)

- [ ] **Step 3: Build del app web (verifica bundling de la biblia)**

Run: `npm run build --workspace=web`
Expected: build OK; el import de `BIBLIA_COMPLETA` (string) se bundlea sin error.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/app/api/telegram/webhook/route.ts
git -c skill.commit=true commit -m "feat(web): cablear el clasificador de intención en el webhook"
```

---

## Task 10: Verificación end-to-end (suite + build + harness en vivo)

**Files:**
- Usa: `scripts/` (harness de conversaciones existente, ver README/scripts)

- [ ] **Step 1: Suite completa del monorepo**

Run: `npm test`
Expected: PASS en todos los paquetes (`@iris/types`, `@iris/agent`, `@iris/db` si aplica).

- [ ] **Step 2: Type-check completo**

Run: `npm run type-check`
Expected: sin errores.

- [ ] **Step 3: Build completo**

Run: `npm run build`
Expected: OK.

- [ ] **Step 4: Harness en vivo (LLM+DB reales) — verifica el comportamiento nuevo**

Localizar el harness de conversaciones en `scripts/` (el que reproduce descripciones sobre LLM+DB reales). Ejecutarlo con al menos estos casos y revisar la salida a mano:
  1. Conversación de >5 turnos incompletos → Iris **no** cierra ni dice "un asesor te contactará".
  2. Lead completo + pregunta común ("¿el jardín le resta valor?") → responde educando, sin cerrar.
  3. Pregunta profunda ("¿qué es el pleocroísmo del berilo?") → responde con detalle (biblia activada).
  4. "quiero comprarla, ¿cómo pago?" → handoff: avisa que un asesor finaliza + el vendedor recibe aviso distinto.
  5. Mensaje en inglés → responde en inglés.

Expected: los 5 comportamientos correctos. Si el harness no cubre un caso, extenderlo mínimamente (siguiendo su patrón) — y correrlo (no solo revisarlo): un script committeado pero nunca corrido es código no verificado.

- [ ] **Step 5: Commit final (si el harness se extendió)**

```bash
git add scripts/
git -c skill.commit=true commit -m "test(agent): harness cubre modo asesor, handoff, biblia y bilingüe"
```

- [ ] **Step 6: Abrir PR**

```bash
git push -u origin docs/iris-asesora-conversacional
gh pr create --fill --base main
```

No desplegar a producción automáticamente: prod NO se auto-despliega (el merge a `main` solo genera preview). El deploy `vercel --prod --yes` desde la raíz es manual y outward-facing → confirmar con el usuario antes.

---

## Self-Review (hecho)

- **Cobertura del spec:** grafo lineal sin guillotina (T8) ✓; modo asesor post-captura (T8) ✓; handoff + notificación distinta (T8) ✓; notificar una vez (T8) ✓; guía curada bilingüe nivel 1 (T5) ✓; biblia nivel 2 con fallback por `preguntaProfunda` (T4,T6) ✓; clasificador barato (T2, cableado T9) ✓; voz Méraldi + few-shot (T6) ✓; idioma auto (T6) ✓; dependencias opcionales con fallback / suite intacta (T2,T8) ✓; testing con smoke-run (T4,T10) ✓; fuera de alcance RAG/pagos ✓.
- **Desviación documentada del spec:** el clasificador es una dep opcional separada (`classifyIntent`) en vez de fusionarse en `extract`, para preservar la suite determinista (no-regresión). Señalado al usuario.
- **Consistencia de tipos:** `IntentFlags`/`DEFAULT_INTENT` (T2) usados en state (T3), graph (T8); `ComposeBrief.intent`/`preguntaProfunda` (T1) usados en brief (T7), composer (T6), graph (T8); `GUIA_HECHOS` conserva nombre (T5) para composer (T6)/index; `BIBLIA_COMPLETA` (T4) usado en composer (T6).
- **Sin placeholders de código:** cada paso muestra el código real. La única pieza generada en ejecución es el TEXTO de la GUÍA curada (T5) y de la BIBLIA (T4, generada por script) — ambas con tests de aceptación concretos.
