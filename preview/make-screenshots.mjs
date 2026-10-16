/**
 * 生成 README 用的**截图源页**（第二步才裁图）。
 *
 * 为什么要有这个：README 里那 9 张图必须能**重新生成**，否则它们迟早变成"手 P 的图"、
 * 跟产物脱节。这里把产物里的真 CSS 与真纯函数拿来渲一个网格页，每格一个状态，
 * 再用无头浏览器按格子坐标裁图落盘。
 *
 * 两步（第二步需要无头浏览器，Node 里没有布局引擎，裁图必须交给浏览器）：
 *   1. `node preview/make-screenshots.mjs`  → 生成 `preview/screenshots-src.html`
 *   2. 浏览器打开它，按 `window.__cells` 里每格的 x/y/w/h 调 CDP
 *      `Page.captureScreenshot({clip:{...,scale:2}})`，按 shot-01…shot-09 落盘到
 *      `preview/screenshots/`（本仓库是用 DSH 的 ego 浏览器 + 一个临时本地 HTTP
 *      服务写盘完成的；任何能跑 CDP 的浏览器都可以照做）。
 *
 * 布局：第一格是收起态那一行（shot-01），下面两排是 4 档 × 浅深色（shot-02…shot-09）。
 */
import { writeFileSync } from "node:fs";
import { createDocument, loadBundle } from "../test/harness.mjs";

const doc = createDocument();
const bundle = loadBundle(new URL("../lib/client.js", import.meta.url).pathname.replace(/^\//, ""), doc, {});
const I = bundle.plugin.__internals;

/* 每个格子的尺寸：卡片 320×232；收起态那一行 680×64 */
/* 真卡片宽度现在是打在**菜单本体**上的 `.ces-surface{width:min(268px, 100vw-32px)}`
   （按参考图比例定：卡片宽 = 输入框宽 × 37%，且 box-sizing:border-box）。
   格子要把它**连右上角的重置按钮**一起放下，所以按 268 + 两侧留白算，
   别按内容宽度算（按内容宽度算会把卡片右边裁掉）。
   `.cardwrap` 里那个写死的 width:268px 是**占位**：产物 CSS 的
   `.ces-surface{width:min(268px,…)!important}` 会把它压回 268px —— 所以格子尺寸是唯一真源。 */
const CARD_W = 300, CARD_H = 172, ROW_W = 700, ROW_H = 64;

const page = `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><title>screenshots</title>
<style>
*{box-sizing:border-box}
body{margin:0;background:#eceef1;font-family:system-ui,-apple-system,"Segoe UI","PingFang SC","Microsoft YaHei",sans-serif}
.cell{position:absolute;overflow:hidden;background:#eceef1;display:grid;place-items:center}
.cell.dark{background:#0f0f11}
/* 官方菜单的真实形状 + DSH 主题令牌 */
.cardwrap{--dsw-alias-bg-layer-1:#fff;--dsw-alias-bg-layer-2:#f5f5f5;--dsw-alias-bg-layer-3:#fff;--dsw-menu-surface-fill:#f8f9fa;--dsw-alias-border-l1:rgb(15 17 21 / 8%);--dsw-alias-border-l2:#0000001a;--dsw-alias-label-primary:#0f1115;--dsw-alias-label-secondary:#65676b;--dsw-alias-label-tertiary:#81858c;--dsw-alias-label-caption:#a2a4a6;--dsw-alias-interactive-bg-hover:#2631480f;--dsw-alias-state-business-primary:#4d93f8;--dsw-alias-state-error-primary:#e5484d;--dsw-alias-menu-icon:#979da6;--dsw-radius-sm:6px;--dsw-radius-md:12px;--dsw-radius-lg:16px;--dsw-elevation-prominent:0 10px 26px rgb(0 0 0 / 16%);--dsw-focus-ring-width:2px;--dsw-focus-ring-color:#4d93f8;color-scheme:light;width:268px}
.cardwrap.dark{--dsw-menu-surface-fill:#2a2b2f;--dsw-alias-border-l1:rgb(255 255 255 / 6%);--dsw-alias-label-primary:#ebeef2;--dsw-alias-label-secondary:#cfd3d6;--dsw-alias-label-tertiary:#adb2b8;--dsw-alias-interactive-bg-hover:#ffffff14;--dsw-alias-state-business-primary:#7aaaff;--dsw-elevation-prominent:0 10px 26px rgb(0 0 0 / 45%);color-scheme:dark}
.menu{z-index:1;width:100%;max-height:none;box-shadow:var(--dsw-elevation-prominent);color:var(--dsw-alias-label-primary);border:0;flex-direction:column;padding:4px;display:flex;position:relative;border-radius:var(--dsw-radius-lg);background:var(--dsw-menu-surface-fill)}
.cell2{box-sizing:border-box;border-radius:var(--dsw-radius-md);width:auto;min-width:100%;height:34px;color:var(--dsw-alias-label-primary);cursor:pointer;text-align:left;background:0 0;border:none;outline:none;align-items:center;gap:6px;padding:0 8px;font-size:13px;line-height:20px;display:flex;font-family:inherit}
.cellLabel{white-space:nowrap;flex:none}
.cellValue{text-overflow:ellipsis;white-space:nowrap;text-align:right;min-width:0;color:var(--dsw-alias-label-tertiary);flex:auto;overflow:hidden}
.cellChevron{width:12px;height:12px;color:var(--dsw-alias-menu-icon);flex:none}
.trigger{border-radius:var(--dsw-radius-sm);min-width:0;height:28px;color:var(--dsw-alias-label-secondary);cursor:pointer;background:0 0;border:none;outline:none;align-items:center;gap:4px;padding:0 4px 0 8px;font-size:13px;line-height:20px;display:flex;font-family:inherit}
.triggerLabel{text-overflow:ellipsis;white-space:nowrap;min-width:0;overflow:hidden}
.triggerEffort{text-overflow:ellipsis;white-space:nowrap;min-width:0;color:var(--dsw-alias-label-caption);flex-shrink:1000;overflow:hidden}
/* 收起态那一行的外壳（模拟 composer 工具行） */
.barwrap{--dsw-alias-label-secondary:#65676b;--dsw-alias-label-caption:#a2a4a6;--dsw-alias-interactive-bg-hover:#2631480f;--dsw-alias-border-l2:#0000001a;--dsw-alias-bg-layer-3:#fff;--dsw-radius-lg:16px;color-scheme:light}
.barwrap.dark{--dsw-alias-label-secondary:#cfd3d6;--dsw-alias-label-caption:#979da6;--dsw-alias-interactive-bg-hover:#ffffff14;--dsw-alias-border-l2:#ffffff1f;--dsw-alias-bg-layer-3:#2a2b2f;color-scheme:dark}
.bar{width:${ROW_W - 40}px;padding:9px 12px;border:1px solid var(--dsw-alias-border-l2);border-radius:var(--dsw-radius-lg);background:var(--dsw-alias-bg-layer-3);display:flex;align-items:center;justify-content:space-between;gap:10px;font-size:13px;color:var(--dsw-alias-label-caption)}
${I.CSS}
</style></head>
<body>
<div id="grid"></div>
<script>
const I = ${JSON.stringify({
  TH: I.TRACK_HEIGHT, KR: I.KNOB_RADIUS, PARTICLES: I.PARTICLES, STAR_MIN: I.STARFIELD_MIN,
  MEAN: I.STARFIELD_DURATION_MEAN, SPREAD: I.STARFIELD_DURATION_SPREAD, MAXF: I.MAX_SPEED_FACTOR,
})};
const CLS = ${JSON.stringify({ surface: I.CLS_SURFACE, card: I.CLS_CARD, head: I.CLS_HEAD, modelrow: I.CLS_MODELROW, value: I.CLS_VALUE, seat: I.CLS_SEAT })};
const h01 = (i, s) => (((i + 1) * s * 2654435761 % 4294967296) >>> 8) % 1000 / 1000;
const c01 = (x) => (!(x > 0) ? 0 : x > 1 ? 1 : x);
const energyFor = (p) => c01((c01(p) - 1/3) / (1 - 1/3));
const speedFor = (p) => Math.min(2, Math.max(0.35, 3 * c01(p) - 1));
const BLUE=[77,147,248], VIOLET=[147,51,234], DEEP=[76,29,149], TV=[139,92,246];
const mix=(a,b,t)=>a.map((v,i)=>Math.round(v+(b[i]-v)*c01(t)));
const fillColorFor=(p)=>{const t=c01(p);return t<=1/3?\`rgb(\${BLUE})\`:t<=2/3?\`rgb(\${mix(BLUE,VIOLET,(t-1/3)/(1/3))})\`:\`rgb(\${mix(VIOLET,DEEP,(t-2/3)/(1/3))})\`;};
const valueColorFor=(p,off)=>off?"":\`rgb(\${mix(BLUE,TV,energyFor(p))})\`;
const knob=(p)=>\`calc(\${I.KR}px + \${Math.round(c01(p)*10000)/10000} * (100% - \${I.KR*2}px))\`;

function slider(pct, name, isOff) {
  const e = energyFor(pct), on = e > 0, sp = speedFor(pct), off = knob(pct);
  const n = Math.round(e * I.PARTICLES.length);
  const stars = I.PARTICLES.slice(0, n).map((p, i) => {
    const b = (I.STAR_MIN + (1 - I.STAR_MIN) * h01(i, 61)).toFixed(3);
    const spread = 1 - I.SPREAD + 2 * I.SPREAD * h01(i, 29);
    const dur = I.MEAN * I.MAXF / sp * spread;
    const delay = -(((p.phase + h01(i, 53) * 0.03) % 1) * dur);
    return \`<span class="ces-star" data-ces-part="star" style="top:\${p.y}%;animation-duration:\${dur.toFixed(3)}s;animation-delay:\${delay.toFixed(3)}s"><span class="ces-star__dot" data-ces-part="particle" style="--ces-b:\${b}"></span></span>\`;
  }).join("");
  const ticks = [0,1,2,3].map(t => \`<span class="ces-tick" data-ces-part="tick" data-on="\${t <= Math.round(pct*3) ? 1 : 0}" style="left:\${knob(t/3)}"></span>\`).join("");
  return \`<div class="ces-inline" data-ces-part="root" data-energy="\${on?1:0}" style="--ces-energy:\${e}">
    <button type="button" class="ces-reset" data-ces-part="reset" aria-label="恢复默认档位：High" \${name === "High" ? "disabled" : ""}><svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M13.2 6.6A5.6 5.6 0 1 0 13 10.4"></path><path d="M13.4 2.8v3.9h-3.9"></path></svg></button>
    <div class="ces-track" data-ces-part="track" role="slider" tabindex="-1" aria-label="推理等级" aria-valuemin="0" aria-valuemax="3" aria-valuenow="\${Math.round(pct*3)}" aria-valuetext="\${name}">
      <div class="ces-fill" data-ces-part="fill" style="width:\${off};background:linear-gradient(90deg, rgb(\${BLUE}), \${fillColorFor(pct)})"></div>
      <div class="ces-energy" data-ces-part="energy" style="width:\${off}"><div class="ces-energy__sweep" data-ces-part="sweep"></div></div>
      <div class="ces-stars" data-ces-part="stars" style="width:\${off};opacity:\${(0.6+0.4*e).toFixed(3)}">\${stars}</div>
      \${ticks}
      <div class="ces-knob" data-ces-part="knob" style="left:\${off}"></div>
    </div>
  </div>\`;
}

function card(level, dark) {
  const { pct, name, isOff } = level;
  const hue = valueColorFor(pct, isOff);
  const rows = \`
      <button class="cell2 \${CLS.modelrow}" role="menuitem" type="button">
        <span class="cellLabel">模型</span>
        <span class="cellValue \${CLS.value}">DeepSeek-V41-Flash</span>
        <svg class="cellChevron" viewBox="0 0 17 17" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><path d="M6.5 4 11 8.5 6.5 13"></path></svg>
      </button>
      <button class="cell2 \${CLS.head}" role="menuitem" type="button">
        <span class="cellLabel">推理等级</span>
        <span class="cellValue \${CLS.value}" style="color:\${hue}">\${name}</span>
        <svg class="cellChevron" viewBox="0 0 17 17" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><path d="M6.5 4 11 8.5 6.5 13"></path></svg>
      </button>\`;
  return \`<div class="cardwrap\${dark ? " dark" : ""}">
    <div class="menu \${CLS.surface} \${CLS.card}" role="menu">\${rows}\${slider(pct, name, isOff)}</div>
  </div>\`;
}

function seatRow(dark) {
  const hue = valueColorFor(2/3, false);
  return \`<div class="barwrap\${dark ? " dark" : ""}">
    <div class="bar">
      <span>发消息或创建任务，/ 调用指令，@ 文件或对话</span>
      <button class="trigger \${CLS.seat}" aria-haspopup="menu" aria-expanded="true" type="button">
        <span class="triggerLabel">DeepSeek-V41-Flash</span>
        <span class="triggerEffort" style="color:\${hue}">High</span>
        <svg width="14" height="14" viewBox="0 0 17 17" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" style="color:var(--dsw-alias-label-caption);flex:none"><path d="M4 6.5 8.5 11 13 6.5"></path></svg>
      </button>
    </div>
  </div>\`;
}

const LEVELS = {
  max:  { pct: 1,   name: "Max",  isOff: false },
  high: { pct: 2/3, name: "High", isOff: false },
  low:  { pct: 1/3, name: "Low",  isOff: false },
  off:  { pct: 0,   name: "Off",  isOff: true },
};

/* 布局：第一行是 shot-01（收起态），下面两排是 4 档 × 浅深色 */
const grid = document.getElementById("grid");
const cells = [];
function addCell(id, w, h, x, y, dark, html) {
  const el = document.createElement("div");
  el.className = "cell" + (dark ? " dark" : "");
  el.id = id;
  el.style.cssText = \`left:\${x}px;top:\${y}px;width:\${w}px;height:\${h}px\`;
  el.innerHTML = html;
  grid.appendChild(el);
  cells.push({ id, x, y, w, h });
}

const PAD = 16;
addCell("shot-01", ${ROW_W}, ${ROW_H}, PAD, PAD, false, seatRow(false));
const order = ["max", "high", "low", "off"];
let x = PAD, y = PAD + ${ROW_H} + 20;
order.forEach((k, i) => {
  addCell("light-" + k, ${CARD_W}, ${CARD_H}, x + i * (${CARD_W} + 14), y, false, card(LEVELS[k], false));
});
y += ${CARD_H} + 20;
order.forEach((k, i) => {
  addCell("dark-" + k, ${CARD_W}, ${CARD_H}, x + i * (${CARD_W} + 14), y, true, card(LEVELS[k], true));
});

window.__cells = cells;
window.__pick = (id) => { const c = cells.find(v => v.id === id); return c || null; };
</script>
</body></html>
`;

const OUT = new URL("./screenshots-src.html", import.meta.url);
writeFileSync(OUT, page, "utf8");
console.log(`截图源页已生成：${OUT.pathname}`);
console.log("（用无头浏览器按 window.__cells 的坐标裁图到 preview/screenshots/）");
