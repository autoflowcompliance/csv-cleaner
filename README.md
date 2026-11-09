# CSV Cleaner (runs in your browser)

Drop a contact or customer CSV on the page. It trims spaces, lower-cases emails, writes phone numbers in international form, writes dates as yyyy-mm-dd, removes empty and exact-duplicate rows, and lists what it will not decide for you (invalid emails, rows that share an email but differ). It also gives you a file listing every change it made.

- **Your file stays on your computer.** The page has no server and makes no network requests of its own; the code is `core.js` and `index.html`, readable in full.
- **Free for the first 500 rows.**
- **Tested on synthetic files only.** No real client file has been run through it. It was written with AI assistance (Claude Code).
- **It does not** merge duplicate people, guess day/month order, fix numbers Excel has already turned into scientific notation, or import anything into Xero, QuickBooks or any CRM.

Built by Neo Dlamini (South Africa, UTC+2). Questions or a bigger file: mphodlamini73@gmail.com.
