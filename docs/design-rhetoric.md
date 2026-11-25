# Design criteria from visual rhetoric

A layout can pass every technical check and still say nothing. This lab therefore writes down, before
any layout, **what the design has to do for whom and at what moment**, and judges the result against
that. The vocabulary is Aristotle's three proofs (ethos, pathos, logos) and kairos, as modern visual
rhetoric reads them. This page gives the method; `poc/composition/design/winter-morning.json` is a
worked example.

## Where the criteria come from

| Idea | What it gives a designer | Source |
|---|---|---|
| Design as argument | A designed thing persuades through technical reasoning (logos), the character it shows (ethos) and the emotion it brings (pathos). | Buchanan, "Declaration by Design", *Design Issues* 2:1 (1985). Read through secondary summaries only; the paper itself was not accessible. |
| The three proofs in visual communication | Logos is clarity for the task; ethos is credibility, fit to the audience and care; pathos is emotion evoked without manipulation. Unintended pathos costs credibility. | Prantl, Möller & Koesten, [arXiv 2304.10540](https://arxiv.org/html/2304.10540v4) |
| The rhetorical situation | A design answers an exigence, for an audience, within constraints. | Bitzer (1968), summarised in [Rhetorical situation](https://en.wikipedia.org/wiki/Rhetorical_situation) |
| Kairos in new media | Kairos covers the choice of mode, medium, production, distribution and circulation, not only timing. | Sheridan, Michel & Ridolfo, [Kairos and New Media](http://enculturation.net/6.2/sheridan-michel-ridolfo), *Enculturation* 6.2 (2009) |
| Enargeia | Vividness that "places before the eyes", so the audience feels present. In Aristotle it works on emotion through imagination. | Aristotle, *Rhetoric* 3.11; [Leiden enargeia project](https://www.universiteitleiden.nl/en/research/research-projects/humanities/enargeia-living-presence-and-persuasion-in-roman-rhetoric-literature-visual-art-and-theatre); O'Gorman, [Looking into Aristotle's eyes](https://pure.psu.edu/en/publications/looking-into-aristotles-eyes-toward-a-theory-of-rhetorical-vision/) |
| Presence and condensation | Pictures argue through presence, immediacy and condensation. The audience completes the premise (enthymeme), so a strong image strengthens values people already hold. | Kjeldsen, "The Rhetoric of Thick Representation", *Argumentation* 29(2) (2015), [Springer](https://link.springer.com/10.1007/978-3-319-21103-9_8) |
| Composition as meaning | Information value (given/new, ideal/real, centre/margin), salience, framing and reading path. | Kress & van Leeuwen, [*Reading Images*](https://www.routledge.com/9780415672573), chapter on the meaning of composition |
| Design rhetoric as practice | Design judged by its effect. Rhetorical intensity matches the goal, and figures (ellipsis, metonymy, hyperbole) work visually. | Bern University of the Arts, [Design & Rhetoric](https://www.bfh.ch/ehsm/en/research/institutes/design-rhetoric/); Ehses & Lupton, *Rhetorical Handbook* (1988) |

## The method

1. **Describe the situation first.** Write the exigence, the audience and where they meet the work,
   the constraints and the kairos: the moment, the medium and how the piece will circulate.
   The campaign file holds this under `rhetoric.situation`.
2. **Write criteria for each appeal before layout.** Each criterion says what the design must do in
   this situation. It must not be a general virtue. "Legible" is not a criterion. "The release date
   lands last and alone, so the viewer leaves with when" is.
3. **Decide where the image is.** If presence matters, the photograph is the stage and everything
   else is placed in it. If comparison or instruction matters, the image is a figure and stays in its
   own region. The scene declares this (`stage: true`), and the checks follow it.
4. **Let motion mean something.** Time-based design is a dramaturgy. Each movement should be a
   property of the situation, such as light changing or time passing. A reveal that only decorates
   does not count.
5. **Separate what can be measured from what must be judged.** Tie each criterion to the checks that
   support it. A passing check never proves a criterion. Every criterion ends in a human judgement.

## Criteria template

| Appeal | Ask | Typical support from checks |
|---|---|---|
| Kairos | Does the design show the moment it answers? Is it made for the medium where it will be met, and how it will circulate (muted autoplay, crop, size)? | Formats rendered from one source; reproducible frames; measured change over time where the moment is enacted |
| Decorum | Do intensity and tone fit the subject and audience? Is there anything louder than the situation warrants? | None. This is judged. |
| Pathos | Is the viewer placed in the scene (enargeia), not shown an object? Is the feeling earned by the scene, not added on top? | None directly. The film itself is the evidence. |
| Logos | Is there one reading path? Is the practical fact the audience needs present and clear? | Type scale; legibility against the real pixels; nothing overflows |
| Ethos | Does craft show care? Is every claim one the sender can stand behind, with the image's origin on record? | Fonts loaded and embedded; safe area; asset hash and provenance |

## What the renderer measures

- **Legibility on a stage image.** The text layer is hidden and the frame is captured. For each text
  box, the 5th and 95th percentile luminance of the pixels behind it are read. The WCAG ratio is then
  taken against the worse of the two, so one bright highlight under a word fails the check. This is
  sampled every 0,5 s through the film and in the end state; the worst frame in which the text is
  fully shown counts.
- **Warmth over time** (`measure: warmth_rises`). This is the mean red minus blue of the whole frame
  at two moments. It must rise, and it must end above zero. It checks that the light really arrives.
  It cannot check whether the light feels like morning.
- The report lists each criterion with its supporting checks and `judgement: pending human review`.

## Limits

- The checks are support, not proof. A design can pass all of them and still fail its situation.
- Warmth is a crude proxy, chosen because it is honest about what it measures.
- Buchanan's mapping of the three proofs to design is cited from secondary sources. The original
  paper could not be fetched.
