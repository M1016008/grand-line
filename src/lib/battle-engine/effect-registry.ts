import type { CardListItem } from "@/lib/cards";
import type {
  CardEffectDefinition,
  EffectAction,
  EffectTrigger,
  TargetSpec,
  TriggeredEffect,
} from "./effects";

const OFFICIAL_SOURCES = new Set(["official_jp", "official_en"]);
const SEARCH_COLORS: Record<string, string> = {
  赤: "red",
  緑: "green",
  青: "blue",
  紫: "purple",
  黒: "black",
  黄: "yellow",
};
const TIMING_MARKERS = [
  "[登場時]",
  "[アタック時]",
  "[起動メイン]",
  "[メイン]",
  "[KO時]",
  "[自分のターン終了時]",
  "[相手のターン中]",
];

export class BattleEffectRegistry {
  private readonly definitions: Map<string, CardEffectDefinition>;

  constructor(cards: CardListItem[]) {
    this.definitions = new Map(
      cards.map((card) => [card.id, compileCardEffect(card)]),
    );
  }

  get(cardId: string): CardEffectDefinition {
    return (
      this.definitions.get(cardId) ?? {
        cardId,
        status: "unsupported",
        rush: false,
        blocker: false,
        effects: [],
        unsupportedReasons: ["verified official factsが候補プールにありません"],
      }
    );
  }

  isRush(cardId: string): boolean {
    const definition = this.get(cardId);
    return definition.status !== "unsupported" && definition.rush;
  }

  isBlocker(cardId: string): boolean {
    const definition = this.get(cardId);
    return definition.status !== "unsupported" && definition.blocker;
  }
}

export function compileCardEffect(card: CardListItem): CardEffectDefinition {
  if (!card.verified || !OFFICIAL_SOURCES.has(card.source)) {
    return {
      cardId: card.id,
      status: "unsupported",
      rush: false,
      blocker: false,
      effects: [],
      unsupportedReasons: ["verified official effectText/triggerTextではありません"],
    };
  }

  const effectText = cleanText(card.effectText);
  const triggerText = cleanText(card.triggerText);
  const rush = hasUnconditionalKeyword(effectText, "速攻");
  const blocker = hasUnconditionalKeyword(effectText, "ブロッカー");
  const effects: TriggeredEffect[] = [];
  const unsupportedReasons: string[] = [];

  const sharedAttack = effectText.match(/\[登場時\]\/\[アタック時\](.*)$/);
  if (sharedAttack) {
    addCompiledEffect(card.id, "on_play", sharedAttack[1], effects, unsupportedReasons);
    addCompiledEffect(card.id, "on_attack", sharedAttack[1], effects, unsupportedReasons);
  } else {
    compileMarker(card.id, effectText, "[登場時]", "on_play", effects, unsupportedReasons);
    compileMarker(card.id, effectText, "[アタック時]", "on_attack", effects, unsupportedReasons);
  }
  compileMarker(card.id, effectText, "[起動メイン]", "activate_main", effects, unsupportedReasons);
  compileMarker(card.id, effectText, "[メイン]", "main", effects, unsupportedReasons);

  if (triggerText) {
    const segment = triggerText.replace(/^\[トリガー\]/, "").trim();
    if (/^このカードの\[メイン\]効果を発動する。?$/.test(segment)) {
      const main = effects.find((effect) => effect.trigger === "main");
      if (main) {
        effects.push({ ...main, id: `${card.id}:trigger`, trigger: "trigger", sourceText: triggerText });
      } else {
        unsupportedReasons.push("Triggerが参照するMain効果を構造化できません");
      }
    } else {
      addCompiledEffect(card.id, "trigger", segment, effects, unsupportedReasons, triggerText);
    }
  }

  if (effectText.includes("[速攻:キャラ]")) {
    unsupportedReasons.push("Rush:キャラの攻撃対象制限は未対応です");
  }
  if (effectText.includes("[カウンター]")) {
    unsupportedReasons.push("イベントのCounter効果はv1未対応です");
  }
  const requestedMechanics = new Set([
    "OnPlay",
    "OnAttack",
    "Draw",
    "Search",
    "ReturnToHand",
    "RestOpponentCard",
    "PowerBuff",
    "PowerDebuff",
    "CostReduction",
    "Trigger",
  ]);
  for (const mechanic of card.mechanics) {
    if (
      !requestedMechanics.has(mechanic) &&
      !["Rush", "Blocker", "RestCard", "Look", "MainPhase", "Counter"].includes(mechanic)
    ) {
      unsupportedReasons.push(`${mechanic} familyはv1未対応です`);
    }
  }

  const hasRulesText = Boolean(effectText && effectText !== "-") || Boolean(triggerText);
  const hasSupported = rush || blocker || effects.length > 0 || !hasRulesText;
  if (hasRulesText && !hasSupported) {
    unsupportedReasons.push("verified official rules textをv1で構造化できません");
  }
  const uniqueReasons = [...new Set(unsupportedReasons)];
  return {
    cardId: card.id,
    status:
      uniqueReasons.length === 0
        ? "supported"
        : hasSupported
          ? "partial"
          : "unsupported",
    rush,
    blocker,
    effects,
    unsupportedReasons: uniqueReasons,
  };
}

function compileMarker(
  cardId: string,
  text: string,
  marker: string,
  trigger: EffectTrigger,
  effects: TriggeredEffect[],
  reasons: string[],
): void {
  const segment = extractSegment(text, marker);
  if (segment) addCompiledEffect(cardId, trigger, segment, effects, reasons);
}

function addCompiledEffect(
  cardId: string,
  trigger: EffectTrigger,
  segment: string,
  effects: TriggeredEffect[],
  reasons: string[],
  sourceText = segment,
): void {
  const parsed = parseActions(segment);
  if (parsed.actions.length > 0 && parsed.reason === undefined) {
    effects.push({
      id: `${cardId}:${trigger}`,
      trigger,
      actions: parsed.actions,
      sourceText,
    });
  } else {
    reasons.push(`${trigger}: ${parsed.reason ?? "効果を構造化できません"}`);
  }
}

function parseActions(segmentRaw: string): { actions: EffectAction[]; reason?: string } {
  const segment = segmentRaw.trim();
  const draw = segment.match(/^カード(\d+)枚を引く。?$/);
  if (draw) return { actions: [{ type: "draw", count: Number(draw[1]) }] };

  if (/^このカードを登場させる。?$/.test(segment)) {
    return { actions: [{ type: "play_self" }] };
  }

  const search = parseSearch(segment);
  if (search) return { actions: [search] };

  if (
    /(?:場合|できる[:：]|ドン!!\s*[-－]\s*\d|[➀➁➂➃➄]|以下から1つ|につき|好きな順番)/.test(
      segment,
    )
  ) {
    return { actions: [], reason: "条件・コスト・選択処理を安全に構造化できません" };
  }

  const targeted = parseTargetedAction(segment);
  if (targeted) return { actions: [targeted] };

  return { actions: [], reason: "v1の保守的parserに一致しません" };
}

function parseSearch(segment: string): Extract<EffectAction, { type: "search" }> | null {
  if (!/残りを.*デッキの下に置く。?$/.test(segment)) return null;
  const match = segment.match(
    /^自分のデッキの上から(\d+)枚を見て、(.+?)1枚までを公開し、手札に加える。その後、残りを.*デッキの下に置く。?$/,
  );
  if (!match) return null;
  const criteria = match[2];
  const feature =
    criteria.match(/特徴《([^》]+)》/)?.[1] ??
    criteria.match(/『([^』]+)』を含む特徴/)?.[1];
  const excludeName = criteria.match(/「([^」]+)」以外/)?.[1];
  const nameIncludes = criteria.match(/「([^」]+)」(?:を含む)?カード/)?.[1];
  const colorJa = criteria.match(/(赤|緑|青|紫|黒|黄)の/)?.[1];
  const color = colorJa ? SEARCH_COLORS[colorJa] : undefined;
  const maxCost = criteria.match(/コスト(\d+)以下/)?.[1];
  const minCost = criteria.match(/コスト(\d+)以上/)?.[1];
  const cardType = criteria.includes("キャラカード")
    ? "CHARACTER"
    : criteria.includes("イベント")
      ? "EVENT"
      : criteria.includes("ステージカード")
        ? "STAGE"
        : undefined;
  if (!feature && !excludeName && !nameIncludes && !color && !cardType && !maxCost && !minCost) {
    return null;
  }
  return {
    type: "search",
    lookAt: Number(match[1]),
    count: 1,
    feature,
    excludeName,
    ...(nameIncludes ? { nameIncludes } : {}),
    ...(color ? { color } : {}),
    cardType,
    minCost: minCost ? Number(minCost) : undefined,
    maxCost: maxCost ? Number(maxCost) : undefined,
  };
}

function parseTargetedAction(
  segment: string,
): Extract<EffectAction, { target: TargetSpec }> | null {
  const normalized = segment.replace(/持ち主の/g, "");
  const ko = normalized.match(
    /^相手の(?:(レスト|アクティブ)の)?(?:(?:元々の)?コスト(\d+)以下の)?キャラ1枚までを、?KOする。?$/,
  );
  if (ko) {
    const target = opponentCharacter();
    const targetState = stateValue(ko[1]);
    const maxCost = numberValue(ko[2]);
    if (targetState) target.state = targetState;
    if (maxCost !== undefined) target.maxCost = maxCost;
    return {
      type: "ko",
      target,
    };
  }
  const rest = normalized.match(
    /^相手の(?:(?:元々の)?コスト(\d+)以下の)?キャラ1枚までを、?レストにする。?$/,
  );
  if (rest) {
    return { type: "rest", target: opponentCharacter({ maxCost: numberValue(rest[1]) }) };
  }
  const opponentBounce = normalized.match(
    /^相手の(?:(?:元々の)?コスト(\d+)以下の)?キャラ1枚までを、?手札に戻す。?$/,
  );
  if (opponentBounce) {
    return {
      type: "return_to_hand",
      target: opponentCharacter({ maxCost: numberValue(opponentBounce[1]) }),
    };
  }
  const eitherPowerBounce = normalized.match(
    /^(?:元々の)?パワー(\d+)のキャラ1枚までを、?手札に戻す。?$/,
  );
  if (eitherPowerBounce) {
    return {
      type: "return_to_hand",
      target: { owner: "either", zones: ["character"], minPower: Number(eitherPowerBounce[1]), maxPower: Number(eitherPowerBounce[1]), count: 1 },
    };
  }
  const modifier = normalized.match(
    /^(自分|相手)の(リーダーかキャラ|キャラ)1枚までを、このターン中、(パワー|コスト)([+＋－-])(\d+)。?$/,
  );
  if (modifier) {
    const amount = Number(modifier[5]) * (/[-－]/.test(modifier[4]) ? -1 : 1);
    const target: TargetSpec = {
      owner: modifier[1] === "自分" ? "own" : "opponent",
      zones: modifier[2] === "リーダーかキャラ" ? ["leader", "character"] : ["character"],
      count: 1,
    };
    return modifier[3] === "パワー"
      ? { type: "power_modifier", target, amount, duration: "turn" }
      : { type: "cost_modifier", target, amount, duration: "turn" };
  }
  return null;
}

function opponentCharacter(
  overrides: Partial<TargetSpec> = {},
): TargetSpec {
  return {
    owner: "opponent",
    zones: ["character"],
    count: 1,
    ...overrides,
  };
}

function extractSegment(text: string, marker: string): string | null {
  const start = text.indexOf(marker);
  if (start < 0) return null;
  const after = text.slice(start + marker.length).trim();
  let end = after.length;
  for (const nextMarker of TIMING_MARKERS) {
    const index = after.indexOf(nextMarker);
    if (index >= 0 && index < end) end = index;
  }
  return after.slice(0, end).trim() || null;
}

function hasUnconditionalKeyword(text: string, keyword: string): boolean {
  return new RegExp(`(?:^|\\s)\\[${keyword}\\](?:\\(|\\s|$)`).test(text);
}

function cleanText(value: string | null | undefined): string {
  return value?.replace(/\s+/g, " ").trim() ?? "";
}

function numberValue(value: string | undefined): number | undefined {
  return value === undefined ? undefined : Number(value);
}

function stateValue(value: string | undefined): "rested" | "active" | undefined {
  return value === "レスト" ? "rested" : value === "アクティブ" ? "active" : undefined;
}
