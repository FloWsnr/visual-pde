# VisualPDE Data Generator

Generate training data from PDE simulations for vision-language models.

This is a fork of [VisualPDE](https://visualpde.com) modified to run headlessly and generate
PNG sequences with metadata for machine learning training.

## Features

- **100+ PDE presets**: Gray-Scott, Brusselator, FitzHugh-Nagumo, wave equations, heat equations, etc.
- **GPU-accelerated simulation**: WebGL shaders for fast computation
- **Programmatic interventions**: Apply brush strokes to modify concentrations mid-simulation
- **Rich metadata**: JSON files with equations, parameters, boundary conditions, and per-frame annotations
- **Parallel execution**: Run multiple simulations concurrently
- **Scale to 10k+**: Designed for large-scale dataset generation

## Installation

### Prerequisites

1. **Node.js 18+**
2. **Chrome/Chromium** with dependencies (for Puppeteer)

#### Installing Chrome Dependencies (Ubuntu/Debian)

```bash
sudo apt-get update
sudo apt-get install -y \
  libnss3 libxss1 libasound2 libatk1.0-0 libatk-bridge2.0-0 \
  libcups2 libdrm2 libgbm1 libgtk-3-0 libxcomposite1 libxdamage1 \
  libxfixes3 libxrandr2 libpango-1.0-0 libcairo2
```

Or install Chrome directly:
```bash
npx puppeteer browsers install chrome
```

### Install Dependencies

```bash
npm install
```

## Usage

### Run a Single Simulation

```bash
# Basic usage
npx tsx datagen/index.ts run --preset GrayScott --frames 500

# With options
npx tsx datagen/index.ts run \
  --preset BrusselatorPDE \
  --frames 1000 \
  --timesteps 100 \
  --width 512 \
  --height 512 \
  --output ./my-output \
  --seed 12345  # For reproducibility
```

### List Available Presets

```bash
npx tsx datagen/index.ts list-presets
npx tsx datagen/index.ts list-presets --category reactionDiffusion
```

### Generate Large Dataset

```bash
# Generate 1000 simulations across multiple presets
npx tsx datagen/index.ts generate \
  --count 1000 \
  --presets GrayScott,BrusselatorPDE,FHN,SIR \
  --frames 500 \
  --workers 4 \
  --randomize \
  --interventions \
  --output ./dataset
```

### Batch from Config File

```bash
npx tsx datagen/index.ts batch --config batch.yaml --workers 8
```

## Output Structure

```
output/
├── index.json              # Master index
├── GrayScott/
│   └── [uuid]/
│       ├── metadata.json   # Equations, parameters, annotations
│       └── frames/
│           ├── 000000.png
│           ├── 000001.png
│           └── ...
└── BrusselatorPDE/
    └── ...
```

### Metadata Format

```json
{
  "id": "...",
  "preset": "GrayScott",
  "equations": {
    "reaction": ["u^2*v - (a+b)*u", "-u^2*v + a*(1-v)"],
    "diffusion": ["1", "2"],
    "boundaryConditions": ["periodic", "periodic"],
    "initialConditions": ["0", "1"]
  },
  "parameters": {
    "kinetic": {"a": 0.037, "b": 0.06},
    "dt": 0.1,
    "spatialStep": 3,
    "domainScale": 100
  },
  "interventions": [...],
  "frameAnnotations": [...]
}
```

## Available Preset Categories

- **reactionDiffusion**: GrayScott, BrusselatorPDE, SchnakenbergPDE, GiererMeinhardt, FHN, Oregonator
- **waves**: waveEquation, dampedWaveEquation, KdV, sineGordon
- **diffusion**: heatEquation, nonlinearDiffusion, chemotaxis
- **biology**: SIR, SIS, SEIR, LotkaVolterra, predatorPrey, fisherKPP
- **fluids**: NavierStokes, BurgersPDE, KuramotoSivashinsky

## Architecture

```
datagen/
├── index.ts            # CLI entry point
├── browser-pool.ts     # Puppeteer browser management
├── simulation-runner.ts # Single simulation execution
├── orchestrator.ts     # Parallel job management
├── preset-sampler.ts   # Randomized preset generation
└── types.ts            # TypeScript interfaces

headless/
└── index.html          # Minimal page for headless simulation

sim/scripts/RD/
├── main.js             # Core simulation (with VPDE API)
├── presets.js          # 227 preset configurations
├── simulation_shaders.js
└── display_shaders.js
```

## Original VisualPDE

Based on [VisualPDE](https://visualpde.com) - Interactive PDE simulations in the browser.
See the [original publication](https://doi.org/10.1007/s11538-023-01218-4) for details.

## License

[Original VisualPDE License](LICENSE.md)
