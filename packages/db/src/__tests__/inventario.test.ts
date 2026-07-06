import { test } from "node:test";
import assert from "node:assert/strict";
import { matchInventory, rankearPiedras, hayMatchExacto } from "../queries/inventario.js";
import type { DbClient } from "../client.js";
import type { Piedra } from "@iris/types";

const base: Omit<Piedra, "id" | "nombre" | "forma" | "peso_ct" | "precio_usd_ct"> = {
  cantidad_piedras: 1, media_url: null, disponible: true, notas: null,
};
const piedra = (id: string, forma: Piedra["forma"], peso_ct: number, precio_usd_ct: number): Piedra =>
  ({ ...base, id, nombre: id, forma, peso_ct, precio_usd_ct });

test("matchInventory coerciona numeric (string) a number y rankea", async () => {
  const fakeDb = {
    from: () => ({ select: () => ({ eq: async () => ({
      data: [
        { id: "a", nombre: "A", forma: "redondo", peso_ct: "3.09", precio_usd_ct: "1500", cantidad_piedras: "1", media_url: null, disponible: true, notas: null },
        { id: "b", nombre: "B", forma: "redondo", peso_ct: "1.00", precio_usd_ct: "200", cantidad_piedras: "1", media_url: null, disponible: true, notas: null },
      ],
      error: null,
    }) }) }),
  } as unknown as DbClient;
  const r = await matchInventory(fakeDb, { peso_quilates: { min: 1, max: 1 } });
  assert.equal(typeof r.piedras[0].precio_usd_ct, "number");
  assert.equal(typeof r.piedras[0].peso_ct, "number");
  assert.equal(r.piedras[0].id, "b"); // b (1.00) más cercano a 1 ct que a (3.09)
  assert.equal(r.hayExactas, true); // b en banda [0.85,1.15]
});

test("matchInventory propaga columnas técnicas nuevas", async () => {
  const fakeDb = {
    from: () => ({ select: () => ({ eq: async () => ({
      data: [
        { id: "a", nombre: "A", forma: "redondo", peso_ct: "3.09", precio_usd_ct: "1500",
          cantidad_piedras: "1", media_url: "http://x/a.jpg", disponible: true, notas: "verde Muzo",
          color: "verde vívido", origen: "Muzo", claridad: "jardín leve", tratamiento: "menor" },
      ],
      error: null,
    }) }) }),
  } as unknown as DbClient;
  const r = await matchInventory(fakeDb, { peso_quilates: { min: 3, max: 3 } });
  assert.equal(r.piedras[0].origen, "Muzo");
  assert.equal(r.piedras[0].color, "verde vívido");
});

const STOCK6: Piedra[] = [
  piedra("a", "corte_esmeralda", 0.88, 5100),
  piedra("b", "corte_esmeralda", 3.61, 1750),
  piedra("c", "cojin", 6.72, 440),
  piedra("d", "redondo", 3.09, 1500),
  piedra("e", "corte_esmeralda", 6.21, 27000),
  piedra("f", "corte_esmeralda", 4.52, 250),
];

test("rankear: sin criterios devuelve vacío", () => {
  assert.deepEqual(rankearPiedras(STOCK6, { proposito: "joyeria" }), []);
});

test("rankear: peso 5-6 ct devuelve las 3 más cercanas (nunca vacío)", () => {
  // penaltyPeso: e(6.21)=0.038 f(4.52)=0.087 c(6.72)=0.131 → top3
  const r = rankearPiedras(STOCK6, { peso_quilates: { min: 5, max: 6 } });
  assert.deepEqual(r.map((p) => p.id), ["e", "f", "c"]);
});

test("rankear: presupuesto es penalización suave, no corte (10ct/2000 total)", () => {
  const big = [piedra("g", "corte_esmeralda", 9.04, 4300), piedra("h", "corte_esmeralda", 8.82, 1500)];
  // h: pres (13230-2000)/2000=5.615 + peso 0.118 ; g: (38872-2000)/2000=18.436 + 0.096 → [h,g]
  const r = rankearPiedras(big, { peso_quilates: { min: 10, max: 10 }, presupuesto: { min: 2000, max: 2000, base: "total" } });
  assert.deepEqual(r.map((p) => p.id), ["h", "g"]);
});

test("rankear: excluye no disponibles", () => {
  const stock = [{ ...piedra("x", "redondo", 1, 100), disponible: false }, piedra("y", "redondo", 1, 100)];
  assert.deepEqual(rankearPiedras(stock, { peso_quilates: { min: 1, max: 1 } }).map((p) => p.id), ["y"]);
});

test("hayMatchExacto: peso 5-6 sin stock en banda → false", () => {
  assert.equal(hayMatchExacto(STOCK6, { peso_quilates: { min: 5, max: 6 } }), false);
});

test("hayMatchExacto: peso 3-4 con stock en banda → true", () => {
  assert.equal(hayMatchExacto(STOCK6, { peso_quilates: { min: 3, max: 4 } }), true);
});

test("hayMatchExacto: sin criterios → false", () => {
  assert.equal(hayMatchExacto(STOCK6, { proposito: "joyeria" }), false);
});
