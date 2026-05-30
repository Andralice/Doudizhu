# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 项目概述

在线斗地主游戏，TypeScript 后端 (Node.js) + 原生 JS 前端，集成 DeepSeek AI 作为电脑玩家。JSON 文件存储账户数据，无数据库。

## 常用命令

```bash
cd dld-server
npm run dev       # 开发模式 (ts-node)
npm run build     # tsc 编译到 dist/
npm run start     # 生产模式
npm run test      # 牌型规则测试 (42 个断言)
```

部署：`.\deploy.ps1` → 编译 + scp 上传 + screen 重启，目标 `154.8.213.134:8088`。

## 架构分层

```
engine/   → 纯函数，无副作用。card.ts (编码/洗牌), rules.ts (牌型识别/比较), hand.ts (提示)
game/     → 有状态：room.ts (房间管理), game.ts (完整生命周期+状态机), state.ts (类型/枚举)
store/    → accounts.ts (JSON 文件账户存储: 注册/登录/战绩)
ai/       → deepseek.ts (LLM 决策+算牌记忆), simple.ts (规则 AI), index.ts (类型+工厂)
network/  → server.ts (HTTP+WS+静态文件), client.ts (消息路由+登录), hub.ts (房间+AI调度), protocol.ts
main.ts   → 入口，dotenv 加载，启动 Server
```

## 游戏状态机

```
Waiting → Bidding (叫地主) → Grabbing (抢地主) → Doubling (加倍) → Playing (出牌) → Finished
```

- 叫地主：3 人轮流，可叫 0/1/2/3 分，3 分立即结束，无叫者重发
- 抢地主：2 农民各一次机会，抢则底分翻倍+地主转移
- 加倍：从地主开始轮流选择

## 卡片编码

`card = value * 10 + suit`
- value: 3=3, 4=4, ..., 13=K, 14=A, 15=2, 16=小王, 17=大王
- suit: 0=♠, 1=♥, 2=♣, 3=♦, 4=王牌

## 通信协议

WebSocket JSON: `{ type, payload }`。消息类型在 `protocol.ts` (C2S / S2C)。
- 登录/注册：`login` / `register` → `login_ok` (含 token + stats)
- 房间：`create_room` / `join_room` / `leave_room` / `add_ai`
- 游戏：`bid` / `grab` / `double` / `play` / `pass` / `hint`
- 安全：`game_start` 为每个玩家单独过滤手牌，底牌地主确定后公开

## 前端

- `public/app.js` — 唯一活跃前端，原生 JS DOM 渲染，`setInterval(up, 400)` 轮询
- `public/index.html` / `public/style.css`
- 全局 `st` 对象驱动所有视图，`updateView()` → `renderHome/renderRoom/renderGame`
- 滑动选牌：Pointer Events + `getBoundingClientRect` 坐标检测
- 横屏：`@media(orientation:portrait)` 自动 `rotate(90deg)`

## AI 系统

- **DeepSeekPlayer**：调用 `deepseek-v4-pro` (api.deepseek.com)，6s 超时单次尝试，无效降级 SimpleAI
- **SimpleAI**：规则 AI，支持单张/对子/三条/三带/顺子/连对/炸弹/火箭，延迟 50ms
- **AI 类型选择**：房间页下拉框 DeepSeek/逻辑 AI，Hub 按类型分派不同延迟 (DeepSeek 1200ms, Simple 50ms)
- **AIMemory**：跟踪 54 张牌出入，提供算牌分析上下文给 DeepSeek

## 前端 UI 约定

- 背景：170deg 多层粉蓝渐变 (`#f9f7ff → #f5f2ff → #fdf5fb → #f4f7ff → #f5f2ff`)
- 卡片面板：`rgba(255,255,255,.5)` + `backdrop-filter:blur(14px)`
- 手牌：50×70px 左对齐重叠 (`margin-right:-18px`)，选中弹起 16px
- 出牌：46×64px 同风格重叠，左侧对手牌靠右显示，右侧对手牌靠左显示
- 按钮：`padding:9px 18px`，主按钮蓝紫渐变，准备按钮固定 160px 居中

## 常见问题

- **AI 不出牌**：日志 `[AI] DeepSeek raw: {}` 表示模型返回空 JSON，检查 API key 和 model 参数
- **战绩不更新**：`gameOver` 调用 `recordGame` 写入 `data/accounts.json`，`login_ok` 返回 stats
- **服务器重启**：`ssh alice@154.8.213.134 "cd ~/dld-server; pkill -f 'node dist/main.js'; sleep 1; export PATH=\$HOME/local/bin:\$PATH; nohup node dist/main.js > dld-server.log 2>&1 &"`
