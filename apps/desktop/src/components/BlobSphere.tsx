import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { useReducedMotion } from "motion/react";
import { useLayoutEffect, useMemo, useRef } from "react";
import { type Group, type InstancedMesh, Object3D, Vector3 } from "three";

/**
 * Flat, monochrome, voice-specific orb: a sphere built from thin white
 * waveform bars (a bar-chart globe), each bar breathing as if reacting to
 * idle audio amplitude. Unlit basic material, no lights, no shading, no
 * glow — pure white geometry on a pure black panel.
 */

const COUNT = 700;
const RADIUS = 0.92;
const MIN_LEN = 0.06;
const MAX_LEN = 0.34;
const UP = new Vector3(0, 1, 0);

interface Bar {
  dir: Vector3;
  phase: number;
}

function energyAt(bar: Bar, t: number): number {
  const { dir, phase } = bar;
  const wave =
    0.55 * Math.sin(t * 1.4 + phase) +
    0.3 * Math.sin(t * 2.6 + phase * 1.7 + dir.y * 3.0) +
    0.15 * Math.sin(t * 0.7 + dir.x * 5.0);
  return Math.min(1, Math.max(0, 0.5 + 0.5 * wave));
}

function WaveformGlobe({ animated }: { animated: boolean }) {
  const meshRef = useRef<InstancedMesh>(null);
  const groupRef = useRef<Group>(null);
  const invalidate = useThree((s) => s.invalidate);
  const dummy = useMemo(() => new Object3D(), []);
  const bars = useMemo<Bar[]>(() => {
    const golden = Math.PI * (3 - Math.sqrt(5));
    return Array.from({ length: COUNT }, (_, i) => {
      const y = 1 - (i / (COUNT - 1)) * 2;
      const r = Math.sqrt(Math.max(0, 1 - y * y));
      const theta = golden * i;
      return {
        dir: new Vector3(Math.cos(theta) * r, y, Math.sin(theta) * r),
        phase: (i * 2.399963) % (Math.PI * 2),
      };
    });
  }, []);

  const layout = (time: number | null) => {
    const mesh = meshRef.current;
    if (!mesh) return;
    for (let i = 0; i < bars.length; i++) {
      const bar = bars[i];
      const e = time === null ? 0.5 : energyAt(bar, time);
      const len = MIN_LEN + e * MAX_LEN;
      dummy.position.copy(bar.dir).multiplyScalar(RADIUS + len / 2);
      dummy.quaternion.setFromUnitVectors(UP, bar.dir);
      dummy.scale.set(1, len, 1);
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
    }
    mesh.instanceMatrix.needsUpdate = true;
  };

  // Reduced motion: one static mid-amplitude frame, no loop.
  useLayoutEffect(() => {
    if (animated) return;
    layout(null);
    if (groupRef.current) groupRef.current.rotation.y = 0.5;
    invalidate();
  });

  useFrame(({ clock }) => {
    if (!animated) return;
    const t = clock.getElapsedTime();
    layout(t);
    if (groupRef.current) groupRef.current.rotation.y = t * 0.12;
  });

  return (
    <group ref={groupRef}>
      <instancedMesh
        ref={meshRef}
        args={[undefined, undefined, COUNT]}
        frustumCulled={false}
      >
        <boxGeometry args={[0.02, 1, 0.02]} />
        <meshBasicMaterial color="#ffffff" toneMapped={false} />
      </instancedMesh>
    </group>
  );
}

const BlobSphere = ({ className }: { className?: string }) => {
  const reduceMotion = useReducedMotion();
  const animated = !reduceMotion;

  return (
    <Canvas
      className={className}
      dpr={[1, 2]}
      camera={{ position: [0, 0, 3], fov: 60 }}
      gl={{ antialias: true }}
      frameloop={animated ? "always" : "never"}
    >
      <color attach="background" args={["#000000"]} />
      <WaveformGlobe animated={animated} />
    </Canvas>
  );
};

export default BlobSphere;
