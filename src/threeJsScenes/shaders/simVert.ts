const simVert = `
    varying vec2 vUv;
    uniform vec2 uv;
    uniform sampler2D uPositions;
    float PI = 3.14159265358;
    void main() {
        vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
        
        gl_PointSize = 1.0;
        gl_Position = projectionMatrix * mvPosition;                
        
        vUv = uv;
    }
`;

export default simVert;