/** Deterministic read-only generator provider; never permits real network access. */
const uri = (id) => ({ type: "uri", value: `https://database.factgrid.de/entity/${id}` });
const literal = (value) => ({ type: "literal", value: String(value) });
globalThis.fetch = async (input, init) => {
  const url = new URL(String(input));
  if (url.origin !== "https://database.factgrid.de") throw new Error("Unexpected provider origin");
  if (url.pathname === "/w/api.php") {
    const entities = Object.fromEntries(url.searchParams.get("ids").split("|").map((id) => [id, {
      id, labels: { de: { value: "Sammlung" } }, aliases: { en: [{ value: "University of Jena" }] },
    }]));
    return Response.json({ entities });
  }
  const query = new URLSearchParams(init.body).get("query");
  let bindings;
  if (query.includes("?class wdt:P3*")) bindings = [{ class: uri("Q512006") }];
  else if (query.includes("COUNT(DISTINCT ?item)")) bindings = [{ count: literal(2) }];
  else if (query.includes("SELECT DISTINCT ?item")) {
    const after = query.match(/FILTER\(STR\(\?item\) > "https:\/\/database.factgrid.de\/entity\/(Q[0-9]+)"\)/u)?.[1] || "";
    const limit = Number(query.match(/LIMIT ([0-9]+)/u)?.[1] || 1);
    bindings = ["Q100001", "Q100002"].filter((id) => id > after).slice(0, limit).map((id) => ({ item: uri(id) }));
  } else {
    if (process.env.CATALOGUE_TEST_FAIL === "metadata") return Response.json({ malformed: true });
    if (!query.includes("pq:P10") || !query.includes("ps:P11") || !query.includes("skos:altLabel")) throw new Error("Incomplete metadata projection");
    const ids = [...query.matchAll(/wd:(Q10000[12])/gu)].map((match) => match[1]);
    bindings = ids.map((id) => ({ item: uri(id), collection: literal("https://database.factgrid.de/entity/Q900"),
      findspot: literal(""), period: literal(""), language: literal(""), workType: literal(""), material: literal(""),
      labelCode: literal(`0 Tablet ${id}`), terms: literal(`P11 title ${id} qualifier inventory HS 751 alias`),
    }));
  }
  return Response.json({ results: { bindings } });
};
