import { Fn, float, vec3, Loop, mx_noise_float } from 'three/tsl';

/**
 * 2D curl noise from a 3D noise potential ψ(x, y, t).
 * ∇×(0, 0, ψ) = (∂ψ/∂y, -∂ψ/∂x, 0) — divergence-free flow in the XY plane.
 * Pure TSL (no wgslFn/glslFn) so compute shaders work on WebGPU and WebGL fallback.
 */
export const curlNoise = Fn(([p, noiseTime, persistence, strength]) => {
    const eps = float(0.04);
    const flowX = float(0).toVar();
    const flowY = float(0).toVar();

    Loop(2, ({ i }) => {
        const fi = float(i);
        const twoPowI = float(2).pow(fi);
        const octaveAmp = float(0.5).mul(twoPowI).mul(persistence.pow(fi));
        const coord = vec3(p.x, p.y, noiseTime).mul(twoPowI);

        const py1 = mx_noise_float(vec3(coord.x, coord.y.add(eps), coord.z));
        const py0 = mx_noise_float(vec3(coord.x, coord.y.sub(eps), coord.z));
        const px1 = mx_noise_float(vec3(coord.x.add(eps), coord.y, coord.z));
        const px0 = mx_noise_float(vec3(coord.x.sub(eps), coord.y, coord.z));

        const dPsidy = py1.sub(py0).div(eps.mul(2));
        const dPsidx = px1.sub(px0).div(eps.mul(2));

        flowX.addAssign(dPsidy.mul(octaveAmp));
        flowY.addAssign(dPsidx.negate().mul(octaveAmp));
    });

    return vec3(flowX, flowY, float(0)).mul(strength);
});
