/**
 * Preset sampler - generates randomized simulation configurations
 */

import { v4 as uuidv4 } from "uuid";
import * as path from "path";
import {
  SimulationConfig,
  GenerateConfig,
  Intervention,
  BrushParams,
} from "./types.js";

// Known good presets for data generation
export const PRESET_CATEGORIES = {
  reactionDiffusion: [
    "GrayScott",
    "BrusselatorPDE",
    "SchnakenbergPDE",
    "GiererMeinhardt",
    "FHN",
    "Oregonator",
  ],
  waves: [
    "waveEquation",
    "waveEquation1D",
    "dampedWaveEquation",
    "KdV",
    "sineGordon",
  ],
  diffusion: [
    "heatEquation",
    "heatEquation1D",
    "nonlinearDiffusion",
    "chemotaxis",
  ],
  biology: [
    "SIR",
    "SIS",
    "SEIR",
    "LotkaVolterra",
    "predatorPrey",
    "fisherKPP",
  ],
  fluids: [
    "NavierStokes",
    "BurgersPDE",
    "KuramotoSivashinsky",
  ],
};

export const ALL_PRESETS = Object.values(PRESET_CATEGORIES).flat();

/**
 * Generate simulation configurations based on generate config
 */
export function generateConfigurations(config: GenerateConfig): SimulationConfig[] {
  const configs: SimulationConfig[] = [];

  for (let i = 0; i < config.count; i++) {
    const id = uuidv4();
    const preset = randomChoice(config.presets);

    const simConfig: SimulationConfig = {
      id,
      preset,
      totalFrames: config.framesPerSim,
      timestepsPerFrame: config.timestepsPerFrame,
      outputDir: path.join(config.outputDir, preset, id),
      resolution: config.resolution,
      randomSeed: config.randomize ? Math.floor(Math.random() * 1e9) : undefined,
    };

    // Randomize parameters if enabled
    if (config.randomize && config.parameterRanges) {
      simConfig.options = {};
      for (const [param, [min, max]] of Object.entries(config.parameterRanges)) {
        simConfig.options[param] = randomInRange(min, max);
      }
    }

    // Add random interventions if enabled
    if (config.randomInterventions) {
      simConfig.interventions = generateRandomInterventions(
        config.framesPerSim,
        config.interventionFrequency || [50, 150]
      );
    }

    configs.push(simConfig);
  }

  return configs;
}

/**
 * Generate random interventions for a simulation
 */
function generateRandomInterventions(
  totalFrames: number,
  frequencyRange: [number, number]
): Intervention[] {
  const interventions: Intervention[] = [];
  let frame = randomIntInRange(frequencyRange[0], frequencyRange[1]);

  while (frame < totalFrames) {
    const intervention: Intervention = {
      frame,
      type: "brush",
      params: generateRandomBrushParams(),
    };
    interventions.push(intervention);

    // Next intervention
    frame += randomIntInRange(frequencyRange[0], frequencyRange[1]);
  }

  return interventions;
}

/**
 * Generate random brush parameters
 */
function generateRandomBrushParams(): BrushParams {
  const species = randomChoice(["u", "v"] as const);

  return {
    x: randomInRange(0.1, 0.9),
    y: randomInRange(0.1, 0.9),
    species,
    value: randomInRange(0, 1),
    radius: randomInRange(0.02, 0.1),
    shape: randomChoice(["circle", "square"] as const),
    action: "replace",
  };
}

/**
 * Sample presets from categories
 */
export function samplePresets(
  categories: (keyof typeof PRESET_CATEGORIES)[],
  count: number
): string[] {
  const available = categories.flatMap((cat) => PRESET_CATEGORIES[cat]);
  const result: string[] = [];

  for (let i = 0; i < count; i++) {
    result.push(randomChoice(available));
  }

  return result;
}

// Utility functions

function randomChoice<T>(arr: readonly T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

function randomInRange(min: number, max: number): number {
  return min + Math.random() * (max - min);
}

function randomIntInRange(min: number, max: number): number {
  return Math.floor(randomInRange(min, max + 1));
}
