const fragmentShader = ` /* glsl */
    varying vec4 vColor;
    void main() {
        gl_FragColor = vColor;
    }
`;

export default fragmentShader;