import { MockBanner } from "@/components/grand-line/mock-banner";
import { PracticeLab } from "@/components/grand-line/practice-lab";
import { SiteHeader } from "@/components/grand-line/site-header";
import { listCards } from "@/lib/cards";

export const dynamic = "force-dynamic";

export const metadata = { title: "練習 — Grand Line" };

export default async function PracticePage() {
  const [leaders, pool] = await Promise.all([
    listCards({ cardType: "LEADER", pageSize: 200 }),
    listCards({ pageSize: 5000 }),
  ]);

  const usingMock = leaders.usingMock || pool.usingMock;

  return (
    <>
      <SiteHeader />
      <main className="mx-auto flex w-full max-w-7xl flex-1 flex-col gap-6 px-4 py-8">
        <header className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="text-primary/80 text-xs tracking-[0.4em] uppercase">
              Practice Lab
            </p>
            <h1 className="font-display text-3xl tracking-wide">
              コンピューター練習
            </h1>
          </div>
          <div className="text-muted-foreground text-sm">
            {pool.totalAll.toLocaleString()} 枚 · {leaders.total.toLocaleString()} リーダー
          </div>
        </header>

        {usingMock ? <MockBanner /> : null}

        <PracticeLab
          leaders={leaders.cards}
          pool={pool.cards}
          usingMock={usingMock}
        />
      </main>
    </>
  );
}
