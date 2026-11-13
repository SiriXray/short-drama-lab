"use strict";

// Chat Completions compatibility layer.
//
// The workbench builds OpenAI *Responses* payloads (`input`, `instructions`,
// `text.format`, `max_output_tokens`) and reads Responses output text. Some
// deployments must talk to providers that only expose `/chat/completions`
// (for example DashScope compatible mode or DeepSeek). Setting
// `ATELIER_PROTOCOL=chat` converts those payloads on the way out and normalises
// the answer back into the Responses shape so no caller has to change.

const DEFAULT_MAX_TOKENS = 16384;
const ROLES = new Set(["system", "assistant", "user"]);

function active(env = process.env) {
  return String(env.ATELIER_PROTOCOL || "").toLowerCase() === "chat";
}

function isResponsesPayload(payload) {
  return Boolean(payload && Array.isArray(payload.input) && !Array.isArray(payload.messages));
}

function chatEndpoint(endpoint) {
  const value = String(endpoint || "");
  return /\/responses\/?$/.test(value) ? value.replace(/\/responses\/?$/, "/chat/completions") : value;
}

function maxTokens(payload, env = process.env) {
  const limit = Math.max(256, Math.min(32768, Number(env.ATELIER_CHAT_MAX_TOKENS || DEFAULT_MAX_TOKENS)));
  const requested = Number(payload?.max_output_tokens ?? payload?.max_completion_tokens ?? payload?.max_tokens ?? 0);
  if (!Number.isFinite(requested) || requested <= 0) return limit;
  return Math.max(256, Math.min(Math.round(requested), limit));
}

function partImageUrl(part) {
  const value = part?.image_url;
  if (typeof value === "string") return value;
  if (value && typeof value.url === "string") return value.url;
  if (typeof part?.url === "string") return part.url;
  return "";
}

function contentParts(content) {
  if (typeof content === "string") return content ? [{ type: "text", text: content }] : [];
  const parts = [];
  for (const part of Array.isArray(content) ? content : []) {
    if ((part?.type === "input_text" || part?.type === "text") && typeof part.text === "string" && part.text) {
      parts.push({ type: "text", text: part.text });
      continue;
    }
    if (part?.type === "input_image" || part?.type === "image_url") {
      const url = partImageUrl(part);
      if (url) parts.push({ type: "image_url", image_url: { url } });
    }
  }
  return parts;
}

function toChatBody(payload, env = process.env) {
  const messages = [];
  if (typeof payload?.instructions === "string" && payload.instructions.trim()) {
    messages.push({ role: "system", content: payload.instructions });
  }
  for (const item of Array.isArray(payload?.input) ? payload.input : []) {
    const parts = contentParts(item?.content);
    if (!parts.length) continue;
    const role = ROLES.has(item?.role) ? item.role : "user";
    messages.push({ role, content: parts.length === 1 && parts[0].type === "text" ? parts[0].text : parts });
  }
  if (!messages.some((message) => message.role !== "system")) messages.push({ role: "user", content: "" });

  const body = { model: payload?.model || "", messages, max_tokens: maxTokens(payload, env), stream: false };
  const format = payload?.text?.format;
  if (format?.type === "json_schema" && format.schema) {
    body.response_format = { type: "json_schema", json_schema: { name: format.name || "result", schema: format.schema } };
  } else if (format?.type === "json_object") {
    body.response_format = { type: "json_object" };
  }
  return body;
}

function fromChatResponse(data) {
  const choice = (data?.choices || [])[0] || {};
  const message = choice.message || {};
  const text = typeof message.content === "string"
    ? message.content
    : Array.isArray(message.content)
      ? message.content.map((part) => (typeof part?.text === "string" ? part.text : "")).join("")
      : "";
  const truncated = choice.finish_reason === "length";
  return {
    id: data?.id || null,
    object: "response",
    status: truncated ? "incomplete" : "completed",
    incomplete_details: truncated ? { reason: "max_output_tokens" } : null,
    output_text: text,
    output: [{ type: "message", role: "assistant", content: [{ type: "output_text", text }] }],
    usage: data?.usage || null,
  };
}

module.exports = { active, isResponsesPayload, chatEndpoint, maxTokens, toChatBody, fromChatResponse, DEFAULT_MAX_TOKENS };
