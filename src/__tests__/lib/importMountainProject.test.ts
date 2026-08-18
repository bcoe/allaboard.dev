/**
 * @jest-environment node
 *
 * Turning a Mountain Project export into outdoor day notes.
 *
 * `SAMPLE_EXPORT` below is a stub, written to look like what Mountain Project
 * actually produces rather than like convenient test data. It carries every awkward
 * shape observed in a real 724-row export: a header whose column *names* matter
 * more than their positions, quoted fields containing commas, protection suffixes,
 * slash grades, bare `+`/`-` modifiers, all five lead styles, boulders that record
 * success in a different column, and a row with an unusable date.
 *
 * It also covers a case the real export happened not to contain — a single day of
 * both routes and boulders, which must become two notes.
 *
 * The one thing a stub cannot do is notice Mountain Project changing their export
 * format. If an import ever starts dropping rows, compare a fresh export's header
 * against `EXPORT_HEADER` first.
 */

import {
  buildMountainProjectNotes,
  normaliseVScale,
  normaliseYds,
  parseCsv,
} from "@/lib/server/importMountainProject";

/** The export's header, verbatim — including which names are quoted. */
const EXPORT_HEADER =
  'Date,Route,Rating,Notes,URL,Pitches,Location,"Avg Stars","Your Stars",Style,"Lead Style","Route Type","Your Rating",Length,"Rating Code"';

/**
 * A stand-in export. Fields, in order:
 *
 *   Date, Route, Rating, Notes, URL, Pitches, Location, Avg Stars, Your Stars,
 *   Style, Lead Style, Route Type, Your Rating, Length, Rating Code
 *
 * `Rating Code` values are real ones, because the grouping rules use them to order
 * difficulty and they interleave slash grades between whole grades.
 */
const SAMPLE_EXPORT = [
  EXPORT_HEADER,

  // A boulder with no recorded style at all: still a session, but claims nothing.
  "2016-11-16,Unknown Problem,V4,,,1,Bishop,3.5,,,,Boulder,,,20400",

  // `Solo` on a boulder denotes an ascent, not an attempt.
  "2018-07-04,Midnight Lightning,V7,,,1,Camp 4,4.0,4,Solo,,Boulder,,,20700",

  // Four boulders. The hardest send carries a protection suffix, and the quoted
  // Notes field contains a comma — a naive split would shift every later column.
  '2023-05-29,The Mandala,V7 PG13,"Crimpy, committing",,1,Bishop,4.0,4,Send,,Boulder,,,20700',
  "2023-05-29,Iron Man Traverse,V4,,,1,Bishop,3.5,3,Send,,Boulder,,,20400",
  "2023-05-29,Sunshine Boulder,V3,,,1,Bishop,3.0,3,Flash,,Boulder,,,20300",
  "2023-05-29,Green Wall Essential,V6-,,,1,Bishop,3.5,,Send,,Boulder,,,20570",

  // Four projects and one onsight. Under a Redpoint-only rule this day would
  // report no send at all, despite a clean onsight.
  "2023-10-01,Slab Route,5.12a/b,,,1,Rifle,3.0,3,Lead,Fell/Hung,Sport,,,6800",
  "2023-10-01,Project A,5.13a,,,1,Rifle,4.0,,Lead,Fell/Hung,Sport,,,8600",
  "2023-10-01,Project B,5.13a,,,1,Rifle,4.0,,Lead,Fell/Hung,Sport,,,8600",
  "2023-10-01,Warmup,5.12a,,,1,Rifle,3.0,3,Lead,Fell/Hung,Sport,,,6600",
  "2023-10-01,Clean Send,5.10d,,,1,Rifle,3.0,4,Lead,Onsight,Sport,,,3500",

  // Nothing went down; the middle row has no lead style at all.
  "2026-05-03,Hard One,5.12b,,,1,Rifle,3.5,,Lead,Fell/Hung,Sport,,,6900",
  "2026-05-03,Unlabelled,5.13c,,,2,Rifle,4.0,,Lead,,Sport,,,9200",
  "2026-05-03,Another,5.11d,,,1,Rifle,3.0,,Lead,Fell/Hung,Sport,,,5500",

  // Two redpoints and a multi-pitch project: the send is the harder redpoint.
  "2026-05-26,Big Project,5.13c,,,2,Rifle,4.0,,Lead,Fell/Hung,Sport,,,9200",
  "2026-05-26,Sent It,5.11d,,,1,Rifle,3.5,4,Lead,Redpoint,Sport,,,5500",
  "2026-05-26,Also Sent,5.11c,,,1,Rifle,3.0,3,Lead,Redpoint,Sport,,,5200",

  // Every awkward grade shape, plus the two lead styles beyond redpoint/onsight.
  "2026-06-01,Plus Grade,5.10+,,,1,Smith Rock,3.0,3,Lead,Redpoint,Sport,,,3300",
  "2026-06-01,Minus Grade,5.14-,,,1,Smith Rock,4.0,,Lead,Fell/Hung,Sport,,,10600",
  "2026-06-01,Old School,5.9-,,,1,Smith Rock,2.5,3,Lead,Onsight,Sport,,,2300",
  "2026-06-01,Pinked It,5.12c,,,1,Smith Rock,3.5,4,Lead,Pinkpoint,Sport,,,7200",
  "2026-06-01,Flashed It,5.11a/b,,,1,Smith Rock,3.0,4,Lead,Flash,Sport,,,4800",

  // One day, both kinds of climbing — two notes. The route type is itself a
  // quoted field containing a comma.
  '2026-06-15,Mixed Route,5.11a,,,1,Joshua Tree,3.0,3,Lead,Redpoint,"Sport, TR",,,4600',
  "2026-06-15,Mixed Boulder,V5,,,1,Joshua Tree,3.5,4,Send,,Boulder,,,20500",

  // A toprope (neither sent nor worked) alongside a multi-pitch trad redpoint.
  "2026-07-01,Toproped,5.11a,,,1,Index,3.0,,TR,,Sport,,,4600",
  "2026-07-01,Trad Lead,5.8+ PG13,,,3,Index,3.0,3,Lead,Redpoint,Trad,,,2200",

  // Unusable date: skipped rather than guessed at.
  "notadate,Broken Row,5.11a,,,1,Nowhere,3.0,,Lead,Redpoint,Sport,,,4600",
  "",
].join("\n");

/** A minimal export with the real header, for one-off rows. */
function csv(...rows: string[]): string {
  return [EXPORT_HEADER, ...rows].join("\n");
}

/**
 * One row, named rather than positional.
 *
 * The focused tests below each turn on one field, and a bare 15-column string
 * makes it impossible to see which. Defaults describe an ordinary sport lead.
 */
const row = (o: {
  date: string;
  rating: string;
  pitches?: number;
  style?: string;
  leadStyle?: string;
  type?: string;
  code?: number;
}) =>
  [
    o.date,
    "A Route",
    o.rating,
    "",
    "",
    String(o.pitches ?? 1),
    "Somewhere",
    "3.0",
    "3",
    o.style ?? "Lead",
    o.leadStyle ?? "",
    o.type ?? "Sport",
    "",
    "",
    String(o.code ?? 1000),
  ].join(",");

describe("the export's own shape", () => {
  it("reads columns by header name, not by position", () => {
    // The spec for this feature placed Lead Style at column 9; a real export has
    // "Your Stars" there and Lead Style at 11. Reading by name is what makes that
    // a non-event rather than a silent mis-import.
    const header = parseCsv(SAMPLE_EXPORT)[0].map((h) => h.trim());

    expect(header[8]).toBe("Your Stars");
    expect(header[10]).toBe("Lead Style");
    expect(header.indexOf("Date")).toBe(0);
    expect(header.indexOf("Rating")).toBe(2);
    expect(header.indexOf("Pitches")).toBe(5);
  });

  it("keeps quoted fields containing commas intact", () => {
    // `Notes`, `Location` and even `Route Type` contain commas in a real export; a
    // naive split shifts every later column and quietly imports the wrong fields.
    const rows = parseCsv('a,b\n"one, two",three\n');
    expect(rows[1]).toEqual(["one, two", "three"]);
  });

  it("rejects a file that is not a Mountain Project export", () => {
    expect(() => buildMountainProjectNotes("foo,bar\n1,2\n")).toThrow(/Mountain Project/);
  });
});

describe("grade normalisation", () => {
  it("keeps grades the app already stores", () => {
    expect(normaliseYds("5.12c")).toBe("5.12c");
    expect(normaliseYds("5.11")).toBe("5.11");
    expect(normaliseVScale("V7")).toBe("V7");
    expect(normaliseVScale("V5+")).toBe("V5+");
  });

  it("strips protection suffixes", () => {
    expect(normaliseYds("5.8+ PG13")).toBe("5.8");
    expect(normaliseVScale("V7 PG13")).toBe("V7");
    expect(normaliseYds("5.11a R")).toBe("5.11a");
  });

  it("takes the lower half of a slash grade", () => {
    // Never overstate what someone climbed.
    expect(normaliseYds("5.12b/c")).toBe("5.12b");
    expect(normaliseYds("5.10a/b")).toBe("5.10a");
    expect(normaliseYds("5.13a/b")).toBe("5.13a");
  });

  it("resolves bare modifiers downward", () => {
    // 5.10+ scores 3300 in Mountain Project's own ordering — between 5.10c (3200)
    // and 5.10d (3500) — so 5.10c is the conservative reading.
    expect(normaliseYds("5.10+")).toBe("5.10c");
    expect(normaliseYds("5.14-")).toBe("5.14a");
    // Below 5.10 the scale has no letters, so the modifier just drops.
    expect(normaliseYds("5.9-")).toBe("5.9");
    expect(normaliseVScale("V6+")).toBe("V6");
    expect(normaliseVScale("V6-")).toBe("V6");
  });

  it("gives up rather than guessing at something unrecognisable", () => {
    expect(normaliseYds("5.16z")).toBeUndefined();
    expect(normaliseYds("hard")).toBeUndefined();
    expect(normaliseVScale("VB")).toBeUndefined();
  });

  it("maps every grade shape the export uses", () => {
    // If this fails, the export has a grade shape the rules do not cover, and the
    // affected days would silently lose their grades.
    const { skipped } = buildMountainProjectNotes(SAMPLE_EXPORT);
    expect(skipped.unknownGrade).toBe(0);
  });
});

describe("grouping a day", () => {
  it("adds the day's pitches together", () => {
    const plan = buildMountainProjectNotes(
      csv(
        row({ date: "2026-05-01", rating: "5.11a", pitches: 2 }),
        row({ date: "2026-05-01", rating: "5.10a", pitches: 1 }),
      ),
    );
    expect(plan.notes[0].data.pitchCount).toBe(3);
  });

  it("takes the hardest Redpoint as the day's send", () => {
    const plan = buildMountainProjectNotes(
      csv(
        row({ date: "2026-05-01", rating: "5.11c", leadStyle: "Redpoint", code: 5200 }),
        row({ date: "2026-05-01", rating: "5.11d", leadStyle: "Redpoint", code: 5500 }),
      ),
    );
    expect(plan.notes[0].data.hardestRouteSent).toBe("5.11d");
  });

  it("takes the hardest Fell/Hung as the day's project", () => {
    const plan = buildMountainProjectNotes(
      csv(
        row({ date: "2026-05-01", rating: "5.12a", leadStyle: "Fell/Hung", code: 6600 }),
        row({ date: "2026-05-01", rating: "5.13c", leadStyle: "Fell/Hung", code: 9200 }),
      ),
    );
    expect(plan.notes[0].data.hardestRouteWorked).toBe("5.13c");
  });

  it("leaves the send blank when nothing went down", () => {
    // A blank field says "not recorded"; a guess would say something false.
    const plan = buildMountainProjectNotes(
      csv(row({ date: "2026-05-01", rating: "5.13a", leadStyle: "Fell/Hung" })),
    );
    expect(plan.notes[0].data).not.toHaveProperty("hardestRouteSent");
    expect(plan.notes[0].data.hardestRouteWorked).toBe("5.13a");
  });

  it("counts an Onsight, Flash or Pinkpoint as a send", () => {
    // The spec named only Redpoint, but these are ascents too — an onsight is a
    // *harder* one. In the real export they are 56 rows across 43 days that would
    // otherwise have reported no send at all.
    for (const leadStyle of ["Onsight", "Flash", "Pinkpoint"]) {
      const plan = buildMountainProjectNotes(
        csv(row({ date: "2026-05-01", rating: "5.12a", leadStyle })),
      );
      expect(plan.notes[0].data.hardestRouteSent).toBe("5.12a");
    }
  });

  it("uses Style, not Lead Style, for boulders", () => {
    // Lead Style is always blank on a boulder row.
    const plan = buildMountainProjectNotes(
      csv(
        row({ date: "2026-05-01", rating: "V4", style: "Send", type: "Boulder", code: 20400 }),
        row({ date: "2026-05-01", rating: "V6", style: "Flash", type: "Boulder", code: 20600 }),
      ),
    );
    expect(plan.notes[0].category).toBe("outdoor_bouldering");
    expect(plan.notes[0].data.hardestBoulderSent).toBe("V6");
  });

  it("splits a day of routes and boulders into two notes", () => {
    const plan = buildMountainProjectNotes(
      csv(
        row({ date: "2026-05-01", rating: "5.11a", leadStyle: "Redpoint", code: 4600 }),
        row({ date: "2026-05-01", rating: "V4", style: "Send", type: "Boulder", code: 20400 }),
      ),
    );
    expect(plan.notes.map((n) => n.category).sort()).toEqual([
      "outdoor_bouldering",
      "outdoor_climbing",
    ]);
    // Boulder pitches never inflate a route session's pitch count.
    const climbing = plan.notes.find((n) => n.category === "outdoor_climbing")!;
    expect(climbing.data.pitchCount).toBe(1);
  });

  it("still records a session when no status is recognised", () => {
    // A top-roped or unlabelled day was still a day out; it just claims no grade.
    const plan = buildMountainProjectNotes(
      csv(row({ date: "2026-05-01", rating: "5.11a", style: "TR", pitches: 3 })),
    );
    expect(plan.notes[0].data).toEqual({ pitchCount: 3 });
  });

  it("skips a row with no usable date rather than inventing one", () => {
    const plan = buildMountainProjectNotes(csv(row({ date: "sometime", rating: "5.11a" })));
    expect(plan.notes).toHaveLength(0);
    expect(plan.skipped.unparsableDate).toBe(1);
  });
});

describe("a whole export, end to end", () => {
  const plan = buildMountainProjectNotes(SAMPLE_EXPORT);
  const on = (period: string, category: string) =>
    plan.notes.find((n) => n.period === period && n.category === category)?.data;

  it("reads every usable row and skips the one that is not", () => {
    expect(plan.rowsParsed).toBe(26);
    expect(plan.skipped.unparsableDate).toBe(1);
    expect(plan.skipped.unknownGrade).toBe(0);
  });

  it("produces one note per day per kind of climbing", () => {
    // 9 days: 6 with roped climbing, 4 with bouldering, one of which is both.
    expect(plan.notes).toHaveLength(10);
    expect(plan.notes.filter((n) => n.category === "outdoor_climbing")).toHaveLength(6);
    expect(plan.notes.filter((n) => n.category === "outdoor_bouldering")).toHaveLength(4);
  });

  it("summarises each day exactly", () => {
    // Spelled out rather than counted, so a change to any rule shows up here as a
    // readable diff of what a day now claims.
    expect(on("2023-10-01", "outdoor_climbing")).toEqual({
      pitchCount: 5,
      // The onsight, which a Redpoint-only rule would have missed entirely.
      hardestRouteSent: "5.10d",
      hardestRouteWorked: "5.13a",
    });

    expect(on("2026-05-03", "outdoor_climbing")).toEqual({
      pitchCount: 4,
      hardestRouteWorked: "5.12b",
      // Nothing went down, so no send is claimed at all.
    });

    expect(on("2026-05-26", "outdoor_climbing")).toEqual({
      pitchCount: 4,
      hardestRouteSent: "5.11d",
      hardestRouteWorked: "5.13c",
    });

    // Every awkward grade shape, resolved downward.
    expect(on("2026-06-01", "outdoor_climbing")).toEqual({
      pitchCount: 5,
      hardestRouteSent: "5.12c", // the Pinkpoint, hardest of four ascents
      hardestRouteWorked: "5.14a", // 5.14- → the bottom of the band
    });

    // A toprope contributes its pitch but claims nothing; the trad redpoint's
    // protection suffix is stripped.
    expect(on("2026-07-01", "outdoor_climbing")).toEqual({
      pitchCount: 4,
      hardestRouteSent: "5.8",
    });

    expect(on("2023-05-29", "outdoor_bouldering")).toEqual({ hardestBoulderSent: "V7" });
    expect(on("2018-07-04", "outdoor_bouldering")).toEqual({ hardestBoulderSent: "V7" });
    // No recorded style: a session with no claim attached.
    expect(on("2016-11-16", "outdoor_bouldering")).toEqual({});
  });

  it("splits the mixed day without letting a boulder inflate the pitch count", () => {
    expect(on("2026-06-15", "outdoor_climbing")).toEqual({
      pitchCount: 1,
      hardestRouteSent: "5.11a",
    });
    expect(on("2026-06-15", "outdoor_bouldering")).toEqual({ hardestBoulderSent: "V5" });
  });

  it("gives every climbing session a pitch count", () => {
    for (const n of plan.notes.filter((x) => x.category === "outdoor_climbing")) {
      expect(n.data.pitchCount).toBeGreaterThan(0);
    }
  });

  it("orders days oldest first, so an import reads as a history", () => {
    const periods = plan.notes.map((n) => n.period);
    expect([...periods].sort()).toEqual(periods);
  });
});
