/**
 * dsh-reasoning-card — 客户端半边
 *
 * 把 DSH 官方模型菜单整体重排成一张 **ChatGPT 风格卡片**，并把「推理等级」做成 Codex 风格滑条：
 *   · 卡片顶部：大号档位名（官方那一行的 value 文字，跟着滑条位置变色）
 *   · 第二行：「模型名 ›」，点它进官方模型列表（列表行也重做成卡片式）
 *   · 滑条铺满一行；拖到最高档时轨道亮起紫色能量层（流向渐变 + 扫光 + 22 颗星尘粒子）
 *   · 卡片右上角：插件自绘的「恢复默认档位」按钮
 *   · 输入框工具行**不加任何东西**；收起态那枚席按钮做成胶囊
 *
 * ── 官方根面板的确切形状（来自 app.asar 源码，本插件用到的锚点）──────────
 *
 *   席（官方 ModelSelect 的 trigger）：
 *     <button aria-haspopup="menu" aria-expanded={open} aria-controls={`${id}-menu`}>
 *   菜单（portal 到 body 的 MenuSurface）：
 *     <… role="menu" id={`${id}-menu`}>                       ← 用 aria-controls + id 定位，比 class 稳
 *       <button role="menuitem"> 模型 … </button>              ← 根面板**只有**两个 menuitem
 *       <button role="menuitem"> 推理等级 <span>High</span> <svg/> </button>   ← 推理等级那一行
 *   子面板（模型列表 / 等级列表）用的是 `menuitemradio`，所以
 *   `button[role="menuitem"]` 恰好唯一标识根面板那两行 —— 这是本插件的主锚点。
 *
 * ── 纪律 ────────────────────────────────────────────────────────────────
 *  1. **只重排、不换节点**：官方那两行与官方列表的 DOM **一个节点都不新建/不删除**，
 *     只给它们加一个自己的 class 改外观；关菜单或卸载时把 class 摘掉即可还原。
 *     官方的键盘、Esc、焦点、portal 定位逻辑因此**原封不动**。
 *  2. **行为改动之一：改掉官方「推理等级」那一行的 click 去向**（见 `guardRow`）。
 *     那一行的 onClick 是官方 drill 进等级列表的**唯一入口**；滑条已经能调等级，
 *     那张卡片就是多余的（用户点名要去掉它）。拦的是**原生 click**：React 17+ 把
 *     onClick 委托到 portal 容器的冒泡阶段，在那一行上捕获阶段 stopImmediatePropagation
 *     就够 —— 鼠标、Enter/Space、官方 Tab 的 `focused.click()` 全都被覆盖。
 *     拦下之后**转发给「模型」那一行**：那一行是卡片上半张的大号标题（档位名），
 *     与下半张的模型名行是同一个视觉整体，点这片区域都该进**模型列表**。
 *  3. **只往菜单里 append 一个容器**（滑条 + 重置按钮）——菜单是官方 React 的产物，
 *     多一个尾巴节点不影响它自己的 children 复用。
 *  4. **fail-open**：任何一步找不到（没有 aria-controls、菜单不是根面板、会话作用域没就绪…）
 *     就把 class 与容器全撤掉 —— 官方菜单保持原样，绝不因为本插件而点不开。
 *  5. **绝不注入消息**：不监听 agent/pre-step、不 append 会话事件、不构造消息
 *     （同类插件在这里踩过 V4 会话准入的坑，本插件结构上不存在这条路）。
 */
window.__ModuleLoader__.load({
  id: "dsh-reasoning-card",
  factory: function (require) {
    var module = { exports: {} };
    var exports = module.exports;

    var React = require("react");
    var ReactDOM = require("react-dom");

    var PACKAGE_ID = "dsh-reasoning-card";
    /** 仍然注册一个（不可见的）插槽条目：它是**每会话**拿到 sessionId 与 ctx 的立足点。 */
    var SLOT_NAME = "conversation.input.right";
    var ENTRY_ID = "reasoning-card";
    var ENTRY_ORDER = 40;
    /** 「加高那一栏的上下距离」（卡片里滑条容器的上下留白）。 */
    var ROW_PADDING_BLOCK = "10px";
    /** 官方那一行的中文/英文文案（形状锚点之一；认不出就按官方固定顺序取第 2 个 menuitem）。 */
    var EFFORT_ROW_LABELS = ["推理等级", "Effort"];
    /** 卡片上给官方那两行/官方列表行打的 class（只加外观，不换节点；卸载时摘掉）。 */
    var CLS_CARD = "ces-card";
    var CLS_HEAD = "ces-head"; // 官方「推理等级」那一行 → 卡片顶部的大号档位名
    var CLS_MODELROW = "ces-modelrow"; // 官方「模型」那一行 → 第二行的「模型名 ›」
    var CLS_LIST = "ces-list"; // 官方模型列表容器（子面板）
    var CLS_OPTION = "ces-option"; // 官方列表行
    var CLS_OPTIONNAME = "ces-optionname"; // 官方列表行的名字 span
    var CLS_OPTIONCOPY = "ces-optioncopy"; // 官方列表行的文案容器
    var CLS_VALUE = "ces-value"; // 官方 value 文字（档位名 / 模型名）
    /** 收起态那枚席按钮（胶囊样式）。 */
    var CLS_SEAT = "ces-seat";
    /**
     * 官方菜单**本体**（root / model / effort 三个面板复用同一个 portal 容器）。
     * 卡片宽度与内距打在它身上，两个面板因此永远同宽 —— 见 CSS 里那段注释。
     */
    var CLS_SURFACE = "ces-surface";
    /** 官方搜索行（`input[role=searchbox]` 的直属容器）：视觉上收起、但保持可聚焦。 */
    var CLS_SEARCHROW = "ces-searchrow";
    /** 官方列表里的粘性分组标题。 */
    var CLS_GROUPHEAD = "ces-grouphead";
    /**
     * 「提供商默认」这个**虚拟档位**的 id 与显示名（插件自造，不会写进目录）。
     *
     * 官方模型列表在目录没给 `reasoning.defaultEffort` 时会**补一项**「提供商默认」
     * （`dsh-client-ui-model-selection` 的 `effort.providerDefault`，中文字典里是 "Default"），
     * 提交的是 `select({provider, model})` —— 不带 `reasoningEffort`。
     * 卡片右上角的 ↻ 在同样情况下走这条，所以用同一个 id 记账。
     */
    var PROVIDER_DEFAULT_ID = "__provider-default__";
    var PROVIDER_DEFAULT_NAME = "Default";
    /**
     * 贴顶分组标题的**自有**标记。
     *
     * 官方 primitives 的 `observeStickyMenuGroups` 靠一条「列表顶 1px 条」的
     * IntersectionObserver 判定贴顶，真机上 section 顶落在 +1~+2px 而那条观察区
     * 恰好在 +1 之内 —— 实测 `data-stuck` 从未置位，标题因此永远透明、
     * 文字直接压在滚过去的行上（就是截图里「Trae Global 压住上一行」）。
     * 我们不去猜官方什么时候修，自己按 scroll 位置算。
     */
    var STUCK_ATTR = "data-ces-stuck";
    /* 拖动期间的写回降频窗口（毫秒）。松手一律立即落地。 */
    var COMMIT_THROTTLE_MS = 120;
    /** 提交后等宿主真实回报的上限；超时回滚并提示，不继续假装已生效。 */
    var COMMIT_DEADLINE_MS = 10000;
    /** 目录解析失败时的退避重试序列（毫秒，累计约 9 秒）。 */
    var RETRY_DELAYS = [60, 240, 540, 960, 1500, 3000, 3000];
    /**
     * 菜单挂上后补发 resize 的时刻（毫秒）。
     *
     * 官方 `place()` 第一次测量时滑块还没被 React portal 渲染进菜单，量到的高度偏小，
     * 于是菜单底边压住触发器（实测 -22px，正确值 +8px）。滑块挂载是异步的，
     * 所以按这几个时刻补测几次把它拉正 —— 次数有界，不做轮询。
     */
    var SETTLE_DELAYS = [0, 60, 180, 420];
    var STYLE_MARKER = PACKAGE_ID;

    /* ── 尺寸与速率常量：**必须声明在 CSS 数组之前**，因为样式表要插值它们 ──
       （踩过一次：CSS 数组先于常量求值，样式里写进去的是 `height:undefinedpx`，
       真机上轨道会塌成 0 高。测试里对轨道高/旋钮直径的断言就是为这个加的。） */
    /** 轨道高度（px）。旋钮直径与它相同 —— 一个"管子里的球"，圆永远是完整的圆。
        用户要求「滑轨变细 2 个像素」：28 → 26（旋钮、填充、刻度、粒子层全部跟着变，
        它们共用这一个常量，所以只改这一处）。 */
    var TRACK_HEIGHT = 26;
    var KNOB_SIZE = TRACK_HEIGHT;
    /** 旋钮半径。圆心在两端各留出这个半径，圆圈才不会顶出轨道被菜单裁掉。 */
    var KNOB_RADIUS = KNOB_SIZE / 2;
    /** 全局速率倍数（用户要求：所有速度 ×4）。粒子时长 = 基准时长 ÷ (本值 × speedFor)。 */
    var BASE_SPEEDUP = 4;
    /**
     * 星空的**基准横穿时长**（秒，越大越慢）与各星时长浮动（± 这个比例）。
     * 基准对应"位置速率最快的那一档"（speedFor 的上限 `MAX_SPEED_FACTOR = 2`）：MAX 档 1.5s，
     * high 档（1×）3s，左端（0.35×）约 8.6s —— 速度随位置变化这条一直保留。
     * 浮动压到 ±8%（速度差 1.16×）：原来用 0.95~2.05s（速度差 2.16×）时快星会追上慢星成团。
     */
    var STARFIELD_DURATION_MEAN = 1.5;
    var STARFIELD_DURATION_SPREAD = 0.08;
    /** MAX 档星空的亮度/大小下限（1 = 现在的大小与亮度，即上限）。 */
    var STARFIELD_MIN = 0.5;
    /** 黄金比：把 22 颗星的高度与相位按低差异序列铺开（见 buildParticles / starDelayFor）。 */
    var GOLDEN_RATIO = 0.6180339887498949;
    /** 位置速率的上限（= speedFor 的封顶值），用来把"最快那一档"和基准时长对齐。 */
    var MAX_SPEED_FACTOR = 2;
    /** 系统开启「减少动态效果」时，星星时长乘这个倍数（放缓而不是冻住）。 */
    var REDUCED_MOTION_SLOWDOWN = 2.6;
    /** 相位相邻的两颗星，高度至少差这么多"槽"（1 槽 = 4% 轨道高）——防止并成一坨。 */
    var MIN_HEIGHT_SLOTS = 3;
    /** 能量段起点：第二档的刻度位置（4 档模型 → 1/3）。这一段以前是纯蓝，之后才渐入紫色。 */
    var ENERGY_START = 1 / 3;
    /** 颜色锚点：紫出现在这里（4 档模型 → high 档）。 */
    var ENERGY_END = 2 / 3;

    /** 蓝 → 紫 → 深紫（"第一档到第二档为蓝色，再往右逐渐变紫变深"）。 */
    var COLOR_BLUE = [77, 147, 248];
    var COLOR_VIOLET = [147, 51, 234];
    var COLOR_DEEP = [76, 29, 149];
    /**
     * 数值文字（"Max"）用的亮紫终点。
     * 文字不能像填充那样收到深紫（`COLOR_DEEP` 在深色底上几乎看不见），所以另给一个亮端；
     * 但也不能太亮 —— 实测 `#c084fc` 在**浅色主题**下对比度只有 2.6:1（发虚），
     * 所以取中档紫罗兰 `#8b5cf6`：对白底 ≈4.2:1、对深色底（#1b1c20）≈4.0:1，两种主题都读得清。
     */
    var COLOR_TEXT_VIOLET = [139, 92, 246];

    /* ════════════════════════════ 样式 ════════════════════════════ */

    /*
     * 颜色一律走 DSH 自己的设计令牌（`--dsw-*`），浅色/深色自动跟随。
     * 蓝色强调色用 `--dsw-alias-state-business-primary`（深色下 = deepseek-400 #7aaaff），
     * 回退到 blue-450 #4d93f8 —— 也就是参考图里那条轨道的蓝。
     */
    var CSS = [
      /* 注入进官方菜单的容器：卡片里滑条那一段 + 右上角的重置按钮。
         它现在是官方菜单的**最后一个子节点**，所以用 order 之外的普通流即可 ——
         官方那两行被我们重排到了它上面（见 .ces-head / .ces-modelrow）。 */
      ".ces-inline{--ces-accent:var(--dsw-alias-state-business-primary,var(--dsw-static-blue-450,#4d93f8));box-sizing:border-box;flex-basis:100%;width:100%;min-width:0}",
      /* 滑条与上面两行之间**留出一段间距**（原来是 2px，悬停胶囊底边几乎贴着滑条）。
         参考图（ChatGPT 强度弹层，逻辑宽约 223px）里这段距离是 11px —— 换成我们的
         268px 卡片约 13px；取 12px，卡片总高因此 104px，与参考图等比换算的 103px 吻合
         （原来只有 96px，比参考图矮一截）。 */
      ".ces-track{position:relative;box-sizing:border-box;height:" + TRACK_HEIGHT + "px;margin-top:12px;border-radius:999px;background:var(--dsw-alias-border-l1,rgba(15,17,21,.08));cursor:pointer;touch-action:none;user-select:none;-webkit-user-select:none}",
      ".ces-track:focus-visible{outline:var(--dsw-focus-ring-width,2px) solid var(--dsw-focus-ring-color,var(--ces-accent));outline-offset:2px}",
      ".ces-fill{position:absolute;top:0;bottom:0;left:0;border-radius:999px;pointer-events:none}",
      ".ces-tick{position:absolute;top:50%;width:3px;height:3px;margin:-1.5px 0 0 -1.5px;border-radius:50%;background:color-mix(in srgb,var(--dsw-alias-label-primary,#0f1115) 26%,transparent);pointer-events:none}",
      ".ces-tick[data-on='1']{background:rgba(255,255,255,.5)}",
      /* 旋钮直径 = 轨道高度（"与滑条同宽"）：圆完整地填满管口，不会出现被裁出的平边。 */
      ".ces-knob{position:absolute;top:50%;width:" + KNOB_SIZE + "px;height:" + KNOB_SIZE + "px;margin:" + (-KNOB_RADIUS) + "px 0 0 " + (-KNOB_RADIUS) + "px;border-radius:50%;background:#fff;box-shadow:0 1px 5px rgba(0,0,0,.34),0 0 0 .5px rgba(0,0,0,.06);pointer-events:none}",
      ".ces-error{margin-top:6px;font-size:11px;line-height:16px;color:var(--dsw-alias-state-error-primary,#e5484d)}",

      /* ══════════════════ 卡片重排（ChatGPT 风格）══════════════════
         这一整块**只加外观，不换节点**：官方那两行（推理等级 / 模型）与官方列表行
         仍是官方自己的节点，只是被我们改成了卡片的排布与观感。
         官方的点击、键盘、焦点、Esc、portal 定位逻辑全都不受影响。 */

      /* 官方菜单本体 → 卡片。
         ⚠️ 官方 .menu 自带 `width:max-content; padding:4px`，这里必须用 `!important`
         压过它的哈希 class（同一个元素上，官方 class 与我们的 class 同优先级，
         但官方样式表在我们的后面还是前面不确定 —— 用 !important 做成确定的）。

         **宽度与内距打在菜单本体上（.ces-surface），不打在 .ces-card 上**：
         官方同一个 portal 容器在 root / model / effort 三个面板间复用，root 面板
         有卡片那两行、model/effort 面板里是官方列表 —— 以前只给 root 面板加
         `.ces-card{width:268px;padding:12px}`，drill 进列表时这个 class 被摘掉，
         面板就回落到官方的 `width:max-content` + `padding:4px`，
         实测外层宽度 **292 → 248** 突变 44px、左边距跟着重锚（面板整块横跳）。
         现在宽度/内距挂在两个面板都有的菜单本体上：**两个面板永远同宽**。

         **必须写 `box-sizing:border-box`**：官方 .menu 没声明 box-sizing，
         默认 content-box ⇒ `width:268px` 再加上 `padding:12px` 实测外层 292px；
         窄视口下 `100vw - 32px` 的预算没算这 24px 内距，
         320px 视口实测 `left:-4`（卡片溢出窗口左缘）。border-box 之后
         声明宽 = 实际外框宽，窄视口不再溢出。

         **宽度按参考图（ChatGPT 桌面版的强度弹层）的比例定**：
         实测参考图里「卡片宽 ÷ 输入框宽 = 37%」，本机输入框逻辑宽约 712px，故 712 × 37% ≈ 264；
         取 268px 与参考图比例吻合到 ±2%。**写死像素、不跟着视口缩放** ——
         参考图里它也是个固定宽度的弹层，而且官方菜单是"测量后固定定位"的，
         宽度会变会让它的 `place()` 每次都要重算位置。 */
      "." + CLS_SURFACE + "{box-sizing:border-box!important;width:min(268px,100vw - 32px)!important;max-width:min(268px,100vw - 32px)!important;padding:12px!important}",
      /* 卡片行距：两行之间**不留 gap**（原来是 3px），两行文字因此贴紧。
         卡片内容 = 大号档位名（line-height 22）+ 模型名 20px + 滑条
         （.ces-track 自带 margin-top:12px —— 那是给悬停胶囊与滑轨之间留出的 15px 呼吸）；
         实测两行**文字**之间的空隙从 7px 收到 2px。
         官方那两行的点击面积不受影响：上半张的透明 `::after` 只补它下面那 2px 字体空白，
         下半张本来就是整行 20px 可点。 */
      "." + CLS_CARD + "{gap:0}",
      /* 卡片里的**视觉顺序**：大号档位名在上、模型名在下。
         官方 DOM 的顺序是[模型][推理等级]，这里用 flex `order` 换位 ——
         **一个节点都不搬**（搬节点会让官方 React 的 children 复用错位）。 */
      "." + CLS_HEAD + "{order:-2}",
      "." + CLS_MODELROW + "{order:-1}",
      /* 卡片顶部：官方「推理等级」那一行 → 大号档位名居中。
         官方这一行是 `height:34px; padding:0 8px` 的 flex 行，里面是
         [label][value][chevron]。这里把 label 与 chevron 藏起来、value 放大居中 ——
         它们仍然在 DOM 里（官方 React 不会因为看不见就出问题），也没有被移动。
          指针是 pointer：这一行被 guardRow 转发到「模型」那一行，点它就进模型列表，
          所以它必须读起来是可点的（原来是 default，因为那时点了什么也不会发生）。 */
      "." + CLS_HEAD + "{height:auto!important;padding:0!important;justify-content:center!important;cursor:pointer!important;position:relative!important}",
      /* 上半张的点击面积向下补 2px：卡片行距已归零，但两行各自的盒子里还留着字体空白
         （上半张 line-height 22 对 16px 字 ≈ 上下各 3px；下半张 line-height 16 对 12px 字）。
         上半张底边下面那 2px 不属于任何一行、点它会落在菜单背景上，
         而用户画的红框是**一整片**区域 —— 所以用透明伪元素把上半张的点击面积补满这 2px。
         高度写死 2px（不是 `height:100%`）：下半张自己本来就整行可点，
         补多了会反过来盖住下半张的文字（实测 `height:100%` 时 elementFromPoint
         打在下半张中心，命中的却是上半张）。
         伪元素上的点击 target 仍是这一行自己，于是照常被 guardRow 转发。 */
      "." + CLS_HEAD + "::after{content:\"\";position:absolute;left:0;right:0;top:100%;height:2px}",
      "." + CLS_HEAD + ":hover{background:0 0!important}",
      "." + CLS_HEAD + ">span:first-child," + "." + CLS_HEAD + ">svg{display:none!important}",
      /* 标题字号：参考图里「档位名文字高 ÷ 卡片宽 = 4.3%」，268 × 4.3% ≈ 11.5px 字高，
         换成 font-size 约 16px（UTF-8 里拉丁字母的大写高度 ≈ 字号的 0.72）。 */
      "." + CLS_HEAD + ">span:nth-child(2){font-size:16px;line-height:22px;font-weight:600;text-align:center;color:var(--dsw-alias-label-primary);flex:1 1 auto}",
      /* 卡片第二行：官方「模型」那一行 → 「模型名 ›」。
         官方的 label（"模型"）藏起来，value 放中间，chevron 留在右边。 */
      "." + CLS_MODELROW + "{height:20px!important;padding:0!important;justify-content:center!important;gap:3px!important}",
      "." + CLS_MODELROW + ">span:first-child{display:none!important}",
      /* `overflow:visible` 是必须的：官方 `.cellValue` 带 `overflow:hidden`（给超长模型名
         做省略号用的），会把挂在 span 上的胶囊伪元素**连负偏移一起裁掉** ——
         实测裁到只剩 span 自己的 149×16 大小，往上罩不住档位名那一行。
         卡片内容区 244px、实测最长的模型名 202px，离省略号还差得远，去掉裁剪不影响观感。 */
      "." + CLS_MODELROW + ">span:nth-child(2){position:relative!important;overflow:visible!important;font-size:12px;line-height:16px;color:var(--dsw-alias-label-secondary);flex:0 1 auto!important;text-align:center}",
      "." + CLS_MODELROW + ">svg{color:var(--dsw-alias-label-secondary)!important;width:11px!important;height:11px!important}",
      /* ── 悬停：整片「档位名 + 模型名」区域浮出一个浅灰圆角胶囊 ────────────
         参考图里那个胶囊把**两行文字**都罩在里面、宽度只包住文字（不铺满卡片）。
         它画在模型名那个 value span 上：span 是 `flex:0 1 auto` 的**内容宽**盒子，
         于是胶囊自然跟着模型名贴身（长名字宽、短名字窄，卡片里居中）。
         竖直方向用负偏移往上罩住「档位名」那一行：head 22px（height:auto 后只剩 line-height 22）
         + modelrow 20px，span 在 modelrow 里上下各留 2px ⇒ top:-25px/bottom:-1px
         正好把两行都包进来（实测胶囊高 41px，两行区域 38px，上下各多一点点呼吸）。
         **下边距收到 -1px**：原来 bottom:-4px 让胶囊往下长出 4px，把滑条上方那 12px
         间距吃掉一大半（实测只剩 10px）—— 用户明确要求悬停胶囊「不要挨着推理等级滑条」。
         收到 -1px 后实测间距 **15px**，与参考图等比换算的 13px 同量级、不再相贴。
         水平方向：左留 12px，右留 26px = 12px 内距 + 11px chevron + 3px 行内 gap，
         把雪弗龙也一起包进去（参考图里 › 就在胶囊右端里面）。
         `z-index:-1` + span 不建栈上下文 ⇒ 胶囊落在菜单材质层之上、两行文字之下，
         文字照常看得见；`pointer-events:none` 保证它不吃点击。

         胶囊圆角 5px：参考图量得 8 源像素，按卡片高比（268/446）换算 = 4.8px。
         原来写 10px —— 在 46px 高的胶囊上是 24%，明显比参考图更圆。 */
      "." + CLS_MODELROW + ">span:nth-child(2)::after{content:\"\";position:absolute;left:-12px;right:-26px;top:-25px;bottom:-1px;border-radius:5px;background:var(--dsw-alias-interactive-bg-hover,#2631480f);opacity:0;pointer-events:none;z-index:-1}",
      /* 悬停/键盘聚焦**两行中任意一行**都让胶囊浮出来。
         官方 DOM 顺序是 [模型行][推理等级行]，而视觉上档位名在上（order:-2）
         —— 兄弟选择器只能向后匹配，所以这里用 `:has()` 从卡片往下找（实测支持）。 */
      "." + CLS_MODELROW + ":hover>span:nth-child(2)::after,"
        + "." + CLS_MODELROW + ":focus-visible>span:nth-child(2)::after,"
        + "." + CLS_CARD + ":has(" + "." + CLS_HEAD + ":hover)>" + "." + CLS_MODELROW + ">span:nth-child(2)::after,"
        + "." + CLS_CARD + ":has(" + "." + CLS_HEAD + ":focus-visible)>" + "." + CLS_MODELROW + ">span:nth-child(2)::after{opacity:1!important}",
      /* 官方给这两行都画了铺满整行的 hover/focus 底色 —— 中和掉：
         悬停反馈只由上面那个贴身胶囊给（head 那条原本就有，这里补上模型行与聚焦态）。 */
      "." + CLS_MODELROW + ":hover,"
        + "." + CLS_MODELROW + ":focus-visible,"
        + "." + CLS_HEAD + ":focus-visible{background:0 0!important}",

      /* 重置按钮：官方没有这个按钮，是插件**自绘**的（在 .ces-inline 里）。
         它要落在**卡片**的右上角，而 .ces-inline 是卡片的最后一个子节点、
         本身**不设 position**（于是绝对值相对最近的定位祖先 = 官方那个 position:fixed 的菜单）
         —— 这样一条 `top/right` 就贴住卡片角，不必猜滑条离卡片顶有多远。 */
      ".ces-reset{position:absolute;top:10px;right:10px;width:17px;height:17px;padding:0;border:0;border-radius:50%;background:0 0;color:var(--dsw-alias-label-tertiary,#81858c);cursor:pointer;display:grid;place-items:center;transition:background .12s,color .12s}",
      ".ces-reset:hover{background:var(--dsw-alias-interactive-bg-hover,#2631480f);color:var(--dsw-alias-label-primary,#0f1115)}",
      ".ces-reset:focus-visible{outline:var(--dsw-focus-ring-width,2px) solid var(--dsw-focus-ring-color,var(--ces-accent));outline-offset:1px}",
      ".ces-reset:disabled{opacity:.35;cursor:default;background:0 0}",
      /* 图标 ≈ 按钮的 0.76（参考图：28px 图标 / 6.3% 卡片宽 → 268px 下约 13px）。 */
      ".ces-reset svg{width:13px;height:13px;display:block}",

      /* 官方列表（子面板）的滚动容器 `.groups`：官方自己管 overflow，这里只动内距。

         ⚠️ `padding` 必须是 0：官方 `.groups` 是 `display:block`，里面的粘性分组标题
         用 `position:sticky; top:0` 贴的是**滚动内容盒**的顶边 —— 容器一有上内距，
         标题就被钉在内距下面（实测贴顶位置从 0 变成 2px），
         上下各多出 2px 的死区、又和官方自己的判定打架。
         旧规则里那句 `gap:2px` 对 block 容器**根本不起作用**（不是 flex），一并去掉。 */
      "." + CLS_LIST + "{padding:0}",
      /* 列表行 → **原样用回官方样式**（用户要求：「模型列表卡片用回官方的样式」）。
         官方 `._7KE1Ra_option` 是 34px 高、`--dsw-radius-md`(12px) 圆角矩形、
         内距 5×7、gap 6px；选中态官方是 `._7KE1Ra_selected{background:0 0}`，
         只靠行尾的对勾表示「当前」。以前那套（999px 胶囊 / 36px 行高 / 6×8 内距 /
         字重 500 / 选中铺一层 `--dsw-alias-interactive-bg-hover` 底色）全部撤掉。

         这里把官方那四个值**显式写回**（不是改造）：同一个元素上我们的 class 与官方
         哈希 class 优先级相同、两张样式表先后不确定，显式声明才能确定地拿到官方外观。

         ⚠️ 只回列表行；**面板本体（.ces-surface）的 268px 宽与 12px 内距保留** ——
         宽度打在菜单本体上是为了让 root / model 两个面板同宽：官方 .menu 是
         `width:max-content; padding:4px`，root 面板有我们那两行卡片，drill 进列表后
         面板会回落成官方尺寸并重锚一次（实测宽度 268→248、面板整块横跳）。 */
      "." + CLS_OPTION + "{border-radius:var(--dsw-radius-md,12px)!important;min-height:34px!important;padding:5px 7px!important;gap:6px!important}",
      "." + CLS_OPTIONCOPY + "{gap:0}",
      "." + CLS_OPTIONNAME + "{font-size:13px;line-height:18px;font-weight:400}",

      /* ── 去掉「搜索模型…」输入框（用户要求）─────────────────────────────
         官方搜索框是 React 里 `choices.length > 4` 的常量判定（模型数超过 4 就渲染），
         插件改不了它的 JSX，只能从 CSS 下手。

         ⚠️ **不能用 `display:none`**：官方 drill 进列表后会把焦点给搜索框
         （实测 `document.activeElement` = `INPUT|searchbox`），Tab-from-trigger
         那条路径也是 `searchRef.current?.focus()`；`display:none` 的元素**不可聚焦**，
         焦点会掉到 body，方向键与 Enter 选中随之失效。
         这里把它收成 1×1、透明、不可点，**元素本身仍可聚焦** ——
         官方那几条键盘分支照常成立（详见 keydown 守卫里那段说明）。 */
      "." + CLS_SEARCHROW + "{position:absolute!important;top:0!important;left:0!important;width:1px!important;height:1px!important;margin:0!important;padding:0!important;border:0!important;overflow:hidden!important;clip-path:inset(50%)!important;opacity:0!important;pointer-events:none!important}",

      /* ── 粘性分组标题的底色（用户说的「拥挤/压字」）───────────────────
         官方 `observeStickyMenuGroups` 在真机上从未把 `data-stuck` 置位（原因见
         STUCK_ATTR 那段注释），标题因此透明，滚过去的行直接从文字底下穿过去。
         这里自己按 scroll 位置打 `data-ces-stuck`（桥里算），并给底色 ——
         用的是官方自己在 stuck 时用的同一个变量，观感与官方一致。 */
      "." + CLS_GROUPHEAD + "[" + STUCK_ATTR + "]{background:var(--dsw-alias-menu-group-header-fill)!important}",

      /* 收起态那枚席按钮 → 胶囊（模型名 + 彩色档位名 + 雪弗龙）。
         官方 trigger 的底色只在 hover 时出现，这里给一个常驻的浅底。
         ⚠️ 用 `:where()` 把自己的权重压到 0，避免压过官方自己的 hover/focus 规则。 */
      ":where(." + CLS_SEAT + "){border-radius:999px!important;background:var(--dsw-alias-interactive-bg-hover,#2631480f)!important;padding:0 8px!important;height:28px!important}",

      /* ── 最高档能量层（纯视觉：紫色星云 + 星尘粒子 + 扫光）─────────────────
         强度由 `--ces-energy`(0..1) 一个变量驱动：外层只做 opacity，
         所以"渐入"是浏览器合成的颜色插值，不需要 JS 逐帧改样式。
         关掉时把粒子动画 `animation-play-state: paused`，不让 22 个隐形元素白烧 GPU。 */
      /* 轨道**不加外发光**（用户要求去掉滑条的投影）：能量只由星云/粒子/扫光表达。
         参考图（ChatGPT 的强度弹层）实测轨道外一圈就是卡片底色，没有任何光晕 —— 见 README。
         ⚠️ 下面那行 `data-energy='0'` 规则**不能一起删** —— 它管的是粒子动画的启停。 */
      ".ces-inline[data-energy='0'] .ces-star,.ces-inline[data-energy='0'] .ces-energy__sweep{animation-play-state:paused}",
      /* 能量层只覆盖**已填充那一段**（宽度与填充相同）：档位右边没到的部分不显示能量条。
         左端从 0 起、宽度由内联样式给（= 到旋钮圆心），所以它跟着旋钮一起长。 */
      ".ces-energy{position:absolute;top:0;bottom:0;left:0;border-radius:999px;overflow:hidden;pointer-events:none;opacity:var(--ces-energy,0);transition:opacity .2s ease;background:linear-gradient(90deg,#3b1178 0%,#6d28d9 30%,#9333ea 62%,#c084fc 100%)}",
      /* 星星单独一层：**不跟着星云淡入**（否则 high 档会被星云的 0.5 透明度压得看不见）。
         几何与星云层相同（贴着已填充段、圆角裁切），透明度由内联样式给。 */
      ".ces-stars{position:absolute;top:0;bottom:0;left:0;border-radius:999px;overflow:hidden;pointer-events:none;transition:opacity .2s ease}",
      /* 星空（**所有出现粒子的档位都用这一套**）：外层是**整轨宽度**的轨道
         （它自己在做 -100% 的连续横穿），内层圆点的亮度/大小由 --ces-b 决定（越亮越大）。
         残影只在两端淡出，而那两端在可视区外，所以看起来粒子"从不消失"。

         ⚠️ 时长与相位**直接内联**写在元素上（见组件的 animationDuration / animationDelay），
         不走 CSS 变量：实测把 `animation-delay:var(--ces-delay)` 写在样式表里时，
         真宿主里负相位不生效 —— 结果是"一打开所有星星挤在起点，十几秒后才靠速度差散开"。
         `--ces-b`（亮度/大小）只是不参与动画计时的普通变量，留着没问题。 */
      ".ces-star{position:absolute;left:0;right:0;height:3px;margin-top:-1.5px;pointer-events:none;animation-name:ces-star-sweep;animation-timing-function:linear;animation-iteration-count:infinite}",
      ".ces-star__dot{position:absolute;left:100%;top:0;width:3px;height:3px;margin-left:-1.5px;border-radius:50%;background:#fff;box-shadow:0 0 4px rgba(255,255,255,.85);opacity:var(--ces-b,1);transform:scale(var(--ces-b,1))}",
      "@keyframes ces-star-sweep{0%{transform:translate3d(0,0,0);opacity:0}6%{opacity:1}94%{opacity:1}100%{transform:translate3d(-100%,0,0);opacity:0}}",
      ".ces-energy__sweep{position:absolute;inset:0;background:linear-gradient(100deg,transparent 18%,rgba(255,255,255,.30) 50%,transparent 82%);transform:translateX(100%);animation:ces-sweep 2.4s linear infinite}",
      "@keyframes ces-sweep{0%{transform:translateX(100%)}100%{transform:translateX(-100%)}}",
      "body[data-ds-dark-theme] .ces-star__dot{background:#f5f3ff;box-shadow:0 0 5px rgba(216,180,254,.95)}",
      /* 系统要求「减少动态效果」时**放缓**而不是冻住：收起扫光。
         星星的放缓在 JS 里算（时长 × REDUCED_MOTION_SLOWDOWN）—— 不走 CSS 媒体查询，
         因为时长现在是内联的，也免得再引入"变量参与动画计时"这类坑。 */
      "@media (prefers-reduced-motion: reduce){.ces-energy{transition:none}.ces-energy__sweep{display:none}}",
    ].join("\n");

    /** 把样式挂进文档。加载器会把它认领为「本插件产出的 style」（HMR 卸载时一并清理）。 */
    function installStyles() {
      try {
        if (typeof document === "undefined" || !document.head) return null;
        var existing = document.querySelector('style[data-plugin-css="' + STYLE_MARKER + '"]');
        if (existing) return existing;
        var style = document.createElement("style");
        style.setAttribute("data-plugin-css", STYLE_MARKER);
        style.textContent = CSS;
        document.head.appendChild(style);
        return style;
      } catch (error) {
        /* 样式失败只影响观感，绝不影响功能 */
        return null;
      }
    }

    /* ════════════════════════ 纯函数（可离线单测）════════════════════════ */

    var EMPTY_SNAPSHOT = Object.freeze({
      current: null,
      groups: [],
      failures: [],
      status: "idle",
      pending: null,
      error: null,
      retainedEffort: undefined,
    });

    /** 在目录快照里找到当前模型条目（groups[].models[]）。 */
    function modelOf(state) {
      var current = state && state.current;
      if (!current || typeof current.provider !== "string" || typeof current.model !== "string") return null;
      var groups = state && Array.isArray(state.groups) ? state.groups : [];
      for (var i = 0; i < groups.length; i += 1) {
        var group = groups[i];
        if (!group || group.id !== current.provider) continue;
        var models = Array.isArray(group.models) ? group.models : [];
        for (var j = 0; j < models.length; j += 1) {
          if (models[j] && models[j].id === current.model) return models[j];
        }
      }
      return null;
    }

    /** 当前模型真实可用的档位列表（官方 id + 官方显示名，按目录顺序）。 */
    function levelsOf(state) {
      var model = modelOf(state);
      var efforts = model && model.reasoning && Array.isArray(model.reasoning.efforts) ? model.reasoning.efforts : [];
      var out = [];
      for (var i = 0; i < efforts.length; i += 1) {
        var effort = efforts[i];
        if (!effort || typeof effort.id !== "string" || effort.id.length === 0) continue;
        out.push({
          id: effort.id,
          name: typeof effort.name === "string" && effort.name.length > 0 ? effort.name : effort.id,
        });
      }
      return out;
    }

    /**
     * 当前**生效**的档位 id：显式设置优先；没设置过就是模型的默认档
     * （与官方 `syncInputs()` 的 `effort = intended.reasoningEffort ?? reasoning.defaultEffort` 同款）。
     */
    function effectiveEffortId(state) {
      var current = state && state.current;
      if (current && typeof current.reasoningEffort === "string" && current.reasoningEffort.length > 0) {
        return current.reasoningEffort;
      }
      var model = modelOf(state);
      var fallback = model && model.reasoning && model.reasoning.defaultEffort;
      return typeof fallback === "string" && fallback.length > 0 ? fallback : null;
    }

    function indexOfLevel(levels, id) {
      if (typeof id !== "string") return -1;
      for (var i = 0; i < levels.length; i += 1) if (levels[i].id === id) return i;
      return -1;
    }

    /**
     * 会话**显式**设置过的档位 id（`current.reasoningEffort`），没设置过返回 null。
     *
     * 与 `effectiveEffortId` 的区别：后者在没设置时会落回目录的 `defaultEffort`，
     * 而这里只回答"用户/宿主到底写没写过档位" —— 「提供商默认」那条回退要靠它判"是否已经在那"。
     */
    function explicitEffortId(state) {
      var current = state && state.current;
      if (current && typeof current.reasoningEffort === "string" && current.reasoningEffort.length > 0) {
        return current.reasoningEffort;
      }
      return null;
    }

    /**
     * 「恢复默认档位」按钮的**目标**。两种情况，都照官方模型列表自己的语义：
     *
     * 1. 目录给了 `reasoning.defaultEffort`、且它确实在当前档位表里 → 写回那个档位 id。
     *    官方在档位列表里就是把这一项当成普通档位列出来的（带默认档自己的名字）。
     * 2. 目录**没给**默认档，或给的 id 不在档位表里 → 清空显式档位，交回提供商默认。
     *    官方在同样情况下会往档位列表里**补一项**「提供商默认」
     *    （`dsh-client-ui-model-selection/lib/client.js:563-568`，文案键 `effort.providerDefault`，
     *    中文字典里就是 "Default"），提交的是 `select({provider, model})` —— 不带 reasoningEffort。
     *    这里照抄同一套。没有这条回退，本机 trae 那批模型（目录里只有 efforts、没有
     *    defaultEffort）卡片右上角就永远空着，与参考图对不上。
     *
     * 模型压根没有推理能力（没有 `reasoning` 元数据）或没有档位时返回 null ——
     * 那时没有"默认档"可言，按钮不渲染，不给一个按了没反应的按钮。
     */
    function resetTargetOf(snapshot) {
      var model = modelOf(snapshot);
      var reasoning = model && model.reasoning;
      if (!reasoning) return null;
      var levels = levelsOf(snapshot);
      if (levels.length === 0) return null;
      var fallback = reasoning.defaultEffort;
      if (typeof fallback === "string" && fallback.length > 0) {
        var at = indexOfLevel(levels, fallback);
        // 默认档必须在当前档位表里，否则写了也是一个目录不认的值 → 落到第 2 种情况。
        if (at >= 0) return { kind: "level", id: fallback, name: levels[at].name };
      }
      return { kind: "provider", id: PROVIDER_DEFAULT_ID, name: PROVIDER_DEFAULT_NAME };
    }

    function clamp01(value) {
      if (!(value > 0)) return 0; // 同时挡住 NaN
      return value > 1 ? 1 : value;
    }

    /** 百分比 → 最近档位下标（滑条连续，档位离散，所以必须吸附）。 */
    function indexFromPct(pct, count) {
      if (count <= 1) return 0;
      return Math.max(0, Math.min(count - 1, Math.round(clamp01(pct) * (count - 1))));
    }

    /** 档位下标 → 该档位在轨道上的百分比（刻度点与旋钮永远对齐）。 */
    function pctFromIndex(index, count) {
      if (count <= 1) return 0;
      var safe = Math.max(0, Math.min(count - 1, index));
      return safe / (count - 1);
    }

    function errorText(error) {
      if (error === null || error === undefined) return "档位切换失败";
      if (typeof error === "string") return error;
      if (typeof error.message === "string" && error.message.length > 0) return error.message;
      if (typeof error.code === "string" && error.code.length > 0) return error.code;
      return String(error);
    }

    /* ─────────────────── 最高档能量层：参数与强度曲线 ─────────────────── */

    /**
     * 星尘粒子（星星）：**全部由下标算出，不用随机数** —— 每次渲染完全一致、可离线断言。
     *
     * 形态 = 3px 圆点；运动 = 横穿整条轨道（右 → 左），**不消失**、没有上下飘动。
     *
     * 高度与相位**必须用两条互不相关的分配**：
     *   · 相位 = 黄金比低差异序列（任意前缀都铺得开，拖动时逐渐加星也不会挤）；
     *   · 高度 = **随机排列**的等距槽位（哈希排序，确定性），并与相位排名解耦。
     * 早期版本这两者取自同一个数 `frac((i+1)×φ)`，结果"越靠右的星越高"，22 颗排成
     * 一条斜线（用户实测反馈"太规整，再随机一点"；相关系数实测 0.999）。
     * 再挑一个满足最小间隔的盐值：**相位相邻**（会在轨道上一直并排走）的两颗
     * 高度至少差 `MIN_HEIGHT_SLOTS` 槽，避免并成一坨。
     */
    var PARTICLES = (function buildParticles() {
      var count = 22;
      var out = [];
      var i;
      for (i = 0; i < count; i += 1) {
        out.push({ y: 0, phase: (i + 1) * GOLDEN_RATIO % 1 });
      }
      // 相位排名：黄金比序列里排名相邻 = 在轨道上位置相邻
      var byPhase = [];
      for (i = 0; i < count; i += 1) byPhase.push(i);
      byPhase.sort(function (a, b) {
        return out[a].phase - out[b].phase;
      });
      // 高度槽：找一个满足"相位相邻至少差 MIN_HEIGHT_SLOTS 槽"的确定性随机排列
      var slots = null;
      for (var salt = 71; salt < 4000 && slots === null; salt += 1) {
        var candidate = [];
        for (i = 0; i < count; i += 1) candidate.push(i);
        candidate.sort(function (a, b) {
          var ha = starHash01(a, salt);
          var hb = starHash01(b, salt);
          return ha === hb ? a - b : ha - hb;
        });
        var ok = true;
        for (var k = 1; k < count && ok; k += 1) {
          if (Math.abs(candidate[k] - candidate[k - 1]) < MIN_HEIGHT_SLOTS) ok = false;
        }
        if (ok) slots = candidate;
      }
      if (slots === null) {
        // 兜底：步长 5 与 22 互质 → 一定是排列，且相邻槽恒差 5（≥ MIN_HEIGHT_SLOTS）
        slots = [];
        for (i = 0; i < count; i += 1) slots.push(i * 5 % count);
      }
      for (var rank = 0; rank < count; rank += 1) {
        out[byPhase[rank]].y = 8 + (slots[rank] / (count - 1)) * 84;
      }
      return out;
    })();

    /* 颜色常量与 ENERGY_* 都声明在文件上部的「尺寸与速率常量」块里（供 CSS 插值用），
       这里只放纯函数 —— 不要再重复声明，否则会出现"改一处漏一处"的双份真相。 */

    function mixColor(from, to, t) {
      var k = clamp01(t);
      return [
        Math.round(from[0] + (to[0] - from[0]) * k),
        Math.round(from[1] + (to[1] - from[1]) * k),
        Math.round(from[2] + (to[2] - from[2]) * k),
      ];
    }

    function rgbOf(color) {
      return "rgb(" + color[0] + "," + color[1] + "," + color[2] + ")";
    }

    /** 位置 → 填充色（当前点的颜色，也就是渐变右端的颜色）。 */
    function fillColorFor(pct) {
      var t = clamp01(pct);
      if (t <= ENERGY_START) return rgbOf(COLOR_BLUE);
      if (t <= ENERGY_END) return rgbOf(mixColor(COLOR_BLUE, COLOR_VIOLET, (t - ENERGY_START) / (ENERGY_END - ENERGY_START)));
      return rgbOf(mixColor(COLOR_VIOLET, COLOR_DEEP, (t - ENERGY_END) / (1 - ENERGY_END)));
    }

    /**
     * 位置 → 填充层的背景：**左端恒为蓝，右端（旋钮处）是当前位置的颜色**。
     * 于是 high 档自然呈现"左蓝右紫"的渐变，越往右右端越深。
     */
    function fillBackgroundFor(pct) {
      return "linear-gradient(90deg, " + rgbOf(COLOR_BLUE) + ", " + fillColorFor(pct) + ")";
    }

    /**
     * 位置 → **官方那一行数值文字**（"Max"）的颜色。
     *
     * 与能量同源：蓝 → 紫罗兰，越往右越紫（用户要求"Max 的字体颜色能不能改变"）。
     * 刻意**不跟填充末尾的深紫走** —— `COLOR_DEEP` 当文字在深色底上几乎看不见；
     * 文字需要一个亮端，所以终点用 `COLOR_TEXT_VIOLET`。
     *
     * **Off 档返回空串**：不写内联色 = 官方原本的灰（用户要求"off 档两个界面都是灰的"）。
     * 调用方直接 `style.color = valueColorFor(...)`，空串在浏览器里就是"清掉内联色"。
     */
    function valueColorFor(pct, level) {
      if (isOffLevel(level)) return "";
      return rgbOf(mixColor(COLOR_BLUE, COLOR_TEXT_VIOLET, energyFor(pct)));
    }

    /**
     * 是不是"关闭推理"那一档。
     *
     * DeepSeek 的档位表是 id `off` / name `Off`（见 `dsh-llm-deepseek/lib/index.js` 的
     * `REASONING_EFFORTS`），但 id 是 provider 自己的字符串，所以 id 和 name 都认一遍，
     * 并额外接受几个同义写法。认不出就是普通档位（照常着色）。
     */
    function isOffLevel(level) {
      if (!level) return false;
      var candidates = [level.id, level.name];
      for (var i = 0; i < candidates.length; i += 1) {
        if (typeof candidates[i] !== "string") continue;
        var flat = candidates[i].replace(/\s+/g, "").toLowerCase();
        if (flat === "off" || flat === "none" || flat === "关闭" || flat === "无") return true;
      }
      return false;
    }

    /**
     * 位置 → 能量强度 0..1（紫色星云 + 粒子的总强度）。
     * **纯位置驱动，与档位数无关**：第二档以前为 0（保持干净的蓝），之后线性渐入到最高档的 1。
     * 锚点：pct=1/3 → 0；pct=2/3（4 档模型的 high）→ 0.5；pct=1（max）→ 1。
     */
    function energyFor(pct) {
      return clamp01((clamp01(pct) - ENERGY_START) / (1 - ENERGY_START));
    }

    /**
     * 位置 → 粒子速率倍数。
     * 锚点来自实测反馈：**high 档（4 档模型的 2/3 处）= 1×（也就是现在这个速度刚刚好）**，
     * 最高档 = 2×。再往左按同一斜率降速，但设 0.35× 下限，免得左端变成静止。
     */
    function speedFor(pct) {
      return Math.min(2, Math.max(0.35, 3 * clamp01(pct) - 1));
    }

    /** 位置 → 可见粒子数（"粒子效果逐渐出现、变密集"）。 */
    function particleCountFor(pct) {
      return Math.round(energyFor(pct) * PARTICLES.length);
    }

    /* ── 星空：所有出现粒子的档位都用这一套（统一的动画）────────────────────

       运动模型：外层是一条**整轨宽度**的轨道，自己在做 `translate3d(-100%)` 的连续横穿；
       圆点在最右端出生、向左穿出，残影只在两端淡出（而那两端在可视区外）→ **从不消失**。
       每颗的亮度/大小由确定性伪随机给出（越亮越大，0.5~1），速率随**位置**变化（速度变化保留）。 */

    /** 确定性伪随机 [0,1)：不用 Math.random（可离线断言、重渲染不跳变），但看起来是随机的。 */
    function starHash01(index, salt) {
      var value = (index + 1) * salt * 2654435761 % 4294967296;
      return ((value >>> 8) % 1000) / 1000;
    }

    /** 第 index 颗粒子的亮度/大小系数，落在 [STARFIELD_MIN, 1]（越亮越大）。 */
    function starBrightnessFor(index) {
      return STARFIELD_MIN + (1 - STARFIELD_MIN) * starHash01(index, 61);
    }

    /**
     * 第 index 颗粒子横穿整条轨道的时长（s）。
     * **保留速度随位置变化**：以 speedFor 上限（MAX 档）对齐基准时长 ——
     * MAX 档 1.5s、high 档（1×）3s、左端（0.35×）约 8.6s；各星之间只差 ±8%（防追尾成团）。
     */
    function starDurationFor(index, speedFactor) {
      var speed = Math.min(MAX_SPEED_FACTOR, Math.max(0.35, typeof speedFactor === "number" ? speedFactor : MAX_SPEED_FACTOR));
      var spread = 1 - STARFIELD_DURATION_SPREAD + 2 * STARFIELD_DURATION_SPREAD * starHash01(index, 29);
      return STARFIELD_DURATION_MEAN * MAX_SPEED_FACTOR / speed * spread;
    }

    /**
     * 第 index 颗粒子的相位（负延迟，单位 s）。
     *
     * 相位用**黄金比低差异序列**铺开，而且**只跟 index 有关、跟当前显示几颗无关** ——
     * 这一点很关键：如果按 `i / 当前数量` 算，拖动过程中粒子数变化会让每颗已挂载动画的
     * `animation-delay` 被改写，按规范当前进度会按新起始时间重算，整片星空就会抖一下/重排一次。
     * 低差异序列还有个好处：**任意前缀**（前 N 颗）本身就是均匀铺开的。
     */
    function starDelayFor(index, duration) {
      var particle = PARTICLES[index];
      var phase = particle && typeof particle.phase === "number" ? particle.phase : 0;
      var jitter = starHash01(index, 53) * 0.03; // 一点点抖动，避免看起来像整齐的队列
      return -((phase + jitter) % 1) * duration;
    }

    /** 位置 → 可见星星数（"逐渐出现、变密集"）。 */
    function starCountFor(pct) {
      return particleCountFor(pct);
    }

    /**
     * 位置 → **星星层**的不透明度。
     *
     * 星星不能跟着星云一起淡入：星云层的透明度 = 能量强度，high 档只有 0.5，
     * 那么每颗星的实际不透明度会被压到 0.25~0.5，在紫色底上几乎看不见
     * （用户实测反馈："high 档一打开几乎没粒子"）。所以星星层单独给一个下限，
     * 只随能量轻微变化：high 档 0.8、MAX 档 1.0 —— "逐渐出现"交给**粒子数**去表达。
     */
    function starLayerOpacityFor(pct) {
      return 0.6 + 0.4 * energyFor(pct);
    }

    /**
     * 旋钮中心 / 填充终点 / 刻度的水平位置：`半径 + pct × (100% − 直径)`。
     * 这样 pct=0 时圆心正好落在左端圆角内、pct=1 时落在右端圆角内 —— 圆圈永远是完整的圆。
     */
    function knobOffsetOf(pct) {
      var t = Math.round(clamp01(pct) * 10000) / 10000;
      return "calc(" + KNOB_RADIUS + "px + " + t + " * (100% - " + KNOB_RADIUS * 2 + "px))";
    }

    /* ═════════════════ 官方目录访问（每会话一个，永不抛错）═════════════════ */

    /**
     * 每个会话一个访问器。它解决两件真实存在的事：
     *  1. `directoryFor(sessionId)` 在会话作用域/绑定尚未就绪时**按设计抛错**；
     *  2. 目录实例可能被重建（换模型代、连接重置），"抓一次揣着用"会变成永久坏的控件。
     * 所以每次读写都重新解析，解析失败就退避重试；订阅在一次成功解析后建立。
     */
    function createDirectoryAccess(ctx, sessionId, timers) {
      var listeners = new Set();
      var directory = null;
      var unsubscribe = null;
      var last = EMPTY_SNAPSHOT;
      var retryIndex = 0;
      var retryTimer = null;
      var closed = false;
      var lastLoadAt = 0;

      function notify() {
        var current = [];
        listeners.forEach(function (listener) { current.push(listener); });
        for (var i = 0; i < current.length; i += 1) {
          try { current[i](); } catch (error) { /* 单个订阅者抛错不影响其它订阅者 */ }
        }
      }

      function scheduleRetry() {
        if (closed || retryTimer !== null || retryIndex >= RETRY_DELAYS.length) return;
        var delay = RETRY_DELAYS[retryIndex];
        retryIndex += 1;
        retryTimer = timers.set(function () {
          retryTimer = null;
          // 解析成功后要主动通知一次：调用方（uSES）正等着 store 出现。
          if (resolve() !== null) {
            notify();
            return;
          }
          // 还没就绪就继续退避 —— 少了这一句，第一次重试失败后自愈链就永久断掉，
          // 控件会静默失效（这正是要防的那种"一次启动期抖动变成永久坏控件"）。
          scheduleRetry();
        }, delay);
      }

      /** 重新解析一次目录；实例变化时重挂订阅。返回当前目录（可能为 null）。 */
      function resolve() {
        if (closed) return null;
        var fresh = null;
        try {
          fresh = ctx.modelDirectories.directoryFor(sessionId);
        } catch (error) {
          fresh = null;
        }
        if (!fresh || !fresh.store || typeof fresh.store.getSnapshot !== "function") fresh = null;
        if (fresh === directory) return directory;
        if (unsubscribe !== null) {
          try { unsubscribe(); } catch (error) { /* 退订失败不影响新订阅 */ }
          unsubscribe = null;
        }
        directory = fresh;
        if (directory !== null) {
          retryIndex = 0;
          try {
            unsubscribe = typeof directory.store.subscribe === "function" ? directory.store.subscribe(notify) : null;
          } catch (error) {
            unsubscribe = null;
          }
          kickLoad();
        }
        return directory;
      }

      /** 主动拉一次目录（不 load 的话 store 停在 idle，档位列表是空的）。 */
      function kickLoad() {
        if (closed || directory === null || typeof directory.load !== "function") return;
        var now = Date.now();
        if (now - lastLoadAt < 400) return;
        lastLoadAt = now;
        var target = directory;
        try {
          Promise.resolve(target.load()).catch(function () { /* 失败原因由 store 的 error 字段呈现 */ });
        } catch (error) {
          /* load 同步抛：同样交给 store 状态 */
        }
      }

      return {
        getSnapshot: function () {
          if (closed) return EMPTY_SNAPSHOT;
          if (directory === null) {
            resolve();
            if (directory === null) scheduleRetry();
          }
          if (directory !== null) {
            try {
              var value = directory.store.getSnapshot();
              if (value && typeof value === "object") last = value;
            } catch (error) {
              /* 保留上一次快照，绝不把渲染打崩 */
            }
          }
          return last;
        },
        subscribe: function (listener) {
          if (closed) return function () {};
          listeners.add(listener);
          if (directory === null) {
            resolve();
            if (directory === null) scheduleRetry();
          }
          // StrictMode 会订阅/退订各跑一次；退订只清订阅，不永久关闭访问器。
          return function () {
            listeners.delete(listener);
          };
        },
        /** 取当前真正可写的目录（load/select 在调用时重新解析，避免用失效实例）。 */
        directory: function () {
          var fresh = resolve();
          return fresh !== null ? fresh : directory;
        },
        load: kickLoad,
        dispose: function () {
          closed = true;
          listeners.clear();
          if (retryTimer !== null) {
            try { timers.clear(retryTimer); } catch (error) { /* 忽略 */ }
            retryTimer = null;
          }
          if (unsubscribe !== null) {
            try { unsubscribe(); } catch (error) { /* 忽略 */ }
            unsubscribe = null;
          }
          directory = null;
        },
      };
    }

    /* ══════════ 官方菜单那一行的 DOM 桥（只动那一行，fail-open）══════════ */

    function firstSpanText(row) {
      try {
        var spans = row.querySelectorAll("span");
        for (var i = 0; i < spans.length; i += 1) {
          var text = spans[i].textContent;
          if (typeof text === "string" && text.length > 0) return text;
        }
      } catch (error) {
        /* 认不出就算了，调用方会退到结构判定 */
      }
      return "";
    }

    /**
     * 官方那一行右侧的**数值文字**（"Max" / "High"）—— 就是 `.cellValue` 那个 span。
     * 找不到 class 时退到结构：行内最后一个非空文字的 span（数值在标签之后、箭头之前）。
     * 只改它的颜色，文字内容一律不碰。
     */
    function findValueElement(row) {
      if (!row || typeof row.querySelectorAll !== "function") return null;
      try {
        var byClass = row.querySelectorAll("span[class*='cellValue']");
        if (byClass.length > 0) return byClass[byClass.length - 1];
        var spans = row.querySelectorAll("span");
        var found = null;
        for (var i = 0; i < spans.length; i += 1) {
          var text = spans[i].textContent;
          if (typeof text === "string" && text.replace(/\s+/g, "").length > 0) found = spans[i];
        }
        return found;
      } catch (error) {
        return null;
      }
    }

    /**
     * **收起的模型席按钮**（"DeepSeek-V41-Flash  High  ⌄"）里只显示档位名的那一小段文字。
     *
     * 官方渲染它用的是哈希 class（`wq12jW_triggerEffort`，前缀随构建变），靠 class 认迟早会失效，
     * 所以按**文字**认：官方 trigger 里的档位文字就是档位的 `name`，和我们从目录读到的是同一份数据。
     *
     * 传**全部档位名**（而不是只要当前那个）：档位刚切换、官方还没重渲染席按钮时，
     * 文字还是旧档位名 —— 只认当前名字会在那一瞬间"放手"，颜色闪一下。
     * 认不出任何已知档位名就返回 null（fail-open，绝不动别的文字）。
     */
    function findSeatEffort(doc, composer, expectedLabels) {
      if (!doc || !composer || typeof doc.querySelectorAll !== "function") return null;
      var list = typeof expectedLabels === "string" ? [expectedLabels] : expectedLabels;
      if (Object.prototype.toString.call(list) !== "[object Array]") return null;
      var wanted = [];
      for (var n = 0; n < list.length; n += 1) {
        var name = typeof list[n] === "string" ? list[n].replace(/\s+/g, "") : "";
        if (name.length > 0 && wanted.indexOf(name) < 0) wanted.push(name);
      }
      if (wanted.length === 0) return null;
      try {
        var seats = doc.querySelectorAll('button[aria-haspopup="menu"]');
        for (var i = 0; i < seats.length; i += 1) {
          if (!composer.contains(seats[i])) continue;
          var spans = seats[i].querySelectorAll("span");
          for (var j = 0; j < spans.length; j += 1) {
            var text = spans[j].textContent;
            if (typeof text === "string" && wanted.indexOf(text.replace(/\s+/g, "")) >= 0) return spans[j];
          }
        }
      } catch (error) {
        return null;
      }
      return null;
    }

    /**
     * 在自己所属的 composer 里，找到"打开的那颗官方模型席"对应的菜单，以及卡片要重排的那几块。
     * 全部用官方**语义属性**（aria-haspopup / aria-expanded / aria-controls / role）定位，
     * 不依赖哈希 class —— 官方改样式不会影响这里，改语义才会（那种改动会先在我的测试里炸掉）。
     *
     * @returns {{menu, head, modelRow, headValue, modelValue}|null}
     *   head       官方「推理等级」那一行（→ 卡片顶部大号档位名）
     *   modelRow   官方「模型」那一行（→ 第二行「模型名 ›」）
     *   headValue  官方那一行的 value span（我们给它上色，文字一个字不改）
     */
    function findCardParts(doc, composer) {
      if (!doc || !composer || typeof doc.querySelectorAll !== "function") return null;
      var seats = doc.querySelectorAll('button[aria-haspopup="menu"][aria-expanded="true"]');
      var seat = null;
      for (var i = 0; i < seats.length; i += 1) {
        if (composer.contains(seats[i])) { seat = seats[i]; break; }
      }
      if (seat === null) return null;

      var menuId = typeof seat.getAttribute === "function" ? seat.getAttribute("aria-controls") : null;
      var menu = menuId && typeof doc.getElementById === "function" ? doc.getElementById(menuId) : null;
      if (!menu) return null;

      var items = menu.querySelectorAll('button[role="menuitem"]');
      if (items.length !== 2) return null; // 根面板恰好两行；子面板用的是 menuitemradio
      var head = null;
      for (var j = 0; j < items.length; j += 1) {
        var label = firstSpanText(items[j]);
        for (var k = 0; k < EFFORT_ROW_LABELS.length; k += 1) {
          if (label === EFFORT_ROW_LABELS[k]) head = items[j];
        }
      }
      // 文案认不出（官方改了措辞/别的语言）就按官方固定顺序：第 2 个 menuitem 是推理等级。
      if (head === null) head = items[1];
      var modelRow = items[0] === head ? items[1] : items[0];
      if (modelRow === head) return null; // 认不出来时宁可什么都不做（fail-open）

      return {
        menu: menu,
        head: head,
        modelRow: modelRow,
        headValue: findValueElement(head),
        modelValue: findValueElement(modelRow),
      };
    }

    /** 兼容旧名字（测试与外部只关心"那一行"）。 */
    function findEffortRow(doc, composer) {
      var parts = findCardParts(doc, composer);
      return parts === null ? null : parts.head;
    }

    /**
     * 监听文档，把滑条容器挂进官方那一行。
     *
     * @param options.doc      宿主 document
     * @param options.win       宿主 window（派发 resize 让官方重测菜单位置）
     * @param options.anchor    () => 本会话在 composer 里的锚点元素（用来判定"哪颗席是我的"）
     * @param options.active    () => boolean，当前是否值得注入（没有档位就不注入，免得白加高）
     * @param options.onChange  (host | null) => void
     */
    function createMenuBridge(options) {
      var doc = options.doc;
      var win = options.win;
      var anchor = options.anchor;
      var active = options.active;
      var onChange = options.onChange;
      if (!doc || typeof doc.createElement !== "function") return null;

      var current = null;
      var seat = null; // 收起态那一行里的档位文字（菜单没打开时也要着色）
      var seatColor = ""; // 组件给的当前颜色：重新抓到元素时立刻补上，不必等下一次渲染
      var observer = null;
      var timer = null;
      var disposed = false;
      var seatLabels = options.seatLabels; // () => string[]，全部已知档位名

      /** 本会话的 composer 容器：从锚点往上找官方给 composer 卡片打的标记。 */
      function composerOf() {
        var node = anchor();
        if (!node) return null;
        var el = node;
        while (el && el.nodeType === 1) {
          if (typeof el.getAttribute === "function" && el.getAttribute("data-composer-card") !== null) return el;
          el = el.parentNode;
        }
        return null;
      }

      /**
       * 给官方节点加/摘我们的 class。
       *
       * 官方节点上**只加 class、不写内联样式**：官方 menu 的样式是普通 class 选择器，
       * 我们的 class 用 `!important` 确定性地压过它；卸载时把 class 摘掉就完全还原，
       * 不存在"我们把官方的内联样式覆盖掉、还回去时还错了顺序"这类问题。
       *
       * 每次加都记账（节点 → class 名），detach 时逐个摘掉；节点已被官方卸载也不报错。
       */
      var styled = []; // [{node, cls}]

      function addCls(node, cls) {
        if (!node || !node.classList || typeof node.classList.add !== "function") return false;
        try {
          node.classList.add(cls);
          styled.push({ node: node, cls: cls });
          return true;
        } catch (error) {
          return false;
        }
      }

      /**
       * 官方「推理等级」那一行的 **click 改向**。
       *
       * 那一行的 `onClick` 是官方 drill 进等级列表的**唯一入口**，而滑条本来就能调等级 ——
       * 那张 Default/Low/High/Xhigh 卡片因此是多余的，用户点名要去掉它。拦掉这一行之后，
       * 滑条（根面板）就成了唯一的档位控件；那一行自己留着当卡片的大号标题
       * （CSS 早已把它做成静态标题：`cursor:default`、无 hover 底色、雪弗龙隐藏）。
       *
       * 但用户要求「**点击红框内区域进入模型列表**」：卡片上半张是那行大号档位名、
       * 下半张是「模型」那一行，两行是一个视觉整体，点这片区域都该进模型列表。
       * 所以拦下之后**转发**给「模型」那一行：调它的原生 `click()`，官方 onClick
       * 照常派发、由官方自己 drill 进模型面板 —— 我们不碰 React 的 state。
       * 转发时**先摘掉自己的守卫**（否则转发出去的 click 又落回本函数，无限递归），
       * 再立刻挂回去。目标是菜单里另一行，不会走进被守卫的那一行。
       *
       * 拦的是**原生 click**，而且必须挂在**那一行自己**身上、用捕获阶段：
       * React 17+ 把 onClick 委托到 portal 容器的**冒泡**阶段（`createPortal` 会
       * `listenToAllSupportedEvents(portalContainer)`），所以挂在祖先上会排到 React 之后
       * （等于白挂）；在那一行上捕获阶段 `stopImmediatePropagation()` 之后，事件既不会
       * 走到目标、也不会再冒泡回 portal 容器，React 的委托处理器根本看不到它。
       * 覆盖范围：鼠标点击、Enter/Space（浏览器把键盘激活合成为 click）、以及官方 Tab
       * 处理里的 `focused.click()` —— 三条路径最后都是同一个原生 click。
       *
       * 只拦 click：pointerdown / pointerup / keydown / mousedown 一概不碰 ——
       * 官方根面板的 ArrowDown/Up 焦点移动、Tab 顺序、Esc 关菜单、portal 定位全部照常。
       */
      var guarded = null; // {node, listener, target}

      function releaseGuard() {
        if (guarded === null) return;
        try {
          if (guarded.node && typeof guarded.node.removeEventListener === "function") {
            guarded.node.removeEventListener("click", guarded.listener, true);
          }
        } catch (error) { /* 节点可能已被官方卸载 */ }
        guarded = null;
      }

      /**
       * 守卫那一行，并把它的 click 转发到 `target`（「模型」那一行）。
       *
       * 守卫换行时用 `releaseGuard()` 把旧的摘干净；`target` 是活的（scan 每次重读官方 DOM），
       * 所以存进 `guarded` 而不是闭包捕获，方便后续换目标。
       */
      function guardRow(node, target) {
        if (guarded !== null && guarded.node === node && guarded.target === target) return;
        releaseGuard();
        if (!node || typeof node.addEventListener !== "function") return;
        var listener = function (event) {
          try {
            if (event && typeof event.stopImmediatePropagation === "function") event.stopImmediatePropagation();
            if (event && typeof event.stopPropagation === "function") event.stopPropagation();
          } catch (error) { /* 吞事件失败也不该把异常抛回官方菜单 */ }
          // 转发到「模型」那一行：摘守卫 → click → 立刻挂回。
          if (!target || typeof target.click !== "function") return;
          releaseGuard();
          try {
            target.click();
          } catch (error) { /* 转发失败就只是"点不开"，不该把异常抛回官方菜单 */ }
          guardRow(node, target);
        };
        try {
          node.addEventListener("click", listener, true);
          guarded = { node: node, listener: listener, target: target };
        } catch (error) {
          guarded = null;
        }
      }

      /** 把记过账的 class 全部摘掉（逆序，先摘后加的）。 */
      function clearCls() {
        for (var i = styled.length - 1; i >= 0; i -= 1) {
          try {
            if (styled[i].node && styled[i].node.classList && typeof styled[i].node.classList.remove === "function") {
              styled[i].node.classList.remove(styled[i].cls);
            }
          } catch (error) { /* 节点可能已被官方卸载 */ }
        }
        styled = [];
      }

      function detach() {
        if (current === null) return;
        var container = current.container;
        try {
          if (container && container.parentNode) container.parentNode.removeChild(container);
        } catch (error) { /* 菜单可能已经被官方卸载 */ }
        try {
          clearCls();
          clearListCls();
          // 数值文字（"Max"）的颜色也是我们改的，退出时一并还原
          if (current.headValue && current.headValue.style) current.headValue.style.color = current.previous.headValueColor;
        } catch (error) { /* 还原失败不影响官方菜单自身 */ }
        // click 守卫也是我们加的：官方节点上不留任何我们的监听（fail-open 的"还原"包含它）。
        try { releaseGuard(); } catch (error) { /* 忽略 */ }
        current = null;
        onChange(null);
      }

      /** 收起的档位文字：还原本来的颜色并忘掉它。 */
      function releaseSeat() {
        var seatEl = seat === null ? null : seat.el;
        if (seatEl === null) return;
        try {
          if (seatEl.style) seatEl.style.color = seat.previousColor;
        } catch (error) { /* 元素可能已被官方卸载 */ }
        seat = null;
      }

      /**
       * 同步收起态的席按钮：给它加胶囊 class，给档位文字上色。
       * 只在**元素换了**（官方重渲染换了节点）或还没抓到时重新抓 —— 文字变了不换元素，
       * 所以档位切换不会造成"还原→再上色"的闪动。
       */
      function syncSeat() {
        var composer = composerOf();
        if (composer === null || active() !== true) { releaseSeat(); return; }
        if (seat !== null && seat.el && doc.documentElement && doc.documentElement.contains(seat.el)) {
          if (seatColor && seat.el.style) seat.el.style.color = seatColor; // 官方清过内联样式就补回来
          return;
        }
        releaseSeat();
        var wanted = typeof seatLabels === "function" ? seatLabels() : null;
        var el = findSeatEffort(doc, composer, wanted);
        if (el === null || !el.style) return;
        seat = { el: el, previousColor: el.style.color || "" };
        if (seatColor) el.style.color = seatColor;
        // 胶囊样式打在**席按钮**上（档位文字是它的孙子），所以要往上找那颗 button。
        var button = el;
        while (button && button.nodeType === 1 && String(button.tagName).toLowerCase() !== "button") {
          button = button.parentNode;
        }
        if (button && button.nodeType === 1) markSeat(button);
      }

      /** 席按钮的胶囊 class：跟菜单那套独立记账（dispose 时要能单独摘掉）。 */
      var markedSeat = null;

      function markSeat(button) {
        if (markedSeat === button) return;
        unmarkSeat();
        try {
          if (button.classList && typeof button.classList.add === "function") {
            button.classList.add(CLS_SEAT);
            markedSeat = button;
          }
        } catch (error) { /* 加不上就算了，只是没有胶囊底色 */ }
      }

      function unmarkSeat() {
        if (markedSeat === null) return;
        try {
          if (markedSeat.classList && typeof markedSeat.classList.remove === "function") markedSeat.classList.remove(CLS_SEAT);
        } catch (error) { /* 节点可能已被官方卸载 */ }
        markedSeat = null;
      }

      /**
       * 官方列表（子面板）也重做成卡片式行。
       * 这是**独立于根面板**的一段：用户 drill 进模型列表时根面板那两行已经不在菜单里了，
       * 所以它单独扫描、单独记账。
       */
      var listStyled = []; // [{node, cls}]
      /** 我们收起来的搜索行：[{row, input, previousReadOnly}]（row 是菜单的**直接子节点**）。 */
      var searchRows = [];
      /** 我们上过色的粘性分组标题：[heading]。贴顶标记不是 class，得单独记账。 */
      var headNodes = [];
      /** 分组标题的滚动监听：{list, listener}。 */
      var headWatcher = null;
      /** 标题重画的 rAF 句柄（没有 rAF 时为 null）。 */
      var headFrame = null;
      /** 菜单里的 keydown 守卫：{node, listener}。 */
      var keyGuard = null;
      /** 菜单尺寸稳定后的重定位：{menu, ro}。 */
      var settle = null;

      function clearListCls() {
        for (var i = listStyled.length - 1; i >= 0; i -= 1) {
          try {
            var entry = listStyled[i];
            if (entry.node && entry.node.classList && typeof entry.node.classList.remove === "function") entry.node.classList.remove(entry.cls);
          } catch (error) { /* 忽略 */ }
        }
        listStyled = [];
        // 搜索行的 readOnly 是我们写上去的 DOM 属性（不是 class），单独还原。
        for (var k = searchRows.length - 1; k >= 0; k -= 1) {
          try {
            if (searchRows[k].input) searchRows[k].input.readOnly = searchRows[k].previousReadOnly;
          } catch (error) { /* 节点可能已被官方卸载 */ }
        }
        searchRows = [];
        // 贴顶标记也是属性（不是 class），逐个摘掉；再解绑滚动监听与键盘守卫。
        for (var h = headNodes.length - 1; h >= 0; h -= 1) {
          try {
            if (headNodes[h] && typeof headNodes[h].removeAttribute === "function") headNodes[h].removeAttribute(STUCK_ATTR);
          } catch (error) { /* 忽略 */ }
        }
        headNodes = [];
        releaseHeadWatcher();
        releaseKeyGuard();
        releaseSettle();
      }

      function addListCls(node, cls) {
        if (!node || !node.classList || typeof node.classList.add !== "function") return;
        try {
          node.classList.add(cls);
          listStyled.push({ node: node, cls: cls });
        } catch (error) { /* 忽略 */ }
      }

      /** 官方搜索行：`input[role=searchbox]` 向上走到菜单的**直接子节点**。 */
      function searchRowOf(menu) {
        if (!menu || typeof menu.querySelector !== "function") return null;
        var input = null;
        try { input = menu.querySelector('input[role="searchbox"]'); } catch (error) { return null; }
        if (input === null) return null;
        var row = input;
        while (row && row.parentNode && row.parentNode !== menu) row = row.parentNode;
        return row && row.parentNode === menu ? { row: row, input: input } : null;
      }

      /**
       * 收起「搜索模型…」那一行。
       *
       * 只加 class（CSS 把它收成 1×1 透明、不可点），**元素本身仍可聚焦** ——
       * 官方 drill 进列表后会把焦点给搜索框、方向键/Enter/Tab 全挂在
       * `event.target instanceof HTMLInputElement` 上，display:none 会让这些分支失效。
       * 另外写 `readOnly` 并记账：输入能力去掉（用户要求），但焦点与键盘路径留着。
       */
      function hideSearchRow(menu) {
        var found = searchRowOf(menu);
        if (found === null) { releaseKeyGuard(); return; }
        addListCls(found.row, CLS_SEARCHROW);
        try {
          searchRows.push({ input: found.input, previousReadOnly: found.input.readOnly === true });
          found.input.readOnly = true;
        } catch (error) { /* 设不上就算了，反正 keydown 守卫也拦着 */ }
        guardKeys(menu);
      }

      /**
       * 菜单里的 keydown 守卫（捕获阶段，挂在**菜单自己**身上）。
       *
       * 官方 onKeyDown 挂在 composer 里的 React root div 上，而菜单是 portal 到 body 的，
       * React 合成事件沿 React 树冒泡 —— 我们在菜单上捕获，先于官方跑。
       * 只拦**单字符键**（它们会变成搜索词、把列表隐形过滤掉，而搜索框已经看不见了）；
       * 方向键/Enter/Tab/Esc/退格一律放行，官方那几条分支照常工作。
       */
      function guardKeys(menu) {
        if (keyGuard !== null && keyGuard.node === menu) return;
        releaseKeyGuard();
        if (!menu || typeof menu.addEventListener !== "function") return;
        var listener = function (event) {
          try {
            if (!event || typeof event.preventDefault !== "function") return;
            if (event.ctrlKey === true || event.metaKey === true || event.altKey === true) return;
            var key = typeof event.key === "string" ? event.key : "";
            if (key.length !== 1) return;
            event.preventDefault();
          } catch (error) { /* 吞键失败也不该把异常抛回官方菜单 */ }
        };
        try {
          menu.addEventListener("keydown", listener, true);
          keyGuard = { node: menu, listener: listener };
        } catch (error) { keyGuard = null; }
      }

      function releaseKeyGuard() {
        if (keyGuard === null) return;
        try {
          if (keyGuard.node && typeof keyGuard.node.removeEventListener === "function") {
            keyGuard.node.removeEventListener("keydown", keyGuard.listener, true);
          }
        } catch (error) { /* 节点可能已被官方卸载 */ }
        keyGuard = null;
      }

      /**
       * 菜单里的分组标题。
       *
       * 走 `children` 逐层找（不用属性选择器）：官方的 `section[data-menu-group]`
       * 是列表容器的直接子节点、标题是它的直接子节点 —— 实测如此。
       */
      function groupHeadings(menu) {
        var out = [];
        if (!menu || typeof menu.querySelectorAll !== "function") return out;
        var lists = [];
        try { lists = menu.querySelectorAll('[role="menu"]'); } catch (error) { return out; }
        for (var i = 0; i < lists.length; i += 1) {
          var kids = lists[i].children || [];
          for (var j = 0; j < kids.length; j += 1) {
            var section = kids[j];
            if (!section || section.nodeType !== 1) continue;
            if (typeof section.getAttribute !== "function" || section.getAttribute("data-menu-group") === null) continue;
            var secKids = section.children || [];
            for (var k = 0; k < secKids.length; k += 1) {
              var kid = secKids[k];
              if (kid && kid.nodeType === 1 && typeof kid.getAttribute === "function" && kid.getAttribute("data-menu-group-heading") !== null) {
                out.push(kid);
                break;
              }
            }
          }
        }
        return out;
      }

      /**
       * 给**贴顶**的分组标题打 `data-ces-stuck`（CSS 用它上不透明底色）。
       *
       * 官方 `observeStickyMenuGroups` 靠一条「列表顶 1px 条」的 IntersectionObserver
       * 判定贴顶，真机上 section 顶落在 +1~+2px、恰好越过那条观察带 ——
       * 实测 `data-stuck` 从未置位，标题永远透明，滚过去的行直接从文字底下穿过去。
       * 这里不猜官方什么时候修：直接按几何算（标题顶边贴住列表顶边、且本组还没滚出去）。
       */
      function paintGroupHeads(list) {
        if (!list || !list.children || typeof list.getBoundingClientRect !== "function") return;
        var listTop = 0;
        try {
          var lr = list.getBoundingClientRect();
          listTop = lr ? lr.top : 0;
        } catch (error) { return; }
        var kids = list.children;
        for (var i = 0; i < kids.length; i += 1) {
          var section = kids[i];
          if (!section || section.nodeType !== 1) continue;
          if (typeof section.getAttribute !== "function" || section.getAttribute("data-menu-group") === null) continue;
          var heading = null;
          var secKids = section.children || [];
          for (var j = 0; j < secKids.length; j += 1) {
            var kid = secKids[j];
            if (kid && kid.nodeType === 1 && typeof kid.getAttribute === "function" && kid.getAttribute("data-menu-group-heading") !== null) { heading = kid; break; }
          }
          if (heading === null) continue;
          var stuck = false;
          try {
            var hr = heading.getBoundingClientRect();
            var sr = section.getBoundingClientRect();
            stuck = hr.top <= listTop + 1 && sr.bottom > listTop + 1;
          } catch (error) { stuck = false; }
          try {
            if (stuck) heading.setAttribute(STUCK_ATTR, "");
            else heading.removeAttribute(STUCK_ATTR);
          } catch (error) { /* 忽略 */ }
        }
      }

      /** 滚动时重画贴顶标记（rAF 节流；没有 rAF 就同步画）。 */
      function watchGroupHeads(list) {
        if (headWatcher !== null && headWatcher.list === list) { paintGroupHeads(list); return; }
        releaseHeadWatcher();
        if (!list || typeof list.addEventListener !== "function") return;
        var listener = function () {
          if (headFrame !== null) return;
          // ⚠️ rAF 不能单独兜底：宿主窗口被最小化/遮挡时它根本不推进（真机与无头环境都实测过），
          // 而"有一帧在排队"这个判断会因此把所有后续滚动都挡掉，贴顶标记就停在旧位置上。
          // 所以再加一个**有界**的定时兜底，谁先到谁画。用 token 而不是"先置 headFrame 再取帧"，
          // 因为有的 rAF 桩是同步回调的，那样会把刚跑完的句柄又写回去、把后续滚动全挡住。
          var token = { frame: null, timer: null, done: false };
          var run = function () {
            if (token.done) return;
            token.done = true;
            if (token.timer !== null) {
              try { clearTimeout(token.timer); } catch (error) { /* 忽略 */ }
            }
            if (headFrame === token) headFrame = null;
            paintGroupHeads(list);
          };
          headFrame = token;
          var raf = win && typeof win.requestAnimationFrame === "function"
            ? win.requestAnimationFrame
            : (typeof requestAnimationFrame === "function" ? requestAnimationFrame : null);
          if (typeof raf === "function") {
            try { token.frame = raf(run); } catch (error) { token.frame = null; }
          }
          if (token.done) return; // rAF 桩可能是同步回调的：那时已经画完了
          if (token.frame === null) { run(); return; }
          token.timer = setTimeout(run, 80);
        };
        try {
          list.addEventListener("scroll", listener, { passive: true });
          headWatcher = { list: list, listener: listener };
          paintGroupHeads(list);
        } catch (error) { headWatcher = null; }
      }

      function releaseHeadWatcher() {
        if (headFrame !== null) {
          try {
            var cancel = win && typeof win.cancelAnimationFrame === "function"
              ? win.cancelAnimationFrame
              : (typeof cancelAnimationFrame === "function" ? cancelAnimationFrame : null);
            if (typeof cancel === "function" && headFrame.frame !== null) cancel(headFrame.frame);
          } catch (error) { /* 忽略 */ }
          try { if (headFrame.timer !== null) clearTimeout(headFrame.timer); } catch (error) { /* 忽略 */ }
          headFrame = null;
        }
        if (headWatcher === null) return;
        try {
          if (headWatcher.list && typeof headWatcher.list.removeEventListener === "function") {
            headWatcher.list.removeEventListener("scroll", headWatcher.listener);
          }
        } catch (error) { /* 节点可能已被官方卸载 */ }
        headWatcher = null;
      }

      /** 让官方 `place()` 重测一次位置（它自己挂在 window resize 上）。 */
      function placeMenu() {
        try {
          win.dispatchEvent(new win.Event("resize"));
        } catch (error) { /* 宿主没有 Event 构造器就算了，官方也会在状态变化时重测 */ }
      }

      /**
       * 尺寸稳定后的重定位。
       *
       * 官方 `place()` 只在 `[open, pane, state, query]` 变化或 window resize 时重算，
       * 而插件改完尺寸的那一刻它还没稳定 —— 实测根面板底边压住触发器 22px（应为 +8）。
       * 这里用 ResizeObserver 盯着菜单本体：尺寸一变就派发 resize，让它重测重夹。
       */
      function settleMenu(menu) {
        if (!menu) return;
        if (settle !== null && settle.menu === menu) { placeMenu(); return; }
        releaseSettle();
        settle = { menu: menu, ro: null, timers: [] };
        var RO = win && win.ResizeObserver;
        if (typeof RO !== "function" && typeof ResizeObserver === "function") RO = ResizeObserver;
        if (typeof RO === "function") {
          try {
            // ⚠️ 回调必须**无条件**派发：ResizeObserver 的首次回调报告的是"当前尺寸"，
            // 而我们的观察往往是在尺寸已经落定之后才开始的 —— 只监听"变化"会一次都不响。
            // 位置变化不会反过来触发尺寸变化，所以不会自己喂自己。
            settle.ro = new RO(function () { placeMenu(); });
            settle.ro.observe(menu);
          } catch (error) { settle.ro = null; }
        }
        // 官方 place() 在菜单刚挂上时按"还没有滑块"的尺寸算了一次（实测高度少 30px ⇒
        // 底边压住触发器 22px）。滑块是 React portal 异步渲染进去的，那一刻还没进 DOM，
        // 所以补几次**有界**的重测把它拉回来；不轮询、不重试到无限。
        for (var i = 0; i < SETTLE_DELAYS.length; i += 1) {
          settle.timers.push(setTimeout(placeMenu, SETTLE_DELAYS[i]));
        }
      }

      function releaseSettle() {
        if (settle === null) return;
        try {
          if (settle.ro && typeof settle.ro.disconnect === "function") settle.ro.disconnect();
        } catch (error) { /* 忽略 */ }
        for (var i = 0; i < settle.timers.length; i += 1) {
          try { clearTimeout(settle.timers[i]); } catch (error) { /* 忽略 */ }
        }
        settle = null;
      }

      function restyleList(menu) {
        clearListCls();
        if (!menu || typeof menu.querySelectorAll !== "function") return;
        try {
          // 菜单**本体**：宽度与内距打在它身上，root / model / effort 三个面板因此永远同宽
          // （官方是同一个 portal 容器换 pane，旧规则只把宽度打在卡片上，
          //  于是 drill 进列表时宽度从 292 掉到 248、还重锚一次）。
          addListCls(menu, CLS_SURFACE);
          // 官方列表容器：`role=menu` 且在菜单里（根面板那个 role 是 group/menu 但只有两行 menuitem）。
          var containers = menu.querySelectorAll('[role="menu"]');
          for (var i = 0; i < containers.length; i += 1) addListCls(containers[i], CLS_LIST);
          var options = menu.querySelectorAll('button[role="menuitemradio"]');
          for (var j = 0; j < options.length; j += 1) {
            addListCls(options[j], CLS_OPTION);
            var copy = options[j].querySelector('span[class*="optionCopy"]') || options[j].querySelector("span");
            if (copy) {
              addListCls(copy, CLS_OPTIONCOPY);
              var name = copy.querySelector('span[class*="modelName"]') || copy.querySelector("span");
              if (name) addListCls(name, CLS_OPTIONNAME);
            }
          }
          // 「搜索模型…」那一行：视觉收起、键盘路径留着。
          hideSearchRow(menu);
          // 粘性分组标题：加 class + 记账，并把贴顶判定接管过来。
          var heads = groupHeadings(menu);
          for (var m = 0; m < heads.length; m += 1) {
            addListCls(heads[m], CLS_GROUPHEAD);
            headNodes.push(heads[m]);
          }
          if (heads.length > 0 && containers.length > 0) watchGroupHeads(containers[0]);
          // 菜单尺寸变过 → 让官方重测位置（持续观察，不是一锤子买卖）。
          settleMenu(menu);
        } catch (error) { /* 列表认不出就算了，官方列表照常可用 */ }
      }

      /**
       * 当前打开的这个菜单（按 aria-controls 找，**不依赖根面板在不在**）。
       * 官方菜单是同一个 portal 容器在 root / model / effort 三个面板间复用，
       * 所以列表重排不能挂在「卡片挂上了」这个条件上 —— 它得独立于面板状态。
       */
      function menuOf(doc, composer) {
        if (!doc || !composer || typeof doc.querySelectorAll !== "function") return null;
        var seats = doc.querySelectorAll('button[aria-haspopup="menu"][aria-expanded="true"]');
        for (var i = 0; i < seats.length; i += 1) {
          if (!composer.contains(seats[i])) continue;
          var menuId = typeof seats[i].getAttribute === "function" ? seats[i].getAttribute("aria-controls") : null;
          var menu = menuId && typeof doc.getElementById === "function" ? doc.getElementById(menuId) : null;
          if (menu) return menu;
        }
        return null;
      }

      function scan() {
        if (disposed) return;
        // 收起态的席按钮：跟菜单那套互相独立，任一处失败都不该拖垮另一处
        try { syncSeat(); } catch (error) { /* 忽略 */ }
        try {
          var composer = composerOf();
          if (composer === null || active() !== true) { detach(); return; }

          // 官方列表（模型列表 / 等级列表）的重排**独立于卡片**：
          // 用户 drill 进任一子面板时根面板那两行会从菜单里消失，但列表还在，
          // 那正是它该被重排的时候。真正的重排动作在下面 detach() 之后
          // （clearListCls 会把它冲掉，见那儿的注释），这里只把菜单取出来。
          var openMenu = menuOf(doc, composer);

          // 已经挂好且那几块都还在 → 什么都不做（列表重排上面已经做过）。
          //
          // ⚠️ 「那几块还在」必须逐块确认，不能只看菜单本身在不在文档里：
          // 官方菜单是**同一个 portal 容器**在 root / model / effort 三个面板间复用
          // （pane 状态一切，根面板那两行从菜单里消失、换成 menuitemradio 列表），
          // 所以 `documentElement.contains(menu)` 在三个面板里**永远为 true**。
          // 只靠这一条判定会漏掉「用户点进推理等级列表」这一刻 —— 滑条卡片连同
          // ces-card / ces-head 一起留在菜单里，于是截图里出现
          // 「上面一条滑条 + 下面 Default/Low/Medium/High 四行」这种多此一举的叠层。
          // 逐块确认后，进子面板 = 那两行不在菜单里 → 走 detach() 全撤，
          // 官方列表恢复自己的观感；返回根面板时重新挂上，滑条照常。
          var attached = current !== null
            && current.menu && doc.documentElement && doc.documentElement.contains(current.menu)
            && current.head && current.head.parentNode === current.menu
            && current.modelRow && current.modelRow.parentNode === current.menu
            && current.container && current.container.parentNode === current.menu;
          if (attached) return;

          // ⚠️ detach() 会 clearListCls()，所以列表重排必须放在它**之后**。
          // 放在之前等于白排 —— 这正是「滑条卡片撤掉了，但官方列表的卡片式行也跟着没了」
          // 那种半撤状态的成因。
          var parts = findCardParts(doc, composer);
          detach();

          // 列表重排：**无论在不在这一个面板里都要做**（放在 detach 之后，否则被冲掉）。
          // 在子面板里时，这里就是它唯一一次被重排的机会。
          if (openMenu !== null) restyleList(openMenu);

          // 卡片不在根面板（用户在子面板里）→ 滑条撤掉、列表已重排，收工。
          if (parts === null) return;

          var previous = {
            // 数值文字原来的内联颜色（通常没设过，读作 ""）
            headValueColor: parts.headValue && parts.headValue.style ? parts.headValue.style.color || "" : "",
          };

          // 卡片重排：只加 class（官方节点一个不换），滑条容器 append 到菜单末尾。
          // （列表重排上面已经按同一个菜单做过，这里不重复。）
          addCls(parts.menu, CLS_CARD);
          addCls(parts.head, CLS_HEAD);
          addCls(parts.modelRow, CLS_MODELROW);
          if (parts.headValue) addCls(parts.headValue, CLS_VALUE);
          if (parts.modelValue) addCls(parts.modelValue, CLS_VALUE);

          // 拦掉「推理等级」那一行的 click —— 官方 drill 进等级列表的唯一入口。
          // 滑条已经能调等级，那张卡片多余；拦下后**转发给「模型」那一行**，
          // 于是卡片上半张（大号档位名）与下半张（模型名）点哪都进模型列表。
          guardRow(parts.head, parts.modelRow);

          var container = doc.createElement("div");
          container.className = "ces-inline";
          container.setAttribute("data-ces-part", "host");
          parts.menu.appendChild(container);

          current = {
            menu: parts.menu,
            row: parts.head,        // 兼容旧字段名（测试与组件用它取"卡片顶部那一行"）
            head: parts.head,
            modelRow: parts.modelRow,
            container: container,
            value: parts.headValue, // 兼容旧字段名
            headValue: parts.headValue,
            modelValue: parts.modelValue,
            previous: previous,
          };
          onChange(current);

          // 官方菜单是"测量后固定定位"的，卡片尺寸变了让它重测一次（官方自己在 resize 里重测并夹取）。
          // ⚠️ 一次性派发**太早**：这时候滑条/列表的尺寸还没落定，实测根面板底边压住触发器 22px
          // （应为官方基准的 +8）。改成让 ResizeObserver 盯着菜单本体，尺寸一变就重测。
          settleMenu(parts.menu);
        } catch (error) {
          try { detach(); } catch (inner) { /* 兜到底 */ }
        }
      }

      function start() {
        scan();
        var MO = win && (win.MutationObserver || (typeof MutationObserver === "function" ? MutationObserver : null));
        if (typeof MO === "function") {
          try {
            observer = new MO(function () { scan(); });
            observer.observe(doc.body || doc.documentElement, { childList: true, subtree: true });
            return;
          } catch (error) {
            observer = null;
          }
        }
        // 没有 MutationObserver 时退化成低频轮询；反正每轮都很便宜。
        if (win && typeof win.setInterval === "function") timer = win.setInterval(scan, 400);
      }

      return {
        scan: scan,
        start: start,
        /** 组件把当前该用的颜色给进来；桥负责在（重新）抓到元素时立刻应用。 */
        setSeatColor: function (color) {
          seatColor = typeof color === "string" ? color : "";
          if (seat !== null && seat.el && seat.el.style) {
            try { seat.el.style.color = seatColor; } catch (error) { /* 忽略 */ }
          }
        },
        dispose: function () {
          disposed = true;
          if (observer !== null) {
            try { observer.disconnect(); } catch (error) { /* 忽略 */ }
            observer = null;
          }
          if (timer !== null) {
            try { win.clearInterval(timer); } catch (error) { /* 忽略 */ }
            timer = null;
          }
          releaseSeat();
          unmarkSeat();
          clearListCls();
          try { releaseGuard(); } catch (error) { /* 忽略 */ }
          detach();
        },
        host: function () { return current; },
      };
    }

    /* ════════════════════════════ 组件 ════════════════════════════ */

    /**
     * 单组件设计：锚点 + 桥 + 滑条（portal 进官方那一行）都在同一个函数里，
     * 所有 hook 都在同一个实例上，展开/收起不会改变 hook 顺序。
     */
    function CodexEffortSlider(props) {
      var sessionId = typeof props.sessionId === "string" && props.sessionId.length > 0 ? props.sessionId : null;
      var locked = props.locked === true;
      var ctx = props.__ctx;

      /** 系统的「减少动态效果」只影响**特效强度**，不影响功能（放缓而不是冻住）。 */
      var reducedMotion = false;
      try {
        reducedMotion = typeof window !== "undefined"
          && typeof window.matchMedia === "function"
          && window.matchMedia("(prefers-reduced-motion: reduce)").matches === true;
      } catch (error) {
        reducedMotion = false;
      }

      var access = React.useMemo(
        function () {
          if (sessionId === null || !ctx) return null;
          return createDirectoryAccess(ctx, sessionId, {
            set: function (fn, delay) { return setTimeout(fn, delay); },
            clear: function (handle) { clearTimeout(handle); },
          });
        },
        [ctx, sessionId],
      );

      React.useEffect(function () {
        return function () {
          if (access !== null) access.dispose();
        };
      }, [access]);

      var subscribe = React.useCallback(
        function (onChange) { return access === null ? function () {} : access.subscribe(onChange); },
        [access],
      );
      var getSnapshot = React.useCallback(
        function () { return access === null ? EMPTY_SNAPSHOT : access.getSnapshot(); },
        [access],
      );
      var state = React.useSyncExternalStore(subscribe, getSnapshot, getSnapshot);

      var levels = levelsOf(state);
      var effectiveId = effectiveEffortId(state);
      var committedIndex = indexOfLevel(levels, effectiveId);
      var levelCount = levels.length;

      var draftState = React.useState(null);
      var draft = draftState[0];
      var setDraft = draftState[1];
      var optimisticState = React.useState(null);
      var optimistic = optimisticState[0];
      var setOptimistic = optimisticState[1];
      var errorState = React.useState(null);
      var errorText_ = errorState[0];
      var setError = errorState[1];
      var busyState = React.useState(false);
      var busy = busyState[0];
      var setBusy = busyState[1];
      var hostState = React.useState(null);
      var host = hostState[0];
      var setHost = hostState[1];

      var anchorRef = React.useRef(null);
      var trackRef = React.useRef(null);
      var optimisticIdRef = React.useRef(null);
      /** 拖动的"最新位置"放 ref：React 会把同一 tick 的多次 setState 合并，
       *  松手那一帧若从 state 读位置，可能读到上一次渲染的旧值，从而写错档位。 */
      var draftRef = React.useRef(null);
      var commitRef = React.useRef({ timer: null, inFlight: false, queued: null });
      var draggingRef = React.useRef(false);
      var levelCountRef = React.useRef(0);
      var seatNamesRef = React.useRef([]); // 全部已知档位名（认官方席按钮上的那段文字用）
      var bridgeRef = React.useRef(null);
      levelCountRef.current = levelCount;

      /* 桥：找到官方菜单那一行，把滑条容器挂进去 */
      React.useEffect(function () {
        if (sessionId === null || !ctx) return undefined;
        var bridge = createMenuBridge({
          doc: typeof document === "undefined" ? null : document,
          win: typeof window === "undefined" ? null : window,
          anchor: function () { return anchorRef.current; },
          active: function () { return levelCountRef.current > 0; },
          onChange: function (next) { setHost(next); },
          // 收起态那一行显示的档位名（官方 trigger 里的文字就是它）；给全部名字更抗"官方还没重渲染"
          seatLabels: function () { return seatNamesRef.current; },
        });
        if (bridge === null) return undefined;
        bridgeRef.current = bridge;
        bridge.start();
        return function () {
          bridgeRef.current = null;
          bridge.dispose();
        };
      }, [ctx, sessionId]);

      /**
       * 档位是**后到**的（目录 load 完才有 efforts）。那时 DOM 没有任何变化，
       * MutationObserver 不会响，所以这里在档位数变化时主动重扫一次 ——
       * 少了这一句，"目录晚到"会让滑条永远挂不上去（起步期抖动变永久失效）。
       */
      React.useEffect(function () {
        if (bridgeRef.current !== null) bridgeRef.current.scan();
      }, [levelCount]);

      // 乐观值：提交后先按用户选的那一档显示，直到宿主真实回报（或超时回滚）。
      var optimisticId = optimistic !== null && typeof optimistic.id === "string" ? optimistic.id : null;
      var optimisticIndex = optimisticId === null ? -1 : indexOfLevel(levels, optimisticId);

      // **已生效**的档位（乐观值优先，其次真实值）：收起态那一行显示的是它，不是拖动中的草稿。
      var effectiveIndex = committedIndex >= 0 ? committedIndex : 0;
      if (optimisticIndex >= 0) effectiveIndex = optimisticIndex;
      var effectivePct = pctFromIndex(effectiveIndex, levelCount);
      var effectiveLevel = levels[effectiveIndex] || null;
      // 席按钮上可能出现的是**任意一个档位名**（档位刚切换时官方还没重渲染）
      var seatNames = [];
      for (var n = 0; n < levels.length; n += 1) {
        if (levels[n] && typeof levels[n].name === "string" && levels[n].name.length > 0) seatNames.push(levels[n].name);
      }
      seatNamesRef.current = seatNames;

      // 显示用的档位：拖动中跟着草稿，否则就是已生效那一档。
      var shownIndex = draft !== null ? draft.index : effectiveIndex;
      var shownPct = draft !== null && typeof draft.pct === "number" ? draft.pct : effectivePct;
      var shownLevel = levels[shownIndex] || null;

      // 三个由**位置**连续驱动的量：填充色（蓝→紫→深紫）、能量强度（星云+星星渐入）、位置速率。
      var energy = energyFor(shownPct);
      var energyOn = energy > 0;
      var fillBackground = fillBackgroundFor(shownPct);
      var knobOffset = knobOffsetOf(shownPct);

      // 「通电」的可视反馈只留在**轨道内部**（星云、粒子、扫光 —— 全是原有那套，一个字节没动）。
      // 轨道**没有外发光**（用户要求去掉滑条的投影）：删掉了原来那条 box-shadow 紫晕规则。
      // 旧版还往"那一行"描一圈紫边，但那一行现在是卡片顶部的标题，
      // 描边会变成给标题画框；而卡片本身由官方菜单自己的阴影表达层级，所以这里不再加效果，
      // 也不再往官方节点写任何内联样式。

      // 卡片顶部那个大号**档位名**也跟着位置变色：蓝 → 亮紫（用户要求）。
      // 同样写内联、退出时由桥还原；**只改颜色，文字内容一个字都不碰**。
      React.useEffect(function () {
        var el = host === null ? null : (host.headValue || host.value);
        if (!el || !el.style) return;
        el.style.color = valueColorFor(shownPct, shownLevel);
      }, [host, shownPct, shownLevel]);

      // **收起态**那一行的档位文字（模型席按钮上的 "High"，菜单没打开时就看得见）也跟着变色。
      // 颜色交给桥保管：官方重渲染换了节点时，桥会在重新抓到的那一刻补上，不必等 React。
      // 注意这里用**已生效**的档位（不是拖动中的草稿）—— 收起态显示的是真实档位。
      React.useEffect(function () {
        if (bridgeRef.current === null) return;
        bridgeRef.current.setSeatColor(valueColorFor(effectivePct, effectiveLevel));
      }, [levelCount, effectivePct, effectiveLevel]);

      // 宿主追上乐观值 → 撤掉乐观态（此后以真实目录为准）。
      // 「提供商默认」不在档位表里，判据是"宿主已经没有任何显式档位了"。
      React.useEffect(function () {
        if (optimisticId === null) return;
        if (optimisticId === PROVIDER_DEFAULT_ID) {
          if (explicitEffortId(state) === null) setOptimistic(null);
          return;
        }
        if (effectiveId === optimisticId) setOptimistic(null);
      }, [effectiveId, optimisticId, state]);

      // 超时兜底：宿主迟迟不回报就回滚并说明，不继续假装已生效。
      React.useEffect(function () {
        if (optimisticId === null) return undefined;
        var handle = setTimeout(function () {
          if (optimisticIdRef.current === optimisticId) {
            optimisticIdRef.current = null;
            setOptimistic(null);
            setError("档位切换超时，宿主未回报结果（已回滚显示）");
          }
        }, COMMIT_DEADLINE_MS);
        return function () { clearTimeout(handle); };
      }, [optimisticId]);

      // 组件卸载：清掉降频定时器（否则会在卸载后写一次宿主）。
      React.useEffect(function () {
        return function () {
          var pending = commitRef.current;
          if (pending.timer !== null) {
            clearTimeout(pending.timer);
            pending.timer = null;
          }
          pending.queued = null;
        };
      }, []);

      function currentState() {
        return access === null ? EMPTY_SNAPSHOT : access.getSnapshot();
      }

      function flush() {
        var pending = commitRef.current;
        if (pending.timer !== null) {
          clearTimeout(pending.timer);
          pending.timer = null;
        }
        var levelId = pending.queued;
        pending.queued = null;
        if (levelId === null || levelId === undefined || access === null) return;

        var snapshot = currentState();
        var current = snapshot && snapshot.current;
        if (!current || typeof current.provider !== "string" || typeof current.model !== "string") {
          setError("模型目录尚未就绪，无法写入档位");
          return;
        }
        // 发送前再判一次：可能宿主已经把这个档位写好了（去重的第二道闸）。
        // 「提供商默认」不是档位表里的一项，用"有没有显式档位"判重，与官方 `chooseEffort(void 0)` 同款。
        if (levelId === PROVIDER_DEFAULT_ID) {
          if (explicitEffortId(snapshot) === null) return;
        } else if (effectiveEffortId(snapshot) === levelId) return;

        var directory = access.directory();
        if (directory === null || typeof directory.select !== "function") {
          setError("模型目录不可用，档位未写入");
          return;
        }

        pending.inFlight = true;
        optimisticIdRef.current = levelId;
        setOptimistic({ id: levelId });
        setError(null);
        setBusy(true);

        var result;
        try {
          // 「提供商默认」按官方语义**不带** reasoningEffort（官方 `chooseEffort(void 0)` 就是这条）。
          result = levelId === PROVIDER_DEFAULT_ID
            ? directory.select({ provider: current.provider, model: current.model })
            : directory.select({
              provider: current.provider,
              model: current.model,
              reasoningEffort: levelId,
            });
        } catch (error) {
          result = Promise.reject(error);
        }

        Promise.resolve(result).then(
          function (outcome) {
            pending.inFlight = false;
            if (outcome && outcome.ok === false) {
              optimisticIdRef.current = null;
              setOptimistic(null);
              setError(errorText(outcome.error));
            }
          },
          function (error) {
            pending.inFlight = false;
            optimisticIdRef.current = null;
            setOptimistic(null);
            setError(errorText(error));
          },
        ).then(function () {
          setBusy(false);
          // 在途合并：拖动期间攒下的最新值在这里补发。
          if (pending.queued !== null) flush();
        });
      }

      /** 请求写回某一档：同档位去重 + 在途合并 + 降频；immediate 用于松手/键盘。 */
      function requestCommit(levelId, immediate) {
        if (levelId === null || levelId === undefined) return;
        var pending = commitRef.current;
        var snapshot = currentState();
        // 「提供商默认」不在档位表里，判据换成"宿主已经没有任何显式档位了"（与 flush() 同一套）。
        var already = levelId === PROVIDER_DEFAULT_ID
          ? explicitEffortId(snapshot) === null
          : effectiveEffortId(snapshot) === levelId;
        if (already && pending.queued === null && !pending.inFlight) return;
        pending.queued = levelId;
        if (pending.inFlight) return;
        if (immediate === true) {
          flush();
          return;
        }
        if (pending.timer !== null) return;
        pending.timer = setTimeout(function () {
          pending.timer = null;
          flush();
        }, COMMIT_THROTTLE_MS);
      }

      function pctAt(clientX) {
        var track = trackRef.current;
        if (!track || typeof track.getBoundingClientRect !== "function") return null;
        var rect = track.getBoundingClientRect();
        // 与视觉几何一致：指针落点映射到"旋钮圆心能到的那一段"，所以拖到最左/最右必定命中端点档位。
        var usable = rect.width - KNOB_RADIUS * 2;
        if (!(usable > 0)) return null;
        return clamp01((clientX - rect.left - KNOB_RADIUS) / usable);
      }

      /** 吞掉事件：滑条在官方的 <button> 里，不能让拖动触发那一行的 onClick（会跳进等级列表）。 */
      function swallow(event) {
        if (event && typeof event.stopPropagation === "function") event.stopPropagation();
      }

      function moveTo(clientX, immediate) {
        if (levelCount === 0) return;
        var pct = pctAt(clientX);
        if (pct === null) return;
        var index = indexFromPct(pct, levelCount);
        var next = { pct: pct, index: index };
        draftRef.current = next;
        setDraft(next);
        requestCommit(levels[index].id, immediate === true);
      }

      function endDrag() {
        if (!draggingRef.current) return;
        draggingRef.current = false;
        var latest = draftRef.current;
        if (latest !== null && levelCount > 0) requestCommit(levels[latest.index].id, true);
        draftRef.current = null;
        setDraft(null);
      }

      function onReset() {
        if (locked || levelCount === 0) return;
        var snapshot = currentState();
        var target = resetTargetOf(snapshot);
        if (target === null) return;
        // 松手/点击一律立即落地；同档位由 requestCommit 自己去重。
        setDraft(null);
        draftRef.current = null;
        // 「提供商默认」不是档位表里的一项，写回时按官方语义**不带** reasoningEffort。
        requestCommit(target.kind === "provider" ? PROVIDER_DEFAULT_ID : target.id, true);
      }

      function onTrackPointerDown(event) {
        if (locked || levelCount === 0) return;
        swallow(event);
        draggingRef.current = true;
        try {
          if (event.currentTarget && typeof event.currentTarget.setPointerCapture === "function" && event.pointerId !== undefined) {
            event.currentTarget.setPointerCapture(event.pointerId);
          }
        } catch (error) { /* 指针捕获失败不影响拖动 */ }
        moveTo(event.clientX, false);
      }

      function onTrackPointerMove(event) {
        if (!draggingRef.current) return;
        swallow(event);
        moveTo(event.clientX, false);
      }

      function onKeyDown(event) {
        if (locked || levelCount === 0) return;
        var key = event.key;
        var index = draftRef.current !== null ? draftRef.current.index : shownIndex;
        var next = null;
        if (key === "ArrowLeft" || key === "ArrowDown") next = Math.max(0, index - 1);
        else if (key === "ArrowRight" || key === "ArrowUp") next = Math.min(levelCount - 1, index + 1);
        else if (key === "Home") next = 0;
        else if (key === "End") next = levelCount - 1;
        else return; // Escape / Enter / Tab 交给官方菜单自己处理
        swallow(event);
        if (typeof event.preventDefault === "function") event.preventDefault();
        setDraft(null);
        requestCommit(levels[next].id, true);
      }

      var trackTitle = "推理等级" + (shownLevel !== null ? "：" + shownLevel.name : "");
      if (reducedMotion) trackTitle += "（系统「减少动态效果」已开启：粒子已放缓）";

      var tickNodes = [];
      for (var t = 0; t < levelCount; t += 1) {
        tickNodes.push(React.createElement("span", {
          key: "tick-" + levels[t].id,
          className: "ces-tick",
          "data-ces-part": "tick",
          "data-on": t <= shownIndex ? "1" : "0",
          style: { left: knobOffsetOf(pctFromIndex(t, levelCount)) },
        }));
      }

      // 星空：所有出现粒子的档位都用这一套动画（统一的横穿 + 不消失 + 亮度即大小）。
      // 速率随**位置**变化（速度变化保留）：MAX 档 1.5s 横穿，high 档 3s，左端约 8.6s。
      var positionSpeed = speedFor(shownPct);
      var starCount = starCountFor(shownPct);
      var starLayerOpacity = starLayerOpacityFor(shownPct);
      var particleNodes = [];
      for (var s = 0; s < starCount; s += 1) {
        var starBrightness = starBrightnessFor(s);
        // 「减少动态效果」的放缓在 JS 里算（时长是内联的，不走媒体查询覆盖）
        var starDuration = starDurationFor(s, positionSpeed) * (reducedMotion ? REDUCED_MOTION_SLOWDOWN : 1);
        particleNodes.push(React.createElement(
          "span",
          {
            key: "star-" + s,
            className: "ces-star",
            "data-ces-part": "star",
            style: {
              top: PARTICLES[s].y + "%",
              // ⚠️ 时长与**负相位**必须直接内联：写成 CSS 变量时真宿主里相位不生效，
              //    会出现"一打开星星全挤在起点"（见样式表里的注释）。
              animationDuration: starDuration.toFixed(3) + "s",
              animationDelay: starDelayFor(s, starDuration).toFixed(3) + "s",
            },
          },
          React.createElement("span", {
            className: "ces-star__dot",
            "data-ces-part": "particle",
            // 亮度即大小系数：越亮越大（同时也是不透明度）
            "data-brightness": starBrightness.toFixed(3),
            style: { "--ces-b": starBrightness.toFixed(3) },
          }),
        ));
      }

      var ui = null;
      if (host !== null && host.container && levelCount > 0) {
        // 重置按钮的目标：目录给的默认档，或官方语义的「提供商默认」。没有推理能力就不渲染。
        var resetTarget = resetTargetOf(state);
        var resetAvailable = resetTarget !== null;
        // 已经在目标上（同档位 / 本来就没显式设置过档位）时按钮不可点 —— 点它没有任何效果，不如明确置灰。
        var resetDisabled = !resetAvailable || locked || busy
          || (resetTarget.kind === "level"
            ? shownIndex === indexOfLevel(levels, resetTarget.id)
            : explicitEffortId(state) === null);
        var defaultName = resetTarget === null ? "" : resetTarget.name;

        ui = ReactDOM.createPortal(
          React.createElement(
            "div",
            {
              className: "ces-inline",
              "data-ces-part": "root",
              "data-energy": energyOn ? "1" : "0",
              "data-motion": reducedMotion ? "reduced" : "full",
              "data-busy": busy ? "1" : "0",
              "data-reset": resetAvailable ? "1" : "0",
              // 「恢复提供商默认」与「恢复默认档位」是两种目标，给测试与调试留个标记。
              "data-reset-kind": resetAvailable ? resetTarget.kind : "none",
              style: { "--ces-energy": String(energy) },
            },
            resetAvailable
              ? React.createElement(
                "button",
                {
                  type: "button",
                  className: "ces-reset",
                  "data-ces-part": "reset",
                  disabled: resetDisabled ? true : undefined,
                  title: "恢复默认档位：" + defaultName,
                  "aria-label": "恢复默认档位：" + defaultName,
                  // 卡片是官方菜单的子孙，而官方菜单有自己的键盘处理；这里把事件吞掉，
                  // 免得点一下重置被官方当成"在菜单里点了某项"。（与滑条同一套做法。）
                  onClick: function (event) { swallow(event); onReset(); },
                  onPointerDown: swallow,
                  onPointerMove: swallow,
                  onPointerUp: swallow,
                },
                // 圆形箭头（自己画的路径，没有第三方代码）
                React.createElement(
                  "svg",
                  { viewBox: "0 0 16 16", fill: "none", stroke: "currentColor", strokeWidth: 1.6, strokeLinecap: "round", strokeLinejoin: "round", "aria-hidden": "true" },
                  React.createElement("path", { d: "M13.2 6.6A5.6 5.6 0 1 0 13 10.4" }),
                  React.createElement("path", { d: "M13.4 2.8v3.9h-3.9" }),
                ),
              )
              : null,
            React.createElement(
              "div",
              {
                ref: trackRef,
                className: "ces-track",
                "data-ces-part": "track",
                role: "slider",
                tabIndex: locked ? -1 : 0,
                "aria-label": "推理等级",
                "aria-valuemin": 0,
                "aria-valuemax": Math.max(0, levelCount - 1),
                "aria-valuenow": shownIndex,
                "aria-valuetext": shownLevel !== null ? shownLevel.name : "",
                "aria-disabled": locked ? "true" : undefined,
                title: trackTitle,
                onPointerDown: onTrackPointerDown,
                onPointerMove: onTrackPointerMove,
                onPointerUp: endDrag,
                onPointerCancel: endDrag,
                onKeyDown: onKeyDown,
                onClick: swallow,
              },
              React.createElement("div", {
                className: "ces-fill",
                "data-ces-part": "fill",
                // 填充宽度 = 到旋钮圆心为止（不是整条轨道）；背景是"左蓝 → 当前位置颜色"的渐变。
                style: { width: knobOffset, background: fillBackground },
              }),
              // 能力层（星云 + 扫光）：透明度 = 能量强度，负责"通电"的渐入。
              React.createElement(
                "div",
                { className: "ces-energy", "data-ces-part": "energy", style: { width: knobOffset } },
                React.createElement("div", { className: "ces-energy__sweep", "data-ces-part": "sweep" }),
              ),
              // 星星单独一层：不跟星云淡入（否则 high 档星星被星云的 0.5 透明度压得看不见）。
              React.createElement(
                "div",
                {
                  className: "ces-stars",
                  "data-ces-part": "stars",
                  style: { width: knobOffset, opacity: starLayerOpacity.toFixed(3) },
                },
                particleNodes,
              ),
              tickNodes,
              React.createElement("div", {
                className: "ces-knob",
                "data-ces-part": "knob",
                style: { left: knobOffset },
              }),
            ),
            errorText_ !== null
              ? React.createElement("div", { className: "ces-error", "data-ces-part": "error", role: "status" }, errorText_)
              : null,
          ),
          host.container,
        );
      }

      // 锚点：不可见、不占位，只用来(1)拿住插槽给的 sessionId 上下文 (2)反查自己的 composer。
      return React.createElement("span", {
        ref: anchorRef,
        hidden: true,
        "data-ces-part": "anchor",
        "aria-hidden": "true",
      }, ui);
    }

    /* ════════════════════════════ 插件接线 ════════════════════════════ */

    /**
     * 三个服务都是官方客户端插件已经在用的（slots 不必说；sessions 与 modelDirectories
     * 是 client-ui-model-selection / client-ui-workspace 的既有注入面）。
     * 这里刻意**不**注入 locale / theme：多声明一个可能不存在的服务会让 fiber 停在
     * PENDING，代价远大于省下两行文案。
     */
    var inject = ["slots", "sessions", "modelDirectories"];

    function apply(ctx) {
      installStyles();
      try {
        ctx.slots.inject(SLOT_NAME, function () {
          return ctx.slots.register(
            {
              name: SLOT_NAME,
              id: ENTRY_ID,
              order: ENTRY_ORDER,
              label: function () { return "Reasoning effort"; },
              // 会话 id 的第二条来路（标准 props 一般已经带了；两条都走 props.sessionId）。
              inject: function (sessionId) { return { sessionId: sessionId }; },
            },
            function SlotComponent(props) {
              return React.createElement(CodexEffortSlider, Object.assign({}, props, { __ctx: ctx }));
            },
          );
        });
      } catch (error) {
        // 注册失败只意味着这块控件不出现，绝不能连累宿主输入区。
        try { console.error("[reasoning-card] 插槽注册失败，控件不会出现：", error); } catch (e) { /* 忽略 */ }
      }
    }

    installStyles();

    exports.apply = apply;
    exports.inject = inject;
    // 离线测试用的接缝（纯函数 + 桥 + 组件本身）。运行时无副作用。
    exports.__internals = {
      CSS: CSS,
      SLOT_NAME: SLOT_NAME,
      ENTRY_ID: ENTRY_ID,
      PARTICLES: PARTICLES,
      ROW_PADDING_BLOCK: ROW_PADDING_BLOCK,
      EFFORT_ROW_LABELS: EFFORT_ROW_LABELS,
      CodexEffortSlider: CodexEffortSlider,
      createMenuBridge: createMenuBridge,
      findEffortRow: findEffortRow,
      findCardParts: findCardParts,
      firstSpanText: firstSpanText,
      levelsOf: levelsOf,
      modelOf: modelOf,
      effectiveEffortId: effectiveEffortId,
      explicitEffortId: explicitEffortId,
      resetTargetOf: resetTargetOf,
      PROVIDER_DEFAULT_ID: PROVIDER_DEFAULT_ID,
      PROVIDER_DEFAULT_NAME: PROVIDER_DEFAULT_NAME,
      indexOfLevel: indexOfLevel,
      indexFromPct: indexFromPct,
      pctFromIndex: pctFromIndex,
      CLS_CARD: CLS_CARD,
      CLS_HEAD: CLS_HEAD,
      CLS_MODELROW: CLS_MODELROW,
      CLS_LIST: CLS_LIST,
      CLS_OPTION: CLS_OPTION,
      CLS_OPTIONNAME: CLS_OPTIONNAME,
      CLS_OPTIONCOPY: CLS_OPTIONCOPY,
      CLS_VALUE: CLS_VALUE,
      CLS_SEAT: CLS_SEAT,
      CLS_SURFACE: CLS_SURFACE,
      CLS_SEARCHROW: CLS_SEARCHROW,
      CLS_GROUPHEAD: CLS_GROUPHEAD,
      STUCK_ATTR: STUCK_ATTR,
      energyFor: energyFor,
      speedFor: speedFor,
      particleCountFor: particleCountFor,
      starCountFor: starCountFor,
      starLayerOpacityFor: starLayerOpacityFor,
      starBrightnessFor: starBrightnessFor,
      starDurationFor: starDurationFor,
      starDelayFor: starDelayFor,
      starHash01: starHash01,
      STARFIELD_DURATION_MEAN: STARFIELD_DURATION_MEAN,
      STARFIELD_DURATION_SPREAD: STARFIELD_DURATION_SPREAD,
      STARFIELD_MIN: STARFIELD_MIN,
      GOLDEN_RATIO: GOLDEN_RATIO,
      MAX_SPEED_FACTOR: MAX_SPEED_FACTOR,
      REDUCED_MOTION_SLOWDOWN: REDUCED_MOTION_SLOWDOWN,
      MIN_HEIGHT_SLOTS: MIN_HEIGHT_SLOTS,
      fillColorFor: fillColorFor,
      fillBackgroundFor: fillBackgroundFor,
      valueColorFor: valueColorFor,
      isOffLevel: isOffLevel,
      findValueElement: findValueElement,
      findSeatEffort: findSeatEffort,
      knobOffsetOf: knobOffsetOf,
      KNOB_RADIUS: KNOB_RADIUS,
      KNOB_SIZE: KNOB_SIZE,
      TRACK_HEIGHT: TRACK_HEIGHT,
      BASE_SPEEDUP: BASE_SPEEDUP,
      ENERGY_START: ENERGY_START,
      ENERGY_END: ENERGY_END,
      clamp01: clamp01,
      installStyles: installStyles,
    };

    return module.exports;
  },
});
