export type StatBlock = {
  maxHp: number; moveSpeed: number; dmg: number; fireRate: number;
};

export type EnemyKind = "Slime" | "Spitter" | "Swarmlet";
export type ItemKind = "ATP" | "Amino" | "Signal";

export type EnemyDef = {
  kind: EnemyKind;
  stats: StatBlock;
  ai: "melee_chase" | "ranged_kite" | "swarm";
  tint?: number; radius?: number;
};

export type WeaponDef = {
  name: string;
  cooldownMs: number;
  projectileSpeed: number;
  spread?: number; // degrees
  onHit: "damage" | "slow" | "dot";
};

export type Wave = {
  t: number; // seconds from start
  spawns: Array<{ kind: EnemyKind; count: number; near?: "player"|"random" }>;
};
