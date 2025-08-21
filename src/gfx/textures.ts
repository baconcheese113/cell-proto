import Phaser from "phaser";

export function makeGridTexture(
  scene: Phaser.Scene, w: number, h: number, bg: number, minor: number, major: number
): string {
  const key = `grid-${w}x${h}-${bg}-${minor}-${major}`;
  console.log(`🎨 Creating grid texture: ${key} (${w}x${h} = ${(w*h*4/1024/1024).toFixed(1)}MB)`);
  if (scene.textures.exists(key)) {
    console.log(`♻️ Grid texture ${key} already exists, reusing`);
    return key;
  }
  const tex = scene.textures.createCanvas(key, w, h);
  if (!tex) return key;
  if (!tex) return key;
  const ctx = tex.getContext();
  if (!ctx) return key;
  ctx.fillStyle = `#${bg.toString(16).padStart(6, "0")}`;
  ctx.fillRect(0, 0, w, h);

  // Minor lines every 16px, major every 64px
  ctx.strokeStyle = `#${minor.toString(16).padStart(6, "0")}`; ctx.globalAlpha = 0.5;
  for (let x = 0; x < w; x += 16) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.stroke(); }
  for (let y = 0; y < h; y += 16) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke(); }

  ctx.strokeStyle = `#${major.toString(16).padStart(6, "0")}`; ctx.globalAlpha = 0.8;
  for (let x = 0; x < w; x += 64) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.stroke(); }
  for (let y = 0; y < h; y += 64) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke(); }

  tex.refresh();
  return key;
}

export function makeCellTexture(
  scene: Phaser.Scene, size: number, rim: number, fill: number, edge: number
): string {
  const key = `cell-${size}-${rim}-${fill}-${edge}`;
  console.log(`🎨 Creating cell texture: ${key} (${size}x${size})`);
  if (scene.textures.exists(key)) {
    console.log(`♻️ Cell texture ${key} already exists, reusing`);
    return key;
  }
  const gfx = scene.add.graphics();
  gfx.fillStyle(fill, 0.9);
  gfx.fillCircle(size / 2, size / 2, size / 2 - rim);
  gfx.lineStyle(rim, edge, 1);
  gfx.strokeCircle(size / 2, size / 2, size / 2 - rim / 2);
  gfx.generateTexture(key, size, size);
  gfx.destroy();
  return key;
}

export function makeRingTexture(scene: Phaser.Scene, size: number, rim: number, color: number): string {
  const key = `ring-${size}-${rim}-${color}`;
  if (scene.textures.exists(key)) return key;
  const gfx = scene.add.graphics();
  gfx.lineStyle(rim, color, 0.9);
  gfx.strokeCircle(size / 2, size / 2, size / 2 - rim);
  gfx.generateTexture(key, size, size);
  gfx.destroy();
  return key;
}

export function makeDotTexture(scene: Phaser.Scene, size: number, color: number): string {
  const key = `dot-${size}-${color}`;
  if (scene.textures.exists(key)) return key;
  const gfx = scene.add.graphics();
  gfx.fillStyle(color, 1);
  gfx.fillCircle(size / 2, size / 2, size / 2);
  gfx.generateTexture(key, size, size);
  gfx.destroy();
  return key;
}

export function makeStationTexture(scene: Phaser.Scene, kind: "Nucleus" | "Ribosome" | "Peroxisome" | "Chaperone"): string {
  const key = `station-${kind}`;
  if (scene.textures.exists(key)) return key;
  const size = 48;
  const gfx = scene.add.graphics();
  gfx.lineStyle(3, 0xffffff, 0.9);
  if (kind === "Ribosome") {
    gfx.strokeTriangle(size/2-12, size/2+10, size/2+12, size/2+10, size/2, size/2-14);
  } else if (kind === "Nucleus") {
    gfx.strokeCircle(size/2, size/2, 14);
    gfx.strokeCircle(size/2, size/2, 8);
  } else if (kind === "Peroxisome") {
    gfx.strokeRect(size/2-12, size/2-12, 24, 24);
    gfx.lineBetween(size/2-12, size/2, size/2+12, size/2);
    gfx.lineBetween(size/2, size/2-12, size/2, size/2+12);
  } else if (kind === "Chaperone") {
    // Repair/wrench-like symbol
    gfx.strokeEllipse(size/2, size/2, 20, 12);
    gfx.strokeRect(size/2-3, size/2-6, 6, 12);
    gfx.strokeCircle(size/2-8, size/2-4, 3);
    gfx.strokeCircle(size/2+8, size/2+4, 3);
  }
  gfx.generateTexture(key, size, size);
  gfx.destroy();
  return key;
}
