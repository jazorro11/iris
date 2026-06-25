import { test } from "node:test";
import assert from "node:assert/strict";
import { forgetUserWith, CHECKPOINT_TABLES, LEAD_TABLES } from "../forget.js";

function fakeRunner() {
  const calls: { sql: string; params: unknown[] }[] = [];
  return {
    calls,
    async query(sql: string, params: unknown[]) {
      calls.push({ sql, params });
      return { rowCount: 1 };
    },
  };
}

test("borra las 5 tablas con la clave correcta por tabla", async () => {
  const runner = fakeRunner();
  const counts = await forgetUserWith(runner, 42);

  // Checkpointer: thread_id = id como STRING.
  for (const table of CHECKPOINT_TABLES) {
    const call = runner.calls.find((c) => c.sql.includes(`public.${table} `));
    assert.ok(call, `falta el delete de ${table}`);
    assert.match(call!.sql, /where thread_id = \$1/);
    assert.deepEqual(call!.params, ["42"]);
  }

  // Dominio: telegram_user_id = id NUMÉRICO.
  for (const table of LEAD_TABLES) {
    const call = runner.calls.find((c) => c.sql.includes(`public.${table} `));
    assert.ok(call, `falta el delete de ${table}`);
    assert.match(call!.sql, /where telegram_user_id = \$1/);
    assert.deepEqual(call!.params, [42]);
  }

  assert.equal(counts.length, CHECKPOINT_TABLES.length + LEAD_TABLES.length);
  assert.ok(counts.every((c) => c.deleted === 1));
});

test("reporta 0 cuando no hay filas", async () => {
  const runner = {
    async query() {
      return { rowCount: 0 };
    },
  };
  const counts = await forgetUserWith(runner, 7);
  assert.ok(counts.every((c) => c.deleted === 0));
});
