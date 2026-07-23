# AI English Buddy(AI 英语搭子)

以语音对话为核心的陪伴式英语学习网页应用。用户与固定 AI 角色("外国朋友")语音聊天:角色有长期记忆、独立人格,温和纠错,每天教 5 个个性化地道表达。

## 技术栈

- **前端/后端**: Next.js (App Router) + TypeScript + Tailwind CSS
- **数据库/认证**: Supabase(Postgres + 邮箱 OTP + Google 登录)
- **语音管线**(模块化,各层可独立替换):
  - STT: OpenAI Whisper
  - LLM: Anthropic Claude
  - TTS: OpenAI TTS
- **实时语音(流畅模式)** — 两种传输:
  - `webrtc`(默认):浏览器直连 OpenAI Realtime。低延迟,但**需要浏览器能直达 `api.openai.com`**(国内无代理时会一直卡"连接中")。
  - `ws`:浏览器 ⇄ 本站自定义 server(`server.ts`)⇄ OpenAI,全程 WebSocket。浏览器只连本站,**国内可用**。用 `NEXT_PUBLIC_REALTIME_TRANSPORT=ws` 开启(见 `fly.toml` `[build.args]`);去掉即回滚到 WebRTC。
- **测试**: Vitest + Testing Library

> **部署两处易踩的坑**(自定义 server 用 `tsx` 运行,不经 `next build` 内联):
> 1. `NEXT_PUBLIC_*` 在运行时是 `undefined` —— server 端要用的(如 Supabase URL/key)必须放进 `fly.toml` 的 **`[env]`**(运行时),不能只放 `[build.args]`。
> 2. OpenAI Realtime **GA** 的 `session.update` 音频格式是**对象** `{ type: 'audio/pcm', rate: 24000 }`,不是字符串 `'pcm16'`(后者被静默拒绝 → 模型丢失人设/语言)。

## 本地启动

### 1. 前置条件

- Node.js >= 20
- [Supabase CLI](https://supabase.com/docs/guides/cli)(本地数据库)+ Docker
- API keys: Anthropic + OpenAI

### 2. 安装依赖

```bash
npm install
```

### 3. 启动本地 Supabase 并初始化数据库

```bash
supabase start          # 启动本地 Postgres/Auth(需要 Docker)
supabase db reset       # 跑迁移 + seed(4 个角色)
```

`supabase start` 输出中的 `API URL` / `anon key` / `service_role key` 填入 `.env.local`。

### 4. 配置环境变量

```bash
cp .env.example .env.local
# 填入 Supabase 的 URL/keys 和 ANTHROPIC_API_KEY / OPENAI_API_KEY
```

### 5. 生成角色试听音频(一次性)

```bash
npx tsx scripts/generate-voice-previews.ts
```

### 6. 启动开发服务器

```bash
npm run dev             # http://localhost:3000
```

## 测试

```bash
npm test                # 单次运行
npm run test:watch      # 监听模式
```

测试不调用真实 AI 服务——所有供应商实现都有对应 fake(`tests/fakes/`)。

## 目录结构

```
supabase/migrations/    数据库迁移(按序号执行)
supabase/seed.sql       4 个角色种子数据
src/app/                页面 + API 路由
src/lib/services/       AI 服务封装(STT/TTS/LLM,env 切换供应商)
src/lib/prompts/        模块化 Prompt(拼装式,非单一长字符串)
src/lib/audio/          句子切分器 + NDJSON 编解码(纯函数)
src/components/talk/    语音对话 UI(录音/播放队列/状态机)
tests/                  单元测试 + API 路由测试 + fakes
```

## 部署(Fly.io + Supabase 云)

程序以 Docker 容器跑在 Fly.io(常驻 Node 服务,无函数时长限制,流式语音更稳);数据库和认证用 Supabase 云。

1. **Supabase**:在 [supabase.com](https://supabase.com) 创建项目;`supabase link --project-ref <ref> && supabase db push` 推送迁移;SQL Editor 执行 `seed.sql`;Dashboard → Auth → Providers 开启 Email OTP(可选 Google);Redirect URLs 加入 `https://<你的域名>/auth/callback`
2. **填 fly.toml**:把 `[build.args]` 里的 Supabase URL / anon key 换成你项目的真实值(这两个是公开值,不是密钥)
3. **Fly.io**:
   ```bash
   fly launch --no-deploy      # 首次:创建 app,保留已有 fly.toml
   fly secrets set \
     SUPABASE_SERVICE_ROLE_KEY=... \
     ANTHROPIC_API_KEY=... \
     OPENAI_API_KEY=...
   fly deploy
   ```
4. 部署后用真机走通:注册 → 选角色 → 语音对话 → 查看总结

> 也兼容 Vercel:仓库导入后配置 `.env.example` 中所有环境变量即可,无需 Dockerfile。
