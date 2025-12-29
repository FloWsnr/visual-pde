# VisualPDE Data Generation Pipeline - Implementation Plan

Transform VisualPDE from an interactive browser-based PDE simulator into a headless data generation pipeline for vision-language model training.

## Summary

- **Runtime**: Puppeteer/Playwright (headless Chrome with full WebGL)
- **Output**: PNG sequences + JSON metadata per simulation
- **Scale**: 10,000+ simulations with parallelization
- **Approach**: Modify in-place, delete unused website files
- **Interventions**: Brush-like only (paint circles/squares)

---

## Phase 1: Cleanup - Delete Unused Files

Remove Jekyll website and browser UI files:

```
DELETE:
├── _layouts/           # Jekyll templates (except reference sim.html)
├── _includes/          # Jekyll partials
├── _*-pdes/            # Content collections (basic-pdes, art-pdes, etc.)
├── _user-guide/        # Documentation pages
├── _visual-stories/    # Educational content
├── _config.yml         # Jekyll config
├── Gemfile, Gemfile.lock
├── index.html, index.md
├── about/, assets/css/, assets/images/
├── manifest.json       # PWA manifest
├── .htaccess
├── sim/css/            # UI stylesheets
└── Most of assets/js/  # Keep only expr-eval, lz-string, three.js deps
```

**Keep:**
- `sim/scripts/RD/` - Core simulation engine
- `sim/scripts/*.js` - Three.js, expr-eval, dat.gui (dat.gui optional)
- `assets/js/jQuery.js` - Required by main.js (can remove later with refactoring)

---

## Phase 2: Create Headless Infrastructure

### 2.1 New Directory Structure

```
visual-pde/
├── package.json                 # Node.js project (Puppeteer, etc.)
├── tsconfig.json                # TypeScript config
├── datagen/                     # NEW: Data generation code
│   ├── index.ts                 # CLI entry point
│   ├── orchestrator.ts          # Job queue & parallelization
│   ├── browser-pool.ts          # Puppeteer browser management
│   ├── simulation-runner.ts     # Single simulation execution
│   ├── frame-capture.ts         # PNG capture logic
│   ├── intervention.ts          # Brush intervention system
│   ├── metadata.ts              # JSON metadata generation
│   ├── preset-sampler.ts        # Random preset generation
│   └── types.ts                 # TypeScript interfaces
├── headless/                    # NEW: Minimal browser page
│   ├── index.html               # Stripped-down HTML for headless
│   └── bridge.js                # API exposure script
├── sim/scripts/RD/              # EXISTING: Core engine (modified)
│   ├── main.js                  # Add headless mode + API exposure
│   ├── presets.js               # Unchanged
│   ├── simulation_shaders.js    # Unchanged
│   └── ...
└── output/                      # Default output directory
```

### 2.2 Minimal HTML (`headless/index.html`)

```html
<!DOCTYPE html>
<html>
<head>
  <script>
    window.HEADLESS_MODE = true;
    window.expandingOptionsInProgress = false;
    window.linkParsed = true;
    window.badLink = false;
  </script>
  <script src="/sim/scripts/expr-eval.js"></script>
  <script src="/assets/js/jQuery.js"></script>
</head>
<body>
  <canvas id="simCanvas" width="512" height="512"></canvas>
  <script type="module" src="/sim/scripts/RD/main.js"></script>
</body>
</html>
```

---

## Phase 3: Modify main.js for Headless Mode

### 3.1 Add Headless Mode Check (near line 95)

```javascript
// Before the VisualPDE() call
if (window.HEADLESS_MODE) {
  window.expandingOptionsInProgress = false;
  window.linkParsed = true;
}
```

### 3.2 Skip UI in Headless Mode (throughout file)

Wrap jQuery/DOM operations with headless checks:
```javascript
if (!window.HEADLESS_MODE) {
  $("#pause").hide();
  // etc.
}
```

Key areas to wrap:
- Lines 4468-4476 (pauseSim UI)
- Lines 4479-4484 (playSim UI)
- All `$()` jQuery selectors
- dat.gui initialization
- Stats display
- Modal dialogs

### 3.3 Expose Internal API (end of VisualPDE function, ~line 11680)

```javascript
if (window.HEADLESS_MODE) {
  window.VPDE = {
    // Simulation control
    play: playSim,
    pause: pauseSim,
    reset: resetSim,

    // Timestep control
    step: () => { timestep(); },
    stepN: (n) => { for(let i=0; i<n; i++) timestep(); },
    render: () => { render(); },

    // State access
    getTime: () => uniforms.t.value,
    getOptions: () => options,

    // Configuration
    loadPreset: loadPreset,
    setOption: (key, val) => { options[key] = val; },
    updateProblem: updateProblem,

    // Brush intervention
    applyBrush: (x, y, species, value, radius) => {
      uniforms.brushCoords.value.set(x, y);
      options.whatToDraw = species;
      options.brushValue = String(value);
      options.brushRadius = String(radius);
      setBrushType();
      isDrawing = true;
      draw();
      isDrawing = false;
    },

    // Frame capture (canvas already has preserveDrawingBuffer:true)
    captureFrame: () => canvas.toDataURL('image/png'),

    // Internals for advanced use
    _uniforms: uniforms,
    _renderer: renderer,
    _simTextures: simTextures,
  };

  window.VPDE_READY = true;
}
```

### 3.4 Deterministic Random Seeds

Modify seed initialization (~line 210):
```javascript
seed = window.VPDE_SEED ?? (options.setSeed ? options.randSeed : performance.now());
```

---

## Phase 4: Puppeteer Integration

### 4.1 Browser Pool (`datagen/browser-pool.ts`)

```typescript
interface BrowserPoolConfig {
  poolSize: number;        // Concurrent browsers (2-8 depending on RAM)
  headless: boolean;       // true for data generation
  width: number;           // Canvas width
  height: number;          // Canvas height
}

// Launch with WebGL support
puppeteer.launch({
  headless: 'new',
  args: [
    '--use-gl=egl',        // GPU rendering
    '--disable-web-security',
    '--no-sandbox',
  ]
});
```

### 4.2 Simulation Runner (`datagen/simulation-runner.ts`)

```typescript
async function runSimulation(page: Page, config: SimConfig): Promise<void> {
  // 1. Navigate with preset
  await page.goto(`file://.../headless/index.html?preset=${config.preset}`);

  // 2. Wait for ready
  await page.waitForFunction(() => window.VPDE_READY === true);

  // 3. Apply any option overrides
  await page.evaluate((opts) => {
    Object.entries(opts).forEach(([k,v]) => window.VPDE.setOption(k, v));
    window.VPDE.updateProblem();
  }, config.options);

  // 4. Run simulation with frame capture
  for (let frame = 0; frame < config.totalFrames; frame++) {
    // Apply scheduled interventions
    for (const intervention of config.interventions) {
      if (intervention.frame === frame) {
        await page.evaluate((i) => {
          window.VPDE.applyBrush(i.x, i.y, i.species, i.value, i.radius);
        }, intervention);
      }
    }

    // Step simulation
    await page.evaluate((n) => {
      window.VPDE.stepN(n);
      window.VPDE.render();
    }, config.timestepsPerFrame);

    // Capture frame
    const dataUrl = await page.evaluate(() => window.VPDE.captureFrame());
    await saveFrame(dataUrl, config.outputDir, frame);
  }

  // 5. Save metadata
  const metadata = await page.evaluate(() => ({
    equations: getEquationsMetadata(),
    options: window.VPDE.getOptions(),
    // ...
  }));
  await saveMetadata(metadata, config.outputDir);
}
```

---

## Phase 5: Metadata Schema

### 5.1 Simulation Metadata (`metadata.json`)

```typescript
interface SimulationMetadata {
  id: string;
  preset: string;
  timestamp: string;

  equations: {
    reaction: string[];          // ["u^2*v - (a+b)*u", "-u^2*v + a*(1-v)"]
    diffusion: number[][];       // [[1, 0], [0, 2]]
    boundaryConditions: string[];
    initialConditions: string[];
  };

  parameters: {
    kinetic: Record<string, number>;  // {a: 0.037, b: 0.06}
    dt: number;
    spatialStep: number;
    domainScale: number;
    timesteppingScheme: string;
  };

  simulation: {
    totalFrames: number;
    timestepsPerFrame: number;
    resolution: [number, number];
    randomSeed?: number;
  };

  visualization: {
    colormap: string;
    minValue: number;
    maxValue: number;
  };

  interventions: Intervention[];

  // Per-frame annotations (populated during/after generation)
  frameAnnotations?: FrameAnnotation[];
}
```

### 5.2 Per-Frame Annotation

```typescript
interface FrameAnnotation {
  frameIndex: number;
  simulationTime: number;
  intervention?: Intervention;
  caption?: string;  // Manual or auto-generated description
}
```

---

## Phase 6: Parallelization & CLI

### 6.1 Orchestrator (`datagen/orchestrator.ts`)

```typescript
// Job queue with parallel workers
const queue = new PQueue({ concurrency: config.workers });

for (const simConfig of allConfigs) {
  queue.add(() => runSimulationWithRetry(simConfig, 3));
}

// Progress tracking
queue.on('active', () => console.log(`Progress: ${completed}/${total}`));
```

### 6.2 CLI Interface (`datagen/index.ts`)

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

---

## Phase 7: Output Organization

```
output/
├── index.json              # Master index of all simulations
├── GrayScott/
│   ├── 000001/
│   │   ├── metadata.json
│   │   └── frames/
│   │       ├── 000000.png
│   │       ├── 000001.png
│   │       └── ...
│   ├── 000002/
│   └── ...
├── BrusselatorPDE/
└── ...
```

---

## Implementation Order

1. **Phase 1**: Delete unused files (Jekyll, docs, etc.)
2. **Phase 2**: Create `headless/index.html` and basic structure
3. **Phase 3**: Modify `main.js` - add headless mode + expose API
4. **Phase 4**: Implement Puppeteer browser pool and simulation runner
5. **Phase 5**: Implement metadata generation
6. **Phase 6**: Add CLI and parallelization
7. **Phase 7**: Test with small batch, then scale to 10k+

---

## Key Files to Modify

| File | Changes |
|------|---------|
| `sim/scripts/RD/main.js` | Add headless mode checks, expose VPDE API |
| NEW `headless/index.html` | Minimal HTML for headless operation |
| NEW `datagen/*.ts` | Data generation pipeline |
| NEW `package.json` | Node.js project with Puppeteer |

---

## Risks & Mitigations

| Risk | Mitigation |
|------|------------|
| WebGL instability in headless | Use `--use-gl=swiftshader` fallback for CPU rendering |
| Memory leaks with many simulations | Restart browser after N simulations |
| jQuery dependency | Wrap all jQuery in headless checks (defer full removal) |
| Frame capture overhead | Capture every N frames, batch writes |

---

## Dependencies to Add

```json
{
  "dependencies": {
    "puppeteer": "^21.0.0",
    "p-queue": "^7.0.0",
    "commander": "^11.0.0"
  },
  "devDependencies": {
    "typescript": "^5.0.0",
    "@types/node": "^20.0.0"
  }
}
```
