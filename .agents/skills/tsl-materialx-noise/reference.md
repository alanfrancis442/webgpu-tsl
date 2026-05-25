# Three.js TSL — MaterialX Noise Functions

## Context

These are built-in noise functions in Three.js TSL (Three.js Shading Language), importable directly from `three/tsl`. They are compiled from MaterialX GLSL and work on both WebGL and WebGPU backends. No external library needed.

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

---

## 1. mx_noise_float

**Type:** Perlin / gradient noise  
**Returns:** `float`  
**Output range:** `[-1, 1]`

### Signature
```
mx_noise_float( position, amplitude = 1.0, pivot = 0.0 )
```

### Parameters
| param | type | default | description |
|---|---|---|---|
| position | vec2 \| vec3 | required | Sample coordinate |
| amplitude | float | 1.0 | Multiplies the raw noise output |
| pivot | float | 0.0 | Offset applied before amplitude scaling |

### Notes
- Raw output is `[-1, 1]`. Remap to `[0,1]` with `.mul(0.5).add(0.5)`.
- The `pivot` param shifts the midpoint: `output = pivot + amplitude * raw_noise`.

### Examples
```js
// Basic 2D
const n = mx_noise_float( uv().mul(5.0) );

// 3D with remap to [0,1]
const n = mx_noise_float( positionLocal.mul(2.0) ).mul(0.5).add(0.5);

// Animated — add time on z axis
const n = mx_noise_float( vec3( uv().mul(4.0), time.mul(0.3) ) );

// Vertex displacement
material.positionNode = positionLocal.add(
  normalLocal.mul( mx_noise_float( positionLocal.mul(3.0) ) )
);
```

### Use cases
terrain height, color variation, vertex displacement, dissolve masks, animated surface

---

## 2. mx_noise_vec3

**Type:** Perlin / gradient noise  
**Returns:** `vec3` (3 independent noise channels)  
**Output range:** each component `[-1, 1]`

### Signature
```
mx_noise_vec3( position, amplitude = 1.0, pivot = 0.0 )
```

### Parameters
Same as `mx_noise_float`.

### Notes
- Each component is a differently seeded gradient noise.
- Use `.xxx` swizzle to get greyscale from a single component.

### Examples
```js
// Water surface color blend
const p = uv().sub(0.5).mul(8.0);
const rawNoise = mx_noise_vec3( vec3( p, time.mul(0.5) ) );
const n = float(0.5).add( float(0.5).mul( rawNoise.x ) );
material.colorNode = mix( colorA, colorB, n );

// Greyscale via swizzle
const grey = mx_noise_vec3( coord ).xxx;

// Domain warp offset
const offset = mx_noise_vec3( positionLocal ).mul( float(0.2) );
const warpedCoord = positionLocal.add( offset );
```

### Use cases
water surface, domain warping, 3D color noise, directional displacement

---

## 3. mx_noise_vec4

**Type:** Perlin / gradient noise  
**Returns:** `vec4` (4 independent noise channels)  
**Output range:** each component `[-1, 1]`

### Signature
```
mx_noise_vec4( position, amplitude = 1.0, pivot = 0.0 )
```

### Notes
- Identical API to `mx_noise_vec3`, adds a 4th independent channel.

### Examples
```js
const n4 = mx_noise_vec4( positionLocal );
const colorPart = n4.rgb.mul(0.5).add(0.5);
const alphaPart  = n4.w.mul(0.5).add(0.5);
```

### Use cases
rgba noise texture, 4-axis offsets

---

## 4. mx_fractal_noise_float

**Type:** Fractal Brownian Motion (fBm)  
**Returns:** `float`  
**Output range:** approx `[-1, 1]`

### Signature
```
mx_fractal_noise_float( position, octaves = 3, lacunarity = 2.0, diminish = 0.5, amplitude = 1.0 )
```

### Parameters
| param | type | default | description |
|---|---|---|---|
| position | vec3 | required | **Always vec3** — even for 2D, wrap with `vec3(uv(), 0.0)` |
| octaves | int | 3 | Number of noise layers. More = finer detail, higher cost. Typical range: 1–8. |
| lacunarity | float | 2.0 | Frequency multiplier per octave. Higher = more spread between layers. |
| diminish | float | 0.5 | Amplitude multiplier per octave. Lower = faster detail falloff. |
| amplitude | float | 1.0 | Overall output scale. |

### Notes
- **Position must be vec3.** This is the most common mistake — unlike base functions, vec2 is not accepted.
- Remap output to `[0,1]` with `.mul(0.5).add(0.5)`.
- Turbulence variant: apply `.abs()` to the output.

### Examples
```js
// Terrain heightmap
const height = mx_fractal_noise_float(
  positionLocal.mul(0.5),
  int(5),      // octaves
  float(2.0),  // lacunarity
  float(0.5),  // diminish
  float(1.0)   // amplitude
);
material.positionNode = positionLocal.add( normalLocal.mul( height ) );

// Animated clouds
const coords = vec3( positionLocal.xy.mul(1.5), time.mul(0.2) );
const cloud = mx_fractal_noise_float( coords, int(4) );
material.colorNode = mix( sky, white, cloud.mul(0.5).add(0.5) );

// Turbulence
const t = mx_fractal_noise_float( positionLocal ).abs();

// Water waves / isolines
const waterWave = mx_fractal_noise_float(
  vec3( uv().mul(5), time.mul(0.001) ),
  int(3), float(19), float(10)
);

// 2D input (must still be vec3)
const n = mx_fractal_noise_float( vec3( uv().mul(3.0), float(0.0) ) );
```

### Use cases
terrain, clouds, fire, water waves, marble, organic texture, dissolve effects

---

## 5. mx_fractal_noise_vec2 / vec3 / vec4

**Type:** Fractal Brownian Motion  
**Returns:** `vec2` / `vec3` / `vec4` (multiple independent fBm channels)  
**Output range:** each component approx `[-1, 1]`

### Signature
```
mx_fractal_noise_vec2( position, octaves = 3, lacunarity = 2.0, diminish = 0.5, amplitude = 1.0 )
mx_fractal_noise_vec3( position, octaves = 3, lacunarity = 2.0, diminish = 0.5, amplitude = 1.0 )
mx_fractal_noise_vec4( position, octaves = 3, lacunarity = 2.0, diminish = 0.5, amplitude = 1.0 )
```

### Notes
- Identical parameter signature to `mx_fractal_noise_float`.
- Each component is an independent fBm channel.

### Examples
```js
// Domain warping with vec2
const warpOffset = mx_fractal_noise_vec2(
  vec3( uv(), time.mul(0.1) ),
  int(3)
).mul( float(0.3) );
const warpedUV = uv().add( warpOffset );

// 3D fractal color
const col = mx_fractal_noise_vec3( positionLocal, int(4) )
              .mul(0.5).add(0.5);
material.colorNode = vec4( col, float(1.0) );
```

### Use cases
domain warping, psychedelic color output, fluid-like distortion

---

## 6. mx_cell_noise_float

**Type:** Cell / hash noise  
**Returns:** `float`  
**Output range:** `[0, 1]` — already positive, no remap needed

### Signature
```
mx_cell_noise_float( position )
```

### Parameters
| param | type | description |
|---|---|---|
| position | vec2 \| vec3 | Sample coordinate. Scale to control cell size. |

### Notes
- No interpolation between cells — each grid cell gets a flat random value.
- Produces a sharp, blocky pattern (no smooth transitions).
- No extra parameters (no amplitude, no jitter).

### Examples
```js
// 2D cell pattern
const cell2d = mx_cell_noise_float( uv().mul(20.0) );

// 3D on geometry surface
const cell3d = mx_cell_noise_float( positionLocal.mul(5.0) );

// Random tile coloring
material.colorNode = mix( colorA, colorB, mx_cell_noise_float( uv().mul(10) ) );

// Binary mask
const mask = mx_cell_noise_float( uv().mul(8) ).step( float(0.5) );
```

### Use cases
random tile colors, mosaic, noise masks, randomized per-cell geometry

---

## 7. mx_worley_noise_float

**Type:** Worley / Voronoi noise  
**Returns:** `float` (distance to nearest feature point)  
**Output range:** `[0, ~1]`

### Signature
```
mx_worley_noise_float( position, jitter = 1.0 )
```

### Parameters
| param | type | default | description |
|---|---|---|---|
| position | vec2 \| vec3 | required | Sample coordinate |
| jitter | float | 1.0 | Cell center randomness. `0.0` = perfect grid, `1.0` = fully random |

### Notes
- Output is the F1 distance (distance to nearest feature point).
- Lower jitter = more regular, honeycomb-like patterns.
- Invert with `.oneMinus()` to get bright cells instead of dark borders.

### Examples
```js
// Basic cellular pattern
const w = mx_worley_noise_float( uv().mul(8.0), float(1.0) );

// Inverted = bright bubbles
material.colorNode = float(1.0).sub( w );

// Cracked / ridged look
const ridged = w.oneMinus().pow( float(8) );

// Regular honeycomb (low jitter)
const honey = mx_worley_noise_float( uv().mul(10), float(0.5) );

// Animated
const coord3d = vec3( uv().mul(6), time.mul(0.4) );
const w3 = mx_worley_noise_float( coord3d, float(1.0) );
```

### Use cases
cells / bubbles, cracked stone, leather, scales, tissue / organic, caustics

---

## 8. mx_worley_noise_vec2 / vec3

**Type:** Worley / Voronoi noise (multi-distance)  
**Returns:**  
- `mx_worley_noise_vec2` → `vec2(F1, F2)` — nearest and second-nearest distances  
- `mx_worley_noise_vec3` → `vec3(F1, F2, F2-F1)` — adds the difference directly

### Signature
```
mx_worley_noise_vec2( position, jitter = 1.0 )
mx_worley_noise_vec3( position, jitter = 1.0 )
```

### Notes
- `F2 - F1` (the difference) is thin at cell edges and thick inside cells — use it for edge detection / outlines.
- `vec3` version has `.z` pre-computed as `F2 - F1`.

### Examples
```js
// Cell edge detection
const w2 = mx_worley_noise_vec2( uv().mul(6.0), float(1.0) );
const edge = w2.y.sub( w2.x ); // F2 - F1
material.colorNode = edge.smoothstep( float(0.0), float(0.1) );

// vec3 version — .z is F2-F1 directly
const w3 = mx_worley_noise_vec3( positionLocal.mul(4), float(1.0) );
const cellEdge = w3.z;
const cellFill  = w3.x; // F1 — distance from center
```

### Use cases
cell outlines, voronoi patterns, stylized cell shading

---

## Common Patterns

### Remap [-1,1] to [0,1]
```js
const n01 = mx_noise_float( coord ).mul(0.5).add(0.5);
```

### Animated noise (time on z axis)
```js
const coord = vec3( uv().mul( scale ), time.mul( speed ) );
const n = mx_fractal_noise_float( coord );
```

### Domain warping
```js
const q = mx_noise_vec3( positionLocal );
const r = mx_noise_vec3( positionLocal.add( q.mul( warpStrength ) ) );
const final = mx_fractal_noise_float( positionLocal.add( r.mul( 0.5 ) ) );
```

### Turbulence
```js
// Simple
const turb = mx_fractal_noise_float( coord ).abs();

// Loop-based (more control)
const turbulence = Fn(([p]) => {
  const t = float(-0.5).toVar();
  Loop({ start: 1.0, end: 10.0, name: 'f', type: 'float', condition: '<=' }, ({ f }) => {
    const power = pow( float(2.0), f ).toVar();
    t.addAssign( mx_noise_float( p.mul(power) ).abs().div(power) );
  });
  return t;
});
```

### Combining Worley + Fractal
```js
const base  = mx_fractal_noise_float( coord, int(3) ).mul(0.5).add(0.5);
const cells = mx_worley_noise_float( coord.xy.mul(5), float(1.0) );
const combined = base.mul( cells.oneMinus() );
```
