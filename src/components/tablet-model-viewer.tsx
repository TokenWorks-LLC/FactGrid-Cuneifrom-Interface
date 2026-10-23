"use client";

import { useEffect, useRef, useState } from "react";

const MAX_MODEL_BYTES = 75_000_000;

async function fetchModel(url: string, signal: AbortSignal, onProgress: (percent: number) => void) {
  const response = await fetch(url, { signal, mode: "cors", credentials: "omit" });
  if (!response.ok || !response.body) throw new Error("The model could not be downloaded.");

  const expected = Number(response.headers.get("content-length"));
  if (expected > MAX_MODEL_BYTES) throw new Error("This model is too large for the viewer.");

  const reader = response.body.getReader();
  // The Heidelberg files include Content-Length. Fill one buffer in that case
  // so a large PLY is not copied and held twice before parsing.
  const bytes = Number.isSafeInteger(expected) && expected > 0 ? new Uint8Array(expected) : null;
  const chunks: Uint8Array[] = [];
  let received = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    received += value.byteLength;
    if (received > MAX_MODEL_BYTES) {
      await reader.cancel();
      throw new Error("This model is too large for the viewer.");
    }
    if (bytes) {
      if (received > bytes.byteLength) {
        await reader.cancel();
        throw new Error("The model size did not match the download header.");
      }
      bytes.set(value, received - value.byteLength);
    } else {
      chunks.push(value);
    }
    if (expected > 0) onProgress(Math.min(100, Math.round((received / expected) * 100)));
  }

  if (bytes) {
    if (received !== bytes.byteLength) throw new Error("The model download was incomplete.");
    return bytes.buffer;
  }

  const combined = new Uint8Array(received);
  let offset = 0;
  for (const chunk of chunks) {
    combined.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return combined.buffer;
}

export function TabletModelViewer({ title, url }: { title: string; url: string }) {
  const mountRef = useRef<HTMLDivElement>(null);
  const resetViewRef = useRef<(() => void) | null>(null);
  const [active, setActive] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [status, setStatus] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const [progress, setProgress] = useState<number | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!active) return;
    const mount = mountRef.current;
    if (!mount) return;

    const controller = new AbortController();
    let disposed = false;
    let disposeViewer: (() => void) | undefined;

    async function load() {
      setStatus("loading");
      setProgress(null);
      try {
        const [buffer, THREE, { PLYLoader }, { OrbitControls }] = await Promise.all([
          fetchModel(url, controller.signal, (value) => {
            if (!disposed) setProgress(value);
          }),
          import("three"),
          import("three/addons/loaders/PLYLoader.js"),
          import("three/addons/controls/OrbitControls.js"),
        ]);
        if (disposed) return;

        const geometry = new PLYLoader().parse(buffer);
        try {
          if (!geometry.getAttribute("normal")) geometry.computeVertexNormals();
          geometry.computeBoundingSphere();
          const sphere = geometry.boundingSphere;
          if (!sphere || !Number.isFinite(sphere.radius) || sphere.radius <= 0) {
            throw new Error("The model has no usable geometry.");
          }

          const scene = new THREE.Scene();
          scene.background = new THREE.Color("#e8dfd1");
          scene.add(new THREE.AmbientLight(0xffffff, 2));
          const light = new THREE.DirectionalLight(0xffffff, 2.5);
          light.position.set(1, 2, 3);
          scene.add(light);
          const reverseLight = new THREE.DirectionalLight(0xffffff, 1.2);
          reverseLight.position.set(-2, -1, -2);
          scene.add(reverseLight);

          const material = new THREE.MeshStandardMaterial({
            color: geometry.getAttribute("color") ? 0xffffff : 0xb79570,
            vertexColors: Boolean(geometry.getAttribute("color")),
            side: THREE.DoubleSide,
            roughness: 1,
          });
          const mesh = new THREE.Mesh(geometry, material);
          mesh.position.copy(sphere.center).multiplyScalar(-1);
          scene.add(mesh);

          const camera = new THREE.PerspectiveCamera(45, 1, sphere.radius / 1_000, sphere.radius * 30);
          const distance = sphere.radius * 2.8;
          camera.position.set(0, 0, distance);
          const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "default" });
          renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
          renderer.domElement.setAttribute("aria-label", `3D model of ${title}. Drag to rotate, scroll or pinch to zoom.`);
          renderer.domElement.setAttribute("role", "img");
          renderer.domElement.tabIndex = 0;
          mount!.appendChild(renderer.domElement);

          const controls = new OrbitControls(camera, renderer.domElement);
          controls.enableDamping = false;
          controls.minDistance = sphere.radius * 1.05;
          controls.maxDistance = sphere.radius * 12;
          controls.listenToKeyEvents(renderer.domElement);
          const render = () => renderer.render(scene, camera);
          const resize = () => {
            if (!mount) return;
            const width = mount.clientWidth;
            const height = mount.clientHeight;
            if (!width || !height) return;
            camera.aspect = width / height;
            camera.updateProjectionMatrix();
            renderer.setSize(width, height);
            render();
          };
          controls.addEventListener("change", render);
          const observer = new ResizeObserver(resize);
          observer.observe(mount!);
          resize();
          resetViewRef.current = () => {
            camera.position.set(0, 0, distance);
            controls.target.set(0, 0, 0);
            controls.update();
            render();
          };
          disposeViewer = () => {
            resetViewRef.current = null;
            observer.disconnect();
            controls.removeEventListener("change", render);
            controls.dispose();
            renderer.dispose();
            renderer.domElement.remove();
            material.dispose();
            geometry.dispose();
          };
          setStatus("ready");
        } catch (cause) {
          geometry.dispose();
          throw cause;
        }
      } catch (cause) {
        if (disposed || controller.signal.aborted) return;
        setError(cause instanceof Error ? cause.message : "The model could not be displayed.");
        setStatus("error");
      }
    }

    void load();
    return () => {
      disposed = true;
      controller.abort();
      disposeViewer?.();
    };
  }, [active, attempt, title, url]);

  return (
    <div className="mt-5">
      {!active ? (
        <button
          className="focus-ring min-h-11 border border-primary bg-primary px-4 text-sm font-semibold text-primary-foreground hover:bg-primary/85"
          onClick={() => setActive(true)}
          type="button"
        >
          Load interactive 3D model
        </button>
      ) : (
        <>
          <div className="relative h-[22rem] overflow-hidden border border-border bg-[#e8dfd1] sm:h-[32rem]" ref={mountRef}>
            {status !== "ready" ? (
              <div className="absolute inset-0 flex items-center justify-center p-6 text-center text-sm text-foreground" role="status">
                {status === "error" ? error : `Loading 3D model${progress === null ? "…" : `: ${progress}%`}`}
              </div>
            ) : null}
          </div>
          <div className="mt-3 flex flex-wrap items-center justify-between gap-3 text-sm text-muted-foreground">
            <p>Drag to rotate. Scroll or pinch to zoom. Arrow keys work when the model is focused.</p>
            {status === "ready" ? (
              <button className="focus-ring min-h-11 font-semibold text-foreground underline" onClick={() => resetViewRef.current?.()} type="button">
                Reset view
              </button>
            ) : null}
            {status === "error" ? (
              <button className="focus-ring min-h-11 font-semibold text-foreground underline" onClick={() => setAttempt((value) => value + 1)} type="button">
                Try again
              </button>
            ) : null}
          </div>
        </>
      )}
    </div>
  );
}
