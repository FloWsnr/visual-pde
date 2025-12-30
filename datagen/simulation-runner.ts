/**
 * Simulation runner - handles individual simulation execution
 */

import { Page } from "puppeteer";
import * as fs from "fs/promises";
import * as path from "path";
import {
  SimulationConfig,
  SimulationMetadata,
  Intervention,
  FrameAnnotation,
} from "./types.js";

// VPDE API interface exposed by main.js in headless mode
interface VPDE {
  play: () => void;
  pause: () => void;
  reset: () => void;
  step: () => void;
  stepN: (n: number) => void;
  render: () => void;
  getTime: () => number;
  getOptions: () => Record<string, unknown>;
  loadPreset: (name: string) => void;
  setOption: (key: string, value: unknown) => void;
  updateProblem: () => void;
  applyBrush: (
    x: number,
    y: number,
    species: string,
    value: number,
    radius: number
  ) => void;
  captureFrame: () => string;
  _uniforms: { t: { value: number } };
}

declare global {
  interface Window {
    VPDE: VPDE;
    VPDE_READY: boolean;
    VPDE_SEED?: number;
  }
}

export class SimulationRunner {
  private page: Page;
  private htmlPath: string;

  constructor(page: Page, htmlPath: string) {
    this.page = page;
    this.htmlPath = htmlPath;
  }

  /**
   * Run a complete simulation and capture frames
   */
  async run(config: SimulationConfig): Promise<SimulationMetadata> {
    console.log(`Starting simulation ${config.id} (preset: ${config.preset})`);

    // Ensure output directory exists
    const framesDir = path.join(config.outputDir, "frames");
    await fs.mkdir(framesDir, { recursive: true });

    // Build URL with preset
    const url = `file://${this.htmlPath}?preset=${encodeURIComponent(config.preset)}`;

    // Navigate to the simulation page - use domcontentloaded since we wait for VPDE_READY
    await this.page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });

    // Wait for VPDE to be ready
    await this.page.waitForFunction(() => window.VPDE_READY === true, {
      timeout: 30000,
    });

    // Set random seed if specified
    if (config.randomSeed !== undefined) {
      await this.page.evaluate((seed) => {
        window.VPDE_SEED = seed;
      }, config.randomSeed);
    }

    // Apply option overrides
    if (config.options && Object.keys(config.options).length > 0) {
      await this.page.evaluate((opts) => {
        for (const [key, value] of Object.entries(opts)) {
          window.VPDE.setOption(key, value);
        }
        window.VPDE.updateProblem();
      }, config.options);
    }

    // Reset simulation to apply settings
    await this.page.evaluate(() => {
      window.VPDE.reset();
    });

    // Sort interventions by frame
    const interventions = [...(config.interventions || [])].sort(
      (a, b) => a.frame - b.frame
    );
    let interventionIndex = 0;

    // Frame annotations
    const frameAnnotations: FrameAnnotation[] = [];

    // Capture frames
    const startTime = Date.now();
    for (let frame = 0; frame < config.totalFrames; frame++) {
      // Apply any interventions scheduled for this frame
      while (
        interventionIndex < interventions.length &&
        interventions[interventionIndex].frame === frame
      ) {
        const intervention = interventions[interventionIndex];
        await this.applyIntervention(intervention);

        // Record simulation time
        const simTime = await this.page.evaluate(() => window.VPDE.getTime());
        intervention.simulationTime = simTime;

        interventionIndex++;
      }

      // Step simulation
      await this.page.evaluate((n) => {
        window.VPDE.stepN(n);
        window.VPDE.render();
      }, config.timestepsPerFrame);

      // Capture frame
      const dataUrl = await this.page.evaluate(() => window.VPDE.captureFrame());
      await this.saveFrame(dataUrl, framesDir, frame);

      // Record frame annotation
      const simTime = await this.page.evaluate(() => window.VPDE.getTime());
      frameAnnotations.push({
        frameIndex: frame,
        simulationTime: simTime,
        intervention: interventions.find((i) => i.frame === frame),
      });

      // Progress logging
      if ((frame + 1) % 100 === 0 || frame === config.totalFrames - 1) {
        const elapsed = (Date.now() - startTime) / 1000;
        const fps = (frame + 1) / elapsed;
        console.log(
          `  Frame ${frame + 1}/${config.totalFrames} (${fps.toFixed(1)} fps)`
        );
      }
    }

    // Collect metadata
    const metadata = await this.collectMetadata(config, frameAnnotations);

    // Save metadata
    const metadataPath = path.join(config.outputDir, "metadata.json");
    await fs.writeFile(metadataPath, JSON.stringify(metadata, null, 2));

    console.log(`Simulation ${config.id} complete`);
    return metadata;
  }

  /**
   * Apply a brush intervention
   */
  private async applyIntervention(intervention: Intervention): Promise<void> {
    if (intervention.type === "brush") {
      const { x, y, species, value, radius } = intervention.params;
      await this.page.evaluate(
        (x, y, species, value, radius) => {
          window.VPDE.applyBrush(x, y, species, value, radius);
        },
        x,
        y,
        species,
        value,
        radius
      );
    }
  }

  /**
   * Save a frame to disk
   */
  private async saveFrame(
    dataUrl: string,
    outputDir: string,
    frameIndex: number
  ): Promise<void> {
    // Remove data URL prefix
    const base64Data = dataUrl.replace(/^data:image\/png;base64,/, "");
    const buffer = Buffer.from(base64Data, "base64");

    // Save with zero-padded frame number
    const filename = `${String(frameIndex).padStart(6, "0")}.png`;
    const filepath = path.join(outputDir, filename);
    await fs.writeFile(filepath, buffer);
  }

  /**
   * Collect simulation metadata
   */
  private async collectMetadata(
    config: SimulationConfig,
    frameAnnotations: FrameAnnotation[]
  ): Promise<SimulationMetadata> {
    const options = await this.page.evaluate(() => window.VPDE.getOptions());
    const finalTime = await this.page.evaluate(() => window.VPDE.getTime());

    // Parse kinetic parameters
    const kineticParams: Record<string, number> = {};
    const kpStr = options.kineticParams as string;
    if (kpStr) {
      const matches = kpStr.matchAll(/(\w+)\s*=\s*([\d.eE+-]+)/g);
      for (const match of matches) {
        kineticParams[match[1]] = parseFloat(match[2]);
      }
    }

    // Build equations array
    const numSpecies = (options.numSpecies as number) || 2;
    const reaction: string[] = [];
    const diffusion: (string | number)[] = [];
    const boundaryConditions: string[] = [];
    const initialConditions: string[] = [];

    for (let i = 1; i <= numSpecies; i++) {
      reaction.push((options[`reactionStr_${i}`] as string) || "0");
      diffusion.push((options[`diffusionStr_${i}_${i}`] as string) || "0");
      boundaryConditions.push(
        (options[`boundaryConditions_${i}`] as string) || "periodic"
      );
      initialConditions.push((options[`initCond_${i}`] as string) || "0");
    }

    return {
      id: config.id,
      preset: config.preset,
      timestamp: new Date().toISOString(),
      generatorVersion: "1.0.0",

      equations: {
        reaction,
        diffusion,
        boundaryConditions,
        initialConditions,
      },

      parameters: {
        kinetic: kineticParams,
        dt: options.dt as number,
        spatialStep: parseFloat(options.spatialStep as string),
        domainScale: options.domainScale as number,
        timesteppingScheme: (options.timesteppingScheme as string) || "Euler",
        numSpecies,
      },

      simulation: {
        totalFrames: config.totalFrames,
        timestepsPerFrame: config.timestepsPerFrame,
        totalTime: finalTime,
        resolution: config.resolution || [512, 512],
        randomSeed: config.randomSeed,
      },

      visualization: {
        colormap: (options.colourmap as string) || "turbo",
        minValue: options.minColourValue as number,
        maxValue: options.maxColourValue as number,
        whatToPlot: (options.whatToPlot as string) || "u",
      },

      interventions: config.interventions || [],
      frameAnnotations,
    };
  }
}
