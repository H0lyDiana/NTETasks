/* ============================================================
   异环 · 赠礼速查 · 交互（中文 / English）
   ============================================================ */
(function () {
  "use strict";

  const D = window.NTE_DATA;
  const I18N = window.NTE_I18N;
  if (!D || !I18N) return;

  const $ = (s) => document.querySelector(s);
  const root = document.documentElement;
  const grid = $("#grid");
  const emptyEl = $("#empty");
  const resultLine = $("#resultLine");
  const searchEl = $("#search");
  const clearBtn = $("#clearSearch");
  const langBtn = $("#langBtn");
  const langLabel = $("#langLabel");

  /* ---------------- 语言 ---------------- */
  const LANG_KEY = "nte-lang";
  let lang = "zh";
  try { if (localStorage.getItem(LANG_KEY) === "en") lang = "en"; } catch (e) { /* 隐私模式 */ }

  const isEn = () => lang === "en";

  function t(key, vars) {
    const d = I18N.ui[lang] || I18N.ui.zh;
    let s = d[key];
    if (s == null) s = I18N.ui.zh[key] != null ? I18N.ui.zh[key] : key;
    if (vars) {
      Object.keys(vars).forEach((k) => {
        s = s.split("{" + k + "}").join(vars[k]);
      });
    }
    return s;
  }

  // 数据里一律存中文名（图标文件名也用它），只在显示时换英文
  const charName = (zh) => (isEn() && I18N.charEn[zh]) || zh;
  const itemName = (zh) => (isEn() && I18N.itemEn[zh]) || zh;
  const whereName = (zh) => (isEn() && I18N.whereEn[zh]) || zh;

  /* ---------------- 主题 ---------------- */
  const themeBtn = $("#themeBtn");
  const themeLabel = $("#themeLabel");
  let theme = root.dataset.theme === "light" ? "light" : "dark";

  function applyTheme(mode) {
    theme = mode;
    if (mode === "light") root.dataset.theme = "light";
    else delete root.dataset.theme;
    themeLabel.textContent = t(mode === "light" ? "themeToDark" : "themeToLight");
    themeBtn.setAttribute("aria-label", t(mode === "light" ? "themeAriaLight" : "themeAriaDark"));
    try { localStorage.setItem("nte-theme", mode); } catch (e) { /* 隐私模式下忽略 */ }
  }

  themeBtn.addEventListener("click", () => {
    applyTheme(theme === "light" ? "dark" : "light");
  });

  const ROUTES = [
    { key: "fast", tag: "fast", cls: "fast" },
    { key: "cheap", tag: "cheap", cls: "cheap" }
  ];

  /* ---------------- 工具 ---------------- */
  const esc = (s) =>
    String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
    }[c]));

  const fmt = (n) => (n == null ? "—" : n.toLocaleString("en-US"));

  function highlight(text, q) {
    const safe = esc(text);
    if (!q) return safe;
    const needle = esc(q);
    const re = new RegExp(needle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi");
    return safe.replace(re, (m) => `<mark>${m}</mark>`);
  }

  function itemIcon(name) {
    return `assets/img/items/${encodeURIComponent(name)}.webp`;
  }

  function itemHTML(n) {
    return `<span class="item">
      <img src="${itemIcon(n)}" alt="" loading="lazy" width="22" height="22">
      <span class="item-name">${highlight(itemName(n), currentQuery)}</span>
    </span>`;
  }

  /* ---------------- 经验表 ---------------- */
  const track = $("#expTrack");
  const hint = $("#expHint");
  let expMode = "per";

  // 累计值由每级需求累加得出，避免数据里重复存一份
  const CUMULATIVE = D.levelExp.reduce((a, v, i) => {
    a.push((a[i - 1] || 0) + v);
    return a;
  }, []);

  function renderExp() {
    const arr = expMode === "per" ? D.levelExp : CUMULATIVE;
    hint.textContent = expMode === "per" ? t("expHintPer") : t("expHintCum");
    track.innerHTML = arr
      .map((v, i) => `<li>
          <span class="lv">${esc(t("expLevel", { a: i, b: i + 1 }))}</span>
          <span class="val">${fmt(v)}</span>
        </li>`)
      .join("");
  }

  document.querySelectorAll(".switch-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".switch-btn").forEach((b) => b.classList.remove("is-active"));
      btn.classList.add("is-active");
      expMode = btn.dataset.mode;
      renderExp();
    });
  });

  /* ---------------- 升级计算 ---------------- */
  const MAX_LV = D.levelExp.length;
  const TOTAL_EXP = CUMULATIVE[MAX_LV - 1];
  const CALC = {}; // 角色中文名 -> { lv, fav }，切换语言不丢输入

  function stateOf(name) {
    return CALC[name] || (CALC[name] = { lv: 0, fav: 0 });
  }

  // 距满级还差的好感度
  function remainOf(lv, fav) {
    if (lv >= MAX_LV) return 0;
    const done = (lv > 0 ? CUMULATIVE[lv - 1] : 0) + fav;
    return Math.max(0, TOTAL_EXP - done);
  }

  const CALC_ROWS = [
    { key: "fast", cls: "fast" },
    { key: "cheap", cls: "cheap" },
    { key: "gift", cls: "gift" }
  ];

  function calcResHTML(c, rem) {
    return CALC_ROWS.map(({ key, cls }) => {
      const r = c[key];
      const label = esc(t(key));
      if (!r.items.length) {
        return `<span class="calc-res none"><em class="cr-tag ${cls}">${label}</em>—</span>`;
      }
      const n = Math.ceil(rem / r.fav);
      return `<span class="calc-res"><em class="cr-tag ${cls}">${label}</em><b>${fmt(n)}</b> ${esc(t("pcs"))} · <b>${fmt(n * r.fons)}</b> ◈</span>`;
    }).join("");
  }

  function calcHTML(c) {
    const st = stateOf(c.name);
    return `<div class="calc" data-char="${esc(c.name)}">
      <div class="calc-in">
        <label class="calc-field" title="${esc(t("levelTitle"))}">${esc(t("level"))}<input type="number" inputmode="numeric" min="0" max="${MAX_LV}" step="1" value="${st.lv}" data-k="lv"></label>
        <label class="calc-field" title="${esc(t("affinityTitle"))}">${esc(t("affinity"))}<input type="number" inputmode="numeric" min="0" step="1" value="${st.fav}" data-k="fav"></label>
        <span class="calc-need" data-out="need"></span>
      </div>
      <div class="calc-out" data-out="res"></div>
    </div>`;
  }

  function paintCalc(box, c) {
    const st = stateOf(c.name);
    const rem = remainOf(st.lv, st.fav);
    box.querySelector('[data-out="need"]').innerHTML = rem
      ? t("need", { v: fmt(rem) })
      : t("maxed");
    box.querySelector('[data-out="res"]').innerHTML = rem ? calcResHTML(c, rem) : "";
  }

  function onCalcInput(e, normalize) {
    const input = e.target.closest(".calc-field input");
    if (!input) return;
    const box = input.closest(".calc");
    const c = D.characters.find((x) => x.name === box.dataset.char);
    if (!c) return;
    const st = stateOf(c.name);
    const k = input.dataset.k;
    let v = parseInt(input.value, 10);
    if (!Number.isFinite(v) || v < 0) v = 0;
    st[k] = k === "lv" ? Math.min(v, MAX_LV) : v;

    if (normalize) {
      // 好感填的是本级进度，超过本级所需则按本级上限收口
      const cap = st.lv >= MAX_LV ? 0 : D.levelExp[st.lv];
      if (st.fav > cap) st.fav = cap;
      input.value = st[k];
      box.querySelector('[data-k="fav"]').value = st.fav;
    }
    paintCalc(box, c);
  }

  /* ---------------- 角色卡 ---------------- */
  let OPEN = null; // 当前展开的角色名；null 表示全部折叠

  function routeHTML(c, route) {
    const r = c[route.key];
    const items = r.items.length
      ? r.items.map(itemHTML).join(`<span class="alt">/</span>`)
      : `<span class="item-name">—</span>`;

    return `<div class="route ${route.cls}">
      <span class="route-tag">${esc(t(route.tag))}</span>
      <div class="route-main">
        <div class="route-items">${items}</div>
        <div class="route-where">${esc(whereName(r.where))}${r.note && !isEn() ? " · " + esc(r.note) : ""}</div>
      </div>
      <div class="route-stats">
        <span class="stat fav"><i>♥</i>${fmt(r.fav)}</span>
        <span class="stat fons"><i>◈</i>${fmt(r.fons)}</span>
      </div>
    </div>`;
  }

  function cardHTML(c) {
    const open = OPEN === c.name;
    const label = charName(c.name);
    return `<article class="card${open ? " is-open" : ""}" data-char="${esc(c.name)}">
      <button class="card-toggle" type="button" aria-expanded="${open}"
        aria-label="${esc(t("expandAria", { name: label, act: open ? t("close") : t("expand") }))}">
        <span class="char-name">${highlight(label, currentQuery)}</span>
        <img class="char-img" src="assets/img/chars/${encodeURIComponent(c.name)}.webp" alt="" loading="lazy">
        <svg class="chev" viewBox="0 0 24 24" aria-hidden="true"><path d="M6 9l6 6 6-6"/></svg>
      </button>
    </article>`;
  }

  function detailHTML(c) {
    const g = c.gift;
    const hasGift = g.items.length > 0;
    const giftInner = hasGift
      ? `<span class="gift-tag">${esc(t("gift"))}</span>
         <div class="route-main">
           <div class="route-items">
             ${g.items.map(itemHTML).join(`<span class="alt">/</span>`)}
           </div>
           <div class="route-where">${esc(whereName(g.where))}</div>
         </div>
         <div class="route-stats">
           <span class="stat fav"><i>♥</i>${fmt(g.fav)}</span>
           <span class="stat fons"><i>◈</i>${fmt(g.fons)}</span>
         </div>`
      : `<span class="gift-tag">${esc(t("gift"))}</span>
         <div class="route-main"><span class="gift-note">${esc(isEn() ? t("noGift") : (g.note || t("none")))}</span></div>`;

    return `<section class="detail" data-char="${esc(c.name)}" aria-label="${esc(t("detailAria", { name: charName(c.name) }))}">
      <div class="card-side">
        <h3 class="char-name">${highlight(charName(c.name), currentQuery)}</h3>
        <img class="char-img" src="assets/img/chars/${encodeURIComponent(c.name)}.webp" alt="${esc(charName(c.name))}" loading="lazy">
        <button class="detail-close" type="button">${esc(t("close"))}</button>
      </div>
      <div class="card-body">
        <div class="card-main">
          ${ROUTES.map((r) => routeHTML(c, r)).join("")}
          <div class="gift${hasGift ? "" : " none"}">${giftInner}</div>
        </div>
        ${calcHTML(c)}
      </div>
    </section>`;
  }

  function closeDetail() {
    const old = grid.querySelector(".detail");
    if (old) old.remove();
  }

  // 面板插在角色所在那一行的后面，整行占满，前面的格子不会留空
  function mountDetail(c, opts) {
    closeDetail();
    let anchor = null;
    grid.querySelectorAll(".card").forEach((el) => {
      if (!anchor && el.dataset.char === c.name) anchor = el;
    });
    if (!anchor) return;

    const top = anchor.offsetTop;
    let last = anchor;
    let next = anchor.nextElementSibling;
    while (next && next.classList.contains("card") && next.offsetTop === top) {
      last = next;
      next = next.nextElementSibling;
    }
    last.insertAdjacentHTML("afterend", detailHTML(c));
    const panel = last.nextElementSibling;

    const box = panel.querySelector(".calc");
    if (box) paintCalc(box, c);

    // 只有用户点了头像才滚动，搜索 / 切语言时不打断阅读位置
    if (!opts || opts.scroll !== false) {
      const r = panel.getBoundingClientRect();
      if (r.top < 0 || r.top > window.innerHeight - 140) {
        const reduce = window.matchMedia("(prefers-reduced-motion:reduce)").matches;
        panel.scrollIntoView({ block: "start", behavior: reduce ? "auto" : "smooth" });
      }
    }
  }

  function setOpen(name) {
    OPEN = name;
    grid.querySelectorAll(".card").forEach((card) => {
      const on = card.dataset.char === name;
      card.classList.toggle("is-open", on);
      card.querySelector(".card-toggle").setAttribute("aria-expanded", String(on));
    });
    const c = name ? D.characters.find((x) => x.name === name) : null;
    if (c) mountDetail(c);
    else closeDetail();
  }

  /* ---------------- 过滤 ---------------- */
  let currentQuery = "";

  function updatePlaceholder() {
    const narrow = window.matchMedia("(max-width:620px)").matches;
    searchEl.placeholder = narrow ? t("searchPhShort") : t("searchPh");
  }

  // 中英关键词都能搜到：两种语言的名字一起进索引，与当前显示语言无关
  function match(c, q) {
    if (!q) return true;
    const parts = [c.name, I18N.charEn[c.name] || ""];
    [c.fast, c.cheap, c.gift].forEach((r) => {
      r.items.forEach((n) => parts.push(n, I18N.itemEn[n] || ""));
      if (r.where) parts.push(r.where, I18N.whereEn[r.where] || "");
      if (r.note) parts.push(r.note);
    });
    return parts.filter(Boolean).join(" ").toLowerCase().includes(q.toLowerCase());
  }

  function render() {
    const q = currentQuery.trim();
    const list = D.characters.filter((c) => match(c, q));

    grid.innerHTML = list.map(cardHTML).join("");
    emptyEl.hidden = list.length > 0;

    const openChar = OPEN ? list.find((c) => c.name === OPEN) : null;
    OPEN = openChar ? openChar.name : null;
    if (openChar) mountDetail(openChar, { scroll: false });

    resultLine.innerHTML = q
      ? t("resultMatch", { n: list.length, q: esc(q) })
      : t("resultAll", { n: D.characters.length });

    clearBtn.hidden = !q;
  }

  /* ---------------- 静态文案 ---------------- */
  function applyStatic() {
    root.lang = isEn() ? "en" : "zh-Hans";
    document.title = t("title");
    const md = document.querySelector('meta[name="description"]');
    if (md) md.setAttribute("content", t("desc"));
    document.querySelectorAll("[data-i18n]").forEach((el) => {
      el.textContent = t(el.dataset.i18n);
    });
    const sw = document.querySelector(".switch");
    if (sw) sw.setAttribute("aria-label", t("expModeAria"));
    searchEl.setAttribute("aria-label", t("searchAria"));
    clearBtn.setAttribute("aria-label", t("clearAria"));
    langBtn.setAttribute("aria-label", t("langAria"));
    langBtn.title = t("langAria");
    langLabel.textContent = t("langLabel");
    updatePlaceholder();
    applyTheme(theme);
  }

  /* ---------------- 事件 ---------------- */
  let timer = null;
  searchEl.addEventListener("input", (e) => {
    currentQuery = e.target.value;
    clearTimeout(timer);
    timer = setTimeout(render, 120);
  });

  clearBtn.addEventListener("click", () => {
    searchEl.value = "";
    currentQuery = "";
    searchEl.focus();
    render();
  });

  grid.addEventListener("click", (e) => {
    const btn = e.target.closest(".card-toggle");
    if (btn) {
      const name = btn.closest(".card").dataset.char;
      setOpen(OPEN === name ? null : name);
      return;
    }
    if (e.target.closest(".detail-close")) setOpen(null);
  });

  grid.addEventListener("input", (e) => onCalcInput(e, false));
  grid.addEventListener("change", (e) => onCalcInput(e, true));

  langBtn.addEventListener("click", () => {
    lang = isEn() ? "zh" : "en";
    try { localStorage.setItem(LANG_KEY, lang); } catch (e) { /* 忽略 */ }
    applyStatic();
    renderExp();
    render();
  });

  window.addEventListener("resize", updatePlaceholder);

  /* ---------------- 启动 ---------------- */
  applyStatic();
  renderExp();
  render();
})();
