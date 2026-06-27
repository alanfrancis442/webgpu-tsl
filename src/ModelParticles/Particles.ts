import * as THREE from 'three/webgpu';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import { MeshSurfaceSampler } from 'three/addons/math/MeshSurfaceSampler.js';
import GUI from 'lil-gui';
import {
    Fn, uniform, float, vec3, int, clamp, pow, mix, sin, cos, dot, normalize,
    instancedArray, instanceIndex, positionGeometry,
    mx_noise_float, mx_fractal_noise_vec3,
} from 'three/tsl';
import type Canvas from './Canvas';

const PARTICLE_COUNT = 20000;
const MOVE_TIMEOUT = 0.06;

type GeometryData = {
    positions: Float32Array;
    normals: Float32Array;
    seeds: Float32Array;
};

export default class Particles {
    private canvas: Canvas;
    private scene: THREE.Scene;
    private renderer: THREE.WebGPURenderer;

    // GPU storage — positions written by compute each frame
    private positions!: THREE.StorageBufferNode<'vec3'>;
    private targets!: THREE.StorageBufferNode<'vec3'>;
    private seeds!: THREE.StorageBufferNode<'float'>;

    // Uniforms — noise
    private uTime!: THREE.UniformNode<'float', number>;
    private noiseAmp!: THREE.UniformNode<'float', number>;
    private noiseScale!: THREE.UniformNode<'float', number>;
    private noiseSpeed!: THREE.UniformNode<'float', number>;
    private noiseGain!: THREE.UniformNode<'float', number>;
    private maskScale!: THREE.UniformNode<'float', number>;
    private maskSpeed!: THREE.UniformNode<'float', number>;
    private maskContrast!: THREE.UniformNode<'float', number>;
    private sphereSize!: THREE.UniformNode<'float', number>;
    private particleColor!: THREE.UniformNode<'color', THREE.Color>;

    // Uniforms — mouse (CPU-driven, read in compute + material)
    private mousePos!: THREE.UniformNode<'vec3', THREE.Vector3>;
    private mouseVel!: THREE.UniformNode<'vec3', THREE.Vector3>;
    private mouseRadius!: THREE.UniformNode<'float', number>;
    private mouseStrength!: THREE.UniformNode<'float', number>;
    private mouseScatter!: THREE.UniformNode<'float', number>;
    private mouseGlowColor!: THREE.UniformNode<'color', THREE.Color>;
    private mouseGlowPassive!: THREE.UniformNode<'float', number>;
    private mouseGlowActive!: THREE.UniformNode<'float', number>;
    private mouseGlowPow!: THREE.UniformNode<'float', number>;
    private mouseGlowEnergy!: THREE.UniformNode<'float', number>;

    // CPU mouse state
    private raycaster = new THREE.Raycaster();
    private mouseNDC = new THREE.Vector2();
    private mousePlane = new THREE.Plane();
    private modelCenter = new THREE.Vector3();
    private cameraDir = new THREE.Vector3();
    private targetMousePos = new THREE.Vector3();
    private smoothMousePos = new THREE.Vector3();
    private prevMousePos = new THREE.Vector3();
    private frameVel = new THREE.Vector3();
    private smoothVel = new THREE.Vector3();
    private impVel = new THREE.Vector3();
    private impulse = new THREE.Vector3();
    private mouseHit = new THREE.Vector3();
    private glowEnergy = 0;
    private mouseMoving = false;
    private mouseEverMoved = false;
    private moveTimer = 0;
    private springStiffness = 5.0;
    private springDamping = 3.0;
    private pushStrength = 12.0;
    private mouseLerp = 6.0;
    private mouseGlowDecay = 1.5;

    // Compute passes
    private computeInit!: THREE.ComputeNode;
    private computeUpdate!: THREE.ComputeNode;

    private mesh!: THREE.InstancedMesh;
    private gui!: GUI;

    constructor(canvas: Canvas) {
        this.canvas = canvas;
        this.scene = canvas.scene;
        this.renderer = canvas.renderer;

        this.uTime = uniform(0);
        this.noiseAmp = uniform(0.08);
        this.noiseScale = uniform(0.6);
        this.noiseSpeed = uniform(0.15);
        this.noiseGain = uniform(0.5);
        this.maskScale = uniform(0.4);
        this.maskSpeed = uniform(0.04);
        this.maskContrast = uniform(1.5);
        this.sphereSize = uniform(0.01);
        this.particleColor = uniform(new THREE.Color(0x8aa0b8));

        this.mousePos = uniform(new THREE.Vector3());
        this.mouseVel = uniform(new THREE.Vector3());
        this.mouseRadius = uniform(1.5);
        this.mouseStrength = uniform(0.6);
        this.mouseScatter = uniform(0.6);
        this.mouseGlowColor = uniform(new THREE.Color(0xffffff));
        this.mouseGlowPassive = uniform(0.0);
        this.mouseGlowActive = uniform(1.5);
        this.mouseGlowPow = uniform(2.0);
        this.mouseGlowEnergy = uniform(0);

        this.initPointerInteraction();
        this.setupGUI();
    }

    private initPointerInteraction() {
        const element = this.canvas.element;

        const updateNDC = (clientX: number, clientY: number) => {
            const rect = element.getBoundingClientRect();
            this.mouseNDC.set(
                ((clientX - rect.left) / rect.width) * 2 - 1,
                -((clientY - rect.top) / rect.height) * 2 + 1,
            );
            this.mouseMoving = true;
            this.moveTimer = 0;
        };

        element.addEventListener('pointermove', (e) => updateNDC(e.clientX, e.clientY));
        element.addEventListener('pointerleave', () => { this.mouseMoving = false; });
        element.addEventListener('touchstart', (e) => {
            if (e.touches.length > 0) updateNDC(e.touches[0].clientX, e.touches[0].clientY);
        }, { passive: true });
        element.addEventListener('touchmove', (e) => {
            e.preventDefault();
            if (e.touches.length > 0) updateNDC(e.touches[0].clientX, e.touches[0].clientY);
        }, { passive: false });
        element.addEventListener('touchend', () => { this.mouseMoving = false; });
    }

    private updateMouse(delta: number) {
        this.moveTimer += delta;
        if (this.moveTimer > MOVE_TIMEOUT) this.mouseMoving = false;

        const camera = this.canvas.camera;
        camera.getWorldDirection(this.cameraDir);
        this.mousePlane.setFromNormalAndCoplanarPoint(this.cameraDir, this.modelCenter);

        if (this.mouseMoving || this.mouseEverMoved) {
            this.raycaster.setFromCamera(this.mouseNDC, camera);
            if (this.raycaster.ray.intersectPlane(this.mousePlane, this.mouseHit) !== null) {
                this.targetMousePos.copy(this.mouseHit);
                if (!this.mouseEverMoved) {
                    this.smoothMousePos.copy(this.mouseHit);
                    this.prevMousePos.copy(this.mouseHit);
                    this.mouseEverMoved = true;
                }
            }
        }

        if (this.mouseEverMoved) {
            const alpha = 1 - Math.exp(-this.mouseLerp * delta);
            this.smoothMousePos.lerp(this.targetMousePos, alpha);
            this.mousePos.value.copy(this.smoothMousePos);
        }

        if (this.mouseMoving) {
            this.frameVel
                .subVectors(this.smoothMousePos, this.prevMousePos)
                .divideScalar(Math.max(delta, 0.001))
                .clampLength(0, 8.0);
            this.smoothVel.lerp(this.frameVel, 0.15);
        } else {
            this.smoothVel.multiplyScalar(0.85);
        }

        const k = this.springStiffness;
        const c = this.springDamping;

        this.impVel.x += (-k * this.impulse.x - c * this.impVel.x) * delta;
        this.impVel.y += (-k * this.impulse.y - c * this.impVel.y) * delta;
        this.impVel.z += (-k * this.impulse.z - c * this.impVel.z) * delta;

        if (this.mouseMoving) {
            const push = this.pushStrength;
            this.impVel.x += this.smoothVel.x * push * delta;
            this.impVel.y += this.smoothVel.y * push * delta;
            this.impVel.z += this.smoothVel.z * push * delta;
        }

        this.impulse.x += this.impVel.x * delta;
        this.impulse.y += this.impVel.y * delta;
        this.impulse.z += this.impVel.z * delta;
        this.impulse.clampLength(0, 3.5);

        this.mouseVel.value.copy(this.impulse);
        this.prevMousePos.copy(this.smoothMousePos);

        const currentImpulse = this.impulse.length();
        if (currentImpulse > this.glowEnergy) this.glowEnergy = currentImpulse;
        this.glowEnergy *= Math.exp(-this.mouseGlowDecay * delta);
        this.mouseGlowEnergy.value = this.glowEnergy;
    }

    private setupGUI() {
        this.gui = new GUI({ title: 'Particles' });

        const noise = this.gui.addFolder('Noise');
        noise.add(this.noiseAmp, 'value', 0, 0.5, 0.001).name('amplitude');
        noise.add(this.noiseScale, 'value', 0, 3, 0.01).name('scale');
        noise.add(this.noiseSpeed, 'value', 0, 1, 0.01).name('speed');
        noise.add(this.noiseGain, 'value', 0, 1, 0.01).name('gain');
        noise.open();

        const mask = this.gui.addFolder('Mask');
        mask.add(this.maskScale, 'value', 0, 2, 0.01).name('scale');
        mask.add(this.maskSpeed, 'value', 0, 0.2, 0.001).name('speed');
        mask.add(this.maskContrast, 'value', 0.1, 5, 0.01).name('contrast');
        mask.open();

        const appearance = this.gui.addFolder('Appearance');
        appearance.add(this.sphereSize, 'value', 0.001, 0.1, 0.001).name('sphere size');
        appearance.addColor({ color: '#8aa0b8' }, 'color').name('color').onChange((value: string) => {
            this.particleColor.value.set(value);
        });
        appearance.open();

        const mouse = this.gui.addFolder('Mouse');
        mouse.add(this.mouseRadius, 'value', 0.1, 5, 0.01).name('radius');
        mouse.add(this.mouseStrength, 'value', 0, 3, 0.01).name('strength');
        mouse.add(this.mouseScatter, 'value', 0, 2, 0.01).name('scatter');
        mouse.add({ springStiffness: this.springStiffness }, 'springStiffness', 0, 20, 0.1)
            .name('spring k').onChange((v: number) => { this.springStiffness = v; });
        mouse.add({ springDamping: this.springDamping }, 'springDamping', 0, 10, 0.1)
            .name('spring damp').onChange((v: number) => { this.springDamping = v; });
        mouse.add({ pushStrength: this.pushStrength }, 'pushStrength', 0, 30, 0.1)
            .name('push').onChange((v: number) => { this.pushStrength = v; });
        mouse.add({ mouseLerp: this.mouseLerp }, 'mouseLerp', 0, 20, 0.1)
            .name('smooth').onChange((v: number) => { this.mouseLerp = v; });

        const glow = mouse.addFolder('Glow');
        glow.add(this.mouseGlowPassive, 'value', 0, 2, 0.01).name('passive');
        glow.add(this.mouseGlowActive, 'value', 0, 5, 0.01).name('active');
        glow.add(this.mouseGlowPow, 'value', 0.5, 5, 0.01).name('power');
        glow.add({ mouseGlowDecay: this.mouseGlowDecay }, 'mouseGlowDecay', 0, 5, 0.01)
            .name('decay').onChange((v: number) => { this.mouseGlowDecay = v; });
        glow.addColor({ color: '#ffffff' }, 'color').name('color').onChange((value: string) => {
            this.mouseGlowColor.value.set(value);
        });
        mouse.open();
    }

    private sampleGLBGeometry(gltf: THREE.Object3D): GeometryData {
        // Normalise to a consistent bounding box (matches reference hologram sampler)
        const bbox = new THREE.Box3().setFromObject(gltf);
        const centre = new THREE.Vector3();
        bbox.getCenter(centre);
        gltf.position.sub(centre);
        gltf.updateMatrixWorld(true);

        const bbox2 = new THREE.Box3().setFromObject(gltf);
        const size = new THREE.Vector3();
        bbox2.getSize(size);
        const maxDim = Math.max(size.x, size.y, size.z);
        gltf.scale.setScalar(maxDim > 0 ? 3 / maxDim : 1);
        gltf.updateMatrixWorld(true);

        const bbox3 = new THREE.Box3().setFromObject(gltf);
        gltf.position.y -= bbox3.min.y;
        gltf.updateMatrixWorld(true);

        const meshes: THREE.Mesh[] = [];
        gltf.traverse((child: THREE.Object3D) => {
            if ((child as THREE.Mesh).isMesh) meshes.push(child as THREE.Mesh);
        });

        const positions = new Float32Array(PARTICLE_COUNT * 3);
        const normals = new Float32Array(PARTICLE_COUNT * 3);
        const seeds = new Float32Array(PARTICLE_COUNT);
        const tempPos = new THREE.Vector3();
        const tempNorm = new THREE.Vector3();
        const normMatrix = new THREE.Matrix3();

        let filled = 0;
        const perMesh = meshes.length > 0 ? Math.floor(PARTICLE_COUNT / meshes.length) : 0;

        for (let m = 0; m < meshes.length; m++) {
            const mesh = meshes[m];
            const count = m < meshes.length - 1 ? perMesh : PARTICLE_COUNT - filled;
            normMatrix.getNormalMatrix(mesh.matrixWorld);
            const sampler = new MeshSurfaceSampler(mesh).build();

            for (let i = 0; i < count; i++) {
                sampler.sample(tempPos, tempNorm);
                mesh.localToWorld(tempPos);
                tempNorm.applyMatrix3(normMatrix).normalize();

                const idx = filled + i;
                const b = idx * 3;
                positions[b] = tempPos.x;
                positions[b + 1] = tempPos.y;
                positions[b + 2] = tempPos.z;
                normals[b] = tempNorm.x;
                normals[b + 1] = tempNorm.y;
                normals[b + 2] = tempNorm.z;
                seeds[idx] = Math.random();
            }
            filled += count;
        }

        return { positions, normals, seeds };
    }

    private computeModelCenter(positions: Float32Array) {
        const box = new THREE.Box3();
        const point = new THREE.Vector3();
        for (let i = 0; i < PARTICLE_COUNT; i++) {
            const b = i * 3;
            point.set(positions[b], positions[b + 1], positions[b + 2]);
            box.expandByPoint(point);
        }
        box.getCenter(this.modelCenter);
    }

    private setup(sampled: GeometryData) {
        const { positions: sampledPositions, seeds: sampledSeeds } = sampled;
        this.computeModelCenter(sampled.positions);

        this.positions = instancedArray(PARTICLE_COUNT, 'vec3');
        this.targets = instancedArray(sampledPositions, 'vec3');
        this.seeds = instancedArray(sampledSeeds, 'float');

        const positions = this.positions;
        const targets = this.targets;
        const seeds = this.seeds;
        const uTime = this.uTime;
        const noiseAmp = this.noiseAmp;
        const noiseScale = this.noiseScale;
        const noiseSpeed = this.noiseSpeed;
        const noiseGain = this.noiseGain;
        const maskScale = this.maskScale;
        const maskSpeed = this.maskSpeed;
        const maskContrast = this.maskContrast;
        const sphereSize = this.sphereSize;
        const particleColor = this.particleColor;
        const mousePos = this.mousePos;
        const mouseVel = this.mouseVel;
        const mouseRadius = this.mouseRadius;
        const mouseStrength = this.mouseStrength;
        const mouseScatter = this.mouseScatter;
        const mouseGlowColor = this.mouseGlowColor;
        const mouseGlowPassive = this.mouseGlowPassive;
        const mouseGlowActive = this.mouseGlowActive;
        const mouseGlowPow = this.mouseGlowPow;
        const mouseGlowEnergy = this.mouseGlowEnergy;

        const epsilon = vec3(0.0001, 0.0001, 0.0001);
        const epsilonZ = vec3(0, 0.0001, 0);

        this.computeInit = Fn(() => {
            const position = positions.element(instanceIndex);
            const target = targets.element(instanceIndex);
            position.assign(target);
        })().compute(PARTICLE_COUNT);

        this.computeUpdate = Fn(() => {
            const position = positions.element(instanceIndex);
            const blendPos = targets.element(instanceIndex);

            const maskCoord = blendPos
                .mul(maskScale)
                .add(vec3(
                    uTime.mul(maskSpeed),
                    uTime.mul(maskSpeed).mul(0.7),
                    uTime.mul(maskSpeed).mul(1.3),
                ));

            const rawMask = mx_noise_float(maskCoord);
            const mask = pow(
                clamp(rawMask.mul(0.5).add(0.5), float(0), float(1)),
                maskContrast,
            );

            const noiseCoord = blendPos
                .mul(noiseScale)
                .add(vec3(
                    uTime.mul(noiseSpeed),
                    float(0),
                    uTime.mul(noiseSpeed).mul(0.7),
                ));

            const noiseDisp = mx_fractal_noise_vec3(
                noiseCoord,
                int(2),
                float(2.0),
                noiseGain,
            ).mul(noiseAmp).mul(mask);

            const seed = seeds.element(instanceIndex);
            const toMouse = mousePos.sub(blendPos);
            const mouseDist = toMouse.length();
            const falloff = clamp(
                float(1.0).sub(mouseDist.div(mouseRadius)),
                float(0),
                float(1),
            );
            const impulseLen = mouseVel.length();
            const velDir = normalize(mouseVel.add(epsilon));
            const rawRand = vec3(
                sin(seed.mul(127.1)),
                cos(seed.mul(311.7)),
                sin(seed.mul(74.3).add(1.0)),
            );
            const randUnit = normalize(rawRand);
            const onAxis = velDir.mul(dot(randUnit, velDir));
            const perpToVel = normalize(randUnit.sub(onAxis).add(epsilonZ));
            const mouseDisp = velDir
                .add(perpToVel.mul(mouseScatter))
                .mul(impulseLen)
                .mul(mouseStrength)
                .mul(falloff.mul(falloff));

            position.assign(blendPos.add(noiseDisp).add(mouseDisp));
        })().compute(PARTICLE_COUNT);

        const sphereGeometry = new THREE.IcosahedronGeometry(1, 0);
        const material = new THREE.MeshBasicNodeMaterial();

        material.positionNode = positions
            .element(instanceIndex)
            .add(positionGeometry.mul(sphereSize));

        material.colorNode = Fn(() => {
            const blendPos = targets.element(instanceIndex);
            const toMouse = mousePos.sub(blendPos);
            const mouseDist = toMouse.length();
            const falloff = clamp(
                float(1.0).sub(mouseDist.div(mouseRadius)),
                float(0),
                float(1),
            );
            const glowFalloff = pow(falloff, mouseGlowPow);
            const passiveGlow = glowFalloff.mul(mouseGlowPassive);
            const activeGlow = glowFalloff.mul(mouseGlowEnergy).mul(mouseGlowActive);
            const glowFactor = clamp(passiveGlow.add(activeGlow), float(0), float(1));
            return mix(particleColor, mouseGlowColor, glowFactor);
        })();

        this.mesh = new THREE.InstancedMesh(sphereGeometry, material, PARTICLE_COUNT);
        this.mesh.frustumCulled = false;
        this.scene.add(this.mesh);
    }

    async loadModel(modelUrl: string) {
        const gltf = await new Promise<THREE.Object3D>((resolve, reject) => {
            const dracoLoader = new DRACOLoader();
            dracoLoader.setDecoderPath('https://www.gstatic.com/draco/versioned/decoders/1.5.6/');
            const loader = new GLTFLoader();
            loader.setDRACOLoader(dracoLoader);
            loader.load(modelUrl, (g) => resolve(g.scene), undefined, reject);
        });

        const sampled = this.sampleGLBGeometry(gltf);
        this.setup(sampled);

        // Scatter particles, then simulate
        this.renderer.compute(this.computeInit);
    }

    update(deltaTime: number) {
        const delta = Math.min(deltaTime, 0.1);
        this.uTime.value += delta;
        this.updateMouse(delta);
        this.renderer.compute(this.computeUpdate);
    }
}
