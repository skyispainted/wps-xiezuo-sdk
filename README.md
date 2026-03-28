# WPS协作机器人SDK

<div align="center">

**WPS协作（WPS365）企业机器人SDK**

[English](README.md) | [中文](README-cn.md)

</div>

---

一个独立的WPS协作机器人SDK，用于构建企业机器人应用。支持HTTP回调模式接收消息，提供完整的API用于发送各类消息。

## 特性

- ✅ **独立SDK** — 不依赖任何框架，可轻松接入任何Node.js项目
- ✅ **HTTP回调模式** — 通过Webhook接收消息（需要公网可访问）
- ✅ **私聊支持** — 机器人与用户一对一交互
- ✅ **群聊支持** — 通过@机器人在群聊中交互
- ✅ **媒体消息支持** — 支持发送图片、文件、富文本等
- ✅ **访问控制** — 支持白名单模式和开放模式
- ✅ **TypeScript** — 完整的类型支持

## 安装

```bash
npm install @skyispainted/wps-xiezuo-sdk
# 或
pnpm add @skyispainted/wps-xiezuo-sdk
# 或
yarn add @skyispainted/wps-xiezuo-sdk
```

## 快速开始

### 创建机器人

```typescript
import { WpsXiezuoBot } from '@skyispainted/wps-xiezuo-sdk';

const bot = new WpsXiezuoBot({
  appId: 'your-app-id',
  secretKey: 'your-secret-key',
  encryptKey: 'your-encrypt-key',
  port: 3000,
  webhookPath: '/webhook',
});

// 注册消息处理器
bot.on('message', async (ctx) => {
  const { message, reply } = ctx;

  console.log(`收到消息: ${message.text}`);
  console.log(`发送者: ${message.senderId}`);

  // 发送回复
  await reply('你好！收到你的消息了。');
});

// 启动机器人
bot.start().then(() => {
  console.log('机器人启动成功');
  console.log(`Webhook URL: ${bot.getWebhookUrl()}`);
});
```

### 仅使用客户端发送消息

如果你只需要发送消息，不需要接收消息：

```typescript
import { WpsClient } from '@skyispainted/wps-xiezuo-sdk';

const client = new WpsClient(
  'your-app-id',
  'your-secret-key',
  'https://openapi.wps.cn'
);

// 发送文本消息
await client.sendTextMessage('Hello!', 'user-id', 'p2p');

// 发送图片消息
await client.sendImageMessage('storage-key', 'chat-id', 'group');

// 发送富文本消息
await client.sendRichTextMessage([
  { type: 'text', text: 'Hello', ... },
], 'chat-id', 'group');
```

### 自定义HTTP服务器

接入Express、Koa等框架：

```typescript
import express from 'express';
import { WpsXiezuoBot, handleWebhookRequest } from '@skyispainted/wps-xiezuo-sdk';

const app = express();
const bot = new WpsXiezuoBot({
  appId: 'your-app-id',
  secretKey: 'your-secret-key',
});

bot.on('message', async (ctx) => {
  await ctx.reply('收到！');
});

app.post('/webhook', express.raw({ type: 'application/json' }), async (req, res) => {
  await handleWebhookRequest(bot, req, res);
});

app.listen(3000);
```

## 配置选项

| 选项 | 类型 | 默认值 | 描述 |
|------|------|--------|------|
| `appId` | string | **必填** | WPS应用ID |
| `secretKey` | string | **必填** | WPS应用密钥 |
| `encryptKey` | string | - | 加密密钥（用于回调验证） |
| `apiUrl` | string | `https://openapi.wps.cn` | WPS API地址 |
| `webhookPath` | string | `/webhook` | Webhook路径 |
| `port` | number | `3000` | HTTP服务器端口 |
| `host` | string | `localhost` | HTTP服务器主机 |
| `companyId` | string | - | 企业ID（可选，会自动获取） |
| `dmPolicy` | `"open"` \| `"allowlist"` | `"open"` | 私聊策略 |
| `groupPolicy` | `"open"` \| `"allowlist"` | `"open"` | 群聊策略 |
| `allowFrom` | string[] | `[]` | 白名单列表 |
| `requireMention` | boolean | `true` | 群聊是否需要@机器人 |
| `showThinking` | boolean | `false` | 是否显示"思考中"提示 |
| `debug` | boolean | `false` | 启用调试日志 |

## 消息类型

### 接收消息

```typescript
bot.on('message', async (ctx) => {
  const { message } = ctx;

  // 消息类型
  message.messageType; // 'text' | 'image' | 'file' | 'rich_text' | ...

  // 消息内容
  message.text;        // 文本内容
  message.mediaUrls;   // 媒体URL列表
  message.chatId;      // 聊天ID
  message.chatType;    // 'p2p' | 'group'
  message.senderId;    // 发送者ID
  message.isAtBot;     // 是否@机器人（群聊）
});
```

### 发送回复

```typescript
bot.on('message', async (ctx) => {
  // 发送文本
  await ctx.reply('文本回复');

  // 发送图片
  await ctx.replyMedia('storage-key', 'image');

  // 发送文件
  await ctx.replyMedia('storage-key', 'file');

  // 发送富文本
  await ctx.replyRichText([
    createTextElement('Hello', 0),
    createImageElement('storage-key', 1),
  ]);

  // 直接使用客户端
  const client = ctx.client;
  await client.sendTextMessage('直接发送', 'chat-id', 'p2p');
});
```

## 事件类型

### 消息事件

```typescript
bot.on('message', async (ctx) => {
  // 处理消息
});
```

### 卡片回调

```typescript
bot.on('card_callback', async (ctx) => {
  const { callback, reply } = ctx;
  console.log(`卡片回调: ${callback.callback_name}`);
  await reply('收到卡片操作');
});
```

### 错误处理

```typescript
bot.on('error', async (ctx) => {
  console.error(`错误: ${ctx.error.message}`);
  console.error(`来源: ${ctx.source}`);
});
```

## WPS开放平台配置

1. 访问 [WPS开放平台](https://open.wps.cn/) 创建内部企业应用
2. 配置消息模式为 **HTTP回调模式**
3. 获取 **App ID**、**Secret Key**、**Encrypt Key**
4. 配置事件订阅URL为你的Webhook地址：
   ```
   http://<YOUR_PUBLIC_IP>:3000/webhook
   ```

## 致谢

本项目基于 [`simple-xiezuo`](https://github.com/xieqiwen/simple-xiezuo) 项目重构，感谢 [@xieqiwen](https://github.com/xieqiwen) 的基础工作。

## License

GPL-3.0