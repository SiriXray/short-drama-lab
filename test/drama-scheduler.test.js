"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { randomUUID } = require("node:crypto");
const { createLimiter, concurrencyConfig } = require("../drama-scheduler");
const { createEngine } = require("../drama-engine");
const { createStore } = require("../drama-router");

const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
async function until(check) {
  for (let i = 0; i < 300; i++) { if (check()) return; await new Promise(resolve => setTimeout(resolve, 5)); }
  throw new Error("Timed out waiting for test state.");
}
function fixtures(t, count) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "atelier-scheduler-test-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const store = createStore(root);
  const projects = Array.from({ length: count }, (_, i) => store.save({ id: randomUUID(), title: `Fixture ${i}`, brief: "test", rightsConfirmed: true,
    assets: [], deliveries: [], ledger: [], events: [], episodes: [{ id: randomUUID(), number: 1, file: "source.mp4", summary: "already summarized", shots: [{ id: randomUUID(), start: 0, end: 3, frames: [] }] }] }));
  return { store, projects };
}
const analyzed = p => ({ shots: [{ id: p.episodes[0].shots[0].id, action: "observed", characters: [], props: [] }] });

test("concurrency defaults are explicit and environment overrides reject unsafe values", () => {
  assert.deepEqual(concurrencyConfig({}, {}), { projects: 4, llm: 2, images: 2, videos: 3 });
  assert.equal(concurrencyConfig({}, { DRAMA_LLM_CONCURRENCY: "3" }).llm, 3);
  assert.equal(concurrencyConfig({ llm: 1 }, { DRAMA_LLM_CONCURRENCY: "3" }).llm, 1);
  for (const value of [0, 9, 1.5, "bad", ""]) assert.throws(() => concurrencyConfig({ llm: value }, {}), /integer/);
});

test("FIFO slots overlap work, enforce a cap, and release on rejection", async () => {
  const pool = createLimiter(2), gates = Array.from({ length: 4 }, deferred), started = [];
  const tasks = gates.map((gate, i) => pool.run(async () => { started.push(i); await gate.promise; if (i === 0) throw new Error("fixture failure"); return i; }));
  const settled = Promise.allSettled(tasks);
  await until(() => started.length === 2);
  assert.deepEqual(pool.snapshot(), { limit: 2, active: 2, queued: 2 });
  gates[0].resolve(); await until(() => started.length === 3);
  assert.deepEqual(started, [0, 1, 2]);
  gates[1].resolve(); await until(() => started.length === 4);
  gates[2].resolve(); gates[3].resolve();
  assert.equal((await settled)[0].status, "rejected");
  assert.deepEqual(pool.snapshot(), { limit: 2, active: 0, queued: 0 });
});

test("four projects share two LLM slots; queued pause and duplicate start never submit", async t => {
  const { store, projects } = fixtures(t, 5), gates = projects.map(deferred), submitted = [];
  const engine = createEngine({ concurrency: { projects: 4, llm: 2 }, llm: async prompt => {
    const i = projects.findIndex(p => prompt.includes(p.episodes[0].shots[0].id));
    submitted.push(i); await gates[i].promise; return analyzed(projects[i]);
  } }, store);
  const tasks = projects.slice(0, 4).map(p => { engine.start(p, "analyze"); return engine.active.get(p.id); });
  assert.throws(() => engine.start(projects[0], "analyze"), /仍在运行/);
  assert.throws(() => engine.start(projects[4], "analyze"), /4 个项目/);
  assert.equal(projects[4].job, undefined);
  await until(() => submitted.length === 2);
  assert.equal(engine.concurrency().llm.active, 2);
  projects[2].job.stopRequested = true;
  gates[0].resolve(); await until(() => submitted.includes(3));
  gates[3].resolve(); gates[1].resolve(); await Promise.all(tasks);
  assert.equal(projects[2].job.status, "paused"); assert.ok(!submitted.includes(2));
  assert.ok([0, 1, 3].every(i => projects[i].job.status === "completed"));
  const count = submitted.length;
  engine.start(projects[0], "analyze"); await engine.active.get(projects[0].id);
  assert.equal(submitted.length, count, "completed analysis must be reused");
});

test("429 backoff releases the slot so another project completes before retry", async t => {
  const { store, projects: [a, b] } = fixtures(t, 2), order = []; let attempts = 0;
  const engine = createEngine({ concurrency: { llm: 1 }, rateLimitDelayMs: 40, llm: async prompt => {
    if (prompt.includes(a.episodes[0].shots[0].id)) {
      order.push("a"); if (++attempts === 1) throw Object.assign(new Error("limited"), { statusCode: 429 });
      return analyzed(a);
    }
    order.push("b"); return analyzed(b);
  } }, store);
  engine.start(a, "analyze"); const first = engine.active.get(a.id);
  engine.start(b, "analyze"); const second = engine.active.get(b.id);
  await Promise.all([first, second]);
  assert.deepEqual(order, ["a", "b", "a"]);
  assert.equal(a.job.status, "completed"); assert.equal(b.job.status, "completed");
});

test("a slow failing request does not block another LLM slot or discard its success", async t => {
  const { store, projects: [a, b] } = fixtures(t, 2), gate = deferred();
  const engine = createEngine({ concurrency: { llm: 2 }, llm: async prompt => {
    if (prompt.includes(a.episodes[0].shots[0].id)) { await gate.promise; throw Object.assign(new Error("timeout"), { statusCode: 504 }); }
    return analyzed(b);
  } }, store);
  engine.start(a, "analyze"); const first = engine.active.get(a.id);
  engine.start(b, "analyze"); await engine.active.get(b.id);
  assert.equal(b.job.status, "completed"); assert.equal(a.job.status, "running");
  gate.resolve(); await first; assert.equal(a.job.status, "failed");
  assert.ok(b.episodes[0].shots[0].analysis);
});

test("Vidu slots are shared across projects and completed tasks never rebill", async t => {
  const { store, projects } = fixtures(t, 3), gates = Array.from({ length: 3 }, deferred); let submissions = 0;
  projects.forEach(p => { p.job = { status: "running", stopRequested: false }; });
  const engine = createEngine({ concurrency: { videos: 2 }, pollIntervalMs: 0,
    requestVidu: async () => ({ taskId: String(submissions++), state: "created" }), normalizeViduTask: t => t,
    getViduTask: async taskId => { await gates[Number(taskId)].promise; return { taskId, state: "success", creations: [{ url: "https://example.com/fixture" }] }; },
    remoteContent: async (_url, _check, opts) => fs.writeFileSync(opts.destination, "fixture"),
    probe: async () => ({ duration: 16, videoCodec: "h264", pixelFormat: "yuv420p" }),
  }, store);
  const targets = projects.map(() => ({ id: randomUUID() })), payload = { model: "viduq4-preview", prompt: "fixture" };
  const tasks = projects.map((p, i) => engine.generated(p, targets[i], "video", "/ent/v2/img2video", payload, ".mp4"));
  await until(() => submissions === 2); assert.equal(engine.concurrency().videos.queued, 1);
  gates[0].resolve(); await until(() => submissions === 3);
  gates[1].resolve(); gates[2].resolve(); await Promise.all(tasks);
  for (const [i, p] of projects.entries()) await engine.generated(p, targets[i], "video", "/ent/v2/img2video", payload, ".mp4");
  assert.equal(submissions, 3);
});
