import Phaser from "phaser";
import type { Ctx } from "../state/cell-machine";

// HUD expects a subset of the machine context; extra fields are fine.
export type HudCtx = Pick<Ctx,
  "atp" | "aa" | "nt" | "mrna" | "catalaseFree" | "catalaseActive" | "stress" | "hp"
> & {
  cooldownTranscribe?: number;
  cooldownTranslate?: number;
  message?: string;
  nextWaveIn?: number;
  misfolded?: number;
};

let hudText: Phaser.GameObjects.Text | null = null;
let hudBg: Phaser.GameObjects.Rectangle | null = null;
let objectivesText: Phaser.GameObjects.Text | null = null;
let objectivesBg: Phaser.GameObjects.Rectangle | null = null;

const FIXED_COLS = 48;
const pad = (s: string) => s.length >= FIXED_COLS ? s.slice(0, FIXED_COLS) : s + " ".repeat(FIXED_COLS - s.length);

export function addHud(scene: Phaser.Scene) {
  hudText?.destroy(); hudText = null;
  hudBg?.destroy();   hudBg = null;
  objectivesText?.destroy(); objectivesText = null;
  objectivesBg?.destroy(); objectivesBg = null;

  // Main HUD (resources)
  hudBg = scene.add.rectangle(8, 8, 10, 10, 0x000000, 0.35).setOrigin(0, 0).setDepth(999);
  hudText = scene.add.text(14, 12, "", {
    fontFamily: "monospace",
    fontSize: "14px",
    color: "#cfe",
    align: "left",
  }).setDepth(1000).setScrollFactor(0);

  // Objectives panel (top-left)
  objectivesBg = scene.add.rectangle(8, 120, 10, 10, 0x001133, 0.9).setOrigin(0, 0).setDepth(999);
  objectivesText = scene.add.text(16, 130, "", {
    fontFamily: "monospace", 
    fontSize: "13px",
    color: "#88ddff",
    align: "left",
  }).setDepth(1000).setScrollFactor(0);
}

export function setHud(scene: Phaser.Scene, ctx: HudCtx) {
  if (!hudText || !hudBg || !objectivesText || !objectivesBg) addHud(scene);

  // Main HUD content
  const header = `Controls: WASD move | 1 Transcribe | 2 Translate | R Stress wave` +
    (ctx.nextWaveIn != null ? `  | Next wave in: ${Math.max(0, Math.ceil(ctx.nextWaveIn))}s` : "");

  const lines = [
    pad(header),
    pad(`ATP:${String(ctx.atp).padStart(3)}  AA:${String(ctx.aa).padStart(3)}  NT:${String(ctx.nt).padStart(3)}`),
    pad(`mRNA:${String(ctx.mrna).padStart(2)}  Catalase free:${String(ctx.catalaseFree).padStart(2)}  Active:${String(ctx.catalaseActive).padStart(2)}`),
    pad(`Stress:${String(ctx.stress).padStart(2)}  HP:${String(ctx.hp).padStart(3)}${ctx.misfolded ? `  Misfolded:${ctx.misfolded}` : ""}`),
  ];

  if (ctx.cooldownTranscribe || ctx.cooldownTranslate) {
    const t = Math.max(0, ctx.cooldownTranscribe ?? 0).toFixed(1);
    const r = Math.max(0, ctx.cooldownTranslate ?? 0).toFixed(1);
    lines.push(pad(`CD transcribe:${t}s  translate:${r}s`));
  }
  if (ctx.message) lines.push(pad(ctx.message));

  hudText!.setText(lines.join("\n"));
  const padXY = { x: 12, y: 10 };
  hudBg!.setSize(hudText!.width + padXY.x * 2, hudText!.height + padXY.y * 2);
  hudBg!.setPosition(8, 8);
  hudText!.setPosition(8 + padXY.x - 6, 8 + padXY.y - 8);

  // Objectives panel content
  const waveTimer = ctx.nextWaveIn != null ? `Next wave in: ${Math.max(0, Math.ceil(ctx.nextWaveIn))}s` : "Next wave in: --s";
  const objectivesContent = [
    "OBJECTIVE:",
    "Survive stress waves by making Catalase",
    "(1 Transcribe, 2 Translate) and delivering",
    "to Peroxisome.",
    "",
    "Controls: WASD, 1, 2, R",
    "",
    waveTimer
  ].join("\n");

  objectivesText!.setText(objectivesContent);
  const objPad = { x: 10, y: 8 };
  objectivesBg!.setSize(objectivesText!.width + objPad.x * 2, objectivesText!.height + objPad.y * 2);
  objectivesText!.setPosition(8 + objPad.x, 120 + objPad.y);
}
