"use strict";

function concurrencyConfig(input = {}, env = process.env) {
  const fields = { projects: ["DRAMA_MAX_PROJECTS", 4], llm: ["DRAMA_LLM_CONCURRENCY", 2], images: ["DRAMA_IMAGE_CONCURRENCY", 2], videos: ["DRAMA_VIDEO_CONCURRENCY", 3] };
  return Object.fromEntries(Object.entries(fields).map(([key, [name, fallback]]) => {
    const value = Number(input[key] ?? env[name] ?? fallback);
    if (!Number.isInteger(value) || value < 1 || value > 8) throw new Error(`${name} must be an integer from 1 to 8.`);
    return [key, value];
  }));
}

// FIFO slots cover the whole request, not just submission. Rejections always release a slot.
function createLimiter(limit) {
  if (!Number.isInteger(limit) || limit < 1) throw new Error("Invalid concurrency limit.");
  let active = 0;
  const queue = [];
  function drain() {
    while (active < limit && queue.length) {
      const item = queue.shift(); active++;
      Promise.resolve().then(item.work).then(
        value => { active--; drain(); item.resolve(value); },
        error => { active--; drain(); item.reject(error); },
      );
    }
  }
  return {
    run(work) { return new Promise((resolve, reject) => { queue.push({ work, resolve, reject }); drain(); }); },
    snapshot() { return { limit, active, queued: queue.length }; },
  };
}

module.exports = { concurrencyConfig, createLimiter };
