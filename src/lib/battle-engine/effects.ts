export type EffectTrigger =
  | "on_play"
  | "on_attack"
  | "when_attacking"
  | "trigger"
  | "activate_main"
  | "main";

export type Duration = "battle" | "turn" | "until_next_turn" | "permanent";

export interface TargetSpec {
  owner: "own" | "opponent" | "either";
  zones: Array<"character" | "leader">;
  state?: "rested" | "active";
  maxCost?: number;
  minCost?: number;
  maxPower?: number;
  minPower?: number;
  feature?: string;
  color?: string;
  count: number;
}

export type EffectAction =
  | { type: "draw"; count: number }
  | { type: "search"; lookAt: number; count: number; cardType?: string; feature?: string; color?: string; nameIncludes?: string; minCost?: number; maxCost?: number; excludeName?: string }
  | { type: "ko"; target: TargetSpec }
  | { type: "return_to_hand"; target: TargetSpec }
  | { type: "return_to_deck"; target: TargetSpec; position: "top" | "bottom" }
  | { type: "rest"; target: TargetSpec }
  | { type: "activate"; target: TargetSpec }
  | { type: "power_modifier"; target: TargetSpec; amount: number; duration: Duration }
  | { type: "cost_modifier"; target: TargetSpec; amount: number; duration: Duration }
  | { type: "add_life"; count: number; from: "deck" | "hand" }
  | { type: "take_life"; count: number; destination: "hand" | "trash" }
  | { type: "play_self"; rested?: boolean };

export interface TriggeredEffect {
  id: string;
  trigger: EffectTrigger;
  actions: EffectAction[];
  sourceText: string;
}

export type EffectCoverageStatus = "supported" | "partial" | "unsupported";

export interface CardEffectDefinition {
  cardId: string;
  status: EffectCoverageStatus;
  rush: boolean;
  blocker: boolean;
  effects: TriggeredEffect[];
  unsupportedReasons: string[];
}

export function isTargetedAction(
  action: EffectAction,
): action is Extract<EffectAction, { target: TargetSpec }> {
  return "target" in action;
}
