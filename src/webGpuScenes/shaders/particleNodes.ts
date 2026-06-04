import {
    Fn,
    uv,
    vec4,
    vec3,
    float,
    sin,
    atan,
    positionView,
} from 'three/tsl';
import type { Node, TextureNode, UniformNode } from 'three/webgpu';

export function createParticleNodes(
    uPositions: TextureNode<'vec4'>,
    uTime: UniformNode<'float', number>,
) {
    const positionNode: Node = Fn(() => {
        const pos = uPositions.sample(uv());
        return vec3(pos.x, pos.y, pos.z);
    })();

    const colorNode: Node = Fn(() => {
        const pos = uPositions.sample(uv());
        const angle = atan(pos.y, pos.x);
        const shade = float(0.5).add(float(0.45).mul(sin(angle.add(uTime))));
        return vec4(vec3(shade), float(1.0));
    })();

    const sizeNode: Node = float(2.0).mul(
        float(300.0).div(positionView.z.negate().max(0.1)),
    );

    return { positionNode, colorNode, sizeNode };
}
