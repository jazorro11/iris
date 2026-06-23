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
