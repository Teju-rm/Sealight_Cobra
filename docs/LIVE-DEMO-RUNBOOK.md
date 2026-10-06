# COBRA Live Quality Gate â€” Demo Runbook

Why this exists: GitHub's servers can't reach `localhost`. ngrok gives your
local `cobra-core` a public web address. On the free plan that address
**changes every time ngrok restarts**, so it must be refreshed right before the demo.

Whoever runs the demo needs: the laptop running `cobra-core`, and admin
access to the GitHub repo (to edit Variables).

---

## One-time setup (do today, not on demo day)

1. Install ngrok. In PowerShell: `winget install ngrok.ngrok`
   (or download from https://ngrok.com/download). Close and reopen PowerShell.
2. Make a free ngrok account, copy your authtoken from the dashboard, then run:
   `ngrok config add-authtoken <YOUR_TOKEN>`
   Keep the token private. Never commit it or paste it in chat.
3. Check it works: `ngrok version`

---

## Before the demo (start 30â€“45 minutes early)

1. **Start cobra-core** (port 4000) and make sure the data is there:
   `curl.exe http://localhost:4000/builds?limit=200`
   You should see the demo builds. If the list is empty, this laptop's database
   has no data â€” ngrok will expose an empty API.
2. **Keep the laptop awake and plugged in.** If it sleeps, the tunnel dies.
   Windows: Settings > System > Power > Screen and sleep > set to Never.
3. **Start the tunnel** in its own terminal window: `ngrok http 4000`
   Copy the `https://....ngrok-free.app` address next to "Forwarding".
   Leave this window open for the whole demo.
4. **Test the tunnel from outside** (replace both values):
   `curl.exe -H "ngrok-skip-browser-warning: true" https://<NGROK_URL>/risk/<FAIL_BUILD_ID>`
   You should see JSON with `"verdict": "fail"`.
5. **Update GitHub:** repo Settings > Secrets and variables > Actions > Variables.
   - `INGESTION_API_HOST` = the ngrok URL (no trailing slash, no `/risk`)
   - `DEMO_BUILD_ID` = the build ID that should FAIL (see "Known builds" below)
6. **Dry run:** open the PR, wait for the check, confirm it goes red and names
   the untested function.

If ngrok is ever restarted (closed window, reboot, crash), the address changes.
Repeat steps 3â€“5.

---

## Demo flow

1. Show the PR with the red âŒ Quality Gate check. Open the check's logs / the
   annotation to show the untested function that blocked it.
2. Switch to the passing case: change `DEMO_BUILD_ID` to the build that PASSES,
   then on the PR open Checks > Re-run all jobs.
3. Show the green âœ… check.
4. Take screenshots of both.

Optional: for a true "merge blocked" button, go to Settings > Branches > add a
rule for `main` and require the status check "Build, test, and check release risk".

---

## Known builds (from the local database)

| Build ID | Result |
|---|---|
| ef5744361f25c59f3c3d7b26e3948b988ba5fe23 | fail (1 untested change) |
| a54727256f9cc3da798bcfbfe2ecc74ffb8c8903 | check with curl |
| 9ab596c49dfb66407e08e30149ef5e368601dd42 | check with curl |

Fill in which of the last two returns `"verdict": "pass"` and use that as the pass build.

---

## If something goes wrong

| What you see on the check | Likely cause | Fix |
|---|---|---|
| "Could not reach the risk API" | ngrok stopped or URL changed | Restart ngrok, update `INGESTION_API_HOST` |
| "Missing INGESTION_API_HOST" | Variable not set | Add it under Actions Variables |
| HTTP 404 | Build ID isn't in this database | Check `DEMO_BUILD_ID` against `/builds` |
| "NO DATA - NOT A VERIFIED PASS" | Build has no registered changes | Use a build with data |
| Check never starts | Workflow file not on the PR's base/branch | Merge the workflow changes to `main` first |

---

## After the demo

- Delete the `DEMO_BUILD_ID` variable.
- Stop ngrok (Ctrl+C) so the tunnel is closed.
- Delete `scripts/mock-risk-api.js` if it's still in the repo.
