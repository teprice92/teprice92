# Why Timeblock behaves the way it does

Every mechanic in this app traces to published work. This document is the audit trail, so
you can argue with the reasoning rather than just the interface. Where the evidence is
thin or contested, it says so.

---

## 1. Time is externalised, not remembered
**In the app:** the depleting dial, the remaining minutes set in the largest type on the
screen, the persistent Now bar on every view, the current-time line on the day timeline.

Time-perception differences are treated as a core feature of ADHD and a candidate third
pathway alongside inhibition and delay aversion: chronic underestimation of how long
things take, and losing the thread of elapsed time. The intervention that holds up is
externalising time *at the point of performance* — putting a visible, continuously
updating representation of remaining time in front of you instead of asking an unreliable
internal clock to produce it. A randomised study of time-assistive devices in children
with ADHD improved both time-processing ability and daily time management.

- [Time perception in adult ADHD: findings from a decade — a review (PubMed)](https://pubmed.ncbi.nlm.nih.gov/36833791/)

**Caveat:** the adult literature is genuinely mixed. Some studies find clear deficits in
time estimation and reproduction; others find no significant difference from controls on
supra-second time production. The design bet here is that externalising time is cheap and
harmless even if the effect is smaller than claimed.

---

## 2. Reward has to arrive now, not on Friday
**In the app:** XP lands the second a block starts — before it is finished. Each sub-step
pays on the tick. Nothing meaningful accrues only weekly. There is no end-of-month payoff.

A meta-analysis by Marx, Hacker, Yu, Cortese and Sonuga-Barke confirms that people with
ADHD choose small immediate rewards over larger delayed ones more often than controls, and
that using real rather than hypothetical rewards nearly doubles the odds ratio.
Sonuga-Barke's delay-aversion model frames this not as a preference for less, but as an
aversive emotional response to waiting itself — waiting is punishing, so it is escaped.

A planner that pays out at the end of the week is therefore built backwards: the payoff
sits on the far side of exactly the delay this population finds aversive.

- [Marx et al., ADHD and the choice of small immediate over larger delayed rewards (J Atten Disord)](https://journals.sagepub.com/doi/10.1177/1087054718772138)
- [Behavioural and neurofunctional profiles of delay aversion in children with ADHD (Translational Psychiatry)](https://www.nature.com/articles/s41398-025-03353-z)

---

## 3. Implementation intentions beat good intentions
**In the app:** the `When … I will …` field is the most prominent thing in the block
editor, and it is read back to you the moment the block starts.

Gollwitzer and Sheeran's meta-analysis of 94 independent tests found if-then plans improved
goal attainment with a medium-to-large effect (d ≈ 0.65) over holding a goal intention
alone. A 2025 systematic review and meta-analysis of implementation intentions in children
found effects were *strongest in clinical samples, which consisted almost exclusively of
children with ADHD*; children with ADHD given an implementation intention outperformed
those given a mere goal intention on go/no-go suppression.

This is the single highest-leverage field in the app, which is why it is not hidden behind
"More".

- [Gollwitzer & Sheeran, Implementation intentions and goal achievement: a meta-analysis](https://www.researchgate.net/publication/37367696_Implementation_Intentions_and_Goal_Achievement_A_Meta-Analysis_of_Effects_and_Processes)
- [Breitwieser et al., The effectiveness of implementation intentions in children (Br J Psychol, 2025)](https://bpspsychub.onlinelibrary.wiley.com/doi/10.1111/bjop.70065?af=R)

**Caveat:** most of the ADHD-specific evidence is in children, and implementation
intentions alone show small-to-medium effects in some analyses.

---

## 4. Initiation is the bottleneck, so lower the entry cost
**In the app:** the start button asks for two minutes, not the whole block. Every block has
a "first tiny move" field. Tasks break into steps. Priorities are A/B/C.

Structured CBT for adult ADHD — Safren's manualised protocol and the group and individual
protocols that followed — is brief, practical and skills-based: breaking tasks down,
planning, prioritising, and managing distractibility, practised in daily life. These
protocols reduce ADHD symptoms against *active* control conditions, not just waitlists.
The app implements those modules as fields rather than as homework.

- [Safren et al., RCT of CBT for adults with ADHD with and without medication](https://pmc.ncbi.nlm.nih.gov/articles/PMC3414742/)
- [CBT for adults with ADHD: study protocol targeting time-management, planning, distractibility](https://www.ncbi.nlm.nih.gov/pmc/articles/PMC4399752/)

---

## 5. Game mechanics measurably improve adherence
**In the app:** XP, levels, 24 badges, unlockable themes.

Gamification — points, levels, badges, challenges and *customisation* applied to non-game
contexts — is one of the few reliable levers on engagement and attrition in digital
mental-health tools. An 8-week randomised trial of a gamified educational application in
children with ADHD found greater improvement in sustained attention, reaction time and
academic measures than a non-gamified equivalent. A meta-analysis of gamified digital
interventions in youth found effects on ADHD and depression outcomes.

Customisation is itself a listed mechanic, which is why themes are unlockables rather than
a settings afterthought.

- [Effectiveness of a gamified educational application in children with ADHD: 8-week RCT](https://www.researchgate.net/publication/398584473_Effectiveness_of_a_gamified_educational_application_on_attention_and_academic_performance_in_children_with_ADHD_an_8-week_randomized_controlled_trial)
- [Gamification to improve resilience and reduce attrition in mobile mental health: RCT](https://www.ncbi.nlm.nih.gov/pmc/articles/PMC7467300/)

**Deliberate omissions.** No leaderboard, no comparison to other users, no streak that
punishes rest, no variable-ratio "loot box" reward schedule. The mechanics that most
reliably drive compulsive use are the ones most likely to turn a planner into another
thing you feel bad about.

---

## 6. Shame is what makes people abandon the app
**In the app:** repair tokens absorb a missed day. Rescheduling a block *pays XP*. Missed
blocks are neutral grey, never red. No screen ever says you failed. Care and Joy blocks
earn exactly what deep-focus blocks earn.

Low self-compassion is associated with poorer mental health in adults with ADHD
specifically, and rejection sensitivity — described in clinical accounts as near-universal
in this population — predicts anxiety, despair and withdrawal. A planner that greets you
with a broken streak and a red overdue list is optimised to produce precisely that
withdrawal, and an abandoned planner has an effect size of zero.

- [The role of self-compassion in the mental health of adults with ADHD](https://www.ncbi.nlm.nih.gov/pmc/articles/PMC9790285/)
- [The lived experience of rejection sensitivity in ADHD (PLOS ONE)](https://journals.plos.org/plosone/article?id=10.1371%2Fjournal.pone.0314669)

---

## 7. Capture the distraction, keep the block
**In the app:** the parking lot, reachable from every screen and from the `c` key. Parking
something pays XP. Parked items convert into blocks in one tap.

Distractibility management in CBT protocols for adult ADHD uses a "distraction delay":
write the intruding thought down, agree to return to it, continue the current task. The
alternative — chasing the thought — costs the whole block, so capture is made cheaper than
pursuit.

---

## 8. Your planning error is a measurable constant
**In the app:** every completed block records actual vs estimated minutes. The app computes
your personal ratio of real to estimated time and pads new duration estimates by it. Days
packed past their slack get flagged.

Rather than asking you to estimate better — which the underlying time-perception
difference makes unlikely — the app measures how wrong you reliably are and corrects for
it silently. Transitions and overruns need somewhere to land, which is what the automatic
buffer blocks are for.

---

## 9. Low visual load is an accessibility requirement, not a style
**In the app:** a muted default palette, five navigation destinations, one primary action
per screen, progressive disclosure in the block editor, Atkinson Hyperlegible, no
autoplaying motion, full `prefers-reduced-motion` support, and a Paper theme that is
near-monochrome.

Cognitive-accessibility guidance for ADHD converges on a consistent set of rules: minimise
visual clutter, chunk information with whitespace, restrict primary navigation, disclose
one step at a time, avoid unpredictable motion, and prefer soft tones to high-energy
colour. Colour never carries meaning alone — every block type also has an emoji, and
planned vs done is encoded as hollow vs solid, not just hue.

- [Designing digital content for users with cognitive disabilities (Section508.gov)](https://www.section508.gov/design/digital-content-users-with-cognitive-disabilities/)
- [Neurodiversity and UX: essential resources for cognitive accessibility](https://stephaniewalter.design/blog/neurodiversity-and-ux-essential-resources-for-cognitive-accessibility/)

---

## The honest caveat

None of this makes Timeblock an evidence-based intervention. It has not been trialled;
it is a planner whose individual design decisions are each traceable to published work,
which is a much weaker claim. The literature it draws on is uneven — strong for
implementation intentions and delay discounting, mixed for adult time perception, and
largely conducted in children for several of the mechanisms above. It is not a substitute
for assessment, therapy or medication.
