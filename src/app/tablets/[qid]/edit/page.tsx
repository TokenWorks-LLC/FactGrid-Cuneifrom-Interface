import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ArrowLeft, FlaskConical } from "lucide-react";

import { TabletEditorPreview, type PreviewEdition } from "@/components/tablet-editor-preview";
import { Badge } from "@/components/ui/badge";
import { FactGridNotFoundError } from "@/lib/factgrid";
import { getTablet } from "@/lib/factgrid/server";
import { wikitextToPlainText } from "@/lib/wikitext-display";

export const revalidate = 300;
export const metadata: Metadata = {
  title: "Editor preview",
  robots: { index: false, follow: true },
};

export default async function EditorPreviewPage({ params }: { params: Promise<{ qid: string }> }) {
  const { qid } = await params;
  let tablet;
  try {
    tablet = await getTablet(qid);
  } catch (error) {
    if (error instanceof FactGridNotFoundError) notFound();
    throw error;
  }

  const editions: PreviewEdition[] = tablet.editions.flatMap((edition, index) => {
    const transcript = edition.revision?.transcript;
    if (!transcript || !edition.reference) return [];
    return [{
      id: edition.editionId ?? `preview-${index}`,
      label: `${edition.label} · ${edition.reference.title}`,
      text: transcript.editable ? transcript.content : wikitextToPlainText(transcript.displayText),
      historyUrl: `${edition.reference.url}?action=history`,
      description: transcript.editable
        ? `Try a draft of ${edition.reference.title}. Your changes stay in this page and are not sent to FactGrid.`
        : `This is a plain-text preview of ${edition.reference.title}. Its source format remains read-only; changing this draft cannot update the original.`,
    }];
  });
  if (editions.length === 0) {
    editions.push({
      id: "blank-draft",
      label: "Blank practice draft",
      text: "",
      historyUrl: `${tablet.factGridUrl}?action=history`,
      description: "No local transcript can be previewed for this record. Try the editor with an empty practice draft; this does not create a document or import an external source.",
    });
  }

  return (
    <main id="main-content">
      <header className="border-b border-border bg-secondary/45">
        <div className="site-container py-10 sm:py-14">
          <a className="focus-ring inline-flex min-h-11 items-center gap-2 text-sm font-medium text-muted-foreground hover:text-foreground" href={`/tablets/${tablet.qid}`}>
            <ArrowLeft aria-hidden="true" className="size-4" />
            Back to tablet record
          </a>
          <div className="mt-6 flex flex-wrap items-center gap-3">
            <p className="font-mono text-xs tracking-[0.12em] text-muted-foreground uppercase">{tablet.qid}</p>
            <Badge variant="outline">Public preview</Badge>
          </div>
          <h1 className="mt-3 font-heading text-4xl leading-tight font-medium tracking-[-0.03em] sm:text-5xl">Editor preview</h1>
          <p className="mt-3 break-words text-lg text-muted-foreground">{tablet.title}</p>
          <div className="mt-6 flex max-w-[75ch] items-start gap-3 border-l-2 border-primary pl-4 text-sm leading-6">
            <FlaskConical aria-hidden="true" className="mt-1 size-4 shrink-0 text-primary" />
            <p>Everyone can try this interface. Drafts stay in this page and are discarded when you leave or reload. Nothing here is saved to FactGrid. Publishing supported edits still requires an approved FactGrid account and an approved target.</p>
          </div>
          <nav aria-label="Editor sections" className="mt-5 flex flex-wrap gap-x-6 text-sm font-medium">
            <a className="focus-ring inline-flex min-h-11 items-center underline underline-offset-4" href="#metadata-draft">Metadata</a>
            <a className="focus-ring inline-flex min-h-11 items-center underline underline-offset-4" href="#transliteration-draft">Transliteration</a>
          </nav>
        </div>
      </header>
      <div className="site-container py-10 sm:py-14">
        <TabletEditorPreview
          editions={editions}
          initialMetadata={{ title: tablet.title, description: tablet.description ?? "", inventoryNumbers: tablet.inventoryNumbers.join("\n") }}
          key={tablet.qid}
        />
      </div>
    </main>
  );
}
