# Iris — Matcher de cercanía + memoria ligera

**Fecha:** 2026-07-06
**Estado:** Diseño aprobado (pendiente de plan de implementación)
**Origen:** Debug intensivo de Chat5 (memoria/cohesión + no envía fotos), 6 subagentes + verificación en producción.

---

## 1. Problema

El usuario reporta que Iris (asesor de esmeraldas por Telegram) **olvida lo que se le pidió, pierde cohesión, y no envía las fotos adecuadas**. La evidencia (Chat5) muestra: tras acumular pedido (5–6 ct → 2000 USD → colombiana → sin preferencia de tono → 10 ct), Iris **nunca muestra una piedra, nunca envía una foto, y gira en un loop de preguntas y disclaimers de presupuesto**.

### 1.1 Hallazgos de la investigación (causa raíz verificada)

**Reencuadre 1 — Chat1–4 son baseline humano, no de Iris.** Son conversaciones humano-humano de vendedores reales (Santiago, Santi, Méraldi). El estándar a replicar: foto real + quilataje + medidas + precio, memoria de días, y cierre. Solo **Chat5 es el bot**.

**Reencuadre 2 — No es amnesia de estado.** Verificado: `mergeRequest` acumula hechos y `PostgresSaver` persiste por `thread_id=telegramUserId`. El estado NO se pierde. El "olvido" percibido es **re-preguntar datos que el sistema no puede representar** + **nunca avanzar**.

**Reencuadre 3 — El pipeline de fotos NO está roto.** Verificación read-only en producción: las **14 filas tienen `media_url` no vacío** (`con_media_url=14, media_no_vacia=14`). El camino `graph.ts:131 → route.ts:70 → send.ts sendPhoto` es correcto. **La foto se envía cuando el match devuelve una piedra.** (Nota: `origen` y `color` están NULL en las 14 filas; el seed `scripts/seed-inventario.mjs` no puebla `media_url` ni las columnas técnicas — prod fue cargado a mano por el Table Editor.)

**Causa raíz real (ambos síntomas convergen):** el matcher `filtrarPiedras` (`packages/db/src/queries/inventario.ts:24-49`) es un **filtro de corte duro** que devuelve `[]` cuando nada cumple el rango exacto. En Chat5:
- Turnos 1–4 ("5–6 ct"): el inventario **no tiene stock entre 5 y 6 ct**; como es un rango `{5,6}`, `bandaPeso` no lo expande → `[]`.
- Turno 5 ("10 ct", presupuesto 2000 acumulado): si el LLM marca `base="total"`, `9.04ct·4300` y `8.82ct·1500` se excluyen → `[]`.

Match vacío → sin piedra → sin `media_url` → sin foto → el redactor se disculpa ("no tengo imágenes"). El loop de aclaración lo agrava:
- **B1** — "anillo de compromiso" no tiene representación en el schema (`tipo_pieza`/`proposito` enums en `schema.ts:34,41`) + extractor con "no inventes" (`extractor.ts:17`) → campos null para siempre.
- **B2** — "sin preferencia de tono" no llena `color.tono` → sigue en *missing* → re-pregunta.
- **B3/B4** — `missingCriticalFields` nunca se vacía → `estado="en_aclaracion"` eterno; `MAX_RONDAS`/`rondas` es **código muerto** (commit `7b7361f` quitó la guillotina) → sin válvula de escape.
- **B5** — el redactor está obligado a terminar preguntando en modo aclarar (`composer.ts:21,28`).
- **B7** — `briefIntent` atado a `estado`, no a la intención → ante "¿cuál me recomiendas?" sigue en "aclarar".

## 2. Objetivos

1. Iris **siempre ofrece las piedras disponibles más cercanas** al pedido (con foto y precio), como los vendedores humanos, en vez de devolver vacío.
2. Iris **muestra antes y pregunta menos**: no bloquea la conversación esperando llenar 6 campos.
3. Iris **no re-pregunta ni re-muestra** lo ya tratado, y mantiene coherencia en charlas largas.
4. Verificación con **harness LLM en vivo** replicando el escenario Chat5.

## 3. No-objetivos (YAGNI)

- Memoria semántica libre / RAG de preferencias (pgvector). El checkpointer ya persiste los hechos estructurados; sería sobre-ingeniería para el volumen actual.
- Poblar `origen`/`color` del inventario (todo el stock de Méraldi es colombiano; `filtrarPiedras` no filtra por origen). Se deja como nota de datos, fuera de alcance.
- Rehacer el checkpointer o la persistencia (funcionan).

## 4. Diseño

### Sección 1 — Matcher de cercanía
**Archivo:** `packages/db/src/queries/inventario.ts`

Reemplazar `filtrarPiedras` (corte duro → `[]`) por un **ranking por puntaje de cercanía**:
- Puntuar TODO el stock `disponible` por distancia al pedido en las dimensiones que el usuario especificó: **peso** (distancia al rango/punto pedido), **presupuesto** (cuánto excede el tope, penalización suave), **forma** (coincide o no).
- Devolver siempre el **top 3** ordenado por menor penalización; **nunca `[]`** salvo inventario vacío.
- Devolver además un flag **`hayExactas: boolean`** (si alguna piedra cumple el pedido literal), para que el redactor distinga "justo lo que pediste" de "lo más cercano".
- El presupuesto pasa de **filtro** a **penalización** → la ambigüedad `base` total-vs-`por_quilate` deja de vaciar el match. (Complementario: afinar la pista del extractor para que "$2000 para un anillo" tienda a `total`.)
- Función **pura y determinista**. Mantener la coerción numeric-as-string en el borde de `matchInventory`.

**Cambio de interfaz:** `matchInventory` pasa de `Promise<Piedra[]>` a `Promise<{ piedras: Piedra[]; hayExactas: boolean }>` (o equivalente). Actualizar los consumidores (`graph.ts`, tests).

**Resuelve:** fotos, "nunca muestra", muro de objeción de precio, "no tengo imágenes" del turno 1.

### Sección 2 — Relajar el gate de aclaración
**Archivos:** `packages/agent/src/graph.ts`, `request.ts`, `questions.ts`

- Desacoplar `briefIntent` de "6 campos completos". Nueva regla en `responderNode`: si hay **lo mínimo para rankear** (peso *o* presupuesto *o* forma) → modo **asesorar** y mostrar piedras; preguntar **a lo sumo 1 dato** solo si afina de verdad. Nunca bloquear por campos faltantes.
- **Válvula de escape de respaldo**: reinstaurar el uso de `rondas`/`MAX_RONDAS` (hoy muerto) → si tras `MAX_RONDAS` turnos sigue en aclarar, forzar avance a asesorar/handoff. Backstop.
- **"sin preferencia" → centinela `"indiferente"`** (`extractor.ts` + `SolicitudSchema`): mapear "me da igual / sin preferencia / lo que recomiendes" al centinela del campo; `missingCriticalFields` lo trata como satisfecho.
- **"anillo de compromiso"**: enseñar al extractor a mapear a `tipo_pieza`/`proposito` para no re-pedirlo y enriquecer el handoff. (Con el gate relajado ya no bloquea; es calidad de contexto.)

**Resuelve:** loop consultivo, "olvido" percibido, intent atado a estado (B1–B5, B7).

### Sección 3 — Redactor honesto y consciente de la foto
**Archivos:** `packages/agent/src/composer.ts`, `brief.ts`

- Informar al redactor (system prompt) que **el sistema auto-adjunta la foto** de la primera piedra → nunca disculparse por "no tener imágenes" cuando hay piedras.
- Manejar `hayExactas=false`: frasear como humano ("no tengo exactamente 10 ct en $2000; lo más cercano que **sí** tengo es…") + precio + foto.
- En modo asesorar, quitar la obligación de "terminar preguntando"; **proponer piedra concreta por nombre** ante "¿cuál me recomiendas?".
- Pasar `hayExactas` y las piedras rankeadas al brief.

### Sección 4 — Memoria ligera
**Archivos:** `packages/agent/src/state.ts`, `graph.ts`, `brief.ts`, `composer.ts`

- **Núcleo determinista (lo que mata el "olvido"):** trackers con reducer de append —
  - `preguntadas: CampoCritico[]` → el redactor desprioriza/rota lo ya preguntado.
  - `piedras_mostradas: string[]` (por `nombre`) → no re-mostrar la misma piedra.
  - Cero costo de LLM, 100% fiable, persistido por el checkpointer.
- **Capa narrativa (rolling summary, estilo `agent-web`):** campo `resumen: string` actualizado por un LLM barato, **best-effort / no-bloqueante** (fire-and-forget, como su `memory_flush`), con secciones *qué pidió / qué se mostró / preferencias / próximo paso*. Se inyecta al brief como `memoria_conversacion` para coherencia en charlas largas (>6 turnos, más allá de la ventana fija de `getRecentMessages`).
- Regla de fallo: si la actualización del `resumen` falla, la conversación continúa con los trackers deterministas (el summary es aditivo, no crítico).

### Sección 5 — Verificación
- **Unit tests:** scoring del matcher (cercanía, nunca vacío, `hayExactas`, numeric-as-string vía cliente falso que devuelve strings), centinela "sin preferencia", válvula de escape, reducers `preguntadas`/`piedras_mostradas`, brief con `memoria_conversacion`.
- **Harness LLM en vivo EN LA TAREA** (no solo mocks): `scripts/eval-asesora.mjs` / `eval-conversaciones.mjs` replicando el escenario Chat5 sobre LLM+DB reales, con `reset-usuario.mjs` para hilo limpio. Aserciones:
  1. Ofrece una piedra concreta + foto (mediaUrl no null en la respuesta).
  2. No entra en loop (avanza a mostrar en ≤2 turnos).
  3. No re-pregunta un dato ya respondido ("sin preferencia de tono" no se vuelve a pedir).
- **Re-verificar TODOS los flags del clasificador** tras tocar prompts (idioma/handoff/preguntaProfunda), no solo el que se cambió.

## 5. Riesgos y mitigaciones

- **Latencia/costo del rolling summary:** una llamada LLM extra por turno. Mitigación: modelo barato, best-effort no-bloqueante, y los trackers deterministas cubren lo crítico sin él.
- **`base="total"` mal etiquetado:** mitigado porque el presupuesto pasa a penalización suave (ya no vacía el match); la mejora del prompt es secundaria.
- **Regresión del clasificador al editar prompts** (lección previa: editar un prompt movió un flag vecino): re-correr el harness completo sobre todos los flags.
- **`media_url` inválido a futuro** (HEIC/Drive/404, nota de memoria): hoy prod funciona; se deja como guard opcional de robustez en el borde de `send.ts`, no bloqueante para este ciclo.

## 6. Datos / migraciones

Ninguna migración de DB requerida. Cambios solo de código y prompts. (El seed `seed-inventario.mjs` podría actualizarse para poblar `media_url` y evitar divergencia dev/prod, pero es opcional y fuera del núcleo.)
