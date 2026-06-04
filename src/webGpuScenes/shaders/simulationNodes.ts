import {
    Fn,
    uv,
    vec4,
    float,
    length,
    abs,
    smoothstep,
    mix,
    sin,
    cos,
    atan,
    vec3,
} from 'three/tsl';
import type { Node, TextureNode, UniformNode } from 'three/webgpu';
import type { Vector2 } from 'three';

export function createSimulationNode(
    uPositions: TextureNode<'vec4'>,
    uInfo: TextureNode<'vec4'>,
    uTime: UniformNode<'float', number>,
    uMouse: UniformNode<'vec2', Vector2>,
): Node {
    return Fn(() => {
        const pos = uPositions.sample(uv());
        const info = uInfo.sample(uv());

        const radius = length(pos.xy);
        const circularForce = float(1).sub(
            smoothstep(float(0.3), float(0.4), abs(pos.x.sub(radius))),
        );
        const angle = atan(pos.y, pos.x).sub(
            info.y.mul(0.1).mul(mix(float(0.5), float(1.0), circularForce)),
        );

        const targetRadius = mix(
            info.x,
            float(1.8),
            float(0.5).add(float(0.45).mul(sin(angle.mul(2.0).add(uTime.mul(0.5))))),
        );
        const newRadius = radius.add(
            targetRadius.sub(radius).mul(mix(float(0.2), float(0.5), circularForce)),
        );

        const targetPos = vec3(cos(angle), sin(angle), float(0.0)).mul(newRadius);
        const posXY = pos.xy.add(targetPos.xy.sub(pos.xy).mul(0.1));

        const distToMouse = length(posXY.sub(uMouse));
        const dir = posXY.sub(uMouse).div(distToMouse.max(0.0001));
        const mouseForce = dir.mul(0.1).mul(smoothstep(0.3, 0.0, distToMouse));
        const finalXY = posXY.add(mouseForce);

        return vec4(finalXY, pos.z, pos.w);
    })();
}
