/**
 * Shared types for the Bandai Japan scraper.
 *
 * The scraper exists to populate `cards` + `card_translations(language='ja',
 * source='official_jp')`. Anything we can't pull from the page (e.g. English
 * translation, computed mechanics) is layered on later by other modules.
 */

export interface ScrapedCard {
  /** `OP01-001` style id, exactly as printed on the card. */
  id: string;
  /** Set code derived from the id prefix (`OP01`, `ST01`, …). */
  setCode: string;
  cardType: "LEADER" | "CHARACTER" | "EVENT" | "STAGE" | "DON";
  colors: string[];
  /** Logical attribute tags (slash, strike, ranged, special, wisdom). */
  attributes: string[];
  features: string[];
  cost: number | null;
  power: number | null;
  counter: number | null;
  life: number | null;
  rarity: string | null;
  hasTrigger: boolean;
  imageUrlJp: string | null;

  name: string;
  effectText: string | null;
  flavorText: string | null;
  triggerText: string | null;

  sourceUrl: string;
  fetchedAt: Date;
}

/**
 * Raw HTML fixture envelope. Saved to `data/raw/bandai-jp/<setCode>.html`
 * (gitignored) so we can iterate on the parser without re-fetching.
 */
export interface RawSetFixture {
  setCode: string;
  fetchedAt: Date;
  url: string;
  html: string;
}

export interface ScrapeRunOptions {
  /** Set code to scrape, e.g. `"OP01"`. */
  setCode: string;
  /**
   * If true, the scraper reads from `data/raw/bandai-jp/<setCode>.html`
   * instead of hitting the network. Use this for parser iteration.
   */
  fromFixture: boolean;
  /** Skip persisting to DB; just print parsed JSON to stdout. */
  dryRun: boolean;
}
