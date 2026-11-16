"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const http = require("node:http");
const media = require("../drama-media");
const { fixture } = require("../tools/upload-review-fixture.cjs");

const request = (port, method, route, body) => new Promise((resolve, reject) => {
  const payload = body === undefined ? "" : JSON.stringify(body);
  const req = http.request({
    host: "127.0.0.1",
    port,
    path: route,
    method,
    headers: payload ? { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(payload) } : {},
  }, res => {
    let data = "";
    res.setEncoding("utf8");
    res.on("data", chunk => { data += chunk; });
    res.on("end", () => {
      let parsed = null;
      try { parsed = JSON.parse(data); } catch { /* keep raw */ }
      resolve({ status: res.statusCode, body: parsed, raw: data });
    });
  });
  req.on("error", reject);
  if (payload) req.write(payload);
  req.end();
});

test("a ten-second platform preview is rejected unless it is explicitly allowed", async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "drama-preview-"));
  const { router } = fixture(root, {}, {
    probe: async () => ({ duration: 10.07, width: 640, height: 360, hasAudio: true, videoCodec: "h264", stream: 0 }),
  });
  const server = http.createServer((req, res) => router.route(req, res));
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const port = server.address().port;
  t.after(async () => {
    await new Promise(resolve => server.close(resolve));
    fs.rmSync(root, { recursive: true, force: true });
  });

  const created = await request(port, "POST", "/api/drama/projects", { uploadIntent: "analyze", title: "预告守卫" });
  assert.equal(created.status, 201);
  const id = created.body.id;

  const blocked = await request(port, "POST", `/api/drama/projects/${id}/import-url`, {
    url: "https://hongguoduanju.com/video/public/7702765030164401176/360p.mp4",
    direct: true,
  });
  assert.equal(blocked.status, 422);
  assert.match(blocked.body.error, /秒/);
  assert.match(blocked.body.error, /预览|完整集/);

  // The rejected import must not leave a half-imported episode behind.
  assert.equal(router.store.get(id).episodes.length, 0);

  const allowed = await request(port, "POST", `/api/drama/projects/${id}/import-url`, {
    url: "https://hongguoduanju.com/video/public/7702765030164401176/360p.mp4",
    direct: true,
    allowPreview: true,
  });
  assert.equal(allowed.status, 201);
  const stored = router.store.get(id).episodes[0];
  assert.equal(stored.access, "ready");
  assert.equal(stored.preview, true);
  assert.equal(stored.metadata.duration, 10.07);
});

test("an m3u8 link is routed through the HLS downloader", async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "drama-hls-route-"));
  const calls = [];
  const { router } = fixture(root, {}, {
    downloadHls: async (url, _isPrivate, options) => {
      calls.push(url);
      fs.writeFileSync(options.destination, "mock-hls");
    },
  });
  const server = http.createServer((req, res) => router.route(req, res));
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const port = server.address().port;
  t.after(async () => {
    await new Promise(resolve => server.close(resolve));
    fs.rmSync(root, { recursive: true, force: true });
  });

  const created = await request(port, "POST", "/api/drama/projects", { uploadIntent: "analyze", title: "HLS 分集" });
  assert.equal(created.status, 201);
  const imported = await request(port, "POST", `/api/drama/projects/${created.body.id}/import-url`, {
    url: "https://cdn.example.test/series/ep01/index.m3u8",
  });
  assert.equal(imported.status, 201);
  assert.deepEqual(calls, ["https://cdn.example.test/series/ep01/index.m3u8"]);
  const episode = router.store.get(created.body.id).episodes[0];
  assert.equal(episode.access, "ready");
  assert.equal(episode.preview, false);
});

test("hls helpers recognise playlists, variants and encrypted segments", () => {
  assert.equal(media.isHlsUrl("https://cdn.example.test/a/index.m3u8"), true);
  assert.equal(media.isHlsUrl("https://cdn.example.test/a/index.M3U8?token=1"), true);
  assert.equal(media.isHlsUrl("https://cdn.example.test/a/ep01.mp4"), false);
  assert.equal(media.isHlsUrl("not a url"), false);

  const master = media.parsePlaylist([
    "#EXTM3U",
    "#EXT-X-STREAM-INF:BANDWIDTH=900000,RESOLUTION=640x360",
    "360p/index.m3u8",
    "#EXT-X-STREAM-INF:BANDWIDTH=2400000,RESOLUTION=1280x720",
    "720p/index.m3u8",
  ].join("\n"), "https://cdn.example.test/series/ep01/master.m3u8");
  assert.equal(master.segments.length, 0);
  assert.equal(master.variants.length, 2);
  assert.equal(master.variants[1].uri, "https://cdn.example.test/series/ep01/720p/index.m3u8");
  assert.equal(master.variants[1].bandwidth, 2400000);

  const encrypted = media.parsePlaylist([
    "#EXTM3U",
    '#EXT-X-KEY:METHOD=AES-128,URI="key.bin",IV=0x00000000000000000000000000000001',
    "#EXTINF:6.0,",
    "seg-1.ts",
    "#EXTINF:6.0,",
    "seg-2.ts",
    "#EXT-X-ENDLIST",
  ].join("\n"), "https://cdn.example.test/series/ep01/index.m3u8");
  assert.equal(encrypted.segments.length, 2);
  assert.equal(encrypted.segments[1].uri, "https://cdn.example.test/series/ep01/seg-2.ts");
  assert.equal(encrypted.segments[1].key.METHOD, "AES-128");

  assert.throws(() => media.parsePlaylist("#EXTM3U\n#EXT-X-MAP:URI=\"init.mp4\"\nseg.m4s\n", "https://cdn.example.test/a.m3u8"), /fMP4/);
  assert.throws(() => media.parsePlaylist("not a playlist", "https://cdn.example.test/a.m3u8"), /HLS/);
});

test("downloadHls reads the playlist, the segments and then remuxes locally", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "drama-hls-dl-"));
  const playlist = ["#EXTM3U", "#EXT-X-TARGETDURATION:4", "#EXTINF:4.0,", "seg-1.ts", "#EXTINF:4.0,", "seg-2.ts", "#EXT-X-ENDLIST"].join("\n");
  const fetched = [];
  const remote = async (url) => {
    fetched.push(url);
    if (url.endsWith(".m3u8")) return { buffer: Buffer.from(playlist, "utf8"), url };
    return { buffer: Buffer.from("not-a-real-ts-segment"), url };
  };
  const destination = path.join(root, "ep.mp4");
  await assert.rejects(
    media.downloadHls("https://cdn.example.test/series/ep01/index.m3u8", () => false, { destination, remote, limit: 1024 * 1024 }),
    error => {
      assert.doesNotMatch(String(error.message), /is not defined/);
      return true;
    },
  );
  assert.deepEqual(fetched.slice(0, 3), [
    "https://cdn.example.test/series/ep01/index.m3u8",
    "https://cdn.example.test/series/ep01/seg-1.ts",
    "https://cdn.example.test/series/ep01/seg-2.ts",
  ]);
  fs.rmSync(root, { recursive: true, force: true });
});