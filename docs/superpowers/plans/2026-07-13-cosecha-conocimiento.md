# Cosecha de conocimiento real — Implementation Plan (Entrega 1)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Un sistema autónomo que, haciéndose pasar por compradores (6 personas), conversa por Telegram con el dueño real de Meraldi y cosecha sus respuestas como un golden dataset estructurado.

**Architecture:** Cerebro puro (`packages/harvest`: personas, engine, guardrails, harvester, observabilidad) sin conocimiento de Telegram ni HTTP; transporte event-driven en `apps/web` (`/api/harvest/webhook`) que traduce Telegram↔cerebro y persiste estado/oro en Supabase; espejo del dataset a Langfuse.

**Tech Stack:** TypeScript ESM, `node:test`, LangChain/OpenAI vía OpenRouter (`@langchain/openai` 1.4.2), Supabase (`@supabase/supabase-js`), Langfuse (`langfuse` + `langfuse-langchain`), Next.js App Router.

## Global Constraints

- **Test runner:** `node:test` + `node:assert/strict`, ejecutado con `tsx --test`. **NO Vitest.**
- **ESM:** imports de módulos locales terminan en `.js` (p.ej. `import { X } from "./config.js"`).
- **Modelo:** siempre `createChatModel()` de `@iris/agent` (OpenRouter). No agregar otro proveedor.
- **Pins de LangChain (override raíz, verbatim):** `@langchain/core` `1.1.41`. No cambiar.
- **Aislamiento:** tablas nuevas con prefijo `harvest_`; NUNCA tocar `leads`/`lead_messages`.
- **MAX_TURNOS = 10** turnos-comprador por conversación.
- **Concurrencia = 1:** a lo más una `harvest_conversations` en estado `activa`.
- **Langfuse degrada a no-op** si faltan `LANGFUSE_PUBLIC_KEY`/`LANGFUSE_SECRET_KEY`. La cosecha funciona sin Langfuse.
- **Idioma de commits:** inglés (convención kausai). Commit vía `git -c skill.commit=true commit` (el commit directo está bloqueado por hook).
- **Bot dedicado:** el transporte de cosecha usa `HARVEST_BOT_TOKEN` (token DISTINTO al de producción `TELEGRAM_BOT_TOKEN`).

## File Structure

**Nuevo paquete `packages/harvest`:**
- `package.json`, `tsconfig.json`
- `src/types.ts` — tipos compartidos (Persona, HistItem, DatasetRecord, GuardrailResult, LlmModel)
- `src/config.ts` — constantes + lectores de env
- `src/personas.ts` — las 6 personas + `getPersona`
- `src/guardrails.ts` — `evaluarGuardrails` (función pura)
- `src/personaEngine.ts` — `siguienteTurno` (LLM)
- `src/harvester.ts` — `extraerRegistro` (LLM + zod)
- `src/observability.ts` — cliente Langfuse no-op-safe + espejo de dataset
- `src/index.ts` — barrel
- `src/__tests__/*.test.ts`

**`packages/db`:**
- `src/queries/harvest.ts` — CRUD de `harvest_*` + idempotencia + builders puros
- `src/queries/__tests__/harvest.test.ts`
- `supabase/migrations/00004_harvest.sql`
- export desde `src/index.ts`

**`apps/web`:**
- `src/lib/telegram/harvest-send.ts` — sender con `HARVEST_BOT_TOKEN`
- `src/app/api/harvest/webhook/route.ts` — transporte event-driven
- `src/app/api/telegram/webhook/route.ts` — (modificar) Langfuse capa 4

**`scripts/`:** `cosechar-iniciar.mts`, `cosechar-detener.mts`, `cosechar-dryrun.mts`

---

### Task 1: Scaffold `packages/harvest` + config

**Files:**
- Create: `packages/harvest/package.json`
- Create: `packages/harvest/tsconfig.json`
- Create: `packages/harvest/src/types.ts`
- Create: `packages/harvest/src/config.ts`
- Test: `packages/harvest/src/__tests__/config.test.ts`

**Interfaces:**
- Produces:
  - `types.ts`: `type HistItem = { rol: "comprador" | "dueño"; texto: string }`; `type Idioma = "es" | "en"`; `interface Persona { key: string; arquetipo: string; objetivo: string; presupuesto: string; nivelConocimiento: string; primerMensaje: string; objeciones: string[]; idioma: Idioma }`; `interface LlmModel { invoke(msgs: { role: string; content: string }[]): Promise<{ content: unknown }> }`; `interface DatasetRecord { conversationId: string; personaKey: string; turno: number; mensajeComprador: string; respuestaDueno: string; contextoPrevio: string; veta: "precio" | "objecion" | "producto" | "tono" | "otro"; notasExtraccion: string }`
  - `config.ts`: `const MAX_TURNOS = 10`; `const STOP_WORDS: RegExp`; `const RESPONSE_DELAY_MS = 4000`; `function harvestEnv(): { botToken: string; webhookSecret: string; ownerChatId: number }`

- [ ] **Step 1: Create the package manifest**

`packages/harvest/package.json`:
```json
{
  "name": "@iris/harvest",
  "private": true,
  "version": "0.0.0",
  "main": "./src/index.ts",
  "types": "./src/index.ts",
  "scripts": {
    "type-check": "tsc --noEmit",
    "test": "tsx --test \"src/**/__tests__/**/*.test.ts\""
  },
  "dependencies": {
    "@iris/agent": "*",
    "@iris/db": "*",
    "@iris/types": "*",
    "@langchain/core": "1.1.41",
    "langfuse": "^3.39.0",
    "langfuse-langchain": "^3.39.0",
    "zod": "^3"
  },
  "devDependencies": { "typescript": "^5", "tsx": "^4.19.0" }
}
```

- [ ] **Step 2: Create tsconfig**

`packages/harvest/tsconfig.json`:
```json
{ "extends": "../config/tsconfig.base.json", "include": ["src"] }
```

- [ ] **Step 3: Create types.ts**

`packages/harvest/src/types.ts`:
```typescript
export type HistItem = { rol: "comprador" | "dueño"; texto: string };
export type Idioma = "es" | "en";
export type Veta = "precio" | "objecion" | "producto" | "tono" | "otro";

export interface Persona {
  key: string;
  arquetipo: string;
  objetivo: string;
  presupuesto: string;
  nivelConocimiento: string;
  primerMensaje: string;
  objeciones: string[];
  idioma: Idioma;
}

/** Modelo LLM mínimo que necesitamos; en tests se inyecta un fake. */
export interface LlmModel {
  invoke(msgs: { role: string; content: string }[]): Promise<{ content: unknown }>;
}

export interface DatasetRecord {
  conversationId: string;
  personaKey: string;
  turno: number;
  mensajeComprador: string;
  respuestaDueno: string;
  contextoPrevio: string;
  veta: Veta;
  notasExtraccion: string;
}
```

- [ ] **Step 4: Write the failing test for config**

`packages/harvest/src/__tests__/config.test.ts`:
```typescript
import { test } from "node:test";
import assert from "node:assert/strict";
import { MAX_TURNOS, STOP_WORDS, RESPONSE_DELAY_MS } from "../config.js";

test("MAX_TURNOS es 10", () => {
  assert.equal(MAX_TURNOS, 10);
});

test("STOP_WORDS detecta las palabras de pausa del dueño", () => {
  for (const t of ["pausa", "para", "¿eres un bot?", "basta ya", "PARA"]) {
    assert.match(t, STOP_WORDS, `debería detectar: ${t}`);
  }
  for (const t of ["hola", "me interesa", "cuánto cuesta"]) {
    assert.doesNotMatch(t, STOP_WORDS, `no debería detectar: ${t}`);
  }
});

test("RESPONSE_DELAY_MS es positivo", () => {
  assert.ok(RESPONSE_DELAY_MS > 0);
});
```

- [ ] **Step 5: Run test to verify it fails**

Run: `cd packages/harvest && npx tsx --test "src/**/__tests__/config.test.ts"`
Expected: FAIL — `Cannot find module '../config.js'`.

- [ ] **Step 6: Implement config.ts**

`packages/harvest/src/config.ts`:
```typescript
export const MAX_TURNOS = 10;

/** Palabras del dueño que detienen la cosecha (word-boundary, case-insensitive). */
export const STOP_WORDS = /\b(pausa|para|basta)\b|¿?\s*eres un bot\s*\??/i;

export const RESPONSE_DELAY_MS = 4000;

export function harvestEnv(): { botToken: string; webhookSecret: string; ownerChatId: number } {
  return {
    botToken: process.env.HARVEST_BOT_TOKEN ?? "",
    webhookSecret: process.env.HARVEST_WEBHOOK_SECRET ?? "",
    ownerChatId: Number(process.env.OWNER_HARVEST_CHAT_ID ?? NaN),
  };
}
```

- [ ] **Step 7: Run test to verify it passes**

Run: `cd packages/harvest && npx tsx --test "src/**/__tests__/config.test.ts"`
Expected: PASS (3 tests).

- [ ] **Step 8: Install workspace deps**

Run (repo root): `npm install`
Expected: `@iris/harvest` linked; `langfuse` y `langfuse-langchain` instalados.

- [ ] **Step 9: Commit**

```bash
git add packages/harvest/package.json packages/harvest/tsconfig.json packages/harvest/src/types.ts packages/harvest/src/config.ts packages/harvest/src/__tests__/config.test.ts package-lock.json
git -c skill.commit=true commit -m "feat(harvest): scaffold package with config and shared types"
```

---

### Task 2: Las 6 personas

**Files:**
- Create: `packages/harvest/src/personas.ts`
- Test: `packages/harvest/src/__tests__/personas.test.ts`

**Interfaces:**
- Consumes: `Persona`, `Idioma` de `./types.js`
- Produces: `const PERSONAS: Persona[]`; `function getPersona(key: string): Persona` (lanza si no existe)

- [ ] **Step 1: Write the failing test**

`packages/harvest/src/__tests__/personas.test.ts`:
```typescript
import { test } from "node:test";
import assert from "node:assert/strict";
import { PERSONAS, getPersona } from "../personas.js";

const KEYS = ["inversionista", "novata_anillo", "cazador_ganga", "tecnico", "turista_en", "apurado_cierre"];

test("hay exactamente 6 personas con las keys esperadas", () => {
  assert.equal(PERSONAS.length, 6);
  assert.deepEqual(PERSONAS.map((p) => p.key).sort(), [...KEYS].sort());
});

test("cada persona tiene primerMensaje no vacío y >=2 objeciones", () => {
  for (const p of PERSONAS) {
    assert.ok(p.primerMensaje.trim().length > 0, `${p.key}: primerMensaje vacío`);
    assert.ok(p.objeciones.length >= 2, `${p.key}: pocas objeciones`);
  }
});

test("turista_en habla inglés; el resto español", () => {
  assert.equal(getPersona("turista_en").idioma, "en");
  assert.equal(getPersona("inversionista").idioma, "es");
});

test("getPersona lanza con key desconocida", () => {
  assert.throws(() => getPersona("no_existe"));
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/harvest && npx tsx --test "src/**/__tests__/personas.test.ts"`
Expected: FAIL — `Cannot find module '../personas.js'`.

- [ ] **Step 3: Implement personas.ts**

`packages/harvest/src/personas.ts`:
```typescript
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/harvest && npx tsx --test "src/**/__tests__/personas.test.ts"`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/harvest/src/personas.ts packages/harvest/src/__tests__/personas.test.ts
git -c skill.commit=true commit -m "feat(harvest): 6 buyer personas anchored in real chats"
```

---

### Task 3: Guardrails (función pura)

**Files:**
- Create: `packages/harvest/src/guardrails.ts`
- Test: `packages/harvest/src/__tests__/guardrails.test.ts`

**Interfaces:**
- Consumes: `MAX_TURNOS`, `STOP_WORDS` de `./config.js`
- Produces: `type GuardrailResult = { accion: "continuar" } | { accion: "detener"; motivo: string }`; `function evaluarGuardrails(input: { turnosComprador: number; ultimoTextoDueno: string }): GuardrailResult`

- [ ] **Step 1: Write the failing test**

`packages/harvest/src/__tests__/guardrails.test.ts`:
```typescript
import { test } from "node:test";
import assert from "node:assert/strict";
import { evaluarGuardrails } from "../guardrails.js";

test("continúa en condiciones normales", () => {
  const r = evaluarGuardrails({ turnosComprador: 3, ultimoTextoDueno: "Claro, tengo varias opciones" });
  assert.equal(r.accion, "continuar");
});

test("detiene al alcanzar MAX_TURNOS (10)", () => {
  const r = evaluarGuardrails({ turnosComprador: 10, ultimoTextoDueno: "aquí va otra" });
  assert.equal(r.accion, "detener");
  assert.match(r.accion === "detener" ? r.motivo : "", /turnos/i);
});

test("detiene ante stop-word del dueño", () => {
  const r = evaluarGuardrails({ turnosComprador: 2, ultimoTextoDueno: "oye, ¿eres un bot?" });
  assert.equal(r.accion, "detener");
  assert.match(r.accion === "detener" ? r.motivo : "", /stop-word|pausa|bot/i);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/harvest && npx tsx --test "src/**/__tests__/guardrails.test.ts"`
Expected: FAIL — `Cannot find module '../guardrails.js'`.

- [ ] **Step 3: Implement guardrails.ts**

`packages/harvest/src/guardrails.ts`:
```typescript
import { MAX_TURNOS, STOP_WORDS } from "./config.js";

export type GuardrailResult = { accion: "continuar" } | { accion: "detener"; motivo: string };

export function evaluarGuardrails(input: { turnosComprador: number; ultimoTextoDueno: string }): GuardrailResult {
  if (STOP_WORDS.test(input.ultimoTextoDueno)) {
    return { accion: "detener", motivo: "stop-word del dueño (pausa/bot/basta)" };
  }
  if (input.turnosComprador >= MAX_TURNOS) {
    return { accion: "detener", motivo: `alcanzado el máximo de ${MAX_TURNOS} turnos` };
  }
  return { accion: "continuar" };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/harvest && npx tsx --test "src/**/__tests__/guardrails.test.ts"`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/harvest/src/guardrails.ts packages/harvest/src/__tests__/guardrails.test.ts
git -c skill.commit=true commit -m "feat(harvest): pure guardrails (turn cap + stop-words)"
```

---

### Task 4: personaEngine (siguiente turno)

**Files:**
- Create: `packages/harvest/src/personaEngine.ts`
- Test: `packages/harvest/src/__tests__/personaEngine.test.ts`

**Interfaces:**
- Consumes: `Persona`, `HistItem`, `LlmModel` de `./types.js`
- Produces: `type TurnoResult = { fin: false; texto: string } | { fin: true }`; `function buildPersonaSystemPrompt(p: Persona): string`; `async function siguienteTurno(model: LlmModel, persona: Persona, historial: HistItem[]): Promise<TurnoResult>`

Nota: el modelo devuelve una línea. Si empieza con el centinela `FIN`, la persona termina. Así el fin es determinista y testeable.

- [ ] **Step 1: Write the failing test**

`packages/harvest/src/__tests__/personaEngine.test.ts`:
```typescript
import { test } from "node:test";
import assert from "node:assert/strict";
import { siguienteTurno, buildPersonaSystemPrompt } from "../personaEngine.js";
import { getPersona } from "../personas.js";
import type { LlmModel } from "../types.js";

const fakeModel = (reply: string): LlmModel => ({ invoke: async () => ({ content: reply }) });

test("el system prompt incluye presupuesto y las objeciones de la persona", () => {
  const p = getPersona("cazador_ganga");
  const sp = buildPersonaSystemPrompt(p);
  assert.match(sp, /2\.000 USD|2000 USD/);
  for (const o of p.objeciones) assert.ok(sp.includes(o), `falta objeción: ${o}`);
});

test("devuelve texto cuando el modelo responde una línea normal", async () => {
  const r = await siguienteTurno(fakeModel("¿me haces un descuento?"), getPersona("cazador_ganga"), []);
  assert.equal(r.fin, false);
  assert.equal(r.fin === false ? r.texto : "", "¿me haces un descuento?");
});

test("termina cuando el modelo emite el centinela FIN", async () => {
  const r = await siguienteTurno(fakeModel("FIN"), getPersona("cazador_ganga"), [
    { rol: "comprador", texto: "hola" },
    { rol: "dueño", texto: "hola, dime" },
  ]);
  assert.equal(r.fin, true);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/harvest && npx tsx --test "src/**/__tests__/personaEngine.test.ts"`
Expected: FAIL — `Cannot find module '../personaEngine.js'`.

- [ ] **Step 3: Implement personaEngine.ts**

`packages/harvest/src/personaEngine.ts`:
```typescript
import type { Persona, HistItem, LlmModel } from "./types.js";

export type TurnoResult = { fin: false; texto: string } | { fin: true };

export function buildPersonaSystemPrompt(p: Persona): string {
  const lang = p.idioma === "en" ? "Write ONLY in English." : "Escribe SOLO en español.";
  return [
    `Eres un comprador simulado escribiéndole a un vendedor de esmeraldas por chat.`,
    `Arquetipo: ${p.arquetipo}. Objetivo: ${p.objetivo}.`,
    `Presupuesto: ${p.presupuesto}. Nivel de conocimiento: ${p.nivelConocimiento}.`,
    `A lo largo de la conversación DEBES plantear, de forma natural y una a una, estas inquietudes:`,
    ...p.objeciones.map((o) => `  - ${o}`),
    `Escribe como una persona real por WhatsApp: 1-2 frases, informal, sin sonar a bot.`,
    lang,
    `Cuando ya hayas planteado tus inquietudes y obtenido respuesta, o la conversación llegue a un cierre natural, responde EXACTAMENTE con la palabra: FIN`,
    `Devuelve SOLO tu próximo mensaje (o FIN). Sin comillas ni prefijos.`,
  ].join("\n");
}

function renderHistorial(historial: HistItem[]): string {
  if (historial.length === 0) return "(aún no hay mensajes)";
  return historial.map((h) => `${h.rol === "comprador" ? "TÚ" : "VENDEDOR"}: ${h.texto}`).join("\n");
}

export async function siguienteTurno(model: LlmModel, persona: Persona, historial: HistItem[]): Promise<TurnoResult> {
  const res = await model.invoke([
    { role: "system", content: buildPersonaSystemPrompt(persona) },
    { role: "user", content: `Conversación hasta ahora:\n${renderHistorial(historial)}\n\nTu próximo mensaje:` },
  ]);
  const texto = (typeof res.content === "string" ? res.content : String(res.content ?? "")).trim();
  if (/^fin\b/i.test(texto) || texto.toUpperCase() === "FIN") return { fin: true };
  return { fin: false, texto };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/harvest && npx tsx --test "src/**/__tests__/personaEngine.test.ts"`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/harvest/src/personaEngine.ts packages/harvest/src/__tests__/personaEngine.test.ts
git -c skill.commit=true commit -m "feat(harvest): persona engine that drives buyer turns with FIN sentinel"
```

---

### Task 5: harvester (extracción estructurada del par)

**Files:**
- Create: `packages/harvest/src/harvester.ts`
- Test: `packages/harvest/src/__tests__/harvester.test.ts`

**Interfaces:**
- Consumes: `LlmModel`, `DatasetRecord`, `Veta` de `./types.js`
- Produces: `async function extraerRegistro(model: LlmModel, input: { conversationId: string; personaKey: string; turno: number; mensajeComprador: string; respuestaDueno: string; contextoPrevio: string }): Promise<DatasetRecord>`

Nota: el modelo devuelve JSON `{ veta, notasExtraccion }`; se valida con zod. Si el JSON es inválido, se cae a `veta:"otro"` (no rompe la cosecha).

- [ ] **Step 1: Write the failing test**

`packages/harvest/src/__tests__/harvester.test.ts`:
```typescript
import { test } from "node:test";
import assert from "node:assert/strict";
import { extraerRegistro } from "../harvester.js";
import type { LlmModel } from "../types.js";

const fakeModel = (reply: string): LlmModel => ({ invoke: async () => ({ content: reply }) });
const base = {
  conversationId: "c1", personaKey: "cazador_ganga", turno: 2,
  mensajeComprador: "¿me haces descuento?", respuestaDueno: "Te puedo dejar en 1900 si cierras hoy",
  contextoPrevio: "Cliente busca colombiana 5-6ct por 2000 USD",
};

test("clasifica la veta y conserva los textos", async () => {
  const r = await extraerRegistro(fakeModel('{"veta":"precio","notasExtraccion":"cede 100 USD por cierre hoy"}'), base);
  assert.equal(r.veta, "precio");
  assert.equal(r.mensajeComprador, base.mensajeComprador);
  assert.equal(r.respuestaDueno, base.respuestaDueno);
  assert.equal(r.personaKey, "cazador_ganga");
  assert.equal(r.turno, 2);
});

test("cae a 'otro' si el modelo devuelve basura", async () => {
  const r = await extraerRegistro(fakeModel("no soy json"), base);
  assert.equal(r.veta, "otro");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/harvest && npx tsx --test "src/**/__tests__/harvester.test.ts"`
Expected: FAIL — `Cannot find module '../harvester.js'`.

- [ ] **Step 3: Implement harvester.ts**

`packages/harvest/src/harvester.ts`:
```typescript
import { z } from "zod";
import type { LlmModel, DatasetRecord } from "./types.js";

const Salida = z.object({
  veta: z.enum(["precio", "objecion", "producto", "tono", "otro"]),
  notasExtraccion: z.string(),
});

const SYSTEM = [
  "Analizas un intercambio de una venta de esmeraldas: el mensaje del comprador y la respuesta del VENDEDOR (dueño real).",
  "Clasifica qué 'veta' de conocimiento aporta la respuesta del vendedor:",
  "  precio (anclas/descuentos/negociación), objecion (cómo maneja una objeción),",
  "  producto (datos de la piedra: origen/tratamiento/certificado/jardín), tono (estilo/voz), otro.",
  "Devuelve SOLO JSON: {\"veta\": \"...\", \"notasExtraccion\": \"<qué aprendimos del vendedor, 1 frase>\"}",
].join("\n");

export async function extraerRegistro(
  model: LlmModel,
  input: {
    conversationId: string; personaKey: string; turno: number;
    mensajeComprador: string; respuestaDueno: string; contextoPrevio: string;
  }
): Promise<DatasetRecord> {
  let veta: DatasetRecord["veta"] = "otro";
  let notasExtraccion = "";
  try {
    const res = await model.invoke([
      { role: "system", content: SYSTEM },
      { role: "user", content: `Contexto: ${input.contextoPrevio}\nCOMPRADOR: ${input.mensajeComprador}\nVENDEDOR: ${input.respuestaDueno}` },
    ]);
    const raw = typeof res.content === "string" ? res.content : String(res.content ?? "");
    const parsed = Salida.parse(JSON.parse(raw));
    veta = parsed.veta;
    notasExtraccion = parsed.notasExtraccion;
  } catch {
    veta = "otro";
    notasExtraccion = "";
  }
  return {
    conversationId: input.conversationId,
    personaKey: input.personaKey,
    turno: input.turno,
    mensajeComprador: input.mensajeComprador,
    respuestaDueno: input.respuestaDueno,
    contextoPrevio: input.contextoPrevio,
    veta,
    notasExtraccion,
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/harvest && npx tsx --test "src/**/__tests__/harvester.test.ts"`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/harvest/src/harvester.ts packages/harvest/src/__tests__/harvester.test.ts
git -c skill.commit=true commit -m "feat(harvest): harvester extracts structured dataset record with veta"
```

---

### Task 6: Observabilidad Langfuse (no-op-safe) + barrel

**Files:**
- Create: `packages/harvest/src/observability.ts`
- Create: `packages/harvest/src/index.ts`
- Test: `packages/harvest/src/__tests__/observability.test.ts`

**Interfaces:**
- Consumes: `DatasetRecord` de `./types.js`
- Produces: `function getLangfuse(): Langfuse | null` (null si faltan keys); `async function espejarDataset(record: DatasetRecord): Promise<string | null>` (devuelve el datasetItemId o null si no-op); `const DATASET_NAME = "meraldi-golden-v1"`. `index.ts` re-exporta todo el paquete.

- [ ] **Step 1: Write the failing test**

`packages/harvest/src/__tests__/observability.test.ts`:
```typescript
import { test } from "node:test";
import assert from "node:assert/strict";
import { espejarDataset } from "../observability.js";

test("espejarDataset no lanza y devuelve null en modo no-op (sin keys)", async () => {
  delete process.env.LANGFUSE_PUBLIC_KEY;
  delete process.env.LANGFUSE_SECRET_KEY;
  const id = await espejarDataset({
    conversationId: "c1", personaKey: "tecnico", turno: 1,
    mensajeComprador: "x", respuestaDueno: "y", contextoPrevio: "z",
    veta: "producto", notasExtraccion: "n",
  });
  assert.equal(id, null);
});
```

Nota: `getLangfuse` cachea el cliente; por eso el test solo ejercita `espejarDataset` en modo sin-keys (no mezclamos estados de env en el mismo proceso de test).

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/harvest && npx tsx --test "src/**/__tests__/observability.test.ts"`
Expected: FAIL — `Cannot find module '../observability.js'`.

- [ ] **Step 3: Implement observability.ts**

`packages/harvest/src/observability.ts`:
```typescript
import { Langfuse } from "langfuse";
import type { DatasetRecord } from "./types.js";

export const DATASET_NAME = "meraldi-golden-v1";

let cached: Langfuse | null | undefined;

export function getLangfuse(): Langfuse | null {
  if (cached !== undefined) return cached;
  const publicKey = process.env.LANGFUSE_PUBLIC_KEY;
  const secretKey = process.env.LANGFUSE_SECRET_KEY;
  if (!publicKey || !secretKey) {
    cached = null;
    return null;
  }
  cached = new Langfuse({ publicKey, secretKey, baseUrl: process.env.LANGFUSE_HOST });
  return cached;
}

/** Espeja un registro al Langfuse Dataset. Id determinista = idempotente en re-runs. */
export async function espejarDataset(record: DatasetRecord): Promise<string | null> {
  const lf = getLangfuse();
  if (!lf) return null;
  const id = `${record.conversationId}:${record.turno}`;
  try {
    await lf.createDatasetItem({
      datasetName: DATASET_NAME,
      id,
      input: { mensajeComprador: record.mensajeComprador, contextoPrevio: record.contextoPrevio },
      expectedOutput: record.respuestaDueno,
      metadata: { personaKey: record.personaKey, veta: record.veta, conversationId: record.conversationId, turno: record.turno },
    });
    await lf.flushAsync();
    return id;
  } catch (err) {
    console.error("[harvest] espejarDataset falló (se conserva el registro local):", err);
    return null;
  }
}
```

- [ ] **Step 4: Implement the barrel index.ts**

`packages/harvest/src/index.ts`:
```typescript
export * from "./types.js";
export * from "./config.js";
export * from "./personas.js";
export * from "./guardrails.js";
export * from "./personaEngine.js";
export * from "./harvester.js";
export * from "./observability.js";
```

- [ ] **Step 5: Run test + type-check**

Run: `cd packages/harvest && npx tsx --test "src/**/__tests__/observability.test.ts" && npm run type-check`
Expected: PASS (1 test) y type-check sin errores.

- [ ] **Step 6: Commit**

```bash
git add packages/harvest/src/observability.ts packages/harvest/src/index.ts packages/harvest/src/__tests__/observability.test.ts
git -c skill.commit=true commit -m "feat(harvest): no-op-safe Langfuse dataset mirroring + barrel"
```

---

### Task 7: Migración SQL + queries de `harvest_*` en `@iris/db`

**Files:**
- Create: `packages/db/supabase/migrations/00004_harvest.sql`
- Create: `packages/db/src/queries/harvest.ts`
- Modify: `packages/db/src/index.ts`
- Test: `packages/db/src/queries/__tests__/harvest.test.ts`

**Interfaces:**
- Produces (builders puros + I/O). Firmas exactas:
  - `interface DatasetRecord` (misma forma que en `@iris/harvest`, re-declarada localmente para no acoplar `@iris/db` a `@iris/harvest`)
  - `function buildConversacionRow(personaKey: string, ownerChatId: number): { persona_key: string; estado: "activa"; turno_actual: number; owner_chat_id: number }`
  - `async function crearConversacion(db: DbClient, personaKey: string, ownerChatId: number): Promise<{ id: string }>`
  - `async function getConversacionActiva(db: DbClient): Promise<{ id: string; persona_key: string; turno_actual: number } | null>`
  - `async function addHarvestMessage(db: DbClient, conversationId: string, rol: "comprador" | "dueño", texto: string, turno: number): Promise<void>`
  - `async function getHarvestMessages(db: DbClient, conversationId: string): Promise<{ rol: "comprador" | "dueño"; texto: string }[]>`
  - `async function guardarDatasetRecord(db: DbClient, rec: DatasetRecord, langfuseItemId: string | null): Promise<void>`
  - `async function cerrarConversacion(db: DbClient, id: string, estado: "terminada" | "detenida", motivo: string): Promise<void>`
  - `async function bumpTurno(db: DbClient, id: string, turno: number): Promise<void>`
  - `async function marcarTodasDetenidas(db: DbClient, motivo: string): Promise<number>`
  - `async function updateYaVisto(db: DbClient, updateId: number): Promise<boolean>` (true si ya estaba visto)

- [ ] **Step 1: Create the migration**

`packages/db/supabase/migrations/00004_harvest.sql`:
```sql
create table if not exists harvest_conversations (
  id uuid primary key default gen_random_uuid(),
  persona_key text not null,
  estado text not null default 'activa' check (estado in ('activa','terminada','detenida')),
  turno_actual int not null default 0,
  motivo_fin text,
  owner_chat_id bigint not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
-- A lo más una conversación activa a la vez (concurrencia = 1).
create unique index if not exists harvest_una_activa
  on harvest_conversations ((estado)) where estado = 'activa';

create table if not exists harvest_messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references harvest_conversations(id) on delete cascade,
  rol text not null check (rol in ('comprador','dueño')),
  texto text not null,
  turno int not null,
  created_at timestamptz not null default now()
);

create table if not exists harvest_dataset (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references harvest_conversations(id) on delete cascade,
  persona_key text not null,
  turno int not null,
  mensaje_comprador text not null,
  respuesta_dueno text not null,
  contexto_previo text not null default '',
  veta text not null check (veta in ('precio','objecion','producto','tono','otro')),
  notas_extraccion text not null default '',
  langfuse_dataset_item_id text,
  created_at timestamptz not null default now()
);

-- Idempotencia de webhooks: un update_id de Telegram se procesa una sola vez.
create table if not exists harvest_updates_vistos (
  update_id bigint primary key,
  created_at timestamptz not null default now()
);
```

- [ ] **Step 2: Write the failing test (builder puro)**

`packages/db/src/queries/__tests__/harvest.test.ts`:
```typescript
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildConversacionRow } from "../harvest.js";

test("buildConversacionRow arma la fila inicial en estado activa", () => {
  const row = buildConversacionRow("inversionista", 12345);
  assert.equal(row.persona_key, "inversionista");
  assert.equal(row.estado, "activa");
  assert.equal(row.turno_actual, 0);
  assert.equal(row.owner_chat_id, 12345);
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `cd packages/db && npx tsx --test "src/queries/__tests__/harvest.test.ts"`
Expected: FAIL — `Cannot find module '../harvest.js'`.

- [ ] **Step 4: Implement queries/harvest.ts**

`packages/db/src/queries/harvest.ts`:
```typescript
import type { DbClient } from "../client.js";

export interface DatasetRecord {
  conversationId: string; personaKey: string; turno: number;
  mensajeComprador: string; respuestaDueno: string; contextoPrevio: string;
  veta: "precio" | "objecion" | "producto" | "tono" | "otro"; notasExtraccion: string;
}

export function buildConversacionRow(personaKey: string, ownerChatId: number) {
  return { persona_key: personaKey, estado: "activa" as const, turno_actual: 0, owner_chat_id: ownerChatId };
}

export async function crearConversacion(db: DbClient, personaKey: string, ownerChatId: number): Promise<{ id: string }> {
  const { data, error } = await db
    .from("harvest_conversations")
    .insert(buildConversacionRow(personaKey, ownerChatId))
    .select("id")
    .single();
  if (error) throw error;
  return data as { id: string };
}

export async function getConversacionActiva(
  db: DbClient
): Promise<{ id: string; persona_key: string; turno_actual: number } | null> {
  const { data, error } = await db
    .from("harvest_conversations")
    .select("id, persona_key, turno_actual")
    .eq("estado", "activa")
    .maybeSingle();
  if (error) throw error;
  return (data as { id: string; persona_key: string; turno_actual: number } | null) ?? null;
}

export async function addHarvestMessage(
  db: DbClient, conversationId: string, rol: "comprador" | "dueño", texto: string, turno: number
): Promise<void> {
  const { error } = await db.from("harvest_messages").insert({ conversation_id: conversationId, rol, texto, turno });
  if (error) throw error;
}

export async function getHarvestMessages(
  db: DbClient, conversationId: string
): Promise<{ rol: "comprador" | "dueño"; texto: string }[]> {
  const { data, error } = await db
    .from("harvest_messages")
    .select("rol, texto")
    .eq("conversation_id", conversationId)
    .order("created_at", { ascending: true });
  if (error) throw error;
  return (data ?? []) as { rol: "comprador" | "dueño"; texto: string }[];
}

export async function guardarDatasetRecord(db: DbClient, rec: DatasetRecord, langfuseItemId: string | null): Promise<void> {
  const { error } = await db.from("harvest_dataset").insert({
    conversation_id: rec.conversationId, persona_key: rec.personaKey, turno: rec.turno,
    mensaje_comprador: rec.mensajeComprador, respuesta_dueno: rec.respuestaDueno,
    contexto_previo: rec.contextoPrevio, veta: rec.veta, notas_extraccion: rec.notasExtraccion,
    langfuse_dataset_item_id: langfuseItemId,
  });
  if (error) throw error;
}

export async function cerrarConversacion(
  db: DbClient, id: string, estado: "terminada" | "detenida", motivo: string
): Promise<void> {
  const { error } = await db
    .from("harvest_conversations")
    .update({ estado, motivo_fin: motivo, updated_at: new Date().toISOString() })
    .eq("id", id);
  if (error) throw error;
}

export async function bumpTurno(db: DbClient, id: string, turno: number): Promise<void> {
  const { error } = await db
    .from("harvest_conversations")
    .update({ turno_actual: turno, updated_at: new Date().toISOString() })
    .eq("id", id);
  if (error) throw error;
}

export async function marcarTodasDetenidas(db: DbClient, motivo: string): Promise<number> {
  const { data, error } = await db
    .from("harvest_conversations")
    .update({ estado: "detenida", motivo_fin: motivo, updated_at: new Date().toISOString() })
    .eq("estado", "activa")
    .select("id");
  if (error) throw error;
  return (data ?? []).length;
}

/** Devuelve true si el update_id ya había sido visto (procesar y salir). */
export async function updateYaVisto(db: DbClient, updateId: number): Promise<boolean> {
  const { error } = await db.from("harvest_updates_vistos").insert({ update_id: updateId });
  if (error) {
    if ((error as { code?: string }).code === "23505") return true; // unique_violation
    throw error;
  }
  return false;
}
```

- [ ] **Step 5: Export from db barrel**

Modify `packages/db/src/index.ts` — añadir al final:
```typescript
export * from "./queries/harvest.js";
```

- [ ] **Step 6: Run test + apply migration**

Run: `cd packages/db && npx tsx --test "src/queries/__tests__/harvest.test.ts"`
Expected: PASS (1 test).
Run (repo root, requiere `apps/web/.env` con `DATABASE_URL`): `node scripts/apply-migration.mjs`
Expected: aplica `00004_harvest.sql` sin error (imprime "Aplicando 00004_harvest.sql...").

- [ ] **Step 7: Commit**

```bash
git add packages/db/supabase/migrations/00004_harvest.sql packages/db/src/queries/harvest.ts packages/db/src/index.ts packages/db/src/queries/__tests__/harvest.test.ts
git -c skill.commit=true commit -m "feat(db): harvest tables migration + queries (concurrency=1, idempotency)"
```

---

### Task 8: Sender dedicado + script `cosechar-iniciar`

**Files:**
- Create: `apps/web/src/lib/telegram/harvest-send.ts`
- Create: `scripts/cosechar-iniciar.mts`

**Interfaces:**
- Consumes: `harvestEnv`, `getPersona` de `@iris/harvest`; `crearConversacion`, `getConversacionActiva`, `addHarvestMessage`, `createServerClient` de `@iris/db`
- Produces: `async function sendHarvestMessage(chatId: number, text: string): Promise<void>`

- [ ] **Step 1: Implement the dedicated sender**

`apps/web/src/lib/telegram/harvest-send.ts`:
```typescript
export async function sendHarvestMessage(chatId: number, text: string): Promise<void> {
  const token = process.env.HARVEST_BOT_TOKEN ?? "";
  if (!token) {
    console.warn("[harvest] HARVEST_BOT_TOKEN no configurado, se omite el envío");
    return;
  }
  const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    console.error("[harvest] sendMessage falló:", res.status, body);
  }
}
```

- [ ] **Step 2: Implement the launch script**

`scripts/cosechar-iniciar.mts`:
```typescript
// Inicia una conversación de cosecha con el dueño. Uso:
//   npx tsx --env-file=apps/web/.env scripts/cosechar-iniciar.mts <persona_key>
import { createServerClient, getConversacionActiva, crearConversacion, addHarvestMessage } from "../packages/db/src/index.ts";
import { getPersona, harvestEnv } from "../packages/harvest/src/index.ts";
import { sendHarvestMessage } from "../apps/web/src/lib/telegram/harvest-send.ts";

const key = process.argv[2];
if (!key) { console.error("Falta persona_key. Ej: cosechar-iniciar.mts inversionista"); process.exit(1); }

const persona = getPersona(key);
const { ownerChatId } = harvestEnv();
if (!Number.isFinite(ownerChatId)) { console.error("OWNER_HARVEST_CHAT_ID no configurado"); process.exit(1); }

const db = createServerClient();
if (await getConversacionActiva(db)) {
  console.error("Ya hay una conversación activa. Ciérrala con cosechar-detener.mts antes de iniciar otra.");
  process.exit(1);
}

const { id } = await crearConversacion(db, persona.key, ownerChatId);
await addHarvestMessage(db, id, "comprador", persona.primerMensaje, 1);
await sendHarvestMessage(ownerChatId, persona.primerMensaje);
console.log(`Conversación ${id} iniciada con persona "${persona.key}". Primer mensaje enviado al dueño.`);
```

- [ ] **Step 3: Type-check**

Run (repo root): `npm run type-check`
Expected: sin errores.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/lib/telegram/harvest-send.ts scripts/cosechar-iniciar.mts
git -c skill.commit=true commit -m "feat(harvest): dedicated Telegram sender + launch script (concurrency guard)"
```

---

### Task 9: Transporte event-driven `/api/harvest/webhook` (+ Langfuse capa 1)

**Files:**
- Modify: `packages/agent/src/model.ts` (`createChatModel` acepta `callbacks`)
- Create: `apps/web/src/app/api/harvest/webhook/route.ts`

**Interfaces:**
- Consumes: `getPersona`, `evaluarGuardrails`, `siguienteTurno`, `extraerRegistro`, `espejarDataset`, `harvestEnv`, `RESPONSE_DELAY_MS`, `HistItem` de `@iris/harvest`; queries de `@iris/db`; `sendHarvestMessage`; `createChatModel` de `@iris/agent`; `CallbackHandler` de `langfuse-langchain`
- Produces: `createChatModel(opts?: { temperature?: number; callbacks?: unknown[] })`; endpoint `POST` que procesa un turno por evento

Contrato de turnos: cuando el comprador manda su mensaje del turno N, se persiste con `turno=N` y `harvest_conversations.turno_actual=N`. La respuesta del dueño se guarda con el mismo `turno=N`. El registro de dataset se etiqueta `turno=N`. El siguiente mensaje del comprador incrementa a `N+1`.

**Langfuse capa 1 (tracing de cosecha):** el webhook construye un `CallbackHandler` (solo si hay keys) y lo pasa a `createChatModel`, de modo que las llamadas del `harvester` y del `personaEngine` quedan trazadas por-turno. Requiere que `langfuse-langchain` esté instalado (dep de `@iris/harvest`, ya presente desde Task 1).

- [ ] **Step 1: Extend `createChatModel` to accept callbacks**

En `packages/agent/src/model.ts`, cambiar la firma y pasar `callbacks` al constructor:
```typescript
export function createChatModel(opts?: { temperature?: number; callbacks?: unknown[] }): ChatOpenAI {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) throw new Error("Missing OPENROUTER_API_KEY");

  return new ChatOpenAI({
    modelName: "openai/gpt-4o-mini",
    temperature: opts?.temperature ?? 0.1,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    callbacks: opts?.callbacks as any,
    configuration: {
      baseURL: "https://openrouter.ai/api/v1",
      defaultHeaders: { "HTTP-Referer": "https://iris.local" },
    },
    apiKey,
  });
}
```
Run: `cd packages/agent && npm test`
Expected: PASS (los tests existentes no dependen de `callbacks`; es opcional).

- [ ] **Step 2: Implement the webhook**

`apps/web/src/app/api/harvest/webhook/route.ts`:
```typescript
import { NextResponse } from "next/server";
import { createChatModel } from "@iris/agent";
import {
  createServerClient, getConversacionActiva, getHarvestMessages, addHarvestMessage,
  guardarDatasetRecord, cerrarConversacion, bumpTurno, updateYaVisto,
} from "@iris/db";
import {
  getPersona, evaluarGuardrails, siguienteTurno, extraerRegistro, espejarDataset, harvestEnv, RESPONSE_DELAY_MS,
  type HistItem,
} from "@iris/harvest";
import { sendHarvestMessage } from "@/lib/telegram/harvest-send";
import { CallbackHandler } from "langfuse-langchain";

export const runtime = "nodejs";
export const maxDuration = 60;

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

function langfuseCallbacks(): unknown[] | undefined {
  if (!process.env.LANGFUSE_PUBLIC_KEY || !process.env.LANGFUSE_SECRET_KEY) return undefined;
  return [
    new CallbackHandler({
      publicKey: process.env.LANGFUSE_PUBLIC_KEY,
      secretKey: process.env.LANGFUSE_SECRET_KEY,
      baseUrl: process.env.LANGFUSE_HOST,
    }),
  ];
}

export async function POST(request: Request) {
  const { webhookSecret, ownerChatId } = harvestEnv();
  const secret = request.headers.get("x-telegram-bot-api-secret-token");
  if (!webhookSecret || secret !== webhookSecret) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const update = (await request.json().catch(() => null)) as
    | { update_id?: number; message?: { chat?: { id?: number }; text?: string } }
    | null;
  if (!update?.message?.text || update.update_id == null) return NextResponse.json({ ok: true });
  if (update.message.chat?.id !== ownerChatId) return NextResponse.json({ ok: true });

  const db = createServerClient();

  // Idempotencia: un reintento de Telegram no genera turno duplicado.
  if (await updateYaVisto(db, update.update_id)) return NextResponse.json({ ok: true });

  const conv = await getConversacionActiva(db);
  if (!conv) return NextResponse.json({ ok: true });

  const respuestaDueno = update.message.text.trim();
  const callbacks = langfuseCallbacks(); // Langfuse capa 1: traza harvester + personaEngine

  try {
    // 1) Guarda la respuesta del dueño en el turno actual del comprador.
    await addHarvestMessage(db, conv.id, "dueño", respuestaDueno, conv.turno_actual);

    // 2) Historial completo (incluye la respuesta recién guardada).
    const historial = (await getHarvestMessages(db, conv.id)) as HistItem[];
    const ultimoComprador = [...historial].reverse().find((h) => h.rol === "comprador")?.texto ?? "";
    const contextoPrevio = historial.slice(0, -1).map((h) => `${h.rol}: ${h.texto}`).join(" | ").slice(0, 1000);

    // 3) Cosecha el par → dataset local + espejo Langfuse.
    const rec = await extraerRegistro(createChatModel({ callbacks }), {
      conversationId: conv.id, personaKey: conv.persona_key, turno: conv.turno_actual,
      mensajeComprador: ultimoComprador, respuestaDueno, contextoPrevio,
    });
    const itemId = await espejarDataset(rec);
    await guardarDatasetRecord(db, rec, itemId);

    // 4) Guardrails.
    const g = evaluarGuardrails({ turnosComprador: conv.turno_actual, ultimoTextoDueno: respuestaDueno });
    if (g.accion === "detener") {
      await cerrarConversacion(db, conv.id, "detenida", g.motivo);
      return NextResponse.json({ ok: true });
    }

    // 5) Siguiente turno del comprador.
    const persona = getPersona(conv.persona_key);
    const turno = await siguienteTurno(createChatModel({ temperature: 0.7, callbacks }), persona, historial);
    if (turno.fin) {
      await cerrarConversacion(db, conv.id, "terminada", "persona finalizó");
      return NextResponse.json({ ok: true });
    }

    // 6) Persiste, avanza el turno y envía (con delay para no sonar robótico).
    const nuevoTurno = conv.turno_actual + 1;
    await addHarvestMessage(db, conv.id, "comprador", turno.texto, nuevoTurno);
    await bumpTurno(db, conv.id, nuevoTurno);
    await delay(RESPONSE_DELAY_MS);
    await sendHarvestMessage(ownerChatId, turno.texto);
  } catch (err) {
    console.error("[harvest] error procesando turno:", err);
  }

  return NextResponse.json({ ok: true });
}
```

- [ ] **Step 3: Type-check**

Run (repo root): `npm run type-check`
Expected: sin errores (verifica que `@iris/harvest` exporta `HistItem`, `RESPONSE_DELAY_MS`, etc.).

- [ ] **Step 4: Commit**

```bash
git add packages/agent/src/model.ts apps/web/src/app/api/harvest/webhook/route.ts
git -c skill.commit=true commit -m "feat(harvest): event-driven webhook + Langfuse layer-1 tracing of harvest turns"
```

---

### Task 10: Kill-switch + harness dry-run

**Files:**
- Create: `scripts/cosechar-detener.mts`
- Create: `scripts/cosechar-dryrun.mts`

**Interfaces:**
- Consumes: `marcarTodasDetenidas`, `createServerClient` de `@iris/db`; `getPersona`, `siguienteTurno`, `evaluarGuardrails`, `extraerRegistro`, `MAX_TURNOS`, `HistItem` de `@iris/harvest`; `createChatModel` de `@iris/agent`
- Produces: dos scripts CLI (sin exports)

- [ ] **Step 1: Implement the kill-switch**

`scripts/cosechar-detener.mts`:
```typescript
// Detiene toda conversación de cosecha activa. Uso:
//   npx tsx --env-file=apps/web/.env scripts/cosechar-detener.mts
import { createServerClient, marcarTodasDetenidas } from "../packages/db/src/index.ts";

const db = createServerClient();
const n = await marcarTodasDetenidas(db, "kill-switch manual");
console.log(`Detenidas ${n} conversación(es) activa(s).`);
```

- [ ] **Step 2: Implement the dry-run harness**

`scripts/cosechar-dryrun.mts`:
```typescript
// Corre una conversación de cosecha completa SIN Telegram ni Supabase reales:
// el "dueño" lo simula otro LLM. Uso:
//   npx tsx --env-file=apps/web/.env scripts/cosechar-dryrun.mts <persona_key>
import { getPersona, siguienteTurno, evaluarGuardrails, extraerRegistro, MAX_TURNOS } from "../packages/harvest/src/index.ts";
import { createChatModel } from "../packages/agent/src/model.ts";
import type { HistItem } from "../packages/harvest/src/types.ts";

const persona = getPersona(process.argv[2] ?? "inversionista");
const comprador = createChatModel({ temperature: 0.7 });
const cosechador = createChatModel({ temperature: 0.1 });
const dueno = createChatModel({ temperature: 0.6 });

const DUENO_SYS =
  "Eres el dueño real de Meraldi, vendedor experto de esmeraldas colombianas. Responde a un cliente por chat, " +
  "1-3 frases, cálido y concreto: da precios de ejemplo, maneja objeciones, describe piedras. Español natural.";

async function responderDueno(historial: HistItem[]): Promise<string> {
  const conv = historial.map((h) => `${h.rol === "comprador" ? "CLIENTE" : "TÚ"}: ${h.texto}`).join("\n");
  const res = await dueno.invoke([
    { role: "system", content: DUENO_SYS },
    { role: "user", content: `${conv}\nTÚ:` },
  ]);
  return (typeof res.content === "string" ? res.content : String(res.content ?? "")).trim();
}

const historial: HistItem[] = [{ rol: "comprador", texto: persona.primerMensaje }];
console.log(`\n🧑 [${persona.key}] ${persona.primerMensaje}`);

for (let turno = 1; turno <= MAX_TURNOS; turno++) {
  const respuestaDueno = await responderDueno(historial);
  historial.push({ rol: "dueño", texto: respuestaDueno });
  console.log(`💚 ${respuestaDueno}`);

  const ultimoComprador = [...historial].reverse().find((h) => h.rol === "comprador")!.texto;
  const rec = await extraerRegistro(cosechador, {
    conversationId: "dryrun", personaKey: persona.key, turno,
    mensajeComprador: ultimoComprador, respuestaDueno, contextoPrevio: "",
  });
  console.log(`   🏷️  veta=${rec.veta} — ${rec.notasExtraccion}`);

  const g = evaluarGuardrails({ turnosComprador: turno, ultimoTextoDueno: respuestaDueno });
  if (g.accion === "detener") { console.log(`   ⛔ ${g.motivo}`); break; }

  const next = await siguienteTurno(comprador, persona, historial);
  if (next.fin) { console.log(`   ✅ persona finalizó`); break; }
  historial.push({ rol: "comprador", texto: next.texto });
  console.log(`\n🧑 ${next.texto}`);
}
```

- [ ] **Step 3: Run the dry-run end-to-end (requires OPENROUTER_API_KEY en apps/web/.env)**

Run: `npx tsx --env-file=apps/web/.env scripts/cosechar-dryrun.mts cazador_ganga`
Expected: imprime una conversación completa comprador↔"dueño", con `veta=...` por turno, y termina por `FIN` o por MAX_TURNOS sin loop infinito. Verifica manualmente que el comprador plantea sus objeciones y suena humano.

- [ ] **Step 4: Commit**

```bash
git add scripts/cosechar-detener.mts scripts/cosechar-dryrun.mts
git -c skill.commit=true commit -m "feat(harvest): kill-switch + offline dry-run harness (LLM-simulated owner)"
```

---

### Task 11: Langfuse capa 4 — tracing de producción de Iris

**Files:**
- Modify: `packages/agent/src/graph.ts` (runIris acepta callbacks opcionales)
- Modify: `packages/agent/package.json` (dep `langfuse-langchain`)
- Modify: `apps/web/src/app/api/telegram/webhook/route.ts`

**Interfaces:**
- Consumes: `CallbackHandler` de `langfuse-langchain`
- Produces: `runIris(deps, input, opts?: { callbacks?: unknown[] })` reenvía `opts.callbacks` a la config de `graph.invoke`

- [ ] **Step 1: Locate the graph.invoke call in runIris**

Run: `grep -n "invoke\|export async function runIris" packages/agent/src/graph.ts`
Expected: encontrar la firma de `runIris` y la línea donde llama `graph.invoke(state, { configurable: { thread_id: ... } })`.

- [ ] **Step 2: Add optional callbacks to runIris**

En `packages/agent/src/graph.ts`: añadir a `runIris` un tercer parámetro opcional `opts` y reenviar `opts.callbacks` en la config de `graph.invoke`. La config pasa de:
```typescript
{ configurable: { thread_id: String(input.telegramUserId) } }
```
a:
```typescript
{ configurable: { thread_id: String(input.telegramUserId) }, callbacks: opts?.callbacks }
```
y la firma añade (sin cambiar el tipo del `input` existente, solo agregando `opts`):
```typescript
opts?: { callbacks?: unknown[] }
```
Ejemplo de firma resultante (ajusta el tipo de `input` al que ya exista en el archivo):
```typescript
export async function runIris(
  deps: IrisDeps,
  input: { telegramUserId: number; chatId: number; text: string; telegramUsername?: string | null },
  opts?: { callbacks?: unknown[] }
): Promise<{ reply: string; mediaUrl: string | null }> {
```

- [ ] **Step 3: Add langfuse-langchain dep to the agent package**

En `packages/agent/package.json`, dentro de `dependencies`, añadir:
```json
"langfuse-langchain": "^3.39.0",
```
Run (repo root): `npm install`

- [ ] **Step 4: Wire the handler in the production webhook**

En `apps/web/src/app/api/telegram/webhook/route.ts`: importar el handler y construirlo solo si hay keys, y pasarlo a `runIris`.
Añadir el import arriba:
```typescript
import { CallbackHandler } from "langfuse-langchain";
```
Antes del `try` que llama `runIris` (dentro del `POST`, tras crear `deps`):
```typescript
const lfHandler =
  process.env.LANGFUSE_PUBLIC_KEY && process.env.LANGFUSE_SECRET_KEY
    ? new CallbackHandler({
        publicKey: process.env.LANGFUSE_PUBLIC_KEY,
        secretKey: process.env.LANGFUSE_SECRET_KEY,
        baseUrl: process.env.LANGFUSE_HOST,
      })
    : undefined;
```
Y cambiar la llamada:
```typescript
const { reply, mediaUrl } = await runIris(deps, parsed, lfHandler ? { callbacks: [lfHandler] } : undefined);
```

- [ ] **Step 5: Verify existing agent tests still pass + type-check**

Run: `cd packages/agent && npm test && npm run type-check`
Expected: PASS (los tests existentes no se rompen; `opts` es opcional).
Run (repo root): `npm run type-check`
Expected: sin errores.

- [ ] **Step 6: Commit**

```bash
git add packages/agent/src/graph.ts packages/agent/package.json apps/web/src/app/api/telegram/webhook/route.ts package-lock.json
git -c skill.commit=true commit -m "feat(agent): optional Langfuse tracing on production Iris webhook"
```

---

## Cierre de Entrega 1

- [ ] **Suite completa + type-check global**

Run (repo root): `npm test && npm run type-check`
Expected: todos los paquetes PASS, sin errores de tipos.

- [ ] **Setup operativo (manual, una vez):**
  1. Crear el bot dedicado con @BotFather → `HARVEST_BOT_TOKEN`.
  2. Añadir a `apps/web/.env`: `HARVEST_BOT_TOKEN`, `HARVEST_WEBHOOK_SECRET`, `OWNER_HARVEST_CHAT_ID`, `LANGFUSE_PUBLIC_KEY`, `LANGFUSE_SECRET_KEY`, `LANGFUSE_HOST`.
  3. Registrar el webhook del bot de cosecha apuntando a `/api/harvest/webhook` con el `secret_token` (`setWebhook` con `secret_token=HARVEST_WEBHOOK_SECRET`).
  4. `node scripts/apply-migration.mjs` contra el Supabase objetivo.
  5. Crear el dataset `meraldi-golden-v1` en Langfuse (o dejar que `createDatasetItem` lo cree en el primer espejo, según versión del SDK).

## Fuera de esta entrega (planes propios)

- **Entrega 2 — eval-runner (`scripts/eval-iris-vs-oro.mts`):** corre Iris contra `meraldi-golden-v1`, puntúa fidelidad (LLM-judge) + rúbrica determinista, agrega por veta. Se planifica cuando haya oro en el dataset.
- **Entrega 3 — doc de recomendaciones de tools de Iris:** data-driven desde el reporte de brechas por veta de la Entrega 2.
