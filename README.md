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
