# Iris asesora conversacional bilingüe con voz Méraldi — Diseño

- **Fecha:** 2026-07-05
- **Estado:** aprobado para plan
- **Autores:** Julio Zorro + Claude
- **Perfil de voz fuente:** [`docs/meraldi/voz-perfil-chats-reales.md`](../../meraldi/voz-perfil-chats-reales.md)

## Problema

Dos problemas independientes reportados sobre Iris (el agente de Méraldi):

1. **Cierre abrupto / "redirige al asesor".** Las conversaciones se cortan y toda pregunta
   posterior termina en "un asesor de Méraldi te contactará", aun cuando el cliente solo
   quiere seguir preguntando sobre esmeraldas.
2. **Conocimiento limitado.** La sabiduría de esmeraldas es `GUIA_HECHOS` (~23 líneas
   destiladas a mano). Se quiere incorporar `BIBLIA_COMPLETA.md` (16 módulos, ~35k tokens).

### Causa raíz del problema 1 (verificada en código)

En `packages/agent/src/graph.ts`, `route()` manda la conversación a `persistir` cuando
`estado === "completo"` **o** `rondas >= MAX_RONDAS` (4). `rondas` **se acumula** (+1 por
turno; reducer en `state.ts`). Consecuencias:
- Con el lead `completo`, **todos** los turnos siguientes vuelven a `persistir`, que redacta
  con `intent: "cerrar"` + `cierre: "completo"` — justo el caso donde el prompt del redactor
  autoriza "un asesor te contactará". De ahí el redireccionamiento perpetuo.
- Aun incompleto, al 4º turno se fuerza `persistir` → cierre abrupto.

El grafo se diseñó como **embudo de captura de lead de un disparo**, no como asesora que
conversa. **Ningún cambio de conocimiento (ni RAG) arregla esto**; es un bug de routing.

## Decisiones (tomadas con el usuario)

| Tema | Decisión |
|---|---|
| Modo post-captura | Iris **conversa libremente** (precio, dudas, más piedras); entrega a un humano **solo** cuando el cliente quiere comprar/pagar o pide certificado GIA / joya a medida. Nunca corta por nº de rondas. |
| Idioma | **Bilingüe con autodetección** (español / inglés) por mensaje. |
| Enfoque de conocimiento | **A — Guía curada + fallback a biblia completa, SIN RAG.** RAG (pgvector) queda como Fase 2. |
| Notificación al vendedor | **Dos momentos:** al capturar el lead + cuando el cliente quiere cerrar (aviso distinto). |
| Trigger de "pregunta profunda" | **Clasificador barato fusionado en la llamada de extracción** (una sola pasada, sin latencia extra). |

## Arquitectura

### 1. Refactor del grafo (arregla el cierre abrupto)

**Actual:** `extractor → validador → route(preguntar|persistir) → END`.

**Nuevo — flujo lineal, el branching vive dentro de los nodos (por valor de `intent`), no en aristas:**

```
START → extractor → validador → efectos → responder → END
```

- **`extractor` (modificado):** una sola llamada estructurada que devuelve `Solicitud`
  **+ un bloque `intent`** con dos flags:
  - `handoff: boolean` — el cliente quiere comprar/pagar, o pide certificado GIA /
    internacional, joya a medida / montaje, o coordinar envío/pago.
  - `preguntaProfunda: boolean` — pregunta gemológica de cola larga que la GUÍA curada no
    cubre.
  Se implementa con un schema wrapper (`ExtraccionSchema = { solicitud, intent }`) para no
  contaminar `SolicitudSchema`. La extracción sigue siendo **dependencia inyectable**; su
  firma pasa a devolver `{ solicitud, intent }` (con `intent` opcional/`default` para tests).
- **`validador` (sin cambios):** calcula `estado` / `camposFaltantes`.
- **`efectos` (era `persistir`; ahora idempotente y SIN redactar):**
  - Upsert del lead cada turno (estado más reciente).
  - `notifySeller` **una sola vez** al primer guardado, controlado por un flag persistido en
    el state (`vendedorNotificado`, reducer last-write, vive en el checkpointer por
    `thread_id`).
  - Si `intent.handoff`, envía una notificación **distinta** ("cliente quiere cerrar:
    …"), controlada por su propio flag (`handoffNotificado`) para no repetir.
  - **Persistencia/efectos van ANTES del redactor** (un fallo del LLM no debe saltarlos).
- **`responder` (redactor, único que redacta):** siempre produce la respuesta al cliente.
  El `intent` del `ComposeBrief` refleja la fase:
  - `aclarar` — aún faltan campos críticos → responde dudas + pide 1 dato (máx 2).
  - `asesorar` — lead completo → responde/educa/muestra piedras/propone siguiente paso,
    **sin cerrar ni derivar**.
  - `handoff` — avisa con calidez que un asesor humano finaliza la compra/certificado/joya.
- **`MAX_RONDAS` deja de ser router.** `rondas` se conserva solo como telemetría. Esto
  elimina la guillotina.

**Estado nuevo (`state.ts`):** añadir `intent` (last-write), `vendedorNotificado` (bool
last-write, default false), `handoffNotificado` (bool last-write, default false), `fase`
derivable (`captando` | `asesorando`) — o inferida de `camposFaltantes.length`.

### 2. Conocimiento en dos niveles (Enfoque A)

- **`guia.ts` (nivel 1):** reemplazar `GUIA_HECHOS` por **GUÍA MÉRALDI curada y bilingüe
  (~3-5k tokens)**, destilada de `BIBLIA_COMPLETA.md` por temas comunes del comprador:
  las 6 variables, precio, tratamiento/aceite/perma, jardín/inclusiones, origen (Muzo,
  Chivor, Coscuez, La Pita, Gachalá; comparación Zambia/Brasil), certificación GIA/local,
  valorización con honestidad, cuidado, identidad de casa colombiana. Siempre en el prompt.
  La destilación se genera con un subagente a partir de las secciones FAQ/mitos/"voz Méraldi"
  de la biblia y se revisa a mano.
- **Biblia completa (nivel 2):** `BIBLIA_COMPLETA.md` entra al repo como
  `packages/agent/src/knowledge/biblia.ts` (string exportado — mismo patrón que `guia.ts`,
  seguro en Vercel serverless, sin `fs` en runtime). Se **inyecta en el prompt del redactor
  solo cuando `intent.preguntaProfunda === true`**.
- **Sin pgvector, sin embeddings, sin ingestión.**

### 3. Voz Méraldi

- Nueva sección **VOZ** en `COMPOSE_SYSTEM_PROMPT`, bilingüe, destilada del perfil
  (`docs/meraldi/voz-perfil-chats-reales.md`): cálida y de par a par; precio directo anclado
  a calidad/origen; **origen como gancho** al presentar piedra; burbujas cortas;
  colombianismos en español; emojis moderados; objeción de precio → alternativa o valor,
  nunca defender ni inventar descuentos.
- **Few-shot** con un puñado de frases-oro bilingües como anclas de estilo.
- **Autodetección de idioma:** el redactor responde en el idioma del `cliente_dijo`; la GUÍA
  y las reglas se expresan de forma que funcionen en ambos idiomas.
- **Guardarraíl (se preserva el actual):** Iris solo usa datos del brief/inventario; NUNCA
  inventa precios, piedras, orígenes, quilates, descuentos ni disponibilidad. Adopta el tono
  y la estructura, no la libertad de improvisar cifras. Las reglas de honestidad actuales
  (valorización, precio de la joya terminada, fuera de catálogo) se mantienen.

### 4. Handoff

- El flag `intent.handoff` (de la extracción) dispara: (a) notificación distinta al vendedor
  en `efectos`, y (b) `intent: "handoff"` en el brief → el redactor avisa con calidez que un
  asesor humano finaliza. Se mantiene la mención "asesor" también cuando el cliente pide
  explícitamente hablar con una persona.

## Componentes y contratos

| Unidad | Qué hace | Depende de |
|---|---|---|
| `extractor.ts` | Extrae `Solicitud` + `intent` en una llamada estructurada | modelo estructurado, `ExtraccionSchema` |
| `guia.ts` | Exporta `GUIA_MERALDI` (curada, bilingüe) | — |
| `knowledge/biblia.ts` | Exporta `BIBLIA_COMPLETA` (string) | — |
| `composer.ts` | Redacta respuesta; incluye biblia si `preguntaProfunda`; aplica VOZ | GUÍA, biblia, brief |
| `graph.ts` | Orquesta `extractor→validador→efectos→responder`; notifica 1 vez | deps inyectables |
| `state.ts` | + `intent`, `vendedorNotificado`, `handoffNotificado` | — |

## Testing (cerebro determinista intacto)

- Clasificación de intención y fallback a biblia son **dependencias opcionales con fallback**:
  sin ellas, `intent` = `{handoff:false, preguntaProfunda:false}` y el grafo cae al camino
  determinista → la suite existente prueba no-regresión sin tocarse (salvo lo abajo).
- **Tests que cambian a propósito** (afirmaban el bug): los que esperan cierre tras
  `MAX_RONDAS` o derivación tras `completo`.
- **Tests nuevos:**
  - No hay cierre tras N (>4) turnos con lead incompleto.
  - Tras `completo`, el redactor recibe `intent: "asesorar"` (no `cerrar`) y no aparece la
    muletilla de asesor.
  - `intent.handoff` → notificación distinta al vendedor + `intent: "handoff"` en el brief.
  - `notifySeller` se llama **una sola vez** a lo largo de varios turnos.
  - `intent.preguntaProfunda` → el prompt del redactor incluye la biblia; si es false, no.
  - Autodetección: mensaje en inglés → respuesta en inglés (con modelo real, en harness).
- **Smoke-run obligatorio** de cualquier script nuevo (`node --check` / import dry-run) antes
  de darlo por bueno — un script committeado pero nunca corrido es código no verificado.

## Fuera de alcance (YAGNI)

- RAG / pgvector / embeddings (Fase 2 si crece la biblia o el volumen de cola larga).
- Pagos in-bot (USDT/tarjeta) — eso es handoff a humano.
- Re-arquitectura del inventario o del match.

## Riesgos

- **Fusionar `intent` en la extracción** puede degradar la calidad de extracción de
  `Solicitud`. Mitigación: schema wrapper claro + prompt separado por sección; validar con el
  harness de conversaciones.
- **GUÍA curada incompleta** deja pasar preguntas comunes al fallback (más costo). Mitigación:
  derivar la GUÍA de las FAQ reales de la biblia; iterar con el harness.
- **Biblia como string de 137KB** infla el bundle. Aceptable; se carga solo cuando se usa.

## Plan de implementación

Se detalla con la skill `writing-plans` tras aprobación de este spec.
