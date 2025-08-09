import { createMachine, assign } from "xstate";

export type Ctx = {
  atp: number;
  aa: number;
  nt: number;
  mrna: number;
  catalaseFree: number;     // produced, carried
  catalaseActive: number;   // delivered to peroxisome
  stress: number;           // 0..100
  hp: number;               // simple fail condition
  cooldownTranscribe: number;
  cooldownTranslate: number;
  misfolded: number;        // reserved for future use
  nextWaveIn: number;       // countdown timer for next stress wave
};

export type Evt =
  | { type: "TICK"; dt: number }
  | { type: "PICKUP"; kind: "glucose" | "aa" | "nt" }
  | { type: "TRANSCRIBE" }
  | { type: "TRANSLATE" }
  | { type: "DELIVER_CATALASE" }
  | { type: "STRESS"; amount: number };

const clamp = (v: number, min = 0, max = 999) => Math.max(min, Math.min(max, v));

export const cellMachine = createMachine({
  /** XState v5 typing lives here */
  types: {} as {
    context: Ctx;
    events: Evt;
  },

  context: {
    atp: 5, aa: 5, nt: 5, mrna: 0,
    catalaseFree: 0, catalaseActive: 0,
    stress: 0, hp: 10,
    cooldownTranscribe: 0, cooldownTranslate: 0,
    misfolded: 0, nextWaveIn: 30
  },

  initial: "homeostasis",

  states: {
    homeostasis: {
      on: {
        PICKUP: {
          actions: assign(({ context, event }) => {
            if (event.type !== "PICKUP") return {};
            if (event.kind === "glucose") return { atp: clamp(context.atp + 2) };
            if (event.kind === "aa")      return { aa: clamp(context.aa + 2) };
            if (event.kind === "nt")      return { nt: clamp(context.nt + 2) };
            return {};
          })
        },

        TRANSCRIBE: {
          guard: ({ context }) =>
            context.nt >= 2 && context.atp >= 1 && context.cooldownTranscribe <= 0,
          actions: assign(({ context }) => ({
            nt: context.nt - 2,
            atp: context.atp - 1,
            mrna: context.mrna + 1,
            cooldownTranscribe: 0.8
          }))
        },

        TRANSLATE: {
          guard: ({ context }) =>
            context.aa >= 3 && context.atp >= 1 && context.mrna > 0 && context.cooldownTranslate <= 0,
          actions: assign(({ context }) => ({
            aa: context.aa - 3,
            atp: context.atp - 1,
            mrna: context.mrna - 1,
            catalaseFree: context.catalaseFree + 1,
            cooldownTranslate: 0.8
          }))
        },

        DELIVER_CATALASE: {
          guard: ({ context }) => context.catalaseFree > 0,
          actions: assign(({ context }) => ({
            catalaseFree: context.catalaseFree - 1,
            catalaseActive: clamp(context.catalaseActive + 1, 0, 99)
          }))
        },

        STRESS: {
          target: "stress",
          actions: assign(({ event }) =>
            event.type === "STRESS" ? { stress: clamp(event.amount, 0, 100) } : {}
          )
        },

        TICK: [
          {
            guard: ({ context, event }) => event.type === "TICK" && Math.max(0, context.nextWaveIn - event.dt) === 0,
            target: "stress",
            actions: assign(({ context, event }) => {
              if (event.type !== "TICK") return {};
              return {
                cooldownTranscribe: Math.max(0, context.cooldownTranscribe - event.dt),
                cooldownTranslate: Math.max(0, context.cooldownTranslate - event.dt),
                nextWaveIn: 30,  // reset timer when wave triggers
                stress: clamp(context.stress + 20, 0, 100)
              };
            })
          },
          {
            actions: assign(({ context, event }) => {
              if (event.type !== "TICK") return {};
              return {
                cooldownTranscribe: Math.max(0, context.cooldownTranscribe - event.dt),
                cooldownTranslate: Math.max(0, context.cooldownTranslate - event.dt),
                nextWaveIn: Math.max(0, context.nextWaveIn - event.dt)
              };
            })
          }
        ]
      }
    },

    stress: {
      on: {
        TICK: {
          actions: assign(({ context, event }) => {
            if (event.type !== "TICK") return {};
            const need = Math.ceil(context.stress / 20);
            const shield = Math.min(context.catalaseActive, need);
            const dmg = Math.max(0, need - shield);
            return {
              atp: clamp(context.atp - dmg, 0, 999),
              hp: clamp(context.hp - (dmg > 0 ? 1 : 0), 0, 10),
              nextWaveIn: Math.max(0, context.nextWaveIn - event.dt)
            };
          })
        },

        TRANSCRIBE: { target: "homeostasis" },
        TRANSLATE: { target: "homeostasis" },
        DELIVER_CATALASE: { target: "homeostasis" }
      }
    }
  }
});
