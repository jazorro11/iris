import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const src = join(here, "..", "packages", "agent", "src", "knowledge", "biblia-completa.md");
const out = join(here, "..", "packages", "agent", "src", "knowledge", "biblia.ts");

const md = readFileSync(src, "utf8");
const content = `/** Generado por scripts/generate-biblia.mjs desde biblia-completa.md. NO editar a mano. */
export const BIBLIA_COMPLETA = ${JSON.stringify(md)};
`;
writeFileSync(out, content, "utf8");
console.log(`biblia.ts generado (${md.length} chars)`);
