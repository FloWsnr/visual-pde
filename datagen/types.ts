/**
 * Type definitions for the VisualPDE data generation pipeline
 */

// ============================================================================
// Simulation Configuration
// ============================================================================

export interface SimulationConfig {
  /** Unique simulation identifier */
  id: string;

  /** Base preset name (e.g., "GrayScott", "BrusselatorPDE") */
  preset: string;

  /** Option overrides to apply on top of preset */
  options?: Partial<SimulationOptions>;

  /** Total number of frames to capture */
  totalFrames: number;

  /** Number of simulation timesteps per captured frame */
  timestepsPerFrame: number;

  /** Scheduled interventions (brush applications) */
  interventions?: Intervention[];

  /** Output directory for this simulation */
  outputDir: string;

  /** Random seed for reproducibility */
  randomSeed?: number;

  /** Canvas resolution [width, height] */
  resolution?: [number, number];
}

export interface SimulationOptions {
  // PDE Equations
  reactionStr_1: string;
  reactionStr_2: string;
  reactionStr_3: string;
  reactionStr_4: string;

  // Diffusion (diagonal)
  diffusionStr_1_1: string;
  diffusionStr_2_2: string;
  diffusionStr_3_3: string;
  diffusionStr_4_4: string;

  // Cross-diffusion (off-diagonal)
  diffusionStr_1_2?: string;
  diffusionStr_2_1?: string;
  // ... etc

  // Boundary conditions
  boundaryConditions_1: "periodic" | "dirichlet" | "neumann" | "robin" | "combo";
  boundaryConditions_2: "periodic" | "dirichlet" | "neumann" | "robin" | "combo";
  boundaryConditions_3: "periodic" | "dirichlet" | "neumann" | "robin" | "combo";
  boundaryConditions_4: "periodic" | "dirichlet" | "neumann" | "robin" | "combo";

  // Initial conditions
  initCond_1: string;
  initCond_2: string;
  initCond_3: string;
  initCond_4: string;

  // Spatial/temporal
  domainScale: number;
  spatialStep: number;
  dt: number;
  dimension: "1" | "2";
  minX: number;
  minY: number;

  // Solver
  numSpecies: number;
  numTimestepsPerFrame: number;
  timesteppingScheme: "Euler" | "Mid";

  // Kinetic parameters (parsed from kineticParams string)
  kineticParams: string;

  // Visualization
  colourmap: string;
  minColourValue: number;
  maxColourValue: number;
  whatToPlot: string;

  // Random seed
  setSeed: boolean;
  randSeed: number;

  // Allow any additional options
  [key: string]: unknown;
}

// ============================================================================
// Interventions
// ============================================================================

export interface Intervention {
  /** Frame index when this intervention should be applied */
  frame: number;

  /** Simulation time when intervention was applied (filled during execution) */
  simulationTime?: number;

  /** Type of intervention */
  type: "brush";

  /** Intervention parameters */
  params: BrushParams;
}

export interface BrushParams {
  /** X coordinate (0-1 normalized) */
  x: number;

  /** Y coordinate (0-1 normalized) */
  y: number;

  /** Species to modify ("u", "v", "w", "q") */
  species: "u" | "v" | "w" | "q";

  /** Value to apply */
  value: number;

  /** Brush radius (simulation units) */
  radius: number;

  /** Brush shape */
  shape?: "circle" | "square";

  /** Brush action */
  action?: "replace" | "add";
}

// ============================================================================
// Metadata Output
// ============================================================================

export interface SimulationMetadata {
  /** Unique simulation identifier */
  id: string;

  /** Base preset used */
  preset: string;

  /** Generation timestamp (ISO 8601) */
  timestamp: string;

  /** Generator version */
  generatorVersion: string;

  /** PDE equations and conditions */
  equations: {
    /** Reaction terms for each species */
    reaction: string[];

    /** Diffusion coefficients (diagonal) */
    diffusion: (string | number)[];

    /** Cross-diffusion matrix (if enabled) */
    crossDiffusion?: (string | number)[][];

    /** Boundary conditions for each species */
    boundaryConditions: string[];

    /** Initial conditions for each species */
    initialConditions: string[];
  };

  /** Numerical parameters */
  parameters: {
    /** User-defined kinetic parameters */
    kinetic: Record<string, number>;

    /** Time step */
    dt: number;

    /** Spatial step */
    spatialStep: number;

    /** Domain scale */
    domainScale: number;

    /** Timestepping scheme */
    timesteppingScheme: string;

    /** Number of species */
    numSpecies: number;
  };

  /** Simulation run details */
  simulation: {
    /** Total frames captured */
    totalFrames: number;

    /** Timesteps executed per frame */
    timestepsPerFrame: number;

    /** Total simulation time */
    totalTime: number;

    /** Canvas resolution */
    resolution: [number, number];

    /** Random seed used (if set) */
    randomSeed?: number;
  };

  /** Visualization settings */
  visualization: {
    /** Color map name */
    colormap: string;

    /** Color value range */
    minValue: number;
    maxValue: number;

    /** What expression is being plotted */
    whatToPlot: string;
  };

  /** Applied interventions with timing */
  interventions: Intervention[];

  /** Per-frame annotations (optional, for VLM training) */
  frameAnnotations?: FrameAnnotation[];
}

export interface FrameAnnotation {
  /** Frame index */
  frameIndex: number;

  /** Simulation time at this frame */
  simulationTime: number;

  /** Intervention applied at this frame (if any) */
  intervention?: Intervention;

  /** Text caption describing what's happening */
  caption?: string;

  /** Additional tags/labels */
  tags?: string[];
}

// ============================================================================
// Batch Generation
// ============================================================================

export interface BatchConfig {
  /** Output base directory */
  outputDir: string;

  /** Number of parallel workers (browser instances) */
  workers: number;

  /** List of simulation configurations to run */
  simulations: SimulationConfig[];

  /** Global defaults applied to all simulations */
  defaults?: Partial<SimulationConfig>;
}

export interface GenerateConfig {
  /** Number of simulations to generate */
  count: number;

  /** Presets to sample from */
  presets: string[];

  /** Whether to randomize parameters */
  randomize: boolean;

  /** Parameter randomization ranges */
  parameterRanges?: Record<string, [number, number]>;

  /** Whether to add random interventions */
  randomInterventions: boolean;

  /** Intervention frequency range [min, max] frames between interventions */
  interventionFrequency?: [number, number];

  /** Output directory */
  outputDir: string;

  /** Number of workers */
  workers: number;

  /** Frames per simulation */
  framesPerSim: number;

  /** Timesteps per frame */
  timestepsPerFrame: number;

  /** Resolution */
  resolution: [number, number];
}

// ============================================================================
// Browser Pool
// ============================================================================

export interface BrowserPoolConfig {
  /** Number of browser instances to maintain */
  poolSize: number;

  /** Run in headless mode */
  headless: boolean;

  /** Canvas width */
  width: number;

  /** Canvas height */
  height: number;

  /** Path to the headless HTML file */
  htmlPath: string;

  /** Maximum simulations before browser restart (to prevent memory leaks) */
  maxSimsPerBrowser?: number;

  /** Use SwiftShader for software WebGL rendering (for headless/WSL/HPC environments) */
  useSwiftShader?: boolean;
}

// ============================================================================
// Progress Tracking
// ============================================================================

export interface JobStatus {
  id: string;
  config: SimulationConfig;
  status: "pending" | "running" | "completed" | "failed";
  startTime?: Date;
  endTime?: Date;
  error?: string;
  retryCount: number;
}

export interface ProgressReport {
  total: number;
  completed: number;
  failed: number;
  running: number;
  pending: number;
  elapsedMs: number;
  estimatedRemainingMs?: number;
}
