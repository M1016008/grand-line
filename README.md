# Grand Line — One Piece TCG Compass

ワンピースカードゲーム向け、個人利用を起点とした総合ダッシュボード型アプリケーション。
カード DB、デッキ構築、AI による相性・確率・シナリオ分析、対戦相手分析、大会情報を一気通貫で扱う。

詳細な構想は `~/Downloads/grand-line-roadmap.docx` (Version 1.0, 2026-05-07) を参照。

## スタック

| レイヤー | 採用技術 |
| --- | --- |
| Web | Next.js 16 (App Router) + TypeScript + React 19 |
| UI | Tailwind CSS v4 + shadcn/ui |
| 状態管理 | Zustand |
| グラフ可視化 | D3.js (d3-force) + React-Flow |
| チャート | Recharts |
| DB | Turso (libSQL/SQLite 互換) |
| ORM | Drizzle ORM |
| AI | Anthropic Claude API (Opus 4.7 / Sonnet 4.6 / Haiku 4.5 を用途別) |
| スクレイピング | Playwright |
| 定期実行 | GitHub Actions (cron) |
| ホスティング | Vercel |

## 開発フェーズ

| Phase | 内容 | 状態 |
| --- | --- | --- |
| 1 | カードデータベース基盤 | 進行中 |
| 2 | デッキビルダー + ルール検証 | 着手予定 |
| 3 | デッキ評価指標 (5 指標レーダー) | 未着手 |
| 3.5 | シナジー分析・可視化 | 未着手 |
| 3.7 | 確率論エンジン | 未着手 |
| 4 | AI デッキ提案 | 未着手 |
| 4.5 | シナリオ・ゲームプラン | 未着手 |
| 5 | 対戦相手分析 | 未着手 |
| 6 | 大会情報ダッシュボード | 未着手 |

## ローカル開発

### 前提

- Node.js 20.9+ / npm 11+
- Turso CLI (`brew install tursodatabase/tap/turso`)
- (任意) Playwright 用の Chromium: `npx playwright install chromium`

### セットアップ

```bash
npm install
cp .env.example .env.local
# .env.local に Turso / Anthropic のクレデンシャルを記入

# Drizzle migration を Turso に流す
npm run db:push

# 開発サーバ
npm run dev
```

http://localhost:3000

### Turso の作成 (初回のみ)

```bash
turso auth login
turso db create onepiece-tcg --location nrt
turso db tokens create onepiece-tcg
turso db show onepiece-tcg --url
```

URL とトークンを `.env.local` に書く。

## ディレクトリ構成

```
src/
  app/                Next.js App Router (page.tsx, layout.tsx, route.ts)
  components/         UI コンポーネント (shadcn/ui ベース)
  db/                 Drizzle スキーマ・クライアント
  lib/                ドメインロジック (mechanics extractor, probability engine, etc.)
  scrapers/           Playwright スクレイパー (バンダイ JP / 海外公式)
  ai/                 Claude API ラッパー、プロンプト、tool-use スキーマ
drizzle/              生成された SQL マイグレーション
data/                 ローカル投入データ (gitignore)
```

## 設計の核

1. **ハルシネーション排除最優先** — 事実情報は一次ソースから取得し、`source` / `verified` カラムで二段階管理。AI は分析・解説のみ。
2. **リーダー中心主義** — シナジーグラフは中央配置、評価指標もリーダー連動度を加味。
3. **確率・シナリオ・戦術の三軸統合** — カード単体性能ではなく相互作用で評価する。

## ライセンス

未定 (個人利用想定)。商用展開時に再検討。
