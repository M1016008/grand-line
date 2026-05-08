/**
 * CLI entry-point env loader.
 *
 * Next.js automatically loads `.env.local` (then `.env`) with the local
 * file taking precedence — but a standalone `tsx` script only sees the
 * default `.env` via `dotenv/config`. Every CLI script in this project
 * imports this module instead, which reproduces Next.js's resolution
 * order so `npm run db:status` and friends honour the same config the
 * dev server does.
 */
import { config } from "dotenv";

// Most-specific first; .env.local wins over .env.
//
// `override: true` is required because tsx 4.21+ auto-loads .env.local
// via dotenvx with a slightly different parser that occasionally skips
// values (Anthropic API keys with multiple `-` segments observed). When
// the parsers disagree we want dotenv (the standard) to be the source
// of truth.
config({ path: ".env.local", override: true });
config({ path: ".env" });
