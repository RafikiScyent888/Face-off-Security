#!/usr/bin/env python3
"""Build a Face-Off acronym pool from an acronym repo's data/acronyms.json.

The Face-Off pages load plain <script> files and never fetch(), because they
have to work from file:// on a classroom laptop with no server. So the JSON
becomes a JS file that sets a global, exactly the way questions-*.js does.

This is a THIRD copy of that acronym data, and the program's own CLAUDE.md
already flags two-copy drift as a live risk. That is why this script exists
and is committed: the copy is regenerated, never hand-edited.
"""
import io, json, os, re, sys, os

SRC, OUT, GLOBAL, TITLE, EXAM = sys.argv[1:6]
# Optional 6th argument: which taxonomy in acronym-topics.py to use, for the
# banks that carry no category of their own.
TOPIC_KEY = sys.argv[6] if len(sys.argv) > 6 else None

items = json.load(io.open(SRC, encoding="utf-8"))
if isinstance(items, dict):
    items = items.get("acronyms") or items.get("data") or []

# WHERE THE COLUMN HEADINGS COME FROM.
#
# Network+'s bank carries a category on every entry and those are used as
# they stand. The other three carry none, so a taxonomy in
# acronym-topics.py supplies them — and the build FAILS, naming names, if a
# single acronym is unclassified. A table keyed by item that does not grow
# with the items is the most repeated fault in this program; this one says
# so out loud rather than dropping the item into a junk column.
TOPIC_OF = {}
if TOPIC_KEY:
    sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
    from importlib import import_module
    topics = import_module("acronym-topics".replace("-", "_")) if False else None
    # the file has a dash in its name, so load it by path
    import importlib.util
    spec = importlib.util.spec_from_file_location(
        "acronym_topics", os.path.join(os.path.dirname(os.path.abspath(__file__)),
                                       "acronym-topics.py"))
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    if TOPIC_KEY not in mod.TOPICS:
        sys.exit('acronym-topics.py has no taxonomy called "%s". It has: %s'
                 % (TOPIC_KEY, ", ".join(sorted(mod.TOPICS))))
    # A key may be a bare acronym, or "ACRONYM = Expansion" where the same
    # letters legitimately mean different things and belong in different
    # columns. Security+ has MAC as Media Access Control, Mandatory Access
    # Control and Message Authentication Code; filing all three under one
    # heading would be wrong in two cases out of three.
    twice = []
    for cat, acs in mod.TOPICS[TOPIC_KEY].items():
        for ac in acs:
            if ac in TOPIC_OF:
                twice.append('"%s" is in both %s and %s' % (ac, TOPIC_OF[ac], cat))
            TOPIC_OF[ac] = cat
    if twice:
        sys.exit("acronym-topics.py lists the same acronym twice:\n  " + "\n  ".join(twice))

# Group by the category the bank already carries. Categories are the board's
# columns, so their names go up in the header and get uppercased to match the
# question bank's house style.
cats = {}
order = []
unclassified = []
# Which acronyms appear more than once in the bank — those must be
# classified by "ACRONYM = Expansion", not by the letters alone.
import collections as _c
_n = _c.Counter(x.get("acronym", "").strip() for x in items)
seen_dupe = {a for a, n in _n.items() if n > 1}
for it in items:
    ac = (it.get("acronym") or "").strip()
    ex = (it.get("expansion") or "").strip()
    df = (it.get("definition") or "").strip()
    if TOPIC_OF:
        # exact "ACRONYM = Expansion" first, then the bare acronym
        cat = TOPIC_OF.get(ac + " = " + ex) or TOPIC_OF.get(ac)
        if not cat:
            unclassified.append(ac if ac not in seen_dupe else ac + " = " + ex)
            continue
    else:
        cat = (it.get("category") or "").strip()
        if not cat:
            sys.exit('acronym "%s" has no category and no taxonomy was named. '
                     "Pass a taxonomy key as the 6th argument." % ac)
    if not ac or not ex or not df:
        sys.exit('acronym "%s" is missing an expansion or a definition; '
                 "every entry needs both or the clue forms cannot be built." % (ac or "?"))
    if cat not in cats:
        cats[cat] = []
        order.append(cat)
    cats[cat].append({"ac": ac, "ex": ex, "df": df, "cat": cat})

vague = sorted({a for a in seen_dupe if a in TOPIC_OF}) if TOPIC_OF else []
if vague:
    sys.exit("These acronyms mean more than one thing in this bank, so filing them\n"
             "by their letters alone puts every meaning in one column. Classify each\n"
             'meaning as "ACRONYM = Expansion" in acronym-topics.py:\n  %s'
             % "\n  ".join(vague))

if unclassified:
    sys.exit("%d acronym(s) are not in the %s taxonomy, so they would never be\n"
             "dealt and nobody would notice. Add them to acronym-topics.py:\n  %s"
             % (len(unclassified), TOPIC_KEY, "\n  ".join(sorted(set(unclassified)))))

# Any acronym named in the taxonomy that is NOT in the bank is a stale entry
# - usually a rename in the source repo - and is worth saying so.
if TOPIC_OF:
    # Compare against BOTH forms a key can take, or every qualified key
    # ("MAC = Media Access Control") reads as stale and the warning becomes
    # noise nobody looks at.
    have = set()
    for c in cats.values():
        for it in c:
            have.add(it["ac"])
            have.add(it["ac"] + " = " + it["ex"])
    stale = sorted(set(TOPIC_OF) - have)
    if stale:
        print("  NOTE: taxonomy names %d acronym(s) not in the bank: %s"
              % (len(stale), ", ".join(stale)))

# Biggest categories first: a board asks for N categories and skips any that
# cannot fill a column, so putting the deep ones first makes short boards work
# without special-casing.
order.sort(key=lambda c: -len(cats[c]))

def js(s):
    return json.dumps(s, ensure_ascii=False)

# AN ACRONYM CAN LEGITIMATELY MEAN TWO THINGS. Network+ has STP for both
# Spanning Tree Protocol and Shielded Twisted Pair, and a student ought to
# meet both. But "Expand this acronym: STP" then has two right answers and
# a team giving the other one would be marked wrong, so any acronym with
# more than one expansion carries the field it belongs to and the clue says
# which one it wants.
seen_ex = {}
for c in order:
    for it in cats[c]:
        seen_ex.setdefault(it["ac"], set()).add(it["ex"])
ambiguous = {a for a, ex in seen_ex.items() if len(ex) > 1}
for c in order:
    for it in cats[c]:
        if it["ac"] in ambiguous:
            it["amb"] = it["cat"]

total = sum(len(cats[c]) for c in order)
small = [c for c in order if len(cats[c]) < 5]

out = []
out.append("/* =====================================================================")
out.append("   FACE-OFF: %s  —  ACRONYM POOL" % TITLE)
out.append("   Exam: %s" % EXAM)
out.append("   ---------------------------------------------------------------------")
out.append("   GENERATED FILE — do not hand-edit.")
out.append("   Rebuild with:  python3 tools/build-acronyms.py")
out.append("   Source of truth: the %s acronym repo's data/acronyms.json." % TITLE)
out.append("")
out.append("   %d acronyms in %d categories." % (total, len(order)))
out.append("")
out.append("   THERE IS NO DIFFICULTY RAMP IN AN ACRONYM. Nothing makes MAC a 100")
out.append("   and SD-WAN a 500, which is a problem on a board whose whole shape is")
out.append("   a column climbing 100 to 500. So the ramp is the TASK, not the item:")
out.append("   the cheap rows ask you to expand the letters, the middle rows give")
out.append("   you a description and ask which acronym it is, and the dear rows")
out.append("   give you the acronym and ask what it actually does. Same acronym,")
out.append("   three difficulties — which is also why %d acronyms go a long way." % total)
out.append("")
out.append("   The clue text is built at draw time from these three fields, so")
out.append("   there is no answer bank to memorise and editing an acronym here")
out.append("   changes every form of it at once.")
out.append("")
out.append("     ac = the acronym          ex = what the letters stand for")
out.append("     df = what it actually does")
out.append("     amb = set only when this acronym means something else somewhere")
out.append("           in the bank; the clue names this field so the team is not")
out.append("           marked wrong for giving the other correct expansion.")
if small:
    out.append("")
    out.append("   Categories with fewer than 5 entries cannot fill a five-row column")
    out.append("   and are skipped on the largest boards. They still play on shorter")
    out.append("   boards and in the Lightning Final. Currently: %s." % ", ".join(small))
out.append("   ===================================================================== */")
out.append("")
out.append("window.%s = {" % GLOBAL)
out.append("  categories: [")
for ci, c in enumerate(order):
    out.append("    { name: %s," % js(c.upper()))
    out.append("      items: [")
    for it in cats[c]:
        out.append("      { ac: %s," % js(it["ac"]))
        out.append("        ex: %s," % js(it["ex"]))
        if it.get("amb"):
            out.append("        amb: %s," % js(it["amb"]))
        out.append("        df: %s }," % js(it["df"]))
    out.append("      ] },")
out.append("  ]")
out.append("};")
out.append("")

io.open(OUT, "w", encoding="utf-8").write("\n".join(out))
print("%s: %d acronyms, %d categories -> %s" % (TITLE, total, len(order), OUT))
if ambiguous:
    print("  more than one meaning (clue will say which field): %s" % ", ".join(sorted(ambiguous)))
if small:
    print("  under 5 entries (skipped on 5-row boards): %s" % ", ".join(small))
