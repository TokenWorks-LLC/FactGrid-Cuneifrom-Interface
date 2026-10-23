"use client";

import { useEffect, useRef, useState } from "react";
import { ExternalLink, ImageIcon, RotateCcw, ZoomIn, ZoomOut } from "lucide-react";

import { isDirectImageUrl, isManifestUrl, pageFromImageUrl, pagesFromManifest, type ImagePage } from "@/lib/factgrid/image-sources";
import type { TabletImage } from "@/lib/factgrid/types";

export function TabletImageViewer({ images }: { images: TabletImage[] }) {
  const container = useRef<HTMLDivElement>(null);
  const viewer = useRef<import("openseadragon").Viewer | null>(null);
  const [selected, setSelected] = useState<number | null>(null);
  const [requestKey, setRequestKey] = useState(0);
  const [pages, setPages] = useState<ImagePage[]>([]);
  const [pageIndex, setPageIndex] = useState(0);
  const [message, setMessage] = useState("");

  useEffect(() => {
    if (selected === null) return;
    const image = images[selected];
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8_000);
    let disposed = false;

    async function prepare() {
      if (isDirectImageUrl(image.url) && !isManifestUrl(image.url)) {
        queueMicrotask(() => {
          if (!disposed) setPages([pageFromImageUrl(image.url)]);
        });
        return;
      }
      try {
        const response = await fetch(image.url, { signal: controller.signal, credentials: "omit", headers: { Accept: "application/ld+json, application/json, image/*" } });
        if (!response.ok || Number(response.headers.get("content-length")) > 2_000_000) {
          throw new Error("Manifest unavailable");
        }
        if (!/(?:application\/|\+)json/iu.test(response.headers.get("content-type") ?? "")) {
          if (!disposed) setPages([pageFromImageUrl(image.url)]);
          return;
        }
        const body = await response.text();
        if (body.length > 2_000_000) throw new Error("Manifest too large");
        const parsed = pagesFromManifest(JSON.parse(body));
        if (parsed.length === 0) throw new Error("No images found");
        if (!disposed) setPages(parsed);
      } catch {
        if (!disposed) {
          if (isManifestUrl(image.url)) setMessage("This IIIF manifest could not be displayed here. Open it at the source instead.");
          else setPages([pageFromImageUrl(image.url)]);
        }
      }
    }
    void prepare().finally(() => clearTimeout(timeout));
    return () => {
      disposed = true;
      clearTimeout(timeout);
      controller.abort();
    };
  }, [images, selected, requestKey]);

  useEffect(() => {
    const element = container.current;
    const page = pages[pageIndex];
    if (!element || !page) return;
    let disposed = false;
    let instance: import("openseadragon").Viewer | undefined;
    let attemptedFallback = false;
    void import("openseadragon").then(({ default: OpenSeadragon }) => {
      if (disposed) return;
      instance = OpenSeadragon({
        element,
        tileSources: page.tileSource,
        showNavigationControl: false,
        showNavigator: true,
        drawer: "canvas",
        navigatorDrawer: "canvas",
        animationTime: 0.25,
        crossOriginPolicy: false,
      });
      viewer.current = instance;
      instance.addHandler("open", () => setMessage(attemptedFallback ? "Tiled view is unavailable; showing the source image." : ""));
      instance.addHandler("open-failed", () => {
        if (page.fallbackUrl && !attemptedFallback) {
          attemptedFallback = true;
          // OpenSeadragon accepts inline image sources; its bundled open() type omits this form.
          instance?.open({ type: "image", url: page.fallbackUrl, buildPyramid: false } as unknown as Parameters<import("openseadragon").Viewer["open"]>[0]);
          setMessage("Tiled view is unavailable; showing the source image.");
        } else {
          setMessage("This image could not be displayed here. Open it at the source instead.");
        }
      });
    }).catch(() => setMessage("The image viewer could not load."));
    return () => {
      disposed = true;
      instance?.destroy();
      if (viewer.current === instance) viewer.current = null;
    };
  }, [pages, pageIndex]);

  const activeImage = selected === null ? null : images[selected];
  return (
    <section aria-label="Tablet images" className="border-b border-border pb-10">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="font-heading text-3xl font-medium">Images</h2>
          <p className="mt-2 text-sm leading-6 text-muted-foreground">
            Select an image to load it from its external source. Scroll or use the controls to zoom.
          </p>
        </div>
        <span className="font-mono text-xs text-muted-foreground">{images.length} image{images.length === 1 ? "" : "s"}</span>
      </div>

      <div className="mt-5 grid gap-2 sm:grid-cols-2">
        {images.map((image, index) => (
          <button
            aria-pressed={selected === index}
            className={`focus-ring min-h-14 border px-4 py-3 text-left text-sm transition-colors ${selected === index ? "border-primary bg-secondary" : "border-border hover:bg-secondary/60"}`}
            key={`${image.url}-${index}`}
            onClick={() => {
              setPages([]);
              setPageIndex(0);
              setMessage("Loading image…");
              setSelected(index);
              setRequestKey((current) => current + 1);
            }}
            type="button"
          >
            <span className="flex items-center gap-2 font-semibold"><ImageIcon aria-hidden="true" className="size-4" /> Image {index + 1}</span>
            <span className="mt-1 block text-xs text-muted-foreground">
              {[...image.sides.map((side) => side.label), ...image.mediaTypes.map((type) => type.label)].join(" · ") || image.label}
            </span>
          </button>
        ))}
      </div>

      {activeImage ? (
        <div className="mt-5">
          <div className="relative h-[24rem] border border-border bg-[#211d1a] sm:h-[34rem]">
            <div aria-label={`Image ${selected! + 1} zoom viewer`} className="h-full w-full" ref={container} />
            {message ? (
              <p aria-live="polite" className="absolute inset-x-3 bottom-3 bg-background/95 px-3 py-2 text-sm text-foreground">{message}</p>
            ) : null}
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <button aria-label="Zoom in" className="focus-ring inline-flex min-h-11 items-center gap-2 border border-border px-3 text-sm" onClick={() => viewer.current?.viewport.zoomBy(1.5)} type="button"><ZoomIn aria-hidden="true" className="size-4" /> Zoom in</button>
            <button aria-label="Zoom out" className="focus-ring inline-flex min-h-11 items-center gap-2 border border-border px-3 text-sm" onClick={() => viewer.current?.viewport.zoomBy(1 / 1.5)} type="button"><ZoomOut aria-hidden="true" className="size-4" /> Zoom out</button>
            <button className="focus-ring inline-flex min-h-11 items-center gap-2 border border-border px-3 text-sm" onClick={() => viewer.current?.viewport.goHome()} type="button"><RotateCcw aria-hidden="true" className="size-4" /> Reset</button>
            <a className="focus-ring ml-auto inline-flex min-h-11 items-center gap-2 text-sm font-semibold underline" href={activeImage.url} rel="noreferrer" target="_blank">Open source <ExternalLink aria-hidden="true" className="size-4" /></a>
          </div>
          {pages.length > 1 ? (
            <label className="mt-4 block text-sm font-medium">Manifest image
              <select className="mt-2 block min-h-11 w-full border border-input bg-background px-3" onChange={(event) => { setMessage("Loading image…"); setPageIndex(Number(event.target.value)); }} value={pageIndex}>
                {pages.map((page, index) => <option key={index} value={index}>{index + 1}. {page.label}</option>)}
              </select>
            </label>
          ) : null}
          <dl className="mt-4 flex flex-wrap gap-x-8 gap-y-2 text-sm">
            {activeImage.sides.length > 0 ? <div><dt className="inline text-muted-foreground">Object side: </dt><dd className="inline">{activeImage.sides.map((side) => side.label).join(", ")}</dd></div> : null}
            {activeImage.mediaTypes.length > 0 ? <div><dt className="inline text-muted-foreground">Media type: </dt><dd className="inline">{activeImage.mediaTypes.map((type) => type.label).join(", ")}</dd></div> : null}
          </dl>
        </div>
      ) : null}
      <p className="mt-4 text-xs leading-5 text-muted-foreground">Images are hosted by their source sites. Rights and availability vary; check the source before reuse.</p>
    </section>
  );
}
