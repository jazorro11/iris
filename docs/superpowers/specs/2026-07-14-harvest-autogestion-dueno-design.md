# Diseño — Autogestión del dueño desde el chat (comandos del bot de cosecha)

**Fecha:** 2026-07-14
**Estado:** Aprobado (brainstorming). Pendiente: plan de implementación.
**Branch:** `feat/harvest-owner-commands` (creada desde `main` tras merge de PR #17 y #18).

## 1. Problema y objetivo

Hoy, para arrancar una conversación de cosecha, **Julio** corre `scripts/cosechar-iniciar.mts`
desde su máquina. Eso lo vuelve el cuello de botella operativo. Se busca que el **dueño se
autogestione todo desde el chat de Telegram**, con la misma naturalidad que el comando `/olvidar`
del agente Iris: iniciar, detener y elegir conversaciones de práctica sin intervención de Julio.

## 2. Decisiones fijadas (del grill)

| # | Decisión | Valor |
|---|----------|-------|
| Selección de perfil | **(C) Híbrido:** `/nuevo` auto-rota el perfil menos usado + `/perfiles` menú opcional para elegir |
| Interacción | **(B) Teclado persistente** de botones (reply keyboard) que envían texto; sin `callback_query`. Slash-commands también funcionan |
| Identidad | **(A) One-time:** binding vía `OWNER_HARVEST_CHAT_ID` (Julio lo setea una vez). El dueño autogestiona todo lo demás |
| `/nuevo` con activa | **(A) Rehusar con aviso** (no auto-detener; no perder cosecha en curso) |
| `/detener` | **Sin confirmación** (no borra datos, solo cierra la conversación) |

## 3. Comandos y comportamiento

El webhook detecta comandos **antes** del flujo normal (patrón `/olvidar`). Los botones del teclado
envían el mismo texto que su slash-command, así que el parser trata ambos igual.

| Botón | Slash | Comportamiento |
|-------|-------|----------------|
| 🆕 Nuevo comprador | `/nuevo` (opcional `/nuevo <n\|key>`) | Si hay conversación `activa` → rehúsa: *"Ya tienes un comprador activo. Toca ⏹ Detener antes de empezar otro."* Si no → elige perfil (auto-rotación o el forzado), crea la conversación, envía el primer mensaje del comprador, confirma. |
| ⏹ Detener | `/detener` | Cierra la conversación `activa` (estado `detenida`, sin confirmación). Si no hay ninguna → lo dice. |
| 📋 Perfiles | `/perfiles` | Lista numerada de los 6 arquetipos. Para forzar uno: `/nuevo 3` o `/nuevo inversionista`. |
| ❓ Ayuda | `/ayuda` | Explica en 3 líneas cómo funciona (nuevo/detener/responder). |
| — | `/estado` | Muestra la conversación activa (persona + turno) o "sin conversación activa". |

- **Mensaje normal (no comando):** se trata como respuesta del vendedor (flujo de cosecha actual),
  **solo si hay conversación activa**. Si no hay ninguna → pista suave:
  *"Toca 🆕 Nuevo comprador para empezar una práctica."*
- **Primer contacto (`/start` o primer mensaje sin conversación):** saludo + explicación breve +
  se muestra el teclado persistente.
- **Menú de slash-commands** registrado en BotFather vía `setCommands` (mejora descubrimiento).

## 4. Rotación de perfiles

`/nuevo` (sin argumento) elige el perfil **menos usado**: cuenta conversaciones por `persona_key`
en `harvest_conversations`, toma el de menor conteo; empates se rompen por el orden de `PERSONAS`.
`/nuevo <n>` (número 1-6 según `/perfiles`) o `/nuevo <key>` fuerza uno específico.

## 5. Identidad y seguridad

- Los comandos y respuestas **solo** se aceptan desde `OWNER_HARVEST_CHAT_ID` (validación ya
  existente en el webhook). Un mensaje de otro chat se ignora (200).
- El binding inicial lo hace Julio una vez (Start del dueño → id → env + redeploy). Sin
  auto-enrolamiento (fuera de alcance).

## 6. Arquitectura (DRY + testeable)

- **`parseHarvestCommand(text)`** — función **pura** en `@iris/harvest` que mapea labels de botón
  (`🆕 Nuevo comprador`, `⏹ Detener`, `📋 Perfiles`, `❓ Ayuda`) **y** slash-commands
  (`/nuevo [arg]`, `/detener`, `/perfiles`, `/ayuda`, `/estado`, `/start`) a un tipo `HarvestCommand`
  discriminado. Devuelve `null` si no es comando. Unit-tested (todas las variantes + argumentos).
- **Extraer `iniciarConversacion(...)`** — la lógica hoy embebida en `cosechar-iniciar.mts`
  (guard de concurrencia + `crearConversacion` + primer `addHarvestMessage` + envío) se mueve a una
  función compartida (en `@iris/harvest` o un módulo de servicio) que **usan tanto el script como el
  webhook**. No duplicar.
- **Query nueva** en `@iris/db`: `contarConversacionesPorPersona(db)` → `{persona_key, count}[]`,
  o un helper `elegirPersonaMenosUsada(db)` para la rotación.
- **`sendHarvestMessage`** gana un parámetro opcional `replyMarkup?` para adjuntar el teclado
  persistente (reply keyboard) en el saludo/confirmaciones.
- **Webhook** (`/api/harvest/webhook`): bloque de manejo de comandos al inicio (tras validar
  secret + owner chat), como `/olvidar`; si es comando, lo maneja y retorna; si no, cae al flujo
  de cosecha actual (que solo actúa si hay conversación activa).
- **`selectHarvestPersona`/rotación** puro y testeable dado la lista de conteos.
- Los scripts locales `cosechar-iniciar`/`cosechar-detener` **se conservan** como fallback de admin
  (reusan `iniciarConversacion` / el cierre).

## 7. Definición del teclado

Reply keyboard persistente (no inline), 2×2:
```
🆕 Nuevo comprador   |   ⏹ Detener
📋 Perfiles          |   ❓ Ayuda
```
Se envía con `reply_markup: { keyboard: [[...],[...]], resize_keyboard: true, is_persistent: true }`.

## 8. Testing

- `parseHarvestCommand.test.ts` — cada label de botón y cada slash-command → comando correcto;
  `/nuevo 3` y `/nuevo inversionista` → arg parseado; texto normal → `null`; sufijo `@bot` tolerado.
- `elegirPersonaMenosUsada.test.ts` (puro) — dados conteos, elige el menor; empate → orden de PERSONAS.
- `iniciarConversacion` — con deps mockeadas: rehúsa si hay activa; si no, crea + primer mensaje.
- Webhook: cubierto por lectura/harness (I/O); sin unit test pesado del borde Telegram.
- Extender `cosechar-dryrun` no aplica (esto es comando de Telegram, no el loop de cosecha).

## 9. Entregables

1. `parseHarvestCommand` + tipos + tests (en `@iris/harvest`).
2. `iniciarConversacion` compartido + refactor de `cosechar-iniciar.mts` para reusarlo.
3. Rotación de personas (`elegirPersonaMenosUsada`) + query de conteo en `@iris/db`.
4. `sendHarvestMessage` con `replyMarkup?`.
5. Webhook: bloque de comandos (nuevo/detener/perfiles/ayuda/estado/start) + teclado + pistas.
6. `setCommands` en BotFather (paso operativo, documentado).

## 10. Fuera de alcance (YAGNI)

Botones inline / `callback_query`, auto-enrolamiento del dueño, multi-dueño, confirmaciones,
programación/scheduler, edición de perfiles desde el chat.
