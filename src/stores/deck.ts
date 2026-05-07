/**
 * Local-only deck draft state. Persists to localStorage so a refresh
 * doesn't blow away an in-progress build. Once auth + DB writes land
 * (Phase 2.5), drafts will be optionally synced to `decks` / `deck_cards`.
 */
import { create } from "zustand";
import { persist } from "zustand/middleware";

import type { CardListItem } from "@/lib/cards";
import type { DeckRuleCard } from "@/lib/deck-rules";

export interface DraftEntry {
  card: CardListItem;
  count: number;
}

interface DeckDraftState {
  leaderId: string | null;
  entries: Record<string, DraftEntry>;
  setLeader: (leaderId: string | null) => void;
  add: (card: CardListItem, n?: number) => void;
  remove: (cardId: string, n?: number) => void;
  clear: () => void;
  /** Project to the shape `validateDeck` expects. */
  asRuleCards: () => DeckRuleCard[];
}

export const useDeckDraft = create<DeckDraftState>()(
  persist(
    (set, get) => ({
      leaderId: null,
      entries: {},
      setLeader(leaderId) {
        set((s) =>
          s.leaderId === leaderId ? s : { leaderId, entries: {} },
        );
      },
      add(card, n = 1) {
        set((s) => {
          const existing = s.entries[card.id]?.count ?? 0;
          const next = Math.min(4, existing + n);
          return {
            entries: {
              ...s.entries,
              [card.id]: { card, count: next },
            },
          };
        });
      },
      remove(cardId, n = 1) {
        set((s) => {
          const existing = s.entries[cardId]?.count ?? 0;
          const next = existing - n;
          if (next <= 0) {
            const { [cardId]: _drop, ...rest } = s.entries;
            void _drop;
            return { entries: rest };
          }
          return {
            entries: {
              ...s.entries,
              [cardId]: { ...s.entries[cardId], count: next },
            },
          };
        });
      },
      clear() {
        set({ entries: {} });
      },
      asRuleCards() {
        return Object.values(get().entries).map((e) => ({
          id: e.card.id,
          cardType: e.card.cardType,
          colors: e.card.colors,
          count: e.count,
        }));
      },
    }),
    {
      name: "grand-line:deck-draft:v1",
      partialize: (s) => ({ leaderId: s.leaderId, entries: s.entries }),
    },
  ),
);
