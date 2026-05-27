import * as THREE from 'three';
import Canvas from './Canvas';
import simVert from './shaders/simVert';
import simFrag from './shaders/simFrag';

const PARTICLE_COUNT = 100000;

const material = new THREE.SpriteMaterial({
    color: 0xffffff,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
});

const sprite = new THREE.Sprite(material);
sprite.scale.set(0.5, 0.5, 1);
sprite.position.set(0, 1, 0);

export default class Particles {
    scene: THREE.Scene;
    renderer: THREE.WebGLRenderer;
    fbo: THREE.WebGLRenderTarget;
    fbo1: THREE.WebGLRenderTarget;
    fboScene: THREE.Scene;
    fboCamera: THREE.OrthographicCamera;
    fboMaterial: THREE.ShaderMaterial;
    points: THREE.Points;
    data: Float32Array;
    particleCount: number;
    count: number;

    constructor(scene: THREE.Scene, renderer: THREE.WebGLRenderer) {
        this.scene = scene;
        this.renderer = renderer;
        this.particleCount = 128;
        this.setupFBO();
        this.initPoints();
        // this.addParticles();
    }

    setupFBO() {
        this.fbo = this.renderer.getRenderTarget();
        this.fbo1 = this.renderer.getRenderTarget();

        this.fboScene = new THREE.Scene();
        this.fboCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
        this.fboCamera.position.set(0, 0, 0.5);
        this.fboCamera.lookAt(0, 0, 0);

        let geometry = new THREE.PlaneGeometry(2, 2);
        this.fboMaterial = new THREE.ShaderMaterial({
            vertexShader: simVert,
            fragmentShader: simFrag,
            uniforms: {
                uPositions: { value: null },
                uVelocities: { value: null },
                time: { value: null },
            },
        });
        this.data = new Float32Array(this.particleCount * this.particleCount * 4);

        for (let i = 0; i < this.particleCount; i++) {
            for (let j = 0; j < this.particleCount; j++) {
                let index = (i * this.particleCount + j) * 4;
                let theta = Math.random() * 2 * Math.PI;
                let radius = Math.random() * 0.5 + 0.5;
                this.data[index] = radius * Math.cos(theta);
                this.data[index + 1] = radius * Math.sin(theta);
                this.data[index + 2] = 0.0;
                this.data[index + 3] = 0.0;
            }
        }

        // let texture = new THREE.DataTexture(this.data, this.particleCount, this.particleCount, THREE.RGBAFormat, THREE.FloatType);
        // texture.needsUpdate = true;

        // this.fboMaterial.uniforms.uPositions.value = texture;
        // this.fboMaterial.uniforms.time.value = 0;

        // let mesh = new THREE.Mesh(geometry, this.fboMaterial);
        // this.fboScene.add(mesh);
    }

    initPoints() {
        const bufferGeometry = new THREE.BufferGeometry();

        this.count = this.particleCount * this.particleCount;
        let positions = new Float32Array(this.count * 3);
        let uv = new Float32Array(this.count * 2);

        for (let i = 0; i < this.count; i++) {
            for (let j = 0; j < this.particleCount; j++) {
                let index = (i + this.count * j);
                positions[index * 3] = Math.random() * 2 - 1;
                positions[index * 3 + 1] = Math.random() * 2 - 1;
                positions[index * 3 + 2] = 0;
                uv[index * 2] = i / this.particleCount;
                uv[index * 2 + 1] = j / this.particleCount;
            }
        }

        bufferGeometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
        bufferGeometry.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
        this.points = new THREE.Points(bufferGeometry, this.fboMaterial);
        this.scene.add(this.points);
    }


    addParticles() {
        this.scene.add(sprite);
    }
}