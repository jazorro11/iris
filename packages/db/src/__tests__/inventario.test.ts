import { test } from "node:test";
import assert from "node:assert/strict";
import { filtrarPiedras, matchInventory, rankearPiedras, hayMatchExacto } from "../queries/inventario.js";
import type { DbClient } from "../client.js";
import type { Piedra } from "@iris/types";

const base: Omit<Piedra, "id" | "nombre" | "forma" | "peso_ct" | "precio_usd_ct"> = {
  cantidad_piedras: 1, media_url: null, disponible: true, notas: null,
};
const piedra = (id: string, forma: Piedra["forma"], peso_ct: number, precio_usd_ct: number): Piedra =>
  ({ ...base, id, nombre: id, forma, peso_ct, precio_usd_ct });

const STOCK: Piedra[] = [
  piedra("a", "corte_esmeralda", 0.88, 5100),
  piedra("b", "corte_esmeralda", 3.61, 1750),
  piedra("c", "cojin", 6.72, 440),
  piedra("d", "redondo", 3.09, 1500),
];

test("solicitud sin criterios relevantes no propone nada", () => {
  assert.deepEqual(filtrarPiedras(STOCK, { proposito: "joyeria" }), []);
});

test("filtra por forma", () => {
  const r = filtrarPiedras(STOCK, { corte: { forma: "cojin" } });
  assert.deepEqual(r.map((p) => p.id), ["c"]);
});

test("forma indiferente no filtra por forma", () => {
  const r = filtrarPiedras(STOCK, { corte: { forma: "indiferente" }, peso_quilates: { min: 3 } });
  assert.deepEqual(r.map((p) => p.id).sort(), ["b", "c", "d"]);
});

test("filtra por rango de peso", () => {
  const r = filtrarPiedras(STOCK, { peso_quilates: { min: 3, max: 4 } });
  assert.deepEqual(r.map((p) => p.id).sort(), ["b", "d"]);
});

test("filtra por precio por_quilate y ordena asc", () => {
  const r = filtrarPiedras(STOCK, { presupuesto: { max: 2000, base: "por_quilate" } });
  assert.deepEqual(r.map((p) => p.id), ["c", "d", "b"]);
});

test("presupuesto total compara precio_usd_ct * peso_ct", () => {
  // c: 440*6.72=2956.8 ; d: 1500*3.09=4635 ; b: 1750*3.61=6317.5 ; a: 5100*0.88=4488
  const r = filtrarPiedras(STOCK, { presupuesto: { max: 3000, base: "total" } });
  assert.deepEqual(r.map((p) => p.id), ["c"]);
});

test("sin base de presupuesto se asume por_quilate", () => {
  const r = filtrarPiedras(STOCK, { presupuesto: { max: 500 } });
  assert.deepEqual(r.map((p) => p.id), ["c"]);
});

test("limita a 3 resultados", () => {
  const many = [
    piedra("p1", "redondo", 1, 100), piedra("p2", "redondo", 1, 200),
    piedra("p3", "redondo", 1, 300), piedra("p4", "redondo", 1, 400),
  ];
  assert.equal(filtrarPiedras(many, { corte: { forma: "redondo" } }).length, 3);
});

test("excluye no disponibles", () => {
  const stock = [{ ...piedra("x", "redondo", 1, 100), disponible: false }];
  assert.deepEqual(filtrarPiedras(stock, { corte: { forma: "redondo" } }), []);
});

test("presupuesto en COP no filtra por precio (se omite)", () => {
  // forma presente → debe devolver la redonda aunque el max COP sea absurdamente bajo
  const r = filtrarPiedras(STOCK, { corte: { forma: "redondo" }, presupuesto: { max: 1, moneda: "COP" } });
  assert.deepEqual(r.map((p) => p.id), ["d"]);
});

test("solo presupuesto COP no es criterio relevante", () => {
  assert.deepEqual(filtrarPiedras(STOCK, { presupuesto: { max: 500, moneda: "COP" } }), []);
});

test("peso de un solo valor (min==max) se expande a banda ±15%", () => {
  // "3 ct" llega como {min:3,max:3} → banda [2.55, 3.45] → solo d (3.09); b (3.61) queda fuera
  const r = filtrarPiedras(STOCK, { peso_quilates: { min: 3, max: 3 } });
  assert.deepEqual(r.map((p) => p.id), ["d"]);
});

test("presupuesto de un solo valor (min==max) se trata como tope", () => {
  // "2000 por quilate" llega como {min:2000,max:2000} → tope 2000 → c,d,b (a=5100 fuera), asc por precio
  const r = filtrarPiedras(STOCK, { presupuesto: { min: 2000, max: 2000, base: "por_quilate" } });
  assert.deepEqual(r.map((p) => p.id), ["c", "d", "b"]);
});

test("caso B: forma + presupuesto tope (min==max) se combinan", () => {
  // "corte esmeralda, máximo 2000 USD/ct" → forma=corte_esmeralda Y tope 2000.
  // De STOCK los corte_esmeralda son a(5100) y b(1750); el tope deja solo b,
  // y c/d quedan fuera por forma. Cubre la combinación forma+precio (ningún
  // otro test la ejerce) usando el presupuesto degenerado que emite el LLM.
  const r = filtrarPiedras(STOCK, {
    corte: { forma: "corte_esmeralda" },
    presupuesto: { min: 2000, max: 2000, base: "por_quilate" },
  });
  assert.deepEqual(r.map((p) => p.id), ["b"]);
});

test("regresión: peso ~10ct ya no exige el valor exacto", () => {
  const big = [piedra("g", "corte_esmeralda", 9.04, 4300), piedra("h", "corte_esmeralda", 12.24, 520)];
  // {min:10,max:10} → banda [8.5, 11.5] → g (9.04) entra, h (12.24) fuera
  const r = filtrarPiedras(big, { peso_quilates: { min: 10, max: 10 } });
  assert.deepEqual(r.map((p) => p.id), ["g"]);
});

test("matchInventory coerciona numeric (string) a number y ordena", async () => {
  const fakeDb = {
    from: () => ({ select: () => ({ eq: async () => ({
      data: [
        { id: "a", nombre: "A", forma: "redondo", peso_ct: "3.09", precio_usd_ct: "1500", cantidad_piedras: "1", media_url: null, disponible: true, notas: null },
        { id: "b", nombre: "B", forma: "redondo", peso_ct: "1.00", precio_usd_ct: "200", cantidad_piedras: "1", media_url: null, disponible: true, notas: null },
      ],
      error: null,
    }) }) }),
  } as unknown as DbClient;
  const r = await matchInventory(fakeDb, { corte: { forma: "redondo" } });
  assert.equal(typeof r[0].precio_usd_ct, "number");
  assert.equal(typeof r[0].peso_ct, "number");
  assert.deepEqual(r.map((p) => p.id), ["b", "a"]);
});

test("matchInventory propaga columnas técnicas nuevas (color/origen/claridad/tratamiento)", async () => {
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
  const r = await matchInventory(fakeDb, { corte: { forma: "redondo" } });
  assert.equal(r[0].color, "verde vívido");
  assert.equal(r[0].origen, "Muzo");
  assert.equal(r[0].claridad, "jardín leve");
  assert.equal(r[0].tratamiento, "menor");
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
