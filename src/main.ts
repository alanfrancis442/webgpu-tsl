import './style.css'
import Canvas from './threeJsScenes/Canvas';
import Particles from './threeJsScenes/Particles';

const canvas = new Canvas();
const particles = new Particles(canvas);
canvas.addLight();
canvas.addGridHelper();
canvas.addOrbitControls();
function animate() {
    requestAnimationFrame(animate);
    canvas.controls.update();
    canvas.render();
    particles.update();
}

animate();
