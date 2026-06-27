import './style.css';
import Canvas from './ModelParticles/Canvas';
import Particles from './ModelParticles/Particles';

const canvas = new Canvas();
const particles = new Particles(canvas);

canvas.addLight();
canvas.addOrbitControls();

await canvas.init();
particles.setupPostFxGui(canvas);

try {
    await particles.loadModel('/tux.glb', false);
} catch (error) {
    console.error('Failed to load model:', error);
}

function animate() {
    requestAnimationFrame(animate);
    canvas.controls.update();
    particles.update(canvas.clock.getDelta());
    canvas.render();
}

animate();
