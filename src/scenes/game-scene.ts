import Phaser from "phaser";
import { ENEMIES, WEAPONS, WAVES } from "../content.ts";
import type { EnemyKind } from "../types.ts";

type Actor = {
  // Image when created via add.image; Matter plugin may attach a body at runtime.
  sprite: Phaser.GameObjects.Image;
  kind: string;
  hp: number;
  radius: number;
  speed: number;
  targetId?: number;
};

export class GameScene extends Phaser.Scene {
  cursors!: Phaser.Types.Input.Keyboard.CursorKeys;
  player!: Actor;
  enemies: Map<number, Actor> = new Map();
  projectiles: Set<Actor> = new Set();
  lastShot = 0;
  elapsed = 0;
  nextWaveIndex = 0;

  create() {
    this.cursors = this.input.keyboard!.createCursorKeys();
    this.input.mouse!.disableContextMenu();

    // Player (procedural circle)
    const p = this.addCircle(0x9cf6ff, 16).setPosition(480, 270);
    this.matter.add.gameObject(p, { shape: { type: "circle", radius: 16 }, frictionAir: 0.12 });
    this.player = { sprite: p, kind: "Player", hp: 100, radius: 16, speed: 220 };

    // Camera follows
    this.cameras.main.startFollow(p as Phaser.GameObjects.GameObject, true, 0.1, 0.1);

    // UI text
    this.add.text(12, 12, "WASD to move, mouse to aim, LMB shoot", { fontFamily: "monospace", color: "#9cf6ff" }).setScrollFactor(0);

    // Quick test: few enemies
    // this.time.addEvent({ delay: 800, repeat: 2, callback: () => this.spawnEnemy("Slime") });
  }

  update(_: number, dtMs: number) {
    const dt = dtMs / 1000;
    this.elapsed += dt;

    // movement
    const dir = new Phaser.Math.Vector2(
      (this.cursors.right?.isDown ? 1 : 0) - (this.cursors.left?.isDown ? 1 : 0),
      (this.cursors.down?.isDown ? 1 : 0) - (this.cursors.up?.isDown ? 1 : 0)
    ).normalize();

    const vel = dir.scale(this.player.speed);
    (this.player.sprite.body as MatterJS.BodyType).force = { x: vel.x * 0.0006, y: vel.y * 0.0006 };

    // aim & shoot
    const mx = this.input.activePointer.worldX, my = this.input.activePointer.worldY;
    if (this.input.activePointer.isDown) this.tryShoot(mx, my);

    // enemy AI
    this.enemies.forEach(e => this.tickEnemy(e, dt));

    // waves
    if (this.nextWaveIndex < WAVES.length && this.elapsed >= WAVES[this.nextWaveIndex].t) {
      for (const s of WAVES[this.nextWaveIndex].spawns) {
        for (let i = 0; i < s.count; i++) this.spawnEnemy(s.kind, s.near);
      }
      this.nextWaveIndex++;
    }

    // cleanup dead projectiles
    this.projectiles.forEach(p => {
      const s = p.sprite;
      if (!this.cameras.main.worldView.contains(s.x, s.y)) this.destroyProjectile(p);
    });
  }

  // ——— Helpers ———
  addCircle(tint: number, r: number) {
    const key = `circle_${tint}_${r}`;
    if (!this.textures.exists(key)) {
      const g = this.add.graphics();
      g.fillStyle(tint, 1);
      g.fillCircle(r + 2, r + 2, r);
      const w = r * 2 + 4, h = r * 2 + 4;
      g.generateTexture(key, w, h);
      g.destroy();
    }
    const s = this.add.image(0, 0, key);
    s.setDisplaySize(r * 2, r * 2);
    return s;
  }

  spawnEnemy(kind: EnemyKind, near?: "player"|"random") {
    const def = ENEMIES[kind];
    const basePos = near === "player"
      ? (this.player.sprite as any)
      : { x: this.cameras.main.worldView.centerX, y: this.cameras.main.worldView.centerY };

    const offset = Phaser.Math.RandomXY(new Phaser.Math.Vector2(), 200 + Math.random()*200);
    const x = basePos.x + offset.x, y = basePos.y + offset.y;

    const s = this.addCircle(def.tint ?? 0xffffff, def.radius ?? 10).setPosition(x, y);
    this.matter.add.gameObject(s, { shape: { type: "circle", radius: def.radius ?? 10 }, frictionAir: 0.06 });
  const id = (s.body as MatterJS.BodyType | null | undefined)?.id ?? Phaser.Math.RND.integer();
  this.enemies.set(id, {
      sprite: s, kind, hp: def.stats.maxHp, radius: def.radius ?? 10, speed: def.stats.moveSpeed
    });
  }

  tickEnemy(e: Actor, _dt: number) {
    // simple chase
    const ep = e.sprite as any, pp = this.player.sprite as any;
    const v = new Phaser.Math.Vector2(pp.x - ep.x, pp.y - ep.y).normalize().scale(e.speed);
    (e.sprite.body as MatterJS.BodyType).force = { x: v.x * 0.0005, y: v.y * 0.0005 };

    // contact damage
    const d2 = Phaser.Math.Distance.Squared(ep.x, ep.y, pp.x, pp.y);
    const r = e.radius + this.player.radius;
    if (d2 < r*r) {
      // tiny damage tick (placeholder)
      // you can add i-frames & timers
    }
  }

  tryShoot(mx: number, my: number) {
    const w = WEAPONS.BasicRibosome;
    const now = performance.now();
    if (now - this.lastShot < w.cooldownMs) return;
    this.lastShot = now;

    const p = this.player.sprite as any;
    const dir = new Phaser.Math.Vector2(mx - p.x, my - p.y).normalize();
    const start = new Phaser.Math.Vector2(p.x, p.y).add(dir.clone().scale(this.player.radius + 6));

    // projectile
    const s = this.addCircle(0xfff5a3, 4).setPosition(start.x, start.y);
    this.matter.add.gameObject(s, { shape: { type: "circle", radius: 4 }, frictionAir: 0, ignoreGravity: true });
    (s.body as MatterJS.BodyType).velocity = { x: dir.x * w.projectileSpeed, y: dir.y * w.projectileSpeed };

    const a: Actor = { sprite: s, kind: "Projectile", hp: 1, radius: 4, speed: w.projectileSpeed };
    this.projectiles.add(a);

    // simple hit detection via overlap check each frame
    this.time.addEvent({
      delay: 16, loop: true,
      callback: () => {
        const sp = s as any;
        let hitId: number | undefined;
        this.enemies.forEach((en, id) => {
          const d2 = Phaser.Math.Distance.Squared(sp.x, sp.y, (en.sprite as any).x, (en.sprite as any).y);
          if (d2 < (en.radius + a.radius) ** 2) hitId = id;
        });
        if (hitId !== undefined) {
          const en = this.enemies.get(hitId)!;
          en.hp -= 10;
          this.makeHitEffect(en.sprite as any);
          if (en.hp <= 0) { (en.sprite as Phaser.GameObjects.Image).destroy(); this.enemies.delete(hitId!); }
          this.destroyProjectile(a);
        }
      }
    });
  }

  destroyProjectile(p: Actor) {
    (p.sprite as Phaser.GameObjects.Image).destroy();
    this.projectiles.delete(p);
  }

  makeHitEffect(pos: {x:number,y:number}) {
    // Copilot-friendly parametric burst
    for (let i=0;i<10;i++) {
  const s = this.addCircle(0xffe08a, 2).setPosition(pos.x, pos.y);
      this.tweens.add({
        targets: s, alpha: 0, scale: { from: 1, to: 0.2 },
        x: s.x + Phaser.Math.Between(-20,20), y: s.y + Phaser.Math.Between(-20,20),
        duration: 180, onComplete: () => s.destroy()
      });
    }
  }
}
