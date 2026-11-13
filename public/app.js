const AGENT_META = {
  strategist: { name: "创意策略", color: "#3157ff" },
  prompt: { name: "提示词工程", color: "#ff6038" },
  director: { name: "分镜导演", color: "#087e60" },
  evaluator: { name: "评测 Agent", color: "#7655e7" },
};

const CREATIVE_STYLE_PRESETS = {
  auto: { label: "自动匹配", prompt: "保持创意目标与参考素材真实质感，先判断主体、场景、色彩和动作，再选择最合适的商业视觉语言。" },
  apple: { label: "Apple 极简科技", prompt: "极简科技产品广告，干净留白背景，单一主体构图，精准柔光勾勒材质与边缘，克制且有目的的产品动作，清晰展示一个核心功能瞬间，冷静高级的商业摄影。" },
  miumiu: { label: "Miu Miu 复古少女", prompt: "复古学院感时装广告，轻微怀旧的柔和色彩，精致但自然的少女姿态，俏皮而克制的生活化微动作，针织、皮革、缎面等材质细节，带有时装杂志编辑感的构图。" },
  cinematic: { label: "电影叙事", prompt: "电影化广告叙事，具有明确情绪弧线和动作因果，层次丰富的光影与空间纵深，自然且连续的运动，镜头之间通过视线、动作或光线完成衔接，真实电影摄影质感。" },
};

const SAMPLE_RESULT = {
  caseTitle: "酒红光带 · 时尚产品短片",
  intentSummary: "围绕人物与酒红色设备的色彩呼应，制作一条 8 秒、9:16 的高端时尚产品短片。",
  creativeStrategy: "用移动窄光替代复杂剧情，让产品材质、人物眼神和首饰高光依次成为注意力锚点，保证画面可控且适合多模型横向评测。",
  sourceAnalysis: {
    subject: "长黑发人物手持酒红色直板设备，黑色上衣与银色首饰形成材质对比。",
    scene: "浅灰色摄影棚，可拓展为极简光影棚拍环境。",
    style: "高端时尚、美妆广告、克制写实。",
    composition: "人物半身居中，产品靠近面部，双手形成稳定展示姿势。",
    opportunities: ["酒红色设备与裙装形成视觉呼应", "设备、耳饰与眼睛适合用移动光带串联", "主体姿势稳定，适合缓慢推镜"],
    risks: ["手指与设备边缘容易变形", "大幅动作会破坏产品展示关系", "光带过强可能造成面部过曝"],
  },
  agents: [
    { id: "strategist", headline: "把产品高光变成叙事线", output: "不依赖台词，用一道移动窄光推动注意力从产品、首饰到人物眼神。", bullets: ["前 2 秒建立人物与产品", "中段完成材质展示", "结尾以稳定凝视收束"] },
    { id: "prompt", headline: "约束身份与握持关系", output: "提示词优先固定发型、服装、设备位置和双手关系，再描述微动作与光线。", bullets: ["明确设备始终竖直", "人物动作控制在眨眼和微抬下巴", "负面词重点约束手部和文字水印"] },
    { id: "director", headline: "单镜头缓推完成信息递进", output: "使用 85mm 肖像感的缓慢推镜，不切镜，让移动光带承担节奏变化。", bullets: ["0-2 秒建立中景", "2-5 秒扫光与微动作", "5-8 秒近景定格"] },
    { id: "evaluator", headline: "建立四项统一验收标准", output: "重点评测主体一致性、产品结构、手部稳定和光影连续性。", bullets: ["身份一致性 30%", "产品结构 30%", "动作自然度 20%", "商业质感 20%"] },
  ],
  production: {
    format: "时尚产品短片",
    audience: "美妆与消费电子兴趣人群",
    duration: "8 秒",
    aspectRatio: "9:16",
    imagePrompt: "高端时尚棚拍，长黑发人物穿黑色修身上衣，手持酒红色直板设备靠近面部，银色长耳饰，浅灰摄影棚，柔和正面光与轮廓光，商业美妆摄影，写实细腻，9:16。",
    videoPrompt: "保持人物发型、妆容、服装、首饰和酒红色设备完全一致。人物正面站在浅灰摄影棚中，双手稳定展示设备；人物轻轻眨眼并略微抬起下巴，一道柔和窄光从左向右依次扫过设备表面、金属组件、耳饰和眼睛。镜头由半身中景缓慢推近至胸像特写，无切镜，动作克制，发梢和耳饰轻微晃动，写实高端商业质感，时间连续。",
    negativePrompt: "手指畸形、设备结构改变、人物身份漂移、脸部扭曲、突然转身、夸张表情、镜头抖动、背景闪烁、文字、水印、过曝。",
    storyboard: [
      { shot: "S01", time: "0-2s", visual: "人物与产品完整建立，正面柔光均匀照亮面部。", camera: "半身中景，缓慢推近", audio: "低频氛围音进入", prompt: "人物稳定直视镜头，保持呼吸与轻微眨眼。" },
      { shot: "S02", time: "2-5s", visual: "窄光依次扫过设备、金属圆环和银色耳饰。", camera: "持续推近，无切镜", audio: "轻微金属高频点缀", prompt: "人物微抬下巴，右手指尖沿设备下缘移动少许。" },
      { shot: "S03", time: "5-8s", visual: "眼睛、唇色和产品材质同时清晰，光带收束。", camera: "胸像特写，推镜停止", audio: "品牌尾音收束", prompt: "发梢和耳饰轻摆，人物重新稳定凝视。" },
    ],
  },
  nextActions: ["生成 4 张关键帧变体并选择产品结构最稳定的一张", "使用 Vidu Q4、Seedance 和可灵进行同 prompt 对比", "按手部稳定、产品结构、商业质感记录 MOS", "优胜结果存入时尚产品 Benchmark"],
  tags: ["时尚", "产品展示", "人物", "棚拍", "移动光带", "缓慢推镜"],
};

const INSPIRATIONS = [
  { id: "red-device", title: "酒红光带", desc: "人物与产品形成单色呼应，适合材质广告和克制微动。", src: "/assets/red-device.webp", category: "fashion", type: "IMAGE", tags: ["时尚", "产品", "棚拍"] },
  { id: "street", title: "城市步态", desc: "自然街头动作与服装廓形，适合跟随运镜和节奏剪辑。", src: "/assets/fashion-street.jpg", category: "fashion", type: "IMAGE", tags: ["街头", "人物", "动态"] },
  { id: "soft", title: "柔光肖像", desc: "简洁背景与自然肤色，可用于情绪递进和人物一致性评测。", src: "/assets/portrait-soft.jpg", category: "portrait", type: "IMAGE", tags: ["肖像", "柔光", "情绪"] },
  { id: "space", title: "模块化空间", desc: "层次明确的室内空间，适合镜头漫游、空间转场和场景编辑。", src: "/assets/studio-space.jpg", category: "space", type: "IMAGE", tags: ["空间", "建筑", "运镜"] },
  { id: "art", title: "色彩手作", desc: "高饱和纹理与创作动作，可拓展为过程记录和视觉实验。", src: "/assets/art-texture.jpg", category: "art", type: "IMAGE", tags: ["艺术", "色彩", "过程"] },
  { id: "editorial", title: "冷调编辑感", desc: "具有服装画报气质的人物素材，适合姿态变化和镜面场景。", src: "/assets/fashion-editorial.jpg", category: "fashion", type: "IMAGE", tags: ["画报", "服装", "姿态"] },
];

const COMPARISONS = [
  { model: "Vidu Q4", src: "/assets/red-device.webp", score: 5, note: "人物与产品结构稳定，光带连续，商业质感最好。" },
  { model: "Seedance 2.0", src: "/assets/fashion-editorial.jpg", score: 4, note: "动作自然，镜头语言丰富，但产品细节略有漂移。" },
  { model: "MiniMax H3", src: "/assets/portrait-soft.jpg", score: 3, note: "面部表现稳定，光影偏平，手部细节需要加强。" },
  { model: "可灵 Omni 3", src: "/assets/fashion-street.jpg", score: 4, note: "动态表现强，风格偏离参考图，适合更大胆的版本。" },
];

const DEFAULT_ASSETS = [
  { id: "a1", name: "酒红光带 Case 生产包", type: "Case", src: "/assets/red-device.webp", tags: "时尚 · 产品 · 9:16", owner: "我", updated: "刚刚", status: "可复用" },
  { id: "a2", name: "人物一致性 Benchmark", type: "Benchmark", src: "/assets/portrait-soft.jpg", tags: "人物 · 一致性 · 评测", owner: "评测组", updated: "2 小时前", status: "已评测" },
  { id: "a3", name: "城市跟拍关键帧", type: "关键帧", src: "/assets/fashion-street.jpg", tags: "街头 · 跟拍 · 动态", owner: "内容组", updated: "昨天", status: "可复用" },
  { id: "a4", name: "模块化空间运镜 Prompt", type: "Prompt", src: "/assets/studio-space.jpg", tags: "空间 · 漫游 · 16:9", owner: "PE", updated: "3 天前", status: "已标注" },
  { id: "a5", name: "冷调画报角色参考", type: "参考图", src: "/assets/fashion-editorial.jpg", tags: "角色 · 服装 · 姿态", owner: "设计组", updated: "5 天前", status: "可复用" },
];

const MAX_DECOMPOSE_FRAMES = 8;
const MAX_DECOMPOSE_BYTES = 12 * 1024 * 1024;

const state = {
  view: "agent",
  mode: "case",
  styleId: "auto",
  activeAgents: new Set(Object.keys(AGENT_META)),
  source: null,
  sourceReferences: [],
  decomposeFrames: [],
  selectedDecomposeFrameId: null,
  result: structuredClone(SAMPLE_RESULT),
  productionTab: "overview",
  messages: [
    { role: "assistant", title: "SIRIHOTDRAMA 总控", text: "我会协调四个专业 Agent，把输入素材整理为完整的 Case 生产包。你可以上传图片、粘贴图片链接，或直接描述创意。" },
    { role: "user", title: "你", text: "基于这张人物产品图，做一条 8 秒的高端时尚短片。动作克制，但要有明确的视觉记忆点。", source: { src: "/assets/red-device.webp", name: "red-device.webp", meta: "人物 / 产品 / 时尚" } },
    { role: "assistant", title: "四 Agent 已完成", text: SAMPLE_RESULT.creativeStrategy, reports: SAMPLE_RESULT.agents },
  ],
  toastTimer: null,
  loadingTimer: null,
  selectedGenerationImage: null,
  generatedKeyframes: [],
  creationMode: "image",
  ideaTask: null,
  videoTasks: [],
  videoArchive: loadLocal("atelier-video-archive", []),
  videoArchiveFilter: "all",
  filmSource: null,
  filmPreviewUrl: null,
  filmAnalysis: null,
  savedCases: loadLocal("atelier-saved-cases", []),
  customAssets: loadLocal("atelier-custom-assets", []),
  activeAgentJobId: sessionStorage.getItem("atelier-agent-job-id") || "",
  activeAgentRequestId: sessionStorage.getItem("atelier-agent-request-id") || "",
  galleryImages: [], galleryProduction: [], galleryFilter: "all", galleryPage: 1,
  galleryFavorites: loadLocal("sirihotdrama-image-favorites", []),
  linkTarget: "agent", creativeBusy: false, draftReady: false,
};

const ids = [
  "sidebar", "mobileMenuButton", "viewTitle", "globalSearch", "statusDot", "modelStatus", "gatewayStatus",
  "agentTrack", "newCaseButton", "saveCaseButton", "currentCaseTitle", "clearConversationButton", "exportCaseButton",
  "messageList", "sourceAttachment", "sourceThumb", "sourceName", "sourceMeta", "removeSourceButton", "briefInput", "creativeStylePicker", "creativeStylePreview",
  "briefCount", "uploadButton", "linkButton", "starterButton", "fileInput", "runAgentButton", "productionContent",
  "compareModelsButton", "startProductionButton", "shuffleButton", "inspirationFilters", "inspirationGrid",
  "sendDecomposeToAgent", "decomposePreview", "decomposeReferenceLabel", "decomposeSourceName", "decomposeSourceMeta",
  "decomposeFrameStrip", "decomposeFrameInput", "decomposeFrameCount", "decomposeFrameStatus",
  "toolMatrix", "generatorPrompt", "generatorResults",
  "ideaPipeline", "ideaStarter", "ideaInput", "ideaAspectRatio", "ideaResolution", "ideaQuality",
  "generateIdeaKeyframeButton", "ideaTaskStatus", "keyframeSummary",
  "viduApiBadge", "generatorSourcePreview", "generatorSourceName", "generatorSourceMeta", "uploadGenerationImageButton",
  "generationImageInput", "useQ4", "useQ31", "videoDuration", "videoResolution", "videoAudio", "videoWatermark",
  "generateVideoButton", "videoTaskSummary", "videoTaskGrid", "filmUploadZone", "filmFileInput", "filmUrlInput",
  "loadFilmUrlButton", "filmPreviewWrap", "filmPreview", "filmSourceName", "filmSourceMeta", "filmFocus",
  "analyzeFilmButton", "analysisProgress", "analysisProgressLabel", "filmAnalysisResult",
  "videoNavCount", "videoArchiveCount", "videoArchiveCredits", "videoArchiveRated", "videoArchiveLatest",
  "videoArchiveFilters", "videoArchiveSearch", "videoArchiveGrid", "openGeneratorFromArchive", "videoDetailDialog", "videoDetailContent",
  "comparePromptTitle", "comparisonGrid", "syncPlaybackButton", "saveBenchmarkButton", "assetCount", "caseCount",
  "librarySearch", "assetTable", "createCollectionButton", "linkDialog", "linkForm", "linkInput", "loadLinkButton",
  "helpButton", "helpDialog", "toast", "notificationsButton",
  "galleryUploadButton", "galleryFileInput", "galleryStatus", "gallerySearch", "gallerySort",
  "generationLinkButton", "saveGenerationImageButton", "reverseImagePromptButton", "reversePromptStatus",
  "imageDirection", "generationStyle", "generateTitle", "copyGeneratorPrompt",
  "resumeIdeaTaskButton",
];
const elements = Object.fromEntries(ids.map((id) => [id, document.getElementById(id)]));

function loadLocal(key, fallback) {
  try {
    const value = JSON.parse(localStorage.getItem(key) || "null");
    return value ?? fallback;
  } catch {
    return fallback;
  }
}

function saveLocal(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

function escapeHtml(value = "") {
  return String(value).replace(/[&<>'"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" }[char]));
}

function apiErrorMessage(data, fallback) {
  const details = [data?.errorCode, data?.traceId ? `追踪号 ${data.traceId}` : ""].filter(Boolean).join(" · ");
  return `${data?.error || fallback}${details ? `（${details}）` : ""}`;
}

function refreshIcons() {
  if (window.lucide) window.lucide.createIcons({ attrs: { "stroke-width": 1.8 } });
}

function showToast(message) {
  clearTimeout(state.toastTimer);
  elements.toast.textContent = message;
  elements.toast.classList.remove("hidden");
  state.toastTimer = setTimeout(() => elements.toast.classList.add("hidden"), 2800);
}

function renderModelStatus() {
  const data = state.gatewayHealth;
  if (!data) return;
  const route = state.view === "generate" && data.creativePrompt ? data.creativePrompt : data;
  const reachable = Object.hasOwn(route, "gatewayReachable") ? route.gatewayReachable : data.gatewayReachable;
  const authenticated = Object.hasOwn(route, "gatewayAuthenticated") ? route.gatewayAuthenticated : data.gatewayAuthenticated;
  elements.modelStatus.textContent = reachable === null
    ? `${route.activeModel} · 待验证`
    : !reachable
    ? "网关暂不可达"
    : authenticated === false
      ? "网关鉴权失败"
      : route.fallbackActive ? `${route.activeModel} · 备用` : route.activeModel;
  elements.statusDot.className = reachable && authenticated !== false ? "ready" : reachable ? "error" : "warning";
  elements.gatewayStatus.textContent = reachable === null
    ? `${route.gateway} · 备用已配置`
    : !reachable
      ? `${route.gateway || data.gateway} · 不可达`
      : authenticated === false
        ? `${route.gateway || data.gateway} · 鉴权失败`
        : `${route.gateway || data.gateway} · 已连接`;
}

async function checkHealth() {
  try {
    const response = await fetch("/api/health");
    const data = await response.json();
    if (!response.ok || (!data.configured && !data.creativePrompt?.configured)) throw new Error("API Key 未配置");
    state.gatewayHealth = data;
    if (data.creativePrompt?.activeModel) elements.generatorPrompt.previousElementSibling.textContent = `视频动作提示词 · ${data.creativePrompt.activeModel}`;
    renderModelStatus();
    if (elements.viduApiBadge) {
      elements.viduApiBadge.classList.toggle("offline", !data.viduConfigured);
      elements.viduApiBadge.lastChild.textContent = data.viduConfigured ? " VIDU API" : " VIDU KEY 缺失";
    }
  } catch (error) {
    state.gatewayHealth = null;
    elements.statusDot.className = "error";
    elements.modelStatus.textContent = "Agent 离线";
    elements.gatewayStatus.textContent = error.message || "网关不可用";
  }
}

function setCreationMode(mode, updateRoute = true) {
  state.creationMode = mode === "idea" ? "idea" : "image";
  document.querySelectorAll("[data-creation-mode]").forEach((button) => button.classList.toggle("active", button.dataset.creationMode === state.creationMode));
  elements.ideaStarter.classList.toggle("hidden", state.creationMode !== "idea");
  elements.generateTitle.textContent = state.creationMode === "idea" ? "灵感成片" : "图片反推提示词";
  elements.ideaPipeline.classList.toggle("hidden", state.creationMode !== "idea");
  if (updateRoute && state.view === "generate") syncCreativeRoute();
  if (state.creationMode === "idea") elements.ideaInput.focus();
}

function setPipelineStep(step) {
  const order = ["idea", "image", "prompt", "video", "score"];
  const current = Math.max(0, order.indexOf(step));
  elements.ideaPipeline.querySelectorAll("[data-pipeline-step]").forEach((item) => {
    const index = order.indexOf(item.dataset.pipelineStep);
    item.classList.toggle("done", index < current);
    item.classList.toggle("active", index === current);
  });
}

function setIdeaStatus(stateName, title, detail) {
  elements.ideaTaskStatus.className = `idea-task-status ${stateName || ""}`.trim();
  elements.ideaTaskStatus.innerHTML = `<i data-lucide="${stateName === "failed" ? "circle-x" : stateName === "success" ? "circle-check" : stateName === "working" ? "loader-circle" : "circle-dashed"}"></i><div><strong>${escapeHtml(title)}</strong><span>${escapeHtml(detail)}</span></div>`;
  refreshIcons();
}

function switchView(view, updateRoute = true) {
  state.view = view;
  renderModelStatus();
  document.querySelectorAll("[data-view-panel]").forEach((panel) => panel.classList.toggle("active", panel.dataset.viewPanel === view));
  document.querySelectorAll(".nav-button[data-view]").forEach((button) => button.classList.toggle("active", button.dataset.view === view));
  const titles = { agent: "Agent Studio", inspiration: "灵感库", decompose: "创意拆解", film: "广告拉片", generate: "灵感生产", videos: "成片库", compare: "多模型对比", library: "Case 与 Benchmark" };
  elements.viewTitle.textContent = titles[view] || "SIRIHOTDRAMA";
  elements.sidebar.classList.remove("open");
  if (view === "videos") renderVideoLibrary();
  if (view === "library") renderLibrary();
  if (view === "compare") renderComparisons();
  if (updateRoute) syncCreativeRoute();
}

function syncCreativeRoute() {
  const route = state.view === "generate" ? state.creationMode === "idea" ? "idea" : "reverse" : state.view === "inspiration" ? "gallery" : state.view;
  if (location.hash !== `#${route}`) history.pushState(null, "", `#${route}`);
  document.querySelectorAll("[data-route]").forEach(a => a.classList.toggle("active", a.dataset.route === route));
  const title = { reverse: "图片反推提示词", idea: "灵感成片", gallery: "精选图片库" }[route];
  if (title) elements.viewTitle.textContent = title;
  document.title = `SIRIHOTDRAMA · ${elements.viewTitle.textContent}`;
}
function applyCreativeRoute() {
  const route = location.hash.slice(1) || "reverse";
  if (["reverse", "idea", "generate"].includes(route)) { switchView("generate", false); setCreationMode(route === "idea" ? "idea" : "image", false); }
  else switchView(route === "gallery" ? "inspiration" : ["agent", "inspiration", "decompose", "film", "videos", "compare", "library"].includes(route) ? route : "generate", false);
  syncCreativeRoute();
}

let draftTimer, draftChain = Promise.resolve();
function saveCreativeDraft() {
  if (!state.draftReady) return Promise.resolve();
  clearTimeout(draftTimer);
  const draft = { image: state.selectedGenerationImage, generatedKeyframes: state.generatedKeyframes,
    prompt: elements.generatorPrompt.value, idea: elements.ideaInput.value, direction: elements.imageDirection.value,
    style: elements.generationStyle.value, creationMode: state.creationMode, videoTasks: structuredClone(state.videoTasks), ideaTask: state.ideaTask,
    controls: Object.fromEntries(["videoDuration", "videoResolution", "ideaAspectRatio", "ideaResolution", "ideaQuality"].map(k => [k, elements[k].value])) };
  draftChain = draftChain.catch(() => {}).then(() => window.CreativeAssets.saveDraft(draft));
  return draftChain;
}
function scheduleCreativeDraft() {
  clearTimeout(draftTimer);
  draftTimer = setTimeout(() => saveCreativeDraft().catch(e => showToast(e.message)), 150);
}
function showGenerationSource() {
  const source = state.selectedGenerationImage;
  elements.generatorSourcePreview.hidden = !source;
  if (source) elements.generatorSourcePreview.src = source.dataUrl;
  elements.generatorSourceName.textContent = source?.name || "尚未选择图片";
  elements.generatorSourceMeta.textContent = source?.meta || "";
}

function renderMessages() {
  elements.messageList.innerHTML = state.messages.map((message) => {
    if (message.thinking) {
      return `<article class="message thinking-message" data-thinking="true"><div class="message-avatar">AI</div><div class="message-bubble"><header><strong>Agent 正在协作</strong><span>LIVE</span></header><p>${escapeHtml(message.text)}</p><div class="thinking-line"></div></div></article>`;
    }
    const source = message.source
      ? `<div class="message-source"><img src="${escapeHtml(message.source.src)}" alt="消息参考素材" /><div><strong>${escapeHtml(message.source.name)}</strong><small>${escapeHtml(message.source.meta)}</small></div></div>`
      : "";
    const reports = message.reports?.map((report) => `<div class="agent-report"><b>${escapeHtml(AGENT_META[report.id]?.name || report.id)} · ${escapeHtml(report.headline)}</b><span>${escapeHtml(report.output)}</span></div>`).join("") || "";
    return `<article class="message ${message.role === "user" ? "user" : ""}">
      <div class="message-avatar">${message.role === "user" ? "YOU" : "AI"}</div>
      <div class="message-bubble"><header><strong>${escapeHtml(message.title)}</strong><span>${escapeHtml(message.time || "NOW")}</span></header><p>${escapeHtml(message.text)}</p>${source}${reports}</div>
    </article>`;
  }).join("");
  elements.messageList.scrollTop = elements.messageList.scrollHeight;
}

function renderProduction() {
  const result = state.result;
  if (!result) {
    elements.productionContent.innerHTML = `<div class="empty-production"><p>运行 Agent 后，这里会同步生成 Case 总览、分镜、提示词和评测标准。</p></div>`;
    return;
  }
  document.querySelectorAll("[data-production-tab]").forEach((button) => button.classList.toggle("active", button.dataset.productionTab === state.productionTab));
  if (state.productionTab === "overview") {
    elements.productionContent.innerHTML = `<div class="case-cover"><img src="${escapeHtml(state.source?.preview || "/assets/red-device.webp")}" alt="Case 封面" /><div class="case-cover-copy"><span>CASE / ${escapeHtml(result.production.format)}</span><strong>${escapeHtml(result.caseTitle)}</strong></div></div>
      <div class="case-metrics"><div><span>画幅</span><strong>${escapeHtml(result.production.aspectRatio)}</strong></div><div><span>时长</span><strong>${escapeHtml(result.production.duration)}</strong></div><div><span>镜头</span><strong>${result.production.storyboard.length} SHOTS</strong></div><div><span>状态</span><strong>PLAN READY</strong></div></div>
      <section class="production-section"><header><strong>创意策略</strong><span>STRATEGY</span></header><p>${escapeHtml(result.creativeStrategy)}</p></section>
      <section class="production-section"><header><strong>素材判断</strong><span>SOURCE READ</span></header><p>${escapeHtml(result.sourceAnalysis.subject)} ${escapeHtml(result.sourceAnalysis.composition)}</p></section>
      <section class="production-section"><header><strong>标签</strong><span>${result.tags.length}</span></header><div class="tag-list">${result.tags.map((tag) => `<span>${escapeHtml(tag)}</span>`).join("")}</div></section>
      <section class="production-section"><header><strong>下一步</strong><span>ACTIONS</span></header><ol class="next-list">${result.nextActions.map((action, index) => `<li><b>${String(index + 1).padStart(2, "0")}</b><span>${escapeHtml(action)}</span></li>`).join("")}</ol></section>`;
  } else if (state.productionTab === "storyboard") {
    elements.productionContent.innerHTML = `<div class="storyboard-list">${result.production.storyboard.map((shot) => `<article class="shot-row"><div class="shot-number">${escapeHtml(shot.shot)}<small>${escapeHtml(shot.time)}</small></div><div class="shot-copy"><strong>${escapeHtml(shot.visual)}</strong><p>${escapeHtml(shot.prompt)}</p><div class="shot-meta"><span>镜头：${escapeHtml(shot.camera)}</span><span>声音：${escapeHtml(shot.audio)}</span></div></div></article>`).join("")}</div>`;
  } else if (state.productionTab === "prompts") {
    elements.productionContent.innerHTML = `<div class="prompt-block"><header><strong>关键帧提示词</strong><button type="button" data-copy="${escapeHtml(result.production.imagePrompt)}" title="复制"><i data-lucide="copy"></i></button></header><textarea rows="7">${escapeHtml(result.production.imagePrompt)}</textarea></div>
      <div class="prompt-block"><header><strong>视频提示词</strong><button type="button" data-copy="${escapeHtml(result.production.videoPrompt)}" title="复制"><i data-lucide="copy"></i></button></header><textarea rows="10">${escapeHtml(result.production.videoPrompt)}</textarea></div>
      <div class="prompt-block"><header><strong>负面提示词</strong><button type="button" data-copy="${escapeHtml(result.production.negativePrompt)}" title="复制"><i data-lucide="copy"></i></button></header><textarea rows="5">${escapeHtml(result.production.negativePrompt)}</textarea></div>`;
  } else {
    elements.productionContent.innerHTML = `<article class="evaluation-card"><strong>评测目标</strong><p>验证同一参考图与 prompt 在多模型中的主体一致性、产品结构、动作自然度和商业质感。</p></article>
      <article class="evaluation-card"><strong>机会点</strong><ul class="risk-list">${result.sourceAnalysis.opportunities.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul></article>
      <article class="evaluation-card"><strong>风险项</strong><ul class="risk-list">${result.sourceAnalysis.risks.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul></article>
      <article class="evaluation-card"><strong>建议模型矩阵</strong><div class="tag-list" style="margin-top:8px"><span>Vidu Q4</span><span>Seedance 2.0</span><span>MiniMax H3</span><span>可灵 Omni 3</span></div></article>`;
  }
  refreshIcons();
}

function setAgentWorking(working) {
  document.querySelectorAll(".agent-lane").forEach((lane) => {
    if (!lane.classList.contains("active")) return;
    lane.classList.toggle("working", working);
    lane.querySelector(".lane-status").textContent = working ? "WORKING" : "READY";
  });
}

function setAgentUiWorking(working) {
  setAgentWorking(working);
  elements.runAgentButton.disabled = working;
  elements.runAgentButton.querySelector("span").textContent = working ? "Agent 协作中" : "运行 Agent";
}

function updateAgentThinking(text) {
  const thinking = state.messages.findLast((message) => message.thinking);
  if (thinking) thinking.text = text;
  else state.messages.push({ role: "assistant", thinking: true, text });
  renderMessages();
}

function setCreativeStyle(styleId) {
  state.styleId = CREATIVE_STYLE_PRESETS[styleId] ? styleId : "auto";
  elements.creativeStylePicker.querySelectorAll("[data-style-id]").forEach((button) => {
    const active = button.dataset.styleId === state.styleId;
    button.classList.toggle("active", active);
    button.setAttribute("aria-selected", String(active));
  });
  const style = CREATIVE_STYLE_PRESETS[state.styleId];
  elements.creativeStylePreview.innerHTML = `<i data-lucide="sparkles"></i><span><b>${escapeHtml(style.label)}</b> · ${escapeHtml(style.prompt)}</span>`;
  refreshIcons();
}

function completeAgentRun(data) {
  state.result = data.result;
  elements.currentCaseTitle.textContent = data.result.caseTitle;
  elements.generatorPrompt.value = data.result.production.videoPrompt;
  if (state.source?.dataUrl) {
    state.selectedGenerationImage = { ...state.source, src: state.source.preview };
    elements.generatorSourcePreview.src = state.source.preview;
    elements.generatorSourceName.textContent = state.source.name;
    elements.generatorSourceMeta.textContent = state.source.meta;
    renderGeneratorResults();
  }
  state.messages = state.messages.filter((message) => !message.thinking);
  state.messages.push({
    role: "assistant",
    title: `${data.result.agents.length} 个 Agent 已完成 · ${data.model}${data.fallbackUsed ? "（自动降级）" : ""}${data.input?.styleId && data.input.styleId !== "auto" ? ` · ${CREATIVE_STYLE_PRESETS[data.input.styleId]?.label || data.input.styleId}` : ""}`,
    text: data.result.creativeStrategy,
    reports: data.result.agents,
  });
  renderMessages();
  renderProduction();
  showToast("Case 生产包已生成并同步");
}

function clearActiveAgentJob() {
  state.activeAgentJobId = "";
  state.activeAgentRequestId = "";
  sessionStorage.removeItem("atelier-agent-job-id");
  sessionStorage.removeItem("atelier-agent-request-id");
}

async function readAgentJob(jobId) {
  const response = await fetch(`/api/agent/jobs/${encodeURIComponent(jobId)}`, {
    signal: AbortSignal.timeout(12000),
    cache: "no-store",
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(apiErrorMessage(data, `Agent 状态查询失败（HTTP ${response.status}）`));
    error.statusCode = response.status;
    throw error;
  }
  return data;
}

async function monitorAgentJob(jobId, initialStatus = null) {
  const waitStartedAt = Date.now();
  let networkFailures = 0;
  let status = initialStatus;
  while (Date.now() - waitStartedAt < 7 * 60 * 1000) {
    try {
      status = status || await readAgentJob(jobId);
      networkFailures = 0;
      if (status.status === "succeeded") return status;
      if (status.status === "failed") throw new Error(apiErrorMessage(status, "Agent 运行失败。"));
      const startedAt = Date.parse(status.startedAt || status.createdAt) || waitStartedAt;
      const elapsed = Math.max(0, Math.round((Date.now() - startedAt) / 1000));
      updateAgentThinking(`任务已受理，四个 Agent 正在协作 · 已运行 ${elapsed} 秒。页面只查询状态，不会重复提交计费任务。`);
      await new Promise((resolve) => setTimeout(resolve, 2000));
      status = null;
    } catch (error) {
      if (!(error instanceof TypeError) && error.name !== "TimeoutError") throw error;
      networkFailures += 1;
      updateAgentThinking(`任务仍在后台运行，本地连接暂时不稳定，正在第 ${networkFailures} 次恢复查询。`);
      await new Promise((resolve) => setTimeout(resolve, Math.min(10000, 1500 * networkFailures)));
      status = null;
    }
  }
  const error = new Error("页面等待已超过 7 分钟，后台任务可能仍在运行。点击“运行 Agent”会继续查询当前任务，不会重复提交。");
  error.keepJob = true;
  throw error;
}

async function runAgents() {
  if (state.activeAgentJobId) {
    setAgentUiWorking(true);
    updateAgentThinking("正在恢复上一次 Agent 任务的状态……");
    try {
      completeAgentRun(await monitorAgentJob(state.activeAgentJobId));
      clearActiveAgentJob();
    } catch (error) {
      if (!error.keepJob) clearActiveAgentJob();
      state.messages = state.messages.filter((message) => !message.thinking);
      state.messages.push({ role: "assistant", title: "任务查询中断", text: error.message || "暂时无法查询 Agent 任务。" });
      renderMessages();
      showToast(error.message || "暂时无法查询 Agent 任务");
    } finally {
      setAgentUiWorking(false);
    }
    return;
  }
  const brief = elements.briefInput.value.trim();
  if (!brief && !state.source?.dataUrl) {
    showToast("请先描述创意，或添加一张参考图片");
    elements.briefInput.focus();
    return;
  }
  const selectedAgents = [...state.activeAgents];
  if (!selectedAgents.length) {
    showToast("至少启用一个 Agent");
    return;
  }
  const userMessage = {
    role: "user",
    title: "你",
    text: brief || "请仅基于参考图片完成创意拆解和生产规划。",
    source: state.source ? { src: state.source.preview, name: state.source.name, meta: state.source.meta } : null,
  };
  state.messages.push(userMessage, { role: "assistant", thinking: true, text: "正在读取素材并分配策略、提示词、导演和评测任务……" });
  renderMessages();
  setAgentUiWorking(true);
  state.activeAgentRequestId ||= `req_${Date.now()}_${crypto.randomUUID().replaceAll("-", "")}`;
  sessionStorage.setItem("atelier-agent-request-id", state.activeAgentRequestId);
  try {
    const response = await fetch("/api/agent/jobs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: AbortSignal.timeout(20000),
      body: JSON.stringify({
        clientRequestId: state.activeAgentRequestId,
        brief,
        imageDataUrl: state.sourceReferences.length > 1 ? "" : state.source?.dataUrl || "",
        imageDataUrls: state.sourceReferences.length > 1
          ? state.sourceReferences.map((source) => source.dataUrl).filter(Boolean)
          : [],
        imageName: state.source?.name || "",
        mode: state.mode,
        styleId: state.styleId,
        agents: selectedAgents,
        targetModel: "Vidu Q4",
        aspectRatio: document.getElementById("generatorRatio")?.value || "9:16",
        duration: 8,
        audience: "社交媒体内容消费者与潜在产品用户",
      }),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(apiErrorMessage(data, `Agent 任务提交失败（HTTP ${response.status}）`));
    state.activeAgentJobId = data.jobId;
    sessionStorage.setItem("atelier-agent-job-id", data.jobId);
    completeAgentRun(await monitorAgentJob(data.jobId, data));
    clearActiveAgentJob();
  } catch (error) {
    const submissionUnknown = !state.activeAgentJobId && (error instanceof TypeError || error.name === "TimeoutError");
    const message = submissionUnknown
      ? "本地连接中断，无法确认任务是否已受理。素材已保留；再次点击会使用同一请求编号，不会创建重复任务。"
      : error.message || "Agent 暂时不可用，请稍后重试。";
    if (!error.keepJob && !submissionUnknown) clearActiveAgentJob();
    state.messages = state.messages.filter((message) => !message.thinking);
    state.messages.push({ role: "assistant", title: "运行中断", text: message });
    renderMessages();
    showToast(message);
  } finally {
    setAgentUiWorking(false);
  }
}

function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error("图片读取失败。"));
    reader.readAsDataURL(file);
  });
}

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("无法解析这张图片。"));
    image.src = src;
  });
}

async function compressImage(file, options = {}) {
  if (!file.type.startsWith("image/")) throw new Error("请选择图片文件。 ");
  if (file.size > 30 * 1024 * 1024) throw new Error("原图不能超过 30MB。");
  const source = await readFileAsDataUrl(file);
  const image = await loadImage(source);
  const maxDimension = options.maxDimension || 2048;
  const scale = Math.min(1, maxDimension / Math.max(image.naturalWidth, image.naturalHeight));
  const width = Math.max(1, Math.round(image.naturalWidth * scale));
  const height = Math.max(1, Math.round(image.naturalHeight * scale));
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d", { alpha: false });
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, width, height);
  context.drawImage(image, 0, 0, width, height);
  const dataUrl = canvas.toDataURL("image/jpeg", options.quality || 0.88);
  const bytes = Math.floor((dataUrl.length - dataUrl.indexOf(",") - 1) * 0.75);
  return { dataUrl, width, height, bytes };
}

function formatBytes(bytes) {
  return bytes < 1024 * 1024 ? `${Math.round(bytes / 1024)} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

async function setSourceFromFile(file, displayName = "") {
  const compressed = await compressImage(file);
  state.source = {
    dataUrl: compressed.dataUrl,
    preview: compressed.dataUrl,
    name: displayName || file.name || "参考图片",
    meta: `${compressed.width} × ${compressed.height} · ${formatBytes(compressed.bytes)}`,
  };
  state.sourceReferences = [state.source];
  renderSourceAttachment();
}

async function setSourceFromPath(src, name) {
  const response = await fetch(src);
  const blob = await response.blob();
  const file = new File([blob], name, { type: blob.type });
  await setSourceFromFile(file, name);
}

function renderSourceAttachment() {
  if (!state.source) {
    elements.sourceAttachment.classList.add("hidden");
    return;
  }
  elements.sourceThumb.src = state.source.preview;
  elements.sourceName.textContent = state.source.name;
  elements.sourceMeta.textContent = state.source.meta;
  elements.sourceAttachment.classList.remove("hidden");
}

function removeSource() {
  state.source = null;
  state.sourceReferences = [];
  elements.fileInput.value = "";
  renderSourceAttachment();
}

function selectedDecomposeFrame() {
  return state.decomposeFrames.find((frame) => frame.id === state.selectedDecomposeFrameId) || state.decomposeFrames[0] || null;
}

function renderDecomposeFrames() {
  const selected = selectedDecomposeFrame();
  const atLimit = state.decomposeFrames.length >= MAX_DECOMPOSE_FRAMES;
  if (selected && selected.id !== state.selectedDecomposeFrameId) state.selectedDecomposeFrameId = selected.id;
  elements.decomposePreview.classList.toggle("hidden", !selected);
  if (selected) elements.decomposePreview.src = selected.preview;
  elements.decomposeReferenceLabel.textContent = selected
    ? `REFERENCE ${String(state.decomposeFrames.indexOf(selected) + 1).padStart(2, "0")}`
    : "NO REFERENCE";
  elements.decomposeSourceName.textContent = selected?.name || "等待添加素材";
  elements.decomposeSourceMeta.textContent = selected
    ? `${selected.width} × ${selected.height} · ${state.decomposeFrames.length} 张参考`
    : "点击 + 上传图片";
  elements.decomposeFrameCount.textContent = `${state.decomposeFrames.length} 帧`;
  elements.decomposeFrameStatus.textContent = state.decomposeFrames.length
    ? `已选择 ${state.decomposeFrames.length} 张参考。点击缩略图切换主图，点击右上角可移除，点击 + 继续补充。`
    : "尚未添加关键帧。点击 + 上传一张或多张图片。";
  elements.decomposeFrameInput.disabled = atLimit;
  elements.decomposeFrameStrip.innerHTML = `${state.decomposeFrames.map((frame, index) => `<div class="frame-item ${frame.id === state.selectedDecomposeFrameId ? "selected" : ""}" data-decompose-frame="${escapeHtml(frame.id)}">
    <button class="frame-select" type="button" title="设为主参考"><img src="${frame.preview}" alt="关键帧 ${index + 1}" /><span>REF ${String(index + 1).padStart(2, "0")}</span></button>
    <button class="frame-remove" type="button" title="移除这张素材" aria-label="移除 ${escapeHtml(frame.name)}"><i data-lucide="x"></i></button>
  </div>`).join("")}<label class="add-frame ${atLimit ? "disabled" : ""}" for="decomposeFrameInput" title="继续添加关键帧" aria-label="继续添加关键帧"><i data-lucide="plus"></i><span>${atLimit ? "已满" : "添加"}</span></label>`;
  refreshIcons();
}

async function createDecomposeFrame(file, displayName = "") {
  const compressed = await compressImage(file, { maxDimension: 1600, quality: 0.82 });
  return {
    id: `frame-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    dataUrl: compressed.dataUrl,
    preview: compressed.dataUrl,
    name: displayName || file.name || "参考图片",
    meta: `${compressed.width} × ${compressed.height} · ${formatBytes(compressed.bytes)}`,
    width: compressed.width,
    height: compressed.height,
    bytes: compressed.bytes,
  };
}

async function addDecomposeFiles(fileList) {
  const files = [...(fileList || [])].filter((file) => file.type.startsWith("image/"));
  if (!files.length) throw new Error("请选择 PNG、JPG、WebP 或 GIF 图片。");
  const slots = MAX_DECOMPOSE_FRAMES - state.decomposeFrames.length;
  if (slots <= 0) throw new Error(`最多可添加 ${MAX_DECOMPOSE_FRAMES} 张参考图。`);
  const accepted = files.slice(0, slots);
  const additions = [];
  let totalBytes = state.decomposeFrames.reduce((sum, frame) => sum + frame.bytes, 0);
  for (const file of accepted) {
    const frame = await createDecomposeFrame(file);
    if (totalBytes + frame.bytes > MAX_DECOMPOSE_BYTES) {
      if (!additions.length) throw new Error("素材组处理后不能超过 12MB，请移除部分图片后再试。");
      break;
    }
    totalBytes += frame.bytes;
    additions.push(frame);
  }
  state.decomposeFrames.push(...additions);
  if (!state.selectedDecomposeFrameId && additions[0]) state.selectedDecomposeFrameId = additions[0].id;
  elements.decomposeFrameInput.value = "";
  renderDecomposeFrames();
  if (!additions.length) throw new Error("素材组已达到 12MB 上限。");
  return { added: additions.length, skipped: files.length - additions.length };
}

async function addDecomposeFrameFromPath(src, name) {
  const response = await fetch(src);
  if (!response.ok) throw new Error(`示例素材读取失败（HTTP ${response.status}）`);
  const blob = await response.blob();
  const frame = await createDecomposeFrame(new File([blob], name, { type: blob.type }), name);
  state.decomposeFrames.push(frame);
  if (!state.selectedDecomposeFrameId) state.selectedDecomposeFrameId = frame.id;
  return frame;
}

function removeDecomposeFrame(id) {
  const index = state.decomposeFrames.findIndex((frame) => frame.id === id);
  if (index < 0) return;
  state.decomposeFrames.splice(index, 1);
  if (state.selectedDecomposeFrameId === id) {
    state.selectedDecomposeFrameId = state.decomposeFrames[Math.min(index, state.decomposeFrames.length - 1)]?.id || null;
  }
  renderDecomposeFrames();
}

function transferDecomposeFramesToAgent() {
  const selected = selectedDecomposeFrame();
  if (!selected) throw new Error("请先点击 + 添加至少一张关键帧。");
  state.source = {
    dataUrl: selected.dataUrl,
    preview: selected.preview,
    name: selected.name,
    meta: `${selected.meta} · 主参考 / 共 ${state.decomposeFrames.length} 张`,
  };
  state.sourceReferences = [selected, ...state.decomposeFrames.filter((frame) => frame.id !== selected.id)];
  renderSourceAttachment();
}

async function loadRemoteImage(url, target = "agent") {
  const response = await fetch("/api/image-from-url", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ url }),
  });
  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw new Error(data.error || `图片载入失败（HTTP ${response.status}）`);
  }
  const blob = await response.blob();
  const finalUrl = decodeURIComponent(response.headers.get("X-Image-Source") || url);
  const hostname = new URL(finalUrl).hostname;
  const file = new File([blob], "remote-image", { type: blob.type });
  if (target === "generation") await setGenerationImageFromFile(file, `链接图片 · ${hostname}`);
  else await setSourceFromFile(file, `链接图片 · ${hostname}`);
}

function galleryItems() {
  return [...state.galleryImages, ...INSPIRATIONS.map(i => ({ ...i, origin: "selected", originLabel: "精选参考" })), ...state.galleryProduction];
}
const galleryObjectUrls = new Map();
async function loadGallery() {
  const warnings = [];
  try {
    const images = await window.CreativeAssets.list();
    for (const url of galleryObjectUrls.values()) URL.revokeObjectURL(url);
    galleryObjectUrls.clear();
    state.galleryImages = images.sort((a, b) => b.createdAt.localeCompare(a.createdAt)).map(i => {
      const src = URL.createObjectURL(i.blob); galleryObjectUrls.set(i.id, src);
      return { ...i, blob: undefined, src, origin: "mine", originLabel: i.generated ? "创作生成" : "我的上传", tags: i.tags || [] };
    });
  } catch (error) { warnings.push(error.message); }
  try {
    const response = await fetch("/api/drama/library", { signal: AbortSignal.timeout(15000) });
    if (!response.ok) throw new Error("制作素材暂不可读取，已保留精选参考和本机图片。");
    const library = await response.json();
    state.galleryProduction = library.items.filter(i => !["video", "delivery"].includes(i.kind)).map(i => ({
      id: `production:${i.id}`, title: i.title, desc: i.description || "", category: i.kind === "character" ? "portrait" : i.kind === "environment" ? "space" : "art",
      src: `/api/drama/library/files/${i.sourceId}/${i.projectId}/${i.file.split("/").map(encodeURIComponent).join("/")}`,
      origin: "production", originLabel: "制作素材", tags: [i.projectTitle], projectUrl: i.projectUrl,
    }));
  } catch (error) { warnings.push(error.message); }
  elements.galleryStatus.textContent = warnings.join(" ") || `${galleryItems().length} 张图片 · ${state.galleryFavorites.length} 项收藏 · 上传与收藏保存在当前浏览器，制作素材来自本机工作区`;
  renderInspirations();
}
async function saveGalleryImage(image, { generated = false, description = "", refresh = true } = {}) {
  if (!image?.dataUrl) throw new Error("请先选择图片。");
  const blob = await (await fetch(image.dataUrl)).blob();
  const digest = [...new Uint8Array(await crypto.subtle.digest("SHA-256", await blob.arrayBuffer()))].map(x => x.toString(16).padStart(2, "0")).join("");
  const id = `image-${digest}`, existing = await window.CreativeAssets.get(id);
  if (!existing) await window.CreativeAssets.put({ id, title: image.name || "创作图片", blob, desc: description, category: "art", generated, createdAt: new Date().toISOString(), tags: [generated ? "AI 生成" : "上传图片"] });
  if (refresh) await loadGallery();
  return id;
}
function renderInspirations(filter = state.galleryFilter) {
  state.galleryFilter = filter;
  const query = elements.gallerySearch.value.trim().toLowerCase();
  let items = galleryItems().filter(i => (filter === "all" || (filter === "favorites" ? state.galleryFavorites.includes(i.id) : i.origin === filter || i.category === filter)) && `${i.title} ${i.desc} ${i.tags.join(" ")}`.toLowerCase().includes(query));
  if (elements.gallerySort.value === "name") items = items.slice().sort((a, b) => a.title.localeCompare(b.title, "zh-CN"));
  const pages = Math.max(1, Math.ceil(items.length / 18)); state.galleryPage = Math.min(pages, state.galleryPage);
  elements.inspirationFilters.querySelectorAll("[data-filter]").forEach(b => b.classList.toggle("active", b.dataset.filter === filter));
  elements.inspirationGrid.innerHTML = items.slice((state.galleryPage - 1) * 18, state.galleryPage * 18).map(item => {
    const saved = state.galleryFavorites.includes(item.id);
    return `<article class="inspiration-card" data-inspiration="${escapeHtml(item.id)}">
      <div class="inspiration-media"><img src="${escapeHtml(item.src)}" alt="${escapeHtml(item.title)}" loading="lazy" /><span class="media-type">${escapeHtml(item.originLabel)}</span><button class="save-inspiration ${saved ? "saved" : ""}" type="button" data-inspiration-action="save" title="${saved ? "取消收藏" : "收藏"}" aria-pressed="${saved}"><i data-lucide="bookmark${saved ? "-check" : ""}"></i></button></div>
      <div class="inspiration-body"><strong>${escapeHtml(item.title)}</strong><p>${escapeHtml(item.desc)}</p><div class="inspiration-tags">${item.tags.map(tag => `<span>${escapeHtml(tag)}</span>`).join("")}</div></div>
      <div class="card-actions"><button type="button" data-inspiration-action="reverse"><i data-lucide="scan-search"></i>反推提示词</button><button type="button" data-inspiration-action="animate"><i data-lucide="video"></i>做视频</button><button type="button" data-inspiration-action="use" title="交给创意 Agent"><i data-lucide="sparkles"></i></button>${item.origin === "mine" ? `<button type="button" data-inspiration-action="delete" title="删除本机图片"><i data-lucide="trash-2"></i></button>` : ""}</div>
    </article>`;
  }).join("") || `<p class="gallery-empty">没有符合条件的图片</p>`;
  elements.inspirationGrid.insertAdjacentHTML("beforeend", `<div class="gallery-pages"><button class="icon-button" type="button" data-gallery-page="-1" ${state.galleryPage === 1 ? "disabled" : ""} title="上一页"><i data-lucide="chevron-left"></i></button><span>${items.length} 张 · ${state.galleryPage} / ${pages}</span><button class="icon-button" type="button" data-gallery-page="1" ${state.galleryPage === pages ? "disabled" : ""} title="下一页"><i data-lucide="chevron-right"></i></button></div>`);
  refreshIcons();
}

async function reverseGenerationImage() {
  if (state.creativeBusy) return;
  const image = state.selectedGenerationImage;
  if (!image?.dataUrl) { showToast("请先上传图片、粘贴图片链接或从图片库选择。"); return; }
  state.creativeBusy = true; elements.reverseImagePromptButton.disabled = true;
  elements.reversePromptStatus.textContent = "正在分析图片与创意方向…";
  const previous = elements.generatorPrompt.value;
  try {
    const result = await runIdeaAgent(`根据这张图片反推可用于图生视频的提示词。严格保留主体身份、外观、产品结构、构图与场景。描述可执行的动作、运镜和时间变化。补充创意方向：${elements.imageDirection.value.trim() || "自然、连续且克制的运动"}`, image.dataUrl);
    if (state.selectedGenerationImage !== image || elements.generatorPrompt.value !== previous) throw new Error("图片或提示词已修改，本次结果未覆盖你的新内容，请重新生成。");
    if (!result?.videoPrompt) throw new Error("模型没有返回视频提示词，请重试。");
    elements.generatorPrompt.value = `${result.videoPrompt}${result.negativePrompt ? `\n\n负面约束：${result.negativePrompt}` : ""}`;
    elements.reversePromptStatus.textContent = "提示词已生成，可编辑后提交视频。";
    setPipelineStep("video"); await saveCreativeDraft();
  } catch (error) { elements.reversePromptStatus.textContent = error.message; showToast(error.message); }
  finally { state.creativeBusy = false; elements.reverseImagePromptButton.disabled = false; }
}

function renderGeneratorResults(loading = false) {
  const images = [
    ...state.generatedKeyframes,
    { name: "red-device.webp", label: "产品正面", src: "/assets/red-device.webp" },
    { name: "fashion-editorial.jpg", label: "冷调画报", src: "/assets/fashion-editorial.jpg" },
    { name: "portrait-soft.jpg", label: "柔光肖像", src: "/assets/portrait-soft.jpg" },
    { name: "fashion-street.jpg", label: "城市步态", src: "/assets/fashion-street.jpg" },
  ];
  elements.generatorResults.innerHTML = images.map((item, index) => {
    const src = item.src;
    const selected = state.selectedGenerationImage?.src === src || state.selectedGenerationImage?.originSrc === src;
    return `<article class="generation-card ${loading ? "loading" : ""} ${selected ? "selected" : ""}" data-generation-src="${escapeHtml(src)}" data-generation-name="${escapeHtml(item.name)}"><img src="${escapeHtml(src)}" alt="关键帧候选 ${index + 1}" /><footer><span>${String(index + 1).padStart(2, "0")} · ${escapeHtml(item.label)}</span><button type="button" title="选为视频首帧"><i data-lucide="${selected ? "check-circle-2" : "circle"}"></i></button></footer></article>`;
  }).join("");
  refreshIcons();
}

async function setGenerationImageFromUrl(url, name = "AI 关键帧") {
  const response = await fetch("/api/image-from-url", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ url }),
  });
  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw new Error(data.error || `生成图片读取失败（HTTP ${response.status}）`);
  }
  const blob = await response.blob();
  await setGenerationImageFromFile(new File([blob], `${name}.png`, { type: blob.type }));
  const generated = { name: `${name}.png`, label: "AI 生成", src: state.selectedGenerationImage.src };
  state.generatedKeyframes = [generated, ...state.generatedKeyframes].slice(0, 4);
  renderGeneratorResults();
  elements.keyframeSummary.textContent = "AI 关键帧已选中 · 动态提示词已回填";
}

async function runIdeaAgent(brief, imageDataUrl = "") {
  const response = await fetch("/api/creative/prompt", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      brief: `${brief}\n视觉风格：${CREATIVE_STYLE_PRESETS[elements.generationStyle.value]?.prompt || CREATIVE_STYLE_PRESETS.auto.prompt}`,
      imageDataUrl,
      targetModel: "Vidu Q4",
      aspectRatio: elements.ideaAspectRatio.value,
      duration: Number(elements.videoDuration.value),
      audience: "社交媒体与商业内容受众",
      styleId: elements.generationStyle.value,
    }),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(apiErrorMessage(data, `创意整理失败（HTTP ${response.status}）`));
  if (data.model) elements.generatorPrompt.previousElementSibling.textContent = `视频动作提示词 · ${data.model}`;
  if (data.model && state.gatewayHealth?.creativePrompt) {
    Object.assign(state.gatewayHealth.creativePrompt, {
      activeModel: data.model, fallbackActive: data.fallbackUsed,
      provider: data.provider, gatewayReachable: true, gatewayAuthenticated: true,
      gateway: data.provider === "deepseek" ? "api.deepseek.com" : state.gatewayHealth.gateway,
    });
    renderModelStatus();
  }
  return data.result;
}

async function pollIdeaImageTask(taskId, attempt = 0) {
  if (attempt >= 120) throw new Error("生图任务等待超时，请稍后到任务记录中查看。");
  await new Promise((resolve) => setTimeout(resolve, attempt ? 3000 : 1000));
  const response = await fetch(`/api/image/task/${encodeURIComponent(taskId)}`);
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || `生图任务查询失败（HTTP ${response.status}）`);
  state.ideaTask = { ...state.ideaTask, ...data };
  await saveCreativeDraft();
  if (data.state === "success") {
    const url = data.creations?.[0]?.url;
    if (!url) throw new Error("生图任务已完成，但没有返回图片地址。");
    return data;
  }
  if (data.state === "failed") throw new Error(`关键帧生成失败${data.errorCode ? `：${data.errorCode}` : "。"}`);
  setIdeaStatus("working", data.state === "queueing" ? "关键帧排队中" : "关键帧生成中", `VIDUIMAGE-2 · ${data.state}`);
  return pollIdeaImageTask(taskId, attempt + 1);
}

async function generateIdeaKeyframe() {
  if (state.creativeBusy) return;
  if (state.ideaTask?.workbenchPending) { showToast("上次生图任务尚未完成，请先续接原任务，避免重复计费。"); return; }
  const idea = elements.ideaInput.value.trim();
  if (!idea) { showToast("请先写下一句话想法"); elements.ideaInput.focus(); return; }
  state.creativeBusy = true;
  elements.generateIdeaKeyframeButton.disabled = true;
  try {
    setPipelineStep("idea");
    setIdeaStatus("working", "正在把想法整理成画面", "GPT-5.6 · 主体、环境、构图与光线");
    const concept = await runIdeaAgent(`把下面的想法发展成一张适合作为视频首帧的高质量商业画面，并规划后续动态：${idea}`);
    state.ideaTask = { state: "submitting", workbenchPending: true, idea };
    await saveCreativeDraft();
    setPipelineStep("image");
    setIdeaStatus("working", "正在生成关键帧", `${elements.ideaAspectRatio.value} · ${elements.ideaResolution.value} · ${elements.ideaQuality.value}`);
    const createResponse = await fetch("/api/image/create", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "viduimage-2",
        prompt: concept.imagePrompt,
        aspectRatio: elements.ideaAspectRatio.value,
        resolution: elements.ideaResolution.value,
        quality: elements.ideaQuality.value,
      }),
    });
    const created = await createResponse.json().catch(() => ({}));
    if (!createResponse.ok) {
      if (createResponse.status >= 400 && createResponse.status < 500 && createResponse.status !== 408) state.ideaTask = { ...state.ideaTask, state: "failed", workbenchPending: false };
      throw new Error(created.error || `生图任务创建失败（HTTP ${createResponse.status}）`);
    }
    if (!created.taskId) throw new Error("接口没有返回生图任务 ID，请先到 Vidu 控制台核对。");
    state.ideaTask = { ...created, workbenchPending: true, idea };
    await saveCreativeDraft();
    await finishIdeaKeyframe();
  } catch (error) {
    setIdeaStatus("failed", "想法成片准备失败", error.message);
    showToast(error.message);
  } finally {
    if (state.ideaTask?.state === "failed") state.ideaTask.workbenchPending = false;
    state.creativeBusy = false;
    elements.generateIdeaKeyframeButton.disabled = false;
    await saveCreativeDraft().catch(e => showToast(e.message));
    renderIdeaResume();
  }
}

function renderIdeaResume() {
  const pending = state.ideaTask?.workbenchPending;
  elements.resumeIdeaTaskButton.hidden = !pending;
  elements.resumeIdeaTaskButton.textContent = state.ideaTask?.state === "success" && state.ideaTask?.taskId ? "重试视频动作提示词" : state.ideaTask?.taskId ? "续接上次生图任务" : "核对并补录生图任务 ID";
}
async function finishIdeaKeyframe() {
  const idea = state.ideaTask.idea;
  const completed = await pollIdeaImageTask(state.ideaTask.taskId);
  await setGenerationImageFromUrl(completed.creations[0].url, `灵感关键帧-${state.ideaTask.taskId}`);
  const image = state.selectedGenerationImage;
  await saveGalleryImage(image, { generated: true, description: idea });
  setPipelineStep("prompt");
  setIdeaStatus("working", "正在读图整理动态", "主体、动作与镜头连续性");
  const motion = await runIdeaAgent(`为这张刚生成的关键帧编写视频动态提示词，保持主体、造型、产品结构与构图，只增加动作、运镜及光线变化。原始想法：${idea}`, image.dataUrl);
  if (state.selectedGenerationImage !== image) throw new Error("参考图已更换，未覆盖新图片的提示词。");
  if (!motion?.videoPrompt) throw new Error("模型没有返回动态提示词，图片和原生图任务已保留。");
  elements.generatorPrompt.value = `${motion.videoPrompt}\n\n负面约束：${motion.negativePrompt || ""}`;
  state.ideaTask.workbenchPending = false;
  setIdeaStatus("success", "关键帧与动态提示词已就绪", "图片已存入精选图片库，确认提示词后可生成视频。");
  await saveCreativeDraft();
  showToast("关键帧和动态提示词已就绪");
}
async function resumeIdeaKeyframe() {
  if (state.creativeBusy || !state.ideaTask?.workbenchPending) return;
  if (!state.ideaTask.taskId) {
    const id = prompt("请在 Vidu 控制台核对后输入生图任务 ID；这里只查询原任务，不重新生图。");
    if (!id) return;
    if (!/^[a-zA-Z0-9_-]{1,200}$/.test(id.trim())) { showToast("任务 ID 格式无效"); return; }
    state.ideaTask.taskId = id.trim(); await saveCreativeDraft();
  }
  state.creativeBusy = true; elements.resumeIdeaTaskButton.disabled = true;
  try { await finishIdeaKeyframe(); }
  catch (error) { setIdeaStatus("failed", "续接未完成", error.message); }
  finally {
    if (state.ideaTask?.state === "failed") state.ideaTask.workbenchPending = false;
    state.creativeBusy = false; elements.resumeIdeaTaskButton.disabled = false;
    await saveCreativeDraft().catch(e => showToast(e.message)); renderIdeaResume();
  }
}

async function setGenerationImageFromFile(file, name = "") {
  const compressed = await compressImage(file);
  state.selectedGenerationImage = {
    dataUrl: compressed.dataUrl,
    src: compressed.dataUrl,
    name: name || file.name || "视频首帧",
    meta: `${compressed.width} × ${compressed.height} · ${formatBytes(compressed.bytes)}`,
  };
  elements.generatorSourcePreview.src = compressed.dataUrl;
  elements.generatorSourceName.textContent = state.selectedGenerationImage.name;
  elements.generatorSourceMeta.textContent = state.selectedGenerationImage.meta;
  elements.generatorPrompt.value = ""; elements.reversePromptStatus.textContent = "";
  showGenerationSource();
  renderGeneratorResults();
  await saveCreativeDraft();
}

async function setGenerationImageFromPath(src, name) {
  const response = await fetch(src);
  if (!response.ok) throw new Error("关键帧读取失败。");
  const blob = await response.blob();
  const compressed = await compressImage(new File([blob], name, { type: blob.type }));
  state.selectedGenerationImage = {
    dataUrl: compressed.dataUrl,
    src: compressed.dataUrl, originSrc: src,
    name,
    meta: `${compressed.width} × ${compressed.height} · ${formatBytes(compressed.bytes)}`,
  };
  elements.generatorSourcePreview.src = src;
  elements.generatorSourceName.textContent = name;
  elements.generatorSourceMeta.textContent = state.selectedGenerationImage.meta;
  elements.generatorPrompt.value = ""; elements.reversePromptStatus.textContent = "";
  showGenerationSource();
  renderGeneratorResults();
  await saveCreativeDraft();
}

const VIDEO_STATE_LABELS = {
  submitting: "提交中",
  created: "已创建",
  queueing: "排队中",
  processing: "生成中",
  success: "已完成",
  failed: "生成失败",
  unknown: "提交结果未知", interrupted: "待续接查询",
};

function videoModelShortLabel(model) {
  return model === "viduq4" ? "Q4" : model === "viduq3.1-ad" ? "Q3.1-AD" : model || "VIDEO";
}

function formatArchiveDate(value, includeTime = false) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "时间未知";
  return new Intl.DateTimeFormat("zh-CN", includeTime
    ? { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false }
    : { year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
}

function archiveCompletedVideo(task) {
  const creation = task.creations?.[0];
  if (task.state !== "success" || !creation?.url) return false;
  const archive = Array.isArray(state.videoArchive) ? state.videoArchive : [];
  const id = `video-${task.taskId || task.localId}`;
  const existing = archive.find((item) => item.id === id || (task.taskId && item.taskId === task.taskId));
  const sourceCover = task.sourceCoverUrl && !task.sourceCoverUrl.startsWith("data:") ? task.sourceCoverUrl : "";
  const record = {
    id,
    taskId: task.taskId || "",
    creationId: creation.id || "",
    url: creation.url,
    coverUrl: creation.coverUrl || sourceCover,
    watermarkedUrl: creation.watermarkedUrl || "",
    model: task.model,
    modelLabel: task.modelLabel,
    duration: task.duration,
    resolution: task.resolution,
    credits: task.credits ?? null,
    score: task.score || existing?.score || 0,
    prompt: task.prompt || existing?.prompt || "",
    title: task.caseTitle || existing?.title || "灵感视频",
    sourceName: task.sourceName || existing?.sourceName || "",
    audio: Boolean(task.audio),
    createdAt: task.createdAt || task.submittedAt || existing?.createdAt || new Date().toISOString(),
    archivedAt: existing?.archivedAt || new Date().toISOString(),
  };
  state.videoArchive = [record, ...archive.filter((item) => item.id !== id && (!task.taskId || item.taskId !== task.taskId))];
  const saved = saveLocal("atelier-video-archive", state.videoArchive);
  if (elements.videoArchiveGrid) renderVideoLibrary();
  return saved;
}

function updateArchivedVideoScore(task) {
  if (!task.taskId || !Array.isArray(state.videoArchive)) return;
  const archived = state.videoArchive.find((item) => item.taskId === task.taskId);
  if (!archived) return;
  archived.score = task.score;
  saveLocal("atelier-video-archive", state.videoArchive);
  if (state.view === "videos") renderVideoLibrary();
}

function renderVideoLibrary() {
  const archive = Array.isArray(state.videoArchive) ? state.videoArchive : [];
  const query = elements.videoArchiveSearch?.value.trim().toLowerCase() || "";
  const filtered = archive.filter((item) => {
    const matchesModel = state.videoArchiveFilter === "all" || item.model === state.videoArchiveFilter;
    const haystack = `${item.title || ""} ${item.modelLabel || ""} ${item.prompt || ""} ${item.sourceName || ""}`.toLowerCase();
    return matchesModel && (!query || haystack.includes(query));
  });
  const rated = archive.filter((item) => Number(item.score) > 0);
  const totalCredits = archive.reduce((sum, item) => sum + (Number(item.credits) || 0), 0);
  const latest = archive.reduce((latestDate, item) => {
    const time = new Date(item.createdAt).getTime();
    return Number.isFinite(time) && time > latestDate ? time : latestDate;
  }, 0);

  elements.videoArchiveCount.textContent = String(archive.length);
  elements.videoArchiveCredits.textContent = totalCredits ? String(totalCredits) : "0";
  elements.videoArchiveRated.textContent = rated.length ? `${(rated.reduce((sum, item) => sum + Number(item.score), 0) / rated.length).toFixed(1)}` : "--";
  elements.videoArchiveLatest.textContent = latest ? formatArchiveDate(latest, true) : "--";
  elements.videoNavCount.textContent = archive.length > 99 ? "99+" : String(archive.length);
  elements.videoNavCount.classList.toggle("hidden", archive.length === 0);
  elements.videoArchiveFilters.querySelectorAll("button[data-video-filter]").forEach((button) => {
    button.classList.toggle("active", button.dataset.videoFilter === state.videoArchiveFilter);
  });

  if (!filtered.length) {
    const hasArchive = archive.length > 0;
    elements.videoArchiveGrid.innerHTML = `<div class="video-library-empty"><i data-lucide="${hasArchive ? "search-x" : "clapperboard"}"></i><strong>${hasArchive ? "没有匹配的成片" : "还没有生成成片"}</strong><span>${hasArchive ? "调整搜索词或模型筛选。" : "视频任务完成后会自动归档到这里。"}</span><button class="primary-button" type="button" ${hasArchive ? "data-reset-video-filters" : "data-go-generate"}><i data-lucide="${hasArchive ? "rotate-ccw" : "wand-sparkles"}"></i>${hasArchive ? "返回全部" : "开始生成"}</button></div>`;
    refreshIcons();
    return;
  }

  elements.videoArchiveGrid.innerHTML = filtered.map((item) => {
    const media = item.coverUrl
      ? `<img src="${escapeHtml(item.coverUrl)}" alt="${escapeHtml(item.title)} 封面" loading="lazy" />`
      : `<video src="${escapeHtml(item.url)}" muted preload="metadata" aria-label="${escapeHtml(item.title)} 预览"></video>`;
    return `<article class="video-library-card" data-archived-video="${escapeHtml(item.id)}">
      <div class="video-library-media">${media}<span class="video-model-badge">${escapeHtml(videoModelShortLabel(item.model))}</span><button type="button" data-open-archived-video title="播放并查看详情" aria-label="播放并查看 ${escapeHtml(item.title)}"><i data-lucide="play"></i></button></div>
      <div class="video-library-copy"><div><span>${escapeHtml(formatArchiveDate(item.createdAt, true))}</span><strong>${escapeHtml(item.title)}</strong></div><p>${escapeHtml(item.prompt || "未记录提示词")}</p><div class="video-library-specs"><span>${escapeHtml(`${item.duration || "--"}s`)}</span><span>${escapeHtml(item.resolution || "--")}</span>${item.credits != null ? `<span>${escapeHtml(item.credits)} 积分</span>` : ""}</div></div>
      <footer><span>${item.score ? `MOS ${escapeHtml(item.score)}.0` : "尚未评分"}</span><div><a href="${escapeHtml(item.url)}" download target="_blank" rel="noreferrer" title="下载视频"><i data-lucide="download"></i></a><button type="button" data-open-archived-video title="查看详情"><i data-lucide="panel-right-open"></i></button></div></footer>
    </article>`;
  }).join("");
  refreshIcons();
}

function openVideoDetail(id) {
  const item = (Array.isArray(state.videoArchive) ? state.videoArchive : []).find((entry) => entry.id === id);
  if (!item) return;
  elements.videoDetailDialog.dataset.videoId = item.id;
  elements.videoDetailContent.innerHTML = `<div class="video-detail-heading"><div><span class="section-kicker">${escapeHtml(videoModelShortLabel(item.model))} / ARCHIVED VIDEO</span><h2>${escapeHtml(item.title)}</h2></div><button class="icon-button subtle" type="button" data-close-video-detail title="关闭"><i data-lucide="x"></i></button></div>
    <div class="video-detail-layout"><div class="video-detail-player"><video src="${escapeHtml(item.url)}" poster="${escapeHtml(item.coverUrl || "")}" controls preload="metadata"></video></div><aside class="video-detail-info">
      <dl><div><dt>模型</dt><dd>${escapeHtml(item.modelLabel || videoModelShortLabel(item.model))}</dd></div><div><dt>规格</dt><dd>${escapeHtml(`${item.duration || "--"}s · ${item.resolution || "--"}`)}</dd></div><div><dt>积分</dt><dd>${item.credits != null ? escapeHtml(item.credits) : "--"}</dd></div><div><dt>MOS</dt><dd>${item.score ? `${escapeHtml(item.score)}.0` : "未评分"}</dd></div><div><dt>生成时间</dt><dd>${escapeHtml(formatArchiveDate(item.createdAt, true))}</dd></div><div><dt>任务 ID</dt><dd title="${escapeHtml(item.taskId)}">${escapeHtml(item.taskId || "--")}</dd></div></dl>
      <section><header><strong>视频提示词</strong><button type="button" data-copy-archive-prompt title="复制提示词"><i data-lucide="copy"></i></button></header><p>${escapeHtml(item.prompt || "未记录提示词")}</p></section>
      <div class="video-detail-actions"><button class="danger-button" type="button" data-delete-archived-video><i data-lucide="trash-2"></i>删除记录</button><a class="secondary-button" href="${escapeHtml(item.url)}" download target="_blank" rel="noreferrer"><i data-lucide="download"></i>下载视频</a></div>
    </aside></div>`;
  refreshIcons();
  elements.videoDetailDialog.showModal();
}

function renderVideoTasks() {
  scheduleCreativeDraft();
  const tasks = state.videoTasks;
  if (!tasks.length) {
    elements.videoTaskSummary.textContent = "尚未提交任务";
    elements.videoTaskGrid.innerHTML = `<div class="video-empty"><i data-lucide="video"></i><strong>等待首帧与提示词</strong><span>选择上方候选，然后提交一个或两个模型。</span></div>`;
    refreshIcons();
    return;
  }
  const completed = tasks.filter((task) => task.state === "success").length;
  const failed = tasks.filter((task) => task.state === "failed").length;
  elements.videoTaskSummary.textContent = `${completed}/${tasks.length} 完成${failed ? ` · ${failed} 失败` : ""}`;
  elements.videoTaskGrid.innerHTML = tasks.map((task) => {
    const creation = task.creations?.[0];
    const label = VIDEO_STATE_LABELS[task.state] || task.state;
    const recovery = ["unknown", "interrupted"].includes(task.state) ? `<button class="secondary-button" type="button" data-resume-video>${task.taskId ? "查询原任务" : "核对并补录任务 ID"}</button>` : "";
    const result = creation?.url
      ? `<video controls preload="metadata" poster="${escapeHtml(creation.coverUrl || "")}" src="${escapeHtml(creation.url)}"></video>`
      : `<div class="video-task-wait"><i data-lucide="${task.state === "failed" ? "circle-x" : "loader-circle"}"></i><strong>${escapeHtml(label)}</strong><span>${escapeHtml(task.error || (task.state === "failed" ? `错误码：${task.errorCode || "未知"}` : "Vidu 正在处理这条任务"))}</span>${recovery}</div>`;
    const score = task.score || 0;
    return `<article class="video-task-card ${escapeHtml(task.state)}" data-video-task="${escapeHtml(task.localId)}"><header><div><span>${task.model === "viduq4" ? "Q4" : "Q3.1-AD"}</span><strong>${escapeHtml(task.modelLabel)}</strong></div><b>${escapeHtml(label)}</b></header><div class="video-task-media">${result}</div><footer><div><span>${task.duration}s · ${escapeHtml(task.resolution)}</span>${task.credits != null ? `<span>${task.credits} 积分</span>` : ""}</div>${creation?.url ? `<a href="${escapeHtml(creation.url)}" download target="_blank" rel="noreferrer" title="下载视频"><i data-lucide="download"></i></a>` : ""}</footer>${creation?.url ? `<div class="video-mos"><span>MOS</span>${[1,2,3,4,5].map((value) => `<button class="${value === score ? "active" : ""}" type="button" data-video-score="${value}">${value}</button>`).join("")}<button class="save-video-benchmark" type="button" data-save-video title="存入 Benchmark"><i data-lucide="database"></i></button></div>` : ""}</article>`;
  }).join("");
  refreshIcons();
}

async function createVideoTask(model, common) {
  const localId = `${model}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const task = {
    localId,
    model,
    modelLabel: model === "viduq4" ? "Vidu Q4" : "Vidu Q3.1-ad",
    state: "submitting",
    duration: common.duration,
    resolution: common.resolution,
    prompt: common.prompt,
    audio: common.audio,
    caseTitle: state.result?.caseTitle || "灵感视频",
    sourceName: state.selectedGenerationImage?.name || "",
    sourceCoverUrl: state.selectedGenerationImage?.src || "",
    submittedAt: new Date().toISOString(),
    creations: [],
    score: 0,
  };
  state.videoTasks.push(task);
  renderVideoTasks();
  let sent = false;
  try {
    await saveCreativeDraft(); sent = true;
    const response = await fetch("/api/video/create", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...common, model }),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw Object.assign(new Error(data.error || `任务创建失败（HTTP ${response.status}）`), { status: response.status });
    if (!data.taskId) throw new Error("接口未返回任务 ID，请先到 Vidu 控制台核对。");
    Object.assign(task, data);
    await saveCreativeDraft();
    renderVideoTasks();
    if (task.state === "success") {
      const archived = archiveCompletedVideo(task);
      showToast(archived ? `${task.modelLabel} 视频已生成，已自动存入成片库` : `${task.modelLabel} 视频已生成，但成片库写入失败`);
    } else {
      pollVideoTask(localId);
    }
  } catch (error) {
    task.state = task.taskId ? "interrupted" : sent && (!error.status || error.status >= 500 || error.status === 408) ? "unknown" : "failed";
    task.error = error.message;
    renderVideoTasks();
  }
}

async function pollVideoTask(localId) {
  const task = state.videoTasks.find((item) => item.localId === localId);
  if (!task || !task.taskId || ["success", "failed"].includes(task.state)) return;
  try {
    const response = await fetch(`/api/video/task/${encodeURIComponent(task.taskId)}`);
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || `查询失败（HTTP ${response.status}）`);
    Object.assign(task, data);
    renderVideoTasks();
    if (task.state === "success") {
      const archived = archiveCompletedVideo(task);
      showToast(archived ? `${task.modelLabel} 视频已生成，已自动存入成片库` : `${task.modelLabel} 视频已生成，但成片库写入失败`);
      return;
    }
    if (task.state === "failed") {
      showToast(`${task.modelLabel} 生成失败`);
      return;
    }
  } catch (error) {
    task.pollErrors = (task.pollErrors || 0) + 1;
    if (task.pollErrors >= 4) {
      task.state = "interrupted";
      task.error = `任务查询连续失败：${error.message}`;
      renderVideoTasks();
      return;
    }
  }
  setTimeout(() => pollVideoTask(localId), 5000);
}

async function generateVideos() {
  if (state.creativeBusy || elements.generateVideoButton.disabled) return;
  if (state.videoTasks.some(t => ["submitting", "created", "queueing", "processing", "unknown", "interrupted"].includes(t.state))) { showToast("已有视频任务未完成或待核对，请先查询原任务，避免重复计费。"); return; }
  const models = [elements.useQ4.checked ? "viduq4" : null, elements.useQ31.checked ? "viduq3.1-ad" : null].filter(Boolean);
  if (!models.length) { showToast("至少选择一个视频模型"); return; }
  if (!state.selectedGenerationImage?.dataUrl) { showToast("请先选择或上传一张首帧"); return; }
  const prompt = elements.generatorPrompt.value.trim();
  if (!prompt) { showToast("请填写视频动作提示词"); elements.generatorPrompt.focus(); return; }
  const common = {
    imageDataUrl: state.selectedGenerationImage.dataUrl,
    prompt,
    duration: Number(elements.videoDuration.value),
    resolution: elements.videoResolution.value,
    audio: elements.videoAudio.checked,
    watermark: elements.videoWatermark.checked,
    offPeak: false,
  };
  state.videoTasks = [];
  setPipelineStep("video");
  elements.generateVideoButton.disabled = true;
  elements.generateVideoButton.innerHTML = `<i data-lucide="loader-circle"></i>正在提交 ${models.length} 个任务`;
  refreshIcons();
  await Promise.all(models.map((model) => createVideoTask(model, common)));
  elements.generateVideoButton.disabled = false;
  elements.generateVideoButton.innerHTML = `<i data-lucide="git-compare-arrows"></i>重新生成对比`;
  refreshIcons();
  const accepted = state.videoTasks.filter((task) => task.taskId).length;
  showToast(accepted ? `${accepted} 个真实视频任务已提交` : "视频任务提交失败，请查看错误信息");
}

function saveVideoBenchmark(task) {
  const creation = task.creations?.[0];
  if (!creation?.url) return;
  const item = {
    id: `video-${task.taskId}`,
    name: `${task.modelLabel} · ${state.result?.caseTitle || "灵感视频"}`,
    type: "视频",
    src: creation.coverUrl || state.selectedGenerationImage?.src || "/assets/red-device.webp",
    tags: `${task.duration}s · ${task.resolution} · MOS ${task.score || "未评分"}`,
    owner: "我",
    updated: "刚刚",
    status: "已生成",
  };
  state.customAssets = [item, ...state.customAssets.filter((asset) => asset.id !== item.id)];
  saveLocal("atelier-custom-assets", state.customAssets);
  showToast("视频结果已存入 Benchmark 资产");
}

function clearFilmPreviewUrl() {
  if (state.filmPreviewUrl) URL.revokeObjectURL(state.filmPreviewUrl);
  state.filmPreviewUrl = null;
}

function setFilmSourceFromFile(file) {
  if (!file) return;
  const supported = ["video/mp4", "video/quicktime", "video/webm", "video/x-matroska"];
  if (!supported.includes(file.type)) throw new Error("请选择 MP4、MOV、WebM 或 MKV 视频。");
  if (file.size > 250 * 1024 * 1024) throw new Error("视频不能超过 250MB。");
  clearFilmPreviewUrl();
  state.filmPreviewUrl = URL.createObjectURL(file);
  state.filmSource = { type: "file", file, name: file.name, size: file.size };
  elements.filmPreview.src = state.filmPreviewUrl;
  elements.filmSourceName.textContent = file.name;
  elements.filmSourceMeta.textContent = `${formatBytes(file.size)} · 本地视频`;
  elements.filmPreviewWrap.classList.remove("hidden");
}

function setFilmSourceFromUrl(url) {
  let parsed;
  try { parsed = new URL(url); } catch { throw new Error("请输入有效的视频直链。"); }
  if (!["http:", "https:"].includes(parsed.protocol)) throw new Error("视频链接仅支持 HTTP 或 HTTPS。");
  clearFilmPreviewUrl();
  state.filmSource = { type: "url", url: parsed.href, name: decodeURIComponent(parsed.pathname.split("/").pop() || parsed.hostname) };
  elements.filmPreview.src = parsed.href;
  elements.filmSourceName.textContent = state.filmSource.name;
  elements.filmSourceMeta.textContent = `${parsed.hostname} · 公开直链`;
  elements.filmPreviewWrap.classList.remove("hidden");
}

function renderFilmAnalysis(data) {
  const analysis = data.result;
  const profile = data.videoProfile;
  const structure = analysis.adStructure || {};
  const structureItems = [
    ["HOOK", "前三秒钩子", structure.hook],
    ["TENSION", "问题 / 递进", structure.problem],
    ["PROOF", "产品证明", structure.productProof],
    ["PAYOFF", "情绪回报", structure.payoff],
    ["CTA", "收束行动", structure.cta],
  ];
  const frames = data.frames || [];
  const shots = analysis.shots || [];
  elements.filmAnalysisResult.innerHTML = `<div class="film-report-head"><div><span>VLM REPORT · ${escapeHtml(data.model || "GPT-5.6")}</span><h2>${escapeHtml(analysis.title || data.fileName)}</h2><p>${escapeHtml(analysis.summary)}</p></div><dl><div><dt>时长</dt><dd>${escapeHtml(profile.durationLabel)}</dd></div><div><dt>画幅</dt><dd>${profile.width}×${profile.height}</dd></div><div><dt>镜头</dt><dd>${shots.length}</dd></div><div><dt>音频</dt><dd>${profile.hasAudio ? "有" : "无"}</dd></div></dl></div>
    <section class="film-report-section"><header><span>01</span><div><strong>关键帧时间线</strong><small>${frames.length} 帧 · 场景检测 + 均匀采样</small></div></header><div class="film-timeline">${frames.map((frame) => `<button type="button" data-film-seek="${frame.time}"><img src="${escapeHtml(frame.url)}" alt="${escapeHtml(frame.timeLabel)} 关键帧" /><span>${escapeHtml(frame.timeLabel)}</span></button>`).join("")}</div></section>
    <section class="film-report-section"><header><span>02</span><div><strong>广告结构</strong><small>从注意力到行动的完整链路</small></div></header><div class="ad-structure-grid">${structureItems.map(([code, label, copy]) => `<article><span>${code}</span><strong>${label}</strong><p>${escapeHtml(copy || "未识别")}</p></article>`).join("")}</div></section>
    <section class="film-report-section"><header><span>03</span><div><strong>逐镜头拆解</strong><small>画面 / 动作 / 运镜 / 声音 / 产品角色</small></div></header><div class="shot-analysis-list">${shots.map((shot) => `<article><button class="shot-timecode" type="button" data-film-seek="${shot.start}"><b>${escapeHtml(shot.id)}</b><span>${formatFilmTime(shot.start)}–${formatFilmTime(shot.end)}</span></button><div class="shot-analysis-copy"><h3>${escapeHtml(shot.visual)}</h3><div class="shot-analysis-meta"><span>景别 · ${escapeHtml(shot.shotSize)}</span><span>镜头 · ${escapeHtml(shot.camera)}</span><span>转场 · ${escapeHtml(shot.transition)}</span></div><dl><div><dt>动作</dt><dd>${escapeHtml(shot.action)}</dd></div><div><dt>声音 / 文字</dt><dd>${escapeHtml(shot.audio)} · ${escapeHtml(shot.onScreenText)}</dd></div><div><dt>产品角色</dt><dd>${escapeHtml(shot.productRole)}</dd></div><div><dt>为何有效</dt><dd>${escapeHtml(shot.whyItWorks)}</dd></div></dl><div class="shot-prompt"><span>复刻提示词</span><p>${escapeHtml(shot.prompt)}</p><button type="button" data-copy="${escapeHtml(shot.prompt)}" title="复制提示词"><i data-lucide="copy"></i></button></div></div></article>`).join("")}</div></section>
    <section class="film-report-section film-system-grid"><article><span>VISUAL SYSTEM</span><strong>视觉系统</strong><ul>${(analysis.visualSystem || []).map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul></article><article><span>AUDIO / RHYTHM</span><strong>声音与节奏</strong><p>${escapeHtml(analysis.rhythm)}</p><ul>${(analysis.audioSystem || []).map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul></article></section>
    <section class="film-report-section replication-block"><header><span>04</span><div><strong>复刻生产包</strong><small>从结构到生成提示词</small></div></header><div class="replication-layout"><ol>${(analysis.replicationPlan || []).map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ol><div><div class="master-prompt"><span>MASTER VIDEO PROMPT</span><p>${escapeHtml(analysis.masterPrompt)}</p><button type="button" data-copy="${escapeHtml(analysis.masterPrompt)}" title="复制主提示词"><i data-lucide="copy"></i></button></div><div class="negative-prompt"><span>NEGATIVE</span><p>${escapeHtml(analysis.negativePrompt)}</p></div></div></div></section>`;
  refreshIcons();
}

function formatFilmTime(value) {
  const seconds = Math.max(0, Number(value) || 0);
  return `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${(seconds % 60).toFixed(1).padStart(4, "0")}`;
}

function setAnalysisProgress(active, label = "") {
  elements.analysisProgress.classList.toggle("hidden", !active);
  elements.analyzeFilmButton.disabled = active;
  if (label) elements.analysisProgressLabel.textContent = label;
  elements.analyzeFilmButton.innerHTML = active
    ? `<i data-lucide="loader-circle"></i>VLM 正在拉片`
    : `<i data-lucide="scan-search"></i>开始 VLM 拉片`;
  refreshIcons();
}

async function analyzeFilm() {
  if (!state.filmSource) { showToast("请先选择本地视频或输入公开视频直链"); return; }
  setAnalysisProgress(true, state.filmSource.type === "file" ? "正在上传视频" : "正在读取视频直链");
  const labels = ["FFmpeg 正在读取视频信息", "正在检测场景变化与音频节奏", "正在提取代表帧", "GPT-5.6 VLM 正在拆解广告"];
  let index = 0;
  const progressTimer = setInterval(() => {
    elements.analysisProgressLabel.textContent = labels[Math.min(index, labels.length - 1)];
    index += 1;
  }, 9000);
  try {
    let response;
    if (state.filmSource.type === "file") {
      response = await fetch("/api/video/analyze", {
        method: "POST",
        headers: {
          "Content-Type": state.filmSource.file.type,
          "X-File-Name": encodeURIComponent(state.filmSource.file.name),
          "X-Analysis-Focus": encodeURIComponent(elements.filmFocus.value.trim()),
        },
        body: state.filmSource.file,
      });
    } else {
      response = await fetch("/api/video/analyze-url", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: state.filmSource.url, focus: elements.filmFocus.value.trim() }),
      });
    }
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(apiErrorMessage(data, `拉片失败（HTTP ${response.status}）`));
    state.filmAnalysis = data;
    renderFilmAnalysis(data);
    showToast(`拉片完成：识别 ${data.result?.shots?.length || 0} 个镜头`);
  } catch (error) {
    elements.filmAnalysisResult.innerHTML = `<div class="film-empty error"><i data-lucide="circle-alert"></i><strong>拉片未完成</strong><span>${escapeHtml(error.message || "视频分析失败，请稍后重试。")}</span><button class="secondary-button" type="button" data-retry-film><i data-lucide="refresh-cw"></i>重试拉片</button></div>`;
    refreshIcons();
    showToast(error.message || "视频分析失败");
  } finally {
    clearInterval(progressTimer);
    setAnalysisProgress(false);
  }
}

function renderComparisons() {
  elements.comparisonGrid.innerHTML = COMPARISONS.map((item, index) => `<article class="compare-card" data-compare-index="${index}">
    <header><strong>${escapeHtml(item.model)}</strong><span class="model-state">演示结果</span></header>
    <div class="compare-visual"><img src="${item.src}" alt="${escapeHtml(item.model)} 对比结果" /><button type="button" title="预览"><i data-lucide="play"></i></button></div>
    <div class="compare-score"><div class="score-top"><span>MOS SCORE</span><strong>${item.score}.0</strong></div><div class="score-dots">${[1,2,3,4,5].map((score) => `<button class="${score === item.score ? "active" : ""}" type="button" data-score="${score}">${score}</button>`).join("")}</div><textarea rows="4" aria-label="${escapeHtml(item.model)} 评分理由">${escapeHtml(item.note)}</textarea></div>
  </article>`).join("");
  refreshIcons();
}

function renderLibrary() {
  const query = elements.librarySearch.value.trim().toLowerCase();
  const assets = [...state.customAssets, ...DEFAULT_ASSETS].filter((asset) => !query || `${asset.name} ${asset.tags} ${asset.type}`.toLowerCase().includes(query));
  elements.assetCount.textContent = String(48 + state.customAssets.length);
  elements.caseCount.textContent = String(7 + state.savedCases.length);
  elements.assetTable.innerHTML = `<div class="asset-row header"><span>预览</span><span>名称</span><span>类型</span><span>标签</span><span class="asset-owner">创建者</span><span>更新时间</span><span></span></div>${assets.map((asset) => `<div class="asset-row"><img src="${escapeHtml(asset.src)}" alt="${escapeHtml(asset.name)}" /><div class="asset-name"><strong>${escapeHtml(asset.name)}</strong><small>ID · ${escapeHtml(asset.id)}</small></div><span class="asset-cell">${escapeHtml(asset.type)}</span><span class="asset-cell">${escapeHtml(asset.tags)}</span><span class="asset-cell asset-owner">${escapeHtml(asset.owner)}</span><div><span class="asset-status">${escapeHtml(asset.status)}</span><small class="asset-cell" style="display:block;margin-top:4px">${escapeHtml(asset.updated)}</small></div><button type="button" title="更多"><i data-lucide="ellipsis"></i></button></div>`).join("")}`;
  refreshIcons();
}

function saveCurrentCase() {
  if (!state.result) return;
  const item = { id: `case-${Date.now()}`, title: state.result.caseTitle, savedAt: new Date().toISOString(), result: state.result };
  state.savedCases = [item, ...state.savedCases].slice(0, 12);
  saveLocal("atelier-saved-cases", state.savedCases);
  state.customAssets = [{ id: item.id, name: item.title, type: "Case", src: state.source?.preview || "/assets/red-device.webp", tags: state.result.tags.slice(0, 3).join(" · "), owner: "我", updated: "刚刚", status: "可复用" }, ...state.customAssets].slice(0, 20);
  saveLocal("atelier-custom-assets", state.customAssets);
  renderLibrary();
  showToast("Case 生产包已保存到团队资产");
}

function exportCase() {
  if (!state.result) return;
  const blob = new Blob([JSON.stringify(state.result, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `atelier-case-${Date.now()}.json`;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function copyText(text) {
  try { await navigator.clipboard.writeText(text); }
  catch {
    const helper = document.createElement("textarea");
    helper.value = text;
    helper.style.position = "fixed";
    helper.style.opacity = "0";
    document.body.appendChild(helper);
    helper.select();
    document.execCommand("copy");
    helper.remove();
  }
  showToast("已复制到剪贴板");
}

async function prepareVideoProduction() {
  if (state.result?.production?.videoPrompt) elements.generatorPrompt.value = state.result.production.videoPrompt;
  if (state.source?.dataUrl) {
    state.selectedGenerationImage = { ...state.source, src: state.source.preview };
    elements.generatorSourcePreview.src = state.source.preview;
    elements.generatorSourceName.textContent = state.source.name;
    elements.generatorSourceMeta.textContent = state.source.meta;
  }
  renderGeneratorResults();
  switchView("generate");
  showToast(state.selectedGenerationImage ? "Case 提示词与首帧已进入视频生成" : "请在生成页选择一张视频首帧");
}

function bindEvents() {
  document.querySelectorAll(".nav-button[data-view]").forEach((button) => button.addEventListener("click", () => switchView(button.dataset.view)));
  elements.mobileMenuButton.addEventListener("click", () => elements.sidebar.classList.toggle("open"));
  elements.agentTrack.addEventListener("click", (event) => {
    const lane = event.target.closest(".agent-lane");
    if (!lane) return;
    lane.classList.toggle("active");
    lane.classList.contains("active") ? state.activeAgents.add(lane.dataset.agent) : state.activeAgents.delete(lane.dataset.agent);
  });
  document.querySelectorAll(".composer-mode button").forEach((button) => button.addEventListener("click", () => {
    document.querySelectorAll(".composer-mode button").forEach((item) => item.classList.remove("active"));
    button.classList.add("active");
    state.mode = button.dataset.mode;
  }));
  elements.creativeStylePicker.addEventListener("click", (event) => {
    const button = event.target.closest("[data-style-id]");
    if (!button) return;
    setCreativeStyle(button.dataset.styleId);
    showToast(`已选择创意方向：${CREATIVE_STYLE_PRESETS[state.styleId].label}`);
  });
  document.querySelectorAll("[data-production-tab]").forEach((button) => button.addEventListener("click", () => { state.productionTab = button.dataset.productionTab; renderProduction(); }));
  elements.briefInput.addEventListener("input", () => { elements.briefCount.textContent = String(elements.briefInput.value.length); });
  elements.runAgentButton.addEventListener("click", runAgents);
  elements.briefInput.addEventListener("keydown", (event) => { if ((event.ctrlKey || event.metaKey) && event.key === "Enter") runAgents(); });
  elements.uploadButton.addEventListener("click", () => elements.fileInput.click());
  elements.fileInput.addEventListener("change", async () => {
    try { await setSourceFromFile(elements.fileInput.files[0]); showToast("参考图片已载入"); }
    catch (error) { showToast(error.message); }
  });
  elements.removeSourceButton.addEventListener("click", removeSource);
  elements.linkButton.addEventListener("click", () => { state.linkTarget = "agent"; elements.linkInput.value = ""; elements.linkDialog.showModal(); setTimeout(() => elements.linkInput.focus(), 50); });
  elements.linkForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (event.submitter?.value === "cancel") { elements.linkDialog.close(); return; }
    const url = elements.linkInput.value.trim();
    if (!url) return;
    elements.loadLinkButton.disabled = true;
    elements.loadLinkButton.textContent = "读取中";
    try { await loadRemoteImage(url, state.linkTarget); elements.linkDialog.close(); showToast("链接图片已载入"); }
    catch (error) { showToast(error.message); }
    finally { elements.loadLinkButton.disabled = false; elements.loadLinkButton.textContent = "载入图片"; }
  });
  elements.starterButton.addEventListener("click", () => {
    elements.briefInput.value = "把参考图发展成一条 8 秒的社交媒体 Case：保持主体身份和产品结构，用一个有记忆点的动作或光影变化完成叙事，并给出可用于多模型对比的统一提示词。";
    elements.briefCount.textContent = String(elements.briefInput.value.length);
    elements.briefInput.focus();
  });
  elements.newCaseButton.addEventListener("click", () => {
    state.messages = [{ role: "assistant", title: "SIRIHOTDRAMA 总控", text: "新 Case 已创建。添加素材或描述创意，我会组织 Agent 开始工作。" }];
    state.result = null;
    removeSource();
    elements.briefInput.value = "";
    elements.briefCount.textContent = "0";
    elements.currentCaseTitle.textContent = "未命名 Case";
    renderMessages();
    renderProduction();
  });
  elements.clearConversationButton.addEventListener("click", () => { state.messages = state.messages.slice(0, 1); renderMessages(); showToast("对话已清空"); });
  elements.exportCaseButton.addEventListener("click", exportCase);
  elements.saveCaseButton.addEventListener("click", saveCurrentCase);
  elements.startProductionButton.addEventListener("click", prepareVideoProduction);
  elements.compareModelsButton.addEventListener("click", () => { if (state.result) elements.comparePromptTitle.textContent = state.result.caseTitle; switchView("compare"); });
  elements.helpButton.addEventListener("click", () => elements.helpDialog.showModal());
  elements.notificationsButton.addEventListener("click", () => showToast("3 个任务更新：1 个 Case 完成，2 个 Benchmark 待评分"));
  elements.inspirationFilters.addEventListener("click", (event) => {
    const button = event.target.closest("button[data-filter]");
    if (!button) return;
    elements.inspirationFilters.querySelectorAll("button").forEach((item) => item.classList.remove("active"));
    button.classList.add("active");
    state.galleryPage = 1; renderInspirations(button.dataset.filter);
  });
  elements.shuffleButton.addEventListener("click", async () => { elements.shuffleButton.disabled = true; try { await loadGallery(); } finally { elements.shuffleButton.disabled = false; } });
  elements.gallerySearch.addEventListener("input", () => { state.galleryPage = 1; renderInspirations(); });
  elements.gallerySort.addEventListener("change", () => { state.galleryPage = 1; renderInspirations(); });
  elements.galleryUploadButton.addEventListener("click", () => elements.galleryFileInput.click());
  elements.galleryFileInput.addEventListener("change", async () => {
    const files = [...elements.galleryFileInput.files]; elements.galleryFileInput.value = "";
    if (files.length > 20) { showToast("每批最多上传 20 张图片，请分批添加。"); return; }
    elements.galleryUploadButton.disabled = true; let added = 0;
    try {
      for (const file of files) {
        const image = await compressImage(file);
        await saveGalleryImage({ ...image, name: file.name }, { refresh: false }); added++;
      }
      await loadGallery();
      state.galleryPage = 1; renderInspirations("mine");
      showToast(`已保存 ${added} 张图片`);
    } catch (error) { await loadGallery(); showToast(`已保存 ${added} 张。${error.message}`); }
    finally { elements.galleryUploadButton.disabled = false; }
  });
  elements.inspirationGrid.addEventListener("click", async (event) => {
    const pageButton = event.target.closest("[data-gallery-page]");
    if (pageButton) { state.galleryPage += Number(pageButton.dataset.galleryPage); renderInspirations(); return; }
    const card = event.target.closest("[data-inspiration]");
    const action = event.target.closest("[data-inspiration-action]")?.dataset.inspirationAction;
    if (!card || !action) return;
    const item = galleryItems().find(entry => entry.id === card.dataset.inspiration);
    if (!item) return;
    if (action === "save") {
      const saved = state.galleryFavorites.includes(item.id);
      const next = saved ? state.galleryFavorites.filter(id => id !== item.id) : [...state.galleryFavorites, item.id];
      if (!saveLocal("sirihotdrama-image-favorites", next)) { showToast("收藏保存失败，请检查浏览器存储空间。"); return; }
      state.galleryFavorites = next; renderInspirations(); showToast(saved ? "已取消收藏" : `已收藏「${item.title}」`); return;
    }
    try {
      if (action === "delete" && item.origin === "mine") {
        if (!confirm(`删除本浏览器中的「${item.title}」？不会删除原文件或已有成片。`)) return;
        await window.CreativeAssets.remove(item.id);
        state.galleryFavorites = state.galleryFavorites.filter(id => id !== item.id); saveLocal("sirihotdrama-image-favorites", state.galleryFavorites);
        await loadGallery(); return;
      }
      if (action === "animate" || action === "reverse") {
        await setGenerationImageFromPath(item.src, `${item.title}.jpg`);
        elements.imageDirection.value = item.desc || "";
        setCreationMode("image", false);
        switchView("generate");
        await saveCreativeDraft();
        showToast("灵感已选为视频首帧");
        return;
      }
      await setSourceFromPath(item.src, `${item.title}.jpg`);
      elements.briefInput.value = action === "reverse" ? `逆推「${item.title}」的主体、场景、风格和可执行视频提示词。` : `基于「${item.title}」做一条完整 Case，保留核心视觉特征并设计新的时间变化。`;
      elements.briefCount.textContent = String(elements.briefInput.value.length);
      state.mode = action === "reverse" ? "reverse" : "case";
      document.querySelectorAll(".composer-mode button").forEach((button) => button.classList.toggle("active", button.dataset.mode === state.mode));
      switchView("agent");
      showToast("素材已送入 Agent 工作区");
    } catch (error) { showToast(error.message); }
  });
  elements.decomposeFrameStrip.addEventListener("click", (event) => {
    const item = event.target.closest("[data-decompose-frame]");
    if (!item) return;
    if (event.target.closest(".frame-remove")) {
      removeDecomposeFrame(item.dataset.decomposeFrame);
      showToast("关键帧已移除");
      return;
    }
    state.selectedDecomposeFrameId = item.dataset.decomposeFrame;
    renderDecomposeFrames();
  });
  elements.decomposeFrameInput.addEventListener("change", async () => {
    try {
      const { added, skipped } = await addDecomposeFiles(elements.decomposeFrameInput.files);
      showToast(skipped ? `已添加 ${added} 张，${skipped} 张因数量或容量上限未加入` : `已添加 ${added} 张关键帧`);
    } catch (error) {
      elements.decomposeFrameInput.value = "";
      showToast(error.message);
    }
  });
  elements.sendDecomposeToAgent.addEventListener("click", async () => {
    try {
      transferDecomposeFramesToAgent();
      elements.briefInput.value = `分析这组 ${state.decomposeFrames.length} 张参考素材，以当前主参考为构图与主体基准，结合其余素材提取可复用的主体、场景和风格信息，完成关键帧提示词、三镜头分镜和多模型评测方案。`;
      elements.briefCount.textContent = String(elements.briefInput.value.length);
      state.mode = "case";
      document.querySelectorAll(".composer-mode button").forEach((button) => button.classList.toggle("active", button.dataset.mode === state.mode));
      switchView("agent");
      showToast(`${state.decomposeFrames.length} 张参考素材已送入 Agent`);
    } catch (error) { showToast(error.message); }
  });
  elements.toolMatrix.addEventListener("click", (event) => {
    const tile = event.target.closest(".tool-tile");
    if (!tile) return;
    elements.toolMatrix.querySelectorAll(".tool-tile").forEach((item) => item.classList.remove("active"));
    tile.classList.add("active");
    if (tile.dataset.tool === "text-image") setCreationMode("idea");
    if (tile.dataset.tool === "image-video") setCreationMode("image");
    showToast(`已切换到「${tile.querySelector("strong").textContent}」工具`);
  });
  document.querySelectorAll("[data-creation-mode]").forEach((button) => button.addEventListener("click", () => setCreationMode(button.dataset.creationMode)));
  elements.generateIdeaKeyframeButton.addEventListener("click", generateIdeaKeyframe);
  elements.resumeIdeaTaskButton.addEventListener("click", () => resumeIdeaKeyframe().catch(e => showToast(e.message)));
  elements.reverseImagePromptButton.addEventListener("click", reverseGenerationImage);
  elements.copyGeneratorPrompt.addEventListener("click", () => copyText(elements.generatorPrompt.value));
  elements.generationLinkButton.addEventListener("click", () => { state.linkTarget = "generation"; elements.linkInput.value = ""; elements.linkDialog.showModal(); elements.linkInput.focus(); });
  elements.saveGenerationImageButton.addEventListener("click", async () => {
    elements.saveGenerationImageButton.disabled = true;
    try { await saveGalleryImage(state.selectedGenerationImage, { description: elements.generatorPrompt.value }); showToast("图片已存入精选图片库"); }
    catch (error) { showToast(error.message); }
    finally { elements.saveGenerationImageButton.disabled = false; }
  });
  for (const id of ["generatorPrompt", "ideaInput", "imageDirection", "generationStyle", "videoDuration", "videoResolution", "ideaAspectRatio", "ideaResolution", "ideaQuality"]) elements[id].addEventListener("input", scheduleCreativeDraft);
  elements.generatorResults.addEventListener("click", async (event) => {
    const card = event.target.closest("[data-generation-src]");
    if (!card) return;
    try {
      await setGenerationImageFromPath(card.dataset.generationSrc, card.dataset.generationName);
      showToast("已选为视频首帧");
    } catch (error) { showToast(error.message); }
  });
  elements.uploadGenerationImageButton.addEventListener("click", () => elements.generationImageInput.click());
  elements.generationImageInput.addEventListener("change", async () => {
    const file = elements.generationImageInput.files[0]; elements.generationImageInput.value = ""; if (!file) return;
    try { await setGenerationImageFromFile(file); showToast("自定义首帧已载入"); }
    catch (error) { showToast(error.message); }
  });
  elements.generateVideoButton.addEventListener("click", generateVideos);
  elements.videoTaskGrid.addEventListener("click", async (event) => {
    const card = event.target.closest("[data-video-task]");
    if (!card) return;
    const task = state.videoTasks.find((item) => item.localId === card.dataset.videoTask);
    if (!task) return;
    const resume = event.target.closest("[data-resume-video]");
    if (resume && !resume.disabled) {
      resume.disabled = true;
      try {
        if (!task.taskId) {
          const id = prompt("请在 Vidu 控制台核对后输入该视频任务 ID，不会创建新任务。");
          if (!id) return;
          if (!/^[a-zA-Z0-9_-]{1,200}$/.test(id.trim())) throw new Error("任务 ID 格式无效。");
          task.taskId = id.trim();
        }
        task.state = "processing"; task.pollErrors = 0; task.error = "";
        await saveCreativeDraft(); await pollVideoTask(task.localId);
      } catch (error) { showToast(error.message); }
      finally { resume.disabled = false; }
      return;
    }
    const scoreButton = event.target.closest("[data-video-score]");
    if (scoreButton) {
      task.score = Number(scoreButton.dataset.videoScore);
      updateArchivedVideoScore(task);
      setPipelineStep("score");
      renderVideoTasks();
      return;
    }
    if (event.target.closest("[data-save-video]")) saveVideoBenchmark(task);
  });
  elements.openGeneratorFromArchive.addEventListener("click", () => switchView("generate"));
  elements.videoArchiveFilters.addEventListener("click", (event) => {
    const button = event.target.closest("button[data-video-filter]");
    if (!button) return;
    state.videoArchiveFilter = button.dataset.videoFilter;
    renderVideoLibrary();
  });
  elements.videoArchiveSearch.addEventListener("input", renderVideoLibrary);
  elements.videoArchiveGrid.addEventListener("click", (event) => {
    if (event.target.closest("[data-go-generate]")) { switchView("generate"); return; }
    if (event.target.closest("[data-reset-video-filters]")) {
      state.videoArchiveFilter = "all";
      elements.videoArchiveSearch.value = "";
      renderVideoLibrary();
      return;
    }
    const openButton = event.target.closest("[data-open-archived-video]");
    const card = openButton?.closest("[data-archived-video]");
    if (card) openVideoDetail(card.dataset.archivedVideo);
  });
  elements.videoDetailContent.addEventListener("click", (event) => {
    if (event.target.closest("[data-close-video-detail]")) { elements.videoDetailDialog.close(); return; }
    const item = state.videoArchive.find((entry) => entry.id === elements.videoDetailDialog.dataset.videoId);
    if (!item) return;
    if (event.target.closest("[data-copy-archive-prompt]")) { copyText(item.prompt || ""); return; }
    if (event.target.closest("[data-delete-archived-video]")) {
      if (!window.confirm("仅删除这条本地归档记录，云端视频不会被删除。确定继续吗？")) return;
      state.videoArchive = state.videoArchive.filter((entry) => entry.id !== item.id);
      saveLocal("atelier-video-archive", state.videoArchive);
      elements.videoDetailDialog.close();
      renderVideoLibrary();
      showToast("成片记录已删除");
    }
  });
  elements.videoDetailDialog.addEventListener("close", () => {
    const video = elements.videoDetailContent.querySelector("video");
    if (video) video.pause();
  });
  elements.filmUploadZone.addEventListener("click", () => elements.filmFileInput.click());
  elements.filmFileInput.addEventListener("change", () => {
    try { setFilmSourceFromFile(elements.filmFileInput.files[0]); showToast("视频已载入，可开始拉片"); }
    catch (error) { showToast(error.message); }
  });
  elements.filmUploadZone.addEventListener("dragover", (event) => { event.preventDefault(); elements.filmUploadZone.classList.add("dragging"); });
  elements.filmUploadZone.addEventListener("dragleave", () => elements.filmUploadZone.classList.remove("dragging"));
  elements.filmUploadZone.addEventListener("drop", (event) => {
    event.preventDefault();
    elements.filmUploadZone.classList.remove("dragging");
    try { setFilmSourceFromFile(event.dataTransfer.files[0]); showToast("视频已载入，可开始拉片"); }
    catch (error) { showToast(error.message); }
  });
  elements.loadFilmUrlButton.addEventListener("click", () => {
    try { setFilmSourceFromUrl(elements.filmUrlInput.value.trim()); showToast("视频链接已载入"); }
    catch (error) { showToast(error.message); }
  });
  elements.analyzeFilmButton.addEventListener("click", analyzeFilm);
  elements.filmAnalysisResult.addEventListener("click", (event) => {
    if (event.target.closest("[data-retry-film]")) { analyzeFilm(); return; }
    const seek = event.target.closest("[data-film-seek]");
    if (!seek) return;
    if (Number.isFinite(Number(seek.dataset.filmSeek))) elements.filmPreview.currentTime = Number(seek.dataset.filmSeek);
    elements.filmPreview.play().catch(() => {});
  });
  elements.comparisonGrid.addEventListener("click", (event) => {
    const scoreButton = event.target.closest("button[data-score]");
    if (!scoreButton) return;
    const card = scoreButton.closest("[data-compare-index]");
    const index = Number(card.dataset.compareIndex);
    COMPARISONS[index].score = Number(scoreButton.dataset.score);
    renderComparisons();
  });
  elements.syncPlaybackButton.addEventListener("click", () => showToast("4 个演示结果已同步到 00:00"));
  elements.saveBenchmarkButton.addEventListener("click", () => {
    const item = { id: `benchmark-${Date.now()}`, name: `${state.result?.caseTitle || "新 Case"} · 多模型评测`, type: "Benchmark", src: state.source?.preview || "/assets/red-device.webp", tags: "多模型 · MOS · 视频", owner: "我", updated: "刚刚", status: "已评测" };
    state.customAssets = [item, ...state.customAssets];
    saveLocal("atelier-custom-assets", state.customAssets);
    showToast("对比结果已存入 Benchmark");
  });
  elements.librarySearch.addEventListener("input", renderLibrary);
  elements.createCollectionButton.addEventListener("click", () => showToast("已创建空合集，可从素材卡片继续添加"));
  elements.globalSearch.addEventListener("keydown", (event) => {
    if (event.key !== "Enter") return;
    elements.librarySearch.value = elements.globalSearch.value;
    switchView("library");
  });
  document.addEventListener("keydown", (event) => {
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") { event.preventDefault(); elements.globalSearch.focus(); }
  });
  document.addEventListener("click", (event) => {
    const copyButton = event.target.closest("[data-copy]");
    if (copyButton) copyText(copyButton.dataset.copy);
  });
  document.addEventListener("click", async event => {
    const a = event.target.closest("a");
    if (!a || a.origin !== location.origin || !["/workspace.html", "/drama.html"].includes(a.pathname) || event.ctrlKey || event.metaKey || event.shiftKey) return;
    event.preventDefault();
    try { await saveCreativeDraft(); location.assign(a.href); }
    catch (error) { showToast(error.message); }
  });
  window.addEventListener("hashchange", applyCreativeRoute);
  window.addEventListener("popstate", applyCreativeRoute);
  window.addEventListener("beforeunload", event => {
    if (state.creativeBusy || state.videoTasks.some(t => t.state === "submitting")) { event.preventDefault(); event.returnValue = ""; }
  });
}

async function init() {
  refreshIcons();
  renderMessages();
  renderProduction();
  renderInspirations();
  renderGeneratorResults();
  renderVideoTasks();
  renderVideoLibrary();
  renderComparisons();
  renderLibrary();
  renderDecomposeFrames();
  bindEvents();
  setCreativeStyle(state.styleId);
  elements.generatorPrompt.value = "";
  try {
    const draft = await window.CreativeAssets.draft();
    if (draft) {
      state.selectedGenerationImage = draft.image || null;
      state.generatedKeyframes = draft.generatedKeyframes || [];
      state.videoTasks = draft.videoTasks || []; state.ideaTask = draft.ideaTask || null;
      for (const task of state.videoTasks) if (task.state === "submitting") task.state = task.taskId ? "processing" : "unknown";
      elements.generatorPrompt.value = draft.prompt || ""; elements.ideaInput.value = draft.idea || "";
      elements.imageDirection.value = draft.direction || ""; elements.generationStyle.value = draft.style || "auto";
      for (const [id, value] of Object.entries(draft.controls || {})) if (elements[id]?.tagName === "SELECT") elements[id].value = value;
    }
  } catch (error) { showToast(error.message); }
  state.draftReady = true;
  showGenerationSource(); renderGeneratorResults(); renderVideoTasks(); renderIdeaResume();
  applyCreativeRoute();
  loadGallery();
  checkHealth();
  try {
    await setSourceFromPath("/assets/red-device.webp", "red-device.webp");
    for (const [src, name] of [
      ["/assets/red-device.webp", "red-device.webp"],
      ["/assets/fashion-editorial.jpg", "fashion-editorial.jpg"],
      ["/assets/portrait-soft.jpg", "portrait-soft.jpg"],
    ]) await addDecomposeFrameFromPath(src, name);
    renderDecomposeFrames();
  }
  catch { /* sample source preview remains available in the production panel */ }
  if (state.activeAgentJobId) runAgents();
  for (const task of state.videoTasks) if (task.taskId && !["success", "failed"].includes(task.state)) pollVideoTask(task.localId);
}

init();
