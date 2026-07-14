// Registra el menú de slash-commands del bot de cosecha en Telegram (mejora descubrimiento).
// Uso: npx tsx --env-file=apps/web/.env scripts/harvest-set-commands.mts
// Idempotente: reemplaza la lista completa de comandos. Correr una vez (o al cambiar los textos).
const token = process.env.HARVEST_BOT_TOKEN ?? "";
if (!token) { console.error("HARVEST_BOT_TOKEN no configurado"); process.exit(1); }

const commands = [
  { command: "nuevo", description: "Empezar una práctica con un nuevo comprador" },
  { command: "detener", description: "Cerrar la práctica actual" },
  { command: "perfiles", description: "Ver los tipos de cliente" },
  { command: "estado", description: "Ver la práctica activa" },
  { command: "ayuda", description: "Cómo funciona el bot" },
];

const res = await fetch(`https://api.telegram.org/bot${token}/setMyCommands`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ commands }),
});
const body = await res.json().catch(() => ({}));
if (!res.ok || !(body as { ok?: boolean }).ok) {
  console.error("setMyCommands falló:", res.status, body);
  process.exit(1);
}
console.log("Slash-commands registrados:", commands.map((c) => `/${c.command}`).join(" "));
