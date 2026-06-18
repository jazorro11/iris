# Diseño — Iris: extracción de solicitudes de compra de esmeraldas

**Fecha:** 2026-06-18
**Autor:** Julio (kausai.ai) con Claude Code
**Estado:** Aprobado para planificación

## 1. Propósito

Construir un agente que reciba mensajes de Telegram de usuarios con **intención de
compra de esmeraldas**, escritos en lenguaje natural, y los convierta en
**información estructurada** según la taxonomía de la *Guía Méraldi de Esmeraldas
Colombianas*. El agente conversa con el comprador (dos vías): extrae lo que el
mensaje contiene, detecta qué falta y pregunta por los datos críticos hasta
completar la solicitud. Cada solicitud completa se persiste como un *lead*
estructurado y se notifica al vendedor.

**"Clasificación" en este MVP = estructurar la solicitud según la taxonomía
Méraldi, NO avaluar la piedra.** La tasación (asignar nivel de calidad/precio) y el
matching con inventario quedan fuera de alcance (ver §7).

## 2. Decisiones tomadas (brainstorming)

| Decisión | Elección | Razón |
| --- | --- | --- |
| Rol del agente | **Conversacional (dos vías)** | Pedir datos faltantes al comprador justifica LangGraph y el reuso del flujo multi-turno. |
| Stack | **Repo nuevo TS, delgado** | Reusa patrones de `agent-web` sin arrastrar web UI/onboarding/integraciones que no aplican. |
| Destino del output | **Supabase + aviso al vendedor** | Historial de leads consultable + notificación; coherente con el reuso. |
| Host del webhook | **Next.js** | Reuso directo del `webhook/route.ts` de `agent-web`, deploy trivial (Vercel), camino claro a panel de leads. |
| Clasificar vs avaluar | **Solo estructurar** | Avalúo y matching son fases futuras. |

## 3. Reuso de `agent-web`

Repo de referencia: https://github.com/jazorro11/agent-web (monorepo TS, Turborepo +
Next.js + Supabase + LangGraph JS).

| Pieza de `agent-web` | Uso en Iris |
| --- | --- |
| `apps/web/src/app/api/telegram/webhook/route.ts` | Base del webhook; se simplifica (sin `/link`, sin comandos de sesión, sin botones approve/reject). |
| `apps/web/src/lib/telegram/send.ts` (`sendTelegramMessage`) | Reuso directo (mensajes + futuros teclados). |
| `apps/web/src/app/api/telegram/setup/route.ts` | Reuso para registrar el webhook. |
| `packages/agent/src/model.ts` (ChatOpenAI vía OpenRouter) | Reuso del patrón de configuración del LLM. |
| `packages/agent/src/graph.ts` | Referencia de patrón `StateGraph` + checkpointer; el grafo de Iris es más simple (sin loop de tools ni HITL `interrupt()`). |
| `packages/agent/src/checkpointer.ts` (PostgresSaver) | Reuso para estado multi-turno por comprador. |
| `packages/db` (cliente Supabase, queries tipadas, migraciones) | Reuso del patrón; tablas nuevas propias de Iris. |
| `packages/config`, `turbo.json` | Reuso de config base del monorepo. |

**No se reusa:** auth/login/onboarding, chat web UI, integraciones GitHub/Google/Notion,
catálogo de tools y su HITL approve/reject, memoria de largo plazo, tareas programadas.

### Pertinencia de LangGraph

La extracción NL→estructurado en su forma pura sería una sola llamada con salida
estructurada. LangGraph **se justifica aquí** porque el sistema es multi-etapa y
multi-turno: extraer → validar completitud → preguntar lo faltante → persistir, con
**estado parcial acumulado entre mensajes** vía checkpointer. No se usa `interrupt()`
(no hay acciones riesgosas que aprobar); el multi-turno se logra re-invocando el grafo
con el mismo `thread_id`.

## 4. Esquema de "Solicitud de compra estructurada"

Modelado con zod en `packages/agent/src/schema.ts`. Campos en su mayoría opcionales:
el comprador rara vez menciona las seis variables. Mapea las 6 variables del §5 de la
guía, la escala de tratamiento del §6, los tipos de pieza del §7 y los orígenes/minas
de §3–§4.

### A. Lead / contacto
- `telegram_user_id`, `telegram_username`, `nombre`
- `idioma`, `fecha`, `contacto_alterno` (email/teléfono, opcional)

### B. Intención comercial
- `tipo_solicitud`: `compra` | `cotizacion` | `exploracion`
- `proposito`: `joyeria` | `coleccion` | `inversion_patrimonio` | `regalo` | `reventa` | `desconocido`
- `presupuesto`: `{ min, max, moneda: USD|COP, base: total|por_quilate }`
- `cantidad_piezas`
- `urgencia`: `inmediato` | `semanas` | `sin_prisa`
- `requiere_certificado`: `bool`; `laboratorio_preferido`: GIA | Gübelin | SSEF | AGL | Guild | otro

### C. Especificación de la piedra — 6 variables Méraldi + tipo de pieza
1. `tipo_pieza`: `gema_tallada` | `cristal_bruto` | `joya_terminada` | `especimen_mineral` *(§7)*
2. `peso_quilates`: `{ min, max }` *(§5)*
3. `color`: `{ tono: verde|verde_azulado|indiferente, saturacion: vivida|media|clara|oscura, descripcion_libre }` *(§1, §5)*
4. `claridad`: `limpia` | `inclusiones_aceptables` | `jardin_aceptable` | `indiferente` *(§1, §5)*
5. `corte`: `{ forma: corte_esmeralda|oval|cojin|gota|redondo|otro|indiferente, calidad: alta|media|indiferente }` *(glosario)*
6. `origen`: `{ pais: colombia|zambia|brasil|afganistan_pakistan|otro|indiferente, mina_zona: muzo|coscuez|chivor|la_pita_maripi|gachala|kafubu_kagem|… }` *(§3, §4)*
7. `tratamiento_max_aceptable`: `sin_tratamiento` | `insignificante` | `menor` | `moderado` | `significativo` | `indiferente` *(§6)*
8. `caracteristicas_especiales`: lista de `trapiche` | `macla` | `canutillo` | `doble_terminacion` | `matriz` *(§4, glosario)*

### D. Metadata de extracción / gestión
- `estado`: `incompleto` | `completo` | `en_aclaracion`
- `campos_faltantes`: lista de claves
- `confianza`: score global 0–1 (opcional por campo)
- `mensaje_original`: texto NL crudo (acumulado por turno)
- `resumen_legible`: para el vendedor
- `notas`

### Campos críticos (fuerzan pregunta de aclaración si faltan)
`proposito`, `presupuesto`, `tipo_pieza`, `peso_quilates`, `color`, `origen`.
El resto (`corte`, `tratamiento_max_aceptable`, `claridad`) se asume `indiferente`
si el comprador no los menciona.

## 5. Arquitectura

```
iris-solution/
├── apps/web/                       # Next.js — SOLO el webhook (sin UI de auth/chat)
│   └── src/app/api/telegram/
│       ├── webhook/route.ts        # recibe update → runExtraction → responde
│       └── setup/route.ts          # registra el webhook en Telegram
├── packages/
│   ├── agent/
│   │   └── src/
│   │       ├── graph.ts            # StateGraph: extractor → validador → (preguntar|persistir→confirmar)
│   │       ├── model.ts            # ChatOpenAI vía OpenRouter (reuso de agent-web)
│   │       ├── schema.ts           # esquema zod (§4) + lista de campos críticos
│   │       ├── checkpointer.ts     # PostgresSaver (reuso)
│   │       └── nodes/
│   │           ├── extractor.ts
│   │           ├── validador.ts
│   │           ├── preguntar.ts
│   │           └── persistir.ts
│   ├── db/                         # cliente Supabase + queries + migraciones (leads, lead_messages)
│   ├── types/                      # interfaces compartidas
│   └── config/                     # tsconfig base/next
└── turbo.json
```

### Modelo de datos (Supabase / Postgres)
- `leads`: una fila por comprador/solicitud. Campos estructurados de §4 (columnas
  tipadas para los críticos + JSONB para el detalle), `estado`, `confianza`,
  `created_at`, `updated_at`. Clave natural: `telegram_user_id` (upsert).
- `lead_messages`: log de la conversación (rol, texto, timestamp, `lead_id`).
- Tablas de checkpoints de LangGraph (`PostgresSaver`), `thread_id = telegram_user_id`.
- RLS habilitado en tablas con datos (patrón de `agent-web`); el webhook usa service role.

### Variables de entorno
`TELEGRAM_BOT_TOKEN`, `TELEGRAM_WEBHOOK_SECRET`, `OPENROUTER_API_KEY` (o equivalente
de `model.ts`), `DATABASE_URL` (Postgres para checkpointer), credenciales Supabase,
`SELLER_TELEGRAM_CHAT_ID` (destino del aviso al vendedor).

## 6. Flujo

1. Comprador escribe al bot. Telegram → `POST /api/telegram/webhook` (valida
   `x-telegram-bot-api-secret-token`).
2. Identidad = `telegram_user_id` (sin `/link`). Se usa como `thread_id`.
3. Se invoca el grafo con el mensaje nuevo; el checkpointer recupera el estado parcial
   previo del thread.
4. **extractor**: LLM con `withStructuredOutput(schemaZod)` → solicitud parcial,
   **fusionada** con el estado previo (no se pisan campos ya capturados).
5. **validador**: calcula `campos_faltantes` entre los críticos → `completo` o
   `en_aclaracion`.
6. Ruta condicional:
   - **faltan críticos** → **preguntar**: genera en NL una pregunta por los faltantes,
     la envía al comprador y termina el turno (estado persiste; se retoma en el próximo
     mensaje).
   - **completo** → **persistir**: `upsert` del lead en Supabase + **notifica al
     vendedor** (Telegram a `SELLER_TELEGRAM_CHAT_ID`) → **confirmar**: mensaje de
     cierre al comprador.

## 7. Alcance

**Dentro (MVP):** webhook Telegram, extracción NL→estructurado, bucle de aclaración
multi-turno, persistencia de leads en Supabase, aviso al vendedor, tests.

**Fuera (fases futuras):**
- Tasación/grading de la piedra (nivel de calidad o precio).
- Matching con inventario real de Méraldi.
- UI web de leads (por ahora vía visor de tablas de Supabase), auth/onboarding.
- Integraciones GitHub/Google/Notion, memoria de largo plazo, tareas programadas.
- Manejo de fotos/video del comprador.

## 8. Estrategia de pruebas

- **Extractor**: fixtures de mensajes NL realistas (ES) → solicitud estructurada
  esperada; cubrir mensajes parciales, ambiguos y completos.
- **Fusión de estado**: un segundo mensaje no debe pisar campos ya capturados.
- **Validador / completitud**: dado un estado parcial, `campos_faltantes` y `estado`
  correctos según la lista de críticos.
- **Esquema zod**: valores fuera de enum se rechazan/normalizan.
- **Webhook**: rechaza secreto inválido; ignora updates sin texto.

## 9. Riesgos y mitigaciones

- **Alucinación de campos** (el LLM "inventa" origen/quilates) → prompt estricto
  "solo extrae lo explícito"; `confianza` por campo; el validador trata baja confianza
  como faltante.
- **Bucle de preguntas infinito** si el comprador no responde lo pedido → límite de
  N preguntas por campo; tras el límite, persistir como `incompleto` y avisar al
  vendedor para seguimiento humano.
- **Mensajes no relacionados** (no son intención de compra) → el extractor marca
  `tipo_solicitud`/`proposito` y el grafo responde cortésmente sin crear lead basura.
