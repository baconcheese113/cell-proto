import { test } from "node:test";
import assert from "node:assert/strict";
import { footprintDeltaH } from "./footprint-cost.ts";

const HOST = 1;
const ENEMY = 0; // background
const LAMBDA = 30;

test("no cost off the footprint", () => {
  const mark = new Uint8Array(4); // none marked
  assert.equal(footprintDeltaH(mark, HOST, 2, ENEMY, HOST, LAMBDA), 0);
});

test("penalizes removing host cytoplasm from a footprint pixel", () => {
  const mark = new Uint8Array([0, 1, 0, 0]);
  // pixel 1 is footprint, currently host (tgt_type=HOST), would become bg (src_type=0)
  assert.equal(footprintDeltaH(mark, HOST, 1, 0, HOST, LAMBDA), LAMBDA);
});

test("rewards covering a footprint pixel with host cytoplasm", () => {
  const mark = new Uint8Array([0, 1, 0, 0]);
  // pixel 1 is footprint, currently bg (tgt_type=0), would become host (src_type=HOST)
  assert.equal(footprintDeltaH(mark, HOST, 1, HOST, 0, LAMBDA), -LAMBDA);
});

test("no cost for host->host or bg->bg on a footprint pixel", () => {
  const mark = new Uint8Array([0, 1, 0, 0]);
  assert.equal(footprintDeltaH(mark, HOST, 1, HOST, HOST, LAMBDA), 0);
  assert.equal(footprintDeltaH(mark, HOST, 1, 0, 0, LAMBDA), 0);
});
