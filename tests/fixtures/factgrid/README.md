# FactGrid adapter fixtures

Every record in this directory is fabricated test data. Q9000001, Q9000002, and
the derived Q9000003 browser fixture must not be presented as live FactGrid records. The shapes mirror the verified
Wikibase and MediaWiki API contracts and cover sparse records, local and
external transcripts, multiple editions, invalid P251 targets, and lossless
transcript splicing. The browser fixture derives Q9000003 from the sparse record
and adds a P251 link to a missing canonical document to verify authenticated
transcription creation and anonymous access denial.
