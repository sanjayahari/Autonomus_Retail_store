// src/StoreScene.jsx
// Autonomous Retail — 3D Store Scene (react-three-fiber + drei)
// Props: { scrollProgress } — 0‥1 normalised scroll position

import { useRef, useMemo, useEffect } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';

// ─── Helpers ──────────────────────────────────────────────────────────────────

const EMERALD  = new THREE.Color(0x10b981);
const INDIGO   = new THREE.Color(0x6366f1);
const DARK_BG  = new THREE.Color(0x09090b);

const PRODUCT_COLORS = [
  '#f43f5e', // Rose / Wine red
  '#3b82f6', // Steel Blue
  '#10b981', // Emerald / Sage Green
  '#eab308', // Amber / Gold
  '#8b5cf6', // Indigo / Purple
  '#06b6d4', // Teal / Cyan
  '#f97316', // Orange / Bronze
  '#a855f7', // Lavender
];

function lerp(a, b, t) { return a + (b - a) * t; }
function lerpV3(out, a, b, t) {
  out.x = lerp(a.x, b.x, t);
  out.y = lerp(a.y, b.y, t);
  out.z = lerp(a.z, b.z, t);
}

// Five scroll keyframes: position + lookAt target
const CAM_KEYS = [
  { t: 0.0,  pos: { x: 15, y: 12, z: 15 },  target: { x: 0, y: 0, z: 0 } },
  { t: 0.3,  pos: { x: 4,  y: 4,  z: 6 },   target: { x: 2, y: 1.5, z: -1 } },
  { t: 0.5,  pos: { x: -6, y: 6,  z: 8 },   target: { x: 0, y: 3, z: 0 } },
  { t: 0.7,  pos: { x: -2, y: 3,  z: -8 },  target: { x: 0, y: 0.2, z: -5 } },
  { t: 1.0,  pos: { x: 0,  y: 18, z: 0.1 }, target: { x: 0, y: 0, z: 0 } },
];

function getKeyframes(progress) {
  let i = 0;
  while (i < CAM_KEYS.length - 1 && CAM_KEYS[i + 1].t <= progress) i++;
  const a = CAM_KEYS[i];
  const b = CAM_KEYS[Math.min(i + 1, CAM_KEYS.length - 1)];
  const range = b.t - a.t || 1;
  const local = Math.max(0, Math.min(1, (progress - a.t) / range));
  // smoothstep
  const t = local * local * (3 - 2 * local);
  return { a, b, t };
}

// ─── Camera Rig ───────────────────────────────────────────────────────────────

function CameraRig({ scrollProgress }) {
  const { camera } = useThree();
  const posRef = useRef(new THREE.Vector3(15, 12, 15));
  const tarRef = useRef(new THREE.Vector3(0, 0, 0));
  const desiredPos = useRef(new THREE.Vector3());
  const desiredTar = useRef(new THREE.Vector3());

  useFrame(() => {
    const { a, b, t } = getKeyframes(scrollProgress);
    desiredPos.current.set(
      lerp(a.pos.x, b.pos.x, t),
      lerp(a.pos.y, b.pos.y, t),
      lerp(a.pos.z, b.pos.z, t),
    );
    desiredTar.current.set(
      lerp(a.target.x, b.target.x, t),
      lerp(a.target.y, b.target.y, t),
      lerp(a.target.z, b.target.z, t),
    );

    // Smooth lag
    const lag = 0.06;
    posRef.current.lerp(desiredPos.current, lag);
    tarRef.current.lerp(desiredTar.current, lag);

    camera.position.copy(posRef.current);
    camera.lookAt(tarRef.current);
  });

  return null;
}

// ─── Ground Plane with Grid ──────────────────────────────────────────────────

function Ground() {
  return (
    <group>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.01, 0]} receiveShadow>
        <planeGeometry args={[45, 45]} />
        <meshStandardMaterial color="#050507" metalness={0.95} roughness={0.06} />
      </mesh>
      <gridHelper args={[45, 45, 0x10b981, 0x0c0c0e]} position={[0, 0.005, 0]} material-transparent={true} material-opacity={0.3} />
    </group>
  );
}

// ─── Store Shell (wireframe box) ──────────────────────────────────────────────

function StoreShell() {
  return (
    <group>
      <lineSegments position={[0, 3, 0]}>
        <edgesGeometry args={[new THREE.BoxGeometry(14, 6, 10)]} />
        <lineBasicMaterial color={EMERALD} transparent opacity={0.25} />
      </lineSegments>
    </group>
  );
}

// ─── Shelf Products (Beverage canisters, bottles, cartons) ───────────────────
function ShelfProducts({ shelfIndex, productType }) {
  const count = 6;
  const spacing = 0.32;
  const startX = -0.8;

  return (
    <group position={[0, 0.02, 0]}>
      {Array.from({ length: count }).map((_, idx) => {
        const x = startX + idx * spacing;
        const z = (Math.random() - 0.5) * 0.14;
        const color = PRODUCT_COLORS[(shelfIndex + idx + productType) % PRODUCT_COLORS.length];
        const pColor = new THREE.Color(color);

        if (shelfIndex === 0) {
          // Bottom Shelf: Beverage canisters with metallic rims
          return (
            <group key={idx} position={[x, 0.08, z]}>
              {/* Can body with colored brand wrap */}
              <mesh castShadow>
                <cylinderGeometry args={[0.048, 0.048, 0.14, 12]} />
                <meshStandardMaterial color={pColor} metalness={0.8} roughness={0.25} />
              </mesh>
              {/* Top metallic rim */}
              <mesh position={[0, 0.072, 0]} castShadow>
                <cylinderGeometry args={[0.05, 0.05, 0.008, 12]} />
                <meshStandardMaterial color="#d4d4d8" metalness={0.95} roughness={0.15} />
              </mesh>
              {/* Bottom metallic rim */}
              <mesh position={[0, -0.072, 0]} castShadow>
                <cylinderGeometry args={[0.05, 0.05, 0.008, 12]} />
                <meshStandardMaterial color="#d4d4d8" metalness={0.95} roughness={0.15} />
              </mesh>
            </group>
          );
        } else if (shelfIndex === 1) {
          // Second Shelf: Premium glass bottles with labels and gold cork foils
          return (
            <group key={idx} position={[x, 0.1, z]}>
              {/* Glass bottle body */}
              <mesh position={[0, 0, 0]} castShadow>
                <cylinderGeometry args={[0.038, 0.038, 0.14, 12]} />
                <meshPhysicalMaterial
                  color={pColor}
                  roughness={0.08}
                  metalness={0.2}
                  transmission={0.9}
                  thickness={0.1}
                  transparent
                  opacity={0.6}
                  clearcoat={1.0}
                />
              </mesh>
              {/* Brand paper label */}
              <mesh position={[0, -0.01, 0.002]}>
                <cylinderGeometry args={[0.039, 0.039, 0.07, 12]} />
                <meshStandardMaterial color="#fafaf9" roughness={0.85} metalness={0.0} />
              </mesh>
              {/* Bottle neck */}
              <mesh position={[0, 0.105, 0]} castShadow>
                <cylinderGeometry args={[0.013, 0.013, 0.07, 8]} />
                <meshPhysicalMaterial
                  color={pColor}
                  roughness={0.08}
                  metalness={0.2}
                  transmission={0.9}
                  thickness={0.1}
                  transparent
                  opacity={0.6}
                  clearcoat={1.0}
                />
              </mesh>
              {/* Gold cork wrap */}
              <mesh position={[0, 0.142, 0]} castShadow>
                <cylinderGeometry args={[0.014, 0.014, 0.015, 8]} />
                <meshStandardMaterial color="#ca8a04" metalness={0.95} roughness={0.1} />
              </mesh>
            </group>
          );
        } else if (shelfIndex === 2) {
          // Third Shelf: Cereal / Gourmet food boxes with gold accents
          return (
            <group key={idx} position={[x, 0.11, z]}>
              {/* Cardboard box */}
              <mesh castShadow>
                <boxGeometry args={[0.075, 0.22, 0.075]} />
                <meshStandardMaterial color={pColor} roughness={0.6} metalness={0.1} />
              </mesh>
              {/* Premium gold brand stripe */}
              <mesh position={[0, 0.02, 0.001]}>
                <boxGeometry args={[0.077, 0.04, 0.077]} />
                <meshStandardMaterial color="#eab308" metalness={0.85} roughness={0.2} />
              </mesh>
            </group>
          );
        } else {
          // Top Shelf: Premium canister with shiny gold cap
          return (
            <group key={idx} position={[x, 0.06, z]}>
              {/* Matte canister body */}
              <mesh castShadow>
                <cylinderGeometry args={[0.038, 0.038, 0.09, 12]} />
                <meshStandardMaterial color={pColor} metalness={0.5} roughness={0.3} />
              </mesh>
              {/* Shiny gold lid */}
              <mesh position={[0, 0.048, 0]} castShadow>
                <cylinderGeometry args={[0.039, 0.039, 0.015, 12]} />
                <meshStandardMaterial color="#eab308" metalness={0.95} roughness={0.05} />
              </mesh>
            </group>
          );
        }
      })}
    </group>
  );
}

// ─── Shelf Unit (single) ──────────────────────────────────────────────────────

function ShelfUnit({ position, productType = 0 }) {
  const shelfCount = 4;
  const shelfHeight = 0.8;

  // Corner columns (matte black steel posts)
  const postGeom = <cylinderGeometry args={[0.02, 0.02, shelfCount * shelfHeight, 8]} />;
  const steelMat = <meshStandardMaterial color="#1a1a20" metalness={0.95} roughness={0.1} />;

  // LED Light strip material
  const ledMat = (
    <meshStandardMaterial
      color={EMERALD}
      emissive={EMERALD}
      emissiveIntensity={0.7}
      transparent
      opacity={0.9}
    />
  );

  return (
    <group position={position}>
      {/* 4 Corner columns */}
      <mesh position={[-1.0, (shelfCount * shelfHeight) / 2, -0.26]}>{postGeom}{steelMat}</mesh>
      <mesh position={[1.0, (shelfCount * shelfHeight) / 2, -0.26]}>{postGeom}{steelMat}</mesh>
      <mesh position={[-1.0, (shelfCount * shelfHeight) / 2, 0.26]}>{postGeom}{steelMat}</mesh>
      <mesh position={[1.0, (shelfCount * shelfHeight) / 2, 0.26]}>{postGeom}{steelMat}</mesh>

      {/* Top cap decorative board */}
      <mesh position={[0, shelfCount * shelfHeight + 0.03, 0]} castShadow>
        <boxGeometry args={[2.14, 0.05, 0.58]} />
        <meshStandardMaterial color="#0c0c0f" metalness={0.9} roughness={0.2} />
      </mesh>

      {/* Individual shelves */}
      {Array.from({ length: shelfCount }).map((_, i) => {
        const y = i * shelfHeight + 0.05;
        return (
          <group key={i} position={[0, y, 0]}>
            {/* Frosted Glass Shelf Platform */}
            <mesh position={[0, 0, 0]}>
              <boxGeometry args={[2.08, 0.025, 0.54]} />
              <meshPhysicalMaterial
                color="#0e172c"
                roughness={0.12}
                metalness={0.1}
                transmission={0.85}
                thickness={0.2}
                transparent
                opacity={0.7}
                clearcoat={1.0}
              />
            </mesh>

            {/* LED Glow Strip underneath the glass shelf */}
            {i > 0 && (
              <mesh position={[0, -0.015, 0]}>
                <boxGeometry args={[1.9, 0.01, 0.01]} />
                {ledMat}
              </mesh>
            )}

            {/* Products on this shelf platform */}
            <ShelfProducts shelfIndex={i} productType={productType} />
          </group>
        );
      })}
    </group>
  );
}

// ─── Shelves (4 units, 2 aisles) ──────────────────────────────────────────────

function Shelves() {
  return (
    <group>
      {/* Aisle 1 */}
      <ShelfUnit position={[2.2, 0, -1.2]} productType={0} />
      <ShelfUnit position={[2.2, 0, 1.8]} productType={1} />
      {/* Aisle 2 */}
      <ShelfUnit position={[-2.8, 0, -1.2]} productType={2} />
      <ShelfUnit position={[-2.8, 0, 1.8]} productType={3} />
    </group>
  );
}

// ─── Camera Mounts (Futuristic domes with subtle scan beams) ───────────────────

// ─── Camera Mounts & Ceiling Truss (Futuristic structure & scan beams) ────────
function CeilingTruss() {
  return (
    <group position={[0, 5.85, 0]}>
      {/* Main lengthwise steel girder 1 */}
      <mesh position={[-3, 0, 0]} rotation={[Math.PI / 2, 0, 0]}>
        <cylinderGeometry args={[0.04, 0.04, 12, 8]} />
        <meshStandardMaterial color="#1f1f23" metalness={0.95} roughness={0.2} />
      </mesh>
      {/* Main lengthwise steel girder 2 */}
      <mesh position={[3, 0, 0]} rotation={[Math.PI / 2, 0, 0]}>
        <cylinderGeometry args={[0.04, 0.04, 12, 8]} />
        <meshStandardMaterial color="#1f1f23" metalness={0.95} roughness={0.2} />
      </mesh>
      {/* Cross support girders */}
      {[-4.5, -1.5, 1.5, 4.5].map((z) => (
        <mesh key={z} position={[0, 0, z]} rotation={[0, 0, Math.PI / 2]}>
          <cylinderGeometry args={[0.03, 0.03, 6, 8]} />
          <meshStandardMaterial color="#1f1f23" metalness={0.95} roughness={0.2} />
        </mesh>
      ))}
      {/* Spotlights pointing down */}
      {[-3.5, 0, 3.5].map((z, i) => (
        <group key={i} position={[0, -0.12, z]} rotation={[Math.PI / 8, 0, 0]}>
          <mesh>
            <cylinderGeometry args={[0.05, 0.06, 0.12, 12]} />
            <meshStandardMaterial color="#0c0c0e" metalness={0.9} roughness={0.15} />
          </mesh>
          <mesh position={[0, -0.061, 0]}>
            <sphereGeometry args={[0.045, 12, 12]} />
            <meshBasicMaterial color="#fafafa" />
          </mesh>
        </group>
      ))}
    </group>
  );
}

function CameraMount({ position, rotation }) {
  const scanColor = new THREE.Color(0x10b981);

  return (
    <group position={position} rotation={rotation}>
      {/* Sleek metallic ceiling bracket */}
      <mesh position={[0, 0.1, 0]}>
        <cylinderGeometry args={[0.03, 0.03, 0.25, 8]} />
        <meshStandardMaterial color="#27272a" metalness={0.95} roughness={0.15} />
      </mesh>

      {/* Modern black dome security camera housing */}
      <mesh position={[0, -0.07, 0]}>
        <sphereGeometry args={[0.13, 16, 16, 0, Math.PI * 2, 0, Math.PI / 2]} />
        <meshStandardMaterial color="#0c0c0f" metalness={0.9} roughness={0.15} />
      </mesh>

      {/* Shiny lens element */}
      <mesh position={[0, -0.08, 0.03]}>
        <sphereGeometry args={[0.055, 16, 16]} />
        <meshStandardMaterial color="#6366f1" emissive="#4f46e5" emissiveIntensity={0.5} roughness={0.05} metalness={0.95} />
      </mesh>

      {/* Soft futuristic scanning light cone (extremely subtle hologram) */}
      <mesh position={[0, -1.8, 0]}>
        <coneGeometry args={[1.4, 3.6, 32, 1, true]} />
        <meshStandardMaterial
          color={scanColor}
          transparent
          opacity={0.015}
          side={THREE.DoubleSide}
          depthWrite={false}
          blending={THREE.AdditiveBlending}
        />
      </mesh>
    </group>
  );
}

function CameraMounts() {
  const mounts = [
    { pos: [5, 5.8, 3],   rot: [0, 0, 0] },
    { pos: [-5, 5.8, 3],  rot: [0, 0, 0] },
    { pos: [5, 5.8, -3],  rot: [0, 0, 0] },
    { pos: [-5, 5.8, -3], rot: [0, 0, 0] },
    { pos: [0, 5.8, 4.5], rot: [0, 0, 0] },
    { pos: [0, 5.8, -4.5],rot: [0, 0, 0] },
  ];
  return (
    <group>
      {mounts.map((m, i) => (
        <CameraMount key={i} position={m.pos} rotation={m.rot} />
      ))}
    </group>
  );
}

// ─── Doors ────────────────────────────────────────────────────────────────────

function Doors({ scrollProgress }) {
  const leftRef = useRef();
  const rightRef = useRef();

  useFrame(() => {
    // Doors open between scroll 0.05‥0.25
    const openT = Math.max(0, Math.min(1, (scrollProgress - 0.05) / 0.2));
    const smooth = openT * openT * (3 - 2 * openT);
    if (leftRef.current)  leftRef.current.position.x = -1.5 - smooth * 1.8;
    if (rightRef.current) rightRef.current.position.x =  1.5 + smooth * 1.8;
  });

  const doorMat = (
    <meshStandardMaterial color="#18181b" metalness={0.8} roughness={0.2} transparent opacity={0.7} />
  );

  return (
    <group position={[0, 1.5, 5]}>
      <mesh ref={leftRef} position={[-1.5, 0, 0]}>
        <boxGeometry args={[1.4, 3, 0.08]} />
        {doorMat}
      </mesh>
      <mesh ref={rightRef} position={[1.5, 0, 0]}>
        <boxGeometry args={[1.4, 3, 0.08]} />
        {doorMat}
      </mesh>
      {/* Door frame */}
      <lineSegments>
        <edgesGeometry args={[new THREE.BoxGeometry(4.5, 3.2, 0.12)]} />
        <lineBasicMaterial color={EMERALD} transparent opacity={0.3} />
      </lineSegments>
    </group>
  );
}

// ─── Checkout Zone ────────────────────────────────────────────────────────────

function CheckoutZone() {
  const ringRef = useRef();
  useFrame(({ clock }) => {
    if (ringRef.current) {
      ringRef.current.rotation.z = clock.elapsedTime * 0.3;
      const pulse = 0.6 + Math.sin(clock.elapsedTime * 2) * 0.15;
      ringRef.current.material.opacity = pulse;
    }
  });

  return (
    <group position={[0, 0.02, -4.5]}>
      {/* Outer ring */}
      <mesh ref={ringRef} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[1.2, 1.6, 64]} />
        <meshStandardMaterial
          color={EMERALD}
          emissive={EMERALD}
          emissiveIntensity={0.8}
          transparent
          opacity={0.6}
          side={THREE.DoubleSide}
          depthWrite={false}
        />
      </mesh>
      {/* Inner glow disc */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.01, 0]}>
        <circleGeometry args={[1.2, 64]} />
        <meshStandardMaterial
          color={EMERALD}
          emissive={EMERALD}
          emissiveIntensity={0.3}
          transparent
          opacity={0.12}
          depthWrite={false}
        />
      </mesh>
      {/* Label — small floating text proxy (thin box) */}
      <mesh position={[0, 0.6, 0]} rotation={[-Math.PI / 4, 0, 0]}>
        <boxGeometry args={[1.4, 0.02, 0.35]} />
        <meshStandardMaterial
          color={EMERALD}
          emissive={EMERALD}
          emissiveIntensity={0.4}
          transparent
          opacity={0.15}
          depthWrite={false}
        />
      </mesh>
    </group>
  );
}

// ─── Customer Capsules ────────────────────────────────────────────────────────

// Pre-defined paths (simple loops)
const PATHS = [
  (t) => [Math.sin(t * Math.PI * 2) * 3, 0.9, Math.cos(t * Math.PI * 2) * 2],
  (t) => [Math.cos(t * Math.PI * 2 + 1) * 2.5, 0.9, Math.sin(t * Math.PI * 2 + 1) * 3],
  (t) => [Math.sin(t * Math.PI * 2 + 2.5) * 4, 0.9, -1 + Math.cos(t * Math.PI * 2 + 2.5) * 2.5],
  (t) => [-1 + Math.sin(t * Math.PI * 2 + 4) * 2, 0.9, Math.cos(t * Math.PI * 2 + 4) * 3.5],
  (t) => [1.5 + Math.cos(t * Math.PI * 2 + 5.5) * 3, 0.9, -2 + Math.sin(t * Math.PI * 2 + 5.5) * 2],
];

const CAPSULE_COLORS = [0x10b981, 0x06b6d4, 0x8b5cf6, 0xf59e0b, 0x6366f1];

function CustomerAgent({ index, scrollProgress, groupRef }) {
  const torusRef1 = useRef();
  const torusRef2 = useRef();
  const footRef = useRef();

  useFrame(({ clock }) => {
    if (torusRef1.current) {
      torusRef1.current.rotation.z = clock.elapsedTime * 2.2;
      torusRef1.current.position.y = Math.sin(clock.elapsedTime * 2 + index) * 0.15;
    }
    if (torusRef2.current) {
      torusRef2.current.rotation.z = -clock.elapsedTime * 1.5;
      torusRef2.current.position.y = Math.sin(clock.elapsedTime * 2 + index) * 0.15;
    }
    if (footRef.current) {
      const scale = 1 + Math.sin(clock.elapsedTime * 3.5 + index) * 0.12;
      footRef.current.scale.set(scale, scale, 1);
    }
  });

  const color = CAPSULE_COLORS[index];

  return (
    <group ref={groupRef}>
      {/* Ground telemetry footprint */}
      <mesh ref={footRef} rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.9, 0]}>
        <ringGeometry args={[0.28, 0.33, 32]} />
        <meshBasicMaterial color={color} transparent opacity={0.45} side={THREE.DoubleSide} depthWrite={false} />
      </mesh>
      {/* Inner target dot */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.895, 0]}>
        <circleGeometry args={[0.07, 16]} />
        <meshBasicMaterial color={color} transparent opacity={0.7} depthWrite={false} />
      </mesh>

      {/* Holographic transparent capsule body */}
      <mesh position={[0, 0, 0]}>
        <capsuleGeometry args={[0.2, 0.6, 8, 16]} />
        <meshStandardMaterial
          color={color}
          emissive={color}
          emissiveIntensity={0.25}
          transparent
          opacity={0.06}
          roughness={0.1}
          metalness={0.9}
        />
      </mesh>

      {/* Wireframe outer tracking shell */}
      <mesh position={[0, 0, 0]}>
        <capsuleGeometry args={[0.205, 0.605, 8, 16]} />
        <meshStandardMaterial
          color={color}
          wireframe
          transparent
          opacity={0.22}
        />
      </mesh>

      {/* Concentric Telemetry Scan Rings rotating in opposite directions */}
      <group ref={torusRef1} rotation={[Math.PI / 2, 0, 0]}>
        <mesh>
          <torusGeometry args={[0.22, 0.006, 8, 32]} />
          <meshBasicMaterial color={color} transparent opacity={0.65} />
        </mesh>
        {/* Dynamic target lock block */}
        <mesh position={[0, 0.28, 0]} rotation={[-Math.PI / 2, 0, 0]}>
          <boxGeometry args={[0.12, 0.008, 0.04]} />
          <meshBasicMaterial color={color} transparent opacity={0.6} />
        </mesh>
      </group>
      <group ref={torusRef2} rotation={[Math.PI / 2, 0, 0]}>
        <mesh>
          <torusGeometry args={[0.26, 0.004, 8, 32]} />
          <meshBasicMaterial color={color} transparent opacity={0.45} />
        </mesh>
      </group>

      {/* Scanning vector line going straight up to ceiling */}
      <mesh position={[0, 2.5, 0]}>
        <cylinderGeometry args={[0.004, 0.004, 5, 4]} />
        <meshBasicMaterial color={color} transparent opacity={0.12} />
      </mesh>
    </group>
  );
}

function Customers({ scrollProgress }) {
  const refs = useRef([]);

  useFrame(({ clock }) => {
    refs.current.forEach((group, i) => {
      if (!group) return;
      const pathT = (scrollProgress * 0.6 + clock.elapsedTime * 0.04 + i * 0.2) % 1;
      const [px, py, pz] = PATHS[i](pathT);
      group.position.set(px, py, pz);
      // Face direction of motion
      const nextT = (pathT + 0.01) % 1;
      const [nx, , nz] = PATHS[i](nextT);
      group.rotation.y = Math.atan2(nx - px, nz - pz);
    });
  });

  return (
    <group>
      {PATHS.map((_, i) => (
        <CustomerAgent
          key={i}
          index={i}
          scrollProgress={scrollProgress}
          groupRef={(el) => { refs.current[i] = el; }}
        />
      ))}
    </group>
  );
}

// ─── Floating Data Particles ──────────────────────────────────────────────────

const PARTICLE_COUNT = 600;

function DataParticles() {
  const pointsRef = useRef();

  const [positions, velocities] = useMemo(() => {
    const pos = new Float32Array(PARTICLE_COUNT * 3);
    const vel = new Float32Array(PARTICLE_COUNT);
    for (let i = 0; i < PARTICLE_COUNT; i++) {
      // Spawn near shelf positions
      const shelfX = (Math.random() > 0.5 ? 2 : -3) + (Math.random() - 0.5) * 2;
      const shelfZ = (Math.random() > 0.5 ? -1 : 2) + (Math.random() - 0.5) * 1.5;
      pos[i * 3]     = shelfX;
      pos[i * 3 + 1] = Math.random() * 6;
      pos[i * 3 + 2] = shelfZ;
      vel[i] = 0.005 + Math.random() * 0.015;
    }
    return [pos, vel];
  }, []);

  const colorsAttr = useMemo(() => {
    const cols = new Float32Array(PARTICLE_COUNT * 3);
    const em = new THREE.Color(0x10b981);
    const ind = new THREE.Color(0x6366f1);
    for (let i = 0; i < PARTICLE_COUNT; i++) {
      const c = Math.random() > 0.3 ? em : ind;
      cols[i * 3]     = c.r;
      cols[i * 3 + 1] = c.g;
      cols[i * 3 + 2] = c.b;
    }
    return cols;
  }, []);

  useFrame(() => {
    if (!pointsRef.current) return;
    const posArr = pointsRef.current.geometry.attributes.position.array;
    for (let i = 0; i < PARTICLE_COUNT; i++) {
      posArr[i * 3 + 1] += velocities[i];
      // Oscillate X/Z slightly
      posArr[i * 3]     += Math.sin(posArr[i * 3 + 1] * 2 + i) * 0.001;
      posArr[i * 3 + 2] += Math.cos(posArr[i * 3 + 1] * 2 + i) * 0.001;
      // Reset when above ceiling
      if (posArr[i * 3 + 1] > 7) {
        const shelfX = (Math.random() > 0.5 ? 2 : -3) + (Math.random() - 0.5) * 2;
        const shelfZ = (Math.random() > 0.5 ? -1 : 2) + (Math.random() - 0.5) * 1.5;
        posArr[i * 3]     = shelfX;
        posArr[i * 3 + 1] = 0;
        posArr[i * 3 + 2] = shelfZ;
      }
    }
    pointsRef.current.geometry.attributes.position.needsUpdate = true;
  });

  return (
    <points ref={pointsRef}>
      <bufferGeometry>
        <bufferAttribute
          attach="attributes-position"
          count={PARTICLE_COUNT}
          array={positions}
          itemSize={3}
        />
        <bufferAttribute
          attach="attributes-color"
          count={PARTICLE_COUNT}
          array={colorsAttr}
          itemSize={3}
        />
      </bufferGeometry>
      <pointsMaterial
        size={0.04}
        vertexColors
        transparent
        opacity={0.7}
        depthWrite={false}
        sizeAttenuation
        blending={THREE.AdditiveBlending}
      />
    </points>
  );
}

// ─── Lighting ─────────────────────────────────────────────────────────────────

function Lighting() {
  return (
    <>
      <ambientLight intensity={0.3} color="#ffffff" />
      <pointLight position={[5, 6, 3]} intensity={1.2} color={EMERALD} distance={20} decay={2} />
      <pointLight position={[-5, 6, -3]} intensity={0.8} color={INDIGO} distance={20} decay={2} />
      <directionalLight position={[0, 10, 5]} intensity={0.6} color="#e4e4e7" />
    </>
  );
}

// ─── Main Scene Export ────────────────────────────────────────────────────────

export default function StoreScene({ scrollProgress = 0 }) {
  return (
    <>
      <fog attach="fog" args={[DARK_BG, 12, 35]} />

      <CameraRig scrollProgress={scrollProgress} />
      <Lighting />
      <Ground />
      <StoreShell />
      <Shelves />
      <CameraMounts />
      <CeilingTruss />
      <Doors scrollProgress={scrollProgress} />
      <CheckoutZone />
      <Customers scrollProgress={scrollProgress} />
      <DataParticles />
    </>
  );
}
