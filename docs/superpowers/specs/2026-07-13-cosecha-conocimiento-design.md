# Diseño — Cosecha de conocimiento real del dueño de Meraldi

**Fecha:** 2026-07-13
**Estado:** Aprobado (brainstorming). Pendiente: plan de implementación.
**Branch de trabajo:** `fix/iris-matcher-cercania-memoria` (crear branch propio para la implementación).

## 1. Problema y objetivo

Iris (el agente vendedor de Meraldi por Telegram) responde bien, pero su conocimiento
(biblia, tono, manejo de objeciones, comportamiento de precio) no está anclado en cómo
vende de verdad el dueño. El dueño **consintió y propuso** recibir "compradores de práctica"
para facilitar feedback.

**Objetivo:** un sistema que se hace pasar por compradores (personas ancladas en chats reales)
y le escribe al **dueño humano real** por Telegram, de forma autónoma turn-by-turn, para
**cosechar sus respuestas reales** como verdad-de-terreno.

**Output #1:** un **golden dataset estructurado** (par `mensaje_comprador → respuesta_dueño`).
De ese dataset se destilan después (curado manual) biblia, playbook de precio/objeciones y tono.
El dataset es el activo medible con Langfuse; lo demás se re-deriva de él.

## 2. Decisiones fijadas (del grill)

| # | Decisión | Valor |
|---|----------|-------|
| Propósito | Cosechar conocimiento real del dueño (no eval adversarial del bot) |
| Consentimiento | Dueño al tanto y de acuerdo (él lo propuso) |
| Canal / modo | Telegram, en vivo turn-by-turn |
| Dónde vive / timing | `apps/web` event-driven; el dueño responde disperso (no sesiones sincrónicas) |
| Output #1 | Golden dataset estructurado; biblia/playbook/tono se destilan después |
| Autonomía | Autónomo + guardrails (sin human-in-the-loop por turno) |
| Personas | 6 arquetipos anclados en chats reales; **1 conversación activa a la vez**; disparo manual |
| Langfuse | 4 capas (tracing cosecha, dataset, eval de Iris, tracing producción); cloud para arrancar |
| Modelo comprador | OpenRouter (`createChatModel`), reusando infra de Iris |
| "Tools del flujo" | (A) doc de recomendaciones de tools de Iris, **data-driven post-cosecha**; (B) plomería interna del build |
| MAX_TURNOS | **10** turnos-comprador por conversación |

## 3. Arquitectura — cerebro puro + transporte

Separación estricta: el **cerebro** no sabe de Telegram ni de HTTP; el **transporte** solo traduce.

```
Dueño (Telegram) ──▶ /api/harvest/webhook (transporte, apps/web)
                          │  carga estado (Supabase)
                          ▼
                   packages/harvest (cerebro puro)
                     ├─ personaEngine: (persona, historial) → siguiente turno | {fin:true}
                     ├─ guardrails: (historial, config) → {continuar|detener, motivo}
                     └─ harvester: (turno-comprador, respuesta-dueño, ctx) → registro de dataset
                          │
              ┌───────────┼───────────────┐
              ▼           ▼                ▼
        Supabase     Telegram out     Langfuse (trace + dataset)
       (estado+oro)  (sig. turno)
```

**Unidades y sus contratos:**

- **`personaEngine`** — dado `(persona, historial)` devuelve texto del siguiente turno-comprador
  o `{ fin: true }`. Depende solo del LLM (OpenRouter). Respeta idioma de la persona.
- **`guardrails`** — función **pura** sobre `(historial, config)` → `{ accion: "continuar"|"detener", motivo }`.
  Sin dependencias externas. Unit-testeable.
- **`harvester`** — dado `(turno-comprador, respuesta-dueño, contexto)` → registro estructurado
  de dataset con `veta` clasificada. Depende del LLM para clasificar/estructurar.
- **transporte web** — I/O puro: valida, carga/guarda estado, Telegram in/out, dispara cerebro.

**Enfoque elegido:** cerebro como paquete `packages/harvest` (testeable sin red) + transporte
en `apps/web`. Si algún día se quiere CLI o WhatsApp, solo cambia el transporte.

## 4. Modelo de datos

Tablas nuevas en Supabase, prefijo `harvest_`, aisladas de `leads`/`lead_messages` de producción.

**`harvest_conversations`** — una fila por conversación.
`id`, `persona_key`, `estado` (`activa` | `terminada` | `detenida`), `turno_actual`,
`motivo_fin`, `owner_chat_id`, `created_at`, `updated_at`.

**`harvest_messages`** — cada mensaje del thread.
`id`, `conversation_id`, `rol` (`comprador` | `dueño`), `texto`, `turno`, `created_at`.

**`harvest_dataset`** — el oro (output #1).
`id`, `conversation_id`, `persona_key`, `turno`, `mensaje_comprador`, `respuesta_dueño`,
`contexto_previo` (resumen del thread hasta ahí), `veta` (`precio` | `objecion` | `producto` | `tono` | `otro`),
`notas_extraccion`, `langfuse_dataset_item_id`, `created_at`.

`harvest_dataset` es la **fuente de verdad local**; se espeja a Langfuse Datasets (capa 2).
Si Langfuse cae, no se pierde nada.

**Idempotencia:** tabla/columna para registrar `update_id` de Telegram procesados, para que un
reintento de webhook no genere turno duplicado.

## 5. Las 6 personas

Cada persona es un script parametrizado (`packages/harvest/src/personas.ts`):
`{ key, objetivo, presupuesto, nivelConocimiento, primerMensaje, objeciones[], idioma }`.
El `personaEngine` las convierte en system-prompt.

| key | Arquetipo | Ancla | Objeciones que fuerza |
|-----|-----------|-------|------------------------|
| `inversionista` | Compra para valorización | Chat2 | "¿se revaloriza?", "¿mejor precio?", "¿pieza total?" |
| `novata_anillo` | Anillo compromiso, sabe poco | C1/Chat5 | "no sé qué me queda", "¿qué son quilates?", pide fotos |
| `cazador_ganga` | Presupuesto duro, regatea | Chat5 | "solo 2000 USD", "está caro", "¿descuento?" |
| `tecnico` | Datos duros | escenario 3 | tratamiento, Muzo vs Coscuez, certificado, jardín |
| `turista_en` | Escribe en inglés | escenario 5 | "is it natural?", "can you ship?", "certificate?" |
| `apurado_cierre` | Quiere comprar YA | escenario 4 | "quiero pagar", "¿cómo transfiero?", "¿me lo guardas?" |

## 6. Flujo event-driven

**Disparo (manual por el operador):** `scripts/cosechar-iniciar.mts <persona_key>`.
Crea `harvest_conversations` (estado `activa`), genera el `primerMensaje` de la persona y lo
envía al dueño por el bot dedicado. **Si ya hay una conversación `activa`, se rehúsa** (concurrencia = 1).

**Cada respuesta del dueño (el evento):**
```
POST /api/harvest/webhook
  1. valida secret + que el chat sea OWNER_HARVEST_CHAT_ID
  2. registra update_id (idempotencia); si ya visto → 200 sin efecto
  3. localiza la conversación activa; si no hay → ignora (200)
  4. guarda harvest_messages(rol=dueño)
  5. harvester: estructura el par (turno-comprador previo → esta respuesta)
       → harvest_dataset + espejo Langfuse
  6. guardrails(historial, config) → ¿continuar?
       detener → marca terminada/detenida, avisa al operador, END
  7. personaEngine(persona, historial) → siguiente turno | {fin:true}
       fin → cierre cortés ("gracias, lo pienso y te escribo")
  8. guarda harvest_messages(rol=comprador), (delay), envía al dueño, turno++
```
La request nunca espera al humano: procesa un turno y responde `200`. El siguiente turno llega
con el siguiente webhook.

## 7. Guardrails

- **Tope de turnos:** máx **10** turnos-comprador por conversación → cierre natural.
- **Stop-words del dueño:** `pausa`, `para`, `¿eres un bot?`, `basta` (regex configurable) →
  detiene, marca `detenida`, avisa al operador por Telegram.
- **Kill-switch global:** `scripts/cosechar-detener.mts` marca toda conversación activa como
  `detenida` y opcionalmente manda cierre cortés al dueño.
- **Anti-spam / ritmo:** event-driven garantiza no mandar dos turnos sin respuesta; `RESPONSE_DELAY_MS`
  mínimo para no sonar robótico-instantáneo.
- **Idempotencia:** por `update_id`.

**Config central** (`packages/harvest/src/config.ts`): `MAX_TURNOS=10`, `STOP_WORDS`,
`RESPONSE_DELAY_MS`; envs `HARVEST_BOT_TOKEN`, `HARVEST_WEBHOOK_SECRET`, `OWNER_HARVEST_CHAT_ID`.

## 8. Langfuse — 4 capas

Módulo `packages/harvest/src/observability.ts` crea el cliente desde envs
(`LANGFUSE_PUBLIC_KEY`, `LANGFUSE_SECRET_KEY`, `LANGFUSE_HOST`). **Sin keys → no-op**; la cosecha
no depende de Langfuse para funcionar. Cloud para arrancar; migrar a self-hosted = cambiar `LANGFUSE_HOST`.

- **Capa 1 — Tracing de cosecha (Entrega 1):** cada turno de `personaEngine` y `harvester`
  envuelto en trace con metadata (`persona_key`, `turno`, `conversation_id`).
- **Capa 2 — Dataset (Entrega 1):** cada fila de `harvest_dataset` se upsertea como dataset item
  en `meraldi-golden-v1`: `input = {mensaje_comprador, contexto_previo}`,
  `expected_output = respuesta_dueño`, `metadata = {persona_key, veta, conversation_id}`.
- **Capa 4 — Tracing de producción (activar de una):** `CallbackHandler` de Langfuse en el
  webhook de Iris (`webhook/route.ts`), tras la misma env-guard. Sin cambio de lógica.
- **Capa 3 — Eval de Iris (Entrega 2):** ver §9.

## 9. Eval-runner (Entrega 2)

`scripts/eval-iris-vs-oro.mts`:
```
por cada item de meraldi-golden-v1:
  1. reconstruye contexto y corre Iris (runIris con fakeDb + MemorySaver, estilo eval-asesora)
  2. captura reply de Iris  vs  expected_output (respuesta real del dueño)
  3. puntúa y sube scores a Langfuse:
     • fidelidad (LLM-as-judge, OpenRouter): ¿Iris cubre lo que dijo el dueño? 0-1
     • rúbrica determinista (reglas existentes):
         no-muletilla-indebida, educa-sin-prometer-rentabilidad,
         ofrece-alternativa, no-inventa-precio, idioma-correcto
     • agregación por `veta` (precio/objeción/producto/tono)
  4. reporte: tabla de brechas ordenada por veta
```
El **reporte de brechas por veta** es el insumo data-driven del documento de recomendaciones de
tools de Iris (parte A del pedido original).

## 10. Testing

- `guardrails.test.ts` — puro: tope de 10 turnos, cada stop-word, idempotencia por `update_id`.
- `personas.test.ts` — cada persona: `primerMensaje` no vacío, idioma correcto, system-prompt incluye objeciones.
- `personaEngine.test.ts` — LLM mockeado: historial que cubrió objetivos → `{fin:true}`; si no → turno; respeta idioma.
- `harvester.test.ts` — LLM mockeado: par → registro con `veta` clasificada y campos completos.
- **Harness en vivo (opt-in):** `scripts/cosechar-dryrun.mts` simula al dueño con otro LLM y corre
  una conversación completa **sin Telegram ni Supabase reales** (fakeDb + captura de envíos).
  Sirve para ver las 6 personas de punta a punta antes de apuntar al dueño real.
- Transporte web probado con el harness; sin unit test pesado del I/O de Telegram (se mockea el borde).

## 11. Entregables

1. `packages/harvest` — cerebro puro (personas, engine, guardrails, harvester, config, observability) + tests.
2. `apps/web/src/app/api/harvest/webhook/route.ts` — transporte.
3. Migración SQL de las 3 tablas `harvest_*` (+ registro de idempotencia).
4. Scripts: `cosechar-iniciar`, `cosechar-detener`, `cosechar-dryrun`, `eval-iris-vs-oro`.
5. Langfuse capa 4 en el webhook de producción de Iris.
6. **(Post-cosecha)** doc de recomendaciones de tools de Iris, data-driven desde el reporte de brechas por veta.

## 12. Fuera de alcance (YAGNI)

Scheduler automático, WhatsApp, self-hosted Langfuse, refactor de Iris a tool-calling,
UI/dashboard, concurrencia > 1.

## 13. Fasing

- **Entrega 1:** `packages/harvest` + transporte + tablas + scripts iniciar/detener/dryrun +
  Langfuse capas 1, 2, 4.
- **Entrega 2:** eval-runner (capa 3) una vez haya oro en el dataset.
- **Entrega 3 (post-cosecha):** doc de recomendaciones de tools de Iris.
