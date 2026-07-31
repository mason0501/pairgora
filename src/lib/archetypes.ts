/**
 * Pair Profile archetypes — the copy layer over the 16 surface codes
 * (design note 21 § 3.1; approved copy, notes 13 & 25 — do not edit copy here
 * without a vault-side voice gate). Scoring produces the code (profile.ts);
 * this module only names and describes it.
 * Direction, not level: no archetype is rendered as better than another.
 * Duos are pattern analogues — affectionate guesses, never assessments; real
 * people appear only in positive/neutral collaboration-pattern framing.
 */

export interface ArchetypeDuo {
  duo: string; // e.g. "Han Solo × Chewbacca"
  why: string;
}

export interface Archetype {
  code: string; // e.g. "S-H-I-F"
  name: string; // e.g. "The Sprinter"
  narrative: string;
  /** "Reads as" — the 3–4 sentence expansion of the one-liner (note 25 § 1). */
  reads: string;
  thrives: readonly string[];
  frays: readonly string[];
  try_this: string;
  duos: readonly ArchetypeDuo[];
}

export const ARCHETYPES: readonly Archetype[] = [
  {
    code: "S-H-I-F",
    name: "The Sprinter",
    narrative:
      "Tight briefs, gut calls, instant green lights. This pair ships before other pairs finish writing the ticket.",
    reads:
      "You brief tight, call it from the gut, and green-light on the spot. Your agent gets small, sharp targets and total clarity about what \u201cdone\u201d means \u2014 because done arrives today. This pair's superpower is cycle time: while other pairs are writing the ticket, you've shipped and moved on.",
    thrives: [
      "the work slices thin",
      "the cost of a wrong guess is low and reversible",
      "momentum matters more than polish",
    ],
    frays: [
      "a task secretly needed a spec (\u201cfast\u201d became \u201ctwice\u201d)",
      "gut calls stack up un-reviewed and drift compounds",
    ],
    try_this:
      "Once a week, pull one shipped-fast piece back and re-read it cold. The Sprinter's blind spot isn't speed \u2014 it's never looking back.",
    duos: [
      { duo: "Han Solo \u00d7 Chewbacca", why: "tight jobs, gut calls, instant mutual green lights" },
      { duo: "A trauma team on shift", why: "scoped handoffs, zero deliberation latency" },
    ],
  },
  {
    code: "S-H-I-G",
    name: "The Gardener",
    narrative:
      "Small plots, tended by feel, trust grown season by season. Nothing in this pair was rushed \u2014 and it shows.",
    reads:
      "You hand over small plots, tend them by feel, and let trust grow season by season. Nothing in this pair got rushed into place \u2014 the agent's range expands exactly as fast as its track record does. Slow to open, hard to shake.",
    thrives: [
      "the domain punishes overreach",
      "the pair is young and the logs are thin",
      "quality of the relationship IS the deliverable",
    ],
    frays: [
      "the trust perimeter stops growing after the track record has outgrown it",
      "\u201cby feel\u201d becomes a bottleneck the agent can't predict",
    ],
    try_this:
      "Name one plot you'd have expanded last month if you'd decided by record instead of feel \u2014 and expand it this week.",
    duos: [
      { duo: "Mr. Miyagi \u00d7 Daniel", why: "scoped tasks assigned by feel, trust earned season by season" },
      { duo: "A bonsai keeper and the tree", why: "small cuts, long patience" },
    ],
  },
  {
    code: "S-H-N-F",
    name: "The Surgeon",
    narrative:
      "Precise scope, evidence first, full confidence once the plan is set. Clean cuts, quick closes.",
    reads:
      "Precise scope, evidence first, and once the plan is set \u2014 full confidence, no hovering. You spend your caution before the incision, not during. Clean cuts, quick closes, short recoveries.",
    thrives: [
      "problems can be isolated before they're touched",
      "the evidence is gatherable up front",
      "execution windows are short",
    ],
    frays: [
      "the case wasn't actually diagnosable in advance and mid-operation surprises need a looser grip",
      "planning cost exceeds the operation",
    ],
    try_this: "Keep a \u201cwent off-plan\u201d log. If it's empty for a month, your scopes may be too safe.",
    duos: [
      { duo: "Gene Kranz \u00d7 Mission Control", why: "evidence first, then total commitment to the call" },
      { duo: "A surgeon and their scrub team", why: "the plan is the trust" },
    ],
  },
  {
    code: "S-H-N-G",
    name: "The Craftsman",
    narrative:
      "Every task measured twice, every result inspected, trust earned one flawless piece at a time. Slow is smooth, smooth is masterful.",
    reads:
      "Every task measured twice, every result inspected, trust extended one flawless piece at a time. This pair runs on standards \u2014 the agent always knows exactly what excellent looks like, because you've shown it, piece after piece. Slow is smooth; smooth is masterful.",
    thrives: [
      "defects are expensive",
      "the craft compounds \u2014 each inspected piece raises the next one's bar",
      "nobody's counting sprints",
    ],
    frays: [
      "inspection becomes ritual instead of information",
      "a fast-moving opportunity needed a rough draft, not a masterpiece",
    ],
    try_this:
      "Pick one deliverable a month that's allowed to ship at 80%. Watch what actually breaks. (Often: nothing.)",
    duos: [
      { duo: "Jiro \u00d7 his apprentice", why: "years of inspected pieces before the egg sushi" },
      { duo: "A luthier and the workshop", why: "tolerance measured in tenths of millimeters" },
    ],
  },
  {
    code: "S-A-I-F",
    name: "The Pit Crew",
    narrative:
      "The agent calls the stop, the human waves it in, and four seconds later it's done. Small jobs, split-second trust, zero wasted motion.",
    reads:
      "The agent calls the stop, you wave it in, and four seconds later it's done. Small jobs, split-second mutual trust, zero wasted motion. This pair has compressed its coordination into reflex \u2014 the conversation happened months ago, so it doesn't need to happen now.",
    thrives: [
      "the same play repeats often enough to be drilled",
      "latency is the enemy",
      "roles are crisp",
    ],
    frays: [
      "a novel situation arrives dressed as a routine one and the reflex fires anyway",
      "nobody notices the playbook aging",
    ],
    try_this:
      "After any stop that felt even 1% off, run the 30-second debrief. Pit crews stay fast by reviewing tape, not by trusting harder.",
    duos: [
      { duo: "Bruce Wayne \u00d7 Alfred", why: "the agent moves first, the principal waves it in \u2014 not a motion wasted" },
      { duo: "An F1 car and its pit wall", why: "the call comes from the data, the trust is instant" },
    ],
  },
  {
    code: "S-A-I-G",
    name: "The Scout",
    narrative:
      "The agent ranges ahead on instinct and reports back; the human verifies the map before the party moves. Bold eyes, careful feet.",
    reads:
      "Your agent ranges ahead on instinct and comes back with a map; you verify the map before the party moves. Bold eyes, careful feet. The agent's freedom is real but bounded \u2014 it can go look at anything, and commit to nothing.",
    thrives: [
      "the terrain is unknown and looking is cheap",
      "wrong commitments are expensive",
      "the agent's instincts are worth harvesting but not yet worth betting on",
    ],
    frays: [
      "every map gets re-surveyed from scratch \u2014 verification stops scaling",
      "the scout stops ranging because reports keep dying in review",
    ],
    try_this:
      "Track your override rate on scout reports. If it's under one in ten, your verification is costing more than it catches.",
    duos: [
      { duo: "Aragorn \u00d7 Legolas", why: "the scout ranges by instinct, the party moves only on the verified map" },
      { duo: "A recon drone and its operator", why: "far eyes, grounded decisions" },
    ],
  },
  {
    code: "S-A-N-F",
    name: "The Navigator",
    narrative:
      "The agent charts the course with data, and the human sails it the same hour. Calculated routes, immediate departures.",
    reads:
      "The agent charts the course with data, and you sail it the same hour. Calculated routes, immediate departures. You've split the work cleanly: the agent owns \u201cwhich way\u201d, you own \u201cgo\u201d \u2014 and \u201cgo\u201d comes fast because the chart shows its work.",
    thrives: [
      "the data is good and the agent shows its reasoning",
      "decisions are frequent and similar in shape",
      "speed compounds",
    ],
    frays: [
      "the chart is confidently wrong and the fast \u201cgo\u201d didn't catch it",
      "conditions shift faster than the recharting cadence",
    ],
    try_this:
      "Once a month, sail one route the chart argued against \u2014 calibration data for both of you.",
    duos: [
      { duo: "A rally driver \u00d7 their co-driver", why: "pace notes called from data, committed to at full speed" },
      { duo: "A harbor pilot and the helm", why: "the chart speaks, the wheel answers" },
    ],
  },
  {
    code: "S-A-N-G",
    name: "The Lab",
    narrative:
      "The agent runs the experiments, one hypothesis at a time \u2014 and the human replicates before believing. Peer review is a love language here.",
    reads:
      "The agent runs the experiments, one hypothesis at a time \u2014 and you replicate before believing. Peer review is a love language here. Nothing enters this pair's shared truth without passing through both of you, which makes that truth unusually load-bearing.",
    thrives: [
      "being wrong quietly is worse than being slow",
      "results feed decisions bigger than the pair",
      "rigor is the product",
    ],
    frays: [
      "replication becomes a bottleneck for claims that didn't need it",
      "the agent starts pre-filtering bold hypotheses to survive review",
    ],
    try_this:
      "Tier your claims \u2014 \u201cload-bearing\u201d gets full replication, \u201cscaffolding\u201d gets spot checks. Save the rigor for where it pays.",
    duos: [
      { duo: "Marie \u00d7 Pierre Curie", why: "one runs it, the other replicates before believing" },
      { duo: "A journal and its referees", why: "the result isn't real until it survives review" },
    ],
  },
  {
    code: "B-H-I-F",
    name: "The Catapult",
    narrative:
      "The human aims big on instinct, releases fast, and lets the agent fly the payload. Not every launch lands \u2014 the ones that do go far.",
    reads:
      "You aim big on instinct, release fast, and let the agent fly the whole payload. Not every launch lands \u2014 the ones that do go far. This pair trades control for range, deliberately: your job is choosing targets worth the arc.",
    thrives: [
      "upside is asymmetric \u2014 one hit pays for five misses",
      "the agent can genuinely carry a whole mission",
      "aim-adjusting between launches is cheap",
    ],
    frays: [
      "a miss was expensive and nobody had instrumented the flight",
      "launches queue faster than lessons land",
    ],
    try_this:
      "Attach one sentence to every launch \u2014 \u201cwe'll know it worked if\u2026\u201d. Cheap instrumentation, compounding aim.",
    duos: [
      { duo: "Steve Jobs \u00d7 Steve Wozniak", why: "big instinctive aim, whole payload delegated, fast faith" },
      { duo: "A siege engineer and the stone", why: "commit fully, then watch the arc" },
    ],
  },
  {
    code: "B-H-I-G",
    name: "The Captain",
    narrative:
      "The human sets the heading by feel and hands over the ship watch by watch. The crew earns the helm; the voyage earns the trust.",
    reads:
      "You set the heading by feel and hand over the ship watch by watch. The crew earns the helm; the voyage earns the trust. Big delegation, deliberate tempo \u2014 the agent's authority is real, and it was paid for in miles.",
    thrives: [
      "the voyage is long enough for trust to compound",
      "the heading matters more than the daily course corrections",
      "earned authority beats granted authority",
    ],
    frays: [
      "the watch schedule stops updating \u2014 the crew outgrew it",
      "\u201cby feel\u201d headings go unexplained and the crew steers blind between orders",
    ],
    try_this:
      "Say the heading's why out loud once per leg. A crew that knows why can hold course through weather you didn't brief.",
    duos: [
      { duo: "Picard \u00d7 Riker", why: "the captain sets the heading, the first officer earns the bridge" },
      { duo: "A sailing master and a long crossing", why: "trust measured in watches stood" },
    ],
  },
  {
    code: "B-H-N-F",
    name: "The Director",
    narrative:
      "A clear vision, a full production handed to the agent, and fast faith in the dailies. The human doesn't hover \u2014 they premiere.",
    reads:
      "A clear vision, a full production handed to the agent, and fast faith in the dailies. You don't hover \u2014 you premiere. The agent runs the whole set precisely because the brief was sharp enough to run from.",
    thrives: [
      "the vision is articulable up front",
      "the agent's craft is proven",
      "reviewing dailies beats attending every take",
    ],
    frays: [
      "the vision drifted mid-production and nobody re-briefed",
      "\u201cfast faith\u201d skipped the one daily that mattered",
    ],
    try_this:
      "Re-state the logline whenever scope changes hands. Productions die of stale briefs, not bad takes.",
    duos: [
      { duo: "Danny Ocean \u00d7 Rusty", why: "the vision is exact, the production is delegated, the faith is immediate" },
      { duo: "A showrunner and the writers' room", why: "premiere-day trust, built on a sharp bible" },
    ],
  },
  {
    code: "B-H-N-G",
    name: "The Conductor",
    narrative:
      "The human holds the score, the agent plays every instrument, and each section rehearses until it's earned its solo. Grand scale, deliberate tempo.",
    reads:
      "You hold the score, the agent plays every instrument, and each section rehearses until it's earned its solo. Grand scale, deliberate tempo. Nothing performs unrehearsed \u2014 which is exactly why the performances land.",
    thrives: [
      "the work is an orchestra \u2014 many parts, one score",
      "excellence is auditable section by section",
      "the timeline respects rehearsal",
    ],
    frays: [
      "the rehearsal bar becomes uniform \u2014 the triangle gets symphony-level scrutiny",
      "the score never leaves your head",
    ],
    try_this:
      "Publish the score \u2014 the full arc, not just this week's movement. Sections rehearse better when they know the symphony.",
    duos: [
      { duo: "Karajan \u00d7 the Berlin Philharmonic", why: "every section earns its solo before the hall hears it" },
      { duo: "A cathedral choirmaster and the voices", why: "grand scale, patient tempo" },
    ],
  },
  {
    code: "B-A-I-F",
    name: "The Autopilot",
    narrative:
      "Broad delegation, agent-led, gut-checked, instantly trusted. The human's job is choosing the destination \u2014 the rest already left the runway.",
    reads:
      "Broad delegation, agent-led, gut-checked, instantly trusted. Your job is choosing the destination \u2014 the rest already left the runway. This pair has the shortest distance between intention and motion of any type on this board.",
    thrives: [
      "destinations are clear even when routes aren't",
      "the agent's judgment has a real track record",
      "your attention is the scarcest resource in the system",
    ],
    frays: [
      "the destination was ambiguous and the autopilot flew somewhere confidently",
      "gut checks thin out until the first turbulence is a surprise",
    ],
    try_this:
      "Spot-check one flight a week end-to-end \u2014 not because you doubt the autopilot, but because calibration is what lets you keep not doubting it.",
    duos: [
      { duo: "Bertie Wooster \u00d7 Jeeves", why: "the human picks the destination, the agent has already handled the rest" },
      { duo: "Tony Stark \u00d7 JARVIS", why: "full mission trust at conversational speed" },
    ],
  },
  {
    code: "B-A-I-G",
    name: "The Explorer",
    narrative:
      "The agent pushes into open territory on its own compass; the human reads the expedition log before funding the next one. Far range, honest maps.",
    reads:
      "The agent pushes into open territory on its own compass; you read the expedition log before funding the next one. Far range, honest maps. The agent's autonomy is wide but accountable \u2014 every expedition ends at your desk.",
    thrives: [
      "the frontier is genuinely unknown",
      "honest failure reports are rewarded",
      "funding decisions benefit from full logs",
    ],
    frays: [
      "log-reading lags expeditions and the agent ranges on stale mandates",
      "\u201cfunding review\u201d quietly becomes \u201croute control\u201d",
    ],
    try_this:
      "Review logs on a fixed cadence the agent can plan around. Explorers navigate better when the funding board is predictable.",
    duos: [
      { duo: "Voyager \u00d7 JPL", why: "the probe ranges on its own compass, the log is the accountability" },
      { duo: "A polar expedition and its geographic society", why: "far range, funded by honest maps" },
    ],
  },
  {
    code: "B-A-N-F",
    name: "The Operator",
    narrative:
      "The agent runs the whole system by the numbers, and the human reads the dashboard, not the code. Trusted at scale because it's measured at scale.",
    reads:
      "The agent runs the whole system by the numbers, and you read the dashboard, not the code. Trusted at scale because it's measured at scale. This pair industrialized its trust \u2014 the metrics are the relationship's load-bearing wall.",
    thrives: [
      "the work is systematizable and the metrics are honest",
      "scale matters",
      "your leverage is judgment over throughput",
    ],
    frays: [
      "the dashboard measures what's easy instead of what's true",
      "an un-metric'd corner of the system quietly grows",
    ],
    try_this:
      "Ask the agent monthly: \u201cwhat's happening that the dashboard can't see?\u201d The answer is your next metric \u2014 or your next incident.",
    duos: [
      { duo: "Billy Beane \u00d7 Peter Brand", why: "the model runs the system, the human reads the dashboard and bets the season on it" },
      { duo: "A plant manager and the control room", why: "trust, instrumented" },
    ],
  },
  {
    code: "B-A-N-G",
    name: "The Architect",
    narrative:
      "Big structures, agent-drafted, analyzed to the bolt, approved floor by floor. Nothing here was improvised \u2014 that's the point.",
    reads:
      "Big structures, agent-drafted, analyzed to the bolt, approved floor by floor. Nothing here was improvised \u2014 that's the point. The agent designs at full ambition because it knows every floor will be inspected, and you approve at full scale because every inspection passes.",
    thrives: [
      "the structure must stand for years",
      "floor-by-floor gates genuinely de-risk",
      "ambition and rigor reinforce each other",
    ],
    frays: [
      "approval latency stalls the whole tower",
      "inspections re-litigate settled floors instead of gating new ones",
    ],
    try_this:
      "Mark floors \u201csettled\u201d explicitly and never reopen them without new load data. Architecture needs closed decisions to build on.",
    duos: [
      { duo: "Antoni Gaud\u00ed \u00d7 the Sagrada Fam\u00edlia committee", why: "drafted at full ambition, approved chapter by chapter, still standing" },
      { duo: "A master builder and the city", why: "structures outlive their arguments" },
    ],
  },
];

/**
 * What each letter position in the 4-letter code means — both poles named,
 * neither favored (§ 1.1 direction, not level).
 */
export const TYPE_LETTER_LEGEND: ReadonlyArray<{
  position: number;
  dimension: string;
  a: { letter: string; label: string };
  b: { letter: string; label: string };
  blurb: string;
}> = [
  {
    position: 1,
    dimension: "delegation",
    a: { letter: "S", label: "Scoped" },
    b: { letter: "B", label: "Broad" },
    blurb: "How work is handed over — tight briefs or whole missions.",
  },
  {
    position: 2,
    dimension: "initiative",
    a: { letter: "H", label: "Human-led" },
    b: { letter: "A", label: "Agent-led" },
    blurb: "Who opens the move — the human or the agent.",
  },
  {
    position: 3,
    dimension: "decision",
    a: { letter: "I", label: "Intuitive" },
    b: { letter: "N", label: "Analytic" },
    blurb: "How calls get made — gut or evidence.",
  },
  {
    position: 4,
    dimension: "trust",
    a: { letter: "F", label: "Fast-trust" },
    b: { letter: "G", label: "Gradual" },
    blurb: "How review lets go — quickly or earned over time.",
  },
];

const BY_CODE = new Map(ARCHETYPES.map((a) => [a.code, a]));

/** Archetype for a 4-letter type code (e.g. "B-A-I-F"); null when the code is null/unknown. */
export function archetypeOf(typeCode: string | null | undefined): Archetype | null {
  if (!typeCode) return null;
  return BY_CODE.get(typeCode.trim().toUpperCase()) ?? null;
}
