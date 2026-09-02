import type { CardListItem } from "@/lib/cards";

/**
 * Verified official JP facts captured from the SSD database for deterministic
 * golden tests. sourceUrl values point to the same official rows.
 */
function officialCard(
  input: Partial<CardListItem> & Pick<CardListItem, "id" | "name" | "cardType">,
): CardListItem {
  return {
    setCode: input.id.split("-")[0],
    colors: ["red"],
    attributes: [],
    features: [],
    mechanics: [],
    cost: input.cardType === "LEADER" ? null : 1,
    power: input.cardType === "EVENT" ? null : 5_000,
    counter: null,
    life: input.cardType === "LEADER" ? 5 : null,
    rarity: null,
    hasTrigger: Boolean(input.triggerText),
    imageUrlJp: null,
    effectText: null,
    triggerText: null,
    source: "official_jp",
    verified: true,
    ...input,
  };
}

export const GOLDEN_LEADER = officialCard({
  id: "ST01-001",
  name: "モンキー・D・ルフィ",
  cardType: "LEADER",
  colors: ["red"],
  power: 5_000,
  life: 5,
  mechanics: ["ActivateMain"],
  effectText: "[起動メイン][ターン1回]このリーダーか自分のキャラ1枚にレストのドン!!1枚までを付与する。",
});

export const GOLDEN_RUSH = officialCard({
  id: "EB01-036",
  name: "ミノチワワ",
  cardType: "CHARACTER",
  colors: ["purple"],
  features: ["インペルダウン", "獄卒獣"],
  mechanics: ["Rush", "OnKO"],
  cost: 4,
  power: 5_000,
  effectText: "[速攻](このカードは登場したターンにアタックできる) [KO時]自分のリーダーが特徴《インペルダウン》を持つ場合、ドン!!デッキからドン!!1枚までを、レストで追加する。",
});

export const GOLDEN_BLOCKER = officialCard({
  id: "EB01-017",
  name: "ブルーノ",
  cardType: "CHARACTER",
  colors: ["green"],
  features: ["FILM", "CP0"],
  mechanics: ["Blocker", "RestCard", "RestOpponentCard"],
  cost: 2,
  power: 2_000,
  counter: 1_000,
  effectText: "[ブロッカー](相手のアタックの後、このカードをレストにし、アタックの対象をこのカードにできる)",
});

export const GOLDEN_DRAW = officialCard({
  id: "EB01-023",
  name: "エドワード・ウィーブル",
  cardType: "CHARACTER",
  colors: ["blue"],
  features: ["王下七武海"],
  mechanics: ["OnPlay"],
  cost: 4,
  power: 6_000,
  effectText: "[登場時]カード1枚を引く。",
});

export const GOLDEN_KO = officialCard({
  id: "EB01-049",
  name: "Tボーン",
  cardType: "CHARACTER",
  colors: ["black"],
  features: ["W7", "海軍"],
  mechanics: ["OnPlay"],
  cost: 5,
  power: 5_000,
  counter: 2_000,
  effectText: "[登場時]相手のコスト2以下のキャラ1枚までを、KOする。",
});

export const GOLDEN_REST = officialCard({
  id: "EB01-015",
  name: "スクラッチメン・アプー",
  cardType: "CHARACTER",
  colors: ["green"],
  features: ["超新星", "オンエア海賊団"],
  mechanics: ["OnPlay", "RestCard", "RestOpponentCard"],
  cost: 1,
  power: 1_000,
  counter: 2_000,
  effectText: "[登場時]相手のコスト2以下のキャラ1枚までを、レストにする。",
});

export const GOLDEN_BOUNCE = officialCard({
  id: "EB03-027",
  name: "マーガレット",
  cardType: "CHARACTER",
  colors: ["blue"],
  features: ["アマゾン・リリー"],
  mechanics: ["OnPlay", "ReturnToHand"],
  cost: 6,
  power: 7_000,
  counter: 1_000,
  effectText: "[登場時]元々のパワー7000のキャラ1枚までを、持ち主の手札に戻す。",
});

export const GOLDEN_SEARCH = officialCard({
  id: "EB02-017",
  name: "ナミ",
  cardType: "CHARACTER",
  colors: ["green"],
  features: ["東の海", "麦わらの一味"],
  mechanics: ["OnPlay", "Search", "Look"],
  cost: 1,
  power: 2_000,
  counter: 1_000,
  effectText: "[登場時]自分のデッキの上から5枚を見て、「ナミ」以外の特徴《麦わらの一味》を持つカード1枚までを公開し、手札に加える。その後、残りを好きな順番でデッキの下に置く。",
});

export const GOLDEN_TRIGGER_DRAW = officialCard({
  id: "EB02-030",
  name: "仲間の夢を笑われた時だ!!!!",
  cardType: "EVENT",
  colors: ["blue"],
  features: ["アラバスタ王国", "麦わらの一味"],
  mechanics: ["Trigger"],
  cost: 2,
  power: null,
  effectText: "[カウンター]自分のキャラすべては、このターン中、バトルでKOされる場合、代わりに自分の手札1枚を捨てることができる。",
  triggerText: "[トリガー]カード1枚を引く。",
  hasTrigger: true,
});

export const GOLDEN_ON_ATTACK = officialCard({
  id: "OP09-003",
  name: "シャチ&ペンギン",
  cardType: "CHARACTER",
  colors: ["red"],
  features: ["ハートの海賊団"],
  mechanics: ["OnAttack", "PowerDebuff"],
  cost: 4,
  power: 5_000,
  counter: 1_000,
  effectText: "[アタック時]相手のキャラ1枚までを、このターン中、パワー-2000。",
});

export const GOLDEN_CARDS = [
  GOLDEN_LEADER,
  GOLDEN_RUSH,
  GOLDEN_BLOCKER,
  GOLDEN_DRAW,
  GOLDEN_KO,
  GOLDEN_REST,
  GOLDEN_BOUNCE,
  GOLDEN_SEARCH,
  GOLDEN_TRIGGER_DRAW,
  GOLDEN_ON_ATTACK,
] as const;
