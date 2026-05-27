import { Fn, float, hash, instancedArray, instanceIndex, time, uniform, vec2, vec3, vec4 } from 'three/tsl';
import * as THREE from 'three/webgpu';
import { curlNoise } from './curlNoise';

const particle_count = 10000;

const basePositions = instancedArray(particle_count, 'vec3');
const positions = instancedArray(particle_count, 'vec3');
const colors = instancedArray(particle_count, 'vec4');

const angularVelocity = uniform(-2);
const minRadius = float(2.5);
const TWO_PI = float(6.28318530718);

// Curl noise tuning
const noiseScale = uniform(0.35);
const curlPersistence = uniform(0.55);
const curlStrength = uniform(0.55);

const computeInit = Fn(() => {
    const position = positions.element(instanceIndex);
    const base = basePositions.element(instanceIndex);
    const color = colors.element(instanceIndex);

    const h0 = hash(instanceIndex);
    const h1 = hash(instanceIndex.add(1));

    const angle = h0.mul(TWO_PI);
    const radius = h1.mul(1.5).add(minRadius);
    const diskX = angle.cos().mul(radius);
    const diskY = angle.sin().mul(radius);

    base.x.assign(diskX);
    base.y.assign(diskY);
    base.z.assign(0);

    position.x.assign(diskX);
    position.y.assign(diskY);
    position.z.assign(0);

    color.assign(vec4(1, 1, 1, 1));
})().compute(particle_count);

const computeUpdate = Fn(() => {
    const position = positions.element(instanceIndex);
    const base = basePositions.element(instanceIndex);

    const r = vec2(base.x, base.y).length().max(minRadius);
    const angle = time.mul(angularVelocity).div(r).mod(TWO_PI);

    const rotX = base.x.mul(angle.cos()).sub(base.y.mul(angle.sin()));
    const rotY = base.x.mul(angle.sin()).add(base.y.mul(angle.cos()));

    const samplePos = vec3(rotX, rotY, base.z).mul(noiseScale);
    const flow = curlNoise(samplePos, time, curlPersistence, curlStrength);

    position.x.assign(rotX.add(flow.x));
    position.y.assign(rotY.add(flow.y));
    position.z.assign(base.z.add(flow.z));
})().compute(particle_count);

const particleMaterial = new THREE.SpriteNodeMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
});

particleMaterial.positionNode = positions.toAttribute();
particleMaterial.colorNode = colors.toAttribute();
particleMaterial.scaleNode = vec2(0.08, 0.08);

const particles = new THREE.Sprite(particleMaterial);
particles.count = particle_count;
particles.frustumCulled = false;

export default class CircularParticle {
    constructor(scene: THREE.Scene, renderer: THREE.WebGPURenderer) {
        scene.add(particles);
        renderer.compute(computeInit);
    }

    update(renderer: THREE.WebGPURenderer) {
        renderer.compute(computeUpdate);
    }
}

