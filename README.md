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

### ローカル SQLite から Turso へ移行

開発中はローカル SQLite (`./data/grand-line.db`) で動かし、本番は Turso
(エッジレプリケーション) に切り替えます。コードは両方サポート — `.env.local`
の `TURSO_DATABASE_URL` が空ならローカル、設定されていれば Turso です。

#### 手順

1. **Turso CLI と DB**

   ```bash
   brew install tursodatabase/tap/turso
   turso auth signup     # 初回のみ
   turso auth login

   turso db create onepiece-tcg --location nrt   # nrt = 東京リージョン
   turso db tokens create onepiece-tcg            # 認証トークン (一度きり表示)
   turso db show onepiece-tcg --url               # libsql://... の URL
   ```

2. **`.env.local` を更新**

   ```bash
   TURSO_DATABASE_URL="libsql://onepiece-tcg-<your-org>.turso.io"
   TURSO_AUTH_TOKEN="<上で発行したトークン>"
   ```

3. **接続先を確認**

   ```bash
   npm run db:status
   # → ▶ Connected to: Turso · libsql://onepiece-tcg-...
   #    全テーブル 0 件 + 「DB is empty」表示が出れば OK
   ```

4. **マイグレーション + シード一括**

   ```bash
   npm run db:bootstrap
   # → 4 マイグレーション適用 → fixtures から 54 セット投入 → 規制取り込み
   # 所要 3〜5 分 (Turso のラウンドトリップ分かかる)
   ```

5. **検証**

   ```bash
   npm run db:status
   # cards 2,533 / sets 55 / restrictions 5 / pairs 3 になっていれば成功
   npm run dev
   # /cards, /regulations, /sets を開いて Turso 経由でデータが見える
   ```

ローカルへ戻したいときは `.env.local` の `TURSO_DATABASE_URL` を空にして
dev サーバを再起動すれば `data/grand-line.db` を読みます。データはどちらに
も残ります。

#### Vercel デプロイ

Vercel プロジェクト設定 (Settings → Environment Variables) に
`TURSO_DATABASE_URL` と `TURSO_AUTH_TOKEN` を追加するだけで本番でも
Turso に接続します。`@libsql/client` は HTTPS 経由で動作するので
serverless 関数からも使えます。

### 定期スクレイピング

カード DB の更新は GitHub Actions で Turso に直接反映します。

| Workflow | 役割 | スケジュール |
| --- | --- | --- |
| `discover-new-sets.yml` | 公式カードリストの収録 dropdown を確認し、新セットだけ登録・スクレイプ | 毎週火曜 09:00 JST |
| `scrape-bandai-cards.yml` | 既知の全セットを再スクレイプし、既存カードの修正・画像・再録 membership を更新 | 毎月1日 09:00 JST |
| `scrape-regulations.yml` | 禁止・制限カードを更新 | 毎週月曜 09:00 JST |
| `db-maintenance.yml` | 古い練習リプレイイベントを削除し、必要に応じて DB を compact | 毎週日曜 09:00 JST |

Actions secrets に `TURSO_DATABASE_URL` と `TURSO_AUTH_TOKEN` を入れておくと、
本番サイトが参照する Turso DB が定期的に更新されます。手動更新したい場合は
GitHub Actions の "Run workflow" から `scrape-bandai-cards.yml` を実行します。

練習ログは容量が増えやすいため、通常は全試合の要約だけを残し、完全な
event stream は少数サンプルだけ保存します。保存上限は環境変数
`PRACTICE_AUTO_FULL_EVENT_GAME_LIMIT`、`PRACTICE_DEFAULT_EVENT_SAMPLE_LIMIT`、
`PRACTICE_MAX_STORED_EVENT_GAMES` で調整できます。古い event stream の削除は
`npm run db:prune:practice -- --dry-run` で事前確認できます。

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
