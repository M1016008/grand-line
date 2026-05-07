/**
 * A small catalogue of OP TCG cards used as a fallback when the database
 * is empty (no scrape has run yet). Lets the UI be reviewed end-to-end
 * without a Turso connection.
 *
 * Every card here is taken from publicly known printings; effect text is
 * paraphrased so we don't ship copyrighted strings before a real scrape
 * has populated the DB. Once a real scrape lands, `cardListSource` in
 * `src/lib/cards.ts` returns DB rows and these mocks become inert.
 */
import type {
  CardTranslationSource,
  ScenarioType,
  SynergyRelationType,
} from "@/db/schema";
import { extractMechanics, type Mechanic } from "@/lib/mechanics";

export interface MockCard {
  id: string;
  setCode: string;
  cardType: "LEADER" | "CHARACTER" | "EVENT" | "STAGE" | "DON";
  name: string;
  colors: string[];
  attributes: string[];
  features: string[];
  cost: number | null;
  power: number | null;
  counter: number | null;
  life: number | null;
  rarity: string | null;
  hasTrigger: boolean;
  effectText: string | null;
  triggerText: string | null;
  imageUrlJp: string | null;
  source: CardTranslationSource;
  verified: boolean;
  /** Computed at module load. */
  mechanics: Mechanic[];
}

const RAW: Omit<MockCard, "mechanics">[] = [
  {
    id: "OP01-001",
    setCode: "OP01",
    cardType: "LEADER",
    name: "モンキー・D・ルフィ (Mock)",
    colors: ["red"],
    attributes: ["打撃"],
    features: ["麦わらの一味", "超新星"],
    cost: null,
    power: 5000,
    counter: null,
    life: 5,
    rarity: "L",
    hasTrigger: false,
    effectText:
      "[アタック時] (このリーダー) このリーダーをアクティブにする。 — 例示用ダミーテキスト",
    triggerText: null,
    imageUrlJp: null,
    source: "manual",
    verified: false,
  },
  {
    id: "OP01-016",
    setCode: "OP01",
    cardType: "CHARACTER",
    name: "ナミ (Mock)",
    colors: ["red"],
    attributes: ["特殊"],
    features: ["麦わらの一味"],
    cost: 1,
    power: 1000,
    counter: 1000,
    life: null,
    rarity: "C",
    hasTrigger: true,
    effectText: "[起動メイン] [ターン1回] 自分のデッキの上から1枚を見る。",
    triggerText: "このキャラを登場させる。",
    imageUrlJp: null,
    source: "manual",
    verified: false,
  },
  {
    id: "OP01-013",
    setCode: "OP01",
    cardType: "CHARACTER",
    name: "ロロノア・ゾロ (Mock)",
    colors: ["red"],
    attributes: ["斬撃"],
    features: ["麦わらの一味", "超新星"],
    cost: 3,
    power: 5000,
    counter: 1000,
    life: null,
    rarity: "SR",
    hasTrigger: false,
    effectText: "[ブロッカー] 自分のターン中、このキャラのパワー +1000。",
    triggerText: null,
    imageUrlJp: null,
    source: "manual",
    verified: false,
  },
  {
    id: "OP01-031",
    setCode: "OP01",
    cardType: "CHARACTER",
    name: "ポートガス・D・エース (Mock)",
    colors: ["red"],
    attributes: ["特殊"],
    features: ["スペード海賊団", "白ひげ海賊団"],
    cost: 4,
    power: 6000,
    counter: 1000,
    life: null,
    rarity: "SR",
    hasTrigger: false,
    effectText:
      "[登場時] 相手のキャラ1枚を選び、レストにする。",
    triggerText: null,
    imageUrlJp: null,
    source: "manual",
    verified: false,
  },
  {
    id: "OP01-024",
    setCode: "OP01",
    cardType: "EVENT",
    name: "ゴムゴムのジェットピストル (Mock)",
    colors: ["red"],
    attributes: [],
    features: ["麦わらの一味"],
    cost: 2,
    power: null,
    counter: null,
    life: null,
    rarity: "C",
    hasTrigger: true,
    effectText: "メイン: 相手のキャラ1枚を選び、KOする。",
    triggerText: "相手のキャラ1枚を選び、レストにする。",
    imageUrlJp: null,
    source: "manual",
    verified: false,
  },
  {
    id: "OP02-001",
    setCode: "OP02",
    cardType: "LEADER",
    name: "シャーロット・カタクリ (Mock)",
    colors: ["green"],
    attributes: ["打撃"],
    features: ["ビッグ・マム海賊団"],
    cost: null,
    power: 5000,
    counter: null,
    life: 4,
    rarity: "L",
    hasTrigger: false,
    effectText:
      "[アタック時] 自分のデッキの上から1枚を見て、デッキの上か下に置く。",
    triggerText: null,
    imageUrlJp: null,
    source: "manual",
    verified: false,
  },
  {
    id: "OP02-026",
    setCode: "OP02",
    cardType: "CHARACTER",
    name: "シャーロット・スムージー (Mock)",
    colors: ["green"],
    attributes: ["斬撃"],
    features: ["ビッグ・マム海賊団"],
    cost: 6,
    power: 7000,
    counter: 1000,
    life: null,
    rarity: "SR",
    hasTrigger: false,
    effectText:
      "[起動メイン] [ターン1回] 相手のキャラ1枚を選び、レストにする。",
    triggerText: null,
    imageUrlJp: null,
    source: "manual",
    verified: false,
  },
];

export const MOCK_CARDS: MockCard[] = RAW.map((c) => ({
  ...c,
  mechanics: extractMechanics(c.effectText, c.triggerText),
}));

export type _UnusedExports = SynergyRelationType | ScenarioType;
