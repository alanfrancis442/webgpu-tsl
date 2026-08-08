import * as THREE from 'three/webgpu';
import {
    pass, uniform, mrt, output, velocity, int,
} from 'three/tsl';
import { bloom } from 'three/addons/tsl/display/BloomNode.js';
import { dof } from 'three/addons/tsl/display/DepthOfFieldNode.js';
import { motionBlur } from 'three/addons/tsl/display/MotionBlur.js';
import { OrbitControls } from 'three/examples/jsm/Addons.js';
import { HDRLoader } from 'three/examples/jsm/Addons.js';

export default class Canvas {
    element: HTMLCanvasElement;
    scene: THREE.Scene;
    camera!: THREE.PerspectiveCamera;
    renderer!: THREE.WebGPURenderer;
    time: number;
    clock: THREE.Clock;
    dimensions!: { width: number; height: number; pixelRatio: number };
    sizes!: { width: number; height: number };
    controls!: OrbitControls;
    renderPipeline!: THREE.RenderPipeline;
    bloomPass!: ReturnType<typeof bloom>;
    dofPass!: ReturnType<typeof dof>;
    dofFocus!: THREE.UniformNode<'float', number>;
    dofFocalLength!: THREE.UniformNode<'float', number>;
    dofBokehScale!: THREE.UniformNode<'float', number>;
    blurAmount!: THREE.UniformNode<'float', number>;

    constructor() {
        this.element = document.createElement('canvas');
        this.element.classList.add('webgl');
        document.body.appendChild(this.element);
        this.scene = new THREE.Scene();
        this.time = 0;
        this.clock = new THREE.Clock();
        this.addHDRTexture();
        this.createCamera();
        this.createRender();
        this.setSizes();
        window.addEventListener('resize', () => {
            this.onResize();
        });
    }

    onResize() {
        this.dimensions = {
            width: window.innerWidth,
            height: window.innerHeight,
            pixelRatio: Math.min(2, window.devicePixelRatio),
        };
        this.camera.aspect = window.innerWidth / window.innerHeight;
        this.camera.updateProjectionMatrix();
        this.setSizes();

        this.renderer.setPixelRatio(this.dimensions.pixelRatio);
        this.renderer.setSize(this.dimensions.width, this.dimensions.height);
    }

    createCamera() {
        this.camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
        this.camera.position.set(0, 0, 10);
    }

    addHDRTexture() {
        const loader = new HDRLoader();
        loader.load('https://dl.polyhaven.org/file/ph-assets/HDRIs/hdr/1k/the_sky_is_on_fire_1k.hdr', (texture) => {
            this.scene.environment = texture;
            this.scene.environment.mapping = THREE.EquirectangularReflectionMapping;
        });
    }

    setSizes() {
        const fov = this.camera.fov * (Math.PI / 180);
        const height = this.camera.position.z * Math.tan(fov / 2) * 2;
        const width = height * this.camera.aspect;

        this.sizes = {
            width,
            height,
        };
    }

    createRender() {
        this.dimensions = {
            width: window.innerWidth,
            height: window.innerHeight,
            pixelRatio: Math.min(2, window.devicePixelRatio),
        };
        this.renderer = new THREE.WebGPURenderer({
            canvas: this.element,
            alpha: false,
            antialias: false,
            // Headroom for large particle storage buffers (70k+ vec3 × several arrays)
            requiredLimits: {
                maxBufferSize: 512 * 1024 * 1024,
                maxStorageBufferBindingSize: 256 * 1024 * 1024,
            },
        });

        this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
        this.renderer.toneMappingExposure = 1.0;
        this.renderer.outputColorSpace = THREE.SRGBColorSpace;
        this.renderer.shadowMap.enabled = true;
        this.renderer.shadowMap.type = THREE.PCFShadowMap;
    }

    getTime() {
        return this.time;
    }

    addOrbitControls() {
        this.controls = new OrbitControls(this.camera, this.element);
        this.controls.enableDamping = true;
        this.controls.dampingFactor = 0.1;
        this.controls.enableZoom = true;
        this.controls.enablePan = true;
        this.controls.update();
    }

    async init() {
        await this.renderer.init();
        this.renderer.setSize(this.dimensions.width, this.dimensions.height);
        this.renderer.setPixelRatio(Math.min(2, window.devicePixelRatio));
        this.setupPostProcessing();
        this.renderPipeline.render();
    }

    private setupPostProcessing() {
        this.renderPipeline = new THREE.RenderPipeline(this.renderer);

        const scenePass = pass(this.scene, this.camera);

        const velocityBlend = new THREE.BlendMode(THREE.CustomBlending);
        velocityBlend.blendSrc = THREE.OneFactor;
        velocityBlend.blendDst = THREE.OneFactor;
        velocityBlend.blendEquation = THREE.MaxEquation;

        const sceneMrt = mrt({ output, velocity });
        sceneMrt.setBlendMode('velocity', velocityBlend);
        scenePass.setMRT(sceneMrt);

        const sceneColor = scenePass.getTextureNode('output');
        const velocityTex = scenePass.getTextureNode('velocity');
        const viewZ = scenePass.getViewZNode();

        this.blurAmount = uniform(0.52);
        this.dofFocus = uniform(9.0);
        this.dofFocalLength = uniform(2.5);
        this.dofBokehScale = uniform(1.2);

        const blurred = motionBlur(
            sceneColor,
            velocityTex.mul(this.blurAmount),
            int(8),
        );

        this.dofPass = dof(
            blurred,
            viewZ,
            this.dofFocus,
            this.dofFocalLength,
            this.dofBokehScale,
        );

        this.bloomPass = bloom(this.dofPass, 0.4, 0.4, 0.1);
        this.renderPipeline.outputNode = (this.dofPass as unknown as typeof sceneColor).add(this.bloomPass);
    }

    render() {
        this.time = this.clock.getElapsedTime();
        this.renderPipeline.render();
    }
}
