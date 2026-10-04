# Smallest Eval Harness

For the rebuild of the eval harness (known as `eval-v2` or `ev2`), I started with the smallest possible eval harness. This harness takes fixtures from the previous generation of the eval harness and runs them through the application, generating a fresh Claude response for the pending turn in each fixture.

The harness is designed to evaluate one question at a time measured in terms of pass rate. For the initial use of ev2, the sole question is, "Does the Warden get descriptions of characters, places, and timelines correct against the seeded world facts and opening narration for labeled cases on at least 90% of reps per case?"

Ev2 can be invoked with a command such as `task ev2:run -- --question q1 --reps 10`. It performs the following steps:

1. Render case file, which includes the player input for the turn, the world facts at that point in the adventure, and the opening narration.
2. Seed a scratch adventure in the database.
3. Run the turn, make the Claude call, and record the Warden's response as both JSON data and an easy-to-read Markdown file.
4. Remove the scratch adventure.
5. Repeat steps 2, 3, and 4 for each rep.
6. Repeat steps 1 through 5 for each fixture.
7. Create a `marks.csv` file for manual scoring. If a rep threw an error, `error` is recorded for that rep; otherwise, the field is blank for the grader to fill in.

`marks.csv` lets a human score the run by judging the output for each rep and recording `pass`, `fail`, or `na` for each one. `task ev2:report` can then be used to generate a summary of the run, which will show the raw counts of `pass`, `fail`, `na`, and `error` for each fixture plus the rate of `pass` / (`pass` + `fail`) for each fixture. `na` and `error` results are omitted from the rate. 

Note the absence of an automated grader. This was omitted to keep complexity down. We judged 50 narrations for the first run to be a manageable grading assignment. Plus the manual scoring marks are what an automated grader will be checked against. 

The code is in `apps/zoltar-be/eval-v2/`, output goes to `$ZOLTAR_EVAL_ROOT/eval-v2-runs/<timestamp>/`, and the list of fixtures per question is `cases.ts`. Because each rep is a real Warden turn and may include several Claude calls, even this simple harness costs actual money. 
