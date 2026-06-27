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
| DB | SSD 上のローカル libSQL/SQLite (`LOCAL_DB_PATH`) |
| ORM | Drizzle ORM |
| AI | Anthropic Claude API (Opus 4.7 / Sonnet 4.6 / Haiku 4.5 を用途別) |
| スクレイピング | Playwright |
| 定期実行 | ローカルジョブ / Codex automation (`scrape:daily`) |
| ホスティング | Vercel |

## 開発フェーズ

| Phase | 内容 | 状態 |
| --- | --- | --- |
| 1 | カードデータベース基盤 (52 セット / 2,439 カード取り込み済み) | 完了 |
| 2 | デッキビルダー + ルール検証 (Zustand 永続化) | 完了 |
| 3 | デッキ評価指標 (5 指標レーダー) | 完了 |
| 3.5 | シナジー分析・可視化 (ルールベース + AI 解析待機) | 完了 |
| 3.7 | 確率論エンジン (超幾何 + Monte Carlo) | 完了 |
| 4 | AI デッキ提案 (Claude Opus tool-use) | 完了 (`ANTHROPIC_API_KEY` 必要) |
| 4.5 | シナリオ・ゲームプラン | 未着手 |
| 5 | 対戦相手分析 | 未着手 |
| 6 | 大会情報ダッシュボード | 未着手 |

## ローカル開発

### 前提

- Node.js 20.9+ / npm 11+
- SSD 上のローカル DB パス (`LOCAL_DB_PATH`)
- (任意) Playwright 用の Chromium: `npx playwright install chromium`

### セットアップ

```bash
npm install
cp .env.example .env.local
# .env.local にローカル DB と Anthropic の設定を記入
#
# GRAND_LINE_DATABASE_MODE="local"
# LOCAL_DB_PATH="/Volumes/OWC Express 1M2 80G/grand-line-data/grand-line.db"

# DB 接続先と件数を確認
npm run db:status

# 開発サーバ
npm run dev
```

http://localhost:3000

### DB 接続先

標準運用は、接続中の SSD に置いたローカル libSQL/SQLite ファイルです。
`.env.local` で `GRAND_LINE_DATABASE_MODE="local"` を指定すると、
`TURSO_DATABASE_URL` が残っていてもアプリ・スクレイパー・メンテナンスは
`LOCAL_DB_PATH` のファイルだけを読み書きします。

```bash
GRAND_LINE_DATABASE_MODE="local"
LOCAL_DB_PATH="/Volumes/OWC Express 1M2 80G/grand-line-data/grand-line.db"
```

任意で Turso を使う場合だけ、`GRAND_LINE_DATABASE_MODE="turso"` と
`TURSO_DATABASE_URL` / `TURSO_AUTH_TOKEN` を設定します。

### 定期スクレイピング

カード DB の更新はローカルジョブで SSD の DB に直接反映します。
GitHub Actions は接続中の SSD にアクセスできないため、手動実行時の
スクレイパー確認用だけに残しています。

| コマンド | 役割 | スケジュール |
| --- | --- | --- |
| `npm run scrape:daily` | 新セット検出、全セット再スクレイプ、禁止/制限更新、DB compact、最終件数確認 | 毎日 04:00 JST |

手動更新したい場合は、ローカルで次を実行します。

```bash
npm run scrape:daily
```

練習ログは容量が増えやすいため、通常は全試合の要約だけを残し、完全な
event stream は少数サンプルだけ保存します。保存上限は環境変数
`PRACTICE_AUTO_FULL_EVENT_GAME_LIMIT`、`PRACTICE_DEFAULT_EVENT_SAMPLE_LIMIT`、
`PRACTICE_MAX_STORED_EVENT_GAMES` で調整できます。古い event stream の削除は
`npm run db:prune:practice -- --dry-run` で事前確認できます。

画像キャッシュは DB に保存せず、`LOCAL_DB_PATH` と同じ SSD 配下の
`image-cache/` に保存します。DB から参照されなくなった画像や壊れた
キャッシュだけを掃除する場合は次を実行します。

```bash
npm run db:manage-cache -- --dry-run
npm run db:manage-cache
```

`IMAGE_CACHE_MAX_MB` は現在参照中の画像キャッシュ量に対する警告ラインです。
有効なカード画像は勝手に削除せず、DB 側でカード行を整理したあとに
`db:manage-cache` が古い画像だけを回収します。

### Anthropic API キー (Phase 3.5b / 4 / 4.5 で必要)

AI シナジー解析・デッキ提案・シナリオ生成は Claude API を呼びます。
キーが設定されていない場合は API ルートが `503 missing_api_key`
を返すだけで他の機能には影響しません。

```bash
# https://console.anthropic.com/ で発行
echo 'ANTHROPIC_API_KEY="sk-ant-..."' >> .env.local

# dev サーバを再起動 (env は起動時のみ読まれる)
```

設定後、`/decks/new/<leaderId>` の「AI に提案させる」パネルが
動作します。1 提案あたり Opus で約 $0.05–$0.15 (プロンプトサイズ依存)。

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
