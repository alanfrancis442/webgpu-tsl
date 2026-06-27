import * as THREE from 'three/webgpu';
import { pass, uniform } from 'three/tsl';
import { bloom } from 'three/addons/tsl/display/BloomNode.js';
import { dof } from 'three/addons/tsl/display/DepthOfFieldNode.js';
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
            console.log('resize');
            this.onResize();
        });
    }

    onResize() {
        this.dimensions = {
            width: window.innerWidth,
            height: window.innerHeight,
            pixelRatio: Math.min(2, window.devicePixelRatio)
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
            // this.scene.background = texture;
            this.scene.environment = texture;
            this.scene.environment.mapping = THREE.EquirectangularReflectionMapping;
        });
    }

    setSizes() {
        let fov = this.camera.fov * (Math.PI / 180);
        let height = this.camera.position.z * Math.tan(fov / 2) * 2;
        let width = height * this.camera.aspect;

        this.sizes = {
            width: width,
            height: height
        };
    }

    createRender() {
        this.dimensions = {
            width: window.innerWidth,
            height: window.innerHeight,
            pixelRatio: Math.min(2, window.devicePixelRatio)
        };
        this.renderer = new THREE.WebGPURenderer({
            canvas: this.element,
            alpha: false,
            antialias: false,
        });

        this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
        this.renderer.toneMappingExposure = 1.0;
        this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    }

    getTime() {
        return this.time;
    }

    addSimpleMesh() {
        const geometry = new THREE.BoxGeometry();
        const material = new THREE.MeshStandardMaterial({ color: 0x0077ff });
        const cube = new THREE.Mesh(geometry, material);
        this.scene.add(cube);
    }

    addLight() {
        const ambientLight = new THREE.AmbientLight(0xffffff, 0.4);
        this.scene.add(ambientLight);

        const directionalLight = new THREE.DirectionalLight(0xffffff, 1.5);
        directionalLight.position.set(5, 8, 10);
        this.scene.add(directionalLight);
    }

    addGridHelper() {
        const gridHelper = new THREE.GridHelper(10, 10);
        this.scene.add(gridHelper);
    }

    addOrbitControls() {
        this.controls = new OrbitControls(this.camera, this.element);
        this.controls.enableDamping = true;
        this.controls.dampingFactor = 0.1;
        this.controls.enableZoom = true;
        this.controls.enablePan = true;
        this.controls.update();
    }

    createDebugMesh() {
        const mesh = new THREE.Mesh(
            new THREE.PlaneGeometry(5, 5),
            new THREE.MeshBasicMaterial({ color: 0xff0000, side: THREE.DoubleSide })
        )

        this.scene.add(mesh)
    }

    addDebugHelpers() {
        // Add axes helper
        const axesHelper = new THREE.AxesHelper(5);
        this.scene.add(axesHelper);

        // Add camera helper
        const helper = new THREE.CameraHelper(this.camera);
        this.scene.add(helper);
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
        const sceneColor = scenePass.getTextureNode('output');
        const viewZ = scenePass.getViewZNode();

        this.dofFocus = uniform(9.0);
        this.dofFocalLength = uniform(2.5);
        this.dofBokehScale = uniform(1.2);

        this.dofPass = dof(
            sceneColor,
            viewZ,
            this.dofFocus,
            this.dofFocalLength,
            this.dofBokehScale,
        );

        this.bloomPass = bloom(this.dofPass, 0.4, 0.4, 0.1);
        this.renderPipeline.outputNode = (this.dofPass as unknown as typeof sceneColor).add(this.bloomPass);
    }

    getParticleRenderTarget(size: number) {
        return new THREE.RenderTarget(size, size, {
            minFilter: THREE.NearestFilter,
            magFilter: THREE.NearestFilter,
            format: THREE.RGBAFormat,
            type: THREE.FloatType,
            depthBuffer: false,
            stencilBuffer: false,
        });
    }

    render() {
        this.time = this.clock.getElapsedTime();
        this.renderPipeline.render();
    }
}