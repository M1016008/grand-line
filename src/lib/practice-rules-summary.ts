export interface RulesOutcomeSummaryInput {
  games: number;
  playerWins: number;
  opponentWins: number;
  firstPlayerResolvedGames: number;
  firstPlayerWins: number;
  secondPlayerResolvedGames: number;
  secondPlayerWins: number;
  resolvedTurnTotal: number;
}

export function summarizeStoredRulesOutcomes(input: RulesOutcomeSummaryInput) {
  const resolvedGames = input.playerWins + input.opponentWins;
  return {
    resolvedGames,
    inconclusiveGames: input.games - resolvedGames,
    resolutionRate: rate(resolvedGames, input.games),
    resolvedWinRate: nullableRate(input.playerWins, resolvedGames),
    firstPlayerWinRate: nullableRate(
      input.firstPlayerWins,
      input.firstPlayerResolvedGames,
    ),
    secondPlayerWinRate: nullableRate(
      input.secondPlayerWins,
      input.secondPlayerResolvedGames,
    ),
    averageResolvedTurns: nullableRate(input.resolvedTurnTotal, resolvedGames),
  };
}

function nullableRate(numerator: number, denominator: number): number | null {
  return denominator > 0 ? numerator / denominator : null;
}

function rate(numerator: number, denominator: number): number {
  return denominator > 0 ? numerator / denominator : 0;
}
