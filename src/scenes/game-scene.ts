import Phaser from "phaser";
import { makeCellTexture, makeDotTexture, makeGridTexture, makeRingTexture, makeStationTexture } from "../gfx";

type Keys = Record<"W" | "A" | "S" | "D" | "E" | "Q", Phaser.Input.Keyboard.Key>;

type StationKind = "Ribosome" | "ER" | "Golgi" | "Lysosome";
type CarryStage = "none" | "poly" | "folded" | "tag_slow" | "tag_stun";

type Station = {
  kind: StationKind;
  pos: Phaser.Math.Vector2;      // relative to cellCenter
  drift: Phaser.Math.Vector2;    // slow bobbing
  sprite: Phaser.GameObjects.Image;
  label: Phaser.GameObjects.Text;
  radius: number;
  ready: boolean;                // for little pulse
};

type Socket = {
  angle: number;                 // radians around membrane
  pos: Phaser.Math.Vector2;      // world position, updated each frame
  ammo: number;                  // 0/1 (armed)
  tag?: 'slow' | 'stun';         // which tag loaded when armed
  sprite: Phaser.GameObjects.Image;
};

type Pathogen = {
  pos: Phaser.Math.Vector2;
  vel: Phaser.Math.Vector2;
  sprite: Phaser.GameObjects.Image;
  hooked: boolean;
  baseSpeed: number;
  slowWhileHooked: boolean;
  stunTimer: number;
  dwellAtMembrane: number; // seconds
};

export class GameScene extends Phaser.Scene {
  // ---------- Input & camera ----------
  private keys!: Keys;
  private grid!: Phaser.GameObjects.TileSprite;

  // ---------- World / cell ----------
  private worldCenter = new Phaser.Math.Vector2(0, 0);
  private cellCenter = new Phaser.Math.Vector2(0, 0);
  private orbitRadius = 800;
  private orbitAngularVel = 0.35;
  private orbitTheta = 0;
  private cellRadius = 220;
  private membraneThickness = 10;

  private cellSprite!: Phaser.GameObjects.Image;
  private lysosomeSprite!: Phaser.GameObjects.Image;

  // ---------- Player ----------
  private player!: Phaser.GameObjects.Image;
  private playerRing!: Phaser.GameObjects.Image;
  private moveSpeed = 300;
  private innerMargin = 14;
  private rel = new Phaser.Math.Vector2(0, 0); // player offset from cellCenter
  private carryStage: CarryStage = "none";
  private carrySprite?: Phaser.GameObjects.Image;

  // ---------- Stations / sockets ----------
  private stations: Station[] = [];
  private sockets: Socket[] = [];
  private socketCount = 6;
  private socketRange = 360; // px grapple range

  // ---------- Pathogens / grapple ----------
  private pathogens: Pathogen[] = [];
  private pathogenSpawnRadius = 340; // just outside membrane
  // private pathogenTargetRadius = this.cellRadius + this.membraneThickness * 0.5; // not used
  private grappleBeam?: Phaser.GameObjects.Graphics;
  private grappleFrom?: Socket;
  private grappleTarget?: Pathogen;

  // ---------- UI / score ----------
  private score = 0;
  private hudText!: Phaser.GameObjects.Text;
  private waveText!: Phaser.GameObjects.Text;
  private integrityBar!: Phaser.GameObjects.Graphics;
  private showHud = true;

  // ---------- Colors ----------
  private col = {
    bgDark: 0x0b0f14,
    gridBg: 0x0f1822,
    gridMinor: 0x172233,
    gridMajor: 0x233042,
    cellFill: 0x193247,
    membrane: 0x4fd1c5,
    lysFill: 0x2a2347,
    lysRim: 0xb07cff,
    player: 0xfff2a8,
    playerRing: 0xffe08a,
    stationRibo: 0x87e56a,
    stationER: 0x64c6ff,
    stationGolgi: 0xffb27d,
    socketArmed: 0x9cf6ff,
    socketEmpty: 0x335a66,
    pathogen: 0xff6961,
    pkgPoly: 0xeaff8f,
    pkgFold: 0xc3f0ff,
    pkgTagSlow: 0x80ffd2,
    pkgTagStun: 0xffd280,
    hudText: "#9cf6ff",
    hudGood: 0x78e08c,
    hudWarn: 0xffca6e,
    hudBad: 0xff6b6b,
  };

  // ---------- Wave director ----------
  private waveTime = 0;
  private nextWaveAt = 15;
  private waveIndex = 0;

  // ---------- Membrane integrity ----------
  private membraneIntegrity = 100;
  // (removed unused membraneTickAcc)

  create() {
    // Input
    this.keys = this.input.keyboard!.addKeys("W,A,S,D,E,Q") as Keys;
    this.input.mouse?.disableContextMenu();

    // Background grid
  const gridKey = makeGridTexture(this, 64, 64, this.col.gridBg, this.col.gridMinor, this.col.gridMajor);
    this.grid = this.add.tileSprite(0, 0, this.scale.width, this.scale.height, gridKey)
      .setOrigin(0, 0)
      .setScrollFactor(0);
    this.scale.on("resize", (sz: Phaser.Structs.Size) => this.grid.setSize(sz.width, sz.height));

    // Cell
  const cellKey = makeCellTexture(this, this.cellRadius * 2 + this.membraneThickness * 2, this.cellRadius, this.membraneThickness, this.col.cellFill, this.col.membrane);
    this.cellSprite = this.add.image(0, 0, cellKey).setDepth(1);

    // Lysosome (drop-off)
  const lysKey = makeCellTexture(this, 160, 70, 8, this.col.lysFill, this.col.lysRim);
    this.lysosomeSprite = this.add.image(0, 0, lysKey).setDepth(2);

    // Player
  const playerKey = makeDotTexture(this, 16, this.col.player);
    this.player = this.add.image(0, 0, playerKey).setDepth(3);
  const ringKey = makeRingTexture(this, 20, 3, this.col.playerRing);
    this.playerRing = this.add.image(0, 0, ringKey).setDepth(3).setAlpha(0.9);

    // HUD
  this.hudText = this.add.text(12, 12, "", { fontFamily: "monospace", color: this.col.hudText }).setScrollFactor(0).setDepth(5).setLineSpacing(2);
  this.waveText = this.add.text(12, 92, "", { fontFamily: "monospace", color: this.col.hudText }).setScrollFactor(0).setDepth(5);
  this.integrityBar = this.add.graphics().setScrollFactor(0).setDepth(5);

    // HUD toggle (H)
    this.input.keyboard?.on('keydown-H', () => {
      this.showHud = !this.showHud;
      this.hudText.setVisible(this.showHud);
      this.waveText.setVisible(this.showHud);
      this.integrityBar.setVisible(this.showHud);
    });

    // Stations
    this.spawnStations();

    // Sockets around membrane
    this.createSocketRing(this.socketCount);

    // Pathogens outside
    this.spawnInitialPathogens(5);

    // Grapple beam
    this.grappleBeam = this.add.graphics().setDepth(4);

    // Position for frame 0
    this.updateCellCenter(0);
    this.placeSprites();

    // Simple help
    const help = [
      "WASD: move inside cell",
      "E: interact at stations (Ribosome → ER → Golgi)",
      "Q: arm socket with a TAG (from Golgi)",
      "[ / ]: orbit speed,  - / = : move speed",
      "1: Make SLOW tag at Golgi,  2: Make STUN tag at Golgi",
      "Right Mouse: fire grapple from ARMED socket (nearby) to hook pathogen",
      "Drag pathogen into LYSOSOME to score",
    ].join("  •  ");
    this.add.text(12, this.scale.height - 20, help, { fontFamily: "monospace", fontSize: "12px", color: "#7fc7ff" })
      .setOrigin(0, 1).setScrollFactor(0).setDepth(5);
  }

  override update(_: number, dtMs: number) {
    const dt = dtMs / 1000;

    // Orbiting cell
    this.updateCellCenter(dt);

    // Player movement inside cell (keyboard + optional gamepad)
    let xAxis = (this.keys.D.isDown ? 1 : 0) - (this.keys.A.isDown ? 1 : 0);
    let yAxis = (this.keys.S.isDown ? 1 : 0) - (this.keys.W.isDown ? 1 : 0);
    const pad = (this.input.gamepad && this.input.gamepad.total > 0) ? this.input.gamepad.getPad(0) : undefined as unknown as Phaser.Input.Gamepad.Gamepad | undefined;
    if (pad) {
      const ax = pad.axes.length > 0 ? pad.axes[0].getValue() : 0;
      const ay = pad.axes.length > 1 ? pad.axes[1].getValue() : 0;
      if (Math.hypot(ax, ay) > 0.2) { xAxis = ax; yAxis = ay; }
      // A: interact, X: arm, RT: grapple
      if (pad.buttons[0]?.pressed) { // A
        const pLocal = this.playerLocal();
        const near = this.stations.find(st => pLocal.distance(st.pos) <= st.radius + 18);
        if (near) this.processAt(near.kind);
      }
      if (pad.buttons[2]?.pressed) { // X
        if (this.carryStage === 'tag_slow' || this.carryStage === 'tag_stun') {
          const near = this.nearestSocketToPlayer(32);
          if (near && near.ammo < 1) {
            near.ammo = 1; near.tag = this.carryStage === 'tag_slow' ? 'slow' : 'stun';
            this.setCarry('none');
          }
        }
      }
      if (pad.buttons[7]?.pressed) { // RT
        if (!this.grappleTarget && !this.grappleFrom) {
          const s = this.nearestSocketToPlayer(32);
          if (s && s.ammo > 0) {
            const target = this.findHookablePathogen(s);
            if (target) {
              s.ammo = 0; target.hooked = true; this.grappleFrom = s; this.grappleTarget = target;
              if (s.tag === 'stun') target.stunTimer = 0.5; else if (s.tag === 'slow') target.slowWhileHooked = true;
              s.tag = undefined;
            }
          }
        }
      } else {
        if (this.grappleTarget) this.grappleTarget.hooked = false;
        this.grappleFrom = undefined; this.grappleTarget = undefined; this.grappleBeam?.clear();
      }
    }
    if (xAxis || yAxis) {
      const dir = new Phaser.Math.Vector2(xAxis, yAxis).normalize();
      this.rel.add(dir.scale(this.moveSpeed * dt));
      const maxR = this.cellRadius - this.innerMargin;
      if (this.rel.lengthSq() > maxR * maxR) this.rel.setLength(maxR);
    }

  // Tuning controls: [ ] and - = (use keycodes: [=219, ]=221, -=189, ==187)
  const kb = this.input.keyboard!;
  if (kb.checkDown(kb.addKey(219), 0)) this.orbitAngularVel = Math.max(0, this.orbitAngularVel - 0.05);
  if (kb.checkDown(kb.addKey(221), 0)) this.orbitAngularVel += 0.05;
  if (kb.checkDown(kb.addKey(189), 0)) this.moveSpeed = Math.max(0, this.moveSpeed - 20);
  if (kb.checkDown(kb.addKey(187), 0)) this.moveSpeed += 20;

  // Station drift & interactions
    this.tickStations(dt);

    // Sockets update (world positions) + interactions
    this.tickSockets(dt);

    // Pathogens AI
    this.tickPathogens(dt);

    // Grapple (aiming & line)
    this.tickGrapple(dt);

    // Place sprites & camera
    this.placeSprites();
    this.cameras.main.centerOn(this.cellCenter.x, this.cellCenter.y);

    // Grid scroll (parallax)
    this.grid.tilePositionX = -this.cellCenter.x * 0.5;
    this.grid.tilePositionY = -this.cellCenter.y * 0.5;

  // Wave director & membrane integrity
  this.tickWaves(dt);
  this.tickIntegrity(dt);

  // HUD
  this.renderHud();
  }

  // -----------------------------------------------------------------------
  // Stations / crafting
  private spawnStations() {
    const r = this.cellRadius * 0.55;
    const make = (angle: number, kind: StationKind, color: number): Station => {
      const pos = new Phaser.Math.Vector2(Math.cos(angle) * r, Math.sin(angle) * r);
      const drift = new Phaser.Math.Vector2(Math.cos(angle + 1.3), Math.sin(angle + 0.7)).scale(10);
  const sprite = this.add.image(0, 0, makeStationTexture(this, kind, color)).setDepth(2);
      const label = this.add.text(0, 0, kind, { fontFamily: "monospace", fontSize: "12px", color: this.col.hudText }).setOrigin(0.5, 0).setDepth(2);
      return { kind, pos, drift, sprite, label, radius: 36, ready: false };
    };
    this.stations.push(make(-Math.PI * 0.25, "Ribosome", this.col.stationRibo));
    this.stations.push(make(+Math.PI * 0.15, "ER", this.col.stationER));
    this.stations.push(make(+Math.PI * 0.75, "Golgi", this.col.stationGolgi));

    // Lysosome sits near center-ish
    this.lysosomeSprite.setDepth(2);
  }

  private tickStations(dt: number) {
    // Bobbing
    for (const s of this.stations) {
      const bob = Math.sin(this.time.now / 600 + s.pos.x * 0.01) * 0.4;
      s.pos.add(s.drift.clone().scale(0.01 * dt));
  // Pulse if in range & correct carry
  const inRange = this.playerLocal().distance(s.pos) <= s.radius + 18;
  const want: CarryStage | undefined = s.kind === "Ribosome" ? "none" : s.kind === "ER" ? "poly" : s.kind === "Golgi" ? "folded" : undefined;
  const good = inRange && (want === undefined || this.carryStage === want);
  const scalePulse = good ? 1 + Math.sin(this.time.now / 120) * 0.05 : 1;
  s.sprite.setScale(scalePulse * (1 + bob * 0.02));
  s.label.setPosition(this.cellCenter.x + s.pos.x, this.cellCenter.y + s.pos.y + 40);
      // Keep inside cell
      const maxR = this.cellRadius - 50;
      if (s.pos.length() > maxR) s.pos.setLength(maxR);
    }

    // Interaction: E to process
    if (Phaser.Input.Keyboard.JustDown(this.keys.E)) {
      const pLocal = this.playerLocal();
      const near = this.stations.find(st => pLocal.distance(st.pos) <= st.radius + 18);
      if (near) this.processAt(near.kind);
    }

    // Golgi: choose tag type
    if (this.carryStage === "folded") {
      const nearGolgi = this.stations.find(st => st.kind === "Golgi" && this.playerLocal().distance(st.pos) <= st.radius + 18);
      if (nearGolgi) {
        if (this.input.keyboard!.checkDown(this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.ONE), 0)) this.setCarry("tag_slow");
        if (this.input.keyboard!.checkDown(this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.TWO), 0)) this.setCarry("tag_stun");
      }
    }
  }

  private processAt(kind: StationKind) {
    // Ribosome -> ER -> Golgi crafting
    if (kind === "Ribosome" && this.carryStage === "none") {
      this.setCarry("poly"); this.burstAtPlayer(0x87e56a);
    } else if (kind === "ER" && this.carryStage === "poly") {
      this.setCarry("folded"); this.burstAtPlayer(0x64c6ff);
    } else if (kind === "Golgi" && this.carryStage === "folded") {
      // Choose specific tag with 1/2 (handled in tickStations); fallback to slow
      this.setCarry("tag_slow"); this.burstAtPlayer(0xffb27d);
    }
  }

  private setCarry(stage: CarryStage) {
    this.carryStage = stage;
    if (this.carrySprite) this.carrySprite.destroy();
  if (stage === "none") return;
  const color = stage === "poly" ? this.col.pkgPoly : stage === "folded" ? this.col.pkgFold : stage === "tag_slow" ? this.col.pkgTagSlow : this.col.pkgTagStun;
  this.carrySprite = this.add.image(0, 0, makeDotTexture(this, 8, color)).setDepth(4);
  }

  // -----------------------------------------------------------------------
  // Sockets / grapple
  private createSocketRing(n: number) {
    this.sockets.length = 0;
    for (let i = 0; i < n; i++) {
      const angle = (i / n) * Math.PI * 2;
  const sprite = this.add.image(0, 0, makeRingTexture(this, 8, 3, this.col.socketEmpty)).setDepth(3).setAlpha(0.9);
      this.sockets.push({
        angle,
        pos: new Phaser.Math.Vector2(),
        ammo: 0,
        sprite,
      });
    }
  }

  private tickSockets(_: number) {
    // Position sockets on membrane
    for (const s of this.sockets) {
      s.pos.set(
        this.cellCenter.x + Math.cos(s.angle) * (this.cellRadius - 2),
        this.cellCenter.y + Math.sin(s.angle) * (this.cellRadius - 2)
      );
      s.sprite.setPosition(s.pos.x, s.pos.y);
      s.sprite.setScale(1 + Math.sin(this.time.now / 500 + s.angle) * 0.03);
      s.sprite.setTint(s.ammo > 0 ? this.col.socketArmed : this.col.socketEmpty);
    }

    // Arm socket: Q near a socket with a TAG package
  if (Phaser.Input.Keyboard.JustDown(this.keys.Q) && (this.carryStage === "tag_slow" || this.carryStage === "tag_stun")) {
      const near = this.nearestSocketToPlayer(32);
      if (near && near.ammo < 1) {
    near.ammo = 1;
    near.tag = this.carryStage === 'tag_slow' ? 'slow' : 'stun';
        this.setCarry("none");
      }
    }

    // Fire grapple: RMB near an armed socket
    if (this.input.activePointer.rightButtonDown()) {
      if (!this.grappleTarget && !this.grappleFrom) {
        const s = this.nearestSocketToPlayer(32);
        if (s && s.ammo > 0) {
          const target = this.findHookablePathogen(s);
          if (target) {
            s.ammo = 0;
            this.grappleFrom = s;
            this.grappleTarget = target;
            target.hooked = true;
            if (s.tag === 'stun') target.stunTimer = 0.5; else if (s.tag === 'slow') target.slowWhileHooked = true;
            s.tag = undefined;
          }
        }
      }
    } else {
      // Release on RMB up if not in lysosome yet
      if (this.grappleTarget) this.grappleTarget.hooked = false;
      this.grappleFrom = undefined;
      this.grappleTarget = undefined;
      this.grappleBeam?.clear();
    }
  }

  private findHookablePathogen(s: Socket): Pathogen | undefined {
    let best: Pathogen | undefined;
    let bestD = Number.POSITIVE_INFINITY;
    for (const p of this.pathogens) {
      if (p.hooked) continue;
      const d = Phaser.Math.Distance.Between(s.pos.x, s.pos.y, p.pos.x, p.pos.y);
      if (d < this.socketRange && d < bestD) {
        best = p; bestD = d;
      }
    }
    return best;
  }

  private nearestSocketToPlayer(maxDist = 40): Socket | undefined {
    const p = this.playerWorld();
    let best: Socket | undefined;
    let bd = maxDist;
    for (const s of this.sockets) {
      const d = Phaser.Math.Distance.Between(p.x, p.y, s.pos.x, s.pos.y);
      if (d < bd) { bd = d; best = s; }
    }
    return best;
  }

  private tickGrapple(dt: number) {
    this.grappleBeam?.clear();
    if (!this.grappleFrom || !this.grappleTarget) return;

    // Draw line
    this.grappleBeam!.lineStyle(2, 0x9cf6ff, 0.9);
    this.grappleBeam!.beginPath();
    this.grappleBeam!.moveTo(this.grappleFrom.pos.x, this.grappleFrom.pos.y);
    this.grappleBeam!.lineTo(this.grappleTarget.pos.x, this.grappleTarget.pos.y);
    this.grappleBeam!.strokePath();

    // Pull pathogen toward socket; then player escorts it into lysosome
    const pull = new Phaser.Math.Vector2(
      this.grappleFrom.pos.x - this.grappleTarget.pos.x,
      this.grappleFrom.pos.y - this.grappleTarget.pos.y
    ).limit(300); // cap pull force
  this.grappleTarget.vel.add(pull.scale(dt)); // smooth pull

    // If pathogen overlaps lysosome, score
    const lysR = 70;
    const d2 = Phaser.Math.Distance.Squared(
      this.grappleTarget.pos.x, this.grappleTarget.pos.y,
      this.lysosomeSprite.x, this.lysosomeSprite.y
    );
    if (d2 < (lysR - 10) * (lysR - 10)) {
      this.score += 1;
      this.grappleTarget.sprite.destroy();
      this.pathogens = this.pathogens.filter(p => p !== this.grappleTarget);
      this.grappleTarget = undefined;
      this.grappleFrom = undefined;
      this.grappleBeam!.clear();

      // Respawn another pathogen to keep the loop going
      this.spawnPathogens(1);
    }
  }

  // -----------------------------------------------------------------------
  // Pathogens
  private spawnInitialPathogens(n: number) {
    this.pathogens.length = 0;
    this.spawnPathogens(n);
  }

  private spawnPathogens(n: number) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const r = this.pathogenSpawnRadius + Math.random() * 40;
      const pos = new Phaser.Math.Vector2(
        this.worldCenter.x + Math.cos(a) * r,
        this.worldCenter.y + Math.sin(a) * r
      );
  const vel = new Phaser.Math.Vector2(0, 0);
  const sprite = this.add.image(pos.x, pos.y, makeDotTexture(this, 10, this.col.pathogen)).setDepth(2);
  const baseSpeed = 40 + Math.random() * 10;
  this.pathogens.push({ pos, vel, sprite, hooked: false, baseSpeed, slowWhileHooked: false, stunTimer: 0, dwellAtMembrane: 0 });
    }
  }

  // Replace your tickPathogens with this:
  private tickPathogens(dt: number) {
    const rim = this.cellRadius + this.membraneThickness * 0.5 + 8;
    for (const p of this.pathogens) {
        if (!p.hooked) {
        // drift toward membrane
        const toCell = new Phaser.Math.Vector2(this.cellCenter.x - p.pos.x, this.cellCenter.y - p.pos.y);
        const dist = toCell.length();
        if (dist > rim) {
            const speed = 40; // slow creep
            toCell.normalize().scale(speed);
            p.vel.lerp(toCell, 0.03);
        } else {
            // slide around rim slowly + random wander to avoid belts
            const tangent = new Phaser.Math.Vector2(-toCell.y, toCell.x).normalize().scale(12);
            const jitter = new Phaser.Math.Vector2(
            (Math.random() - 0.5) * 6,
            (Math.random() - 0.5) * 6
            );
            p.vel.lerp(tangent.add(jitter), 0.05);
        }
        }

        // Integrate + damp
        p.pos.add(p.vel.clone().scale(dt));
        p.vel.scale(0.96);

        // Render
        p.sprite.setPosition(p.pos.x, p.pos.y);
    }
  }


  // -----------------------------------------------------------------------
  // Placement / transforms
  private updateCellCenter(dt: number) {
    this.orbitTheta += this.orbitAngularVel * dt;
    const c = this.worldCenter;
    const R = this.orbitRadius;
    this.cellCenter.set(c.x + Math.cos(this.orbitTheta) * R, c.y + Math.sin(this.orbitTheta) * R);
  }

  private placeSprites() {
    // Cell & lysosome
    this.cellSprite.setPosition(this.cellCenter.x, this.cellCenter.y);
    const lysLocal = new Phaser.Math.Vector2(0, this.cellRadius * 0.1);
    this.lysosomeSprite.setPosition(this.cellCenter.x + lysLocal.x, this.cellCenter.y + lysLocal.y);

    // Player & attachments
    const px = this.cellCenter.x + this.rel.x;
    const py = this.cellCenter.y + this.rel.y;
    this.player.setPosition(px, py);
    this.playerRing.setPosition(px, py);
    this.playerRing.rotation += 0.03;

    // Carry sprite follows player
    if (this.carrySprite) this.carrySprite.setPosition(px + 18, py - 16);

    // Stations (world position from relative offsets)
    for (const s of this.stations) {
      s.sprite.setPosition(this.cellCenter.x + s.pos.x, this.cellCenter.y + s.pos.y);
    }
  }

  private playerLocal(): Phaser.Math.Vector2 {
    return new Phaser.Math.Vector2(this.rel.x, this.rel.y);
  }
  private playerWorld(): Phaser.Math.Vector2 {
    return new Phaser.Math.Vector2(this.cellCenter.x + this.rel.x, this.cellCenter.y + this.rel.y);
  }

  private renderHud() {
  const hud = [
      `cellRadius: ${this.cellRadius.toFixed(0)}`,
      `orbitAngularVel: ${this.orbitAngularVel.toFixed(2)} [ / ]`,
      `moveSpeed: ${this.moveSpeed.toFixed(0)} - / =`,
      `socketRange: ${this.socketRange.toFixed(0)}`,
      `pathogens: ${this.pathogens.length}`,
      `score: ${this.score}`,
    ].join("\n");
    this.hudText.setText(hud);
    this.waveText.setText(`Next wave in: ${Math.max(0, this.nextWaveAt - Math.floor(this.waveTime))}s`);

    // Integrity bar
    const w = 220, h = 8, x = 12, y = 64;
    const pct = Phaser.Math.Clamp(this.membraneIntegrity / 100, 0, 1);
    const col = pct > 0.6 ? this.col.hudGood : pct > 0.3 ? this.col.hudWarn : this.col.hudBad;
    this.integrityBar.clear();
    this.integrityBar.fillStyle(0x1b2a3a, 0.8).fillRect(x-2, y-2, w+4, h+4);
    this.integrityBar.fillStyle(0x0b0f14, 1).fillRect(x, y, w, h);
    this.integrityBar.fillStyle(col, 0.95).fillRect(x, y, Math.floor(w * pct), h);
  }

  // -----------------------------------------------------------------------
  // Wave director
  private tickWaves(dt: number) {
    this.waveTime += dt;
    if (this.waveTime >= this.nextWaveAt) {
      // clamp
      if (this.pathogens.length < 20) {
        const n = Math.min(20 - this.pathogens.length, 2 + this.waveIndex);
        this.spawnPathogens(n);
      }
      this.waveIndex++;
      this.waveTime = 0;
      this.nextWaveAt = 15; // constant cadence
    }
  }

  // Membrane integrity
  private tickIntegrity(dt: number) {
    // Per-pathogen dwell damage
    const damaging = this.pathogens.filter(p => !p.hooked && p.dwellAtMembrane >= 3).length;
    if (damaging > 0) this.membraneIntegrity = Math.max(0, this.membraneIntegrity - damaging * dt);

    if (this.membraneIntegrity <= 0) {
      // flash and reset
      const flash = this.add.rectangle(0, 0, this.scale.width, this.scale.height, 0xff0000, 0.2).setOrigin(0,0).setScrollFactor(0).setDepth(10);
      this.tweens.add({ targets: flash, alpha: 0, duration: 300, onComplete: () => flash.destroy() });
      this.scene.restart();
    }
  }

  // -----------------------------------------------------------------------
  // Tiny burst particle
  private burstAt(x: number, y: number, color: number) {
    for (let i = 0; i < 10; i++) {
      const s = this.add.image(x, y, makeDotTexture(this, 2, color)).setDepth(6);
      const dx = Phaser.Math.Between(-20, 20);
      const dy = Phaser.Math.Between(-20, 20);
      this.tweens.add({ targets: s, alpha: 0, scale: { from: 1, to: 0.2 }, x: x + dx, y: y + dy, duration: 200, onComplete: () => s.destroy() });
    }
  }
  private burstAtPlayer(color: number) {
    this.burstAt(this.player.x, this.player.y, color);
  }

}
