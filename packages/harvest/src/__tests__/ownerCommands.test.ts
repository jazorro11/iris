import { test } from "node:test";
import assert from "node:assert/strict";
import {
  parseHarvestCommand, listarPerfiles,
  BTN_NUEVO, BTN_DETENER, BTN_PERFILES, BTN_AYUDA,
} from "../ownerCommands.js";

test("labels de botón → comando correcto", () => {
  assert.deepEqual(parseHarvestCommand(BTN_NUEVO), { tipo: "nuevo", arg: null });
  assert.deepEqual(parseHarvestCommand(BTN_DETENER), { tipo: "detener" });
  assert.deepEqual(parseHarvestCommand(BTN_PERFILES), { tipo: "perfiles" });
  assert.deepEqual(parseHarvestCommand(BTN_AYUDA), { tipo: "ayuda" });
});

test("slash-commands → comando correcto", () => {
  assert.deepEqual(parseHarvestCommand("/nuevo"), { tipo: "nuevo", arg: null });
  assert.deepEqual(parseHarvestCommand("/detener"), { tipo: "detener" });
  assert.deepEqual(parseHarvestCommand("/perfiles"), { tipo: "perfiles" });
  assert.deepEqual(parseHarvestCommand("/ayuda"), { tipo: "ayuda" });
  assert.deepEqual(parseHarvestCommand("/estado"), { tipo: "estado" });
  assert.deepEqual(parseHarvestCommand("/start"), { tipo: "start" });
});

test("/nuevo con argumento (número o key)", () => {
  assert.deepEqual(parseHarvestCommand("/nuevo 3"), { tipo: "nuevo", arg: "3" });
  assert.deepEqual(parseHarvestCommand("/nuevo inversionista"), { tipo: "nuevo", arg: "inversionista" });
});

test("tolera sufijo @bot y espacios/mayúsculas", () => {
  assert.deepEqual(parseHarvestCommand("  /NUEVO@iris_bot 2  "), { tipo: "nuevo", arg: "2" });
  assert.deepEqual(parseHarvestCommand("/detener@iris_bot"), { tipo: "detener" });
});

test("texto normal → null", () => {
  assert.equal(parseHarvestCommand("Te lo dejo en 1900 si cierras hoy"), null);
  assert.equal(parseHarvestCommand(undefined), null);
  assert.equal(parseHarvestCommand(""), null);
});

test("listarPerfiles numera los 6 arquetipos", () => {
  const txt = listarPerfiles();
  assert.match(txt, /1\. /);
  assert.match(txt, /6\. /);
  assert.doesNotMatch(txt, /7\. /);
});
