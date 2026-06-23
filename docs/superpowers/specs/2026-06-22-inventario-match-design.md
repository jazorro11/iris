# Inventario de esmeraldas + match en Iris — Diseño

Fecha: 2026-06-22
Estado: aprobado (pendiente plan de implementación)

## Objetivo

Méraldi mantiene un inventario de esmeraldas que cambia constantemente. Iris (el bot
de Telegram) ya captura una `Solicitud` del comprador. Queremos que, cuando la
solicitud coincida con piedras en stock, Iris **proponga una o varias piedras**.

## Principio rector (ponytail)

Cero tecnología nueva. Se reusa Supabase (Postgres) que ya corre en Vercel, los
mismos enums del bot, y el **Table Editor de Supabase** para la edición no técnica.
Sin vector DB, sin admin custom, sin leer Google Drive en vivo. 14 ítems es un `WHERE`.

## Datos disponibles

El inventario inicial son 14 carpetas; el **nombre de carpeta es el dato**. Cada
nombre codifica de forma confiable solo: forma, peso (ct), precio (usd/ct) y si es
pieza única / pareja / lote. El resto de atributos que el bot pregunta (color exacto,
origen, claridad, tratamiento) **no** están en el inventario.

Decisión: el match se hace solo sobre **forma + peso + precio/ct**. Los demás datos
del comprador se usan para conversar, no para filtrar. Enriquecer por piedra queda
para cuando existan los datos reales.

## 1. Tabla `inventario` (Supabase)

Una fila por ítem.

| Campo | Tipo | Nota |
|---|---|---|
| `id` | uuid pk | default `gen_random_uuid()` |
| `nombre` | text not null | ej. "Cuadrada 0.88 ct - 5.100 usd-ct" |
| `forma` | text not null | mismo dominio que `corte.forma` del bot: `corte_esmeralda`, `oval`, `cojin`, `gota`, `redondo`, `otro` |
| `peso_ct` | numeric not null | ej. 0.88 |
| `precio_usd_ct` | numeric not null | ej. 5100 (USD por quilate) |
| `cantidad_piedras` | int not null default 1 | 1 = única, 2 = pareja, N = lote |
| `media_url` | text null | link a la carpeta de Drive |
| `disponible` | boolean not null default true | "sale" del stock sin borrar la fila |
| `notas` | text null | hueco para color/origen si algún día se enriquece |
| `created_at` | timestamptz default now() | |
| `updated_at` | timestamptz default now() | |

`forma` se deja como `text` (no enum de Postgres) para no acoplar la migración al
enum de la app; la validación de dominio vive en `@iris/types`. Índice por
`(disponible, forma)` para el match.

### Mapeo de nombre → fila (parser de carga inicial)

- Forma: "Cuadrada" / "Esmeralda" / "Esmeralda cuadrada" → `corte_esmeralda`;
  "Cushion"/"cushions" → `cojin`; "Redonda" → `redondo`; "Corazones" → `otro`
  (el enum del comprador no tiene "corazón", así que no es pedible de forma específica).
- Peso: el número antes de `ct` (ej. `12.24 ct`). En lotes/parejas es el peso **total**.
- Precio: el número antes de `usd-ct` / `-ct`. El separador `.` es de miles
  (`5.100` → 5100, `27.000` → 27000, `440` → 440).
- Cantidad: "Pareja…" → 2; "Lote N piedras…" / "Lote N esmeraldas…" → N; resto → 1.

## 2. Match — `matchInventory(solicitud) -> Piedra[]`

Vive en `@iris/db` (query) con la lógica de filtros, consumida por el agente.
Un solo query sobre `inventario` con `disponible = true`:

- **forma**: si `solicitud.corte.forma` está y ≠ `indiferente` → debe coincidir.
- **peso**: si hay `peso_quilates.min`/`.max` → `peso_ct` dentro del rango (límites abiertos si falta uno).
- **precio**:
  - si `presupuesto.base = por_quilate` → `precio_usd_ct` dentro de `[min, max]`.
  - si `presupuesto.base = total` y hay peso → comparar `precio_usd_ct * peso_ct` contra `[min, max]`.
  - sin presupuesto → no se filtra por precio.

Si el comprador no dio un dato, ese filtro se omite (no descarta piedras).
Devuelve hasta **3**, ordenadas por `precio_usd_ct` ascendente.

## 3. Enganche en el grafo del agente

En `persistirNode` (final del turno; cubre `completo` y `incompleto` por MAX_RONDAS):

1. `const matches = await deps.matchInventory(state.solicitud)`.
2. Si `matches.length > 0`: anexar al `reply` un bloque "Tengo estas piedras que
   podrían encajar: …" (nombre, peso, precio/ct, link si hay) y anexar al
   `buildSellerSummary`. Si no hay matches, el mensaje actual queda igual.

`matchInventory` es una `dep` nueva en `IrisDeps`, inyectada igual que `extract`,
`saveLead`, `notifySeller`. En tests se inyecta una versión fake.

## 4. Edición (persona no técnica)

**Table Editor de Supabase** (UI tipo hoja de cálculo, ya existe). Flujo: subir
media a Drive como hoy → pegar el link en `media_url` → llenar forma/peso/precio →
marcar `disponible = false` cuando se venda. No se construye admin ahora.

## 5. Carga inicial

Script/SQL idempotente con las 14 piedras parseadas de los nombres de carpeta
(mismo estilo que `scripts/` existentes). `media_url` apunta al link de Drive que
provea el usuario, o `null` si aún no lo tiene.

## 6. Verificación

Tests unitarios:
- `matchInventory`: dado un set de piedras y una solicitud, devuelve las correctas
  (coincidencia de forma, rango de peso, rango de precio por_quilate y total, omisión
  de filtros ausentes, límite 3, orden).
- parser de nombre → fila (forma, peso, precio con separador de miles, cantidad).

## Fuera de alcance (y cuándo agregarlo)

- Admin custom → cuando el Table Editor genere fricción real.
- Enriquecer color/origen/claridad/tratamiento por piedra → cuando existan los datos.
- Búsqueda semántica / embeddings → probablemente nunca.
