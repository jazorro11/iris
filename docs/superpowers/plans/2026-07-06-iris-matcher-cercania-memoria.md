# Iris — Matcher de cercanía + memoria ligera — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Que Iris siempre ofrezca las piedras disponibles más cercanas (con foto y precio), muestre antes y pregunte menos, y no re-pregunte/re-muestre lo ya tratado.

**Architecture:** El matcher pasa de filtro de corte duro (`[]` cuando nada cumple) a un ranking por puntaje de cercanía que nunca devuelve vacío si el cliente dio algún criterio, más un flag `hayExactas`. El gate de 6 campos deja de bloquear: en cuanto hay piedras que mostrar (o tras N rondas), la conversación avanza a "asesorar". Trackers deterministas de campos preguntados y piedras mostradas evitan repeticiones; un resumen rodante opcional da coherencia narrativa.

**Tech Stack:** TypeScript, LangGraph JS (`@langchain/langgraph`), Zod, node:test + node:assert/strict, tsx, monorepo npm-workspaces (`@iris/types`, `@iris/db`, `@iris/agent`, `apps/web`).

## Global Constraints

- **Pins de LangChain (no tocar):** `@langchain/core` 1.1.41, `@langchain/langgraph-checkpoint` 1.0.1 (root `package.json` overrides). No introducir deps que exijan `--legacy-peer-deps`.
- **Framework de test:** `node:test` (`import { test } from "node:test"`) + `node:assert/strict`. Correr por paquete: `npm test -w @iris/db` y `npm test -w @iris/agent`. Un archivo suelto: `npx tsx --test <ruta>` desde la raíz.
- **tsx + barrels `export *`:** en scripts/tests `.mts`/`.mjs` importar por subpath directo cuando el paquete apunta a build (`@iris/db`); los tests dentro de cada paquete importan por ruta relativa `../...js`.
- **Imports con extensión `.js`** en el código TS de los paquetes (ESM + `extensionAlias`). Mantener el estilo existente.
- **Commits en español**, tipo `feat(agent): ...` / `fix(db): ...`, terminando con:
  `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`
- **NUNCA `git push` a `main`**; trabajar en la rama actual `docs/iris-asesora-conversacional`. No desplegar a prod en este plan.
- **Comportamiento-LLM se verifica EN VIVO** (Task 8), no solo con mocks. Tras tocar cualquier prompt, re-verificar TODOS los flags del clasificador (idioma/handoff/preguntaProfunda), no solo el que se cambió.
- **Producción NO se toca** (solo lectura ya hecha). El inventario prod ya tiene `media_url` poblado; `origen`/`color` están NULL (fuera de alcance).

---

## File Structure

- `packages/db/src/queries/inventario.ts` — matcher: se reemplaza `filtrarPiedras` (filtro duro) por `rankearPiedras` (ranking de cercanía) + `hayMatchExacto`; `matchInventory` devuelve `{ piedras, hayExactas }`.
- `packages/db/src/__tests__/inventario.test.ts` — se reescriben los tests de filtro por tests de ranking; se conservan los de coerción/COP/disponible adaptados.
- `packages/agent/src/graph.ts` — `decideBriefIntent` (gate relajado + válvula de escape); consumo del nuevo `matchInventory`; registro de trackers de memoria.
- `packages/agent/src/state.ts` — nuevos canales `preguntadas`, `piedras_mostradas` (union), `resumen` (lastWrite).
- `packages/agent/src/brief.ts` + `packages/types/src/compose.ts` — el brief transporta `hayExactas`, `yaPreguntado`, `piedrasMostradas`, `resumen`.
- `packages/agent/src/composer.ts` — prompt consciente de la foto auto-adjunta, fraseo "lo más cercano" y anti-repetición; render de los nuevos campos.
- `packages/agent/src/extractor.ts` — prompt mapea "sin preferencia" → `indiferente` y "anillo de compromiso" → `tipo_pieza`/`proposito`.
- `packages/agent/src/__tests__/*` — tests nuevos/adaptados (graph.media, graph.gate, brief).
- `scripts/eval-asesora.mjs` — escenario Chat5 con stock realista (con `media_url`) para verificación en vivo.

---

## Task 1: Matcher de cercanía (funciones puras)

Introduce el ranking sin tocar aún `matchInventory` ni el grafo (build queda verde).

**Files:**
- Modify: `packages/db/src/queries/inventario.ts`
- Test: `packages/db/src/__tests__/inventario.test.ts`

**Interfaces:**
- Produces:
  - `hasCriteriosRelevantes(s: Solicitud): boolean`
  - `cumpleEstricto(p: Piedra, s: Solicitud): boolean`
  - `hayMatchExacto(piedras: Piedra[], s: Solicitud): boolean`
  - `rankearPiedras(piedras: Piedra[], s: Solicitud): Piedra[]` (≤3, nunca vacío si hay criterios y hay stock disponible; `[]` si no hay criterios)

- [ ] **Step 1: Escribe los tests que fallan**

Añade al final de `packages/db/src/__tests__/inventario.test.ts` (mantén los imports; agrega `rankearPiedras, hayMatchExacto` al import de `../queries/inventario.js`):

```ts
import { rankearPiedras, hayMatchExacto } from "../queries/inventario.js";

const STOCK6: Piedra[] = [
  piedra("a", "corte_esmeralda", 0.88, 5100),
  piedra("b", "corte_esmeralda", 3.61, 1750),
  piedra("c", "cojin", 6.72, 440),
  piedra("d", "redondo", 3.09, 1500),
  piedra("e", "corte_esmeralda", 6.21, 27000),
  piedra("f", "corte_esmeralda", 4.52, 250),
];

test("rankear: sin criterios devuelve vacío", () => {
  assert.deepEqual(rankearPiedras(STOCK6, { proposito: "joyeria" }), []);
});

test("rankear: peso 5-6 ct devuelve las 3 más cercanas (nunca vacío)", () => {
  // penaltyPeso: e(6.21)=0.038 f(4.52)=0.087 c(6.72)=0.131 → top3
  const r = rankearPiedras(STOCK6, { peso_quilates: { min: 5, max: 6 } });
  assert.deepEqual(r.map((p) => p.id), ["e", "f", "c"]);
});

test("rankear: presupuesto es penalización suave, no corte (10ct/2000 total)", () => {
  const big = [piedra("g", "corte_esmeralda", 9.04, 4300), piedra("h", "corte_esmeralda", 8.82, 1500)];
  // h: pres (13230-2000)/2000=5.615 + peso 0.118 ; g: (38872-2000)/2000=18.436 + 0.096 → [h,g]
  const r = rankearPiedras(big, { peso_quilates: { min: 10, max: 10 }, presupuesto: { min: 2000, max: 2000, base: "total" } });
  assert.deepEqual(r.map((p) => p.id), ["h", "g"]);
});

test("rankear: excluye no disponibles", () => {
  const stock = [{ ...piedra("x", "redondo", 1, 100), disponible: false }, piedra("y", "redondo", 1, 100)];
  assert.deepEqual(rankearPiedras(stock, { peso_quilates: { min: 1, max: 1 } }).map((p) => p.id), ["y"]);
});

test("hayMatchExacto: peso 5-6 sin stock en banda → false", () => {
  assert.equal(hayMatchExacto(STOCK6, { peso_quilates: { min: 5, max: 6 } }), false);
});

test("hayMatchExacto: peso 3-4 con stock en banda → true", () => {
  assert.equal(hayMatchExacto(STOCK6, { peso_quilates: { min: 3, max: 4 } }), true);
});

test("hayMatchExacto: sin criterios → false", () => {
  assert.equal(hayMatchExacto(STOCK6, { proposito: "joyeria" }), false);
});
```

- [ ] **Step 2: Corre los tests y verifica que fallan**

Run: `npx tsx --test packages/db/src/__tests__/inventario.test.ts`
Expected: FAIL — `rankearPiedras`/`hayMatchExacto` no exportadas.

- [ ] **Step 3: Implementa las funciones puras**

En `packages/db/src/queries/inventario.ts`, conserva `dentro`, `bandaPeso`, `topePresupuesto` y añade (antes de `matchInventory`):

```ts
export function hasCriteriosRelevantes(s: Solicitud): boolean {
  const forma = s.corte?.forma;
  const peso = s.peso_quilates;
  const pres = s.presupuesto;
  const hayForma = forma != null && forma !== "indiferente";
  const hayPeso = peso != null && (peso.min != null || peso.max != null);
  const hayPres = pres != null && (pres.min != null || pres.max != null) && pres.moneda !== "COP";
  return hayForma || hayPeso || hayPres;
}

/** ¿La piedra cumple LITERALMENTE lo pedido (forma + banda de peso + tope de presupuesto)? */
export function cumpleEstricto(p: Piedra, s: Solicitud): boolean {
  if (!p.disponible) return false;
  const forma = s.corte?.forma;
  const hayForma = forma != null && forma !== "indiferente";
  if (hayForma && p.forma !== forma) return false;
  const peso = s.peso_quilates;
  const hayPeso = peso != null && (peso.min != null || peso.max != null);
  if (hayPeso) {
    const [pMin, pMax] = bandaPeso(peso!.min ?? null, peso!.max ?? null);
    if (!dentro(p.peso_ct, pMin, pMax)) return false;
  }
  const pres = s.presupuesto;
  const hayPres = pres != null && (pres.min != null || pres.max != null) && pres.moneda !== "COP";
  if (hayPres) {
    const [, presMax] = topePresupuesto(pres!.min ?? null, pres!.max ?? null);
    const precio = pres!.base === "total" ? p.precio_usd_ct * p.peso_ct : p.precio_usd_ct;
    if (!dentro(precio, null, presMax)) return false;
  }
  return true;
}

export function hayMatchExacto(piedras: Piedra[], s: Solicitud): boolean {
  if (!hasCriteriosRelevantes(s)) return false;
  return piedras.some((p) => cumpleEstricto(p, s));
}

function penaltyPeso(p: Piedra, s: Solicitud): number {
  const peso = s.peso_quilates;
  if (!peso || (peso.min == null && peso.max == null)) return 0;
  const min = peso.min ?? peso.max!;
  const max = peso.max ?? peso.min!;
  if (p.peso_ct >= min && p.peso_ct <= max) return 0;
  const d = p.peso_ct < min ? min - p.peso_ct : p.peso_ct - max;
  return d / ((min + max) / 2); // distancia relativa al centro pedido
}

function penaltyPres(p: Piedra, s: Solicitud): number {
  const pres = s.presupuesto;
  if (!pres || pres.moneda === "COP") return 0;
  const tope = pres.max ?? pres.min;
  if (tope == null) return 0;
  const precio = pres.base === "total" ? p.precio_usd_ct * p.peso_ct : p.precio_usd_ct;
  if (precio <= tope) return 0; // por debajo del presupuesto no penaliza
  return (precio - tope) / tope; // exceso relativo
}

function penaltyForma(p: Piedra, s: Solicitud): number {
  const forma = s.corte?.forma;
  if (forma == null || forma === "indiferente") return 0;
  return p.forma === forma ? 0 : 0.5;
}

/** Ranking por cercanía: nunca vacío si hay criterios y stock disponible. */
export function rankearPiedras(piedras: Piedra[], s: Solicitud): Piedra[] {
  if (!hasCriteriosRelevantes(s)) return [];
  return piedras
    .filter((p) => p.disponible)
    .map((p) => ({ p, score: penaltyPeso(p, s) + penaltyPres(p, s) + penaltyForma(p, s) }))
    .sort((a, b) => a.score - b.score || a.p.precio_usd_ct - b.p.precio_usd_ct)
    .slice(0, 3)
    .map((x) => x.p);
}
```

- [ ] **Step 4: Corre los tests y verifica que pasan**

Run: `npx tsx --test packages/db/src/__tests__/inventario.test.ts`
Expected: los 7 tests nuevos PASS (los antiguos de `filtrarPiedras` siguen verdes; se retiran en Task 2).

- [ ] **Step 5: Commit**

```bash
git add packages/db/src/queries/inventario.ts packages/db/src/__tests__/inventario.test.ts
git -c skill.commit=true commit -m "feat(db): matcher de cercanía (rankearPiedras + hayMatchExacto)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: `matchInventory` devuelve `{ piedras, hayExactas }` y se retira el filtro duro

**Files:**
- Modify: `packages/db/src/queries/inventario.ts:52-63`
- Modify: `packages/db/src/__tests__/inventario.test.ts` (retirar tests de `filtrarPiedras`, adaptar los de coerción)
- Modify: `packages/agent/src/graph.ts` (tipo `IrisDeps.matchInventory` + `responderNode`/`efectosNode`)
- Modify: `packages/agent/src/__tests__/graph.media.test.ts` (mock nuevo)
- Modify: `packages/agent/src/__tests__/graph.test.ts:39,181` (dos mocks de `matchInventory` devuelven struct)
- Modify: `scripts/eval-asesora.mjs` (dep `matchInventory` desestructura struct)
- (Sin cambios de código) `apps/web/src/app/api/telegram/webhook/route.ts:61` — el tipo alinea solo.

**Interfaces:**
- Produces: `matchInventory(db, s): Promise<{ piedras: Piedra[]; hayExactas: boolean }>`
- Consumes en `graph.ts`: `IrisDeps.matchInventory?: (s: Solicitud) => Promise<{ piedras: Piedra[]; hayExactas: boolean }>`

- [ ] **Step 1: Adapta el test de coerción (rojo)**

En `packages/db/src/__tests__/inventario.test.ts`:
1. **Elimina** los tests cuyo nombre empieza por "filtra…", "solicitud sin criterios…", "forma indiferente…", "limita a 3…", "excluye no disponibles" (el viejo), "presupuesto en COP…", "solo presupuesto COP…", "peso de un solo valor…", "presupuesto de un solo valor…", "caso B…", "regresión: peso ~10ct…" y "presupuesto total…" — todos ejercen `filtrarPiedras`.
2. **Quita** `filtrarPiedras` del import.
3. **Adapta** los dos tests de `matchInventory` (coerción + columnas técnicas) al nuevo retorno:

```ts
test("matchInventory coerciona numeric (string) a number y rankea", async () => {
  const fakeDb = {
    from: () => ({ select: () => ({ eq: async () => ({
      data: [
        { id: "a", nombre: "A", forma: "redondo", peso_ct: "3.09", precio_usd_ct: "1500", cantidad_piedras: "1", media_url: null, disponible: true, notas: null },
        { id: "b", nombre: "B", forma: "redondo", peso_ct: "1.00", precio_usd_ct: "200", cantidad_piedras: "1", media_url: null, disponible: true, notas: null },
      ],
      error: null,
    }) }) }),
  } as unknown as DbClient;
  const r = await matchInventory(fakeDb, { peso_quilates: { min: 1, max: 1 } });
  assert.equal(typeof r.piedras[0].precio_usd_ct, "number");
  assert.equal(typeof r.piedras[0].peso_ct, "number");
  assert.equal(r.piedras[0].id, "b"); // b (1.00) más cercano a 1 ct que a (3.09)
  assert.equal(r.hayExactas, true); // b en banda [0.85,1.15]
});

test("matchInventory propaga columnas técnicas nuevas", async () => {
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
  const r = await matchInventory(fakeDb, { peso_quilates: { min: 3, max: 3 } });
  assert.equal(r.piedras[0].origen, "Muzo");
  assert.equal(r.piedras[0].color, "verde vívido");
});
```

- [ ] **Step 2: Corre y verifica el rojo**

Run: `npx tsx --test packages/db/src/__tests__/inventario.test.ts`
Expected: FAIL — `matchInventory` aún devuelve `Piedra[]` (accesos a `.piedras`/`.hayExactas` fallan).

- [ ] **Step 3: Reescribe `matchInventory` y elimina `filtrarPiedras`**

En `packages/db/src/queries/inventario.ts`, **borra** la función `filtrarPiedras` (líneas 22-49) y reemplaza `matchInventory`:

```ts
/** Trae el stock disponible y devuelve las piedras más cercanas + si hubo match exacto. */
export async function matchInventory(
  db: DbClient,
  solicitud: Solicitud
): Promise<{ piedras: Piedra[]; hayExactas: boolean }> {
  const { data, error } = await db.from("inventario").select("*").eq("disponible", true);
  if (error) throw error;
  // Supabase devuelve columnas numeric como string; coercionar a number en el borde.
  const piedras = (data ?? []).map((r: any) => ({
    ...r,
    peso_ct: Number(r.peso_ct),
    precio_usd_ct: Number(r.precio_usd_ct),
    cantidad_piedras: Number(r.cantidad_piedras),
  })) as Piedra[];
  return { piedras: rankearPiedras(piedras, solicitud), hayExactas: hayMatchExacto(piedras, solicitud) };
}
```

- [ ] **Step 4: Actualiza los consumidores en `graph.ts`**

- Cambia el tipo en `IrisDeps` (línea 16):
```ts
  matchInventory?: (solicitud: Solicitud) => Promise<{ piedras: Piedra[]; hayExactas: boolean }>;
```
- En `efectosNode` (línea 97), desestructura:
```ts
    const { piedras } = deps.matchInventory ? await deps.matchInventory(state.solicitud) : { piedras: [] as Piedra[] };
```
- En `responderNode` (línea 109), desestructura (se usará `hayExactas` en Task 5):
```ts
  const { piedras, hayExactas } = deps.matchInventory
    ? await deps.matchInventory(state.solicitud)
    : { piedras: [] as Piedra[], hayExactas: false };
```
  (Marca `hayExactas` como usado más adelante; si el linter se queja por no-usado, se consume en Task 5. Para mantener verde ahora, pásalo al brief como campo ignorado o prefíjalo `void hayExactas;` temporalmente — se elimina el `void` en Task 5.)

- [ ] **Step 5: Actualiza los mocks de los tests del grafo**

En `graph.media.test.ts`, primer test:
```ts
    matchInventory: async () => ({ piedras: [piedraFoto], hayExactas: true }),
```
(el segundo test no define `matchInventory`, no requiere cambio).

En `graph.test.ts`:
- Línea 39:
```ts
    matchInventory: async (s) => { pasoSolicitud = s; return { piedras: [piedra], hayExactas: true }; },
```
- Línea 181:
```ts
    matchInventory: async () => ({ piedras: [piedra], hayExactas: true }),
```

- [ ] **Step 6: Actualiza `scripts/eval-asesora.mjs`**

Cambia la dep (línea 40) para propagar solo las piedras al grafo (el grafo ya desestructura internamente): no requiere cambio porque `deps.matchInventory` devuelve lo que retorna `matchInventory(fakeDb, s)`, que ahora es el struct. Verifica que la firma calce (el grafo desestructura). Sin cambios de código aquí.

- [ ] **Step 7: Corre toda la suite de ambos paquetes**

Run: `npm test -w @iris/db && npm test -w @iris/agent`
Expected: PASS (db: coerción/técnicas + ranking; agent: media expone `http://x/a.jpg`).

- [ ] **Step 8: Commit**

```bash
git add packages/db packages/agent scripts/eval-asesora.mjs
git -c skill.commit=true commit -m "refactor(db,agent): matchInventory devuelve {piedras,hayExactas}; retira filtro duro

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: Relajar el gate + válvula de escape (`decideBriefIntent`)

**Files:**
- Modify: `packages/agent/src/graph.ts` (nueva `decideBriefIntent`, uso en `responderNode`, import `MAX_RONDAS`)
- Test: `packages/agent/src/__tests__/graph.gate.test.ts` (nuevo)

**Interfaces:**
- Produces: `decideBriefIntent(a: { handoff: boolean; estado: EstadoLead; tieneStones: boolean; rondas: number }): "handoff" | "asesorar" | "aclarar"`

- [ ] **Step 1: Escribe el test que falla**

Crea `packages/agent/src/__tests__/graph.gate.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { decideBriefIntent } from "../graph.js";

test("handoff manda sobre todo", () => {
  assert.equal(decideBriefIntent({ handoff: true, estado: "en_aclaracion", tieneStones: false, rondas: 1 }), "handoff");
});

test("con piedras que mostrar → asesorar aunque falten datos", () => {
  assert.equal(decideBriefIntent({ handoff: false, estado: "en_aclaracion", tieneStones: true, rondas: 1 }), "asesorar");
});

test("estado completo → asesorar", () => {
  assert.equal(decideBriefIntent({ handoff: false, estado: "completo", tieneStones: false, rondas: 1 }), "asesorar");
});

test("válvula de escape: tras MAX_RONDAS incompleto y sin piedras → asesorar", () => {
  assert.equal(decideBriefIntent({ handoff: false, estado: "en_aclaracion", tieneStones: false, rondas: 4 }), "asesorar");
});

test("incompleto, sin piedras, pocas rondas → aclarar", () => {
  assert.equal(decideBriefIntent({ handoff: false, estado: "en_aclaracion", tieneStones: false, rondas: 1 }), "aclarar");
});
```

- [ ] **Step 2: Corre y verifica el rojo**

Run: `npx tsx --test packages/agent/src/__tests__/graph.gate.test.ts`
Expected: FAIL — `decideBriefIntent` no exportada.

- [ ] **Step 3: Implementa y usa `decideBriefIntent`**

En `packages/agent/src/graph.ts`:
- Añade al import de `request.js`: `import { evaluarEstado, MAX_RONDAS } from "./request.js";`
- Exporta la función (antes de `responderNode`):
```ts
export function decideBriefIntent(a: {
  handoff: boolean; estado: EstadoLead; tieneStones: boolean; rondas: number;
}): "handoff" | "asesorar" | "aclarar" {
  if (a.handoff) return "handoff";
  if (a.estado === "completo" || a.tieneStones || a.rondas >= MAX_RONDAS) return "asesorar";
  return "aclarar";
}
```
- En `responderNode`, reemplaza el cálculo de `briefIntent` (líneas 110-112) por:
```ts
  const briefIntent = decideBriefIntent({
    handoff: state.intent.handoff,
    estado: state.estado,
    tieneStones: piedras.length > 0,
    rondas: state.rondas,
  });
```

- [ ] **Step 4: Corre y verifica el verde**

Run: `npx tsx --test packages/agent/src/__tests__/graph.gate.test.ts`
Expected: los 5 tests PASS.

- [ ] **Step 5: Verifica no-regresión del grafo**

Run: `npm test -w @iris/agent`
Expected: PASS. (Nota: `graph.test.ts:75-91` afirmaba "no cierra ni persiste tras muchos turnos incompletos". Sigue válido: `decideBriefIntent` cambia el *modo de redacción*, no persiste ni cierra el lead — `efectosNode` sigue gateado por `estado==="completo" || handoff`. Si algún assert de `graph.test.ts` dependía del texto de aclaración con piedras presentes, actualízalo al nuevo modo asesorar.)

- [ ] **Step 6: Commit**

```bash
git add packages/agent/src/graph.ts packages/agent/src/__tests__/graph.gate.test.ts
git -c skill.commit=true commit -m "feat(agent): gate relajado + válvula de escape (decideBriefIntent)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: Extractor — "sin preferencia" → `indiferente` y "anillo de compromiso"

Cambio de prompt. La verificación de comportamiento es EN VIVO (Task 8); aquí solo se edita el prompt y se documenta el criterio.

**Files:**
- Modify: `packages/agent/src/extractor.ts:12-23` (`EXTRACTION_SYSTEM_PROMPT`)

- [ ] **Step 1: Edita el prompt de extracción**

Reemplaza el bloque `Reglas:` de `EXTRACTION_SYSTEM_PROMPT` por:

```ts
Reglas:
- No inventes ni asumas valores que el comprador no dijo. Si un dato no aparece, omítelo.
- Usa exclusivamente los valores de enumeración permitidos por el esquema.
- "sin preferencia", "me da igual", "el que recomiendes", "no importa" sobre un atributo → usa el valor "indiferente" de ese campo (color.tono, corte.forma, origen.pais, claridad, tratamiento_max_aceptable). Es un valor lleno, NO lo omitas.
- "verde esmeralda intenso" → color.tono=verde, color.saturacion=vivida.
- "anillo de compromiso" / "para un anillo" / "para engastar" → el comprador busca la GEMA para montar: tipo_pieza=gema_tallada, proposito=regalo. "anillo ya hecho" / "joya terminada" → tipo_pieza=joya_terminada.
- Presupuesto: detecta moneda (USD/COP) y si es total o por quilate. Un monto único para "un anillo"/"una piedra" sin decir "por quilate" es total (base=total).
- Orígenes Méraldi: Colombia (Muzo, Coscuez, Chivor, La Pita/Maripí, Gachalá), Zambia (Kafubu/Kagem), Brasil.
- Tratamiento según la guía: sin_tratamiento, insignificante, menor, moderado, significativo.
- Tipo de pieza: gema tallada, cristal en bruto, joya terminada o espécimen mineral.
```

- [ ] **Step 2: Sanidad de tipos e import**

Run: `npm test -w @iris/agent && npx tsc --noEmit -p packages/agent`
Expected: PASS (los tests de extractor con mocks no dependen del texto del prompt; el smoke real es Task 8).

- [ ] **Step 3: Commit**

```bash
git add packages/agent/src/extractor.ts
git -c skill.commit=true commit -m "fix(agent): extractor mapea 'sin preferencia'→indiferente y 'anillo de compromiso'→gema_tallada/regalo

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 5: Brief y redactor conscientes de foto, cercanía y anti-repetición

**Files:**
- Modify: `packages/types/src/compose.ts` (campos nuevos en `ComposeBrief`)
- Modify: `packages/agent/src/brief.ts` (propaga campos)
- Modify: `packages/agent/src/composer.ts` (render + prompt)
- Modify: `packages/agent/src/graph.ts` (pasa `hayExactas` al brief)
- Test: `packages/agent/src/__tests__/brief.test.ts` (render determinista)

**Interfaces:**
- Produces (`ComposeBrief` gana): `hayExactas?: boolean`, `yaPreguntado?: CampoCritico[]`, `piedrasMostradas?: string[]`, `resumen?: string`
- `buildComposeBrief` acepta esos campos y los copia al brief.

- [ ] **Step 1: Test de render (rojo)**

En `packages/agent/src/__tests__/brief.test.ts` añade (importa `renderBriefForPrompt` desde `../composer.js` si no está):

```ts
import { renderBriefForPrompt } from "../composer.js";

test("render incluye hayExactas, ya_preguntado, ya_mostrado y memoria", () => {
  const brief = buildComposeBrief({
    intent: "asesorar", userMessage: "de 10 quilates?", solicitud: { peso_quilates: { min: 10, max: 10 } },
    missing: ["proposito"], stones: [],
    hayExactas: false, yaPreguntado: ["color"], piedrasMostradas: ["Esmeralda X"], resumen: "Cliente busca 10ct.",
  });
  const txt = renderBriefForPrompt(brief);
  assert.match(txt, /match_exacto: no/);
  assert.match(txt, /ya_preguntado: color/);
  assert.match(txt, /ya_mostrado: Esmeralda X/);
  assert.match(txt, /memoria_conversacion: Cliente busca 10ct\./);
});
```

- [ ] **Step 2: Corre y verifica el rojo**

Run: `npx tsx --test packages/agent/src/__tests__/brief.test.ts`
Expected: FAIL (campos no existen / no se renderizan).

- [ ] **Step 3: Extiende el tipo `ComposeBrief`**

En `packages/types/src/compose.ts`, dentro de la interfaz, añade:
```ts
  /** true si alguna piedra cumple LITERALMENTE lo pedido; false → las stones son "lo más cercano". */
  hayExactas?: boolean;
  /** Campos ya preguntados en turnos anteriores; el redactor no debe repetirlos. */
  yaPreguntado?: CampoCritico[];
  /** Nombres de piedras ya mostradas; no re-mostrar la misma. */
  piedrasMostradas?: string[];
  /** Resumen rodante de la conversación (memoria ligera). */
  resumen?: string;
```

- [ ] **Step 4: Propaga en `buildComposeBrief`**

En `packages/agent/src/brief.ts`, añade al tipo de `input` los cuatro campos opcionales (mismas firmas) y al objeto devuelto:
```ts
    ...(input.hayExactas !== undefined ? { hayExactas: input.hayExactas } : {}),
    ...(input.yaPreguntado?.length ? { yaPreguntado: input.yaPreguntado } : {}),
    ...(input.piedrasMostradas?.length ? { piedrasMostradas: input.piedrasMostradas } : {}),
    ...(input.resumen ? { resumen: input.resumen } : {}),
```
Firma añadida al `input`:
```ts
  hayExactas?: boolean;
  yaPreguntado?: CampoCritico[];
  piedrasMostradas?: string[];
  resumen?: string;
```

- [ ] **Step 5: Render en `renderBriefForPrompt`**

En `packages/agent/src/composer.ts`, dentro del array de `renderBriefForPrompt` (antes de `historial_reciente`), añade líneas condicionales:
```ts
    b.hayExactas !== undefined ? `match_exacto: ${b.hayExactas ? "sí" : "no"}` : null,
    b.yaPreguntado?.length ? `ya_preguntado: ${b.yaPreguntado.join(", ")}` : null,
    b.piedrasMostradas?.length ? `ya_mostrado: ${b.piedrasMostradas.join(", ")}` : null,
    b.resumen ? `memoria_conversacion: ${b.resumen}` : null,
```
(Van dentro del `[...]` que ya usa `.filter(Boolean)`.)

- [ ] **Step 6: Ajusta el system prompt del redactor**

En `COMPOSE_SYSTEM_PROMPT` (`composer.ts`), añade tras el paso 4 (antes de "Fuente de los datos…") este bloque:
```ts
REGLAS DE PIEDRAS Y FOTO (críticas):
- El sistema ADJUNTA AUTOMÁTICAMENTE la foto de la PRIMERA piedra de piedras_que_encajan. Cuando haya al menos una piedra, NUNCA digas que no tienes imágenes: preséntala como "te la comparto" / "aquí la tienes". Solo si piedras_que_encajan está vacío puedes decir que aún no tienes una imagen para ese pedido y pedir un dato para buscar.
- Si match_exacto=no, sé honesta: no tienes exactamente lo pedido, PERO muestra la más cercana de piedras_que_encajan con su precio y qué la acerca ("no tengo justo 10 ct en ese presupuesto; lo más cercano que sí tengo es…").
- Ante "¿cuál me recomiendas?" propón UNA piedra concreta POR SU NOMBRE de piedras_que_encajan, con origen/quilates/precio. Nunca respondas una recomendación con otra pregunta.
- No vuelvas a preguntar nada que esté en ya_preguntado. No vuelvas a presentar como novedad una piedra que esté en ya_mostrado.
```
Y en la regla del intent `"asesorar"` (línea 29), cambia el final para no forzar pregunta:
```ts
- "asesorar": ya hay algo que mostrar. Presenta/《refuerza》la mejor piedra que encaja (nombre, origen, quilates, precio total), responde dudas y propón el siguiente paso (ver la foto, cotizar, afinar). Puedes cerrar con una pregunta breve solo si aporta; no es obligatorio.
```

- [ ] **Step 7: Pasa `hayExactas` desde el grafo**

En `packages/agent/src/graph.ts` `responderNode`, en la llamada a `buildComposeBrief`, añade `hayExactas,` (elimina el `void hayExactas;` temporal de Task 2).

- [ ] **Step 8: Corre los tests**

Run: `npm test -w @iris/agent && npm test -w @iris/types`
Expected: PASS (incluido el nuevo test de render).

- [ ] **Step 9: Commit**

```bash
git add packages/types/src/compose.ts packages/agent/src/brief.ts packages/agent/src/composer.ts packages/agent/src/graph.ts packages/agent/src/__tests__/brief.test.ts
git -c skill.commit=true commit -m "feat(agent): redactor consciente de foto/cercanía y anti-repetición

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 6: Memoria ligera — trackers deterministas (preguntadas / piedras_mostradas)

**Files:**
- Modify: `packages/agent/src/state.ts` (canales union)
- Modify: `packages/agent/src/graph.ts` (`responderNode` registra y consume)
- Test: `packages/agent/src/__tests__/graph.memoria.test.ts` (nuevo)

**Interfaces:**
- State gana: `preguntadas: CampoCritico[]`, `piedras_mostradas: string[]` (reducer de unión).
- `responderNode` prioriza `missing` por lo no-preguntado y devuelve los deltas.

- [ ] **Step 1: Test (rojo) — no re-pregunta a través de turnos**

Crea `packages/agent/src/__tests__/graph.memoria.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { MemorySaver } from "@langchain/langgraph";
import { runIris, type IrisDeps } from "../graph.js";
import type { ComposeBrief } from "@iris/types";

test("no repite un campo ya preguntado en turnos sucesivos", async () => {
  const briefs: ComposeBrief[] = [];
  const deps: IrisDeps = {
    extract: async () => ({}), // nunca completa → siempre aclarar
    saveLead: async () => ({ id: "x" }),
    notifySeller: async () => {},
    matchInventory: async () => ({ piedras: [], hayExactas: false }),
    compose: async (brief) => { briefs.push(brief); return "ok"; },
    checkpointer: new MemorySaver(),
  };
  await runIris(deps, { telegramUserId: 77, chatId: 77, text: "hola" });
  await runIris(deps, { telegramUserId: 77, chatId: 77, text: "sigo sin saber" });
  // El 1er campo priorizado del turno 2 debe diferir del preguntado en el turno 1.
  assert.equal(briefs.length, 2);
  assert.ok(briefs[1].yaPreguntado && briefs[1].yaPreguntado.length >= 1);
  assert.notEqual(briefs[1].missing[0], briefs[0].missing[0]);
});
```

- [ ] **Step 2: Corre y verifica el rojo**

Run: `npx tsx --test packages/agent/src/__tests__/graph.memoria.test.ts`
Expected: FAIL (`yaPreguntado` indefinido / no rota).

- [ ] **Step 3: Añade los canales al estado**

En `packages/agent/src/state.ts`, tras el helper `lastWrite`, añade:
```ts
const unionArr = <T>(def: T[]) => ({
  reducer: (p: T[], n: T[]) => Array.from(new Set([...(p ?? []), ...(n ?? [])])),
  default: () => def,
});
```
Y dentro de `Annotation.Root({...})`:
```ts
  preguntadas: Annotation<CampoCritico[]>(unionArr<CampoCritico>([])),
  piedras_mostradas: Annotation<string[]>(unionArr<string>([])),
  resumen: Annotation<string>(lastWrite("")),
```
(`resumen` se usa en Task 7; declararlo aquí evita un segundo cambio de estado.)

- [ ] **Step 4: `responderNode` registra y prioriza**

En `graph.ts` `responderNode`, antes de `buildComposeBrief`:
```ts
  const yaPreguntado = state.preguntadas;
  const target = state.camposFaltantes.find((c) => !yaPreguntado.includes(c)) ?? null;
  const missingPrioritizado = target
    ? [target, ...state.camposFaltantes.filter((c) => c !== target)]
    : state.camposFaltantes;
```
Pasa al brief `missing: missingPrioritizado`, `yaPreguntado`, `piedrasMostradas: state.piedras_mostradas`.
Y cambia el `return`:
```ts
  return {
    reply,
    mediaUrl: piedras[0]?.media_url ?? null,
    preguntadas: target ? [target] : [],
    piedras_mostradas: piedras.map((p) => p.nombre),
  };
```

- [ ] **Step 5: Corre y verifica el verde**

Run: `npx tsx --test packages/agent/src/__tests__/graph.memoria.test.ts && npm test -w @iris/agent`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/agent/src/state.ts packages/agent/src/graph.ts packages/agent/src/__tests__/graph.memoria.test.ts
git -c skill.commit=true commit -m "feat(agent): memoria ligera determinista (preguntadas + piedras_mostradas)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 7: Memoria ligera — resumen rodante (best-effort, no bloqueante)

**Files:**
- Modify: `packages/agent/src/graph.ts` (`IrisDeps.summarize?`, nodo/uso en `responderNode`, brief)
- Modify: `apps/web/src/app/api/telegram/webhook/route.ts` (cablea `summarize`)
- Modify: `scripts/eval-asesora.mjs` (cablea `summarize`)
- Test: `packages/agent/src/__tests__/graph.resumen.test.ts` (nuevo)

**Interfaces:**
- `IrisDeps.summarize?: (a: { previo: string; userMessage: string; reply: string }) => Promise<string>`
- `responderNode` actualiza `resumen` best-effort y lo pasa al brief.

- [ ] **Step 1: Test (rojo) — resumen persiste y no rompe si falla**

Crea `packages/agent/src/__tests__/graph.resumen.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { MemorySaver } from "@langchain/langgraph";
import { runIris, type IrisDeps } from "../graph.js";
import type { ComposeBrief } from "@iris/types";

test("el resumen del turno previo llega al brief del turno siguiente", async () => {
  const briefs: ComposeBrief[] = [];
  const cp = new MemorySaver();
  const deps: IrisDeps = {
    extract: async () => ({}),
    saveLead: async () => ({ id: "x" }),
    notifySeller: async () => {},
    matchInventory: async () => ({ piedras: [], hayExactas: false }),
    compose: async (b) => { briefs.push(b); return "ok"; },
    summarize: async ({ userMessage }) => `resumen tras: ${userMessage}`,
    checkpointer: cp,
  };
  await runIris(deps, { telegramUserId: 88, chatId: 88, text: "primero" });
  await runIris(deps, { telegramUserId: 88, chatId: 88, text: "segundo" });
  assert.equal(briefs[1].resumen, "resumen tras: primero");
});

test("si summarize lanza, la conversación continúa", async () => {
  const deps: IrisDeps = {
    extract: async () => ({}),
    saveLead: async () => ({ id: "x" }),
    notifySeller: async () => {},
    matchInventory: async () => ({ piedras: [], hayExactas: false }),
    compose: async () => "ok",
    summarize: async () => { throw new Error("boom"); },
    checkpointer: new MemorySaver(),
  };
  const out = await runIris(deps, { telegramUserId: 89, chatId: 89, text: "hola" });
  assert.equal(out.reply, "ok");
});
```

- [ ] **Step 2: Corre y verifica el rojo**

Run: `npx tsx --test packages/agent/src/__tests__/graph.resumen.test.ts`
Expected: FAIL (`summarize` no existe / `resumen` no se propaga).

- [ ] **Step 3: Implementa en `graph.ts`**

- Añade a `IrisDeps`:
```ts
  /** Opcional: actualiza el resumen rodante (best-effort). Si falta o falla, se conserva el previo. */
  summarize?: (a: { previo: string; userMessage: string; reply: string }) => Promise<string>;
```
- En `responderNode`, pasa `resumen: state.resumen` al `buildComposeBrief`.
- Tras calcular `reply`, actualiza el resumen best-effort y añádelo al `return`:
```ts
  let resumen = state.resumen;
  if (deps.summarize) {
    try {
      resumen = await deps.summarize({ previo: state.resumen, userMessage: state.inputText, reply });
    } catch (err) {
      console.error("[iris] summarize falló, conservo resumen previo:", err);
    }
  }
```
  y en el objeto de retorno añade `resumen,`.

  **Importante:** el brief del turno actual usa `state.resumen` (el previo), y el nuevo `resumen` se persiste para el turno siguiente — así el test "llega al brief del turno siguiente" pasa.

- [ ] **Step 4: Cablea en el webhook y el eval**

- `apps/web/.../webhook/route.ts`, dentro de `deps`, añade (usando el modelo barato ya disponible `model`):
```ts
    summarize: async ({ previo, userMessage, reply }) => {
      const res = await model.invoke([
        { role: "system", content: "Actualiza en 2-4 frases el resumen de una conversación de venta de esmeraldas: qué pidió el cliente, qué se le mostró, sus preferencias y el próximo paso. Devuelve solo el resumen." },
        { role: "user", content: `Resumen previo: ${previo || "(vacío)"}\nCliente dijo: ${userMessage}\nIris respondió: ${reply}` },
      ]);
      return typeof res.content === "string" ? res.content.trim() : String(res.content ?? "").trim();
    },
```
- `scripts/eval-asesora.mjs`: añade una `summarize` análoga usando `model` en el objeto `deps` de `nuevaSesion` (mismo prompt).

- [ ] **Step 5: Corre los tests**

Run: `npm test -w @iris/agent`
Expected: PASS (ambos tests de resumen + no-regresión).

- [ ] **Step 6: Commit**

```bash
git add packages/agent/src/graph.ts apps/web/src/app/api/telegram/webhook/route.ts scripts/eval-asesora.mjs packages/agent/src/__tests__/graph.resumen.test.ts
git -c skill.commit=true commit -m "feat(agent): resumen rodante best-effort (memoria ligera narrativa)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 8: Verificación EN VIVO (harness LLM real) — escenario Chat5

Reproduce el caso real y confirma comportamiento con LLM+DB reales. **Esta es la aceptación.**

**Files:**
- Modify: `scripts/eval-asesora.mjs` (stock realista con `media_url` + escenario Chat5)

- [ ] **Step 1: Añade stock realista y el escenario Chat5**

En `scripts/eval-asesora.mjs`, extiende `STOCK` con piedras que reflejen el rango del caso (incluyen `media_url` no vacío) y añade un escenario:

```js
// Stock realista (subset del inventario prod, con foto).
STOCK.push(
  { id: "3", nombre: "Cushion 6.72 ct - 440 usd-ct", forma: "cojin", peso_ct: 6.72,
    precio_usd_ct: 440, cantidad_piedras: 1, media_url: "https://example.com/cush672.jpg",
    disponible: true, notas: null, color: null, origen: null, claridad: null, tratamiento: null },
  { id: "4", nombre: "Esmeralda cuadrada 9.04 ct - 4.300 usd-ct", forma: "corte_esmeralda", peso_ct: 9.04,
    precio_usd_ct: 4300, cantidad_piedras: 1, media_url: "https://example.com/sq904.jpg",
    disponible: true, notas: null, color: null, origen: null, claridad: null, tratamiento: null },
  { id: "5", nombre: "Lote 4 esmeraldas 8.82 ct - 1.500 usd-ct", forma: "corte_esmeralda", peso_ct: 8.82,
    precio_usd_ct: 1500, cantidad_piedras: 4, media_url: "https://example.com/lote882.jpg",
    disponible: true, notas: null, color: null, origen: null, claridad: null, tratamiento: null },
);

escenarios.push({
  titulo: "6) Chat5: pide fotos 5-6ct → 2000USD colombiana → sin tono → 10ct (debe MOSTRAR piedra+foto, sin loop)",
  turnos: [
    "Hola buenas noches, estoy buscando una esmeralda de unos 5 a 6 quilates para un anillo de compromiso, tienes imágenes que me puedas compartir?",
    "De unos 2000 USD y solo me importa que sea colombiana la procedencia",
    "No tengo ninguna preferencia en tono",
    "O cual me puedes recomendar tú con ese presupuesto?",
    "Si exploremoslas si tienes alguna de 10 quilates que me puedas mostrar me agradaría",
  ],
});
```
Además, imprime `mediaUrl` por turno: en el `console.log` del turno agrega `${out.mediaUrl ? "  📷 " + out.mediaUrl : "  (sin foto)"}`.

- [ ] **Step 2: Corre el harness en vivo**

Run: `npx tsx --env-file=apps/web/.env scripts/eval-asesora.mjs`
Expected (aserciones a verificar a ojo sobre el output del escenario 6):
1. **Foto:** en el turno 1 y/o siguientes, `out.mediaUrl` NO es null y aparece "📷" — Iris ofrece una piedra concreta y NO dice "no tengo imágenes".
2. **Sin loop:** ya en el turno 1-2 presenta piedra(s) cercana(s) (6.21/6.72/…); no se queda solo preguntando.
3. **No re-pregunta:** tras "No tengo preferencia en tono", en turnos posteriores NO vuelve a preguntar por el color/tono.
4. **Recomendación concreta:** ante "¿cuál me recomiendas?" nombra una piedra específica con precio.
5. **Escenarios 1-5 intactos** (regresión del clasificador): (1) sin cierre en turnos largos; (2) educa el jardín; (3) profunda=true; (4) handoff=true + «HANDOFF»; (5) responde en inglés.

- [ ] **Step 3: Si algún criterio falla, depurar (no avanzar)**

Aplica systematic-debugging sobre el punto que falle (p. ej. si el extractor aún no mapea "sin preferencia", revisar Task 4; si no muestra foto, revisar que `matchInventory` devuelva piedras con `media_url` y que el prompt de Task 5 esté activo). Re-correr hasta cumplir los 5 criterios.

- [ ] **Step 4: Suite completa + type-check**

Run: `npm test && npx tsc --noEmit -p packages/agent && npx tsc --noEmit -p packages/db`
Expected: todo verde.

- [ ] **Step 5: Commit**

```bash
git add scripts/eval-asesora.mjs
git -c skill.commit=true commit -m "test(agent): harness en vivo del escenario Chat5 (foto + sin loop + sin re-preguntar)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Self-Review

**1. Cobertura del spec:**
- Sección 1 (matcher cercanía + hayExactas) → Tasks 1, 2. ✓
- Sección 2 (relajar gate + válvula + "sin preferencia" + "anillo de compromiso") → Tasks 3, 4. ✓
- Sección 3 (redactor honesto/foto/cercanía/recomendación concreta) → Task 5. ✓
- Sección 4 (memoria ligera: trackers deterministas + rolling summary) → Tasks 6, 7. ✓
- Sección 5 (unit tests + harness LLM en vivo + re-verificar flags) → Tasks 1-7 (unit) + Task 8 (vivo). ✓
- No-objetivos (pgvector, poblar origen/color) → NO hay tarea. ✓ (correcto, fuera de alcance)

**2. Placeholders:** ninguno; los cambios de prompt incluyen el texto exacto; el código de las tareas deterministas está completo.

**3. Consistencia de tipos:**
- `matchInventory` → `Promise<{ piedras: Piedra[]; hayExactas: boolean }>` usado igual en Task 2 (graph, media test, webhook, eval). ✓
- `decideBriefIntent` firma idéntica en Task 3 (def + test + uso). ✓
- Campos de `ComposeBrief` (`hayExactas`, `yaPreguntado`, `piedrasMostradas`, `resumen`) declarados en Task 5 y consumidos en render (Task 5), grafo (Tasks 5-7). ✓
- Canales de estado (`preguntadas`, `piedras_mostradas`, `resumen`) declarados en Task 6 y usados en Tasks 6-7. ✓

**Nota de dependencia entre tareas:** Task 2 introduce `hayExactas` en `responderNode` (temporal `void`), consumido en Task 5; Task 6 declara `resumen` en el estado, usado en Task 7. Ejecutar en orden.

---

## Execution Handoff

Plan completo y guardado en `docs/superpowers/plans/2026-07-06-iris-matcher-cercania-memoria.md`. Dos opciones de ejecución:

1. **Subagent-Driven (recomendado)** — despacho un subagente fresco por tarea, reviso entre tareas, iteración rápida.
2. **Inline Execution** — ejecuto las tareas en esta sesión con checkpoints de revisión.

¿Cuál prefieres?
