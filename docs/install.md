# Installing Commitbook on your own web hosting

This is the recommended way to run Commitbook. Your GitHub access key is kept on your
server, and you sign in with a normal username and password that your browser or password
manager (Apple Passwords, iCloud Keychain, 1Password…) can save and fill in.

## What you need

- Web hosting with **PHP 7.4 or newer** and **HTTPS**, for example any cPanel host (Krystal,
  and so on). PHP's `curl` extension is used if present; otherwise `allow_url_fopen`.
- A **private GitHub repository** for your notes (it can be empty), and a
  **fine-grained access key** for it. See *Make the access key* below.

## Install

1. **Make a folder for it.** In cPanel, create a subdomain such as `notes.example.com`,
   or use a folder of an existing site. Note its folder, e.g. `public_html/notes.example.com`.
2. **Download the latest `commitbook-x.y.z.zip`** from the
   [Releases page](https://github.com/thcousins/commitbook/releases).
3. **Upload and extract it** into that folder. In cPanel: *File Manager* → open the folder →
   *Upload* the zip → right-click it → *Extract*. Then delete the zip. The folder should now
   contain `index.html`, `assets/` and `api/`.
4. **Turn off any other password protection** on the folder (e.g. cPanel *Directory
   Privacy*), so you don't sign in twice. Commitbook has its own sign-in.
5. **Open the address in your browser.** You'll see *Set up Commitbook*:
   choose a username and password, then enter your notes repository (`your-name/notes`) and
   the access key. Commitbook checks them with GitHub and opens your notes.

That's it. On other devices, just open the address and sign in. Tick *Keep me signed in*
to stay signed in for 90 days on that device.

## Make the access key

1. **Find the fine-grained tokens page.** On GitHub, click your **profile picture** (top right)
   → **Settings** → **Developer settings** (at the bottom of the left-hand menu)
   → **Personal access tokens** → **Fine-grained tokens** → **Generate new token**.
   Or go straight there: [github.com/settings/personal-access-tokens/new](https://github.com/settings/personal-access-tokens/new).
2. **Fill in the form:**
   - **Token name:** *Commitbook*. **Expiration:** choose a date, and put a reminder in your
     calendar to renew it.
   - **Resource owner:** your own account.
   - **Repository access:** *Only select repositories* → your notes repository.
   - **Permissions:** under *Repository permissions*, set **Contents** to *Read and write*.
     (If you see an *Add permissions* button instead, click it, choose *Contents*, then set it
     to *Read and write*.) Leave everything else as it is.
3. Click **Generate token** and **copy it straight away**. GitHub only shows it once; if you lose
   it, just make a new one.

When it expires, make a new one and enter it in Commitbook under
*⋯ → Sign-in and GitHub settings*.

## Where your settings are kept

Your username, a hash of your password (not the password itself) and the access key are
stored in `~/.commitbook/<id>/config.php`, in your hosting account's home folder, **outside
the web folder**, so they can't be downloaded. (If the home folder isn't writable, Commitbook
falls back to `api/data/` inside the app folder, which it protects with an `.htaccess` file.
To choose a folder yourself, set the `COMMITBOOK_DATA` environment variable.)

- **Change your password or access key:** *⋯ → Sign-in and GitHub settings*. Changing the
  password signs out your other devices.
- **Forgot your password?** Delete `config.php` from that folder (cPanel *File Manager*, with
  *Show hidden files* on), then open Commitbook to set it up again. Your notes are safe;
  they're on GitHub.
- **Too many wrong passwords** lock sign-in for 15 minutes.

## Sharing notes and folders

Open a note and choose **⋯ → Share link…**, or use **⋯** next to a folder and choose
**Share folder…**, to make a private link such as `https://notes.example.com/s/9f3a…`
(40 random characters, so it can't be guessed). Anyone with the link can open it without
signing in, and always sees the notes as they are now. They can't reach any other note.

- **Read only or Can edit.** Choose when you make the link, and change it later on the same
  link. *Read only* shows the note (or the folder's notes, with a list of its subfolders to
  find them). *Can edit* also lets them change those notes; their saves appear in the
  revision history marked “(shared link)”. They can't add, move, delete or tag notes, or reach
  anything outside what you shared.
- A shared folder includes its subfolders, and notes you add to it later.
- **Stop sharing** from the same place, or from **⋯ → Shared links** in the sidebar, which lists
  every link you've made. A link can also be set to stop working after a day, a week, a month or
  a year.
- A note's link keeps working if the note is moved or renamed (in the app or directly in GitHub).
  It stops while the note is in the Trash. A folder's link follows the folder when you rename
  or move it in the app.
- Links of the form `/s/…` rely on Apache's `mod_rewrite`, which cPanel hosts have. If yours
  doesn't, links still work written as `/s/?…` (the same 40 characters after the `?`).
- The list of links is kept with your other settings, outside the web folder.

## Updating

Download the new zip and extract it over the old files, replacing them. Your settings live
elsewhere, so they're kept.

To update automatically instead, fork the repository and use the `Deploy` workflow with the
`DEPLOY_*` secrets described in the README; it uploads each new version over SSH.

## Security notes

- The app's files (HTML, JavaScript) aren't secret and can be fetched by anyone. Your notes
  can only be reached after signing in, through `api/github.php`, which adds the access key on
  the server and only allows the one notes repository.
- Sign-in cookies are `HttpOnly`, `Secure` (on HTTPS) and `SameSite=Strict`, and requests to the
  server must come from the app itself.
- Use HTTPS. Without it, passwords travel unencrypted.
