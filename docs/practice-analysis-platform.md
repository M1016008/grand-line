# Practice and Analysis Platform

Grand Line の練習機能は、オンライン対戦よりも「自分のデッキ理解とプレイング改善」を優先する。中心になるのは、CPU戦、局面別ドリル、AI vs AIの自動対戦、そして完全に再現可能な対戦ログである。

## Rule Baseline

参照元は ONE PIECE CARD GAME 公式ルールページ、および Comprehensive Rules v1.2.0（Last updated: 2026-01-16）。

初期実装で反映する範囲:

- 50枚デッキ、リーダー1枚、DON!!デッキ10枚。
- リーダー色に合うカードだけをデッキに入れる制約。
- 初手5枚、1回だけ全入れ替えできるマリガン。
- リーダーのライフ値に応じたライフ配置。
- リフレッシュ、ドロー、DON!!、メイン、エンドのターン骨格。
- カード使用、DON使用、アタック、ライフ変動、トリガー公開のログ化。

完全再現へ向けて次に必要な範囲:

- 全カード効果を解決できる効果エンジン。
- カウンター、ブロッカー、バトル中パワー比較、対象変更の厳密処理。
- 永続効果、置換効果、同時誘発、効果の優先順。
- FAQ、エラッタ、個別裁定のバージョン管理。

## Replay Log Contract

`GameReplayLog` remains the canonical full replay shape. To reduce Turso
storage use, large batch runs may persist every game summary while storing
full event streams for only a sampled subset of games. The run metadata records
the storage policy so later tools can distinguish full replays from
summary-only games.

すべての試合は `GameReplayLog` として保存できる形にする。

- `seed`: 乱数を再現するための値。
- `rulesVersion`: 参照したルールバージョン。
- `cpuSkill`: CPU強度。
- `firstPlayer`: 先攻側。
- `decks`: リーダー、デッキ枚数、生成元。
- `events`: 全イベントのJSONストリーム。
- `result`: 勝敗、勝因、ターン数、最終ライフ。

イベントは、後から分析指標を追加できるように、状態スナップショットを毎回持つ。最低限、ライフ、手札枚数、デッキ残数、利用可能DON、使用DONを記録する。

## Persistence

Persistence is intentionally split by weight:

- `practice_runs`: one execution unit, including storage policy metadata.
- `practice_games`: one row per game. This is always saved for every game and
  carries the replay seed, result, deck snapshots, and compact summary metrics.
- `practice_events`: full replay event streams. Small runs are stored fully; in
  automatic mode, runs over 100 games store a representative event sample and
  keep the remaining games as summaries only.

練習ログは3層で保存する。

- `practice_runs`: CPU戦またはAI vs AIバッチの実行単位。
- `practice_games`: 1試合ごとのseed、勝敗、先攻後攻、最終状態、軽量な要約。
- `practice_events`: replayを完全に再現するためのイベントストリーム。

保存は練習画面から自動で行う。保存に失敗しても、画面上のシミュレーション結果は消さない。
AI vs AIの大量対戦は、最大10,000戦までサーバー側で実行し、replayをブラウザへ返さずDBへ直接保存する。

## Metrics

初期実装で集計する指標:

- 単純勝率。
- Ablation分析。
- ターン別の特定カード到達確率。
- マリガン判断別の勝率。
- 先攻・後攻差。
- トリガー公開率・成功率。
- カード使用タイミング分布。
- 敗北時のカウンター余剰。
- 勝因分類。
- ライフ推移。
- DON使用効率。

`Ablation分析` は、対象カードをデッキ内の汎用カードへ差し替え、同じseed系列で再実行した勝率差をカード貢献度として扱う。厳密な因果推定ではないが、構築改善の入口として使える。

## CPU Skill Targets

`beginner`: 初心者の壁打ち相手。カーブ通りにプレイし、守備やリーサルの評価は控えめにする。

`advanced`: 上級者の練習相手。マリガン、リーサル、守備リソース、DON効率をより強く評価する。将来的には探索深度、カード効果理解、プレイログ学習で伸ばす。
