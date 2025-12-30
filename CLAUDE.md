# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

VisualPDE Data Generation Pipeline is a headless system for generating synthetic PDE simulation datasets for vision-language model training. It leverages GPU-accelerated WebGL simulations running in headless Chrome to produce sequences of PNG frames with detailed JSON metadata.

**Original interactive site**: https://visualpde.com (no longer maintained in this fork)

## Quick Start

### Installation
```bash
npm install
```

### CLI Usage
```bash
# Single simulation
npx ts-node datagen/index.ts run --preset GrayScott --frames 500

# Batch from config
npx ts-node datagen/index.ts batch --config batch.yaml

# Large-scale generation
npx ts-node datagen/index.ts generate \
  --count 10000 \
  --presets GrayScott,BrusselatorPDE,SIR \
  --randomize \
  --workers 4 \
  --output ./dataset
```

## Architecture

### Core Simulation Engine (`sim/scripts/RD/`)
- **main.js** - Entry point with headless mode support, exposes `window.VPDE` API
- **presets.js** - Preset PDE configurations
- **simulation_shaders.js** - GLSL shaders for PDE solving
- **display_shaders.js** - Visualization shaders (colormaps, contours)
- **drawing_shaders.js** - Brush intervention shaders
- **post_shaders.js** - Post-processing effects

The simulation uses GPU-accelerated GLSL shaders with Three.js. Simulation state is stored in WebGL textures, updated each timestep by shaders, then rendered to canvas. In headless mode, jQuery/DOM operations are skipped and an API is exposed via `window.VPDE`.

### Headless Infrastructure (`headless/`)
- **index.html** - Minimal HTML page for headless Chrome (no UI)
- **bridge.js** - API exposure script (optional, main.js handles this)

Sets `window.HEADLESS_MODE = true` to disable UI initialization.

### Data Generation Pipeline (`datagen/`)
- **index.ts** - CLI entry point (Commander.js)
- **orchestrator.ts** - Job queue & parallel execution (p-queue)
- **browser-pool.ts** - Puppeteer browser lifecycle management
- **simulation-runner.ts** - Single simulation execution logic
- **frame-capture.ts** - PNG capture from canvas
- **intervention.ts** - Brush-based intervention system
- **metadata.ts** - JSON metadata generation
- **preset-sampler.ts** - Random preset/parameter generation
- **types.ts** - TypeScript interfaces

### Key Libraries
- **Puppeteer** - Headless Chrome automation with WebGL support
- **Three.js** - WebGL abstraction for GPU rendering
- **expr-eval** - Math expression parsing (PDE equations)
- **p-queue** - Parallel job execution
- **Commander.js** - CLI framework
- **jQuery** - Legacy dependency (used by main.js, skipped in headless mode)

## Headless Mode API

When `window.HEADLESS_MODE = true`, `sim/scripts/RD/main.js` exposes:

```javascript
window.VPDE = {
  // Simulation control
  play: () => void,
  pause: () => void,
  reset: () => void,

  // Timestep control
  step: () => void,              // Single timestep
  stepN: (n: number) => void,    // N timesteps
  render: () => void,            // Render current state

  // State access
  getTime: () => number,
  getOptions: () => object,

  // Configuration
  loadPreset: (name: string) => void,
  setOption: (key: string, value: any) => void,
  updateProblem: () => void,

  // Brush intervention
  applyBrush: (x, y, species, value, radius) => void,

  // Frame capture
  captureFrame: () => string,    // Returns PNG data URL

  // Internals (advanced use)
  _uniforms: object,
  _renderer: THREE.WebGLRenderer,
  _simTextures: object
};

window.VPDE_READY = true;  // Set when initialization complete
```

## Output Format

```
output/
├── index.json              # Master index
├── GrayScott/
│   ├── 000001/
│   │   ├── metadata.json   # Equations, parameters, interventions
│   │   └── frames/
│   │       ├── 000000.png
│   │       ├── 000001.png
│   │       └── ...
│   ├── 000002/
│   └── ...
└── BrusselatorPDE/
    └── ...
```

### Metadata Schema
Each simulation's `metadata.json` contains:
- **equations**: Reaction terms, diffusion matrix, boundary/initial conditions
- **parameters**: Kinetic parameters, dt, spatial step, domain scale
- **simulation**: Frame count, timesteps per frame, resolution, random seed
- **visualization**: Colormap, value ranges
- **interventions**: Brush interventions with frame timing
- **frameAnnotations** (optional): Per-frame captions/descriptions

See `datagen/types.ts` for full TypeScript interfaces.

## Technology Stack

- **Runtime**: Puppeteer (headless Chrome) with `--use-gl=egl` for GPU rendering
- **Simulation**: Three.js + WebGL GLSL shaders (GPU-accelerated)
- **Pipeline**: TypeScript, Node.js, p-queue for parallelization
- **CLI**: Commander.js
- **Legacy**: jQuery (skipped in headless mode)

## Key Files

- `sim/scripts/RD/main.js` - Simulation engine with headless mode + API exposure
- `headless/index.html` - Minimal page for headless Chrome
- `datagen/index.ts` - CLI entry point
- `datagen/simulation-runner.ts` - Core simulation execution logic
- `package.json` - Node dependencies (Puppeteer, TypeScript, etc.)
- `tsconfig.json` - TypeScript configuration

## Deleted Components (Post-Refactor)

The following Jekyll website components have been removed:
- `_layouts/`, `_includes/` - Jekyll templates
- `_*-pdes/` - Content collections
- `_user-guide/`, `_visual-stories/` - Documentation
- `_config.yml`, `Gemfile` - Jekyll config
- `sim/css/` - UI stylesheets
- Most of `assets/` - Images, CSS, search indexes

## Development Workflow

1. **Modify simulation engine**: Edit `sim/scripts/RD/main.js` or shader files
2. **Test headless mode**: Run single simulation with `datagen/index.ts run`
3. **Validate metadata**: Check `output/*/metadata.json` structure
4. **Scale up**: Use batch mode for multi-simulation testing
5. **Production run**: Use `generate` command with high `--count` and `--workers`

## Browser Pool Configuration

Controlled via `BrowserPoolConfig` in `datagen/browser-pool.ts`:
- **poolSize**: Concurrent browsers (2-8 recommended, RAM-dependent)
- **headless**: Always `true` for data generation
- **width/height**: Canvas resolution (default 512x512)

Puppeteer launch args:
- `--use-gl=egl` - GPU rendering (or `--use-gl=swiftshader` for CPU fallback)
- `--disable-web-security` - Allow file:// protocol access
- `--no-sandbox` - Required for some Docker environments
