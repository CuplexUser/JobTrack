# Microsoft Edge Add-ons listing

What to enter in Partner Center for JobTrack Clipper. Kept here so the next submission starts
from the same text. Upload `apps/extension/release/jobtrack-clipper-<version>-chromium.zip`
(built by `npm run package --workspace=@jobtrack/extension`).

## Availability

- **Visibility:** Hidden while it is only for your own use (installed from the listing link).
  Public later if it should be findable.
- **Markets:** all.

## Properties

- **Category:** Productivity
- **Website:** https://github.com/CuplexUser/JobTrack
- **Support contact:** https://github.com/CuplexUser/JobTrack/issues
- **Mature content:** no

## Privacy

**Single purpose**

> Saves the job posting shown in the current tab into JobTrack, a job application tracker that
> runs on the user's own computer, when the user clicks the extension's button.

**Permission justification**

- **activeTab:** Reads the job posting in the tab the user is looking at, only when the user
  clicks the extension's button. No access to any other tab or page.
- **scripting:** Runs the function that reads the posting's title, company, location and
  description from the active tab after the click, and, when the user presses Connect to
  JobTrack, listens on JobTrack's own local connect page for the access token.
- **storage:** Stores two settings locally: the address of the user's JobTrack and the access
  token it issued.
- **Host permissions (http://127.0.0.1/\*, http://localhost/\*):** JobTrack runs on the user's own
  computer. These are the only hosts the extension can reach, which is where it sends the saved
  posting.

**Remote code:** No, I am not using remote code.

**Data usage:** The extension reads website content (the job posting on the active page) and
sends it only to JobTrack on the user's own computer. Nothing is sent to the developer or any
third party, and there are no analytics or advertising.

**Privacy policy URL:** https://github.com/CuplexUser/JobTrack/blob/main/apps/extension/PRIVACY.md

## Store listing (English)

**Extension logo:** `apps/extension/store/logo-300.png`

**Description** (Partner Center wants at least 250 characters):

> JobTrack Clipper saves the job posting you are reading into JobTrack, a free, open source job
> application tracker that runs on your own computer.
>
> Open a posting on LinkedIn, Indeed, Glassdoor or a company's careers page and click the
> extension. It reads the title, company, location, salary and description, shows you what it
> found so you can correct anything, and saves it to JobTrack as an opening with one click.
> Before you save, it tells you if you have already applied to that company or that exact role.
>
> Private by design: the extension only reads a page when you click it, and it can only talk to
> JobTrack on your own machine (127.0.0.1 and localhost). Nothing is sent to the developer or
> anyone else.
>
> Setup takes one click: install JobTrack (1.3.0 or newer), open the extension's settings, press
> Connect to JobTrack and allow it on the page that opens.
>
> JobTrack: https://github.com/CuplexUser/JobTrack

**Search terms:** job tracker, job application, job search, clipper, LinkedIn jobs, careers

## Notes for certification

> The extension needs JobTrack running locally to save anything; it has no server of its own.
>
> To test:
> 1. Install Node.js 24, then run `npx jobtrack` (or install the Windows app from
>    https://github.com/CuplexUser/JobTrack/releases/latest). JobTrack starts on
>    http://127.0.0.1:3001.
> 2. Open the extension's settings and press Connect to JobTrack. A JobTrack page opens; press
>    Allow. The settings page then reports "Connected to JobTrack".
> 3. Open any job posting (for example a Greenhouse or Lever job page) and click the extension
>    icon. Check the fields and press Save opening. The posting appears under Openings in
>    JobTrack at http://127.0.0.1:3001/openings.
>
> Without JobTrack running, the popup still reads the page but saving reports that JobTrack is
> not reachable, which is expected.
