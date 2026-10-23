export interface ImagePage {
  label: string;
  tileSource: string | { type: "image"; url: string; buildPyramid: false };
  fallbackUrl?: string;
}

function object(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function entries(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function safeUrl(value: unknown): string | undefined {
  if (typeof value !== "string" || value.length > 2_048) return undefined;
  try {
    const url = new URL(value);
    if (!(["https:", "http:"].includes(url.protocol)) || url.username || url.password) return undefined;
    return url.toString();
  } catch {
    return undefined;
  }
}

function label(value: unknown, fallback: string): string {
  if (typeof value === "string") return value.slice(0, 100) || fallback;
  const translations = object(value);
  const text = translations?.en ?? translations?.none ?? Object.values(translations ?? {})[0];
  return (Array.isArray(text) && typeof text[0] === "string" ? text[0] : fallback).slice(0, 100);
}

function imagePage(bodyValue: unknown, pageLabel: string): ImagePage | undefined {
  const body = object(bodyValue);
  if (!body) return undefined;
  const imageUrl = safeUrl(body.id ?? body["@id"]);
  const service = object(entries(body.service)[0] ?? body.service);
  const serviceUrl = safeUrl(service?.id ?? service?.["@id"]);
  if (serviceUrl) {
    return {
      label: pageLabel,
      tileSource: `${serviceUrl.replace(/\/(?:info\.json)?\/?$/u, "")}/info.json`,
      fallbackUrl: imageUrl,
    };
  }
  return imageUrl ? { label: pageLabel, tileSource: { type: "image", url: imageUrl, buildPyramid: false } } : undefined;
}

/** Extracts painting images from IIIF Presentation 2 and 3 manifests. */
export function pagesFromManifest(value: unknown): ImagePage[] {
  const manifest = object(value);
  if (!manifest) return [];
  const canvases = manifest.type === "Manifest"
    ? entries(manifest.items)
    : entries(object(entries(manifest.sequences)[0])?.canvases);
  return canvases.slice(0, 100).flatMap((canvasValue, index) => {
    const canvas = object(canvasValue);
    if (!canvas) return [];
    const pageLabel = label(canvas.label, `Image ${index + 1}`);
    if (manifest.type === "Manifest") {
      for (const annotationPage of entries(canvas.items)) {
        for (const annotationValue of entries(object(annotationPage)?.items)) {
          const annotation = object(annotationValue);
          if (annotation?.motivation !== "painting") continue;
          const page = imagePage(annotation.body, pageLabel);
          if (page) return [page];
        }
      }
    } else {
      for (const annotationValue of entries(canvas.images)) {
        const page = imagePage(object(annotationValue)?.resource, pageLabel);
        if (page) return [page];
      }
    }
    return [];
  });
}

export function isManifestUrl(url: string): boolean {
  const path = new URL(url).pathname;
  return !/\/info\.json$/iu.test(path) && (/(?:^|\/)manifest(?:\.json)?\/?$/iu.test(path) || /\.json$/iu.test(path));
}

export function isDirectImageUrl(url: string): boolean {
  return /(?:\/info\.json|\.(?:avif|gif|jpe?g|png|tiff?|webp|svg))$/iu.test(new URL(url).pathname);
}

export function pageFromImageUrl(url: string): ImagePage {
  const parsed = new URL(url);
  if (/\/info\.json$/iu.test(parsed.pathname)) {
    return { label: "Image", tileSource: url };
  }
  // IIIF Image API full-size URLs can use the underlying tile service.
  const match = parsed.pathname.match(/^(.*)\/full\/(?:full|max|\d+,)\/0\/default\.(?:jpe?g|png|webp)$/iu);
  if (match) {
    const infoUrl = new URL(parsed);
    infoUrl.pathname = `${match[1]}/info.json`;
    return { label: "Image", tileSource: infoUrl.toString(), fallbackUrl: url };
  }
  return { label: "Image", tileSource: { type: "image", url, buildPyramid: false } };
}
