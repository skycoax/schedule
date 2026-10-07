// 3D-телефон: корпус из тёмного титана, стекло, экран с видео приложения, островок, кнопки и камеры сзади.
// Размеры — в сантиметрах (≈ современный 6.1″ телефон): 7.06 × 14.91 × 0.83.
import React, { useMemo } from 'react';
import * as THREE from 'three';

// экран — ровно в пропорции записи 1179×2556 (393×852 pt); 1 pt = SCREEN.w / 393
const SW = 6.72;
export const SCREEN = { w: SW, h: SW * 852 / 393, r: 0.95 };
export const PT = SW / 393;
export const PHONE = { w: SW + 0.34, h: SCREEN.h + 0.34, d: 0.83, r: 1.12, bezel: 0.17 };

function roundedRect(w: number, h: number, r: number) {
  const s = new THREE.Shape();
  const x = -w / 2, y = -h / 2;
  s.moveTo(x + r, y);
  s.lineTo(x + w - r, y);
  s.absarc(x + w - r, y + r, r, -Math.PI / 2, 0, false);
  s.lineTo(x + w, y + h - r);
  s.absarc(x + w - r, y + h - r, r, 0, Math.PI / 2, false);
  s.lineTo(x + r, y + h);
  s.absarc(x + r, y + h - r, r, Math.PI / 2, Math.PI, false);
  s.lineTo(x, y + r);
  s.absarc(x + r, y + r, r, Math.PI, Math.PI * 1.5, false);
  return s;
}

// плоская фигура со своими UV 0..1 по габаритам
function flatGeometry(w: number, h: number, r: number, seg = 24) {
  const g = new THREE.ShapeGeometry(roundedRect(w, h, r), seg);
  const pos = g.attributes.position as THREE.BufferAttribute;
  const uv = new Float32Array(pos.count * 2);
  for (let i = 0; i < pos.count; i++) {
    uv[i * 2] = pos.getX(i) / w + 0.5;
    uv[i * 2 + 1] = pos.getY(i) / h + 0.5;
  }
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  return g;
}

export const Phone: React.FC<{
  screen?: THREE.Texture | null;
  screenOpacity?: number;
  glare?: number;          // 0..1 — положение блика по стеклу
  children?: React.ReactNode;
}> = ({ screen, screenOpacity = 1, glare = 0.3, children }) => {
  const { w, h, d, r } = PHONE;

  const body = useMemo(() => {
    const bevel = 0.16;
    const g = new THREE.ExtrudeGeometry(roundedRect(w - bevel * 2, h - bevel * 2, r - bevel), {
      depth: d - bevel * 2, bevelEnabled: true, bevelThickness: bevel, bevelSize: bevel, bevelSegments: 10, curveSegments: 48,
    });
    g.translate(0, 0, -(d - bevel * 2) / 2);
    g.computeVertexNormals();
    return g;
  }, [w, h, d, r]);

  const glass = useMemo(() => flatGeometry(w - 0.06, h - 0.06, r - 0.03, 48), [w, h, r]);
  const screenGeo = useMemo(() => flatGeometry(SCREEN.w, SCREEN.h, SCREEN.r, 48), []);
  const island = useMemo(() => flatGeometry(126 * PT, 37 * PT, 18.5 * PT, 16), []);
  const back = useMemo(() => flatGeometry(w - 0.06, h - 0.06, r - 0.03, 48), [w, h, r]);
  const plateau = useMemo(() => flatGeometry(3.05, 3.2, 0.72, 16), []);

  const frameMat = useMemo(() => new THREE.MeshPhysicalMaterial({
    color: new THREE.Color('#3b3b3f'), metalness: 1, roughness: 0.28, clearcoat: 0.4, clearcoatRoughness: 0.2,
  }), []);
  const blackMat = useMemo(() => new THREE.MeshPhysicalMaterial({
    color: new THREE.Color('#020203'), metalness: 0, roughness: 0.05, clearcoat: 1, clearcoatRoughness: 0.03, reflectivity: 0.6,
  }), []);
  const backMat = useMemo(() => new THREE.MeshPhysicalMaterial({
    color: new THREE.Color('#2a2a2e'), metalness: 0.2, roughness: 0.55, clearcoat: 0.6, clearcoatRoughness: 0.5,
  }), []);
  const lensMat = useMemo(() => new THREE.MeshPhysicalMaterial({ color: '#050507', metalness: 0.4, roughness: 0.08, clearcoat: 1 }), []);
  const ringMat = useMemo(() => new THREE.MeshPhysicalMaterial({ color: '#4a4a50', metalness: 1, roughness: 0.22 }), []);

  // блик: полоса света, скользящая по стеклу
  const glareMat = useMemo(() => {
    const c = document.createElement('canvas'); c.width = 512; c.height = 512;
    const x = c.getContext('2d')!;
    const gr = x.createLinearGradient(0, 0, 512, 512);
    gr.addColorStop(0, 'rgba(255,255,255,0)');
    gr.addColorStop(0.44, 'rgba(255,255,255,0)');
    gr.addColorStop(0.5, 'rgba(255,255,255,0.10)');
    gr.addColorStop(0.56, 'rgba(255,255,255,0)');
    gr.addColorStop(1, 'rgba(255,255,255,0)');
    x.fillStyle = gr; x.fillRect(0, 0, 512, 512);
    const t = new THREE.CanvasTexture(c);
    t.wrapS = THREE.ClampToEdgeWrapping; t.wrapT = THREE.ClampToEdgeWrapping;
    return new THREE.MeshBasicMaterial({ map: t, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false });
  }, []);
  glareMat.map!.offset.set(0.9 - glare * 1.8, 0.9 - glare * 1.8);
  glareMat.map!.needsUpdate = false;

  const screenMat = useMemo(() => new THREE.MeshBasicMaterial({ toneMapped: false, transparent: true }), []);
  screenMat.map = screen || null;
  screenMat.color.set(screen ? '#ffffff' : '#000000');
  screenMat.opacity = screenOpacity;
  screenMat.needsUpdate = true;

  const z = d / 2;
  return (
    <group>
      <mesh geometry={body} material={frameMat} />
      {/* лицевое стекло (чёрное) */}
      <mesh geometry={glass} material={blackMat} position={[0, 0, z + 0.001]} />
      {/* экран */}
      <mesh geometry={screenGeo} material={screenMat} position={[0, 0, z + 0.004]} />
      {/* островок */}
      <mesh geometry={island} position={[0, SCREEN.h / 2 - (11 + 18.5) * PT, z + 0.006]}>
        <meshBasicMaterial color="#000000" toneMapped={false} />
      </mesh>
      {children}
      {/* блик по стеклу */}
      <mesh geometry={glass} material={glareMat} position={[0, 0, z + 0.008]} />
      {/* задняя крышка и камеры */}
      <group rotation={[0, Math.PI, 0]}>
        <mesh geometry={back} material={backMat} position={[0, 0, z + 0.001]} />
        <mesh geometry={plateau} material={backMat} position={[w / 2 - 1.75, h / 2 - 1.8, z + 0.05]} />
        {[[-0.62, 0.68], [-0.62, -0.68], [0.68, 0]].map(([dx, dy], i) => (
          <group key={i} position={[w / 2 - 1.75 + dx, h / 2 - 1.8 + dy, z + 0.12]} rotation={[Math.PI / 2, 0, 0]}>
            <mesh material={ringMat}><cylinderGeometry args={[0.55, 0.57, 0.16, 48]} /></mesh>
            <mesh material={lensMat} position={[0, 0.085, 0]}><cylinderGeometry args={[0.4, 0.4, 0.02, 48]} /></mesh>
          </group>
        ))}
      </group>
      {/* кнопки */}
      <mesh material={frameMat} position={[w / 2 + 0.03, 2.3, 0]}><boxGeometry args={[0.08, 2.0, 0.3]} /></mesh>
      <mesh material={frameMat} position={[-w / 2 - 0.03, 3.6, 0]}><boxGeometry args={[0.08, 0.7, 0.3]} /></mesh>
      <mesh material={frameMat} position={[-w / 2 - 0.03, 2.2, 0]}><boxGeometry args={[0.08, 1.3, 0.3]} /></mesh>
      <mesh material={frameMat} position={[-w / 2 - 0.03, 0.6, 0]}><boxGeometry args={[0.08, 1.3, 0.3]} /></mesh>
    </group>
  );
};
