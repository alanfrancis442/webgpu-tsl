import './style.css'
import Canvas from './Canvas'

const canvas = new Canvas();
canvas.addDebugHelpers();
canvas.addSimpleMesh();
canvas.addLight();
canvas.addGridHelper();
canvas.addOrbitControls();
await canvas.init();
function animate() {
    requestAnimationFrame(animate);
    canvas.time = canvas.clock.getElapsedTime();
    if(canvas.renderer){
        canvas.render()
    }
}

animate();
