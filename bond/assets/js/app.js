/* ============================================================
   异环 · 祷歌为谁而诵 V1.4 赠礼速查 · 交互
   ============================================================ */
(function () {
  "use strict";

  const D = window.NTE_DATA;
  if (!D) return;

  const $ = (s) => document.querySelector(s);
  const root = document.documentElement;
  const grid = $("#grid");
  const emptyEl = $("#empty");
  const resultLine = $("#resultLine");
  const searchEl = $("#search");
  const clearBtn = $("#clearSearch");

  /* ---------------- 主题 ---------------- */
  const themeBtn = $("#themeBtn");
  const themeLabel = $("#themeLabel");
  let theme = root.dataset.theme === "light" ? "light" : "dark";

  function applyTheme(t) {
    if (t === "light") root.dataset.theme = "light";
    else delete root.dataset.theme;
    themeLabel.textContent = t === "light" ? "黑夜" : "白昼";
    themeBtn.setAttribute("aria-label", t === "light" ? "切换到黑夜主题" : "切换到白昼主题");
    try { localStorage.setItem("nte-theme", t); } catch (e) { /* 隐私模式下忽略 */ }
  }
  applyTheme(theme);

  themeBtn.addEventListener("click", () => {
    theme = theme === "light" ? "dark" : "light";
    applyTheme(theme);
  });

  const ROUTES = [
    { key: "fast", tag: "速升", cls: "fast" },
    { key: "cheap", tag: "省钱", cls: "cheap" }
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
      <span class="item-name">${highlight(n, currentQuery)}</span>
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
    hint.textContent =
      expMode === "per" ? "升到下一级需要的好感度" : "从 0 级累计升到该级所需好感度";
    track.innerHTML = arr
      .map((v, i) => `<li>
          <span class="lv">${i}→${i + 1}级</span>
          <span class="val">${fmt(v)}</span>
        </li>`)
      .join("");
  }
  renderExp();

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
  const CALC = {}; // 角色名 -> { lv, fav }，重渲染后仍保留输入

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
    { tag: "速升", cls: "fast", key: "fast" },
    { tag: "省钱", cls: "cheap", key: "cheap" },
    { tag: "均衡", cls: "gift", key: "gift" }
  ];

  function calcResHTML(c, rem) {
    return CALC_ROWS.map(({ tag, cls, key }) => {
      const r = c[key];
      if (!r.items.length) {
        return `<span class="calc-res none"><em class="cr-tag ${cls}">${tag}</em>—</span>`;
      }
      const n = Math.ceil(rem / r.fav);
      return `<span class="calc-res"><em class="cr-tag ${cls}">${tag}</em><b>${fmt(n)}</b> 份 · <b>${fmt(n * r.fons)}</b> ◈</span>`;
    }).join("");
  }

  function calcHTML(c) {
    const st = stateOf(c.name);
    return `<div class="calc" data-char="${esc(c.name)}">
      <div class="calc-in">
        <label class="calc-field" title="角色当前好感等级 0-${MAX_LV}">等级<input type="number" inputmode="numeric" min="0" max="${MAX_LV}" step="1" value="${st.lv}" data-k="lv"></label>
        <label class="calc-field" title="当前等级内的好感进度">好感<input type="number" inputmode="numeric" min="0" step="1" value="${st.fav}" data-k="fav"></label>
        <span class="calc-need" data-out="need"></span>
      </div>
      <div class="calc-out" data-out="res"></div>
    </div>`;
  }

  function paintCalc(box, c) {
    const st = stateOf(c.name);
    const rem = remainOf(st.lv, st.fav);
    box.querySelector('[data-out="need"]').innerHTML = rem
      ? `还需 <b>♥${fmt(rem)}</b> 到满级`
      : `<b>已满级</b>`;
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
      <span class="route-tag">${route.tag}</span>
      <div class="route-main">
        <div class="route-items">${items}</div>
        <div class="route-where">${esc(r.where)}${r.note ? " · " + esc(r.note) : ""}</div>
      </div>
      <div class="route-stats">
        <span class="stat fav"><i>♥</i>${fmt(r.fav)}</span>
        <span class="stat fons"><i>◈</i>${fmt(r.fons)}</span>
      </div>
    </div>`;
  }

  function cardHTML(c) {
    const open = OPEN === c.name;
    return `<article class="card${open ? " is-open" : ""}" data-char="${esc(c.name)}">
      <button class="card-toggle" type="button" aria-expanded="${open}"
        aria-label="${esc(c.name)}：${open ? "收起" : "展开"}赠礼路线">
        <span class="char-name">${highlight(c.name, currentQuery)}</span>
        <img class="char-img" src="assets/img/chars/${encodeURIComponent(c.name)}.webp" alt="" loading="lazy" width="${c.portraitW}" height="${c.portraitH}">
        <svg class="chev" viewBox="0 0 24 24" aria-hidden="true"><path d="M6 9l6 6 6-6"/></svg>
      </button>
    </article>`;
  }

  function detailHTML(c) {
    const g = c.gift;
    const hasGift = g.items.length > 0;
    const giftInner = hasGift
      ? `<span class="gift-tag">均衡</span>
         <div class="route-main">
           <div class="route-items">
             ${g.items.map(itemHTML).join(`<span class="alt">/</span>`)}
           </div>
           <div class="route-where">${esc(g.where)}</div>
         </div>
         <div class="route-stats">
           <span class="stat fav"><i>♥</i>${fmt(g.fav)}</span>
           <span class="stat fons"><i>◈</i>${fmt(g.fons)}</span>
         </div>`
      : `<span class="gift-tag">均衡</span>
         <div class="route-main"><span class="gift-note">${esc(g.note || "无")}</span></div>`;

    return `<section class="detail" data-char="${esc(c.name)}" aria-label="${esc(c.name)} 的赠礼路线">
      <div class="card-side">
        <h3 class="char-name">${highlight(c.name, currentQuery)}</h3>
        <img class="char-img" src="assets/img/chars/${encodeURIComponent(c.name)}.webp" alt="${esc(c.name)}" loading="lazy" width="${c.portraitW}" height="${c.portraitH}">
        <button class="detail-close" type="button">收起</button>
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
  function mountDetail(c) {
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

    const box = last.nextElementSibling.querySelector(".calc");
    if (box) paintCalc(box, c);
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

  function match(c, q) {
    if (!q) return true;
    const hay = [c.name]
      .concat(c.fast.items, c.cheap.items, c.gift.items, [
        c.fast.where, c.cheap.where, c.gift.where
      ])
      .filter(Boolean)
      .join(" ")
      .toLowerCase();
    return hay.includes(q.toLowerCase());
  }

  function render() {
    const q = currentQuery.trim();
    const list = D.characters.filter((c) => match(c, q));

    grid.innerHTML = list.map(cardHTML).join("");
    emptyEl.hidden = list.length > 0;

    const openChar = OPEN ? list.find((c) => c.name === OPEN) : null;
    OPEN = openChar ? openChar.name : null;
    if (openChar) mountDetail(openChar);

    resultLine.innerHTML = q
      ? `匹配到 <b>${list.length}</b> 位角色 · 关键词「${esc(q)}」`
      : `共 <b>${D.characters.length}</b> 位角色 · 点击头像展开赠礼路线`;

    clearBtn.hidden = !q;
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

  render();
})();
