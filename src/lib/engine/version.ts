/**
 * Engine version constant.
 *
 * Kept in a dedicated module to avoid the circular-import trap where
 * state.ts → effect-dsl.ts paths would have to round-trip through
 * index.ts to read the version.
 *
 * Bump on:
 *  - Breaking changes to GameState shape.
 *  - Changes to phase progression or combat resolution that alter
 *    outcomes of identical-seed games.
 * Do NOT bump for:
 *  - Adding new cards to the registry.
 *  - Adding new Effect DSL tags (those bump DSL_VERSION instead).
 *  - Adding analytics / UI features.
 */
export const ENGINE_VERSION = "0.2.0-alpha";
