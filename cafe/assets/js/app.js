/* ============================================================
   一咖舍 · 经营计算器 — 主逻辑
   语言切换 / 日期与风向标计算 / 渲染 / 视图切换 / 交互 / 启动
   依赖：assets/js/data.js（须先于本文件加载）
   ============================================================ */

let LANG = 'zh';

/* ================= 多语言 ================= */
function T(k, v){
  const d = I18N[LANG] || I18N.zh;
  let s = (d[k] !== undefined) ? d[k] : (I18N.zh[k] !== undefined ? I18N.zh[k] : k);
  if(v) for(const p in v) s = s.split('{'+p+'}').join(v[p]);
  return s;
}
function TA(k){ const d = I18N[LANG] || I18N.zh; return d[k] !== undefined ? d[k] : I18N.zh[k]; }
function catName(c, short){ return LANG==='en' ? ((short ? CAT_EN_S[c] : CAT_EN[c]) || c) : c; }
function prodName(p){ return LANG==='en' ? (PROD_EN[p.n] || p.n) : p.n; }
function empName(n){ return LANG==='en' ? (EMP_EN[n] || n) : n; }
function weekdayName(d){ return LANG==='en' ? TA('weekdays')[d.getDay()] : '周' + TA('weekdays')[d.getDay()]; }

function applyLang(){
  document.documentElement.lang = LANG==='en' ? 'en' : 'zh-CN';
  document.title = T('docTitle');
  document.querySelectorAll('[data-t]').forEach(el=>{ el.textContent = T(el.dataset.t); });
  document.querySelectorAll('[data-th]').forEach(el=>{ el.innerHTML = T(el.dataset.th); });
  document.querySelectorAll('#langSw span[data-l]').forEach(el=> el.classList.toggle('on', el.dataset.l === LANG));
}
function setLang(l){
  LANG = (l === 'en') ? 'en' : 'zh';
  S.lang = LANG;
  applyLang();
  render();
}

/* ================= 工具 ================= */
const $ = s => document.querySelector(s);
function ymd(d){ return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0'); }
function parseYmd(s){ const a=s.split('-').map(Number); return new Date(a[0],a[1]-1,a[2]); }
function dayIdx(d){ return Math.round((Date.UTC(d.getFullYear(),d.getMonth(),d.getDate()) - BASE_DAY)/86400000); }
function catOf(d){ return CATS[((dayIdx(d)%6)+6)%6]; }
/* 生效日：12:00 前仍沿用前一日（对应表格 B12 = INT(NOW()-TIME(12,0,0))） */
function effDate(now){
  const n = now || new Date();
  const d = new Date(n.getFullYear(), n.getMonth(), n.getDate());
  if(n.getHours() < 12) d.setDate(d.getDate() - 1);
  return d;
}
/* 下一次切换时刻：今天 12:00，若已过则为明天 12:00 */
function nextSwitch(now){
  const n = now || new Date();
  const t = new Date(n.getFullYear(), n.getMonth(), n.getDate(), 12, 0, 0, 0);
  if(n.getHours() >= 12) t.setDate(t.getDate() + 1);
  return t;
}
function fmt(n,dp){
  if(!isFinite(n)) return '0';
  const d = dp===undefined ? (Math.abs(n)>=1000?0:1) : dp;
  return n.toLocaleString(LANG==='en'?'en-US':'zh-CN',{minimumFractionDigits:d, maximumFractionDigits:d});
}
function trim(n){ return (Math.round(n*100)/100).toString(); }

/* ================= 状态 ================= */
let S = {sel: DEF_SEL.slice(), date: ymd(effDate()), auto: true, used: DEF_USED.slice(), cs: true, lang:'zh', fold:true};

/* ================= 计算 ================= */
function buffs(){
  const b = {flow:0, sellAdd:0, sellPct:0, flowPct:0};
  EMP.forEach(e=>{ if(S.used.includes(e.n)) for(const k in e.s) b[k]+=e.s[k]; });
  if(S.cs) for(const k in CS.s) b[k]+=CS.s[k];
  return b;
}
function calc(){
  const b = buffs();
  const flow = (BASE_FLOW + b.flow) * (1 + b.flowPct/100);
  const flowMul = flow / BASE_FLOW;
  const cat = catOf(parseYmd(S.date));

  /* 单品在某风向标下的收益：命中原料才加成
     · 命中：表格 E 列写法 (基础价 + 加成 + 售价加成) × (1+售价加成%) × 24 × 人流量加成
     · 咖啡豆列在表格里用的是 C+B14 的写法，此处保持与原表一致 */
  const valueFor = (p, c) => {
    const mk = 1 + b.sellPct/100;
    const C  = (p.p + b.sellAdd) * mk;
    const t  = 24 * flowMul;
    if(!p.ing.includes(c)) return C * t;
    if(c === '咖啡豆')     return (C + CAT_ADD[c]) * t;
    return (p.p + CAT_ADD[c] + b.sellAdd) * mk * t;
  };

  const rows = PRODUCTS.map(p=>{
    const price = (p.p + b.sellAdd) * (1 + b.sellPct/100);
    const hit = p.ing.includes(cat);
    return {p, price, no: price*24*flowMul, hit, val: valueFor(p, cat)};
  });
  const rev = S.sel.reduce((s,i)=> s + (rows[i] ? rows[i].val : 0), 0);

  /* 各风向标下的小时营收对照 */
  const cmp = CATS.map(c=>({
    c, add: CAT_ADD[c],
    rev: S.sel.reduce((s,i)=> s + (PRODUCTS[i] ? valueFor(PRODUCTS[i], c) : 0), 0),
    n:   S.sel.filter(i=> PRODUCTS[i] && PRODUCTS[i].ing.includes(c)).length,
  }));

  return {b, flow, flowMul, cat, rows, rev, cmp};
}

/* ================= 渲染 ================= */
function paintNote(){
  const now = new Date();
  const ns = nextSwitch(now);
  const ms = Math.max(0, ns - now);
  const h = Math.floor(ms/3600000), m = Math.floor(ms%3600000/60000), s = Math.floor(ms%60000/1000);
  const clock = h + ':' + String(m).padStart(2,'0') + ':' + String(s).padStart(2,'0');
  const after = new Date(ns.getFullYear(), ns.getMonth(), ns.getDate());
  $('#heroNote').innerHTML = T(S.auto ? 'noteAuto' : 'noteManual',
    {clock, date: ymd(after).slice(5).replace('-','.'), cat: catName(catOf(after))});
}

function paint(el, cat, glow){
  el.style.setProperty('--cat-bg', CAT_COLOR[cat]);
  el.style.setProperty('--cat-c', CAT_COLOR[cat]);
  if(glow) el.style.setProperty('--cat-glow', CAT_COLOR[cat]+'55');
}
const STAT_META = [
  ['flow',   'kFlow',    'b1'],
  ['sellAdd','kSellAdd', 'b2'],
  ['sellPct','kSellPct', 'b3'],
  ['flowPct','kFlowPct', 'b4'],
];

function render(){
  const R = calc(), b = R.b;
  const d = parseYmd(S.date);

  const eff = effDate();
  $('#todayStr').textContent = ymd(eff).replace(/-/g,'.');
  $('#todayCat').textContent = T('todayCat', {cat: catName(catOf(eff))});

  $('#btnAuto').style.display = S.auto ? 'none' : 'inline-block';
  paintNote();

  $('#dateIn').value = S.date;
  $('#weekday').textContent = weekdayName(d);
  $('#trendName').textContent = catName(R.cat);
  $('#trendAdd').textContent = '×' + CAT_ADD[R.cat];
  paint($('#hero'), R.cat, true);
  paint($('#trendChip'), R.cat, false);
  $('#trendTip').textContent = T('tip', {n: CAT_ADD[R.cat]});
  $('#cycle').innerHTML = CATS.map(c=>
    `<div class="cyc ${c===R.cat?'on':''}" style="--cat-bg:${CAT_COLOR[c]}">${catName(c,true)}</div>`).join('');

  $('#sRev').innerHTML  = fmt(R.rev,2) + '<span class="u">/h</span>';
  $('#sMul').innerHTML  = R.flowMul.toFixed(4) + '<span class="u">×</span>';
  $('#sFlow').innerHTML = fmt(R.flow,0);

  /* 上架商品：已选的完整展示，未选的折叠成一行 */
  $('#selCount').textContent = T('selCount', {n: S.sel.length, t: PRODUCTS.length});
  const ingTags = (p, cat, mini) =>
    `<div class="ing${mini?' mini2':''}">` +
    p.ing.map(c=>`<i class="${c===cat?'on':''}" style="--c:${CAT_COLOR[c]}">${catName(c)}</i>`).join('') +
    `</div>`;

  let selHtml = '', idleHtml = '';
  R.rows.forEach((r,i)=>{
    if(!S.sel.includes(i)){
      idleHtml += `<div class="item mini" data-i="${i}" style="--cat-c:${CAT_COLOR[R.cat]}">
        <div class="tick"><svg viewBox="0 0 24 24" fill="none" stroke="#1a1411" stroke-width="3.4" stroke-linecap="round" stroke-linejoin="round"><path d="M4 12.5l5.5 5.5L20 7"/></svg></div>
        <div class="nm">${prodName(r.p)}</div>
        <div class="pv ${r.hit?'hit':''}">${r.p.p}</div>
      </div>`;
      return;
    }
    const diff = r.val - r.no;
    selHtml += `<div class="item sel ${r.hit?'hit':''}" data-i="${i}" style="--cat-c:${r.hit?CAT_COLOR[R.cat]:'rgba(255,255,255,.12)'}">
      <div class="tick"><svg viewBox="0 0 24 24" fill="none" stroke="#1a1411" stroke-width="3.4" stroke-linecap="round" stroke-linejoin="round"><path d="M4 12.5l5.5 5.5L20 7"/></svg></div>
      <div class="info">
        <div class="nm">${prodName(r.p)}</div>
        ${ingTags(r.p, R.cat)}
        <div class="mt">
          <span>${T('itemBase')} <b>${r.p.p}</b></span>
          <span>${T('itemAdj')} <b>${fmt(r.price,2)}</b></span>
          <span>${r.hit ? '<span style="color:'+CAT_COLOR[R.cat]+'">'+T('itemHit',{cat:catName(R.cat)})+'</span>' : T('itemMiss')}</span>
        </div>
      </div>
      <div class="earn">
        <div class="n">${fmt(r.val,0)}</div>
        <div class="d ${r.hit?'up':''}">${r.hit ? '↑ +'+fmt(diff,0) : fmt(r.no,0)}</div>
      </div>
    </div>`;
  });
  $('#selList').innerHTML = selHtml;
  $('#idleList').innerHTML = idleHtml;

  /* 未选商品折叠栏 */
  const idleN = PRODUCTS.length - S.sel.length;
  $('#idleWrap').classList.toggle('hide', idleN === 0);
  $('#foldBar').classList.toggle('on', idleN > 0);
  $('#idleList').classList.toggle('hide', S.fold || idleN === 0);
  $('#foldBar').classList.toggle('open', !S.fold);
  $('#foldText').textContent = T(S.fold ? 'foldShow' : 'foldHide', {n: idleN});

  /* 各风向标对照 */
  $('#cmpBody').innerHTML = R.cmp.map(o=>
    `<tr class="${o.c===R.cat?'hi':''}" style="--cat-c:${CAT_COLOR[o.c]}">
       <td><span class="dotc" style="background:${CAT_COLOR[o.c]}"></span>${catName(o.c)}</td>
       <td class="muted">+${o.add}</td>
       <td class="muted">${o.n}</td>
       <td class="${o.c===R.cat?'hot':''}">${fmt(o.rev,2)}</td></tr>`).join('');

  /* 商品总览 */
  $('#goodsCat').textContent = T('goodsCat', {cat: catName(R.cat), n: CAT_ADD[R.cat]});
  $('#goodsBody').innerHTML = R.rows.map(r=>
    `<tr class="${r.hit?'hi':''}" style="--cat-c:${r.hit?CAT_COLOR[R.cat]:'rgba(255,255,255,.12)'}">
       <td>${prodName(r.p)}${ingTags(r.p, R.cat, true)}</td>
       <td class="muted">${r.p.p}</td><td>${fmt(r.price,2)}</td>
       <td class="${r.hit?'muted':''}">${fmt(r.no,0)}</td>
       <td class="${r.hit?'hot':'muted'}">${fmt(r.val,0)}</td></tr>`).join('');

  /* 加成汇总 */
  $('#b-flow').textContent    = '+' + trim(b.flow);
  $('#b-sellAdd').textContent = '+' + trim(b.sellAdd);
  $('#b-sellPct').textContent = '+' + trim(b.sellPct);
  $('#b-flowPct').textContent = '+' + trim(b.flowPct);

  /* 雇员编排 */
  const usedEmp = EMP.filter(e=>S.used.includes(e.n));
  const idleEmp = EMP.filter(e=>!S.used.includes(e.n));
  const card = e => {
    const chips = STAT_META.filter(([k])=> e.s[k]!==undefined)
      .map(([k,label,cls])=>`<i class="${cls}">${T(label)} +${trim(e.s[k])}</i>`).join('');
    return `<div class="emp ${S.used.includes(e.n)?'on':'off'}" data-n="${e.n}" data-cs="0">
      <div class="en"><i class="av" style="background-image:url('${empAv(e.n)}')"></i><span class="en-n">${empName(e.n)}</span></div>
      <div class="es">${chips}</div></div>`;
  };
  const csCard = on => `<div class="emp ${on?'on':'off'}" data-n="${CS.n}" data-cs="1">
      <div class="en"><i class="av" style="background-image:url('${empAv(CS.n)}')"></i><span class="en-n">${T('csName')}</span><span class="cs">${T('csTag')}</span></div>
      <div class="es"><i class="b4">${T('kFlowPct')} +1</i></div></div>`;

  $('#col-used').innerHTML = usedEmp.map(card).join('') + (S.cs ? csCard(true) : '');
  $('#col-idle').innerHTML = idleEmp.map(card).join('') + (S.cs ? '' : csCard(false));

  const usedN = usedEmp.length + (S.cs ? 1 : 0);
  $('#c-used').textContent = `${usedN} / ${MAX_EMP + 1}`;
  $('#c-used').className = 'cnt' + (usedEmp.length >= MAX_EMP ? ' full' : '');
  $('#c-idle').textContent = `${idleEmp.length + (S.cs ? 0 : 1)}`;
  $('#col-used').className = 'col-in' + (usedEmp.length >= MAX_EMP ? ' full' : '');

  /* 日历 */
  const start = parseYmd(S.date);
  $('#calHead').innerHTML = TA('weekdays').map(x=>`<div class="h">${x}</div>`).join('');
  let cells = '';
  for(let i=0;i<start.getDay();i++) cells += '<div></div>';
  for(let i=0;i<28;i++){
    const dd = new Date(start.getFullYear(), start.getMonth(), start.getDate()+i);
    const c = catOf(dd), k = ymd(dd), isEff = k === ymd(effDate());
    cells += `<div class="day ${k===S.date?'today':''} ${isEff?'eff':''} ${i>13?'dim':''}" style="--cat-bg:${CAT_COLOR[c]}" data-d="${k}" title="${catName(c)}">
      <div class="dd">${dd.getDate()}</div><div class="dc"></div></div>`;
  }
  $('#calGrid').innerHTML = cells;
  $('#legend').innerHTML = CATS.map(c=>`<div class="lg"><i style="background:${CAT_COLOR[c]}"></i>${catName(c)}</div>`).join('');

  try{ localStorage.setItem(KEY, JSON.stringify(S)); }catch(e){}
}

/* ================= 响应式视图切换 ================= */
let curView = 'earn';
const mqPC = window.matchMedia('(min-width: 960px)');

const allTabs  = () => document.querySelectorAll('.tab');
const allViews = () => document.querySelectorAll('.view');

function applyViews(){
  const pc = mqPC.matches;
  allViews().forEach(v=> v.classList.toggle('on', pc || v.id === 'v-' + curView));
}
function setTab(name){
  curView = name;
  allTabs().forEach(t=> t.classList.toggle('on', t.dataset.v === name));
}
function goView(name){
  setTab(name); applyViews();
  if(mqPC.matches){                       /* 大屏：滚动定位到区块 */
    const el = document.getElementById('v-' + name);
    if(el) el.scrollIntoView({behavior:'smooth', block:'start'});
  }else{                                  /* 小屏：切换视图并回顶 */
    window.scrollTo({top:0, behavior:'smooth'});
  }
}
/* 大屏滚动联动侧栏高亮 */
function scrollSpy(){
  if(!mqPC.matches) return;
  const views = [...allViews()];
  let name = curView;
  views.forEach(v=>{ if(v.getBoundingClientRect().top <= 150) name = v.id.slice(2); });
  /* 已滚到底部时，最后一屏即当前区块（避免高亮回退） */
  if(views.length && window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 8)
    name = views[views.length-1].id.slice(2);
  if(name !== curView) setTab(name);
}
/* 底部菜单栏真实高度（含 iPhone 安全区）→ 写入 --nav-h，
   供 .app 的 padding-bottom 与 toast 定位使用，避免内容被底栏盖住 */
function syncNavH(){
  const nav = document.querySelector('nav');
  if(!nav) return;
  const h = mqPC.matches ? 0 : nav.offsetHeight;
  document.documentElement.style.setProperty('--nav-h', h + 'px');
}
function onMQChange(){
  applyViews();
  syncNavH();
  if(mqPC.matches) scrollSpy();
}
window.addEventListener('resize', syncNavH);
window.addEventListener('orientationchange', syncNavH);
if(mqPC.addEventListener) mqPC.addEventListener('change', onMQChange);
else if(mqPC.addListener) mqPC.addListener(onMQChange);
window.addEventListener('scroll', scrollSpy, {passive:true});

/* ================= 交互 ================= */
document.addEventListener('click', e=>{
  const tab = e.target.closest('.tab');
  if(tab){ goView(tab.dataset.v); return; }
  if(e.target.closest('#foldBar')){ S.fold = !S.fold; render(); return; }
  const it = e.target.closest('.item');
  if(it){
    const i = +it.dataset.i, k = S.sel.indexOf(i);
    if(k>-1) S.sel.splice(k,1); else S.sel.push(i);
    S.sel.sort((a,b)=>a-b); render(); return;
  }
  const emp = e.target.closest('.emp');
  if(emp){
    if(emp.dataset.cs === '1'){ S.cs = !S.cs; render(); return; }
    const n = emp.dataset.n, k = S.used.indexOf(n);
    if(k>-1) S.used.splice(k,1);
    else {
      if(S.used.length >= MAX_EMP){ toast(T('toastMax',{n:MAX_EMP})); return; }
      S.used.push(n);
      S.used = EMP_NAMES.filter(x=>S.used.includes(x));
    }
    render(); return;
  }
  const day = e.target.closest('.day');
  if(day){ S.date = day.dataset.d; S.auto = false; render(); toast(T('toastSwitch',{d:S.date})); return; }
});

$('#langSw').addEventListener('click', e=>{
  const s = e.target.closest('span[data-l]');
  if(!s || s.dataset.l === LANG) return;
  const l = s.dataset.l;
  setLang(l);
  toast(T('toastLang', {l: I18N[l] ? I18N[l].langLabel : l}));
});

$('#dateIn').addEventListener('change', e=>{
  if(e.target.value){ S.date = e.target.value; S.auto = false; render(); }
});

$('#btnAuto').addEventListener('click', ()=>{
  S.auto = true; S.date = ymd(effDate()); render(); toast(T('toastBack'));
});

$('#btnReset').addEventListener('click', ()=>{
  S.used = DEF_USED.slice(); S.cs = true; render(); toast(T('toastReset'));
});

function toast(t){
  const el = $('#toast'); el.textContent = t; el.classList.add('on');
  clearTimeout(el._t); el._t = setTimeout(()=>el.classList.remove('on'), 1700);
}

/* ================= 启动 ================= */
(function init(){
  try{
    const raw = localStorage.getItem(KEY);
    if(raw){
      const o = JSON.parse(raw);
      if(o && typeof o==='object'){
        S = Object.assign(S, o);
        if(!Array.isArray(S.used)) S.used = DEF_USED.slice();
        S.used = EMP_NAMES.filter(n=>S.used.includes(n)).slice(0, MAX_EMP);
        S.cs = o.cs !== false;
        S.auto = o.auto !== false;
      }
    }
  }catch(e){}
  if(!Array.isArray(S.sel) || !S.sel.length) S.sel = DEF_SEL.slice();
  if(S.auto || !S.date) S.date = ymd(effDate());
  const ql = new URLSearchParams(location.search).get('lang');   /* ?lang=en 可直接进英文 */
  if(ql === 'en' || ql === 'zh') S.lang = ql;
  const qv = new URLSearchParams(location.search).get('view');   /* ?view=emp 可直接进某个页签 */
  if(['earn','emp','goods','cal'].includes(qv)) curView = qv;
  LANG = (S.lang === 'en') ? 'en' : 'zh';
  applyLang();
  render();
  setTab(curView);
  applyViews();
  syncNavH();

  setInterval(()=>{
    const eff = ymd(effDate());
    if(S.auto && eff !== S.date){ S.date = eff; render(); return; }   // 12:00 到点自动切换
    paintNote();
  }, 1000);
})();
