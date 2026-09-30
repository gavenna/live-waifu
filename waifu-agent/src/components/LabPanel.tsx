import { useEffect, useRef, useState, useCallback, useMemo } from "react";
import * as PIXI from "pixi.js";
import { Live2DModel, MotionPreloadStrategy } from "pixi-live2d-display/cubism4";
import { PRESETS, DEFAULT_PERSONA } from "../persona.config";

(window as any).PIXI = PIXI;

type Tab = "motions" | "expressions" | "params" | "effects";

interface MotionInfo { group: string; index: number; name: string; duration: number; loop: boolean; }
interface ExprInfo { name: string; index: number; desc: string; }
interface ParamInfo { id: string; value: number; min: number; max: number; def: number; }

// ── Helper descriptions ──────────────────────────────

/** 把 hex 颜色转成 r,g,b (用于 rgba() 拼接) */
function hexToRgb(hex: string): string {
  const h = hex.replace("#", "");
  const r = parseInt(h.substring(0, 2), 16);
  const g = parseInt(h.substring(2, 4), 16);
  const b = parseInt(h.substring(4, 6), 16);
  return `${r},${g},${b}`;
}

const MOTION_GROUP_LABELS: Record<string, string> = {
  Idle: "待机",
  TapBody: "点击身体",
  Tap: "点击",
  PinchIn: "捏入(放大)",
  PinchOut: "拉开(缩小)",
  Shake: "摇晃",
  FlickHead: "弹头",
  TiltHead: "歪头",
  Nod: "点头",
  Angry: "生气",
  Happy: "开心",
  Sad: "悲伤",
  Surprise: "惊讶",
};

/** 不带 group 前缀的纯数字显示，例如 Idle[0]→"待机1", TapBody[2]→"胸口" */
function getMotionLabel(group: string, index: number): string {
  const key = `${group}[${index}]`;
  const known: Record<string, string> = {
    "TapBody[0]": "头部", "TapBody[1]": "左肩", "TapBody[2]": "右肩",
    "TapBody[3]": "胸口", "TapBody[4]": "腹部", "TapBody[5]": "左腿",
    "TapBody[6]": "右腿", "TapBody[7]": "左手", "TapBody[8]": "右手",
  };
  if (known[key]) return known[key];
  const groupLabel = MOTION_GROUP_LABELS[group] || group;
  return `${groupLabel}${index + 1}`;
}

/** 常用 Live2D 参数 ID → 中文说明 */
const PARAM_LABELS: Record<string, string> = {
  // ── 头部角度 ──
  ParamAngleX: "头部左右转(Yaw)",
  ParamAngleY: "头部上下转(Pitch)",
  ParamAngleZ: "头部倾斜(Roll)",
  ParamBodyAngleX: "身体左右转",
  ParamBodyAngleY: "身体前后倾",
  ParamBodyAngleZ: "身体倾斜",
  ParamBodyRotateX: "身体旋转X",
  ParamBodyRotateY: "身体旋转Y",
  ParamBodyRotateZ: "身体旋转Z",
  // ── 眼球 ──
  ParamEyeBallX: "眼球水平",
  ParamEyeBallY: "眼球垂直",
  ParamEyeBallDirectionX: "眼球方向X",
  ParamEyeBallDirectionY: "眼球方向Y",
  // ── 眼睛开闭 ──
  ParamEyeLOpen: "左眼睁开度",
  ParamEyeROpen: "右眼睁开度",
  ParamEyeLSmile: "左眼笑弯",
  ParamEyeRSmile: "右眼笑弯",
  // ── 眉毛 ──
  ParamBrowLY: "左眉高低",
  ParamBrowRY: "右眉高低",
  ParamBrowLAngle: "左眉角度",
  ParamBrowRAngle: "右眉角度",
  ParamBrowLForm: "左眉形状",
  ParamBrowRForm: "右眉形状",
  ParamBrowLDirection: "左眉方向",
  ParamBrowRDirection: "右眉方向",
  // ── 嘴巴 ──
  ParamMouthOpenY: "嘴巴张开度",
  ParamMouthForm: "口型(圆/扁)",
  ParamMouthUp: "上唇↑",
  ParamMouthDown: "下唇/下颌↓",
  ParamMouthAngry: "愤怒嘴型",
  ParamMouthAngryLine: "愤怒嘴角线",
  ParamMouthSize: "嘴大小",
  ParamMouthPosition: "嘴位置",
  ParamMouthSmile: "嘴角上扬",
  ParamMouthWidth: "嘴宽度",
  // ── 特殊口型(元音) ──
  ParamA: "元音A口型",
  ParamI: "元音I口型",
  ParamU: "元音U口型",
  ParamE: "元音E口型",
  ParamO: "元音O口型",
  // ── 鼻子 ──
  ParamNose: "鼻子位置",
  ParamNoseY: "鼻子Y",
  ParamNoseX: "鼻子X",
  // ── 头发 ──
  ParamHairFront: "前发摆动",
  ParamHairSide: "侧发摆动",
  ParamHairBack: "后发摆动",
  ParamHairFluffy: "头发蓬松",
  ParamHairShake: "头发抖动",
  ParamHairFrontFluffy: "前发蓬松",
  ParamHairSideFluffy: "侧发蓬松",
  // ── 身体/胸部 ──
  ParamBustX: "胸部左右",
  ParamBustY: "胸部上下",
  ParamBaseX: "身体水平",
  ParamBaseY: "身体垂直",
  // ── 手臂/手 ──
  ParamArmLA: "左臂A",
  ParamArmLB: "左臂B",
  ParamArmRA: "右臂A",
  ParamArmRB: "右臂B",
  ParamHandL: "左手",
  ParamHandR: "右手",
  // ── 呼吸/物理 ──
  ParamBreath: "呼吸幅度",
  ParamBreathShake: "呼吸抖动",
  // ── 脸蛋/其他 ──
  ParamCheek: "脸蛋(脸红)",
  ParamTear: "眼泪",
  ParamSweat: "汗滴",
  ParamBodyShake: "身体抖动",
  ParamBodyTremble: "身体颤抖",
};

const EXPR_DESCRIPTIONS: Record<string, string> = {
  exp_01: "中立/重置",
  exp_02: "微笑眯眼",
  exp_03: "闭眼",
  exp_04: "惊喜瞪眼",
  exp_05: "悲伤",
  exp_06: "害羞(脸红)",
  exp_07: "眩晕/心形眼",
  exp_08: "生气",
  mouth_lv0: "口型:闭",
  mouth_lv1: "口型:微张",
  mouth_lv2: "口型:半张",
  mouth_open: "口型:全张",
  _diag_mouth_up_only: "口型诊断-上唇",
  _diag_mouth_down_only: "口型诊断-下唇/下颌",
  _diag_mouth_angry: "口型诊断-愤怒嘴型",
  _diag_mouth_angryline: "口型诊断-愤怒嘴角线",
  _diag_param_a: "口型诊断-元音A",
  _diag_param_i: "口型诊断-元音I",
};

function getExprLabel(name: string): string {
  if (EXPR_DESCRIPTIONS[name]) return EXPR_DESCRIPTIONS[name];
  const lower = name.toLowerCase();
  if (/\b(neutral|reset|normal|default|exp_0[01])\b/.test(lower)) return "中立/默认";
  if (/\b(smile|grin|happy|joy|laugh|fun)\b/.test(lower)) return "开心/微笑";
  if (/\b(angry|mad|rage|furious)\b/.test(lower)) return "生气";
  if (/\b(sad|cry|tear|sorrow|grief)\b/.test(lower)) return "悲伤/哭泣";
  if (/\b(surprise|shock|amaze|wow)\b/.test(lower)) return "惊讶";
  if (/\b(blush|shy|embarrass|bashful)\b/.test(lower)) return "害羞/脸红";
  if (/\b(wink)\b/.test(lower)) return "眨眼";
  if (/\b(fear|scared|terrified|dread)\b/.test(lower)) return "恐惧";
  if (/\b(sleep|tired|yawn|sleepy)\b/.test(lower)) return "困倦/打哈欠";
  if (/\b(dizzy|stun|dazed|faint)\b/.test(lower)) return "眩晕";
  if (/\b(heart|love|affection|romance)\b/.test(lower)) return "爱心/恋爱";
  if (/\b(serious|stern|firm)\b/.test(lower)) return "认真/严肃";
  if (/\b(pain|hurt|ouch)\b/.test(lower)) return "疼痛";
  if (/\b(think|pondering|wonder)\b/.test(lower)) return "思考";
  if (/\b(disgust|yuck|gross|eww)\b/.test(lower)) return "厌恶";
  if (/\b(relief|phew|sigh)\b/.test(lower)) return "松一口气";
  if (/\b(mouth)\b/.test(lower)) return "口型变化";
  // maozu model common expression IDs
  if (/\bexp_02\b/.test(lower)) return "微笑";
  if (/\bexp_03\b/.test(lower)) return "闭眼";
  if (/\bexp_04\b/.test(lower)) return "惊喜";
  if (/\bexp_05\b/.test(lower)) return "悲伤";
  if (/\bexp_06\b/.test(lower)) return "害羞";
  if (/\bexp_07\b/.test(lower)) return "眩晕";
  if (/\bexp_08\b/.test(lower)) return "生气";
  return "";
}

// ══════════════════════════════════════════════════════

export function LabPanel() {
  const canvasRef = useRef<HTMLDivElement>(null);
  const modelRef = useRef<any>(null);
  const appRef = useRef<PIXI.Application | null>(null);
  const [tab, setTab] = useState<Tab>("motions");
  const [modelLoaded, setModelLoaded] = useState(false);

  // Motions state
  const [motions, setMotions] = useState<MotionInfo[]>([]);
  const [playingGroup, setPlayingGroup] = useState("");
  const [playingIdx, setPlayingIdx] = useState(-1);

  // Expressions state
  const [expressions, setExpressions] = useState<ExprInfo[]>([]);
  const [currentExpr, setCurrentExpr] = useState("");

  // Parameters state
  const [params, setParams] = useState<ParamInfo[]>([]);
  const [search, setSearch] = useState("");
  const [exprDiff, setExprDiff] = useState<string | null>(null);
  const exprFileRef = useRef<Map<string, any>>(new Map());
  const activeExprRef = useRef<string>("");
  const tickerFnRef = useRef<(() => void) | null>(null);

  // ── Pause auto-animation ────────────────────────────
  const [paused, setPaused] = useState(false);
  const pausedRef = useRef(false);
  pausedRef.current = paused;
  const userChangeRef = useRef(false);
  const coreModelCleanupRef = useRef<(() => void) | null>(null);
  const savedUserParamsRef = useRef<Float32Array | null>(null);

  // Auto cycle
  const [autoCycle, setAutoCycle] = useState(false);
  const autoRef = useRef(autoCycle);
  autoRef.current = autoCycle;
  const cycleIdxRef = useRef(0);

  // Preview config
  const [preview, setPreview] = useState({ w: 300, h: 400, scale: 0.10, posX: 150, posY: 200 });

  // Raw data dump
  const [rawDump, setRawDump] = useState<any>(null);
  const [showRaw, setShowRaw] = useState(false);

  // ── 特效 (shimmer) 参数 ──
  const [shimmerColor, setShimmerColor] = useState("#f1c40f");   // 高亮色
  const [shimmerPeak, setShimmerPeak] = useState(0.65);           // 峰值不透明度 0-1
  const [shimmerWidth, setShimmerWidth] = useState(40);           // 光带宽度 (梯度百分比)
  const [shimmerSpeed, setShimmerSpeed] = useState(2.0);          // 动画周期 (秒)
  const [shimmerBgSize, setShimmerBgSize] = useState(200);        // background-size %
  const [shimmerKeyStart, setShimmerKeyStart] = useState(200);    // keyframe 起始 %
  const [shimmerKeyEnd, setShimmerKeyEnd] = useState(-200);       // keyframe 终止 %
  const [shimmerTextColor, setShimmerTextColor] = useState("#dddddd"); // 文字颜色

  // ── 漂浮粒子参数 ──
  const [fpCount, setFpCount] = useState(20);
  const [fpSizeMin, setFpSizeMin] = useState(2);
  const [fpSizeMax, setFpSizeMax] = useState(5);
  const [fpOpMin, setFpOpMin] = useState(0.3);
  const [fpOpMax, setFpOpMax] = useState(0.7);
  const [fpSpeed, setFpSpeed] = useState(3.5);
  const [fpGlow, setFpGlow] = useState(8);
  const [fpColor1, setFpColor1] = useState("#f1c40f");
  const [fpColor2, setFpColor2] = useState("#f39c12");
  const [fpColor3, setFpColor3] = useState("#d4a574");

  // 稳定随机粒子数据 (仅依赖 count, 其他参数实时生效)
  const fpDots = useMemo(() => {
    const dots: { x: number; y: number; variant: number; seed: number }[] = [];
    for (let i = 0; i < fpCount; i++) {
      dots.push({
        x: 8 + Math.random() * 84,
        y: 8 + Math.random() * 84,
        variant: i % 4,
        seed: Math.random(),
      });
    }
    return dots;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fpCount]);

  // 动态粒子 CSS
  const fpCss = useMemo(() => {
    // 生成每个 variant 的 keyframes (用不同轨迹)
    const variants = [
      { name: "fp-lab-0", x1: 6, y1: -10, x2: -3, y2: -5, x3: -8, y3: 7 },
      { name: "fp-lab-1", x1: -7, y1: -6, x2: 5, y2: 10, x3: 0, y3: 0 },
      { name: "fp-lab-2", x1: 10, y1: -12, x2: -4, y2: 3, x3: 0, y3: -8 },
      { name: "fp-lab-3", x1: -9, y1: 8, x2: 6, y2: -4, x3: -2, y3: -10 },
    ];
    const keyframes = variants.map(v =>
      `@keyframes ${v.name} { 0%,100% { transform: translate(0,0); } 25% { transform: translate(${v.x1}px,${v.y1}px); } 50% { transform: translate(${v.x2}px,${v.y2}px); } 75% { transform: translate(${v.x3}px,${v.y3}px); } }`
    ).join("\n");
    const dotStyle = `.fp-lab-dot { position: absolute; border-radius: 50%; pointer-events: none; }`;
    return { keyframes, dotStyle };
  }, []);

  // 动态生成 shimmer CSS
  const shimmerCss = useMemo(() => {
    const halfW = shimmerWidth / 2;
    const c = shimmerColor;
    const peak = shimmerPeak;
    const edge = shimmerPeak * 0.5;
    const grad = `linear-gradient(90deg, rgba(${hexToRgb(c)},0) ${50 - shimmerWidth}%, rgba(${hexToRgb(c)},${edge.toFixed(2)}) ${50 - halfW}%, rgba(${hexToRgb(c)},${peak.toFixed(2)}) 50%, rgba(${hexToRgb(c)},${edge.toFixed(2)}) ${50 + halfW}%, rgba(${hexToRgb(c)},0) ${50 + shimmerWidth}%)`;
    return {
      gradient: grad,
      keyframes: `@keyframes shimmer-lab { 0% { background-position: ${shimmerKeyStart}% center; } 100% { background-position: ${shimmerKeyEnd}% center; } }`,
      style: `.shimmer-lab-text { font-size: 14px; margin-bottom: 6px; padding: 2px 16px; border-radius: 4px; color: ${shimmerTextColor}; background: ${grad}; background-size: ${shimmerBgSize}% 100%; animation: shimmer-lab ${shimmerSpeed}s linear infinite; }`,
    };
  }, [shimmerColor, shimmerPeak, shimmerWidth, shimmerSpeed, shimmerBgSize, shimmerKeyStart, shimmerKeyEnd, shimmerTextColor]);

  // ── Init PIXI + model ──────────────────────────────
  useEffect(() => {
    if (!canvasRef.current) return;
    let destroyed = false;
    let app: PIXI.Application | null = null;

    (async () => {
      const preset = PRESETS[DEFAULT_PERSONA];
      app = new PIXI.Application({ width: preview.w, height: preview.h, backgroundAlpha: 0, antialias: true });
      if (destroyed) return;
      canvasRef.current!.appendChild(app.view as unknown as HTMLElement);
      appRef.current = app;

      try {
        const model = await Live2DModel.from(preset.modelPath, { autoInteract: false, motionPreload: MotionPreloadStrategy.ALL });
        if (destroyed) return;
        (model as any).anchor.set(0.5, 0.5);
        (model as any).position.set(preview.posX, preview.posY);
        (model as any).scale.set(preview.scale);
        app.stage.addChild(model as any);
        modelRef.current = model;
        (window as any).__lab_model__ = model;
        setModelLoaded(true);

        // ── Install coreModel parameter write interceptor ──
        const core: any = model.internalModel?.coreModel;
        const im: any = model.internalModel;
        if (core && im) {
          const origSetByIndex = core.setParameterValueByIndex.bind(core);
          const origSetById = core.setParameterValueById.bind(core);
          const origAddById = core.addParameterValueById?.bind(core);
          const origAddByIndex = core.addParameterValueByIndex?.bind(core);

          // Wrap setParameterValueByIndex — all write paths converge here
          core.setParameterValueByIndex = function (index: number, value: number, weight = 1) {
            if (pausedRef.current && !userChangeRef.current) return;
            origSetByIndex(index, value, weight);
          };
          core.setParameterValueById = function (id: string, value: number, weight = 1) {
            if (pausedRef.current && !userChangeRef.current) return;
            origSetById(id, value, weight);
          };
          if (origAddById) core.addParameterValueById = function (id: string, value: number, weight = 1) {
            if (pausedRef.current && !userChangeRef.current) return;
            origAddById(id, value, weight);
          };
          if (origAddByIndex) core.addParameterValueByIndex = function (index: number, value: number, weight = 1) {
            if (pausedRef.current && !userChangeRef.current) return;
            origAddByIndex(index, value, weight);
          };

          // Event hooks: physics writes directly to Float32Array, bypassing setParam*
          // Save before any writes → restore after physics, before coreModel.update()
          const onBeforeMotionUpdate = () => {
            if (!pausedRef.current) return;
            const count = core.getParameterCount?.() || 0;
            let arr = savedUserParamsRef.current;
            if (!arr || arr.length !== count) arr = new Float32Array(count);
            savedUserParamsRef.current = arr;
            for (let i = 0; i < count; i++) arr[i] = core.getParameterValueByIndex(i);
          };
          const onBeforeModelUpdate = () => {
            if (!pausedRef.current || !savedUserParamsRef.current) return;
            const arr = savedUserParamsRef.current;
            const pv: Float32Array = core._parameterValues;
            if (pv) for (let i = 0; i < Math.min(arr.length, pv.length); i++) pv[i] = arr[i];
          };
          im.on?.("beforeMotionUpdate", onBeforeMotionUpdate);
          im.on?.("beforeModelUpdate", onBeforeModelUpdate);

          // Cleanup: restore originals + remove listeners
          coreModelCleanupRef.current = () => {
            core.setParameterValueByIndex = origSetByIndex;
            core.setParameterValueById = origSetById;
            if (origAddById) core.addParameterValueById = origAddById;
            if (origAddByIndex) core.addParameterValueByIndex = origAddByIndex;
            im.off?.("beforeMotionUpdate", onBeforeMotionUpdate);
            im.off?.("beforeModelUpdate", onBeforeModelUpdate);
          };
        }

        // Scan motions
        const mm = model.internalModel?.motionManager;
        const defs: Record<string, any[]> = (mm?.definitions || {}) as Record<string, any[]>;
        const mList: MotionInfo[] = [];
        for (const [group, list] of Object.entries(defs)) {
          for (let i = 0; i < (list?.length || 0); i++) {
            mList.push({
              group, index: i,
              name: `${group}[${i}]`,
              duration: list[i]?._duration ?? 0,
              loop: list[i]?.isLooping?.() ?? false,
            });
          }
        }
        setMotions(mList);

        // Scan expressions (Cubism 4: .model3.json defines {Name, File} refs to .exp3.json)
        const em = mm?.expressionManager;
        const expDefs: any[] = em?.definitions || (em as any)?._definitions || [];
        const baseUrl = preset.modelPath.replace(/[^/]+$/, ""); // model dir

        // Fetch .exp3.json files to get actual parameter defs (bypass runtime overwrites)
        const exprFileData: Map<string, any> = new Map();
        const expFetchPs = expDefs.map(async (e: any) => {
          const ename = e?.name || e?._name || e?.Name || "";
          const file: string = e?.File || "";
          if (!file) return;
          try {
            const url = baseUrl + file;
            const res = await fetch(url);
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const json = await res.json();
            exprFileData.set(ename, json);
          } catch (err) { console.warn("[Lab] 表达式文件加载失败:", file, err); }
        });
        await Promise.allSettled(expFetchPs);
        exprFileRef.current = exprFileData;

        const eList: ExprInfo[] = [];
        for (let i = 0; i < expDefs.length; i++) {
          const e = expDefs[i];
          const ename = e?.name || e?._name || e?.Name || `expr_${i}`;
          if (ename.startsWith("_diag_")) continue; // 旧诊断表情，弃用
          const fileJson = exprFileData.get(ename);
          const params = fileJson?.Parameters || [];
          eList.push({
            name: ename, index: i,
            desc: getExprLabel(ename) + (params.length > 0 ? ` [${params.length}参数]` : " [空]"),
          });
        }
        setExpressions(eList);

        // Also find expression-like motion groups (.exp3.json loaded as motions)
        const exprMotionGroups: string[] = [];
        for (const group of Object.keys(defs)) {
          if (/expr|expression|表情/i.test(group)) exprMotionGroups.push(group);
        }

        // Scan parameters
        const pList: ParamInfo[] = [];
        if (core) {
          const count: number = core.getParameterCount?.() || 0;
          const modelData: any = core.getModel?.();
          const ids: string[] = modelData?.parameters?.ids || [];
          for (let i = 0; i < count; i++) {
            pList.push({
              id: ids[i] || `param_${i}`,
              value: core.getParameterValueByIndex?.(i) || 0,
              min: core.getParameterMinimumValue?.(i) || 0,
              max: core.getParameterMaximumValue?.(i) || 1,
              def: core.getParameterDefaultValue?.(i) || 0,
            });
          }
        }
        setParams(pList);

        // ── Dump raw data ────────────────────────────
        const imKeys = Object.keys(model.internalModel || {})
          .filter(k => typeof (model.internalModel as any)[k] !== "function");
        const mmKeys = mm ? Object.keys(mm).filter(k => typeof (mm as any)[k] !== "function") : [];
        const dump: any = {
          internalModelKeys: imKeys,
          motionManagerKeys: mmKeys,
          motionCount: mList.length,
          motionGroups: Object.keys(defs).map(g => ({ group: g, count: defs[g]?.length || 0 })),
          exprDefsCount: eList.length,
          exprFileData: (() => {
            const out: any = {};
            exprFileData.forEach((json, name) => {
              out[name] = {
                params: (json.Parameters || []).map((p: any) => `${p.Id}=${p.Value}(${p.Blend || "Overwrite"})`),
                fadeIn: json.FadeInTime, fadeOut: json.FadeOutTime,
              };
            });
            return out;
          })(),
          exprMotionGroups,
          paramCount: pList.length,
          _rawExprDefs: JSON.parse(JSON.stringify(expDefs)),
          _rawMotionGroups: Object.keys(defs),
        };
        console.log("[Lab 模型数据]", JSON.stringify(dump, null, 2));
        setRawDump(dump);
      } catch (e) { console.error("Lab model load error:", e); }
    })();

    return () => {
      destroyed = true;
      if (coreModelCleanupRef.current) { coreModelCleanupRef.current(); coreModelCleanupRef.current = null; }
      if (tickerFnRef.current) { try { PIXI.Ticker.shared.remove(tickerFnRef.current); } catch (_) {} tickerFnRef.current = null; }
      if (app) app.destroy(true);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Apply preview config ──────────────────────────
  const applyPreview = useCallback((p: typeof preview) => {
    const app = appRef.current;
    const model = modelRef.current;
    if (app) app.renderer.resize(p.w, p.h);
    if (model) {
      model.position.set(p.posX, p.posY);
      model.scale.set(p.scale);
    }
  }, []);

  const updatePreview = useCallback((field: string, value: number) => {
    setPreview((prev) => {
      const next = { ...prev, [field]: value };
      applyPreview(next);
      return next;
    });
  }, [applyPreview]);

  // ── Auto cycle motions/expressions ─────────────────
  useEffect(() => {
    if (!autoCycle || motions.length === 0 || paused) return;
    const timer = setInterval(() => {
      const m = motions[cycleIdxRef.current % motions.length];
      modelRef.current?.motion(m.group, m.index, 3).catch(() => {});
      setPlayingGroup(m.group); setPlayingIdx(m.index);
      cycleIdxRef.current++;
    }, 3000);
    return () => clearInterval(timer);
  }, [autoCycle, motions, paused]);

  // ── Refresh parameter values ───────────────────────
  const refreshParams = useCallback(() => {
    const core = modelRef.current?.internalModel?.coreModel;
    if (!core) return;
    setParams((prev) => prev.map((p, i) => ({
      ...p, value: core.getParameterValueByIndex?.(i) || 0,
    })));
  }, []);

  useEffect(() => {
    if (tab !== "params") return;
    const timer = setInterval(refreshParams, 200);
    return () => clearInterval(timer);
  }, [tab, refreshParams]);

  // ── Motions tab ────────────────────────────────────
  const motionGroups = useMemo(() => {
    const map = new Map<string, MotionInfo[]>();
    for (const m of motions) {
      if (!map.has(m.group)) map.set(m.group, []);
      map.get(m.group)!.push(m);
    }
    return [...map.entries()];
  }, [motions]);

  const playMotion = useCallback((group: string, index: number) => {
    modelRef.current?.motion(group, index, 3).catch(() => {});
    setPlayingGroup(group); setPlayingIdx(index);
  }, []);

  const stopMotion = useCallback(() => {
    modelRef.current?.internalModel?.motionManager?.stopAllMotions();
    setPlayingGroup(""); setPlayingIdx(-1);
  }, []);

  const togglePause = useCallback(() => {
    setPaused((prev) => {
      if (prev) return false;
      // 暂停时清掉正在播放的动作和 ticker 表情
      modelRef.current?.internalModel?.motionManager?.stopAllMotions();
      setPlayingGroup(""); setPlayingIdx(-1);
      if (tickerFnRef.current) {
        try { PIXI.Ticker.shared.remove(tickerFnRef.current); } catch (_) {}
        try { appRef.current?.ticker.remove(tickerFnRef.current); } catch (_) {}
        tickerFnRef.current = null;
      }
      activeExprRef.current = "";
      return true;
    });
  }, []);

  // ── Expressions tab ─────────────────────────────────
  const applyExpression = useCallback((e: ExprInfo) => {
    const model = modelRef.current;
    if (!model) return;
    const log = (...args: any[]) => console.log("[Lab表情]", ...args);

    // 先停动作
    model.internalModel?.motionManager?.stopAllMotions();
    setPlayingGroup(""); setPlayingIdx(-1);

    // 清理旧的 ticker 回调
    if (tickerFnRef.current) {
      try { PIXI.Ticker.shared.remove(tickerFnRef.current); } catch (_) {}
      try { appRef.current?.ticker.remove(tickerFnRef.current); } catch (_) {}
      tickerFnRef.current = null;
    }
    activeExprRef.current = e.name;

    // 从 fetch 的 .exp3.json 中获取参数定义
    const fileJson = exprFileRef.current.get(e.name);
    const fileParams: any[] = fileJson?.Parameters || [];
    log("表达式:", e.name, "参数:", fileParams.map((p: any) => `${p.Id}=${p.Value}(${p.Blend})`).join(", "));

    if (pausedRef.current) {
      // 暂停模式：直接设参数，不会被动画覆盖（动画写已拦截）
      const core = model.internalModel?.coreModel;
      if (core && fileParams.length > 0) {
        userChangeRef.current = true;
        try {
          for (const p of fileParams) {
            core.setParameterValueById?.(p.Id, p.Value, 1);
          }
        } finally { userChangeRef.current = false; }
      }
    } else {
      // 非暂停：启动 ticker 每帧重放对抗动画
      tickerFnRef.current = () => {
        const m = modelRef.current;
        if (!m || activeExprRef.current !== e.name) return;
        try { m.expression(e.name)?.catch(() => {}); } catch (_) {}
      };
      try { PIXI.Ticker.shared.add(tickerFnRef.current, undefined, -50); } catch (_) {}
      try { appRef.current?.ticker.add(tickerFnRef.current, undefined, -50); } catch (_) {}
      try { model.expression(e.name)?.catch(() => {}); } catch (_) {}
    }

    setExprDiff(fileParams.length > 0
      ? `.exp3.json 参数 (${fileParams.length}个${paused ? ", 暂停模式-直接应用" : ", 每帧持续应用"}):\n${fileParams.map((p: any) => `  ${p.Id}=${p.Value} (${p.Blend || "Overwrite"})`).join("\n")}`
      : "此表达式的 .exp3.json 文件不包含参数定义");

    setCurrentExpr(e.name);
  }, []);

  const resetExpression = useCallback(() => {
    const model = modelRef.current;
    if (!model) return;

    // 停止 ticker 重放
    if (tickerFnRef.current) {
      try { PIXI.Ticker.shared.remove(tickerFnRef.current); } catch (_) {}
      try { appRef.current?.ticker.remove(tickerFnRef.current); } catch (_) {}
      tickerFnRef.current = null;
    }
    activeExprRef.current = "";

    model.internalModel?.motionManager?.stopAllMotions();
    setPlayingGroup(""); setPlayingIdx(-1);
    const em = model.internalModel?.motionManager?.expressionManager;
    try { em?.resetExpression?.(); } catch (_) {}
    try { model.expression("exp_01")?.catch(() => {}); } catch (_) {}
    const core = model.internalModel?.coreModel;
    if (core) {
      const count = core.getParameterCount?.() || 0;
      userChangeRef.current = true;
      try {
        for (let i = 0; i < count; i++) {
          const def = core.getParameterDefaultValue?.(i) || 0;
          try { core.setParameterValueByIndex?.(i, def, 1); } catch (_) {}
        }
      } finally { userChangeRef.current = false; }
    }
    setExprDiff(null);
    setCurrentExpr("");
  }, []);

  // ── Parameters tab ─────────────────────────────────
  const setParamValue = useCallback((index: number, value: number) => {
    const core = modelRef.current?.internalModel?.coreModel;
    if (!core) return;
    userChangeRef.current = true;
    try { core.setParameterValueByIndex?.(index, value, 1); }
    finally { userChangeRef.current = false; }
    setParams((prev) => prev.map((p, i) => i === index ? { ...p, value } : p));
  }, []);

  const resetAllParams = useCallback(() => {
    const core = modelRef.current?.internalModel?.coreModel;
    if (!core) return;
    const count = core.getParameterCount?.() || 0;
    userChangeRef.current = true;
    try {
      for (let i = 0; i < count; i++) {
        const def = core.getParameterDefaultValue?.(i) || 0;
        core.setParameterValueByIndex?.(i, def, 1);
      }
    } finally { userChangeRef.current = false; }
    refreshParams();
  }, [refreshParams]);

  const filteredParams = useMemo(() => {
    if (!search) return params;
    const q = search.toLowerCase();
    return params.filter((p) => p.id.toLowerCase().includes(q));
  }, [params, search]);

  // ── Render ─────────────────────────────────────────
  return (
    <div style={rootStyle}>
      {/* Tabs */}
      <div style={tabBarStyle}>
        {(["motions", "expressions", "params", "effects"] as Tab[]).map((t) => (
          <button key={t} onClick={() => setTab(t)}
            style={{ ...tabBtnStyle, background: tab === t ? "#4a6cf7" : "rgba(255,255,255,0.06)", color: tab === t ? "#fff" : "#888" }}
          >{t === "motions" ? "🎬 动作" : t === "expressions" ? "🎭 表情" : t === "params" ? "🎛 参数" : "✨ 特效"}</button>
        ))}
        <button onClick={togglePause}
          disabled={!modelLoaded}
          style={{
            ...tabBtnStyle,
            marginLeft: "auto",
            background: paused ? "#ef4444" : "rgba(34,197,94,0.15)",
            color: paused ? "#fff" : "#4ade80",
            fontWeight: 600,
            opacity: modelLoaded ? 1 : 0.4,
            cursor: modelLoaded ? "pointer" : "not-allowed",
          }}
          title={paused ? "恢复自动动画(物理/呼吸/眨眼等)" : "暂停自动动画 — 手动调节参数不会被覆盖"}
        >{paused ? "⏸ 已暂停" : "▶ 动画中"}</button>
        <span style={{ fontSize: 10, color: "#555" }}>
          {motions.length} 动作 / {expressions.length} 表情 / {params.length} 参数
        </span>
      </div>

      {/* Content */}
      <div style={contentStyle}>
        {/* ═══ Motions ═══ */}
        {tab === "motions" && (
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <div style={{ display: "flex", gap: 6, alignItems: "center", marginBottom: 4 }}>
              <button onClick={() => setAutoCycle(!autoCycle)}
                style={{ ...actionBtn, background: autoCycle ? "#22c55e" : "rgba(255,255,255,0.08)" }}
              >{autoCycle ? "⏸ 停止循环" : "▶ 自动循环 (3s)"}</button>
              <button onClick={stopMotion} style={actionBtn}>⏹ 停止</button>
              {playingGroup && <span style={{ fontSize: 10, color: "#22d3ee" }}>▶ {getMotionLabel(playingGroup, playingIdx)}</span>}
            </div>
            {motionGroups.map(([group, list]) => (
              <div key={group}>
                <div style={{ fontSize: 11, color: "#aaa", fontWeight: 600, marginBottom: 2 }}>{MOTION_GROUP_LABELS[group] || group} · {group} ({list.length})</div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
                  {list.map((m) => (
                    <button key={`${m.group}-${m.index}`} onClick={() => playMotion(m.group, m.index)}
                      style={{
                        ...motionBtn,
                        background: playingGroup === m.group && playingIdx === m.index ? "rgba(74,108,247,0.3)" : "rgba(255,255,255,0.06)",
                        borderColor: playingGroup === m.group && playingIdx === m.index ? "#4a6cf7" : "rgba(255,255,255,0.1)",
                      }}
                    >
                      <div style={{ fontSize: 12 }}>{getMotionLabel(m.group, m.index)}</div>
                      <div style={{ fontSize: 9, color: "#666" }}>{m.duration.toFixed(1)}s {m.loop ? "⟳" : ""}</div>
                      <div style={{ fontSize: 8, color: "#555" }}>#{m.index}</div>
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}

        {/* ═══ Expressions ═══ */}
        {tab === "expressions" && (
          <div>
            <div style={{ display: "flex", gap: 6, marginBottom: 6, alignItems: "center", flexWrap: "wrap" }}>
              <span style={{ fontSize: 10, color: "#888" }}>
                表达式定义: {expressions.length} 个
                {rawDump?.exprMotionGroups?.length > 0 && ` + 动作表情组: ${rawDump.exprMotionGroups.join(", ")}`}
              </span>
              <button onClick={() => setShowRaw(!showRaw)}
                style={{ ...actionBtn, background: showRaw ? "#4a6cf7" : "rgba(255,255,255,0.08)", fontSize: 10 }}
              >📋 {showRaw ? "隐藏" : "显示"}原始数据</button>
              <button onClick={resetExpression} style={actionBtn}>↺ 重置</button>
              {currentExpr && <span style={{ fontSize: 10, color: "#ec4899" }}>当前: {currentExpr} {getExprLabel(currentExpr) && `(${getExprLabel(currentExpr)})`}</span>}
            </div>

            {/* Raw data dump */}
            {showRaw && rawDump && (
              <div style={{ marginBottom: 8, padding: 8, background: "rgba(0,0,0,0.5)", borderRadius: 6, border: "1px solid rgba(255,255,255,0.08)", maxHeight: 300, overflow: "auto" }}>
                <div style={{ fontSize: 10, color: "#aaa", marginBottom: 4, fontWeight: 600 }}>
                  结构: internalModel → {rawDump.internalModelKeys?.join(", ")}
                </div>
                <div style={{ fontSize: 10, color: "#888", marginBottom: 4 }}>
                  motionManager → {rawDump.motionManagerKeys?.join(", ")}
                </div>
                <div style={{ fontSize: 10, color: "#888", marginBottom: 6 }}>
                  动作组 ({rawDump.motionGroups?.length}): {rawDump._rawMotionGroups?.join(", ")}
                  {rawDump.exprMotionGroups?.length > 0 && <span style={{ color: "#ec4899" }}> | 含表情关键词: {rawDump.exprMotionGroups.join(", ")}</span>}
                </div>
                <div style={{ fontSize: 10, color: "#aaa", marginBottom: 4, fontWeight: 600 }}>
                  有效表达式 ({rawDump.exprDefsCount} 个, _diag_* 已弃用已过滤)
                </div>
                <div style={{ fontSize: 10, color: "#aaa", marginBottom: 4 }}>
                  表达式文件参数 (从 .exp3.json 直接读取，不经过运行时):
                </div>
                {rawDump.exprFileData && Object.entries(rawDump.exprFileData as Record<string, any>).map(([name, data]: [string, any]) => (
                  <div key={name} style={{ fontSize: 9, color: "#8b8", marginBottom: 2 }}>
                    <span style={{ color: "#4ade80" }}>{name}</span>
                    {data.params.length > 0
                      ? <> → {data.params.map((p: string) => <span key={p} style={{ color: "#fbbf24" }}>[{p}]</span>)}</>
                      : <span style={{ color: "#ef4444" }}> → (无参数! 文件可能为空或格式不对)</span>}
                  </div>
                ))}
                {rawDump.exprDefsCount > 0 && (
                  <div style={{ marginTop: 6 }}>
                    <div style={{ fontSize: 9, color: "#666", marginBottom: 2 }}>原始 JSON:</div>
                    <pre style={{ fontSize: 8, color: "#555", margin: 0, whiteSpace: "pre-wrap", wordBreak: "break-all" }}>
                      {JSON.stringify(rawDump._rawExprDefs, null, 2)}
                    </pre>
                  </div>
                )}
              </div>
            )}

            {/* Expression buttons */}
            {expressions.length === 0 && (
              <div style={{ color: "#666", fontSize: 11, marginBottom: 8 }}>
                ⚠ 模型的 expressionManager 没有表达式定义。请点"📋 显示原始数据"查看详情，或尝试在动作标签中查找表情类动作组。
              </div>
            )}
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
              {expressions.map((e) => (
                <button key={e.name} onClick={() => applyExpression(e)}
                  style={{
                    ...exprBtn,
                    background: currentExpr === e.name ? "rgba(236,72,153,0.25)" : "rgba(255,255,255,0.05)",
                    borderColor: currentExpr === e.name ? "#ec4899" : "rgba(255,255,255,0.1)",
                  }}
                >
                  <div style={{ fontSize: 12, fontWeight: 600 }}>{e.desc || e.name}</div>
                  <div style={{ fontSize: 9, color: "#555" }}>{e.name}</div>
                </button>
              ))}
            </div>

            {/* Expression diff */}
            {exprDiff && (
              <div style={{ marginTop: 10, padding: 8, background: "rgba(0,255,0,0.05)", borderRadius: 6, border: "1px solid rgba(0,255,0,0.12)" }}>
                <div style={{ fontSize: 10, color: "#4ade80", fontWeight: 600, marginBottom: 4 }}>表达式参数定义 (来自 .exp3.json 文件)</div>
                <pre style={{ fontSize: 9, color: "#8b8", margin: 0, whiteSpace: "pre-wrap", wordBreak: "break-all" }}>{exprDiff}</pre>
              </div>
            )}
          </div>
        )}

        {/* ═══ Parameters ═══ */}
        {tab === "params" && (
          <div>
            <div style={{ marginBottom: 6, padding: 4, background: paused ? "rgba(251,191,36,0.08)" : "rgba(255,255,255,0.03)", borderRadius: 4 }}>
              <span style={{ fontSize: 9, color: paused ? "#fbbf24" : "#888" }}>
                {paused
                  ? "⏸ 暂停模式：自动动画已冻结。滑条不会被弹回，可直接手动调参。表情标签页中点击表情会直接应用参数值。"
                  : "💡 参数由物理引擎/呼吸/口型同步实时驱动，手动拖动会被覆盖。请使用顶栏「⏸ 暂停动画」按钮暂停后手动调参。"}
              </span>
            </div>
            <div style={{ display: "flex", gap: 6, marginBottom: 6 }}>
              <input placeholder="搜索参数..." value={search} onChange={(e) => setSearch(e.target.value)}
                style={searchInput} />
              <button onClick={resetAllParams} style={actionBtn}>↺ 重置全部</button>
              <span style={{ fontSize: 10, color: "#555", alignSelf: "center" }}>
                共 {params.length}，显示 {filteredParams.length}
              </span>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
              {filteredParams.map((p) => (
                <div key={p.id} style={paramRow}>
                  <span style={{ fontSize: 10, color: "#aaa", width: 160, flexShrink: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={p.id}>{p.id}</span>
                  <span style={{ fontSize: 9, color: "#8b8", width: 110, flexShrink: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={PARAM_LABELS[p.id] || ""}>{PARAM_LABELS[p.id] || ""}</span>
                  <input type="range" min={p.min} max={p.max} step={(p.max - p.min) / 100}
                    value={p.value} onChange={(e) => setParamValue(params.indexOf(p), parseFloat(e.target.value))}
                    style={{ flex: 1, maxWidth: 200, accentColor: "#4a6cf7", margin: "0 4px" }} />
                  <input type="number" value={p.value} min={p.min} max={p.max} step={0.01}
                    onChange={(e) => setParamValue(params.indexOf(p), parseFloat(e.target.value) || 0)}
                    style={numInput} />
                  <button onClick={() => setParamValue(params.indexOf(p), p.def)}
                    style={resetBtn} title="重置默认值">↺</button>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ═══ Effects / Shimmer ═══ */}
        {tab === "effects" && (
          <div>
            {/* 动态注入 shimmer CSS */}
            <style>{shimmerCss.keyframes}</style>
            <style>{shimmerCss.style}</style>

            {/* ── 预览区：致谢画面整体 (shimmer + 漂浮粒子) ── */}
            <style>{fpCss.keyframes}</style>
            <style>{fpCss.dotStyle}</style>
            <div style={{
              position: "relative", marginBottom: 16, padding: 20,
              background: "#0a0a0f", borderRadius: 8,
              border: "1px solid rgba(255,255,255,0.08)", textAlign: "center",
              overflow: "hidden", minHeight: 220,
            }}>
              {/* 漂浮粒子背景 */}
              {fpDots.map((dot, i) => {
                const colors = [fpColor1, fpColor2, fpColor3];
                const color = colors[i % 3];
                const animNames = ["fp-lab-0", "fp-lab-1", "fp-lab-2", "fp-lab-3"];
                const size = fpSizeMin + dot.seed * (fpSizeMax - fpSizeMin);
                const opacity = fpOpMin + (1 - dot.seed) * (fpOpMax - fpOpMin);
                return (
                  <div
                    key={i}
                    className="fp-lab-dot"
                    style={{
                      left: `${dot.x}%`,
                      top: `${dot.y}%`,
                      width: size,
                      height: size,
                      background: color,
                      opacity,
                      boxShadow: `0 0 ${fpGlow * (0.5 + dot.seed * 0.5)}px ${color}`,
                      animation: `${animNames[dot.variant]} ${fpSpeed * (0.6 + dot.seed * 0.8)}s ease-in-out infinite`,
                      animationDelay: `${dot.seed * 3}s`,
                    } as React.CSSProperties}
                  />
                );
              })}
              {/* 致谢文字 (z-index 在粒子上层) */}
              <div style={{ position: "relative", zIndex: 1 }}>
                <div style={{ fontSize: 18, fontWeight: 600, color: "#f1c40f", marginBottom: 20, letterSpacing: 4 }}>
                  ★ 感谢每一位赞助者 ★
                </div>
                {["赞助者A", "赞助者B", "赞助者C", "赞助者D"].map((name, i) => (
                  <div key={i} className="shimmer-lab-text">
                    {name}
                    <span style={{ fontSize: 11, opacity: 0.55, marginLeft: 12 }}>支持者</span>
                  </div>
                ))}
                <div style={{ marginTop: 12, fontSize: 13, color: "#555", letterSpacing: 2 }}>
                  —— 虚位以待 ——
                </div>
              </div>
            </div>

            {/* 参数滑块 */}
            <div style={effectsGridStyle}>
              <FxSlider label="高亮色" value={shimmerColor} onChange={setShimmerColor} type="color" />
              <FxSlider label="文字色" value={shimmerTextColor} onChange={setShimmerTextColor} type="color" />
              <FxSlider label="峰值亮度" value={shimmerPeak} onChange={setShimmerPeak} min={0} max={1} step={0.05} />
              <FxSlider label="光带宽度" value={shimmerWidth} onChange={setShimmerWidth} min={5} max={50} step={1} unit="%" />
              <FxSlider label="动画速度" value={shimmerSpeed} onChange={setShimmerSpeed} min={0.5} max={5} step={0.1} unit="s" />
              <FxSlider label="背景宽度" value={shimmerBgSize} onChange={setShimmerBgSize} min={100} max={500} step={10} unit="%" />
              <FxSlider label="起始位置" value={shimmerKeyStart} onChange={setShimmerKeyStart} min={100} max={500} step={10} unit="%" />
              <FxSlider label="终止位置" value={shimmerKeyEnd} onChange={setShimmerKeyEnd} min={-500} max={0} step={10} unit="%" />
            </div>

            {/* 生成的 CSS 代码 */}
            <div style={{ marginTop: 12, padding: 10, background: "rgba(0,0,0,0.5)", borderRadius: 6, border: "1px solid rgba(255,255,255,0.06)" }}>
              <div style={{ fontSize: 10, color: "#888", marginBottom: 6 }}>当前 CSS (可复制到 StartupSequence)</div>
              <pre style={{ fontSize: 9, color: "#aaa", margin: 0, whiteSpace: "pre-wrap", wordBreak: "break-all" }}>
{`.shimmer-row {
  color: ${shimmerTextColor};
  background: ${shimmerCss.gradient};
  background-size: ${shimmerBgSize}% 100%;
  animation: shimmer ${shimmerSpeed}s linear infinite;
}
@keyframes shimmer {
  0% { background-position: ${shimmerKeyStart}% center; }
  100% { background-position: ${shimmerKeyEnd}% center; }
}`}
              </pre>
            </div>

            {/* ── 漂浮粒子参数 ── */}
            <div style={{ marginTop: 16, paddingTop: 16, borderTop: "1px solid rgba(255,255,255,0.06)" }}>
              <div style={{ fontSize: 11, color: "#888", fontWeight: 600, marginBottom: 10 }}>✦ 背景漂浮粒子</div>
              <div style={effectsGridStyle}>
                <FxSlider label="粒子数量" value={fpCount} onChange={setFpCount} min={5} max={40} step={1} />
                <FxSlider label="漂浮速度" value={fpSpeed} onChange={setFpSpeed} min={1} max={8} step={0.5} unit="s" />
                <FxSlider label="最小尺寸" value={fpSizeMin} onChange={setFpSizeMin} min={1} max={8} step={0.5} unit="px" />
                <FxSlider label="最大尺寸" value={fpSizeMax} onChange={setFpSizeMax} min={2} max={12} step={0.5} unit="px" />
                <FxSlider label="最小透明度" value={fpOpMin} onChange={setFpOpMin} min={0.05} max={1} step={0.05} />
                <FxSlider label="最大透明度" value={fpOpMax} onChange={setFpOpMax} min={0.1} max={1} step={0.05} />
                <FxSlider label="发光扩散" value={fpGlow} onChange={setFpGlow} min={0} max={20} step={0.5} unit="px" />
              </div>
              <div style={{ ...effectsGridStyle, marginTop: 4 }}>
                <FxSlider label="颜色 1" value={fpColor1} onChange={setFpColor1} type="color" />
                <FxSlider label="颜色 2" value={fpColor2} onChange={setFpColor2} type="color" />
                <FxSlider label="颜色 3" value={fpColor3} onChange={setFpColor3} type="color" />
              </div>
            </div>
          </div>
        )}

      </div>

      {/* Canvas preview */}
      <div style={previewStyle}>
        {/* Preview controls */}
        <div style={previewCtrlStyle}>
          <div style={{ fontSize: 10, color: "#666", fontWeight: 600, marginBottom: 3 }}>预览参数</div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 3 }}>
            <PreviewNum label="画布W" value={preview.w} onChange={(v) => updatePreview("w", v)} min={100} max={800} step={10} />
            <PreviewNum label="画布H" value={preview.h} onChange={(v) => updatePreview("h", v)} min={100} max={800} step={10} />
            <PreviewNum label="缩放" value={preview.scale} onChange={(v) => updatePreview("scale", v)} min={0.01} max={0.5} step={0.01} />
            <PreviewNum label="X" value={preview.posX} onChange={(v) => updatePreview("posX", v)} min={0} max={800} step={10} />
            <PreviewNum label="Y" value={preview.posY} onChange={(v) => updatePreview("posY", v)} min={0} max={800} step={10} />
          </div>
        </div>
        <div ref={canvasRef} style={{ width: preview.w, height: preview.h }} />
        {!modelLoaded && <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", color: "#666", fontSize: 11 }}>加载中...</div>}
      </div>
    </div>
  );
}

// Preview number input helper
function PreviewNum({ label, value, onChange, min, max, step }: { label: string; value: number; onChange: (v: number) => void; min: number; max: number; step: number }) {
  return (
    <label style={{ display: "flex", alignItems: "center", gap: 1, fontSize: 9 }}>
      <span style={{ color: "#888" }}>{label}</span>
      <input type="number" value={value} onChange={(e) => onChange(parseFloat(e.target.value) || 0)} min={min} max={max} step={step}
        style={{ width: 48, background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 3, padding: "1px 3px", color: "#ccc", fontSize: 9, outline: "none" }} />
    </label>
  );
}

// Effects slider helper — color picker or range slider
function FxSlider({ label, value, onChange, min, max, step, unit, type }: {
  label: string;
  value: number | string;
  onChange: (v: any) => void;
  min?: number;
  max?: number;
  step?: number;
  unit?: string;
  type?: "color";
}) {
  return (
    <label style={{ display: "flex", flexDirection: "column", gap: 2, fontSize: 10 }}>
      <span style={{ color: "#888" }}>{label}{unit ? ` (${unit})` : ""}: <span style={{ color: "#f1c40f" }}>{typeof value === "number" ? value.toFixed(2) : value}</span></span>
      {type === "color" ? (
        <input type="color" value={value as string} onChange={(e) => onChange(e.target.value)}
          style={{ width: "100%", height: 24, border: "none", borderRadius: 4, cursor: "pointer", background: "transparent" }} />
      ) : (
        <input type="range" min={min} max={max} step={step} value={value as number}
          onChange={(e) => onChange(parseFloat(e.target.value))}
          style={{ width: "100%", accentColor: "#4a6cf7" }} />
      )}
    </label>
  );
}

// ── Styles ──────────────────────────────────────────

const rootStyle: React.CSSProperties = {
  width: "100vw", height: "100vh", display: "flex", overflow: "hidden",
};

const previewCtrlStyle: React.CSSProperties = {
  position: "absolute", top: 4, left: 4, right: 4, zIndex: 5,
  background: "rgba(0,0,0,0.85)", borderRadius: 6,
  padding: "4px 8px",
};

const previewStyle: React.CSSProperties = {
  width: 340, flexShrink: 0,
  display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
  borderLeft: "1px solid rgba(255,255,255,0.06)",
  background: "rgba(0,0,0,0.3)", position: "relative",
  paddingTop: 40,
};

const tabBarStyle: React.CSSProperties = {
  position: "absolute", top: 0, left: 0, right: 340,
  display: "flex", gap: 4, padding: "6px 10px",
  borderBottom: "1px solid rgba(255,255,255,0.06)",
  background: "rgba(0,0,0,0.4)", zIndex: 10, alignItems: "center",
};

const contentStyle: React.CSSProperties = {
  flex: 1, overflow: "auto", padding: "50px 10px 10px 10px",
  marginRight: 340,
};

const tabBtnStyle: React.CSSProperties = {
  border: "none", borderRadius: 6, padding: "5px 14px",
  fontSize: 12, cursor: "pointer", fontWeight: 600,
};

const motionBtn: React.CSSProperties = {
  border: "1px solid", borderRadius: 6, padding: "6px 10px",
  color: "#ddd", fontSize: 12, cursor: "pointer", minWidth: 56, textAlign: "center",
  background: "rgba(255,255,255,0.05)",
};

const exprBtn: React.CSSProperties = {
  border: "1px solid", borderRadius: 8, padding: "8px 14px",
  color: "#ddd", cursor: "pointer", minWidth: 80, textAlign: "center",
};

const actionBtn: React.CSSProperties = {
  border: "1px solid rgba(255,255,255,0.12)", borderRadius: 6,
  padding: "4px 12px", fontSize: 11, color: "#ccc", cursor: "pointer",
  background: "rgba(255,255,255,0.08)",
};

const searchInput: React.CSSProperties = {
  background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.1)",
  borderRadius: 6, padding: "4px 8px", color: "#ddd", fontSize: 11, outline: "none",
  width: 160,
};

const paramRow: React.CSSProperties = {
  display: "flex", alignItems: "center", gap: 2,
  padding: "2px 4px", borderRadius: 4,
};
const numInput: React.CSSProperties = {
  width: 52, background: "rgba(255,255,255,0.06)",
  border: "1px solid rgba(255,255,255,0.1)", borderRadius: 4,
  padding: "1px 3px", color: "#ddd", fontSize: 9, outline: "none",
  textAlign: "center",
};
const resetBtn: React.CSSProperties = {
  width: 20, height: 20, borderRadius: 4, border: "none",
  background: "rgba(255,255,255,0.06)", color: "#888", fontSize: 9,
  cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center",
};

const effectsGridStyle: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "1fr 1fr",
  gap: "8px 16px",
};
