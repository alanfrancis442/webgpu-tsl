const vertexShader = `
    varying vec2 vUv;
    varying vec4 vColor;
    uniform sampler2D uPositions;
    uniform float uTime;
    float PI = 3.14159265358;
    void main() {
        vec4 pos = texture2D(uPositions, uv);
        vec4 mvPosition = modelViewMatrix * vec4(pos.xyz, 1.0);
        
        float angle = atan(pos.y, pos.x);

        float shade = 0.5 + 0.45 * sin(angle - uTime);
        vColor = vec4(vec3(shade), 1.0);
        gl_PointSize = 2.0*(1.0/-mvPosition.z);
        gl_Position = projectionMatrix * mvPosition;                
        
        vUv = uv;
    } 
`;

export default vertexShader;