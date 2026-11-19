# Website live chat — setup guide (Phase 11)

The website channel is our own — there is no external platform, no
app review, and no fees. A workspace can run several website
channels (one per site).

## Add the chat bubble to a website

1. In the dashboard go to **Channels → Website live chat → Add to
   your website**.
2. Name the site, pick the bubble color, and set the welcome
   heading/line. Decide whether visitors are asked for their name
   and email before the first chat (pre-chat form, on by default).
3. Click **Create & get code** and copy the one-line snippet:

   ```html
   <script src="https://omnichannel-nepal-tech.vercel.app/widget.js" data-website-token="wt_…" data-color="#4f46e5" async></script>
   ```

4. Paste it into the website just before the closing `</body>` tag,
   on every page where the bubble should appear. Plain HTML,
   WordPress (theme footer / a "Custom HTML" block in the footer),
   Next.js (`next/script` or the root layout) — anywhere a script
   tag can go.

The bubble appears bottom-right (full-screen panel on phones).
Clicking it opens the chat in an iframe served from the app, so the
widget never clashes with the site's own styles.

## How it works

- Visitors chat **without an account**. On their first chat the
  widget issues them a signed visitor token, stored in their
  browser's localStorage — when they return in the same browser,
  the same conversation continues.
- If the pre-chat form is on, the visitor's name (and optional
  email) becomes the contact in the inbox. Otherwise the contact is
  "Website visitor".
- Messages land in the inbox like any other channel: assignment,
  canned responses, tags, priority, snooze all work. Replies,
  images and files go both ways. There is **no messaging window**.
- Visitor-side updates poll every ~2.5 seconds (the agent side is
  fully realtime). Expect replies to appear within a few seconds.
- Clearing the browser's site data (or switching device/browser)
  starts a fresh conversation — the same behaviour as other live
  chat tools for anonymous visitors.

## Settings & the snippet

- **Embed code** and **Settings** buttons sit on the channel's row
  in Channels.
- The bubble color is baked into the snippet (`data-color`). If you
  change it, copy the snippet again. Welcome texts and the pre-chat
  toggle are read live — no snippet change needed.
- The website token in the snippet is **public by design**: it only
  identifies which site the widget belongs to. A visitor's access
  to their own conversation is protected by a separate signed
  token, and every widget endpoint is rate-limited.

## Turning it off

**Disconnect** the channel in Channels — the widget API stops
serving that site immediately (the bubble script can also be
removed from the site at any time). Conversation history is kept.

## Limits (v1)

- One conversation per visitor per site (the latest one is shown).
- Message list shows the most recent 200 messages.
- Files up to 16 MB, same allowlist as the inbox composer.
- No visitor typing indicators or read receipts.
