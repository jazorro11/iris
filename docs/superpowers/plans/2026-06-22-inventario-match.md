# Inventario de esmeraldas + match en Iris — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Que Iris proponga piedras del inventario cuando la solicitud del comprador coincide en forma, peso y/o precio.

**Architecture:** Tabla `inventario` en Supabase (la misma BD de leads). La lógica de match es una función pura `filtrarPiedras` (testeable sin BD) envuelta por `matchInventory(db, solicitud)` que solo hace un `select where disponible=true`. El grafo del agente llama `matchInventory` en `persistirNode` y anexa la propuesta al `reply` y al resumen del vendedor. Edición vía Table Editor de Supabase; carga inicial vía script seed con 14 filas estáticas.

**Tech Stack:** TypeScript, Supabase (`@supabase/supabase-js`), LangGraph, Next.js (webhook), tests con `node:test` + `tsx`.

## Global Constraints

- Imports entre archivos TS usan extensión `.js` (ESM) — copiar el estilo de los archivos vecinos.
- Tests: `node:test` + `node:assert/strict`, ubicados en `__tests__/`, ejecutados con `tsx --test`. Sin frameworks extra.
- Nunca `git push` directo a `main`. El trabajo va en la rama `feat/inventario-match` (ya creada).
- Si `git commit` está bloqueado por el guard, usar `git -c skill.commit=true commit`.
- Mensajes de commit terminan con: `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`
- Dominio de `forma` (mismo que `corte.forma` del bot, sin `indiferente`): `corte_esmeralda` | `oval` | `cojin` | `gota` | `redondo` | `otro`.
- El inventario solo se filtra por forma + peso + precio/ct. Cuando `presupuesto.base` no está, se asume `por_quilate`.

---

### Task 1: Migración — tabla `inventario` y apply-migration genérico

**Files:**
- Create: `packages/db/supabase/migrations/00002_inventario.sql`
- Modify: `scripts/apply-migration.mjs` (aplicar TODAS las migraciones en orden, no solo `00001`)

**Interfaces:**
- Produces: tabla `public.inventario` con columnas `id, nombre, forma, peso_ct, precio_usd_ct, cantidad_piedras, media_url, disponible, notas, created_at, updated_at` y `unique(nombre)`.

- [ ] **Step 1: Crear la migración**

`packages/db/supabase/migrations/00002_inventario.sql`:

```sql
-- Iris — inventario de esmeraldas

create table if not exists public.inventario (
  id uuid primary key default gen_random_uuid(),
  nombre text not null unique,
  forma text not null,
  peso_ct numeric not null,
  precio_usd_ct numeric not null,
  cantidad_piedras int not null default 1,
  media_url text,
  disponible boolean not null default true,
  notas text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists inventario_match_idx
  on public.inventario (disponible, forma);

-- RLS habilitado: el webhook usa service role (bypassa RLS). Sin políticas públicas.
-- El Table Editor de Supabase (consola) también opera con privilegios de servicio.
alter table public.inventario enable row level security;
```

- [ ] **Step 2: Generalizar `apply-migration.mjs` para aplicar todas las migraciones**

Reemplazar el bloque que lee/aplica solo `00001_init.sql` por uno que lea el directorio de migraciones ordenado. En `scripts/apply-migration.mjs`, sustituir desde la línea `const sql = readFileSync(` hasta `await client.query(sql);` por:

```js
import { readdirSync } from "node:fs";

const migrationsDir = path.join(root, "packages/db/supabase/migrations");
const files = readdirSync(migrationsDir).filter((f) => f.endsWith(".sql")).sort();
for (const file of files) {
  const sql = readFileSync(path.join(migrationsDir, file), "utf8");
  console.log(`Aplicando ${file}...`);
  await client.query(sql);
}
```

(El `import { readdirSync }` puede ir junto al `readFileSync` ya importado al inicio del archivo; mover ambos a una sola línea `import { readFileSync, readdirSync } from "node:fs";`.)

Y actualizar la verificación final para incluir `inventario`:

```js
const { rows } = await client.query(
  `select table_name from information_schema.tables
   where table_schema='public' and table_name in ('leads','lead_messages','inventario')
   order by table_name`
);
```

- [ ] **Step 3: Aplicar la migración**

Run: `node scripts/apply-migration.mjs`
Expected: imprime `Aplicando 00001_init.sql...`, `Aplicando 00002_inventario.sql...` y `Tablas presentes: inventario, lead_messages, leads`.

(Si falla por falta de `apps/web/.env` o `DATABASE_URL`, ese es un problema de entorno local — confirmar con el usuario antes de continuar; no es un fallo del plan.)

- [ ] **Step 4: Commit**

```bash
git add packages/db/supabase/migrations/00002_inventario.sql scripts/apply-migration.mjs
git -c skill.commit=true commit -m "feat(db): tabla inventario y apply-migration genérico

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: Tipo `Piedra` en `@iris/types`

**Files:**
- Create: `packages/types/src/inventario.ts`
- Modify: `packages/types/src/index.ts`

**Interfaces:**
- Consumes: nada.
- Produces:
  - `type PiedraForma = "corte_esmeralda" | "oval" | "cojin" | "gota" | "redondo" | "otro"`
  - `interface Piedra { id: string; nombre: string; forma: PiedraForma; peso_ct: number; precio_usd_ct: number; cantidad_piedras: number; media_url: string | null; disponible: boolean; notas: string | null; }`

- [ ] **Step 1: Crear el archivo de tipos**

`packages/types/src/inventario.ts`:

```ts
/** Forma del corte de una piedra en inventario.
 * Mismo dominio que `corte.forma` del comprador, sin `indiferente`. */
export type PiedraForma =
  | "corte_esmeralda"
  | "oval"
  | "cojin"
  | "gota"
  | "redondo"
  | "otro";

/** Una fila de la tabla `inventario`. */
export interface Piedra {
  id: string;
  nombre: string;
  forma: PiedraForma;
  peso_ct: number;
  precio_usd_ct: number;
  cantidad_piedras: number;
  media_url: string | null;
  disponible: boolean;
  notas: string | null;
}
```

- [ ] **Step 2: Exportar desde el índice**

En `packages/types/src/index.ts`, agregar al final:

```ts
export * from "./inventario.js";
```

- [ ] **Step 3: Verificar tipos**

Run: `npm run type-check --workspace=@iris/types`
Expected: sin errores.

- [ ] **Step 4: Commit**

```bash
git add packages/types/src/inventario.ts packages/types/src/index.ts
git -c skill.commit=true commit -m "feat(types): tipo Piedra para inventario

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: Lógica de match en `@iris/db`

**Files:**
- Create: `packages/db/src/queries/inventario.ts`
- Create: `packages/db/src/__tests__/inventario.test.ts`
- Modify: `packages/db/src/index.ts`

**Interfaces:**
- Consumes: `Piedra` de `@iris/types`; `Solicitud` de `@iris/types`; `DbClient` de `../client.js`.
- Produces:
  - `filtrarPiedras(piedras: Piedra[], solicitud: Solicitud): Piedra[]` — pura. Si no hay ninguno de forma/peso/presupuesto en la solicitud, devuelve `[]`. Filtra por forma (si ≠ `indiferente`), rango de peso, rango de precio (`por_quilate` por defecto; `total` usa `precio_usd_ct * peso_ct`). Ordena por `precio_usd_ct` asc y limita a 3.
  - `matchInventory(db: DbClient, solicitud: Solicitud): Promise<Piedra[]>` — `select * where disponible=true` y delega en `filtrarPiedras`.

- [ ] **Step 1: Escribir el test que falla**

`packages/db/src/__tests__/inventario.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { filtrarPiedras } from "../queries/inventario.js";
import type { Piedra } from "@iris/types";

const base: Omit<Piedra, "id" | "nombre" | "forma" | "peso_ct" | "precio_usd_ct"> = {
  cantidad_piedras: 1, media_url: null, disponible: true, notas: null,
};
const piedra = (id: string, forma: Piedra["forma"], peso_ct: number, precio_usd_ct: number): Piedra =>
  ({ ...base, id, nombre: id, forma, peso_ct, precio_usd_ct });

const STOCK: Piedra[] = [
  piedra("a", "corte_esmeralda", 0.88, 5100),
  piedra("b", "corte_esmeralda", 3.61, 1750),
  piedra("c", "cojin", 6.72, 440),
  piedra("d", "redondo", 3.09, 1500),
];

test("solicitud sin criterios relevantes no propone nada", () => {
  assert.deepEqual(filtrarPiedras(STOCK, { proposito: "joyeria" }), []);
});

test("filtra por forma", () => {
  const r = filtrarPiedras(STOCK, { corte: { forma: "cojin" } });
  assert.deepEqual(r.map((p) => p.id), ["c"]);
});

test("forma indiferente no filtra por forma", () => {
  const r = filtrarPiedras(STOCK, { corte: { forma: "indiferente" }, peso_quilates: { min: 3 } });
  assert.deepEqual(r.map((p) => p.id).sort(), ["b", "c", "d"]);
});

test("filtra por rango de peso", () => {
  const r = filtrarPiedras(STOCK, { peso_quilates: { min: 3, max: 4 } });
  assert.deepEqual(r.map((p) => p.id).sort(), ["b", "d"]);
});

test("filtra por precio por_quilate y ordena asc", () => {
  const r = filtrarPiedras(STOCK, { presupuesto: { max: 2000, base: "por_quilate" } });
  assert.deepEqual(r.map((p) => p.id), ["c", "d", "b"]);
});

test("presupuesto total compara precio_usd_ct * peso_ct", () => {
  // c: 440*6.72=2956.8 ; d: 1500*3.09=4635 ; b: 1750*3.61=6317.5 ; a: 5100*0.88=4488
  const r = filtrarPiedras(STOCK, { presupuesto: { max: 3000, base: "total" } });
  assert.deepEqual(r.map((p) => p.id), ["c"]);
});

test("sin base de presupuesto se asume por_quilate", () => {
  const r = filtrarPiedras(STOCK, { presupuesto: { max: 500 } });
  assert.deepEqual(r.map((p) => p.id), ["c"]);
});

test("limita a 3 resultados", () => {
  const many = [
    piedra("p1", "redondo", 1, 100), piedra("p2", "redondo", 1, 200),
    piedra("p3", "redondo", 1, 300), piedra("p4", "redondo", 1, 400),
  ];
  assert.equal(filtrarPiedras(many, { corte: { forma: "redondo" } }).length, 3);
});

test("excluye no disponibles", () => {
  const stock = [piedra("x", "redondo", 1, 100)];
  stock[0].disponible = false;
  assert.deepEqual(filtrarPiedras(stock, { corte: { forma: "redondo" } }), []);
});
```

- [ ] **Step 2: Correr el test para verificar que falla**

Run: `npx tsx --test packages/db/src/__tests__/inventario.test.ts`
Expected: FAIL — `filtrarPiedras` no existe / módulo no encontrado.

- [ ] **Step 3: Implementar `filtrarPiedras` y `matchInventory`**

`packages/db/src/queries/inventario.ts`:

```ts
import type { DbClient } from "../client.js";
import type { Piedra, Solicitud } from "@iris/types";

const dentro = (v: number, min?: number | null, max?: number | null): boolean =>
  (min == null || v >= min) && (max == null || v <= max);

/** Filtra el stock contra la solicitud. Solo usa forma + peso + precio/ct.
 * Devuelve [] si el comprador no dio ninguno de esos tres criterios. */
export function filtrarPiedras(piedras: Piedra[], s: Solicitud): Piedra[] {
  const forma = s.corte?.forma;
  const peso = s.peso_quilates;
  const pres = s.presupuesto;
  const hayForma = forma != null && forma !== "indiferente";
  const hayPeso = peso != null && (peso.min != null || peso.max != null);
  const hayPres = pres != null && (pres.min != null || pres.max != null);
  if (!hayForma && !hayPeso && !hayPres) return [];

  return piedras
    .filter((p) => p.disponible)
    .filter((p) => !hayForma || p.forma === forma)
    .filter((p) => !hayPeso || dentro(p.peso_ct, peso!.min, peso!.max))
    .filter((p) => {
      if (!hayPres) return true;
      // ponytail: base ausente → por_quilate (los precios del inventario son por quilate)
      if (pres!.base === "total") return dentro(p.precio_usd_ct * p.peso_ct, pres!.min, pres!.max);
      return dentro(p.precio_usd_ct, pres!.min, pres!.max);
    })
    .sort((a, b) => a.precio_usd_ct - b.precio_usd_ct)
    .slice(0, 3);
}

/** Trae el stock disponible y lo filtra contra la solicitud. */
export async function matchInventory(db: DbClient, solicitud: Solicitud): Promise<Piedra[]> {
  const { data, error } = await db.from("inventario").select("*").eq("disponible", true);
  if (error) throw error;
  return filtrarPiedras((data ?? []) as Piedra[], solicitud);
}
```

- [ ] **Step 4: Exportar desde el índice**

En `packages/db/src/index.ts`, agregar al final:

```ts
export * from "./queries/inventario.js";
```

- [ ] **Step 5: Correr el test para verificar que pasa**

Run: `npx tsx --test packages/db/src/__tests__/inventario.test.ts`
Expected: PASS — todos los tests verdes.

- [ ] **Step 6: Commit**

```bash
git add packages/db/src/queries/inventario.ts packages/db/src/__tests__/inventario.test.ts packages/db/src/index.ts
git -c skill.commit=true commit -m "feat(db): filtrarPiedras y matchInventory

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: Propuesta de piedras en el grafo del agente

**Files:**
- Modify: `packages/agent/src/graph.ts`
- Modify: `packages/agent/src/__tests__/graph.test.ts`

**Interfaces:**
- Consumes: `matchInventory`/`Piedra` (a través del tipo `Piedra` de `@iris/types`); `filtrarPiedras` no se usa aquí.
- Produces:
  - `IrisDeps` gana un campo OPCIONAL `matchInventory?: (solicitud: Solicitud) => Promise<Piedra[]>`.
  - `buildPiedrasPropuestas(piedras: Piedra[]): string` exportada — devuelve `""` si la lista está vacía, o un bloque de texto con viñetas.
  - `persistirNode` anexa la propuesta al `reply` y al texto enviado a `notifySeller`.

- [ ] **Step 1: Escribir el test que falla**

Agregar a `packages/agent/src/__tests__/graph.test.ts` (incluir `Piedra` en el import de `@iris/types` existente: `import type { LeadRow, Solicitud, Piedra } from "@iris/types";`):

```ts
import { buildPiedrasPropuestas } from "../graph.js";

test("buildPiedrasPropuestas vacío cuando no hay piedras", () => {
  assert.equal(buildPiedrasPropuestas([]), "");
});

test("buildPiedrasPropuestas lista nombre, peso y precio", () => {
  const piedras: Piedra[] = [{
    id: "a", nombre: "Cushion 6.72 ct - 440 usd-ct", forma: "cojin",
    peso_ct: 6.72, precio_usd_ct: 440, cantidad_piedras: 1,
    media_url: null, disponible: true, notas: null,
  }];
  const txt = buildPiedrasPropuestas(piedras);
  assert.match(txt, /Cushion 6\.72/);
  assert.match(txt, /440/);
});

test("al completar, propone piedras del inventario en reply y al vendedor", async () => {
  const seller: string[] = [];
  const piedra: Piedra = {
    id: "a", nombre: "Redonda 3.09 ct - 1.500 usd-ct", forma: "redondo",
    peso_ct: 3.09, precio_usd_ct: 1500, cantidad_piedras: 1,
    media_url: null, disponible: true, notas: null,
  };
  const deps: IrisDeps = {
    extract: async () => ({
      proposito: "joyeria", tipo_pieza: "gema_tallada", color: { tono: "verde" },
      presupuesto: { max: 5000, moneda: "USD" }, peso_quilates: { min: 1 },
      origen: { pais: "colombia" },
    }),
    saveLead: async () => ({ id: "lead-1" }),
    notifySeller: async (t) => { seller.push(t); },
    matchInventory: async () => [piedra],
    checkpointer: new MemorySaver(),
  };
  const { reply, estado } = await runIris(deps, {
    telegramUserId: 55, chatId: 55, text: "esmeralda verde de Colombia, 1ct, hasta 5000",
  });
  assert.equal(estado, "completo");
  assert.match(reply, /Redonda 3\.09/);
  assert.match(seller[0], /Redonda 3\.09/);
});
```

- [ ] **Step 2: Correr el test para verificar que falla**

Run: `npx tsx --test packages/agent/src/__tests__/graph.test.ts`
Expected: FAIL — `buildPiedrasPropuestas` no existe y `matchInventory` no es campo de `IrisDeps`.

- [ ] **Step 3: Implementar en `graph.ts`**

En `packages/agent/src/graph.ts`:

1. Ampliar el import de tipos (línea 2) para incluir `Piedra`:

```ts
import type { Solicitud, EstadoLead, LeadRow, Piedra } from "@iris/types";
```

2. Agregar el campo opcional a `IrisDeps` (dentro de la interfaz, junto a `notifySeller`):

```ts
  /** Opcional: propone piedras del inventario que coincidan. */
  matchInventory?: (solicitud: Solicitud) => Promise<Piedra[]>;
```

3. Agregar la función exportada (después de `buildSellerSummary`):

```ts
export function buildPiedrasPropuestas(piedras: Piedra[]): string {
  if (piedras.length === 0) return "";
  const items = piedras.map((p) => {
    const link = p.media_url ? ` — ${p.media_url}` : "";
    return `• ${p.nombre} (${p.peso_ct} ct, ${p.precio_usd_ct} USD/ct)${link}`;
  });
  return `\n\nTengo estas piedras que podrían encajar:\n${items.join("\n")}`;
}
```

4. Modificar `persistirNode` para anexar la propuesta. Reemplazar el cuerpo desde `await deps.saveLead(row);` hasta el `return` final por:

```ts
  await deps.saveLead(row);
  const piedras = deps.matchInventory ? await deps.matchInventory(state.solicitud) : [];
  const propuesta = buildPiedrasPropuestas(piedras);
  await deps.notifySeller(buildSellerSummary(row) + propuesta);
  const reply = estadoFinal === "completo"
    ? "¡Gracias! Registré tu solicitud y un asesor de Méraldi te contactará pronto. 💚"
    : "Gracias por la información. Un asesor de Méraldi continuará contigo para afinar los detalles.";
  return { reply: reply + propuesta, estado: estadoFinal };
```

- [ ] **Step 4: Correr los tests del agente para verificar que pasan**

Run: `npx tsx --test packages/agent/src/__tests__/graph.test.ts`
Expected: PASS — incluyendo los tests existentes (siguen funcionando porque `matchInventory` es opcional).

- [ ] **Step 5: Commit**

```bash
git add packages/agent/src/graph.ts packages/agent/src/__tests__/graph.test.ts
git -c skill.commit=true commit -m "feat(agent): proponer piedras del inventario al persistir

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: Cablear `matchInventory` en el webhook

**Files:**
- Modify: `apps/web/src/app/api/telegram/webhook/route.ts`

**Interfaces:**
- Consumes: `matchInventory` de `@iris/db`; `IrisDeps.matchInventory` del agente.
- Produces: el webhook de producción inyecta la dependencia real.

- [ ] **Step 1: Importar `matchInventory`**

En la línea 2 de `route.ts`, agregar `matchInventory` al import de `@iris/db`:

```ts
import { createServerClient, upsertLead, addLeadMessage, matchInventory } from "@iris/db";
```

- [ ] **Step 2: Inyectar la dependencia**

Dentro del objeto `deps` (después de `notifySeller`), agregar:

```ts
    matchInventory: (solicitud) => matchInventory(db, solicitud),
```

- [ ] **Step 3: Verificar tipos y build del app web**

Run: `npm run type-check --workspace=@iris/agent && npm run build --workspace=web`
Expected: sin errores de tipo; build de Next exitoso.

(Si el script `type-check` no existe en algún workspace, usar `npx tsc --noEmit -p <workspace>` o el build como verificación.)

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/app/api/telegram/webhook/route.ts
git -c skill.commit=true commit -m "feat(web): inyectar matchInventory en el webhook

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 6: Carga inicial del inventario (14 piedras)

**Files:**
- Create: `scripts/seed-inventario.mjs`

**Interfaces:**
- Consumes: tabla `inventario` (Task 1), `DATABASE_URL` en `apps/web/.env`.
- Produces: 14 filas en `inventario`. Idempotente vía `on conflict (nombre) do nothing`.

`media_url` se deja `null`: el usuario aún no proveyó el link de Drive y lo llenará en el Table Editor.

- [ ] **Step 1: Crear el script seed**

`scripts/seed-inventario.mjs`:

```js
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import pg from "pg";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const envText = readFileSync(path.join(root, "apps/web/.env"), "utf8");
const env = {};
for (const line of envText.split(/\r?\n/)) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m) env[m[1]] = m[2];
}
const url = env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL no encontrado en apps/web/.env");

// nombre, forma, peso_ct, precio_usd_ct, cantidad_piedras
const PIEDRAS = [
  ["Cuadrada 0.88 ct - 5.100 usd-ct", "corte_esmeralda", 0.88, 5100, 1],
  ["Cuadrada 3.61 ct - 1.750 usd-ct", "corte_esmeralda", 3.61, 1750, 1],
  ["Cuadrada 6.21 ct - 27.000 usd-ct", "corte_esmeralda", 6.21, 27000, 1],
  ["Cushion 6.72 ct - 440 usd-ct", "cojin", 6.72, 440, 1],
  ["Esmeralda 1.26 ct - 5.800 usd-ct", "corte_esmeralda", 1.26, 5800, 1],
  ["Esmeralda 2.04 ct - 1.050 usd-ct", "corte_esmeralda", 2.04, 1050, 1],
  ["Esmeralda 3.46 ct - 7.200 usd-ct", "corte_esmeralda", 3.46, 7200, 1],
  ["Esmeralda cuadrada 9.04 ct - 4.300 usd-ct", "corte_esmeralda", 9.04, 4300, 1],
  ["Lote 28 piedras en 12.24 ct - 520 usd-ct", "otro", 12.24, 520, 28],
  ["Lote 4 esmeraldas 8.82 ct - 1.500 usd-ct", "corte_esmeralda", 8.82, 1500, 4],
  ["Pareja corazones 3.99 ct - 1.000 usd-ct", "otro", 3.99, 1000, 2],
  ["Pareja cushions 4.60 ct - 860 usd-ct", "cojin", 4.60, 860, 2],
  ["Pareja esmeraldas 4.52 ct - 250 usd-ct", "corte_esmeralda", 4.52, 250, 2],
  ["Redonda 3.09 ct - 1.500 usd-ct", "redondo", 3.09, 1500, 1],
];

const client = new pg.Client({ connectionString: url, ssl: { rejectUnauthorized: false } });
await client.connect();
console.log("Conectado. Cargando inventario...");
for (const [nombre, forma, peso, precio, cant] of PIEDRAS) {
  await client.query(
    `insert into public.inventario (nombre, forma, peso_ct, precio_usd_ct, cantidad_piedras)
     values ($1,$2,$3,$4,$5) on conflict (nombre) do nothing`,
    [nombre, forma, peso, precio, cant]
  );
}
const { rows } = await client.query("select count(*)::int as n from public.inventario");
console.log(`Inventario: ${rows[0].n} filas.`);
await client.end();
console.log("OK");
```

- [ ] **Step 2: Ejecutar el seed**

Run: `node scripts/seed-inventario.mjs`
Expected: `Inventario: 14 filas.` y `OK`. Correrlo de nuevo debe seguir diciendo `14 filas` (idempotente).

- [ ] **Step 3: Commit**

```bash
git add scripts/seed-inventario.mjs
git -c skill.commit=true commit -m "feat(db): script de carga inicial del inventario (14 piedras)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Notas de cierre

- **Pendiente del usuario:** link de la carpeta de Drive para llenar `media_url` (vía Table Editor). Mientras tanto la propuesta muestra nombre/peso/precio sin link.
- **Edición continua:** Table Editor de Supabase (`Table editor → inventario`). Marcar `disponible = false` al vender.
- **Descartado por YAGNI:** parser de nombres de carpeta (la carga es única y la edición es manual), admin custom, enriquecer color/origen por piedra, búsqueda semántica.
