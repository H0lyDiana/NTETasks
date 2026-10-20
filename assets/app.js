/* 异环 · 都市手账 — 交互逻辑 */
(function () {
  "use strict";

  const DATA = window.NTE_DATA;
  const STORE_KEY = "nte.companion.v1";
  const THEME_KEY = "nte.companion.theme";
  const SESSION_KEY = "nte.companion.session";

  /* 固定国服（北京时间），不再提供区服切换 */
  const TZ_OFFSET = 480; // 分钟
  const DAY_MS = 86400000;

  const WEEK = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];
  const RESET_ICON = { daily: "daily", weekly: "grid", special: "star", monthly: "monthly" };
  const LIST_HINT = {
    daily: "每日 05:00 自动重置",
    weekly: "每周一 05:00 自动重置",
    monthly: "每月 1 日 00:00 重置",
    all: "全部任务汇总，按周期顺序排列"
  };
  const FALLBACK_STEPS = ["无"];
  const THEME_COLOR = { dark: "#0a0d10", light: "#fbf6f0" };

  const state = {
    done: [], cat: "daily", selected: null, name: "",
    started: {}, counts: {}, perHour: {}, lastReset: {}, doneAt: {}, user: null,
    view: "tasks" // tasks = 任务列表，calendar = 工具里的版本日历（不写进存档）
  };

  const $ = (s) => document.querySelector(s);
  const el = {
    nav: $("#navigation"),
    tools: $("#tools"),
    calendarView: $("#calendar-view"),
    calList: $("#cal-list"),
    cafeView: $("#cafe-view"),
    cafeFrame: $("#cafe-frame"),
    cafeIframe: $("#cafe-iframe"),
    workbench: $(".workbench"),
    resetGrid: $("#reset-grid"),
    list: $("#task-list"),
    listPanel: $(".list-panel"),
    listTitle: $("#list-title"),
    listSub: $("#list-sub"),
    listHint: $("#list-hint"),
    ringFg: $("#ring-fg"),
    ringLabel: $("#ring-label"),
    detailCount: $("#detail-count"),
    detailChip: $("#detail-chip"),
    detailTitle: $("#detail-title"),
    detailDue: $("#detail-due"),
    detailMech: $("#detail-mech"),
    detailSteps: $("#detail-steps"),
    markDone: $("#mark-done"),
    profileName: $("#profile-name"),
    profileLevel: $("#profile-level"),
    profileAvatar: $("#profile-avatar"),
    syncLabel: $("#sync-label"),
    today: $("#today-label"),
    checked: $("#checked-label"),
    toast: $("#toast"),
    themeBtn: $("#theme-btn"),
    sidebar: $("#sidebar"),
    scrim: $("#scrim")
  };

  const esc = (s) =>
    String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const pad = (n) => String(n).padStart(2, "0");
  const icon = (id) => `<svg class="ic"><use href="#i-${id}"/></svg>`;

  /* ---------------- 存储 ---------------- */
  // 未登录写公共的游客档，登录后按账号分开存，切号不会串进度
  const storeKey = () => (state.user ? `${STORE_KEY}:u${state.user.id}` : STORE_KEY);
  const knownIds = () => new Set(DATA.tasks.map((t) => t.id));

  // 重置结算点：键是分类 key（daily / weekly / monthly）或 "s<任务 id>"，值是时间戳
  function stampMap(obj) {
    const out = {};
    if (!obj || typeof obj !== "object") return out;
    Object.keys(obj).forEach((k) => {
      const v = Number(obj[k]);
      if (Number.isFinite(v) && v > 0) out[k] = v;
    });
    return out;
  }

  // 勾选状态的最后改动时间（勾上 / 取消都记）：多端合并时用它判断哪边更新
  function doneStampMap(obj) {
    const out = {};
    const known = knownIds();
    if (!obj || typeof obj !== "object") return out;
    Object.keys(obj).forEach((k) => {
      const id = Number(k);
      const v = Number(obj[k]);
      if (known.has(id) && Number.isFinite(v) && v > 0) out[id] = v;
    });
    return out;
  }

  // 计时起点 / 完成次数 / 每小时收益：按任务 id 存，丢掉数据里已经没了的
  function numMap(obj) {
    const out = {};
    const known = knownIds();
    if (!obj || typeof obj !== "object") return out;
    Object.keys(obj).forEach((k) => {
      const id = Number(k);
      const v = Number(obj[k]);
      if (known.has(id) && Number.isFinite(v) && v >= 0) out[id] = v;
    });
    return out;
  }

  // 把任意来源（本机 / 云端）的存档收敛成可信的字段
  function normalize(raw) {
    const s = raw && typeof raw === "object" ? raw : {};
    const known = knownIds();
    const doneAt = doneStampMap(s.doneAt);
    const picked = Array.isArray(s.done) ? [...new Set(s.done)].filter((id) => known.has(id)) : [];
    return {
      done: [...unifyLinks(picked, doneAt)],
      name: typeof s.name === "string" ? s.name : "",
      cat: DATA.categories.some((c) => c.key === s.cat) ? s.cat : "daily",
      started: numMap(s.started),
      counts: numMap(s.counts),
      perHour: numMap(s.perHour),
      lastReset: stampMap(s.lastReset),
      doneAt: doneAt
    };
  }

  function applyData(raw) {
    const d = normalize(raw);
    state.done = d.done;
    state.name = d.name;
    state.cat = d.cat;
    state.started = d.started;
    state.counts = d.counts;
    state.perHour = d.perHour;
    state.lastReset = d.lastReset;
    state.doneAt = d.doneAt;
  }

  function snapshot() {
    return {
      done: state.done.slice(),
      name: state.name,
      cat: state.cat,
      started: Object.assign({}, state.started),
      counts: Object.assign({}, state.counts),
      perHour: Object.assign({}, state.perHour),
      lastReset: Object.assign({}, state.lastReset),
      doneAt: Object.assign({}, state.doneAt)
    };
  }

  // 勾选状态按「最后一次改动时间」逐条判定：取消勾选、周期重置也能同步过去，
  // 不会被云端那份旧存档按并集又勾回来。时间戳缺失（旧存档）按 0 处理，相等时保留已完成。
  function mergeDone(b, l) {
    const bSet = new Set(b.done);
    const lSet = new Set(l.done);
    const ids = new Set(b.done.concat(l.done));
    Object.keys(b.doneAt).forEach((k) => ids.add(Number(k)));
    Object.keys(l.doneAt).forEach((k) => ids.add(Number(k)));
    const done = [];
    ids.forEach((id) => {
      const bHas = bSet.has(id);
      const lHas = lSet.has(id);
      let keep = bHas || lHas;
      if (bHas !== lHas) {
        const bt = b.doneAt[id] || 0;
        const lt = l.doneAt[id] || 0;
        if (lt !== bt) keep = lt > bt ? lHas : bHas;
      }
      if (keep) done.push(id);
    });
    // 保持列表顺序稳定：按 data.js 里的任务顺序排
    const order = new Map(DATA.tasks.map((t, i) => [t.id, i]));
    return done.sort((x, y) => (order.get(x) ?? 0) - (order.get(y) ?? 0));
  }

  // 登录 / 进页面时的合并：云端为基础，本机进度并进来
  // 勾选取「最后一次改动」、次数取较大值、本机正在跑的计时与收益优先
  function mergeData(base, local) {
    const b = normalize(base);
    const l = normalize(local);
    const counts = Object.assign({}, b.counts);
    Object.keys(l.counts).forEach((k) => {
      counts[k] = Math.max(counts[k] || 0, l.counts[k]);
    });
    // 重置结算点取较晚的一边：已经清过的周期不重复清
    const lastReset = Object.assign({}, b.lastReset);
    Object.keys(l.lastReset).forEach((k) => {
      lastReset[k] = Math.max(lastReset[k] || 0, l.lastReset[k]);
    });
    // 勾选时间戳取较晚的一边，供下一次合并判断
    const doneAt = Object.assign({}, b.doneAt);
    Object.keys(l.doneAt).forEach((k) => {
      doneAt[k] = Math.max(doneAt[k] || 0, l.doneAt[k]);
    });
    return normalize({
      done: mergeDone(b, l),
      name: l.name || b.name,
      cat: l.cat || b.cat,
      started: Object.assign({}, b.started, l.started),
      counts: counts,
      perHour: Object.assign({}, b.perHour, l.perHour),
      lastReset: lastReset,
      doneAt: doneAt
    });
  }

  function load() {
    try {
      const raw = localStorage.getItem(storeKey());
      applyData(raw ? JSON.parse(raw) : null);
    } catch (e) { /* 忽略损坏的存档 */ }
  }

  function save(thenSync) {
    try {
      localStorage.setItem(storeKey(), JSON.stringify(snapshot()));
    } catch (e) { /* 无痕模式下忽略 */ }
    if (thenSync !== false) scheduleSync();
  }

  function readSession() {
    try {
      const s = JSON.parse(localStorage.getItem(SESSION_KEY) || "null");
      if (s && s.id) return { id: String(s.id), name: String(s.name || "") };
    } catch (e) { /* 忽略 */ }
    return null;
  }
  function writeSession(user) {
    try {
      if (user) localStorage.setItem(SESSION_KEY, JSON.stringify(user));
      else localStorage.removeItem(SESSION_KEY);
    } catch (e) { /* 忽略 */ }
  }

  /* ---------------- 云端同步 ---------------- */
  const CLOUD = window.NTE_CLOUD || null;
  let syncTimer = null;
  let syncing = false;
  let syncAgain = false;
  let syncFailed = false;
  let dirty = false;

  const cloudOn = () => !!(CLOUD && CLOUD.ready());

  function scheduleSync() {
    dirty = true;
    if (!state.user || !cloudOn()) return;
    clearTimeout(syncTimer);
    syncTimer = setTimeout(pushCloud, 900);
  }

  async function pushCloud() {
    if (!state.user || !cloudOn()) return;
    if (syncing) { syncAgain = true; return; }
    syncing = true;
    try {
      await CLOUD.push(state.user.id, snapshot());
      dirty = false;
      syncFailed = false;
      setSyncLabel(true);
    } catch (e) {
      dirty = true;
      if (!syncFailed) {
        syncFailed = true;
        setSyncLabel(false);
        toast("云端同步失败，稍后自动重试");
      }
      clearTimeout(syncTimer);
      syncTimer = setTimeout(pushCloud, 15000);
    } finally {
      syncing = false;
      if (syncAgain) { syncAgain = false; scheduleSync(); }
    }
  }

  async function pullCloud() {
    if (!state.user || !cloudOn()) return;
    try {
      const res = await CLOUD.pull(state.user.id);
      applyData(mergeData(res && res.data, snapshot()));
      // 云端存档也带着上次结算点，合并后立刻结算，换设备同样按周期清
      settleResets(Date.now());
      save(false);
      renderAll();
      syncFailed = false;
      setSyncLabel(true);
      await pushCloud();
    } catch (e) {
      syncFailed = true;
      setSyncLabel(false);
    }
  }

  function setSyncLabel(ok) {
    if (!el.syncLabel) return;
    if (state.user) {
      el.syncLabel.textContent = ok
        ? `已同步到云端 · ${state.user.name}`
        : "云端同步异常 · 本地已保存";
    } else {
      el.syncLabel.textContent = "进度自动保存在本机 · 换设备需重新勾选";
    }
  }

  /* ---------------- 时间 ---------------- */
  // 把“北京时间墙上时刻”换算成真实时间戳
  function wallToReal(y, m, d, h, off) {
    return Date.UTC(y, m, d, h, 0, 0) - off * 60000;
  }
  // 取北京时间墙上的年月日时分
  function wall(ms, off) {
    const t = new Date(ms + off * 60000);
    return {
      y: t.getUTCFullYear(), m: t.getUTCMonth(), d: t.getUTCDate(),
      h: t.getUTCHours(), mi: t.getUTCMinutes(), dow: t.getUTCDay()
    };
  }

  function nextReset(kind, now) {
    const w = wall(now, TZ_OFFSET);
    switch (kind) {
      case "daily": {
        let t = wallToReal(w.y, w.m, w.d, 5, TZ_OFFSET);
        if (t <= now) t += DAY_MS;
        return t;
      }
      case "weekly": {
        const add = (1 - w.dow + 7) % 7;
        let t = wallToReal(w.y, w.m, w.d + add, 5, TZ_OFFSET);
        if (t <= now) t += 7 * DAY_MS;
        return t;
      }
      case "monthly": {
        let t = wallToReal(w.y, w.m + 1, 1, 0, TZ_OFFSET);
        if (t <= now) t = wallToReal(w.y, w.m + 2, 1, 0, TZ_OFFSET);
        return t;
      }
      default:
        return null;
    }
  }

  /* ---------------- 特殊任务：开始时间 + 重置周期，都写在任务本身 ---------------- */
  const SPECIAL_CAT = DATA.categories.find((c) => c.reset === "custom") || null;
  const specialTasks = () => (SPECIAL_CAT ? DATA.tasks.filter((t) => t.cat === SPECIAL_CAT.key) : []);
  const DEFAULT_CYCLE = 7; // 没写 every 时按 7 天算

  const startOf = (t) => {
    const v = Date.parse((t && t.startAt) || "");
    return Number.isFinite(v) ? v : null;
  };
  const cycleOf = (t) => {
    const n = Number(t && t.every);
    return Number.isFinite(n) && n > 0 ? n : DEFAULT_CYCLE;
  };
  // 从开始时间按周期往后数，取严格晚于 now 的第一个重置点
  function nextCycleReset(t, now) {
    const start = startOf(t);
    if (start == null) return null;
    const step = cycleOf(t) * DAY_MS;
    if (now < start) return start;
    return start + (Math.floor((now - start) / step) + 1) * step;
  }
  // 特殊任务：startAt + N×every 里已经过去的最近一次
  function lastCycleReset(t, now) {
    const start = startOf(t);
    if (start == null) return null;
    const step = cycleOf(t) * DAY_MS;
    if (now < start) return null;
    return start + Math.floor((now - start) / step) * step;
  }
  // 已经过去的最近一次分类重置点（每日 05:00 / 每周一 05:00 / 每月 1 日 00:00）
  function lastResetBoundary(kind, now) {
    const w = wall(now, TZ_OFFSET);
    switch (kind) {
      case "daily": {
        const t = wallToReal(w.y, w.m, w.d, 5, TZ_OFFSET);
        return t <= now ? t : wallToReal(w.y, w.m, w.d - 1, 5, TZ_OFFSET);
      }
      case "weekly": {
        const add = (1 - w.dow + 7) % 7;
        const t = wallToReal(w.y, w.m, w.d + add, 5, TZ_OFFSET);
        return t <= now ? t : wallToReal(w.y, w.m, w.d + add - 7, 5, TZ_OFFSET);
      }
      case "monthly": {
        const t = wallToReal(w.y, w.m, 1, 0, TZ_OFFSET);
        return t <= now ? t : wallToReal(w.y, w.m - 1, 1, 0, TZ_OFFSET);
      }
      default:
        return null;
    }
  }
  // 版本卡可以固定跟随某条特殊任务（分类上的 cardTask = 任务 id）；
  // 没指定时才退回「全部特殊任务里最近的一次重置」
  const CARD_TASK = SPECIAL_CAT && SPECIAL_CAT.cardTask != null ? Number(SPECIAL_CAT.cardTask) : null;
  function versionDeadline(now) {
    if (CARD_TASK != null) {
      const t = specialTasks().find((x) => Number(x.id) === CARD_TASK);
      return t ? nextCycleReset(t, now) : null;
    }
    const list = specialTasks().map((t) => nextCycleReset(t, now)).filter((v) => v != null);
    return list.length ? Math.min.apply(null, list) : null;
  }
  const resetKinds = (now) =>
    new Set(
      specialTasks()
        .filter((t) => !LINK_OWNER.has(t.id)) // 从属任务不按自己的周期走，不参与比较
        .map((t) => nextCycleReset(t, now))
        .filter((v) => v != null)
    ).size;
  const deadlineOf = (cat, now) => (cat.reset === "custom" ? versionDeadline(now) : nextReset(cat.reset, now));
  const clockText = (cat, t, now) => (t == null ? "—" : timeHtml(humanIn(t - now)));
  const shortDue = (ts) => {
    const w = wall(ts, TZ_OFFSET);
    return `${w.m + 1}/${w.d} ${pad(w.h)}:00`;
  };
  const longDue = (ts) => {
    const w = wall(ts, TZ_OFFSET);
    return `${w.m + 1}月${w.d}日 ${pad(w.h)}:00`;
  };
  function remainText(ts, now) {
    const diff = ts - now;
    if (diff <= 0) return "即将重置";
    const d = Math.floor(diff / DAY_MS);
    if (d >= 1) return `剩 ${d} 天`;
    const h = Math.floor(diff / 3600000);
    if (h >= 1) return `剩 ${h} 小时`;
    return `剩 ${Math.max(1, Math.floor(diff / 60000))} 分钟`;
  }

  function humanIn(ms) {
    if (ms <= 0) return { d: 0, str: "00:00:00" };
    const total = Math.floor(ms / 1000);
    const d = Math.floor(total / 86400);
    const h = Math.floor((total % 86400) / 3600);
    const m = Math.floor((total % 3600) / 60);
    const s = total % 60;
    return { d, str: `${pad(h)}:${pad(m)}:${pad(s)}` };
  }
  const timeHtml = (h) => `${h.d > 0 ? `<span class="d">${h.d}天</span>` : ""}${h.str}`;

  // 拆成若干 <span>，窄栏时只在分隔处折行；周期类统一为「日期 · 时间」，特殊任务显示「重置 …」
  function resetSubLabel(cat, ts, prefix) {
    const w = wall(ts, TZ_OFFSET);
    if (cat.reset === "custom") {
      return [`<span>${prefix || ""}重置 ${w.m + 1}月${w.d}日</span>`, `<span>${pad(w.h)}:00</span>`].join("");
    }
    if (!RESET_ICON[cat.reset]) return "不自动重置";
    const date = `${w.m + 1}月${w.d}日${WEEK[w.dow]}`;
    return [`<span>${date}</span>`, `<span>${pad(w.h)}:00</span>`].join("");
  }

  // 特殊任务列表的提示：所有重置时间一致就直说，不一致则指向列表右侧
  // 每段用 nowrap 包住，窄屏只在「·」处折行，不会把「每 7 天」拆成两半
  function customResetHint() {
    const now = Date.now();
    const rows = specialTasks()
      .filter((t) => !LINK_OWNER.has(t.id)) // 从属任务不按自己的周期重置，别算进来
      .map((t) => ({ at: nextCycleReset(t, now), every: cycleOf(t) }))
      .filter((r) => r.at != null);
    if (!rows.length) return "开始时间未设置，可在 data.js 里补";
    const at = [...new Set(rows.map((r) => r.at))];
    if (at.length > 1) return "各任务重置时间不同";
    const every = [...new Set(rows.map((r) => r.every))];
    const tail = every.length === 1 ? `<span class="nb"> · 每 ${every[0]} 天</span>` : "";
    return `<span class="nb">下次重置 ${longDue(at[0])}</span>${tail}`;
  }

  /* ---------------- 任务机制（后台在 data.js 里给任务配了字段才生效） ---------------- */
  // clock 完成后多少小时重置 / earn 每小时收益累计到多少重置 / countStep 每完成一次加多少
  const numOf = (v) => {
    const n = Number(v);
    return Number.isFinite(n) && n > 0 ? n : 0;
  };
  const mechOf = (t) => ({
    clock: numOf(t && t.clock),
    earn: numOf(t && t.earn),
    countStep: numOf(t && t.countStep),
    minor: !!(t && t.minor) // 次要任务：排在已完成之后，不计入总次数
  });
  const hasMech = (m) => !!(m.clock || m.earn || m.countStep);

  /* ---------------- 关联任务（后台在 data.js 里给主任务配 link: [id, ...]） ---------------- */
  // 主任务 link 里列出的就是从属任务。整组规则：
  //   1. 主任务完成 → 从属任务全部完成；从属任务完成不影响主任务和其他从属（单向）
  //   2. 主任务重置 → 从属任务一起重置（只清跟随主任务完成的那些）
  //   3. 从属任务自己到点（clock / earn）或所属分类到重置点，只要主任务还没重置，就不许它重置
  const LINK_CHILDREN = new Map(); // 主任务 id -> [从属 id]
  const LINK_OWNER = new Map();    // 从属 id -> 主任务 id

  (function buildLinks() {
    const known = new Set(DATA.tasks.map((t) => t.id));
    // 自己配了 link 的任务是主任务，不能再被别人收成从属（不支持组套组）
    const claimers = new Set();
    DATA.tasks.forEach((t) => {
      if (Array.isArray(t.link) && t.link.length) claimers.add(t.id);
    });
    DATA.tasks.forEach((t) => {
      if (!Array.isArray(t.link) || !t.link.length) return;
      if (LINK_OWNER.has(t.id)) return; // 已经是别人的从属，它自己的 link 忽略
      const kids = [];
      t.link.forEach((raw) => {
        const id = Number(raw);
        if (!Number.isFinite(id) || id === t.id) return;
        if (!known.has(id) || LINK_OWNER.has(id) || claimers.has(id) || kids.includes(id)) return;
        LINK_OWNER.set(id, t.id);
        kids.push(id);
      });
      if (kids.length) LINK_CHILDREN.set(t.id, kids);
    });
  })();

  // 一条任务所在的整组（自己也在里面）；没配 link 就是它自己
  function groupOf(id) {
    const owner = LINK_OWNER.get(id);
    if (owner != null) return [owner].concat(LINK_CHILDREN.get(owner) || []);
    const kids = LINK_CHILDREN.get(id);
    return kids ? [id].concat(kids) : [id];
  }
  // 组里的主任务 id（没配 link 返回 null）
  function ownerOf(id) {
    if (LINK_OWNER.has(id)) return LINK_OWNER.get(id);
    return LINK_CHILDREN.has(id) ? id : null;
  }
  // 撤销 / 重置主任务时，只带那些「跟着主任务一起完成」的从属；
  // 主任务完成之前或之后自己单独完成过的，不算跟随，保留原状态。
  function followingKids(id) {
    const kids = (LINK_CHILDREN.get(id) || []).filter((x) => state.done.includes(x));
    const own = state.doneAt[id] || 0;
    if (!own) return kids; // 旧存档没有时间戳，按整组处理
    return kids.filter((x) => (state.doneAt[x] || 0) === own);
  }
  // 联动是单向的：主任务完成 → 从属全部完成；从属完成不影响主任务。
  // 主任务完成后被单独撤销过的从属（时间戳比主任务晚）保持未完成，不在这里复活。
  function unifyLinks(done, doneAt) {
    const set = new Set(done);
    LINK_CHILDREN.forEach((kids, owner) => {
      if (!set.has(owner)) return;
      const ownerAt = doneAt[owner] || 0;
      kids.forEach((id) => {
        if (set.has(id)) return;
        if ((doneAt[id] || 0) > ownerAt) return; // 之后被单独撤销过，尊重它
        set.add(id);
        if (ownerAt) doneAt[id] = ownerAt;
      });
    });
    return set;
  }

  // 收益按整点跳：满一小时才加一次「每小时收益」
  function earnedOf(id, start, now) {
    if (start == null) return 0;
    const per = numOf(state.perHour[id]);
    if (!per) return 0;
    return Math.floor((now - start) / 3600000) * per;
  }
  const fmtHours = (h) => (h > 0 ? `${h} 小时` : "0 小时");
  const fmtNum = (n) => Math.round(n).toLocaleString("zh-CN");
  const clockLeft = (ms) => {
    const total = Math.max(0, Math.floor(ms / 1000));
    return `${pad(Math.floor(total / 3600))}:${pad(Math.floor((total % 3600) / 60))}:${pad(total % 60)}`;
  };

  /* ---------------- 数据 ---------------- */
  // 列表顺序：未完成 → 已完成 → 次要任务（minor），各组内保持 data.js 里的原始顺序
  function catTasks(key) {
    const base = key === "all" ? DATA.tasks : DATA.tasks.filter((t) => t.cat === key);
    const doneSet = new Set(state.done);
    const todo = [];
    const done = [];
    const minor = [];
    base.forEach((t) => {
      if (t.minor) minor.push(t);
      else if (doneSet.has(t.id)) done.push(t);
      else todo.push(t);
    });
    return todo.concat(done, minor);
  }
  // 一次遍历算出每个分类的已完成/总数，供侧栏与列表共用；次要任务不计入总次数
  function categoryStats() {
    const doneSet = new Set(state.done);
    const stats = {};
    DATA.categories.forEach((c) => { stats[c.key] = { done: 0, total: 0 }; });
    DATA.tasks.forEach((t) => {
      if (t.minor) return;
      const isDone = doneSet.has(t.id);
      [stats[t.cat], stats.all].forEach((s) => {
        if (!s) return;
        s.total++;
        if (isDone) s.done++;
      });
    });
    return stats;
  }

  /* ---------------- 渲染：侧栏 ---------------- */
  function renderNav() {
    const stats = categoryStats();
    el.nav.innerHTML = DATA.categories.map((c, i) => {
      const s = stats[c.key] || { done: 0, total: 0 };
      const divider = i === 4 ? '<div class="nav-divider"></div>' : "";
      const active = state.view === "tasks" && c.key === state.cat;
      return `${divider}<button class="nav-btn${active ? " active" : ""}" data-category="${c.key}">
        ${icon(c.icon)}<span>${c.label}</span><span class="nav-count">${s.done}/${s.total}</span>
      </button>`;
    }).join("");
  }

  // 「工具」分组：版本日历 + 一咖舍（经营计算器）
  const TOOLS = [
    { key: "calendar", icon: "calendar", label: "版本日历" },
    { key: "cafe", icon: "cafe", label: "一咖舍" }
  ];

  function renderTools() {
    el.tools.innerHTML = TOOLS.map((t) => `<button class="nav-btn${state.view === t.key ? " active" : ""}" data-tool="${t.key}">
      ${icon(t.icon)}<span>${t.label}</span>
    </button>`).join("");
  }

  /* ---------------- 渲染：版本日历 ---------------- */
  // 图片统一放在 images/，文件名即版本号；ratio = 高 / 宽，用来撑住占位高度
  const CAL_VERSIONS = [
    { v: "[1.1]游梦洄廊", src: "images/1.1.jpg", ratio: 1.2 },
    { v: "[1.2]九百九十九夜", src: "images/1.2.jpg", ratio: 1.4974 },
    { v: "[1.3]雾中朔望星回", src: "images/1.3.jpg", ratio: 1.8484 },
    { v: "[1.4]祷歌为谁而诵", src: "images/1.4.jpg", ratio: 1.7328 }
  ];

  // 只在第一次进工具页时铺一次 DOM，之后展开状态由浏览器自己保留
  function renderCalendar() {
    if (el.calList.childElementCount) return;
    el.calList.innerHTML = CAL_VERSIONS.map((it) => `
      <details class="cal-item">
        <summary class="cal-head">
          <span class="cal-ver">${esc(it.v)}</span>
          <svg class="ic cal-arrow"><use href="#i-chevron"/></svg>
        </summary>
        <a class="cal-shot" href="${esc(it.src)}" target="_blank" rel="noopener">
          <img data-src="${esc(it.src)}" alt="${esc(it.v)} 版本日历" loading="lazy"
               style="aspect-ratio:1/${it.ratio}" />
        </a>
      </details>`).join("");
    // 展开时才真正请求原图（4 张合计约 16MB，不能一进页面就拉）
    el.calList.querySelectorAll("details.cal-item").forEach((box) => {
      box.addEventListener("toggle", () => {
        if (!box.open) return;
        const img = box.querySelector("img[data-src]");
        if (!img) return;
        img.src = img.dataset.src;
        img.removeAttribute("data-src");
      });
    });
  }

  // 第一次进「一咖舍」才挂 iframe 地址，避免一打开手账就拉外部页面
  function mountCafe() {
    const frame = el.cafeIframe;
    if (!frame || !frame.dataset.src) return;
    frame.src = frame.dataset.src;
    frame.removeAttribute("data-src");
  }

  // 切换主区内容：任务列表 / 版本日历 / 一咖舍
  function applyView(view) {
    const tasks = view === "tasks";
    state.view = tasks ? "tasks" : view;
    el.resetGrid.hidden = !tasks;
    el.workbench.hidden = !tasks;
    el.calendarView.hidden = view !== "calendar";
    if (el.cafeView) el.cafeView.hidden = view !== "cafe";
    renderNav();
    renderTools();
  }

  function switchView(view) {
    if (state.view === view) return;
    applyView(view);
    if (view === "calendar") {
      renderCalendar();
      el.calendarView.scrollIntoView({ block: "start", behavior: "smooth" });
    } else if (view === "cafe") {
      mountCafe();
      if (el.cafeView) el.cafeView.scrollIntoView({ block: "start", behavior: "smooth" });
    } else {
      renderList();
      renderDetail();
      el.resetGrid.scrollIntoView({ block: "start" });
    }
  }

  // 切换分类：导航高亮、倒计时卡高亮、列表与详情一起刷新
  function selectCategory(key) {
    state.cat = key;
    state.selected = null;
    const back = state.view !== "tasks";
    if (back) applyView("tasks");
    save();
    renderNav();
    syncResetActive();
    renderList();
    renderDetail();
    if (back) el.resetGrid.scrollIntoView({ block: "start" });
  }

  /* ---------------- 渲染：倒计时卡片 ---------------- */
  let clockNodes = [];
  let cardStamps = [];

  // 当前版本卡固定排在最左边，其余按分类顺序
  function resetCardCats() {
    const cards = DATA.categories.filter((c) => c.reset);
    return cards.filter((c) => c.reset === "custom").concat(cards.filter((c) => c.reset !== "custom"));
  }

  function renderResetCards() {
    const now = Date.now();
    const cards = resetCardCats();
    const multi = CARD_TASK == null && resetKinds(now) > 1;
    el.resetGrid.innerHTML = cards.map((c) => {
      const t = deadlineOf(c, now);
      const emptyText = c.reset === "custom" && CARD_TASK != null ? "版本卡任务未设置" : "开始时间未设置";
      const sub = t == null ? `<span>${emptyText}</span>` : resetSubLabel(c, t, multi ? "最近" : "");
      return `<button type="button" class="reset-card${c.key === state.cat ? " active" : ""}" data-kind="${c.key}" aria-label="查看${esc(c.label)}任务">
        <div class="rc-top"><span>${esc(c.version || c.label)}</span>${icon(RESET_ICON[c.reset] || "monthly")}</div>
        <div class="rc-time">${clockText(c, t, now)}</div>
        <div class="rc-sub">${sub}</div>
      </button>`;
    }).join("");
    clockNodes = [...el.resetGrid.querySelectorAll(".reset-card")].map((node, i) => ({
      node: node.querySelector(".rc-time"), cat: cards[i]
    }));
    cardStamps = cards.map((c) => deadlineOf(c, now));
  }

  function syncResetActive() {
    el.resetGrid.querySelectorAll(".reset-card").forEach((card) => {
      card.classList.toggle("active", card.dataset.kind === state.cat);
    });
  }

  function tick() {
    const now = Date.now();
    clockNodes.forEach(({ node, cat }) => {
      node.innerHTML = clockText(cat, deadlineOf(cat, now), now);
    });
    // 跨过重置点后副标题的日期要跟着换，整块重绘一次即可
    if (cardStamps.some((t, i) => deadlineOf(clockNodes[i].cat, now) !== t)) renderResetCards();
    // 到点先把上一周期的完成状态清掉，再处理计时 / 收益的自动重置
    const settled = settleResets(now);
    if (settled.touched) save();
    if (settled.labels.length) {
      renderNav();
      renderList();
      renderDetail();
      renderProfile();
      toast(`${settled.labels.join("、")}任务已重置`);
    }
    checkAutoReset(now);
    syncMechLive(now);
  }

  /* ---------------- 渲染：列表 ---------------- */
  function renderList() {
    const cat = DATA.categories.find((c) => c.key === state.cat);
    const tasks = catTasks(state.cat);
    const stat = categoryStats()[state.cat] || { done: 0, total: 0 };
    const done = stat.done;

    el.listTitle.textContent = cat.label + "任务";
    el.listSub.textContent = `已完成 ${done} / ${stat.total}`;
    el.listHint.innerHTML = cat.reset === "custom" ? customResetHint() : esc(LIST_HINT[state.cat] || "");

    const pct = stat.total ? Math.round((done / stat.total) * 100) : 0;
    const C = 2 * Math.PI * 19;
    el.ringFg.style.strokeDasharray = C.toFixed(1);
    el.ringFg.style.strokeDashoffset = (C * (1 - pct / 100)).toFixed(1);
    el.ringLabel.textContent = pct + "%";

    const now = Date.now();
    el.list.innerHTML = tasks.map((t) => {
      const cls = "task-row"
        + (t.minor ? " minor" : "")
        + (state.done.includes(t.id) ? " done" : "")
        + (state.selected === t.id ? " selected" : "");
      // 特殊任务的重置时间各自不同，直接标在这一行右侧；配了 countStep 的带上完成次数
      // 从属任务跟着主任务走，自己那个周期不算数，就不显示倒计时避免误导
      const due = LINK_OWNER.has(t.id) ? null : nextCycleReset(t, now);
      const dueTag = due == null ? "" : `<span class="task-due">${shortDue(due)}</span>`;
      const m = mechOf(t);
      const times = m.countStep ? state.counts[t.id] || 0 : 0;
      const countTag = times ? `<span class="task-count">×${fmtNum(times)}</span>` : "";
      return `<button class="${cls}" data-id="${t.id}">
        <span class="check">${icon("check")}</span>
        <span class="task-title">${esc(t.title)}</span>${countTag}${dueTag}
      </button>`;
    }).join("");
  }

  /* ---------------- 渲染：详情 ---------------- */
  function mechHtml(task, now) {
    const m = mechOf(task);
    if (!hasMech(m)) return "";
    const rows = [];
    const start = state.started[task.id];

    if (m.clock) {
      const left = start != null ? start + m.clock * 3600000 - now : null;
      const text = left == null
        ? `完成后 ${fmtHours(m.clock)}自动重置`
        : (left > 0 ? `剩 ${clockLeft(left)}` : "即将重置");
      rows.push(`<div class="mech-row"><span class="mech-k">计时</span><span class="mech-v" id="mech-timer">${esc(text)}</span></div>`);
    }
    if (m.earn) {
      const per = numOf(state.perHour[task.id]);
      const got = earnedOf(task.id, start, now);
      const text = per ? `${fmtNum(got)} / ${fmtNum(m.earn)}` : `目标 ${fmtNum(m.earn)} · 还没填每小时收益`;
      rows.push(`<div class="mech-row"><span class="mech-k">收益</span><span class="mech-v" id="mech-earn">${esc(text)}</span></div>`);
      rows.push(`<div class="mech-row mech-form">
        <span class="mech-k">每小时</span>
        <input class="mech-input" id="per-hour" type="number" min="0" step="1" inputmode="numeric"
               value="${per || ""}" placeholder="输入每小时收益" aria-label="每小时收益">
        <button class="mech-save" id="per-hour-save" type="button">保存</button>
      </div>`);
    }
    if (m.countStep) {
      rows.push(`<div class="mech-row"><span class="mech-k">完成</span><span class="mech-v">${fmtNum(state.counts[task.id] || 0)} 次<i>每次 +${fmtNum(m.countStep)}</i></span></div>`);
    }
    return rows.join("");
  }

  // 每秒只更新会变的数字，避免整块重绘把输入框里的内容冲掉
  function syncMechLive(now) {
    const task = DATA.tasks.find((t) => t.id === state.selected);
    if (!task) return;
    const m = mechOf(task);
    if (!m.clock && !m.earn) return;
    const start = state.started[task.id];
    const timer = $("#mech-timer");
    if (timer && m.clock) {
      const left = start != null ? start + m.clock * 3600000 - now : null;
      timer.textContent = left == null
        ? `完成后 ${fmtHours(m.clock)}自动重置`
        : (left > 0 ? `剩 ${clockLeft(left)}` : "即将重置");
    }
    const earn = $("#mech-earn");
    if (earn && m.earn) {
      const per = numOf(state.perHour[task.id]);
      const got = earnedOf(task.id, start, now);
      earn.textContent = per ? `${fmtNum(got)} / ${fmtNum(m.earn)}` : `目标 ${fmtNum(m.earn)} · 还没填每小时收益`;
    }
  }

  function renderDetail() {
    const tasks = catTasks(state.cat);
    if (!tasks.length) return;

    let task = tasks.find((t) => t.id === state.selected);
    // 默认挑第一条还没勾的主任务；次要任务不主动选中
    if (!task) {
      task = tasks.find((t) => !t.minor && !state.done.includes(t.id))
        || tasks.find((t) => !t.minor)
        || tasks[0];
    }
    state.selected = task.id;

    const isDone = state.done.includes(task.id);
    const owner = DATA.categories.find((c) => c.key === task.cat);
    // 攻略步骤为空时显示「无」，不带列表圆点
    const steps = (task.steps || []).map((s) => s.trim()).filter(Boolean);
    const hasSteps = steps.length > 0;

    el.detailCount.textContent = `${pad(tasks.indexOf(task) + 1)} / ${tasks.length}`;
    el.detailChip.textContent = (owner ? owner.label : "") + "任务";
    el.detailTitle.textContent = task.title;

    // 从属任务的重置由主任务决定，不显示自己那个不会生效的周期
    const due = LINK_OWNER.has(task.id) ? null : nextCycleReset(task, Date.now());
    if (due == null) {
      el.detailDue.hidden = true;
      el.detailDue.textContent = "";
    } else {
      el.detailDue.hidden = false;
      el.detailDue.textContent = `下次重置 ${longDue(due)} · ${remainText(due, Date.now())}`;
    }

    // 机制块：只有后台给这条任务配了 clock / earn / countStep 才出现
    el.detailMech.innerHTML = mechHtml(task, Date.now());
    el.detailMech.hidden = !el.detailMech.innerHTML;

    el.detailSteps.innerHTML = (hasSteps ? steps : FALLBACK_STEPS)
      .map((s) => (hasSteps ? `<li>${esc(s)}</li>` : `<li class="empty">${esc(s)}</li>`))
      .join("");

    el.markDone.textContent = isDone ? "撤销完成标记" : "标记为已完成";
    el.markDone.classList.toggle("is-done", isDone);

    el.list.querySelectorAll(".task-row").forEach((row) => {
      row.classList.toggle("selected", row.dataset.id === String(task.id));
    });
  }

  /* ---------------- 操作 ---------------- */
  function selectTask(id) {
    state.selected = id;
    save();
    renderDetail();
  }

  // 开始一轮：记下计时起点（有 clock / earn 时），计数 +step
  function startRound(id) {
    const t = DATA.tasks.find((x) => x.id === id);
    if (!t) return;
    const m = mechOf(t);
    if (m.clock || m.earn) state.started[id] = Date.now();
    if (m.countStep) state.counts[id] = (state.counts[id] || 0) + m.countStep;
  }

  // 结束一轮：keepCount 为真时保留计数（计时/收益到点的正常重置），手动撤销则扣回去
  function endRound(id, keepCount) {
    const t = DATA.tasks.find((x) => x.id === id);
    const m = t ? mechOf(t) : { countStep: 0 };
    const i = state.done.indexOf(id);
    if (i >= 0) state.done.splice(i, 1);
    state.doneAt[id] = Date.now(); // 记下这次取消，合并时不会被云端旧存档勾回来
    delete state.started[id];
    if (!keepCount && m.countStep) {
      state.counts[id] = Math.max(0, (state.counts[id] || 0) - m.countStep);
    }
  }

  function toggleDone(id) {
    const wasDone = state.done.includes(id);
    // 联动是单向的：主任务完成带全部从属；从属完成只改自己
    const kids = LINK_CHILDREN.get(id) || [];
    const stamp = Date.now();
    if (wasDone) {
      // 撤销主任务时，跟随它完成的从属一起撤销；从属撤销只影响自己
      const ids = [id].concat(kids.length ? followingKids(id) : []);
      ids.forEach((x) => endRound(x, false));
      ids.forEach((x) => { state.doneAt[x] = stamp; });
    } else {
      [id].concat(kids).forEach((x) => {
        if (state.done.includes(x)) return;
        state.done.push(x);
        state.doneAt[x] = stamp;
        startRound(x);
      });
    }
    save();
    renderNav();
    renderList();
    renderDetail();
    renderProfile();
    const t = DATA.tasks.find((x) => x.id === id);
    if (!t) return;
    // 主任务完成才会带上从属，提示里只在这时提一句
    const more = !wasDone && kids.length ? `（含 ${kids.length} 条关联）` : "";
    if (wasDone) { toast(`已取消：${t.title}`); return; }
    const m = mechOf(t);
    const extra = more || (m.countStep ? ` · 计数 ${fmtNum(state.counts[id] || 0)}` : "");
    toast(`已完成：${t.title}${extra}`);
  }

  // 计时到点 / 收益达标 → 自动取消完成，回到可再做一轮的状态
  function checkAutoReset(now) {
    if (!state.done.length) return;
    const hits = [];
    const cleared = new Set();
    state.done.slice().forEach((id) => {
      if (cleared.has(id) || !state.done.includes(id)) return;
      const t = DATA.tasks.find((x) => x.id === id);
      if (!t) return;
      const m = mechOf(t);
      const start = state.started[id];
      if (start == null || (!m.clock && !m.earn)) return;
      // 从属任务不能自己先走：主任务还挂着就继续等，等主任务重置时一起清
      const owner = LINK_OWNER.get(id);
      if (owner != null && state.done.includes(owner)) return;
      const per = numOf(state.perHour[id]);
      const timeUp = !!m.clock && now - start >= m.clock * 3600000;
      const earnUp = !!m.earn && per > 0 && earnedOf(id, start, now) >= m.earn;
      if (!timeUp && !earnUp) return;
      // 主任务到点 → 跟随它完成的从属一起重置；从属自己到点只清自己
      const scope = owner != null ? [id] : [id].concat(followingKids(id));
      scope.forEach((x) => {
        endRound(x, true);
        cleared.add(x);
      });
      hits.push(t.title);
    });
    if (!hits.length) return;
    save();
    renderNav();
    renderList();
    renderDetail();
    renderProfile();
    toast(hits.length === 1 ? `已重置：${hits[0]}` : `${hits.length} 个任务已重置`);
  }

  /* ---------------- 到点自动重置：跨过重置点就清掉已完成 ---------------- */
  // 每个分类记一个「上次结算的重置点」，特殊任务按任务 id 各记一个。
  // 首次没有记录时只记基线、不清空（旧存档判断不出是哪天勾的），之后每次跨点自动清。
  // 清掉的是该分类里没标 minor 的任务：完成状态与计时起点一起清，计数与每小时收益保留。
  function settleResets(now) {
    let touched = false;
    const labels = [];

    const settle = (key, boundary, ids, label) => {
      const prev = state.lastReset[key];
      if (prev == null) {
        state.lastReset[key] = boundary;
        touched = true;
        return;
      }
      if (prev >= boundary) return;
      state.lastReset[key] = boundary;
      touched = true;
      const before = state.done.length;
      // 关联组：主任务被清时带上从属任务；从属任务自己不参与分类结算
      const clear = new Set();
      ids.forEach((id) => {
        if (!state.done.includes(id)) return;
        groupOf(id).forEach((x) => clear.add(x));
      });
      if (clear.size) {
        const stamp = Date.now();
        clear.forEach((id) => {
          if (!state.done.includes(id)) return;
          state.doneAt[id] = stamp; // 自动重置也算一次取消，合并时以它为准
          delete state.started[id];
        });
        state.done = state.done.filter((id) => !clear.has(id));
      }
      if (state.done.length !== before && !labels.includes(label)) labels.push(label);
    };

    DATA.categories.forEach((c) => {
      if (!c.reset) return; // 「所有」是汇总视图，自己没有周期
      if (c.reset === "custom") {
        DATA.tasks.forEach((t) => {
          // 从属任务不走自己的特殊周期，等主任务重置时一起清
          if (t.cat !== c.key || t.minor || LINK_OWNER.has(t.id)) return;
          const b = lastCycleReset(t, now);
          if (b != null) settle("s" + t.id, b, [t.id], c.label);
        });
        return;
      }
      const b = lastResetBoundary(c.reset, now);
      if (b == null) return;
      const ids = DATA.tasks
        .filter((t) => t.cat === c.key && !t.minor && !LINK_OWNER.has(t.id))
        .map((t) => t.id);
      settle(c.key, b, ids, c.label);
    });

    return { touched: touched, labels: labels };
  }

  function savePerHour() {
    const input = $("#per-hour");
    const task = DATA.tasks.find((t) => t.id === state.selected);
    if (!input || !task) return;
    const v = Math.max(0, Math.floor(Number(input.value) || 0));
    if (v > 0) state.perHour[task.id] = v;
    else delete state.perHour[task.id];
    save();
    renderDetail();
    toast(v > 0 ? `每小时收益已保存：${fmtNum(v)}` : "已清空每小时收益");
  }

  function setCategoryDone(done) {
    const ids = catTasks(state.cat).map((t) => t.id);
    // 「全部完成」不碰次要任务（它们不计入进度，也不替用户启动计时）；「清空本页」全清
    const target = done ? catTasks(state.cat).filter((t) => !t.minor).map((t) => t.id) : ids;
    // 联动单向：本页出现主任务时带上它的从属（可能跨分类）；本页只是从属就只处理它自己
    const scope = new Set();
    target.forEach((id) => {
      scope.add(id);
      if (LINK_OWNER.has(id)) return;
      (LINK_CHILDREN.get(id) || []).forEach((x) => scope.add(x));
    });
    const now = Date.now();
    if (done) {
      scope.forEach((id) => {
        if (!state.done.includes(id)) state.done.push(id);
        state.doneAt[id] = now;
      });
    } else {
      scope.forEach((id) => { state.doneAt[id] = now; });
      state.done = state.done.filter((id) => !scope.has(id));
    }
    save();
    renderNav();
    renderList();
    renderDetail();
    renderProfile();
    toast(done ? "本页已全部标记完成" : "已清空本页进度");
  }

  function step(dir) {
    if (state.view !== "tasks") return; // 工具页没有上下切换的任务
    const tasks = catTasks(state.cat);
    if (!tasks.length) return;
    const idx = tasks.findIndex((t) => t.id === state.selected);
    const next = tasks[(idx + dir + tasks.length) % tasks.length];
    state.selected = next.id;
    save();
    renderDetail();
    const row = el.list.querySelector(`[data-id="${next.id}"]`);
    if (row) row.scrollIntoView({ block: "nearest" });
  }

  function renderProfile() {
    const total = DATA.tasks.length;
    const done = state.done.length;
    const label = state.name || (state.user ? state.user.name : "");
    el.profileName.textContent = label || "个人档案";
    el.profileLevel.textContent = `已完成 ${done}/${total}`;
    if (label) el.profileAvatar.textContent = label.slice(0, 1).toUpperCase();
    else el.profileAvatar.innerHTML = icon("user");
  }

  // 切号 / 登录后整体重绘一遍
  function renderAll() {
    renderNav();
    renderTools();
    renderResetCards();
    renderList();
    renderDetail();
    renderProfile();
    setSyncLabel(!syncFailed);
  }

  /* ---------------- 账号 ---------------- */
  function openProfile() {
    const dialog = $("#profile-dialog");
    const logged = !!state.user;
    const on = cloudOn();

    $("#acct-guest").hidden = logged;
    $("#acct-user").hidden = !logged;

    const btn = $("#login-btn");
    btn.disabled = !on;
    $("#login-hint").textContent = on
      ? "只填用户名，不需要密码。登录后进度存到云端，换设备登录同一个名字就能接着用。"
      : "云端还没接通：在 cloud-config.js 里填好云函数地址才能登录。";

    if (logged) {
      $("#acct-name").textContent = state.user.name;
      $("#acct-hint").textContent = on ? "进度已开启云端同步。" : "云端未接通，当前只在本地保存。";
    }

    $("#login-input").value = "";
    $("#name-input").value = state.name;
    if (typeof dialog.showModal === "function") dialog.showModal();
  }

  function closeProfile() {
    const dialog = $("#profile-dialog");
    if (dialog && typeof dialog.close === "function") dialog.close();
  }

  async function doLogin() {
    if (!cloudOn()) { toast("云端还没接通"); return; }
    const input = $("#login-input");
    const name = input.value.trim().replace(/\s+/g, " ").slice(0, 16);
    if (!name) { toast("请输入用户名"); input.focus(); return; }

    const btn = $("#login-btn");
    btn.disabled = true;
    btn.textContent = "登录中…";
    try {
      const res = await CLOUD.login(name);
      if (!res || !res.id) throw new Error("云端没返回账号");
      // 云端旧进度 + 本机游客进度合并，然后以这个账号的身份继续
      const merged = mergeData(res.data, snapshot());
      state.user = { id: String(res.id), name: res.name || name };
      writeSession(state.user);
      applyData(merged);
      if (!state.name) state.name = state.user.name;
      save(false);
      renderAll();
      closeProfile();
      toast(`已登录：${state.user.name}`);
      await pushCloud();
    } catch (e) {
      toast("登录失败：" + ((e && e.message) || "网络异常"));
    } finally {
      btn.disabled = !cloudOn();
      btn.textContent = "登录";
    }
  }

  async function doLogout() {
    const name = state.user ? state.user.name : "";
    await pushCloud();
    // 云端确认存下了才清掉本地游客档，避免同步失败时丢进度
    const safeToClear = !syncFailed;
    state.user = null;
    writeSession(null);
    if (safeToClear) {
      try { localStorage.removeItem(STORE_KEY); } catch (e) { /* 忽略 */ }
    }
    load();
    state.selected = null;
    renderAll();
    closeProfile();
    toast(name ? `已退出 ${name}` : "已退出登录");
  }

  /* ---------------- 顶部信息 ---------------- */
  function renderClockLabels() {
    const w = wall(Date.now(), TZ_OFFSET);
    el.today.textContent = `${w.m + 1}月${w.d}日${WEEK[w.dow]}`;
    el.checked.textContent = `检查时间 · ${w.m + 1}月${w.d}日 ${pad(w.h)}:${pad(w.mi)}`;
  }

  /* ---------------- 提示 ---------------- */
  let toastTimer = null;
  function toast(msg) {
    el.toast.textContent = msg;
    el.toast.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.toast.classList.remove("show"), 1800);
  }

  /* ---------------- 主题 ---------------- */
  function currentTheme() {
    return document.documentElement.dataset.theme === "light" ? "light" : "dark";
  }
  function syncThemeChrome(t) {
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute("content", THEME_COLOR[t] || THEME_COLOR.dark);
    el.themeBtn.setAttribute("aria-pressed", t === "light" ? "true" : "false");
    el.themeBtn.setAttribute("title", t === "light" ? "切换到黑夜主题" : "切换到白天主题");
  }
  function applyTheme(t) {
    document.documentElement.dataset.theme = t;
    try { localStorage.setItem(THEME_KEY, t); } catch (e) { /* 无痕模式忽略 */ }
    syncThemeChrome(t);
    toast(t === "light" ? "已切换到白天主题" : "已切换到黑夜主题");
  }

  /* ---------------- 侧栏（移动端） ---------------- */
  function openSidebar() { el.sidebar.classList.add("open"); el.scrim.classList.add("show"); }
  function closeSidebar() { el.sidebar.classList.remove("open"); el.scrim.classList.remove("show"); }

  /* ---------------- 事件绑定 ---------------- */
  function bind() {
    $("#menu-btn").addEventListener("click", openSidebar);
    $("#side-close").addEventListener("click", closeSidebar);
    el.scrim.addEventListener("click", closeSidebar);

    el.themeBtn.addEventListener("click", () => applyTheme(currentTheme() === "light" ? "dark" : "light"));

    // 侧栏分类：一次委托，避免重建按钮时反复绑定
    el.nav.addEventListener("click", (ev) => {
      const btn = ev.target.closest(".nav-btn");
      if (!btn) return;
      selectCategory(btn.dataset.category);
      closeSidebar();
    });

    // 工具分组：版本日历 / 一咖舍
    el.tools.addEventListener("click", (ev) => {
      const btn = ev.target.closest(".nav-btn");
      if (!btn) return;
      switchView(btn.dataset.tool);
      closeSidebar();
    });

    // 点击倒计时卡：切到对应分类，并滚动到任务列表
    el.resetGrid.addEventListener("click", (ev) => {
      const card = ev.target.closest(".reset-card");
      if (!card) return;
      if (card.dataset.kind !== state.cat) selectCategory(card.dataset.kind);
      (el.listPanel || el.list).scrollIntoView({ behavior: "smooth", block: "start" });
    });

    // 任务列表：点勾选框切换完成，点其余区域选中该任务
    el.list.addEventListener("click", (ev) => {
      const row = ev.target.closest(".task-row");
      if (!row) return;
      const id = Number(row.dataset.id);
      if (ev.target.closest(".check")) toggleDone(id);
      else selectTask(id);
    });

    el.markDone.addEventListener("click", () => {
      if (state.selected) toggleDone(state.selected);
    });

    // 机制块里的「每小时收益」：点保存或回车才写盘
    el.detailMech.addEventListener("click", (ev) => {
      if (ev.target.closest("#per-hour-save")) savePerHour();
    });
    el.detailMech.addEventListener("keydown", (ev) => {
      if (ev.target.id === "per-hour" && ev.key === "Enter") {
        ev.preventDefault();
        savePerHour();
      }
    });

    $("#complete-all").addEventListener("click", () => setCategoryDone(true));
    $("#clear-cat").addEventListener("click", () => setCategoryDone(false));

    $("#profile-open").addEventListener("click", openProfile);
    $("#login-btn").addEventListener("click", doLogin);
    $("#logout-btn").addEventListener("click", doLogout);
    $("#login-input").addEventListener("keydown", (ev) => {
      if (ev.key !== "Enter") return;
      ev.preventDefault();
      doLogin();
    });
    $("#profile-form").addEventListener("submit", (e) => {
      if (((e.submitter && e.submitter.value) || "save") !== "save") return;
      state.name = $("#name-input").value.trim().slice(0, 16);
      save();
      renderProfile();
      toast(state.name ? `档案已保存：${state.name}` : "已清空昵称");
    });

    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape") closeSidebar();
      if (e.target.tagName === "INPUT" || e.target.tagName === "SELECT") return;
      if (e.key === "ArrowDown" || e.key === "j") { e.preventDefault(); step(1); }
      if (e.key === "ArrowUp" || e.key === "k") { e.preventDefault(); step(-1); }
    });
  }

  /* ---------------- 启动 ---------------- */
  function init() {
    state.user = readSession();
    load();
    // 进页面先结算一次周期：跨过 05:00 / 周一 / 月初就把上一周期的完成状态清掉
    const bootSettle = settleResets(Date.now());
    if (bootSettle.touched) save();
    syncThemeChrome(currentTheme());
    bind();
    renderNav();
    renderTools();
    renderResetCards();
    renderList();
    renderDetail();
    renderProfile();
    renderClockLabels();
    setSyncLabel(!syncFailed);
    checkAutoReset(Date.now());
    if (bootSettle.labels.length) toast(`${bootSettle.labels.join("、")}任务已重置`);
    setInterval(tick, 1000);
    setInterval(renderClockLabels, 30000);
    // 兜底：还有没推上去的改动就每 45 秒补一次；切到后台时立刻冲刷
    setInterval(() => { if (dirty && state.user) pushCloud(); }, 45000);
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "hidden" && dirty && state.user) pushCloud();
    });
    // 上次登录过就先把云端存档拉下来合并一次
    if (state.user) pullCloud();
  }

  init();
})();
