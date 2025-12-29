/**
 * Orchestrator - manages parallel simulation execution
 */

import PQueue from "p-queue";
import * as fs from "fs/promises";
import * as path from "path";
import { BrowserPool } from "./browser-pool.js";
import { SimulationRunner } from "./simulation-runner.js";
import {
  SimulationConfig,
  BatchConfig,
  JobStatus,
  ProgressReport,
  SimulationMetadata,
} from "./types.js";

export class Orchestrator {
  private browserPool: BrowserPool;
  private queue: PQueue;
  private jobs: Map<string, JobStatus> = new Map();
  private startTime: number = 0;
  private completedCount = 0;
  private failedCount = 0;

  constructor(
    browserPool: BrowserPool,
    concurrency: number = 4,
    private maxRetries: number = 3
  ) {
    this.browserPool = browserPool;
    this.queue = new PQueue({ concurrency });
  }

  /**
   * Run a batch of simulations
   */
  async runBatch(config: BatchConfig): Promise<SimulationMetadata[]> {
    console.log(`Starting batch of ${config.simulations.length} simulations`);
    console.log(`Workers: ${config.workers}, Max retries: ${this.maxRetries}`);

    this.startTime = Date.now();
    this.completedCount = 0;
    this.failedCount = 0;

    // Initialize jobs
    for (const simConfig of config.simulations) {
      const fullConfig = this.mergeWithDefaults(simConfig, config.defaults);
      this.jobs.set(fullConfig.id, {
        id: fullConfig.id,
        config: fullConfig,
        status: "pending",
        retryCount: 0,
      });
    }

    // Create master index directory
    await fs.mkdir(config.outputDir, { recursive: true });

    // Queue all jobs
    const results: SimulationMetadata[] = [];
    const promises = config.simulations.map((simConfig) => {
      const fullConfig = this.mergeWithDefaults(simConfig, config.defaults);
      return this.queue.add(async () => {
        const result = await this.runWithRetry(fullConfig);
        if (result) {
          results.push(result);
        }
        return result;
      });
    });

    // Wait for all jobs
    await Promise.all(promises);

    // Write master index
    const index = {
      generated: new Date().toISOString(),
      total_simulations: config.simulations.length,
      completed: this.completedCount,
      failed: this.failedCount,
      elapsed_ms: Date.now() - this.startTime,
      simulations: results.map((m) => ({
        id: m.id,
        preset: m.preset,
        path: path.relative(config.outputDir, path.dirname(m.id)),
      })),
    };
    await fs.writeFile(
      path.join(config.outputDir, "index.json"),
      JSON.stringify(index, null, 2)
    );

    console.log(
      `\nBatch complete: ${this.completedCount} succeeded, ${this.failedCount} failed`
    );
    return results;
  }

  /**
   * Run a single simulation with retry logic
   */
  private async runWithRetry(
    config: SimulationConfig
  ): Promise<SimulationMetadata | null> {
    const job = this.jobs.get(config.id)!;
    job.status = "running";
    job.startTime = new Date();

    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      try {
        const page = await this.browserPool.acquirePage();
        const htmlPath = this.browserPool.getHtmlPath();

        try {
          const runner = new SimulationRunner(page, htmlPath);
          const metadata = await runner.run(config);

          job.status = "completed";
          job.endTime = new Date();
          this.completedCount++;
          this.logProgress();

          return metadata;
        } finally {
          await this.browserPool.releasePage(page);
        }
      } catch (error) {
        job.retryCount++;
        job.error = error instanceof Error ? error.message : String(error);

        if (attempt < this.maxRetries) {
          console.warn(
            `Simulation ${config.id} failed (attempt ${attempt + 1}/${this.maxRetries + 1}): ${job.error}`
          );
          // Wait before retry
          await new Promise((resolve) =>
            setTimeout(resolve, 1000 * (attempt + 1))
          );
        } else {
          console.error(
            `Simulation ${config.id} failed after ${this.maxRetries + 1} attempts: ${job.error}`
          );
          job.status = "failed";
          job.endTime = new Date();
          this.failedCount++;
          this.logProgress();

          // Save error info
          try {
            await fs.mkdir(config.outputDir, { recursive: true });
            await fs.writeFile(
              path.join(config.outputDir, "error.json"),
              JSON.stringify(
                {
                  id: config.id,
                  error: job.error,
                  retryCount: job.retryCount,
                  timestamp: new Date().toISOString(),
                },
                null,
                2
              )
            );
          } catch (e) {
            // Ignore write errors
          }
        }
      }
    }

    return null;
  }

  /**
   * Merge simulation config with defaults
   */
  private mergeWithDefaults(
    config: SimulationConfig,
    defaults?: Partial<SimulationConfig>
  ): SimulationConfig {
    if (!defaults) return config;

    return {
      ...defaults,
      ...config,
      options: {
        ...defaults.options,
        ...config.options,
      },
    } as SimulationConfig;
  }

  /**
   * Log progress
   */
  private logProgress(): void {
    const total = this.jobs.size;
    const completed = this.completedCount;
    const failed = this.failedCount;
    const elapsed = Date.now() - this.startTime;
    const remaining = total - completed - failed;

    const rate = completed / (elapsed / 1000); // sims per second
    const eta = remaining / rate; // seconds

    console.log(
      `Progress: ${completed}/${total} completed, ${failed} failed ` +
        `(${rate.toFixed(2)} sims/s, ETA: ${Math.round(eta)}s)`
    );
  }

  /**
   * Get current progress report
   */
  getProgress(): ProgressReport {
    const elapsed = Date.now() - this.startTime;
    const completed = this.completedCount;
    const failed = this.failedCount;
    const total = this.jobs.size;
    const remaining = total - completed - failed;

    let estimatedRemaining: number | undefined;
    if (completed > 0) {
      const rate = completed / elapsed;
      estimatedRemaining = remaining / rate;
    }

    return {
      total,
      completed,
      failed,
      running: this.queue.pending,
      pending: remaining - this.queue.pending,
      elapsedMs: elapsed,
      estimatedRemainingMs: estimatedRemaining,
    };
  }

  /**
   * Get all job statuses
   */
  getJobStatuses(): JobStatus[] {
    return Array.from(this.jobs.values());
  }
}
