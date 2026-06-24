// CpmReplication — the binary delta codec for host-authoritative lattice
// replication (the networking seam the plan wants from day one).
//
// The host runs the one true CPM simulation and exports a per-pixel snapshot
// (CpmSimulation.snapshotKinds — 1 byte/pixel). A full 220^2 lattice is ~48 KB;
// sending that every frame is far too much (the reason the JSON stateChannel
// doesn't fit). Instead we send a DELTA from the client's last-known frame:
// CPM changes only ~5-10% of pixels per step, so a dirty-segment encoding shrinks
// the payload by ~10-20x. The client is a pure deterministic renderer — it
// applies deltas and never re-simulates (Monte-Carlo flips would diverge).
//
// Wire format (delta): a sequence of segments
//   varint(unchangedRun) varint(changedRun) changedBytes[changedRun]
// repeated until the end of the lattice. The decoder copies unchanged bytes from
// the previous frame and overwrites the changed runs.

/** Append a LEB128 unsigned varint to a byte array. */
function writeVarint(out: number[], value: number): void {
  let v = value >>> 0;
  while (v >= 0x80) {
    out.push((v & 0x7f) | 0x80);
    v >>>= 7;
  }
  out.push(v);
}

function readVarint(buf: Uint8Array, pos: { i: number }): number {
  let result = 0,
    shift = 0,
    byte: number;
  do {
    byte = buf[pos.i++];
    result |= (byte & 0x7f) << shift;
    shift += 7;
  } while (byte & 0x80);
  return result >>> 0;
}

/** Encode `curr` as a delta from `prev` (same length; prev may be all-zeros for
 *  a keyframe). Returns a compact byte array. */
export function encodeLatticeDelta(prev: Uint8Array, curr: Uint8Array): Uint8Array {
  const n = curr.length;
  const out: number[] = [];
  let i = 0;
  while (i < n) {
    let same = 0;
    while (i < n && prev[i] === curr[i]) {
      same++;
      i++;
    }
    writeVarint(out, same);
    const start = i;
    while (i < n && prev[i] !== curr[i]) i++;
    const changed = i - start;
    writeVarint(out, changed);
    for (let k = start; k < i; k++) out.push(curr[k]);
  }
  return Uint8Array.from(out);
}

/** Apply a delta to `prev`, producing the next frame. `prev` is not mutated. */
export function applyLatticeDelta(prev: Uint8Array, delta: Uint8Array): Uint8Array {
  const out = prev.slice();
  const pos = { i: 0 };
  let dst = 0;
  while (pos.i < delta.length) {
    const same = readVarint(delta, pos);
    dst += same; // unchanged bytes already correct in the copy
    const changed = readVarint(delta, pos);
    for (let k = 0; k < changed; k++) out[dst++] = delta[pos.i++];
  }
  return out;
}
