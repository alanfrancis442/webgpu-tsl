import * as THREE from 'three/webgpu';
import { uniform, uniformTexture } from 'three/tsl';
import type { TextureNode, UniformNode } from 'three/webgpu';
import Canvas from './Canvas';
import { createSimulationNode } from './shaders/simulationNodes';
import { createParticleNodes } from './shaders/particleNodes';

export default class Particles {
    canvas: Canvas;
    scene: THREE.Scene;
    camera: THREE.Camera;
    renderer: THREE.WebGPURenderer;
    raycaster: THREE.Raycaster;
    mouse: THREE.Vector2;
    mouseWorld: THREE.Vector3;
    interactionPlane: THREE.Plane;
    fbo!: THREE.RenderTarget;
    fbo1!: THREE.RenderTarget;
    fboScene!: THREE.Scene;
    fboCamera!: THREE.OrthographicCamera;
    fboMaterial!: THREE.MeshBasicNodeMaterial;
    fboTexture!: THREE.DataTexture;
    info!: THREE.DataTexture;
    infoArray!: Float32Array;
    material!: THREE.PointsNodeMaterial;
    points!: THREE.Points;
    data!: Float32Array;
    particleCount: number;
    count!: number;
    seeded: boolean;

    uPositionsReadTex!: TextureNode<'vec4'>;
    uPositionsDisplayTex!: TextureNode<'vec4'>;
    uInfoTex!: TextureNode<'vec4'>;
    uTime!: UniformNode<'float', number>;
    uMouse!: UniformNode<'vec2', THREE.Vector2>;

    constructor(canvas: Canvas) {
        this.canvas = canvas;
        this.scene = canvas.scene;
        this.camera = canvas.camera;
        this.renderer = canvas.renderer;
        this.raycaster = new THREE.Raycaster();
        this.mouse = new THREE.Vector2(0, 0);
        this.mouseWorld = new THREE.Vector3(0, 0, 0);
        this.interactionPlane = new THREE.Plane(new THREE.Vector3(0, 0, 1), 0);
        this.particleCount = 256;
        this.seeded = false;
        this.setupFBO();
        this.initPoints();
        this.initRaycaster();
    }

    initRaycaster() {
        const canvas = this.canvas.element;

        const onPointerMove = (event: PointerEvent) => {
            const rect = canvas.getBoundingClientRect();
            this.mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
            this.mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

            this.raycaster.setFromCamera(this.mouse, this.camera);

            const hit = this.raycaster.ray.intersectPlane(this.interactionPlane, this.mouseWorld);
            if (hit !== null) {
                this.uMouse.value.set(hit.x, hit.y);
            }
        };

        canvas.addEventListener('pointermove', onPointerMove);
    }

    setupFBO() {
        const size = this.particleCount;
        this.fbo = this.canvas.getParticleRenderTarget(size);
        this.fbo1 = this.canvas.getParticleRenderTarget(size);

        this.fboScene = new THREE.Scene();
        this.fboCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

        this.data = new Float32Array(size * size * 4);

        for (let y = 0; y < size; y++) {
            for (let x = 0; x < size; x++) {
                const index = (y * size + x) * 4;
                const theta = Math.random() * 2 * Math.PI;
                const radius = Math.random() * 0.5 + 0.5;
                this.data[index] = radius * Math.cos(theta);
                this.data[index + 1] = radius * Math.sin(theta);
                this.data[index + 2] = 0.0;
                this.data[index + 3] = 0.0;
            }
        }

        this.fboTexture = new THREE.DataTexture(
            this.data,
            size,
            size,
            THREE.RGBAFormat,
            THREE.FloatType,
        );
        this.fboTexture.minFilter = THREE.NearestFilter;
        this.fboTexture.magFilter = THREE.NearestFilter;
        this.fboTexture.needsUpdate = true;

        this.infoArray = new Float32Array(size * size * 4);

        for (let y = 0; y < size; y++) {
            for (let x = 0; x < size; x++) {
                const index = (y * size + x) * 4;
                this.infoArray[index] = Math.random() + 0.5;
                this.infoArray[index + 1] = Math.random() + 0.5;
                this.infoArray[index + 2] = 0.0;
                this.infoArray[index + 3] = 0.0;
            }
        }

        this.info = new THREE.DataTexture(
            this.infoArray,
            size,
            size,
            THREE.RGBAFormat,
            THREE.FloatType,
        );
        this.info.minFilter = THREE.NearestFilter;
        this.info.magFilter = THREE.NearestFilter;
        this.info.needsUpdate = true;

        this.uPositionsReadTex = uniformTexture(this.fboTexture);
        this.uPositionsDisplayTex = uniformTexture(this.fboTexture);
        this.uInfoTex = uniformTexture(this.info);
        this.uTime = uniform(0);
        this.uMouse = uniform(new THREE.Vector2(0, 0));

        this.fboMaterial = new THREE.MeshBasicNodeMaterial();
        this.fboMaterial.colorNode = createSimulationNode(
            this.uPositionsReadTex,
            this.uInfoTex,
            this.uTime,
            this.uMouse,
        ) as THREE.MeshBasicNodeMaterial['colorNode'];

        const geometry = new THREE.PlaneGeometry(2, 2);
        const mesh = new THREE.Mesh(geometry, this.fboMaterial);
        this.fboScene.add(mesh);
    }

    initPoints() {
        const size = this.particleCount;
        this.count = size * size;

        const { positionNode, colorNode, sizeNode } = createParticleNodes(
            this.uPositionsDisplayTex,
            this.uTime,
        );

        this.material = new THREE.PointsNodeMaterial({
            transparent: false,
            depthWrite: true,
        });
        this.material.positionNode = positionNode as THREE.PointsNodeMaterial['positionNode'];
        this.material.colorNode = colorNode as THREE.PointsNodeMaterial['colorNode'];
        this.material.sizeNode = sizeNode as THREE.PointsNodeMaterial['sizeNode'];

        const bufferGeometry = new THREE.BufferGeometry();
        const positions = new Float32Array(this.count * 3);
        const uv = new Float32Array(this.count * 2);

        for (let y = 0; y < size; y++) {
            for (let x = 0; x < size; x++) {
                const index = y * size + x;
                positions[index * 3] = 0;
                positions[index * 3 + 1] = 0;
                positions[index * 3 + 2] = 0;
                uv[index * 2] = (x + 0.5) / size;
                uv[index * 2 + 1] = (y + 0.5) / size;
            }
        }

        bufferGeometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
        bufferGeometry.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
        this.points = new THREE.Points(bufferGeometry, this.material);
        this.scene.add(this.points);
    }

    update() {
        const readTexture = this.seeded ? this.fbo1.texture : this.fboTexture;
        this.uPositionsReadTex.value = readTexture;
        this.uPositionsDisplayTex.value = this.fbo.texture;
        this.uTime.value += 0.01;

        this.renderer.setRenderTarget(this.fbo);
        this.renderer.render(this.fboScene, this.fboCamera);
        this.renderer.setRenderTarget(null);
        this.renderer.render(this.scene, this.camera);

        this.seeded = true;

        const temp = this.fbo;
        this.fbo = this.fbo1;
        this.fbo1 = temp;
    }
}
