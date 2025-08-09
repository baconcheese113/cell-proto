import type { EnemyDef, EnemyKind, WeaponDef, Wave } from "./types.ts";

export const ENEMIES: Record<EnemyKind, EnemyDef> = {
  Slime: {
    kind: "Slime",
    stats: { maxHp: 20, moveSpeed: 90, dmg: 5, fireRate: 0 },
    ai: "melee_chase",
    tint: 0x8ef58a, radius: 12,
  },
  Spitter: {
    kind: "Spitter",
    stats: { maxHp: 18, moveSpeed: 70, dmg: 4, fireRate: 1.2 },
    ai: "ranged_kite",
    tint: 0x6ed0ff, radius: 10,
  },
  Swarmlet: {
    kind: "Swarmlet",
    stats: { maxHp: 6, moveSpeed: 120, dmg: 2, fireRate: 0 },
    ai: "swarm",
    tint: 0xffb3a7, radius: 6,
  },
} as const satisfies Record<EnemyKind, EnemyDef>;

export const WEAPONS = {
  BasicRibosome: {
    name: "BasicRibosome",
    cooldownMs: 180,
    projectileSpeed: 520,
    onHit: "damage",
  },
  PhageBurst: {
    name: "PhageBurst",
    cooldownMs: 900,
    projectileSpeed: 0,
    spread: 360,
    onHit: "dot",
  },
} as const satisfies Record<string, WeaponDef>;

export const WAVES: Wave[] = [
  { t: 3,  spawns: [{ kind: "Slime", count: 6 }] },
  { t: 15, spawns: [{ kind: "Slime", count: 6 }, { kind: "Spitter", count: 2 }] },
  { t: 30, spawns: [{ kind: "Swarmlet", count: 25, near: "player" }] },
] as const;
