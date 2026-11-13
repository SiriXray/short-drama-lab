const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const dns = require("node:dns").promises;
const net = require("node:net");
const os = require("node:os");
const crypto = require("node:crypto");
const { execFile } = require("node:child_process");
const { promisify } = require("node:util");
const gatewayProtocol = require("./gateway-protocol");

const PUBLIC_DIR = path.join(__dirname, "public");
const DEFAULT_PORT = Number(process.env.PORT || 4328);
const DEFAULT_BASE_URL = "https://api.openai.com/v1";
const DEFAULT_MODEL = "gpt-5.6-sol";
const DEFAULT_FALLBACK_MODEL = "gpt-5.6-terra";
const DEFAULT_CREATIVE_MODEL = "gpt-6-sol";
const DEFAULT_CREATIVE_FALLBACK_MODEL = "gpt-6-luna";
const CREATIVE_BACKUP_FILE = path.join(__dirname, "data", "creative-backup.json");
const CREATIVE_HOST_COOLDOWN_MS = 60000;
const CREATIVE_CONNECTION_ERRORS = new Set(["UND_ERR_CONNECT_TIMEOUT", "ETIMEDOUT", "ECONNREFUSED", "ECONNRESET", "ENOTFOUND", "EAI_AGAIN"]);
const DEFAULT_REASONING_EFFORT = "low";
const GATEWAY_RETRYABLE_STATUS = new Set([408, 409, 425, 429, 500, 502, 503, 504]);
const AGENT_TIMEOUT_MS = Number(process.env.ATELIER_AGENT_TIMEOUT_MS || 120000);
const VLM_TIMEOUT_MS = Number(process.env.ATELIER_VLM_TIMEOUT_MS || 480000);
const PRIMARY_AGENT_TIMEOUT_MS = Number(process.env.ATELIER_PRIMARY_AGENT_TIMEOUT_MS || 180000);
const PRIMARY_VLM_TIMEOUT_MS = Number(process.env.ATELIER_PRIMARY_VLM_TIMEOUT_MS || 90000);
const CREATIVE_PROMPT_TIMEOUT_MS = Number(process.env.ATELIER_CREATIVE_PROMPT_TIMEOUT_MS || 90000);
const PRIMARY_CREATIVE_PROMPT_TIMEOUT_MS = Number(process.env.ATELIER_PRIMARY_CREATIVE_PROMPT_TIMEOUT_MS || 120000);
const AGENT_MAX_OUTPUT_TOKENS = Math.max(1200, Math.min(5200, Number(process.env.ATELIER_AGENT_MAX_OUTPUT_TOKENS || 3200)));
const AGENT_JOB_TIMEOUT_MS = 300000;
const AGENT_JOB_TTL_MS = 30 * 60 * 1000;
const MAX_AGENT_JOBS = 32;
const MAX_ACTIVE_AGENT_JOBS = 2;
const GATEWAY_MAX_ATTEMPTS = Math.max(1, Math.min(5, Number(process.env.ATELIER_GATEWAY_MAX_ATTEMPTS || 3)));
const MODEL_COOLDOWN_MS = Number(process.env.ATELIER_MODEL_COOLDOWN_MS || 600000);
const MAX_BODY_BYTES = 18 * 1024 * 1024;
const MAX_IMAGE_BYTES = 12 * 1024 * 1024;
const MAX_REMOTE_REDIRECTS = 4;
const REMOTE_IMAGE_TIMEOUT_MS = 20000;
const REMOTE_IMAGE_TYPES = new Set(["image/gif", "image/jpeg", "image/png", "image/webp"]);
const MAX_VIDEO_BYTES = 250 * 1024 * 1024;
const MAX_ANALYSIS_SECONDS = 300;
const VIDEO_JOB_DIR = path.join(os.tmpdir(), "vidu-atelier-video-analysis");
const FFMPEG_PATH = process.env.FFMPEG_PATH || "ffmpeg";
const FFPROBE_PATH = process.env.FFPROBE_PATH || "ffprobe";
const execFileAsync = promisify(execFile);
const REMOTE_VIDEO_TYPES = new Set(["video/mp4", "video/quicktime", "video/webm", "video/x-matroska"]);
let gatewayProbeCache = { checkedAt: 0, reachable: false, authenticated: false, statusCode: null, latencyMs: null };
const gatewayModelCooldowns = new Map();
const creativeHostCooldowns = new Map();
const creativeRouteChecks = new Map();
const agentJobs = new Map();

const MIME_TYPES = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".ico": "image/x-icon",
  ".jpeg": "image/jpeg",
  ".jpg": "image/jpeg",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".webp": "image/webp",
};

const AGENT_IDS = ["strategist", "prompt", "director", "evaluator"];
const MODE_IDS = ["case", "reverse", "storyboard", "benchmark"];
const CREATIVE_STYLE_PRESETS = {
  auto: {
    label: "自动匹配",
    description: "让 Agent 从素材和创意中判断最合适的视觉方向",
    direction: "不预设品牌风格，先从主体、素材质感和创意目标中判断最合适的视觉语言。",
    focus: "优先给出 2 个可执行方向，并说明推荐理由。",
    prompt: "保持创意目标与参考素材真实质感，先判断主体、场景、色彩和动作，再选择最合适的商业视觉语言。",
    negative: "避免风格与素材冲突，避免无依据的品牌化符号。",
  },
  apple: {
    label: "Apple 极简科技",
    description: "留白、材质、功能瞬间与克制高级感",
    direction: "提炼极简科技产品广告的视觉语言：干净留白、单一主体、精准材质光、克制动作、清晰功能瞬间和高级但不堆砌的商业质感。",
    focus: "策略聚焦一个核心产品价值，提示词锁定材质与结构，导演用少镜头完成清晰展示，评测强调产品一致性、功能可读性和留白控制。",
    prompt: "极简科技产品广告，干净留白背景，单一主体构图，精准柔光勾勒材质与边缘，克制且有目的的产品动作，清晰展示一个核心功能瞬间，冷静高级的商业摄影，画面秩序严谨。",
    negative: "避免堆叠道具、复杂背景、过度装饰、夸张表演、无意义快速剪辑、廉价科技霓虹和新增品牌 Logo。",
  },
  miumiu: {
    label: "Miu Miu 复古少女",
    description: "复古学院、轻俏反差、时装感与生活化动作",
    direction: "提炼复古学院与当代少女感的时装广告语言：轻微怀旧色彩、精致但不端着的造型、俏皮反差、生活化微动作、材质细节和带有编辑感的构图。",
    focus: "策略聚焦人物态度与风格记忆点，提示词强调服装材质和姿态，导演加入轻巧有趣的动作节奏，评测关注人物气质、造型连续性和时装编辑感。",
    prompt: "复古学院感时装广告，轻微怀旧的柔和色彩，精致但自然的少女姿态，俏皮而克制的生活化微动作，针织、皮革、缎面等材质细节，带有时装杂志编辑感的构图，轻盈但有记忆点。",
    negative: "避免成熟奢华晚宴感、过度性感化、夸张卡通感、脏乱复古滤镜、造型漂移、复杂 Logo 和可识别的现成广告画面。",
  },
  cinematic: {
    label: "电影叙事",
    description: "光影、情绪、空间关系与连续动作",
    direction: "采用电影化叙事的视觉语言：明确的情绪弧线、层次光影、空间关系、自然运动和有因果的镜头衔接，避免只有漂亮画面而缺少事件。",
    focus: "策略聚焦情绪转折，提示词补足环境和光线逻辑，导演设计动作因果与镜头衔接，评测强调叙事连贯性、节奏和情绪传达。",
    prompt: "电影化广告叙事，具有明确情绪弧线和动作因果，层次丰富的光影与空间纵深，自然且连续的运动，镜头之间通过视线、动作或光线完成衔接，真实电影摄影质感。",
    negative: "避免只有氛围没有事件、跳切式动作、空间关系混乱、光线方向前后矛盾、过度慢动作和无关的视觉特效。",
  },
};

const AGENT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["caseTitle", "intentSummary", "creativeStrategy", "sourceAnalysis", "agents", "production", "nextActions", "tags"],
  properties: {
    caseTitle: { type: "string" },
    intentSummary: { type: "string" },
    creativeStrategy: { type: "string" },
    sourceAnalysis: {
      type: "object",
      additionalProperties: false,
      required: ["subject", "scene", "style", "composition", "opportunities", "risks"],
      properties: {
        subject: { type: "string" },
        scene: { type: "string" },
        style: { type: "string" },
        composition: { type: "string" },
        opportunities: { type: "array", items: { type: "string" }, minItems: 2, maxItems: 5 },
        risks: { type: "array", items: { type: "string" }, minItems: 1, maxItems: 4 },
      },
    },
    agents: {
      type: "array",
      minItems: 1,
      maxItems: 4,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["id", "headline", "output", "bullets"],
        properties: {
          id: { type: "string", enum: AGENT_IDS },
          headline: { type: "string" },
          output: { type: "string" },
          bullets: { type: "array", items: { type: "string" }, minItems: 2, maxItems: 5 },
        },
      },
    },
    production: {
      type: "object",
      additionalProperties: false,
      required: ["format", "audience", "duration", "aspectRatio", "imagePrompt", "videoPrompt", "negativePrompt", "storyboard"],
      properties: {
        format: { type: "string" },
        audience: { type: "string" },
        duration: { type: "string" },
        aspectRatio: { type: "string" },
        imagePrompt: { type: "string" },
        videoPrompt: { type: "string" },
        negativePrompt: { type: "string" },
        storyboard: {
          type: "array",
          minItems: 3,
          maxItems: 6,
          items: {
            type: "object",
            additionalProperties: false,
            required: ["shot", "time", "visual", "camera", "audio", "prompt"],
            properties: {
              shot: { type: "string" },
              time: { type: "string" },
              visual: { type: "string" },
              camera: { type: "string" },
              audio: { type: "string" },
              prompt: { type: "string" },
            },
          },
        },
      },
    },
    nextActions: { type: "array", items: { type: "string" }, minItems: 2, maxItems: 5 },
    tags: { type: "array", items: { type: "string" }, minItems: 3, maxItems: 8 },
  },
};

const CREATIVE_PROMPT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["visualSummary", "imagePrompt", "videoPrompt", "negativePrompt", "motionPlan"],
  properties: {
    visualSummary: { type: "string" },
    imagePrompt: { type: "string" },
    videoPrompt: { type: "string" },
    negativePrompt: { type: "string" },
    motionPlan: {
      type: "array",
      minItems: 3,
      maxItems: 5,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["time", "action", "camera"],
        properties: {
          time: { type: "string" },
          action: { type: "string" },
          camera: { type: "string" },
        },
      },
    },
  },
};

const VIDEO_ANALYSIS_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: [
    "title", "summary", "adStructure", "shots", "visualSystem", "audioSystem",
    "rhythm", "replicationPlan", "masterPrompt", "negativePrompt", "risks",
  ],
  properties: {
    title: { type: "string" },
    summary: { type: "string" },
    adStructure: {
      type: "object",
      additionalProperties: false,
      required: ["hook", "problem", "productProof", "payoff", "cta"],
      properties: {
        hook: { type: "string" },
        problem: { type: "string" },
        productProof: { type: "string" },
        payoff: { type: "string" },
        cta: { type: "string" },
      },
    },
    shots: {
      type: "array",
      minItems: 1,
      maxItems: 8,
      items: {
        type: "object",
        additionalProperties: false,
        required: [
          "start", "end", "frameIndex", "visual", "camera", "action", "audioText", "role", "prompt",
        ],
        properties: {
          start: { type: "number" },
          end: { type: "number" },
          frameIndex: { type: "integer" },
          visual: { type: "string" },
          camera: { type: "string" },
          action: { type: "string" },
          audioText: { type: "string" },
          role: { type: "string" },
          prompt: { type: "string" },
        },
      },
    },
    visualSystem: { type: "array", items: { type: "string" }, minItems: 2, maxItems: 8 },
    audioSystem: { type: "array", items: { type: "string" }, minItems: 1, maxItems: 8 },
    rhythm: { type: "string" },
    replicationPlan: { type: "array", items: { type: "string" }, minItems: 3, maxItems: 10 },
    masterPrompt: { type: "string" },
    negativePrompt: { type: "string" },
    risks: { type: "array", items: { type: "string" }, minItems: 1, maxItems: 8 },
  },
};

function cleanText(value, maxLength = 2000) {
  if (typeof value !== "string") return "";
  return value.trim().slice(0, maxLength);
}

function getGatewayConfig() {
  const baseUrl = (process.env.ATELIER_BASE_URL || process.env.OPENAI_BASE_URL || DEFAULT_BASE_URL).replace(/\/$/, "");
  const apiKey = process.env.ATELIER_API_KEY || process.env.MY_PROXY_API_KEY || process.env.OPENAI_API_KEY || "";
  return {
    apiKey,
    keySource: process.env.ATELIER_API_KEY
      ? "ATELIER_API_KEY"
      : process.env.MY_PROXY_API_KEY
        ? "MY_PROXY_API_KEY"
        : process.env.OPENAI_API_KEY
          ? "OPENAI_API_KEY"
          : null,
    baseUrl,
    model: process.env.ATELIER_MODEL || process.env.OPENAI_MODEL || DEFAULT_MODEL,
    fallbackModel: process.env.ATELIER_FALLBACK_MODEL || DEFAULT_FALLBACK_MODEL,
    reasoningEffort: process.env.ATELIER_REASONING_EFFORT || DEFAULT_REASONING_EFFORT,
  };
}

function getCreativeBackupConfig(env = process.env, filePath = CREATIVE_BACKUP_FILE) {
  if (env.ATELIER_CREATIVE_BACKUP_ENABLED === "0") return null;
  let apiKey = env.DEEPSEEK_API_KEY || "";
  if (!apiKey) {
    try { apiKey = JSON.parse(fs.readFileSync(filePath, "utf8")).apiKey || ""; }
    catch (error) {
      if (error.code !== "ENOENT") throw Object.assign(new Error("创意备用服务配置文件无效。"), { statusCode: 503 });
    }
  }
  if (typeof apiKey !== "string" || !apiKey.trim()) return null;
  // Keep this credential bound to the official endpoint confirmed by the user.
  return { apiKey: apiKey.trim(), baseUrl: "https://api.deepseek.com", model: "deepseek-flash", provider: "deepseek", supportsImages: true };
}

function getCreativePromptConfig(base = getGatewayConfig(), env = process.env, backup = getCreativeBackupConfig(env)) {
  return { ...base,
    model: env.ATELIER_CREATIVE_MODEL || DEFAULT_CREATIVE_MODEL,
    fallbackModel: env.ATELIER_CREATIVE_FALLBACK_MODEL ?? DEFAULT_CREATIVE_FALLBACK_MODEL,
    backup,
  };
}

function creativePromptRoutes(config, now = Date.now()) {
  const routes = config.apiKey ? gatewayModelCandidates(config, now).map(model => ({ ...config, model, provider: config.provider || "gateway" })) : [];
  if (config.backup?.apiKey) routes.push(config.backup);
  const available = routes.filter(route => (creativeHostCooldowns.get(route.baseUrl) || 0) <= now);
  return available.length ? available : routes;
}

function creativePromptStatus(config, probe, now = Date.now()) {
  const route = creativePromptRoutes(config, now)[0];
  const check = route && creativeRouteChecks.get(`${route.baseUrl}|${route.model}`);
  const recent = check && now - check.checkedAt < CREATIVE_HOST_COOLDOWN_MS;
  const sameGateway = route?.baseUrl === config.baseUrl;
  return {
    version: 3, configured: Boolean(route), model: config.model, fallbackModel: config.fallbackModel,
    activeModel: route?.model || config.model, provider: route?.provider || "gateway",
    fallbackActive: Boolean(route && (route.baseUrl !== config.baseUrl || route.model !== config.model)),
    backupConfigured: Boolean(config.backup?.apiKey), backupModel: config.backup?.model || null,
    gateway: route ? new URL(route.baseUrl).host : null,
    gatewayReachable: recent ? check.ok : sameGateway ? probe.reachable : null,
    gatewayAuthenticated: recent ? check.ok : sameGateway ? probe.authenticated : null,
    primaryTimeoutMs: PRIMARY_CREATIVE_PROMPT_TIMEOUT_MS, fallbackTimeoutMs: CREATIVE_PROMPT_TIMEOUT_MS,
  };
}

function isGatewayModelCoolingDown(model, now = Date.now()) {
  const until = gatewayModelCooldowns.get(model) || 0;
  if (until <= now) {
    gatewayModelCooldowns.delete(model);
    return false;
  }
  return true;
}

function gatewayModelCandidates(config, now = Date.now()) {
  const models = [...new Set([config.model, config.fallbackModel].filter(Boolean))];
  if (models.length > 1 && isGatewayModelCoolingDown(config.model, now)) return models.filter((model) => model !== config.model);
  return models;
}

function markGatewayModelUnavailable(model, traceId, durationMs = MODEL_COOLDOWN_MS) {
  gatewayModelCooldowns.set(model, Date.now() + durationMs);
  console.warn(`[gateway] ${traceId || "no-trace"} model=${model} cooldown_ms=${durationMs}`);
}

function isGatewayModelError(error) {
  return error?.errorCode === "GATEWAY_HTTP_404" || /model not found|invalid_model/i.test(error?.message || "");
}

async function probeGateway(config = getGatewayConfig(), options = {}) {
  if (!config.apiKey) return { reachable: false, authenticated: false, statusCode: null, latencyMs: null };
  const now = Date.now();
  if (!options.force && now - gatewayProbeCache.checkedAt < 15000) return gatewayProbeCache;
  const startedAt = Date.now();
  try {
    const response = await (options.fetchImpl || fetch)(`${config.baseUrl}/models`, {
      headers: { Authorization: `Bearer ${config.apiKey}` },
      signal: AbortSignal.timeout(4000),
    });
    gatewayProbeCache = {
      checkedAt: now,
      reachable: true,
      authenticated: ![401, 403].includes(response.status),
      statusCode: response.status,
      latencyMs: Date.now() - startedAt,
    };
  } catch {
    gatewayProbeCache = { checkedAt: now, reachable: false, authenticated: false, statusCode: null, latencyMs: null };
  }
  return gatewayProbeCache;
}

function normalizeAgentRequest(body) {
  if (!body || typeof body !== "object") throw Object.assign(new Error("请求内容不能为空。"), { statusCode: 400 });
  const brief = cleanText(body.brief, 5000);
  const imageDataUrl = cleanText(body.imageDataUrl, MAX_BODY_BYTES);
  const imageDataUrls = Array.isArray(body.imageDataUrls)
    ? [...new Set(body.imageDataUrls.map((value) => cleanText(value, MAX_BODY_BYTES)).filter(Boolean))].slice(0, 8)
    : [];
  if (!brief && !imageDataUrl && !imageDataUrls.length) {
    throw Object.assign(new Error("请提供创意描述或参考图片。"), { statusCode: 400 });
  }
  let totalImageBytes = 0;
  for (const image of [imageDataUrl, ...imageDataUrls].filter(Boolean)) {
    const match = image.match(/^data:image\/(png|jpe?g|webp|gif);base64,([a-zA-Z0-9+/=]+)$/);
    if (!match) throw Object.assign(new Error("图片格式不受支持，请使用 PNG、JPG、WebP 或 GIF。"), { statusCode: 400 });
    const estimatedBytes = Math.floor((match[2].length * 3) / 4);
    if (estimatedBytes > MAX_IMAGE_BYTES) throw Object.assign(new Error("处理后的图片不能超过 12MB。"), { statusCode: 413 });
    totalImageBytes += estimatedBytes;
  }
  if (totalImageBytes > MAX_IMAGE_BYTES) throw Object.assign(new Error("参考图片合计不能超过 12MB。"), { statusCode: 413 });
  const requestedAgents = Array.isArray(body.agents) ? body.agents.filter((id) => AGENT_IDS.includes(id)) : AGENT_IDS;
  const agents = [...new Set(requestedAgents)].slice(0, 4);
  const styleId = typeof body.styleId === "string" && Object.hasOwn(CREATIVE_STYLE_PRESETS, body.styleId)
    ? body.styleId
    : "auto";
  return {
    brief,
    imageDataUrl,
    imageDataUrls,
    imageName: cleanText(body.imageName, 180),
    mode: MODE_IDS.includes(body.mode) ? body.mode : "case",
    styleId,
    agents: agents.length ? agents : AGENT_IDS,
    targetModel: cleanText(body.targetModel, 60) || "Vidu Q4",
    aspectRatio: ["16:9", "9:16", "1:1", "4:3"].includes(body.aspectRatio) ? body.aspectRatio : "9:16",
    duration: [5, 8, 10, 12, 15, 20].includes(Number(body.duration)) ? Number(body.duration) : 8,
    audience: cleanText(body.audience, 300) || "社交媒体内容消费者",
  };
}

function normalizeCreativePromptRequest(body) {
  const base = normalizeAgentRequest({
    ...body,
    mode: body?.imageDataUrl || body?.imageDataUrls?.length ? "reverse" : "case",
    agents: ["prompt", "director"],
  });
  return {
    brief: base.brief,
    imageDataUrl: base.imageDataUrl,
    imageDataUrls: base.imageDataUrls,
    aspectRatio: base.aspectRatio,
    duration: base.duration,
    targetModel: base.targetModel,
  };
}

function buildUserBrief(input) {
  const modeLabels = {
    case: "完整 Case 生产：从创意拆解到关键帧、分镜和视频提示词",
    reverse: "重点逆推参考素材，提取主体、场景、风格与中英文可执行提示词",
    storyboard: "重点输出导演级分镜脚本、运镜、节奏和声音设计",
    benchmark: "重点构造可用于多模型横向评测的统一提示词、变量和评分维度",
  };
  const roleLabels = {
    strategist: "创意策略 Agent：负责洞察、受众、叙事钩子与差异化方向",
    prompt: "提示词工程 Agent：负责可直接用于生图和生视频模型的提示词",
    director: "分镜导演 Agent：负责镜头、动作、时间连续性和声音设计",
    evaluator: "评测 Agent：负责风险、可执行性、多模型评测维度与验收标准",
  };
  const style = CREATIVE_STYLE_PRESETS[input.styleId] || CREATIVE_STYLE_PRESETS.auto;
  return [
    `任务模式：${modeLabels[input.mode]}`,
    `用户创意：${input.brief || "仅基于参考图片自主拆解与发散"}`,
    `目标视频模型：${input.targetModel}`,
    `目标受众：${input.audience}`,
    `成片规格：${input.aspectRatio}，约 ${input.duration} 秒`,
    `创意方向：${style.label}`,
    `方向说明：${style.direction}`,
    `Agent 分工重点：${style.focus}`,
    `风格执行提示词：${style.prompt}`,
    `风格负面约束：${style.negative}`,
    `已启用 Agent：\n${input.agents.map((id) => `- ${roleLabels[id]}`).join("\n")}`,
    "请让每个 Agent 的输出互相衔接，不要重复同一段话。",
    "所有提示词必须描述可见画面、动作变化、镜头行为、光线和连续性，可直接用于生成模型。",
    "不要猜测真实人物身份、品牌或受版权保护角色；无法确认的事实使用中性表述。",
    "风格预设只用于提炼视觉语言，不要复制品牌 Logo、具体广告素材、商标文案或可识别的在世人物；最终输出应形成原创、可执行的创意方案。",
  ].join("\n");
}

function buildGatewayPayload(input, model, structured = true, reasoningEffort = DEFAULT_REASONING_EFFORT) {
  const content = [{ type: "input_text", text: buildUserBrief(input) }];
  const referenceImages = [...new Set([input.imageDataUrl, ...(input.imageDataUrls || [])].filter(Boolean))];
  referenceImages.forEach((imageUrl, index) => content.push({ type: "input_image", image_url: imageUrl, detail: index === 0 ? "high" : "low" }));
  const payload = {
    model,
    instructions: [
      "你是 SIRIHOTDRAMA 的总控 Agent，负责协调创意策略、提示词工程、分镜导演和模型评测四个专业角色。",
      "你的目标是把一个模糊创意转化为可以落地生产、对比评测和沉淀复用的 Case 生产包。",
      "先分析输入素材，再分配角色观点，最后合并为一致的生产计划。",
      "语言务实、具体、专业，避免空泛营销语和无法执行的概念。",
      "输出必须符合给定 JSON 结构，所有内容使用中文。",
      "每个说明字段只写一句具体短句，Agent 各给 2 个要点，分镜给 3 段，避免重复；视频提示词必须完整可执行。",
      "必须把用户选择的创意方向落实到 creativeStrategy、四个 Agent 报告、storyboard 和 production prompts，而不是只在标签中提及。",
    ].join("\n"),
    input: [{ role: "user", content }],
    reasoning: { effort: reasoningEffort },
    max_output_tokens: AGENT_MAX_OUTPUT_TOKENS,
  };
  if (structured) {
    payload.text = {
      format: {
        type: "json_schema",
        name: "atelier_agent_case",
        strict: true,
        schema: AGENT_SCHEMA,
      },
    };
  } else {
    payload.input[0].content[0].text += `\n\n仅返回一个 JSON 对象，不要使用 Markdown 代码块。结构必须符合：${JSON.stringify(AGENT_SCHEMA)}`;
  }
  return payload;
}

function buildCreativePromptPayload(input, model, structured = true) {
  const referenceImages = [...new Set([input.imageDataUrl, ...(input.imageDataUrls || [])].filter(Boolean))];
  const content = [{
    type: "input_text",
    text: [
      `原始想法：${input.brief || "请基于参考图片判断"}`,
      `成片规格：${input.aspectRatio}，约 ${input.duration} 秒，目标模型 ${input.targetModel}`,
      referenceImages.length
        ? "分析参考图并保持主体身份、产品结构、颜色、材质、构图和场景稳定，只设计时间变化、动作、运镜与光影变化。"
        : "把想法整理成一张适合作为视频首帧的商业画面，同时给出后续运动方向。",
      "提示词必须描述可见画面和可执行动作；无法从图片确认的品牌、人物身份或文字不要臆造。",
    ].join("\n"),
  }];
  referenceImages.forEach((imageUrl) => content.push({ type: "input_image", image_url: imageUrl, detail: "low" }));
  const payload = {
    model,
    instructions: [
      "你是商业影像提示词导演，只处理单张关键帧和图生视频动态提示词。",
      "输出中文，内容具体紧凑；videoPrompt 必须自包含，可直接提交视频模型。",
      "motionPlan 按时间顺序给出 3-5 段动作和镜头变化，不写策略、评测、标签或营销解释。",
      "输出必须符合给定 JSON 结构，不要输出 Markdown。",
    ].join("\n"),
    input: [{ role: "user", content }],
    reasoning: { effort: model === "deepseek-flash" ? "none" : "low" },
    max_output_tokens: model === "deepseek-flash" ? 2800 : 1400,
  };
  if (structured) {
    payload.text = { format: { type: "json_schema", name: "creative_video_prompt", strict: true, schema: CREATIVE_PROMPT_SCHEMA } };
  } else {
    payload.input[0].content[0].text += `\n仅返回 JSON：${JSON.stringify(CREATIVE_PROMPT_SCHEMA)}`;
  }
  return payload;
}

function extractOutputText(response) {
  if (typeof response?.output_text === "string" && response.output_text.trim()) return response.output_text.trim();
  const chunks = [];
  for (const item of response?.output || []) {
    for (const content of item?.content || []) {
      if (typeof content?.text === "string") chunks.push(content.text);
    }
  }
  return chunks.join("\n").trim();
}

function parseModelJson(text) {
  if (!text) throw new Error("模型没有返回可解析的内容。");
  const cleaned = text.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "").trim();
  try {
    return JSON.parse(cleaned);
  } catch {
    const start = cleaned.indexOf("{");
    const end = cleaned.lastIndexOf("}");
    if (start >= 0 && end > start) return JSON.parse(cleaned.slice(start, end + 1));
    throw new Error("模型返回的 JSON 格式无效。");
  }
}

function applyCreativeStylePrompt(result, input) {
  const styleId = Object.hasOwn(CREATIVE_STYLE_PRESETS, input?.styleId) ? input.styleId : "auto";
  const style = CREATIVE_STYLE_PRESETS[styleId];
  const stylePrompt = `风格执行：${style.prompt}`;
  const styleNegative = `风格负面约束：${style.negative}`;
  result.production.imagePrompt = cleanText(`${result.production.imagePrompt} ${stylePrompt}`, 5000);
  result.production.videoPrompt = cleanText(`${result.production.videoPrompt} ${stylePrompt}`, 5000);
  result.production.negativePrompt = cleanText(`${result.production.negativePrompt} ${styleNegative}`, 2000);
  result.production.storyboard = result.production.storyboard.map((shot) => ({
    ...shot,
    prompt: cleanText(`${shot.prompt} ${stylePrompt}`, 2000),
  }));
  result.creativeStyle = {
    id: styleId,
    label: style.label,
    prompt: style.prompt,
    negativePrompt: style.negative,
  };
  return result;
}

function validateAgentResult(result, input) {
  if (!result || typeof result !== "object" || !result.production || !result.sourceAnalysis || !Array.isArray(result.agents)) {
    throw new Error("模型返回缺少完整的 Case 生产计划。");
  }
  const requested = new Set(input.agents);
  const agents = result.agents
    .filter((agent) => requested.has(agent.id))
    .slice(0, 4)
    .map((agent) => ({
      id: agent.id,
      headline: cleanText(agent.headline, 300),
      output: cleanText(agent.output, 2000),
      bullets: Array.isArray(agent.bullets) ? agent.bullets.map((item) => cleanText(item, 500)).filter(Boolean).slice(0, 5) : [],
    }));
  const storyboard = Array.isArray(result.production.storyboard)
    ? result.production.storyboard.slice(0, 6).map((shot) => ({
      shot: cleanText(shot?.shot, 80),
      time: cleanText(shot?.time, 80),
      visual: cleanText(shot?.visual, 1000),
      camera: cleanText(shot?.camera, 500),
      audio: cleanText(shot?.audio, 500),
      prompt: cleanText(shot?.prompt, 2000),
    }))
    : [];
  const opportunities = Array.isArray(result.sourceAnalysis.opportunities)
    ? result.sourceAnalysis.opportunities.map((item) => cleanText(item, 500)).filter(Boolean).slice(0, 5) : [];
  const risks = Array.isArray(result.sourceAnalysis.risks)
    ? result.sourceAnalysis.risks.map((item) => cleanText(item, 500)).filter(Boolean).slice(0, 4) : [];
  const tags = Array.isArray(result.tags) ? result.tags.map((item) => cleanText(item, 120)).filter(Boolean).slice(0, 8) : [];
  const nextActions = Array.isArray(result.nextActions) ? result.nextActions.map((item) => cleanText(item, 500)).filter(Boolean).slice(0, 5) : [];
  const normalized = {
    caseTitle: cleanText(result.caseTitle, 300),
    intentSummary: cleanText(result.intentSummary, 1200),
    creativeStrategy: cleanText(result.creativeStrategy, 3000),
    sourceAnalysis: {
      subject: cleanText(result.sourceAnalysis.subject, 800),
      scene: cleanText(result.sourceAnalysis.scene, 800),
      style: cleanText(result.sourceAnalysis.style, 800),
      composition: cleanText(result.sourceAnalysis.composition, 800),
      opportunities,
      risks,
    },
    agents,
    production: {
      format: cleanText(result.production.format, 200),
      audience: cleanText(result.production.audience, 500),
      duration: cleanText(result.production.duration, 80),
      aspectRatio: cleanText(result.production.aspectRatio, 40),
      imagePrompt: cleanText(result.production.imagePrompt, 5000),
      videoPrompt: cleanText(result.production.videoPrompt, 5000),
      negativePrompt: cleanText(result.production.negativePrompt, 2000),
      storyboard,
    },
    nextActions,
    tags,
  };
  const missingAgent = input.agents.some((id) => !agents.some((agent) => agent.id === id));
  const invalidAgent = agents.some((agent) => !agent.headline || !agent.output || agent.bullets.length < 2);
  const invalidShot = storyboard.some((shot) => Object.values(shot).some((value) => !value));
  const requiredText = [
    normalized.caseTitle, normalized.intentSummary, normalized.creativeStrategy,
    normalized.sourceAnalysis.subject, normalized.sourceAnalysis.scene, normalized.sourceAnalysis.style,
    normalized.sourceAnalysis.composition, normalized.production.format, normalized.production.audience,
    normalized.production.duration, normalized.production.aspectRatio, normalized.production.imagePrompt,
    normalized.production.videoPrompt, normalized.production.negativePrompt,
  ];
  if (requiredText.some((value) => !value) || missingAgent || invalidAgent || invalidShot
    || storyboard.length < 3 || opportunities.length < 2 || risks.length < 1 || nextActions.length < 2 || tags.length < 3) {
    throw new Error("模型返回的策略、Agent 报告、分镜或提示词不完整。");
  }
  return applyCreativeStylePrompt(normalized, input);
}

function validateCreativePromptResult(result) {
  if (!result || typeof result !== "object" || !Array.isArray(result.motionPlan)) {
    throw new Error("模型返回的创意提示词不完整。");
  }
  const normalized = {
    visualSummary: cleanText(result.visualSummary, 1200),
    imagePrompt: cleanText(result.imagePrompt, 5000),
    videoPrompt: cleanText(result.videoPrompt, 5000),
    negativePrompt: cleanText(result.negativePrompt, 2000),
    motionPlan: result.motionPlan.slice(0, 5).map((item) => ({
      time: cleanText(item?.time, 80),
      action: cleanText(item?.action, 600),
      camera: cleanText(item?.camera, 400),
    })),
  };
  if (!normalized.imagePrompt || !normalized.videoPrompt || normalized.motionPlan.length < 3) {
    throw new Error("模型缺少关键帧提示词、视频提示词或运动计划。");
  }
  return normalized;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function gatewayFailureMessage(operation, error) {
  if (error?.name === "TimeoutError") return `${operation}超过等待上限。`;
  const cause = error?.cause?.code || error?.code || "NETWORK_ERROR";
  const messages = {
    ECONNREFUSED: "本机 AI 网关未响应",
    ECONNRESET: "AI 网关连接被重置",
    ETIMEDOUT: "AI 网关连接超时",
    UND_ERR_CONNECT_TIMEOUT: "AI 网关连接超时",
    UND_ERR_HEADERS_TIMEOUT: "AI 网关返回响应头超时",
    UND_ERR_SOCKET: "AI 网关连接意外中断",
  };
  return `${operation}暂时失败：${messages[cause] || "无法连接 AI 网关"}。`;
}

async function requestGatewayResponse(endpoint, payload, options = {}) {
  const fetchImpl = options.fetchImpl || fetch;
  const sleepImpl = options.sleepImpl || sleep;
  const operation = options.operation || "AI 请求";
  const timeoutMs = options.timeoutMs || AGENT_TIMEOUT_MS;
  const maxAttempts = options.maxAttempts || GATEWAY_MAX_ATTEMPTS;
  const traceId = options.traceId || crypto.randomBytes(6).toString("hex");
  const chatMode = options.protocol !== "responses" && gatewayProtocol.active() && gatewayProtocol.isResponsesPayload(payload);
  const targetEndpoint = chatMode ? gatewayProtocol.chatEndpoint(endpoint) : endpoint;
  const requestBody = chatMode ? gatewayProtocol.toChatBody(payload) : payload;
  let lastError;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const startedAt = Date.now();
    const timeoutSignal = AbortSignal.timeout(timeoutMs);
    const requestSignal = options.signal
      ? AbortSignal.any([options.signal, timeoutSignal])
      : timeoutSignal;
    try {
      const response = await fetchImpl(targetEndpoint, {
        method: "POST",
        headers: options.headers,
        body: JSON.stringify(requestBody),
        signal: requestSignal,
        redirect: options.redirect,
      });
      const raw = await response.text();
      let data;
      try { data = JSON.parse(raw); } catch { data = null; }
      if (response.ok) {
        console.log(`[gateway] ${traceId} ${operation} success attempt=${attempt} duration_ms=${Date.now() - startedAt}`);
        return { response, raw, data: chatMode ? gatewayProtocol.fromChatResponse(data) : data, attempts: attempt, traceId };
      }
      const message = data?.error?.message || raw.slice(0, 500) || `${operation}失败（HTTP ${response.status}）`;
      lastError = Object.assign(new Error(message), {
        statusCode: response.status >= 500 ? 502 : response.status,
        errorCode: `GATEWAY_HTTP_${response.status}`,
        retryable: GATEWAY_RETRYABLE_STATUS.has(response.status),
        attempts: attempt,
        traceId,
      });
      console.warn(`[gateway] ${traceId} ${operation} http=${response.status} attempt=${attempt} duration_ms=${Date.now() - startedAt}`);
      if (!lastError.retryable || attempt === maxAttempts) break;
    } catch (error) {
      const abortedByDeadline = requestSignal.aborted && requestSignal.reason?.name === "TimeoutError";
      const abortedExternally = Boolean(options.signal?.aborted);
      const cause = requestSignal.aborted ? requestSignal.reason : error;
      lastError = Object.assign(new Error(gatewayFailureMessage(operation, cause)), {
        name: cause?.name || "Error",
        statusCode: abortedByDeadline ? 504 : abortedExternally ? 499 : 502,
        errorCode: abortedByDeadline ? "GATEWAY_TIMEOUT" : abortedExternally ? "REQUEST_ABORTED" : (cause?.cause?.code || cause?.code || "GATEWAY_NETWORK_ERROR"),
        retryable: !abortedExternally,
        attempts: attempt,
        traceId,
      });
      console.warn(`[gateway] ${traceId} ${operation} network=${lastError.errorCode} attempt=${attempt} duration_ms=${Date.now() - startedAt}`);
      if (abortedExternally || attempt === maxAttempts) break;
    }
    await sleepImpl(Math.min(5000, 1000 * (2 ** (attempt - 1))));
  }
  if (lastError?.retryable && lastError.attempts > 1) {
    lastError.message = `${lastError.message} 已自动尝试 ${lastError.attempts} 次，请使用错误编号 ${lastError.traceId} 排查。`;
  }
  throw lastError;
}

async function callGateway(input, options = {}) {
  const config = options.config || getGatewayConfig();
  if (!config.apiKey) throw Object.assign(new Error("服务端未配置 API Key。"), { statusCode: 503 });
  const endpoint = `${config.baseUrl}/responses`;
  let lastError;
  for (const model of gatewayModelCandidates(config)) {
    const fallbackUsed = model !== config.model;
    for (const structured of [true, false]) {
      let gatewayResult;
      try {
        gatewayResult = await requestGatewayResponse(endpoint, buildGatewayPayload(input, model, structured, config.reasoningEffort), {
          headers: { Authorization: `Bearer ${config.apiKey}`, "Content-Type": "application/json" },
          operation: `Agent 响应 (${model})`,
          timeoutMs: fallbackUsed ? AGENT_TIMEOUT_MS : PRIMARY_AGENT_TIMEOUT_MS,
          maxAttempts: 1,
          signal: options.signal,
          fetchImpl: options.fetchImpl,
        });
      } catch (error) {
        lastError = error;
        if (options.signal?.aborted) throw error;
        if (structured && [400, 422].includes(error.statusCode) && !isGatewayModelError(error)) continue;
        if (error.retryable || isGatewayModelError(error)) markGatewayModelUnavailable(model, error.traceId);
        break;
      }
      const { response, data, attempts, traceId } = gatewayResult;
      if (data?.status === "incomplete") {
        const reason = cleanText(data?.incomplete_details?.reason, 120) || "unknown";
        lastError = Object.assign(new Error(`Agent 输出未完成（${reason}）。请缩短输入后重试。`), {
          statusCode: 502,
          errorCode: "GATEWAY_INCOMPLETE_OUTPUT",
          traceId,
          retryable: true,
        });
        markGatewayModelUnavailable(model, traceId);
        break;
      }
      try {
        gatewayModelCooldowns.delete(model);
        return {
          result: validateAgentResult(parseModelJson(extractOutputText(data)), input),
          model,
          fallbackUsed,
          reasoningEffort: config.reasoningEffort,
          requestId: response.headers.get("x-request-id") || data?.id || null,
          attempts,
          traceId,
        };
      } catch (error) {
        lastError = Object.assign(new Error(`Agent 返回结构不完整：${error.message}`), { statusCode: 502, errorCode: "GATEWAY_INVALID_OUTPUT", traceId, retryable: true });
        console.warn(`[gateway] ${traceId} Agent 响应 invalid_output model=${model} structured=${structured}`);
        markGatewayModelUnavailable(model, traceId);
        break;
      }
    }
  }
  throw lastError;
}

async function callCreativePromptGateway(input, options = {}) {
  const config = options.config || getCreativePromptConfig();
  const routes = creativePromptRoutes(config);
  if (!routes.length) throw Object.assign(new Error("服务端未配置 API Key。"), { statusCode: 503 });
  const failedHosts = new Set();
  const secrets = [config.apiKey, config.backup?.apiKey].filter(Boolean);
  let lastError;
  for (const route of routes) {
    if (failedHosts.has(route.baseUrl)) continue;
    options.signal?.throwIfAborted();
    const { model } = route;
    const endpoint = `${route.baseUrl}/responses`;
    const routeKey = `${route.baseUrl}|${model}`;
    const fallbackUsed = model !== config.model || route.baseUrl !== config.baseUrl;
    for (const structured of [true, false]) {
      let gatewayResult;
      try {
        gatewayResult = await requestGatewayResponse(endpoint, buildCreativePromptPayload(input, model, structured), {
          headers: { Authorization: `Bearer ${route.apiKey}`, "Content-Type": "application/json" },
          operation: `创意提示词 (${model})`,
          timeoutMs: fallbackUsed ? CREATIVE_PROMPT_TIMEOUT_MS : PRIMARY_CREATIVE_PROMPT_TIMEOUT_MS,
          maxAttempts: 1,
          signal: options.signal,
          fetchImpl: options.fetchImpl,
          redirect: "error",
        });
      } catch (error) {
        for (const secret of secrets) error.message = error.message.split(secret).join("[redacted]");
        lastError = error;
        creativeRouteChecks.set(routeKey, { ok: false, checkedAt: Date.now() });
        if (options.signal?.aborted) throw error;
        if (structured && [400, 422].includes(error.statusCode) && !isGatewayModelError(error)) continue;
        if (error.retryable || isGatewayModelError(error)) markGatewayModelUnavailable(model, error.traceId);
        // A connection/auth failure affects both GPT models on the same host.
        if (config.backup?.apiKey && (CREATIVE_CONNECTION_ERRORS.has(error.errorCode) || [401, 403].includes(error.statusCode))) {
          failedHosts.add(route.baseUrl);
          creativeHostCooldowns.set(route.baseUrl, Date.now() + CREATIVE_HOST_COOLDOWN_MS);
        }
        break;
      }
      const { response, data, attempts, traceId } = gatewayResult;
      if (data?.status && data.status !== "completed") {
        lastError = Object.assign(new Error("创意提示词输出未完成，请缩短输入后重试。"), { statusCode: 502, errorCode: "GATEWAY_INCOMPLETE_OUTPUT", traceId, retryable: true });
        creativeRouteChecks.set(routeKey, { ok: false, checkedAt: Date.now() });
        markGatewayModelUnavailable(model, traceId);
        break;
      }
      try {
        const result = validateCreativePromptResult(parseModelJson(extractOutputText(data)));
        gatewayModelCooldowns.delete(model);
        creativeHostCooldowns.delete(route.baseUrl);
        creativeRouteChecks.set(routeKey, { ok: true, checkedAt: Date.now() });
        return {
          result,
          model,
          provider: route.provider,
          fallbackUsed,
          requestId: response.headers.get("x-request-id") || data?.id || null,
          attempts,
          traceId,
        };
      } catch (error) {
        lastError = Object.assign(new Error(`创意提示词返回结构不完整：${error.message}`), { statusCode: 502, errorCode: "GATEWAY_INVALID_OUTPUT", traceId, retryable: true });
        for (const secret of secrets) lastError.message = lastError.message.split(secret).join("[redacted]");
        creativeRouteChecks.set(routeKey, { ok: false, checkedAt: Date.now() });
        if (structured) continue;
        markGatewayModelUnavailable(model, traceId);
      }
    }
  }
  throw lastError;
}

function formatSeconds(value) {
  const seconds = Math.max(0, Number(value) || 0);
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds - minutes * 60;
  return `${String(minutes).padStart(2, "0")}:${remainder.toFixed(1).padStart(4, "0")}`;
}

function parseRatio(value) {
  const [width, height] = String(value || "").split(":").map(Number);
  return width > 0 && height > 0 ? `${width}:${height}` : "unknown";
}

function buildVideoWorkDir() {
  if (fs.existsSync(VIDEO_JOB_DIR)) {
    const cutoff = Date.now() - 24 * 60 * 60 * 1000;
    for (const entry of fs.readdirSync(VIDEO_JOB_DIR, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const jobPath = path.join(VIDEO_JOB_DIR, entry.name);
      try {
        if (fs.statSync(jobPath).mtimeMs < cutoff) fs.rmSync(jobPath, { recursive: true, force: true });
      } catch { /* another request may already be cleaning this job */ }
    }
  }
  const id = `${Date.now()}-${crypto.randomBytes(4).toString("hex")}`;
  const dir = path.join(VIDEO_JOB_DIR, id);
  fs.mkdirSync(path.join(dir, "frames"), { recursive: true });
  return { id, dir, frameDir: path.join(dir, "frames") };
}

async function probeVideo(videoPath) {
  const { stdout } = await execFileAsync(FFPROBE_PATH, [
    "-v", "error", "-show_format", "-show_streams", "-of", "json", videoPath,
  ], { maxBuffer: 2 * 1024 * 1024, timeout: 30000 });
  const probe = JSON.parse(stdout);
  const videoStream = (probe.streams || []).find((stream) => stream.codec_type === "video" && stream.disposition?.attached_pic !== 1);
  if (!videoStream) throw Object.assign(new Error("没有检测到可分析的视频流。"), { statusCode: 415 });
  const duration = Number(probe.format?.duration || videoStream.duration || 0);
  if (!Number.isFinite(duration) || duration <= 0) throw Object.assign(new Error("无法读取视频时长。"), { statusCode: 422 });
  if (duration > MAX_ANALYSIS_SECONDS) throw Object.assign(new Error("首版拉片分析支持 5 分钟以内的视频。"), { statusCode: 413 });
  const hasAudio = (probe.streams || []).some((stream) => stream.codec_type === "audio");
  return {
    duration,
    durationLabel: formatSeconds(duration),
    width: Number(videoStream.width || 0),
    height: Number(videoStream.height || 0),
    fps: videoStream.avg_frame_rate || videoStream.r_frame_rate || "unknown",
    codec: videoStream.codec_name || "unknown",
    aspectRatio: parseRatio(videoStream.width && videoStream.height ? `${videoStream.width}:${videoStream.height}` : ""),
    hasAudio,
  };
}

function parseSceneTimestamps(text, duration) {
  const timestamps = [];
  for (const line of String(text || "").split(/\r?\n/)) {
    const match = line.match(/pts_time:([0-9.]+)/);
    if (match) timestamps.push(Number(match[1]));
  }
  const deduped = [...new Set(timestamps.filter((value) => Number.isFinite(value) && value >= 0 && value <= duration))];
  return deduped.sort((a, b) => a - b);
}

function buildFrameTimes(duration, sceneTimes = []) {
  const maxFrames = 6;
  const times = new Set([0, Number(Math.max(0, duration - 0.2).toFixed(2))]);
  const validScenes = sceneTimes.filter((time) => Number.isFinite(time) && time > 0 && time < duration);
  const sceneBudget = Math.min(maxFrames - 2, validScenes.length);
  for (let index = 0; index < sceneBudget; index += 1) {
    const sourceIndex = Math.round((index * (validScenes.length - 1)) / Math.max(1, sceneBudget - 1));
    times.add(Number(validScenes[sourceIndex].toFixed(2)));
  }
  for (let index = 1; times.size < maxFrames && index < maxFrames * 2; index += 1) {
    times.add(Number(((duration * index) / (maxFrames - 1)).toFixed(2)));
  }
  return [...times].filter((time) => time <= duration).sort((a, b) => a - b).slice(0, maxFrames);
}

async function detectScenes(videoPath, duration) {
  try {
    const { stderr } = await execFileAsync(FFMPEG_PATH, [
      "-hide_banner", "-i", videoPath, "-vf", "select='gt(scene,0.28)',showinfo", "-f", "null", "-",
    ], { maxBuffer: 4 * 1024 * 1024, timeout: 90000 });
    return parseSceneTimestamps(stderr, duration);
  } catch {
    return [];
  }
}

async function extractVideoFrames(videoPath, frameDir, times) {
  const frames = [];
  for (let index = 0; index < times.length; index += 1) {
    const time = times[index];
    const filename = `frame-${String(index + 1).padStart(2, "0")}.jpg`;
    const output = path.join(frameDir, filename);
    await execFileAsync(FFMPEG_PATH, [
      "-y", "-hide_banner", "-loglevel", "error", "-ss", String(time), "-i", videoPath,
      "-frames:v", "1", "-vf", "scale=720:-2", "-q:v", "4", output,
    ], { timeout: 45000 });
    frames.push({ time, timeLabel: formatSeconds(time), filename, path: output });
  }
  return frames;
}

async function analyzeAudioSignals(videoPath, hasAudio) {
  if (!hasAudio) return { hasAudio: false, meanVolume: null, maxVolume: null, silence: [] };
  try {
    const { stderr } = await execFileAsync(FFMPEG_PATH, [
      "-hide_banner", "-i", videoPath, "-af", "volumedetect,silencedetect=noise=-30dB:d=0.45", "-f", "null", "-",
    ], { maxBuffer: 2 * 1024 * 1024, timeout: 90000 });
    const mean = stderr.match(/mean_volume:\s*(-?[0-9.]+) dB/);
    const max = stderr.match(/max_volume:\s*(-?[0-9.]+) dB/);
    const silence = [...stderr.matchAll(/silence_start:\s*([0-9.]+)/g)].map((match) => Number(match[1]));
    return {
      hasAudio: true,
      meanVolume: mean ? Number(mean[1]) : null,
      maxVolume: max ? Number(max[1]) : null,
      silence: silence.slice(0, 12).map((start) => formatSeconds(start)),
    };
  } catch {
    return { hasAudio: true, meanVolume: null, maxVolume: null, silence: [] };
  }
}

function dataUrlFromFile(filePath) {
  return `data:image/jpeg;base64,${fs.readFileSync(filePath).toString("base64")}`;
}

function buildVideoAnalysisPayload(input, model, frames, structured = true, reasoningEffort = DEFAULT_REASONING_EFFORT) {
  const content = [{ type: "input_text", text: [
    "你是一名广告导演、剪辑师、品牌策略师和 VLM 视频分析专家。",
    "下面是一段视频的代表帧序列，帧按时间顺序排列。请把它当作一条广告进行拉片，不要只描述静态图片。",
    `视频信息：时长 ${input.metadata.durationLabel}，画幅 ${input.metadata.width}x${input.metadata.height}（${input.metadata.aspectRatio}），编码 ${input.metadata.codec}，音频 ${input.metadata.hasAudio ? "有" : "无"}。`,
    `场景变化候选时间：${input.sceneTimes.length ? input.sceneTimes.map(formatSeconds).join("、") : "未检测到明显硬切，请根据帧内容判断"}。`,
    `技术音频信号：${JSON.stringify(input.audioSignals)}。`,
    `用户关注点：${input.focus || "完整广告拉片，重点关注创意、节奏、产品露出、镜头语言、声音和可复刻方法"}`,
    "请以相邻帧之间的变化为依据推断镜头段落、动作、运镜和节奏。无法确认的台词、品牌或文字必须标记为不确定，不要臆造。",
    "输出要能够直接指导团队复刻一条同结构广告，并能转为生图/生视频提示词。",
  ].join("\n") }];
  for (const frame of frames) content.push({ type: "input_text", text: `帧 ${frame.index} · ${frame.timeLabel}` }, { type: "input_image", image_url: dataUrlFromFile(frame.path), detail: "low" });
  const payload = {
    model,
    instructions: [
      "输出中文结构化广告拉片报告。镜头列表必须覆盖从 0 秒到视频结束的主要时间段，并按时间顺序。",
      "镜头级内容用紧凑字段表达：visual 写可见画面，action 写主体动作，camera 合并景别/运镜/转场，audioText 合并声音/台词/屏幕文字，role 合并产品品牌露出、叙事作用与有效原因。",
      "宏观层面拆解 3 秒 Hook、冲突或信息递进、产品价值证明、CTA/收束；没有对应内容时明确写‘未识别’。",
      "复刻方案必须给出可执行的创意母题、镜头模板、提示词、负面提示词和最小制作单元。",
      "每个字段用一句紧凑但具体的话完成，避免同义重复；输出 4-8 个镜头，以代表帧和明显场景变化覆盖叙事，不要把无法观察到的间隔臆造为新镜头。",
      "所有解释使用中文；不要输出 Markdown 代码块。",
    ].join("\n"),
    input: [{ role: "user", content }],
    reasoning: { effort: reasoningEffort },
    max_output_tokens: 2400,
  };
  if (structured) {
    payload.text = { format: { type: "json_schema", name: "advert_video_teardown", strict: true, schema: VIDEO_ANALYSIS_SCHEMA } };
  } else {
    payload.input[0].content[0].text += `\n仅返回 JSON：${JSON.stringify(VIDEO_ANALYSIS_SCHEMA)}`;
  }
  return payload;
}

function validateVideoAnalysisResult(result, metadata) {
  if (!result || typeof result !== "object" || !Array.isArray(result.shots) || !result.adStructure) {
    throw new Error("模型返回的拉片报告不完整。");
  }
  result.shots = result.shots.slice(0, 8).map((shot, index) => {
    const start = Math.max(0, Math.min(metadata.duration, Number(shot.start) || 0));
    const end = Math.max(start, Math.min(metadata.duration, Number(shot.end) || start));
    const role = cleanText(shot.role || shot.productRole, 600) || "未识别";
    const camera = cleanText(shot.camera, 600) || "抽帧无法确认";
    const audioText = cleanText(shot.audioText || shot.audio, 800) || "未识别";
    return {
      ...shot,
      id: cleanText(shot.id, 30) || `S${String(index + 1).padStart(2, "0")}`,
      start,
      end,
      duration: Number(Math.max(0, end - start).toFixed(2)),
      frameIndex: Math.max(1, Number.parseInt(shot.frameIndex, 10) || index + 1),
      shotSize: cleanText(shot.shotSize, 120) || camera,
      camera,
      movement: cleanText(shot.movement, 300) || camera,
      visual: cleanText(shot.visual, 1000) || "未识别",
      action: cleanText(shot.action, 800) || "未识别",
      onScreenText: cleanText(shot.onScreenText, 500) || audioText,
      audio: audioText,
      productRole: cleanText(shot.productRole, 600) || role,
      transition: cleanText(shot.transition, 300) || (index === 0 ? "开场" : "抽帧无法确认"),
      whyItWorks: cleanText(shot.whyItWorks, 600) || role,
      prompt: cleanText(shot.prompt, 1400) || "未生成",
    };
  }).sort((a, b) => a.start - b.start);
  for (const key of ["visualSystem", "audioSystem", "replicationPlan", "risks"]) {
    result[key] = Array.isArray(result[key]) ? result[key].slice(0, key === "replicationPlan" ? 10 : 8) : [];
  }
  return result;
}

async function callVideoAnalysisGateway(input, frames) {
  const config = getGatewayConfig();
  if (!config.apiKey) throw Object.assign(new Error("服务端未配置 GPT-5.6 API Key。"), { statusCode: 503 });
  const endpoint = `${config.baseUrl}/responses`;
  const reasoningEffort = process.env.ATELIER_VLM_REASONING_EFFORT || "low";
  let lastError;
  for (const model of gatewayModelCandidates(config)) {
    const fallbackUsed = model !== config.model;
    for (const structured of [true, false]) {
      let gatewayResult;
      try {
        gatewayResult = await requestGatewayResponse(endpoint, buildVideoAnalysisPayload(input, model, frames, structured, reasoningEffort), {
          headers: { Authorization: `Bearer ${config.apiKey}`, "Content-Type": "application/json" },
          operation: `VLM 拉片 (${model})`,
          timeoutMs: fallbackUsed ? VLM_TIMEOUT_MS : PRIMARY_VLM_TIMEOUT_MS,
          maxAttempts: fallbackUsed ? Math.max(1, GATEWAY_MAX_ATTEMPTS - 1) : 1,
        });
      } catch (error) {
        lastError = error;
        if (structured && [400, 422].includes(error.statusCode) && !isGatewayModelError(error)) continue;
        if (error.retryable || isGatewayModelError(error)) markGatewayModelUnavailable(model, error.traceId);
        break;
      }
      const { response, data, attempts, traceId } = gatewayResult;
      try {
        gatewayModelCooldowns.delete(model);
        return {
          result: validateVideoAnalysisResult(parseModelJson(extractOutputText(data)), input.metadata),
          model,
          fallbackUsed,
          reasoningEffort,
          requestId: response.headers.get("x-request-id") || data?.id || null,
          attempts,
          traceId,
        };
      } catch (error) {
        lastError = Object.assign(new Error(`VLM 返回结构不完整：${error.message}`), { statusCode: 502, errorCode: "GATEWAY_INVALID_OUTPUT", traceId, retryable: true });
        console.warn(`[gateway] ${traceId} VLM 拉片 invalid_output model=${model} structured=${structured}`);
        if (structured) continue;
        markGatewayModelUnavailable(model, traceId);
      }
    }
  }
  throw lastError;
}

function videoExtension(contentType, fallbackName = "") {
  const byType = {
    "video/mp4": ".mp4",
    "video/quicktime": ".mov",
    "video/webm": ".webm",
    "video/x-matroska": ".mkv",
  };
  if (byType[contentType]) return byType[contentType];
  const extension = path.extname(fallbackName).toLowerCase();
  return [".mp4", ".mov", ".webm", ".mkv"].includes(extension) ? extension : ".mp4";
}

function safeHeaderValue(value, maxLength = 500) {
  try { return cleanText(decodeURIComponent(String(value || "")), maxLength); }
  catch { return cleanText(value, maxLength); }
}

function writeRequestToFile(req, filePath) {
  return new Promise((resolve, reject) => {
    const output = fs.createWriteStream(filePath, { flags: "wx" });
    let size = 0;
    let tooLarge = false;
    let settled = false;
    const fail = (error) => {
      if (settled) return;
      settled = true;
      output.destroy();
      fs.rm(filePath, { force: true }, () => reject(error));
    };
    output.on("error", fail);
    req.on("error", fail);
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > MAX_VIDEO_BYTES) {
        tooLarge = true;
        return;
      }
      if (!tooLarge && !output.write(chunk)) req.pause(), output.once("drain", () => req.resume());
    });
    req.on("end", () => {
      if (tooLarge) {
        fail(Object.assign(new Error("视频不能超过 250MB。"), { statusCode: 413 }));
        return;
      }
      output.end(() => {
        if (settled) return;
        settled = true;
        if (!size) {
          fs.rm(filePath, { force: true }, () => reject(Object.assign(new Error("上传的视频为空。"), { statusCode: 400 })));
          return;
        }
        resolve(size);
      });
    });
  });
}

async function writeRemoteVideoResponse(response, filePath) {
  const reader = response.body?.getReader();
  if (!reader) throw Object.assign(new Error("视频服务器没有返回内容。"), { statusCode: 502 });
  const output = fs.createWriteStream(filePath, { flags: "wx" });
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_VIDEO_BYTES) {
        await reader.cancel();
        throw Object.assign(new Error("链接视频不能超过 250MB。"), { statusCode: 413 });
      }
      if (!output.write(Buffer.from(value))) await new Promise((resolve) => output.once("drain", resolve));
    }
    await new Promise((resolve, reject) => output.end((error) => error ? reject(error) : resolve()));
    if (!size) throw Object.assign(new Error("视频链接返回了空文件。"), { statusCode: 422 });
    return size;
  } catch (error) {
    output.destroy();
    await fs.promises.rm(filePath, { force: true });
    throw error;
  }
}

function normalizeRemoteVideoUrl(value) {
  const raw = cleanText(value, 2048);
  if (!raw) throw Object.assign(new Error("请输入公开视频直链。"), { statusCode: 400 });
  let url;
  try { url = new URL(raw); } catch { throw Object.assign(new Error("视频链接格式无效。"), { statusCode: 400 }); }
  if (!['http:', 'https:'].includes(url.protocol)) throw Object.assign(new Error("视频链接仅支持 HTTP 或 HTTPS。"), { statusCode: 400 });
  if (url.username || url.password) throw Object.assign(new Error("视频链接不能包含账号或密码。"), { statusCode: 400 });
  url.hash = "";
  return url;
}

async function downloadRemoteVideo(value, work, options = {}) {
  const fetchImpl = options.fetchImpl || fetch;
  const lookup = options.lookup || dns.lookup;
  let url = normalizeRemoteVideoUrl(value);
  for (let redirects = 0; redirects <= MAX_REMOTE_REDIRECTS; redirects += 1) {
    await assertPublicRemoteUrl(url, lookup, "视频");
    let response;
    try {
      response = await fetchImpl(url, {
        redirect: "manual",
        headers: { Accept: "video/mp4,video/quicktime,video/webm,video/x-matroska" },
        signal: AbortSignal.timeout(120000),
      });
    } catch (error) {
      const message = error.name === "TimeoutError" ? "视频链接响应超时。" : "无法访问视频链接，请确认它是公开直链。";
      throw Object.assign(new Error(message), { statusCode: 502 });
    }
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get("location");
      if (!location || redirects === MAX_REMOTE_REDIRECTS) throw Object.assign(new Error("视频链接重定向次数过多。"), { statusCode: 400 });
      url = normalizeRemoteVideoUrl(new URL(location, url).href);
      continue;
    }
    if (!response.ok) throw Object.assign(new Error(`视频链接访问失败（HTTP ${response.status}）。`), { statusCode: 502 });
    const contentType = (response.headers.get("content-type") || "").split(";")[0].trim().toLowerCase();
    const extension = videoExtension(contentType, url.pathname);
    if (!REMOTE_VIDEO_TYPES.has(contentType) && contentType !== "application/octet-stream") {
      throw Object.assign(new Error("链接返回的不是受支持的视频文件。"), { statusCode: 415 });
    }
    const declaredSize = Number(response.headers.get("content-length") || 0);
    if (declaredSize > MAX_VIDEO_BYTES) throw Object.assign(new Error("链接视频不能超过 250MB。"), { statusCode: 413 });
    const filePath = path.join(work.dir, `source${extension}`);
    await writeRemoteVideoResponse(response, filePath);
    return { filePath, fileName: path.basename(url.pathname) || `remote${extension}`, finalUrl: url.href };
  }
  throw Object.assign(new Error("视频链接重定向次数过多。"), { statusCode: 400 });
}

async function analyzeVideoFile(videoPath, work, details = {}) {
  const metadata = await probeVideo(videoPath);
  const [sceneTimes, audioSignals] = await Promise.all([
    detectScenes(videoPath, metadata.duration),
    analyzeAudioSignals(videoPath, metadata.hasAudio),
  ]);
  const frameTimes = buildFrameTimes(metadata.duration, sceneTimes);
  const extracted = await extractVideoFrames(videoPath, work.frameDir, frameTimes);
  const frames = extracted.map((frame, index) => ({ ...frame, index: index + 1 }));
  if (!frames.length) throw Object.assign(new Error("未能从视频中提取关键帧。"), { statusCode: 422 });
  const analysis = await callVideoAnalysisGateway({ metadata, sceneTimes, audioSignals, focus: cleanText(details.focus, 1500) }, frames);
  return {
    ...analysis,
    jobId: work.id,
    fileName: cleanText(details.fileName, 240) || "video",
    sourceUrl: details.sourceUrl || null,
    videoProfile: metadata,
    sceneTimes,
    audioSignals,
    frames: frames.map(({ index, time, timeLabel, filename }) => ({
      index,
      time,
      timeLabel,
      url: `/api/video/frame/${work.id}/${filename}`,
    })),
    generatedAt: new Date().toISOString(),
  };
}

function getViduConfig() {
  return {
    apiKey: process.env.VIDU_API_KEY || "",
    baseUrl: (process.env.VIDU_BASE_URL || "https://api.vidu.cn").replace(/\/$/, ""),
  };
}

function readImageDimensions(buffer, subtype) {
  if (subtype === "png" && buffer.length >= 24 && buffer.toString("ascii", 1, 4) === "PNG") {
    return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
  }
  if (["jpg", "jpeg"].includes(subtype) && buffer.length >= 12 && buffer[0] === 0xff && buffer[1] === 0xd8) {
    let offset = 2;
    const sofMarkers = new Set([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf]);
    while (offset + 8 < buffer.length) {
      if (buffer[offset] !== 0xff) { offset += 1; continue; }
      const marker = buffer[offset + 1];
      if (marker === 0xd8 || marker === 0xd9) { offset += 2; continue; }
      const length = buffer.readUInt16BE(offset + 2);
      if (sofMarkers.has(marker)) return { width: buffer.readUInt16BE(offset + 7), height: buffer.readUInt16BE(offset + 5) };
      if (length < 2) break;
      offset += length + 2;
    }
  }
  if (subtype === "webp" && buffer.length >= 30 && buffer.toString("ascii", 0, 4) === "RIFF" && buffer.toString("ascii", 8, 12) === "WEBP") {
    const chunk = buffer.toString("ascii", 12, 16);
    if (chunk === "VP8X") return { width: 1 + buffer.readUIntLE(24, 3), height: 1 + buffer.readUIntLE(27, 3) };
    if (chunk === "VP8 " && buffer.length >= 30) return { width: buffer.readUInt16LE(26) & 0x3fff, height: buffer.readUInt16LE(28) & 0x3fff };
    if (chunk === "VP8L" && buffer.length >= 25) {
      const b1 = buffer[21], b2 = buffer[22], b3 = buffer[23], b4 = buffer[24];
      return { width: 1 + b1 + ((b2 & 0x3f) << 8), height: 1 + ((b2 & 0xc0) >> 6) + (b3 << 2) + ((b4 & 0x0f) << 10) };
    }
  }
  throw Object.assign(new Error("无法读取首帧图片尺寸，请重新导出 PNG、JPG 或 WebP。"), { statusCode: 422 });
}

function validateViduImageBuffer(buffer, subtype) {
  const dimensions = readImageDimensions(buffer, subtype);
  const { width, height } = dimensions;
  if (width < 256 || height < 256 || width > 5760 || height > 5760) {
    throw Object.assign(new Error("首帧宽高必须在 256–5760 像素之间。"), { statusCode: 400 });
  }
  const ratio = width / height;
  if (ratio < 0.4 || ratio > 2.5) throw Object.assign(new Error("首帧宽高比必须在 0.4–2.5 之间。"), { statusCode: 400 });
  return dimensions;
}

function normalizeViduCreateRequest(body) {
  if (!body || typeof body !== "object") throw Object.assign(new Error("请求内容不能为空。"), { statusCode: 400 });
  const model = cleanText(body.model, 30);
  if (!["viduq4", "viduq3.1-ad"].includes(model)) throw Object.assign(new Error("仅支持 Vidu Q4 和 Vidu Q3.1-ad。"), { statusCode: 400 });
  const imageDataUrl = cleanText(body.imageDataUrl, MAX_BODY_BYTES);
  const imageUrl = cleanText(body.imageUrl, 2048);
  let image;
  if (imageDataUrl) {
    const match = imageDataUrl.match(/^data:image\/(png|jpe?g|webp);base64,([a-zA-Z0-9+/=]+)$/);
    if (!match) throw Object.assign(new Error("首帧仅支持 PNG、JPG 或 WebP。"), { statusCode: 400 });
    const estimatedBytes = Math.floor((match[2].length * 3) / 4);
    if (estimatedBytes > MAX_IMAGE_BYTES) throw Object.assign(new Error("首帧图片不能超过 12MB。"), { statusCode: 413 });
    validateViduImageBuffer(Buffer.from(match[2], "base64"), match[1].toLowerCase().replace("jpeg", "jpg"));
    image = imageDataUrl;
  } else if (imageUrl) {
    image = normalizeRemoteImageUrl(imageUrl).href;
  } else {
    throw Object.assign(new Error("请先选择一张首帧图片。"), { statusCode: 400 });
  }
  const promptLimit = model === "viduq4" ? 5000 : 7000;
  const prompt = cleanText(body.prompt, promptLimit);
  const duration = Number(body.duration);
  // The live Q4 endpoint currently rejects 1-4s even though the supplied draft documents 1-16s.
  const minDuration = model === "viduq4" ? 5 : 4;
  const maxDuration = model === "viduq4" ? 16 : 15;
  if (!Number.isInteger(duration) || duration < minDuration || duration > maxDuration) {
    throw Object.assign(new Error(`${model === "viduq4" ? "Q4" : "Q3.1-ad"} 时长须为 ${minDuration}-${maxDuration} 秒整数。`), { statusCode: 400 });
  }
  const resolutions = model === "viduq4" ? ["540p", "720p", "1080p", "2K", "4K"] : ["540p", "720p", "1080p", "2K"];
  const resolution = resolutions.includes(body.resolution) ? body.resolution : "720p";
  const seed = Number.isInteger(Number(body.seed)) ? Number(body.seed) : 0;
  const audio = model === "viduq4" && body.audio === true;
  const offPeak = body.offPeak === true && !audio;
  return { model, image, imageIsRemote: Boolean(imageUrl), prompt, duration, resolution, seed, audio, offPeak, watermark: body.watermark === true };
}

function buildViduPayload(input) {
  const payload = {
    model: input.model,
    images: [input.image],
    prompt: input.prompt,
    duration: input.duration,
    seed: input.seed,
    resolution: input.resolution,
    off_peak: input.offPeak,
    watermark: input.watermark,
  };
  if (input.model === "viduq4") payload.audio = input.audio;
  return payload;
}

const VIDU_IMAGE_RATIOS = new Set(["9:16", "2:3", "3:4", "4:5", "1:1", "5:4", "4:3", "3:2", "16:9", "21:9", "9:21", "1:2", "2:1"]);
const VIDU_IMAGE_RESOLUTIONS = new Set(["1K", "2K", "4K"]);
const VIDU_IMAGE_QUALITIES = new Set(["auto", "low", "medium", "high"]);

function normalizeViduImageCreateRequest(body) {
  if (!body || typeof body !== "object") throw Object.assign(new Error("请求内容不能为空。"), { statusCode: 400 });
  const model = cleanText(body.model, 30) || "viduimage-2";
  if (model !== "viduimage-2") throw Object.assign(new Error("当前想法成片仅支持 viduimage-2。"), { statusCode: 400 });
  const prompt = cleanText(body.prompt, 12000);
  if (!prompt) throw Object.assign(new Error("请先描述要生成的关键帧。"), { statusCode: 400 });
  const aspectRatio = cleanText(body.aspectRatio || body.aspect_ratio, 10) || "9:16";
  if (!VIDU_IMAGE_RATIOS.has(aspectRatio)) throw Object.assign(new Error("viduimage-2 不支持该图片比例。"), { statusCode: 400 });
  const resolution = cleanText(body.resolution, 10) || "1K";
  if (!VIDU_IMAGE_RESOLUTIONS.has(resolution)) throw Object.assign(new Error("当前线上 viduimage-2 分辨率仅支持 1K、2K 或 4K。"), { statusCode: 400 });
  const quality = cleanText(body.quality, 10) || "auto";
  if (!VIDU_IMAGE_QUALITIES.has(quality)) throw Object.assign(new Error("viduimage-2 质量仅支持 auto、low、medium 或 high。"), { statusCode: 400 });
  return { model, prompt, aspectRatio, resolution, quality };
}

function buildViduImagePayload(input) {
  return {
    model: input.model,
    images: [],
    prompt: input.prompt,
    aspect_ratio: input.aspectRatio,
    resolution: input.resolution,
    quality: input.quality,
  };
}

function normalizeViduTask(data, fallbackModel = "") {
  const state = cleanText(data?.state || data?.status, 30) || "created";
  const creations = Array.isArray(data?.creations) ? data.creations.map((creation) => ({
    id: creation.id || null,
    url: creation.url || null,
    coverUrl: creation.cover_url || null,
    watermarkedUrl: creation.watermarked_url || null,
  })) : [];
  return {
    taskId: data?.task_id || data?.id || null,
    state,
    model: data?.model || fallbackModel || null,
    credits: Number.isFinite(Number(data?.credits)) ? Number(data.credits) : null,
    errorCode: data?.err_code || null,
    creations,
    createdAt: data?.created_at || null,
  };
}

async function requestVidu(pathname, options = {}) {
  const config = getViduConfig();
  if (!config.apiKey) throw Object.assign(new Error("服务端未配置 VIDU_API_KEY。"), { statusCode: 503 });
  const response = await fetch(`${config.baseUrl}${pathname}`, {
    ...options,
    headers: { Authorization: `Token ${config.apiKey}`, "Content-Type": "application/json", ...(options.headers || {}) },
    signal: AbortSignal.timeout(60000),
  });
  const raw = await response.text();
  let data;
  try { data = JSON.parse(raw); } catch { data = null; }
  if (!response.ok) {
    const field = data?.metadata?.fields ? `（字段：${data.metadata.fields}）` : "";
    const message = `${data?.message || data?.error?.message || data?.detail || raw.slice(0, 500) || `Vidu 请求失败（HTTP ${response.status}）`}${field}`;
    throw Object.assign(new Error(message), { statusCode: response.status >= 500 ? 502 : response.status });
  }
  if (!data || typeof data !== "object") throw Object.assign(new Error("Vidu 返回了无法解析的响应。"), { statusCode: 502 });
  return data;
}

async function createViduTask(body) {
  const input = normalizeViduCreateRequest(body);
  if (input.imageIsRemote) {
    const remote = await fetchRemoteImage(input.image);
    const subtype = remote.contentType.split("/")[1].replace("jpeg", "jpg");
    validateViduImageBuffer(remote.buffer, subtype);
    input.image = `data:${remote.contentType};base64,${remote.buffer.toString("base64")}`;
  }
  const data = await requestVidu("/ent/v2/img2video", { method: "POST", body: JSON.stringify(buildViduPayload(input)) });
  const task = normalizeViduTask(data, input.model);
  if (!task.taskId) throw Object.assign(new Error("Vidu 创建任务成功，但未返回 task_id。"), { statusCode: 502 });
  return task;
}

async function createViduImageTask(body) {
  const input = normalizeViduImageCreateRequest(body);
  const data = await requestVidu("/ent/v2/reference2image", { method: "POST", body: JSON.stringify(buildViduImagePayload(input)) });
  const task = normalizeViduTask(data, input.model);
  if (!task.taskId) throw Object.assign(new Error("Vidu 创建生图任务成功，但未返回 task_id。"), { statusCode: 502 });
  return { ...task, provider: "vidu", kind: "image" };
}

async function getViduTask(taskId) {
  const id = cleanText(taskId, 200);
  if (!/^[a-zA-Z0-9_-]+$/.test(id)) throw Object.assign(new Error("任务 ID 格式无效。"), { statusCode: 400 });
  return normalizeViduTask(await requestVidu(`/ent/v2/tasks/${encodeURIComponent(id)}/creations`));
}

async function getViduImageTask(taskId) {
  return { ...(await getViduTask(taskId)), provider: "vidu", kind: "image" };
}

function normalizeRemoteImageUrl(value) {
  const raw = cleanText(value, 2048);
  if (!raw) throw Object.assign(new Error("请输入图片链接。"), { statusCode: 400 });
  let url;
  try { url = new URL(raw); } catch { throw Object.assign(new Error("图片链接格式无效。"), { statusCode: 400 }); }
  if (!["http:", "https:"].includes(url.protocol)) throw Object.assign(new Error("图片链接仅支持 HTTP 或 HTTPS。"), { statusCode: 400 });
  if (url.username || url.password) throw Object.assign(new Error("图片链接不能包含账号或密码。"), { statusCode: 400 });
  url.hash = "";
  return url;
}

function isPrivateAddress(address) {
  const normalized = String(address || "").toLowerCase().split("%")[0];
  if (net.isIPv4(normalized)) {
    const [a, b] = normalized.split(".").map(Number);
    return a === 0 || a === 10 || a === 127 || (a === 169 && b === 254)
      || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168)
      || (a === 100 && b >= 64 && b <= 127) || a >= 224;
  }
  if (net.isIPv6(normalized)) {
    if (normalized === "::" || normalized === "::1") return true;
    const mapped = normalized.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    if (mapped) return isPrivateAddress(mapped[1]);
    return normalized.startsWith("fc") || normalized.startsWith("fd") || /^fe[89ab]/.test(normalized);
  }
  return true;
}

async function assertPublicRemoteUrl(url, lookup = dns.lookup, resourceLabel = "图片") {
  const hostname = url.hostname.toLowerCase();
  if (hostname === "localhost" || hostname.endsWith(".localhost") || hostname.endsWith(".local")) {
    throw Object.assign(new Error(`出于安全原因，不支持本机或内网${resourceLabel}链接。`), { statusCode: 400 });
  }
  const records = net.isIP(hostname) ? [{ address: hostname }] : await lookup(hostname, { all: true, verbatim: true });
  if (!records.length || records.some((record) => isPrivateAddress(record.address))) {
    throw Object.assign(new Error(`出于安全原因，不支持本机或内网${resourceLabel}链接。`), { statusCode: 400 });
  }
}

async function readLimitedResponse(response) {
  const reader = response.body?.getReader();
  if (!reader) throw new Error("图片服务器没有返回内容。");
  const chunks = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_IMAGE_BYTES) {
      await reader.cancel();
      throw Object.assign(new Error("链接图片不能超过 12MB。"), { statusCode: 413 });
    }
    chunks.push(Buffer.from(value));
  }
  return Buffer.concat(chunks, size);
}

async function fetchRemoteImage(value, options = {}) {
  const fetchImpl = options.fetchImpl || fetch;
  const lookup = options.lookup || dns.lookup;
  let url = normalizeRemoteImageUrl(value);
  for (let redirects = 0; redirects <= MAX_REMOTE_REDIRECTS; redirects += 1) {
    await assertPublicRemoteUrl(url, lookup);
    let response;
    try {
      response = await fetchImpl(url, {
        redirect: "manual",
        headers: { Accept: "image/png,image/jpeg,image/webp,image/gif" },
        signal: AbortSignal.timeout(REMOTE_IMAGE_TIMEOUT_MS),
      });
    } catch (error) {
      const message = error.name === "TimeoutError" ? "图片链接响应超时。" : "无法访问图片链接，请确认地址公开可访问。";
      throw Object.assign(new Error(message), { statusCode: 502 });
    }
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get("location");
      if (!location || redirects === MAX_REMOTE_REDIRECTS) throw Object.assign(new Error("图片链接重定向次数过多。"), { statusCode: 400 });
      url = normalizeRemoteImageUrl(new URL(location, url).href);
      continue;
    }
    if (!response.ok) throw Object.assign(new Error(`图片链接访问失败（HTTP ${response.status}）。`), { statusCode: 502 });
    const contentType = (response.headers.get("content-type") || "").split(";")[0].trim().toLowerCase();
    if (!REMOTE_IMAGE_TYPES.has(contentType)) throw Object.assign(new Error("链接返回的不是受支持的图片。"), { statusCode: 415 });
    const declaredSize = Number(response.headers.get("content-length") || 0);
    if (declaredSize > MAX_IMAGE_BYTES) throw Object.assign(new Error("链接图片不能超过 12MB。"), { statusCode: 413 });
    const buffer = await readLimitedResponse(response);
    if (!buffer.length) throw Object.assign(new Error("图片链接返回了空文件。"), { statusCode: 422 });
    return { buffer, contentType, finalUrl: url.href };
  }
  throw Object.assign(new Error("图片链接重定向次数过多。"), { statusCode: 400 });
}

function sendJson(res, statusCode, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body),
    "Cache-Control": "no-store",
  });
  res.end(body);
}

function publicErrorPayload(error, fallbackMessage) {
  return {
    error: error?.message || fallbackMessage,
    errorCode: error?.errorCode || null,
    traceId: error?.traceId || null,
    retryable: Boolean(error?.retryable),
  };
}

function cleanupAgentJobs(store = agentJobs, now = Date.now()) {
  for (const [jobId, job] of store) {
    if (job.finishedAtMs && now - job.finishedAtMs >= AGENT_JOB_TTL_MS) store.delete(jobId);
  }
  if (store.size < MAX_AGENT_JOBS) return;
  const finished = [...store.values()]
    .filter((job) => job.finishedAtMs)
    .sort((a, b) => a.finishedAtMs - b.finishedAtMs);
  while (store.size >= MAX_AGENT_JOBS && finished.length) store.delete(finished.shift().jobId);
}

function agentJobSnapshot(job) {
  const snapshot = {
    jobId: job.jobId,
    status: job.status,
    createdAt: job.createdAt,
    startedAt: job.startedAt,
    finishedAt: job.finishedAt || null,
  };
  if (job.status === "succeeded") Object.assign(snapshot, job.output);
  if (job.status === "failed") Object.assign(snapshot, job.error);
  return snapshot;
}

function createAgentJob(input, options = {}) {
  const store = options.store || agentJobs;
  const clock = options.clock || Date.now;
  const runAgent = options.runAgent || callGateway;
  const now = clock();
  cleanupAgentJobs(store, now);
  const clientRequestId = cleanText(options.clientRequestId, 100);
  if (clientRequestId && !/^[A-Za-z0-9_-]{8,100}$/.test(clientRequestId)) {
    throw Object.assign(new Error("Agent 请求编号格式无效。"), { statusCode: 400, errorCode: "INVALID_REQUEST_ID" });
  }
  const existing = clientRequestId
    ? [...store.values()].find((job) => job.clientRequestId === clientRequestId)
    : null;
  if (existing) return { job: existing, created: false };
  const activeCount = [...store.values()].filter((job) => job.status === "running").length;
  if (activeCount >= MAX_ACTIVE_AGENT_JOBS) {
    throw Object.assign(new Error("当前已有 2 个 Agent 任务运行中，请等待其中一个完成。"), {
      statusCode: 429,
      errorCode: "AGENT_CAPACITY",
      retryable: true,
    });
  }
  if (store.size >= MAX_AGENT_JOBS) {
    throw Object.assign(new Error("Agent 任务记录已满，请稍后再试。"), {
      statusCode: 503,
      errorCode: "AGENT_JOB_STORE_FULL",
      retryable: true,
    });
  }
  const jobId = `agent_${crypto.randomBytes(12).toString("hex")}`;
  const createdAtMs = clock();
  const job = {
    jobId,
    clientRequestId,
    status: "running",
    createdAt: new Date(createdAtMs).toISOString(),
    startedAt: new Date(createdAtMs).toISOString(),
    finishedAt: null,
    finishedAtMs: null,
    output: null,
    error: null,
    promise: null,
  };
  store.set(jobId, job);
  const signal = AbortSignal.timeout(options.timeoutMs || AGENT_JOB_TIMEOUT_MS);
  job.promise = Promise.resolve()
    .then(() => runAgent(input, { signal }))
    .then((result) => {
      const finishedAtMs = clock();
      job.status = "succeeded";
      job.finishedAtMs = finishedAtMs;
      job.finishedAt = new Date(finishedAtMs).toISOString();
      job.output = {
        ...result,
        generatedAt: job.finishedAt,
        input: { ...input, imageDataUrl: undefined, imageDataUrls: undefined },
      };
    })
    .catch((error) => {
      const finishedAtMs = clock();
      const timedOut = error?.name === "TimeoutError" || signal.aborted;
      if (timedOut && !error?.errorCode) {
        Object.assign(error, {
          message: "Agent 总运行时间超过 5 分钟，任务已停止。",
          errorCode: "AGENT_JOB_TIMEOUT",
          statusCode: 504,
          retryable: true,
        });
      }
      job.status = "failed";
      job.finishedAtMs = finishedAtMs;
      job.finishedAt = new Date(finishedAtMs).toISOString();
      job.error = publicErrorPayload(error, "Agent 运行失败，请稍后重试。");
    });
  return { job, created: true };
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(Object.assign(new Error("请求内容过大。"), { statusCode: 413 }));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      try { resolve(JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}")); }
      catch { reject(Object.assign(new Error("请求 JSON 格式无效。"), { statusCode: 400 })); }
    });
    req.on("error", reject);
  });
}

function serveStatic(req, res) {
  let pathname;
  try { pathname = decodeURIComponent(new URL(req.url, "http://localhost").pathname); }
  catch { sendJson(res, 400, { error: "无效的请求地址。" }); return; }
  const requested = pathname === "/" ? "/index.html" : pathname;
  const filePath = path.resolve(PUBLIC_DIR, `.${requested}`);
  if (!filePath.startsWith(`${PUBLIC_DIR}${path.sep}`)) { sendJson(res, 403, { error: "禁止访问。" }); return; }
  fs.readFile(filePath, (error, content) => {
    if (error) { sendJson(res, error.code === "ENOENT" ? 404 : 500, { error: "文件不存在。" }); return; }
    res.writeHead(200, {
      "Content-Type": MIME_TYPES[path.extname(filePath).toLowerCase()] || "application/octet-stream",
      "Content-Length": content.length,
      "Cache-Control": "no-cache",
    });
    res.end(content);
  });
}

function serveVideoFrame(res, jobId, filename) {
  if (!/^\d{13}-[a-f0-9]{8}$/.test(jobId) || !/^frame-\d{2}\.jpg$/.test(filename)) {
    sendJson(res, 400, { error: "关键帧地址无效。" });
    return;
  }
  const framePath = path.join(VIDEO_JOB_DIR, jobId, "frames", filename);
  fs.readFile(framePath, (error, content) => {
    if (error) { sendJson(res, error.code === "ENOENT" ? 404 : 500, { error: "关键帧不存在。" }); return; }
    res.writeHead(200, {
      "Content-Type": "image/jpeg",
      "Content-Length": content.length,
      "Cache-Control": "private, max-age=21600",
    });
    res.end(content);
  });
}

function createServer(options = {}) {
  const jobStore = options.agentJobs || agentJobs;
  const runAgent = options.runAgent || callGateway;
  const runCreativePrompt = options.runCreativePrompt || callCreativePromptGateway;
  let activeCreativeRequests = 0;
  let drama = options.dramaRouter;
  return http.createServer(async (req, res) => {
    const requestUrl = new URL(req.url, "http://localhost");
    if (requestUrl.pathname.startsWith("/api/drama/") || requestUrl.pathname === "/vendor/lucide.js") {
      drama ||= require("./drama-router").createDramaRouter({
        getGatewayConfig, gatewayModelCandidates, requestGatewayResponse, extractOutputText, parseModelJson,
        getViduConfig, requestVidu, normalizeViduTask, getViduTask, isPrivateAddress,
      }, options.drama || {});
      await drama.route(req, res);
      return;
    }
    if (req.method === "GET" && req.url === "/api/health") {
      const config = getGatewayConfig();
      const vidu = getViduConfig();
      const gatewayProbe = await probeGateway(config);
      const fallbackActive = isGatewayModelCoolingDown(config.model) && Boolean(config.fallbackModel);
      const creative = getCreativePromptConfig(config);
      sendJson(res, 200, {
        ok: true,
        configured: Boolean(config.apiKey),
        model: config.model,
        activeModel: fallbackActive ? config.fallbackModel : config.model,
        fallbackModel: config.fallbackModel,
        fallbackActive,
        creativePrompt: { ...creativePromptStatus(creative, gatewayProbe), running: activeCreativeRequests },
        gateway: config.baseUrl.replace(/^https?:\/\//, ""),
        gatewayReachable: gatewayProbe.reachable,
        gatewayAuthenticated: gatewayProbe.authenticated,
        gatewayStatusCode: gatewayProbe.statusCode,
        gatewayLatencyMs: gatewayProbe.latencyMs,
        keySource: config.keySource,
        agentJobs: {
          running: [...jobStore.values()].filter((job) => job.status === "running").length,
          retained: jobStore.size,
        },
        viduConfigured: Boolean(vidu.apiKey),
        viduGateway: vidu.baseUrl.replace(/^https?:\/\//, ""),
      });
      return;
    }
    if (req.method === "POST" && req.url === "/api/agent/jobs") {
      try {
        const body = await readJsonBody(req);
        const input = normalizeAgentRequest(body);
        const { job, created } = createAgentJob(input, {
          store: jobStore,
          runAgent,
          clientRequestId: body.clientRequestId,
          timeoutMs: options.agentJobTimeoutMs,
        });
        sendJson(res, created ? 202 : 200, { ...agentJobSnapshot(job), deduplicated: !created });
      } catch (error) {
        if (!res.headersSent) sendJson(res, error.statusCode || 500, publicErrorPayload(error, "Agent 任务提交失败，请稍后重试。"));
      }
      return;
    }
    const agentJobMatch = requestUrl.pathname.match(/^\/api\/agent\/jobs\/(agent_[a-f0-9]{24})$/);
    if (req.method === "GET" && agentJobMatch) {
      cleanupAgentJobs(jobStore);
      const job = jobStore.get(agentJobMatch[1]);
      if (!job) sendJson(res, 404, { error: "Agent 任务不存在、已过期，或服务已重启。", errorCode: "AGENT_JOB_NOT_FOUND" });
      else sendJson(res, 200, agentJobSnapshot(job));
      return;
    }
    if (req.method === "POST" && req.url === "/api/agent/run") {
      try {
        const input = normalizeAgentRequest(await readJsonBody(req));
        const result = await runAgent(input, { signal: AbortSignal.timeout(AGENT_JOB_TIMEOUT_MS) });
        sendJson(res, 200, { ...result, generatedAt: new Date().toISOString(), input: { ...input, imageDataUrl: undefined, imageDataUrls: undefined } });
      } catch (error) {
        if (!res.headersSent) sendJson(res, error.statusCode || 500, publicErrorPayload(error, "Agent 运行失败，请稍后重试。"));
      }
      return;
    }
    if (req.method === "POST" && req.url === "/api/creative/prompt") {
      activeCreativeRequests++;
      try {
        const input = normalizeCreativePromptRequest(await readJsonBody(req));
        const result = await runCreativePrompt(input);
        sendJson(res, 200, { ...result, generatedAt: new Date().toISOString() });
      } catch (error) {
        if (!res.headersSent) sendJson(res, error.statusCode || 500, publicErrorPayload(error, "创意提示词生成失败，请稍后重试。"));
      } finally {
        activeCreativeRequests--;
      }
      return;
    }
    if (req.method === "POST" && req.url === "/api/image-from-url") {
      try {
        const body = await readJsonBody(req);
        const image = await fetchRemoteImage(body.url);
        res.writeHead(200, {
          "Content-Type": image.contentType,
          "Content-Length": image.buffer.length,
          "Cache-Control": "no-store",
          "X-Image-Source": encodeURIComponent(image.finalUrl),
        });
        res.end(image.buffer);
      } catch (error) {
        if (!res.headersSent) sendJson(res, error.statusCode || 500, { error: error.message });
      }
      return;
    }
    if (req.method === "POST" && req.url === "/api/image/create") {
      try {
        sendJson(res, 201, await createViduImageTask(await readJsonBody(req)));
      } catch (error) {
        if (!res.headersSent) sendJson(res, error.statusCode || 500, { error: error.name === "TimeoutError" ? "Vidu 生图任务创建超时，请稍后重试。" : error.message });
      }
      return;
    }
    const imageTaskMatch = requestUrl.pathname.match(/^\/api\/image\/task\/([^/]+)$/);
    if (req.method === "GET" && imageTaskMatch) {
      try {
        sendJson(res, 200, await getViduImageTask(imageTaskMatch[1]));
      } catch (error) {
        if (!res.headersSent) sendJson(res, error.statusCode || 500, { error: error.name === "TimeoutError" ? "Vidu 生图任务查询超时，请稍后重试。" : error.message });
      }
      return;
    }
    if (req.method === "POST" && req.url === "/api/video/analyze") {
      const contentType = (req.headers["content-type"] || "").split(";")[0].trim().toLowerCase();
      if (!REMOTE_VIDEO_TYPES.has(contentType)) {
        sendJson(res, 415, { error: "请上传 MP4、MOV、WebM 或 MKV 视频。" });
        return;
      }
      const work = buildVideoWorkDir();
      const fileName = safeHeaderValue(req.headers["x-file-name"], 240) || `upload${videoExtension(contentType)}`;
      const filePath = path.join(work.dir, `source${videoExtension(contentType, fileName)}`);
      try {
        await writeRequestToFile(req, filePath);
        const result = await analyzeVideoFile(filePath, work, {
          fileName,
          focus: safeHeaderValue(req.headers["x-analysis-focus"], 1500),
        });
        sendJson(res, 200, result);
      } catch (error) {
        await fs.promises.rm(work.dir, { recursive: true, force: true }).catch(() => {});
        if (!res.headersSent) sendJson(res, error.statusCode || 500, publicErrorPayload(error, "视频分析失败，请稍后重试。"));
      }
      return;
    }
    if (req.method === "POST" && req.url === "/api/video/analyze-url") {
      const work = buildVideoWorkDir();
      try {
        const body = await readJsonBody(req);
        const remote = await downloadRemoteVideo(body.url, work);
        const result = await analyzeVideoFile(remote.filePath, work, {
          fileName: remote.fileName,
          sourceUrl: remote.finalUrl,
          focus: body.focus,
        });
        sendJson(res, 200, result);
      } catch (error) {
        await fs.promises.rm(work.dir, { recursive: true, force: true }).catch(() => {});
        if (!res.headersSent) sendJson(res, error.statusCode || 500, publicErrorPayload(error, "视频分析失败，请稍后重试。"));
      }
      return;
    }
    const frameMatch = requestUrl.pathname.match(/^\/api\/video\/frame\/([^/]+)\/([^/]+)$/);
    if (req.method === "GET" && frameMatch) {
      serveVideoFrame(res, frameMatch[1], frameMatch[2]);
      return;
    }
    if (req.method === "POST" && req.url === "/api/video/create") {
      try {
        sendJson(res, 201, await createViduTask(await readJsonBody(req)));
      } catch (error) {
        if (!res.headersSent) sendJson(res, error.statusCode || 500, { error: error.name === "TimeoutError" ? "Vidu 创建任务超时，请稍后重试。" : error.message });
      }
      return;
    }
    const taskMatch = requestUrl.pathname.match(/^\/api\/video\/task\/([^/]+)$/);
    if (req.method === "GET" && taskMatch) {
      try {
        sendJson(res, 200, await getViduTask(taskMatch[1]));
      } catch (error) {
        if (!res.headersSent) sendJson(res, error.statusCode || 500, { error: error.name === "TimeoutError" ? "Vidu 查询任务超时，请稍后重试。" : error.message });
      }
      return;
    }
    if (req.method === "GET" || req.method === "HEAD") { serveStatic(req, res); return; }
    sendJson(res, 405, { error: "不支持的请求方法。" });
  });
}

if (require.main === module) {
  const server = createServer();
  server.listen(DEFAULT_PORT, "127.0.0.1", () => {
    const config = getGatewayConfig();
    console.log(`SIRIHOTDRAMA: http://127.0.0.1:${DEFAULT_PORT}`);
    console.log(`Gateway: ${config.baseUrl} | Model: ${config.model} | Key: ${config.keySource || "missing"}`);
  });
}

module.exports = {
  AGENT_SCHEMA,
  CREATIVE_STYLE_PRESETS,
  CREATIVE_PROMPT_SCHEMA,
  VIDEO_ANALYSIS_SCHEMA,
  analyzeVideoFile,
  applyCreativeStylePrompt,
  buildFrameTimes,
  callGateway,
  callCreativePromptGateway,
  buildGatewayPayload,
  buildCreativePromptPayload,
  buildViduImagePayload,
  buildUserBrief,
  buildViduPayload,
  buildVideoAnalysisPayload,
  cleanupAgentJobs,
  createAgentJob,
  createServer,
  createViduImageTask,
  createViduTask,
  extractOutputText,
  fetchRemoteImage,
  getGatewayConfig,
  getCreativePromptConfig,
  getCreativeBackupConfig,
  creativePromptRoutes,
  creativePromptStatus,
  gatewayModelCandidates,
  getViduConfig,
  getViduImageTask,
  getViduTask,
  isPrivateAddress,
  agentJobSnapshot,
  normalizeAgentRequest,
  normalizeCreativePromptRequest,
  normalizeRemoteImageUrl,
  normalizeRemoteVideoUrl,
  normalizeViduCreateRequest,
  normalizeViduImageCreateRequest,
  normalizeViduTask,
  requestVidu,
  parseSceneTimestamps,
  readImageDimensions,
  parseModelJson,
  probeGateway,
  publicErrorPayload,
  requestGatewayResponse,
  validateAgentResult,
  validateCreativePromptResult,
  validateViduImageBuffer,
  validateVideoAnalysisResult,
};
