"use client";

import { useMemo, useState } from "react";
import { Bot, Hand, Play, RefreshCw, Shield, Swords, User, Zap } from "lucide-react";

import { ColorChip } from "@/components/grand-line/color-chip";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { calculateDeckCoverage, type DeckEffectCoverage } from "@/lib/battle-engine/coverage";
import { BattleEffectRegistry } from "@/lib/battle-engine/effect-registry";
import {
  acceptAttack,
  attachDon,
  chooseBlocker,
  chooseEffectTarget,
  createBattleState,
  declareCharacterAttack,
  declareLeaderAttack,
  endPlayerTurn,
  playCard,
  resolveTriggerChoice,
  useCounterCard,
} from "@/lib/battle-engine/engine";
import {
  effectiveCharacterPower,
  effectiveLeaderPower,
} from "@/lib/battle-engine/selectors";
import type { BattleSide, BattleState, BattleZoneCard } from "@/lib/battle-engine/state";
import type { CardListItem } from "@/lib/cards";
import { proxiedCardImage } from "@/lib/img";
import { CPU_LEVELS, type CpuSkill } from "@/lib/practice-log";
import { buildPracticeDeck } from "@/lib/practice-sim";
import { cn } from "@/lib/utils";
import { useDeckDraft } from "@/stores/deck";

interface BattleArenaProps {
  leaders: CardListItem[];
  pool: CardListItem[];
  usingMock: boolean;
}

export function BattleArena({ leaders, pool, usingMock }: BattleArenaProps) {
  const [playerLeaderId, setPlayerLeaderId] = useState(leaders[0]?.id ?? "");
  const [opponentLeaderId, setOpponentLeaderId] = useState(
    leaders[1]?.id ?? leaders[0]?.id ?? "",
  );
  const [cpuSkill, setCpuSkill] = useState<CpuSkill>("level1");
  const [seed, setSeed] = useState(9301);
  const [battle, setBattle] = useState<BattleState | null>(null);
  const [selectedHandIndex, setSelectedHandIndex] = useState<number | null>(null);
  const [donTarget, setDonTarget] = useState("player:leader");

  const draftLeaderId = useDeckDraft((state) => state.leaderId);
  const draftEntries = useDeckDraft((state) => state.entries);
  const playerLeader = leaders.find((leader) => leader.id === playerLeaderId) ?? leaders[0];
  const opponentLeader =
    leaders.find((leader) => leader.id === opponentLeaderId) ??
    leaders.find((leader) => leader.id !== playerLeader?.id) ??
    leaders[0];
  const localDraftEntries = useMemo(
    () => (draftLeaderId === playerLeader?.id ? Object.values(draftEntries) : []),
    [draftEntries, draftLeaderId, playerLeader?.id],
  );
  const playerDeck = useMemo(
    () => (playerLeader ? buildPracticeDeck(playerLeader, pool, localDraftEntries) : null),
    [localDraftEntries, playerLeader, pool],
  );
  const opponentDeck = useMemo(
    () => (opponentLeader ? buildPracticeDeck(opponentLeader, pool) : null),
    [opponentLeader, pool],
  );
  const registry = useMemo(() => new BattleEffectRegistry(pool), [pool]);
  const playerCoverage = useMemo(
    () => (playerDeck ? calculateDeckCoverage(playerDeck, registry) : null),
    [playerDeck, registry],
  );
  const opponentCoverage = useMemo(
    () => (opponentDeck ? calculateDeckCoverage(opponentDeck, registry) : null),
    [opponentDeck, registry],
  );
  const selectedLevel = CPU_LEVELS.find((level) => level.value === cpuSkill) ?? CPU_LEVELS[0];
  const selectedCard =
    selectedHandIndex === null ? null : battle?.player.hand[selectedHandIndex] ?? null;
  const canAct = Boolean(
    battle && !battle.winner && !battle.pending && battle.activePlayer === "player",
  );

  function resetBattle(): void {
    setBattle(null);
    setSelectedHandIndex(null);
    setDonTarget("player:leader");
  }

  function startBattle(nextSeed = seed): void {
    if (!playerDeck || !opponentDeck) return;
    setBattle(createBattleState(playerDeck, opponentDeck, nextSeed));
    setSelectedHandIndex(null);
    setDonTarget("player:leader");
  }

  if (!playerLeader || !opponentLeader || !playerDeck || !opponentDeck) {
    return (
      <Card className="border-border/40 bg-card/40">
        <CardContent className="text-muted-foreground p-10 text-center text-sm">
          対戦に使えるリーダーがまだありません。
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <section className="grid gap-3 lg:grid-cols-[1fr_1fr_1.4fr_auto]">
        <LeaderSelect
          label="自分"
          value={playerLeaderId}
          leaders={leaders}
          onChange={(value) => {
            setPlayerLeaderId(value);
            resetBattle();
          }}
        />
        <LeaderSelect
          label="CPU"
          value={opponentLeaderId}
          leaders={leaders}
          onChange={(value) => {
            setOpponentLeaderId(value);
            resetBattle();
          }}
        />
        <div className="border-border/40 bg-card/40 rounded-lg border p-3">
          <div className="mb-2 flex items-center justify-between gap-2">
            <span className="text-muted-foreground text-xs">CPUレベル</span>
            <Badge variant="outline">{selectedLevel.label}</Badge>
          </div>
          <div className="grid grid-cols-5 gap-1">
            {CPU_LEVELS.map((level, index) => (
              <Button
                key={level.value}
                type="button"
                variant={level.value === cpuSkill ? "default" : "secondary"}
                size="sm"
                className="h-9 px-0 font-mono"
                onClick={() => {
                  setCpuSkill(level.value);
                  resetBattle();
                }}
              >
                {index + 1}
              </Button>
            ))}
          </div>
          <p className="text-muted-foreground mt-2 min-h-8 text-xs leading-relaxed">
            {selectedLevel.detail}
          </p>
        </div>
        <div className="border-border/40 bg-card/40 flex min-w-44 flex-col justify-between rounded-lg border p-3">
          <div className="text-muted-foreground text-xs">seed {seed}</div>
          <div className="flex gap-2">
            <Button
              type="button"
              variant="secondary"
              size="icon"
              onClick={() => {
                const nextSeed = seed + 97;
                setSeed(nextSeed);
                startBattle(nextSeed);
              }}
              aria-label="seed更新"
            >
              <RefreshCw className="size-4" />
            </Button>
            <Button type="button" className="flex-1" onClick={() => startBattle()}>
              <Play className="size-4" />
              開始
            </Button>
          </div>
        </div>
      </section>

      {usingMock ? (
        <div className="border-source-unverified/30 bg-source-unverified/10 text-source-unverified rounded-lg border px-3 py-2 text-sm">
          モックカードではverified effect coverageを保証できません。
        </div>
      ) : null}

      <section className="grid gap-3 md:grid-cols-2">
        <CoveragePanel title="自分の効果再現率" coverage={playerCoverage} />
        <CoveragePanel title="CPUの効果再現率" coverage={opponentCoverage} />
      </section>
      {playerCoverage && opponentCoverage && (!playerCoverage.complete || !opponentCoverage.complete) ? (
        <div className="border-amber-500/40 bg-amber-500/10 rounded-lg border px-4 py-3 text-sm text-amber-100">
          この対戦は完全再現ではありません。partial / unsupported効果は近似せず、ログへ明示します。
        </div>
      ) : null}

      <section className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
        <div className="border-border/50 relative overflow-hidden rounded-lg border bg-[linear-gradient(135deg,rgba(27,65,59,.95),rgba(24,38,68,.96)_48%,rgba(76,45,29,.9))] p-3 shadow-2xl">
          <div className="relative grid gap-3">
            <SideBoard
              owner="opponent"
              state={battle}
              fallbackLeader={opponentLeader}
              registry={registry}
            />
            <div className="border-border/50 bg-background/45 grid min-h-16 grid-cols-[1fr_auto_1fr] items-center gap-3 rounded-lg border px-3 py-2 backdrop-blur">
              <div className="text-muted-foreground truncate text-xs">
                {battle ? `Turn ${battle.turn}` : "Ready"}
              </div>
              <Badge variant={battle?.winner ? "default" : "outline"} className="font-mono">
                {battle?.winner
                  ? battle.winner === "player"
                    ? "YOU WIN"
                    : "CPU WIN"
                  : battle?.pending
                    ? "DECISION"
                    : battle?.activePlayer === "opponent"
                      ? "CPU"
                      : battle?.turn === 1
                        ? "NO ATTACK"
                        : "MAIN"}
              </Badge>
              <div className="text-muted-foreground truncate text-right text-xs">
                {battle?.log.at(-1) ?? "効果再現率を確認して開始"}
              </div>
            </div>
            <SideBoard
              owner="player"
              state={battle}
              fallbackLeader={playerLeader}
              registry={registry}
              canAct={canAct}
              onAttack={(instanceId) =>
                setBattle((current) =>
                  current
                    ? declareCharacterAttack(current, "player", instanceId, registry, cpuSkill)
                    : current,
                )
              }
            />
            <HandRow
              hand={battle?.player.hand ?? []}
              selectedIndex={selectedHandIndex}
              disabled={!canAct}
              onSelect={setSelectedHandIndex}
            />
          </div>
        </div>

        <aside className="grid content-start gap-3">
          <PendingDecision battle={battle} registry={registry} onChange={setBattle} />
          <Card className="border-border/40 bg-card/50">
            <CardContent className="space-y-3 p-4">
              <div className="flex items-center justify-between gap-3">
                <h2 className="font-display text-lg tracking-wide">アクション</h2>
                <Badge variant="outline">Rules Kernel v1</Badge>
              </div>
              <div className="grid grid-cols-3 gap-2">
                <Metric label="Life" value={String(battle?.player.lifeCards.length ?? "-")} />
                <Metric
                  label="DON"
                  value={
                    battle
                      ? `${battle.player.donTotal - battle.player.donRested}/${battle.player.donTotal}`
                      : "-"
                  }
                />
                <Metric label="Deck" value={String(battle?.player.deck.length ?? "-")} />
              </div>
              <div className="grid gap-2">
                <Button
                  type="button"
                  disabled={!canAct || !selectedCard || selectedHandIndex === null}
                  onClick={() => {
                    if (selectedHandIndex === null) return;
                    setBattle((current) =>
                      current
                        ? playCard(current, "player", selectedHandIndex, registry)
                        : current,
                    );
                    setSelectedHandIndex(null);
                  }}
                >
                  <Zap className="size-4" />
                  プレイ
                </Button>
                <Button
                  type="button"
                  variant="secondary"
                  disabled={!canAct || !battle || battle.turn === 1 || battle.player.leaderRested}
                  onClick={() =>
                    setBattle((current) =>
                      current
                        ? declareLeaderAttack(current, "player", registry, cpuSkill)
                        : current,
                    )
                  }
                >
                  <Swords className="size-4" />
                  リーダー攻撃
                </Button>
                <div className="grid grid-cols-[1fr_auto] gap-2">
                  <select
                    value={donTarget}
                    onChange={(event) => setDonTarget(event.target.value)}
                    className="border-input bg-background h-9 min-w-0 rounded-md border px-2 text-xs"
                    aria-label="DON!!付与先"
                  >
                    <option value="player:leader">リーダー</option>
                    {(battle?.player.board ?? []).map((zone) => (
                      <option key={zone.instanceId} value={zone.instanceId}>
                        {zone.card.name}
                      </option>
                    ))}
                  </select>
                  <Button
                    type="button"
                    variant="outline"
                    disabled={!canAct || !battle || battle.player.donTotal <= battle.player.donRested}
                    onClick={() =>
                      setBattle((current) =>
                        current ? attachDon(current, "player", donTarget) : current,
                      )
                    }
                  >
                    DON!!付与
                  </Button>
                </div>
                <Button
                  type="button"
                  variant="outline"
                  disabled={!canAct}
                  onClick={() =>
                    setBattle((current) =>
                      current ? endPlayerTurn(current, registry, cpuSkill) : current,
                    )
                  }
                >
                  ターン終了
                </Button>
              </div>
              {selectedCard ? <CardLine card={selectedCard} /> : null}
            </CardContent>
          </Card>

          <Card className="border-border/40 bg-card/50">
            <CardContent className="space-y-3 p-4">
              <div className="flex items-center justify-between gap-3">
                <h2 className="font-display text-lg tracking-wide">効果解決ログ</h2>
                <Badge variant="secondary">{battle?.log.length ?? 0}</Badge>
              </div>
              <ol className="max-h-96 space-y-1 overflow-y-auto font-mono text-xs">
                {(battle?.log ?? ["対戦を開始してください。"]).slice(-24).map((line, index) => (
                  <li key={`${index}:${line}`} className="text-muted-foreground leading-relaxed">
                    {line}
                  </li>
                ))}
              </ol>
            </CardContent>
          </Card>
        </aside>
      </section>
    </div>
  );
}

function PendingDecision({
  battle,
  registry,
  onChange,
}: {
  battle: BattleState | null;
  registry: BattleEffectRegistry;
  onChange: React.Dispatch<React.SetStateAction<BattleState | null>>;
}) {
  const pending = battle?.pending;
  if (!pending) return null;
  return (
    <Card className="border-primary/40 bg-primary/10">
      <CardContent className="space-y-3 p-4">
        <h2 className="font-display text-lg">選択が必要です</h2>
        {pending.type === "effect_target" ? (
          <>
            <p className="text-sm">{pending.sourceName} の合法対象を選択</p>
            <div className="grid gap-2">
              {pending.legalTargets.map((target) => (
                <Button
                  key={target.instanceId}
                  type="button"
                  variant="secondary"
                  onClick={() =>
                    onChange((current) =>
                      current
                        ? chooseEffectTarget(current, target.instanceId, registry)
                        : current,
                    )
                  }
                >
                  {target.label}
                </Button>
              ))}
            </div>
          </>
        ) : null}
        {pending.type === "defense" ? (
          <>
            <p className="text-sm">
              {pending.attackerName}：{pending.attackPower} / 現在のCounter +{pending.counterPower}
            </p>
            {pending.blockerOptions.length > 0 && !pending.selectedBlocker ? (
              <div className="grid gap-2">
                <span className="text-muted-foreground text-xs">Blocker candidate</span>
                {pending.blockerOptions.map((target) => (
                  <Button
                    key={target.instanceId}
                    type="button"
                    variant="secondary"
                    onClick={() =>
                      onChange((current) =>
                        current ? chooseBlocker(current, target.instanceId) : current,
                      )
                    }
                  >
                    {target.label} でブロック
                  </Button>
                ))}
              </div>
            ) : null}
            <div className="grid gap-2">
              {(battle?.player.hand ?? []).map((card, index) =>
                (card.counter ?? 0) > 0 ? (
                  <Button
                    key={`${card.id}:${index}`}
                    type="button"
                    variant="outline"
                    onClick={() =>
                      onChange((current) =>
                        current ? useCounterCard(current, index) : current,
                      )
                    }
                  >
                    {card.name} をカウンター使用 +{card.counter}
                  </Button>
                ) : null,
              )}
              <Button
                type="button"
                onClick={() =>
                  onChange((current) =>
                    current ? acceptAttack(current, registry) : current,
                  )
                }
              >
                {pending.counterPower > 0 ? "カウンターを使って解決" : "カウンターを使わず受ける"}
              </Button>
            </div>
          </>
        ) : null}
        {pending.type === "trigger" ? (
          <>
            <p className="text-sm">
              Lifeから {pending.revealedCard.id} {pending.revealedCard.name} を公開
            </p>
            <p className="text-muted-foreground text-xs">{pending.effect.sourceText}</p>
            <div className="grid grid-cols-2 gap-2">
              <Button
                type="button"
                onClick={() =>
                  onChange((current) =>
                    current ? resolveTriggerChoice(current, true, registry) : current,
                  )
                }
              >
                Trigger発動
              </Button>
              <Button
                type="button"
                variant="outline"
                onClick={() =>
                  onChange((current) =>
                    current ? resolveTriggerChoice(current, false, registry) : current,
                  )
                }
              >
                発動せず手札へ
              </Button>
            </div>
          </>
        ) : null}
      </CardContent>
    </Card>
  );
}

function CoveragePanel({ title, coverage }: { title: string; coverage: DeckEffectCoverage | null }) {
  if (!coverage) return null;
  const problemEntries = coverage.entries.filter((entry) => entry.status !== "supported");
  return (
    <Card className="border-border/40 bg-card/40">
      <CardContent className="space-y-2 p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="font-semibold">{title}</h2>
          <Badge variant={coverage.complete ? "default" : "outline"}>
            {coverage.supportedCards} / {coverage.totalCards} cards
          </Badge>
        </div>
        <div className="flex gap-3 text-xs">
          <span>supported {coverage.supportedCards}</span>
          <span className="text-amber-300">partial {coverage.partialCards}</span>
          <span className="text-red-300">unsupported {coverage.unsupportedCards}</span>
        </div>
        {problemEntries.length > 0 ? (
          <details className="text-muted-foreground text-xs">
            <summary className="cursor-pointer">未完全再現カードを表示</summary>
            <ul className="mt-2 space-y-1">
              {problemEntries.slice(0, 12).map((entry) => (
                <li key={entry.cardId}>
                  {entry.cardId} {entry.name} ×{entry.copies} — {entry.status}
                </li>
              ))}
            </ul>
          </details>
        ) : null}
      </CardContent>
    </Card>
  );
}

function LeaderSelect({
  label,
  value,
  leaders,
  onChange,
}: {
  label: string;
  value: string;
  leaders: CardListItem[];
  onChange: (value: string) => void;
}) {
  const leader = leaders.find((item) => item.id === value) ?? leaders[0];
  return (
    <label className="border-border/40 bg-card/40 grid gap-2 rounded-lg border p-3 text-xs">
      <span className="text-muted-foreground">{label}</span>
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="border-input bg-background h-9 w-full rounded-md border px-3 text-sm"
      >
        {leaders.map((item) => (
          <option key={item.id} value={item.id}>
            {item.id} · {item.name}
          </option>
        ))}
      </select>
      {leader ? (
        <div className="flex items-center gap-2">
          {leader.colors.map((color) => (
            <ColorChip key={color} color={color} />
          ))}
          <span className="text-muted-foreground">life {leader.life ?? 5}</span>
        </div>
      ) : null}
    </label>
  );
}

function SideBoard({
  owner,
  state,
  fallbackLeader,
  registry,
  canAct,
  onAttack,
}: {
  owner: "player" | "opponent";
  state: BattleState | null;
  fallbackLeader: CardListItem;
  registry: BattleEffectRegistry;
  canAct?: boolean;
  onAttack?: (instanceId: string) => void;
}) {
  const side = state?.[owner];
  const leader = side?.leader ?? fallbackLeader;
  const isOpponent = owner === "opponent";
  return (
    <div className="grid grid-cols-[76px_minmax(0,1fr)_88px] gap-3">
      <PileColumn side={side} flipped={isOpponent} />
      <div className="grid gap-2">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 text-sm font-semibold">
            {isOpponent ? <Bot className="size-4" /> : <User className="size-4" />}
            {isOpponent ? "CPU" : "YOU"}
          </div>
          <span className="font-mono text-xs">Life {side?.lifeCards.length ?? leader.life ?? 5}</span>
        </div>
        <div className="grid grid-cols-5 gap-2">
          {Array.from({ length: 5 }, (_, index) => {
            const zone = side?.board[index];
            const attackable = Boolean(
              canAct &&
                state &&
                state.turn > 1 &&
                zone &&
                !zone.rested &&
                (zone.playedTurn < state.turn || registry.isRush(zone.card.id)),
            );
            return (
              <BoardSlot
                key={zone?.instanceId ?? `${owner}:${index}`}
                zone={zone}
                flipped={isOpponent}
                canAttack={attackable}
                onAttack={zone ? () => onAttack?.(zone.instanceId) : undefined}
              />
            );
          })}
        </div>
        {isOpponent ? <div className="text-muted-foreground text-center text-xs">Hand {side?.hand.length ?? 5}</div> : null}
      </div>
      <div className="grid gap-2">
        <div className="flex items-center gap-1 text-muted-foreground text-[11px]">
          <Shield className="size-3" /> LEADER
        </div>
        <CardPortrait card={leader} rested={side?.leaderRested} flipped={isOpponent} />
        {side && state ? (
          <div className="text-center font-mono text-[10px]">
            {effectiveLeaderPower(state, owner)}
            {side.leaderAttachedDon > 0 ? ` · DON×${side.leaderAttachedDon}` : ""}
          </div>
        ) : null}
      </div>
    </div>
  );
}

function PileColumn({ side, flipped }: { side?: BattleSide; flipped?: boolean }) {
  return (
    <div className="grid gap-2 text-center font-mono text-[10px]">
      <MiniPile label="DECK" value={String(side?.deck.length ?? 50)} flipped={flipped} />
      <MiniPile label="TRASH" value={String(side?.trash.length ?? 0)} flipped={flipped} />
      <MiniPile label="DON!!" value={`${side?.donTotal ?? 0}/${side?.donDeck ?? 10}`} accent />
    </div>
  );
}

function MiniPile({ label, value, accent, flipped }: { label: string; value: string; accent?: boolean; flipped?: boolean }) {
  return (
    <div className={cn("border-border/35 flex aspect-[3/4] flex-col items-center justify-center rounded-md border", accent ? "bg-primary/20 text-primary" : "bg-background/30 text-muted-foreground", flipped && "rotate-180")}>
      <span>{label}</span><span className="text-lg font-semibold">{value}</span>
    </div>
  );
}

function BoardSlot({ zone, flipped, canAttack, onAttack }: { zone?: BattleZoneCard; flipped?: boolean; canAttack?: boolean; onAttack?: () => void }) {
  return (
    <div className="border-border/35 bg-background/20 relative flex aspect-[3/4] min-h-28 items-center justify-center rounded-md border">
      {zone ? (
        <>
          <CardPortrait card={zone.card} flipped={flipped} rested={zone.rested} />
          <div className="absolute top-1 left-1 rounded bg-black/75 px-1 font-mono text-[9px]">
            {effectiveCharacterPower(zone)}{zone.attachedDon > 0 ? ` D×${zone.attachedDon}` : ""}
          </div>
          {canAttack ? (
            <Button type="button" size="icon" variant="secondary" className="absolute right-1 bottom-1 size-7" onClick={onAttack} aria-label={`${zone.card.name}で攻撃`}>
              <Swords className="size-3.5" />
            </Button>
          ) : null}
        </>
      ) : <span className="text-muted-foreground/50 text-[10px]">FIELD</span>}
    </div>
  );
}

function HandRow({ hand, selectedIndex, disabled, onSelect }: { hand: CardListItem[]; selectedIndex: number | null; disabled?: boolean; onSelect: (index: number) => void }) {
  return (
    <div className="border-border/45 bg-background/40 rounded-lg border p-2">
      <div className="mb-2 flex items-center gap-2 text-sm font-semibold"><Hand className="size-4" />手札<Badge variant="secondary">{hand.length}</Badge></div>
      <div className="grid grid-cols-5 gap-2 md:grid-cols-7 lg:grid-cols-10">
        {hand.map((card, index) => (
          <button key={`${card.id}:${index}`} type="button" disabled={disabled} onClick={() => onSelect(index)} className={cn("focus-visible:ring-ring rounded-md outline-none focus-visible:ring-2", selectedIndex === index && "ring-primary ring-2")}>
            <CardPortrait card={card} compact />
          </button>
        ))}
      </div>
    </div>
  );
}

function CardPortrait({ card, flipped, rested, compact }: { card: CardListItem; flipped?: boolean; rested?: boolean; compact?: boolean }) {
  const image = proxiedCardImage(card.imageUrlJp);
  return (
    <div className={cn("border-border/40 bg-card/80 relative aspect-[3/4] w-full overflow-hidden rounded-md border", rested && "rotate-90 opacity-85", flipped && !rested && "rotate-180", compact ? "min-h-24" : "min-h-28")}>
      {image ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={image} alt={card.name} className="h-full w-full object-cover" />
      ) : (
        <div className="text-muted-foreground flex h-full items-center justify-center p-2 text-center text-[10px]">
          {card.name}
        </div>
      )}
      <div className="absolute inset-x-0 bottom-0 bg-black/70 px-1 py-0.5 text-[9px]"><div className="truncate">{card.name}</div><div className="font-mono">{card.cost === null ? "L" : `C${card.cost}`} {card.power ?? ""}</div></div>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return <div className="border-border/40 bg-background/30 rounded-md border p-2"><div className="text-muted-foreground text-[10px] uppercase">{label}</div><div className="font-mono text-lg">{value}</div></div>;
}

function CardLine({ card }: { card: CardListItem }) {
  return <div className="border-border/40 bg-background/30 rounded-md border p-3"><div className="text-muted-foreground font-mono text-[11px]">{card.id}</div><div className="truncate text-sm font-semibold">{card.name}</div><div className="text-muted-foreground mt-1 text-[11px]">cost {card.cost ?? "-"} · power {card.power ?? "-"} · counter {card.counter ?? 0}</div></div>;
}
