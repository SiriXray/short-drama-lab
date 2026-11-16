"use strict";

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { Transform } = require("node:stream");
const { pipeline } = require("node:stream/promises");
const { execFile } = require("node:child_process");
const { promisify } = require("node:util");
const archiver = require("archiver");
const media = require("./drama-media");
const { createEngine } = require("./drama-engine");
const { STYLES, productionConfig } = require("./drama-production");
const { createSettings } = require("./drama-settings");
const { records, preflight, workspace } = require("./drama-workspace");
const { createLibrary, assetImpact, invalidateAsset, archiveImage } = require("./drama-library");
const { buildVideoRequest, taskPath } = require("./drama-video-models");
const uuid = () => crypto.randomUUID();
const text = (value, max = 3000) => String(value ?? "").trim().slice(0, max);
const validId = value => /^[a-f0-9-]{36}$/.test(value);
const bytesLimit = 500 * 1024 * 1024;
const MIN_PREVIEW_SECONDS = 20;

// Hongguo's public web player only exposes a ~10 s preview clip; full episodes sit
// behind the app's protected playback endpoint, so say that instead of a generic 403.
function previewOnlyMessage(inputUrl) {
  let hostname = "";
  try { hostname = new URL(String(inputUrl || "")).hostname.replace(/^www\./, ""); } catch { hostname = ""; }
  if (hostname === "hongguoduanju.com") return "红果网页端只公开约 10 秒预告，完整集在 App 内受保护，无法通过公开网页获取。请改用授权片源：本地完整分集文件，或可访问的直链 / HLS。";
  return "网页没有公开可下载的完整视频，请补充授权片源（本地文件、直链或 HLS m3u8）。";
}

function createStore(root) {
  fs.mkdirSync(root, { recursive: true });
  const cache = new Map();
  function file(projectId, relative = "project.json") {
    if (!validId(projectId) || !relative || path.isAbsolute(relative)) throw media.fail("无效素材路径。");
    const base = path.resolve(root, projectId);
    const result = path.resolve(base, relative);
    if (!result.startsWith(base + path.sep)) throw media.fail("无效素材路径。", 403);
    return result;
  }
  function save(p) {
    p.updatedAt = new Date().toISOString();
    const currentRecords = records(p);
    p.ledger = p.ledger.map(old => currentRecords.find(r => r.id === old.id) || old);
    const filename = file(p.id);
    fs.mkdirSync(path.dirname(filename), { recursive: true });
    fs.writeFileSync(`${filename}.tmp`, JSON.stringify(p, null, 2));
    fs.renameSync(`${filename}.tmp`, filename);
    cache.set(p.id, p);
    return p;
  }
  function get(projectId) {
    if (cache.has(projectId)) return cache.get(projectId);
    const filename = file(projectId);
    if (!fs.existsSync(filename)) throw media.fail("项目不存在。", 404);
    const p = JSON.parse(fs.readFileSync(filename, "utf8"));
    if (p.job?.status === "running") {
      p.job.status = "interrupted";
      p.job.error = "服务曾中断。继续运行将查询已保存的生成任务；提交状态未知时需先核对。";
      save(p);
    }
    cache.set(projectId, p); return p;
  }
  function list(includeArchived = false) {
    return fs.readdirSync(root).filter(validId).flatMap(projectId => {
      try { const p = get(projectId); return p.archived && !includeArchived ? [] : [{ id: p.id, title: p.title, updatedAt: p.updatedAt, episodeCount: p.episodes.length, job: p.job }]; }
      catch { return []; }
    }).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }
  return { file, get, save, list };
}

function invalidate(p, episodeIds) {
  for (const d of p.deliveries) if (!episodeIds || episodeIds.includes(d.episodeId)) d.stale = true;
  if (p.uploadWorkflow) delete p.uploadWorkflow.productionProjectId;
}

function invalidateContinuations(p, ep, index) {
  if (!p.production?.continuity) return;
  delete p.production.pilotApproved;
  for (const s of ep.shots.slice(index + 1)) {
    if (s.continuity?.type !== "continue") break;
    delete s.video; delete s.qc; delete s.continuity.anchor;
    if (s.frame?.model === "continuity-frame") delete s.frame;
  }
}

async function readBody(req) {
  const chunks = []; let bytes = 0;
  for await (const chunk of req) {
    bytes += chunk.length;
    if (bytes > 2 * 1024 * 1024) throw media.fail("请求内容过大。", 413);
    chunks.push(chunk);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}"); }
  catch { throw media.fail("JSON 格式无效。"); }
}

function streamFile(req, res, filename, type, download = false) {
  const size = fs.statSync(filename).size;
  const range = req.headers.range;
  const headers = { "Content-Type": type, "Accept-Ranges": "bytes", "X-Content-Type-Options": "nosniff", "Cache-Control": "private, no-cache" };
  if (download) headers["Content-Disposition"] = `attachment; filename="${path.basename(filename).replace(/[^a-zA-Z0-9_.-]/g, "_")}"`;
  let start = 0, end = size - 1;
  if (range) {
    const match = /^bytes=(\d*)-(\d*)$/.exec(range);
    if (!match || (!match[1] && !match[2])) { res.writeHead(416, { "Content-Range": `bytes */${size}` }); res.end(); return; }
    start = match[1] ? Number(match[1]) : Math.max(0, size - Number(match[2]));
    end = match[1] && match[2] ? Math.min(size - 1, Number(match[2])) : size - 1;
    if (start > end || start >= size) { res.writeHead(416, { "Content-Range": `bytes */${size}` }); res.end(); return; }
    headers["Content-Range"] = `bytes ${start}-${end}/${size}`;
  }
  headers["Content-Length"] = end - start + 1;
  res.writeHead(range ? 206 : 200, headers);
  const stream = fs.createReadStream(filename, { start, end });
  stream.on("error", () => res.destroy());
  res.on("close", () => stream.destroy());
  stream.pipe(res);
}

function createDramaRouter(deps, options = {}) {
  const root = options.root || path.join(__dirname, "data", "drama");
  const store = createStore(root);
  const settings = createSettings(root, deps);
  const library = createLibrary(root, store, options.librarySources);
  deps = settings.runtime;
  const engine = createEngine({ ...deps, concurrency: options.concurrency || deps.concurrency, importEpisode }, store);
  const locks = new Set();
  const importJobs = new Map();
  let catalog = null;
  const catalogFile = path.join(root, "catalog.json");
  try { catalog = JSON.parse(fs.readFileSync(catalogFile, "utf8")); } catch { /* no imported source yet */ }
  const send = (res, status, value) => { res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" }); res.end(JSON.stringify(value)); };
  const listEnv = name => (process.env[name] || "").split(",").map(value => value.trim().toLowerCase()).filter(Boolean);
  function hostName(host) {
    const value = String(host || "").trim().toLowerCase();
    if (value.startsWith("[")) return value.replace(/^\[([^\]]+)\](?::\d+)?$/, "$1");
    return value.replace(/:\d+$/, "");
  }
  function guard(req) {
    const host = req.headers.host || "";
    const name = hostName(host);
    const local = /^(127\.0\.0\.1|localhost|::1)$/.test(name);
    // A reverse-proxied deployment (public HTTPS host) must opt in explicitly.
    if (!local && !listEnv("DRAMA_ALLOWED_HOSTS").includes(name)) throw media.fail("工作台仅限本机访问。", 403);
    const origin = req.headers.origin;
    if (origin) {
      const allowed = new Set([`http://${host}`, `https://${host}`, ...listEnv("DRAMA_PUBLIC_ORIGINS")]);
      if (!allowed.has(origin.toLowerCase())) throw media.fail("不允许跨站请求。", 403);
    }
    if (req.headers["sec-fetch-site"] === "cross-site") throw media.fail("不允许跨站请求。", 403);
  }
  function idle(p) { if (engine.active.has(p.id)) throw media.fail("运行中不可修改，请先暂停。", 409); }
  async function downloadEpisode(p, ep, url, options = {}) {
    const extension = ".mp4";
    const rel = `episodes/${ep.id}-${uuid()}${extension}`;
    const destination = store.file(p.id, rel);
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    try {
      if ((deps.isHlsUrl || media.isHlsUrl)(url)) {
        await (deps.downloadHls || media.downloadHls)(url, deps.isPrivateAddress, { destination, limit: bytesLimit, onProgress: ({ index, total }) => { if (index === total || index % 50 === 0) console.log(`[hls] ${ep.id} ${index}/${total} segments`); } });
      } else {
        await (deps.remoteContent || media.remoteContent)(url, deps.isPrivateAddress, { destination, limit: bytesLimit });
      }
      const metadata = await (deps.probe || media.probe)(destination);
      if (metadata.duration > 900) throw media.fail("每集最多 15 分钟，请分段导入。");
      if (metadata.duration < MIN_PREVIEW_SECONDS && options.allowPreview !== true) {
        throw media.fail(`该片源只有 ${Math.max(1, Math.round(metadata.duration))} 秒，通常是平台预览片而不是完整集。请提供完整片源，或显式允许导入短视频。`, 422);
      }
      ep.file = rel; ep.metadata = metadata; ep.videoUrl = url; ep.access = "ready"; ep.error = "";
      ep.preview = metadata.duration < MIN_PREVIEW_SECONDS;
      ep.shots = []; ep.summary = ""; invalidate(p, [ep.id]); store.save(p);
    } catch (error) {
      fs.rmSync(destination, { force: true });
      throw error;
    }
  }
  async function importEpisodeUrl(p, ep, sourceUrl, options = {}) {
    let videoUrl = sourceUrl;
    if (!/\.(mp4|mov|webm|m3u8)(?:\?|$)/i.test(sourceUrl) && options.direct !== true) {
      const source = await (deps.remoteContent || media.remoteContent)(sourceUrl, deps.isPrivateAddress);
      const items = media.parseCatalog(source.buffer.toString("utf8"), source.contentType, source.url);
      videoUrl = items.flatMap(item => item.episodes).find(e => e.videoUrl)?.videoUrl;
      if (!videoUrl) throw media.fail(previewOnlyMessage(sourceUrl), 403);
    }
    await downloadEpisode(p, ep, videoUrl, { allowPreview: options.allowPreview === true });
    ep.sourceUrl = sourceUrl;
    if (!p.episodes.some(e => e.id === ep.id)) p.episodes.push(ep);
    return ep;
  }
  // Server-side batch import: keeps going when the browser is closed and reports
  // per-URL failures instead of aborting the whole list.
  function startImportJob(p, urls, options) {
    const state = { status: "running", total: urls.length, done: 0, failed: [], startedAt: new Date().toISOString(), current: "" };
    importJobs.set(p.id, state);
    (async () => {
      for (let index = 0; index < urls.length; index += 1) {
        if (state.status !== "running") break;
        const sourceUrl = urls[index];
        state.current = sourceUrl;
        const ep = { id: uuid(), number: Math.max(0, ...p.episodes.map(e => e.number)) + 1, title: `${options.title || "链接分集"} ${index + 1}`, shots: [], transcript: "", access: "pending" };
        try {
          await importEpisodeUrl(p, ep, sourceUrl, options);
          state.done += 1;
        } catch (error) {
          state.failed.push({ url: sourceUrl, error: text(error.message, 300) });
        }
        try { store.save(p); } catch (error) { state.status = "failed"; state.error = text(error.message, 300); break; }
      }
      if (state.status === "running") state.status = "completed";
      state.current = "";
    })().catch(error => { state.status = "failed"; state.error = text(error.message, 300); });
    return state;
  }
  async function importEpisode(p, ep) {
    try {
      let videoUrl = ep.videoUrl;
      if (!videoUrl) {
        const source = await (deps.remoteContent || media.remoteContent)(ep.pageUrl, deps.isPrivateAddress);
        const items = media.parseCatalog(source.buffer.toString("utf8"), source.contentType, source.url);
        videoUrl = items.flatMap(item => item.episodes).find(e => e.videoUrl)?.videoUrl;
      }
      if (!videoUrl) throw media.fail(previewOnlyMessage(ep.pageUrl), 403);
      await downloadEpisode(p, ep, videoUrl);
    } catch (error) { ep.error = text(error.message); ep.access = "permission-required"; store.save(p); throw error; }
  }
  async function route(req, res) {
    const url = new URL(req.url, "http://localhost");
    if (!url.pathname.startsWith("/api/drama/") && url.pathname !== "/vendor/lucide.js") return false;
    let locked;
    try {
      guard(req);
      if (url.pathname === "/vendor/lucide.js") {
        streamFile(req, res, path.join(__dirname, "node_modules/lucide/dist/umd/lucide.js"), "text/javascript; charset=utf-8"); return true;
      }
      const routePath = url.pathname.slice("/api/drama".length);
      if (routePath === "/health" && req.method === "GET") {
        const binaries = {};
        for (const key of ["ffmpeg", "ffprobe"]) {
          try { await promisify(execFile)(process.env[`${key.toUpperCase()}_PATH`] || key, ["-version"], { timeout: 10000, windowsHide: true }); binaries[key] = true; }
          catch { binaries[key] = false; }
        }
        send(res, 200, { brand: "SIRIHOTDRAMA", workspaceVersion: 1, uploadWorkflowVersion: 1, visualReviewVersion: 1, geminiConfigured: Boolean(deps.getGeminiConfig?.()?.apiKey), llmConfigured: Boolean(deps.getGatewayConfig().apiKey), viduConfigured: Boolean(deps.getViduConfig().apiKey), model: deps.getGatewayConfig().model, ...binaries, activeJobs: engine.active.size, continuityVersion: 1, concurrencyVersion: 1, concurrency: engine.concurrency() }); return true;
      }
      if (routePath === "/settings") {
        if (req.method === "GET") { send(res, 200, settings.view()); return true; }
        if (req.method === "PATCH") {
          const body = await readBody(req);
          const hasMediaTasks = store.list(true).some(s => [...store.get(s.id).ledger, ...records(store.get(s.id))].some(r => r.taskId || ["unknown", "submitting"].includes(r.state)));
          send(res, 200, settings.update(body, { active: engine.active.size > 0, hasMediaTasks })); return true;
        }
      }
      if (routePath === "/settings/probe" && req.method === "POST") {
        if (locks.has("probe")) throw media.fail("正在检测服务，请稍候。", 409);
        locks.add("probe"); locked = "probe";
        const body = await readBody(req);
        const taskId = body.kind !== "text" ? store.list().flatMap(s => store.get(s.id).ledger).find(r => r.taskId && (r.provider || "vidu") === body.kind)?.taskId : undefined;
        send(res, 200, await settings.probe(body.kind, taskId)); return true;
      }
      if (routePath === "/workspace" && req.method === "GET") {
        send(res, 200, workspace(store, root, engine.concurrency())); return true;
      }
      if (routePath === "/library" && req.method === "GET") { send(res, 200, library.index()); return true; }
      const libraryFile = /^\/library\/files\/([a-z-]+)\/([a-f0-9-]{36})\/(.+)$/.exec(routePath);
      if (libraryFile && req.method === "GET") {
        const relative = decodeURIComponent(libraryFile[3]);
        const type = { ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png", ".webp": "image/webp", ".mp4": "video/mp4" }[path.extname(relative).toLowerCase()];
        if (!type) throw media.fail("素材类型不支持。", 403);
        streamFile(req, res, library.file(libraryFile[1], libraryFile[2], relative), type, url.searchParams.has("download")); return true;
      }
      if (routePath === "/catalog") {
        if (req.method === "GET") { send(res, 200, catalog || { items: [], sourceUrl: "", capturedAt: null }); return true; }
        if (req.method === "POST") {
          if (locks.has("catalog")) throw media.fail("榜单正在更新。", 409);
          locks.add("catalog"); locked = "catalog";
          const body = await readBody(req);
          const sourceUrl = media.publicUrl(text(body.url, 2048)).href;
          if (catalog?.sourceUrl === sourceUrl && Date.now() - Date.parse(catalog.capturedAt) < 60000) { send(res, 200, catalog); return true; }
          const source = await (deps.remoteContent || media.remoteContent)(sourceUrl, deps.isPrivateAddress);
          const items = media.sortCatalog(media.parseCatalog(source.buffer.toString("utf8"), source.contentType, source.url), body.metric || "heat");
          catalog = { sourceUrl, capturedAt: new Date().toISOString(), metric: body.metric || "heat", items };
          fs.writeFileSync(`${catalogFile}.tmp`, JSON.stringify(catalog, null, 2)); fs.renameSync(`${catalogFile}.tmp`, catalogFile);
          send(res, 200, catalog); return true;
        }
      }
      if (routePath === "/projects") {
        if (req.method === "GET") { send(res, 200, { projects: store.list() }); return true; }
        if (req.method === "POST") {
          const body = await readBody(req);
          const p = { id: uuid(), title: text(body.title, 160) || "新短剧项目", brief: text(body.brief, 6000), aspectRatio: "9:16", videoMode: "img2video", audio: true,
            rightsConfirmed: body.rightsConfirmed === true, creativeSettings: settings.creative(), maxShotSeconds: 8, createdAt: new Date().toISOString(), episodes: [], assets: [], ledger: [], deliveries: [], events: [], job: null };
          if (body.uploadIntent !== undefined) {
            if (!["analyze", "remake"].includes(body.uploadIntent) || body.catalogIndex !== undefined) throw media.fail("上传工作流类型无效。");
            p.sourceKind = "user-video";
            p.uploadWorkflow = { intent: body.uploadIntent };
          }
          if (body.catalogIndex !== undefined) {
            const source = catalog?.items?.[Number(body.catalogIndex)];
            if (!source) throw media.fail("请刷新榜单后重新选择。");
            if (source.episodes.length > 100) throw media.fail("来源超过 100 集，请分项目导入，不会自动截断目录。");
            p.title = text(body.title, 160) || source.title; p.source = { ...source, episodes: undefined };
            p.episodes = source.episodes.map(ep => ({ ...ep, id: uuid(), sourceUrl: ep.pageUrl || source.sourceUrl, shots: [], access: ep.videoUrl || ep.pageUrl ? "pending" : "permission-required" }));
          }
          store.save(p); send(res, 201, p); return true;
        }
      }
      const fileMatch = /^\/files\/([a-f0-9-]{36})\/(.+)$/.exec(routePath);
      if (fileMatch && req.method === "GET") {
        const relative = decodeURIComponent(fileMatch[2]);
        const filename = store.file(fileMatch[1], relative);
        const types = { ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp", ".png": "image/png", ".mp4": "video/mp4", ".json": "application/json" };
        if (!types[path.extname(filename)] || relative === "project.json") throw media.fail("素材类型不支持。", 403);
        if (!fs.existsSync(filename)) throw media.fail("素材不存在。", 404);
        streamFile(req, res, filename, types[path.extname(filename)], url.searchParams.has("download")); return true;
      }
      const match = /^\/projects\/([a-f0-9-]{36})(?:\/(.*))?$/.exec(routePath);
      if (!match) throw media.fail("接口不存在。", 404);
      const p = store.get(match[1]); const action = match[2] || "";
      if (req.method !== "GET") {
        if (locks.has(p.id)) throw media.fail("项目正在保存或导入，请稍后再试。", 409);
        locks.add(p.id); locked = p.id;
      }
      if (!action && req.method === "GET") { send(res, 200, { ...p, import: importJobs.get(p.id) || null }); return true; }
      if (action === "trials" && req.method === "POST") {
        const body = await readBody(req);
        if (body.confirmPaid !== true || !validId(body.id)) throw media.fail("请确认计费并提供有效的请求 ID。");
        const existing = p.modelTrials?.find(t => t.id === body.id);
        if (existing) { send(res, 200, existing); return true; }
        idle(p);
        if (!p.rightsConfirmed) throw media.fail("请先在项目中确认素材使用权限。");
        if ((p.modelTrials?.length || 0) >= 100) throw media.fail("单项目最多保留 100 条模型试跑。");
        const input = Object.fromEntries(["provider", "mode", "prompt", "images", "duration", "resolution", "ratio"].map(k => [k, body[k]]));
        const request = buildVideoRequest(input);
        const fingerprint = crypto.createHash("sha256").update(JSON.stringify(request)).digest("hex");
        if (p.modelTrials?.some(t => t.fingerprint === fingerprint && t.video && !t.video.file && t.video.state !== "failed")) throw media.fail("同参数任务尚未核对或未完成，请续接原任务，避免重复计费。", 409);
        if (!settings.config(input.provider).apiKey) throw media.fail("请先在 AI 服务中配置模型密钥。", 503);
        const capacity = engine.concurrency().projects;
        if (capacity.active >= capacity.limit) throw media.fail("当前项目并发已满，尚未提交，请稍后重试。", 429);
        const trial = { id: body.id, input, ...request, fingerprint, createdAt: new Date().toISOString() };
        p.modelTrials ||= []; p.modelTrials.push(trial); store.save(p);
        engine.startTrial(p, trial); send(res, 202, trial); return true;
      }
      const trialAction = /^trials\/([a-f0-9-]{36})\/(resume|task)$/.exec(action);
      if (trialAction && req.method === "POST") {
        idle(p);
        const trial = p.modelTrials?.find(t => t.id === trialAction[1]);
        if (!trial) throw media.fail("试跑记录不存在。", 404);
        if (trialAction[2] === "task") {
          const body = await readBody(req);
          if (!trial.video || trial.video.taskId || !["unknown", "submitting"].includes(trial.video.state)) throw media.fail("仅可为提交结果未知且没有 ID 的任务补录任务 ID。");
          taskPath(trial.input.provider, body.taskId);
          const task = await deps.videoClient.poll(trial.input.provider, body.taskId, trial.video.baseUrl);
          Object.assign(trial.video, task, { error: "" }); store.save(p);
        } else {
          if (!trial.video?.taskId && trial.video) throw media.fail("请先在服务商控制台核对并补录任务 ID，不能重复提交。", 409);
          // A queued draft with no upstream submission still needs explicit billing confirmation.
          if (!trial.video && (await readBody(req)).confirmPaid !== true) throw media.fail("此记录尚未提交，请确认计费。");
          engine.startTrial(p, trial);
        }
        send(res, 202, trial); return true;
      }
      if (action === "assets/import" && req.method === "POST") {
        idle(p); const body = await readBody(req);
        send(res, 201, library.importAsset(p, body)); return true;
      }
      if (action === "assets" && req.method === "POST") {
        idle(p); const body = await readBody(req);
        if (!text(body.name, 120) || !text(body.prompt, 10000)) throw media.fail("请填写角色名称与外观提示词。");
        if (p.assets.length >= 100) throw media.fail("单项目最多管理 100 项资产。");
        const id = uuid(), style = body.style || "cinematic";
        if (!STYLES[style]) throw media.fail("视觉风格无效。");
        const asset = { id, name: text(body.name, 120), type: "character", prompt: text(body.prompt, 10000), description: text(body.description, 3000), style,
          key: `CHAR_${id.slice(0, 8)}`, identityKey: `CHAR_${id.slice(0, 8)}`, identityMasterId: id };
        p.assets.push(asset); store.save(p); send(res, 201, asset); return true;
      }
      const managedAsset = /^assets\/([a-f0-9-]{36})\/(profile|image|impact|cast)$/.exec(action);
      if (managedAsset) {
        const asset = p.assets.find(a => a.id === managedAsset[1]);
        if (!asset) throw media.fail("资产不存在。", 404);
        const operation = managedAsset[2], impact = assetImpact(p, asset);
        if (operation === "impact" && req.method === "GET") { send(res, 200, impact); return true; }
        idle(p);
        if (operation === "profile" && req.method === "PATCH") {
          const body = await readBody(req);
          if (!text(body.name, 120)) throw media.fail("角色展示名称不能为空。");
          asset.name = text(body.name, 120); asset.description = text(body.description, 3000);
          store.save(p); send(res, 200, asset); return true;
        }
        if (operation === "cast" && req.method === "PUT") {
          const body = await readBody(req), allShots = p.episodes.flatMap(e => e.shots || []);
          if (!Array.isArray(body.shotIds) || body.shotIds.some(id => !allShots.some(s => s.id === id))) throw media.fail("出场镜头无效。");
          const changed = allShots.filter(s => Boolean(s.assetIds?.includes(asset.id)) !== body.shotIds.includes(s.id));
          if (changed.length && body.confirm !== true) throw media.fail("请确认出场调整会使相关镜头素材失效。");
          const affected = new Set(changed);
          for (const ep of p.episodes) {
            let prior = false;
            for (const s of ep.shots || []) { prior = affected.has(s) || Boolean(p.production?.continuity && prior && s.continuity?.type === "continue"); if (prior) affected.add(s); }
          }
          if (impact.unresolved || [...affected].some(s => [s.frame, s.video].some(r => r && !r.file && ["unknown", "submitting", "processing", "created", "queueing"].includes(r.state)))) throw media.fail("相关任务尚未核对完成，不能修改出场镜头。", 409);
          for (const s of changed) if (body.shotIds.includes(s.id) && (s.assetIds || []).length >= 14) throw media.fail("镜头参考资产已达14项，请先减少参考图。");
          for (const ep of p.episodes) for (const s of ep.shots || []) if (changed.includes(s)) {
            s.assetIds = (s.assetIds || []).filter(id => id !== asset.id);
            if (body.shotIds.includes(s.id)) s.assetIds.push(asset.id);
            delete s.frame; delete s.video; delete s.qc; if (s.continuity) delete s.continuity.anchor;
            invalidate(p, [ep.id]); invalidateContinuations(p, ep, ep.shots.indexOf(s));
          }
          if (changed.length) for (const d of p.deliveries) if (d.kind === "full-film") d.stale = true;
          store.save(p); send(res, 200, { changed: changed.length }); return true;
        }
        if (operation === "image" && req.method === "POST") {
          if (impact.unresolved) throw media.fail("相关任务仍在生成或提交结果未知，请先核对。", 409);
          if ((asset.image || impact.shotIds.length) && url.searchParams.get("confirm") !== "true") throw media.fail("请确认替换参考图及相关镜头失效。");
          const chunks = []; let size = 0;
          for await (const chunk of req) { size += chunk.length; if (size > 12 * 1024 * 1024) throw media.fail("图片不能超过12MB。", 413); chunks.push(chunk); }
          const bytes = Buffer.concat(chunks), subtype = bytes[0] === 255 && bytes[1] === 216 ? "jpg" : bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) ? "png" : "";
          if (!subtype) throw media.fail("请上传有效的 JPG 或 PNG 图片。");
          (deps.validateViduImageBuffer || require("./server").validateViduImageBuffer)(bytes, subtype);
          const id = uuid(), rel = `generated/${id}.png`, output = store.file(p.id, rel), input = `${output}.upload.${subtype}`;
          fs.mkdirSync(path.dirname(output), { recursive: true }); fs.writeFileSync(input, bytes);
          try {
            await promisify(execFile)(process.env.FFMPEG_PATH || "ffmpeg", ["-y", "-v", "error", "-i", input, "-frames:v", "1", "-vf", "scale=w='min(2560,iw)':h='min(2560,ih)':force_original_aspect_ratio=decrease", output], { windowsHide: true, timeout: 30000, maxBuffer: 1024 * 1024 });
            if (fs.statSync(output).size > 12 * 1024 * 1024) throw new Error("too large");
          } catch { if (fs.existsSync(output)) fs.unlinkSync(output); throw media.fail("图片解码失败或解码后超过12MB，请换一张标准 JPG / PNG。"); }
          finally { fs.unlinkSync(input); }
          archiveImage(asset); invalidateAsset(p, asset, impact);
          asset.image = { id, state: "success", file: rel, model: "user-provided", createdAt: new Date().toISOString() };
          p.ledger.push(asset.image); store.save(p); send(res, 200, { asset, impact }); return true;
        }
        throw media.fail("接口方法不支持。", 405);
      }
      if (action === "preflight" && req.method === "POST") {
        const body = await readBody(req);
        const plan = preflight(p, body.stage || "all", body.episodeIds, store);
        if (["all", "assemble"].includes(plan.stage) && deps.getGeminiConfig?.()?.enabled) plan.warnings.push("拼接完成后自动调用 Gemini 计费质检，最多抽取240帧；发现问题仅标记复核，不自动重新生成视频。");
        send(res, 200, plan); return true;
      }
      if (action === "production" && req.method === "POST") {
        idle(p);
        const body = await readBody(req);
        if (body.requestId !== undefined && !validId(body.requestId)) throw media.fail("制作请求 ID 无效。");
        const previous = body.requestId && p.productionCopies?.find(c => c.requestId === body.requestId);
        if (previous) { send(res, 200, store.get(previous.projectId)); return true; }
        if (!Array.isArray(body.episodes) || !body.episodes.length || body.episodes.length > 100 || new Set(body.episodes.map(e => e.id)).size !== body.episodes.length) throw media.fail("请选择不重复的制作分集。");
        const config = productionConfig(body);
        const episodes = body.episodes.map(input => {
          const ep = p.episodes.find(e => e.id === input.id);
          if (!ep || !ep.file || !STYLES[input.style]) throw media.fail("分集或视觉风格无效。");
          const shots = ep.sourceShots || ep.shots;
          if (!shots?.length || shots.some(s => !s.analysis) || !ep.summary) throw media.fail(`第 ${ep.number} 集尚未完成逐集拉片。`);
          const result = structuredClone(ep);
          result.shots = structuredClone(shots); result.style = input.style;
          delete result.sourceShots; delete result.narrative; delete result.assetIds;
          for (const s of result.shots) for (const key of ["video", "frame", "prompt", "imagePrompt", "assetIds", "qc"]) delete s[key];
          return result;
        }).sort((a, b) => a.number - b.number);
        const copy = { id: uuid(), title: text(body.title, 160) || `${p.title} · ${episodes.length} 集制作`, brief: text(`${p.brief || ""}\n按原片叙事机制进行视觉重构；未知对白不冒充原台词。`, 6000),
          rightsConfirmed: p.rightsConfirmed, aspectRatio: "9:16", videoMode: "img2video", audio: true, maxShotSeconds: 8,
          production: { ...config, sourceProjectId: p.id, createdAt: new Date().toISOString() }, source: p.source, creativeSettings: settings.creative(),
          createdAt: new Date().toISOString(), episodes, assets: [], ledger: [], deliveries: [], events: [], job: null };
        const files = new Set(episodes.flatMap(e => [e.file, ...e.shots.flatMap(s => (s.frames || []).map(f => f.file))]));
        for (const relative of files) if (!fs.existsSync(store.file(p.id, relative))) throw media.fail("原片或关键帧丢失，请重新导入拉片。", 404);
        for (const relative of files) {
          const dest = store.file(copy.id, relative); fs.mkdirSync(path.dirname(dest), { recursive: true });
          fs.copyFileSync(store.file(p.id, relative), dest);
        }
        store.save(copy);
        if (body.requestId) { p.productionCopies ||= []; p.productionCopies.push({ requestId: body.requestId, projectId: copy.id }); }
        if (p.uploadWorkflow) p.uploadWorkflow.productionProjectId = copy.id;
        store.save(p); send(res, 201, copy); return true;
      }
      if (!action && req.method === "PATCH") {
        idle(p); const body = await readBody(req);
        if (p.production && ["brief", "aspectRatio", "videoMode", "maxShotSeconds"].some(k => body[k] !== undefined && body[k] !== p[k])) throw media.fail("制作副本的风格和路由已锁定；请从原片项目新建制作副本。");
        if (body.aspectRatio !== undefined && !["9:16", "16:9", "1:1"].includes(body.aspectRatio)) throw media.fail("画幅无效。");
        if (body.videoMode !== undefined && !["img2video", "reference2video"].includes(body.videoMode)) throw media.fail("视频模式无效。");
        if (body.maxShotSeconds !== undefined && ![5, 8, 12, 16].includes(Number(body.maxShotSeconds))) throw media.fail("镜头窗口无效。");
        if (body.title !== undefined) p.title = text(body.title, 160) || p.title;
        if (body.rightsConfirmed !== undefined) p.rightsConfirmed = body.rightsConfirmed === true;
        if (body.archived !== undefined) p.archived = body.archived === true;
        for (const key of ["brief", "aspectRatio", "videoMode", "audio", "maxShotSeconds"]) {
          const value = key === "brief" ? text(body[key], 6000) : key === "audio" ? body[key] === true : body[key];
          if (body[key] !== undefined && p[key] !== value) {
            p[key] = value; invalidate(p);
            for (const ep of p.episodes) for (const s of ep.shots || []) {
              if (["brief", "aspectRatio"].includes(key)) { delete s.frame; delete s.prompt; delete s.imagePrompt; }
              if (key !== "maxShotSeconds") delete s.video;
            }
            if (["brief", "aspectRatio"].includes(key)) p.assets = [];
          }
        }
        store.save(p); send(res, 200, p); return true;
      }
      if (action === "run" && req.method === "POST") {
        const body = await readBody(req);
        engine.start(p, body.stage || "all", body.episodeIds); send(res, 202, p); return true;
      }
      const reviewMatch = /^deliveries\/([a-f0-9-]{36})\/review$/.exec(action);
      if (reviewMatch && req.method === "POST") {
        const body = await readBody(req);
        if (body.confirmPaid !== true) throw media.fail("请确认 Gemini 质检计费；不会重新生成视频。");
        const delivery = p.deliveries.find(d => d.id === reviewMatch[1]);
        if (!delivery) throw media.fail("成片不存在。", 404);
        engine.startDeliveryReview(p, delivery, { force: body.force === true });
        send(res, 202, p); return true;
      }
      if (action === "continuity/approve" && req.method === "POST") {
        idle(p); const body = await readBody(req);
        if (!p.production?.continuity || body.confirmed !== true) throw media.fail("请确认已验收相邻片段的句尾和空间衔接。");
        if (p.episodes.some(ep => ep.shots.slice(0, p.production.pilotUnits).length < Math.min(2, ep.shots.length) || !ep.shots.length || ep.shots.slice(0, p.production.pilotUnits).some(s => !s.video?.file || !s.qc))) throw media.fail("请先完成每集相邻样片。");
        p.production.pilotApproved = true;
        store.save(p); send(res, 200, p); return true;
      }
      if (action === "stop" && req.method === "POST") {
        if (p.job?.status === "running") { p.job.stopRequested = true; store.save(p); }
        send(res, 200, p); return true;
      }
      if (action === "episodes" && req.method === "POST") {
        idle(p);
        if (p.production) throw media.fail("请在原片项目补充分集，再新建制作副本。");
        const episodeId = url.searchParams.get("replace");
        if (!episodeId && p.episodes.length >= 100) throw media.fail("每个项目最多 100 集。");
        let ep = episodeId ? p.episodes.find(e => e.id === episodeId) : null;
        if (episodeId && !ep) throw media.fail("分集不存在。", 404);
        ep ||= { id: uuid(), number: Math.max(0, ...p.episodes.map(e => e.number)) + 1, title: text(url.searchParams.get("title"), 160) || "本地分集", transcript: "", sourceUrl: "", shots: [] };
        const rel = `episodes/${ep.id}-${uuid()}.mp4`; const filename = store.file(p.id, rel);
        fs.mkdirSync(path.dirname(filename), { recursive: true });
        let size = 0;
        try {
          const limiter = new Transform({ transform(chunk, _encoding, cb) { size += chunk.length; cb(size > bytesLimit ? media.fail("视频超过 500MB。", 413) : null, chunk); } });
          await pipeline(req, limiter, fs.createWriteStream(`${filename}.part`));
          if (!size) throw media.fail("上传视频为空。");
          const metadata = await (deps.probe || media.probe)(`${filename}.part`);
          if (metadata.duration > 900) throw media.fail("每集最多 15 分钟。");
          fs.renameSync(`${filename}.part`, filename);
          Object.assign(ep, { file: rel, metadata, access: "ready", shots: [], summary: "", error: "" });
          if (!episodeId) p.episodes.push(ep);
          invalidate(p, [ep.id]); store.save(p); send(res, 201, p); return true;
        } finally { if (fs.existsSync(`${filename}.part`)) fs.unlinkSync(`${filename}.part`); }
      }
      if (action === "import-url" && req.method === "POST") {
        idle(p); const body = await readBody(req);
        if (p.production) throw media.fail("请在原片项目导入片源，再新建制作副本。");
        let ep = body.episodeId ? p.episodes.find(e => e.id === body.episodeId) : null;
        if (body.episodeId && !ep) throw media.fail("分集不存在。", 404);
        if (!ep && p.episodes.length >= 100) throw media.fail("每个项目最多 100 集。");
        ep ||= { id: uuid(), number: Math.max(0, ...p.episodes.map(e => e.number)) + 1, title: text(body.title, 160) || "链接分集", shots: [], transcript: "" };
        const sourceUrl = text(body.url || ep.videoUrl || ep.pageUrl, 2048);
        if (!sourceUrl) throw media.fail("该集未公开视频，请补充有权限的视频文件或直链。", 403);
        try {
          await importEpisodeUrl(p, ep, sourceUrl, { direct: body.direct === true, allowPreview: body.allowPreview === true });
          store.save(p); send(res, 201, p); return true;
        } catch (error) { ep.error = text(error.message); ep.access = "permission-required"; store.save(p); throw error; }
      }
      if (action === "import-urls" && req.method === "POST") {
        idle(p); const body = await readBody(req);
        if (p.production) throw media.fail("请在原片项目导入片源，再新建制作副本。");
        const urls = [...new Set([].concat(body.urls || []).map(value => text(value, 2048)).filter(Boolean))].slice(0, 100);
        if (!urls.length) throw media.fail("请至少提供一个视频或播放页链接。");
        if (p.episodes.length + urls.length > 100) throw media.fail(`每个项目最多 100 集，当前已有 ${p.episodes.length} 集，本次 ${urls.length} 条链接。`);
        if (importJobs.get(p.id)?.status === "running") throw media.fail("该项目的批量导入正在进行，请等待完成。", 409);
        const state = startImportJob(p, urls, { direct: body.direct === true, allowPreview: body.allowPreview === true, title: text(body.title, 160) });
        send(res, 202, { ...p, import: state }); return true;
      }
      const epMatch = /^episodes\/([a-f0-9-]{36})$/.exec(action);
      if (epMatch && ["PATCH", "DELETE"].includes(req.method)) {
        idle(p); const ep = p.episodes.find(e => e.id === epMatch[1]); if (!ep) throw media.fail("分集不存在。", 404);
        let changed = req.method === "DELETE";
        if (req.method === "DELETE") p.episodes = p.episodes.filter(e => e !== ep);
        else {
          const body = await readBody(req);
          if (p.production && (body.reanalyze === true || (body.transcript !== undefined && text(body.transcript, 100000) !== text(ep.transcript, 100000)))) throw media.fail("请在原片项目更新对白与拉片，再新建制作副本。");
          if (body.number !== undefined) {
            if (!Number.isInteger(body.number) || body.number < 1 || body.number > 999 || p.episodes.some(e => e !== ep && e.number === body.number)) throw media.fail("集数须为不重复的 1-999 整数。");
          }
          if (body.title !== undefined && ep.title !== text(body.title, 160)) { ep.title = text(body.title, 160); changed = true; }
          if (body.number !== undefined && ep.number !== body.number) { ep.number = body.number; changed = true; }
          if (body.transcript !== undefined && ep.transcript !== text(body.transcript, 100000)) { ep.transcript = text(body.transcript, 100000); ep.shots = []; ep.summary = ""; changed = true; }
          if (body.reanalyze === true) { ep.shots = []; ep.summary = ""; changed = true; }
        }
        if (changed) invalidate(p, [ep.id]); store.save(p); send(res, 200, p); return true;
      }
      const shotMatch = /^shots\/([a-f0-9-]{36})$/.exec(action);
      if (shotMatch && req.method === "PATCH") {
        idle(p); const body = await readBody(req);
        const ep = p.episodes.find(e => e.shots?.some(s => s.id === shotMatch[1]));
        const shot = ep?.shots.find(s => s.id === shotMatch[1]); if (!shot) throw media.fail("镜头不存在。", 404);
        for (const key of ["prompt", "imagePrompt"]) if (body[key] !== undefined && !text(body[key])) throw media.fail("提示词不能为空。");
        let changed = false;
        for (const key of ["prompt", "imagePrompt"]) if (body[key] !== undefined && shot[key] !== text(body[key], key === "prompt" ? 4800 : 10000)) {
          shot[key] = text(body[key], key === "prompt" ? 4800 : 10000); delete shot.video;
          delete shot.qc;
          if (key === "imagePrompt") delete shot.frame;
          changed = true;
        }
        if (body.included !== undefined && shot.included !== (body.included === true)) { shot.included = body.included === true; changed = true; }
        if (changed) { invalidate(p, [ep.id]); invalidateContinuations(p, ep, ep.shots.indexOf(shot)); } store.save(p); send(res, 200, p); return true;
      }
      const assetMatch = /^assets\/([a-f0-9-]{36})$/.exec(action);
      if (assetMatch && req.method === "PATCH") {
        idle(p); const body = await readBody(req); const asset = p.assets.find(a => a.id === assetMatch[1]);
        if (!asset) throw media.fail("资产不存在。", 404);
        if (!text(body.prompt)) throw media.fail("资产提示词不能为空。");
        if (asset.prompt !== text(body.prompt, 10000)) {
          asset.prompt = text(body.prompt, 10000); delete asset.image;
          for (const ep of p.episodes) for (const s of ep.shots || []) if (s.assetIds?.includes(asset.id)) { delete s.frame; delete s.video; delete s.qc; invalidate(p, [ep.id]); invalidateContinuations(p, ep, ep.shots.indexOf(s)); }
        }
        store.save(p); send(res, 200, p); return true;
      }
      if (action === "recover" && req.method === "POST") {
        idle(p); const body = await readBody(req);
        const targets = [...p.assets, ...p.episodes.flatMap(e => e.shots || [])];
        const target = targets.find(t => ["image", "frame", "video"].some(k => t[k]?.id === body.recordId));
        const key = target && ["image", "frame", "video"].find(k => target[k]?.id === body.recordId);
        if (!key) throw media.fail("任务记录不存在。", 404);
        const record = target[key];
        if (body.taskId) {
          if (!/^[a-zA-Z0-9_-]{1,200}$/.test(body.taskId)) throw media.fail("任务 ID 无效。");
          Object.assign(record, { taskId: body.taskId, state: "processing", error: "" });
        } else {
          if (!["failed", "unknown", "submitting"].includes(record.state) || body.confirmResubmit !== true) throw media.fail("请先确认旧任务状态及重新计费。");
          record.state = "superseded"; delete target[key];
        }
        store.save(p); send(res, 200, p); return true;
      }
      if (action === "export" && req.method === "GET") {
        idle(p);
        res.writeHead(200, { "Content-Type": "application/zip", "Content-Disposition": `attachment; filename="drama-${p.id}.zip"` });
        const archive = archiver("zip", { zlib: { level: 1 } });
        archive.on("error", () => res.destroy()); res.on("close", () => archive.abort()); archive.pipe(res);
        archive.append(JSON.stringify(p, null, 2), { name: "project.json" });
        for (const name of ["generated", "deliveries", "frames", "qc", "previews"]) {
          const dir = store.file(p.id, name); if (fs.existsSync(dir)) archive.directory(dir, name, entry => !/\.part(?:\.mp4)?$|part-\d+\.mp4$|concat\.txt$/.test(entry.name) && entry);
        }
        await archive.finalize(); return true;
      }
      throw media.fail("接口不存在。", 404);
    } catch (error) {
      if (!res.headersSent && !res.destroyed) send(res, error.statusCode || 500, { error: text(error.message, 1500) });
      else if (!res.writableEnded) res.destroy();
      return true;
    } finally { if (locked) locks.delete(locked); }
  }
  return { route, store, engine };
}

module.exports = { createDramaRouter, createStore, streamFile, invalidate, invalidateContinuations };
