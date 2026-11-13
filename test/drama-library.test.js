"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const http = require("node:http");
const { randomUUID } = require("node:crypto");
const { execFile } = require("node:child_process");
const { promisify } = require("node:util");
const { createStore, createDramaRouter } = require("../drama-router");
const { createLibrary } = require("../drama-library");
function tmp(t) { const root = fs.mkdtempSync(path.join(os.tmpdir(), "siri-library-")); t.after(() => fs.rmSync(root, { recursive: true, force: true })); return root; }
function project(store, title) { const p = { id: randomUUID(), title, assets: [], episodes: [], ledger: [], deliveries: [], events: [], aspectRatio: "9:16", audio: true, rightsConfirmed: true }; store.save(p); return p; }
function file(store, p, name, bytes = "fixture") { const out = store.file(p.id, name); fs.mkdirSync(path.dirname(out), { recursive: true }); fs.writeFileSync(out, bytes); return name; }

test("unified library reads other workspaces without changing active job state and copies only selected reference", t => {
  const root = tmp(t), foreignRoot = tmp(t), store = createStore(root), foreign = createStore(foreignRoot);
  const p = project(foreign, "Original"), target = project(store, "Target");
  const a = { id: randomUUID(), type: "character", style: "cinematic", name: "Lead", prompt: "stable face", image: { id: randomUUID(), file: file(foreign, p, "generated/lead.png"), state: "success" } };
  p.assets.push(a); p.job = { status: "running" }; foreign.save(p);
  const before = fs.readFileSync(foreign.file(p.id), "utf8");
  const library = createLibrary(root, store, [{ id: "legacy", root: foreignRoot, label: "Legacy", port: 4329 }]);
  const index = library.index();
  assert.equal(index.characters.length, 1); assert.equal(index.characters[0].editable, false);
  assert.equal(index.characters[0].projectUrl, `http://127.0.0.1:4329/drama.html#${p.id}`);
  assert.equal(index.projects.find(s => s.id === p.id).job.status, "running");
  assert.equal(library.index(), index);
  const copied = library.importAsset(target, { sourceId: "legacy", projectId: p.id, assetId: a.id });
  assert.notEqual(copied.id, a.id); assert.equal(copied.identityMasterId, copied.id);
  assert.equal(fs.readFileSync(store.file(target.id, copied.image.file), "utf8"), "fixture");
  assert.equal(fs.readFileSync(foreign.file(p.id), "utf8"), before);
  assert.equal(library.index().characters.length, 2);
  assert.throws(() => library.file("legacy", p.id, "../settings.json"));
  assert.throws(() => library.importAsset(target, { sourceId: "invalid", projectId: p.id, assetId: a.id }));
});

test("character upload validates bytes, preserves image versions, invalidates dependent clips and full film only after confirmation", async t => {
  const root = tmp(t), router = createDramaRouter({}, { root });
  const p = project(router.store, "Character production");
  p.production = { continuity: true, pilotApproved: true };
  const png = path.join(root, "test.png");
  await promisify(execFile)("ffmpeg", ["-y", "-v", "error", "-f", "lavfi", "-i", "color=c=green:s=512x512", "-frames:v", "1", png], { windowsHide: true, timeout: 30000 });
  const bytes = fs.readFileSync(png);
  const leadId = randomUUID(), variantId = randomUUID(), shotId = randomUUID(), continuedId = randomUUID(), untouchedId = randomUUID(), episodeId = randomUUID();
  const lead = { id: leadId, type: "character", name: "Lead", prompt: "lead prompt", identityMasterId: leadId, image: { id: randomUUID(), state: "success", file: file(router.store, p, "generated/old.png", bytes) } };
  const variant = { id: variantId, type: "character", name: "Costume", prompt: "variant", identityMasterId: leadId, image: { id: randomUUID(), state: "success", file: file(router.store, p, "generated/costume.png", bytes) } };
  p.assets.push(lead, variant);
  p.episodes.push({ id: episodeId, number: 1, shots: [
    { id: shotId, assetIds: [variantId], frame: { file: "frame" }, video: { file: "old.mp4" } },
    { id: continuedId, assetIds: [], continuity: { type: "continue", anchor: "old-anchor" }, video: { file: "continuation.mp4" } },
    { id: untouchedId, assetIds: [], continuity: { type: "cut" }, video: { file: "keep.mp4" } },
  ] });
  p.deliveries.push({ episodeId, file: "episode.mp4", stale: false }, { kind: "full-film", episodeId: "full-film", file: "full.mp4", stale: false }); router.store.save(p);
  const server = http.createServer((req, res) => router.route(req, res)); await new Promise(resolve => server.listen(0, "127.0.0.1", resolve)); t.after(() => new Promise(resolve => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}/api/drama`, route = `${base}/projects/${p.id}/assets/${lead.id}`;
  const post = (url, body, method = "POST") => fetch(url, { method, headers: { "Content-Type": Buffer.isBuffer(body) ? "image/png" : "application/json" }, body: Buffer.isBuffer(body) ? body : JSON.stringify(body) });
  const before = fs.readFileSync(router.store.file(p.id), "utf8");
  assert.equal((await post(`${route}/image`, bytes)).status, 400);
  assert.equal((await post(`${route}/image?confirm=true`, Buffer.from("not an image"))).status, 400);
  assert.equal(fs.readFileSync(router.store.file(p.id), "utf8"), before);
  const uploaded = await post(`${route}/image?confirm=true`, bytes); assert.equal(uploaded.status, 200, await uploaded.clone().text());
  assert.equal(lead.imageHistory.length, 1); assert.equal(variant.imageHistory.length, 1); assert.equal(variant.image, undefined);
  assert.ok(fs.existsSync(router.store.file(p.id, lead.imageHistory[0].file)));
  assert.ok(fs.existsSync(router.store.file(p.id, lead.image.file)));
  assert.equal(p.episodes[0].shots[0].video, undefined); assert.equal(p.episodes[0].shots[1].video, undefined);
  assert.equal(p.episodes[0].shots[2].video.file, "keep.mp4"); assert.ok(p.deliveries.every(d => d.stale));
  assert.equal(p.production.pilotApproved, undefined);
  const currentFile = lead.image.file;
  assert.equal((await post(`${route}/profile`, { name: "Display name", description: "Role biography" }, "PATCH")).status, 200);
  assert.equal(lead.image.file, currentFile); assert.equal(lead.id, leadId); assert.equal(lead.description, "Role biography");
  assert.equal((await post(`${route}/cast`, { shotIds: [untouchedId] }, "PUT")).status, 400);
  assert.equal((await post(`${route}/cast`, { shotIds: [untouchedId], confirm: true }, "PUT")).status, 200);
  assert.ok(p.episodes[0].shots[2].assetIds.includes(leadId)); assert.equal(p.episodes[0].shots[2].video, undefined);
  lead.image = { state: "unknown", taskId: "uncertain" }; router.store.save(p);
  assert.equal((await post(`${route}/image?confirm=true`, bytes)).status, 409);
  assert.equal((await fetch(`${base}/library/files/current/${p.id}/project.json`)).status, 403);
});
