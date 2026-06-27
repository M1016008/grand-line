"use client";

import { useMemo, useState } from "react";
import {
  Bot,
  Hand,
  Play,
  RefreshCw,
  Shield,
  Swords,
  User,
  Zap,
} from "lucide-react";

import { ColorChip } from "@/components/grand-line/color-chip";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { CPU_LEVELS, cpuSkillRank, type CpuSkill } from "@/lib/practice-log";
import { buildPracticeDeck, type PracticeDeck } from "@/lib/practice-sim";
import { proxiedCardImage } from "@/lib/img";
import { cn } from "@/lib/utils";
import { useDeckDraft } from "@/stores/deck";
import type { CardListItem } from "@/lib/cards";

interface BattleArenaProps {
  leaders: CardListItem[];
  pool: CardListItem[];
  usingMock: boolean;
}

interface ZoneCard {
  id: string;
  card: CardListItem;
  rested: boolean;
  turnPlayed: number;
}

interface BattleSide {
  deckName: string;
  leader: CardListItem;
  deck: CardListItem[];
  hand: CardListItem[];
  lifeCards: CardListItem[];
  board: ZoneCard[];
  trash: CardListItem[];
  donAvailable: number;
  donUsed: number;
  donDeck: number;
  leaderRested: boolean;
}

interface BattleState {
  seed: number;
  turn: number;
  phase: "player" | "finished";
  player: BattleSide;
  opponent: BattleSide;
  selectedHandIndex: number | null;
  log: string[];
  winner?: "player" | "opponent";
}

type BattleAction =
  | { type: "leader" }
  | { type: "character"; zoneId: string };

const FIELD_SLOTS = 5;
const MAX_LOG_LINES = 12;

export function BattleArena({ leaders, pool, usingMock }: BattleArenaProps) {
  const [playerLeaderId, setPlayerLeaderId] = useState(leaders[0]?.id ?? "");
  const [opponentLeaderId, setOpponentLeaderId] = useState(
    leaders[1]?.id ?? leaders[0]?.id ?? "",
  );
  const [cpuSkill, setCpuSkill] = useState<CpuSkill>("level1");
  const [seed, setSeed] = useState(9301);
  const [battle, setBattle] = useState<BattleState | null>(null);

  const draftLeaderId = useDeckDraft((s) => s.leaderId);
  const draftEntries = useDeckDraft((s) => s.entries);

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
  const selectedLevel = CPU_LEVELS.find((level) => level.value === cpuSkill) ?? CPU_LEVELS[0];
  const selectedCard =
    battle?.selectedHandIndex !== null && battle?.selectedHandIndex !== undefined
      ? battle.player.hand[battle.selectedHandIndex]
      : null;
  const canAct = battle?.phase === "player" && !battle.winner;

  function startBattle(nextSeed = seed) {
    if (!playerDeck || !opponentDeck) return;
    const rng = mulberry32(nextSeed);
    const initial: BattleState = {
      seed: nextSeed,
      turn: 1,
      phase: "player",
      player: setupSide(playerDeck, rng),
      opponent: setupSide(opponentDeck, rng),
      selectedHandIndex: null,
      log: [],
    };
    setBattle(beginPlayerTurn(initial, true));
  }

  function playSelectedCard() {
    if (!battle || battle.phase !== "player" || battle.selectedHandIndex === null) return;
    setBattle((current) => {
      if (!current || current.phase !== "player" || current.selectedHandIndex === null) {
        return current;
      }
      const card = current.player.hand[current.selectedHandIndex];
      if (!card) return current;
      const cost = card.cost ?? 0;
      const remainingDon = current.player.donAvailable - current.player.donUsed;
      if (cost > remainingDon) {
        return appendLog(current, `${card.name} はDON!!が足りません。`);
      }
      if (card.cardType === "CHARACTER" && current.player.board.length >= FIELD_SLOTS) {
        return appendLog(current, "キャラエリアがいっぱいです。");
      }

      const hand = current.player.hand.filter((_, index) => index !== current.selectedHandIndex);
      let player: BattleSide = {
        ...current.player,
        hand,
        donUsed: current.player.donUsed + cost,
      };
      let opponent = current.opponent;
      const log = [...current.log];

      if (card.cardType === "CHARACTER") {
        player = {
          ...player,
          board: [
            ...player.board,
            {
              id: `${card.id}:${current.turn}:${current.player.board.length}:${player.trash.length}`,
              card,
              rested: false,
              turnPlayed: current.turn,
            },
          ],
        };
        log.push(`${card.name} を登場させた。`);
      } else {
        const effect = resolveTacticCard(player, opponent, card);
        player = effect.player;
        opponent = effect.opponent;
        log.push(effect.message);
      }

      return trimLog({
        ...current,
        player,
        opponent,
        selectedHandIndex: null,
        log,
      });
    });
  }

  function attack(action: BattleAction) {
    if (!battle || battle.phase !== "player" || battle.turn === 1) return;
    setBattle((current) => {
      if (!current || current.phase !== "player" || current.turn === 1) return current;
      const attacker =
        action.type === "leader"
          ? {
              name: current.player.leader.name,
              power: current.player.leader.power ?? 5000,
              rested: current.player.leaderRested,
            }
          : (() => {
              const zone = current.player.board.find((item) => item.id === action.zoneId);
              if (!zone) return null;
              return {
                name: zone.card.name,
                power: zone.card.power ?? 3000,
                rested: zone.rested || zone.turnPlayed >= current.turn,
              };
            })();
      if (!attacker || attacker.rested) return current;

      const player =
        action.type === "leader"
          ? { ...current.player, leaderRested: true }
          : {
              ...current.player,
              board: current.player.board.map((item) =>
                item.id === action.zoneId ? { ...item, rested: true } : item,
              ),
            };
      const resolved = resolveAttack({
        attackerName: attacker.name,
        attackPower: attacker.power,
        attacker: "player",
        defender: current.opponent,
        cpuSkill,
        rng: mulberry32(current.seed + current.turn * 337),
      });
      const next: BattleState = {
        ...current,
        player,
        opponent: resolved.defender,
        log: [...current.log, resolved.message],
      };
      if (resolved.defeated) {
        return finishBattle(next, "player", `${attacker.name} がリーダーへ通した。`);
      }
      return trimLog(next);
    });
  }

  function endTurn() {
    if (!battle || battle.phase !== "player") return;
    setBattle((current) => {
      if (!current || current.phase !== "player") return current;
      const afterCpu = runCpuTurn(current, cpuSkill);
      if (afterCpu.winner) return afterCpu;
      return beginPlayerTurn({ ...afterCpu, turn: afterCpu.turn + 1 }, false);
    });
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
            setBattle(null);
          }}
        />
        <LeaderSelect
          label="CPU"
          value={opponentLeaderId}
          leaders={leaders}
          onChange={(value) => {
            setOpponentLeaderId(value);
            setBattle(null);
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
                  setBattle(null);
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
          モックカードで表示中です。
        </div>
      ) : null}

      <section className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_340px]">
        <div
          className="border-border/50 relative overflow-hidden rounded-lg border p-3 shadow-2xl"
          style={{
            backgroundImage:
              "linear-gradient(135deg, rgba(27,65,59,.95), rgba(24,38,68,.96) 48%, rgba(76,45,29,.9))",
          }}
        >
          <div className="pointer-events-none absolute inset-0 opacity-35 [background-image:linear-gradient(rgba(255,255,255,.06)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,.06)_1px,transparent_1px)] [background-size:34px_34px]" />
          <div className="relative grid gap-3">
            <SideBoard
              side="opponent"
              state={battle?.opponent}
              leader={opponentLeader}
              cpuLevel={selectedLevel.label}
            />
            <div className="border-border/50 bg-background/45 grid min-h-16 grid-cols-[1fr_auto_1fr] items-center gap-3 rounded-lg border px-3 py-2 backdrop-blur">
              <div className="text-muted-foreground truncate text-xs">
                {battle ? `Turn ${battle.turn}` : "Ready"}
              </div>
              <Badge
                variant={battle?.winner ? "default" : battle?.turn === 1 ? "secondary" : "outline"}
                className="font-mono"
              >
                {battle?.winner
                  ? battle.winner === "player"
                    ? "YOU WIN"
                    : "CPU WIN"
                  : battle
                    ? battle.turn === 1
                      ? "NO ATTACK"
                      : "MAIN"
                    : "SETUP"}
              </Badge>
              <div className="text-muted-foreground truncate text-right text-xs">
                {battle?.log.at(-1) ?? "CPUレベルを選んで開始"}
              </div>
            </div>
            <SideBoard
              side="player"
              state={battle?.player}
              leader={playerLeader}
              currentTurn={battle?.turn ?? 0}
              onSelectAttacker={(zoneId) => attack({ type: "character", zoneId })}
              canAttack={Boolean(canAct && battle && battle.turn > 1)}
            />
            <HandRow
              hand={battle?.player.hand ?? []}
              selectedIndex={battle?.selectedHandIndex ?? null}
              disabled={!canAct}
              onSelect={(index) =>
                setBattle((current) =>
                  current ? { ...current, selectedHandIndex: index } : current,
                )
              }
            />
          </div>
        </div>

        <aside className="grid content-start gap-3">
          <Card className="border-border/40 bg-card/50">
            <CardContent className="space-y-3 p-4">
              <div className="flex items-center justify-between gap-3">
                <h2 className="font-display text-lg tracking-wide">アクション</h2>
                <Badge variant="outline">{selectedLevel.label}</Badge>
              </div>
              <div className="grid grid-cols-3 gap-2">
                <Metric label="Life" value={String(battle?.player.lifeCards.length ?? "-")} />
                <Metric
                  label="DON"
                  value={
                    battle
                      ? `${battle.player.donAvailable - battle.player.donUsed}/${battle.player.donAvailable}`
                      : "-"
                  }
                />
                <Metric label="Deck" value={String(battle?.player.deck.length ?? "-")} />
              </div>
              <div className="grid gap-2">
                <Button
                  type="button"
                  onClick={playSelectedCard}
                  disabled={!canAct || !selectedCard}
                  className="w-full"
                >
                  <Zap className="size-4" />
                  プレイ
                </Button>
                <Button
                  type="button"
                  variant="secondary"
                  onClick={() => attack({ type: "leader" })}
                  disabled={
                    !canAct ||
                    !battle ||
                    battle.turn === 1 ||
                    battle.player.leaderRested
                  }
                  className="w-full"
                >
                  <Swords className="size-4" />
                  リーダー攻撃
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  onClick={endTurn}
                  disabled={!canAct}
                  className="w-full"
                >
                  ターン終了
                </Button>
              </div>
              {selectedCard ? (
                <div className="border-border/40 bg-background/30 rounded-md border p-3">
                  <CardLine card={selectedCard} />
                </div>
              ) : (
                <p className="text-muted-foreground text-sm">手札を選択</p>
              )}
            </CardContent>
          </Card>

          <Card className="border-border/40 bg-card/50">
            <CardContent className="space-y-3 p-4">
              <div className="flex items-center justify-between gap-3">
                <h2 className="font-display text-lg tracking-wide">ログ</h2>
                <Badge variant="secondary">{battle?.log.length ?? 0}</Badge>
              </div>
              <ol className="space-y-2 text-sm">
                {(battle?.log ?? ["対戦を開始してください。"]).slice(-MAX_LOG_LINES).map((line, index) => (
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
        className="border-input bg-background h-9 w-full rounded-md border px-3 text-sm outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
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
          <span className="text-muted-foreground">
            life {leader.life ?? 5} · {leader.power ?? 5000}
          </span>
        </div>
      ) : null}
    </label>
  );
}

function SideBoard({
  side,
  state,
  leader,
  cpuLevel,
  canAttack,
  currentTurn = 0,
  onSelectAttacker,
}: {
  side: "player" | "opponent";
  state?: BattleSide;
  leader: CardListItem;
  cpuLevel?: string;
  canAttack?: boolean;
  currentTurn?: number;
  onSelectAttacker?: (zoneId: string) => void;
}) {
  const isOpponent = side === "opponent";
  const board = state?.board ?? [];
  const life = state?.lifeCards.length ?? leader.life ?? 5;
  return (
    <div
      className={cn(
        "grid gap-3",
        isOpponent
          ? "grid-cols-[88px_minmax(0,1fr)_88px]"
          : "grid-cols-[88px_minmax(0,1fr)_88px]",
      )}
    >
      <PileColumn
        deckCount={state?.deck.length ?? 50}
        trashTop={state?.trash.at(-1)}
        don={`${state?.donAvailable ?? 0}/${state?.donDeck ?? 10}`}
        flipped={isOpponent}
      />
      <div className="grid gap-2">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            {isOpponent ? <Bot className="size-4" /> : <User className="size-4" />}
            <span className="truncate text-sm font-semibold">
              {isOpponent ? "CPU" : "YOU"}
            </span>
            {cpuLevel ? <Badge variant="outline">{cpuLevel}</Badge> : null}
          </div>
          <LifePips count={life} />
        </div>
        <div className="grid grid-cols-5 gap-2">
          {Array.from({ length: FIELD_SLOTS }, (_, index) => {
            const zone = board[index];
            return (
              <BoardSlot
                key={zone?.id ?? `${side}:slot:${index}`}
                zone={zone}
                flipped={isOpponent}
                canAttack={Boolean(
                  canAttack && zone && !zone.rested && zone.turnPlayed < currentTurn,
                )}
                onAttack={zone ? () => onSelectAttacker?.(zone.id) : undefined}
              />
            );
          })}
        </div>
        {isOpponent ? <OpponentHand count={state?.hand.length ?? 5} /> : null}
      </div>
      <LeaderColumn
        leader={leader}
        rested={state?.leaderRested ?? false}
        flipped={isOpponent}
      />
    </div>
  );
}

function BoardSlot({
  zone,
  flipped,
  canAttack,
  onAttack,
}: {
  zone?: ZoneCard;
  flipped?: boolean;
  canAttack?: boolean;
  onAttack?: () => void;
}) {
  return (
    <div className="border-border/35 bg-background/20 relative flex aspect-[3/4] min-h-28 items-center justify-center rounded-md border">
      {zone ? (
        <>
          <CardPortrait
            card={zone.card}
            flipped={flipped}
            rested={zone.rested}
            className="h-full w-full"
          />
          {canAttack ? (
            <Button
              type="button"
              size="icon"
              variant="secondary"
              className="absolute right-1 bottom-1 size-7"
              onClick={onAttack}
              aria-label={`${zone.card.name}で攻撃`}
            >
              <Swords className="size-3.5" />
            </Button>
          ) : null}
        </>
      ) : (
        <span className="text-muted-foreground/50 text-[10px]">FIELD</span>
      )}
    </div>
  );
}

function LeaderColumn({
  leader,
  rested,
  flipped,
}: {
  leader: CardListItem;
  rested: boolean;
  flipped?: boolean;
}) {
  return (
    <div className="grid gap-2">
      <div className="flex items-center gap-1 text-muted-foreground text-[11px]">
        <Shield className="size-3" />
        LEADER
      </div>
      <CardPortrait card={leader} flipped={flipped} rested={rested} />
    </div>
  );
}

function PileColumn({
  deckCount,
  trashTop,
  don,
  flipped,
}: {
  deckCount: number;
  trashTop?: CardListItem;
  don: string;
  flipped?: boolean;
}) {
  return (
    <div className="grid gap-2">
      <MiniPile label="DECK" value={String(deckCount)} flipped={flipped} />
      <div className="border-border/35 bg-background/20 aspect-[3/4] overflow-hidden rounded-md border">
        {trashTop ? (
          <CardPortrait card={trashTop} flipped={flipped} />
        ) : (
          <div className="text-muted-foreground/60 flex h-full items-center justify-center text-[10px]">
            TRASH
          </div>
        )}
      </div>
      <MiniPile label="DON!!" value={don} accent />
    </div>
  );
}

function MiniPile({
  label,
  value,
  accent,
  flipped,
}: {
  label: string;
  value: string;
  accent?: boolean;
  flipped?: boolean;
}) {
  return (
    <div
      className={cn(
        "border-border/35 flex aspect-[3/4] flex-col items-center justify-center rounded-md border text-center font-mono",
        accent ? "bg-primary/20 text-primary" : "bg-background/30 text-muted-foreground",
        flipped && "rotate-180",
      )}
    >
      <span className="text-[10px]">{label}</span>
      <span className="text-lg font-semibold">{value}</span>
    </div>
  );
}

function OpponentHand({ count }: { count: number }) {
  return (
    <div className="flex h-16 items-end justify-center gap-1 overflow-hidden">
      {Array.from({ length: count }, (_, index) => (
        <div
          key={index}
          className="border-primary/30 h-14 w-10 rotate-180 rounded-sm border bg-[linear-gradient(145deg,rgba(20,28,52,.95),rgba(209,171,80,.35))] shadow"
        />
      ))}
    </div>
  );
}

function HandRow({
  hand,
  selectedIndex,
  disabled,
  onSelect,
}: {
  hand: CardListItem[];
  selectedIndex: number | null;
  disabled?: boolean;
  onSelect: (index: number) => void;
}) {
  return (
    <div className="border-border/45 bg-background/40 rounded-lg border p-2">
      <div className="mb-2 flex items-center gap-2 text-sm font-semibold">
        <Hand className="size-4" />
        手札
        <Badge variant="secondary">{hand.length}</Badge>
      </div>
      <div className="grid grid-cols-5 gap-2 md:grid-cols-7 lg:grid-cols-10">
        {hand.map((card, index) => (
          <button
            key={`${card.id}:${index}`}
            type="button"
            disabled={disabled}
            onClick={() => onSelect(index)}
            className={cn(
              "focus-visible:ring-ring rounded-md outline-none focus-visible:ring-2",
              selectedIndex === index && "ring-primary ring-2",
            )}
          >
            <CardPortrait card={card} compact />
          </button>
        ))}
      </div>
    </div>
  );
}

function CardPortrait({
  card,
  flipped,
  rested,
  compact,
  className,
}: {
  card: CardListItem;
  flipped?: boolean;
  rested?: boolean;
  compact?: boolean;
  className?: string;
}) {
  const img = proxiedCardImage(card.imageUrlJp);
  return (
    <div
      className={cn(
        "border-border/40 bg-card/80 relative aspect-[3/4] overflow-hidden rounded-md border",
        rested && "rotate-90 opacity-85",
        flipped && !rested && "rotate-180",
        compact ? "min-h-24" : "min-h-28",
        className,
      )}
    >
      {img ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={img} alt={card.name} className="h-full w-full object-cover" />
      ) : (
        <div className="text-muted-foreground flex h-full items-center justify-center p-2 text-center text-[10px]">
          {card.name}
        </div>
      )}
      <div className="absolute inset-x-0 bottom-0 bg-black/65 px-1 py-0.5 text-[9px] leading-tight">
        <div className="truncate">{card.name}</div>
        <div className="text-muted-foreground font-mono">
          {card.cost !== null ? `C${card.cost}` : "L"} {card.power ?? ""}
        </div>
      </div>
    </div>
  );
}

function LifePips({ count }: { count: number }) {
  return (
    <div className="flex items-center gap-1">
      {Array.from({ length: Math.max(0, count) }, (_, index) => (
        <span
          key={index}
          className="bg-primary h-3 w-2 rounded-sm shadow-[0_0_10px_rgba(245,200,90,.35)]"
        />
      ))}
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="border-border/40 bg-background/30 rounded-md border p-2">
      <div className="text-muted-foreground text-[10px] uppercase">{label}</div>
      <div className="font-mono text-lg">{value}</div>
    </div>
  );
}

function CardLine({ card }: { card: CardListItem }) {
  return (
    <div className="min-w-0">
      <div className="text-muted-foreground font-mono text-[11px]">{card.id}</div>
      <div className="truncate text-sm font-semibold">{card.name}</div>
      <div className="text-muted-foreground mt-1 flex flex-wrap gap-2 text-[11px]">
        {card.cost !== null ? <span>cost {card.cost}</span> : null}
        {card.power !== null ? <span>power {card.power}</span> : null}
        {card.counter !== null ? <span>counter {card.counter}</span> : null}
      </div>
    </div>
  );
}

function setupSide(deck: PracticeDeck, rng: () => number): BattleSide {
  const pile = materialize(deck);
  shuffle(pile, rng);
  const hand = pile.splice(0, 5);
  const lifeCards = pile.splice(0, deck.leader.life ?? 5).reverse();
  return {
    deckName: deck.name,
    leader: deck.leader,
    deck: pile,
    hand,
    lifeCards,
    board: [],
    trash: [],
    donAvailable: 0,
    donUsed: 0,
    donDeck: 10,
    leaderRested: false,
  };
}

function beginPlayerTurn(state: BattleState, firstTurn: boolean): BattleState {
  let player = refreshSide(state.player);
  const log = [...state.log, `Turn ${state.turn}: あなたのターン`];
  if (!firstTurn) {
    const drawn = drawOne(player);
    player = drawn.side;
    if (drawn.deckOut) return finishBattle({ ...state, player, log }, "opponent", "山札切れ。");
  }
  player = addDon(player, firstTurn ? 1 : 2);
  return trimLog({
    ...state,
    phase: "player",
    player,
    selectedHandIndex: null,
    log,
  });
}

function runCpuTurn(state: BattleState, cpuSkill: CpuSkill): BattleState {
  const rank = cpuSkillRank(cpuSkill);
  const rng = mulberry32(state.seed + state.turn * 1009 + rank * 41);
  let opponent = addDon(refreshSide(state.opponent), 2);
  let player = state.player;
  const log = [...state.log, `Turn ${state.turn}: CPUのターン`];
  const drawn = drawOne(opponent);
  opponent = drawn.side;
  if (drawn.deckOut) return finishBattle({ ...state, opponent, log }, "player", "CPUが山札切れ。");

  const maxPlays = [1, 1, 2, 2, 3][rank - 1] ?? 1;
  for (let i = 0; i < maxPlays; i++) {
    const index = chooseCpuCard(opponent, player, cpuSkill);
    if (index === null) break;
    const played = playCpuCard(opponent, player, index, state.turn);
    opponent = played.opponent;
    player = played.player;
    log.push(played.message);
  }

  if (state.turn > 1) {
    const leaderAttack = resolveAttack({
      attackerName: opponent.leader.name,
      attackPower: (opponent.leader.power ?? 5000) + (rank - 3) * 250,
      attacker: "opponent",
      defender: player,
      cpuSkill,
      rng,
    });
    opponent = { ...opponent, leaderRested: true };
    player = leaderAttack.defender;
    log.push(leaderAttack.message);
    if (leaderAttack.defeated) {
      return finishBattle({ ...state, player, opponent, log }, "opponent", "CPUリーダーの攻撃。");
    }

    if (rank >= 3) {
      for (const zone of opponent.board.filter((item) => !item.rested && item.turnPlayed < state.turn)) {
        const attack = resolveAttack({
          attackerName: zone.card.name,
          attackPower: (zone.card.power ?? 3000) + (rank - 3) * 200,
          attacker: "opponent",
          defender: player,
          cpuSkill,
          rng,
        });
        opponent = {
          ...opponent,
          board: opponent.board.map((item) =>
            item.id === zone.id ? { ...item, rested: true } : item,
          ),
        };
        player = attack.defender;
        log.push(attack.message);
        if (attack.defeated) {
          return finishBattle({ ...state, player, opponent, log }, "opponent", "CPUの盤面打点。");
        }
      }
    }
  }

  return trimLog({ ...state, player, opponent, log });
}

function playCpuCard(
  opponent: BattleSide,
  player: BattleSide,
  handIndex: number,
  turn: number,
): { opponent: BattleSide; player: BattleSide; message: string } {
  const card = opponent.hand[handIndex];
  const hand = opponent.hand.filter((_, index) => index !== handIndex);
  const cost = card.cost ?? 0;
  let nextOpponent: BattleSide = {
    ...opponent,
    hand,
    donUsed: opponent.donUsed + cost,
  };
  if (card.cardType === "CHARACTER" && opponent.board.length < FIELD_SLOTS) {
    nextOpponent = {
      ...nextOpponent,
      board: [
        ...opponent.board,
        {
          id: `cpu:${card.id}:${turn}:${opponent.board.length}`,
          card,
          rested: false,
          turnPlayed: turn,
        },
      ],
    };
    return { opponent: nextOpponent, player, message: `CPU: ${card.name} を登場。` };
  }
  const effect = resolveTacticCard(nextOpponent, player, card);
  return {
    opponent: effect.player,
    player: effect.opponent,
    message: `CPU: ${effect.message}`,
  };
}

function chooseCpuCard(
  opponent: BattleSide,
  player: BattleSide,
  cpuSkill: CpuSkill,
): number | null {
  const remainingDon = opponent.donAvailable - opponent.donUsed;
  const playable = opponent.hand
    .map((card, index) => ({ card, index, score: battleCardScore(card, player, cpuSkill) }))
    .filter((item) => (item.card.cost ?? 0) <= remainingDon)
    .filter((item) => item.card.cardType !== "CHARACTER" || opponent.board.length < FIELD_SLOTS);
  if (playable.length === 0) return null;
  const rank = cpuSkillRank(cpuSkill);
  playable.sort((a, b) => b.score - a.score || (b.card.cost ?? 0) - (a.card.cost ?? 0));
  if (rank === 1) return playable[playable.length - 1].index;
  if (rank === 2) {
    return (
      playable.find((item) => (item.card.cost ?? 0) <= Math.max(1, remainingDon - 1)) ??
      playable[0]
    ).index;
  }
  return playable[0].index;
}

function resolveTacticCard(
  player: BattleSide,
  opponent: BattleSide,
  card: CardListItem,
): { player: BattleSide; opponent: BattleSide; message: string } {
  let nextPlayer = { ...player, trash: [...player.trash, card] };
  if (
    opponent.board.length > 0 &&
    (card.mechanics.includes("KORemoval") ||
      card.mechanics.includes("RestOpponentCard") ||
      card.mechanics.includes("ReturnToHand"))
  ) {
    const target = opponent.board[0];
    const nextOpponent = {
      ...opponent,
      board: opponent.board.slice(1),
      trash: [...opponent.trash, target.card],
    };
    return {
      player: nextPlayer,
      opponent: nextOpponent,
      message: `${card.name} で ${target.card.name} を処理。`,
    };
  }
  if (card.mechanics.includes("Draw") || card.mechanics.includes("Search")) {
    const drawn = drawOne(nextPlayer);
    nextPlayer = drawn.side;
    return {
      player: nextPlayer,
      opponent,
      message: `${card.name} で手札を整えた。`,
    };
  }
  return {
    player: nextPlayer,
    opponent,
    message: `${card.name} を使用。`,
  };
}

function resolveAttack({
  attackerName,
  attackPower,
  attacker,
  defender,
  cpuSkill,
  rng,
}: {
  attackerName: string;
  attackPower: number;
  attacker: "player" | "opponent";
  defender: BattleSide;
  cpuSkill: CpuSkill;
  rng: () => number;
}): { defender: BattleSide; message: string; defeated: boolean } {
  const rank = cpuSkillRank(cpuSkill);
  const guard =
    attacker === "player"
      ? rank >= 3
        ? estimateCounter(defender.hand, rank)
        : 0
      : estimateCounter(defender.hand, Math.max(1, 6 - rank));
  const defenseLine = (defender.leader.power ?? 5000) + guard;
  const variance = Math.floor(rng() * 600);
  if (attackPower + variance < defenseLine) {
    return {
      defender,
      message: `${attackerName} の攻撃は守られた。`,
      defeated: false,
    };
  }
  const damaged = dealLifeDamage(defender);
  return {
    defender: damaged.side,
    message: damaged.card
      ? `${attackerName} が1点。ライフから ${damaged.card.name}。`
      : `${attackerName} が勝負を決めた。`,
    defeated: damaged.defeated,
  };
}

function dealLifeDamage(side: BattleSide): {
  side: BattleSide;
  card?: CardListItem;
  defeated: boolean;
} {
  const [card, ...rest] = side.lifeCards;
  if (!card) return { side, defeated: true };
  const next = {
    ...side,
    lifeCards: rest,
    hand: [...side.hand, card],
  };
  return { side: next, card, defeated: rest.length === 0 };
}

function finishBattle(
  state: BattleState,
  winner: "player" | "opponent",
  message: string,
): BattleState {
  return trimLog({
    ...state,
    phase: "finished",
    winner,
    selectedHandIndex: null,
    log: [...state.log, message, winner === "player" ? "あなたの勝ち。" : "CPUの勝ち。"],
  });
}

function refreshSide(side: BattleSide): BattleSide {
  return {
    ...side,
    donUsed: 0,
    leaderRested: false,
    board: side.board.map((item) => ({ ...item, rested: false })),
  };
}

function addDon(side: BattleSide, amount: number): BattleSide {
  const actual = Math.min(amount, side.donDeck, 10 - side.donAvailable);
  return {
    ...side,
    donAvailable: side.donAvailable + actual,
    donDeck: side.donDeck - actual,
  };
}

function drawOne(side: BattleSide): { side: BattleSide; deckOut: boolean } {
  const [card, ...deck] = side.deck;
  if (!card) return { side, deckOut: true };
  return {
    side: {
      ...side,
      deck,
      hand: [...side.hand, card],
    },
    deckOut: false,
  };
}

function estimateCounter(hand: CardListItem[], rank: number): number {
  const usable = hand
    .map((card) => card.counter ?? 0)
    .filter((counter) => counter > 0)
    .sort((a, b) => b - a)
    .slice(0, rank >= 4 ? 2 : 1);
  return Math.min(3000, usable.reduce((acc, value) => acc + value, 0));
}

function battleCardScore(card: CardListItem, opponent: BattleSide, cpuSkill: CpuSkill): number {
  const rank = cpuSkillRank(cpuSkill);
  const curve = card.cost === null ? 0 : Math.max(0, 12 - Math.abs(card.cost - 3) * 2);
  const power = (card.power ?? 0) / 700;
  const counter = rank >= 4 && opponent.lifeCards.length <= 2 ? (card.counter ?? 0) / 700 : 0;
  const mechanics =
    card.mechanics.filter((item) =>
      ["Rush", "OnPlay", "OnAttack", "Draw", "Search", "KORemoval", "Blocker"].includes(item),
    ).length * (rank >= 3 ? 4 : 2);
  return curve + power + counter + mechanics + rank;
}

function materialize(deck: PracticeDeck): CardListItem[] {
  return deck.entries.flatMap((entry) =>
    Array.from({ length: entry.count }, () => entry.card),
  );
}

function shuffle<T>(items: T[], rng: () => number): void {
  for (let i = items.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [items[i], items[j]] = [items[j], items[i]];
  }
}

function mulberry32(seed: number) {
  let t = seed >>> 0;
  return () => {
    t += 0x6d2b79f5;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

function appendLog(state: BattleState, line: string): BattleState {
  return trimLog({ ...state, log: [...state.log, line] });
}

function trimLog(state: BattleState): BattleState {
  return {
    ...state,
    log: state.log.slice(-MAX_LOG_LINES),
  };
}
