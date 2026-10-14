/**
 * 生成观感预览页：`preview/panel.html`
 *
 * 存在的理由：真插件要重启 DSH Desktop 才看得见。这个页面把**官方模型菜单**也一起复刻出来，
 * 并且用与插件 DOM 桥**同样的手法**（只给官方形状的节点加 class 重排 + 往菜单 append 一个容器），
 * 把官方菜单变成卡片、把滑条挂上去，所以看到的排布、配色、能量层就是真东西。
 *
 * 防漂移的两条硬措施（否则预览页会慢慢变成一张骗人的图）：
 *   1. CSS 直接从 `lib/client.js` 里**抽出来**，不是复制一份；
 *   2. 拖动数学（indexFromPct / pctFromIndex / energyFor / 粒子参数）也是从产物里
 *      **抽函数体**内联进页面 —— 抽取失败就抛错，绝不悄悄生成一个数学不一样的预览。
 *
 * 明确它不是什么：静态复刻，不接宿主、不发生任何档位写回。
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const BUNDLE = join(ROOT, "lib", "client.js");
const OUT = join(ROOT, "preview", "panel.html");

const source = readFileSync(BUNDLE, "utf8");

/**
 * 取 `var CSS = [ ... ].join("\n");` —— **真求值**，不做文本抽取。
 *
 * 为什么必须求值：有几条规则用了字符串拼接（`"...height:" + TRACK_HEIGHT + "px;..."`），
 * 纯文本抽取会在拼接处断掉，把 `.ces-track` 的 height 截成空值 —— 轨道就变成 0px 高、
 * 预览页上根本看不见（这个 bug 真实发生过：实测 `track rect=254x0`）。
 */
function extractCss(text, constantsSource) {
  const start = text.indexOf("var CSS = [");
  if (start < 0) throw new Error("产物里找不到 CSS 数组");
  const end = text.indexOf('].join("\\n");', start);
  if (end < 0) throw new Error("产物里 CSS 数组的结尾形状变了");
  const expression = text.slice(start + "var CSS = ".length, end + '].join("\\n")'.length);
  const css = Function(`"use strict";\n${constantsSource}\nreturn ${expression};`)();
  if (typeof css !== "string" || css.length === 0) throw new Error("CSS 数组求值结果异常");
  if (css.includes('" +') || css.includes('+ "')) throw new Error("CSS 里残留拼接片段（求值没走对）");
  return css;
}

/**
 * 按名字抽出一个函数（含 `function name(...) { ... }` 整体）。
 * 扫描器会跳过字符串与注释里的花括号，所以函数体里写字面量 `{` 不会被算错。
 */
function extractFunction(text, name) {
  const head = `function ${name}(`;
  const start = text.indexOf(head);
  if (start < 0) throw new Error(`产物里找不到函数 ${name}（预览页必须用真函数，不能自己复制一份）`);
  let depth = 0;
  const i = text.indexOf("{", start);
  if (i < 0) throw new Error(`${name} 没有函数体`);
  for (let j = i; j < text.length; j += 1) {
    const ch = text[j];
    const next = text[j + 1];
    if (ch === "/" && next === "/") { j = text.indexOf("\n", j); continue; }
    if (ch === "/" && next === "*") { j = text.indexOf("*/", j) + 1; continue; }
    if (ch === '"' || ch === "'") {
      const quote = ch;
      j += 1;
      while (j < text.length && text[j] !== quote) {
        if (text[j] === "\\") j += 1;
        j += 1;
      }
      continue;
    }
    if (ch === "{") depth += 1;
    else if (ch === "}") {
      depth -= 1;
      if (depth === 0) return text.slice(start, j + 1);
    }
  }
  throw new Error(`${name} 的函数体没有闭合`);
}

/**
 * 抽一组 `var NAME = <表达式>;` 并**在同一个作用域里按顺序求值**（因为常量之间会互相引用，
 * 例如 `KNOB_SIZE = TRACK_HEIGHT`）。求值的是产物里我自己的常量声明，不涉及外部输入。
 */
function extractConstants(text, names) {
  const declarations = names.map((name) => {
    const match = new RegExp(`var ${name} = ([^;]+);`).exec(text);
    if (!match) throw new Error(`产物里找不到常量 ${name}`);
    return `var ${name} = ${match[1]};`;
  });
  const source = declarations.join("\n");
  const body = `${source}\nreturn { ${names.join(", ")} };`;
  return { values: Function(`"use strict";\n${body}`)(), source };
}

const fns = [
  "clamp01",
  "pctFromIndex",
  "indexFromPct",
  "mixColor",
  "rgbOf",
  "fillColorFor",
  "fillBackgroundFor",
  "energyFor",
  "speedFor",
  "particleCountFor",
  "starCountFor",
  "starLayerOpacityFor",
  "starBrightnessFor",
  "starDurationFor",
  "starDelayFor",
  "starHash01",
  "knobOffsetOf",
  "buildParticles",
  "isOffLevel",
  "valueColorFor",
].map((name) => extractFunction(source, name)).join("\n\n");
const constantNames = [
  /* 卡片重排用的 class 名：预览页必须用**产物里那一个**字符串，
     自己抄一份迟早跟产物不一致（那样预览就变成骗人的图）。 */
  "CLS_CARD",
  "CLS_HEAD",
  "CLS_MODELROW",
  "CLS_LIST",
  "CLS_OPTION",
  "CLS_OPTIONCOPY",
  "CLS_OPTIONNAME",
  "CLS_VALUE",
  "CLS_SEAT",
  "ROW_PADDING_BLOCK",
  "TRACK_HEIGHT",
  "KNOB_SIZE",
  "KNOB_RADIUS",
  "BASE_SPEEDUP",
  "STARFIELD_DURATION_MEAN",
  "STARFIELD_DURATION_SPREAD",
  "STARFIELD_MIN",
  "GOLDEN_RATIO",
  "MAX_SPEED_FACTOR",
  "MIN_HEIGHT_SLOTS",
  "ENERGY_START",
  "ENERGY_END",
  "COLOR_BLUE",
  "COLOR_VIOLET",
  "COLOR_DEEP",
  "COLOR_TEXT_VIOLET",
];
const { values: constants, source: constantsSource } = extractConstants(source, constantNames);
const css = extractCss(source, constantsSource);
if (constants.KNOB_SIZE !== constants.TRACK_HEIGHT) {
  throw new Error("产物里旋钮直径 ≠ 轨道高度（用户要求「与滑条同宽」）");
}
if (!css.includes(".ces-energy") || !css.includes(".ces-star__dot")) {
  throw new Error("抽出来的 CSS 里没有能量层/星空规则（产物结构变了）");
}
/* 卡片相关守卫：class 名必须是非空字符串；**有样式职责的那几个**还必须真在 CSS 里有规则 ——
   否则预览页会加一堆没人认领的 class，看起来"没生效"却查不出原因。 */
const MUST_HAVE_RULE = ["CLS_CARD", "CLS_HEAD", "CLS_MODELROW", "CLS_LIST", "CLS_OPTION", "CLS_OPTIONCOPY", "CLS_OPTIONNAME", "CLS_SEAT"];
/* CLS_VALUE 是个**标记**（断言/调试用），本身不带样式 —— 那两个 value span 的颜色分别是
   JS 写的内联色（卡片顶部档位名）和 `.ces-head/.ces-modelrow > span:nth-child(2)` 的规则。
   所以它只做非空校验，不过"必须有规则"这一关。 */
const MARKER_ONLY = ["CLS_VALUE"];
for (const name of [...MUST_HAVE_RULE, ...MARKER_ONLY]) {
  const value = constants[name];
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`产物里 ${name} 不是非空字符串（拿到 ${JSON.stringify(value)}）`);
  }
}
for (const name of MUST_HAVE_RULE) {
  const value = constants[name];
  if (!css.includes("." + value)) {
    throw new Error(`产物 CSS 里找不到 .${value} 的规则（${name} 加了 class 也不会有效果）`);
  }
}
/* 标记类虽然不自己出样式，但必须被那两条 nth-child 规则**间接认领**，
   否则它就是一个纯粹没用的字符串。 */
if (!css.includes(">span:nth-child(2)")) {
  throw new Error("产物 CSS 里没有 value 的样式规则（>span:nth-child(2)），CLS_VALUE 会变成死标记");
}
if (!css.includes(".ces-track{") || !css.includes(".ces-knob{")) {
  throw new Error("抽出来的 CSS 里没有轨道/旋钮规则（产物结构变了）");
}

/* ── 生成期守卫：抽出来的函数引用到的每个大写常量，预览页里都必须声明过 ──
   漏一个就是 `ReferenceError`，而它会让**整个页面脚本**挂掉（滑条都不出现）。
   这个 bug 真的发生过一次（COLOR_BLUE 没发出去），所以在这里钉死。 */
{
  const declared = new Set([
    ...constantNames,
    "PARTICLES",
  ]);
  const BUILTINS = new Set([
    "Math", "JSON", "Object", "String", "Array", "Number", "Boolean", "Date", "RegExp",
    "Error", "Infinity", "NaN", "Function", "Set", "Map", "WeakMap", "URLSearchParams", "DOMMatrixReadOnly",
  ]);
  const referenced = new Set();
  for (const match of fns.matchAll(/\b([A-Z][A-Z0-9_]{2,})\b/g)) referenced.add(match[1]);
  const missing = [...referenced].filter((name) => !declared.has(name) && !BUILTINS.has(name));
  if (missing.length > 0) {
    throw new Error(`预览页缺常量声明：${missing.join("、")} —— 会 ReferenceError 让整页脚本挂掉`);
  }
}

const html = `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<title>dsh-codex-effort-slider — 观感预览（卡片）</title>
<style>
/* ── 预览页自带的最小主题令牌（取自 DSH 官方 ui-theme 的真实取值）──
   真插件在 DSH 里直接用官方令牌，这里只是为了在浏览器里还原同一套观感。 */
body{--dsw-alias-bg-layer-1:#fff;--dsw-alias-bg-layer-2:#f5f5f5;--dsw-alias-bg-layer-3:#fff;--dsw-menu-surface-fill:#f8f9fa94;--dsw-alias-border-l1:rgb(15 17 21 / 8%);--dsw-alias-border-l2:#0000001a;--dsw-alias-label-primary:#0f1115;--dsw-alias-label-secondary:#65676b;--dsw-alias-label-tertiary:#81858c;--dsw-alias-label-caption:#a2a4a6;--dsw-alias-interactive-bg-hover:#2631480f;--dsw-alias-state-business-primary:#4d93f8;--dsw-alias-state-error-primary:#e5484d;--dsw-alias-menu-icon:#979da6;--dsw-radius-sm:6px;--dsw-radius-md:12px;--dsw-radius-lg:16px;--dsw-menu-backdrop-filter:blur(20px);--dsw-elevation-prominent:0 12px 32px rgb(0 0 0 / 18%);--dsw-focus-ring-width:2px;--dsw-focus-ring-color:#4d93f8;color-scheme:light}
body[data-ds-dark-theme]{--dsw-alias-bg-layer-1:#212123;--dsw-alias-bg-layer-2:#17171a;--dsw-alias-bg-layer-3:#292929;--dsw-menu-surface-fill:#43454a73;--dsw-alias-border-l1:rgb(255 255 255 / 6%);--dsw-alias-border-l2:#ffffff1f;--dsw-alias-label-primary:#ebeef2;--dsw-alias-label-secondary:#cfd3d6;--dsw-alias-label-tertiary:#adb2b8;--dsw-alias-label-caption:#979da6;--dsw-alias-interactive-bg-hover:#ffffff14;--dsw-alias-state-business-primary:#7aaaff;--dsw-alias-state-error-primary:#ff6b6b;--dsw-elevation-prominent:0 12px 32px rgb(0 0 0 / 45%);color-scheme:dark}
*{box-sizing:border-box}
body{margin:0;min-height:100vh;display:grid;place-items:start center;gap:18px;padding:28px;font-family:system-ui,-apple-system,"Segoe UI",Roboto,"PingFang SC","Microsoft YaHei",sans-serif;background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary)}
.stage{width:760px;max-width:100%}
.note{font-size:12px;line-height:1.7;color:var(--dsw-alias-label-tertiary);margin-bottom:14px}
.note b{color:var(--dsw-alias-label-secondary)}
.cols{display:flex;gap:26px;align-items:flex-start;flex-wrap:wrap}
.col{width:max-content;max-width:100%}
.col h4{margin:0 0 8px;font-size:12px;font-weight:600;color:var(--dsw-alias-label-tertiary)}
/* 复刻官方模型菜单外壳（.menu / .cell 的真实取值：flex 行、34px 高、padding 0 8px、gap 6px）。
   position:relative 是为了让自绘的重置按钮能贴到卡片角上（真宿主里官方菜单是 position:fixed）。 */
.mock-menu{z-index:1100;position:relative;width:420px;max-width:100%;border-radius:var(--dsw-radius-lg);background:var(--dsw-menu-surface-fill);backdrop-filter:var(--dsw-menu-backdrop-filter);box-shadow:var(--dsw-elevation-prominent);border:1px solid var(--dsw-alias-border-l2);display:flex;flex-direction:column;padding:4px}
.mock-cell{box-sizing:border-box;border-radius:var(--dsw-radius-md);width:auto;min-width:100%;height:34px;color:var(--dsw-alias-label-primary);cursor:pointer;text-align:left;background:0 0;border:none;outline:none;align-items:center;gap:6px;padding:0 8px;font-size:13px;line-height:20px;display:flex;font-family:inherit}
.mock-cell:hover{background:var(--dsw-alias-interactive-bg-hover)}
.mock-cellLabel{white-space:nowrap;flex:none}
.mock-cellValue{text-overflow:ellipsis;white-space:nowrap;text-align:right;min-width:0;color:var(--dsw-alias-label-tertiary);flex:auto;overflow:hidden}
.mock-chev{width:12px;height:12px;color:var(--dsw-alias-menu-icon);flex:none}
/* 复刻官方模型列表（子面板）的官方形状：role=menu 的滚动容器 + role=menuitemradio 的行 */
.mock-groups{display:flex;flex-direction:column;min-height:0;max-height:230px;overflow-y:auto}
.mock-option{box-sizing:border-box;border-radius:var(--dsw-radius-md);width:auto;min-width:100%;min-height:34px;color:inherit;text-align:left;cursor:pointer;background:0 0;border:none;outline:none;align-items:center;gap:6px;padding:5px 7px;display:flex;font-family:inherit;font-size:13px}
.mock-option:hover{background:var(--dsw-alias-interactive-bg-hover)}
.mock-optionCopy{flex-direction:column;flex:1;min-width:0;display:flex}
.mock-modelName{text-overflow:ellipsis;white-space:nowrap;overflow:hidden}
.mock-check{color:var(--dsw-alias-label-primary);flex:0 0 14px;place-items:center;display:grid}
.mock-check svg{width:14px;height:14px}
.mock-composer{padding:10px 12px;border:1px solid var(--dsw-alias-border-l2);border-radius:var(--dsw-radius-lg);background:var(--dsw-alias-bg-layer-3);color:var(--dsw-alias-label-tertiary);font-size:13px;display:flex;align-items:center;justify-content:space-between;gap:10px}
/* 复刻官方**收起态**模型席按钮（triggerLabel / triggerEffort 两个 span） */
.mock-trigger{display:inline-flex;align-items:center;gap:6px;height:28px;padding:0 8px;border:0;border-radius:var(--dsw-radius-sm);background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary);font:inherit;font-size:13px;cursor:pointer}
.mock-triggerLabel{font-weight:600}
.mock-triggerEffort{color:var(--dsw-alias-label-caption);font-weight:500}
.mock-trigger .mock-chev{width:14px;height:14px}
.mock-send{width:26px;height:26px;border-radius:50%;background:var(--dsw-alias-state-business-primary);opacity:.85;flex:none}
.controls{display:flex;flex-wrap:wrap;gap:8px;margin-top:16px}
.controls button{font:inherit;font-size:12px;padding:6px 10px;border-radius:999px;border:1px solid var(--dsw-alias-border-l2);background:transparent;color:var(--dsw-alias-label-secondary);cursor:pointer}
.controls button:hover{background:var(--dsw-alias-interactive-bg-hover)}
/* ── 以下是**从 lib/client.js 抽取的真 CSS** ── */
${css}
</style>
</head>
<body>
<div class="stage">
  <div class="note">
    这是 <b>观感预览</b>（静态复刻）：CSS 与拖动数学都是从 <code>lib/client.js</code> 抽取的真代码。
    插件现在的做法是<b>只给官方节点加 class 重排</b>（不新建/不搬动官方节点、不写内联样式），
    往官方菜单里只 append 一个容器；下面三段就是照着官方产物形状复刻的。
    <b>拖到最右</b>看最高档能量层。
  </div>

  <div class="cols">
    <div class="col">
      <h4>① 卡片（根面板：大号档位名 + 模型行 + 滑条 + 重置）</h4>
      <div class="mock-menu" role="menu" aria-label="模型与推理等级" id="card">
        <button class="mock-cell mock-modelrow" role="menuitem" type="button" id="modelRow">
          <span class="mock-cellLabel">模型</span>
          <span class="mock-cellValue">DeepSeek-V41-Flash</span>
          <svg class="mock-chev" viewBox="0 0 17 17" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M6.5 4 11 8.5 6.5 13"></path></svg>
        </button>
        <button class="mock-cell mock-head" role="menuitem" type="button" id="effortRow">
          <span class="mock-cellLabel">推理等级</span>
          <span class="mock-cellValue" id="effortValue">High</span>
          <svg class="mock-chev" viewBox="0 0 17 17" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M6.5 4 11 8.5 6.5 13"></path></svg>
        </button>
      </div>
    </div>

    <div class="col">
      <h4>② 模型列表（子面板，卡片式行）</h4>
      <div class="mock-menu" role="menu" aria-label="模型">
        <div class="mock-groups" role="menu" id="list">
          <button class="mock-option" role="menuitemradio" aria-checked="true" type="button">
            <span class="mock-optionCopy"><span class="mock-modelName">默认</span></span>
            <span class="mock-check"><svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M3 8.5l3.2 3.2L13 5"></path></svg></span>
          </button>
          <button class="mock-option" role="menuitemradio" aria-checked="false" type="button">
            <span class="mock-optionCopy"><span class="mock-modelName">6 Luna</span></span><span class="mock-check"></span>
          </button>
          <button class="mock-option" role="menuitemradio" aria-checked="false" type="button">
            <span class="mock-optionCopy"><span class="mock-modelName">5.6 Terra</span></span><span class="mock-check"></span>
          </button>
          <button class="mock-option" role="menuitemradio" aria-checked="false" type="button">
            <span class="mock-optionCopy"><span class="mock-modelName">5.6 Luna</span></span><span class="mock-check"></span>
          </button>
        </div>
      </div>
    </div>
  </div>

  <div class="cols" style="margin-top:22px">
    <div class="col" style="width:760px">
      <h4>③ 收起态席按钮（胶囊）</h4>
      <div class="mock-composer">
        <span>发消息或创建任务，/ 调用指令，@ 文件或对话</span>
        <button class="mock-trigger" type="button" id="seat">
          <span class="mock-triggerLabel">DeepSeek-V41-Flash</span>
          <span class="mock-triggerEffort" id="seatEffort">High</span>
          <svg class="mock-chev" viewBox="0 0 17 17" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M4 6.5 8.5 11 13 6.5"></path></svg>
        </button>
      </div>
    </div>
  </div>

  <div class="controls">
    <button id="theme">切换浅色/深色</button>
    <button id="levels4">4 档（Off/Low/High/Max）</button>
    <button id="levels2">2 档（High/Max）</button>
    <button id="levels6">6 档（含 minimal/xhigh）</button>
  </div>
</div>

<script>
/* ── 以下函数体从 lib/client.js 抽取（数学与真插件逐字一致）── */
${fns}

var ROW_PADDING_BLOCK = ${JSON.stringify(constants.ROW_PADDING_BLOCK)};
var TRACK_HEIGHT = ${JSON.stringify(constants.TRACK_HEIGHT)};
var KNOB_SIZE = ${JSON.stringify(constants.KNOB_SIZE)};
var KNOB_RADIUS = ${JSON.stringify(constants.KNOB_RADIUS)};
var BASE_SPEEDUP = ${JSON.stringify(constants.BASE_SPEEDUP)};
var STARFIELD_DURATION_MEAN = ${JSON.stringify(constants.STARFIELD_DURATION_MEAN)};
var STARFIELD_DURATION_SPREAD = ${JSON.stringify(constants.STARFIELD_DURATION_SPREAD)};
var STARFIELD_MIN = ${JSON.stringify(constants.STARFIELD_MIN)};
var GOLDEN_RATIO = ${JSON.stringify(constants.GOLDEN_RATIO)};
var MAX_SPEED_FACTOR = ${JSON.stringify(constants.MAX_SPEED_FACTOR)};
var MIN_HEIGHT_SLOTS = ${JSON.stringify(constants.MIN_HEIGHT_SLOTS)};
var ENERGY_START = ${JSON.stringify(constants.ENERGY_START)};
var ENERGY_END = ${JSON.stringify(constants.ENERGY_END)};
var COLOR_BLUE = ${JSON.stringify(constants.COLOR_BLUE)};
var COLOR_VIOLET = ${JSON.stringify(constants.COLOR_VIOLET)};
var COLOR_DEEP = ${JSON.stringify(constants.COLOR_DEEP)};
var COLOR_TEXT_VIOLET = ${JSON.stringify(constants.COLOR_TEXT_VIOLET)};
var CLS_CARD = ${JSON.stringify(constants.CLS_CARD)};
var CLS_HEAD = ${JSON.stringify(constants.CLS_HEAD)};
var CLS_MODELROW = ${JSON.stringify(constants.CLS_MODELROW)};
var CLS_LIST = ${JSON.stringify(constants.CLS_LIST)};
var CLS_OPTION = ${JSON.stringify(constants.CLS_OPTION)};
var CLS_OPTIONCOPY = ${JSON.stringify(constants.CLS_OPTIONCOPY)};
var CLS_OPTIONNAME = ${JSON.stringify(constants.CLS_OPTIONNAME)};
var CLS_VALUE = ${JSON.stringify(constants.CLS_VALUE)};
var CLS_SEAT = ${JSON.stringify(constants.CLS_SEAT)};
/* 星尘参数表：抽出来的 starDelayFor 会读 PARTICLES，这里必须真的建出来
   （少了它预览页会 ReferenceError 整个脚本挂掉 —— 生成期有守卫盯着这件事）。 */
var PARTICLES = buildParticles();
var LEVELS = {
  "4": [{id:"off",name:"Off"},{id:"low",name:"Low"},{id:"high",name:"High"},{id:"max",name:"Max"}],
  "2": [{id:"high",name:"High"},{id:"max",name:"Max"}],
  "6": [{id:"off",name:"Off"},{id:"minimal",name:"Minimal"},{id:"low",name:"Low"},{id:"medium",name:"Medium"},{id:"xhigh",name:"XHigh"},{id:"max",name:"Max"}]
};
var current = "4";
var index = 2;
var dragging = false;

/* ── 复刻插件现在的 DOM 桥：**只加 class**（不换节点、不写内联样式）+ append 一个容器 ── */
document.getElementById("card").classList.add(CLS_CARD);
document.getElementById("modelRow").classList.add(CLS_MODELROW);
document.getElementById("effortRow").classList.add(CLS_HEAD);
document.getElementById("modelRow").querySelector(".mock-cellValue").classList.add(CLS_VALUE);
document.getElementById("effortValue").classList.add(CLS_VALUE);
document.getElementById("seat").classList.add(CLS_SEAT);
document.getElementById("list").classList.add(CLS_LIST);
Array.prototype.forEach.call(document.querySelectorAll("#list .mock-option"), function (option) {
  option.classList.add(CLS_OPTION);
  var copy = option.querySelector(".mock-optionCopy");
  if (copy) copy.classList.add(CLS_OPTIONCOPY);
  var name = option.querySelector(".mock-modelName");
  if (name) name.classList.add(CLS_OPTIONNAME);
});

/* 容器 append 到**菜单末尾**（真插件就是 append 到官方菜单，而不是塞进某一行）。
   ⚠️ 产物是**两层** .ces-inline，别压成一层：
     · 外层 = DOM 桥 append 进菜单的那个容器（data-ces-part="host"）；
     · 内层 = 组件用 react-dom portal 渲进去的根（data-ces-part="root"），
       重置按钮与滑条都挂在**内层**上，data-energy / --ces-energy 也写在**内层**。
   两层同名同规则（.ces-inline 只设 flex-basis/width/box-sizing），观感上没差别，
   但结构必须对齐 —— 否则"预览里看到的层级"和真宿主不是一回事。 */
var host = document.createElement("div");
host.className = "ces-inline";
/* data-ces-part="host" 是产物给容器打的同一个标记（lib/client.js 里 append 时设的），
   预览页照打 —— 自查脚本靠它确认"容器真的 append 到了菜单上"。 */
host.setAttribute("data-ces-part", "host");
document.getElementById("card").appendChild(host);

/* 内层：portal 的落脚点（与产物同构）。能量变量与 data-energy 写在它身上。 */
var root = document.createElement("div");
root.className = "ces-inline";
root.setAttribute("data-ces-part", "root");
root.setAttribute("data-energy", "0");
host.appendChild(root);

/* 自绘的「恢复默认档位」按钮（官方没有这个按钮）。产物把它挂在**内层**上。 */
var reset = document.createElement("button");
reset.type = "button";
reset.className = "ces-reset";
reset.setAttribute("data-ces-part", "reset");
reset.setAttribute("aria-label", "恢复默认档位：High");
reset.title = "恢复默认档位：High";
reset.innerHTML = '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">'
  + '<path d="M13.2 6.6A5.6 5.6 0 1 0 13 10.4"></path><path d="M13.4 2.8v3.9h-3.9"></path></svg>';
root.appendChild(reset);

var track = document.createElement("div");
track.className = "ces-track";
track.setAttribute("role", "slider");
track.setAttribute("tabindex", "0");
var fill = document.createElement("div");
fill.className = "ces-fill";
var energy = document.createElement("div");
energy.className = "ces-energy";
var sweep = document.createElement("div");
sweep.className = "ces-energy__sweep";
energy.appendChild(sweep);
var ticks = document.createElement("span");
var knob = document.createElement("div");
knob.className = "ces-knob";
track.appendChild(fill);
track.appendChild(energy);
track.appendChild(ticks);
track.appendChild(knob);
root.appendChild(track);
var valueSpan = document.getElementById("effortValue");
var seatEffortSpan = document.getElementById("seatEffort");

/* 星空（所有出现粒子的档位共用）：外层是整轨宽度的轨道（自己在横穿），内层圆点带亮度。 */
var starDefs = buildParticles().map(function (p, i) {
  return { top: p.y, brightness: starBrightnessFor(i) };
});
/* 星星单独一层（与真组件同结构）：不跟星云淡入，否则 high 档会被星云的 0.5 透明度压暗。 */
var starHost = document.createElement("span");
starHost.className = "ces-stars";
starHost.setAttribute("data-ces-part", "stars");
starHost.style.position = "absolute";
starHost.style.inset = "0 auto 0 0";
starHost.style.borderRadius = "999px";
starHost.style.overflow = "hidden";
starHost.style.pointerEvents = "none";
track.appendChild(starHost);
var starEls = starDefs.map(function (def, i) {
  var star = document.createElement("span");
  star.className = "ces-star";
  star.style.top = def.top + "%";
  var dot = document.createElement("span");
  dot.className = "ces-star__dot";
  dot.style.setProperty("--ces-b", def.brightness.toFixed(3));
  star.appendChild(dot);
  star.style.display = "none";
  starHost.appendChild(star);
  return star;
});

/** 速度随位置变化（保留）：MAX 1.5s、high 3s、左端 ~8.6s；各星只差 ±8%。
 *  时长/相位与生产一致：**直接内联**，不走 CSS 变量（变量会让负相位在真宿主里失效）。 */
function applyParticles(pct) {
  var count = particleCountFor(pct);
  var speedFactor = speedFor(pct);
  starHost.style.width = knobOffsetOf(pct);
  starHost.style.opacity = String(starLayerOpacityFor(pct));
  starEls.forEach(function (el, i) {
    var duration = starDurationFor(i, speedFactor);
    el.style.display = i < count ? "" : "none";
    el.style.animationDuration = duration.toFixed(3) + "s";
    el.style.animationDelay = starDelayFor(i, duration).toFixed(3) + "s";
  });
  starHost.setAttribute("data-count", String(count));
}

/* 系统开了「减少动态效果」时真插件用 title 说明原因；预览页照做 */
var reduced = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
root.setAttribute("data-motion", reduced ? "reduced" : "full");
if (reduced) track.title = "推理等级（系统「减少动态效果」已开启：粒子已放缓）";

function renderTicks() {
  var levels = LEVELS[current];
  ticks.innerHTML = "";
  levels.forEach(function (level, i) {
    var tick = document.createElement("span");
    tick.className = "ces-tick";
    tick.style.left = knobOffsetOf(pctFromIndex(i, levels.length));
    tick.dataset.on = i <= index ? "1" : "0";
    ticks.appendChild(tick);
  });
}

function render(pct) {
  var levels = LEVELS[current];
  var shownPct = typeof pct === "number" ? pct : pctFromIndex(index, levels.length);
  var strength = energyFor(shownPct);
  var shown = levels[index];
  var offset = knobOffsetOf(shownPct);
  fill.style.width = offset;
  fill.style.background = fillBackgroundFor(shownPct);
  energy.style.width = offset; // 能量条只覆盖已填充段（档位右边没到的地方不显示）
  knob.style.left = offset;
  root.style.setProperty("--ces-energy", String(strength));
  root.dataset.energy = strength > 0 ? "1" : "0";
  valueSpan.textContent = shown.name;
  // 卡片顶部那个大号档位名：跟着**显示中**的位置/档位着色（Off 档 = 空串 = 官方灰）
  valueSpan.style.color = valueColorFor(shownPct, shown);
  // 收起态的席按钮：显示的是**已生效**档位（预览里没有草稿，就是当前档），同样着色
  seatEffortSpan.textContent = shown.name;
  seatEffortSpan.style.color = valueColorFor(pctFromIndex(index, levels.length), shown);
  // 已经就在默认档（high）上时按钮置灰 —— 与产物一致
  if (shown.id === "high") reset.setAttribute("disabled", "");
  else reset.removeAttribute("disabled");
  track.setAttribute("aria-valuemax", String(levels.length - 1));
  track.setAttribute("aria-valuenow", String(index));
  track.setAttribute("aria-valuetext", shown.name);
  applyParticles(shownPct);
  renderTicks();
}

function pctAt(clientX) {
  var rect = track.getBoundingClientRect();
  var usable = rect.width - KNOB_RADIUS * 2;
  if (!(usable > 0)) return null;
  return clamp01((clientX - rect.left - KNOB_RADIUS) / usable);
}

function onMove(clientX) {
  var pct = pctAt(clientX);
  if (pct === null) return;
  index = indexFromPct(pct, LEVELS[current].length);
  render(pct);
}

track.addEventListener("pointerdown", function (event) {
  dragging = true;
  track.setPointerCapture(event.pointerId);
  onMove(event.clientX);
});
track.addEventListener("pointermove", function (event) { if (dragging) onMove(event.clientX); });
function end() { if (!dragging) return; dragging = false; render(); }
track.addEventListener("pointerup", end);
track.addEventListener("pointercancel", end);
track.addEventListener("keydown", function (event) {
  var levels = LEVELS[current];
  var next = null;
  if (event.key === "ArrowLeft" || event.key === "ArrowDown") next = Math.max(0, index - 1);
  else if (event.key === "ArrowRight" || event.key === "ArrowUp") next = Math.min(levels.length - 1, index + 1);
  else if (event.key === "Home") next = 0;
  else if (event.key === "End") next = levels.length - 1;
  else return;
  event.preventDefault();
  index = next;
  render();
});

/* 重置按钮：产物写回的是**模型的默认档**（defaultEffort）。
   预览页不接宿主、不能真写档位，所以这里只把它"按下去"的效果演出来 ——
   回到默认档（High），并在已经是 High 时置灰（与产物的判定一致）。 */
reset.addEventListener("click", function () {
  if (reset.disabled) return;
  var levels = LEVELS[current];
  for (var i = 0; i < levels.length; i += 1) {
    if (levels[i].id === "high") { index = i; break; }
  }
  render();
});

function setLevels(key) {
  current = key;
  index = Math.min(index, LEVELS[key].length - 1);
  render();
}

/* 支持 ?level=off|low|high|max 与 ?theme=dark|light
   （无头截图和自查都用它们定位到具体状态）。 */
(function applyQuery() {
  var params = new URLSearchParams(location.search);
  var wantedTheme = (params.get("theme") || "").toLowerCase();
  if (wantedTheme === "dark") document.body.setAttribute("data-ds-dark-theme", "");
  else if (wantedTheme === "light") document.body.removeAttribute("data-ds-dark-theme");
  var wantedLevels = params.get("levels");
  if (wantedLevels === "2" || wantedLevels === "4" || wantedLevels === "6") current = wantedLevels;
  var wanted = (params.get("level") || "").toLowerCase();
  if (wanted === "") return;
  var levels = LEVELS[current];
  for (var i = 0; i < levels.length; i += 1) {
    if (levels[i].id === wanted) { index = i; return; }
  }
})();

document.getElementById("theme").addEventListener("click", function () {
  if (document.body.hasAttribute("data-ds-dark-theme")) document.body.removeAttribute("data-ds-dark-theme");
  else document.body.setAttribute("data-ds-dark-theme", "");
});
document.getElementById("levels4").addEventListener("click", function () { setLevels("4"); });
document.getElementById("levels2").addEventListener("click", function () { setLevels("2"); });
document.getElementById("levels6").addEventListener("click", function () { setLevels("6"); });

render();
</script>
</body>
</html>
`;

mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, html, "utf8");
console.log(`预览页已生成：${OUT}`);
console.log(`（CSS ${css.length} 字符 + ${fns.split("function ").length - 1} 个抽自产物的函数 + 卡片 class=${constants.CLS_CARD}/${constants.CLS_HEAD}/${constants.CLS_MODELROW}）`);
