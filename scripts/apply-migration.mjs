import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import pg from "pg";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// Cargar apps/web/.env manualmente (solo lo que necesitamos)
const envText = readFileSync(path.join(root, "apps/web/.env"), "utf8");
const env = {};
for (const line of envText.split(/\r?\n/)) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m) env[m[1]] = m[2];
}

const url = env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL no encontrado en apps/web/.env");

const migrationsDir = path.join(root, "packages/db/supabase/migrations");
const files = readdirSync(migrationsDir).filter((f) => f.endsWith(".sql")).sort();

const client = new pg.Client({ connectionString: url, ssl: { rejectUnauthorized: false } });
await client.connect();
console.log("Conectado a Postgres. Aplicando migración...");
for (const file of files) {
  const sql = readFileSync(path.join(migrationsDir, file), "utf8");
  console.log(`Aplicando ${file}...`);
  await client.query(sql);
}

const { rows } = await client.query(
  `select table_name from information_schema.tables
   where table_schema='public' and table_name in ('leads','lead_messages','inventario')
   order by table_name`
);
console.log("Tablas presentes:", rows.map((r) => r.table_name).join(", ") || "(ninguna)");
await client.end();
console.log("OK");
