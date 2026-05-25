---
name: tsl-materialx-noise
description: Reference for Three.js TSL MaterialX noise functions (mx_noise_*, mx_fractal_noise_*, mx_cell_noise_*, mx_worley_noise_*). Use when writing TSL shaders with Perlin, fBm, cell, or Worley noise, vertex displacement, domain warping, terrain, clouds, water, or dissolve masks.
disable-model-invocation: true
---

# Three.js TSL — MaterialX Noise

Built-in noise from `three/tsl` (MaterialX GLSL). Works on WebGL and WebGPU. No external library.

## Import

```js
import {
  mx_noise_float, mx_noise_vec3, mx_noise_vec4,
  mx_fractal_noise_float, mx_fractal_noise_vec2,
  mx_fractal_noise_vec3, mx_fractal_noise_vec4,
  mx_cell_noise_float,
  mx_worley_noise_float, mx_worley_noise_vec2, mx_worley_noise_vec3
} from 'three/tsl'
```

## Quick reference

| function | returns | input | output range | key params |
|---|---|---|---|---|
| `mx_noise_float` | float | vec2 \| vec3 | [-1, 1] | amplitude, pivot |
| `mx_noise_vec3` | vec3 | vec2 \| vec3 | [-1, 1] per channel | amplitude, pivot |
| `mx_noise_vec4` | vec4 | vec2 \| vec3 | [-1, 1] per channel | amplitude, pivot |
| `mx_fractal_noise_float` | float | **vec3 only** | [-1, 1] approx | octaves, lacunarity, diminish, amplitude |
| `mx_fractal_noise_vec2` | vec2 | **vec3 only** | [-1, 1] per channel | same as above |
| `mx_fractal_noise_vec3` | vec3 | **vec3 only** | [-1, 1] per channel | same as above |
| `mx_fractal_noise_vec4` | vec4 | **vec3 only** | [-1, 1] per channel | same as above |
| `mx_cell_noise_float` | float | vec2 \| vec3 | [0, 1] | none |
| `mx_worley_noise_float` | float (F1) | vec2 \| vec3 | [0, ~1] | jitter |
| `mx_worley_noise_vec2` | vec2 (F1, F2) | vec2 \| vec3 | [0, ~1] | jitter |
| `mx_worley_noise_vec3` | vec3 (F1, F2, F2-F1) | vec2 \| vec3 | [0, ~1] | jitter |

## Common mistakes

- **`mx_fractal_noise_*` requires vec3** — vec2 errors. Use `vec3(uv(), 0.0)` for 2D.
- **Perlin outputs [-1, 1]** — remap with `.mul(0.5).add(0.5)` for color/masks.
- **`mx_cell_noise_float` is already [0, 1]** — do not remap.
- **TSL method chaining** — `.mul()`, `.add()`, `.abs()`, `.oneMinus()`, not GLSL function calls.

## Common patterns

### Remap [-1,1] to [0,1]

```js
const n01 = mx_noise_float(coord).mul(0.5).add(0.5);
```

### Animated noise (time on z)

```js
const coord = vec3(uv().mul(scale), time.mul(speed));
const n = mx_fractal_noise_float(coord);
```

### Domain warping

```js
const q = mx_noise_vec3(positionLocal);
const r = mx_noise_vec3(positionLocal.add(q.mul(warpStrength)));
const final = mx_fractal_noise_float(positionLocal.add(r.mul(0.5)));
```

### Turbulence

```js
const turb = mx_fractal_noise_float(coord).abs();
```

### Worley + fractal

```js
const base = mx_fractal_noise_float(coord, int(3)).mul(0.5).add(0.5);
const cells = mx_worley_noise_float(coord.xy.mul(5), float(1.0));
const combined = base.mul(cells.oneMinus());
```

## When to use which

| Need | Function |
|---|---|
| Smooth height/color/displacement | `mx_noise_float` / `mx_noise_vec3` |
| Terrain, clouds, organic detail | `mx_fractal_noise_float` |
| UV/domain warp | `mx_fractal_noise_vec2` |
| Blocky random tiles | `mx_cell_noise_float` |
| Cells, bubbles, scales, cracks | `mx_worley_noise_float` |
| Cell edges / outlines | `mx_worley_noise_vec2` or `vec3` (`.z` = F2−F1) |

## Full API

Per-function signatures, parameters, examples, and use cases: [reference.md](reference.md)

Project doc (same content): `app/assets/docs/tsl-materialx-noise.md`
