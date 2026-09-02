import test from "node:test";
import assert from "node:assert/strict";

import { ALL_SET_CODES, SERIES_PARAM, SET_NAMES_JP } from "./fetch";

const CURRENT_OFFICIAL_SETS: Record<string, string> = {
  OP16: "550116",
  OP17: "550117",
  ST31: "550031",
  ST32: "550032",
  ST33: "550033",
  ST34: "550034",
  ST35: "550035",
  ST36: "550036",
};

test("current official sets have stable series ids and Japanese names", () => {
  for (const [setCode, seriesId] of Object.entries(CURRENT_OFFICIAL_SETS)) {
    assert.equal(SERIES_PARAM[setCode], seriesId, `${setCode} series id`);
    assert.ok(SET_NAMES_JP[setCode]?.includes(setCode.slice(0, 2)), `${setCode} name`);
  }
});

test("current official sets are included in full scrape targets", () => {
  for (const setCode of Object.keys(CURRENT_OFFICIAL_SETS)) {
    assert.ok(ALL_SET_CODES.includes(setCode), `${setCode} must be refreshed by run-all`);
  }
});
