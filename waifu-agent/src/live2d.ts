// 验证 pixi-live2d-display 可以正常导入
// 实际模型渲染在 Day 7 之后实现
import { Live2DModel } from "pixi-live2d-display";
import * as PIXI from "pixi.js";

// 注册 Live2D 到 PIXI
// 注意：需要 Cubism SDK 运行时支持，模型文件需放在
// public/live2d-models/ 目录下
console.log("pixi-live2d-display loaded:", typeof Live2DModel);

export { Live2DModel };
export type { PIXI };
