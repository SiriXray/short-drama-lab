"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { randomUUID } = require("node:crypto");
const { createStore } = require("../drama-router");
const { createEngine } = require("../drama-engine");
const { createSettings } = require("../drama-settings");
const { samplePlan, batches, normalizeBatch, verdict, createDeliveryReviewer } = require("../drama-vlm-review");
const clean = () => ({ summary: "No visible anomaly in samples", uncertain: false, findings: [] });
function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "drama-vlm-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const store = createStore(root), epId = randomUUID();
  const delivery = { id: randomUUID(), episodeId: epId, file: "film.mp4", manifest: "manifest.json", style: "cinematic", metadata: { duration: 32 } };
  const p = { id: randomUUID(), title: "Review test", rightsConfirmed: true, assets: [], episodes: [{ id: epId, number: 1, metadata: { duration: 32 }, shots: [0, 16].map(start => ({ start, end: start + 16, video: { file: "film.mp4", metadata: { duration: 16 } } })) }], deliveries: [delivery], ledger: [], events: [], job: {} };
  store.save(p); fs.writeFileSync(store.file(p.id, delivery.file), "immutable-video"); fs.writeFileSync(store.file(p.id, delivery.manifest), "{}");
  let calls = 0;
  const deps = { getGeminiConfig: () => ({ model: "gemini-2.5-pro", baseUrl: "https://gateway.example/v1", apiKey: "secret-test", enabled: true, intervalSeconds: 2 }),
    probe: async () => delivery.metadata, reviewImageAt: async (_file, output) => { fs.mkdirSync(path.dirname(output), { recursive: true }); fs.writeFileSync(output, "JPEG-test"); },
    geminiReview: async () => { calls++; return clean(); } };
  const reviewer = () => createDeliveryReviewer({ deps, store, checkpoint: () => {}, event: () => {}, runSlot: fn => fn() });
  return { root, store, p, delivery, deps, reviewer, calls: () => calls };
}
test("sampling includes both sides of joins and stays within the disclosed cap", () => {
  const plan = samplePlan(32, [16]);
  for (const time of [0, 15.25, 15.85, 16.15, 16.75, 31.95]) assert.ok(plan.frames.some(f => f.time === time));
  const long = samplePlan(900, Array.from({ length: 100 }, (_, i) => i * 9), 1);
  assert.ok(long.frames.length <= 240); assert.ok(long.limited);
  assert.ok(batches(plan.frames).slice(1).every((b, i) => b[0].id === batches(plan.frames)[i].at(-2).id));
  assert.throws(() => samplePlan(0)); assert.throws(() => batches([], 8)); assert.throws(() => batches(plan.frames, 2));
});
test("findings require valid evidence; high-confidence severe findings block approval", () => {
  const frames = [{ id: "a", time: 1 }, { id: "b", time: 2 }];
  const finding = { category: "style_drift", severity: "high", confidence: 0.91, frameIds: ["a", "b"], start: 999, description: "photo to drawing", suggestion: "review join" };
  const result = normalizeBatch({ ...clean(), findings: [finding] }, frames);
  assert.equal(result.findings[0].start, 1); assert.equal(verdict([result], true), "blocked");
  assert.equal(verdict([result], false), "unverified");
  assert.equal(verdict([{ ...clean(), uncertain: true }], true), "review");
  for (const invalid of [null, { ...finding, frameIds: ["fake"] }, { ...finding, frameIds: ["a"] }, { ...finding, confidence: 2 }]) assert.throws(() => normalizeBatch({ ...clean(), findings: [invalid] }, frames));
  assert.throws(() => normalizeBatch({ findings: [] }, frames));
});
test("failed Gemini batch resumes successful batches without changing video or generating media", async t => {
  const f = fixture(t); let calls = 0;
  f.deps.geminiReview = async () => { if (++calls === 2) throw new Error("upstream failed with private diagnostics"); return clean(); };
  const first = await f.reviewer().review(f.p, f.delivery);
  assert.equal(first.status, "failed"); assert.equal(first.verdict, "unverified"); assert.equal(first.batches.length, 1);
  const report = await f.reviewer().review(f.p, f.delivery);
  assert.equal(report.status, "completed"); assert.equal(report.verdict, "pass");
  assert.equal(calls, report.totalBatches + 1);
  await f.reviewer().review(f.p, f.delivery); assert.equal(calls, report.totalBatches + 1);
  assert.equal(fs.readFileSync(f.store.file(f.p.id, "film.mp4"), "utf8"), "immutable-video");
  const disk = fs.readFileSync(f.store.file(f.p.id, report.reportFile), "utf8");
  assert.ok(!disk.includes("secret-test") && !disk.includes("private diagnostics"));
  assert.equal(JSON.parse(fs.readFileSync(f.store.file(f.p.id, "manifest.json"))).visualReview.verdict, "pass");
  await f.reviewer().review(f.p, f.delivery, { force: true }); assert.equal(f.delivery.reviewHistory.length, 1);
});
test("reference byte changes invalidate cached visual review", async t => {
  const f = fixture(t), id = randomUUID();
  f.p.assets = [{ id, name: "Lead", type: "character", image: { file: "lead.jpg" } }];
  f.p.episodes[0].shots[0].assetIds = [id]; fs.writeFileSync(f.store.file(f.p.id, "lead.jpg"), "first");
  const first = await f.reviewer().review(f.p, f.delivery);
  fs.writeFileSync(f.store.file(f.p.id, "lead.jpg"), "changed");
  const next = await f.reviewer().review(f.p, f.delivery);
  assert.notEqual(first.cacheKey, next.cacheKey); assert.equal(f.delivery.reviewHistory.length, 1);
});
test("missing media and malformed responses stay explicitly unverified", async t => {
  const f = fixture(t);
  f.deps.geminiReview = async () => ({ findings: [] });
  assert.equal((await f.reviewer().review(f.p, f.delivery)).status, "failed");
  fs.unlinkSync(f.store.file(f.p.id, "film.mp4"));
  assert.equal((await f.reviewer().review(f.p, f.delivery)).verdict, "unverified");
});
test("Agent4 resumes inspection on the existing delivery, never reassembles or regenerates", async t => {
  const f = fixture(t); let assembleCalls = 0;
  f.deps.assemble = async () => { assembleCalls++; throw new Error("Must reuse delivery"); };
  f.deps.geminiReview = async () => { throw new Error("offline"); };
  const engine = createEngine(f.deps, f.store);
  engine.start(f.p, "assemble"); await engine.active.get(f.p.id);
  assert.equal(f.p.job.status, "failed"); assert.equal(f.p.deliveries.length, 1);
  f.deps.geminiReview = async () => clean();
  engine.start(f.p, "assemble"); await engine.active.get(f.p.id);
  assert.equal(f.p.job.status, "completed", f.p.job.error); assert.equal(assembleCalls, 0);
});
test("Gemini settings inherit credentials privately and reject non-Gemini models", t => {
  const f = fixture(t), settings = createSettings(f.root, { getGatewayConfig: () => ({ baseUrl: "https://gateway.example/v1", model: "gpt-test", apiKey: "never-public" }) });
  assert.equal(settings.runtime.getGeminiConfig().apiKey, "never-public");
  assert.ok(!JSON.stringify(settings.view()).includes("never-public"));
  assert.throws(() => settings.update({ services: { gemini: { model: "gpt-test" } } }));
  settings.update({ services: { gemini: { enabled: false, intervalSeconds: 1 } } });
  assert.equal(settings.view().services.gemini.enabled, false);
});
