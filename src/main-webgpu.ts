import './style.css';
import Canvas from './webGpuScenes/Canvas';
import Particles from './webGpuScenes/Particles';

const canvas = new Canvas();
const particles = new Particles(canvas);

canvas.addLight();
canvas.addGridHelper();
canvas.addOrbitControls();

await canvas.init();

function animate() {
    requestAnimationFrame(animate);
    canvas.controls.update();
    particles.update();
}

animate();
