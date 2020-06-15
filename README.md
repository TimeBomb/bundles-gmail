# bundles-gmail

JS UserScript that implements an Inbox-like bundling feature into GMail, leveraging labels and DOM manipulations.
This allows you to group emails in your inbox by label.

# Installation Instructions

1. Install TamperMonkey for [Chrome](https://chrome.google.com/webstore/detail/tampermonkey/dhdgffkkebhmkfjojejmpbldmpobfkfo?hl=en) or [Firefox](https://addons.mozilla.org/en-US/firefox/addon/tampermonkey/).
2. Click the TamperMonkey icon and select `Create a new script...`
3. Copy paste the entire raw contents of https://github.com/TimeBomb/bundles-gmail/raw/master/gmail-bundles-userscript.js into the user script and press [Cmd]+[S] to save.
4. Refresh GMail and you should have bundles.

# Usage

1. All emails with visible labels are separated into bundles by their label. Emails with multiple labels will be separated into multiple bundles and accessible from any bundle that matches their labels. Bundled emails are invisible by default.
2. Bundles will be placed in the position of the most recent email in the bundle. The sender will contain the bundle name colored based off the label color, the subject will contain a list of up to three of the most recent senders of emails in the bundle. The date will contain the date of the most recent email in the bundle.
3. Bundles containing unread emails will have their bundle name bolded.
4. Click the bundle to open it. You can open one bundle at a time. Open bundles have their bundle name underlined. Opening a bundle hides all emails except the bundled emails. Click the bundle again to close it, restoring visibility of your unbundled emails.
5. There are currently some bugs that occur when you open bundles while viewing other labels that you access from the left label menu. It's recommended to stay in the Inbox for the time being.
6. If you do encounter bugs, opening and closing a bundle can sometimes fix it. If that doesn't fix it, refresh the page. If things are too buggy, disable the user script.
