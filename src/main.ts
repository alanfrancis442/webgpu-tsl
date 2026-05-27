import './style.css'
import Canvas from './threeJsScenes/Canvas';
import Particles from './threeJsScenes/Particles';

const canvas = new Canvas();
new Particles(canvas.scene, canvas.renderer);
canvas.addLight();
canvas.addGridHelper();
canvas.addOrbitControls();
function animate() {
    requestAnimationFrame(animate);
    canvas.render();
}

animate();
