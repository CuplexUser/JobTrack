# Profile, fit and automation

What JobTrack does for you once it knows what you are looking for: ranks saved openings by
how well they fit, fills in follow-up dates, closes out applications that went nowhere, and
reminds you when something comes due.

All of it lives on the Settings page. The profile is optional, and both rules are **off until
you switch them on**, because each one writes to records you did not touch.

---

## The profile and fit ranking

The profile holds what you are after: a summary of your experience (a pasted CV works well),
the job titles you want, where you would work, work modes, the lowest salary you would take,
and words that make a posting better or rule it out. Every part is optional. Anything left
blank is simply not scored.

The Openings page then shows each opening's fit from 0 to 100, with a *Best fit first* order.
Hover the score to see why. Fit is deliberately a sum of named parts rather than one opaque
number, so a surprising rank can be understood and the profile corrected:

| part | worth | how it is judged |
|---|---|---|
| title | 30 | best match against your target titles; full marks when every word of a target is in the title, so "Senior Backend Engineer, Payments" matches "Backend Engineer" |
| summary | 25 | how close the posting reads to your summary, by meaning, using the same local model as search |
| location | 15 | any of your places appears in the posting's location; a remote role counts everywhere if you picked Remote |
| work mode | 10 | one of the modes you picked |
| salary | 10 | the posting's range reaches your floor (compared only in the same currency) |
| keywords | 10 | wanted words found; three are enough for full credit |
| excluded words | minus 40 each | a word you want to avoid, found as a whole word |

Only the parts your profile uses count, and the score is the share of those points a posting
earned, so even a profile with one field produces a full 0 to 100 spread. A posting that does
not say (no location, no salary) gets half credit for that part rather than none.

Words match as whole words, ignoring case and accents, so "Go" does not match "Google". While
the search model is still loading after start-up, the summary part is left out and the tooltip
says so; everything else still ranks.

The scoring is pure code in `packages/shared/src/fit.ts`, with the weights at the top.

---

## Rules

**Give new applications a follow-up date.** When you leave the follow-up date blank, a new
application gets one this many days after it was applied for. It never gets a date that has
already passed, so importing last year's applications does not flood the dashboard with
overdue follow-ups, and an application that is already over gets none. This covers the New
Application form, converting an opening, the MCP server and imports.

**Mark silent applications as ghosted.** An application still at *Applied* or *Screening* is
marked *Ghosted* once nothing has happened for the number of days you choose (14 to 365).
Silence runs from the latest of: the date you applied, its last status change, and its
follow-up date, so a follow-up you have planned keeps it safe. *Interview* is left alone on
purpose, since a long wait after an interview is normal.

The rule runs every hour while the server is running (from the API or the tray app, never from
the MCP server). Every change goes through the normal status change, so it appears in the
application's history with the note *Marked ghosted automatically after N days without a
response* and can be undone like any other change. The rule is safe to run repeatedly: an
application it has already moved is no longer a candidate, so there is no bookkeeping about
when it last ran.

Settings shows exactly which applications the rule would change before and after you switch
it on, with a *Run now* button. It is worth looking at that list first: on a long search, the
number can be larger than you expect.

---

## Reminders on Windows

The Windows tray app checks the agenda (`GET /api/agenda`) every half hour and shows a
notification when a follow-up date or a person's reconnect date comes due. Clicking it opens
the dashboard. Each item is announced once per due date, so moving a follow-up and letting it
come due again announces it again, while the checks in between stay quiet. Quiet applications
and idle openings are not announced: they are prompts to look, not appointments.

Reminders are on by default and can be switched off in the tray's Settings dialog, under
General.

---

## From Claude Desktop

`get_profile` and `update_profile` read and change the profile. An update changes only the
fields it names, so adding a target title cannot wipe your locations. `rank_openings` returns
openings best first with their scores and reasons, and `list_openings` accepts `sort: 'fit'`
and `minFit`. The `triage_openings` prompt works through openings best first.

The rules are not exposed to MCP: switching on something that changes records on its own stays
a choice you make in Settings.
