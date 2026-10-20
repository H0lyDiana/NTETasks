"use strict";
/**
 * 异环 · 都市手账 — 账号与存档云函数
 *
 * 只用用户名登录（没有密码），整份进度存在 PostgreSQL 的 public.users 表里。
 *
 * 本环境是 CloudBase PostgreSQL 模式（没有文档型数据库），云函数里的 rdb 客户端
 * 以 anon 角色出网，表本身开了 RLS 且不对外授权，所以读写都经由三个
 * SECURITY DEFINER 的数据库函数完成（见 cloudbase/migrations）：
 *   nte_login(p_name)         找到或创建账号，返回 { id, name, data }
 *   nte_pull(p_id)            读一个账号
 *   nte_save(p_id, p_data)    写回整包进度
 * 只暴露这三个动作，匿名角色拿不到列表或任意查询。
 *
 * 请求体（text/plain 里包一段 JSON，或直接 callFunction 传对象）：
 *   { action: "login", name }
 *   { action: "pull",  userId }
 *   { action: "save",  userId, data }
 *
 * 走「云函数 HTTP 访问服务」时返回 { statusCode, headers, body }，
 * 让浏览器拿到正确的 CORS 头；走 SDK callFunction 时就是普通对象。
 */

const tcb = require("@cloudbase/node-sdk");

const app = tcb.init({ env: tcb.SYMBOL_CURRENT_ENV });
const db = app.rdb();
const NAME_MAX = 16;
const DATA_MAX = 200 * 1024; // 存档上限 200KB，正常进度只有几 KB

const ok = (extra) => Object.assign({ ok: true }, extra || {});
const fail = (msg) => ({ ok: false, error: msg });

function corsHeaders() {
  return {
    "Content-Type": "application/json; charset=utf-8",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Max-Age": "86400"
  };
}

// 兼容三种入参：HTTP 网关（body 可能是 base64）、HTTP 访问服务（body 是字符串）、
// callFunction（直接给对象）
function parseEvent(event) {
  if (!event) return {};
  const body = event.body;
  if (typeof body === "string" && body.trim()) {
    let text = body;
    if (event.isBase64Encoded) {
      try {
        text = Buffer.from(body, "base64").toString("utf8");
      } catch (e) {
        /* 保持原样 */
      }
    }
    try {
      return JSON.parse(text);
    } catch (e) {
      /* 再试一次把它当 base64 */
    }
    try {
      const decoded = Buffer.from(body, "base64").toString("utf8");
      if (decoded.trim().charAt(0) === "{") return JSON.parse(decoded);
    } catch (e) {
      /* 放弃，按空对象处理 */
    }
    return {};
  }
  if (body && typeof body === "object") return body;
  return event;
}

function cleanName(raw) {
  return String(raw == null ? "" : raw).replace(/\s+/g, " ").trim().slice(0, NAME_MAX);
}

const normalizeId = (v) => (v == null ? null : String(v));

async function callRpc(fn, args) {
  const res = (await db.rpc(fn, args)) || {};
  if (res.error) {
    const err = new Error(res.error.message || res.error.details || "数据库操作失败");
    err.code = res.error.code;
    throw err;
  }
  return res.data;
}

const firstRow = (rows) => (Array.isArray(rows) ? rows[0] : rows) || null;

async function login(rawName) {
  const name = cleanName(rawName);
  if (!name) return fail("用户名不能为空");

  const row = firstRow(await callRpc("nte_login", { p_name: name }));
  if (!row) return fail("创建账号失败");
  return ok({ id: normalizeId(row.id), name: row.name, data: row.data || null });
}

async function pull(userId) {
  if (!userId) return fail("缺少 userId");
  const row = firstRow(await callRpc("nte_pull", { p_id: Number(userId) }));
  if (!row) return fail("账号不存在");
  return ok({ id: normalizeId(row.id), name: row.name, data: row.data || null });
}

async function save(userId, data) {
  if (!userId) return fail("缺少 userId");
  if (!data || typeof data !== "object") return fail("存档格式不对");

  let text;
  try {
    text = JSON.stringify(data);
  } catch (e) {
    return fail("存档无法序列化");
  }
  if (text.length > DATA_MAX) return fail("存档过大，无法保存");

  await callRpc("nte_save", { p_id: Number(userId), p_data: JSON.parse(text) });
  return ok({ updatedAt: Date.now() });
}

async function run(input) {
  const action = (input && input.action) || "";
  switch (action) {
    case "login": return await login(input.name);
    case "pull": return await pull(input.userId);
    case "save": return await save(input.userId, input.data);
    default: return fail("未知操作：" + action);
  }
}

exports.main = async (event) => {
  if (event && String(event.httpMethod || "").toUpperCase() === "OPTIONS") {
    return { statusCode: 204, headers: corsHeaders(), body: "" };
  }
  let result;
  try {
    result = await run(parseEvent(event));
  } catch (e) {
    console.error("[nte-api]", e);
    result = fail((e && e.message) || "云端异常");
  }
  return { statusCode: 200, headers: corsHeaders(), body: JSON.stringify(result) };
};
