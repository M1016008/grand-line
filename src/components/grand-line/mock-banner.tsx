import Link from "next/link";

export function MockBanner() {
  return (
    <div className="border-source-unverified/40 bg-source-unverified/10 text-source-unverified mb-6 rounded-lg border px-4 py-3 text-sm">
      <strong className="font-semibold">モックデータ表示中。</strong>{" "}
      Turso と <code className="font-mono text-xs">.env.local</code> の設定後、
      <code className="font-mono text-xs">npm run scrape:bandai-jp -- --set OP01</code>{" "}
      で本物のカードを取り込めます。
      <Link href="https://docs.turso.tech/cli" className="ml-2 underline">
        Turso CLI セットアップ →
      </Link>
    </div>
  );
}
