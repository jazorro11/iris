# Iris — Capa de voz humana — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Que Iris converse como una asesora real (acusa recibo, pide 1-2 datos en prosa, conecta las piedras que encajan) sin tocar el cerebro determinístico (extracción, routing, match, captura de leads).

**Architecture:** Se añade un nodo "redactor" LLM. Los nodos `preguntar` y `persistir` siguen haciendo todo su trabajo determinístico, pero ensamblan un `ComposeBrief` de solo-hechos y se lo pasan a `deps.compose(brief)`, que devuelve la prosa. `compose` es **opcional**: si falta o falla, el nodo cae a las plantillas actuales (red de seguridad). Por eso las pruebas existentes no requieren cambios.

**Tech Stack:** TypeScript (ESM), LangGraph JS, LangChain `@langchain/openai` (ChatOpenAI vía OpenRouter), `node:test` + `tsx`, monorepo npm-workspaces + turbo.

## Global Constraints

- **Modelo:** `openai/gpt-4o-mini` vía OpenRouter (`baseURL https://openrouter.ai/api/v1`, `apiKey = process.env.OPENROUTER_API_KEY`). Extractor temp `0.1` (sin cambios). Redactor temp `0.6`.
- **Versiones pinneadas (no tocar):** `@langchain/core 1.1.41`, `@langchain/langgraph 1.2.7`, `@langchain/openai 1.4.2`. No añadir dependencias nuevas.
- **Guardrails del redactor:** nunca inventar piedras, precios, orígenes ni quilates fuera del brief; nunca prometer tiempos/descuentos/disponibilidad; nunca pedir datos ya conocidos; nunca formato de viñetas tipo formulario; máximo ~3-4 frases.
- **Tests:** `node:test` (`import { test } from "node:test"`, `import assert from "node:assert/strict"`). Correr desde `packages/agent` con `npm test`. En tests, importar módulos por **subpath directo** (`../composer.js`, `../brief.js`), nunca por el barrel `@iris/agent` (tsx no surfacea `export *`). Los tipos sí pueden venir de `@iris/types` (los imports de tipo se borran en runtime).
- **Imports ESM:** extensión `.js` en imports relativos aunque el archivo sea `.ts` (estilo del repo).
- **Git:** branch actual `test/harness-recomendacion`; commitear ahí, NO push a `main`. Hay guard de commit: si `git commit` se bloquea, usar `git -c skill.commit=true commit`. Terminar el mensaje con la línea `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`.
- **No tocar (fuera de alcance):** `extractor.ts`, `request.ts`, `route()`, `MAX_RONDAS`, esquema de `Solicitud`, match de inventario, notificación al vendedor (sigue usando `buildSellerSummary` + `buildPiedrasPropuestas`).

---

## File Structure

- **Create** `packages/types/src/compose.ts` — tipo `ComposeBrief`.
- **Modify** `packages/types/src/index.ts` — re-exportar `./compose.js`.
- **Create** `packages/agent/src/brief.ts` — builder puro `buildComposeBrief` (+ helper `pickKnownCriticos`).
- **Create** `packages/agent/src/composer.ts` — `COMPOSE_SYSTEM_PROMPT`, `renderBriefForPrompt`, `composeReply`, `ChatModel` interface, `createComposerModel`.
- **Modify** `packages/agent/src/model.ts` — `createChatModel` acepta `temperature` opcional (default 0.1).
- **Modify** `packages/agent/src/graph.ts` — `IrisDeps.compose?`, helper `composeOrFallback`, reescritura de `preguntarNode`/`persistirNode`.
- **Modify** `packages/agent/src/index.ts` — exportar lo nuevo.
- **Modify** `apps/web/src/app/api/telegram/webhook/route.ts` — cablear `compose` real.
- **Create (tests)** `packages/agent/src/__tests__/brief.test.ts`, `composer.test.ts`, `graph.compose.test.ts`.
- **Create (opcional)** `scripts/eval-composer.mjs` — eval de tono manual.

---

### Task 1: `ComposeBrief` + brief builder puro

**Files:**
- Create: `packages/types/src/compose.ts`
- Modify: `packages/types/src/index.ts`
- Create: `packages/agent/src/brief.ts`
- Test: `packages/agent/src/__tests__/brief.test.ts`

**Interfaces:**
- Produces:
  - `type ComposeBrief = { intent: "aclarar" | "cerrar"; userMessage: string; known: Partial<Solicitud>; missing: CampoCritico[]; stones: Piedra[]; cierre?: "completo" | "incompleto" }`
  - `pickKnownCriticos(s: Solicitud): Partial<Solicitud>`
  - `buildComposeBrief(input: { intent: "aclarar" | "cerrar"; userMessage: string; solicitud: Solicitud; missing: CampoCritico[]; stones: Piedra[]; cierre?: "completo" | "incompleto" }): ComposeBrief`
- Consumes: `Solicitud`, `CampoCritico`, `Piedra` de `@iris/types`.

- [ ] **Step 1: Crear el tipo `ComposeBrief`**

Create `packages/types/src/compose.ts`:

```ts
import type { Solicitud, CampoCritico } from "./schema.js";
import type { Piedra } from "./inventario.js";

/** Hechos verificados que el redactor (LLM) tiene permitido usar. */
export interface ComposeBrief {
  intent: "aclarar" | "cerrar";
  /** Último mensaje del cliente, para acusar recibo. */
  userMessage: string;
  /** Solo los campos críticos ya capturados (para reconocer lo dicho). */
  known: Partial<Solicitud>;
  /** Campos críticos faltantes, priorizados; el redactor pide 1-2. */
  missing: CampoCritico[];
  /** Piedras reales que encajan (puede ir vacío). */
  stones: Piedra[];
  /** Presente solo cuando intent="cerrar". */
  cierre?: "completo" | "incompleto";
}
```

- [ ] **Step 2: Re-exportar desde el barrel de types**

Modify `packages/types/src/index.ts`, añadir al final:

```ts
export * from "./compose.js";
```

- [ ] **Step 3: Escribir el test que falla**

Create `packages/agent/src/__tests__/brief.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildComposeBrief, pickKnownCriticos } from "../brief.js";
import type { Piedra } from "@iris/types";

test("pickKnownCriticos deja solo críticos presentes", () => {
  const known = pickKnownCriticos({
    proposito: "joyeria",
    presupuesto: { max: 3000, moneda: "USD" },
    claridad: "limpia", // no es crítico → se descarta
  });
  assert.deepEqual(Object.keys(known).sort(), ["presupuesto", "proposito"]);
});

test("buildComposeBrief excluye de known los campos que están en missing", () => {
  const brief = buildComposeBrief({
    intent: "aclarar",
    userMessage: "hola",
    solicitud: { proposito: "joyeria", presupuesto: { base: "por_quilate" } },
    missing: ["presupuesto", "tipo_pieza"],
    stones: [],
  });
  assert.deepEqual(Object.keys(brief.known), ["proposito"]); // presupuesto está en missing
  assert.deepEqual(brief.missing, ["presupuesto", "tipo_pieza"]);
  assert.equal(brief.cierre, undefined);
});

test("buildComposeBrief incluye cierre y stones cuando se pasan", () => {
  const piedra: Piedra = {
    id: "a", nombre: "Cuadrada 9.04 ct", forma: "corte_esmeralda",
    peso_ct: 9.04, precio_usd_ct: 4300, cantidad_piedras: 1,
    media_url: null, disponible: true, notas: null,
  };
  const brief = buildComposeBrief({
    intent: "cerrar",
    userMessage: "listo",
    solicitud: { proposito: "joyeria" },
    missing: [],
    stones: [piedra],
    cierre: "completo",
  });
  assert.equal(brief.intent, "cerrar");
  assert.equal(brief.cierre, "completo");
  assert.equal(brief.stones[0].nombre, "Cuadrada 9.04 ct");
});
```

- [ ] **Step 4: Correr el test y verlo fallar**

Run: `cd packages/agent && npm test`
Expected: FAIL — `Cannot find module '../brief.js'`.

- [ ] **Step 5: Implementar el builder**

Create `packages/agent/src/brief.ts`:

```ts
import type { Solicitud, CampoCritico, Piedra, ComposeBrief } from "@iris/types";

const CRITICOS: CampoCritico[] = [
  "proposito", "presupuesto", "tipo_pieza", "peso_quilates", "color", "origen",
];

/** Devuelve solo los campos críticos presentes en la solicitud. */
export function pickKnownCriticos(s: Solicitud): Partial<Solicitud> {
  const out: Record<string, unknown> = {};
  for (const k of CRITICOS) {
    const v = (s as Record<string, unknown>)[k];
    if (v != null) out[k] = v;
  }
  return out as Partial<Solicitud>;
}

/** Ensambla el brief de solo-hechos para el redactor. `known` excluye lo que sigue faltando. */
export function buildComposeBrief(input: {
  intent: "aclarar" | "cerrar";
  userMessage: string;
  solicitud: Solicitud;
  missing: CampoCritico[];
  stones: Piedra[];
  cierre?: "completo" | "incompleto";
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
    ...(input.cierre ? { cierre: input.cierre } : {}),
  };
}
```

- [ ] **Step 6: Correr el test y verlo pasar**

Run: `cd packages/agent && npm test`
Expected: PASS (los 3 tests de brief, más los existentes verdes).

- [ ] **Step 7: Commit**

```bash
git add packages/types/src/compose.ts packages/types/src/index.ts packages/agent/src/brief.ts packages/agent/src/__tests__/brief.test.ts
git -c skill.commit=true commit -m "feat(agent): ComposeBrief y builder puro state→brief

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: Redactor — modelo, prompt y `composeReply`

**Files:**
- Modify: `packages/agent/src/model.ts:3-16`
- Create: `packages/agent/src/composer.ts`
- Test: `packages/agent/src/__tests__/composer.test.ts`

**Interfaces:**
- Consumes: `ComposeBrief` de `@iris/types`; `createChatModel` de `./model.js`.
- Produces:
  - `interface ChatModel { invoke(input: unknown): Promise<{ content: unknown }> }`
  - `const COMPOSE_SYSTEM_PROMPT: string`
  - `renderBriefForPrompt(b: ComposeBrief): string`
  - `composeReply(model: ChatModel, brief: ComposeBrief): Promise<string>`
  - `createComposerModel(): ChatModel`

- [ ] **Step 1: Hacer `temperature` configurable en el modelo**

Modify `packages/agent/src/model.ts`, reemplazar la firma para aceptar opciones (default 0.1, retrocompatible):

```ts
import { ChatOpenAI } from "@langchain/openai";

export function createChatModel(opts?: { temperature?: number }): ChatOpenAI {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) throw new Error("Missing OPENROUTER_API_KEY");

  return new ChatOpenAI({
    modelName: "openai/gpt-4o-mini",
    temperature: opts?.temperature ?? 0.1,
    configuration: {
      baseURL: "https://openrouter.ai/api/v1",
      defaultHeaders: { "HTTP-Referer": "https://iris.local" },
    },
    apiKey,
  });
}
```

- [ ] **Step 2: Escribir el test que falla**

Create `packages/agent/src/__tests__/composer.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { renderBriefForPrompt, composeReply, COMPOSE_SYSTEM_PROMPT, type ChatModel } from "../composer.js";
import type { ComposeBrief, Piedra } from "@iris/types";

const piedra: Piedra = {
  id: "a", nombre: "Esmeralda cuadrada 9.04 ct", forma: "corte_esmeralda",
  peso_ct: 9.04, precio_usd_ct: 4300, cantidad_piedras: 1,
  media_url: null, disponible: true, notas: null,
};

const brief: ComposeBrief = {
  intent: "aclarar",
  userMessage: "busco una esmeralda de 9 quilates",
  known: { proposito: "joyeria" },
  missing: ["presupuesto", "origen"],
  stones: [piedra],
};

test("renderBriefForPrompt incluye mensaje, faltantes y datos reales de la piedra", () => {
  const txt = renderBriefForPrompt(brief);
  assert.match(txt, /busco una esmeralda de 9 quilates/);
  assert.match(txt, /presupuesto, origen/);
  assert.match(txt, /Esmeralda cuadrada 9\.04/);
  assert.match(txt, /4300/);
});

test("renderBriefForPrompt marca cuando no hay piedras", () => {
  const txt = renderBriefForPrompt({ ...brief, stones: [] });
  assert.match(txt, /\(ninguna\)/);
});

test("composeReply pasa el system prompt y devuelve el texto recortado", async () => {
  let visto: Array<{ role: string; content: string }> = [];
  const fake: ChatModel = {
    invoke: async (input) => {
      visto = input as Array<{ role: string; content: string }>;
      return { content: "  Hola, con gusto te ayudo.  " };
    },
  };
  const out = await composeReply(fake, brief);
  assert.equal(out, "Hola, con gusto te ayudo.");
  assert.equal(visto[0].role, "system");
  assert.equal(visto[0].content, COMPOSE_SYSTEM_PROMPT);
  assert.match(visto[1].content, /busco una esmeralda de 9 quilates/);
});

test("composeReply tolera content no-string", async () => {
  const fake: ChatModel = { invoke: async () => ({ content: 123 }) };
  const out = await composeReply(fake, brief);
  assert.equal(out, "123");
});
```

- [ ] **Step 3: Correr el test y verlo fallar**

Run: `cd packages/agent && npm test`
Expected: FAIL — `Cannot find module '../composer.js'`.

- [ ] **Step 4: Implementar el redactor**

Create `packages/agent/src/composer.ts`:

```ts
import type { ComposeBrief } from "@iris/types";
import { createChatModel } from "./model.js";

/** Interfaz mínima de un modelo de chat de texto libre (satisfecha por ChatOpenAI). */
export interface ChatModel {
  invoke(input: unknown): Promise<{ content: unknown }>;
}

export const COMPOSE_SYSTEM_PROMPT = `Eres Iris, asesora de Méraldi, casa de esmeraldas colombianas. Hablas por chat con un comprador, como lo haría una asesora real: cálida, cercana y breve.

Recibes un BRIEF con hechos verificados. Tu única tarea es redactar el siguiente mensaje de Iris usando EXCLUSIVAMENTE esos hechos.

Cómo conversas:
- Primero acusa recibo de lo que el cliente acaba de decir (cliente_dijo / ya_sabemos), con naturalidad, sin repetírselo como loro.
- Si intent="aclarar": pide solo 1 dato (máximo 2) de falta_por_preguntar, el más relevante, dentro de una frase fluida. NUNCA en lista de viñetas. NUNCA el encabezado "Para ayudarte mejor, cuéntame". Varía el fraseo en cada turno.
- Si hay piedras_que_encajan: menciona la que mejor encaja conectándola con lo que el cliente dijo (p. ej. presupuesto o peso), como recomendación de asesora. Usa solo nombre, peso y precio TAL CUAL vienen en el brief.
- Si intent="cerrar": agradece y avísale que un asesor de Méraldi lo contactará. Si cierre="incompleto", dilo de forma natural (faltan detalles por afinar).

Prohibido:
- Inventar piedras, precios, orígenes, quilates o datos que no estén en el brief.
- Prometer tiempos, descuentos o disponibilidad concretos.
- Pedir datos que ya están en ya_sabemos.
- Sonar a formulario. Máximo ~3-4 frases.

Responde solo con el mensaje para el cliente, en español, sin comillas.`;

/** Serializa el brief en un bloque de texto legible para el LLM. Determinístico. */
export function renderBriefForPrompt(b: ComposeBrief): string {
  const known = Object.keys(b.known).length ? JSON.stringify(b.known) : "(nada aún)";
  const missing = b.missing.length ? b.missing.join(", ") : "(nada)";
  const stones = b.stones.length
    ? b.stones.map((p) => `- ${p.nombre} (${p.peso_ct} ct, ${p.precio_usd_ct} USD/ct)`).join("\n")
    : "(ninguna)";
  return [
    `intent: ${b.intent}`,
    `cliente_dijo: ${b.userMessage}`,
    `ya_sabemos: ${known}`,
    `falta_por_preguntar (prioridad): ${missing}`,
    `piedras_que_encajan:\n${stones}`,
    b.cierre ? `cierre: ${b.cierre}` : null,
  ].filter(Boolean).join("\n");
}

/** Redacta el mensaje al cliente a partir del brief. Lanza si el modelo falla. */
export async function composeReply(model: ChatModel, brief: ComposeBrief): Promise<string> {
  const res = await model.invoke([
    { role: "system", content: COMPOSE_SYSTEM_PROMPT },
    { role: "user", content: renderBriefForPrompt(brief) },
  ]);
  const text = typeof res.content === "string" ? res.content : String(res.content ?? "");
  return text.trim();
}

/** Instancia del modelo redactor (temp alta para calidez). */
export function createComposerModel(): ChatModel {
  return createChatModel({ temperature: 0.6 });
}
```

- [ ] **Step 5: Correr el test y verlo pasar**

Run: `cd packages/agent && npm test`
Expected: PASS (4 tests de composer + el resto verdes).

- [ ] **Step 6: Commit**

```bash
git add packages/agent/src/model.ts packages/agent/src/composer.ts packages/agent/src/__tests__/composer.test.ts
git -c skill.commit=true commit -m "feat(agent): redactor LLM (prompt, render de brief, composeReply)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: Cablear `compose` en el grafo con fallback

**Files:**
- Modify: `packages/agent/src/graph.ts:9-17` (IrisDeps), `:60-85` (nodos)
- Test: `packages/agent/src/__tests__/graph.compose.test.ts`

**Interfaces:**
- Consumes: `buildComposeBrief` de `./brief.js`; `ComposeBrief` de `@iris/types`.
- Produces (en `IrisDeps`): `compose?: (brief: ComposeBrief) => Promise<string>`.

- [ ] **Step 1: Escribir el test que falla**

Create `packages/agent/src/__tests__/graph.compose.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { MemorySaver } from "@langchain/langgraph";
import { runIris, type IrisDeps } from "../graph.js";
import type { LeadRow, ComposeBrief } from "@iris/types";

test("aclaración: compose recibe el brief correcto y su salida es el reply", async () => {
  let recibido: ComposeBrief | null = null;
  const deps: IrisDeps = {
    extract: async () => ({ proposito: "joyeria" }),
    saveLead: async () => ({ id: "x" }),
    notifySeller: async () => {},
    compose: async (b) => { recibido = b; return "Genial, ¿qué presupuesto manejas?"; },
    checkpointer: new MemorySaver(),
  };
  const { reply, estado } = await runIris(deps, {
    telegramUserId: 1, chatId: 1, text: "quiero una esmeralda de 9 ct",
  });
  assert.equal(estado, "en_aclaracion");
  assert.equal(reply, "Genial, ¿qué presupuesto manejas?");
  assert.ok(recibido);
  assert.equal(recibido!.intent, "aclarar");
  assert.equal(recibido!.userMessage, "quiero una esmeralda de 9 ct");
  assert.ok(recibido!.missing.includes("presupuesto"));
});

test("cierre: compose recibe intent=cerrar y cierre=completo", async () => {
  const saved: LeadRow[] = [];
  let recibido: ComposeBrief | null = null;
  const deps: IrisDeps = {
    extract: async () => ({
      proposito: "joyeria", tipo_pieza: "gema_tallada", color: { tono: "verde" },
      presupuesto: { max: 5000, moneda: "USD" }, peso_quilates: { min: 1 },
      origen: { pais: "colombia" },
    }),
    saveLead: async (r) => { saved.push(r); return { id: "lead-1" }; },
    notifySeller: async () => {},
    compose: async (b) => { recibido = b; return "¡Gracias! Un asesor te contactará."; },
    checkpointer: new MemorySaver(),
  };
  const { reply, estado } = await runIris(deps, {
    telegramUserId: 2, chatId: 2, text: "esmeralda verde de Colombia, 1ct, hasta 5000",
  });
  assert.equal(estado, "completo");
  assert.equal(saved.length, 1);
  assert.equal(reply, "¡Gracias! Un asesor te contactará.");
  assert.equal(recibido!.intent, "cerrar");
  assert.equal(recibido!.cierre, "completo");
});

test("fallback: si compose lanza, usa la plantilla y el lead igual se guarda", async () => {
  const saved: LeadRow[] = [];
  const deps: IrisDeps = {
    extract: async () => ({
      proposito: "joyeria", tipo_pieza: "gema_tallada", color: { tono: "verde" },
      presupuesto: { max: 5000, moneda: "USD" }, peso_quilates: { min: 1 },
      origen: { pais: "colombia" },
    }),
    saveLead: async (r) => { saved.push(r); return { id: "lead-1" }; },
    notifySeller: async () => {},
    compose: async () => { throw new Error("LLM caído"); },
    checkpointer: new MemorySaver(),
  };
  const { reply, estado } = await runIris(deps, {
    telegramUserId: 3, chatId: 3, text: "esmeralda verde de Colombia, 1ct, hasta 5000",
  });
  assert.equal(estado, "completo");
  assert.equal(saved.length, 1);
  assert.match(reply, /asesor de Méraldi/); // cayó a la plantilla de cierre
});
```

- [ ] **Step 2: Correr el test y verlo fallar**

Run: `cd packages/agent && npm test`
Expected: FAIL — `IrisDeps` no acepta `compose` / los reply no coinciden (los nodos aún usan plantillas).

- [ ] **Step 3: Añadir `compose` a `IrisDeps` y el helper de fallback**

Modify `packages/agent/src/graph.ts`. Añadir el import (junto a los otros imports de `./`):

```ts
import { buildComposeBrief } from "./brief.js";
import type { ComposeBrief } from "@iris/types";
```

Añadir el campo a la interfaz `IrisDeps` (después de `matchInventory?`):

```ts
  /** Opcional: redacta el mensaje al cliente desde el brief. Si falta o falla, se usan plantillas. */
  compose?: (brief: ComposeBrief) => Promise<string>;
```

Añadir el helper (por ejemplo, justo antes de `extractorNode`):

```ts
async function composeOrFallback(deps: IrisDeps, brief: ComposeBrief, fallback: string): Promise<string> {
  if (!deps.compose) return fallback;
  try {
    const out = await deps.compose(brief);
    return out && out.trim() ? out : fallback;
  } catch (err) {
    console.error("[iris] compose falló, usando plantilla:", err);
    return fallback;
  }
}
```

- [ ] **Step 4: Reescribir `preguntarNode`**

Modify `packages/agent/src/graph.ts`, reemplazar `preguntarNode` completo:

```ts
async function preguntarNode(state: State, deps: IrisDeps): Promise<Partial<State>> {
  const piedras = deps.matchInventory ? await deps.matchInventory(state.solicitud) : [];
  const fallback = buildClarificationMessage(state.camposFaltantes) + buildPiedrasPropuestas(piedras);
  const brief = buildComposeBrief({
    intent: "aclarar",
    userMessage: state.inputText,
    solicitud: state.solicitud,
    missing: state.camposFaltantes,
    stones: piedras,
  });
  const reply = await composeOrFallback(deps, brief, fallback);
  return { reply };
}
```

- [ ] **Step 5: Reescribir `persistirNode`**

Modify `packages/agent/src/graph.ts`, reemplazar `persistirNode` completo (la notificación al vendedor NO cambia):

```ts
async function persistirNode(state: State, deps: IrisDeps): Promise<Partial<State>> {
  const estadoFinal: EstadoLead = state.estado === "completo" ? "completo" : "incompleto";
  const row = buildLeadRow({
    telegramUserId: state.telegramUserId,
    telegramUsername: state.telegramUsername,
    solicitud: state.solicitud,
    estado: estadoFinal,
    camposFaltantes: state.camposFaltantes,
  });
  await deps.saveLead(row);
  const piedras = deps.matchInventory ? await deps.matchInventory(state.solicitud) : [];
  const propuesta = buildPiedrasPropuestas(piedras);
  await deps.notifySeller(buildSellerSummary(row) + propuesta);
  const fallbackBase = estadoFinal === "completo"
    ? "¡Gracias! Registré tu solicitud y un asesor de Méraldi te contactará pronto. 💚"
    : "Gracias por la información. Un asesor de Méraldi continuará contigo para afinar los detalles.";
  const brief = buildComposeBrief({
    intent: "cerrar",
    userMessage: state.inputText,
    solicitud: state.solicitud,
    missing: state.camposFaltantes,
    stones: piedras,
    cierre: estadoFinal,
  });
  const reply = await composeOrFallback(deps, brief, fallbackBase + propuesta);
  return { reply, estado: estadoFinal };
}
```

- [ ] **Step 6: Correr los tests y verlos pasar**

Run: `cd packages/agent && npm test`
Expected: PASS — los 3 tests nuevos de `graph.compose.test.ts` Y los de `graph.test.ts` existentes (que no inyectan `compose`, así que siguen viendo las plantillas vía fallback).

- [ ] **Step 7: Type-check**

Run: `cd packages/agent && npm run type-check`
Expected: sin errores.

- [ ] **Step 8: Commit**

```bash
git add packages/agent/src/graph.ts packages/agent/src/__tests__/graph.compose.test.ts
git -c skill.commit=true commit -m "feat(agent): nodo redactor en el grafo con fallback a plantillas

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: Exponer en el barrel y cablear en producción

**Files:**
- Modify: `packages/agent/src/index.ts`
- Modify: `apps/web/src/app/api/telegram/webhook/route.ts:1-33`

**Interfaces:**
- Consumes: `createComposerModel`, `composeReply` de `@iris/agent`.

- [ ] **Step 1: Exportar lo nuevo desde el barrel del agente**

Modify `packages/agent/src/index.ts`, añadir:

```ts
export { composeReply, createComposerModel, COMPOSE_SYSTEM_PROMPT, renderBriefForPrompt, type ChatModel } from "./composer.js";
export { buildComposeBrief, pickKnownCriticos } from "./brief.js";
```

- [ ] **Step 2: Cablear `compose` en el webhook**

Modify `apps/web/src/app/api/telegram/webhook/route.ts`. Cambiar el import de `@iris/agent` para incluir el redactor:

```ts
import { runIris, createChatModel, extractRequest, createComposerModel, composeReply, type IrisDeps } from "@iris/agent";
```

Crear la instancia del redactor junto a `const model = createChatModel();`:

```ts
  const model = createChatModel();
  const composerModel = createComposerModel();
```

Añadir `compose` al objeto `deps` (después de `matchInventory`):

```ts
    compose: (brief) => composeReply(composerModel, brief),
```

- [ ] **Step 3: Type-check del workspace completo**

Run: `cd packages/agent && npm run type-check`
Then: `cd apps/web && npm run type-check` (o el script de type-check que exista en `apps/web`; si no existe, `npx tsc --noEmit`).
Expected: sin errores.

- [ ] **Step 4: Build de la app web (verifica el wiring de Next)**

Run (desde la raíz): `npm run build --workspace=apps/web`
Expected: build exitoso.

- [ ] **Step 5: Commit**

```bash
git add packages/agent/src/index.ts apps/web/src/app/api/telegram/webhook/route.ts
git -c skill.commit=true commit -m "feat(web): cablear redactor humano en el webhook de Telegram

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 5 (opcional, manual): Eval de tono con la transcripción real

> No corre en CI. Requiere `OPENROUTER_API_KEY`. Es para revisar la VOZ del redactor a ojo, no una aserción automatizada.

**Files:**
- Create: `scripts/eval-composer.mjs`

- [ ] **Step 1: Crear el script de eval**

Create `scripts/eval-composer.mjs`:

```js
// Eval manual del redactor. Uso: OPENROUTER_API_KEY=... npx tsx scripts/eval-composer.mjs
// Importa por subpath directo (tsx no surfacea el barrel export *).
import { buildComposeBrief } from "../packages/agent/src/brief.ts";
import { createComposerModel, composeReply } from "../packages/agent/src/composer.ts";

const model = createComposerModel();

const casos = [
  {
    nombre: "aclaración con piedras",
    brief: buildComposeBrief({
      intent: "aclarar",
      userMessage: "Hola estoy buscando una esmeralda de 9 quilates",
      solicitud: {},
      missing: ["proposito", "presupuesto", "color"],
      stones: [
        { id: "1", nombre: "Lote 4 esmeraldas 8.82 ct", forma: "corte_esmeralda", peso_ct: 8.82, precio_usd_ct: 1500, cantidad_piedras: 4, media_url: null, disponible: true, notas: null },
        { id: "2", nombre: "Esmeralda cuadrada 9.04 ct", forma: "corte_esmeralda", peso_ct: 9.04, precio_usd_ct: 4300, cantidad_piedras: 1, media_url: null, disponible: true, notas: null },
      ],
    }),
  },
  {
    nombre: "cierre completo",
    brief: buildComposeBrief({
      intent: "cerrar",
      userMessage: "No tengo preferencia de lugar desde que sea colombiana",
      solicitud: { proposito: "joyeria", presupuesto: { max: 3000, moneda: "USD" }, origen: { pais: "colombia" } },
      missing: [],
      stones: [],
      cierre: "completo",
    }),
  },
];

for (const c of casos) {
  const reply = await composeReply(model, c.brief);
  console.log(`\n=== ${c.nombre} ===\n${reply}\n`);
}
```

- [ ] **Step 2: Correr el eval y revisar la voz a ojo**

Run: `OPENROUTER_API_KEY=<key> npx tsx scripts/eval-composer.mjs`
Expected: dos mensajes en prosa natural, cálidos, sin viñetas, que acusan recibo y (en el primer caso) conectan la piedra que encaja. Verificar que NO inventa precios/piedras fuera del brief.

- [ ] **Step 3: Commit**

```bash
git add scripts/eval-composer.mjs
git -c skill.commit=true commit -m "chore(agent): script de eval manual del redactor

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Notas de verificación final (tras Task 4)

- `cd packages/agent && npm test` → todo verde (brief, composer, graph.compose, y los graph/questions/request/extractor existentes sin cambios).
- `cd packages/agent && npm run type-check` → limpio.
- `npm run build --workspace=apps/web` → build OK.
- Confirmar que las pruebas existentes de `graph.test.ts` siguen pasando **sin modificarlas** (prueba de que el fallback preserva el comportamiento determinístico anterior).
