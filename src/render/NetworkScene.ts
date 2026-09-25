import { LocalizedError, msg, type LocalizedText } from '../i18n/core';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { LineSegments2 } from 'three/addons/lines/LineSegments2.js';
import { LineSegmentsGeometry } from 'three/addons/lines/LineSegmentsGeometry.js';
import { LineMaterial } from 'three/addons/lines/LineMaterial.js';
import { nearestNode } from './picking';
import { connectionColor, groupColor, nodeColor, SHARED_COLOR, usesGroupColors, usesPodColors } from './colors';
import { DEPTH_LINK_THRESHOLD } from '../model/types';
import type { BenchmarkResult, Filter, FrameStats, LayoutMode, LayoutResult, PathSet, TopologyBuffers, ViewConfig } from '../model/types';

const pointVertex = [
  'attribute vec3 nodeColor;', 'uniform float pointSize;', 'varying vec3 vColor;',
  'void main(){ vColor=nodeColor; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0); gl_PointSize=pointSize; }',
].join('\n');
const pointFragment = [
  'varying vec3 vColor;',
  'void main(){ if(length(gl_PointCoord-vec2(0.5))>0.5) discard; gl_FragColor=vec4(vColor,1.0);',
  '#include <colorspace_fragment>', '}',
].join('\n');
// Camera-facing, outlined circles keep devices legible at every viewing angle.
// One instanced quad per switch preserves the large-network draw-call budget.
const switchVertex = `
uniform vec2 viewport;
varying vec2 vUv;
varying vec3 vColor;
varying float vSize;
void main() {
  vec4 center = modelViewMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0);
  float distanceScale = isOrthographic ? 1.0 : max(0.1, -center.z);
  vSize = clamp(length(instanceMatrix[0].xyz) * projectionMatrix[1][1] * viewport.y * 0.5 / distanceScale, 2.5, 18.0);
  gl_Position = projectionMatrix * center;
  gl_Position.xy += position.xy * vSize * 2.0 / viewport * gl_Position.w;
  vUv = uv; vColor = instanceColor;
}`;
const switchFragment = `
varying vec2 vUv;
varying vec3 vColor;
varying float vSize;
void main() {
  float radius = length(vUv * 2.0 - 1.0);
  float aa = fwidth(radius);
  if (radius > 1.0) discard;
  float border = 1.0 - smoothstep(max(0.25, 1.0 - 2.2 / vSize) - aa, max(0.25, 1.0 - 2.2 / vSize), radius);
  vec3 color = mix(vec3(0.035, 0.060, 0.082), vColor, border);
  gl_FragColor = vec4(color, 1.0 - smoothstep(1.0 - aa, 1.0, radius));
  #include <colorspace_fragment>
}`;
const lineVertex = [
  'attribute vec2 ends;', 'uniform sampler2D nodePositions;', 'uniform sampler2D linkColors;',
  'uniform float textureSize;', 'uniform bool elbow;', 'varying vec3 vColor;', 'flat varying vec3 vPlaneColor;',
  'vec2 uvFor(float id){ return (vec2(mod(id,textureSize),floor(id/textureSize))+0.5)/textureSize; }',
  'void main(){',
  'vec2 uvA=uvFor(ends.x); vec2 uvB=uvFor(ends.y);',
  'vec3 a=texture2D(nodePositions,uvA).xyz; vec3 b=texture2D(nodePositions,uvB).xyz;',
  'float t=position.x; vec3 p=mix(a,b,t);',
  'if(elbow){ float mid=(a.y+b.y)*0.5; vec3 c=vec3(a.x,mid,a.z); vec3 d=vec3(b.x,mid,b.z);',
  'if(t<0.33334) p=mix(a,c,t*3.0); else if(t<0.66667) p=mix(c,d,(t-0.3333333)*3.0); else p=mix(d,b,(t-0.6666667)*3.0); }',
  'vColor=mix(texture2D(linkColors,uvA).rgb,texture2D(linkColors,uvB).rgb,t);',
  'vPlaneColor=texture2D(linkColors,uvB).rgb;',
  'gl_Position=projectionMatrix*modelViewMatrix*vec4(p,1.0); }',
].join('\n');
const lineFragment = [
  'uniform float opacity;', 'uniform bool planeColors;', 'varying vec3 vColor;', 'flat varying vec3 vPlaneColor;',
  'void main(){',
  'vec3 color=planeColors?vPlaneColor:vColor;',
  '#ifdef DEPTH_LINES',
  'gl_FragColor=vec4(mix(vec3(0.947,0.956,0.965),color,opacity),1.0);',
  '#else',
  'gl_FragColor=vec4(color,opacity);',
  '#endif',
  '#include <colorspace_fragment>', '}',
].join('\n');
const straightVertex = [
  'attribute vec3 linkColor;', 'varying vec3 vColor;', 'flat varying vec3 vPlaneColor;',
  // Edges are ordered lower tier -> upper tier. WebGL2 flat interpolation takes
  // the final vertex, keeping one plane or Pod color along the entire link.
  'void main(){ vColor=linkColor; vPlaneColor=linkColor; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0); }',
].join('\n');

export class NetworkScene {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera: THREE.PerspectiveCamera | THREE.OrthographicCamera;
  private controls: OrbitControls;
  private resizeObserver: ResizeObserver;
  private raf = 0;
  private disposed = false;
  private dirty = true;
  private width = 1; private height = 1;
  private graph: TopologyBuffers | null = null;
  private layout: LayoutResult | null = null;
  private layoutBounds = new THREE.Box3();
  private mode: LayoutMode = 'layered';
  private fitAll2D = false;
  private view: ViewConfig = { layout: 'layered', lines: 'straight', opacity: 0.18, colorBy: 'plane', showEndpoints: true };
  private filter: Filter = { tier: null, plane: null, pod: null };
  private selected: number | null = null;
  private path: number[] = [];
  private allPaths: PathSet | null = null;
  private resources: { dispose: () => void }[] = [];
  private highlights: THREE.Object3D[] = [];
  private highlightResources: { dispose: () => void }[] = [];
  private positionAttribute: THREE.BufferAttribute | null = null;
  private colors: Float32Array | null = null;
  private linkColors: THREE.BufferAttribute | null = null;
  private positionTexture: THREE.DataTexture | null = null;
  private linkColorTexture: THREE.DataTexture | null = null;
  private endpoints: THREE.Points | null = null;
  private switches: THREE.InstancedMesh | null = null;
  private links: THREE.LineSegments<THREE.BufferGeometry, THREE.ShaderMaterial> | null = null;
  private guides: THREE.LineSegments<THREE.BufferGeometry, THREE.LineBasicMaterial> | null = null;
  private sheets: THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial> | null = null;
  private labels: { element: HTMLSpanElement; position: THREE.Vector3; plane: number | null; pod: number | null }[] = [];
  private straightMaterial: THREE.ShaderMaterial | null = null;
  private elbowMaterial: THREE.ShaderMaterial | null = null;
  private visibleEdges: Uint32Array = new Uint32Array(0);
  private visible = new Uint8Array(0);
  private visibleNodeCount = 0; private visibleEdgeCount = 0;
  private visibleSwitches: number[] = [];
  private statsStart = performance.now(); private renderedFrames = 0;
  private onPick: (id: number | null) => void;
  private onStats: (stats: FrameStats) => void;
  private onError: (message: LocalizedText) => void;
  private pointerDown: [number, number] = [0, 0];
  private benchmarkState: {
    start: number; previous: number; duration: number; samples: number[];
    resolve: (result: BenchmarkResult) => void; reject: (error: Error) => void; oldRotate: boolean;
  } | null = null;

  constructor(private host: HTMLDivElement, onPick: (id: number | null) => void,
    onStats: (stats: FrameStats) => void, onError: (message: LocalizedText) => void) {
    this.onPick = onPick; this.onStats = onStats; this.onError = onError;
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(1);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.setClearColor(0x000000, 0);
    this.renderer.domElement.setAttribute('role', 'img');
    this.host.appendChild(this.renderer.domElement);
    this.camera = new THREE.PerspectiveCamera(42, 1, 0.1, 100000);
    this.controls = this.makeControls();
    this.renderer.domElement.addEventListener('pointerdown', this.handlePointerDown);
    this.renderer.domElement.addEventListener('pointerup', this.handlePointerUp);
    this.renderer.domElement.addEventListener('webglcontextlost', this.handleContextLost);
    this.resizeObserver = new ResizeObserver(this.resize);
    this.resizeObserver.observe(host);
    this.resize();
    this.animate();
  }
  private makeControls() {
    const controls = new OrbitControls(this.camera, this.renderer.domElement);
    controls.enableDamping = true; controls.dampingFactor = 0.09;
    controls.autoRotateSpeed = 1.2;
    controls.minDistance = 2; controls.maxDistance = 20000;
    controls.maxPolarAngle = Math.PI * 0.93;
    return controls;
  }
  private handleContextLost = (event: Event) => {
    event.preventDefault();
    this.cancelBenchmark(msg("GPU context lost"));
    this.onError(msg("GPU context lost. Reload to restore the canvas; your applied configuration will be restored."));
  };
  private resize = () => {
    const oldWidth = this.width, oldHeight = this.height;
    this.width = Math.max(1, this.host.clientWidth);
    this.height = Math.max(1, this.host.clientHeight);
    this.renderer.setSize(this.width, this.height, false);
    if (this.switches) (this.switches.material as THREE.ShaderMaterial).uniforms.viewport.value.set(this.width, this.height);
    if (this.camera instanceof THREE.PerspectiveCamera) this.camera.aspect = this.width / this.height;
    else this.updateOrthographicBounds();
    this.camera.updateProjectionMatrix(); this.dirty = true;
    if (this.graph && this.width > 1 && this.height > 1 &&
        (oldWidth !== this.width || oldHeight !== this.height)) {
      this.cancelBenchmark(msg("Canvas size changed"));
      this.reset();
    }
  };
  private updateOrthographicBounds() {
    if (!(this.camera instanceof THREE.OrthographicCamera)) return;
    const aspect = this.width / this.height;
    const extent = this.layoutBounds.getSize(new THREE.Vector3());
    if (this.mode === 'planes') {
      this.camera.updateMatrixWorld();
      const projected = new THREE.Box3(), corner = new THREE.Vector3();
      for (const x of [this.layoutBounds.min.x, this.layoutBounds.max.x])
        for (const y of [this.layoutBounds.min.y, this.layoutBounds.max.y])
          for (const z of [this.layoutBounds.min.z, this.layoutBounds.max.z])
            projected.expandByPoint(corner.set(x, y, z).applyMatrix4(this.camera.matrixWorldInverse));
      const size = Math.max(1, projected.max.y, -projected.min.y, projected.max.x / aspect, -projected.min.x / aspect) * 1.22;
      this.camera.left = -size * aspect; this.camera.right = size * aspect;
      this.camera.top = size; this.camera.bottom = -size;
      return;
    }
    // Long rows may extend beyond the viewport. Preserve readable tier spacing
    // by default; fitting the entire wide fabric is an explicit user action.
    const halfWidth = this.mode === 'flat' && !this.fitAll2D ? 0 : extent.x / (2 * aspect);
    const size = Math.max(1, extent.y / 2, halfWidth) * 1.12 + (this.layout?.span ?? 180) * 0.025;
    this.camera.left = -size * aspect; this.camera.right = size * aspect;
    this.camera.top = size; this.camera.bottom = -size;
  }
  private remember<T extends { dispose: () => void }>(resource: T): T { this.resources.push(resource); return resource; }
  clear() {
    this.cancelBenchmark(msg("Network changed"));
    this.clearGuides();
    this.clearHighlights(); this.scene.clear();
    for (const resource of this.resources) resource.dispose();
    this.resources = [];
    this.graph = null; this.layout = null; this.layoutBounds.makeEmpty(); this.links = null; this.endpoints = null;
    this.switches = null; this.straightMaterial = null; this.elbowMaterial = null;
    this.visibleEdges = new Uint32Array(0);
    this.positionTexture = null; this.linkColorTexture = null; this.positionAttribute = null; this.colors = null; this.linkColors = null;
    this.visibleNodeCount = 0; this.visibleEdgeCount = 0; this.visibleSwitches = [];
    this.dirty = true;
    this.reportStats(0);
  }
  setGraph(graph: TopologyBuffers, layout: LayoutResult, view: ViewConfig) {
    this.clear(); this.graph = graph; this.layout = layout; this.view = view;
    this.selected = null; this.path = []; this.allPaths = null;
    const size = Math.ceil(Math.sqrt(graph.nodeCount));
    const positionData = new Float32Array(size * size * 4);
    this.positionTexture = this.remember(new THREE.DataTexture(positionData, size, size, THREE.RGBAFormat, THREE.FloatType));
    this.linkColorTexture = this.remember(new THREE.DataTexture(new Uint8Array(size * size * 4), size, size));
    this.colors = new Float32Array(graph.nodeCount * 3);
    this.linkColors = new THREE.BufferAttribute(new Float32Array(graph.nodeCount * 3), 3);
    this.positionAttribute = new THREE.BufferAttribute(layout.positions, 3);
    const endpointGeometry = this.remember(new THREE.BufferGeometry());
    endpointGeometry.setAttribute('position', this.positionAttribute);
    endpointGeometry.setAttribute('nodeColor', new THREE.BufferAttribute(this.colors, 3));
    const pointMaterial = this.remember(new THREE.ShaderMaterial({
      vertexShader: pointVertex, fragmentShader: pointFragment,
      uniforms: { pointSize: { value: graph.nodeCount > 10000 ? 2.2 : 4.0 } }, depthWrite: true,
    }));
    this.endpoints = new THREE.Points(endpointGeometry, pointMaterial);
    this.endpoints.frustumCulled = false; this.endpoints.renderOrder = 2;
    // Link surfaces use depth rejection at large scales. Start a fresh depth pass for
    // nodes, so every endpoint/switch remains visible and pickable over dense wiring.
    this.endpoints.onBeforeRender = renderer => renderer.clearDepth();
    this.scene.add(this.endpoints);
    const switchGeometry = this.remember(new THREE.PlaneGeometry(1, 1));
    const switchMaterial = this.remember(new THREE.ShaderMaterial({ vertexShader: switchVertex, fragmentShader: switchFragment,
      uniforms: { viewport: { value: new THREE.Vector2(this.width, this.height) } },
      transparent: true, depthWrite: false, depthTest: false }));
    this.switches = new THREE.InstancedMesh(switchGeometry, switchMaterial, graph.nodeCount - graph.endpointCount);
    this.remember(this.switches);
    this.switches.frustumCulled = false; this.switches.renderOrder = 3;
    this.scene.add(this.switches);

    const lineGeometry = this.remember(new THREE.BufferGeometry());
    const depthLines = graph.edgeCount > DEPTH_LINK_THRESHOLD;
    const lineSettings = {
      defines: depthLines ? { DEPTH_LINES: 1 } : {},
      transparent: !depthLines, depthWrite: depthLines, depthTest: depthLines,
    };
    this.elbowMaterial = this.remember(new THREE.ShaderMaterial({
      vertexShader: lineVertex, fragmentShader: lineFragment,
      uniforms: {
        nodePositions: { value: this.positionTexture }, linkColors: { value: this.linkColorTexture },
        textureSize: { value: size }, opacity: { value: view.opacity }, elbow: { value: true },
        planeColors: { value: view.colorBy === 'plane' },
      },
      ...lineSettings,
    }));
    this.straightMaterial = this.remember(new THREE.ShaderMaterial({
      vertexShader: straightVertex, fragmentShader: lineFragment,
      uniforms: { opacity: { value: view.opacity }, planeColors: { value: view.colorBy === 'plane' } },
      ...lineSettings,
    }));
    this.links = new THREE.LineSegments(lineGeometry, this.straightMaterial);
    this.links.frustumCulled = false; this.links.renderOrder = 0;
    this.scene.add(this.links);

    this.setColors(view.colorBy);
    this.setLayout(layout, view.layout);
    this.setLineMode(view.lines);
    this.setFilter(this.filter);
  }
  setLayout(layout: LayoutResult, mode: LayoutMode) {
    if (!this.graph || !this.positionAttribute || !this.positionTexture) return;
    this.cancelBenchmark(msg("Layout changed"));
    this.layout = layout; this.mode = mode;
    this.positionAttribute.array = layout.positions; this.positionAttribute.needsUpdate = true;
    this.updateLayoutBounds();
    const data = this.positionTexture.image.data as Float32Array;
    for (let n = 0; n < this.graph.nodeCount; n++) {
      data[n * 4] = layout.positions[n * 3]; data[n * 4 + 1] = layout.positions[n * 3 + 1];
      data[n * 4 + 2] = layout.positions[n * 3 + 2]; data[n * 4 + 3] = 1;
    }
    this.positionTexture.needsUpdate = true;
    this.clearGuides();
    for (const label of layout.labels) {
      const element = document.createElement('span'); element.className = 'topology-label'; element.textContent = label.text;
      element.style.color = label.pod !== null && usesPodColors(this.graph) ? groupColor(label.pod)
        : label.plane === null ? SHARED_COLOR : groupColor(label.plane);
      if (label.pod === null && label.plane === null) element.classList.add('tier-label');
      this.host.appendChild(element);
      this.labels.push({ element, position: new THREE.Vector3(...label.position), plane: label.plane, pod: label.pod });
    }
    if (layout.guides.length) {
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', new THREE.BufferAttribute(layout.guides, 3));
      const colors = new Float32Array(layout.guideGroups.length * 3), color = new THREE.Color();
      layout.guideGroups.forEach((group, i) => color.set(group < 0 ? SHARED_COLOR : groupColor(group))
        .lerp(new THREE.Color('#263947'), 0.55).toArray(colors, i * 3));
      geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
      this.guides = new THREE.LineSegments(geometry, new THREE.LineBasicMaterial({ vertexColors: true,
        transparent: true, opacity: 0.38, depthWrite: false, depthTest: false }));
      this.guides.renderOrder = 1; this.guides.frustumCulled = false;
      this.guides.visible = Object.values(this.filter).every(value => value === null);
      this.scene.add(this.guides);
      const vertices: number[] = [], tints: number[] = [];
      for (let frame = 0; frame < layout.guides.length; frame += 24) {
        color.set(groupColor(Math.max(0, layout.guideGroups[frame / 3])));
        for (const corner of [0, 1, 2, 0, 2, 3]) {
          vertices.push(...layout.guides.subarray(frame + corner * 6, frame + corner * 6 + 3));
          tints.push(color.r, color.g, color.b);
        }
      }
      const sheetGeometry = new THREE.BufferGeometry();
      sheetGeometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
      sheetGeometry.setAttribute('color', new THREE.Float32BufferAttribute(tints, 3));
      this.sheets = new THREE.Mesh(sheetGeometry, new THREE.MeshBasicMaterial({ vertexColors: true,
        side: THREE.DoubleSide, forceSinglePass: true, transparent: true,
        opacity: Math.min(0.018, 0.18 / (layout.guides.length / 24)), depthWrite: false, depthTest: false }));
      this.sheets.renderOrder = -1; this.sheets.frustumCulled = false; this.sheets.visible = this.guides.visible;
      this.scene.add(this.sheets);
    }
    this.updateSwitches(); this.updateHighlights(); this.reset();
  }
  private clearGuides() {
    for (const label of this.labels) label.element.remove();
    this.labels = [];
    if (this.sheets) {
      this.scene.remove(this.sheets); this.sheets.geometry.dispose(); this.sheets.material.dispose(); this.sheets = null;
    }
    if (!this.guides) return;
    this.scene.remove(this.guides); this.guides.geometry.dispose(); this.guides.material.dispose(); this.guides = null;
  }
  private updateLabels() {
    const point = new THREE.Vector3(), occupied: { x: number; y: number; width: number }[] = [];
    for (const label of this.labels) {
      point.copy(label.position).project(this.camera);
      const x = (point.x + 1) * this.width / 2, y = (1 - point.y) * this.height / 2;
      const width = label.element.textContent!.length * 8 + 18;
      const show = point.z >= -1 && point.z <= 1 && x > width / 2 + 12 && x < this.width - width / 2 - 12 && y > 55 && y < this.height - 42 &&
        this.filter.tier === null && (this.filter.plane === null || label.plane === this.filter.plane) &&
        (this.filter.pod === null || label.pod === this.filter.pod) &&
        !occupied.some(r => Math.abs(r.x - x) < (r.width + width) / 2 + 8 && Math.abs(r.y - y) < 30);
      label.element.style.display = show ? '' : 'none';
      if (show) {
        occupied.push({ x, y, width });
        label.element.style.transform = `translate(${x}px, ${y}px) translate(-50%, -100%)`;
      }
    }
  }
  private updateLayoutBounds() {
    if (!this.layout || !this.graph) return;
    this.layoutBounds.makeEmpty();
    const point = new THREE.Vector3();
    for (let n = this.view.showEndpoints ? 0 : this.graph.endpointCount; n < this.graph.nodeCount; n++)
      this.layoutBounds.expandByPoint(point.fromArray(this.layout.positions, n * 3));
    if (this.mode === 'planes') for (const label of this.layout.labels)
      this.layoutBounds.expandByPoint(point.fromArray(label.position));
  }
  setView(view: ViewConfig) {
    const old = this.view; this.view = view;
    if (old.colorBy !== view.colorBy) this.setColors(view.colorBy);
    if (old.lines !== view.lines) this.setLineMode(view.lines);
    if (old.showEndpoints !== view.showEndpoints) {
      this.setFilter(this.filter); this.updateLayoutBounds(); this.reset();
    }
    this.updateOpacity(); this.dirty = true;
  }
  private setLineMode(mode: ViewConfig['lines']) {
    if (!this.links || !this.positionAttribute || !this.linkColors || !this.straightMaterial || !this.elbowMaterial) return;
    this.cancelBenchmark(msg("Link style changed"));
    const oldGeometry = this.links.geometry;
    oldGeometry.dispose();
    this.resources = this.resources.filter(resource => resource !== oldGeometry);
    if (mode === 'straight') {
      // Indexed lines transform shared node coordinates instead of issuing millions of tiny instances.
      const geometry = this.remember(new THREE.BufferGeometry());
      geometry.setAttribute('position', this.positionAttribute);
      geometry.setAttribute('linkColor', this.linkColors);
      geometry.setIndex(new THREE.BufferAttribute(this.visibleEdges, 1));
      geometry.setDrawRange(0, this.visibleEdges.length);
      this.links.geometry = geometry; this.links.material = this.straightMaterial;
    } else {
      // Elbows expand in the vertex shader; each physical link still needs only two node IDs.
      const geometry = this.remember(new THREE.InstancedBufferGeometry());
      const ticks = [0, 1 / 3, 1 / 3, 2 / 3, 2 / 3, 1];
      const values = new Float32Array(ticks.length * 3);
      ticks.forEach((t, i) => { values[i * 3] = t; });
      geometry.setAttribute('position', new THREE.BufferAttribute(values, 3));
      // Uint32 attributes bind with vertexAttribIPointer, whereas the shader accepts vec2.
      geometry.setAttribute('ends', new THREE.InstancedBufferAttribute(Float32Array.from(this.visibleEdges), 2));
      geometry.instanceCount = this.visibleEdges.length / 2;
      geometry.setDrawRange(0, ticks.length);
      this.links.geometry = geometry; this.links.material = this.elbowMaterial;
    }
    this.updateHighlights(); this.updateOpacity(); this.dirty = true;
  }
  private setColors(colorBy: ViewConfig['colorBy']) {
    if (!this.graph || !this.colors || !this.linkColorTexture || !this.linkColors) return;
    for (const material of [this.straightMaterial, this.elbowMaterial]) {
      if (material) material.uniforms.planeColors.value = usesGroupColors(this.graph, colorBy);
    }
    const data = this.linkColorTexture.image.data as Uint8Array;
    const color = new THREE.Color();
    for (let n = 0; n < this.graph.nodeCount; n++) {
      color.set(nodeColor(this.graph, n, colorBy));
      color.toArray(this.colors, n * 3);
      color.set(connectionColor(this.graph, n, colorBy));
      this.linkColors.setXYZ(n, color.r, color.g, color.b);
      data[n * 4] = Math.round(color.r * 255); data[n * 4 + 1] = Math.round(color.g * 255);
      data[n * 4 + 2] = Math.round(color.b * 255); data[n * 4 + 3] = 255;
    }
    this.linkColorTexture.needsUpdate = true;
    this.linkColors.needsUpdate = true;
    if (this.endpoints) this.endpoints.geometry.attributes.nodeColor.needsUpdate = true;
    this.updateSwitches(); this.dirty = true;
  }
  setFilter(filter: Filter) {
    this.filter = filter;
    if (!this.graph || !this.endpoints || !this.links) return;
    this.cancelBenchmark(msg("Filters changed"));
    const g = this.graph;
    if (this.guides) this.guides.visible = Object.values(filter).every(value => value === null);
    if (this.sheets) this.sheets.visible = Object.values(filter).every(value => value === null);
    this.visible = new Uint8Array(g.nodeCount);
    const endpoints: number[] = [], nodes: number[] = [];
    this.visibleSwitches = [];
    for (let n = 0; n < g.nodeCount; n++) {
      const visible = (this.view.showEndpoints || g.tier[n] >= 0) && (filter.tier === null || g.tier[n] === filter.tier) &&
        (filter.plane === null || (g.colorGroupKind === 'tier' ? g.plane[n] : g.colorGroup[n]) === -1 ||
          (g.colorGroupKind === 'tier' ? g.plane[n] : g.colorGroup[n]) === filter.plane) &&
        (filter.pod === null || g.pod[n] === -1 || g.pod[n] === filter.pod);
      if (!visible) continue;
      this.visible[n] = 1; nodes.push(n);
      if (n < g.endpointCount) endpoints.push(n); else this.visibleSwitches.push(n);
    }
    const all = nodes.length === g.nodeCount;
    let edges = g.edges;
    if (!all) {
      const filtered = new Uint32Array(g.edges.length);
      let offset = 0;
      for (let e = 0; e < g.edges.length; e += 2) {
        if (this.visible[g.edges[e]] && this.visible[g.edges[e + 1]]) {
          filtered[offset++] = g.edges[e]; filtered[offset++] = g.edges[e + 1];
        }
      }
      edges = filtered.slice(0, offset);
    }
    this.visibleNodeCount = nodes.length; this.visibleEdgeCount = edges.length / 2;
    // Dispose VAOs before replacing attributes so repeated filtering releases GPU buffers.
    this.endpoints.geometry.dispose();
    this.endpoints.geometry.setIndex(new THREE.BufferAttribute(Uint32Array.from(endpoints), 1));
    this.visibleEdges = edges;
    this.setLineMode(this.view.lines);
    this.updateSwitches(); this.updateHighlights(); this.dirty = true;
  }
  private updateSwitches() {
    if (!this.switches || !this.layout || !this.colors) return;
    const matrix = new THREE.Matrix4(), color = new THREE.Color();
    const scale = Math.max(1.7, this.layout.span / 90) * (this.graph && this.graph.nodeCount - this.graph.endpointCount > 2000 ? 0.7 : 1);
    this.switches.count = this.visibleSwitches.length;
    this.visibleSwitches.forEach((n, i) => {
      const size = scale * (n === this.selected ? 1.18 : 1);
      matrix.makeScale(size * 1.8, size * 0.7, size * 1.2);
      matrix.setPosition(this.layout!.positions[n * 3], this.layout!.positions[n * 3 + 1], this.layout!.positions[n * 3 + 2]);
      this.switches!.setMatrixAt(i, matrix);
      this.switches!.setColorAt(i, color.fromArray(this.colors!, n * 3));
    });
    this.switches.instanceMatrix.needsUpdate = true;
    if (this.switches.instanceColor) this.switches.instanceColor.needsUpdate = true;
  }
  setSelection(selected: number | null, path: number[], allPaths: PathSet | null) {
    this.selected = selected; this.path = path; this.allPaths = allPaths;
    this.updateSwitches(); this.updateHighlights(); this.updateOpacity(); this.dirty = true;
  }
  private updateOpacity() {
    if (this.links) {
      const density = this.graph!.edgeCount > DEPTH_LINK_THRESHOLD ? 1 : Math.max(1, (this.visibleEdgeCount / 1800) ** 0.85);
      this.links.material.uniforms.opacity.value = this.view.opacity / density * (this.selected !== null || this.path.length || this.allPaths ? 0.13 : 1);
    }
  }
  private clearHighlights() {
    for (const object of this.highlights) this.scene.remove(object);
    for (const resource of this.highlightResources) resource.dispose();
    this.highlights = []; this.highlightResources = [];
  }
  private updateHighlights() {
    this.clearHighlights();
    if (!this.graph || !this.layout) return;
    const edges: number[] = [], edgeColors: number[] = [], nodes = new Set<number>();
    const fromColor = new THREE.Color(), toColor = new THREE.Color(), segmentColor = new THREE.Color();
    const add = (a: number, b: number) => {
      if (!this.visible[a] || !this.visible[b]) return;
      const p = this.layout!.positions;
      const av = [p[a * 3], p[a * 3 + 1], p[a * 3 + 2]];
      const bv = [p[b * 3], p[b * 3 + 1], p[b * 3 + 2]];
      if (this.view.lines === 'elbow') {
        const mid = (av[1] + bv[1]) / 2;
        const c = [av[0], mid, av[2]], d = [bv[0], mid, bv[2]];
        edges.push(...av, ...c, ...c, ...d, ...d, ...bv);
      } else {
        edges.push(...av, ...bv);
      }
      fromColor.fromBufferAttribute(this.linkColors!, a); toColor.fromBufferAttribute(this.linkColors!, b);
      if (usesGroupColors(this.graph!, this.view.colorBy)) {
        // Path traversal can run either way; the upper tier still owns the link color.
        if (this.graph!.tier[a] > this.graph!.tier[b]) toColor.copy(fromColor);
        else fromColor.copy(toColor);
      }
      const stops = this.view.lines === 'elbow' ? [0, 1 / 3, 1 / 3, 2 / 3, 2 / 3, 1] : [0, 1];
      for (const t of stops) {
        segmentColor.copy(fromColor).lerp(toColor, t);
        edgeColors.push(segmentColor.r, segmentColor.g, segmentColor.b);
      }
      nodes.add(a); nodes.add(b);
    };
    if (this.allPaths) {
      for (const node of this.allPaths.nodes) if (this.visible[node]) nodes.add(node);
      for (const edge of this.allPaths.edges) add(this.graph.edges[edge * 2], this.graph.edges[edge * 2 + 1]);
    } else if (this.path.length) {
      for (const node of this.path) if (this.visible[node]) nodes.add(node);
      for (let i = 1; i < this.path.length; i++) add(this.path[i - 1], this.path[i]);
    } else if (this.selected !== null && this.visible[this.selected]) {
      nodes.add(this.selected);
      for (let i = this.graph.adjacencyOffsets[this.selected]; i < this.graph.adjacencyOffsets[this.selected + 1]; i++) {
        const e = this.graph.incidentEdges[i] * 2;
        add(this.graph.edges[e], this.graph.edges[e + 1]);
      }
    }
    if (!nodes.size) return;
    const geometry = new LineSegmentsGeometry().setPositions(edges).setColors(edgeColors);
    const material = new LineMaterial({ vertexColors: true, linewidth: 2.6, depthTest: false, depthWrite: false,
      transparent: true, opacity: 1, resolution: new THREE.Vector2(this.width, this.height) });
    const lines = new LineSegments2(geometry, material); lines.renderOrder = 4; lines.frustumCulled = false;
    this.scene.add(lines); this.highlights.push(lines); this.highlightResources.push(geometry, material);
    const pointGeometry = new THREE.BufferGeometry();
    pointGeometry.setAttribute('position', this.positionAttribute!);
    const colors = new Float32Array(this.graph.nodeCount * 3);
    for (const n of nodes) colors.set(this.colors!.subarray(n * 3, n * 3 + 3), n * 3);
    pointGeometry.setAttribute('nodeColor', new THREE.BufferAttribute(colors, 3));
    pointGeometry.setIndex([...nodes]);
    const pointMaterial = new THREE.ShaderMaterial({
      vertexShader: pointVertex, fragmentShader: pointFragment,
      uniforms: { pointSize: { value: 7 } }, depthTest: false,
    });
    const points = new THREE.Points(pointGeometry, pointMaterial); points.frustumCulled = false; points.renderOrder = 5;
    this.scene.add(points); this.highlights.push(points); this.highlightResources.push(pointGeometry, pointMaterial);
  }
  reset(fitAll = false) {
    this.fitAll2D = fitAll;
    const span = this.layout?.span ?? 180, height = this.layout?.height ?? 120;
    const flat = this.mode === 'flat' || this.mode === 'radial';
    const diagram = this.mode === 'planes';
    const wasRotate = this.controls.autoRotate;
    this.controls.dispose();
    this.camera = flat || diagram ? new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 100000)
      : new THREE.PerspectiveCamera(42, this.width / this.height, 0.1, 100000);
    const center = new THREE.Vector3(0, this.mode === 'radial' ? 0 : height * 0.47, 0);
    if (this.layout) this.layoutBounds.getCenter(center);
    if (diagram) {
      const distance = Math.max(span * 4, this.layoutBounds.getSize(new THREE.Vector3()).length() * 2);
      this.camera.far = Math.max(100000, distance * 4);
      this.camera.position.copy(center).addScaledVector(new THREE.Vector3(1.8, 0.8, 1.15).normalize(), distance);
      this.camera.lookAt(center); this.updateOrthographicBounds();
    } else if (flat) {
      this.updateOrthographicBounds(); this.camera.position.set(center.x, center.y, span * 4);
    } else {
      // Fit the actual bounding sphere, including exploded planes, so an orbit does
      // not clip terminals at the viewport edge. Adapt to portrait viewports too.
      let radiusSquared = 0;
      if (this.layout) {
        const p = this.layout.positions;
        for (let i = (this.view.showEndpoints ? 0 : this.graph!.endpointCount) * 3; i < p.length; i += 3)
          radiusSquared = Math.max(radiusSquared, p[i] ** 2 + (p[i + 1] - center.y) ** 2 + p[i + 2] ** 2);
      }
      const halfFov = THREE.MathUtils.degToRad(21);
      const limitingAngle = Math.min(halfFov, Math.atan(Math.tan(halfFov) * this.width / this.height));
      const distance = Math.max(10, Math.sqrt(radiusSquared) / Math.sin(limitingAngle) * 1.08);
      this.camera.far = Math.max(100000, distance * 4);
      const direction = this.layout?.guides.length ? new THREE.Vector3(1.65, 0.65, 1.05).normalize()
        : new THREE.Vector3(0.9, 0.6, 1.15).normalize();
      this.camera.position.copy(center).addScaledVector(direction, distance);
    }
    this.camera.lookAt(center); this.camera.updateProjectionMatrix();
    this.controls = this.makeControls(); this.controls.target.copy(center);
    this.controls.maxDistance = Math.max(20000, this.camera.position.distanceTo(center) * 4);
    this.controls.enableRotate = !flat; this.controls.autoRotate = flat ? false : wasRotate;
    this.controls.update(); this.dirty = true;
  }
  focusNode(id: number) {
    if (!this.layout || !this.graph || id >= this.graph.nodeCount) return;
    const target = new THREE.Vector3().fromArray(this.layout.positions, id * 3);
    const direction = this.camera.position.clone().sub(this.controls.target).normalize();
    this.controls.target.copy(target);
    this.camera.position.copy(target).addScaledVector(direction, Math.max(20, this.layout.span * 0.18));
    if (this.camera instanceof THREE.OrthographicCamera) { this.camera.zoom = 4; this.camera.updateProjectionMatrix(); }
    this.controls.update(); this.dirty = true;
  }
  toggleRotate(): boolean {
    if (this.mode === 'flat' || this.mode === 'radial') return false;
    this.controls.autoRotate = !this.controls.autoRotate; this.dirty = true;
    return this.controls.autoRotate;
  }
  private handlePointerDown = (event: PointerEvent) => { this.pointerDown = [event.clientX, event.clientY]; };
  private handlePointerUp = (event: PointerEvent) => {
    if (event.button !== 0 || Math.hypot(event.clientX - this.pointerDown[0], event.clientY - this.pointerDown[1]) > 4 || !this.graph) return;
    if (!this.layout) return;
    const rect = this.renderer.domElement.getBoundingClientRect();
    this.camera.updateMatrixWorld();
    const projection = new THREE.Matrix4().multiplyMatrices(this.camera.projectionMatrix, this.camera.matrixWorldInverse);
    const id = nearestNode(this.layout.positions, this.visible, projection.elements,
      rect.width, rect.height, event.clientX - rect.left, event.clientY - rect.top);
    this.onPick(id); this.dirty = true;
  };
  benchmark(durationMs = 30000): Promise<BenchmarkResult> {
    if (!this.graph || this.visibleNodeCount !== this.graph.nodeCount || this.visibleEdgeCount !== this.graph.edgeCount)
      return Promise.reject(new LocalizedError(msg("Clear all filters before benchmarking the full network")));
    if (this.mode !== 'layered' || this.view.lines !== 'straight')
      return Promise.reject(new LocalizedError(msg("Use 3D layered layout and straight links for the benchmark")));
    this.cancelBenchmark(msg("A new benchmark has started"));
    this.reset();
    return new Promise((resolve, reject) => {
      this.benchmarkState = { start: performance.now(), previous: 0, duration: durationMs, samples: [], resolve, reject, oldRotate: this.controls.autoRotate };
      this.controls.autoRotate = true; this.dirty = true;
    });
  }
  private cancelBenchmark(message: LocalizedText) {
    if (!this.benchmarkState) return;
    this.controls.autoRotate = this.benchmarkState.oldRotate;
    this.benchmarkState.reject(new LocalizedError(message)); this.benchmarkState = null;
  }
  private animate = () => {
    if (this.disposed) return;
    this.raf = requestAnimationFrame(this.animate);
    const now = performance.now();
    const moved = this.controls.update();
    if (this.dirty || moved || this.benchmarkState) {
      this.renderer.render(this.scene, this.camera);
      this.updateLabels();
      this.dirty = false; this.renderedFrames++;
      if (this.benchmarkState) {
        const b = this.benchmarkState;
        if (b.previous && now - b.start > 1000) b.samples.push(now - b.previous);
        b.previous = now;
        if (now - b.start >= b.duration) {
          b.samples.sort((a, c) => a - c);
          const gl = this.renderer.getContext(), extension = gl.getExtension('WEBGL_debug_renderer_info');
          const result: BenchmarkResult = {
            durationMs: now - b.start, frames: b.samples.length,
            medianFps: b.samples.length ? 1000 / b.samples[Math.floor(b.samples.length / 2)] : 0,
            p95FrameMs: b.samples[Math.floor(b.samples.length * 0.95)] ?? 0,
            nodes: this.visibleNodeCount, links: this.visibleEdgeCount,
            submittedSegments: this.submittedSegments(), drawCalls: this.renderer.info.render.calls,
            width: this.width, height: this.height, dpr: 1,
            renderer: extension ? String(gl.getParameter(extension.UNMASKED_RENDERER_WEBGL)) : 'Unavailable',
            lineCompositing: this.graph!.edgeCount > DEPTH_LINK_THRESHOLD ? 'depth' : 'blend',
          };
          this.controls.autoRotate = b.oldRotate; this.benchmarkState = null; b.resolve(result);
        }
      }
    }
    if (now - this.statsStart > 700) {
      this.reportStats(Math.round(this.renderedFrames * 1000 / (now - this.statsStart)));
      this.statsStart = now; this.renderedFrames = 0;
    }
  };
  private submittedSegments() {
    if (!this.links) return 0;
    const geometry = this.links.geometry;
    const instances = geometry instanceof THREE.InstancedBufferGeometry ? geometry.instanceCount : 1;
    return instances * geometry.drawRange.count / 2;
  }
  private reportStats(fps: number) {
    this.onStats({ fps, visibleNodes: this.visibleNodeCount, visibleEdges: this.visibleEdgeCount,
      drawCalls: this.renderer.info.render.calls, submittedSegments: this.submittedSegments() });
  }
  dispose() {
    this.disposed = true; cancelAnimationFrame(this.raf);
    this.resizeObserver.disconnect(); this.clear(); this.controls.dispose();
    this.renderer.domElement.removeEventListener('pointerdown', this.handlePointerDown);
    this.renderer.domElement.removeEventListener('pointerup', this.handlePointerUp);
    this.renderer.domElement.removeEventListener('webglcontextlost', this.handleContextLost);
    this.renderer.dispose(); this.renderer.forceContextLoss(); this.renderer.domElement.remove();
  }
}
