import type { CardListItem } from "@/lib/cards";
import type { EffectAction } from "./effects";
import {
  resolveDeckOut,
  sideOf,
  withSide,
  type BattleState,
  type BattleTargetRef,
} from "./state";

export interface AppliedAction {
  state: BattleState;
  log: string[];
}

export function drawCards(
  state: BattleState,
  owner: "player" | "opponent",
  count: number,
): AppliedAction {
  state = resolveDeckOut(state, owner);
  if (state.winner) return { state, log: ["→ 0枚ドロー（デッキ0枚）"] };
  let side = sideOf(state, owner);
  const drawn: CardListItem[] = [];
  for (let index = 0; index < count; index++) {
    const [card, ...deck] = side.deck;
    if (!card) break;
    drawn.push(card);
    side = { ...side, deck, hand: [...side.hand, card] };
    state = resolveDeckOut(withSide(state, owner, side), owner);
    side = sideOf(state, owner);
    if (state.winner) break;
  }
  return {
    state: withSide(state, owner, side),
    log: drawn.length === count
      ? [`→ ${drawn.length}枚ドロー`]
      : [`→ ${drawn.length}枚ドロー（山札不足）`],
  };
}

export function searchChoices(
  state: BattleState,
  owner: "player" | "opponent",
  action: Extract<EffectAction, { type: "search" }>,
): Array<{ card: CardListItem; lookedIndex: number }> {
  const side = sideOf(state, owner);
  const looked = side.deck.slice(0, action.lookAt);
  return looked.flatMap((card, index) => {
    if (action.cardType && card.cardType !== action.cardType) return [];
    if (action.feature && !card.features.includes(action.feature)) return [];
    if (action.color && !card.colors.includes(action.color)) return [];
    if (action.nameIncludes && !card.name.includes(action.nameIncludes)) return [];
    if (action.minCost !== undefined && (card.cost ?? -1) < action.minCost) return [];
    if (action.maxCost !== undefined && (card.cost ?? Number.MAX_SAFE_INTEGER) > action.maxCost) {
      return [];
    }
    if (action.excludeName && card.name === action.excludeName) return [];
    return [{ card, lookedIndex: index }];
  });
}

export function resolveSearchDeck(
  state: BattleState,
  owner: "player" | "opponent",
  action: Extract<EffectAction, { type: "search" }>,
  selectedLookedIndexes: number[],
): AppliedAction {
  const side = sideOf(state, owner);
  const looked = side.deck.slice(0, action.lookAt);
  const rest = side.deck.slice(action.lookAt);
  const legal = new Set(searchChoices(state, owner, action).map((entry) => entry.lookedIndex));
  const chosenIndexes = new Set(selectedLookedIndexes);
  if (
    chosenIndexes.size > action.count ||
    [...chosenIndexes].some((index) => !legal.has(index)) ||
    (!action.optional && chosenIndexes.size !== Math.min(action.count, legal.size))
  ) {
    return { state, log: ["→ 不正なSearch選択を拒否"] };
  }
  const chosen = looked.flatMap((card, index) =>
    chosenIndexes.has(index) ? [{ card, lookedIndex: index }] : [],
  );
  const remainingLooked = looked.filter((_, index) => !chosenIndexes.has(index));
  const nextSide = {
    ...side,
    deck: [...rest, ...remainingLooked],
    hand: [...side.hand, ...chosen.map((entry) => entry.card)],
  };
  const nextState = resolveDeckOut(withSide(state, owner, nextSide), owner);
  return {
    state: nextState,
    log: [
      chosen.length > 0
        ? `→ 上から${action.lookAt}枚を確認し、${chosen.map((entry) => entry.card.name).join("、")}を手札へ`
        : `→ 上から${action.lookAt}枚を確認（手札に加えない）`,
    ],
  };
}

export function addDeckCardsToLife(
  state: BattleState,
  owner: "player" | "opponent",
  count: number,
): AppliedAction {
  state = resolveDeckOut(state, owner);
  if (state.winner) return { state, log: ["→ Lifeに0枚追加（デッキ0枚）"] };
  let side = sideOf(state, owner);
  let moved = 0;
  for (let index = 0; index < count; index++) {
    const [card, ...deck] = side.deck;
    if (!card) break;
    side = { ...side, deck, lifeCards: [card, ...side.lifeCards] };
    moved++;
    state = resolveDeckOut(withSide(state, owner, side), owner);
    side = sideOf(state, owner);
    if (state.winner) break;
  }
  return {
    state: withSide(state, owner, side),
    log: [`→ Lifeに${moved}枚追加`],
  };
}

export function applyTargetedAction(
  state: BattleState,
  action: Extract<EffectAction, { target: unknown }>,
  target: BattleTargetRef,
): AppliedAction {
  const side = sideOf(state, target.owner);
  if (target.zone === "leader") {
    if (action.type !== "power_modifier") {
      return { state, log: ["→ 対象リーダーには未対応の処理"] };
    }
    return {
      state: withSide(state, target.owner, {
        ...side,
        leaderPowerModifier: side.leaderPowerModifier + action.amount,
      }),
      log: [`→ ${target.label} のパワー ${signed(action.amount)}`],
    };
  }

  const zone = side.board.find((card) => card.instanceId === target.instanceId);
  if (!zone) return { state, log: ["→ 合法対象が見つかりません"] };
  const remaining = side.board.filter((card) => card.instanceId !== target.instanceId);
  switch (action.type) {
    case "ko":
      return {
        state: withSide(state, target.owner, {
          ...side,
          board: remaining,
          trash: [...side.trash, zone.card],
        }),
        log: [`→ ${zone.card.name} をKO（トラッシュへ）`],
      };
    case "return_to_hand":
      return {
        state: withSide(state, target.owner, {
          ...side,
          board: remaining,
          hand: [...side.hand, zone.card],
        }),
        log: [`→ ${zone.card.name} を手札へ戻す`],
      };
    case "return_to_deck":
      return {
        state: withSide(state, target.owner, {
          ...side,
          board: remaining,
          deck:
            action.position === "top"
              ? [zone.card, ...side.deck]
              : [...side.deck, zone.card],
        }),
        log: [`→ ${zone.card.name} をデッキ${action.position === "top" ? "上" : "下"}へ`],
      };
    case "rest":
      return {
        state: withSide(state, target.owner, {
          ...side,
          board: side.board.map((card) =>
            card.instanceId === target.instanceId ? { ...card, rested: true } : card,
          ),
        }),
        log: [`→ ${zone.card.name} をレスト`],
      };
    case "activate":
      return {
        state: withSide(state, target.owner, {
          ...side,
          board: side.board.map((card) =>
            card.instanceId === target.instanceId ? { ...card, rested: false } : card,
          ),
        }),
        log: [`→ ${zone.card.name} をアクティブ`],
      };
    case "power_modifier":
      return {
        state: withSide(state, target.owner, {
          ...side,
          board: side.board.map((card) =>
            card.instanceId === target.instanceId
              ? { ...card, powerModifier: card.powerModifier + action.amount }
              : card,
          ),
        }),
        log: [`→ ${zone.card.name} のパワー ${signed(action.amount)}`],
      };
    case "cost_modifier":
      return {
        state: withSide(state, target.owner, {
          ...side,
          board: side.board.map((card) =>
            card.instanceId === target.instanceId
              ? { ...card, costModifier: card.costModifier + action.amount }
              : card,
          ),
        }),
        log: [`→ ${zone.card.name} のコスト ${signed(action.amount)}`],
      };
    default:
      return { state, log: ["→ 未対応の対象処理"] };
  }
}

function signed(value: number): string {
  return value >= 0 ? `+${value}` : String(value);
}
