# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 项目概述

在线斗地主游戏，TypeScript 后端 (Node.js) + 原生 JS 前端，集成 DeepSeek AI 作为电脑玩家。纯内存存储，无数据库。

## 常用命令

```
npm run dev       # 开发模式 (ts-node 直接运行)
npm run build     # tsc 编译到 dist/
npm run start     # 生产模式 (node dist/main.js)
npm run test      # 运行牌型规则测试 (无测试框架，纯断言)
```

所有命令在 `dld-server/` 目录下执行。

## 架构分层

```
engine/   → 纯函数，无副作用。card.ts (编码/洗牌), rules.ts (牌型识别/比较), hand.ts (提示)
game/     → 有状态：room.ts (房间管理), game.ts (完整游戏生命周期), state.ts (类型定义)
ai/       → AIPlayer：deepseek.ts (LLM 决策 + 算牌记忆), simple.ts (规则回退)
network/  → server.ts (HTTP+WS), client.ts (消息路由+登录), hub.ts (房间中心+AI 调度), protocol.ts (消息常量)
main.ts   → 入口，dotenv 加载，启动 Server
```

**核心规则：** `engine/` 不能修改全局状态，不能依赖外部服务。`game/` 管理状态但不处理网络。`network/` 编排两者。

## 卡片编码

`value * 10 + suit`，value: 3=3 ~ 17=大王，suit: 0=♠ 1=♥ 2=♣ 3=♦ 4=王牌。

## 通信协议

WebSocket JSON 帧，格式 `{ type, payload }`。C2S 和 S2C 消息类型定义在 `src/network/protocol.ts`。

关键安全设计：`game_start` 时服务器为每个客户端单独过滤手牌，每个玩家只收到自己的牌。底牌在地主确定后才公开。

## 前端

`public/app.js` (542行) 是唯一活跃的前端文件。`public/game.js` 是废弃的重构版本，不要修改它。前端用 `setInterval(updateView, 500)` 轮询渲染，无框架。全局 `state` 对象驱动所有视图。

## AI 系统

- `DeepSeekPlayer`：调用 DeepSeek API (`/chat/completions`)，携带完整规则系统提示 + 算牌上下文。服务器端验证决策，无效则重试一次后回退到 SimpleAI。
- `SimpleAI`：基于规则的确定性 AI，可配置激进程度。
- AI 动作统一延迟 `AI_DELAY_MS = 1500ms`，通过 `setTimeout` 调度。
- `AIMemory` 跟踪 54 张牌的出入情况，支持算牌分析。

## 部署

`deploy.ps1` 部署到 `154.8.213.134:8088`。通过 SSH + screen 管理进程。`GET /health` 返回服务器状态。
