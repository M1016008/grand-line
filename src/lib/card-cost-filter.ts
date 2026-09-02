export type CardCostFilter = number | { atLeast: number };

/** Convert the URL cost bucket into the query-layer representation. */
export function parseCardCostFilter(value: string | undefined): CardCostFilter | undefined {
  if (!value) return undefined;
  if (value === "8+") return { atLeast: 8 };
  if (!/^\d+$/.test(value)) return undefined;

  const exactCost = Number(value);
  return Number.isSafeInteger(exactCost) ? exactCost : undefined;
}

/** Shared by the mock path and unit tests; null-cost leaders never match. */
export function matchesCardCost(
  cardCost: number | null,
  filter: CardCostFilter | undefined,
): boolean {
  if (filter === undefined) return true;
  if (cardCost === null) return false;
  return typeof filter === "number" ? cardCost === filter : cardCost >= filter.atLeast;
}
