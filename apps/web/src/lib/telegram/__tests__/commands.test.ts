import { test } from "node:test";
import assert from "node:assert/strict";
import { parseCommand } from "../commands.js";

test("/olvidar sin argumento pide confirmación", () => {
  assert.deepEqual(parseCommand("/olvidar"), { name: "olvidar", confirm: false });
});

test("/olvidar confirmar ejecuta el borrado", () => {
  assert.deepEqual(parseCommand("/olvidar confirmar"), { name: "olvidar", confirm: true });
});

test("acepta mayúsculas y espacios alrededor", () => {
  assert.deepEqual(parseCommand("  /OLVIDAR Confirmar  "), { name: "olvidar", confirm: true });
});

test("acepta el sufijo @bot de los grupos", () => {
  assert.deepEqual(parseCommand("/olvidar@iris_bot confirmar"), { name: "olvidar", confirm: true });
  assert.deepEqual(parseCommand("/olvidar@iris_bot"), { name: "olvidar", confirm: false });
});

test("un argumento que no es 'confirmar' no confirma", () => {
  assert.deepEqual(parseCommand("/olvidar ya"), { name: "olvidar", confirm: false });
});

test("texto normal no es un comando", () => {
  assert.equal(parseCommand("hola, busco esmeraldas"), null);
  assert.equal(parseCommand("quiero que me olvides"), null);
  assert.equal(parseCommand("/start"), null);
});
