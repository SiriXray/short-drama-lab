"use strict";

const $ = selector => document.querySelector(selector);
const esc = value => String(value ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const icon = name => `<i data-lucide="${name}"></i>`;
const fmt = value => value == null ? "未公开" : value >= 1e8 ? `${(value / 1e8).toFixed(1)}亿` : value >= 1e4 ? `${(value / 1e4).toFixed(1)}万` : String(value);
const time = value => `${Math.floor(value / 60).toString().padStart(2, "0")}:${(value % 60).toFixed(1).padStart(4, "0")}`;
const stages = [{ id: "analyze", name: "采集与拉片", detail: "GPT 视觉分析" }, { id: "assets", name: "分镜与资产", detail: "Vidu Image 2" }, { id: "video", name: "镜头生成", detail: "Vidu Q4" }, { id: "assemble", name: "拼接与交付", detail: "Gemini 视觉质检" }];
const visualStyles = { anime2d: "2D 动漫", cinematic: "真人电影质感", cg3d: "3D 漫剧 CG" };
let project = null, tab = "episodes", catalog = { items: [] }, projects = [], selected = new Set(), episodeFilter = "", modalSubmit = null, replaceEpisode = null, noticeTimer, contentSignature = "", fetching = false, lastRefresh = 0;
const icons = () => window.lucide?.createIcons();
const fileUrl = file => `/api/drama/files/${project.id}/${file.split("/").map(encodeURIComponent).join("/")}`;
const api = async (route, body, method = body === undefined ? "GET" : "POST") => {
  const response = await fetch(`/api/drama${route}`, { method, headers: body === undefined ? {} : { "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || `请求失败 (${response.status})`);
  return result;
};
function notify(message, error = false) {
  clearTimeout(noticeTimer); $("#notice").textContent = message; $("#notice").className = error ? "error" : ""; $("#notice").hidden = false;
  noticeTimer = setTimeout(() => { $("#notice").hidden = true; }, error ? 14000 : 6000);
}
async function busy(button, fn) {
  if (button?.disabled) return;
  if (button) button.disabled = true;
  try { await fn(); } catch (error) { notify(error.message, true); }
  finally { if (button?.isConnected) button.disabled = false; }
}
function modal(title, html, onSubmit, label = "保存") {
  $("#modal-title").textContent = title; $("#modal-body").innerHTML = html; $("#modal-submit").textContent = label;
  modalSubmit = onSubmit; icons(); $("#modal").showModal();
}
const field = (label, name, value, type = "input", attrs = "") => `<label class="field">${label}${type === "textarea" ? `<textarea name="${name}" ${attrs}>${esc(value)}</textarea>` : `<input name="${name}" value="${esc(value)}" ${attrs}>`}</label>`;
const warning = message => `<p class="warning">${message}</p>`;
const empty = (message, glyph = "clapperboard") => `<div class="empty">${icon(glyph)}<p>${message}</p></div>`;
const badge = (text, kind = "") => `<span class="badge ${kind}">${esc(text)}</span>`;
const isRunning = () => project?.job?.status === "running";
const available = e => Boolean(e.file || e.pageUrl || e.videoUrl || e.sourceKind === "user-script-and-portrait");
const selectedEpisodes = () => project.episodes.filter(e => selected.has(e.id));
const visibleEpisodes = () => project.episodes.filter(e => !episodeFilter || e.id === episodeFilter).sort((a, b) => a.number - b.number);
const statusNames = { ready: "视频已导入", pending: "待读取视频", "permission-required": "待补充片源", running: "运行中", paused: "已暂停", interrupted: "待恢复", completed: "已完成", failed: "失败", submitting: "提交中", unknown: "结果未知", success: "已完成", processing: "生成中", created: "已提交", queueing: "排队中", superseded: "已替换" };
function renderNav() {
  $("#projects").innerHTML = projects.length ? projects.map(p => `<button class="side-item ${project?.id === p.id ? "active" : ""}" data-project="${p.id}" title="${esc(p.title)}">${icon("clapperboard")}<span>${esc(p.title)}</span></button>`).join("") : `<span class="muted" style="padding:8px">暂无项目</span>`;
  $("#catalog-nav").classList.toggle("active", !project); icons();
}
async function refreshProjects() { projects = (await api("/projects")).projects; renderNav(); }
function renderCatalog() {
  $("#captured").textContent = catalog.capturedAt ? `${new Date(catalog.capturedAt).toLocaleString("zh-CN")} · ${catalog.items.length} 部` : "尚未读取";
  $("#catalog-result").innerHTML = !catalog.items.length ? empty("暂无片源", "list-video") : `<p class="source-note">${catalog.items.some(i => i.heat != null) ? "榜单指标：综合热度。播放量未公开时不作换算。" : "来源未公开播放量或热度。"} 当前分集目录为网页公开部分。</p><div class="rank-list">${catalog.items.map((row, index) => `<article class="rank-row"><span class="rank-number">${String(row.sourceRank).padStart(2, "0")}</span>${row.coverUrl ? `<img class="cover" src="${esc(row.coverUrl)}" loading="lazy" referrerpolicy="no-referrer" alt="${esc(row.title)}封面">` : `<div class="cover"></div>`}<div><a class="rank-title" href="${esc(row.sourceUrl)}" target="_blank" rel="noreferrer">${esc(row.title)}</a><p class="rank-description">${esc(row.description || `${row.episodes.length} 个公开分集记录`)}</p></div><div class="metric">${fmt(row[catalog.metric || "heat"])}<small>${catalog.metric === "playCount" ? "播放量" : "综合热度"}</small></div><button class="button small" data-catalog="${index}">${icon("plus")}建项</button></article>`).join("")}</div>`;
  icons();
}
async function openProject(id) {
  const p = await api(`/projects/${id}`); project = p;
  if (p.production) tab = "production";
  selected = new Set(p.episodes.filter(e => e.file || e.sourceKind === "user-script-and-portrait" || (e.number === 1 && (e.pageUrl || e.videoUrl))).map(e => e.id)); episodeFilter = ""; contentSignature = "";
  history.replaceState(null, "", `/drama.html#${p.id}`);
  $("#catalog-view").hidden = true; $("#project-view").hidden = false; renderNav(); renderProject();
}
function setProject(p) { if (!project || project.id !== p.id) return; project = p; renderProject(); }
function renderProject() {
  if (!project) return;
  if (episodeFilter && !project.episodes.some(e => e.id === episodeFilter)) episodeFilter = "";
  $("#project-title").textContent = project.title;
  $("#project-kicker").textContent = `${project.aspectRatio} / ${project.episodes.length} 集 / ${project.production ? "2K 完整制作" : `${project.episodes.reduce((n, e) => n + (e.shots?.length || 0), 0)} 原片镜头`}`;
  $("#export").href = `/api/drama/projects/${project.id}/export`;
  $("#export").hidden = isRunning();
  $("#project-settings").disabled = isRunning();
  $("#agent-track").innerHTML = stages.map((s, i) => `<div class="agent ${isRunning() && project.job.stage === s.id ? "active" : ""}"><span>0${i + 1}</span><div><h3>${s.name}</h3><small>${s.detail}</small><button data-run="${s.id}" ${isRunning() ? "disabled" : ""}>${isRunning() && project.job.stage === s.id ? "执行中" : "运行此阶段"}</button></div></div>`).join("");
  const job = project.job;
  const completedMessage = job?.reviewRequired ? "流程已完成，成片有待人工复核项" : `${job?.stage === "trial" ? "模型试跑" : job?.requestedStage === "review" ? "Gemini 质检" : stages.find(s => s.id === job?.requestedStage)?.name || "全流程"}已完成`;
  const needsUpdate = job?.status === "completed" && project.deliveries.length > 0 && project.deliveries.every(d => d.stale);
  $("#job-state").innerHTML = job ? `${badge(needsUpdate ? "待更新" : statusNames[job.status] || job.status, needsUpdate ? "warn" : job.status === "failed" ? "failed" : job.status === "completed" ? "success" : "")} <span class="${job.error ? "error" : ""}">${esc(job.error || (needsUpdate ? "内容已修改，相关结果待重新生成" : job.status === "running" ? project.events.at(-1)?.message : job.status === "completed" ? completedMessage : ""))}</span>` : badge("待开始");
  if (job?.stage === "trial") $("#job-state").insertAdjacentHTML("beforeend", ' <a href="/workspace.html#trials">查看模型试跑</a>');
  $("#stop").hidden = !isRunning(); $("#stop").disabled = Boolean(job?.stopRequested);
  $("#run-all").disabled = isRunning() || !project.episodes.length;
  $("#run-all").innerHTML = `${icon("play")}${job?.stage !== "trial" && ["paused", "failed", "interrupted"].includes(job?.status) ? "继续至成片" : "运行至成片"}`;
  document.querySelectorAll("[data-tab]").forEach(b => b.classList.toggle("active", b.dataset.tab === tab));
  const signature = JSON.stringify(tab === "assets" ? [tab, project.assets, project.production?.bible, isRunning()] : [tab, episodeFilter, [...selected], project.episodes, project.assets, project.deliveries, project.production, isRunning()]);
  const playing = [...document.querySelectorAll("#project-content video")].some(v => !v.paused);
  if (contentSignature !== signature && !playing) {
    contentSignature = signature;
    const openAssets = [...document.querySelectorAll("[data-asset-details][open]")].map(el => el.dataset.assetDetails);
    $("#project-content").innerHTML = ({ production: renderProduction, episodes: renderEpisodes, storyboard: renderStoryboard, assets: renderAssets, videos: renderVideos, delivery: renderDelivery }[tab])();
    document.querySelectorAll("[data-asset-details]").forEach(el => { el.open = openAssets.includes(el.dataset.assetDetails); });
    document.querySelectorAll("[data-select]").forEach(el => { el.disabled = !available(project.episodes.find(e => e.id === el.dataset.select)); });
    const all = $("#select-all");
    if (all) all.checked = project.episodes.some(available) && project.episodes.filter(available).every(e => selected.has(e.id));
    decorateProduction();
  }
  $("#log-count").textContent = project.events.length ? `(${project.events.length})` : "";
  $("#events").innerHTML = [...project.events].reverse().map(e => `<li><time>${new Date(e.at).toLocaleTimeString("zh-CN")}</time><span>${esc(e.message)}</span></li>`).join("");
  $("#task-records").innerHTML = project.ledger.filter(r => r.state !== "superseded").map(r => `<div class="record"><span>${badge(statusNames[r.state] || r.state, ["failed", "unknown", "submitting"].includes(r.state) ? "warn" : "")} ${esc(r.model)}<br><code>${esc(r.taskId || "未返回任务 ID")}</code>${r.credits != null ? ` · ${r.credits} 积分` : ""}${r.error ? `<p class="error-text">${esc(r.error)}</p>` : ""}</span>${["failed", "unknown", "submitting"].includes(r.state) && !isRunning() ? `<button class="button small" data-recover="${r.id}">${icon("rotate-ccw")}核对任务</button>` : ""}</div>`).join("");
  document.querySelectorAll(".story-stills img,.media-preview img").forEach(img => { img.tabIndex = 0; img.setAttribute("role", "button"); img.title = "放大查看"; });
  const activeRecords = new Set([...project.assets.map(a => a.image?.id), ...project.episodes.flatMap(e => (e.shots || []).flatMap(s => [s.frame?.id, s.video?.id]))].filter(Boolean));
  document.querySelectorAll("[data-recover]").forEach(button => { if (!activeRecords.has(button.dataset.recover)) button.remove(); });
  icons();
  if (project.production) {
    const stageDetail = document.querySelectorAll("#agent-track small")[2];
    if (stageDetail) stageDetail.textContent = "Q4 Preview · 16s · 2K";
    document.querySelectorAll("#import-link,#upload,[data-replace],[data-fetch]").forEach(b => { b.disabled = true; });
  }
  if (typeof renderUploadNext === "function") renderUploadNext();
}
function decorateProduction() {
  if (!project.production) return;
  if (project.production.continuity && !project.production.pilotApproved && ["production", "videos"].includes(tab)) {
    const ready = project.episodes.every(e => e.shots.length && e.shots.slice(0, 2).every(s => s.video?.file && s.qc));
    if (ready) document.querySelector("#project-content .section-title")?.insertAdjacentHTML("beforeend", `<button class="button primary" id="approve-continuity" ${isRunning() ? "disabled" : ""}>${icon("check-check")}验收相邻样片</button>`);
  }
  if (tab === "videos") {
    const button = document.querySelector('#project-content [data-run="video"]');
    if (button) button.innerHTML = `${icon("film")}生成分镜视频`;
    const shots = visibleEpisodes().flatMap(e => e.shots || []).filter(s => s.included !== false);
    document.querySelectorAll(".media-item").forEach((el, i) => {
      const s = shots[i], model = s.mode === "img2video" ? `${project.production.imageModel} 图生` : `${project.production.referenceModel} 参考生`;
      el.querySelector(".tag-row")?.insertAdjacentHTML("beforeend", badge(model));
      if (s.video?.previewFile) el.querySelector(".actions")?.insertAdjacentHTML("beforeend", `<a class="icon" href="${fileUrl(s.video.file)}?download" title="下载原始编码视频" aria-label="下载原始编码视频">${icon("file-video")}</a>`);
      if (s.mode === "reference2video" && !s.video) el.querySelector(".tag-row .badge").textContent = "使用资产直接参考生";
      if (s.qc) el.insertAdjacentHTML("beforeend", `<details class="qc-note"><summary>${s.qc.verdict === "pass" ? "视觉采样通过 · 待听审" : "画面待复核 · 待听审"}</summary><p>${esc(s.qc.style)}</p><p>${esc(s.qc.story)}</p><ul>${s.qc.issues.map(v => `<li>${esc(v)}</li>`).join("")}</ul><p>${esc(s.qc.audioReview)}</p></details>`);
    });
  }
  if (tab === "delivery") document.querySelectorAll(".delivery-row").forEach((el, i) => {
    const d = [...project.deliveries].reverse()[i];
    if (d.quality) el.querySelector("h3").insertAdjacentHTML("afterend", `<div class="tag-row">${badge(visualStyles[d.style])}${badge(d.quality.completeTimeline ? "全时间轴" : "节选成片", d.quality.completeTimeline ? "success" : "warn")}${badge(`${d.quality.visualReviewUnits} 段待视觉复核 · 待听审`, "warn")}</div><p class="muted">参考生 ${d.quality.referenceUnits} 段 · 图生 ${d.quality.imageUnits} 段 · ${d.quality.upscaledUnits ? `${d.quality.upscaledUnits} 段经过放大，原始尺寸详见分镜清单` : "未放大原素材"}</p>`);
  });
}
function renderProduction() {
  if (!project.production) return `<div class="section-title"><h2>分集制作</h2><button class="button primary" id="create-production" ${isRunning() ? "disabled" : ""}>${icon("copy-plus")}建立制作副本</button></div>${project.episodes.map(e => `<div class="episode-plan"><h3>第 ${e.number} 集</h3><p class="muted">${e.shots?.length || 0} 个原片镜头 · ${e.summary ? "逐集分析已完成" : "待完成拉片"}</p></div>`).join("")}`;
  const p = project.production, units = project.episodes.flatMap(e => e.sourceShots ? e.shots : []);
  const refs = units.filter(s => s.mode === "reference2video").length;
  const done = units.filter(s => s.video?.file).length;
  const authored = project.sourceKind === "user-script-and-portrait";
  return `<div class="section-title"><h2>分集生产总览</h2><a class="button" href="${authored ? fileUrl("storyboard.md") : `/drama.html#${p.sourceProjectId}`}" target="_blank" rel="noreferrer">${icon("external-link")}${authored ? "分镜剧本" : "原片项目"}</a></div><div class="production-metrics"><div><strong>${done}<small> / ${units.length}</small></strong><span>已生成片段</span></div><div><strong>${units.length ? Math.round(refs / units.length * 100) : Math.round(p.referenceShare * 100)}%</strong><span>参考生 · 按片段数</span></div><div><strong>2K</strong><span>9:16 · Image 2</span></div><div><strong>${project.deliveries.filter(d => !d.stale && d.kind !== "full-film").length}<small> / ${project.episodes.length}</small></strong><span>分集成片</span></div></div><p class="source-note">参考生：${esc(p.referenceModel)} · 图生：${esc(p.imageModel)} · 每段生成 16 秒 · 视觉采样与人工听审分别记录</p>${p.bible ? `<details class="story-summary"><summary>跨集身份与连续性</summary><div>${esc(p.bible.premise)}\n${esc(p.bible.continuity)}\n${p.bible.identities.map(x => `${esc(x.name)}：${esc(x.identity)}`).join("\n")}</div></details>` : ""}${project.episodes.map(e => `<section class="episode-plan"><div class="section-title"><h2>第 ${e.number} 集</h2>${badge(visualStyles[e.style], "success")}</div><p class="muted">${time(e.metadata.duration)} · ${e.sourceShots?.length || e.shots.length} ${authored ? "剧本场景" : "原片镜头"} · ${e.sourceShots ? `${e.shots.length} 个生成片段` : "待生成制作计划"}</p>${e.narrative ? `<dl class="narrative-grid">${Object.entries({ hook: "开场钩子", desire: "人物目标", conflict: "冲突机制", escalation: "转折升级", payoff: "情绪回报", cliffhanger: "结尾悬念", uncertainties: "不确定信息" }).map(([k, label]) => `<div><dt>${label}</dt><dd>${esc(e.narrative[k] || "未确认")}</dd></div>`).join("")}</dl><div class="unit-list">${e.shots.map((s, i) => `<div class="unit-row"><span>${String(i + 1).padStart(2, "0")}</span><div><h3>${esc(s.title || "待编写提示词")}</h3><p class="muted">${time(s.start)} → ${time(s.end)} · ${s.beats ? `${s.beats.length} 个剧情节拍` : "剧本编写"}</p><p class="muted">${esc(s.routeReason)}</p></div><div>${badge(s.mode === "reference2video" ? "参考生" : "首帧图生")}${badge(s.video?.file ? "视频已完成" : s.prompt ? "提示词已就绪" : "待编写", s.video?.file ? "success" : "")}</div></div>`).join("")}</div><details class="story-summary"><summary>${authored ? "编写依据（非原片观察）" : "原片逐镜头依据"} · ${e.sourceShots.length} 镜头</summary><div>${e.sourceShots.map(s => `${time(s.start)}–${time(s.end)} ${esc(s.analysis.action)}\n对白依据：${esc(s.analysis.dialogue || "未知")}`).join("\n\n")}</div></details>` : ""}</section>`).join("")}`;
}

function createProduction(startAfter = false) {
  const eps = selectedEpisodes();
  const sourceId = project.id, requestId = crypto.randomUUID();
  if (!eps.length) return notify("请先选择制作分集。", true);
  if (eps.some(e => !e.summary || !(e.sourceShots || e.shots)?.length || (e.sourceShots || e.shots).some(s => !s.analysis))) return notify("请先完成所选分集的逐集拉片。", true);
  modal("建立完整制作副本", field("项目名称", "title", `${project.title} · ${eps.length}集制作`) + eps.map(e => `<label class="field">第 ${e.number} 集视觉风格<select name="style-${e.id}">${Object.entries(visualStyles).map(([key, name]) => `<option value="${key}" ${key === "cinematic" ? "selected" : ""}>${name}</option>`).join("")}</select></label>`).join("") + `<div class="field-inline"><label class="field">参考生占比<select name="referenceShare"><option value="0.7">70%</option><option value="0.5">50%</option><option value="1">100%</option><option value="0">0%</option></select></label><label class="field">生成规格<input readonly value="Q4 Preview · 16s · 9:16 · 2K"></label></div><label class="checkbox-label"><input type="checkbox" name="continuity" checked>尾帧接续与完整句尾校验</label>` + warning("先生成每集两段相邻样片，验收后继续整集。原片和旧版成片保留。"), async v => {
    if (v.has("continuity") && (await api("/health")).continuityVersion !== 1) throw new Error("后端尚未加载连续性修正，请先重启工作台服务再创建；未提交计费任务。");
    const p = await api(`/projects/${sourceId}/production`, { requestId, title: v.get("title"), episodes: eps.map(e => ({ id: e.id, style: v.get(`style-${e.id}`) })), referenceShare: Number(v.get("referenceShare")), referenceModel: "viduq4-preview", imageModel: "viduq4-preview", continuity: v.has("continuity") });
    await refreshProjects(); await openProject(p.id);
    if (startAfter) return () => run("all");
  }, "创建制作副本");
}
function episodeSelector() {
  return `<label class="selection">分集 <select id="episode-filter"><option value="">全部分集</option>${project.episodes.map(e => `<option value="${e.id}" ${episodeFilter === e.id ? "selected" : ""}>第 ${e.number} 集 · ${esc(e.title)}</option>`).join("")}</select></label>`;
}
function renderEpisodes() {
  return `<div class="section-title"><label class="selection"><input class="check" type="checkbox" id="select-all" ${project.episodes.filter(e => e.file).length && project.episodes.filter(e => e.file).every(e => selected.has(e.id)) ? "checked" : ""}>已选 ${selected.size} 集</label><div class="actions"><button class="button" id="import-link" ${isRunning() ? "disabled" : ""}>${icon("link")}链接导入</button><button class="button" id="upload" ${isRunning() ? "disabled" : ""}>${icon("upload")}上传分集</button></div></div>${!project.episodes.length ? empty("暂无分集", "upload") : project.episodes.slice().sort((a, b) => a.number - b.number).map(e => `<article class="episode-row"><input type="checkbox" class="check" data-select="${e.id}" aria-label="选择第${e.number}集" ${selected.has(e.id) ? "checked" : ""} ${!e.file ? "disabled" : ""}><div><h3>第 ${e.number} 集 · ${esc(e.title)}</h3>${badge(statusNames[e.access] || "待导入", e.file ? "success" : "warn")} ${e.metadata ? `<span class="muted">${time(e.metadata.duration)} · ${e.metadata.width}×${e.metadata.height}</span>` : ""}${e.error ? `<p class="error-text">${esc(e.error)}</p>` : ""}</div><div class="actions">${e.file ? `<button class="icon" title="预览原片" data-preview="${e.id}" aria-label="预览原片">${icon("play")}</button>` : e.pageUrl || e.videoUrl ? `<button class="button small" data-fetch="${e.id}" ${isRunning() ? "disabled" : ""}>${icon("download")}读取视频</button>` : ""}<button class="icon" data-replace="${e.id}" title="补充或替换本集视频" aria-label="补充或替换本集视频" ${isRunning() ? "disabled" : ""}>${icon("upload")}</button><button class="icon" data-edit-episode="${e.id}" title="集数与对白" aria-label="集数与对白" ${isRunning() ? "disabled" : ""}>${icon("file-pen-line")}</button><button class="icon" data-delete-episode="${e.id}" title="移除分集" aria-label="移除分集" ${isRunning() ? "disabled" : ""}>${icon("trash-2")}</button></div></article>`).join("")}`;
}
function renderStoryboard() {
  const episodes = visibleEpisodes();
  return `<div class="section-title">${episodeSelector()}<button class="button" data-run="analyze" ${isRunning() ? "disabled" : ""}>${icon("scan-search")}开始拉片</button></div>${episodes.some(e => e.shots?.length) ? episodes.map(e => !e.shots?.length ? "" : `<h2>第 ${e.number} 集</h2>${e.summary ? `<details class="story-summary"><summary>剧情概览与复刻要点</summary><div>${esc(e.summary)}</div></details>` : ""}${e.shots.map((s, i) => `<article class="story-row"><div><div class="story-stills">${s.frames.map(f => `<img src="${fileUrl(f.file)}" loading="lazy" alt="${time(f.time)}关键帧">`).join("")}</div><div class="timecode">${time(s.start)} → ${time(s.end)}</div><span class="muted">${s.boundary === "generation-unit" ? "生成片段" : s.boundary === "time-window" ? "时长切分" : "场景切分"}</span></div><div class="story-body"><h3>${String(i + 1).padStart(2, "0")} · ${esc(s.analysis?.scene || "待分析")}</h3><p>${esc(s.analysis?.action || "")}</p><p class="evidence">${esc(s.analysis?.camera || "")} · ${esc(s.analysis?.emotion || "")}</p><div class="tag-row">${(s.analysis?.characters || []).map(n => badge(n)).join("")}</div><p class="evidence">对白：${esc(s.analysis?.dialogue || "未知")}</p><p class="evidence">${esc(s.analysis?.evidence || "")}</p>${s.prompt ? `<details><summary class="muted">视频提示词</summary><p>${esc(s.prompt)}</p></details>` : ""}<div class="actions">${s.prompt ? `<button class="button small" data-edit-shot="${s.id}" ${isRunning() ? "disabled" : ""}>${icon("pencil")}编辑提示词</button>` : ""}<label class="selection"><input type="checkbox" class="check" data-include="${s.id}" ${s.included !== false ? "checked" : ""} ${isRunning() ? "disabled" : ""}>纳入成片</label></div></div></article>`).join("")}`).join("") : empty("暂无拉片分镜", "scan-search")}`;
}
function assetInfo(asset) {
  const identity = asset.type === "character" && asset.identityKey ? project.production?.bible?.identities?.find(i => i.key === asset.identityKey) : null;
  const candidate = asset.identityMasterId ? project.assets.find(a => a.id === asset.identityMasterId) : null;
  const master = asset.type === "character" && asset.identityKey && candidate?.type === "character" && candidate.identityKey === asset.identityKey && candidate.style === asset.style ? candidate : null;
  return { identity, master, status: asset.image?.file ? "已生成" : asset.image?.state === "success" ? "图片待保存" : statusNames[asset.image?.state] || "待生成" };
}
function assetDescription(asset) {
  const { identity, master } = assetInfo(asset);
  return `<dl class="asset-description">${asset.type === "character" ? `<dt>角色</dt><dd>${esc(identity?.name || asset.name)}</dd>${identity?.identity ? `<dt>角色描述</dt><dd>${esc(identity.identity)}</dd>` : ""}` : ""}<dt>${asset.type === "character" ? "本次造型" : "资产名称"}</dt><dd>${esc(asset.name)}</dd><dt>生图描述</dt><dd>${esc(asset.prompt || "暂无描述")}</dd>${master ? `<dt>固定主参考</dt><dd>${esc(master.name)}</dd>` : ""}</dl>`;
}
function assetCard(asset) {
  const { identity, master, status } = assetInfo(asset);
  const ready = Boolean(asset.image?.file), glyph = asset.type === "character" ? "user-round" : asset.type === "prop" ? "box" : "mountain";
  return `<article class="media-item asset-item" data-asset-id="${esc(asset.id)}">
    <div class="media-preview asset-preview">${ready ? `<img src="${fileUrl(asset.image.file)}" loading="lazy" alt="${esc(asset.name)}" data-asset-image="${esc(asset.id)}">` : ""}<div class="asset-image-fallback" ${ready ? "hidden" : ""}>${icon(glyph)}<span>${esc(status)}</span></div></div>
    <h3>${esc(asset.name)}</h3><div class="tag-row">${badge(status, ready ? "success" : ["failed", "unknown"].includes(asset.image?.state) ? "warn" : "")}${master ? badge(master.id === asset.id ? "角色主参考" : "换装 / 造型") : ""}${asset.style ? badge(visualStyles[asset.style] || asset.style) : ""}</div>
    ${identity?.name ? `<p class="asset-role">角色：${esc(identity.name)}</p>` : ""}<p class="asset-summary">${esc(identity?.identity || asset.prompt || "暂无描述")}</p>
    <details class="asset-details" data-asset-details="${esc(asset.id)}"><summary>完整描述</summary>${assetDescription(asset)}</details>
    ${asset.image?.error ? `<p class="asset-error">${esc(asset.image.error)}</p>` : ""}
    <div class="actions"><button class="icon" data-edit-asset="${esc(asset.id)}" title="编辑资产描述" aria-label="编辑 ${esc(asset.name)}" ${isRunning() ? "disabled" : ""}>${icon("pencil")}</button>${master && master.id !== asset.id ? `<button class="icon" data-preview-asset="${esc(master.id)}" title="查看主参考：${esc(master.name)}" aria-label="查看 ${esc(asset.name)} 的主参考图">${icon("contact-round")}</button>` : ""}${ready ? `<button class="icon" data-preview-asset="${esc(asset.id)}" title="查看大图与描述" aria-label="查看 ${esc(asset.name)} 的大图与描述">${icon("maximize-2")}</button><a class="icon" title="下载资产原图" aria-label="下载 ${esc(asset.name)}" href="${fileUrl(asset.image.file)}?download">${icon("download")}</a>` : ""}</div>
  </article>`;
}
function renderAssets() {
  const ready = project.assets.filter(a => a.image?.file).length;
  const groups = [["character", "角色资产"], ["prop", "道具资产"], ["environment", "环境资产"], ["other", "其他资产"]];
  return `<div class="section-title"><div><h2>角色 · 道具 · 环境</h2><p class="asset-count" aria-live="polite">已生成 ${ready} / ${project.assets.length} 张</p></div><button class="button" data-run="assets" ${isRunning() ? "disabled" : ""}>${icon("image-plus")}生成资产与首帧</button></div>${project.assets.length ? groups.map(([type, title]) => {
    const assets = project.assets.filter(a => type === "other" ? !["character", "prop", "environment"].includes(a.type) : a.type === type);
    return assets.length ? `<section class="asset-section" data-asset-type="${type}"><div class="section-title"><h3>${title}</h3><span class="muted">${assets.filter(a => a.image?.file).length} / ${assets.length} 张</span></div><div class="media-grid asset-grid">${assets.map(assetCard).join("")}</div></section>` : "";
  }).join("") : empty("暂无角色资产", "images")}`;
}
function previewAsset(id) {
  const asset = project.assets.find(a => a.id === id);
  if (!asset) return notify("该资产已更新，请刷新后查看。", true);
  modal(asset.name, `<div class="asset-modal">${asset.image?.file ? `<img src="${fileUrl(asset.image.file)}" alt="${esc(asset.name)}"><a class="button small" href="${fileUrl(asset.image.file)}?download">${icon("download")}下载原图</a>` : `<p class="muted">${esc(assetInfo(asset).status)}</p>`}${assetDescription(asset)}</div>`, async () => {}, "关闭");
}
function renderVideos() {
  const shots = visibleEpisodes().flatMap(e => (e.shots || []).filter(s => s.included !== false).map((s, i) => ({ ...s, number: e.number, index: i + 1 })));
  return `<div class="section-title">${episodeSelector()}<button class="button" data-run="video" ${isRunning() ? "disabled" : ""}>${icon("film")}生成 Q4 镜头</button></div>${shots.length ? `<div class="media-grid">${shots.map(s => `<article class="media-item"><div class="media-preview">${s.video?.file ? `<video src="${fileUrl(s.video.previewFile || s.video.file)}" controls playsinline preload="metadata" ${s.frame?.file ? `poster="${fileUrl(s.frame.file)}"` : ""}></video>` : s.frame?.file ? `<img src="${fileUrl(s.frame.file)}" loading="lazy" alt="第${s.number}集镜头${s.index}首帧">` : icon("film")}</div><h3>第 ${s.number} 集 · 镜头 ${s.index}</h3><div class="tag-row">${badge(statusNames[s.video?.state] || (s.frame?.file ? "首帧已就绪" : "待生成首帧"), s.video?.file ? "success" : "")}<span class="muted">${time(s.start)} → ${time(s.end)}</span></div><p>${esc(s.prompt || s.analysis?.action || "")}</p><div class="actions">${s.prompt ? `<button class="button small" data-edit-shot="${s.id}" ${isRunning() ? "disabled" : ""}>${icon("pencil")}提示词</button>` : ""}${s.video?.file ? `<a class="icon" href="${fileUrl(s.video.previewFile || s.video.file)}?download" title="下载镜头" aria-label="下载镜头">${icon("download")}</a>` : ""}</div></article>`).join("")}</div>` : empty("暂无镜头视频", "film")}`;
}
function renderDelivery() {
  return `<div class="section-title"><h2>成片交付</h2><button class="button" data-run="assemble" ${isRunning() ? "disabled" : ""}>${icon("scissors")}拼接成片</button></div>${project.deliveries.length ? project.deliveries.slice().reverse().map(d => `<article class="delivery-row" data-delivery="${d.id}"><video controls playsinline preload="metadata" src="${fileUrl(d.file)}"></video><div><h3>${d.title ? esc(d.title) : `第 ${d.number} 集`}</h3>${badge(d.stale ? "历史版本" : "最新成片", d.stale ? "warn" : "")}<p class="muted" style="margin-top:12px">${time(d.metadata.duration)} · ${d.metadata.width}×${d.metadata.height} · MP4</p><p class="muted">${new Date(d.createdAt).toLocaleString("zh-CN")}</p><div class="actions"><a class="button primary" href="${fileUrl(d.file)}?download">${icon("download")}下载成片</a><a class="button" href="${fileUrl(d.manifest)}?download">${icon("file-json")}分镜清单</a></div>${renderVisualReview(d)}</div></article>`).join("") : empty("暂无交付成片", "package-check")}`;
}
function renderVisualReview(d) {
  const r = d.visualReview;
  const labels = { pass: "视觉采样通过 · 待听审", blocked: "发现高风险问题 · 待复核", review: "视觉待复核", unverified: "质检未完成" };
  const status = r?.status === "completed" ? labels[r.verdict] : r?.status === "running" && isRunning() ? "Gemini 质检中" : r ? "质检未完成" : "尚未进行 Gemini 质检";
  const kinds = { style_drift: "风格突变", extra_limbs: "多余肢体", anatomy: "结构畸形", identity_drift: "角色漂移" };
  return `<section class="visual-review">${badge(status, r?.verdict === "pass" ? "success" : "warn")}${r?.model ? `<p class="muted">${esc(r.model)} · ${r.batches?.length || 0} / ${r.totalBatches || "?"} 组</p>` : ""}${r?.error ? warning(esc(r.error)) : ""}<p class="muted">${esc(r?.limitation || "抽帧检查风格、角色与肢体，不替代逐帧和音频人工验收。")}</p>${r?.coverage ? `<p class="muted">${r.coverage.frameCount} 帧 · ${r.coverage.effectiveIntervalSeconds}s 间隔 · ${r.coverage.sampledJoins.length} 个拼接点${r.coverage.limited ? " · 已触及采样上限，需人工补审" : ""}</p>` : ""}<div class="actions"><button class="button small" data-review="${d.id}" ${isRunning() ? "disabled" : ""}>${icon("scan-eye")}${r?.status === "completed" ? "重新质检" : "开始 / 继续质检"}</button>${r?.reportFile ? `<a class="button small" href="${fileUrl(r.reportFile)}?download">${icon("file-json")}质检报告</a>` : ""}</div>${r?.findings?.length ? `<details class="review-findings"><summary>${r.findings.length} 个问题证据</summary>${r.findings.map(f => `<div class="review-finding"><strong>${esc(kinds[f.category])} · ${time(f.start)}</strong><p>${esc(f.description)}</p><p class="muted">置信度 ${Math.round(f.confidence * 100)}% · ${esc(f.suggestion)}</p><div class="review-frames">${f.frameIds.map(id => r.frames.find(frame => frame.id === id)).filter(Boolean).map(frame => `<button data-seek="${frame.time}" data-review-video="${d.id}" title="定位 ${time(frame.time)}"><img src="${fileUrl(frame.file)}" loading="lazy" alt="${time(frame.time)} 质检证据"><span>${time(frame.time)}</span></button>`).join("")}</div></div>`).join("")}</details>` : ""}</section>`;
}
function createProject(catalogIndex) {
  const source = catalogIndex === undefined ? null : catalog.items[catalogIndex];
  modal(source ? "建立复刻项目" : "新建短剧项目", field("项目名称", "title", source?.title || "", "input", "required maxlength=160") + field("创作方向", "brief", "保留戏剧结构与情绪节奏，生成原创角色与场景。", "textarea", "maxlength=6000") + `<label class="checkbox-label"><input name="rights" type="checkbox">我已取得片源分析及改编使用所需权限</label>`, async values => {
    const p = await api("/projects", { title: values.get("title"), brief: values.get("brief"), rightsConfirmed: values.has("rights"), ...(source ? { catalogIndex } : {}) });
    await refreshProjects(); await openProject(p.id);
  }, "创建项目");
}
async function run(stage) {
  if (project.uploadWorkflow && !project.production && stage !== "analyze") {
    if (typeof continueUpload !== "function") return notify("上传工作流脚本尚未加载，请稍候或刷新页面。", true);
    return busy(null, continueUpload);
  }
  const eps = selectedEpisodes();
  if (!eps.length) { notify("请在片源与分集中选择要处理的集数。", true); tab = "episodes"; renderProject(); return; }
  const id = project.id;
  let plan;
  try { plan = await api(`/projects/${id}/preflight`, { stage, episodeIds: eps.map(e => e.id) }); }
  catch (error) { notify(error.message, true); return; }
  if (project?.id !== id) return;
  const counts = (label, c) => `<div class="record preflight-count"><strong>${label}</strong><span>新生成 ${c.new} · 复用 ${c.reuse} · 查询续接 ${c.resume} · 待核对 ${c.blocked}</span></div>`;
  const body = `<p>第 ${eps.map(e => e.number).join("、")} 集 · ${plan.reference + plan.firstFrame} 个已确定片段</p><p class="muted">${esc(plan.models)} · ${esc(plan.aspectRatio)} · ${esc(plan.resolution)} · 计划生成 ${plan.totalSeconds} 秒</p>${counts("图片", plan.images)}${counts("视频", plan.videos)}${plan.warnings.map(w => warning(esc(w))).join("")}${plan.blockers.map(w => warning(esc(w))).join("")}${warning(stage === "assemble" ? (plan.preserveSpeech ? "保留完整生成片段和句尾，不按原片窗口截断。" : "按原镜头时长剪裁并拼接，请先确认句尾不会被截断。") : "新生成会产生费用；续接已保存任务 ID，不重复提交。最终费用以服务商账单为准。")}`;
  modal(stage === "all" ? "运行至成片" : stages.find(s => s.id === stage).name, body + (plan.blockers.length ? "" : `${!project.rightsConfirmed ? `<label class="checkbox-label"><input type="checkbox" name="rights" required>确认拥有片源分析与改编使用所需权限</label>` : ""}<label class="checkbox-label"><input type="checkbox" name="confirm" required>确认${stage === "assemble" ? "开始拼接" : "计费调用"}</label>`), async () => {
    if (plan.blockers.length) return;
    if (!project.rightsConfirmed) setProject(await api(`/projects/${project.id}`, { rightsConfirmed: true }, "PATCH"));
    setProject(await api(`/projects/${project.id}/run`, { stage, episodeIds: eps.map(e => e.id) }));
  }, plan.blockers.length ? "关闭并核对" : "开始运行");
}
function settings() {
  if (project.production) return modal("制作项目设置", field("项目名称", "title", project.title, "input", "required maxlength=160") + `<label class="checkbox-label"><input name="audio" type="checkbox" ${project.audio ? "checked" : ""}>Q4 生成声音</label><label class="checkbox-label"><input name="rights" type="checkbox" ${project.rightsConfirmed ? "checked" : ""}>已取得片源分析及改编使用权限</label>` + warning("变更声音设置将使已有视频失效，旧任务和文件保留。风格与路由固定在制作副本中。"), async v => { setProject(await api(`/projects/${project.id}`, { title: v.get("title"), audio: v.has("audio"), rightsConfirmed: v.has("rights") }, "PATCH")); await refreshProjects(); });
  modal("项目设置", field("项目名称", "title", project.title, "input", "required maxlength=160") + field("创作方向", "brief", project.brief, "textarea", "maxlength=6000") + `<div class="field-inline"><label class="field">画幅<select name="aspectRatio">${["9:16", "16:9", "1:1"].map(v => `<option ${project.aspectRatio === v ? "selected" : ""}>${v}</option>`).join("")}</select></label><label class="field">Q4 模式<select name="videoMode"><option value="img2video" ${project.videoMode === "img2video" ? "selected" : ""}>首帧图生视频</option><option value="reference2video" ${project.videoMode === "reference2video" ? "selected" : ""}>多资产参考生视频</option></select></label></div><label class="field">最大镜头窗口<select name="maxShotSeconds">${[5, 8, 12, 16].map(v => `<option value="${v}" ${project.maxShotSeconds === v ? "selected" : ""}>${v} 秒</option>`).join("")}</select></label><label class="checkbox-label"><input name="audio" type="checkbox" ${project.audio ? "checked" : ""}>Q4 生成声音</label><label class="checkbox-label"><input name="rights" type="checkbox" ${project.rightsConfirmed ? "checked" : ""}>已取得片源分析及改编使用权限</label>${warning("修改创作方向或画幅将使原分镜提示词、资产和视频失效，重新生成会计费。旧文件保留在生产包中。镜头窗口仅影响下一次拉片。")}`, async v => {
    setProject(await api(`/projects/${project.id}`, { title: v.get("title"), brief: v.get("brief"), aspectRatio: v.get("aspectRatio"), videoMode: v.get("videoMode"), maxShotSeconds: Number(v.get("maxShotSeconds")), audio: v.has("audio"), rightsConfirmed: v.has("rights") }, "PATCH")); await refreshProjects();
  });
}
document.addEventListener("click", event => {
  const preview = event.target.closest(".story-stills img,.media-preview img");
  if (preview?.dataset.assetImage) return previewAsset(preview.dataset.assetImage);
  if (preview) return modal(preview.alt || "素材预览", `<img src="${esc(preview.src)}" alt="${esc(preview.alt)}" style="width:100%;max-height:65vh;object-fit:contain">`, async () => {}, "关闭");
  const b = event.target.closest("button"); if (!b || b.disabled) return;
  if (b.dataset.previewAsset) return previewAsset(b.dataset.previewAsset);
  if (b.dataset.retryAsset) {
    const asset = project.assets.find(a => a.id === b.dataset.retryAsset), frame = b.closest(".asset-preview"), img = frame?.querySelector("img");
    if (asset?.image?.file && img) { frame.querySelector(".asset-image-fallback").innerHTML = `${icon("loader-circle")}<span>正在读取图片</span>`; img.src = `${fileUrl(asset.image.file)}?retry=${Date.now()}`; icons(); }
    return;
  }
  if (b.dataset.project) return void busy(b, () => openProject(b.dataset.project));
  if (b.dataset.catalog !== undefined) return createProject(Number(b.dataset.catalog));
  if (b.dataset.tab) { tab = b.dataset.tab; contentSignature = ""; $("#project-content").innerHTML = ""; renderProject(); return; }
  if (b.dataset.run) return run(b.dataset.run);
  if (b.dataset.review) {
    const d = project.deliveries.find(d => d.id === b.dataset.review), id = project.id;
    return modal("Gemini 成片质检", warning("仅检查已有视频，不重新生图或生视频。已完成的检测批次会复用；重新质检会另行计费并保留上一版报告。") + `<label class="checkbox-label"><input type="checkbox" name="paid" required>确认 Gemini 视觉分析计费</label>`, async () => setProject(await api(`/projects/${id}/deliveries/${d.id}/review`, { confirmPaid: true, force: d.visualReview?.status === "completed" })), "开始质检");
  }
  if (b.dataset.seek !== undefined) {
    const video = document.querySelector(`[data-delivery="${b.dataset.reviewVideo}"] video`);
    if (video) { video.currentTime = Number(b.dataset.seek); video.scrollIntoView({ block: "center" }); video.play().catch(() => {}); }
    return;
  }
  if (b.id === "create-production") return createProduction();
  if (b.id === "approve-continuity") return modal("确认相邻样片", `<label class="checkbox-label"><input type="checkbox" name="confirmed" required>已检查每集前两段：句尾完整、画外音正确、人物站位与动作衔接自然</label>`, async v => { setProject(await api(`/projects/${project.id}/continuity/approve`, { confirmed: v.has("confirmed") })); await run("all"); }, "确认并继续整集");
  if (b.id === "upload" || b.dataset.replace) { replaceEpisode = b.dataset.replace || null; $("#upload-input").multiple = !replaceEpisode; $("#upload-input").click(); return; }
  if (b.dataset.fetch) return void busy(b, async () => { notify("正在读取并保存分集视频…"); const p = await api(`/projects/${project.id}/import-url`, { episodeId: b.dataset.fetch }); if (project?.id === p.id) selected.add(b.dataset.fetch); setProject(p); notify("分集视频已保存"); });
  if (b.id === "import-link") return modal("导入分集链接",
    field("视频或播放页链接（每行一个）", "url", "", "textarea", "rows=4 required placeholder=\"https://cdn.example.com/ep01.mp4 或 https://cdn.example.com/ep01/index.m3u8\"") +
    field("分集名称前缀", "title", "链接分集") +
    `<label class="checkbox-label"><input type="checkbox" name="direct">这是视频直链（无文件扩展名）</label>` +
    `<label class="checkbox-label"><input type="checkbox" name="allowPreview">允许导入短于 20 秒的预览片</label>` +
    warning("支持 mp4 / mov / webm 直链与 HLS（m3u8）整集导入，每集 ≤15 分钟、≤500MB。红果网页端只公开约 10 秒预告，完整集在 App 内受保护；这类预览默认会被拒绝。"),
    async v => {
      const urls = String(v.get("url") || "").split(/[\r\n]+/).map(s => s.trim()).filter(Boolean).slice(0, 100);
      if (!urls.length) throw new Error("请填写至少一个链接。");
      const prefix = String(v.get("title") || "").trim() || "链接分集";
      const direct = v.has("direct"), allowPreview = v.has("allowPreview"), failures = [];
      for (const [index, url] of urls.entries()) {
        notify(`正在导入第 ${index + 1}/${urls.length} 个链接…`);
        try {
          const p = await api(`/projects/${project.id}/import-url`, { url, title: urls.length > 1 ? `${prefix} ${index + 1}` : prefix, direct, allowPreview });
          if (project?.id === p.id) setProject(p);
        } catch (error) { failures.push(`第 ${index + 1} 个：${error.message}`); }
      }
      if (failures.length) throw new Error(`已导入 ${urls.length - failures.length}/${urls.length} 个链接；失败：${failures.join("；")}`);
      notify(`已导入 ${urls.length} 个链接`);
      renderProject();
    }, "导入视频");
  if (b.dataset.preview) { const ep = project.episodes.find(e => e.id === b.dataset.preview); return modal(`第 ${ep.number} 集 · 原片`, `<video controls autoplay playsinline style="width:100%;max-height:60vh" src="${fileUrl(ep.file)}"></video>`, async () => {}, "关闭"); }
  if (b.dataset.editEpisode) {
    const ep = project.episodes.find(e => e.id === b.dataset.editEpisode);
    return modal("分集与对白", `<div class="field-inline">${field("集数", "number", ep.number, "input", "type=number min=1 max=999 required")}${field("标题", "title", ep.title, "input", "required")}</div>` + field("对白 / 字幕", "transcript", ep.transcript, "textarea", "maxlength=100000 rows=8") + warning("修改对白将重新拉片，并使该集原生成结果失效。") + `<label class="checkbox-label"><input name="reanalyze" type="checkbox">重新分析本集</label>`, async v => setProject(await api(`/projects/${project.id}/episodes/${ep.id}`, { number: Number(v.get("number")), title: v.get("title"), transcript: v.get("transcript"), reanalyze: v.has("reanalyze") }, "PATCH")));
  }
  if (b.dataset.deleteEpisode) return modal("移除分集", warning("从本项目移除该集，历史生成文件仍保留在生产包中。"), async () => { selected.delete(b.dataset.deleteEpisode); setProject(await api(`/projects/${project.id}/episodes/${b.dataset.deleteEpisode}`, {}, "DELETE")); }, "移除");
  if (b.dataset.editShot) {
    const s = project.episodes.flatMap(e => e.shots || []).find(s => s.id === b.dataset.editShot);
    const referenceOnly = project.production && (s.mode === "reference2video" || s.continuity?.type === "continue");
    const firstFrame = referenceOnly ? "" : field("首帧提示词", "imagePrompt", s.imagePrompt, "textarea", "required maxlength=10000 rows=5");
    return modal("分镜提示词", firstFrame + field("Q4 视频提示词", "prompt", s.prompt, "textarea", "required maxlength=4800 rows=6") + warning("修改提示词后，受影响的素材需重新生成。"), async v => setProject(await api(`/projects/${project.id}/shots/${s.id}`, { ...(referenceOnly ? {} : { imagePrompt: v.get("imagePrompt") }), prompt: v.get("prompt") }, "PATCH")));
  }
  if (b.dataset.editAsset) { const a = project.assets.find(a => a.id === b.dataset.editAsset); return modal(a.name, field("资产提示词", "prompt", a.prompt, "textarea", "required maxlength=10000 rows=10") + warning("修改资产会使引用它的首帧与视频失效。"), async v => setProject(await api(`/projects/${project.id}/assets/${a.id}`, { prompt: v.get("prompt") }, "PATCH"))); }
  if (b.dataset.recover) return modal("核对生成任务", field("Vidu 任务 ID（已提交时补录）", "taskId", "") + warning("如果旧任务仍在生成，请补录任务 ID。重新提交可能重复计费。") + `<label class="checkbox-label"><input type="checkbox" name="confirmResubmit">已核对旧任务，确认重新提交</label>`, async v => setProject(await api(`/projects/${project.id}/recover`, { recordId: b.dataset.recover, taskId: v.get("taskId"), confirmResubmit: v.has("confirmResubmit") })));
});

document.addEventListener("error", event => {
  const img = event.target;
  if (!img.matches?.(".asset-preview img[data-asset-image]")) return;
  img.hidden = true;
  const fallback = img.parentElement.querySelector(".asset-image-fallback");
  fallback.hidden = false;
  fallback.innerHTML = `${icon("image-off")}<span>图片读取失败</span><button class="icon" data-retry-asset="${esc(img.dataset.assetImage)}" title="重新读取图片（不重新生成）" aria-label="重新读取图片">${icon("refresh-cw")}</button>`;
  icons();
}, true);
document.addEventListener("load", event => {
  const img = event.target;
  if (!img.matches?.(".asset-preview img[data-asset-image]")) return;
  img.hidden = false; img.parentElement.querySelector(".asset-image-fallback").hidden = true;
}, true);
document.addEventListener("keydown", event => {
  if (["Enter", " "].includes(event.key) && event.target.matches(".story-stills img,.media-preview img")) { event.preventDefault(); event.target.click(); }
});
document.addEventListener("change", event => {
  const el = event.target;
  if (el.dataset.select) { el.checked ? selected.add(el.dataset.select) : selected.delete(el.dataset.select); renderProject(); }
  if (el.id === "select-all") { selected = new Set(el.checked ? project.episodes.filter(available).map(e => e.id) : []); renderProject(); }
  if (el.id === "episode-filter") { episodeFilter = el.value; renderProject(); }
  if (el.dataset.include) busy(null, async () => setProject(await api(`/projects/${project.id}/shots/${el.dataset.include}`, { included: el.checked }, "PATCH")));
});
$("#upload-input").addEventListener("change", async event => {
  const files = [...event.target.files]; const projectId = project.id; const replacing = replaceEpisode; event.target.value = "";
  await busy(null, async () => {
    for (let i = 0; i < files.length; i++) {
      const file = files[i]; if (file.size > 500 * 1024 * 1024) throw new Error(`${file.name} 超过 500MB`);
      notify(`正在导入 ${i + 1}/${files.length}：${file.name}`);
      const query = new URLSearchParams({ title: file.name, ...(replacing ? { replace: replacing } : {}) });
      const response = await fetch(`/api/drama/projects/${projectId}/episodes?${query}`, { method: "POST", body: file, headers: { "Content-Type": file.type || "application/octet-stream" } });
      const p = await response.json(); if (!response.ok) throw new Error(p.error);
      if (project?.id === projectId) { selected.add(replacing || p.episodes.at(-1).id); setProject(p); }
    }
    notify("分集已保存"); await refreshProjects();
  });
});
$("#source-form").addEventListener("submit", event => { event.preventDefault(); busy(event.submitter, async () => { catalog = await api("/catalog", { url: $("#source-url").value, metric: $("#metric").value }); renderCatalog(); notify(`已读取 ${catalog.items.length} 部剧集`); }); });
$("#catalog-nav").onclick = () => { project = null; history.replaceState(null, "", "/drama.html"); $("#catalog-view").hidden = false; $("#project-view").hidden = true; renderNav(); };
$("#new-project").onclick = () => createProject(); $("#local-project").onclick = () => createProject();
$("#project-settings").onclick = settings; $("#run-all").onclick = () => run("all");
$("#stop").onclick = event => busy(event.currentTarget, async () => { setProject(await api(`/projects/${project.id}/stop`, {})); notify("暂停已请求，当前调用返回后保存结果。"); });
const closeModal = () => { $("#modal").close(); $("#modal-body").innerHTML = ""; };
$("#close-modal").onclick = closeModal; $("#cancel-modal").onclick = closeModal;
$("#modal").addEventListener("close", () => { $("#modal-body").innerHTML = ""; });
$("#modal-form").addEventListener("submit", event => { event.preventDefault(); busy(event.submitter, async () => { const next = await modalSubmit(new FormData(event.currentTarget)); closeModal(); if (typeof next === "function") await next(); }); });
window.addEventListener("hashchange", () => {
  const id = location.hash.slice(1);
  if (/^[a-f0-9-]{36}$/.test(id) && id !== project?.id) busy(null, () => openProject(id));
  else if (!id) { project = null; $("#catalog-view").hidden = false; $("#project-view").hidden = true; renderNav(); }
});
async function init() {
  icons(); renderCatalog();
  await busy(null, async () => { await refreshProjects(); catalog = await api("/catalog"); renderCatalog(); if (/^[a-f0-9-]{36}$/.test(location.hash.slice(1))) await openProject(location.hash.slice(1)); });
  await busy(null, async () => { const h = await api("/health"); const ready = h.llmConfigured && h.viduConfigured && h.ffmpeg && h.ffprobe; $("#health").innerHTML = `<span class="dot ${ready ? "ready" : "error"}"></span>${ready ? "服务已就绪" : "配置未齐全"}`; $("#health").title = `LLM: ${h.llmConfigured} / Vidu: ${h.viduConfigured} / FFmpeg: ${h.ffmpeg} / FFprobe: ${h.ffprobe}${h.concurrency ? `\n并发上限：项目 ${h.concurrency.projects.limit} / GPT ${h.concurrency.llm.limit} / 生图 ${h.concurrency.images.limit} / 视频 ${h.concurrency.videos.limit}` : ""}`; });
}
setInterval(async () => {
  if (!project || fetching || (!isRunning() && Date.now() - lastRefresh < 15000)) return;
  fetching = true; lastRefresh = Date.now(); const projectId = project.id, wasRunning = isRunning(), previousJobId = project.job?.id;
  try { const p = await api(`/projects/${projectId}`); if (project?.id === projectId) { setProject(p); if (!isRunning()) { await refreshProjects(); if (p.job && (wasRunning || p.job.id !== previousJobId)) notify(p.job.status === "completed" ? "本次任务已完成" : p.job.error || statusNames[p.job.status], p.job.status === "failed"); } } }
  catch (error) { notify(`服务连接中断，生成记录保留在服务端。${error.message}`, true); }
  finally { fetching = false; }
}, 4000);
init();
