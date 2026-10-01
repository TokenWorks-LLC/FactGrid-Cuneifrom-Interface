import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";

import { TabletEditor } from "@/components/tablet-editor";
import { Badge } from "@/components/ui/badge";
import { FactGridNotFoundError } from "@/lib/factgrid";
import { getTablet, hasCanonicalTranscription } from "@/lib/factgrid/server";

export const revalidate = 300;
export const metadata: Metadata = {
  title: "Edit tablet record",
  robots: { index: false, follow: true },
};

export default async function TabletEditorPage({ params }: { params: Promise<{ qid: string }> }) {
  const { qid } = await params;
  let tablet;
  try {
    tablet = await getTablet(qid, { includeDocuments: false });
  } catch (error) {
    if (error instanceof FactGridNotFoundError) notFound();
    throw error;
  }

  const hasCanonicalLink = tablet.editions.some(
    (edition) => edition.reference?.title === `D-${tablet.qid}`,
  );
  // A P251 link may point to a page that has not been created yet. Check only
  // that page's existence; metadata editing does not need document revisions.
  const offerTranscriptionCreation = hasCanonicalLink
    ? !(await hasCanonicalTranscription(tablet.qid))
    : !tablet.editions.some((edition) => edition.reference);

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
            <Badge variant="outline">FactGrid editor</Badge>
          </div>
          <h1 className="mt-3 font-heading text-4xl leading-tight font-medium tracking-[-0.03em] sm:text-5xl">Edit tablet record</h1>
          <p className="mt-3 break-words text-lg text-muted-foreground">{tablet.title}</p>
          <p className="mt-6 max-w-[75ch] text-sm leading-6">Sign in with FactGrid to edit metadata or add a missing transcription. Your account permissions apply to every save.</p>
        </div>
      </header>
      <div className="site-container py-10 sm:py-14">
        <TabletEditor
          key={tablet.qid}
          offerTranscriptionCreation={offerTranscriptionCreation}
          qid={tablet.qid}
        />
      </div>
    </main>
  );
}
