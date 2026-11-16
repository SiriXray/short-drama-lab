"use strict";

const fs = require("node:fs");
const os = require("node:os");
const crypto = require("node:crypto");
const path = require("node:path");
const http = require("node:http");
const https = require("node:https");
const dns = require("node:dns").promises;
const { execFile } = require("node:child_process");
const { promisify } = require("node:util");
const { once } = require("node:events");
const cheerio = require("cheerio");
const exec = promisify(execFile);
// Keep-alive agents: HLS imports issue hundreds of segment requests, and a fresh
// TLS handshake per segment dominates the download time.
const keepAlive = { http: new http.Agent({ keepAlive: true, maxSockets: 8 }), https: new https.Agent({ keepAlive: true, maxSockets: 8 }) };
const ffmpeg = process.env.FFMPEG_PATH || "ffmpeg";
const ffprobe = process.env.FFPROBE_PATH || "ffprobe";
const fail = (message, statusCode = 400) => Object.assign(new Error(message), { statusCode });

function publicUrl(raw) {
  let url;
  try { url = new URL(raw); } catch { throw fail("请输入完整的 HTTP / HTTPS 地址。"); }
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) throw fail("来源链接不支持此协议或内嵌凭据。");
  return url;
}

// Pin the validated address for the actual connection, including every redirect.
async function openRemote(raw, isPrivateAddress, options = {}, depth = 0) {
  const url = publicUrl(raw);
  const hostname = url.hostname.replace(/^\[|\]$/g, "");
  const addresses = await dns.lookup(hostname, { all: true, verbatim: true });
  if (!addresses.length || addresses.some(({ address }) => isPrivateAddress(address) || /^::ffff:/i.test(address))) throw fail("不能采集本机或内网地址。");
  const response = await new Promise((resolve, reject) => {
    const req = (url.protocol === "https:" ? https : http).get(url, {
      agent: url.protocol === "https:" ? keepAlive.https : keepAlive.http,
      headers: { "User-Agent": "Atelier-Drama/1.0", Accept: "*/*", ...(options.headers || {}) },
      lookup: (_host, opts, callback) => opts.all ? callback(null, [addresses[0]]) : callback(null, addresses[0].address, addresses[0].family),
    }, resolve);
    req.setTimeout(options.timeoutMs || 60000, () => req.destroy(fail("来源服务器响应超时。", 504)));
    req.on("error", reject);
  });
  if ([301, 302, 303, 307, 308].includes(response.statusCode)) {
    response.resume();
    if (!response.headers.location || depth >= 4) throw fail("来源跳转次数过多。");
    const next = new URL(response.headers.location, url);
    const headers = next.origin === url.origin ? options.headers : {};
    return openRemote(next.href, isPrivateAddress, { ...options, headers }, depth + 1);
  }
  if (response.statusCode < 200 || response.statusCode >= 300) {
    response.resume();
    if ([401, 403].includes(response.statusCode)) throw fail("来源需要登录或访问授权，请提供可访问的分集视频或授权数据源。", 403);
    if (response.statusCode === 429) throw fail("来源限制了采集频率，请稍后重试。", 429);
    throw fail(`来源读取失败（HTTP ${response.statusCode}）。`, 502);
  }
  return { response, url: url.href, contentType: String(response.headers["content-type"] || "").split(";")[0] };
}

async function remoteContent(url, isPrivateAddress, options = {}) {
  const opened = await openRemote(url, isPrivateAddress, options);
  const limit = options.limit || 4 * 1024 * 1024;
  let bytes = 0;
  const chunks = [];
  const target = options.destination ? fs.createWriteStream(`${options.destination}.part`, { flags: "w" }) : null;
  let streamError;
  if (target) target.on("error", error => { streamError = error; opened.response.destroy(error); });
  try {
    for await (const chunk of opened.response) {
      bytes += chunk.length;
      if (bytes > limit) throw fail("文件超过当前导入大小限制。", 413);
      if (target) { if (!target.write(chunk)) await once(target, "drain"); }
      else chunks.push(chunk);
    }
    if (!bytes) throw fail("来源没有返回内容。", 422);
    if (target) {
      target.end();
      await once(target, "finish");
      if (streamError) throw streamError;
      fs.renameSync(`${options.destination}.part`, options.destination);
    }
    return { ...opened, response: undefined, bytes, buffer: target ? undefined : Buffer.concat(chunks) };
  } catch (error) {
    opened.response.destroy();
    if (target) {
      target.destroy();
      if (!target.closed) await new Promise(resolve => target.once("close", resolve));
      if (fs.existsSync(`${options.destination}.part`)) fs.unlinkSync(`${options.destination}.part`);
    }
    throw error;
  }
}

function numericMetric(raw) {
  if (raw == null || raw === "") return null;
  if (typeof raw === "number") return Number.isFinite(raw) && raw >= 0 ? raw : null;
  const match = String(raw).replaceAll(",", "").trim().match(/^(\d+(?:\.\d+)?)\s*(万|亿|[kKmM])?(?:次|播放)?$/);
  if (!match) return null;
  return Number(match[1]) * ({ "万": 1e4, "亿": 1e8, k: 1e3, K: 1e3, m: 1e6, M: 1e6 }[match[2]] || 1);
}

function safeLink(value, base) {
  if (!value || typeof value !== "string") return "";
  try { return publicUrl(new URL(value, base).href).href; } catch { return ""; }
}

function parseCatalog(text, contentType, sourceUrl) {
  const rows = [];
  const visit = (value, depth = 0) => {
    if (!value || depth > 12) return;
    if (Array.isArray(value)) { value.slice(0, 500).forEach(v => visit(v, depth + 1)); return; }
    if (typeof value !== "object") return;
    const type = value["@type"];
    const title = value.title || value.name || value.book_name || value.series_name;
    if (title && (value.episodes || value.videoUrl || value.video_url || value.contentUrl || value.playCount != null || value.play_count != null || value.heat != null || ["VideoObject", "TVSeries", "TVEpisode"].includes(type))) {
      const stats = [].concat(value.interactionStatistic || []).find(s => /WatchAction/.test(String(s?.interactionType?.["@type"] || s?.interactionType)));
      const episodes = [].concat(value.episodes || value.episode || []).map((ep, index) => ({
        number: Number(ep.number || ep.episodeNumber || index + 1),
        title: String(ep.title || ep.name || `第 ${index + 1} 集`).slice(0, 160),
        videoUrl: safeLink(ep.videoUrl || ep.video_url || ep.contentUrl || "", sourceUrl),
        transcript: String(ep.transcript || "").slice(0, 100000),
      })).filter(ep => ep.videoUrl && ep.videoUrl !== sourceUrl);
      const videoUrl = safeLink(value.videoUrl || value.video_url || value.contentUrl || "", sourceUrl);
      if (videoUrl && videoUrl !== sourceUrl && !episodes.length) episodes.push({ number: 1, title: String(title), videoUrl, transcript: "" });
      rows.push({ title: String(title).slice(0, 160), sourceUrl: safeLink(value.sourceUrl || value.url || sourceUrl, sourceUrl),
        coverUrl: safeLink([].concat(value.coverUrl || value.thumbnailUrl || value.image || [])[0] || "", sourceUrl),
        description: String(value.description || "").slice(0, 6000),
        playCount: numericMetric(value.playCount ?? value.play_count ?? value.views ?? stats?.userInteractionCount),
        heat: numericMetric(value.heat ?? value.hot_value), episodes });
      return;
    }
    Object.values(value).forEach(child => visit(child, depth + 1));
  };
  if (/json/.test(contentType) || /^[\s]*[\[{]/.test(text)) {
    let data;
    try { data = JSON.parse(text); } catch { throw fail("数据源 JSON 无法解析。", 422); }
    visit(data);
  } else {
    const $ = cheerio.load(text);
    if (new URL(sourceUrl).hostname.replace(/^www\./, "") === "hongguoduanju.com") {
      $('article[aria-labelledby^="rank-title-"]').each((_i, el) => {
        const item = $(el);
        const title = item.find('h2').first().text().trim();
        if (!title) return;
        const episodes = item.find('a[aria-label^="播放第"]').toArray().map(a => ({
          number: Number($(a).text()), title: `第 ${$(a).text()} 集`,
          pageUrl: safeLink($(a).attr('href'), sourceUrl), videoUrl: "", transcript: "",
        }));
        rows.push({ title, sourceUrl: safeLink(item.find('a[href^="/detail"]').attr('href'), sourceUrl),
          coverUrl: safeLink(item.find('img').attr('src'), sourceUrl),
          description: item.find('[class*="pc-description-"]').text().trim(),
          heat: numericMetric(item.find('[class*="pc-metrics-"]').text().replace(/热度/g, '').trim()),
          playCount: null, episodes, access: "page-only", metricLabel: "综合热度" });
      });
    }
    $('script[type="application/ld+json"],script[type="application/json"]').each((_i, el) => {
      try { visit(JSON.parse($(el).text())); } catch { /* ignore unrelated embedded JSON */ }
    });
    if (new URL(sourceUrl).hostname.replace(/^www\./, "") === "hongguoduanju.com" && new URL(sourceUrl).pathname === "/detail") {
      const episodes = $('a[href^="/player/"]').toArray().filter(el => /^\d+$/.test($(el).text().trim())).map(el => ({
        number: Number($(el).text()), title: `第 ${$(el).text()} 集`, pageUrl: safeLink($(el).attr("href"), sourceUrl), videoUrl: "", transcript: "",
      }));
      for (const row of rows) if (!row.episodes.length) row.episodes = [...new Map(episodes.map(e => [e.number, e])).values()];
    }
    const title = $('meta[property="og:title"]').attr("content") || $("title").text() || "来源视频";
    $("video").each((_i, el) => {
      const videoUrl = safeLink($(el).attr("src") || $(el).find("source").attr("src") || "", sourceUrl);
      if (videoUrl && videoUrl !== sourceUrl) rows.push({ title, sourceUrl, coverUrl: safeLink($(el).attr("poster") || "", sourceUrl), playCount: null, heat: null, episodes: [{ number: 1, title, videoUrl }] });
    });
    if (!rows.length) throw fail("网页未公开可读取的榜单/分集视频数据。请提供红果授权接口、分集直链，或导入本地视频。", 422);
  }
  if (!rows.length) throw fail("未找到剧集记录。数据源需包含 title、playCount/heat、episodes[].videoUrl。", 422);
  const unique = [...new Map(rows.map(row => [row.episodes.length === 1 && row.episodes[0].videoUrl ? row.episodes[0].videoUrl : `${row.sourceUrl}|${row.title}`, row])).values()];
  return unique.slice(0, 200).map((row, index) => ({ ...row, sourceRank: index + 1, capturedAt: new Date().toISOString() }));
}

function sortCatalog(items, metric = "playCount") {
  if (!["playCount", "heat"].includes(metric)) throw fail("排序指标仅支持播放量或热度。");
  return [...items].sort((a, b) => (b[metric] ?? -1) - (a[metric] ?? -1) || a.sourceRank - b.sourceRank);
}

// Public HLS sources are downloaded segment by segment so every request still
// goes through the same private-address guard as the page importer.
function isHlsUrl(value) {
  try {
    const url = new URL(value);
    return /\.m3u8?$/i.test(url.pathname) || /(?:^|[?&])format=m3u8(?:&|$)/i.test(url.search);
  } catch { return false; }
}

function playlistAttributes(text) {
  const out = {};
  const pattern = /([A-Z0-9-]+)=("[^"]*"|[^,]*)/gi;
  let match;
  while ((match = pattern.exec(String(text)))) out[match[1].toUpperCase()] = match[2].replace(/^"|"$/g, "");
  return out;
}

function parsePlaylist(text, baseUrl) {
  const lines = String(text).split(/\r?\n/).map(line => line.trim()).filter(Boolean);
  if (!lines.length || !lines[0].startsWith("#EXTM3U")) throw fail("不是有效的 HLS 播放列表。", 422);
  const variants = [], segments = [];
  let variant = null, key = null;
  for (const line of lines) {
    if (line.startsWith("#EXT-X-STREAM-INF:")) { variant = playlistAttributes(line.slice("#EXT-X-STREAM-INF:".length)); continue; }
    if (line.startsWith("#EXT-X-KEY:")) {
      const attrs = playlistAttributes(line.slice("#EXT-X-KEY:".length));
      key = attrs.METHOD && attrs.METHOD.toUpperCase() !== "NONE" ? attrs : null;
      continue;
    }
    if (line.startsWith("#EXT-X-MAP:")) throw fail("该 HLS 使用 fMP4 分片，当前只支持 TS 分片。", 422);
    if (line.startsWith("#")) continue;
    const uri = new URL(line, baseUrl).href;
    if (variant) { variants.push({ uri, bandwidth: Number(variant.BANDWIDTH || 0) }); variant = null; continue; }
    segments.push({ uri, key });
  }
  return { variants, segments };
}

async function hlsSegmentData(segment, index, state) {
  const fetched = await state.remote(segment.uri, state.isPrivateAddress, { limit: 64 * 1024 * 1024 });
  if (!segment.key) return fetched.buffer;
  const method = String(segment.key.METHOD || "").toUpperCase();
  if (method !== "AES-128") throw fail(`HLS 使用 ${method} 加密，暂不支持。`, 422);
  if (!segment.key.URI) throw fail("HLS 密钥地址缺失。", 422);
  const keyUri = new URL(segment.key.URI, segment.uri).href;
  if (!state.keys.has(keyUri)) state.keys.set(keyUri, (await state.remote(keyUri, state.isPrivateAddress, { limit: 64 * 1024 })).buffer);
  const key = state.keys.get(keyUri);
  if (key.length !== 16) throw fail("HLS 密钥长度无效。", 422);
  const iv = segment.key.IV
    ? Buffer.from(segment.key.IV.replace(/^0x/i, "").padStart(32, "0").slice(0, 32), "hex")
    : (() => { const value = Buffer.alloc(16); value.writeUInt32BE(index >>> 0, 12); return value; })();
  const decipher = crypto.createDecipheriv("aes-128-cbc", key, iv);
  return Buffer.concat([decipher.update(fetched.buffer), decipher.final()]);
}

async function downloadHls(url, isPrivateAddress, options = {}) {
  const remote = options.remote || remoteContent;
  const limit = options.limit || 500 * 1024 * 1024;
  const state = { isPrivateAddress, remote, keys: new Map() };
  let current = url, playlist = null;
  for (let depth = 0; depth < 4; depth += 1) {
    const source = await remote(current, isPrivateAddress, { limit: 4 * 1024 * 1024 });
    playlist = parsePlaylist(source.buffer.toString("utf8"), source.url || current);
    if (playlist.segments.length) break;
    if (!playlist.variants.length) throw fail("HLS 播放列表没有可用分片。", 422);
    playlist.variants.sort((a, b) => b.bandwidth - a.bandwidth);
    current = playlist.variants[0].uri;
    playlist = null;
  }
  if (!playlist?.segments.length) throw fail("HLS 播放列表没有可用分片。", 422);
  if (playlist.segments.length > 4000) throw fail("HLS 分片数量超过当前限制。", 413);

  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "drama-hls-"));
  const joined = path.join(tempDir, "media.ts");
  const handle = fs.openSync(joined, "w");
  // Fetch a few segments at a time but always append them in playlist order.
  const parallel = Math.max(1, Math.min(8, Number(process.env.DRAMA_HLS_CONCURRENCY || 6)));
  let bytes = 0;
  try {
    for (let start = 0; start < playlist.segments.length; start += parallel) {
      const batch = playlist.segments.slice(start, start + parallel);
      const chunks = await Promise.all(batch.map((segment, offset) => hlsSegmentData(segment, start + offset, state)));
      for (const data of chunks) {
        bytes += data.length;
        if (bytes > limit) throw fail("视频超过 500MB。", 413);
        fs.writeSync(handle, data);
      }
      if (typeof options.onProgress === "function") options.onProgress({ index: Math.min(start + batch.length, playlist.segments.length), total: playlist.segments.length, bytes });
    }
  } finally {
    fs.closeSync(handle);
  }

  const partial = `${options.destination}.part.mp4`;
  try {
    await exec(ffmpeg, ["-y", "-hide_banner", "-loglevel", "error", "-f", "mpegts", "-i", joined, "-c", "copy", "-bsf:a", "aac_adtstoasc", "-movflags", "+faststart", "-f", "mp4", partial], { timeout: 900000, windowsHide: true, maxBuffer: 8 * 1024 * 1024 });
    if (!fs.existsSync(partial) || !fs.statSync(partial).size) throw fail("HLS 合成为空文件。", 422);
    fs.renameSync(partial, options.destination);
    return { bytes, segments: playlist.segments.length, size: fs.statSync(options.destination).size };
  } catch (error) {
    fs.rmSync(partial, { force: true });
    throw error;
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

async function probe(file) {
  const { stdout } = await exec(ffprobe, ["-v", "error", "-protocol_whitelist", "file,pipe", "-show_format", "-show_streams", "-of", "json", file], { timeout: 30000, windowsHide: true, maxBuffer: 2e6 });
  const info = JSON.parse(stdout);
  const video = info.streams.find(s => s.codec_type === "video" && !s.disposition?.attached_pic);
  const duration = Number(info.format.duration || video?.duration);
  if (!video || !Number.isFinite(duration) || duration <= 0) throw fail("文件没有可解码的视频流。", 422);
  return { duration, width: video.width, height: video.height, stream: video.index, videoCodec: video.codec_name, pixelFormat: video.pix_fmt,
    hasAudio: info.streams.some(s => s.codec_type === "audio") };
}

function shotWindows(duration, scenes = [], maxGap = 8) {
  if (!(duration > 0) || !(maxGap >= 1 && maxGap <= 16)) throw fail("视频时长或镜头窗口无效。");
  const cuts = [0];
  for (const t of [...new Set(scenes)].sort((a, b) => a - b)) {
    if (Number.isFinite(t) && t >= cuts.at(-1) + 0.8 && t < duration - 0.5) cuts.push(t);
  }
  cuts.push(duration);
  const shots = [];
  for (let i = 1; i < cuts.length; i++) {
    const count = Math.ceil((cuts[i] - cuts[i - 1]) / maxGap);
    for (let n = 0; n < count; n++) {
      const start = cuts[i - 1] + (cuts[i] - cuts[i - 1]) * n / count;
      const end = cuts[i - 1] + (cuts[i] - cuts[i - 1]) * (n + 1) / count;
      shots.push({ start: +start.toFixed(3), end: +end.toFixed(3), boundary: count > 1 ? "time-window" : "scene-change" });
    }
  }
  return shots;
}

async function extractShots(file, dir, maxGap = 8) {
  const metadata = await probe(file);
  if (metadata.duration > 900) throw fail("每集最多 15 分钟，请先分集导入。");
  const { stderr } = await exec(ffmpeg, ["-hide_banner", "-protocol_whitelist", "file,pipe", "-i", file, "-map", `0:${metadata.stream}`, "-an", "-vf", "select='gt(scene,0.28)',showinfo", "-f", "null", "-"], { timeout: 240000, maxBuffer: 12e6, windowsHide: true });
  const scenes = [...stderr.matchAll(/pts_time:([\d.]+)/g)].map(m => Number(m[1]));
  const windows = shotWindows(metadata.duration, scenes, maxGap);
  fs.mkdirSync(dir, { recursive: true });
  for (let i = 0; i < windows.length; i++) {
    const shot = windows[i];
    shot.frames = [];
    const span = shot.end - shot.start;
    for (const [j, fraction] of [0.1, 0.5, 0.9].entries()) {
      const at = shot.start + span * fraction;
      const filename = `shot-${String(i + 1).padStart(4, "0")}-${j}.jpg`;
      await exec(ffmpeg, ["-y", "-hide_banner", "-loglevel", "error", "-protocol_whitelist", "file,pipe", "-ss", String(at), "-i", file, "-map", `0:${metadata.stream}`, "-frames:v", "1", "-vf", "scale=640:-2", "-q:v", "4", "-update", "1", path.join(dir, filename)], { timeout: 30000, windowsHide: true });
      if (!fs.statSync(path.join(dir, filename)).size) throw fail("镜头抽帧失败。", 422);
      shot.frames.push({ file: filename, time: +at.toFixed(3) });
    }
  }
  return { metadata, shots: windows };
}

async function conditionImage(file, output) {
  fs.mkdirSync(path.dirname(output), { recursive: true });
  await exec(ffmpeg, ["-y", "-hide_banner", "-loglevel", "error", "-protocol_whitelist", "file,pipe", "-i", file, "-frames:v", "1", "-vf", "scale=1024:1024:force_original_aspect_ratio=decrease", "-q:v", "3", "-update", "1", `${output}.part.jpg`], { timeout: 30000, windowsHide: true, maxBuffer: 2e6 });
  if (fs.statSync(`${output}.part.jpg`).size > 1024 * 1024) throw fail("压缩参考图仍超过 1MB，请检查素材。");
  fs.renameSync(`${output}.part.jpg`, output);
}

async function sampleFrames(file, dir) {
  const meta = await probe(file);
  fs.mkdirSync(dir, { recursive: true });
  const frames = [];
  for (const [i, fraction] of [0.12, 0.5, 0.88].entries()) {
    const at = meta.duration * fraction, name = `sample-${i}.jpg`;
    await exec(ffmpeg, ["-y", "-hide_banner", "-loglevel", "error", "-protocol_whitelist", "file,pipe", "-ss", String(at), "-i", file, "-map", `0:${meta.stream}`, "-frames:v", "1", "-vf", "scale=640:-2", "-q:v", "4", "-update", "1", path.join(dir, name)], { timeout: 30000, windowsHide: true, maxBuffer: 2e6 });
    frames.push({ file: name, time: +at.toFixed(3) });
  }
  return frames;
}

async function browserPreview(file, output) {
  fs.mkdirSync(path.dirname(output), { recursive: true });
  const partial = `${output}.part.mp4`;
  await exec(ffmpeg, ["-y", "-hide_banner", "-loglevel", "error", "-protocol_whitelist", "file,pipe", "-i", file,
    "-map", "0:v:0", "-map", "0:a?", "-c:v", "libx264", "-threads", "2", "-preset", "veryfast", "-crf", "18", "-pix_fmt", "yuv420p",
    "-c:a", "aac", "-b:a", "192k", "-movflags", "+faststart", partial], { timeout: 300000, windowsHide: true, maxBuffer: 2e6 });
  const metadata = await probe(partial);
  if (metadata.videoCodec !== "h264") throw fail("预览转码未生成H.264视频。", 422);
  fs.renameSync(partial, output); return metadata;
}

async function endingFrame(file, output) {
  fs.mkdirSync(path.dirname(output), { recursive: true });
  const partial = `${output}.part.jpg`;
  await exec(ffmpeg, ["-y", "-hide_banner", "-loglevel", "error", "-protocol_whitelist", "file,pipe", "-sseof", "-0.08", "-i", file,
    "-map", "0:v:0", "-frames:v", "1", "-vf", "scale=1024:-2", "-q:v", "2", "-update", "1", partial], { timeout: 30000, windowsHide: true, maxBuffer: 2e6 });
  if (!fs.existsSync(partial) || !fs.statSync(partial).size) throw fail("上一段尾帧提取失败，不能盲目提交下一段。", 422);
  fs.renameSync(partial, output);
}

async function assemble(clips, output, aspectRatio = "9:16", resolution = "720p") {
  if (!clips.length) throw fail("没有已完成的镜头视频。");
  const dir = path.dirname(output);
  fs.mkdirSync(dir, { recursive: true });
  const dimensions = { "9:16": [720, 1280], "16:9": [1280, 720], "1:1": [720, 720] }[aspectRatio];
  if (!dimensions) throw fail("交付画幅无效。");
  if (!["720p", "2K"].includes(resolution)) throw fail("交付分辨率无效。");
  const [w, h] = dimensions.map(n => n * (resolution === "2K" ? 2 : 1));
  const normalized = [];
  for (const [i, clip] of clips.entries()) {
    const meta = await probe(clip.file);
    if (resolution === "2K" && clip.duration > meta.duration + 0.1) throw fail("生成片段短于计划时间，不能以缺失剧情冒充完整成片。请检查该片段。");
    const duration = Math.min(meta.duration, clip.duration || meta.duration);
    const name = `part-${String(i).padStart(4, "0")}.mp4`;
    const args = ["-y", "-hide_banner", "-loglevel", "error", "-protocol_whitelist", "file,pipe", "-i", clip.file];
    if (!meta.hasAudio) args.push("-f", "lavfi", "-i", "anullsrc=channel_layout=stereo:sample_rate=48000");
    args.push("-map", `0:${meta.stream}`, "-map", meta.hasAudio ? "0:a:0" : "1:a:0", "-t", String(duration), "-vf", `scale=${w}:${h}:force_original_aspect_ratio=decrease,pad=${w}:${h}:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=24`, "-c:v", "libx264", "-preset", "fast", "-crf", "20", "-pix_fmt", "yuv420p", "-c:a", "aac", "-ar", "48000", "-ac", "2", "-af", "apad", "-movflags", "+faststart", path.join(dir, name));
    await exec(ffmpeg, args, { timeout: 300000, windowsHide: true, maxBuffer: 2e6 });
    normalized.push(name);
  }
  const list = path.join(dir, "concat.txt");
  fs.writeFileSync(list, normalized.map(name => `file '${name}'`).join("\n"));
  await exec(ffmpeg, ["-y", "-hide_banner", "-loglevel", "error", "-f", "concat", "-safe", "1", "-i", list, "-c", "copy", "-movflags", "+faststart", output], { timeout: 300000, windowsHide: true, maxBuffer: 2e6 });
  return probe(output);
}

module.exports = { fail, publicUrl, remoteContent, isHlsUrl, parsePlaylist, downloadHls, parseCatalog, sortCatalog, numericMetric, probe, shotWindows, extractShots, assemble, conditionImage, sampleFrames, browserPreview, endingFrame };
