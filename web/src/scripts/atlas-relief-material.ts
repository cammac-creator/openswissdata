import { BufferAttribute, Mesh, MeshStandardMaterial, Vector3 } from 'three';

/** Fines strates de matière attachées à l'objet, stables pendant sa rotation. */
export function sculptedMaterial(mesh: Mesh): void {
  const positions = mesh.geometry.getAttribute('position');
  const heights = new Float32Array(positions.count);
  const point = new Vector3();
  for (let i = 0; i < positions.count; i++) {
    point.fromBufferAttribute(positions, i).applyMatrix4(mesh.matrixWorld);
    heights[i] = point.y;
  }
  mesh.geometry.setAttribute('sculptureHeight', new BufferAttribute(heights, 1));
  const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
  for (const material of materials) {
    if (!(material instanceof MeshStandardMaterial)) continue;
    material.dithering = true;
    material.onBeforeCompile = shader => {
      shader.vertexShader = `attribute float sculptureHeight;\nvarying float vSculptureHeight;\n${shader.vertexShader}`;
      shader.vertexShader = shader.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\nvSculptureHeight = sculptureHeight;');
      shader.fragmentShader = `varying float vSculptureHeight;\n${shader.fragmentShader}`;
      shader.fragmentShader = shader.fragmentShader.replace('#include <color_fragment>', `
        #include <color_fragment>
        float layerPhase = vSculptureHeight / 0.058;
        float layerWidth = max(fwidth(layerPhase), 0.025);
        float layerVisibility = 1.0 - smoothstep(0.35, 0.85, layerWidth);
        float layerLine = 1.0 - smoothstep(0.10, 0.10 + layerWidth, abs(fract(layerPhase) - 0.18));
        diffuseColor.rgb *= 1.0 - 0.16 * layerLine * layerVisibility;
      `);
      // Perturbation par gradient de surface, comme le bump mapping de Three.js (licence MIT fournie).
      shader.fragmentShader = shader.fragmentShader.replace('#include <normal_fragment_maps>', `
        #include <normal_fragment_maps>
        float layerSlope = -0.0022 * 108.33078 * sin(vSculptureHeight * 108.33078) * layerVisibility;
        vec3 surfaceX = dFdx(-vViewPosition);
        vec3 surfaceY = dFdy(-vViewPosition);
        vec3 axisX = cross(surfaceY, normal);
        vec3 axisY = cross(normal, surfaceX);
        float determinant = dot(surfaceX, axisX) * faceDirection;
        vec3 layerGradient = sign(determinant) * layerSlope * (dFdx(vSculptureHeight) * axisX + dFdy(vSculptureHeight) * axisY);
        normal = normalize(max(abs(determinant), 0.00000001) * normal - layerGradient);
      `);
    };
    material.customProgramCacheKey = () => 'atlas-strates-v1';
  }
}
