# FactGrid adapter fixtures

Except for the explicitly named `live-q894483-entity.json` and
`live-q894483-document.json` captures, these are fabricated test data. Q9000001,
Q9000002, and the derived Q9000003/Q9000004 browser fixtures must not be
presented as live FactGrid records. The shapes mirror the verified
Wikibase and MediaWiki API contracts and cover sparse records, local and
external transcripts, multiple editions, invalid P251 targets, and lossless
transcript splicing. The browser fixture derives Q9000003 from the sparse record
and adds a P251 link to a missing canonical document to verify authenticated
transcription creation and anonymous access denial.

The two HS 751 files were retrieved read-only on 13 November 2026. They preserve
item revision 20736312 and document revision 20109826, including the exact ATF
poem. They are source regression fixtures, not an assertion that live revisions
remain unchanged. Related labels prefixed `TEST FIXTURE` in the browser preload
are synthetic presentation values, not observed FactGrid labels.

`catalogue-index.json` is a deliberately small synthetic discovery index. Its
`complete` flag means complete for this fixture set only, never for FactGrid.
The preload forces this path so browser tests cannot accidentally use an
operator's live index. Q9100001–Q9100025 and Q9200001–Q9300060 model pagination,
off-page values, and large facet lists; none is a claimed live record.
