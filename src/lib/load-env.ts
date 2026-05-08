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

// Most-specific first; later loads do not override earlier ones.
config({ path: ".env.local" });
config({ path: ".env" });
