/* ============================================================
   一咖舍 · 经营计算器 — 数据层
   商品 / 雇员 / 品类配置 + 中英词条
   （数据源自 一咖舍.xlsx、word.xlsx）
   ============================================================ */

/* ================= 数据（源自 一咖舍.xlsx） ================= */
const CATS = ['主食','甜品','饮料','面粉','水果','咖啡豆'];
const CAT_ADD = {'主食':1,'甜品':1,'饮料':1,'面粉':0.75,'水果':0.75,'咖啡豆':0.75};
const CAT_COLOR = {'主食':'#e8a33d','甜品':'#e0709b','饮料':'#4fb3c8','面粉':'#d4c25a','水果':'#6fc26a','咖啡豆':'#a9713f'};

/* 商品 = 基础价格 + 原料构成（风向标加成作用于原料） */
const PRODUCTS = [
  {n:'红豆黄油可颂',   p:14,   ing:['主食','面粉']},
  {n:'草莓盒子蛋糕',   p:14.5, ing:['甜品','面粉','水果']},
  {n:'橙香热咖啡',     p:15,   ing:['饮料','水果','咖啡豆']},
  {n:'炸猪排三明治',   p:15.5, ing:['主食','面粉']},
  {n:'脆椰曲奇玛奇朵', p:16,   ing:['饮料','水果','咖啡豆']},
  {n:'雪顶抹茶拿铁',   p:16.5, ing:['饮料','咖啡豆']},
  {n:'提拉米苏',       p:17,   ing:['甜品','面粉','咖啡豆']},
  {n:'火腿芝士可颂',   p:17.5, ing:['主食','面粉']},
  {n:'焦糖可可千层',   p:18,   ing:['甜品','面粉']},
];
const DEF_SEL = [2,4,5,6,8];

/* 雇员池：人流量 / 售价加成 / 售价加成% / 人流量% */
const EMP = [
  {n:'薄荷',     s:{sellAdd:0.3}},
  {n:'哈尼娅',   s:{sellAdd:0.42}},
  {n:'阿德勒',   s:{sellAdd:0.3}},
  {n:'埃德嘉',   s:{flow:63}},
  {n:'海月',     s:{sellAdd:0.12, flowPct:2.5}},
  {n:'翳',       s:{flow:45}},
  {n:'娜娜莉',   s:{sellAdd:0.5}},
  {n:'早雾',     s:{sellAdd:0.42}},
  {n:'达芙蒂尔', s:{flow:45}},
  {n:'小吱',     s:{flow:45}},
  {n:'安魂曲',   s:{sellPct:2.5}},
  {n:'真红',     s:{sellAdd:0.6, sellPct:3}},
  {n:'白藏',     s:{flow:45}},
  {n:'伊洛伊',   s:{flow:63}},
  {n:'灵可',     s:{flow:63}},
  {n:'明音凛',   s:{flow:63}},
];
const CS = {n:'专属客服', s:{flowPct:1}, cs:true};

/* 角色头像：assets/img/chars/<角色名>.webp（128px 方形头像） */
const EMP_AV_DIR = 'assets/img/chars/';
function empAv(n){ return EMP_AV_DIR + n + '.webp'; }
const EMP_NAMES = EMP.map(e=>e.n);
const DEF_USED = ['哈尼娅','埃德嘉','海月','早雾','明音凛','小吱','安魂曲','真红','伊洛伊','灵可'];
const MAX_EMP = 10;
const BASE_FLOW = 2400;

const BASE_DAY = Date.UTC(2026,8,11);
const KEY = 'yikaishe.v4';   /* v4：默认编排改为明音凛（替换达芙蒂尔），旧缓存不再沿用 */

/* ================= 中英词条（英文词条参考 word.xlsx） ================= */
const CAT_EN   = {'主食':'Main Dishes','甜品':'Desserts','饮料':'Beverages','面粉':'Flour','水果':'Fruit','咖啡豆':'Coffee Beans'};
const CAT_EN_S = {'主食':'Main','甜品':'Dessert','饮料':'Drink','面粉':'Flour','水果':'Fruit','咖啡豆':'Coffee'};
const PROD_EN = {
  '红豆黄油可颂':'Red Bean & Butter Crossiant',
  '草莓盒子蛋糕':'Strawberry Box Cake',
  '橙香热咖啡':'Orange Hot Coffee',
  '炸猪排三明治':'Pork Cutlet',
  '脆椰曲奇玛奇朵':'Coconut Macchiato',
  '雪顶抹茶拿铁':'Matcha Latte with Milk Cap',
  '提拉米苏':'Tiramisu',
  '火腿芝士可颂':'Ham & Cheese',
  '焦糖可可千层':'Caramel & Cocoa Mille-Feuille',
};
const EMP_EN = {
  '早雾':'Sakiri','安魂曲':'Lacrimosa','翳':'Skia','娜娜莉':'Nanally','薄荷':'Mint','哈尼娅':'Haniel',
  '埃德嘉':'Edgar','白藏':'Baicang','哈索尔':'Hathor','阿德勒':'Adler','达芙蒂尔':'Daffodill',
  '海月':'Aurelia','小吱':'Chiz','伊洛伊':'Iroi','真红':'Shinku','明音凛':'Akane Rin','灵可':'Lingke',
};

const I18N = {
  zh:{
    docTitle:'一咖舍 · 经营计算器',
    appName:'一咖舍', appSub:'经营计算器',
    todayCat:'{cat} 生效中',
    heroLbl:'当日风向标',
    tip:'命中品类价格 +{n}',
    btnAuto:'回到当前生效日',
    noteA:'12:00 前沿用前一日加成',
    noteAuto:'<b>{clock}</b> 后切换 → {date} {cat}',
    noteManual:'手动选择中 · <b>{clock}</b> 后进 {date} {cat}',
    statRev:'小时营收', statMul:'人流量加成', statFlow:'总人流量',
    listTitle:'上架商品', selCount:'已选 {n} / {t}',
    foldShow:'未选中 {n} 个', foldHide:'收起未选中 {n} 个',
    cmpTitle:'各风向标对照', cmpSub:'按当前上架商品',
    thTrend:'风向标', thAdd:'加成', thHit:'命中', thRev:'小时营收',
    itemBase:'基础', itemAdj:'加成价', itemHit:'命中 {cat}', itemMiss:'未命中',
    goodsTitle:'商品收益总览', goodsCat:'当前：{cat} ×{n}',
    thItem:'商品', thBase:'基础', thAdj:'加成价', thNo:'无风向标', thToday:'今日收益',
    empTitle:'加成汇总', empSub:'来自上阵雇员',
    kFlow:'人流量', kSellAdd:'售价加成', kSellPct:'售价加成%', kFlowPct:'人流量%',
    maxTitle:'雇员编排', maxSub:'点击卡片切换上阵',
    colUsed:'已使用', colIdle:'未使用',
    resetBtn:'恢复表格默认编排',
    calTitle:'风向标日历', calSub:'6 日一循环',
    csName:'专属客服', csTag:'专属',
    navEarn:'收益', navGoods:'商品', navEmp:'雇员', navCal:'日历',
    weekdays:['日','一','二','三','四','五','六'],
    toastMax:'最多上阵 {n} 名雇员，请先撤下一位',
    toastSwitch:'已切到 {d}', toastBack:'已回到当前生效日',
    toastReset:'已恢复表格默认编排', toastLang:'已切换为 {l}',
    langLabel:'中文',
    goodsNote:`<h3>计算规则</h3>
        <p>
          每个商品由若干种<b>原料</b>构成，风向标加成作用于原料：<br>
          · 原料命中当日风向标 → 基础价格额外 <code>+风向标加成</code> 再计算<br>
          · 未命中 → 只按加成价计算<br>
          加成价 = (基础价格 + 售价加成) × (1 + 售价加成%)<br>
          收益 = 加成价 × 24 × 人流量加成
        </p>`,
    empNote:`<h3>规则</h3>
        <p>
          上阵上限 <code>10 名雇员 + 1 名专属客服</code>，只有「已使用」一侧的加成参与计算。<br>
          总人流量 = (2400 + Σ人流量) × (1 + Σ人流量%)<br>
          人流量加成 = 总人流量 ÷ 2400<br>
          默认编排下：(2400 + 297) × 1.035 = <code>2791.40</code>，加成 <code>1.1631×</code>
        </p>`,
    calNote:`<h3>循环顺序</h3>
            <p>主食 → 甜品 → 饮料 → 面粉 → 水果 → 咖啡豆，每 6 天一轮。主食 / 甜品 / 饮料加成为 <code>1</code>，面粉 / 水果 / 咖啡豆加成为 <code>0.75</code>。</p>
            <p style="margin-top:7px">加成在 <b style="color:var(--gold2)">当日 12:00</b> 起生效，12:00 之前仍沿用前一天的加成（金色「生效」格为当前生效日）。</p>`,
  },
  en:{
    docTitle:'Origen Cafe · Business Calculator',
    appName:'The Cafe by Origen', appSub:'Business Calculator',
    todayCat:'{cat} active',
    heroLbl:"Today's Trend",
    tip:'Matched category price +{n}',
    btnAuto:'Back to current day',
    noteA:"Before 12:00, previous day's bonus applies",
    noteAuto:'Switch in <b>{clock}</b> → {date} {cat}',
    noteManual:'Manual · next {date} {cat} in <b>{clock}</b>',
    statRev:'Revenue/h', statMul:'Popularity Bonus', statFlow:'Total Traffic',
    listTitle:'Listed Items', selCount:'Selected {n} / {t}',
    foldShow:'{n} not selected', foldHide:'Hide {n} unselected',
    cmpTitle:'Trend Comparison', cmpSub:'Based on listed items',
    thTrend:'Trend', thAdd:'Bonus', thHit:'Hits', thRev:'Revenue/h',
    itemBase:'Base', itemAdj:'Adj.', itemHit:'Matched {cat}', itemMiss:'No match',
    goodsTitle:'Item Revenue Overview', goodsCat:'Now: {cat} ×{n}',
    thItem:'Item', thBase:'Base', thAdj:'Adj.', thNo:'No Trend', thToday:'Today',
    empTitle:'Bonus Summary', empSub:'From deployed employees',
    kFlow:'Traffic', kSellAdd:'Price Add', kSellPct:'Price Add%', kFlowPct:'Traffic%',
    maxTitle:'Employee Setup', maxSub:'Tap a card to deploy',
    colUsed:'Deployed', colIdle:'Idle',
    resetBtn:'Restore default lineup',
    calTitle:'Trend Calendar', calSub:'6-day cycle',
    csName:'Exclusive Customer Service', csTag:'CS',
    navEarn:'Revenue', navGoods:'Items', navEmp:'Staff', navCal:'Calendar',
    weekdays:['Sun','Mon','Tue','Wed','Thu','Fri','Sat'],
    toastMax:'Up to {n} employees can be deployed — remove one first',
    toastSwitch:'Switched to {d}', toastBack:'Back to current day',
    toastReset:'Default lineup restored', toastLang:'Switched to {l}',
    langLabel:'English',
    goodsNote:`<h3>Calculation Rules</h3>
        <p>
          Each item is made of several <b>ingredients</b>; the trend bonus applies to ingredients:<br>
          · Ingredient matches today's trend → base price gets an extra <code>+trend bonus</code> before calculation<br>
          · No match → calculated on the adjusted price only<br>
          Adj. price = (Base price + Price add) × (1 + Price add%)<br>
          Revenue = Adj. price × 24 × Traffic multiplier
        </p>`,
    empNote:`<h3>Rules</h3>
        <p>
          Up to <code>10 employees + 1 exclusive customer service</code>; only bonuses on the "Deployed" side count.<br>
          Total traffic = (2400 + ΣTraffic) × (1 + ΣTraffic%)<br>
          Traffic multiplier = Total traffic ÷ 2400<br>
          With the default lineup: (2400 + 297) × 1.035 = <code>2791.40</code>, multiplier <code>1.1631×</code>
        </p>`,
    calNote:`<h3>Cycle Order</h3>
            <p>Main Dishes → Desserts → Beverages → Flour → Fruit → Coffee Beans, one cycle every 6 days. Main Dishes / Desserts / Beverages have a bonus of <code>1</code>; Flour / Fruit / Coffee Beans <code>0.75</code>.</p>
            <p style="margin-top:7px">The bonus takes effect at <b style="color:var(--gold2)">12:00 daily</b>; before 12:00 the previous day's bonus still applies (the gold "ON" cell marks the currently active day).</p>`,
  }
};
