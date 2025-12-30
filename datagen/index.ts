#!/usr/bin/env node
/**
 * VisualPDE Data Generation CLI
 *
 * Generate training data from PDE simulations for vision-language models.
 */

import { Command } from "commander";
import * as path from "path";
import * as fs from "fs/promises";
import { v4 as uuidv4 } from "uuid";
import { BrowserPool } from "./browser-pool.js";
import { SimulationRunner } from "./simulation-runner.js";
import { Orchestrator } from "./orchestrator.js";
import {
  generateConfigurations,
  ALL_PRESETS,
  PRESET_CATEGORIES,
} from "./preset-sampler.js";
import {
  SimulationConfig,
  BatchConfig,
  GenerateConfig,
  BrowserPoolConfig,
} from "./types.js";

const program = new Command();

// Get the project root directory
const __dirname = path.dirname(new URL(import.meta.url).pathname);
const PROJECT_ROOT = path.resolve(__dirname, "..");
const HEADLESS_HTML = path.join(PROJECT_ROOT, "headless", "index.html");
const DEFAULT_OUTPUT = path.join(PROJECT_ROOT, "output");

program
  .name("vpde-datagen")
  .description("Generate training data from VisualPDE simulations")
  .version("1.0.0");

// ============================================================================
// Run a single simulation
// ============================================================================

program
  .command("run")
  .description("Run a single simulation")
  .requiredOption("-p, --preset <name>", "Preset name (e.g., GrayScott)")
  .option("-f, --frames <number>", "Number of frames to capture", "500")
  .option("-t, --timesteps <number>", "Timesteps per frame", "100")
  .option("-o, --output <dir>", "Output directory", DEFAULT_OUTPUT)
  .option("-w, --width <number>", "Canvas width", "512")
  .option("-h, --height <number>", "Canvas height", "512")
  .option("-s, --seed <number>", "Random seed for reproducibility")
  .option("--no-headless", "Show browser window (for debugging)")
  .option("--gpu", "Use GPU rendering (requires GPU, default is software SwiftShader)")
  .action(async (opts) => {
    const id = uuidv4();
    const outputDir = path.join(opts.output, opts.preset, id);

    const config: SimulationConfig = {
      id,
      preset: opts.preset,
      totalFrames: parseInt(opts.frames),
      timestepsPerFrame: parseInt(opts.timesteps),
      outputDir,
      resolution: [parseInt(opts.width), parseInt(opts.height)],
      randomSeed: opts.seed ? parseInt(opts.seed) : undefined,
    };

    const poolConfig: BrowserPoolConfig = {
      poolSize: 1,
      headless: opts.headless,
      width: parseInt(opts.width),
      height: parseInt(opts.height),
      htmlPath: HEADLESS_HTML,
      useSwiftShader: !opts.gpu, // Use SwiftShader by default, GPU if --gpu flag
    };

    console.log(`Running simulation: ${opts.preset}`);
    console.log(`Output: ${outputDir}`);

    const pool = new BrowserPool(poolConfig);

    try {
      await pool.initialize();
      const page = await pool.acquirePage();
      const runner = new SimulationRunner(page, HEADLESS_HTML);
      const metadata = await runner.run(config);
      await pool.releasePage(page);

      console.log(`\nSimulation complete!`);
      console.log(`Frames: ${metadata.simulation.totalFrames}`);
      console.log(`Total time: ${metadata.simulation.totalTime.toFixed(2)}`);
      console.log(`Output: ${outputDir}`);
    } finally {
      await pool.shutdown();
    }
  });

// ============================================================================
// Run batch from config file
// ============================================================================

program
  .command("batch")
  .description("Run batch of simulations from config file")
  .requiredOption("-c, --config <file>", "Batch config file (JSON)")
  .option("-w, --workers <number>", "Number of parallel workers", "4")
  .option("--no-headless", "Show browser windows")
  .option("--gpu", "Use GPU rendering (requires GPU, default is software SwiftShader)")
  .action(async (opts) => {
    const configPath = path.resolve(opts.config);
    const configText = await fs.readFile(configPath, "utf-8");
    const batchConfig: BatchConfig = JSON.parse(configText);

    // Override workers if specified
    batchConfig.workers = parseInt(opts.workers);

    const poolConfig: BrowserPoolConfig = {
      poolSize: batchConfig.workers,
      headless: opts.headless,
      width: 512,
      height: 512,
      htmlPath: HEADLESS_HTML,
      maxSimsPerBrowser: 50,
      useSwiftShader: !opts.gpu,
    };

    console.log(`Running batch with ${batchConfig.simulations.length} simulations`);
    console.log(`Workers: ${batchConfig.workers}`);

    const pool = new BrowserPool(poolConfig);

    try {
      await pool.initialize();
      const orchestrator = new Orchestrator(pool, batchConfig.workers);
      await orchestrator.runBatch(batchConfig);
    } finally {
      await pool.shutdown();
    }
  });

// ============================================================================
// Generate randomized dataset
// ============================================================================

program
  .command("generate")
  .description("Generate randomized simulation dataset")
  .requiredOption("-n, --count <number>", "Number of simulations to generate")
  .option(
    "-p, --presets <list>",
    "Comma-separated list of presets",
    ALL_PRESETS.join(",")
  )
  .option("-f, --frames <number>", "Frames per simulation", "500")
  .option("-t, --timesteps <number>", "Timesteps per frame", "100")
  .option("-o, --output <dir>", "Output directory", DEFAULT_OUTPUT)
  .option("-w, --workers <number>", "Number of parallel workers", "4")
  .option("--width <number>", "Canvas width", "512")
  .option("--height <number>", "Canvas height", "512")
  .option("--randomize", "Randomize parameters", false)
  .option("--interventions", "Add random interventions", false)
  .option("--no-headless", "Show browser windows")
  .option("--gpu", "Use GPU rendering (requires GPU, default is software SwiftShader)")
  .action(async (opts) => {
    const presets = opts.presets.split(",").map((p: string) => p.trim());

    const generateConfig: GenerateConfig = {
      count: parseInt(opts.count),
      presets,
      randomize: opts.randomize,
      randomInterventions: opts.interventions,
      outputDir: opts.output,
      workers: parseInt(opts.workers),
      framesPerSim: parseInt(opts.frames),
      timestepsPerFrame: parseInt(opts.timesteps),
      resolution: [parseInt(opts.width), parseInt(opts.height)],
    };

    // Generate simulation configurations
    const simConfigs = generateConfigurations(generateConfig);

    const batchConfig: BatchConfig = {
      outputDir: opts.output,
      workers: generateConfig.workers,
      simulations: simConfigs,
    };

    const poolConfig: BrowserPoolConfig = {
      poolSize: generateConfig.workers,
      headless: opts.headless,
      width: parseInt(opts.width),
      height: parseInt(opts.height),
      htmlPath: HEADLESS_HTML,
      maxSimsPerBrowser: 50,
      useSwiftShader: !opts.gpu,
    };

    console.log(`\nGenerating ${opts.count} simulations`);
    console.log(`Presets: ${presets.length} selected`);
    console.log(`Workers: ${opts.workers}`);
    console.log(`Output: ${opts.output}`);
    console.log();

    const pool = new BrowserPool(poolConfig);

    try {
      await pool.initialize();
      const orchestrator = new Orchestrator(pool, generateConfig.workers);
      await orchestrator.runBatch(batchConfig);
    } finally {
      await pool.shutdown();
    }
  });

// ============================================================================
// List available presets
// ============================================================================

program
  .command("list-presets")
  .description("List available simulation presets")
  .option("-c, --category <name>", "Filter by category")
  .action((opts) => {
    if (opts.category) {
      const cat = opts.category as keyof typeof PRESET_CATEGORIES;
      if (PRESET_CATEGORIES[cat]) {
        console.log(`\n${opts.category}:`);
        PRESET_CATEGORIES[cat].forEach((p) => console.log(`  - ${p}`));
      } else {
        console.error(`Unknown category: ${opts.category}`);
        console.log("Available categories:", Object.keys(PRESET_CATEGORIES).join(", "));
      }
    } else {
      console.log("\nAvailable presets by category:\n");
      for (const [category, presets] of Object.entries(PRESET_CATEGORIES)) {
        console.log(`${category}:`);
        presets.forEach((p) => console.log(`  - ${p}`));
        console.log();
      }
    }
  });

// ============================================================================
// Main
// ============================================================================

program.parse();
