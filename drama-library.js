"use strict";
const fs = require("node:fs");
const path = require("node:path");
const { randomUUID } = require("node:crypto");
const { fail } = require("./drama-media");
const { workspace } = require("./drama-workspace");
const uuid = value => /^[a-f0-9-]{36}$/.test(value);

function assetImpact(p, asset) {
  const ids = new Set([asset.id]);
  for (let i = 0; i < p.assets.length; i++) for (const a of p.assets) if (ids.has(a.identityMasterId)) ids.add(a.id);
  const shots = [], episodes = new Set();
  for (const ep of p.episodes) {
    let continuation = false;
    for (const s of ep.shots || []) {
      continuation = Boolean(s.assetIds?.some(id => ids.has(id)) || (p.production?.continuity && continuation && s.continuity?.type === "continue"));
      if (continuation) { shots.push(s); episodes.add(ep.id); }
    }
  }
  const records = [...p.assets.filter(a => ids.has(a.id)).map(a => a.image), ...shots.flatMap(s => [s.video, s.frame])].filter(Boolean);
  const unresolved = records.some(r => !r.file && ["unknown", "submitting", "processing", "created", "queueing"].includes(r.state));
  return { assetIds: [...ids], shotIds: shots.map(s => s.id), episodeIds: [...episodes], videoCount: shots.filter(s => s.video).length, unresolved };
}
function archiveImage(asset) {
  if (asset.image) { asset.imageHistory ||= []; asset.imageHistory.push(structuredClone(asset.image)); }
}
function invalidateAsset(p, asset, impact) {
  for (const a of p.assets.filter(a => a.id !== asset.id && impact.assetIds.includes(a.id))) { archiveImage(a); delete a.image; }
  for (const ep of p.episodes) for (const s of ep.shots || []) if (impact.shotIds.includes(s.id)) { delete s.frame; delete s.video; delete s.qc; if (s.continuity) delete s.continuity.anchor; }
  if (impact.shotIds.length && p.production?.continuity) delete p.production.pilotApproved;
  for (const d of p.deliveries) if (impact.episodeIds.includes(d.episodeId) || (impact.episodeIds.length && d.kind === "full-film")) d.stale = true;
}
function createLibrary(root, store, extraSources) {
  const dataDir = path.join(__dirname, "data");
  const definitions = extraSources || (path.dirname(path.resolve(root)) === path.resolve(dataDir) ? [
    { id: "drama", label: "红果原始工作区", root: path.join(dataDir, "drama"), port: 4328 },
    { id: "drama-realistic", label: "红果真人工作区", root: path.join(dataDir, "drama-realistic"), port: 4329 },
    { id: "gulf-story", label: "剧本成片工作区", root: path.join(dataDir, "gulf-story"), port: 4331 },
  ] : []);
  const sources = [{ id: "current", label: "当前工作区", root, store, editable: true }, ...definitions.filter(s => path.resolve(s.root) !== path.resolve(root) && fs.existsSync(s.root)).map(s => ({ ...s, editable: false }))];
  let cached, cacheKey, cachedAt = 0;
  function file(sourceId, projectId, relative) {
    const source = sources.find(s => s.id === sourceId);
    if (!source || !uuid(projectId) || !relative || path.isAbsolute(relative)) throw fail("素材路径无效。", 404);
    const base = path.resolve(source.root, projectId), out = path.resolve(base, relative);
    if (!out.startsWith(base + path.sep)) throw fail("素材路径无效。", 403);
    if (!fs.existsSync(out) || !fs.statSync(out).isFile()) throw fail("素材文件不存在。", 404);
    if (!fs.realpathSync(out).startsWith(fs.realpathSync(base) + path.sep)) throw fail("不允许跨目录素材链接。", 403);
    return out;
  }
  function project(source, id) { return source.editable ? store.get(id) : JSON.parse(fs.readFileSync(file(source.id, id, "project.json"), "utf8")); }
  function index() {
    const signature = JSON.stringify(sources.map(s => [s.id, ...fs.readdirSync(s.root).filter(uuid).map(id => {
      try { const stat = fs.statSync(path.join(s.root, id, "project.json")); return [id, stat.mtimeMs, stat.size]; }
      catch { return [id, null]; }
    })]));
    if (cached && signature === cacheKey && Date.now() - cachedAt < 30000) return cached;
    const all = { projects: [], items: [], characters: [], sources: sources.map(s => ({ id: s.id, label: s.label, editable: s.editable })), warnings: [] };
    for (const source of sources) {
      // Historical servers retain sole write ownership. Only read complete atomic JSON snapshots here.
      const ids = source.editable ? store.list().map(p => p.id) : fs.readdirSync(source.root).filter(uuid);
      const rows = [];
      for (const id of ids) {
        try { const p = project(source, id); if (p.id === id && !p.archived) rows.push(p); }
        catch { all.warnings.push(`${source.label}：项目 ${id} 暂不可读取。`); }
      }
      const lookup = new Map(rows.map(p => [p.id, p]));
      const reader = { list: () => rows.map(p => ({ id: p.id })), get: id => lookup.get(id), file: (id, relative) => file(source.id, id, relative) };
      const result = workspace(reader, source.root, {});
      const meta = p => ({ sourceId: source.id, sourceLabel: source.label, editable: source.editable, projectKey: `${source.id}:${p.id}`, projectUrl: source.editable ? `/drama.html#${p.id}` : `http://127.0.0.1:${source.port}/drama.html#${p.id}` });
      all.projects.push(...result.projects.map(p => ({ ...p, ...meta(p) })));
      all.items.push(...result.items.map(i => ({ ...i, ...meta({ id: i.projectId }), id: `${source.id}:${i.id}` })));
      for (const p of rows) {
        const seen = new Set(result.items.filter(i => i.projectId === p.id).map(i => i.file));
        const history = [...(p.ledger || []), ...p.assets.flatMap(a => (a.imageHistory || []).map(r => ({ ...r, historyName: a.name })))];
        for (const r of history) {
          if (!r.file || seen.has(r.file)) continue;
          try { file(source.id, p.id, r.file); } catch { continue; }
          const kind = path.extname(r.file).toLowerCase() === ".mp4" ? "video" : "image";
          if (![".mp4", ".png", ".jpg", ".jpeg", ".webp"].includes(path.extname(r.file).toLowerCase())) continue;
          seen.add(r.file);
          let previewFile = r.file;
          try { if (r.previewFile) { file(source.id, p.id, r.previewFile); previewFile = r.previewFile; } } catch { /* retain original download */ }
          all.items.push({ ...meta(p), id: `${source.id}:${p.id}:history:${r.id || r.file}`, projectId: p.id, projectTitle: p.title,
            kind, title: `${r.historyName || (kind === "video" ? "历史视频" : "历史图片")} · ${r.taskId || r.id || "旧版本"}`, description: r.request?.prompt || "历史版本，保留供查看与下载。", file: r.file, previewFile, model: r.model, stale: true });
        }
      }
      for (const p of rows) for (const a of p.assets.filter(a => a.type === "character")) {
        const image = result.items.find(i => i.assetId === a.id && i.projectId === p.id);
        all.characters.push({ id: `${source.id}:${p.id}:${a.id}`, assetId: a.id, projectId: p.id, projectTitle: p.title, ...meta(p),
          name: a.name, description: a.description || "", prompt: a.prompt, identityKey: a.identityKey || a.key || "", style: a.style || "",
          file: image?.file || "", previewFile: image?.previewFile || "", model: a.image?.model || "", imageState: a.image?.state || "empty",
          appearances: p.episodes.flatMap(e => (e.shots || []).filter(s => s.assetIds?.includes(a.id)).map(s => ({ id: s.id, episodeNumber: e.number, title: s.title || `${s.start}s` }))),
          history: (a.imageHistory || []).filter(r => { try { file(source.id, p.id, r.file); return true; } catch { return false; } }).map(r => ({ file: r.file, model: r.model, createdAt: r.createdAt || r.submittedAt })) });
      }
    }
    cached = all; cacheKey = signature; cachedAt = Date.now(); return all;
  }
  function importAsset(target, body) {
    const source = sources.find(s => s.id === body.sourceId);
    if (!source || !uuid(body.projectId) || !uuid(body.assetId)) throw fail("来源资产无效。");
    const p = project(source, body.projectId), a = p.assets.find(a => a.id === body.assetId);
    if (!a?.image?.file || !["character", "prop", "environment"].includes(a.type)) throw fail("仅可复用已保存的角色、道具或环境图。");
    const styles = [...new Set(target.episodes.map(e => e.style).filter(Boolean))];
    if (target.production && a.style && styles.length && !styles.includes(a.style)) throw fail("来源资产画风与目标制作项目不一致，请选择同风格项目。");
    if (target.assets.length >= 100) throw fail("单项目最多管理 100 项资产。");
    const original = file(source.id, p.id, a.image.file), ext = path.extname(original).toLowerCase();
    if (![".png", ".jpg", ".jpeg", ".webp"].includes(ext)) throw fail("仅支持图片资产。");
    const id = randomUUID(), relative = `generated/${id}${ext}`;
    const dest = store.file(target.id, relative); fs.mkdirSync(path.dirname(dest), { recursive: true }); fs.copyFileSync(original, dest);
    const asset = { id, name: a.name, description: a.description || "", type: a.type, prompt: a.prompt, style: a.style || "cinematic",
      key: `IMPORTED_${id.slice(0, 8)}`, identityKey: a.type === "character" ? `IMPORTED_${id.slice(0, 8)}` : "", identityMasterId: id,
      sourceAsset: { sourceId: source.id, projectId: p.id, assetId: a.id }, image: { id: randomUUID(), state: "success", file: relative, model: "library-import", createdAt: new Date().toISOString() } };
    target.assets.push(asset); store.save(target); return asset;
  }
  return { index, file, importAsset };
}
module.exports = { createLibrary, assetImpact, invalidateAsset, archiveImage };
