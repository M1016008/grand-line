import { BattleArena } from "@/components/grand-line/battle-arena";
import { MockBanner } from "@/components/grand-line/mock-banner";
import { SiteHeader } from "@/components/grand-line/site-header";
import { listCards } from "@/lib/cards";

export const dynamic = "force-dynamic";

export const metadata = { title: "対戦 — Grand Line" };

export default async function BattlePage() {
  const [leaders, pool] = await Promise.all([
    listCards({ cardType: "LEADER", pageSize: 200 }),
    listCards({ pageSize: 5000, includeOfficialText: true }),
  ]);

  const usingMock = leaders.usingMock || pool.usingMock;

  return (
    <>
      <SiteHeader />
      <main className="mx-auto flex w-full max-w-7xl flex-1 flex-col gap-6 px-4 py-6">
        <header className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="text-primary/80 text-xs tracking-[0.4em] uppercase">
              インタラクティブ対戦
            </p>
            <h1 className="font-display text-3xl tracking-wide">CPU対戦</h1>
            <p className="text-muted-foreground mt-2 text-sm">
              CPU対戦練習で、構築の勝率や判断力を実戦的にチェックします。
            </p>
          </div>
          <div className="text-muted-foreground text-sm">
            {pool.totalAll.toLocaleString()} 枚 · 5段階CPU
          </div>
        </header>

        {usingMock ? <MockBanner /> : null}

        <BattleArena
          leaders={leaders.cards}
          pool={pool.cards}
          usingMock={usingMock}
        />
      </main>
    </>
  );
}
