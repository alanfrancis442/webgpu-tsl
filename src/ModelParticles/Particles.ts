import * as THREE from 'three/webgpu';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import { MeshSurfaceSampler } from 'three/addons/math/MeshSurfaceSampler.js';
import GUI from 'lil-gui';
import {
    Fn, uniform, float, vec2, vec3, vec4, int, clamp, pow, mix, sin, cos, dot,
    normalize, max, sqrt, oneMinus, uv, positionView, frameGroup,
    cameraViewMatrix, cameraProjectionMatrix, modelViewMatrix,
    instancedArray, instanceIndex, mrt, shadow,
    mx_noise_float, mx_fractal_noise_vec3,
} from 'three/tsl';
import type Canvas from './Canvas';

const PARTICLE_COUNT = 70000;
const MOVE_TIMEOUT = 0.06;
const SHADOW_LAYER = 1;
const SHADOW_RADIUS = 8;

type GeometryData = {
    positions: Float32Array;
    normals: Float32Array;
    seeds: Float32Array;
};

export default class Particles {
    private canvas: Canvas;
    private scene: THREE.Scene;
    private renderer: THREE.WebGPURenderer;

    private positions!: THREE.StorageBufferNode<'vec3'>;
    private prevPositions!: THREE.StorageBufferNode<'vec3'>;
    private targets!: THREE.StorageBufferNode<'vec3'>;
    private seeds!: THREE.StorageBufferNode<'float'>;

    private uTime!: THREE.UniformNode<'float', number>;
    private noiseAmp!: THREE.UniformNode<'float', number>;
    private noiseScale!: THREE.UniformNode<'float', number>;
    private noiseSpeed!: THREE.UniformNode<'float', number>;
    private noiseGain!: THREE.UniformNode<'float', number>;
    private maskScale!: THREE.UniformNode<'float', number>;
    private maskSpeed!: THREE.UniformNode<'float', number>;
    private maskContrast!: THREE.UniformNode<'float', number>;
    private particleSize!: THREE.UniformNode<'float', number>;
    private particleColor!: THREE.UniformNode<'color', THREE.Color>;
    private shadowColor!: THREE.UniformNode<'color', THREE.Color>;
    private shadowPower!: THREE.UniformNode<'float', number>;
    private lightDirection!: THREE.UniformNode<'vec3', THREE.Vector3>;
    private ambientStrength!: THREE.UniformNode<'float', number>;
    private specularStrength!: THREE.UniformNode<'float', number>;

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
    private springStiffness = 9.7;
    private springDamping = 6.7;
    private pushStrength = 10.8;
    private mouseLerp = 9.4;
    private mouseGlowDecay = 1.5;

    private computeInit!: THREE.ComputeNode;
    private computeCopyPrev!: THREE.ComputeNode;
    private computeUpdate!: THREE.ComputeNode;

    private light!: THREE.DirectionalLight;
    private sprite?: THREE.Sprite;
    private shadowSprite?: THREE.Sprite;
    private gui!: GUI;
    private isReady = false;

    constructor(canvas: Canvas) {
        this.canvas = canvas;
        this.scene = canvas.scene;
        this.renderer = canvas.renderer;

        // Per-frame sim uniforms on frameGroup (skill: drive clock from JS, not TSL time)
        this.uTime = uniform(0).setGroup(frameGroup);
        this.noiseAmp = uniform(0.156);
        this.noiseScale = uniform(0.97);
        this.noiseSpeed = uniform(0.47);
        this.noiseGain = uniform(0.5);
        this.maskScale = uniform(0.72);
        this.maskSpeed = uniform(0.195);
        this.maskContrast = uniform(1.99);
        this.particleSize = uniform(0.04);
        this.particleColor = uniform(new THREE.Color(0x8aa0b8));
        this.shadowColor = uniform(new THREE.Color(0x0a0c12));
        this.shadowPower = uniform(3.0);
        this.ambientStrength = uniform(0.35);
        this.specularStrength = uniform(0.45);

        this.mousePos = uniform(new THREE.Vector3()).setGroup(frameGroup);
        this.mouseVel = uniform(new THREE.Vector3()).setGroup(frameGroup);
        this.mouseRadius = uniform(1.45);
        this.mouseStrength = uniform(0.23);
        this.mouseScatter = uniform(0.21);
        this.mouseGlowColor = uniform(new THREE.Color(0xffffff));
        this.mouseGlowPassive = uniform(0.0);
        this.mouseGlowActive = uniform(1.5);
        this.mouseGlowPow = uniform(2.0);
        this.mouseGlowEnergy = uniform(0).setGroup(frameGroup);

        const { light, lightDirection } = this.createShadowLight();
        this.light = light;
        this.lightDirection = uniform(lightDirection.clone());

        this.renderer.shadowMap.enabled = true;
        this.renderer.shadowMap.type = THREE.PCFShadowMap;

        this.initPointerInteraction();
        this.setupGUI();
    }

    private createShadowLight() {
        const lightDirection = new THREE.Vector3(-0.5, 1, 0.25).normalize();
        const light = new THREE.DirectionalLight(0xffffff, 1);
        light.position.copy(lightDirection).multiplyScalar(SHADOW_RADIUS * 4);
        light.target.position.set(0, 1.5, 0);
        light.castShadow = true;

        const bound = SHADOW_RADIUS * 3;
        const cam = light.shadow.camera;
        cam.left = -bound;
        cam.right = bound;
        cam.top = bound;
        cam.bottom = -bound;
        cam.near = SHADOW_RADIUS;
        cam.far = SHADOW_RADIUS * 8;
        cam.updateProjectionMatrix();
        cam.layers.set(SHADOW_LAYER);

        light.shadow.mapSize.set(1024, 1024);
        light.shadow.radius = 12.8;
        light.shadow.normalBias = 4;

        return { light, lightDirection };
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
        appearance.add(this.particleSize, 'value', 0.005, 0.2, 0.001).name('particle size');
        appearance.add(this.ambientStrength, 'value', 0, 1, 0.01).name('ambient');
        appearance.add(this.specularStrength, 'value', 0, 2, 0.01).name('specular');
        appearance.addColor({ color: '#8aa0b8' }, 'color').name('color').onChange((value: string) => {
            this.particleColor.value.set(value);
        });
        appearance.open();

        const shadows = this.gui.addFolder('Shadows');
        shadows.add(this.shadowPower, 'value', 0.5, 8, 0.01).name('power');
        shadows.add(this.light.shadow, 'radius', 0, 24, 0.1).name('blur');
        shadows.addColor({ color: '#0a0c12' }, 'color').name('color').onChange((value: string) => {
            this.shadowColor.value.set(value);
        });
        shadows.open();

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

    setupPostFxGui(canvas: Canvas) {
        const bloomFolder = this.gui.addFolder('Bloom');
        bloomFolder.add(canvas.bloomPass.strength, 'value', 0, 3, 0.01).name('strength');
        bloomFolder.add(canvas.bloomPass.radius, 'value', 0, 1, 0.01).name('radius');
        bloomFolder.add(canvas.bloomPass.threshold, 'value', 0, 1, 0.01).name('threshold');
        bloomFolder.open();

        const dofFolder = this.gui.addFolder('Depth of Field');
        dofFolder.add(canvas.dofFocus, 'value', 1, 30, 0.1).name('focus');
        dofFolder.add(canvas.dofFocalLength, 'value', 0.1, 15, 0.1).name('focal length');
        dofFolder.add(canvas.dofBokehScale, 'value', 0, 5, 0.01).name('bokeh scale');
        dofFolder.open();

        const blurFolder = this.gui.addFolder('Motion Blur');
        blurFolder.add(canvas.blurAmount, 'value', 0, 2, 0.01).name('amount');
        blurFolder.open();
    }

    private sampleGLBGeometry(gltf: THREE.Object3D): GeometryData {
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
        this.light.target.position.copy(this.modelCenter);
        this.light.position.copy(this.lightDirection.value).multiplyScalar(SHADOW_RADIUS * 4).add(this.modelCenter);
    }

    private disposeSprites() {
        if (this.sprite) {
            this.scene.remove(this.sprite);
            (this.sprite.material as THREE.Material).dispose();
            this.sprite = undefined;
        }
        if (this.shadowSprite) {
            this.scene.remove(this.shadowSprite);
            (this.shadowSprite.material as THREE.Material).dispose();
            this.shadowSprite = undefined;
        }
    }

    private setup(sampled: GeometryData) {
        const { positions: sampledPositions, seeds: sampledSeeds } = sampled;
        this.computeModelCenter(sampled.positions);

        this.positions = instancedArray(PARTICLE_COUNT, 'vec3');
        this.prevPositions = instancedArray(PARTICLE_COUNT, 'vec3');
        this.targets = instancedArray(sampledPositions, 'vec3');
        this.seeds = instancedArray(sampledSeeds, 'float');

        const positions = this.positions;
        const prevPositions = this.prevPositions;
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
        const particleSize = this.particleSize;
        const particleColor = this.particleColor;
        const shadowColor = this.shadowColor;
        const shadowPower = this.shadowPower;
        const lightDirection = this.lightDirection;
        const ambientStrength = this.ambientStrength;
        const specularStrength = this.specularStrength;
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
            const prev = prevPositions.element(instanceIndex);
            const target = targets.element(instanceIndex);
            position.assign(target);
            prev.assign(target);
        })().compute(PARTICLE_COUNT, [64]);

        this.computeCopyPrev = Fn(() => {
            const prev = prevPositions.element(instanceIndex);
            const curr = positions.element(instanceIndex);
            prev.assign(curr);
        })().compute(PARTICLE_COUNT, [64]);

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
        })().compute(PARTICLE_COUNT, [64]);

        const simPos = positions.toAttribute();
        const simPrev = prevPositions.toAttribute();
        const seedAttr = seeds.toAttribute();
        const particleScale = seedAttr.mul(0.5).add(0.75).mul(particleSize);

        const clipParticleDisc = Fn(() => {
            const p = uv().mul(2).sub(1);
            const pFlip = vec2(p.x, p.y.negate()).toVar();
            const r2 = dot(pFlip, pFlip);
            r2.greaterThan(1.0).discard();
            return pFlip;
        });

        const shadowMaterial = new THREE.SpriteNodeMaterial();
        shadowMaterial.positionNode = simPos;
        shadowMaterial.scaleNode = particleScale;
        shadowMaterial.lights = false;
        shadowMaterial.colorNode = Fn(() => {
            clipParticleDisc();
            return vec3(0);
        })();

        this.shadowSprite = new THREE.Sprite(shadowMaterial);
        this.shadowSprite.count = PARTICLE_COUNT;
        this.shadowSprite.frustumCulled = false;
        // Sprite typings mark castShadow as always false; WebGPU still honors it for depth.
        (this.shadowSprite as THREE.Object3D).castShadow = true;
        this.shadowSprite.receiveShadow = false;
        this.shadowSprite.layers.set(SHADOW_LAYER);

        const shadowFactor = shadow(this.light) as unknown as THREE.Node<'float'>;

        const material = new THREE.SpriteNodeMaterial();
        material.positionNode = simPos;
        material.scaleNode = particleScale;
        material.lights = false;
        material.colorNode = Fn(() => {
            const pFlip = clipParticleDisc();
            const r2 = dot(pFlip, pFlip);
            const normal = vec3(pFlip, sqrt(max(float(0), float(1).sub(r2))));

            const lightDir = normalize(cameraViewMatrix.mul(vec4(lightDirection, 0)).xyz);
            const viewDir = normalize(positionView.negate());

            const NdotL = dot(normal, lightDir);
            const diffuse = max(NdotL.mul(0.5).add(0.5), float(0));
            const diffuseSq = diffuse.mul(diffuse);

            const halfDir = normalize(lightDir.add(viewDir));
            const specular = pow(max(dot(normal, halfDir), float(0)), float(48));
            const fresnel = pow(oneMinus(max(dot(normal, viewDir), float(0))), float(1));

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
            const baseColor = mix(particleColor, mouseGlowColor, glowFactor);
            const albedo = vec3(baseColor).toVar();

            const shadowMask = pow(shadowFactor, shadowPower);
            const lit = albedo.mul(ambientStrength)
                .add(
                    albedo.mul(diffuseSq.mul(0.85))
                        .add(vec3(1, 1, 1).mul(specular).mul(specularStrength))
                        .add(albedo.mul(fresnel).mul(0.25))
                        .mul(shadowMask),
                )
                .toVar();

            // mix(lit, shadowedAlbedo, 1 - mask) without color-typed mix() overload
            const shadowCol = shadowColor as unknown as THREE.Node<'vec3'>;
            return lit.add(
                shadowCol.mul(albedo).sub(lit).mul(oneMinus(shadowMask)),
            );
        })();

        material.mrtNode = mrt({
            velocity: Fn(() => {
                const currClip = cameraProjectionMatrix.mul(
                    modelViewMatrix.mul(vec4(simPos.xyz, 1)),
                );
                const prevClip = cameraProjectionMatrix.mul(
                    modelViewMatrix.mul(vec4(simPrev.xyz, 1)),
                );
                return currClip.xy.div(currClip.w).sub(prevClip.xy.div(prevClip.w));
            })(),
        });

        this.sprite = new THREE.Sprite(material);
        this.sprite.count = PARTICLE_COUNT;
        this.sprite.frustumCulled = false;
        this.sprite.castShadow = false;
        this.sprite.receiveShadow = true;

        this.scene.add(this.light);
        this.scene.add(this.light.target);
        this.scene.add(this.shadowSprite);
        this.scene.add(this.sprite);
    }

    async loadModel(modelUrl: string, draco = false) {
        this.isReady = false;
        this.disposeSprites();

        if (this.light.parent) {
            this.scene.remove(this.light);
            this.scene.remove(this.light.target);
        }

        const loader = new GLTFLoader();
        if (draco) {
            const dracoLoader = new DRACOLoader();
            dracoLoader.setDecoderPath('https://www.gstatic.com/draco/versioned/decoders/1.5.6/');
            loader.setDRACOLoader(dracoLoader);
        }

        const gltf = await loader.loadAsync(modelUrl);
        const sampled = this.sampleGLBGeometry(gltf.scene);
        this.setup(sampled);

        await this.renderer.computeAsync(this.computeInit);
        this.isReady = true;
    }

    update(deltaTime: number) {
        if (!this.isReady) return;

        // Cap catch-up after tab switch (skill: Math.min(delta * 60, 4))
        const deltaFrames = Math.min(deltaTime * 60, 4);
        const delta = deltaFrames / 60;
        this.uTime.value += delta;
        this.updateMouse(delta);
        this.renderer.compute(this.computeCopyPrev);
        this.renderer.compute(this.computeUpdate);
    }
}
