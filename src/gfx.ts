import Phaser from "phaser";

// Procedural texture helpers. They cache by key and reuse across calls.

export function makeGridTexture(
  scene: Phaser.Scene,
  w: number,
  h: number,
  bg: number,
  minor: number,
  major: number
): string {
  const key = `grid-${w}x${h}-${bg}-${minor}-${major}`;
  if (scene.textures.exists(key)) return key;
  const tex = scene.textures.createCanvas(key, w, h);
  if (!tex) return key;
  const ctx = tex.getContext();
  if (!ctx) return key;
  ctx.fillStyle = Phaser.Display.Color.IntegerToColor(bg).rgba;
  ctx.fillRect(0, 0, w, h);
  // minor
  ctx.strokeStyle = Phaser.Display.Color.IntegerToColor(minor).rgba;
  ctx.lineWidth = 1;
  for (let x = 0; x <= w; x += 8) { ctx.beginPath(); ctx.moveTo(x + 0.5, 0); ctx.lineTo(x + 0.5, h); ctx.stroke(); }
  for (let y = 0; y <= h; y += 8) { ctx.beginPath(); ctx.moveTo(0, y + 0.5); ctx.lineTo(w, y + 0.5); ctx.stroke(); }
  // major
  ctx.strokeStyle = Phaser.Display.Color.IntegerToColor(major).rgba;
  ctx.lineWidth = 1.5;
  for (let x = 0; x <= w; x += 32) { ctx.beginPath(); ctx.moveTo(x + 0.5, 0); ctx.lineTo(x + 0.5, h); ctx.stroke(); }
  for (let y = 0; y <= h; y += 32) { ctx.beginPath(); ctx.moveTo(0, y + 0.5); ctx.lineTo(w, y + 0.5); ctx.stroke(); }
  tex.refresh();
  return key;
}

export function makeCellTexture(
  scene: Phaser.Scene,
  size: number,
  radius: number,
  rim: number,
  fill: number,
  membrane: number
): string {
  const key = `cell-${size}-${radius}-${rim}-${fill}-${membrane}`;
  if (scene.textures.exists(key)) return key;
  const gfx = scene.add.graphics();
  gfx.fillStyle(fill, 0.9);
  gfx.fillCircle(size / 2, size / 2, radius);
  gfx.lineStyle(rim, membrane, 1);
  gfx.strokeCircle(size / 2, size / 2, radius + rim / 2 - 1);
  // subtle internal filaments
  gfx.lineStyle(2, membrane, 0.12);
  for (let a = 0; a < Math.PI * 2; a += Math.PI / 3) {
    gfx.beginPath();
    const r0 = radius * 0.6, r1 = radius * 0.9;
    gfx.moveTo(size/2 + Math.cos(a) * r0, size/2 + Math.sin(a) * r0);
    gfx.lineTo(size/2 + Math.cos(a + 0.6) * r1, size/2 + Math.sin(a + 0.6) * r1);
    gfx.strokePath();
  }
  gfx.generateTexture(key, size, size);
  gfx.destroy();
  return key;
}

export function makeDotTexture(scene: Phaser.Scene, r: number, color: number): string {
  const key = `dot-${r}-${color}`;
  if (scene.textures.exists(key)) return key;
  const s = r * 2 + 4;
  const gfx = scene.add.graphics();
  gfx.fillStyle(color, 1);
  gfx.fillCircle(s / 2, s / 2, r);
  gfx.generateTexture(key, s, s);
  gfx.destroy();
  return key;
}

export function makeRingTexture(scene: Phaser.Scene, radius: number, thickness: number, color: number): string {
  const key = `ring-${radius}-${thickness}-${color}`;
  if (scene.textures.exists(key)) return key;
  const s = radius * 2 + thickness * 2;
  const gfx = scene.add.graphics();
  gfx.lineStyle(thickness, color, 0.95);
  gfx.strokeCircle(s / 2, s / 2, radius);
  gfx.generateTexture(key, s, s);
  gfx.destroy();
  return key;
}

export function makeStationTexture(scene: Phaser.Scene, kind: string, color: number): string {
  const key = `station-${kind}-${color}`;
  if (scene.textures.exists(key)) return key;
  const size = 96;
  const gfx = scene.add.graphics();
  gfx.fillStyle(0x000000, 0);
  gfx.fillRect(0, 0, size, size);

  // base
  gfx.fillStyle(color, 0.25);
  gfx.fillCircle(size/2, size/2, 32);
  gfx.lineStyle(4, color, 0.9);
  gfx.strokeCircle(size/2, size/2, 32);

  // icon hint
  gfx.lineStyle(3, color, 0.9);
  if (kind === "Ribosome") {
    gfx.strokeTriangle(size/2-12, size/2+10, size/2+12, size/2+10, size/2, size/2-14);
  } else if (kind === "ER") {
    gfx.strokeRect(size/2-12, size/2-12, 24, 24);
  } else if (kind === "Golgi") {
    gfx.beginPath();
    gfx.moveTo(size/2-16, size/2-8);
    gfx.lineTo(size/2+16, size/2-8);
    gfx.moveTo(size/2-16, size/2);
    gfx.lineTo(size/2+16, size/2);
    gfx.moveTo(size/2-16, size/2+8);
    gfx.lineTo(size/2+16, size/2+8);
    gfx.strokePath();
  } else if (kind === "Lysosome") {
    gfx.strokeCircle(size/2, size/2, 20);
    gfx.strokeCircle(size/2, size/2, 8);
  }

  gfx.generateTexture(key, size, size);
  gfx.destroy();
  return key;
}
