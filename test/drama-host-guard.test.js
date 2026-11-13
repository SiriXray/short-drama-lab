"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const http = require("node:http");
const { fixture } = require("../tools/upload-review-fixture.cjs");

const call = (port, headers) => new Promise((resolve, reject) => {
  const req = http.request({ host: "127.0.0.1", port, path: "/api/drama/health", method: "GET", headers }, res => {
    let body = "";
    res.setEncoding("utf8");
    res.on("data", chunk => { body += chunk; });
    res.on("end", () => resolve({ status: res.statusCode, body }));
  });
  req.on("error", reject);
  req.end();
});

test("the drama workbench stays loopback-only unless a public host is configured", async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "drama-host-guard-"));
  const { router } = fixture(root);
  const server = http.createServer((req, res) => router.route(req, res));
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const port = server.address().port;
  const previous = { hosts: process.env.DRAMA_ALLOWED_HOSTS, origins: process.env.DRAMA_PUBLIC_ORIGINS };
  const restore = () => {
    delete process.env.DRAMA_ALLOWED_HOSTS;
    delete process.env.DRAMA_PUBLIC_ORIGINS;
    if (previous.hosts !== undefined) process.env.DRAMA_ALLOWED_HOSTS = previous.hosts;
    if (previous.origins !== undefined) process.env.DRAMA_PUBLIC_ORIGINS = previous.origins;
  };
  restore();
  t.after(async () => {
    await new Promise(resolve => server.close(resolve));
    restore();
    fs.rmSync(root, { recursive: true, force: true });
  });

  assert.equal((await call(port, { Host: `127.0.0.1:${port}` })).status, 200);
  assert.equal((await call(port, { Host: `localhost:${port}` })).status, 200);

  const blocked = await call(port, { Host: "drama.example.test" });
  assert.equal(blocked.status, 403);
  assert.match(blocked.body, /仅限本机/);

  process.env.DRAMA_ALLOWED_HOSTS = "drama.example.test, second.example.test";
  const proxied = await call(port, { Host: "drama.example.test" });
  assert.equal(proxied.status, 200);
  assert.equal((await call(port, { Host: "second.example.test" })).status, 200);
  assert.equal((await call(port, { Host: "other.example.test" })).status, 403);

  const crossSite = await call(port, { Host: "drama.example.test", Origin: "https://attacker.example" });
  assert.equal(crossSite.status, 403);
  assert.match(crossSite.body, /跨站/);

  process.env.DRAMA_PUBLIC_ORIGINS = "https://drama.example.test";
  assert.equal((await call(port, { Host: "drama.example.test", Origin: "https://drama.example.test" })).status, 200);
  assert.equal((await call(port, { Host: "drama.example.test", Origin: "https://attacker.example" })).status, 403);
});
