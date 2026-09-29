"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { AlertTriangle, Check, LoaderCircle, Plus, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";

export type MetadataValue =
  | { kind: "string"; value: string }
  | { kind: "entity"; id: string; entityType: "item" | "property" | "lexeme" | "form" | "sense" }
  | { kind: "monolingualtext"; text: string; language: string }
  | { kind: "time"; time: string; timezone: number; before: number; after: number; precision: number; calendarModel: string }
  | { kind: "quantity"; amount: string; unit: string; lowerBound?: string; upperBound?: string }
  | { kind: "coordinate"; latitude: number; longitude: number; altitude: null; precision: number; globe: string }
  | { kind: "unsupported"; raw: unknown };

export interface EditableSnak {
  property: string;
  datatype: string;
  snaktype: "value" | "somevalue" | "novalue";
  value?: MetadataValue;
}

export interface EditableReference {
  hash?: string;
  snaks: Record<string, EditableSnak[]>;
  snaksOrder: string[];
}

export interface EditableStatement {
  id?: string | null;
  rank: "preferred" | "normal" | "deprecated";
  mainsnak: EditableSnak;
  qualifiers: Record<string, EditableSnak[]>;
  qualifierOrder: string[];
  references: EditableReference[];
}

export interface EditableEntity {
  id: string;
  lastRevision: number;
  modified?: string;
  labels: Record<string, string>;
  descriptions: Record<string, string>;
  aliases: Record<string, string[]>;
  sitelinks: Record<string, { title: string; badges: string[] }>;
  statements: EditableStatement[];
}

export interface PropertyDefinition {
  id: string;
  datatype: string;
  label: string;
  description?: string;
  supported: boolean;
  readOnlyReason?: string;
}

export interface MetadataModel {
  entity: EditableEntity;
  properties: Record<string, PropertyDefinition>;
}

type MetadataOperation =
  | { type: "set-label" | "set-description"; language: string; value: string | null }
  | { type: "set-aliases"; language: string; values: string[] }
  | { type: "set-sitelink"; site: string; title: string | null; badges?: string[] }
  | { type: "upsert-statement"; statement: EditableStatement }
  | { type: "remove-statement"; statementId: string };

type SaveState =
  | { status: "idle" }
  | { status: "saving" }
  | { status: "saved"; message: string }
  | { status: "error" | "conflict" | "unknown" | "partial"; message: string };

const inputClass = "mt-2 min-h-11 w-full min-w-0 border border-input bg-background px-3 text-base md:text-sm";
const selectClass = inputClass;

function cloneEntity(entity: EditableEntity): EditableEntity {
  return structuredClone(entity);
}

function same(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function mapKeys(left: Record<string, unknown>, right: Record<string, unknown>): string[] {
  return [...new Set([...Object.keys(left), ...Object.keys(right)])].sort();
}

export function buildMetadataOperations(initial: EditableEntity, draft: EditableEntity): MetadataOperation[] {
  const operations: MetadataOperation[] = [];
  for (const language of mapKeys(initial.labels, draft.labels)) {
    if (initial.labels[language] !== draft.labels[language]) {
      operations.push({ type: "set-label", language, value: draft.labels[language]?.trim() || null });
    }
  }
  for (const language of mapKeys(initial.descriptions, draft.descriptions)) {
    if (initial.descriptions[language] !== draft.descriptions[language]) {
      operations.push({ type: "set-description", language, value: draft.descriptions[language]?.trim() || null });
    }
  }
  for (const language of mapKeys(initial.aliases, draft.aliases)) {
    if (!same(initial.aliases[language] ?? [], draft.aliases[language] ?? [])) {
      operations.push({ type: "set-aliases", language, values: (draft.aliases[language] ?? []).filter(Boolean) });
    }
  }
  for (const site of mapKeys(initial.sitelinks, draft.sitelinks)) {
    if (!same(initial.sitelinks[site], draft.sitelinks[site])) {
      const value = draft.sitelinks[site];
      operations.push({ type: "set-sitelink", site, title: value?.title.trim() || null, badges: value?.badges ?? [] });
    }
  }

  const draftById = new Map(draft.statements.flatMap((statement) => statement.id ? [[statement.id, statement] as const] : []));
  for (const statement of initial.statements) {
    if (statement.id && !draftById.has(statement.id)) operations.push({ type: "remove-statement", statementId: statement.id });
  }
  const initialById = new Map(initial.statements.flatMap((statement) => statement.id ? [[statement.id, statement] as const] : []));
  for (const statement of draft.statements) {
    const completeStatement = {
      ...statement,
      references: statement.references.filter((reference) =>
        Object.values(reference.snaks).some((snaks) => snaks.length > 0),
      ),
    };
    if (!statement.id || !same(initialById.get(statement.id), completeStatement)) {
      operations.push({ type: "upsert-statement", statement: completeStatement });
    }
  }
  return operations;
}

function defaultValue(datatype: string): MetadataValue {
  switch (datatype) {
    case "wikibase-item": return { kind: "entity", id: "", entityType: "item" };
    case "wikibase-property": return { kind: "entity", id: "", entityType: "property" };
    case "wikibase-lexeme": return { kind: "entity", id: "", entityType: "lexeme" };
    case "wikibase-form": return { kind: "entity", id: "", entityType: "form" };
    case "wikibase-sense": return { kind: "entity", id: "", entityType: "sense" };
    case "monolingualtext": return { kind: "monolingualtext", text: "", language: "en" };
    case "time": return { kind: "time", time: "+00000000000-00-00T00:00:00Z", timezone: 0, before: 0, after: 0, precision: 9, calendarModel: "http://www.wikidata.org/entity/Q1985727" };
    case "quantity": return { kind: "quantity", amount: "", unit: "1" };
    case "globe-coordinate": return { kind: "coordinate", latitude: 0, longitude: 0, altitude: null, precision: 0.0001, globe: "http://www.wikidata.org/entity/Q2" };
    default: return { kind: "string", value: "" };
  }
}

function defaultSnak(property: PropertyDefinition): EditableSnak {
  return { property: property.id, datatype: property.datatype, snaktype: "value", value: defaultValue(property.datatype) };
}

function propertyName(definitions: Record<string, PropertyDefinition>, property: string): string {
  const definition = definitions[property];
  return definition ? `${definition.label} (${property})` : property;
}

function TermRows({
  kind,
  values,
  onChange,
}: {
  kind: "Labels" | "Descriptions";
  values: Record<string, string>;
  onChange: (values: Record<string, string>) => void;
}) {
  const rows = Object.entries(values).sort(([left], [right]) => left.localeCompare(right));
  return (
    <fieldset className="border border-border p-4 sm:p-5">
      <legend className="px-2 font-heading text-xl font-medium">{kind}</legend>
      <div className="space-y-4">
        {rows.map(([language, value]) => (
          <div className="grid min-w-0 gap-3 sm:grid-cols-[7rem_minmax(0,1fr)_auto] sm:items-end" key={language}>
            <div>
              <Label htmlFor={`${kind}-${language}-language`}>Language</Label>
              <input className={inputClass} id={`${kind}-${language}-language`} readOnly value={language} />
            </div>
            <div>
              <Label htmlFor={`${kind}-${language}-value`}>{kind.slice(0, -1)}</Label>
              <input className={inputClass} id={`${kind}-${language}-value`} onChange={(event) => onChange({ ...values, [language]: event.target.value })} value={value} />
            </div>
            <Button aria-label={`Remove ${kind.toLowerCase()} for ${language}`} className="min-h-11 rounded-none" onClick={() => {
              const next = { ...values };
              delete next[language];
              onChange(next);
            }} type="button" variant="outline"><Trash2 aria-hidden="true" /></Button>
          </div>
        ))}
        <AddLanguage onAdd={(language) => onChange({ ...values, [language]: "" })} used={Object.keys(values)} />
      </div>
    </fieldset>
  );
}

function AddLanguage({ onAdd, used }: { onAdd: (language: string) => void; used: string[] }) {
  const id = useId();
  const [language, setLanguage] = useState("");
  return (
    <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
      <div className="min-w-0 flex-1">
        <Label htmlFor={id}>Add language code</Label>
        <input className={inputClass} id={id} onChange={(event) => setLanguage(event.target.value.toLowerCase())} pattern="[a-z0-9-]+" placeholder="e.g. en, de, akk-Latn" value={language} />
      </div>
      <Button className="min-h-11 rounded-none" disabled={!/^[a-z0-9]+(?:-[a-z0-9]+)*$/i.test(language) || used.includes(language)} onClick={() => { onAdd(language); setLanguage(""); }} type="button" variant="outline"><Plus aria-hidden="true" /> Add language</Button>
    </div>
  );
}

function AliasesEditor({ values, onChange }: { values: Record<string, string[]>; onChange: (values: Record<string, string[]>) => void }) {
  return (
    <fieldset className="border border-border p-4 sm:p-5">
      <legend className="px-2 font-heading text-xl font-medium">Aliases</legend>
      <div className="space-y-5">
        {Object.entries(values).sort(([a], [b]) => a.localeCompare(b)).map(([language, aliases]) => (
          <div className="border-l-2 border-border pl-4" key={language}>
            <div className="flex items-center justify-between gap-3"><p className="font-medium">{language}</p><Button aria-label={`Remove all aliases for ${language}`} onClick={() => { const next = { ...values }; delete next[language]; onChange(next); }} size="sm" type="button" variant="outline">Remove language</Button></div>
            <div className="mt-3 space-y-2">
              {aliases.map((alias, index) => <div className="flex gap-2" key={`${language}-${index}`}><input aria-label={`Alias ${index + 1} for ${language}`} className="min-h-11 min-w-0 flex-1 border border-input bg-background px-3 text-base md:text-sm" onChange={(event) => onChange({ ...values, [language]: aliases.map((item, itemIndex) => itemIndex === index ? event.target.value : item) })} value={alias} /><Button aria-label={`Remove alias ${index + 1} for ${language}`} className="min-h-11 rounded-none" onClick={() => onChange({ ...values, [language]: aliases.filter((_, itemIndex) => itemIndex !== index) })} type="button" variant="outline"><Trash2 aria-hidden="true" /></Button></div>)}
              <Button onClick={() => onChange({ ...values, [language]: [...aliases, ""] })} type="button" variant="outline"><Plus aria-hidden="true" /> Add alias</Button>
            </div>
          </div>
        ))}
        <AddLanguage onAdd={(language) => onChange({ ...values, [language]: [""] })} used={Object.keys(values)} />
      </div>
    </fieldset>
  );
}

function ValueEditor({ snak, onChange, readOnly }: { snak: EditableSnak; onChange: (snak: EditableSnak) => void; readOnly: boolean }) {
  if (snak.snaktype !== "value") return <p className="mt-3 text-sm text-muted-foreground">This statement intentionally has {snak.snaktype === "somevalue" ? "an unknown value" : "no value"}.</p>;
  const value = snak.value ?? defaultValue(snak.datatype);
  const setValue = (next: MetadataValue) => onChange({ ...snak, value: next });
  if (value.kind === "unsupported") return <div><p className="text-sm text-muted-foreground">This stored value shape is not safely editable and is preserved read only.</p><pre className="mt-2 max-h-48 overflow-auto border border-border bg-card p-3 text-xs break-words whitespace-pre-wrap">{JSON.stringify(value.raw, null, 2)}</pre></div>;
  if (value.kind === "string") return <div><Label>Value</Label><input aria-label="Statement value" className={inputClass} disabled={readOnly} inputMode={snak.datatype === "url" ? "url" : "text"} onChange={(event) => setValue({ ...value, value: event.target.value })} value={value.value} /></div>;
  if (value.kind === "entity") return <div><Label>Entity ID</Label><input aria-label="Entity ID" className={`${inputClass} font-mono uppercase`} disabled={readOnly} onChange={(event) => setValue({ ...value, id: event.target.value.toUpperCase() })} placeholder={value.entityType === "property" ? "P123" : "Q123"} value={value.id} /></div>;
  if (value.kind === "monolingualtext") return <div className="grid gap-3 sm:grid-cols-[8rem_minmax(0,1fr)]"><div><Label>Language</Label><input aria-label="Monolingual text language" className={inputClass} disabled={readOnly} onChange={(event) => setValue({ ...value, language: event.target.value })} value={value.language} /></div><div><Label>Text</Label><input aria-label="Monolingual text" className={inputClass} disabled={readOnly} onChange={(event) => setValue({ ...value, text: event.target.value })} value={value.text} /></div></div>;
  if (value.kind === "time") return <div className="grid gap-3 sm:grid-cols-2"><Field label="Time" value={value.time} onChange={(next) => setValue({ ...value, time: next })} readOnly={readOnly} /><NumberField label="Precision" value={value.precision} onChange={(next) => setValue({ ...value, precision: next })} readOnly={readOnly} /><NumberField label="Before" value={value.before} onChange={(next) => setValue({ ...value, before: next })} readOnly={readOnly} /><NumberField label="After" value={value.after} onChange={(next) => setValue({ ...value, after: next })} readOnly={readOnly} /><Field label="Calendar model" value={value.calendarModel} onChange={(next) => setValue({ ...value, calendarModel: next })} readOnly={readOnly} /></div>;
  if (value.kind === "quantity") return <div className="grid gap-3 sm:grid-cols-2"><Field label="Amount" value={value.amount} onChange={(next) => setValue({ ...value, amount: next })} readOnly={readOnly} /><Field label="Unit (1 or entity URI)" value={value.unit} onChange={(next) => setValue({ ...value, unit: next })} readOnly={readOnly} /><Field label="Lower bound (optional)" value={value.lowerBound ?? ""} onChange={(next) => setValue({ ...value, lowerBound: next || undefined })} readOnly={readOnly} /><Field label="Upper bound (optional)" value={value.upperBound ?? ""} onChange={(next) => setValue({ ...value, upperBound: next || undefined })} readOnly={readOnly} /></div>;
  return <div className="grid gap-3 sm:grid-cols-2"><NumberField label="Latitude" value={value.latitude} onChange={(next) => setValue({ ...value, latitude: next })} readOnly={readOnly} /><NumberField label="Longitude" value={value.longitude} onChange={(next) => setValue({ ...value, longitude: next })} readOnly={readOnly} /><NumberField label="Precision" value={value.precision} onChange={(next) => setValue({ ...value, precision: next })} readOnly={readOnly} /><Field label="Globe" value={value.globe} onChange={(next) => setValue({ ...value, globe: next })} readOnly={readOnly} /></div>;
}

function Field({ label, value, onChange, readOnly }: { label: string; value: string; onChange: (value: string) => void; readOnly: boolean }) {
  const [pendingValue, setPendingValue] = useState(value);
  if (label === "Add site key") {
    return <div><Label htmlFor="new-sitelink-site">Add site key</Label><div className="mt-2 flex flex-col gap-2 sm:flex-row"><input className={`${inputClass} mt-0`} id="new-sitelink-site" onChange={(event) => setPendingValue(event.target.value)} placeholder="e.g. enwiki" value={pendingValue} /><Button className="min-h-11 rounded-none" disabled={!pendingValue.trim()} onClick={() => { onChange(pendingValue.trim()); setPendingValue(""); }} type="button" variant="outline"><Plus aria-hidden="true" /> Add sitelink</Button></div></div>;
  }
  return <div><Label>{label}</Label><input aria-label={label} className={inputClass} disabled={readOnly} onChange={(event) => onChange(event.target.value)} value={value} /></div>;
}

function NumberField({ label, value, onChange, readOnly }: { label: string; value: number; onChange: (value: number) => void; readOnly: boolean }) {
  return <div><Label>{label}</Label><input aria-label={label} className={inputClass} disabled={readOnly} onChange={(event) => onChange(Number(event.target.value))} step="any" type="number" value={value} /></div>;
}

function SnakEditor({ snak, definition, onChange }: { snak: EditableSnak; definition?: PropertyDefinition; onChange: (snak: EditableSnak) => void }) {
  const readOnly = definition?.supported === false;
  return <div className="min-w-0 space-y-3"><div className="grid gap-3 sm:grid-cols-[12rem_minmax(0,1fr)]"><div><Label>Value state</Label><select aria-label="Value state" className={selectClass} disabled={readOnly} onChange={(event) => { const snaktype = event.target.value as EditableSnak["snaktype"]; onChange({ ...snak, snaktype, value: snaktype === "value" ? (snak.value ?? defaultValue(snak.datatype)) : undefined }); }} value={snak.snaktype}><option value="value">Value</option><option value="somevalue">Unknown value</option><option value="novalue">No value</option></select></div><div><p className="text-sm font-medium">Datatype</p><p className="mt-3 break-words font-mono text-sm">{snak.datatype}</p></div></div>{readOnly ? <p className="border-l-2 border-border pl-3 text-sm text-muted-foreground">Read only: {definition?.readOnlyReason ?? "This datatype is not supported safely."}</p> : <ValueEditor onChange={onChange} readOnly={false} snak={snak} />}</div>;
}

function PropertyAdder({ label, definitions, onAdd, resolveProperty }: { label: string; definitions: Record<string, PropertyDefinition>; onAdd: (definition: PropertyDefinition) => void; resolveProperty: (property: string) => Promise<PropertyDefinition | undefined> }) {
  const id = useId();
  const [property, setProperty] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  return <div className="flex flex-col gap-2 sm:flex-row sm:items-end"><div className="min-w-0 flex-1"><Label htmlFor={id}>{label}</Label><input aria-describedby={error ? `${id}-error` : undefined} aria-invalid={Boolean(error)} className={`${inputClass} font-mono uppercase`} id={id} list={`${id}-properties`} onChange={(event) => { setProperty(event.target.value.toUpperCase()); setError(""); }} placeholder="P123" value={property} /><datalist id={`${id}-properties`}>{Object.values(definitions).map((definition) => <option key={definition.id} value={definition.id}>{definition.label}</option>)}</datalist>{error ? <p className="mt-2 text-sm text-destructive" id={`${id}-error`} role="alert">{error}</p> : null}</div><Button className="min-h-11 rounded-none" disabled={busy || !/^P[1-9]\d*$/.test(property)} onClick={async () => { setBusy(true); const definition = definitions[property] ?? await resolveProperty(property); setBusy(false); if (!definition) { setError("FactGrid did not return a definition for this property."); return; } onAdd(definition); setProperty(""); }} type="button" variant="outline">{busy ? <LoaderCircle aria-hidden="true" className="animate-spin" /> : <Plus aria-hidden="true" />} Add</Button></div>;
}

function flattenSnaks(snaks: Record<string, EditableSnak[]>, order: string[]): EditableSnak[] {
  const ordered = [...new Set([...order, ...Object.keys(snaks)])];
  return ordered.flatMap((property) => snaks[property] ?? []);
}

function groupSnaks(snaks: EditableSnak[]): { values: Record<string, EditableSnak[]>; order: string[] } {
  const values: Record<string, EditableSnak[]> = {};
  for (const snak of snaks) (values[snak.property] ??= []).push(snak);
  return { values, order: [...new Set(snaks.map((snak) => snak.property))] };
}

function SnakList({ title, snaks, definitions, onChange, resolveProperty }: { title: string; snaks: EditableSnak[]; definitions: Record<string, PropertyDefinition>; onChange: (snaks: EditableSnak[]) => void; resolveProperty: (property: string) => Promise<PropertyDefinition | undefined> }) {
  return <fieldset className="border-l-2 border-border pl-4"><legend className="px-2 text-sm font-semibold">{title}</legend><div className="space-y-4">{snaks.map((snak, index) => <div className="min-w-0 border-t border-border pt-4" key={`${snak.property}-${index}`}><div className="mb-3 flex flex-wrap items-center justify-between gap-2"><p className="break-words text-sm font-medium">{propertyName(definitions, snak.property)}</p><Button aria-label={`Remove ${title.toLowerCase()} ${propertyName(definitions, snak.property)}`} onClick={() => onChange(snaks.filter((_, itemIndex) => itemIndex !== index))} size="sm" type="button" variant="outline"><Trash2 aria-hidden="true" /> Remove</Button></div><SnakEditor definition={definitions[snak.property]} onChange={(next) => onChange(snaks.map((item, itemIndex) => itemIndex === index ? next : item))} snak={snak} /></div>)}<PropertyAdder definitions={definitions} label={`Add ${title.toLowerCase()} property`} onAdd={(definition) => onChange([...snaks, defaultSnak(definition)])} resolveProperty={resolveProperty} /></div></fieldset>;
}

function StatementEditor({ statement, index, definitions, onChange, onRemove, resolveProperty }: { statement: EditableStatement; index: number; definitions: Record<string, PropertyDefinition>; onChange: (statement: EditableStatement) => void; onRemove: () => void; resolveProperty: (property: string) => Promise<PropertyDefinition | undefined> }) {
  const name = propertyName(definitions, statement.mainsnak.property);
  const allSnaks = [statement.mainsnak, ...flattenSnaks(statement.qualifiers, statement.qualifierOrder), ...statement.references.flatMap((reference) => flattenSnaks(reference.snaks, reference.snaksOrder))];
  const mainDefinition = definitions[statement.mainsnak.property];
  const readOnly = mainDefinition?.supported === false || allSnaks.some((snak) => definitions[snak.property]?.supported === false || snak.value?.kind === "unsupported");
  return <fieldset className="min-w-0 border border-border p-4 sm:p-6" disabled={readOnly}><legend className="max-w-full break-words px-2 font-heading text-xl font-medium">{name}</legend>{readOnly ? <p className="mb-4 border-l-2 border-border pl-3 text-sm text-muted-foreground">This statement contains an unsupported value or lacks a stable FactGrid statement ID, so it is preserved read only.</p> : null}<div className="flex flex-wrap items-end justify-between gap-3"><div className="w-full max-w-52"><Label htmlFor={`statement-${index}-rank`}>Rank</Label><select className={selectClass} id={`statement-${index}-rank`} onChange={(event) => onChange({ ...statement, rank: event.target.value as EditableStatement["rank"] })} value={statement.rank}><option value="preferred">Preferred</option><option value="normal">Normal</option><option value="deprecated">Deprecated</option></select></div><Button aria-label={`Remove statement ${name}`} className="min-h-11 rounded-none" onClick={onRemove} type="button" variant="destructive"><Trash2 aria-hidden="true" /> Remove statement</Button></div><div className="mt-5"><SnakEditor definition={definitions[statement.mainsnak.property]} onChange={(mainsnak) => onChange({ ...statement, mainsnak })} snak={statement.mainsnak} /></div><div className="mt-6 space-y-6"><SnakList definitions={definitions} onChange={(snaks) => { const grouped = groupSnaks(snaks); onChange({ ...statement, qualifiers: grouped.values, qualifierOrder: grouped.order }); }} resolveProperty={resolveProperty} snaks={flattenSnaks(statement.qualifiers, statement.qualifierOrder)} title="Qualifiers" /><fieldset className="space-y-5 border-l-2 border-border pl-4"><legend className="px-2 text-sm font-semibold">References</legend>{statement.references.map((reference, referenceIndex) => <div className="border-t border-border pt-4" key={reference.hash ?? `new-${referenceIndex}`}><div className="mb-3 flex justify-end"><Button aria-label={`Remove reference ${referenceIndex + 1} from ${name}`} onClick={() => onChange({ ...statement, references: statement.references.filter((_, indexToKeep) => indexToKeep !== referenceIndex) })} size="sm" type="button" variant="outline"><Trash2 aria-hidden="true" /> Remove reference</Button></div><SnakList definitions={definitions} onChange={(snaks) => { const grouped = groupSnaks(snaks); onChange({ ...statement, references: statement.references.map((item, itemIndex) => itemIndex === referenceIndex ? { ...item, snaks: grouped.values, snaksOrder: grouped.order } : item) }); }} resolveProperty={resolveProperty} snaks={flattenSnaks(reference.snaks, reference.snaksOrder)} title={`Reference ${referenceIndex + 1} values`} /></div>)}<Button onClick={() => onChange({ ...statement, references: [...statement.references, { snaks: {}, snaksOrder: [] }] })} type="button" variant="outline"><Plus aria-hidden="true" /> Add reference</Button></fieldset></div></fieldset>;
}

function ReviewDialog({ changes, catalogueChange, onCancel, onConfirm }: { changes: string[]; catalogueChange: boolean; onCancel: () => void; onConfirm: () => void }) {
  const confirmRef = useRef<HTMLButtonElement>(null);
  useEffect(() => { confirmRef.current?.focus(); }, []);
  return <div aria-labelledby="change-review-title" aria-modal="true" className="fixed inset-0 z-50 grid place-items-center overflow-y-auto bg-foreground/45 p-4" onKeyDown={(event) => { if (event.key === "Escape") onCancel(); }} role="dialog"><div className="w-full max-w-2xl border border-border bg-background p-5 shadow-xl sm:p-7"><h3 className="font-heading text-2xl font-medium" id="change-review-title">Review changes before saving</h3><p className="mt-2 text-sm leading-6 text-muted-foreground">These changes will be written to the authoritative FactGrid item under your signed-in identity.</p>{catalogueChange ? <Alert className="mt-4 rounded-none" variant="destructive"><AlertTriangle aria-hidden="true" /><AlertTitle>Catalogue membership may change</AlertTitle><AlertDescription>This edit changes the tablet classification (P2) and could remove the record from this catalogue.</AlertDescription></Alert> : null}<ul className="mt-5 max-h-72 list-disc space-y-2 overflow-y-auto pl-5 text-sm">{changes.map((change, index) => <li className="break-words" key={`${change}-${index}`}>{change}</li>)}</ul><div className="mt-6 flex flex-wrap justify-end gap-3"><Button onClick={onCancel} type="button" variant="outline">Keep editing</Button><Button onClick={onConfirm} ref={confirmRef} type="button">Confirm and save</Button></div></div></div>;
}

export function MetadataEditor({ qid, csrfToken, initialModel }: { qid: string; csrfToken: string; initialModel: MetadataModel }) {
  const router = useRouter();
  const errorRef = useRef<HTMLDivElement>(null);
  const [baseline, setBaseline] = useState(() => cloneEntity(initialModel.entity));
  const [draft, setDraft] = useState(() => cloneEntity(initialModel.entity));
  const [properties, setProperties] = useState(initialModel.properties);
  const [summary, setSummary] = useState("");
  const [saveState, setSaveState] = useState<SaveState>({ status: "idle" });
  const [reviewing, setReviewing] = useState(false);
  const operations = useMemo(() => buildMetadataOperations(baseline, draft), [baseline, draft]);
  const dirty = operations.length > 0;

  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  async function resolveProperty(property: string): Promise<PropertyDefinition | undefined> {
    try {
      const response = await fetch(`/api/tablets/${encodeURIComponent(qid)}/metadata?properties=${encodeURIComponent(property)}`, { cache: "no-store" });
      if (!response.ok) return undefined;
      const body = await response.json() as MetadataModel;
      setProperties((current) => ({ ...current, ...body.properties }));
      return body.properties[property];
    } catch { return undefined; }
  }

  const changeDescriptions = operations.map((operation) => {
    if (operation.type === "set-label") return `${operation.value ? "Set" : "Remove"} ${operation.language} label`;
    if (operation.type === "set-description") return `${operation.value ? "Set" : "Remove"} ${operation.language} description`;
    if (operation.type === "set-aliases") return `Update ${operation.language} aliases`;
    if (operation.type === "set-sitelink") return `${operation.title ? "Set" : "Remove"} ${operation.site} sitelink`;
    if (operation.type === "remove-statement") return `Remove statement ${operation.statementId}`;
    if ("statement" in operation) return `${operation.statement.id ? "Update" : "Add"} ${propertyName(properties, operation.statement.mainsnak.property)} statement`;
    return "Update metadata";
  });
  const catalogueChange = operations.some((operation) => operation.type === "upsert-statement" && operation.statement.mainsnak.property === "P2" || operation.type === "remove-statement" && baseline.statements.find((statement) => statement.id === operation.statementId)?.mainsnak.property === "P2");

  async function save() {
    if (!dirty || saveState.status === "saving") return;
    setReviewing(false);
    setSaveState({ status: "saving" });
    try {
      const response = await fetch(`/api/tablets/${encodeURIComponent(qid)}/metadata`, { method: "PUT", headers: { "Content-Type": "application/json", "X-CSRF-Token": csrfToken }, body: JSON.stringify({ baseRevision: baseline.lastRevision, summary, confirmRemovals: operations.some((operation) => operation.type === "remove-statement" || operation.type === "upsert-statement" || operation.type === "set-aliases" && operation.values.length === 0 || operation.type === "set-sitelink" && operation.title === null || (operation.type === "set-label" || operation.type === "set-description") && operation.value === null), confirmCatalogueRemoval: catalogueChange, operations }) });
      const body = await response.json().catch(() => ({})) as { entity?: EditableEntity; properties?: Record<string, PropertyDefinition>; revisionId?: number; message?: string; saveStatus?: "unknown" | "partial"; error?: { message?: string } };
      const message = body.message ?? body.error?.message;
      if (response.status === 409) { setSaveState({ status: "conflict", message: message ?? "FactGrid has a newer revision. Your draft is preserved; reload and reapply it deliberately." }); requestAnimationFrame(() => errorRef.current?.focus()); return; }
      if (body.saveStatus === "unknown") { setSaveState({ status: "unknown", message: message ?? "FactGrid did not conclusively confirm this save. Your draft is preserved; check item history before retrying." }); requestAnimationFrame(() => errorRef.current?.focus()); return; }
      if (!response.ok || !body.entity) { setSaveState({ status: body.saveStatus === "partial" ? "partial" : "error", message: message ?? "FactGrid did not confirm the metadata save. Your draft is preserved." }); requestAnimationFrame(() => errorRef.current?.focus()); return; }
      const confirmed = cloneEntity(body.entity);
      setBaseline(confirmed); setDraft(cloneEntity(confirmed)); setProperties((current) => ({ ...current, ...body.properties })); setSummary(""); setSaveState({ status: "saved", message: body.message ?? `Saved as entity revision ${body.revisionId ?? confirmed.lastRevision}.` }); router.refresh();
    } catch { setSaveState({ status: "unknown", message: "The response was interrupted, so the save status is unknown. Your draft is preserved; check FactGrid history before retrying." }); requestAnimationFrame(() => errorRef.current?.focus()); }
  }

  return <section aria-labelledby="metadata-editor-title" id="metadata-draft" className="scroll-mt-28"><div className="flex flex-wrap items-end justify-between gap-3"><div><h2 className="font-heading text-3xl font-medium" id="metadata-editor-title">Edit metadata</h2><p className="mt-2 max-w-[72ch] text-sm leading-6 text-muted-foreground">Edit the complete FactGrid entity. IDs are preserved; unsupported datatypes remain visible and read only.</p></div><p className="font-mono text-xs text-muted-foreground">Revision {baseline.lastRevision}</p></div><div className="mt-7 space-y-7"><TermRows kind="Labels" onChange={(labels) => setDraft({ ...draft, labels })} values={draft.labels} /><TermRows kind="Descriptions" onChange={(descriptions) => setDraft({ ...draft, descriptions })} values={draft.descriptions} /><AliasesEditor onChange={(aliases) => setDraft({ ...draft, aliases })} values={draft.aliases} /><fieldset className="border border-border p-4 sm:p-5"><legend className="px-2 font-heading text-xl font-medium">Sitelinks</legend><div className="space-y-4">{Object.entries(draft.sitelinks).sort(([a], [b]) => a.localeCompare(b)).map(([site, value]) => <div className="grid min-w-0 gap-3 sm:grid-cols-[10rem_minmax(0,1fr)_auto] sm:items-end" key={site}><Field label="Site" onChange={() => undefined} readOnly value={site} /><Field label={`Title on ${site}`} onChange={(title) => setDraft({ ...draft, sitelinks: { ...draft.sitelinks, [site]: { ...value, title } } })} readOnly={false} value={value.title} /><Button aria-label={`Remove ${site} sitelink`} className="min-h-11 rounded-none" onClick={() => { const sitelinks = { ...draft.sitelinks }; delete sitelinks[site]; setDraft({ ...draft, sitelinks }); }} type="button" variant="outline"><Trash2 aria-hidden="true" /></Button></div>)}<div className="grid gap-3 sm:grid-cols-2"><Field label="Add site key" onChange={(site) => setDraft({ ...draft, sitelinks: site && !draft.sitelinks[site] ? { ...draft.sitelinks, [site]: { title: "", badges: [] } } : draft.sitelinks })} readOnly={false} value="" /></div></div></fieldset><section aria-labelledby="statements-title"><h3 className="font-heading text-2xl font-medium" id="statements-title">Statements</h3><p className="mt-2 text-sm text-muted-foreground">Multiple values, ranks, qualifiers, and references are preserved for each property.</p><div className="mt-5 space-y-6">{draft.statements.map((statement, index) => <StatementEditor definitions={properties} index={index} key={statement.id ?? `new-${index}`} onChange={(next) => setDraft({ ...draft, statements: draft.statements.map((item, itemIndex) => itemIndex === index ? next : item) })} onRemove={() => setDraft({ ...draft, statements: draft.statements.filter((_, itemIndex) => itemIndex !== index) })} resolveProperty={resolveProperty} statement={statement} />)}<PropertyAdder definitions={properties} label="Add statement property" onAdd={(definition) => setDraft({ ...draft, statements: [...draft.statements, { rank: "normal", mainsnak: defaultSnak(definition), qualifiers: {}, qualifierOrder: [], references: [] }] })} resolveProperty={resolveProperty} /></div></section><div><Label htmlFor="metadata-summary">Edit summary</Label><input className={inputClass} id="metadata-summary" maxLength={255} onChange={(event) => setSummary(event.target.value)} placeholder="Briefly describe these metadata changes" value={summary} /></div></div>{saveState.status !== "idle" && saveState.status !== "saving" ? <div className="mt-6" ref={errorRef} tabIndex={saveState.status === "saved" ? undefined : -1}><Alert className="rounded-none" variant={saveState.status === "saved" ? "default" : "destructive"}><>{saveState.status === "saved" ? <Check aria-hidden="true" /> : <AlertTriangle aria-hidden="true" />}</><AlertTitle>{saveState.status === "saved" ? "Save confirmed" : saveState.status === "conflict" ? "Revision conflict" : saveState.status === "partial" ? "Save partly completed" : "Draft not cleared"}</AlertTitle><AlertDescription>{saveState.message}</AlertDescription></Alert></div> : null}<div className="mt-6 flex flex-wrap items-center gap-3"><Button aria-busy={saveState.status === "saving"} className="min-h-11 rounded-none" disabled={!dirty || saveState.status === "saving"} onClick={() => setReviewing(true)} type="button">{saveState.status === "saving" ? <><LoaderCircle aria-hidden="true" className="animate-spin" /> Saving…</> : "Review and save"}</Button><Button className="min-h-11 rounded-none" disabled={!dirty || saveState.status === "saving"} onClick={() => { setDraft(cloneEntity(baseline)); setSummary(""); setSaveState({ status: "idle" }); }} type="button" variant="outline">Discard metadata changes</Button><span aria-live="polite" className="text-sm text-muted-foreground" role="status">{saveState.status === "saving" ? "Saving metadata to FactGrid…" : dirty ? `${operations.length} unsaved metadata change${operations.length === 1 ? "" : "s"}` : `Metadata synchronized at revision ${baseline.lastRevision}`}</span></div>{reviewing ? <ReviewDialog catalogueChange={catalogueChange} changes={changeDescriptions} onCancel={() => setReviewing(false)} onConfirm={save} /> : null}</section>;
}
