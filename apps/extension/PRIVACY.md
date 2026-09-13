# JobTrack Clipper privacy policy

JobTrack Clipper is a browser extension that saves a job posting you are reading into
JobTrack, an application that runs on your own computer.

## What it reads

Only the page in the tab you are looking at, and only at the moment you click the extension's
button. From that page it reads the job posting: the title, company, location, salary and
description, the structured data the page publishes about the posting, and any text you have
selected. It does not run on pages you merely visit, and it does not read other tabs, your
history or your bookmarks.

When you press **Connect to JobTrack**, it also runs on the JobTrack connect page it opened
itself, to receive the access token after you press **Allow** there.

## Where that goes

Only to JobTrack on your own computer, at the address in the extension's settings
(`http://127.0.0.1:3001` by default). The extension's permissions allow it to reach
`127.0.0.1` and `localhost` and nothing else, so it cannot send anything to any other server.

Nothing is sent to the developer or to anyone else. There are no analytics, no tracking, no
advertising and no remote code.

## What it stores

Two settings, in the browser's extension storage on your computer: the JobTrack address and
the access token JobTrack issued to it. Removing the extension removes both.

## Contact

Questions or problems: https://github.com/CuplexUser/JobTrack/issues
