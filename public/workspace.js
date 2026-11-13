"use strict";
const $ = s => document.querySelector(s);
const esc = v => String(v ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const icon = name => `<i data-lucide="${name}"></i>`;
const titles = { tasks: "任务中心", library: "统一素材库", characters: "角色管理", trials: "模型试跑", services: "AI 服务", styles: "风格预设", agents: "Agent 配置", storage: "存储与关于" };
const kinds = { character: "角色", prop: "道具", environment: "环境", frame: "分镜首帧", image: "历史图片", video: "镜头视频", delivery: "成片" };
const states = { running: "运行中", paused: "已暂停", interrupted: "待恢复", completed: "已完成", failed: "失败", unknown: "提交结果未知", submitting: "提交中", success: "成功", processing: "生成中", queueing: "排队中", created: "已提交" };
let config, data, library, libraryAvailable = true, dirty = false, current = "", timer, loading = false, libraryPage = 1, uploadingRole, modalAction;
const filters = { query: "", project: "", kind: "", status: "" };
const icons = () => {
  window.lucide?.createIcons();
  for (const card of document.querySelectorAll(".library-grid .media-item")) {
    const video = card.querySelector("video"), id = card.querySelector("[data-preview]")?.dataset.preview;
    const item = video && library?.items.find(i => i.id === id);
    if (item?.posterFile) video.poster = fileUrl(item, item.posterFile);
  }
};
const fileUrl = (item, file = item.previewFile) => `${item.sourceId ? `/api/drama/library/files/${item.sourceId}` : "/api/drama/files"}/${item.projectId}/${file.split("/").map(encodeURIComponent).join("/")}`;
const projectUrl = id => `/drama.html#${id}`;
const field = (label, name, value, attrs = "") => `<label class="field">${label}<input name="${name}" value="${esc(value)}" ${attrs}></label>`;
const textarea = (label, name, value, max) => `<label class="field">${label}<textarea name="${name}" maxlength="${max}">${esc(value)}</textarea></label>`;
const badge = state => `<span class="badge ${["failed", "unknown", "interrupted"].includes(state) ? "warn" : ["completed", "success"].includes(state) ? "success" : ""}">${esc(states[state] || state || "未启动")}</span>`;
const empty = text => `<div class="empty">${icon("inbox")}<p>${text}</p></div>`;
async function api(url, body, method = body === undefined ? "GET" : "POST") {
  const r = await fetch(`/api/drama${url}`, { method, headers: body === undefined ? {} : { "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
  const result = await r.json();
  if (!r.ok) throw Object.assign(new Error(result.error || `请求失败 (${r.status})`), { status: r.status });
  return result;
}
function notify(text, error = false) { clearTimeout(timer); $("#notice").textContent = text; $("#notice").className = error ? "error" : ""; $("#notice").hidden = false; timer = setTimeout(() => $("#notice").hidden = true, error ? 14000 : 7000); }
const saveButton = `<div class="dialog-actions"><button class="button primary" type="submit">${icon("save")}保存设置</button></div>`;
function serviceForm() {
  const t = config.services.text, v = config.services.vidu, g = config.services.gemini;
  const keyField = (name, c) => field(`API Key · ${c.configured ? "已配置，留空保留" : "未配置"}`, `${name}Key`, "", 'type="password" autocomplete="new-password" maxlength="1024"');
  return `<form id="settings-form" class="workspace-form"><p class="scope-note">${esc(config.scope)}</p>
    <section class="workspace-section"><div class="section-title"><h2>文本与视觉分析</h2>${badge(t.configured ? "已配置" : "未配置")}</div>
    <p class="muted">OpenAI Responses 兼容协议 · ${t.source === "inherited" ? "继承启动配置" : "工作区配置"}</p>
    ${field("Base URL", "textBase", t.baseUrl, 'type="url" required')}${keyField("text", t)}
    <div class="field-inline">${field("模型 ID", "textModel", t.model, 'required maxlength="160"')}<label class="field">推理强度<select name="effort">${["low", "medium", "high"].map(x => `<option value="${x}" ${x === t.reasoningEffort ? "selected" : ""}>${{ low: "低", medium: "中", high: "高" }[x]}</option>`).join("")}</select></label></div>
    <button class="button" type="button" data-probe="text">${icon("wifi")}检测已保存配置</button><p class="service-result" id="text-result"></p></section>
    ${g ? `<section class="workspace-section"><div class="section-title"><h2>Gemini 成片质检</h2>${badge(g.configured ? "已配置" : "未配置")}</div><p class="muted">Responses 兼容网关 · 风格突变 / 畸形多肢 / 角色漂移</p>${field("Base URL", "geminiBase", g.baseUrl, 'type="url" required')}${keyField("gemini", g)}${field("Gemini 模型 ID", "geminiModel", g.model, 'required maxlength="160"')}<label class="field">抽帧间隔<select name="geminiInterval">${[1, 2, 4].map(n => `<option value="${n}" ${n === g.intervalSeconds ? "selected" : ""}>${n} 秒</option>`).join("")}</select></label><label class="checkbox-label"><input type="checkbox" name="geminiEnabled" ${g.enabled ? "checked" : ""}>拼接后自动进行 Gemini 质检（计费）</label><button class="button" type="button" data-probe="gemini">${icon("wifi")}检测已保存配置</button><p class="service-result" id="gemini-result"></p></section>` : ""}
    <section class="workspace-section"><div class="section-title"><h2>图片与视频</h2>${badge(v.configured ? "已配置" : "未配置")}</div>
    <p class="muted">Vidu · Token 鉴权 · ${v.source === "inherited" ? "继承启动配置" : "工作区配置"}</p>
    ${field("Base URL", "viduBase", v.baseUrl, 'type="url" required')}${keyField("vidu", v)}
    <div class="record"><span>角色 / 道具 / 环境</span><strong>viduimage-2</strong></div><div class="record"><span>制作副本 · 参考生 / 图生</span><strong>viduq4-preview</strong></div><p class="muted">16 秒 · 9:16 · 2K；既有项目保留原参数。</p>
    <button class="button" type="button" data-probe="vidu">${icon("wifi")}查询历史任务验证</button><p class="service-result" id="vidu-result"></p></section>
    ${["wan", "minimax"].filter(k => config.services[k]).map(k => { const c = config.services[k]; return `<section class="workspace-section"><div class="section-title"><h2>${esc(c.label)}</h2>${badge(c.configured ? "已配置" : "未配置")}</div><p class="muted">${esc(c.model)} · ${c.minDuration}-${c.maxDuration} 秒 · ${c.resolutions.join(" / ")}</p>${field("Base URL", `${k}Base`, c.baseUrl, 'type="url" required')}${keyField(k, c)}<button class="button" type="button" data-probe="${k}">${icon("wifi")}查询历史任务验证</button><p class="service-result" id="${k}-result"></p></section>`; }).join("")}
    <p class="warning">修改服务地址必须重填密钥；已有媒体任务的服务地址不可变更。${esc(config.storage.secrets)}</p>${saveButton}</form>`;
}
function trialResults() {
  const trials = data.modelTrials || [];
  return trials.length ? trials.slice().reverse().map(t => {
    const v = t.video, job = data.projects.find(p => p.id === t.projectId)?.job, running = job?.status === "running", saved = data.items.find(i => i.trialId === t.id && i.projectId === t.projectId);
    const error = v?.error || v?.lastPollError || (job?.trialId === t.id ? job.error : "");
    return `<article class="task-project"><div class="section-title"><h3>${esc(config.services[t.input.provider]?.label || t.input.provider)} · ${esc(t.projectTitle)}</h3>${badge(saved ? "success" : v?.state || "待提交")}</div><p class="muted">${t.input.duration}s · ${esc(t.input.resolution)} · ${esc(t.input.mode)} · ${esc(t.createdAt.slice(0, 16).replace("T", " "))}</p><p>${esc(t.input.prompt)}</p>${v?.taskId ? `<code>${esc(v.taskId)}</code>` : ""}${error && !saved ? `<p class="error-text">${esc(error)}</p>` : ""}${saved ? `<video class="trial-video" controls playsinline preload="none" src="${fileUrl(saved)}"></video><a class="button small" href="${fileUrl(saved, saved.file)}?download">${icon("download")}下载原文件</a>` : `<div class="actions">${v && !v.taskId && ["unknown", "submitting"].includes(v.state) ? `<button class="button" data-trial-task="${t.id}" ${running ? "disabled" : ""}>${icon("link")}补录任务 ID</button>` : v?.state !== "failed" ? `<button class="button" data-trial-resume="${t.id}" ${running ? "disabled" : ""}>${icon("refresh-cw")}${v?.taskId ? "查询原任务" : "提交生成"}</button>` : ""}${running ? `<button class="button" data-stop="${t.projectId}">${icon("pause")}暂停等待</button>` : ""}</div>`}</article>`;
  }).join("") : empty("暂无模型试跑记录");
}
function trialsForm() {
  if (!config.services.wan) return empty("当前服务未加载新模型，请完成服务重启。");
  return `<div class="workspace-form"><form id="trial-form" data-request-id="${crypto.randomUUID()}"><section class="workspace-section">${targetProjects()}<div class="field-inline"><label class="field">模型<select name="provider">${["wan", "minimax"].map(k => `<option value="${k}">${esc(config.services[k].label)}${config.services[k].configured ? "" : "（未配置密钥）"}</option>`).join("")}</select></label><label class="field">模式<select name="mode"><option value="r2v">参考生视频</option><option value="i2v">图生视频</option><option value="t2v">文生视频</option></select></label></div><div class="field-inline">${field("时长（秒）", "duration", 16, 'type="number" min="2" max="30" step="1" required')}<label class="field">清晰度<select name="resolution"><option>480P</option><option>720P</option><option selected>1080P</option></select></label><label class="field">画幅<select name="ratio">${["9:16", "16:9", "1:1", "4:3", "3:4", "21:9"].map(r => `<option>${r}</option>`).join("")}</select></label></div><p id="trial-spec" class="muted">Wan 3.0 · 2-30 秒；原有 Q4 分镜配置不变。</p>${textarea("视频提示词", "prompt", "", 12000)}<div id="trial-images"><label class="field">已保存的图片<select id="trial-asset"><option value="">选择角色 / 道具 / 环境 / 首帧</option>${library.items.filter(i => !["video", "delivery"].includes(i.kind)).map(i => `<option value="${esc(i.id)}">${esc(i.title)} · ${esc(i.projectTitle)}${i.sourceUrl ? "" : "（仅本机）"}</option>`).join("")}</select></label><button class="button small" type="button" id="trial-add-image">${icon("plus")}加入参考</button>${textarea("图片公网链接（每行一张，按顺序对应角色；图生依次为首帧、可选尾帧）", "images", "", 80000)}</div><label class="checkbox-label"><input type="checkbox" name="paid" required>确认素材使用权限并发起一次计费生成</label><div class="dialog-actions"><button class="button primary" type="submit" ${data.projects.length ? "" : "disabled"}>${icon("clapperboard")}生成试跑视频</button></div></section></form><section class="workspace-section"><div class="section-title"><h2>试跑记录</h2><button class="icon" id="refresh-trials" title="刷新任务" aria-label="刷新任务">${icon("refresh-cw")}</button></div><div id="trial-results">${trialResults()}</div></section></div>`;
}
async function refreshTrials() {
  data = await api("/workspace");
  if (current === "trials" && $("#trial-results")) { $("#trial-results").innerHTML = trialResults(); icons(); }
}
function styleForm() {
  return `<form id="settings-form" class="workspace-form"><p class="scope-note">新建制作副本时锁定。已有角色图、提示词和成片不变。</p>${Object.entries(config.styles).map(([key, s]) => `<section class="workspace-section"><h2>${esc(s.name)}</h2><p class="base-prompt">${esc(s.prompt)}</p>${textarea("补充风格要求", key, s.supplement, 2000)}</section>`).join("")}${saveButton}</form>`;
}
function agentForm() {
  return `<form id="settings-form" class="workspace-form"><p class="scope-note">新项目使用保存时的指令快照。原有 JSON 格式、证据要求和语速校验仍然执行。</p>${[["analyze", "Agent 1 · 采集与拉片"], ["assets", "Agent 2 · 分镜与资产"], ["video", "Agent 3 · 视频质检"], ["assemble", "Agent 4 · Gemini 成片质检"]].filter(([key]) => config.agents[key] !== undefined).map(([key, title]) => `<section class="workspace-section"><h2>${title}</h2>${textarea("补充指令", key, config.agents[key], 4000)}</section>`).join("")}${saveButton}</form>`;
}
function toolbar(assetsMode) {
  const projects = assetsMode ? library.projects : data.projects;
  return `<div class="workspace-toolbar"><label class="field">搜索<input id="query" type="search" value="${esc(filters.query)}" placeholder="项目、角色、镜头或任务 ID"></label><label class="field">项目<select id="project-filter"><option value="">全部项目</option>${projects.map(p => `<option value="${p.projectKey || p.id}" ${filters.project === (p.projectKey || p.id) ? "selected" : ""}>${esc(p.title)}${p.sourceLabel ? ` · ${esc(p.sourceLabel)}` : ""}</option>`).join("")}</select></label>${assetsMode ? (current === "characters" ? "" : `<label class="field">素材类型<select id="kind-filter"><option value="">全部素材</option>${Object.entries(kinds).map(([k, v]) => `<option value="${k}" ${filters.kind === k ? "selected" : ""}>${v}</option>`).join("")}</select></label>`) : `<label class="field">任务状态<select id="status-filter"><option value="">全部状态</option><option value="attention" ${filters.status === "attention" ? "selected" : ""}>需处理</option><option value="active" ${filters.status === "active" ? "selected" : ""}>进行中</option><option value="saved" ${filters.status === "saved" ? "selected" : ""}>已保存</option></select></label>`}</div>`;
}
function matches(item) { return (!filters.project || (item.projectKey || item.projectId) === filters.project) && `${item.projectTitle} ${item.title || item.name || ""} ${item.description || ""} ${item.identityKey || ""} ${item.taskId || ""}`.toLowerCase().includes(filters.query.toLowerCase()); }
function libraryResults() {
  const items = library.items.filter(i => matches(i) && (!filters.kind || i.kind === filters.kind));
  const pages = Math.max(1, Math.ceil(items.length / 18)); libraryPage = Math.min(libraryPage, pages);
  return `<p class="muted">${items.length} 项 · ${library.sources.length} 个本机工作区</p>${library.warnings.map(w => `<p class="warning">${esc(w)}</p>`).join("")}${items.length ? `<div class="media-grid library-grid">${items.slice((libraryPage - 1) * 18, libraryPage * 18).map(i => `<article class="media-item"><div class="media-preview">${["video", "delivery"].includes(i.kind) ? `<video controls playsinline preload="none" src="${fileUrl(i)}"></video>` : `<button data-preview="${esc(i.id)}" title="查看${esc(i.title)}"><img src="${fileUrl(i)}" alt="${esc(i.title)}" loading="lazy"></button>`}</div><h3>${esc(i.title)}</h3><div class="tag-row">${badge(kinds[i.kind] || "图片")}${i.stale ? badge("历史版本") : ""}<span class="muted">${esc(i.model)}</span></div><p class="description">${esc(i.projectTitle)} · ${esc(i.sourceLabel)}</p><p>${esc(i.description)}</p><div class="actions"><button class="icon" data-preview="${esc(i.id)}" title="查看资产与描述" aria-label="查看资产与描述">${icon("maximize-2")}</button><a class="icon" href="${fileUrl(i, i.file)}?download" title="下载原文件" aria-label="下载原文件">${icon("download")}</a>${i.assetId ? `<button class="button small" data-reuse="${esc(i.id)}">${icon("copy-plus")}复用到项目</button>` : ""}<a class="button small" href="${i.projectUrl}">进入项目${icon("arrow-up-right")}</a></div></article>`).join("")}</div>${pagination(pages)}` : empty("暂无符合条件的已保存素材")}`;
}
function pagination(pages) { return `<div class="workspace-pagination"><button class="icon" id="prev-page" ${libraryPage === 1 ? "disabled" : ""} title="上一页" aria-label="上一页">${icon("chevron-left")}</button><span class="muted">${libraryPage} / ${pages}</span><button class="icon" id="next-page" ${libraryPage === pages ? "disabled" : ""} title="下一页" aria-label="下一页">${icon("chevron-right")}</button></div>`; }
function roleResults() {
  const roles = library.characters.filter(matches), pages = Math.max(1, Math.ceil(roles.length / 18)); libraryPage = Math.min(libraryPage, pages);
  return `<p class="muted">${roles.length} 个角色 · 各制作版本独立保留</p>${roles.length ? `<div class="media-grid library-grid">${roles.slice((libraryPage - 1) * 18, libraryPage * 18).map(a => `<article class="media-item"><div class="media-preview">${a.file ? `<button data-role="${esc(a.id)}"><img src="${fileUrl(a)}" alt="${esc(a.name)}" loading="lazy"></button>` : `<button data-role="${esc(a.id)}" title="管理${esc(a.name)}">${icon("user-round")}</button>`}</div><h3>${esc(a.name)}</h3><div class="tag-row">${badge(a.file ? "参考图已保存" : "待上传 / 生成")}${badge(`${a.appearances.length} 个出场镜头`)}</div><p class="description">${esc(a.projectTitle)} · ${esc(a.sourceLabel)}</p><p>${esc(a.description || a.prompt)}</p><div class="actions"><button class="button small" data-role="${esc(a.id)}">${icon(a.editable ? "contact" : "eye")}${a.editable ? "管理角色" : "查看角色"}</button>${a.file ? `<button class="icon" data-reuse-role="${esc(a.id)}" title="复制角色到当前项目" aria-label="复制角色到当前项目">${icon("copy-plus")}</button>` : ""}</div></article>`).join("")}</div>${pagination(pages)}` : empty("暂无符合条件的角色")}`;
}
function results() { return current === "library" ? libraryResults() : current === "characters" ? roleResults() : taskResults(); }
function manageDialog(title, html, onSubmit) {
  $("#preview-title").textContent = title; modalAction = onSubmit;
  $("#preview-body").innerHTML = html; icons(); if (!$("#preview").open) $("#preview").showModal();
}
function targetProjects() { return `<label class="field">目标项目<select name="target" required>${data.projects.map(p => `<option value="${p.id}">${esc(p.title)}</option>`).join("")}</select></label>`; }
function reuseAsset(item) {
  if (!data.projects.length) return notify("请先在当前工作区新建项目。", true);
  manageDialog("复用资产到项目", `<form id="asset-form">${targetProjects()}<p class="muted">独立复制参考图与描述，不生成、不计费，也不改动原项目。导入后可在角色管理中设置出场镜头。</p>${saveButton}</form>`, async v => {
    await api(`/projects/${v.get("target")}/assets/import`, { sourceId: item.sourceId, projectId: item.projectId, assetId: item.assetId });
  });
}
function roleDialog(a) {
  const image = a.file ? `<img src="${fileUrl(a)}" alt="${esc(a.name)}">` : `<p class="muted">参考图尚未生成</p>`;
  const details = `<p class="muted">身份 ID：${esc(a.identityKey)} · ${esc(a.sourceLabel)}</p><details class="asset-details"><summary>外观提示词与出场</summary><p>${esc(a.prompt)}</p><p>${a.appearances.map(s => `第 ${s.episodeNumber} 集 · ${esc(s.title)}`).join("<br>") || "尚未关联出场镜头"}</p></details>${a.history.length ? `<details class="asset-details"><summary>历史参考图（${a.history.length}）</summary><div class="reference-history">${a.history.map(r => `<a href="${fileUrl(a, r.file)}" target="_blank"><img src="${fileUrl(a, r.file)}" alt="历史参考图" loading="lazy"></a>`).join("")}</div></details>` : ""}`;
  manageDialog(a.name, image + details + (a.editable ? `<div class="actions role-actions"><button class="button" data-upload-role="${esc(a.id)}">${icon("upload")}${a.file ? "替换参考图" : "上传参考图"}</button><button class="button" data-cast="${esc(a.id)}">${icon("list-video")}出场镜头</button></div><form id="asset-form">${field("展示名称", "name", a.name, 'required maxlength="120"')}${textarea("角色描述", "description", a.description || a.prompt, 3000)}<p class="muted">仅更新档案，不改写已生成的图片和视频提示词。</p>${saveButton}</form>` : `<p>${esc(a.description || a.prompt)}</p><p class="muted">历史工作区只读，可复制到当前项目后管理。</p>${a.file ? `<button class="button" data-reuse-role="${esc(a.id)}">${icon("copy-plus")}复用到项目</button>` : ""}`), async v => api(`/projects/${a.projectId}/assets/${a.assetId}/profile`, { name: v.get("name"), description: v.get("description") }, "PATCH"));
}
function taskResults() {
  const list = data.tasks.filter(t => matches(t) && (!filters.status || (filters.status === "attention" ? ["failed", "unknown", "submitting"].includes(t.state) : filters.status === "saved" ? t.saved : !t.saved && !["failed", "unknown", "submitting"].includes(t.state))));
  return list.length ? `<p class="muted">${list.length} 条 · 已保存任务 ID 可在项目内核对续接</p><div class="workspace-table-wrap"><table class="workspace-table"><thead><tr><th>项目 / 模型</th><th>状态</th><th>任务 ID</th><th>积分</th></tr></thead><tbody>${list.slice().reverse().slice(0, 200).map(t => `<tr><td><a href="${projectUrl(t.projectId)}">${esc(t.projectTitle)}</a><p class="muted">${esc(t.model)}</p></td><td>${badge(t.saved ? "success" : t.state)}${t.error ? `<p class="error-text">${esc(t.error)}</p>` : ""}</td><td><code>${esc(t.taskId || "未返回，请核对")}</code></td><td>${t.credits ?? "未返回"}</td></tr>`).join("")}</tbody></table></div>${list.length > 200 ? `<p class="muted">当前显示最近 200 条，请按项目筛选。</p>` : ""}` : empty("暂无符合条件的任务");
}
function tasks() {
  const c = data.concurrency;
  return `<div class="production-metrics workspace-stats">${[["projects", "运行项目"], ["llm", "文本 / 视觉"], ["images", "生图"], ["videos", "生视频"]].map(([key, label]) => `<div><strong>${c[key].active}<small> / ${c[key].limit}</small></strong><span>${label}${c[key].queued ? ` · 排队 ${c[key].queued}` : ""}</span></div>`).join("")}</div><p class="muted">本服务的本地并发限制，不代表账号配额；其他端口不计入。</p>${data.projects.length ? data.projects.map(p => `<article class="task-project"><div class="section-title"><h2><a href="${projectUrl(p.id)}">${esc(p.title)}</a></h2><div class="actions">${p.job?.status === "running" ? `<button class="button small" data-stop="${p.id}">${icon("pause")}暂停</button>` : ""}<a class="button small" href="${projectUrl(p.id)}">查看项目${icon("arrow-up-right")}</a></div></div><div class="task-state">${badge(p.job?.status)}<span class="muted">${p.episodes} 集 · ${p.images} 张图 · ${p.videos} 个视频 · ${p.deliveries} 个成片</span>${p.job?.error ? `<p class="error-text">${esc(p.job.error)}</p>` : ""}</div></article>`).join("") : empty("暂无短剧项目")}<div class="section-title"><h2>生成任务</h2></div>${toolbar(false)}<div id="results">${taskResults()}</div>`;
}
function storage() {
  return `<div class="workspace-form"><section class="workspace-section"><h2>本机存储</h2><p>当前短剧工作区</p><code class="workspace-path">${esc(config.storage.root)}</code><p>设置文件</p><code class="workspace-path">${esc(config.storage.settingsFile)}</code><p class="muted">可用空间：${data.freeBytes == null ? "系统未返回" : `${(data.freeBytes / 1024 ** 3).toFixed(1)} GB`} · ${data.projects.length} 个项目 · ${data.items.length} 项已保存素材</p><p class="warning">${esc(config.storage.secrets)} 当前入口不迁移或删除素材。</p></section><section class="workspace-section"><h2>SIRIHOTDRAMA</h2><p>本地工作区 · 版本 1</p><p class="muted">既有短剧制作流程与项目数据保留。当前版本没有自动更新器。</p><a class="button" href="https://github.com/chatfire-AI/huobao-drama" target="_blank" rel="noreferrer">${icon("external-link")}功能设计参考</a><p class="muted">参考产品功能设计，独立实现；未复制其代码或替换当前框架。</p></section></div>`;
}
function render() {
  current = Object.hasOwn(titles, location.hash.slice(1)) ? location.hash.slice(1) : "tasks";
  $("#page-title").textContent = titles[current]; document.title = `SIRIHOTDRAMA · ${titles[current]}`;
  document.querySelectorAll('.sidebar a[href^="#"]').forEach(a => a.classList.toggle("active", a.hash === `#${current}`));
  $("#content").innerHTML = ({ tasks, trials: trialsForm, library: () => `${toolbar(true)}<div id="results">${libraryResults()}</div>`, characters: () => `<div class="section-title"><h2>角色档案</h2><button class="button primary" id="new-role">${icon("user-plus")}新建角色</button></div>${toolbar(true)}<div id="results">${roleResults()}</div>`, services: serviceForm, styles: styleForm, agents: agentForm, storage })[current]();
  if (!libraryAvailable) {
    $("#content").insertAdjacentHTML("afterbegin", '<p class="warning">当前服务尚未加载统一素材库与角色管理，请重启此端口服务。已有素材仍可查看。</p>');
    if ($("#new-role")) $("#new-role").disabled = true;
  }
  icons();
}
async function refresh() {
  if (loading) return;
  if (dirty && !confirm("刷新将放弃尚未保存的设置，继续吗？")) return;
  loading = true; $("#refresh").disabled = true;
  try {
    config = await api("/settings"); data = await api("/workspace");
    try { library = await api("/library"); libraryAvailable = true; }
    catch (error) {
      if (error.status !== 404) throw error;
      libraryAvailable = false;
      library = { projects: data.projects, characters: [], sources: [{ id: "current" }], warnings: [], items: data.items.map(i => ({ ...i, assetId: undefined, projectUrl: projectUrl(i.projectId), sourceLabel: "当前工作区" })) };
    }
    dirty = false; render();
    $("#health").innerHTML = `<span class="dot ready"></span>${data.concurrency.projects.active} 个项目运行中`;
  } catch (error) { notify(error.message.includes("接口不存在") ? "当前服务尚未加载新版功能，请重启此端口服务后刷新。" : error.message, true); }
  finally { loading = false; $("#refresh").disabled = false; }
}
document.addEventListener("submit", async e => {
  if (e.target.id === "trial-form") {
    e.preventDefault(); const b = e.submitter; if (b.disabled) return; b.disabled = true;
    try {
      const v = new FormData(e.target), provider = v.get("provider");
      if (!config.services[provider].configured) throw new Error("请先在 AI 服务中配置本模型密钥。");
      const body = { id: e.target.dataset.requestId, provider, mode: v.get("mode"), prompt: v.get("prompt"), duration: Number(v.get("duration")), resolution: v.get("resolution"), ratio: e.target.elements.ratio.value, images: v.get("mode") === "t2v" ? [] : String(v.get("images")).split(/\r?\n/).map(s => s.trim()).filter(Boolean), confirmPaid: v.has("paid") };
      await api(`/projects/${v.get("target")}/trials`, body);
      e.target.dataset.requestId = crypto.randomUUID(); e.target.querySelector('[name="paid"]').checked = false; dirty = false;
      await refreshTrials(); notify("已提交，结果将保存到素材库；原有成片不变。");
    } catch (error) { notify(error.message, true); } finally { b.disabled = false; }
    return;
  }
  if (e.target.id === "asset-form") {
    e.preventDefault(); const b = e.submitter; if (b.disabled) return; b.disabled = true;
    try { await modalAction(new FormData(e.target)); $("#preview").close(); await refresh(); notify("资产已保存"); }
    catch (error) { notify(error.message, true); } finally { b.disabled = false; }
    return;
  }
  if (e.target.id !== "settings-form") return;
  e.preventDefault(); const button = e.submitter; if (button.disabled) return;
  button.disabled = true;
  try {
    const v = new FormData(e.target);
    const body = current === "services" ? { services: { text: { baseUrl: v.get("textBase"), apiKey: v.get("textKey"), model: v.get("textModel"), reasoningEffort: v.get("effort") }, vidu: { baseUrl: v.get("viduBase"), apiKey: v.get("viduKey") } } } : { [current]: Object.fromEntries(v) };
    if (current === "services" && config.services.gemini) body.services.gemini = { baseUrl: v.get("geminiBase"), apiKey: v.get("geminiKey"), model: v.get("geminiModel"), enabled: v.has("geminiEnabled"), intervalSeconds: Number(v.get("geminiInterval")) };
    if (current === "services") for (const k of ["wan", "minimax"]) if (config.services[k]) body.services[k] = { baseUrl: v.get(`${k}Base`), apiKey: v.get(`${k}Key`) };
    config = await api("/settings", body, "PATCH"); dirty = false; render(); notify("设置已保存");
  } catch (error) { notify(error.message, true); }
  finally { button.disabled = false; }
});
document.addEventListener("input", e => {
  if (e.target.closest("#settings-form,#trial-form")) dirty = true;
  if (e.target.id === "query") { filters.query = e.target.value; libraryPage = 1; $("#results").innerHTML = results(); icons(); }
});
document.addEventListener("change", e => {
  if (e.target.closest("#trial-form")) {
    const form = $("#trial-form"), c = config.services[form.elements.provider.value];
    if (e.target.name === "provider") {
      form.elements.duration.min = c.minDuration; form.elements.duration.max = c.maxDuration;
      form.elements.resolution.innerHTML = c.resolutions.map((r, i) => `<option ${i === c.resolutions.length - 1 ? "selected" : ""}>${r}</option>`).join("");
      $("#trial-spec").textContent = `${c.label} · ${c.minDuration}-${c.maxDuration} 秒；超出时长需手动调整提示词与语音，不会自动截短。`;
    }
    $("#trial-images").hidden = form.elements.mode.value === "t2v";
    form.elements.ratio.disabled = form.elements.mode.value === "i2v";
  }
  const key = { "project-filter": "project", "kind-filter": "kind", "status-filter": "status" }[e.target.id];
  if (key) { filters[key] = e.target.value; libraryPage = 1; $("#results").innerHTML = results(); icons(); }
});
document.addEventListener("click", async e => {
  const nav = e.target.closest("a");
  if (nav && dirty && !confirm("离开将放弃尚未保存的设置，继续吗？")) { e.preventDefault(); return; }
  if (nav) dirty = false;
  const b = e.target.closest("button"); if (!b || b.disabled) return;
  if (b.id === "trial-add-image") {
    const item = library.items.find(i => i.id === $("#trial-asset").value);
    if (!item) return notify("请先选择图片。", true);
    if (!item.sourceUrl) return notify("这张图片只有本机文件。请先提供服务商可访问的公网链接；不会自动上传私人素材。", true);
    const input = $('#trial-form [name="images"]'); input.value = [input.value.trim(), item.sourceUrl].filter(Boolean).join("\n"); dirty = true; return;
  }
  if (b.id === "refresh-trials" || b.dataset.trialResume || b.dataset.trialTask) {
    b.disabled = true;
    try {
      if (b.dataset.trialResume || b.dataset.trialTask) {
        const t = data.modelTrials.find(t => t.id === (b.dataset.trialResume || b.dataset.trialTask));
        if (b.dataset.trialTask) {
          const taskId = prompt("输入该模型控制台已确认的任务 ID（不会创建新任务）"); if (!taskId) return;
          await api(`/projects/${t.projectId}/trials/${t.id}/task`, { taskId: taskId.trim() });
        } else {
          if (!t.video && !confirm("此记录尚未提交。确认发起一次计费生成？")) return;
          await api(`/projects/${t.projectId}/trials/${t.id}/resume`, { confirmPaid: !t.video });
        }
      }
      await refreshTrials();
    } catch (error) { notify(error.message, true); } finally { b.disabled = false; }
    return;
  }
  if (b.id === "prev-page" || b.id === "next-page") { libraryPage += b.id === "next-page" ? 1 : -1; $("#results").innerHTML = results(); icons(); return; }
  if (b.dataset.role) return roleDialog(library.characters.find(a => a.id === b.dataset.role));
  if (b.dataset.reuse) return reuseAsset(library.items.find(i => i.id === b.dataset.reuse));
  if (b.dataset.reuseRole) return reuseAsset(library.characters.find(i => i.id === b.dataset.reuseRole));
  if (b.dataset.uploadRole) { uploadingRole = library.characters.find(a => a.id === b.dataset.uploadRole); $("#reference-upload").click(); return; }
  if (b.id === "new-role") {
    if (!data.projects.length) return notify("请先新建短剧项目。", true);
    return manageDialog("新建角色", `<form id="asset-form">${targetProjects()}${field("角色名称", "name", "", 'required maxlength="120"')}${textarea("外观提示词", "prompt", "", 10000)}<label class="field">视觉风格<select name="style"><option value="cinematic">真人电影质感</option><option value="anime2d">2D 动漫</option><option value="cg3d">3D 漫剧 CG</option></select></label>${saveButton}</form>`, async v => api(`/projects/${v.get("target")}/assets`, { name: v.get("name"), prompt: v.get("prompt"), style: v.get("style") }));
  }
  if (b.dataset.cast) {
    b.disabled = true;
    try {
      const a = library.characters.find(a => a.id === b.dataset.cast), p = await api(`/projects/${a.projectId}`);
      manageDialog(`${a.name} · 出场镜头`, `<form id="asset-form"><div class="cast-list">${p.episodes.map(ep => `<h3>第 ${ep.number} 集</h3>${(ep.shots || []).map(s => `<label class="checkbox-label"><input type="checkbox" name="shot" value="${s.id}" ${s.assetIds?.includes(a.assetId) ? "checked" : ""}>${esc(s.title || `${s.start}s`)} · ${esc((s.prompt || "").slice(0, 65))}</label>`).join("")}`).join("")}</div><p class="warning">修改会使受影响镜头及后续连续片段失效，旧文件保留。参考图绑定不自动改写剧情提示词，请保持人物描述一致。</p><label class="checkbox-label"><input type="checkbox" required>确认调整出场镜头</label>${saveButton}</form>`, async v => api(`/projects/${a.projectId}/assets/${a.assetId}/cast`, { shotIds: v.getAll("shot"), confirm: true }, "PUT"));
    } catch (error) { notify(error.message, true); } finally { b.disabled = false; }
    return;
  }
  if (b.dataset.preview) {
    const i = library.items.find(i => i.id === b.dataset.preview); if (!i) return;
    $("#preview-title").textContent = i.title;
    $("#preview-body").innerHTML = `${["video", "delivery"].includes(i.kind) ? `<video controls playsinline src="${fileUrl(i)}"></video>` : `<img src="${fileUrl(i)}" alt="${esc(i.title)}">`}<p>${esc(i.description)}</p><a class="button" href="${fileUrl(i, i.file)}?download">${icon("download")}下载原文件</a>`;
    icons(); $("#preview").showModal(); return;
  }
  if (b.dataset.probe || b.dataset.stop) {
    b.disabled = true;
    try {
      if (b.dataset.probe) {
        if (dirty) throw new Error("请先保存配置，再检测。");
        const result = await api("/settings/probe", { kind: b.dataset.probe });
        $(`#${b.dataset.probe}-result`).textContent = result.message;
        if (result.ok === false) notify(result.message, true);
      } else if (confirm("暂停本项目？已提交任务仍可能在服务商继续生成，恢复时将查询原任务 ID。")) { await api(`/projects/${b.dataset.stop}/stop`, {}); await refresh(); }
    } catch (error) { notify(error.message, true); }
    finally { b.disabled = false; }
  }
});
$("#close-preview").onclick = () => $("#preview").close();
$("#reference-upload").addEventListener("change", async e => {
  const file = e.target.files[0], a = uploadingRole; e.target.value = "";
  if (!file || !a) return;
  try {
    if (file.size > 12 * 1024 * 1024) throw new Error("图片不能超过12MB。");
    const impact = await api(`/projects/${a.projectId}/assets/${a.assetId}/impact`);
    if (impact.unresolved) throw new Error("相关任务尚未核对，暂不能替换参考图。");
    if (!confirm(`将保存新参考图，保留旧版本；${impact.shotIds.length} 个相关片段需重新制作（已有视频 ${impact.videoCount} 个）。确认上传？`)) return;
    notify("正在保存并校验参考图");
    const r = await fetch(`/api/drama/projects/${a.projectId}/assets/${a.assetId}/image?confirm=true`, { method: "POST", headers: { "Content-Type": file.type }, body: file });
    const result = await r.json(); if (!r.ok) throw new Error(result.error);
    $("#preview").close(); await refresh(); notify("参考图已保存，旧版本保留");
  } catch (error) { notify(error.message, true); }
});
$("#preview").addEventListener("close", () => $("#preview-body").replaceChildren());
$("#refresh").onclick = refresh;
window.addEventListener("beforeunload", e => { if (dirty) { e.preventDefault(); e.returnValue = ""; } });
window.addEventListener("hashchange", () => { if (config && data && library) { dirty = false; filters.project = ""; libraryPage = 1; render(); } });
setInterval(() => { if (current === "tasks" && !document.hidden && !loading) refresh(); }, 15000);
setInterval(() => { if (current === "trials" && !document.hidden && !loading) refreshTrials().catch(e => notify(e.message, true)); }, 15000);
refresh();
