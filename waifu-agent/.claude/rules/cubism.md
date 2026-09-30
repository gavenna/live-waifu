---
description: Cubism 4 运行时架构、每帧更新管线、关键陷阱。修改 Live2D 模型/动作/表情时加载。
paths:
  - "**/App.tsx"
  - "**/LabPanel.tsx"
  - "**/DiagPanel.tsx"
  - "**/persona.config.ts"
---

# Cubism 4 运行时架构 (pixi-live2d-display)

> **源码位置**: `node_modules/pixi-live2d-display/dist/cubism4.es.js`
> **类型定义**: `node_modules/pixi-live2d-display/types/index.d.ts`

## 每帧更新管线 (12 步)

`Cubism4InternalModel.update()` 按以下顺序执行，**顺序不能改变**：

```
 1. emit("beforeMotionUpdate")       → 可订阅，在此保存当前参数
 2. motionManager.update()           → 动作设参，走 setParameterValueByIndex
 3. coreModel.saveParameters()       → 快照当前参数到 _savedParameters
 4. expressionManager.update()       → 表情设参
 5. eyeBlink?.updateParameters()     → 自动眨眼
 6. updateFocus()                    → 焦点跟踪，走 addParameterValueById
 7. updateNaturalMovements()         → 呼吸动画 (breath)，走 addParameterValueById
 8. physics.evaluate()               → ⚠️ 直写 Float32Array，绕过 setParameterValueByIndex！
 9. pose?.updateParameters()         → 姿态更新，走 setParameterValueByIndex
10. emit("beforeModelUpdate")        → 可订阅，在此恢复被物理覆盖的值
11. coreModel.update()               → 用 _parameterValues 计算最终顶点
12. coreModel.loadParameters()       → 从 _savedParameters 恢复
```

## 关键陷阱

- **禁止替换 `internalModel` 的属性为 boolean**（如 `internalModel.lipSync = false`）。这些属性是对象实例，update 循环会调用其方法，替换为 primitive 会导致 TypeError 崩溃整个 PIXI renderer。
- **替换 `model.update` 无效**：pixi-live2d-display 注册的是绑定的函数引用，事后替换实例方法不影响已注册的 listener。
- **物理引擎不走函数调用**：`CubismPhysics.evaluate()` 修改 `_model.parameters.values`（与 `_parameterValues` 是同一个 Float32Array），不经过 `setParameterValueByIndex`。要拦截物理写入，必须在步骤 10（beforeModelUpdate）之后恢复值。
- **`_parameterValues` === `_model.parameters.values`**：同一个 Float32Array，写一处即生效。
- **所有其他系统最终都走 `setParameterValueByIndex`**：动作、表情、眨眼、焦点、呼吸、姿态——全部调用 `coreModel.setParameterValueByIndex()`。拦截这个方法就能阻断除物理外的所有自动动画。

## 安全挂起自动动画的方法

既要在代码中临时冻结参数（如实验室调试），又要保证渲染不中断：

1. 包装 `coreModel.setParameterValueByIndex/setParameterValueById`，用 ref flag 区分用户调用和自动动画调用
2. 订阅 `beforeMotionUpdate` 保存 `_parameterValues` 快照
3. 订阅 `beforeModelUpdate` 把快照写回 `_parameterValues`，覆盖物理引擎的输出
4. `coreModel.update()` (步骤 11) 用恢复后的值渲染 → 画面正常，参数冻结

**不要在修改 `coreModel` 方法后忘记恢复**，否则组件卸载时遗留的包装函数持有过期闭包引用。

## 表达式 (.exp3.json)

- 定义在 `.model3.json` 里：`{Name, File}` 引用外部文件
- 从 JS 读取参数需通过 `fetch()` 获得文件内容 `→ json.Parameters[]`
- `model.expression(name)` 会异步加载 .exp3.json 并应用
- 属性名是 `Name` 和 `File`（大写），不是 `name`/`file`
- `pixi-live2d-display` 的 ExpressionManager 可能在文件存在时仍报 "Failed to load" — 检查文件格式是否符合 Cubism 4 规范
