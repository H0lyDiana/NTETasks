/* 异环 · 都市手账 — 云端存档适配层
 *
 * 对外只暴露 window.NTE_CLOUD：
 *   ready()            云端是否可用
 *   login(name)        -> { id, name, data }
 *   pull(id)           -> { data }
 *   push(id, data)     -> true
 *
 * 走 CloudBase 云函数的 HTTP 访问服务，用普通 fetch，不依赖 SDK：
 * 请求体用 text/plain 避免浏览器发预检请求，云函数那边兼容两种入参形态。
 */
(function () {
  "use strict";

  var CFG = window.NTE_CLOUD_CONFIG || {};
  var URL = (CFG.endpoint || "").trim();
  var TIMEOUT = 12000;

  function ready() {
    return !!URL;
  }

  // 云函数 HTTP 访问服务可能原样返回 { statusCode, headers, body }
  function unwrap(data) {
    if (data && typeof data.body === "string" && typeof data.statusCode === "number") {
      try { return JSON.parse(data.body); } catch (e) { return data; }
    }
    return data;
  }

  async function call(action, payload) {
    if (!URL) throw new Error("云端未配置");

    var body = Object.assign({ action: action }, payload || {});
    var ctrl = typeof AbortController !== "undefined" ? new AbortController() : null;
    var timer = ctrl ? setTimeout(function () { ctrl.abort(); }, TIMEOUT) : null;

    var resp;
    try {
      resp = await fetch(URL, {
        method: "POST",
        mode: "cors",
        credentials: "omit",
        cache: "no-store",
        headers: { "Content-Type": "text/plain;charset=UTF-8" },
        body: JSON.stringify(body),
        signal: ctrl ? ctrl.signal : undefined
      });
    } catch (e) {
      if (timer) clearTimeout(timer);
      throw new Error(e && e.name === "AbortError" ? "连接云端超时" : "连不上云端");
    }
    if (timer) clearTimeout(timer);

    var data = null;
    try {
      data = unwrap(await resp.json());
    } catch (e) {
      throw new Error("云端返回异常（HTTP " + resp.status + "）");
    }
    if (!resp.ok || !data || data.ok === false) {
      throw new Error((data && data.error) || ("云端返回异常（HTTP " + resp.status + "）"));
    }
    return data;
  }

  window.NTE_CLOUD = {
    ready: ready,
    login: function (name) { return call("login", { name: name }); },
    pull: function (id) { return call("pull", { userId: id }); },
    push: function (id, data) { return call("save", { userId: id, data: data }); }
  };
})();
