import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, ExternalLink, FileText, ImageIcon, LockKeyhole } from "lucide-react";

import { EditionComparison } from "@/components/edition-comparison";
import { EditionEditGate } from "@/components/edition-edit-gate";
import { Badge } from "@/components/ui/badge";
import { isAllowedEditTarget, parseAllowedEditTargets } from "@/lib/edit/targets";
import { FactGridNotFoundError, type LabeledEntity, type TabletEdition } from "@/lib/factgrid";
import { getTablet } from "@/lib/factgrid/server";
import { wikitextToPlainText } from "@/lib/wikitext-display";

export const revalidate = 300;

const allowedEditTargets = parseAllowedEditTargets(process.env.FACTGRID_ALLOWED_EDIT_TARGETS);

type TabletPageProps = { params: Promise<{ qid: string }> };

export async function generateMetadata({ params }: TabletPageProps): Promise<Metadata> {
  const { qid } = await params;
  try {
    const tablet = await getTablet(qid, { includeDocuments: false });
    return {
      title: tablet.title,
      description: tablet.description ?? `FactGrid cuneiform tablet record ${tablet.qid}.`,
    };
  } catch (error) {
    if (error instanceof FactGridNotFoundError) return { title: "Tablet not found" };
    return { title: qid };
  }
}

export default async function TabletPage({ params }: TabletPageProps) {
  const { qid } = await params;
  let tablet;
  try {
    tablet = await getTablet(qid);
  } catch (error) {
    if (error instanceof FactGridNotFoundError) notFound();
    throw error;
  }

  const hasTextSources = tablet.editions.length > 0 || tablet.externalTranscripts.length > 0;
  const comparisonEditions = tablet.editions.flatMap((edition, index) => {
    const transcript = edition.revision?.transcript;
    if (!transcript) return [];
    return [
      {
        id: edition.editionId ?? `edition-${index + 1}`,
        label: edition.label,
        sourceTitle: edition.reference?.title ?? `Edition ${index + 1}`,
        text: wikitextToPlainText(transcript.displayText),
      },
    ];
  });

  return (
    <main id="main-content">
      <header className="border-b border-border bg-secondary/45">
        <div className="site-container py-10 sm:py-14">
          <Link
            className="focus-ring inline-flex min-h-11 items-center gap-2 text-sm font-medium text-muted-foreground hover:text-foreground"
            href="/browse"
          >
            <ArrowLeft aria-hidden="true" className="size-4" />
            Back to catalogue
          </Link>
          <div className="mt-6 grid gap-7 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-end">
            <div>
              <p className="font-mono text-xs tracking-[0.12em] text-muted-foreground uppercase">{tablet.qid}</p>
              <h1 className="mt-3 max-w-[18ch] break-words font-heading text-4xl leading-tight font-medium tracking-[-0.03em] sm:text-6xl">
                {tablet.title}
              </h1>
              {tablet.description ? (
                <p className="mt-5 max-w-[66ch] text-lg leading-8 text-muted-foreground">{tablet.description}</p>
              ) : (
                <p className="mt-5 text-sm text-muted-foreground">No description recorded in FactGrid.</p>
              )}
            </div>
            <a
              className="focus-ring inline-flex min-h-11 items-center gap-2 self-start text-sm font-semibold underline decoration-primary/35 underline-offset-4 hover:decoration-primary lg:self-auto"
              href={tablet.factGridUrl}
              rel="noreferrer"
              target="_blank"
            >
              Open authoritative record
              <ExternalLink aria-hidden="true" className="size-4" />
            </a>
          </div>
        </div>
      </header>

      <div className="site-container grid gap-14 py-12 lg:grid-cols-[18rem_minmax(0,1fr)] lg:py-16">
        <aside className="order-2 lg:order-1 lg:sticky lg:top-28 lg:self-start">
          <h2 className="font-mono text-xs tracking-[0.12em] text-muted-foreground uppercase">Record metadata</h2>
          <dl className="mt-4 divide-y divide-border border-y border-border">
            <MetadataRow label="FactGrid ID" values={[tablet.qid]} mono />
            <MetadataRow label="Inventory number" values={tablet.inventoryNumbers} />
            <MetadataRow label="CDLI ID" values={tablet.cdliIds} mono />
            <MetadataEntities label="Collection / holding" values={tablet.holdings} />
            <MetadataEntities label="Finding spot" values={tablet.findspots} />
            <MetadataEntities label="Period / style" values={tablet.periods} />
            <MetadataEntities label="Language" values={tablet.languages} />
            <MetadataEntities label="Type of work" values={tablet.workTypes} />
            <MetadataEntities label="Material" values={tablet.materials} />
            <MetadataRow
              label="Dimensions"
              values={tablet.dimensions.map(
                (dimension) =>
                  `${dimension.kind}: ${dimension.amount}${dimension.unit ? ` ${dimension.unit.label}` : ""}`,
              )}
            />
          </dl>

          <div className="mt-9">
            <h2 className="font-mono text-xs tracking-[0.12em] text-muted-foreground uppercase">Images</h2>
            {tablet.images.length > 0 ? (
              <ul className="mt-3 divide-y divide-border border-y border-border">
                {tablet.images.map((image) => (
                  <li key={image.url}>
                    <a
                      className="focus-ring flex min-h-12 items-center justify-between gap-3 py-3 text-sm font-medium hover:text-primary"
                      href={image.url}
                      rel="noreferrer"
                      target="_blank"
                    >
                      <span className="flex min-w-0 items-center gap-2">
                        <ImageIcon aria-hidden="true" className="size-4 shrink-0" />
                        <span className="truncate">{image.label}</span>
                      </span>
                      <ExternalLink aria-hidden="true" className="size-4 shrink-0" />
                    </a>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-3 text-sm leading-6 text-muted-foreground">No image link is recorded in the supported FactGrid properties.</p>
            )}
            {tablet.images.length > 0 ? (
              <p className="mt-3 text-xs leading-5 text-muted-foreground">
                Rights vary by source. Images are linked until item-specific reuse terms can be verified.
              </p>
            ) : null}
          </div>
        </aside>

        <div className="order-1 min-w-0 lg:order-2">
          <div className="flex flex-wrap items-end justify-between gap-4 border-b border-foreground/35 pb-4">
            <div>
              <h2 className="font-heading text-3xl font-medium">Texts and editions</h2>
              <p className="mt-2 max-w-[68ch] text-sm leading-6 text-muted-foreground">
                Each linked witness remains separate. Labels describe its source format, not a merged or preferred text.
              </p>
            </div>
            <Badge variant="outline">
              {tablet.editions.length + tablet.externalTranscripts.length} source
              {tablet.editions.length + tablet.externalTranscripts.length === 1 ? "" : "s"}
            </Badge>
          </div>

          {!hasTextSources ? (
            <div className="border-b border-border py-12">
              <FileText aria-hidden="true" className="size-7 text-muted-foreground" />
              <h3 className="mt-5 font-heading text-2xl font-medium">No transcript is linked</h3>
              <p className="mt-3 max-w-[60ch] leading-7 text-muted-foreground">
                FactGrid currently records neither a document page nor an external transcript for this tablet.
              </p>
            </div>
          ) : null}

          {tablet.editions.length > 0 ? (
            <nav aria-label="Edition index" className="border-b border-border py-5">
              <p className="font-mono text-xs tracking-[0.1em] text-muted-foreground uppercase">
                Edition index
              </p>
              <ol className="mt-3 flex flex-wrap gap-x-5 gap-y-2 text-sm">
                {tablet.editions.map((edition, index) => (
                  <li key={edition.editionId ?? edition.reference?.url ?? index}>
                    <a
                      className="focus-ring inline-flex min-h-11 items-center underline decoration-border underline-offset-4 hover:decoration-primary"
                      href={`#edition-${index + 1}`}
                    >
                      {index + 1}. {edition.label}
                    </a>
                  </li>
                ))}
              </ol>
            </nav>
          ) : null}

          <EditionComparison editions={comparisonEditions} />

          {tablet.editions.map((edition, index) => (
            <EditionSection
              edition={edition}
              expandedByDefault={index === 0}
              index={index}
              key={edition.editionId ?? edition.reference?.url ?? index}
              qid={tablet.qid}
            />
          ))}

          {tablet.externalTranscripts.map((source, index) => (
            <section className="border-b border-border py-9" key={source.url}>
              <div className="flex flex-wrap items-center justify-between gap-4">
                <div>
                  <p className="font-mono text-xs tracking-[0.1em] text-muted-foreground uppercase">External source {index + 1}</p>
                  <h3 className="mt-2 font-heading text-2xl font-medium">External transcript</h3>
                </div>
                <a
                  className="focus-ring inline-flex min-h-11 items-center gap-2 text-sm font-semibold underline underline-offset-4"
                  href={source.url}
                  rel="noreferrer"
                  target="_blank"
                >
                  Open {source.label}
                  <ExternalLink aria-hidden="true" className="size-4" />
                </a>
              </div>
              <p className="mt-4 max-w-[68ch] text-sm leading-6 text-muted-foreground">
                This link comes from FactGrid. The external text is not copied or editable here, and its present availability is controlled by the source site.
              </p>
            </section>
          ))}

          {tablet.omittedEditionCount > 0 ? (
            <p className="mt-6 text-sm text-muted-foreground">
              {tablet.omittedEditionCount} additional document link{tablet.omittedEditionCount === 1 ? " was" : "s were"} omitted to keep this read bounded. See FactGrid for the complete statement list.
            </p>
          ) : null}
        </div>
      </div>
    </main>
  );
}

function MetadataRow({ label, values, mono = false }: { label: string; values: string[]; mono?: boolean }) {
  return (
    <div className="py-3.5">
      <dt className="text-xs font-medium text-muted-foreground">{label}</dt>
      <dd className={`mt-1 break-words text-sm ${mono ? "font-mono" : ""}`}>
        {values.length > 0 ? values.join(", ") : "Not recorded in FactGrid"}
      </dd>
    </div>
  );
}

function MetadataEntities({ label, values }: { label: string; values: LabeledEntity[] }) {
  return (
    <div className="py-3.5">
      <dt className="text-xs font-medium text-muted-foreground">{label}</dt>
      <dd className="mt-1 text-sm">
        {values.length > 0
          ? values.map((value, index) => (
              <span key={value.id}>
                {index > 0 ? ", " : null}
                <a className="underline decoration-border underline-offset-4 hover:decoration-primary" href={value.url} rel="noreferrer" target="_blank">
                  {value.label}
                </a>
              </span>
            ))
          : "Not recorded in FactGrid"}
      </dd>
    </div>
  );
}

function EditionSection({
  edition,
  expandedByDefault,
  index,
  qid,
}: {
  edition: TabletEdition;
  expandedByDefault: boolean;
  index: number;
  qid: string;
}) {
  const revision = edition.revision;
  const transcript = revision?.transcript;
  const sourceUrl = edition.reference?.url;
  const historyUrl = sourceUrl ? `${sourceUrl}?action=history` : undefined;
  const targetEnabled = Boolean(
    edition.reference && isAllowedEditTarget(edition.reference, allowedEditTargets),
  );
  const editEligible = Boolean(transcript?.editable && targetEnabled);
  const statusLabel =
    edition.status === "missing"
      ? "Missing page"
      : edition.status !== "loaded"
        ? "Read only"
        : editEligible
          ? "Editable with approval"
          : "Read only";
  const readOnlyReason = transcript
    ? !transcript.editable
      ? (transcript.reason ??
        "This source format is available for reading but is not safe for plain-text editing.")
      : !targetEnabled
        ? "This plain transcript is not on this deployment’s approved edit-target list."
        : undefined
    : undefined;
  const supportingSections = (revision?.sections ?? []).filter(
    (section) =>
      !transcript || !/^(?:transcript(?:ion)?|transliteration)$/iu.test(section.heading),
  );

  return (
    <section className="scroll-mt-28 border-b border-border py-9" id={`edition-${index + 1}`}>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex flex-wrap items-center gap-3">
            <h3 className="font-heading text-2xl font-medium">{edition.label}</h3>
            <Badge variant={editEligible ? "secondary" : "outline"}>
              {statusLabel}
            </Badge>
          </div>
          {edition.reference ? (
            <p className="mt-2 break-all font-mono text-xs text-muted-foreground">{edition.reference.title}</p>
          ) : null}
        </div>
        {sourceUrl ? (
          <div className="flex flex-wrap gap-4 text-sm">
            <a className="focus-ring inline-flex min-h-11 items-center gap-2 font-medium underline underline-offset-4" href={sourceUrl} rel="noreferrer" target="_blank">
              Source page
              <ExternalLink aria-hidden="true" className="size-4" />
            </a>
            {historyUrl ? (
              <a className="focus-ring inline-flex min-h-11 items-center gap-2 text-muted-foreground underline underline-offset-4 hover:text-foreground" href={historyUrl} rel="noreferrer" target="_blank">
                Revision history
              </a>
            ) : null}
          </div>
        ) : null}
      </div>

      {revision ? (
        <details className="group mt-6" open={expandedByDefault}>
          <summary className="focus-ring flex min-h-11 cursor-pointer list-none items-center justify-between gap-4 border-y border-border py-3 text-sm font-semibold">
            Edition text and notes
            <span
              aria-hidden="true"
              className="font-sans text-base text-muted-foreground transition-transform group-open:rotate-45"
            >
              +
            </span>
          </summary>

          {transcript ? (
            <div className="mt-7">
              <p className="font-mono text-xs tracking-[0.1em] text-muted-foreground uppercase">
                Transliteration
              </p>
              {readOnlyReason ? (
                <p className="mt-3 flex max-w-[70ch] gap-2 text-sm leading-6 text-muted-foreground">
                  <LockKeyhole aria-hidden="true" className="mt-1 size-4 shrink-0" />
                  {readOnlyReason}
                </p>
              ) : null}
              <pre className="transcript-text mt-4 border border-border bg-card p-5 text-sm leading-7 whitespace-pre-wrap sm:p-7">
                {wikitextToPlainText(transcript.displayText) ||
                  "The recognized transcript region is empty."}
              </pre>
            </div>
          ) : (
            <p className="mt-6 max-w-[68ch] text-sm leading-6 text-muted-foreground">
              The page is readable, but no supported transliteration region was recognized. Use the source page to inspect its full structure.
            </p>
          )}

          {supportingSections.length > 0 ? (
            <div className="mt-8 space-y-7">
              {supportingSections.map((section, sectionIndex) => {
                const text = wikitextToPlainText(section.wikitext);
                if (!text) return null;
                return (
                  <details
                    className="group/note border-t border-border pt-4"
                    key={`${section.heading}-${sectionIndex}`}
                  >
                    <summary className="focus-ring flex min-h-11 cursor-pointer list-none items-center justify-between gap-4 font-heading text-xl font-medium">
                      {section.heading}
                      <span
                        aria-hidden="true"
                        className="font-sans text-sm text-muted-foreground group-open/note:rotate-45"
                      >
                        +
                      </span>
                    </summary>
                    <div className="mt-3 max-w-[75ch] whitespace-pre-wrap text-[1.02rem] leading-8 text-muted-foreground">
                      {text}
                    </div>
                  </details>
                );
              })}
            </div>
          ) : null}

          {transcript?.editable && targetEnabled && edition.editionId && historyUrl ? (
            <EditionEditGate
              editionId={edition.editionId}
              historyUrl={historyUrl}
              initialRevision={revision.revisionId}
              initialText={transcript.content}
              qid={qid}
              targetEnabled
            />
          ) : null}

          <p className="mt-6 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
            <span>Revision {revision.revisionId}</span>
            <span>Retrieved from a {revision.contentModel} page</span>
          </p>
        </details>
      ) : (
        <p className="mt-6 max-w-[68ch] text-sm leading-6 text-muted-foreground">
          {edition.reason ?? "This linked page could not be read in a supported format."}
        </p>
      )}
    </section>
  );
}
