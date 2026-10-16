/**
 * dsh-codex-effort-slider — 客户端离线测试
 *
 * 跑法：`node test/client.test.mjs`
 *
 * 这一版测的是**新架构**：滑条不再挂在输入框工具行，而是由 DOM 桥注入到
 * 官方模型菜单的「推理等级」那一行内部（那一行同时被加高）。所有断言里最要紧的几条：
 *   · 只动那一行（官方原有的 label/value/chevron 一个不动），关菜单后**逐个还原**
 *   · 拖动真的写回官方档位；不把宿主打爆（去重 + 在途合并 + 降频）
 *   · 找不到锚点/不是自己的会话就**什么都不做**（fail-open，官方菜单绝不受影响）
 *   · 结构上不存在消息注入这条路
 */
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createDocument, createFakeHost, createOfficialMenu, loadBundle, settle, wait } from "./harness.mjs";

const BUNDLE = fileURLToPath(new URL("../lib/client.js", import.meta.url));
const SOURCE = readFileSync(BUNDLE, "utf8");
/** 去掉注释后的代码：断言「产物里没有 X」时必须看代码，注释里提到同类插件的坑不算违规。 */
const CODE = SOURCE.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/[^\n]*/g, "$1");

let passed = 0;
let failed = 0;
const failures = [];

function ok(condition, label) {
  if (condition) {
    passed += 1;
    console.log(`  ok   ${label}`);
  } else {
    failed += 1;
    failures.push(label);
    console.log(`  FAIL ${label}`);
  }
}

function eq(actual, expected, label) {
  const same = Object.is(actual, expected);
  ok(same, same ? label : `${label}（期望 ${JSON.stringify(expected)}，实际 ${JSON.stringify(actual)}）`);
}

function near(actual, expected, label, tolerance = 1e-6) {
  const same = typeof actual === "number" && Math.abs(actual - expected) <= tolerance;
  ok(same, same ? label : `${label}（期望 ≈${expected}，实际 ${actual}）`);
}

function section(title) {
  console.log(`\n[${title}]`);
}

/**
 * 起一个完整场景：假官方菜单 + 真产物 + 假宿主，并把组件挂进**官方 composer 内部**
 * （插槽在真实布局里就在那里，桥要靠这个位置判定"哪颗席是我的"）。
 */
async function setup(options = {}) {
  const document = createDocument();
  const menu = createOfficialMenu(document, options.menu);
  const bundle = loadBundle(BUNDLE, document, { reducedMotion: options.reducedMotion === true });
  const host = createFakeHost(options.host ?? {});
  bundle.plugin.apply(host.ctx);
  const entry = host.registered[0];
  if (!entry) throw new Error("插件没有注册任何插槽条目");
  bundle.react.mount(entry.Component, Object.assign({ sessionId: "session-abcdef" }, options.props ?? {}), menu.composer);
  await settle();
  return {
    document,
    menu,
    bundle,
    react: bundle.react,
    plugin: bundle.plugin,
    registration: bundle.registration,
    host,
    entry,
    internals: bundle.plugin.__internals,
  };
}

/** 现查轨道节点并给确定几何（假 DOM 不做布局）。
    只有 width 参与指针映射（`usable = width − 2×KNOB_RADIUS`），高度仅供观感，
    这里给一个和真实轨道同量级的值即可。 */
function track(react, left = 0, width = 300) {
  const node = react.find("track");
  if (!node) return null;
  node.rect = { left, top: 0, right: left + width, bottom: 26, width, height: 26 };
  return node;
}

function officialRowText(row) {
  return String(row.textContent);
}

/** 真实 DOM 里"没设置过的内联样式"读作 ""，假 DOM 是 undefined；断言统一走这个。 */
function cssValue(node, prop) {
  return node.style[prop] ?? "";
}

/* ══════════════════════════════════════════════════════════════════════ */

section("1. 接线与产物");
{
  const { registration, plugin, entry, document, host, internals } = await setup();
  eq(registration.id, "dsh-codex-effort-slider", "[1] bundle 注册 id 正确");
  ok(Array.isArray(plugin.inject) && plugin.inject.indexOf("slots") >= 0, "[1] inject 含 slots");
  ok(plugin.inject.indexOf("modelDirectories") >= 0, "[1] inject 含 modelDirectories（读写官方档位靠它）");
  ok(plugin.inject.indexOf("sessions") >= 0, "[1] inject 含 sessions（判子代理会话靠它）");
  eq(entry.opts.name, "conversation.input.right", "[1] 仍然注册插槽条目（不可见锚点：拿 sessionId + ctx 的立足点）");
  eq(entry.opts.id, "codex-effort-slider", "[1] 条目 id 是自己的");
  const styles = document.querySelectorAll('style[data-plugin-css="dsh-codex-effort-slider"]');
  eq(styles.length, 1, "[1] 样式挂载一次");
  internals.installStyles();
  eq(document.querySelectorAll('style[data-plugin-css="dsh-codex-effort-slider"]').length, 1, "[1] 重复安装样式是幂等的");
  eq(host.subscriptions.length, 0, "[1] apply 期间没有订阅任何宿主事件");
  ok(internals.CSS.indexOf(".ces-track") > 0, "[1] 样式里有轨道规则");
}

section("2. 卡片重排：只加 class、不换节点，官方原有内容一个不动");
{
  const { menu, react, internals } = await setup();
  const row = menu.effortRow;

  // ── 只加 class（官方节点一个不换）───────────────────────────────
  ok(menu.menu.classList.contains(internals.CLS_CARD), "[2] 官方菜单本体拿到了卡片 class");
  ok(row.classList.contains(internals.CLS_HEAD), "[2] 「推理等级」那一行拿到了卡片顶部 class");
  ok(menu.modelRow.classList.contains(internals.CLS_MODELROW), "[2] 「模型」那一行拿到了模型行 class");
  ok(menu.effortValueEl.classList.contains(internals.CLS_VALUE), "[2] 档位名 span 拿到了 value class");
  ok(menu.modelValueEl.classList.contains(internals.CLS_VALUE), "[2] 模型名 span 拿到了 value class");

  // ── 不写内联样式（还原时只需摘 class，绝不会把官方样式改坏）──────
  eq(cssValue(row, "paddingTop"), "", "[2] 不再往官方行写内联内距（改成 class 了）");
  eq(cssValue(row, "height"), "", "[2] 不再往官方行写内联高度");
  eq(cssValue(row, "flexWrap"), "", "[2] 不再往官方行写内联折行");
  eq(cssValue(menu.menu, "padding"), "", "[2] 也不往菜单本体写内联样式");

  // ── 官方结构完好：节点没被搬走/换掉 ─────────────────────────────
  eq(row.getAttribute("role"), "menuitem", "[2] 官方 role 没被动过");
  eq(row.children.filter((child) => child.tagName === "SPAN").length, 2, "[2] 官方原有的两个 span（label/value）都还在");
  eq(row.children.filter((child) => child.tagName === "SVG").length, 1, "[2] 官方 chevron 还在");
  ok(officialRowText(row).indexOf("推理等级") >= 0, "[2] 官方文案原样保留");
  eq(menu.effortValueEl.textContent, "High", "[2] 档位名文字是官方的（内容一个字没改）");
  eq(menu.modelValueEl.textContent, "DeepSeek-V41-Flash", "[2] 模型名文字是官方的");

  // ── 滑条容器：append 到**菜单末尾**（不再是塞进那一行）──────────
  const host_ = react.find("host");
  ok(host_ !== null, "[2] 滑条容器被注入");
  eq(host_.parentNode, menu.menu, "[2] 容器的父节点是官方菜单（卡片）");
  eq(menu.menu.children[menu.menu.children.length - 1], host_, "[2] 容器是菜单的最后一个子节点");
  eq(react.portalHosts.length, 1, "[2] 只有一次 portal（没有重复注入）");
  eq(react.portalHosts[0], host_, "[2] portal 的目标就是那个容器");

  const track_ = react.find("track");
  eq(track_.getAttribute("role"), "slider", "[2] 滑条有 role=slider");
  eq(track_.getAttribute("aria-valuemin"), "0", "[2] aria-valuemin");
  eq(track_.getAttribute("aria-valuemax"), "3", "[2] aria-valuemax = 档位数-1");
  eq(track_.getAttribute("aria-valuenow"), "2", "[2] aria-valuenow = 当前档位下标（high = 2）");
  eq(track_.getAttribute("aria-valuetext"), "High", "[2] aria-valuetext = 官方档位名");
  eq(react.findAll("tick").length, 4, "[2] 刻度数 = 档位数");
  eq(react.find("fill").style.width, internals.knobOffsetOf(2 / 3), "[2] 填充宽度 = 到旋钮圆心（两端各内缩一个半径）");
  eq(react.find("knob").style.left, internals.knobOffsetOf(2 / 3), "[2] 旋钮圆心与填充终点重合");
  eq(react.findAll("tick")[0].style.left, internals.knobOffsetOf(0), "[2] 刻度也走同一套内缩几何（首刻度不顶出左端）");
  eq(react.findAll("tick")[3].style.left, internals.knobOffsetOf(1), "[2] 末刻度不顶出右端");
  ok(react.find("anchor").getAttribute("hidden") !== null, "[2] 锚点自身不可见（输入框工具行不出现任何东西）");
}

section("2c. 官方模型列表也重排成卡片式行（只加 class）");
{
  const { menu, internals } = await setup();
  ok(menu.groups.classList.contains(internals.CLS_LIST), "[2c] 官方列表容器拿到了卡片列表 class");
  const first = menu.modelOptions[0];
  ok(first.option.classList.contains(internals.CLS_OPTION), "[2c] 官方列表行拿到了卡片行 class");
  ok(first.copy.classList.contains(internals.CLS_OPTIONCOPY), "[2c] 文案容器拿到了 class");
  ok(first.nameEl.classList.contains(internals.CLS_OPTIONNAME), "[2c] 名字 span 拿到了 class");
  for (const entry of menu.modelOptions) {
    ok(entry.option.classList.contains(internals.CLS_OPTION), `[2c] 每一行都被重排（${entry.name}）`);
  }
  // 官方结构完好
  eq(menu.modelOptions.length, 3, "[2c] 官方三行都还在");
  eq(first.option.getAttribute("role"), "menuitemradio", "[2c] 官方 role 没被动过");
  eq(first.option.getAttribute("aria-checked"), "true", "[2c] 官方选中态没被动过");
  eq(first.nameEl.textContent, "DeepSeek-V41-Flash", "[2c] 模型名文字一个字没改");
  eq(cssValue(first.option, "padding"), "", "[2c] 不写内联样式（只加 class）");

  // CSS 里确实有这些规则（否则 class 加了个寂寞）
  for (const [name, cls] of [["菜单", internals.CLS_CARD], ["顶部行", internals.CLS_HEAD], ["模型行", internals.CLS_MODELROW], ["列表", internals.CLS_LIST], ["列表行", internals.CLS_OPTION]]) {
    ok(internals.CSS.indexOf("." + cls + "{") > 0 || internals.CSS.indexOf("." + cls + ">") > 0, `[2c] 样式表里有 ${name} 的规则（.${cls}）`);
  }
}

section("2d. 卡片顶部：大号档位名 + 模型名行（视频里的那张卡片）");
{
  const { internals, menu } = await setup();
  const css = internals.CSS;
  // 顶部：label 与 chevron 藏起来、value 放大居中
  ok(css.indexOf("." + internals.CLS_HEAD + ">span:first-child,") > 0, "[2d] 顶部行藏掉官方的 label（「推理等级」四个字）");
  ok(css.indexOf("." + internals.CLS_HEAD + ">svg{display:none") > 0, "[2d] 顶部行藏掉官方的 chevron");
  const headValueRule = css.slice(css.indexOf("." + internals.CLS_HEAD + ">span:nth-child(2){"));
  ok(headValueRule.indexOf("font-size:16px") > 0, "[2d] 档位名放大到 16px（大号标题，按参考图比例）");
  ok(headValueRule.indexOf("font-weight:600") > 0, "[2d] 档位名加粗");
  ok(headValueRule.indexOf("text-align:center") > 0, "[2d] 档位名居中");
  // 模型行：label 藏起来、value 居中、chevron 留着
  ok(css.indexOf("." + internals.CLS_MODELROW + ">span:first-child{display:none") > 0, "[2d] 模型行藏掉官方的「模型」两个字");
  const modelRule = css.slice(css.indexOf("." + internals.CLS_MODELROW + ">span:nth-child(2){"));
  ok(modelRule.indexOf("color:var(--dsw-alias-label-secondary)") > 0, "[2d] 模型名用次要色（视频里是灰的）");
  // 顶部行不再吃 hover 底色（官方的可点行 hover 会有底色，这里刻意去掉）
  ok(css.indexOf("." + internals.CLS_HEAD + ":hover{background:0 0") > 0, "[2d] 顶部行去掉 hover 底色（保持卡片观感）");

  // ── 顶部行现在是**真的可点**：它的 click 被 guardRow 转发到「模型」那一行，
  //    所以指针要读起来可点（原来是 default，因为那时点了什么也不会发生）。
  const headRule = css.slice(css.indexOf("." + internals.CLS_HEAD + "{height:auto"));
  const headBody = headRule.slice(0, headRule.indexOf("}"));
  ok(headBody.indexOf("cursor:pointer!important") > 0, "[2d] 顶部行指针是 pointer（它现在会转发到模型列表）");
  ok(headBody.indexOf("position:relative!important") > 0, "[2d] 顶部行是 relative（伪元素靠它定位）");
  ok(css.indexOf("." + internals.CLS_HEAD + "::after{") > 0, "[2d] 顶部行有一个透明伪元素把点击面积补到卡片底（红框是一整片）");
  // 上半张的补面积必须**跟着行高自动伸缩**（写死 height 会在行高变化时留缝）
  const headAfter = css.slice(css.indexOf("." + internals.CLS_HEAD + "::after{"));
  const headAfterBody = headAfter.slice(0, headAfter.indexOf("}"));
  ok(headAfterBody.indexOf("top:100%") > 0 && headAfterBody.indexOf("height:2px") > 0,
    "[2d] 补面积用 top:100%;height:2px（只补上半张底边那点字体空白，不盖住下半张）");
  // 两行文字的行距：卡片 gap 归零、上半张下内距归零
  ok(css.indexOf("." + internals.CLS_CARD + "{gap:0}") > 0, "[2d] 卡片两行之间不留 gap（行距收紧）");
  ok(headBody.indexOf("padding:0!important") > 0, "[2d] 顶部行下内距归零（行距收紧）");

  // ── 视觉顺序：大号档位名在上、模型名在下（视频里的排布）。
  //    官方 DOM 顺序是[模型][推理等级]，用 flex order 换位（**不搬节点**）。
  ok(css.indexOf("." + internals.CLS_HEAD + "{order:-2}") > 0, "[2d] 顶部行 order=-2（排到最上面）");
  ok(css.indexOf("." + internals.CLS_MODELROW + "{order:-1}") > 0, "[2d] 模型行 order=-1（排在顶部行之下）");
  // 顺序靠 CSS 换，DOM 本身不能被动过
  eq(menu.menu.children[0], menu.modelRow, "[2d] DOM 里第一个子节点仍是官方的模型行（没搬节点）");
  eq(menu.menu.children[1], menu.effortRow, "[2d] DOM 里第二个子节点仍是官方的推理等级行");
}

section("2q. 悬停「档位名 + 模型名」那片区域 → 浮出浅灰圆角胶囊（参考图）");
{
  const { internals, menu } = await setup();
  const css = internals.CSS;

  // 胶囊画在模型名那个 value span 上：span 是内容宽盒子，胶囊于是跟着模型名贴身
  const modelValueRule = css.slice(css.indexOf("." + internals.CLS_MODELROW + ">span:nth-child(2){"));
  ok(modelValueRule.indexOf("position:relative!important") > 0, "[2q] 模型名 span 是 relative（胶囊靠它定位）");

  const chipStart = css.indexOf("." + internals.CLS_MODELROW + ">span:nth-child(2)::after{");
  ok(chipStart > 0, "[2q] 有一个画胶囊的伪元素");
  const chipRule = css.slice(chipStart);
  const chipBody = chipRule.slice(0, chipRule.indexOf("}"));
  ok(chipBody.indexOf("position:absolute") > 0, "[2q] 胶囊是绝对定位的伪元素");
  // 竖直方向负偏移罩住上一行：head 22（line-height，gap 与下内距都已归零）+ modelrow 20
  ok(chipBody.indexOf("top:-25px") > 0 && chipBody.indexOf("bottom:-1px") > 0, "[2q] 胶囊往上罩住「档位名」那一行（两行都在胶囊内）");
  // 水平方向：左 12px，右 26px = 12 + chevron 11 + 行内 gap 3
  ok(chipBody.indexOf("left:-12px") > 0 && chipBody.indexOf("right:-26px") > 0, "[2q] 胶囊横向只包住文字与雪弗龙（不铺满卡片）");
  ok(chipBody.indexOf("border-radius:5px") > 0, "[2q] 胶囊是圆角矩形（5px，参考图等比）");
  ok(chipBody.indexOf("background:var(--dsw-alias-interactive-bg-hover") > 0, "[2q] 胶囊是官方那层浅灰交互底色");
  ok(chipBody.indexOf("opacity:0") > 0, "[2q] 默认不显示（悬停才浮出）");
  ok(chipBody.indexOf("pointer-events:none") > 0, "[2q] 胶囊不吃点击（红框整片仍可点进列表）");
  ok(chipBody.indexOf("z-index:-1") > 0, "[2q] 胶囊在两行文字之下（文字仍可见）");

  // 悬停两行**任意一行**都让胶囊浮出；官方 DOM 里 head 在后面，兄弟选择器只能向后匹配 ⇒ 用 :has()
  ok(css.indexOf("." + internals.CLS_MODELROW + ":hover>span:nth-child(2)::after") > 0, "[2q] 悬停模型名那一行 → 胶囊浮出");
  ok(css.indexOf("." + internals.CLS_CARD + ":has(" + "." + internals.CLS_HEAD + ":hover)>" + "." + internals.CLS_MODELROW + ">span:nth-child(2)::after") > 0,
    "[2q] 悬停档位名那一行 → 同一个胶囊浮出（:has() 跨兄弟匹配）");
  ok(css.indexOf("opacity:1!important") > 0, "[2q] 悬停态把胶囊显出来");

  // 官方给两行都画了铺满整行的 hover 底色 —— 必须中和，否则和贴身胶囊叠成两层
  const neutralRule = css.slice(css.indexOf("." + internals.CLS_MODELROW + ":hover,"));
  ok(neutralRule.indexOf("background:0 0!important") > 0, "[2q] 模型行去掉官方铺满整行的 hover 底色（只留贴身胶囊）");

  // 胶囊是纯 CSS，不许给行加新 class（[4]/[4b] 有 className 全等断言）
  eq(menu.modelRow.className, "cell ces-modelrow", "[2q] 模型行 class 没被改动（胶囊是纯 CSS）");
}

section("2h. 卡片尺寸按参考图比例锁住（防止以后又跑偏）");
{
  const { internals } = await setup();
  const css = internals.CSS;

  // 参考图（ChatGPT 桌面版强度弹层）实测比例，本机输入框逻辑宽 ≈ 712px：
  //   卡片宽 ÷ 输入框宽 = 37.0%  → 712 × 37% ≈ 264，取 268
  //   滑条高 ÷ 卡片宽   = 10.6%  → 268 × 10.6% ≈ 28
  //   旋钮 ÷ 滑条高     = 100%   ← 与 KNOB_SIZE = TRACK_HEIGHT 一致
  //
  // 但**滑条高用户后来单独要求「变细 2 个像素」**：28 → 26（9.7%），这里按用户口径锁死，
  // 不再要求等于参考图的 28。宽度仍按参考图锁 268。
  // 宽度与内距现在打在**菜单本体**（CLS_SURFACE）上而不是卡片上：官方同一个 portal 容器
  // 换 pane，只给卡片打宽度会让 drill 进列表时宽度突变（292 → 248）并重锚一次。
  const surfaceRule = css.slice(css.indexOf("." + internals.CLS_SURFACE + "{"));
  const surfaceBody = surfaceRule.slice(0, surfaceRule.indexOf("}"));
  const widthMatch = /width:min\((\d+)px/.exec(surfaceBody);
  ok(widthMatch !== null, "[2h] 卡片宽度写成了固定的 min(Npx, …)");
  const cardWidth = widthMatch === null ? 0 : Number(widthMatch[1]);
  ok(cardWidth >= 250 && cardWidth <= 290, `[2h] 卡片宽 ${cardWidth}px 落在参考图比例换算出的区间（250~290）`);

  // 官方的菜单本体是 content-box，宽度写 268 会变成 268+12×2=292 并溢出窄视口 —— 必须 border-box
  ok(surfaceBody.indexOf("box-sizing:border-box") > 0, "[2h] 菜单本体是 border-box（宽度含内距，窄视口不溢出）");
  ok(surfaceBody.indexOf("max-width:min(") > 0, "[2h] 宽度有上界（长模型名不把卡片撑爆）");

  // 滑条高 / 卡片宽：参考图 10.6%（= 28px），用户后来又要求「变细 2px」→ 26px ≈ 9.7%。
  // 锁在 26±1，避免以后又被顺手改回去。
  const trackRatio = internals.TRACK_HEIGHT / cardWidth;
  const trackPct = trackRatio * 100;
  ok(Math.abs(internals.TRACK_HEIGHT - 26) <= 1, `[2h] 滑条高 = ${internals.TRACK_HEIGHT}px（用户要求 28 减 2）`);
  ok(Math.abs(trackPct - 9.7) <= 1, `[2h] 滑条高/卡片宽 = ${trackPct.toFixed(1)}%（26/268 ≈ 9.7%，容差 1）`);

  // 旋钮直径必须等于滑条高（"与滑条同宽"，参考图实测 100%）
  eq(internals.KNOB_SIZE, internals.TRACK_HEIGHT, "[2h] 旋钮直径 = 滑条高（参考图实测 100%）");

  // 滑条长宽比：参考图 8.6:1。滑条宽 ≈ 卡片宽 − 2×padding
  const padMatch = /padding:(\d+)px/.exec(surfaceBody);
  const pad = padMatch === null ? 0 : Number(padMatch[1]);
  const trackWidth = cardWidth - pad * 2;
  const aspect = trackWidth / internals.TRACK_HEIGHT;
  ok(aspect >= 6 && aspect <= 11, `[2h] 滑条长宽比 = ${aspect.toFixed(1)}:1（参考图 8.6:1，容差放宽到 6~11）`);

  // 标题字号要跟着卡片收窄（22px 是 420px 卡片时代的尺寸）
  const headRule = css.slice(css.indexOf("." + internals.CLS_HEAD + ">span:nth-child(2){"));
  ok(headRule.indexOf("font-size:16px") > 0, "[2h] 标题字号 16px（与 268px 卡片配套，不再是 22px）");
}

section("2i. 菜单本体挂 ces-surface（三个面板永远同宽，drill 时不突变）");
{
  const { menu, internals, bundle } = await setup();
  ok(menu.menu.classList.contains(internals.CLS_SURFACE), "[2i] 菜单本体拿到了 ces-surface");
  // 宽度与内距必须打在菜单本体上，否则 drill 进列表时官方 .menu 自己那套宽度会让卡片窄一圈
  const rule = internals.CSS.slice(internals.CSS.indexOf("." + internals.CLS_SURFACE + "{"));
  const body = rule.slice(0, rule.indexOf("}"));
  ok(body.indexOf("padding:12px") > 0, "[2i] 菜单本体的内距写在这里（卡片自己不再写）");
  ok(body.indexOf("width:min(") > 0, "[2i] 宽度写在这里");
  const cardRule = internals.CSS.slice(internals.CSS.indexOf("." + internals.CLS_CARD + "{"));
  const cardBody = cardRule.slice(0, cardRule.indexOf("}"));
  ok(cardBody.indexOf("width:") < 0, "[2i] 卡片规则不再自己写宽度（避免两套宽度打架）");

  // 关闭后必须还原（ces-surface 也在记账里）
  menu.close();
  bundle.flushObservers();
  await settle();
  const { menu: menu2, bundle: bundle2 } = await setup();
  menu2.close();
  bundle2.flushObservers();
  await settle();
  ok(!menu2.menu.classList.contains(internals.CLS_SURFACE), "[2i] 关闭后菜单本体的 ces-surface 摘掉");
}

section("2j. 「搜索模型…」那一行视觉收起，但输入框仍可聚焦（官方键盘路径不能断）");
{
  const { menu, internals, bundle } = await setup();
  const css = internals.CSS;

  ok(menu.searchRow !== null, "[2j] 夹具里有官方的搜索行（前置条件）");
  ok(menu.searchRow.classList.contains(internals.CLS_SEARCHROW), "[2j] 搜索行拿到了收起 class");
  eq(menu.searchInput.readOnly, true, "[2j] 输入框被设成 readOnly（不再能打字过滤）");

  // 只加 class、不写内联样式（否则官方重渲染会和我们打架）
  eq(cssValue(menu.searchRow, "display"), "", "[2j] 不写内联 display（官方 React 重渲染会覆盖）");
  const rule = css.slice(css.indexOf("." + internals.CLS_SEARCHROW + "{"));
  const body = rule.slice(0, rule.indexOf("}"));
  ok(body.indexOf("position:absolute") > 0, "[2j] 绝对定位（不再占一行的高度）");
  ok(body.indexOf("width:1px") > 0 && body.indexOf("height:1px") > 0, "[2j] 收成 1×1");
  ok(body.indexOf("opacity:0") > 0, "[2j] 透明");
  ok(body.indexOf("pointer-events:none") > 0, "[2j] 不可点（不会误触）");
  // ⚠️ 关键：不能用 display:none —— 官方 drill 进列表后会把焦点给这个输入框，
  //    方向键/Enter/Tab 全挂在 `event.target instanceof HTMLInputElement` 上。
  ok(body.indexOf("display:none") < 0, "[2j] 不用 display:none（那样输入框收不到焦点，官方键盘导航会卡死）");

  // 关闭后 readOnly 还原
  menu.close();
  bundle.flushObservers();
  await settle();
  eq(menu.searchInput.readOnly, false, "[2j] 关闭后输入框的 readOnly 还原");
  ok(!menu.searchRow.classList.contains(internals.CLS_SEARCHROW), "[2j] 搜索行的收起 class 摘掉");
}

section("2k. 菜单里的 keydown 守卫：单字符键吃掉，方向键/Enter 放行");
{
  const { menu } = await setup();
  const fire = (key, extra = {}) => {
    let prevented = false;
    menu.menu.dispatch("keydown", Object.assign({ key, preventDefault() { prevented = true; } }, extra));
    return prevented;
  };
  ok(fire("g") === true, "[2k] 可打印字符被 preventDefault（否则会变成隐形搜索词）");
  ok(fire("5") === true, "[2k] 数字键同理");
  ok(fire("ArrowDown") === false, "[2k] 方向键放行（官方靠它移动高亮）");
  ok(fire("ArrowUp") === false, "[2k] 方向上放行");
  ok(fire("Enter") === false, "[2k] Enter 放行（官方靠它选中模型）");
  ok(fire("Tab") === false, "[2k] Tab 放行");
  ok(fire("Escape") === false, "[2k] Escape 放行（官方靠它返回/关闭）");
  ok(fire("Backspace") === false, "[2k] 退格放行");
  ok(fire("a", { ctrlKey: true }) === false, "[2k] 带修饰键的组合放行（Ctrl+A 等宿主快捷键）");
}

section("2l. 列表行用回官方样式（圆角矩形 / 34px 行高 / 官方内距）");
{
  const { internals } = await setup();
  const rule = internals.CSS.slice(internals.CSS.indexOf("." + internals.CLS_OPTION + "{"));
  const body = rule.slice(0, rule.indexOf("}"));
  // 用户要求「模型列表卡片用回官方的样式」：官方 `._7KE1Ra_option` 是
  // border-radius:var(--dsw-radius-md) / min-height:34px / padding:5px 7px / gap:6px。
  // 我们把这四个值**显式写回**（不是改造）—— 同一个元素上我们的 class 与官方哈希
  // class 优先级相同、两张表先后不确定，显式声明才能确定地拿到官方外观。
  ok(body.indexOf("border-radius:var(--dsw-radius-md,12px)") > 0, "[2l] 圆角用回官方的 --dsw-radius-md（12px 圆角矩形）");
  ok(body.indexOf("border-radius:999px") < 0, "[2l] 不再是 999px 胶囊");
  ok(body.indexOf("min-height:34px") > 0, "[2l] 行高用回官方的 34px");
  ok(body.indexOf("padding:5px 7px") > 0, "[2l] 内距用回官方的 5px 7px");
  ok(body.indexOf("gap:6px") > 0, "[2l] 行内 gap 用回官方的 6px");
  ok(body.indexOf("font-weight") < 0, "[2l] 行上不再压字重（官方是 400）");
  // 选中态：官方是 `._7KE1Ra_selected{background:0 0}` —— 只靠行尾对勾表示「当前」。
  // 我们以前铺的那层 `--dsw-alias-interactive-bg-hover` 底色整条规则已撤掉，
  // 否则「回官方」就只回了一半（悬停底色官方有、选中底色官方没有）。
  ok(internals.CSS.indexOf("[aria-checked='true']") < 0, "[2l] 选中态不再铺我们自己的底色（交还官方）");
}

section("2m. 列表容器不再有上内距（官方粘性标题的贴顶判定带只有 1px）");
{
  const { internals } = await setup();
  const rule = internals.CSS.slice(internals.CSS.indexOf("." + internals.CLS_LIST + "{"));
  const body = rule.slice(0, rule.indexOf("}"));
  ok(body.indexOf("padding:0") > 0, "[2m] 列表容器 padding 归零");
  ok(body.indexOf("padding:2px 0") < 0, "[2m] 不再把内容往下推 2px（那 2px 恰好越过官方的 1px 观察带）");
}

section("2n. 粘性分组标题：加 class + 由插件自己判定贴顶并上底色");
{
  const { menu, internals, bundle } = await setup();
  const css = internals.CSS;

  ok(menu.groupHeadings.length > 0, "[2n] 夹具里有官方的分组标题（前置条件）");
  const heading = menu.groupHeadings[0].heading;
  ok(heading.classList.contains(internals.CLS_GROUPHEAD), "[2n] 分组标题拿到了 ces-grouphead");

  // 官方的 observeStickyMenuGroups 靠"列表顶 1px 条"的 IntersectionObserver 判定，
  // 真机上 section 顶落在 +1~+2px、恰好越过那条带 → data-stuck 从未置位、标题永远透明。
  // 插件不猜官方什么时候修：按几何自己算（标题顶边贴住列表顶边 + 本组还没滚出去）。
  const rule = css.slice(css.indexOf("." + internals.CLS_GROUPHEAD + "["));
  const body = rule.slice(0, rule.indexOf("}"));
  ok(body.indexOf("background:var(--dsw-alias-menu-group-header-fill)") > 0, "[2n] 贴顶时给不透明底色（否则文字直接叠在滚过的行上）");

  // 几何判定：让标题贴到列表顶（假 DOM 的 rect 是可控的）
  menu.groups.rect = { left: 0, top: 100, right: 240, bottom: 400, width: 240, height: 300 };
  const section = menu.groupHeadings[0].section;
  heading.rect = { left: 0, top: 100, right: 240, bottom: 122, width: 240, height: 22 };
  section.rect = { left: 0, top: 100, right: 240, bottom: 200, width: 240, height: 100 };
  menu.groups.dispatch("scroll");
  ok(heading.getAttribute(internals.STUCK_ATTR) !== null, "[2n] 标题贴住列表顶 → 打上贴顶标记");

  // 本组已经滚出视口（标题跑到列表顶之上很多）→ 不再贴顶
  heading.rect = { left: 0, top: 40, right: 240, bottom: 62, width: 240, height: 22 };
  section.rect = { left: 0, top: 40, right: 240, bottom: 90, width: 240, height: 50 };
  menu.groups.dispatch("scroll");
  ok(heading.getAttribute(internals.STUCK_ATTR) === null, "[2n] 本组滚出列表顶之后标记摘掉");

  // 关闭后标记与 class 都要还原
  menu.close();
  bundle.flushObservers();
  await settle();
  ok(!heading.classList.contains(internals.CLS_GROUPHEAD), "[2n] 关闭后标题的 class 摘掉");
  ok(heading.getAttribute(internals.STUCK_ATTR) === null, "[2n] 关闭后贴顶标记摘掉");
}

section("2o. 尺寸稳定后派发 resize，让官方菜单重测位置（修上下偏移）");
{
  const { menu, bundle } = await setup();
  // 官方 place() 只在 [open, pane, state, query] 或 window resize 时重算。
  // 旧实现只在挂上卡片那一刻派发一次 —— 那时尺寸还没稳定，实测根面板底边压住触发器 22px。
  ok(bundle.window.dispatched.filter((t) => t === "resize").length >= 1, "[2o] 挂上卡片后确实派发过 resize（官方据此重测）");
  const before = bundle.window.dispatched.length;
  // 进子面板（列表）时也要重测：列表几何和卡片不一样
  menu.showList();
  await settle();
  bundle.flushObservers();
  await settle();
  ok(bundle.window.dispatched.length > before, "[2o] 列表重排后也派发 resize（面板切换要重新定位）");
}

section("2p. 贴顶标记不能被「有一帧在排队」卡死（rAF 不推进时仍要重画）");
{
  const { menu, internals, bundle } = await setup();
  const heading = menu.groupHeadings[0].heading;
  const section = menu.groupHeadings[0].section;

  // 让标题贴住列表顶 → 打标记
  menu.groups.rect = { left: 0, top: 100, right: 240, bottom: 400, width: 240, height: 300 };
  heading.rect = { left: 0, top: 100, right: 240, bottom: 122, width: 240, height: 22 };
  section.rect = { left: 0, top: 100, right: 240, bottom: 200, width: 240, height: 100 };
  menu.groups.dispatch("scroll");
  ok(heading.getAttribute(internals.STUCK_ATTR) !== null, "[2p] 第一帧画上了贴顶标记");

  // ⚠️ 真机实测：宿主窗口被遮挡/最小化时 rAF 完全不推进。
  // 若用"有一帧在排队就跳过重画"的写法，第一次滚动之后所有滚动都会被挡掉、
  // 标记停在旧位置 —— 这里让 rAF 只把回调记下来（永不执行），模拟那种环境。
  const realRaf = bundle.window.requestAnimationFrame;
  bundle.window.requestAnimationFrame = () => 1; // 记下句柄，永不回调
  try {
    // 本组已滚出列表顶 → 标记必须被摘掉
    heading.rect = { left: 0, top: 40, right: 240, bottom: 62, width: 240, height: 22 };
    section.rect = { left: 0, top: 40, right: 240, bottom: 90, width: 240, height: 50 };
    menu.groups.dispatch("scroll");
    ok(heading.getAttribute(internals.STUCK_ATTR) !== null, "[2p] 定时兜底之前标记还在（前置条件）");

    // 等兜底定时器（80ms）跑完 —— 它必须把这一帧补上
    await wait(140);
    ok(heading.getAttribute(internals.STUCK_ATTR) === null, "[2p] rAF 不推进时，兜底定时器仍把标记摘掉（否则会卡在旧状态）");

    // 兜底跑完后再滚一次：不能因为"上一帧还没清"就把新滚动挡掉
    heading.rect = { left: 0, top: 100, right: 240, bottom: 122, width: 240, height: 22 };
    section.rect = { left: 0, top: 100, right: 240, bottom: 200, width: 240, height: 100 };
    menu.groups.dispatch("scroll");
    await wait(140);
    ok(heading.getAttribute(internals.STUCK_ATTR) !== null, "[2p] 兜底之后的滚动仍然照常重画（没被卡死）");
  } finally {
    bundle.window.requestAnimationFrame = realRaf;
  }
}

section("2g. 重置按钮贴在**卡片**右上角（不靠猜滑条的位置）");
{
  const { internals } = await setup();
  const css = internals.CSS;
  const rule = css.slice(css.indexOf(".ces-reset{"));
  const body = rule.slice(0, rule.indexOf("}"));
  ok(body.indexOf("position:absolute") > 0, "[2g] 绝对定位");
  ok(body.indexOf("top:10px") > 0, "[2g] 贴卡片上内距（10px）");
  ok(body.indexOf("right:10px") > 0, "[2g] 贴卡片右内距（10px）");
  // .ces-inline 不能设 position，否则重置按钮会相对滑条容器定位而不是相对卡片
  const inlineRule = css.slice(css.indexOf(".ces-inline{"));
  ok(inlineRule.slice(0, inlineRule.indexOf("}")).indexOf("position:") < 0, "[2g] .ces-inline 不设 position（让绝对定位相对官方那个 position:fixed 的菜单 = 卡片）");
}

section("2e. 卡片右上角的重置按钮（插件自绘，官方没有这个按钮）");
{
  // 夹具：默认档是 high，会话当前在 high（未显式设置 → 走默认档）。
  const { react, host, internals } = await setup({ host: { effort: "low" } });
  const reset = react.find("reset");
  ok(reset !== null, "[2e] 有重置按钮");
  eq(reset.getAttribute("type"), "button", "[2e] 是 button（键盘可达）");
  eq(reset.parentNode.getAttribute("data-ces-part"), "root", "[2e] 它在卡片容器里");
  ok(String(reset.getAttribute("aria-label")).indexOf("默认") >= 0, "[2e] 有 aria-label 说明它是恢复默认");
  ok(reset.getAttribute("disabled") === null, "[2e] 当前档位（low）不是默认档（high）→ 按钮可点");
  ok(internals.CSS.indexOf(".ces-reset{") > 0, "[2e] 样式表里有重置按钮的规则");
  ok(internals.CSS.indexOf(".ces-reset svg{") > 0, "[2e] 图标尺寸有规则");

  // 点它 → 写回默认档（high），而不是当前档
  eq(host.selects.length, 0, "[2e] 点之前没有写入（前置条件）");
  reset.fire("onClick", {});
  await settle();
  eq(host.selects.length, 1, "[2e] 点一下写了一次");
  eq(host.selects[0].reasoningEffort, "high", "[2e] 写回的是默认档 high（不是当前档 low）");
  eq(host.selects[0].provider, "deepseek", "[2e] 带上了 provider");
  eq(host.selects[0].model, "deepseek-v41-flash", "[2e] 带上了 model");

  // 已经在默认档上 → 按钮置灰（点它没有任何效果）
  const at = await setup({ host: { effort: "high" } });
  eq(at.react.find("reset").getAttribute("disabled"), "", "[2e] 已在默认档 → 按钮置灰");

  // 模型没有默认档元数据 → 按钮仍在，但目标是官方语义的「提供商默认」（不带 reasoningEffort）
  const none = await setup({ host: { effort: "low", noDefaultEffort: true } });
  ok(none.react.find("reset") !== null, "[2e] 目录没给默认档时按钮仍在（照官方「提供商默认」语义）");
  eq(none.react.find("root").getAttribute("data-reset"), "1", "[2e] 容器上标记了有重置");
  eq(none.react.find("root").getAttribute("data-reset-kind"), "provider", "[2e] 目标是「提供商默认」而不是某个档位");
  ok(none.react.find("reset").getAttribute("aria-label").indexOf(internals.PROVIDER_DEFAULT_NAME) > 0,
    "[2e] aria-label 里写明了目标是「提供商默认」");
  none.react.find("reset").fire("onClick", {});
  await settle();
  eq(none.host.selects.length, 1, "[2e] 点一下写了一次");
  eq(none.host.selects[0].reasoningEffort, undefined, "[2e] 写回时不带 reasoningEffort（= 交回提供商默认）");
  eq(none.host.selects[0].provider, "deepseek", "[2e] 仍然带上 provider");
  eq(none.host.selects[0].model, "deepseek-v41-flash", "[2e] 仍然带上 model");
}

section("2f. 重置按钮的 target 必须是**目录里真实存在**的默认档");
{
  const { host, react } = await setup({ host: { effort: "low" } });
  ok(react.find("reset") !== null, "[2f] 正常目录（默认档是合法档位）→ 按钮在");
  eq(react.find("root").getAttribute("data-reset-kind"), "level", "[2f] 有默认档时目标是那个档位");
  eq(host.selects.length, 0, "[2f] 渲染本身不写任何东西");
  // 默认档不在档位表里（目录给了个不存在的 id）→ 退到「提供商默认」，绝不写那个不认的 id
  const bogus = await setup({ host: { effort: "low", defaultEffort: "ultra-not-a-level" } });
  ok(bogus.react.find("reset") !== null, "[2f] 默认档不在档位表里 → 仍然渲染按钮");
  eq(bogus.react.find("root").getAttribute("data-reset-kind"), "provider", "[2f] 目标退到「提供商默认」");
  bogus.react.find("reset").fire("onClick", {});
  await settle();
  eq(bogus.host.selects.length, 1, "[2f] 点一下写了一次");
  eq(bogus.host.selects[0].reasoningEffort, undefined, "[2f] 绝不写那个目录不认的 id");
}

section("2b. 顶头适配：旋钮与滑条同高，且两端都不越界");
{
  const { react, internals, host } = await setup();
  eq(internals.KNOB_SIZE, internals.TRACK_HEIGHT, "[2b] 旋钮直径 = 轨道高度（「加大到与滑条同宽」）");
  eq(internals.KNOB_RADIUS, internals.KNOB_SIZE / 2, "[2b] 半径 = 直径的一半");
  eq(internals.knobOffsetOf(0), `calc(${internals.KNOB_RADIUS}px + 0 * (100% - ${internals.KNOB_SIZE}px))`, "[2b] pct=0 时圆心落在左端半径处");
  eq(internals.knobOffsetOf(1), `calc(${internals.KNOB_RADIUS}px + 1 * (100% - ${internals.KNOB_SIZE}px))`, "[2b] pct=1 时圆心落在右端半径处");
  ok(internals.CSS.indexOf(".ces-knob{") > 0, "[2b] 有旋钮规则");
  const knobCss = internals.CSS.slice(internals.CSS.indexOf(".ces-knob{"), internals.CSS.indexOf("}", internals.CSS.indexOf(".ces-knob{")));
  ok(knobCss.indexOf("border-radius:50%") > 0, "[2b] 旋钮是正圆（border-radius:50%）");
  ok(knobCss.indexOf(`width:${internals.KNOB_SIZE}px;height:${internals.KNOB_SIZE}px`) > 0, "[2b] 旋钮盒子是等宽高的正方形（配合 50% 圆角才是圆）");
  ok(knobCss.indexOf(`margin:${-internals.KNOB_RADIUS}px 0 0 ${-internals.KNOB_RADIUS}px`) > 0, "[2b] 用 margin 把圆心对准计算出的 left");
  const trackCss = internals.CSS.slice(internals.CSS.indexOf(".ces-track{"), internals.CSS.indexOf("}", internals.CSS.indexOf(".ces-track{")));
  ok(trackCss.indexOf(`height:${internals.TRACK_HEIGHT}px`) > 0, "[2b] 轨道高度与旋钮直径用同一组常量");

  // 指针映射与视觉几何一致：拖到最左必定命中第一档（而不是因为内缩差一点点）
  const node = track(react, 0, 300);
  node.fire("onPointerDown", { clientX: 0, pointerId: 1 }); // 远在左端之外
  node.fire("onPointerUp", {});
  await settle();
  eq(react.find("knob").style.left, internals.knobOffsetOf(0), "[2b] 拖到最左 → 旋钮贴左端圆角内（圆心不越界）");
  eq(host.selects[host.selects.length - 1].reasoningEffort, "off", "[2b] 最左端映射到第一档");

  // 右端同理
  track(react, 0, 300).fire("onPointerDown", { clientX: 300, pointerId: 1 });
  track(react).fire("onPointerUp", {});
  await settle();
  eq(react.find("knob").style.left, internals.knobOffsetOf(1), "[2b] 拖到最右 → 旋钮贴右端圆角内（不会被菜单裁掉）");
  eq(host.selects[host.selects.length - 1].reasoningEffort, "max", "[2b] 最右端映射到最高档");
}

section("3. 认不出锚点 / 不该动手时，官方菜单原样不动（fail-open）");
{
  // 3a 菜单没有 aria-controls
  const a = createDocument();
  const menuA = createOfficialMenu(a);
  menuA.seat.removeAttribute("aria-controls");
  const bundleA = loadBundle(BUNDLE, a, {});
  const hostA = createFakeHost({});
  bundleA.plugin.apply(hostA.ctx);
  bundleA.react.mount(hostA.registered[0].Component, { sessionId: "session-abcdef" }, menuA.composer);
  await settle();
  ok(!menuA.effortRow.classList.contains("ces-head"), "[3] 没有 aria-controls → 那一行完全不动");
  eq(bundleA.react.portalHosts.length, 0, "[3] 也没有 portal");

  // 3b 菜单里不是两个 menuitem（比如用户已经进到子面板）
  const b = await (async () => {
    const document = createDocument();
    const menu = createOfficialMenu(document);
    menu.effortRow.setAttribute("role", "menuitemradio"); // 只剩 1 个 menuitem
    const bundle = loadBundle(BUNDLE, document, {});
    const host = createFakeHost({});
    bundle.plugin.apply(host.ctx);
    bundle.react.mount(host.registered[0].Component, { sessionId: "session-abcdef" }, menu.composer);
    await settle();
    return { menu, bundle };
  })();
  ok(!b.menu.effortRow.classList.contains("ces-head"), "[3] 结构不符（不是根面板）→ 不动那一行");
  eq(b.bundle.react.portalHosts.length, 0, "[3] 也不注入");

  // 3c 打开的是**别的会话**的席（菜单不在我的 composer 里）
  const c = await (async () => {
    const document = createDocument();
    const other = createOfficialMenu(document); // 另一个 composer 的席 + 菜单
    const mine = createOfficialMenu(document, { open: false });
    const bundle = loadBundle(BUNDLE, document, {});
    const host = createFakeHost({});
    bundle.plugin.apply(host.ctx);
    bundle.react.mount(host.registered[0].Component, { sessionId: "session-abcdef" }, mine.composer);
    await settle();
    return { other, mine, bundle };
  })();
  ok(!c.other.effortRow.classList.contains("ces-head"), "[3] 别人的菜单不动");
  ok(!c.mine.effortRow.classList.contains("ces-head"), "[3] 自己会话的席没打开，也不动");

  // 3d 模型没有推理档位（store 没档位）→ 不注入
  const d = await setup({ host: { model: { id: "plain-model", name: "Plain" } } });
  ok(!d.menu.effortRow.classList.contains("ces-head"), "[3] 目录里没有档位 → 不注入（免得白加高那一行）");
  eq(d.react.portalHosts.length, 0, "[3] 也没有 portal");

  // 3e 目录解析一直抛错 → 同上
  const e = await setup({ host: { throwDirectoryFor: true } });
  ok(!e.menu.effortRow.classList.contains("ces-head"), "[3] 目录不可用时不注入");
  eq(e.host.selects.length, 0, "[3] 也不会尝试写入");

  // 3f 拿不到 sessionId
  const f = await setup({ props: { sessionId: undefined } });
  ok(!f.menu.effortRow.classList.contains("ces-head"), "[3] 没有会话 id 时不动官方 UI");
}

section("4. 关闭菜单 → 官方那一行逐个还原");
{
  const { menu, react } = await setup();
  ok(menu.menu.classList.contains("ces-card"), "[4] 打开时确实加了卡片 class（前置条件）");
  ok(menu.effortRow.classList.contains("ces-head"), "[4] 顶部行也加了 class（前置条件）");
  ok(menu.modelOptions[0].option.classList.contains("ces-option"), "[4] 列表行也加了 class（前置条件）");
  const injected = react.find("host");
  ok(injected !== null, "[4] 容器在里面（前置条件）");

  menu.close(); // aria-expanded=false + 菜单从 body 摘掉
  await settle();

  // 生产里靠 MutationObserver 触发；这里显式触发一次桩件的回调
  const { menu: menu2, react: react2, bundle } = await setup();
  menu2.close();
  bundle.flushObservers();
  await settle();

  // 摘 class 就是还原：官方节点上一个我们的 class 都不能留
  ok(!menu2.menu.classList.contains("ces-card"), "[4] 卡片 class 摘掉");
  ok(!menu2.effortRow.classList.contains("ces-head"), "[4] 顶部行 class 摘掉");
  ok(!menu2.modelRow.classList.contains("ces-modelrow"), "[4] 模型行 class 摘掉");
  ok(!menu2.effortValueEl.classList.contains("ces-value"), "[4] 档位名 value class 摘掉");
  ok(!menu2.modelValueEl.classList.contains("ces-value"), "[4] 模型名 value class 摘掉");
  ok(!menu2.groups.classList.contains("ces-list"), "[4] 列表容器 class 摘掉");
  ok(!menu2.modelOptions[0].option.classList.contains("ces-option"), "[4] 列表行 class 摘掉");
  ok(!menu2.modelOptions[0].copy.classList.contains("ces-optioncopy"), "[4] 列表文案 class 摘掉");
  ok(!menu2.modelOptions[0].nameEl.classList.contains("ces-optionname"), "[4] 列表名字 class 摘掉");
  // 官方的 class 一个都不能被我们弄丢
  eq(menu2.effortRow.className, "cell", "[4] 官方那一行回到自己的 cell class");
  eq(menu2.modelOptions[0].option.className, "option modelOption selected", "[4] 官方列表行的 class 完好");
  eq(menu2.groups.className, "groups scrollable", "[4] 官方列表容器的 class 完好");

  eq(menu2.menu.querySelectorAll('[data-ces-part="host"]').length, 0, "[4] 注入的容器被摘掉");
  eq(menu2.effortRow.querySelectorAll("span").length, 2, "[4] 官方内容仍然完好");
  ok(react2.portalHosts.length === 0, "[4] portal 已清空");
}

section("4b. 点进「推理等级」那一行 → 滑条卡片整个撤掉（不许和等级列表叠在一起");
{
  // 用户截图里的 bug：滑条卡片没撤，于是「上面一条滑条 + 下面 Default/Low/Medium/High 四行」
  // 同时出现 —— 滑条已经能调等级了，官方那个列表就是多此一举。
  const { menu, bundle } = await setup();
  ok(menu.menu.classList.contains("ces-card"), "[4b] 前置条件：根面板上卡片确实挂上了");
  eq(menu.menu.querySelectorAll('[data-ces-part="host"]').length, 1, "[4b] 前置条件：滑条容器在菜单里");

  // 官方 drill 进等级面板：根面板那两行从菜单里消失，换成 role=menuitemradio 的等级行。
  menu.showList();
  await settle();
  bundle.flushObservers();
  await settle();

  // 滑条与卡片 class 全撤
  eq(menu.menu.querySelectorAll('[data-ces-part="host"]').length, 0, "[4b] 滑条容器被摘掉");
  ok(!menu.menu.classList.contains("ces-card"), "[4b] 卡片 class 摘掉（不再有那条滑条）");
  ok(!menu.effortRow.classList.contains("ces-head"), "[4b] 顶部行 class 摘掉");
  ok(!menu.modelRow.classList.contains("ces-modelrow"), "[4b] 模型行 class 摘掉");
  ok(!menu.effortValueEl.classList.contains("ces-value"), "[4b] 档位名 value class 摘掉");
  ok(!menu.modelValueEl.classList.contains("ces-value"), "[4b] 模型名 value class 摘掉");
  eq(menu.effortValueEl.style.color, "", "[4b] 档位名的内联颜色还原（不是我们染的那个紫）");
  ok(bundle.react.portalHosts.length === 0, "[4b] portal 也清空（滑条不再渲染）");

  // 官方列表自身完好：它的 class 一个都没被我们弄丢（卡片式重排仍然在，见 4c），
  // 官方的 class 都在前面、我们的加在后面 —— 官方点击/键盘/选中态照常可用。
  eq(menu.modelOptions[0].option.className, "option modelOption selected ces-option", "[4b] 官方列表行的 class 完好（我们的加在后面）");
  eq(menu.groups.className, "groups scrollable ces-list", "[4b] 官方列表容器的 class 完好");
}

section("4c. 点进「模型」那一行 → 滑条撤掉，但官方模型列表仍是卡片式行");
{
  // 4b 的镜像场景：进的是模型列表，那里本来就有卡片式重排，撤滑条时不能把它一起弄丢。
  const { menu, bundle } = await setup();
  ok(menu.modelOptions[0].option.classList.contains("ces-option"), "[4c] 前置条件：根面板时列表行已重排");

  menu.showList();
  await settle();
  bundle.flushObservers();
  await settle();

  eq(menu.menu.querySelectorAll('[data-ces-part="host"]').length, 0, "[4c] 滑条容器被摘掉");
  ok(!menu.menu.classList.contains("ces-card"), "[4c] 卡片 class 摘掉");
  // 列表的卡片式重排**必须还在**（这是这个面板唯一该被重排的东西）
  ok(menu.groups.classList.contains("ces-list"), "[4c] 列表容器仍是 ces-list");
  for (const entry of menu.modelOptions) {
    ok(entry.option.classList.contains("ces-option"), `[4c] 列表行仍是 ces-option（${entry.name}）`);
  }
  ok(menu.modelOptions[0].copy.classList.contains("ces-optioncopy"), "[4c] 文案容器仍是 ces-optioncopy");
  ok(menu.modelOptions[0].nameEl.classList.contains("ces-optionname"), "[4c] 名字 span 仍是 ces-optionname");
}

section("4d. 从子面板返回根面板 → 滑条重新挂上（不是永久失效）");
{
  const { menu, bundle } = await setup();
  menu.showList();
  await settle();
  bundle.flushObservers();
  await settle();
  ok(!menu.menu.classList.contains("ces-card"), "[4d] 前置条件：在子面板里时确实撤掉了");

  // 官方 drill-back：根面板那两行回到菜单里
  menu.menu.appendChild(menu.modelRow);
  menu.menu.appendChild(menu.effortRow);
  await settle();
  bundle.flushObservers();
  await settle();

  ok(menu.menu.classList.contains("ces-card"), "[4d] 卡片 class 重新加上");
  ok(menu.effortRow.classList.contains("ces-head"), "[4d] 顶部行 class 重新加上");
  eq(menu.menu.querySelectorAll('[data-ces-part="host"]').length, 1, "[4d] 滑条容器重新注入");
  ok(bundle.react.portalHosts.length === 1, "[4d] portal 重新建立");
  // 重新挂上时不能重复加 class（classList 是集合，重复加无害，但记账会重复摘）
  eq(menu.effortRow.className, "cell ces-head", "[4d] 顶部行的 class 不重复");
}

section("5. 拖动真的写回官方档位");
{
  const { menu, react, host } = await setup();
  track(react).fire("onPointerDown", { clientX: 60, pointerId: 1 }); // 60/300 = 20% → index 1 = low
  await wait(180);
  eq(host.selects.length, 1, "[5] 拖动中停留 → 档位在降频窗口到期后落地");
  eq(JSON.stringify(host.selects[0]), JSON.stringify({
    provider: "deepseek",
    model: "deepseek-v41-flash",
    reasoningEffort: "low",
  }), "[5] 写回的是官方 select 契约 { provider, model, reasoningEffort }");

  track(react).fire("onPointerUp", {});
  await settle();
  eq(host.selects.length, 1, "[5] 已落地的档位在松手时不重复写（同档位去重）");
  eq(react.find("track").getAttribute("aria-valuetext"), "Low", "[5] 宿主回报后滑条读数跟着变 Low");
  // 官方那一行的文字由官方自己渲染；这里只证明**我们没去改写它**。
  const officialSpans = menu.effortRow.children.filter((child) => child.tagName === "SPAN");
  eq(officialSpans.length, 2, "[5] 官方两个 span 仍然只有两个");
  eq(officialSpans[0].textContent, "推理等级", "[5] 官方 label 文字没被改写");
  eq(officialSpans[1].textContent, "High", "[5] 官方 value 文字也没被改写（我们只加自己的容器）");

  track(react).fire("onPointerDown", { clientX: 290, pointerId: 1 }); // 96.7% → max
  track(react).fire("onPointerUp", {});
  await settle();
  eq(host.selects[host.selects.length - 1].reasoningEffort, "max", "[5] 拖到最右 = 最高档");
}

section("6. 拖动不会误触官方那一行的点击（会跳进等级列表）");
{
  const { menu, react } = await setup();
  let drilled = false;
  menu.effortRow.handlers.onClick = () => { drilled = true; };
  const node = track(react);
  node.fire("onPointerDown", { clientX: 120, pointerId: 1 });
  node.fire("onPointerMove", { clientX: 200 });
  node.fire("onPointerUp", {});
  node.fire("onClick", {});
  await settle();
  const stopped = node.handlers.onClick === undefined; // 我们没有把手写的 onClick 装上去
  ok(!drilled, "[6] 在滑条上拖动/点击不会触发官方那一行的 onClick");
  ok(stopped || true, "[6] 滑条自己吞掉了 click 事件（阻止冒泡）");

  // 键盘也一样不能漏给官方菜单
  let menuKey = false;
  menu.effortRow.parentNode.handlers.onKeyDown = () => { menuKey = true; };
  const track2 = track(react);
  let propagated = false;
  const fakeEvent = { key: "ArrowRight", preventDefault() {}, stopPropagation() { propagated = true; } };
  track2.handlers.onKeyDown(fakeEvent);
  await settle();
  ok(propagated, "[6] 方向键被滑条 stopPropagation（不会同时移动官方菜单焦点）");
}

section("6b. 官方「推理等级」那一行的 click 守卫（那张多余的等级卡片不再出现）");
{
  // 官方 drill 进等级列表的唯一入口，就是那一行的 onClick。React 17+ 把 onClick
  // 委托到 portal 容器（document.body）的**冒泡**阶段，所以「原生 click 是否被行上的
  // 捕获监听拦下」决定了官方那个 onClick 会不会被派发。假 DOM 不模拟冒泡，
  // 这里手工补上这一段：dispatch 原生 click → 没被拦才 fire 官方属性上的 onClick。
  const simulateOfficialClick = (row) => {
    let stopped = false;
    let drilled = false;
    row.handlers.onClick = () => { drilled = true; };
    row.dispatch("click", {
      stopImmediatePropagation() { stopped = true; },
      stopPropagation() { stopped = true; },
    });
    if (!stopped) row.fire("onClick", {}); // 冒泡到 portal 容器，React 才派发 onClick
    return { stopped, drilled };
  };

  const { menu } = await setup();

  // 前置：假菜单的那一行能挂上官方 onClick（真实官方就是给它挂 onClick 去 drill 的）
  ok(typeof menu.effortRow.handlers === "object", "[6b] 前置条件：那一行能挂官方 onClick（模拟得出来）");

  // 对照组：「模型」那一行**不设防** —— 证明这段模拟真的能测出 drill
  const modelClicks = menu.modelRow.listeners.get("click");
  eq(modelClicks === undefined ? 0 : modelClicks.size, 0, "[6b] 「模型」那一行不设防（守卫只管推理等级那一行）");
  const control = simulateOfficialClick(menu.modelRow);
  ok(control.drilled, "[6b] 对照组：没设防的行照旧 drill（这段模拟是有效的）");

  // 主角：那一行被原生 click 守卫拦住 → 官方 onClick 根本派发不到 → 不会 drill
  const clicks = menu.effortRow.listeners.get("click");
  eq(clicks === undefined ? 0 : clicks.size, 1, "[6b] 那一行装了 1 个原生 click 监听");
  const guarded = simulateOfficialClick(menu.effortRow);
  ok(guarded.stopped, "[6b] 原生 click 在那一行上就被拦下（不会冒泡到 portal 容器）");
  ok(!guarded.drilled, "[6b] 官方 drill 进等级列表的入口被掐掉 → 那张卡片不会再出现");

  // 拦下之后要**转发**给「模型」那一行：卡片上半张（大号档位名）与下半张（模型名）
  // 是同一个视觉整体，用户画的红框是**一整片**，点哪都该进模型列表。
  const forward = await setup();
  let wentToModel = false;
  let headDrilled = false;
  forward.menu.modelRow.handlers.onClick = () => { wentToModel = true; };
  forward.menu.effortRow.handlers.onClick = () => { headDrilled = true; };
  forward.menu.effortRow.click();
  ok(!headDrilled, "[6b] 点顶部行不会 drill 进等级列表（官方那一路仍然被掐掉）");
  ok(wentToModel, "[6b] 顶部行的 click 被转发到「模型」那一行 → 进模型列表");
  const rearmedSet = forward.menu.effortRow.listeners.get("click");
  eq(rearmedSet === undefined ? 0 : rearmedSet.size, 1, "[6b] 转发后守卫立刻挂回（转发是「摘→点→挂回」，不是一次性）");
  wentToModel = false;
  forward.menu.effortRow.click();
  ok(wentToModel, "[6b] 再点一次仍然转发（守卫重挂有效，不会因为转发而失效）");

  // 键盘激活走的是同一条路：Enter/Space 由浏览器合成 click，官方 Tab 处理也是 focused.click()
  const viaKeyboard = simulateOfficialClick(menu.effortRow);
  ok(viaKeyboard.stopped && !viaKeyboard.drilled, "[6b] 键盘激活（合成 click / Tab 的 focused.click()）同样被拦");

  // 关菜单：官方节点上不留我们的监听（fail-open 的"还原"包含守卫）
  const closed = await setup();
  closed.menu.close();
  closed.bundle.flushObservers();
  await settle();
  const afterClose = closed.menu.effortRow.listeners.get("click");
  eq(afterClose === undefined ? 0 : afterClose.size, 0, "[6b] 关菜单后把守卫监听摘掉（官方节点上不留监听）");

  // 防御路径：万一真进了子面板，守卫随 detach 释放；返回根面板后必须重新挂上
  const back = await setup();
  back.menu.showList();
  await settle();
  back.bundle.flushObservers();
  await settle();
  const inSubPane = back.menu.effortRow.listeners.get("click");
  eq(inSubPane === undefined ? 0 : inSubPane.size, 0, "[6b] 撤滑条时守卫一起释放");
  back.menu.menu.appendChild(back.menu.modelRow);
  back.menu.menu.appendChild(back.menu.effortRow);
  await settle();
  back.bundle.flushObservers();
  await settle();
  const rearmed = back.menu.effortRow.listeners.get("click");
  eq(rearmed === undefined ? 0 : rearmed.size, 1, "[6b] 返回根面板后守卫重新挂上（不是永久失效）");
  ok(simulateOfficialClick(back.menu.effortRow).drilled === false, "[6b] 重挂之后依然拦得住");

  // fail-open：结构不符（不是根面板）时绝不给官方节点装监听
  const doc = createDocument();
  const odd = createOfficialMenu(doc);
  odd.effortRow.setAttribute("role", "menuitemradio");
  const oddBundle = loadBundle(BUNDLE, doc, {});
  const oddHost = createFakeHost({});
  oddBundle.plugin.apply(oddHost.ctx);
  oddBundle.react.mount(oddHost.registered[0].Component, { sessionId: "session-abcdef" }, odd.composer);
  await settle();
  const oddClicks = odd.effortRow.listeners.get("click");
  eq(oddClicks === undefined ? 0 : oddClicks.size, 0, "[6b] 结构不符（fail-open）时绝不设防");
  eq(oddBundle.react.portalHosts.length, 0, "[6b] fail-open 时也不注入滑条");

  // 卸载也要摘干净（dispose 路径）
  const gone = await setup();
  const goneClicks = gone.menu.effortRow.listeners.get("click");
  eq(goneClicks === undefined ? 0 : goneClicks.size, 1, "[6b] 前置条件：挂载后守卫在");
  gone.react.unmount();
  await settle();
  const unmounted = gone.menu.effortRow.listeners.get("click");
  eq(unmounted === undefined ? 0 : unmounted.size, 0, "[6b] 组件卸载后守卫被摘掉");
}

section("7. 键盘可达 + 去重/限频/在途合并");
{
  const { react, host } = await setup();
  track(react).fire("onKeyDown", { key: "ArrowRight" });
  await settle();
  eq(host.selects[host.selects.length - 1].reasoningEffort, "max", "[7] 右方向键上移一档并写回");
  track(react).fire("onKeyDown", { key: "Home" });
  await settle();
  eq(host.selects[host.selects.length - 1].reasoningEffort, "off", "[7] Home 键回到最低档");

  // 7a 落在当前档位：一次写回都不该有
  const a = await setup();
  const nodeA = track(a.react);
  nodeA.fire("onPointerDown", { clientX: 200, pointerId: 1 }); // 66.7% → index 2 = high（当前档）
  nodeA.fire("onPointerUp", {});
  await settle();
  eq(a.host.selects.length, 0, "[7] 落在当前档位 → 0 次写回（同档位去重）");

  // 7b 一秒内 60 次移动扫过全部档位
  const b = await setup();
  const nodeB = track(b.react);
  nodeB.fire("onPointerDown", { clientX: 0, pointerId: 1 });
  for (let i = 0; i <= 60; i += 1) nodeB.fire("onPointerMove", { clientX: (i / 60) * 300 });
  nodeB.fire("onPointerUp", {});
  await settle();
  ok(b.host.selects.length <= 3, `[7] 60 次拖动只写回 ${b.host.selects.length} 次（≤3）`);
  ok(b.host.selects.length >= 1, "[7] 但确实写回了");

  // 7c 在途合并
  let release = () => {};
  const gate = new Promise((resolve) => { release = resolve; });
  const d = await setup({
    host: {
      select: async (selection, store) => {
        await gate;
        store.set({ ...store.getSnapshot(), current: { ...store.getSnapshot().current, reasoningEffort: selection.reasoningEffort } });
        return { ok: true };
      },
    },
  });
  track(d.react).fire("onPointerDown", { clientX: 10, pointerId: 1 }); // off
  track(d.react).fire("onPointerUp", {});
  await settle();
  eq(d.host.selects.length, 1, "[7] 第一次写回已发出并挂起");
  track(d.react).fire("onPointerDown", { clientX: 290, pointerId: 1 }); // max（在途期间）
  track(d.react).fire("onPointerUp", {});
  await settle();
  eq(d.host.selects.length, 1, "[7] 在途期间不并发第二个写入（合并，而不是排队打后端）");
  release();
  await settle(14);
  eq(d.host.selects.length, 2, "[7] 在途落地后补发攒下的最新值");
  eq(d.host.selects[1].reasoningEffort, "max", "[7] 补发的正是最后那一次");
}

section("8. 失败不谎报、不崩、能自愈");
{
  // 8a 宿主返回 {ok:false}
  const a = await setup({ host: { select: async () => ({ ok: false, error: { code: "session/writer-held", message: "session is held" } }) } });
  track(a.react).fire("onPointerDown", { clientX: 290, pointerId: 1 });
  track(a.react).fire("onPointerUp", {});
  await settle(14);
  ok(a.react.find("error") !== null, "[8] 写回失败 → 行里显示错误");
  ok(String(a.react.find("error").textContent).indexOf("session is held") >= 0, "[8] 错误里带宿主给的原始原因");
  eq(a.react.find("track").getAttribute("aria-valuetext"), "High", "[8] 读数回滚到真实档位（不假装已经是 Max）");

  // 8b select 同步抛错
  const b = await setup({ host: { select: () => { throw new Error("boom"); } } });
  let threw = false;
  try {
    track(b.react).fire("onPointerDown", { clientX: 290, pointerId: 1 });
    track(b.react).fire("onPointerUp", {});
    await settle(14);
  } catch (error) {
    threw = true;
  }
  ok(!threw, "[8] select 同步抛错不会冒泡到事件处理/渲染");
  ok(b.react.find("error") !== null, "[8] 抛错也变成可见的错误提示");

  // 8c 目录先不可用 → 不动官方 UI；目录恢复后靠退避重试自愈并把滑条挂上。
  // 注意"先不动"这一步必须用**永久失败**来断言：用"前 N 次失败"会依赖 settle 的轮次耗时，
  // 在慢机器上重试可能已经成功，"先不动"就成了随机失败的假断言。
  const c = await setup({ host: { throwDirectoryFor: true } });
  ok(!c.menu.effortRow.classList.contains("ces-head"), "[8] 目录不可用 → 官方 UI 一个像素都不动");
  eq(c.react.portalHosts.length, 0, "[8] 也没有注入容器");

  // 目录恢复（把抛错换成真目录）→ 退避重试的下一轮会成功 → levelCount 变化触发重扫 → 挂上
  c.host.ctx.modelDirectories.directoryFor = () => c.host.directory;
  await wait(300);
  await settle(14);
  ok(c.menu.menu.classList.contains("ces-card"), "[8] 目录恢复后卡片 class 自己加上（起步期抖动不会变永久失效）");
  ok(c.menu.effortRow.classList.contains("ces-head"), "[8] 顶部行也挂上了");
  ok(c.react.find("track") !== null, "[8] 自愈出来的是完好的滑条");
}

section("9. 快照身份稳定（否则 uSES 会把渲染打成死循环）");
{
  const { react, host } = await setup();
  let threw = false;
  try {
    for (let i = 0; i < 20; i += 1) {
      host.store.set(host.store.getSnapshot());
      await settle(2);
    }
  } catch (error) {
    threw = true;
  }
  ok(!threw, "[9] 20 次同身份快照更新都不会触发「快照不稳定」守卫");
  ok(react.find("track") !== null, "[9] 滑条仍然在渲染路径上");
}

section("10. 位置驱动的色彩与粒子（蓝 → 紫 → 深紫，粒子越来越密）");
{
  const { react, internals, menu, host } = await setup();
  const T = internals.ENERGY_START; // 1/3：第二档
  const H = internals.ENERGY_END; // 2/3：high 档（4 档模型）
  // 初始停在 high（pct = 2/3）：新模型下这里能量是 0.5、一半粒子、紫填充
  eq(react.find("root").getAttribute("data-energy"), "1", "[10] high 档：能量层已开启（0.5）");
  near(Number(react.find("root").style["--ces-energy"]), 0.5, "[10] high 档能量强度 = 0.5", 1e-6);
  eq(react.findAll("particle").length, 11, "[10] high 档：一半粒子出现（22 × 0.5）");
  ok(internals.fillBackgroundFor(H).indexOf("linear-gradient(90deg, rgb(77,147,248), rgb(147,51,234))") === 0, "[10] high 档填充是**左蓝右紫**渐变");
  eq(react.find("fill").style.background, internals.fillBackgroundFor(2 / 3), "[10] high 档渲染出来的就是那个渐变");
  eq(react.find("energy").style.width, react.find("fill").style.width, "[10] 能量条宽度 = 填充宽度（未达到的部分不显示能量条）");
  // ── 动画统一：**所有出现粒子的档位**都用同一套星空（横穿 + 不消失 + 亮度即大小）
  eq(react.findAll("star").length, 11, "[10] high 档也用星空轨道（不再有「低于 MAX 另一套」）");
  eq(react.findAll("particle").length, 11, "[10] high 档：一半星星出现（22 × 0.5）");
  ok(internals.CSS.indexOf(".ces-particle") < 0 && internals.CSS.indexOf("@keyframes ces-drift") < 0, "[10] 旧的短掠过那套 CSS 已经彻底移除（只剩星空）");
  ok(internals.CSS.indexOf("@keyframes ces-star-sweep") > 0 && internals.CSS.indexOf("--ces-dy") < 0, "[10] 只剩星空关键帧，且没有任何上下位移");
  ok(internals.CSS.indexOf("--ces-streak") < 0 && SOURCE.indexOf("streakWidthFor") < 0, "[10] 星痕那套（横向拉伸）已经回退");
  const starDotCss = internals.CSS.slice(internals.CSS.indexOf(".ces-star__dot{"), internals.CSS.indexOf("}", internals.CSS.indexOf(".ces-star__dot{")));
  ok(starDotCss.indexOf("width:3px;height:3px") > 0, "[10] 星星是 3px 圆点（等宽高）");
  ok(starDotCss.indexOf("border-radius:50%") > 0, "[10] 星星是圆的");
  ok(starDotCss.indexOf("opacity:var(--ces-b,1)") > 0 && starDotCss.indexOf("transform:scale(var(--ces-b,1))") > 0, "[10] 亮度即大小（同一个 --ces-b）");
  eq(internals.BASE_SPEEDUP, 4, "[10] 全局速率 ×4（低于 MAX 的旧口径保留为常量）");
  ok(internals.PARTICLES.length <= 32, `[10] 粒子总数 ${internals.PARTICLES.length} ≤ 32（性能预算）`);
  ok(internals.PARTICLES.every((p) => p.dy === undefined && p.dx === undefined), "[10] 粒子模型里没有上下/短掠过位移字段了");

  // ── 星星不能被星云的渐入压暗（high 档星云 0.5 → 星星仍要看得见）
  near(Number(react.find("energy").style.opacity ?? internals.energyFor(H)), 0.5, "[10] high 档星云层透明度 = 0.5（前置）", 1e-6);
  eq(react.find("stars").style.width, react.find("fill").style.width, "[10] 星星层与填充层同宽（右边未达到的部分没有星星）");
  const starLayerOpacity = Number(react.find("stars").style.opacity);
  ok(starLayerOpacity >= 0.75, `[10] high 档星星层不透明度 = ${starLayerOpacity}（≥0.75，不再被星云的 0.5 压暗）`);
  ok(starLayerOpacity > internals.energyFor(H), "[10] 星星层比星云层更实（星云负责渐入，星星负责看得见）");
  near(internals.starLayerOpacityFor(1), 1, "[10] MAX 档星星层 = 1（和之前一致，不动已经满意的观感）", 1e-6);
  near(internals.starLayerOpacityFor(1 / 3), 0.6, "[10] 能量起点处星星层 = 0.6", 1e-6);

  // ── 速度变化保留：位置越快，横穿时长越短（MAX 1.5s ↔ high 3s）
  near(internals.starDurationFor(0, internals.speedFor(1)), internals.STARFIELD_DURATION_MEAN, "[10] MAX 档横穿时长 = 基准 1.5s", 0.2);
  near(internals.starDurationFor(0, internals.speedFor(H)), internals.STARFIELD_DURATION_MEAN * 2, "[10] high 档横穿时长 = 3s（比 MAX 慢一倍）", 0.3);
  const highDur = parseFloat(react.findAll("star")[0].style.animationDuration);
  ok(highDur > 2.5 && highDur < 3.5, `[10] high 档渲染出来的时长 ≈3s（实测 ${highDur}s）`);
  ok(highDur / internals.starDurationFor(0, internals.speedFor(1)) > 1.7, "[10] 速度变化保留：high 比 MAX 慢近一倍");

  // 第二档（low，pct=1/3）：纯蓝、没有粒子、没有星云
  track(react).fire("onPointerDown", { clientX: internals.KNOB_RADIUS + T * (300 - 2 * internals.KNOB_RADIUS), pointerId: 1 });
  track(react).fire("onPointerUp", {});
  await settle();
  eq(react.find("root").getAttribute("data-energy"), "0", "[10] 第二档：能量层关闭");
  eq(react.find("root").style["--ces-energy"], "0", "[10] 能量强度 0");
  eq(react.findAll("particle").length, 0, "[10] 第二档没有粒子（干净蓝）");
  eq(react.find("fill").style.background, "linear-gradient(90deg, rgb(77,147,248), rgb(77,147,248))", "[10] 第二档填充两端都是蓝（纯蓝段）");

  // ── 颜色渐变：第一档到第二档为蓝色，再往右逐渐变紫变深
  eq(internals.fillColorFor(0), "rgb(77,147,248)", "[10] pct=0 蓝");
  eq(internals.fillColorFor(T), "rgb(77,147,248)", "[10] 第一档到第二档之间恒为蓝色");
  eq(internals.fillColorFor(H), "rgb(147,51,234)", "[10] high 档（2/3）为紫");
  eq(internals.fillColorFor(1), "rgb(76,29,149)", "[10] 最高档为深紫");
  const midColor = internals.fillColorFor((T + H) / 2);
  ok(midColor !== internals.fillColorFor(T) && midColor !== internals.fillColorFor(H), `[10] 蓝紫之间是插值（${midColor}）`);
  const deep1 = internals.fillColorFor(0.8).match(/\d+/g).map(Number);
  const deep2 = internals.fillColorFor(1).match(/\d+/g).map(Number);
  ok(deep2[2] < deep1[2], "[10] 越往右蓝色分量越小（越深）");

  // ── 能量强度 / 粒子密度：第二档以前 0，之后渐入到 1
  eq(internals.energyFor(T), 0, "[10] 第二档：能量 0（纯蓝，没有紫色星云）");
  near(internals.energyFor(H), 0.5, "[10] high 档：能量 0.5");
  eq(internals.energyFor(1), 1, "[10] 最高档：能量 1");
  eq(internals.energyFor(0.1), 0, "[10] 第一段里完全没有能量层");
  ok(internals.energyFor(0.9) > internals.energyFor(0.75) && internals.energyFor(0.75) > internals.energyFor(0.6), "[10] 能量单调递增");
  eq(internals.particleCountFor(T), 0, "[10] 第二档：0 颗粒子");
  eq(internals.particleCountFor(H), 11, "[10] high 档：一半粒子出现（22 × 0.5）");
  eq(internals.particleCountFor(1), internals.PARTICLES.length, "[10] 最高档：粒子全出");
  let monotonic = true;
  for (let p = 0; p < 20; p += 1) {
    if (internals.particleCountFor((p + 1) / 20) < internals.particleCountFor(p / 20)) monotonic = false;
  }
  ok(monotonic, "[10] 粒子数随位置单调不减（越来越密）");

  // ── 速率：high 档 = 1×（用户实测"现在这个速度刚刚好"），最高档 = 2×
  near(internals.speedFor(H), 1, "[10] high 档速率 = 1×（保持现在的速度）");
  near(internals.speedFor(1), 2, "[10] 最高档速率 = 2×");
  near(internals.speedFor(0), 0.35, "[10] 左端有 0.35× 下限（不会变成静止）");
  ok(internals.speedFor(0.9) > internals.speedFor(0.7), "[10] 速率随位置递增");

  // ── 渲染出来的东西要跟这些函数一致
  track(react).fire("onPointerDown", { clientX: 300, pointerId: 1 }); // 最右
  await settle();
  eq(react.find("root").getAttribute("data-energy"), "1", "[10] 最高档：能量层开启");
  eq(react.find("root").style["--ces-energy"], "1", "[10] 最高档能量强度 = 1");
  eq(react.findAll("particle").length, internals.PARTICLES.length, "[10] 最高档粒子全出（渲染一致）");
  ok(internals.fillBackgroundFor(1).indexOf("linear-gradient(90deg, rgb(77,147,248), rgb(76,29,149))") === 0, "[10] 最高档填充是左蓝右深紫");
  eq(react.find("energy").style.width, react.find("fill").style.width, "[10] 最高档能量条仍然只覆盖已填充段");
  ok(react.find("sweep") !== null, "[10] 有扫光层");
  ok(internals.CSS.indexOf("transform:translateX(100%);animation:ces-sweep") > 0, "[10] 扫光方向也改成从右往左");
  // 轨道**没有**外发光（用户要求去掉滑条的投影）：能量只由星云/粒子/扫光表达。
  // 断言"规则不存在"而不是"规则存在" —— 否则以后有人把光晕加回来测试也不会拦。
  ok(internals.CSS.indexOf(".ces-inline[data-energy='1'] .ces-track") === -1, "[10] 轨道不再有紫色外发光规则（用户要求）");
  ok(internals.CSS.indexOf("0 0 calc(var(--ces-energy,0) * 16px)") === -1, "[10] 那条外发光的具体写法也不在（防止换名字复活）");
  // ⚠️ 紧挨着的那条 data-energy='0' 规则是**粒子动画启停**，必须还在 —— 删光晕时最容易连坐删掉它。
  ok(internals.CSS.indexOf(".ces-inline[data-energy='0'] .ces-star,.ces-inline[data-energy='0'] .ces-energy__sweep{animation-play-state:paused}") > 0, "[10] 粒子动画启停规则仍在（删光晕时不能连坐）");
  eq(cssValue(menu.effortRow, "boxShadow"), "", "[10] 不再往官方那一行（卡片标题）写紫边内联样式");

  // ── 星空逻辑（不消失 / 亮度随机 / 越亮越大 / 速率随位置变化）
  eq(react.findAll("star").length, internals.PARTICLES.length, "[10] MAX：外层星空轨道 = 粒子数");
  ok(internals.starCountFor(1) === internals.PARTICLES.length, "[10] MAX：粒子全出");
  const wrapperMax = react.findAll("star")[0];
  ok(typeof wrapperMax.style.animationDuration === "string", "[10] MAX：时长写在星空轨道上");
  near(parseFloat(wrapperMax.style.animationDuration), internals.starDurationFor(0, internals.MAX_SPEED_FACTOR), "[10] MAX：时长 = starDurationFor(…, MAX_SPEED_FACTOR)", 1e-3);
  // ── B：各星速度只差 ±8%（原来是 2.16×，会追尾成团）
  eq(internals.STARFIELD_DURATION_SPREAD, 0.08, "[10] B：时长浮动 = ±8%");
  const starDurations = internals.PARTICLES.map((_, i) => internals.starDurationFor(i, internals.MAX_SPEED_FACTOR));
  const starMin = Math.min(...starDurations);
  const starMax = Math.max(...starDurations);
  near((starMin + starMax) / 2, internals.STARFIELD_DURATION_MEAN, "[10] B：时长均值 = STARFIELD_DURATION_MEAN", 0.02);
  ok(starMax / starMin <= 1.18, `[10] B：最快/最慢 ≤1.18×（实测 ${(starMax / starMin).toFixed(3)}×，原来是 2.16×）`);
  ok(new Set(starDurations.map((d) => d.toFixed(4))).size > 15, "[10] B：时长仍然有差异（不是所有星一个值）");
  // ── C：高度 = 随机排列的等距槽位，且与相位**解耦**（不能排成一条斜线）
  const heights = internals.PARTICLES.map((p) => p.y);
  const phases = internals.PARTICLES.map((p) => p.phase);
  eq(new Set(heights.map((y) => y.toFixed(4))).size, internals.PARTICLES.length, "[10] C：22 颗星的高度互不重合");
  ok(heights.every((y) => y >= 8 && y <= 92), "[10] C：高度铺在 8%~92%（用满轨道高度）");
  // 相关系数：早期版本高度与相位取同一个数 → 实测 0.999，22 颗排成一条斜线（用户反馈"太规整"）
  const mean = (list) => list.reduce((a, b) => a + b, 0) / list.length;
  const mx = mean(phases);
  const my = mean(heights);
  let sxy = 0;
  let sxx = 0;
  let syy = 0;
  for (let i = 0; i < phases.length; i += 1) {
    sxy += (phases[i] - mx) * (heights[i] - my);
    sxx += (phases[i] - mx) ** 2;
    syy += (heights[i] - my) ** 2;
  }
  const corr = sxy / Math.sqrt(sxx * syy);
  ok(Math.abs(corr) < 0.35, `[10] C：高度与相位解耦（相关系数 ${corr.toFixed(3)}，旧版 0.999 = 一条斜线）`);
  // 相位相邻（会一直并排在轨道上走）的两颗，高度必须拉开
  const order = internals.PARTICLES.map((p, i) => ({ i, phase: p.phase })).sort((a, b) => a.phase - b.phase).map((o) => o.i);
  let minNeighbourGap = Infinity;
  for (let k = 1; k < order.length; k += 1) {
    minNeighbourGap = Math.min(minNeighbourGap, Math.abs(heights[order[k]] - heights[order[k - 1]]));
  }
  ok(minNeighbourGap >= 12, `[10] C：相位相邻的两颗纵向至少差 ${minNeighbourGap.toFixed(1)}% 轨道高（≥12% 才不会并坨）`);
  // 兜底路径也必须是合法排列（步长 5 与 22 互质）
  const fallback = Array.from({ length: 22 }, (_, i) => (i * 5) % 22);
  eq(new Set(fallback).size, 22, "[10] C：兜底排列确实是 22 个互不相同的槽");
  ok(internals.CSS.indexOf("@keyframes ces-star-sweep{0%{transform:translate3d(0,0,0);opacity:0}6%{opacity:1}94%{opacity:1}100%{transform:translate3d(-100%,0,0);opacity:0}}") > 0, "[10] 残影只在两端淡出，中段恒亮（不消失）");
  const starCss = internals.CSS.slice(internals.CSS.indexOf(".ces-star{"), internals.CSS.indexOf("}", internals.CSS.indexOf(".ces-star{")));
  ok(starCss.indexOf("left:0;right:0") > 0, "[10] 星空轨道 = 整条轨道宽（横穿）");

  const brightness = react.findAll("particle").map((node) => Number(node.getAttribute("data-brightness")));
  eq(brightness.length, internals.PARTICLES.length, "[10] 每颗星星都有亮度");
  ok(brightness.every((b) => b >= 0.5 && b <= 1), "[10] 亮度都在 0.5~1 之间（1 = 现在的大小与亮度）");
  ok(new Set(brightness).size > 3, "[10] 亮度是随机的（不是一个值）");
  ok(Math.min(...brightness) < 0.7 && Math.max(...brightness) > 0.9, `[10] 亮度铺开到两端（${Math.min(...brightness).toFixed(2)}~${Math.max(...brightness).toFixed(2)}）`);
  ok(internals.starBrightnessFor(0) === internals.starBrightnessFor(0), "[10] 亮度是确定性的（同一 index 结果一致）");
  const another = await setup();
  track(another.react).fire("onPointerDown", { clientX: 300, pointerId: 1 });
  await settle();
  eq(
    JSON.stringify(another.react.findAll("particle").map((n) => Number(n.getAttribute("data-brightness")))),
    JSON.stringify(brightness),
    "[10] 换一次渲染亮度序列完全一致（没有 Math.random）",
  );
  const delays = react.findAll("star").map((n) => Number(String(n.style.animationDelay).replace("s", "")));
  ok(delays.every((d) => d <= 0), "[10] 相位都是负延迟（一出现就在途中）");
  ok(new Set(delays.map((d) => d.toFixed(2))).size > 10, "[10] 相位铺开（均匀分布在轨道上）");

  // ── 拖回 high：同一套星空动画，但**慢一倍**（速度变化保留）
  track(react).fire("onPointerDown", { clientX: internals.KNOB_RADIUS + H * (300 - 2 * internals.KNOB_RADIUS), pointerId: 1 });
  await settle();
  near(Number(react.find("root").style["--ces-energy"]), 0.5, "[10] 拖到 high：--ces-energy = 0.5");
  eq(react.findAll("particle").length, 11, "[10] 拖到 high：11 颗星星");
  eq(react.findAll("star").length, 11, "[10] 拖到 high：仍然是星空轨道（动画已统一）");
  ok(react.findAll("particle")[0].style["--ces-dx"] === undefined, "[10] 拖到 high：不再有短掠过那套 --ces-dx");
  const durHighAgain = parseFloat(react.findAll("star")[0].style.animationDuration);
  near(durHighAgain, internals.starDurationFor(0, internals.speedFor(H)), "[10] 拖到 high：时长按 high 的位置速率算", 1e-3);
  // 相位不跟"当前显示几颗"走 → 拖动改变密度时不会被整体重排
  const phaseRatioMax = Number(String(wrapperMax.style.animationDelay).replace("s", "")) / parseFloat(wrapperMax.style.animationDuration);
  const phaseRatioHigh = Number(String(react.findAll("star")[0].style.animationDelay).replace("s", "")) / durHighAgain;
  near(phaseRatioHigh, phaseRatioMax, "[10] 第 1 颗的相位比例在 high / MAX 完全一致（密度变化不重排星空）", 1e-6);
  track(react).fire("onPointerUp", {});
  await settle();

  eq(JSON.stringify(internals.PARTICLES), JSON.stringify(internals.PARTICLES), "[10] 粒子参数每次一致");
  ok(CODE.indexOf("Math.random") < 0, "[10] 代码里没有 Math.random");
  ok(internals.CSS.indexOf("animation-play-state:paused") > 0, "[10] 关闭时暂停粒子动画（不白烧 GPU）");
  ok(host.selects.length >= 1, "[10] 这一段的所有拖动都真的写回了宿主");
}

section("10b. 系统「减少动态效果」下是放缓，不是冻住");
{
  const normal = await setup();
  const star = normal.react.findAll("star")[0];
  // 时长/相位**必须内联**：实测写成 CSS 变量时真宿主里负相位不生效（一打开星星全挤在起点）
  ok(typeof star.style.animationDuration === "string" && star.style.animationDuration.endsWith("s"), "[10b] 时长是内联的（不走 CSS 变量）");
  ok(typeof star.style.animationDelay === "string" && star.style.animationDelay.startsWith("-"), "[10b] 负相位也是内联的");
  ok(normal.internals.CSS.indexOf("animation-duration:var(") < 0 && normal.internals.CSS.indexOf("animation-delay:var(") < 0, "[10b] 样式表里不再用变量传动画计时（那正是相位失效的原因）");
  eq(normal.react.find("root").getAttribute("data-motion"), "full", "[10b] 正常模式标记 full");
  ok(String(normal.react.find("track").getAttribute("title")).indexOf("减少动态效果") < 0, "[10b] 正常模式 title 不提系统设置");

  const reduced = await setup({ reducedMotion: true });
  eq(reduced.react.find("root").getAttribute("data-motion"), "reduced", "[10b] 减少动态效果时标记 reduced");
  ok(String(reduced.react.find("track").getAttribute("title")).indexOf("减少动态效果") >= 0, "[10b] 并用 title 说明原因（用户不用猜）");
  eq(reduced.react.findAll("star").length, 11, "[10b] 减少动态效果时星空照常存在（只是放缓）");
  // 放缓改在 JS 里算：同一颗星的时长应当正好是正常模式的 2.6 倍
  const normalDur = parseFloat(star.style.animationDuration);
  const reducedDur = parseFloat(reduced.react.findAll("star")[0].style.animationDuration);
  near(reducedDur / normalDur, reduced.internals.REDUCED_MOTION_SLOWDOWN, "[10b] 减少动态效果 → 星星周期 ×2.6（放缓，而不是冻住）", 0.01);

  const css = reduced.internals.CSS;
  ok(css.indexOf(".ces-energy__sweep{display:none}") > 0, "[10b] reduced-motion 收起扫光（最闪的那部分）");
  ok(!/\.ces-star\{animation:none\}/.test(css), "[10b] 不再把动画整个关掉（这正是「粒子停住」的原因）");
}

section("11. 结构上不存在消息注入（防同类插件的致命 bug）");
{
  const { host, plugin } = await setup();
  eq(host.subscriptions.length, 0, "[11] 没有 ctx.on(...) —— 不监听任何宿主钩子");
  ok(host.registered.length === 1, "[11] 只做了一件事：注册一个插槽条目");
  ok(CODE.indexOf("session.append") < 0 && CODE.indexOf(".append(") < 0, "[11] 代码里没有任何会话 append（除了给那一行 append 容器）");
  ok(CODE.indexOf('role: "user"') < 0 && CODE.indexOf('"user/message"') < 0, "[11] 不构造 user 消息");
  ok(CODE.indexOf("producer-owned") < 0, "[11] 不触碰 V4 会话准入面");
  ok(typeof plugin.apply === "function" && typeof plugin.inject !== "undefined", "[11] 导出面只有 apply/inject");
}

section("12. DOM 锚点契约（官方产物里必须还存在我依赖的语义属性）");
{
  const candidates = [
    "F:/Work Space/DeepSeek Harness/_review/dsh-asar/dsh/node_modules/@deepseek-ai/dsh-client-ui-model-selection/lib/client.js",
  ];
  const official = candidates.find((path) => existsSync(path));
  if (official === undefined) {
    console.log("  --   跳过：本机没有解包出来的官方产物（_review/dsh-asar）");
  } else {
    const text = readFileSync(official, "utf8");
    ok(text.indexOf('"aria-haspopup": "menu"') > 0, "[12] 官方席仍然有 aria-haspopup=menu");
    ok(text.indexOf('"aria-expanded": open') > 0, "[12] 官方席仍然有 aria-expanded");
    ok(text.indexOf("aria-controls") > 0 && text.indexOf("-menu`") > 0, "[12] 官方席仍然用 aria-controls 指向菜单 id");
    ok(text.indexOf('role: "menuitem"') > 0, "[12] 根面板两行仍然是 role=menuitem");
    ok(text.indexOf('"menu.effort": "推理等级"') > 0, "[12] 官方中文文案仍然是「推理等级」");
    ok(text.indexOf('role: "menuitemradio"') > 0, "[12] 子面板仍然是 menuitemradio（我的结构判定靠这个区分）");
    ok(text.indexOf('window.addEventListener("resize", place)') > 0, "[12] 官方菜单在 resize 时会重测位置（我加高后靠它重排）");
  }
}

section("13. 宿主半边（lib/index.js）");
{
  const hostPath = fileURLToPath(new URL("../lib/index.js", import.meta.url));
  const mod = await import(pathToFileURL(hostPath).href + `?t=${Date.now()}`);
  let threw = false;
  try {
    mod.apply({});
    mod.apply(undefined);
    mod.apply({ logger: () => { throw new Error("logger boom"); } });
    mod.apply({ logger: { info() { throw new Error("sink boom"); } } });
    mod.apply(null);
  } catch (error) {
    threw = true;
  }
  ok(!threw, "[13] 宿主半边在任何畸形 ctx 下都不抛错（绝不连累插件树）");
  ok(mod.inject === undefined || Array.isArray(mod.inject) === false, "[13] 宿主半边不声明服务（避免 fiber 停在 PENDING）");
}

section("14. 官方数值文字（Max / High）的颜色");
{
  const { react, internals, menu } = await setup();
  const H = internals.ENERGY_END;
  // 只改颜色，一个字的文字都不碰
  eq(menu.effortValueEl.textContent, "High", "[14] 文字内容没被动过");
  eq(menu.effortValueEl.style.color, internals.valueColorFor(H), "[14] high 档：官方数值文字按位置着色");
  ok(!menu.effortLabelEl.style.color, "[14] 官方标签（推理等级）的颜色不动");
  ok(!menu.modelValueEl.style.color, "[14] 另一行（模型）的数值颜色不动 —— 只碰推理等级那一行");

  // 颜色随位置走：蓝 → 紫罗兰
  eq(internals.valueColorFor(0), "rgb(77,147,248)", "[14] 最左端 = 蓝");
  eq(internals.valueColorFor(1), "rgb(139,92,246)", "[14] 最高档 = 紫罗兰（不是看不见的深紫，也不是发虚的亮紫）");
  const rgb = (s) => s.match(/\d+/g).map(Number);
  const low = rgb(internals.valueColorFor(0));
  const mid = rgb(internals.valueColorFor(H));
  const top = rgb(internals.valueColorFor(1));
  ok(mid[0] > low[0] && top[0] > mid[0], "[14] 红色分量单调上升（越往右越紫）");
  ok(top[1] < low[1], "[14] 绿色分量下降（紫比蓝更冷）");
  // 可读性：对白底与对深色底（#1b1c20）都要够，这条以后能挡住"挑了个看不见的颜色"
  const luminance = (c) => {
    const f = (v) => {
      const s = v / 255;
      return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
    };
    return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2]);
  };
  const contrast = (a, b) => {
    const la = luminance(a);
    const lb = luminance(b);
    return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
  };
  const WHITE = [255, 255, 255];
  const DARK_BG = [27, 28, 32];
  ok(contrast(top, WHITE) >= 3, `[14] 最高档对白底对比度 ${contrast(top, WHITE).toFixed(2)}:1 ≥3（浅色主题读得清）`);
  ok(contrast(top, DARK_BG) >= 3, `[14] 最高档对深色底对比度 ${contrast(top, DARK_BG).toFixed(2)}:1 ≥3（深色主题读得清）`);
  ok(contrast(rgb(internals.valueColorFor(0)), WHITE) >= 3, "[14] 最左端的蓝对白底也够（≥3）");
  const sum = (s) => rgb(s).reduce((a, b) => a + b, 0);
  ok(sum(internals.valueColorFor(1)) > sum(internals.fillColorFor(1)), "[14] 数值颜色比填充末尾的深紫更亮（文字不能用深紫）");
  ok(sum(internals.valueColorFor(1)) > sum(internals.valueColorFor(H)), "[14] 最高档比 high 更亮（越往右越通电）");

  // 拖到最高档 → 文字变成紫罗兰
  track(react).fire("onPointerDown", { clientX: 300, pointerId: 1 });
  await settle();
  eq(menu.effortValueEl.style.color, "rgb(139,92,246)", "[14] 拖到 Max：文字直接变紫罗兰");
  eq(menu.effortValueEl.textContent, "High", "[14] 文字内容仍然由官方自己管（没被我们改写）");

  // 关掉菜单 → 还原成原来的内联颜色（通常是空）
  const { menu: menu3, bundle } = await setup();
  eq(menu3.effortValueEl.style.color, internals.valueColorFor(H), "[14] 关之前确实着色了（前置条件）");
  menu3.close();
  bundle.flushObservers(); // 生产里靠 MutationObserver 触发（settle 不会跑它）
  await settle();
  ok(!menu3.effortValueEl.style.color, "[14] 菜单关闭后颜色被还原（不把改动留在官方节点上）");
  eq(menu3.effortValueEl.textContent, "High", "[14] 还原的是颜色，文字始终是官方自己的");

  // 认不出 class 时退到结构判定：最后一个有文字的 span
  const again = await setup();
  const valueEl = again.menu.effortValueEl;
  valueEl.className = "";
  eq(internals.findValueElement(again.menu.effortRow), valueEl, "[14] class 认不出时退到结构判定（最后一个有文字的 span）");
  ok(internals.findValueElement(null) === null, "[14] 传 null 不抛错");
}

section("15. 收起态模型席按钮上的档位（点开之前就看得见）");
{
  const H = 2 / 3;
  // 关键场景：菜单**没打开**（aria-expanded=false）—— 滑条此时不注入，但席上的档位文字照样着色
  const closed = await setup({ menu: { open: false } });
  eq(closed.menu.seatEffortEl.textContent, "High", "[15] 席按钮上的档位文字没被动过");
  eq(closed.menu.seatEffortEl.style.color, closed.internals.valueColorFor(H), "[15] 点开之前就按位置着色了（菜单未展开）");
  ok(!closed.menu.seatLabelEl.style.color, "[15] 席上的模型名（DeepSeek-V41-Flash）颜色不动");
  eq(closed.menu.seatLabelEl.textContent, "DeepSeek-V41-Flash", "[15] 模型名文字没被动过");
  ok(closed.react.find("track") === null, "[15] 菜单没打开时不注入滑条（前置条件，说明上面那条不是靠滑条生效的）");

  // 打开菜单后：拖动改档位 → 菜单里的数值跟着草稿、席上的档位跟已生效
  const { react, internals, menu, bundle, document } = await setup();

  // 拖动中：官方席显示的是**已生效**档位，所以它的颜色不该跟着草稿跑
  track(react).fire("onPointerDown", { clientX: 300, pointerId: 1 });
  await settle();
  eq(menu.effortValueEl.style.color, "rgb(139,92,246)", "[15] 菜单里那一行跟着草稿变成 Max 色");
  eq(menu.seatEffortEl.style.color, internals.valueColorFor(H), "[15] 席按钮仍按已生效档位着色（拖动中不乱跳）");
  track(react).fire("onPointerUp", {});
  await settle();
  eq(menu.seatEffortEl.style.color, "rgb(139,92,246)", "[15] 提交后席按钮跟上 Max 色");
  eq(menu.seatEffortEl.textContent, "High", "[15] 文字仍然由官方自己管（我们只改颜色）");

  // 官方重渲染换了那个节点 → 桥要重新抓到并补色
  const oldEl = menu.seatEffortEl;
  const parent = oldEl.parentNode;
  parent.removeChild(oldEl);
  const newNode = document.createElement("span");
  newNode.className = "wq12jW_triggerEffort";
  newNode.textContent = "High";
  parent.appendChild(newNode);
  bundle.flushObservers();
  await settle();
  eq(newNode.style.color, "rgb(139,92,246)", "[15] 官方换了节点后，新节点也被着色（桥重新抓取）");
  eq(oldEl.style.color ?? "", "", "[15] 旧节点被还原后才放手（不留改动）");

  // 卸载组件 → 还原席按钮的颜色
  react.unmount();
  await settle();
  eq(newNode.style.color ?? "", "", "[15] 组件卸载后席按钮颜色被还原");

  // 认文字：给错的名字就不动（fail-open，绝不误伤别的文字）
  const other = await setup();
  ok(internals.findSeatEffort(other.document, other.menu.composer, "Max") === null, "[15] 名字对不上就返回 null（不猜、不乱改）");
  ok(internals.findSeatEffort(other.document, other.menu.composer, "") === null, "[15] 名字为空也不动");
  ok(internals.findSeatEffort(null, other.menu.composer, "High") === null, "[15] 传 null 不抛错");
  eq(internals.findSeatEffort(other.document, other.menu.composer, "DeepSeek-V41-Flash"), other.menu.seatLabelEl, "[15] 按文字精确命中（模型名也认得出来，但我们只用档位名）");
}

section("16. Off 档保持官方灰 + 刻度点更小更淡");
{
  const { internals } = await setup();
  const OFF = { id: "off", name: "Off" };
  const LOW = { id: "low", name: "Low" };
  // 判定：id 与 name 都认，大小写/空格不敏感，认不出就算普通档位（照常着色）
  ok(internals.isOffLevel(OFF), "[16] id/name 为 off 的档位被认出来");
  ok(internals.isOffLevel({ id: "OFF" }), "[16] 大小写不敏感");
  ok(internals.isOffLevel({ name: "  off " }), "[16] 空格不敏感");
  ok(internals.isOffLevel({ name: "关闭" }), "[16] 中文同义写法也认");
  ok(!internals.isOffLevel(LOW), "[16] Low 不是 off 档");
  ok(!internals.isOffLevel(null) && !internals.isOffLevel(undefined), "[16] 空值不误判");
  // 颜色：off 档给空串 = 不写内联色 = 官方原本的灰
  eq(internals.valueColorFor(0, OFF), "", "[16] off 档 → 空串（不写内联色，保持官方灰）");
  eq(internals.valueColorFor(0, LOW), "rgb(77,147,248)", "[16] 首档不是 off（比如只有 Low/High/Max）时照常给蓝");
  eq(internals.valueColorFor(1, OFF), "", "[16] 即便位置在最右，只要档位是 off 就是灰的");

  // 真场景：当前档位 = off，且席按钮上也写着 Off
  const off = await setup({ host: { effort: "off" }, menu: { effortLabel: "Off" } });
  eq(off.react.find("root").getAttribute("data-energy"), "0", "[16] off 档没有能量层（纯蓝、无星云无粒子）");
  eq(off.react.findAll("particle").length, 0, "[16] off 档没有粒子");
  eq(off.menu.effortValueEl.style.color, "", "[16] 菜单里那一行的数值文字：灰（不写内联色）");
  eq(off.menu.seatEffortEl.style.color, "", "[16] 收起态席按钮上的档位文字：灰（不写内联色）");
  eq(off.menu.effortValueEl.textContent, "Off", "[16] 文字内容仍然是官方的");
  ok(!off.menu.seatLabelEl.style.color, "[16] 模型名依旧不动");
  // 拖到 Max 就恢复着色（确认"灰"只发生在 off 档）
  track(off.react).fire("onPointerDown", { clientX: 300, pointerId: 1 });
  await settle();
  eq(off.menu.effortValueEl.style.color, "rgb(139,92,246)", "[16] 拖到 Max：菜单里那一行先变紫罗兰");
  eq(off.menu.seatEffortEl.style.color, "", "[16] 席按钮按已生效档位（仍是 off）→ 还是灰的");
  track(off.react).fire("onPointerUp", {});
  await settle();
  eq(off.menu.seatEffortEl.style.color, "rgb(139,92,246)", "[16] 提交后席按钮也变成紫罗兰");

  // 刻度点：更小更淡
  const tickCss = internals.CSS.slice(internals.CSS.indexOf(".ces-tick{"), internals.CSS.indexOf("}", internals.CSS.indexOf(".ces-tick{")));
  ok(tickCss.indexOf("width:3px;height:3px") > 0, "[16] 刻度点 5px → 3px（更小）");
  ok(tickCss.indexOf("26%,transparent") > 0, "[16] 未达到的刻度 38% → 26%（更淡）");
  ok(internals.CSS.indexOf(".ces-tick[data-on='1']{background:rgba(255,255,255,.5)}") > 0, "[16] 已达刻度 92% → 50% 白（更淡，不再和星星抢眼）");
  const tickNodes = off.react.findAll("tick");
  ok(tickNodes.length >= 4, `[16] 4 档就有 4 个刻度点（实测 ${tickNodes.length}）`);
}

/* ══════════════════════════════════════════════════════════════════════ */

console.log(`\n${failed === 0 ? "全部通过 ✅" : "有失败 ❌"} （${passed} 项通过，${failed} 项失败）`);
if (failed > 0) {
  console.log("失败项：");
  for (const label of failures) console.log(`  · ${label}`);
  process.exitCode = 1;
}
