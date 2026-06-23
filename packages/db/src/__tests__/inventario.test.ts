import { test } from "node:test";
import assert from "node:assert/strict";
import { filtrarPiedras, matchInventory } from "../queries/inventario.js";
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
