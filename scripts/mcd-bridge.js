#!/usr/bin/env node
/**
 * mcd-bridge.js — 麦当劳官方 MCP 的本地 stdio↔HTTP 桥接器（零依赖，Node >= 18）
 *
 * 解决的问题：部分桌面客户端（如 WorkBuddy）直连 https://mcp.mcd.cn 时，
 * Windows schannel 的 TLS 证书吊销检查离线失败（CRYPT_E_REVOCATION_OFFLINE），
 * 导致 MCP 加载失败。本桥接器以 stdio MCP Server 形式被客户端拉起，
 * 用 Node fetch（不做 Windows 吊销检查）转发 JSON-RPC 到官方 HTTP 端点。
 *
 * 使用：Token 从环境变量 MCD_MCP_TOKEN 读取，绝不硬编码。
 *   MCD_MCP_TOKEN=your_token node mcd-bridge.js
 */
const BASE = process.env.MCD_MCP_URL || "https://mcp.mcd.cn/mcp-servers/mcd-mcp";
const TOKEN = process.env.MCD_MCP_TOKEN;

if (!TOKEN) {
  // MCP stdio 协议下无法与客户端完成握手，输出错误后退出
  process.stderr.write("[mcd-bridge] missing env MCD_MCP_TOKEN\n");
  process.exit(1);
}

let sessionId = null;

const readline = require("readline");
const rl = readline.createInterface({ input: process.stdin, terminal: false });

async function forward(raw, msg) {
  const headers = {
    "Content-Type": "application/json",
    "Accept": "application/json, text/event-stream",
    "Authorization": "Bearer " + TOKEN
  };
  if (sessionId) headers["Mcp-Session-Id"] = sessionId;
  const res = await fetch(BASE, { method: "POST", headers, body: raw });
  const sid = res.headers.get("mcp-session-id");
  if (sid) sessionId = sid;

  // 通知类消息（无 id）无需回包（服务端返回 202）
  if (msg.id === undefined || msg.id === null) return;

  const ct = (res.headers.get("content-type") || "").toLowerCase();
  if (ct.includes("text/event-stream")) {
    const text = await res.text();
    let out = null;
    for (const l of text.split("\n")) {
      if (!l.startsWith("data:")) continue;
      try {
        const j = JSON.parse(l.slice(5).trim());
        if (j.id === msg.id) out = j; // 取匹配 id 的响应
      } catch (_) {}
    }
    if (out) process.stdout.write(JSON.stringify(out) + "\n");
  } else {
    const body = await res.text();
    if (body.trim()) process.stdout.write(body.trim() + "\n");
  }
}

rl.on("line", (line) => {
  const raw = line.trim();
  if (!raw) return;
  let msg;
  try { msg = JSON.parse(raw); } catch (_) { return; }
  forward(raw, msg).catch((e) => {
    if (msg.id !== undefined && msg.id !== null) {
      process.stdout.write(JSON.stringify({
        jsonrpc: "2.0", id: msg.id,
        error: { code: -32603, message: "bridge forward failed: " + String(e && e.message || e) }
      }) + "\n");
    }
  });
});

process.on("SIGINT", () => process.exit(0));
process.on("SIGTERM", () => process.exit(0));
