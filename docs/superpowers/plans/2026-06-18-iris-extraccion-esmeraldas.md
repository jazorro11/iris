# Iris — Extracción NL→estructurado de solicitudes de esmeraldas — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Un bot de Telegram que conversa con compradores de esmeraldas, extrae su solicitud a información estructurada según la taxonomía Méraldi, pregunta por los datos críticos que falten y persiste cada lead en Supabase notificando al vendedor.

**Architecture:** Monorepo TypeScript (Turborepo + npm workspaces). `apps/web` (Next.js) aloja solo el webhook de Telegram. `packages/agent` corre un grafo LangGraph (`extractor → validador → preguntar | persistir`) con estado parcial acumulado por comprador vía checkpointer Postgres. `packages/db` (Supabase) persiste leads; `packages/types` define el esquema zod compartido.

**Tech Stack:** TypeScript 5, Turborepo, Next.js 15 (App Router), LangGraph JS (`@langchain/langgraph`), `@langchain/openai` (vía OpenRouter), `@langchain/langgraph-checkpoint-postgres` (`PostgresSaver`), zod 3, Supabase (`@supabase/supabase-js`), pruebas con `node:test` ejecutado por `tsx --test`.

## Global Constraints

- **Node:** >= 20. **Package manager:** npm (workspaces).
- **Dependencias fijas/floor (copiar verbatim):** `@langchain/core` pin `1.1.41` vía `overrides` en root; `@langchain/langgraph` `1.2.7` (exacto); `@langchain/openai` `1.4.2` (exacto); `@langchain/langgraph-checkpoint-postgres` `1.0.1` (exacto); `zod` `^3`; `@supabase/supabase-js` `^2`; `next` `^15`; `react` `^19`; `tsx` `^4.19.0`; `turbo` `^2`; `typescript` `^5`.
  - **Nota (deriva de versiones, 2026-06-18):** los rangos `^1.0` de langgraph/openai resuelven hoy a versiones que exigen `@langchain/core` >= 1.1.48/1.2.0, incompatibles con el pin `1.1.41` (forzarían `--legacy-peer-deps`). Por eso se fijan exactas las versiones probadas por `agent-web`. Instalar SIEMPRE sin `--legacy-peer-deps`; si vuelve a hacer falta, es señal de deriva — re-fijar versiones, no usar el flag.
  - **`@iris/db` en `@iris/agent`:** se difiere — `@iris/agent` NO declara `@iris/db` hasta la Task 7 (que es la primera que lo importa, en `graph.ts`). En Task 7 se añade `"@iris/db": "*"` a las deps del agente y se reinstala.
- **Scope de paquetes:** `@iris/config`, `@iris/types`, `@iris/db`, `@iris/agent`, `@iris/web`. Nombre root: `iris`.
- **Tests:** cada paquete con código lógico define script `"test": "tsx --test \"src/**/__tests__/**/*.test.ts\""` y usa `node:test` + `node:assert/strict`.
- **Idioma de cara al usuario:** español (mensajes al comprador y al vendedor).
- **Clasificar ≠ avaluar:** el sistema estructura la solicitud; NO asigna calidad ni precio (fuera de alcance).
- **El webhook usa Supabase service role** (bypassa RLS); no se definen políticas RLS públicas.
- **Campos críticos (orden de prioridad):** `proposito`, `presupuesto`, `tipo_pieza`, `peso_quilates`, `color`, `origen`.
- **`MAX_RONDAS = 4`:** tras 4 turnos sin completar, se persiste el lead como `incompleto` y se avisa al vendedor para seguimiento humano.

## Mapa de archivos

```
iris-solution/
├── package.json                # root: workspaces + scripts turbo + overrides
├── turbo.json                  # pipeline build/dev/lint/type-check/test
├── .gitignore
├── .env.example
├── packages/
│   ├── config/
│   │   ├── package.json
│   │   ├── tsconfig.base.json
│   │   └── tsconfig.next.json
│   ├── types/
│   │   ├── package.json
│   │   ├── tsconfig.json
│   │   └── src/
│   │       ├── index.ts        # re-exports
│   │       ├── schema.ts       # zod SolicitudSchema + Solicitud + CAMPOS_CRITICOS + CampoCritico
│   │       ├── lead.ts         # EstadoLead, LeadRow, Lead
│   │       └── __tests__/schema.test.ts
│   ├── db/
│   │   ├── package.json
│   │   ├── tsconfig.json
│   │   ├── supabase/migrations/00001_init.sql
│   │   └── src/
│   │       ├── index.ts
│   │       ├── client.ts       # createServerClient, DbClient
│   │       ├── queries/leads.ts# buildLeadRow, upsertLead, getLead, addLeadMessage
│   │       └── __tests__/leads.test.ts
│   └── agent/
│       ├── package.json
│       ├── tsconfig.json
│       └── src/
│           ├── index.ts
│           ├── request.ts      # mergeRequest, missingCriticalFields, isComplete, evaluarEstado, MAX_RONDAS
│           ├── model.ts        # createChatModel (OpenRouter)
│           ├── checkpointer.ts # getCheckpointer (PostgresSaver)
│           ├── extractor.ts    # EXTRACTION_SYSTEM_PROMPT, extractRequest, StructuredModel
│           ├── questions.ts    # PREGUNTAS, clarificationTargets, buildClarificationMessage
│           ├── state.ts        # IrisState (Annotation.Root)
│           ├── graph.ts        # IrisDeps, buildGraph, runIris, buildSellerSummary
│           └── __tests__/
│               ├── request.test.ts
│               ├── extractor.test.ts
│               ├── questions.test.ts
│               └── graph.test.ts
└── apps/web/
    ├── package.json
    ├── next.config.ts
    ├── tsconfig.json
    ├── next-env.d.ts
    └── src/
        ├── lib/telegram/
        │   ├── send.ts         # sendTelegramMessage
        │   ├── parse.ts        # parseTelegramUpdate
        │   └── __tests__/parse.test.ts
        └── app/api/telegram/
            ├── webhook/route.ts
            └── setup/route.ts
```

---

### Task 1: Scaffolding del monorepo y configuración

**Files:**
- Create: `package.json`, `turbo.json`, `.gitignore`, `.env.example`
- Create: `packages/config/package.json`, `packages/config/tsconfig.base.json`, `packages/config/tsconfig.next.json`
- Create: `packages/types/package.json`, `packages/types/tsconfig.json`, `packages/types/src/index.ts`

**Interfaces:**
- Consumes: nada.
- Produces: workspaces instalables; `@iris/config` con `tsconfig.base.json`; `@iris/types` compilable.

- [ ] **Step 1: Crear los archivos de configuración del root y de `@iris/config`**

`package.json`:
```json
{
  "name": "iris",
  "private": true,
  "packageManager": "npm@11.6.2",
  "engines": { "node": ">=20" },
  "workspaces": ["apps/*", "packages/*"],
  "scripts": {
    "build": "turbo run build",
    "dev": "turbo run dev",
    "lint": "turbo run lint",
    "type-check": "turbo run type-check",
    "test": "turbo run test"
  },
  "devDependencies": { "tsx": "^4.19.0", "turbo": "^2", "typescript": "^5" },
  "overrides": { "@langchain/core": "1.1.41" }
}
```

`turbo.json`:
```json
{
  "$schema": "https://turbo.build/schema.json",
  "tasks": {
    "build": {
      "dependsOn": ["^build"],
      "outputs": [".next/**", "!.next/cache/**", "dist/**"],
      "env": [
        "NEXT_PUBLIC_SUPABASE_URL",
        "SUPABASE_SERVICE_ROLE_KEY",
        "DATABASE_URL",
        "OPENROUTER_API_KEY",
        "TELEGRAM_BOT_TOKEN",
        "TELEGRAM_WEBHOOK_SECRET",
        "TELEGRAM_WEBHOOK_BASE_URL",
        "SELLER_TELEGRAM_CHAT_ID"
      ]
    },
    "dev": { "cache": false, "persistent": true },
    "lint": { "dependsOn": ["^build"] },
    "type-check": { "dependsOn": ["^build"] },
    "test": { "dependsOn": ["^build"] }
  }
}
```

`.gitignore`:
```
node_modules/
.next/
dist/
.turbo/
*.tsbuildinfo
.env
.env.local
.DS_Store
```

`.env.example`:
```
# Telegram
TELEGRAM_BOT_TOKEN=
TELEGRAM_WEBHOOK_SECRET=
TELEGRAM_WEBHOOK_BASE_URL=
SELLER_TELEGRAM_CHAT_ID=

# LLM (OpenRouter)
OPENROUTER_API_KEY=

# Supabase
NEXT_PUBLIC_SUPABASE_URL=
SUPABASE_SERVICE_ROLE_KEY=

# Postgres directo (para el checkpointer de LangGraph; conexión NO-pooler)
DATABASE_URL=
```

`packages/config/package.json`:
```json
{ "name": "@iris/config", "private": true, "version": "0.0.0", "files": ["*.json"] }
```

`packages/config/tsconfig.base.json`:
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "esModuleInterop": true,
    "forceConsistentCasingInFileNames": true,
    "strict": true,
    "skipLibCheck": true,
    "resolveJsonModule": true,
    "isolatedModules": true,
    "noEmit": true
  }
}
```

`packages/config/tsconfig.next.json`:
```json
{
  "extends": "./tsconfig.base.json",
  "compilerOptions": {
    "lib": ["dom", "dom.iterable", "esnext"],
    "jsx": "preserve",
    "allowJs": true,
    "incremental": true,
    "plugins": [{ "name": "next" }]
  }
}
```

- [ ] **Step 2: Crear el paquete `@iris/types` (placeholder)**

`packages/types/package.json`:
```json
{
  "name": "@iris/types",
  "private": true,
  "version": "0.0.0",
  "main": "./src/index.ts",
  "types": "./src/index.ts",
  "scripts": {
    "type-check": "tsc --noEmit",
    "test": "tsx --test \"src/**/__tests__/**/*.test.ts\""
  },
  "dependencies": { "zod": "^3" },
  "devDependencies": { "typescript": "^5", "tsx": "^4.19.0" }
}
```

`packages/types/tsconfig.json`:
```json
{ "extends": "../config/tsconfig.base.json", "include": ["src"] }
```

`packages/types/src/index.ts`:
```ts
export {};
```

- [ ] **Step 3: Instalar y verificar el type-check**

Run: `npm install`
Expected: instala sin errores; crea `node_modules` y `package-lock.json`.

Run: `npm run type-check`
Expected: PASS (turbo ejecuta `type-check` de `@iris/types` sin errores).

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "chore: scaffolding del monorepo (turbo + workspaces + config)"
```

---

### Task 2: Esquema compartido `@iris/types`

**Files:**
- Create: `packages/types/src/schema.ts`, `packages/types/src/lead.ts`
- Modify: `packages/types/src/index.ts`
- Test: `packages/types/src/__tests__/schema.test.ts`

**Interfaces:**
- Consumes: `zod`.
- Produces:
  - `SolicitudSchema: z.ZodObject` y `type Solicitud = z.infer<typeof SolicitudSchema>`
  - `CAMPOS_CRITICOS: readonly ["proposito","presupuesto","tipo_pieza","peso_quilates","color","origen"]`
  - `type CampoCritico = typeof CAMPOS_CRITICOS[number]`
  - `type EstadoLead = "incompleto" | "completo" | "en_aclaracion"`
  - `interface LeadRow` (fila de inserción en Supabase) e `interface Lead` (fila leída)

- [ ] **Step 1: Escribir el test que falla**

`packages/types/src/__tests__/schema.test.ts`:
```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { SolicitudSchema, CAMPOS_CRITICOS } from "../schema.js";

test("SolicitudSchema acepta una solicitud parcial válida", () => {
  const parsed = SolicitudSchema.parse({
    proposito: "joyeria",
    color: { tono: "verde", saturacion: "vivida" },
    origen: { pais: "colombia", mina_zona: "muzo" },
    peso_quilates: { min: 1, max: 3 },
  });
  assert.equal(parsed.proposito, "joyeria");
  assert.equal(parsed.color?.tono, "verde");
});

test("SolicitudSchema acepta objeto vacío (todo opcional)", () => {
  assert.deepEqual(SolicitudSchema.parse({}), {});
});

test("SolicitudSchema rechaza un enum inválido", () => {
  assert.throws(() => SolicitudSchema.parse({ proposito: "lavado_de_dinero" }));
});

test("CAMPOS_CRITICOS son los seis acordados", () => {
  assert.deepEqual([...CAMPOS_CRITICOS], [
    "proposito", "presupuesto", "tipo_pieza", "peso_quilates", "color", "origen",
  ]);
});
```

- [ ] **Step 2: Ejecutar el test para verificar que falla**

Run: `npm test -w @iris/types`
Expected: FAIL (no existe `../schema.js`).

- [ ] **Step 3: Implementar el esquema**

`packages/types/src/schema.ts`:
```ts
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
```

`packages/types/src/lead.ts`:
```ts
import type { Solicitud } from "./schema.js";

export type EstadoLead = "incompleto" | "completo" | "en_aclaracion";

/** Forma de inserción/upsert en la tabla `leads`. */
export interface LeadRow {
  telegram_user_id: number;
  telegram_username: string | null;
  estado: EstadoLead;
  campos_faltantes: string[];
  solicitud: Solicitud;
  proposito: string | null;
  tipo_pieza: string | null;
  origen_pais: string | null;
}

/** Fila leída de `leads` (incluye columnas generadas por la BD). */
export interface Lead extends LeadRow {
  id: string;
  created_at: string;
  updated_at: string;
}
```

`packages/types/src/index.ts`:
```ts
export * from "./schema.js";
export * from "./lead.js";
```

- [ ] **Step 4: Ejecutar el test para verificar que pasa**

Run: `npm test -w @iris/types`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/types
git commit -m "feat(types): esquema zod de Solicitud + tipos de Lead"
```

---

### Task 3: Lógica de solicitud `@iris/agent` (merge / completitud)

**Files:**
- Create: `packages/agent/package.json`, `packages/agent/tsconfig.json`
- Create: `packages/agent/src/request.ts`
- Test: `packages/agent/src/__tests__/request.test.ts`

**Interfaces:**
- Consumes: `Solicitud`, `CampoCritico`, `CAMPOS_CRITICOS`, `EstadoLead` de `@iris/types`.
- Produces:
  - `mergeRequest(prior: Solicitud, partial: Solicitud): Solicitud`
  - `missingCriticalFields(s: Solicitud): CampoCritico[]`
  - `isComplete(s: Solicitud): boolean`
  - `evaluarEstado(s: Solicitud): { estado: EstadoLead; camposFaltantes: CampoCritico[] }`
  - `MAX_RONDAS: number` (= 4)

- [ ] **Step 1: Crear el paquete `@iris/agent`**

`packages/agent/package.json`:
```json
{
  "name": "@iris/agent",
  "private": true,
  "version": "0.0.0",
  "main": "./src/index.ts",
  "types": "./src/index.ts",
  "scripts": {
    "type-check": "tsc --noEmit",
    "test": "tsx --test \"src/**/__tests__/**/*.test.ts\""
  },
  "dependencies": {
    "@iris/db": "*",
    "@iris/types": "*",
    "@langchain/core": "1.1.41",
    "@langchain/langgraph": "^1.0",
    "@langchain/langgraph-checkpoint-postgres": "^1.0",
    "@langchain/openai": "^1.0",
    "zod": "^3"
  },
  "devDependencies": { "typescript": "^5", "tsx": "^4.19.0" }
}
```

`packages/agent/tsconfig.json`:
```json
{ "extends": "../config/tsconfig.base.json", "include": ["src"] }
```

Run: `npm install`
Expected: instala las dependencias de LangChain/LangGraph del nuevo paquete.

- [ ] **Step 2: Escribir el test que falla**

`packages/agent/src/__tests__/request.test.ts`:
```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { mergeRequest, missingCriticalFields, isComplete, evaluarEstado } from "../request.js";

test("mergeRequest combina campos de dos turnos sin pisar lo previo", () => {
  const prior = { color: { tono: "verde" as const }, proposito: "joyeria" as const };
  const partial = { origen: { pais: "colombia" as const } };
  const merged = mergeRequest(prior, partial);
  assert.equal(merged.color?.tono, "verde");
  assert.equal(merged.proposito, "joyeria");
  assert.equal(merged.origen?.pais, "colombia");
});

test("mergeRequest hace merge dentro de objetos anidados", () => {
  const prior = { presupuesto: { max: 5000, moneda: "USD" as const } };
  const partial = { presupuesto: { min: 1000 } };
  const merged = mergeRequest(prior, partial);
  assert.deepEqual(merged.presupuesto, { max: 5000, moneda: "USD", min: 1000 });
});

test("mergeRequest ignora undefined/null entrantes", () => {
  const prior = { color: { tono: "verde" as const } };
  const partial = { color: { tono: undefined } } as never;
  const merged = mergeRequest(prior, partial);
  assert.equal(merged.color?.tono, "verde");
});

test("mergeRequest une características especiales sin duplicar", () => {
  const prior = { caracteristicas_especiales: ["trapiche" as const] };
  const partial = { caracteristicas_especiales: ["trapiche" as const, "macla" as const] };
  const merged = mergeRequest(prior, partial);
  assert.deepEqual(merged.caracteristicas_especiales, ["trapiche", "macla"]);
});

test("missingCriticalFields detecta los seis críticos en vacío", () => {
  assert.deepEqual(missingCriticalFields({}), [
    "proposito", "presupuesto", "tipo_pieza", "peso_quilates", "color", "origen",
  ]);
});

test("missingCriticalFields trata 'desconocido' y rangos vacíos como faltantes", () => {
  const s = { proposito: "desconocido" as const, presupuesto: {}, peso_quilates: {} };
  const faltan = missingCriticalFields(s);
  assert.ok(faltan.includes("proposito"));
  assert.ok(faltan.includes("presupuesto"));
  assert.ok(faltan.includes("peso_quilates"));
});

test("isComplete / evaluarEstado con solicitud completa", () => {
  const s = {
    proposito: "joyeria" as const,
    presupuesto: { max: 5000 },
    tipo_pieza: "gema_tallada" as const,
    peso_quilates: { min: 1 },
    color: { tono: "verde" as const },
    origen: { pais: "colombia" as const },
  };
  assert.equal(isComplete(s), true);
  assert.deepEqual(evaluarEstado(s), { estado: "completo", camposFaltantes: [] });
});

test("evaluarEstado marca en_aclaracion si falta algo", () => {
  assert.equal(evaluarEstado({ proposito: "joyeria" }).estado, "en_aclaracion");
});
```

- [ ] **Step 3: Ejecutar el test para verificar que falla**

Run: `npm test -w @iris/agent`
Expected: FAIL (no existe `../request.js`).

- [ ] **Step 4: Implementar la lógica**

`packages/agent/src/request.ts`:
```ts
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
```

- [ ] **Step 5: Ejecutar el test para verificar que pasa**

Run: `npm test -w @iris/agent`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/agent
git commit -m "feat(agent): merge de solicitud parcial y evaluación de completitud"
```

---

### Task 4: Modelo LLM y extractor

**Files:**
- Create: `packages/agent/src/model.ts`, `packages/agent/src/extractor.ts`
- Test: `packages/agent/src/__tests__/extractor.test.ts`

**Interfaces:**
- Consumes: `SolicitudSchema`, `Solicitud` de `@iris/types`; `@langchain/openai`.
- Produces:
  - `createChatModel(): ChatOpenAI`
  - `interface StructuredModel { withStructuredOutput(schema: unknown, opts?: { name?: string }): { invoke: (input: unknown) => Promise<unknown> } }`
  - `EXTRACTION_SYSTEM_PROMPT: string`
  - `extractRequest(model: StructuredModel, text: string): Promise<Solicitud>`

- [ ] **Step 1: Escribir el test que falla**

`packages/agent/src/__tests__/extractor.test.ts`:
```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { extractRequest, EXTRACTION_SYSTEM_PROMPT, type StructuredModel } from "../extractor.js";

function fakeModel(fixture: unknown, captured: { input?: unknown }): StructuredModel {
  return {
    withStructuredOutput() {
      return {
        invoke: async (input: unknown) => {
          captured.input = input;
          return fixture;
        },
      };
    },
  };
}

test("extractRequest devuelve la solicitud validada y pasa el system prompt", async () => {
  const captured: { input?: unknown } = {};
  const model = fakeModel({ proposito: "joyeria", color: { tono: "verde" } }, captured);
  const result = await extractRequest(model, "quiero una esmeralda verde para un anillo");
  assert.equal(result.proposito, "joyeria");
  assert.equal(result.color?.tono, "verde");
  const msgs = captured.input as Array<{ role: string; content: string }>;
  assert.equal(msgs[0].role, "system");
  assert.equal(msgs[0].content, EXTRACTION_SYSTEM_PROMPT);
  assert.equal(msgs[1].content, "quiero una esmeralda verde para un anillo");
});

test("extractRequest rechaza salidas con enums inválidos", async () => {
  const model = fakeModel({ proposito: "no_existe" }, {});
  await assert.rejects(() => extractRequest(model, "texto"));
});

test("EXTRACTION_SYSTEM_PROMPT instruye extraer solo lo explícito", () => {
  assert.match(EXTRACTION_SYSTEM_PROMPT, /expl[ií]cito|no inventes|no asumas/i);
});
```

- [ ] **Step 2: Ejecutar el test para verificar que falla**

Run: `npm test -w @iris/agent`
Expected: FAIL (no existe `../extractor.js`).

- [ ] **Step 3: Implementar modelo y extractor**

`packages/agent/src/model.ts`:
```ts
import { ChatOpenAI } from "@langchain/openai";

export function createChatModel(): ChatOpenAI {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) throw new Error("Missing OPENROUTER_API_KEY");

  return new ChatOpenAI({
    modelName: "openai/gpt-4o-mini",
    temperature: 0.1,
    configuration: {
      baseURL: "https://openrouter.ai/api/v1",
      defaultHeaders: { "HTTP-Referer": "https://iris.local" },
    },
    apiKey,
  });
}
```

`packages/agent/src/extractor.ts`:
```ts
import { SolicitudSchema, type Solicitud } from "@iris/types";

/** Interfaz mínima de un modelo capaz de salida estructurada (satisfecha por ChatOpenAI). */
export interface StructuredModel {
  withStructuredOutput(
    schema: unknown,
    opts?: { name?: string }
  ): { invoke: (input: unknown) => Promise<unknown> };
}

export const EXTRACTION_SYSTEM_PROMPT = `Eres un asistente de Méraldi, casa de esmeraldas colombianas.
Tu tarea es leer el mensaje de un comprador (en lenguaje natural) y extraer SOLO la información
que el comprador menciona EXPLÍCITAMENTE, a la estructura indicada.

Reglas:
- No inventes ni asumas valores que el comprador no dijo. Si un dato no aparece, omítelo.
- Usa exclusivamente los valores de enumeración permitidos por el esquema.
- "verde esmeralda intenso" → color.tono=verde, color.saturacion=vivida.
- Presupuesto: detecta moneda (USD/COP) y si es total o por quilate.
- Orígenes Méraldi: Colombia (Muzo, Coscuez, Chivor, La Pita/Maripí, Gachalá), Zambia (Kafubu/Kagem), Brasil.
- Tratamiento según la guía: sin_tratamiento, insignificante, menor, moderado, significativo.
- Tipo de pieza: gema tallada, cristal en bruto, joya terminada o espécimen mineral.`;

export async function extractRequest(model: StructuredModel, text: string): Promise<Solicitud> {
  const structured = model.withStructuredOutput(SolicitudSchema, { name: "solicitud" });
  const raw = await structured.invoke([
    { role: "system", content: EXTRACTION_SYSTEM_PROMPT },
    { role: "user", content: text },
  ]);
  return SolicitudSchema.parse(raw);
}
```

- [ ] **Step 4: Ejecutar el test para verificar que pasa**

Run: `npm test -w @iris/agent`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/agent
git commit -m "feat(agent): modelo OpenRouter y extractor con salida estructurada"
```

---

### Task 5: Generación de preguntas de aclaración

**Files:**
- Create: `packages/agent/src/questions.ts`
- Test: `packages/agent/src/__tests__/questions.test.ts`

**Interfaces:**
- Consumes: `Solicitud`, `CampoCritico` de `@iris/types`; `missingCriticalFields` de `./request.js`.
- Produces:
  - `PREGUNTAS: Record<CampoCritico, string>`
  - `clarificationTargets(s: Solicitud): CampoCritico[]`
  - `buildClarificationMessage(targets: CampoCritico[]): string` (máx 3 preguntas por mensaje)

- [ ] **Step 1: Escribir el test que falla**

`packages/agent/src/__tests__/questions.test.ts`:
```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildClarificationMessage, clarificationTargets, PREGUNTAS } from "../questions.js";

test("clarificationTargets devuelve los críticos faltantes", () => {
  assert.deepEqual(clarificationTargets({ proposito: "joyeria" }), [
    "presupuesto", "tipo_pieza", "peso_quilates", "color", "origen",
  ]);
});

test("buildClarificationMessage limita a 3 preguntas", () => {
  const msg = buildClarificationMessage(["presupuesto", "tipo_pieza", "peso_quilates", "color", "origen"]);
  const bullets = msg.split("\n").filter((l) => l.trim().startsWith("•"));
  assert.equal(bullets.length, 3);
  assert.ok(msg.includes(PREGUNTAS.presupuesto));
});

test("buildClarificationMessage maneja lista vacía con un fallback", () => {
  const msg = buildClarificationMessage([]);
  assert.ok(msg.length > 0);
  assert.ok(!msg.includes("•"));
});
```

- [ ] **Step 2: Ejecutar el test para verificar que falla**

Run: `npm test -w @iris/agent`
Expected: FAIL (no existe `../questions.js`).

- [ ] **Step 3: Implementar**

`packages/agent/src/questions.ts`:
```ts
import type { Solicitud, CampoCritico } from "@iris/types";
import { missingCriticalFields } from "./request.js";

export const PREGUNTAS: Record<CampoCritico, string> = {
  proposito: "¿La esmeralda es para joyería, colección o inversión?",
  presupuesto: "¿Qué presupuesto manejas y en qué moneda?",
  tipo_pieza: "¿Buscas una gema tallada, un cristal en bruto o una joya terminada?",
  peso_quilates: "¿Qué peso en quilates te interesa (aprox.)?",
  color: "¿Tienes preferencia de color (verde intenso, verde azulado…)?",
  origen: "¿Prefieres algún origen en particular (Colombia: Muzo, Coscuez, Chivor…)?",
};

export function clarificationTargets(s: Solicitud): CampoCritico[] {
  return missingCriticalFields(s);
}

/** Mensaje al comprador pidiendo hasta 3 datos críticos faltantes. */
export function buildClarificationMessage(targets: CampoCritico[]): string {
  if (targets.length === 0) {
    return "¿Podrías darme un poco más de detalle sobre la esmeralda que buscas?";
  }
  const preguntas = targets.slice(0, 3).map((t) => `• ${PREGUNTAS[t]}`).join("\n");
  return `Para ayudarte mejor, cuéntame:\n${preguntas}`;
}
```

- [ ] **Step 4: Ejecutar el test para verificar que pasa**

Run: `npm test -w @iris/agent`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/agent
git commit -m "feat(agent): preguntas de aclaración por campos críticos faltantes"
```

---

### Task 6: Capa de datos `@iris/db`

**Files:**
- Create: `packages/db/package.json`, `packages/db/tsconfig.json`
- Create: `packages/db/src/client.ts`, `packages/db/src/index.ts`, `packages/db/src/queries/leads.ts`
- Create: `packages/db/supabase/migrations/00001_init.sql`
- Test: `packages/db/src/__tests__/leads.test.ts`

**Interfaces:**
- Consumes: `Solicitud`, `LeadRow`, `EstadoLead`, `Lead` de `@iris/types`; `@supabase/supabase-js`.
- Produces:
  - `type DbClient = SupabaseClient`; `createServerClient(): DbClient`
  - `buildLeadRow(input: { telegramUserId: number; telegramUsername?: string | null; solicitud: Solicitud; estado: EstadoLead; camposFaltantes: string[] }): LeadRow`
  - `upsertLead(db: DbClient, row: LeadRow): Promise<{ id: string }>`
  - `getLead(db: DbClient, telegramUserId: number): Promise<Lead | null>`
  - `addLeadMessage(db: DbClient, telegramUserId: number, rol: "comprador" | "agente", texto: string): Promise<void>`

- [ ] **Step 1: Crear el paquete `@iris/db`**

`packages/db/package.json`:
```json
{
  "name": "@iris/db",
  "private": true,
  "version": "0.0.0",
  "main": "./src/index.ts",
  "types": "./src/index.ts",
  "scripts": {
    "type-check": "tsc --noEmit",
    "test": "tsx --test \"src/**/__tests__/**/*.test.ts\""
  },
  "dependencies": { "@iris/types": "*", "@supabase/supabase-js": "^2" },
  "devDependencies": { "typescript": "^5", "tsx": "^4.19.0" }
}
```

`packages/db/tsconfig.json`:
```json
{ "extends": "../config/tsconfig.base.json", "include": ["src"] }
```

Run: `npm install`
Expected: instala `@supabase/supabase-js`.

- [ ] **Step 2: Escribir el test que falla (función pura `buildLeadRow`)**

`packages/db/src/__tests__/leads.test.ts`:
```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildLeadRow } from "../queries/leads.js";

test("buildLeadRow mapea columnas tipadas + JSONB", () => {
  const row = buildLeadRow({
    telegramUserId: 42,
    telegramUsername: "comprador1",
    solicitud: {
      proposito: "joyeria",
      tipo_pieza: "gema_tallada",
      origen: { pais: "colombia", mina_zona: "muzo" },
    },
    estado: "completo",
    camposFaltantes: [],
  });
  assert.equal(row.telegram_user_id, 42);
  assert.equal(row.telegram_username, "comprador1");
  assert.equal(row.estado, "completo");
  assert.equal(row.proposito, "joyeria");
  assert.equal(row.tipo_pieza, "gema_tallada");
  assert.equal(row.origen_pais, "colombia");
  assert.equal(row.solicitud.origen?.mina_zona, "muzo");
});

test("buildLeadRow usa null cuando faltan columnas tipadas", () => {
  const row = buildLeadRow({
    telegramUserId: 7,
    solicitud: {},
    estado: "incompleto",
    camposFaltantes: ["proposito"],
  });
  assert.equal(row.telegram_username, null);
  assert.equal(row.proposito, null);
  assert.equal(row.origen_pais, null);
});
```

- [ ] **Step 3: Ejecutar el test para verificar que falla**

Run: `npm test -w @iris/db`
Expected: FAIL (no existe `../queries/leads.js`).

- [ ] **Step 4: Implementar cliente, queries y migración**

`packages/db/src/client.ts`:
```ts
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

export type DbClient = SupabaseClient;

export function createServerClient(): DbClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Missing Supabase server env vars");
  return createClient(url, key);
}
```

`packages/db/src/queries/leads.ts`:
```ts
import type { DbClient } from "../client.js";
import type { Solicitud, LeadRow, EstadoLead, Lead } from "@iris/types";

export function buildLeadRow(input: {
  telegramUserId: number;
  telegramUsername?: string | null;
  solicitud: Solicitud;
  estado: EstadoLead;
  camposFaltantes: string[];
}): LeadRow {
  return {
    telegram_user_id: input.telegramUserId,
    telegram_username: input.telegramUsername ?? null,
    estado: input.estado,
    campos_faltantes: input.camposFaltantes,
    solicitud: input.solicitud,
    proposito: input.solicitud.proposito ?? null,
    tipo_pieza: input.solicitud.tipo_pieza ?? null,
    origen_pais: input.solicitud.origen?.pais ?? null,
  };
}

export async function upsertLead(db: DbClient, row: LeadRow): Promise<{ id: string }> {
  const { data, error } = await db
    .from("leads")
    .upsert({ ...row, updated_at: new Date().toISOString() }, { onConflict: "telegram_user_id" })
    .select("id")
    .single();
  if (error) throw error;
  return data as { id: string };
}

export async function getLead(db: DbClient, telegramUserId: number): Promise<Lead | null> {
  const { data, error } = await db
    .from("leads")
    .select("*")
    .eq("telegram_user_id", telegramUserId)
    .maybeSingle();
  if (error) throw error;
  return (data as Lead | null) ?? null;
}

export async function addLeadMessage(
  db: DbClient,
  telegramUserId: number,
  rol: "comprador" | "agente",
  texto: string
): Promise<void> {
  const { error } = await db
    .from("lead_messages")
    .insert({ telegram_user_id: telegramUserId, rol, texto });
  if (error) throw error;
}
```

`packages/db/src/index.ts`:
```ts
export { createServerClient, type DbClient } from "./client.js";
export * from "./queries/leads.js";
```

`packages/db/supabase/migrations/00001_init.sql`:
```sql
-- Iris — esquema inicial

create table if not exists public.leads (
  id uuid primary key default gen_random_uuid(),
  telegram_user_id bigint not null unique,
  telegram_username text,
  estado text not null default 'incompleto',
  campos_faltantes text[] not null default '{}',
  solicitud jsonb not null default '{}'::jsonb,
  proposito text,
  tipo_pieza text,
  origen_pais text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.lead_messages (
  id uuid primary key default gen_random_uuid(),
  telegram_user_id bigint not null,
  rol text not null check (rol in ('comprador', 'agente')),
  texto text not null,
  created_at timestamptz not null default now()
);
create index if not exists lead_messages_user_idx
  on public.lead_messages (telegram_user_id, created_at);

-- RLS habilitado: el webhook usa service role (bypassa RLS). Sin políticas públicas.
alter table public.leads enable row level security;
alter table public.lead_messages enable row level security;
```

- [ ] **Step 5: Ejecutar el test para verificar que pasa**

Run: `npm test -w @iris/db`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/db
git commit -m "feat(db): cliente Supabase, queries de leads y migración inicial"
```

---

### Task 7: Estado, grafo LangGraph y orquestación

**Files:**
- Create: `packages/agent/src/checkpointer.ts`, `packages/agent/src/state.ts`, `packages/agent/src/graph.ts`, `packages/agent/src/index.ts`
- Test: `packages/agent/src/__tests__/graph.test.ts`

**Interfaces:**
- Consumes: `mergeRequest`, `evaluarEstado`, `MAX_RONDAS` (`./request.js`); `buildClarificationMessage` (`./questions.js`); `buildLeadRow` (`@iris/db`); `Solicitud`, `CampoCritico`, `EstadoLead`, `LeadRow` (`@iris/types`); `StateGraph`, `Annotation`, `MemorySaver`, `START`, `END` (`@langchain/langgraph`).
- Produces:
  - `IrisState` (Annotation.Root) y `type State = typeof IrisState.State`
  - `getCheckpointer(): Promise<PostgresSaver>`
  - `interface IrisDeps { extract: (text: string) => Promise<Solicitud>; saveLead: (row: LeadRow) => Promise<{ id: string }>; notifySeller: (text: string) => Promise<void>; checkpointer?: BaseCheckpointSaver }`
  - `buildSellerSummary(row: LeadRow): string`
  - `buildGraph(deps: IrisDeps): Promise<CompiledGraph>`
  - `runIris(deps: IrisDeps, input: { telegramUserId: number; chatId: number; telegramUsername?: string; text: string }): Promise<{ reply: string; estado: EstadoLead }>`
  - `index.ts` re-exporta lo público del agente (incl. `createChatModel`, `extractRequest`, `EXTRACTION_SYSTEM_PROMPT`).

- [ ] **Step 0: Añadir la dependencia `@iris/db` al agente y reinstalar**

`graph.ts` importa `buildLeadRow` de `@iris/db` (creado en Task 6). En la Task 3 se difirió esta dependencia, así que añádela ahora a `packages/agent/package.json` (en `dependencies`, orden alfabético, justo antes de `@iris/types`):
```json
"@iris/db": "*",
```
Luego `npm install` (SIN `--legacy-peer-deps`). Verifica exit 0 y que `@langchain/core` siga en `1.1.41`.

- [ ] **Step 1: Escribir el test que falla (grafo con `MemorySaver`)**

`packages/agent/src/__tests__/graph.test.ts`:
```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { MemorySaver } from "@langchain/langgraph";
import { runIris, buildSellerSummary, type IrisDeps } from "../graph.js";
import type { LeadRow, Solicitud } from "@iris/types";

test("mensaje incompleto pide aclaración y no persiste", async () => {
  const saved: LeadRow[] = [];
  const deps: IrisDeps = {
    extract: async () => ({ proposito: "joyeria" }),
    saveLead: async (r) => { saved.push(r); return { id: "x" }; },
    notifySeller: async () => {},
    checkpointer: new MemorySaver(),
  };
  const { reply, estado } = await runIris(deps, {
    telegramUserId: 1, chatId: 1, text: "quiero una esmeralda para un anillo",
  });
  assert.equal(estado, "en_aclaracion");
  assert.equal(saved.length, 0);
  assert.match(reply, /presupuesto|quilates|origen|tipo|color/i);
});

test("la solicitud se completa en el segundo turno → persiste y notifica", async () => {
  const saved: LeadRow[] = [];
  const seller: string[] = [];
  const cp = new MemorySaver();
  let call = 0;
  const turnos: Solicitud[] = [
    { proposito: "joyeria", tipo_pieza: "gema_tallada", color: { tono: "verde" } },
    { presupuesto: { max: 5000, moneda: "USD" }, peso_quilates: { min: 1 }, origen: { pais: "colombia" } },
  ];
  const deps: IrisDeps = {
    extract: async () => turnos[call++],
    saveLead: async (r) => { saved.push(r); return { id: "lead-1" }; },
    notifySeller: async (t) => { seller.push(t); },
    checkpointer: cp,
  };
  await runIris(deps, { telegramUserId: 7, chatId: 7, text: "esmeralda verde tallada para joyería" });
  const r2 = await runIris(deps, { telegramUserId: 7, chatId: 7, text: "hasta 5000 USD, 1 quilate, de Colombia" });

  assert.equal(r2.estado, "completo");
  assert.equal(saved.length, 1);
  assert.equal(saved[0].solicitud.color?.tono, "verde"); // mergeado del turno 1
  assert.equal(saved[0].origen_pais, "colombia");
  assert.equal(seller.length, 1);
});

test("buildSellerSummary incluye el id de Telegram y el estado", () => {
  const summary = buildSellerSummary({
    telegram_user_id: 99, telegram_username: "ana", estado: "completo",
    campos_faltantes: [], solicitud: { proposito: "joyeria" },
    proposito: "joyeria", tipo_pieza: null, origen_pais: null,
  });
  assert.match(summary, /99/);
  assert.match(summary, /completo/i);
});
```

- [ ] **Step 2: Ejecutar el test para verificar que falla**

Run: `npm test -w @iris/agent`
Expected: FAIL (no existen `../graph.js` ni `../state.js`).

- [ ] **Step 3: Implementar checkpointer, estado y grafo**

`packages/agent/src/checkpointer.ts`:
```ts
import { PostgresSaver } from "@langchain/langgraph-checkpoint-postgres";

let _saver: PostgresSaver | null = null;

/** Singleton PostgresSaver respaldado por DATABASE_URL (conexión directa, no-pooler). */
export async function getCheckpointer(): Promise<PostgresSaver> {
  if (!_saver) {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error("DATABASE_URL es requerido para el checkpointing de LangGraph");
    _saver = PostgresSaver.fromConnString(url);
    await _saver.setup();
  }
  return _saver;
}
```

`packages/agent/src/state.ts`:
```ts
import { Annotation } from "@langchain/langgraph";
import type { Solicitud, CampoCritico, EstadoLead } from "@iris/types";
import { mergeRequest } from "./request.js";

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
});

export type State = typeof IrisState.State;
```

`packages/agent/src/graph.ts`:
```ts
import { StateGraph, START, END, type BaseCheckpointSaver } from "@langchain/langgraph";
import type { Solicitud, EstadoLead, LeadRow } from "@iris/types";
import { buildLeadRow } from "@iris/db";
import { IrisState, type State } from "./state.js";
import { evaluarEstado, MAX_RONDAS } from "./request.js";
import { buildClarificationMessage } from "./questions.js";
import { getCheckpointer } from "./checkpointer.js";

export interface IrisDeps {
  extract: (text: string) => Promise<Solicitud>;
  saveLead: (row: LeadRow) => Promise<{ id: string }>;
  notifySeller: (text: string) => Promise<void>;
  /** Por defecto PostgresSaver; en tests se inyecta MemorySaver. */
  checkpointer?: BaseCheckpointSaver;
}

export function buildSellerSummary(row: LeadRow): string {
  const s = row.solicitud;
  const linea = (k: string, v: unknown) => (v != null && v !== "" ? `${k}: ${typeof v === "object" ? JSON.stringify(v) : v}` : null);
  const partes = [
    `Nuevo lead (Telegram ${row.telegram_user_id}${row.telegram_username ? ` @${row.telegram_username}` : ""}) — estado: ${row.estado}`,
    linea("Propósito", s.proposito),
    linea("Tipo de pieza", s.tipo_pieza),
    linea("Peso (qt)", s.peso_quilates),
    linea("Color", s.color),
    linea("Origen", s.origen),
    linea("Presupuesto", s.presupuesto),
    linea("Tratamiento máx.", s.tratamiento_max_aceptable),
    row.campos_faltantes.length ? `Faltan: ${row.campos_faltantes.join(", ")}` : null,
  ].filter(Boolean);
  return partes.join("\n");
}

async function extractorNode(state: State, deps: IrisDeps): Promise<Partial<State>> {
  const partial = await deps.extract(state.inputText);
  return { solicitud: partial };
}

function validadorNode(state: State): Partial<State> {
  return evaluarEstado(state.solicitud);
}

function route(state: State): "preguntar" | "persistir" {
  if (state.estado === "completo") return "persistir";
  if (state.rondas >= MAX_RONDAS) return "persistir";
  return "preguntar";
}

function preguntarNode(state: State): Partial<State> {
  return { reply: buildClarificationMessage(state.camposFaltantes) };
}

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
  await deps.notifySeller(buildSellerSummary(row));
  const reply = estadoFinal === "completo"
    ? "¡Gracias! Registré tu solicitud y un asesor de Méraldi te contactará pronto. 💚"
    : "Gracias por la información. Un asesor de Méraldi continuará contigo para afinar los detalles.";
  return { reply, estado: estadoFinal };
}

export async function buildGraph(deps: IrisDeps) {
  const checkpointer = deps.checkpointer ?? (await getCheckpointer());
  const graph = new StateGraph(IrisState)
    .addNode("extractor", (s: State) => extractorNode(s, deps))
    .addNode("validador", validadorNode)
    .addNode("preguntar", preguntarNode)
    .addNode("persistir", (s: State) => persistirNode(s, deps))
    .addEdge(START, "extractor")
    .addEdge("extractor", "validador")
    .addConditionalEdges("validador", route, { preguntar: "preguntar", persistir: "persistir" })
    .addEdge("preguntar", END)
    .addEdge("persistir", END);
  return graph.compile({ checkpointer });
}

export async function runIris(
  deps: IrisDeps,
  input: { telegramUserId: number; chatId: number; telegramUsername?: string; text: string }
): Promise<{ reply: string; estado: EstadoLead }> {
  const app = await buildGraph(deps);
  const final = (await app.invoke(
    {
      inputText: input.text,
      telegramUserId: input.telegramUserId,
      chatId: input.chatId,
      telegramUsername: input.telegramUsername ?? null,
      rondas: 1,
    },
    { configurable: { thread_id: String(input.telegramUserId) } }
  )) as State;
  return { reply: final.reply, estado: final.estado };
}
```

`packages/agent/src/index.ts`:
```ts
export { runIris, buildGraph, buildSellerSummary, type IrisDeps } from "./graph.js";
export { createChatModel } from "./model.js";
export { extractRequest, EXTRACTION_SYSTEM_PROMPT, type StructuredModel } from "./extractor.js";
export { getCheckpointer } from "./checkpointer.js";
export { mergeRequest, missingCriticalFields, isComplete, evaluarEstado, MAX_RONDAS } from "./request.js";
export { IrisState, type State } from "./state.js";
```

- [ ] **Step 4: Ejecutar el test para verificar que pasa**

Run: `npm test -w @iris/agent`
Expected: PASS (incluye los tests de tasks previas).

Si `BaseCheckpointSaver` no se exporta desde `@langchain/langgraph` en la versión instalada, importarlo así en su lugar:
```ts
import type { BaseCheckpointSaver } from "@langchain/langgraph-checkpoint";
```

- [ ] **Step 5: Commit**

```bash
git add packages/agent
git commit -m "feat(agent): grafo LangGraph extractor→validador→preguntar|persistir"
```

---

### Task 8: App Next.js — webhook de Telegram

**Files:**
- Create: `apps/web/package.json`, `apps/web/next.config.ts`, `apps/web/tsconfig.json`, `apps/web/next-env.d.ts`
- Create: `apps/web/src/lib/telegram/send.ts`, `apps/web/src/lib/telegram/parse.ts`
- Create: `apps/web/src/app/api/telegram/webhook/route.ts`, `apps/web/src/app/api/telegram/setup/route.ts`
- Test: `apps/web/src/lib/telegram/__tests__/parse.test.ts`

**Interfaces:**
- Consumes: `runIris`, `createChatModel`, `extractRequest`, `getCheckpointer` (`@iris/agent`); `createServerClient`, `upsertLead`, `addLeadMessage` (`@iris/db`).
- Produces:
  - `sendTelegramMessage(chatId: number, text: string, replyMarkup?: Record<string, unknown>): Promise<void>`
  - `parseTelegramUpdate(update: unknown): { telegramUserId: number; chatId: number; telegramUsername?: string; text: string } | null`
  - Route handlers `POST /api/telegram/webhook` y `GET /api/telegram/setup`.

- [ ] **Step 1: Crear el paquete `@iris/web` y su configuración**

`apps/web/package.json`:
```json
{
  "name": "@iris/web",
  "private": true,
  "version": "0.0.0",
  "scripts": {
    "dev": "next dev",
    "build": "next build",
    "start": "next start",
    "lint": "next lint",
    "type-check": "tsc --noEmit",
    "test": "tsx --test \"src/**/__tests__/**/*.test.ts\""
  },
  "dependencies": {
    "@iris/agent": "*",
    "@iris/db": "*",
    "@iris/types": "*",
    "next": "^15",
    "react": "^19",
    "react-dom": "^19"
  },
  "devDependencies": {
    "@types/node": "^22",
    "@types/react": "^19",
    "tsx": "^4.19.0",
    "typescript": "^5"
  }
}
```

`apps/web/next.config.ts`:
```ts
import type { NextConfig } from "next";

const config: NextConfig = {
  transpilePackages: ["@iris/agent", "@iris/db", "@iris/types"],
};

export default config;
```

`apps/web/tsconfig.json`:
```json
{
  "extends": "../../packages/config/tsconfig.next.json",
  "compilerOptions": {
    "module": "esnext",
    "moduleResolution": "bundler",
    "paths": { "@/*": ["./src/*"] }
  },
  "include": ["next-env.d.ts", "**/*.ts", "**/*.tsx", ".next/types/**/*.ts"],
  "exclude": ["node_modules"]
}
```

`apps/web/next-env.d.ts`:
```ts
/// <reference types="next" />
/// <reference types="next/image-types/global" />
```

Run: `npm install`
Expected: instala Next.js y React.

- [ ] **Step 2: Escribir el test que falla (parser puro del update)**

`apps/web/src/lib/telegram/__tests__/parse.test.ts`:
```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseTelegramUpdate } from "../parse.js";

test("parseTelegramUpdate extrae user/chat/text de un mensaje", () => {
  const parsed = parseTelegramUpdate({
    update_id: 1,
    message: { message_id: 5, from: { id: 42, username: "ana" }, chat: { id: 99 }, text: "  hola  " },
  });
  assert.deepEqual(parsed, { telegramUserId: 42, chatId: 99, telegramUsername: "ana", text: "hola" });
});

test("parseTelegramUpdate devuelve null si no hay texto", () => {
  assert.equal(parseTelegramUpdate({ update_id: 1, message: { from: { id: 1 }, chat: { id: 1 } } }), null);
});

test("parseTelegramUpdate devuelve null para updates no-mensaje", () => {
  assert.equal(parseTelegramUpdate({ update_id: 1 }), null);
});
```

- [ ] **Step 3: Ejecutar el test para verificar que falla**

Run: `npm test -w @iris/web`
Expected: FAIL (no existe `../parse.js`).

- [ ] **Step 4: Implementar parser, send y routes**

`apps/web/src/lib/telegram/parse.ts`:
```ts
interface TelegramMessage {
  from?: { id?: number; username?: string };
  chat?: { id?: number };
  text?: string;
}

export function parseTelegramUpdate(
  update: unknown
): { telegramUserId: number; chatId: number; telegramUsername?: string; text: string } | null {
  const u = update as { message?: TelegramMessage };
  const msg = u?.message;
  const telegramUserId = msg?.from?.id;
  const chatId = msg?.chat?.id;
  const text = msg?.text?.trim();
  if (typeof telegramUserId !== "number" || typeof chatId !== "number" || !text) return null;
  return {
    telegramUserId,
    chatId,
    telegramUsername: msg?.from?.username,
    text,
  };
}
```

`apps/web/src/lib/telegram/send.ts`:
```ts
const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN ?? "";

export async function sendTelegramMessage(
  chatId: number,
  text: string,
  replyMarkup?: Record<string, unknown>
): Promise<void> {
  if (!BOT_TOKEN) {
    console.warn("[telegram] TELEGRAM_BOT_TOKEN no configurado, se omite el envío");
    return;
  }
  const res = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text, ...(replyMarkup ? { reply_markup: replyMarkup } : {}) }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    console.error("[telegram] sendMessage falló:", res.status, body);
  }
}
```

`apps/web/src/app/api/telegram/webhook/route.ts`:
```ts
import { NextResponse } from "next/server";
import { createServerClient, upsertLead, addLeadMessage } from "@iris/db";
import { runIris, createChatModel, extractRequest, type IrisDeps } from "@iris/agent";
import { sendTelegramMessage } from "@/lib/telegram/send";
import { parseTelegramUpdate } from "@/lib/telegram/parse";

export const runtime = "nodejs";

const WEBHOOK_SECRET = process.env.TELEGRAM_WEBHOOK_SECRET ?? "";

export async function POST(request: Request) {
  const secret = request.headers.get("x-telegram-bot-api-secret-token");
  if (!WEBHOOK_SECRET || secret !== WEBHOOK_SECRET) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const parsed = parseTelegramUpdate(await request.json());
  if (!parsed) return NextResponse.json({ ok: true });

  const db = createServerClient();
  const model = createChatModel();
  const sellerChatId = Number(process.env.SELLER_TELEGRAM_CHAT_ID);

  const deps: IrisDeps = {
    extract: (text) => extractRequest(model, text),
    saveLead: (row) => upsertLead(db, row),
    notifySeller: async (text) => {
      if (Number.isFinite(sellerChatId)) await sendTelegramMessage(sellerChatId, text);
    },
  };

  try {
    await addLeadMessage(db, parsed.telegramUserId, "comprador", parsed.text);
    const { reply } = await runIris(deps, parsed);
    await addLeadMessage(db, parsed.telegramUserId, "agente", reply);
    await sendTelegramMessage(parsed.chatId, reply);
  } catch (err) {
    console.error("[iris] error procesando mensaje:", err);
    await sendTelegramMessage(parsed.chatId, "Hubo un error procesando tu mensaje. Intenta de nuevo.");
  }

  return NextResponse.json({ ok: true });
}
```

`apps/web/src/app/api/telegram/setup/route.ts`:
```ts
import { NextResponse } from "next/server";

function publicOrigin(request: Request): string {
  const fromEnv = process.env.TELEGRAM_WEBHOOK_BASE_URL?.replace(/\/+$/, "");
  if (fromEnv) return fromEnv;
  const fwd = request.headers.get("x-forwarded-host")?.split(",")[0]?.trim();
  if (fwd) {
    const proto = request.headers.get("x-forwarded-proto")?.split(",")[0]?.trim() || "https";
    return `${proto}://${fwd}`;
  }
  return new URL(request.url).origin;
}

export async function GET(request: Request) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const secret = process.env.TELEGRAM_WEBHOOK_SECRET;
  if (!token) return NextResponse.json({ error: "TELEGRAM_BOT_TOKEN not set" }, { status: 500 });

  const webhookUrl = `${publicOrigin(request)}/api/telegram/webhook`;
  const res = await fetch(`https://api.telegram.org/bot${token}/setWebhook`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ url: webhookUrl, ...(secret ? { secret_token: secret } : {}) }),
  });
  return NextResponse.json({ webhookUrl, telegram: await res.json() });
}
```

- [ ] **Step 5: Ejecutar el test para verificar que pasa**

Run: `npm test -w @iris/web`
Expected: PASS (3 tests de parse).

- [ ] **Step 6: Verificar tipos de toda la app**

Run: `npm run type-check`
Expected: PASS en todos los paquetes.

- [ ] **Step 7: Commit**

```bash
git add apps/web
git commit -m "feat(web): webhook de Telegram + setup que orquesta el grafo Iris"
```

---

### Task 9: README, verificación integral y commit final

**Files:**
- Create: `README.md`
- Modify: ninguno (verificación).

**Interfaces:**
- Consumes: todo lo anterior.
- Produces: documentación de arranque + repo verificado.

- [ ] **Step 1: Escribir el README**

`README.md`:
```markdown
# Iris — Extracción de solicitudes de compra de esmeraldas

Bot de Telegram que conversa con compradores de esmeraldas, convierte sus mensajes
en lenguaje natural a información estructurada según la taxonomía de la *Guía Méraldi*,
pregunta por los datos críticos que falten y registra cada lead en Supabase,
notificando al vendedor.

## Arquitectura

Monorepo TypeScript (Turborepo + npm workspaces):

- `apps/web` — Next.js; aloja el webhook de Telegram (`/api/telegram/webhook`) y `/api/telegram/setup`.
- `packages/agent` — grafo LangGraph (`extractor → validador → preguntar | persistir`), extractor con salida estructurada, modelo vía OpenRouter, checkpointer Postgres.
- `packages/db` — cliente Supabase, queries de leads y migraciones SQL.
- `packages/types` — esquema zod `Solicitud` + tipos de Lead compartidos.
- `packages/config` — tsconfig base/next.

El estado parcial de cada comprador se acumula entre mensajes vía el checkpointer
(`thread_id = telegram_user_id`). "Clasificación" aquí significa **estructurar** la
solicitud según la taxonomía Méraldi; no avalúa la piedra.

Diseño completo: `docs/superpowers/specs/2026-06-18-iris-extraccion-esmeraldas-design.md`.

## Requisitos

- Node >= 20, npm.
- Una base Supabase (Postgres) y una API key de OpenRouter.
- Un bot de Telegram (token de @BotFather).

## Setup

1. `npm install`
2. Copia `.env.example` a `.env` y completa las variables.
3. Aplica la migración `packages/db/supabase/migrations/00001_init.sql` en tu base Supabase.
4. `npm run dev` (levanta Next.js).
5. Expón el endpoint con HTTPS (deploy o túnel) y registra el webhook visitando `GET /api/telegram/setup`.

## Variables de entorno

Ver `.env.example`. Claves: `TELEGRAM_BOT_TOKEN`, `TELEGRAM_WEBHOOK_SECRET`,
`SELLER_TELEGRAM_CHAT_ID`, `OPENROUTER_API_KEY`, `NEXT_PUBLIC_SUPABASE_URL`,
`SUPABASE_SERVICE_ROLE_KEY`, `DATABASE_URL` (Postgres directo, no-pooler, para el checkpointer).

## Comandos

| Comando | Acción |
| --- | --- |
| `npm run dev` | Next.js en desarrollo |
| `npm run build` | Build de todos los paquetes |
| `npm run type-check` | Type-check del monorepo |
| `npm test` | Tests de todos los paquetes |
| `npm test -w @iris/agent` | Tests de un paquete |

## Alcance

MVP: extracción NL→estructurado, bucle de aclaración multi-turno, persistencia de
leads, aviso al vendedor. Fuera de alcance: tasación/grading, matching de inventario,
UI web de leads, auth/onboarding. Ver el documento de diseño.
```

- [ ] **Step 2: Verificación integral**

Run: `npm install`
Expected: sin errores.

Run: `npm run type-check`
Expected: PASS en todos los paquetes.

Run: `npm test`
Expected: PASS en todos los paquetes (`@iris/types`, `@iris/agent`, `@iris/db`, `@iris/web`).

Run: `npm run build -w @iris/web`
Expected: Next.js compila sin errores de tipo.

- [ ] **Step 3: Commit final**

```bash
git add -A
git commit -m "docs: README y verificación integral del MVP de Iris"
```

---

## Self-Review

**1. Cobertura del spec:**
- §3 Esquema estructurado → Task 2 (`schema.ts`). ✓
- §3 Campos críticos → Task 2/3 (`CAMPOS_CRITICOS`, `missingCriticalFields`). ✓
- §3 Reuso agent-web (model, checkpointer, send, webhook, db pattern) → Tasks 4,6,7,8. ✓
- §3 Pertinencia LangGraph (multi-etapa + estado multi-turno, sin interrupt) → Task 7. ✓
- §5 Arquitectura monorepo TS delgado → Tasks 1,8. ✓
- §5 Modelo de datos (leads, lead_messages, checkpoints) → Task 6 (migración) + Task 7 (PostgresSaver). ✓
- §6 Flujo (extractor→validador→preguntar|persistir→confirmar; aviso al vendedor) → Task 7. ✓
- §7 Clasificar≠avaluar; no auth/UI/integraciones → respetado (no hay tasks de eso). ✓
- §8 Estrategia de pruebas (extractor, merge, completitud, schema, webhook secret/no-texto) → Tasks 2,3,4,7,8. ✓
- §9 Riesgos: alucinación (prompt "solo explícito" + re-parse zod, Task 4); bucle infinito (`MAX_RONDAS`, Task 3/7); mensajes no relacionados (`tipo_solicitud`/`proposito` opcionales + flujo cortés). ✓

**2. Placeholders:** ninguno; cada step tiene código/comandos concretos. ✓

**3. Consistencia de tipos:** `Solicitud`, `CampoCritico`, `EstadoLead`, `LeadRow`, `IrisDeps`, `State`, `buildLeadRow`, `mergeRequest`, `evaluarEstado`, `extractRequest`, `runIris`, `buildClarificationMessage` se definen una vez y se consumen con la misma firma en tasks posteriores. ✓
```
