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

1. Open [GitHub → Settings → Developer settings → Fine-grained tokens → Generate new token](https://github.com/settings/personal-access-tokens/new).
2. Name it *Commitbook* and choose an expiry date (put a reminder in your calendar to renew it).
3. **Repository access:** *Only select repositories* → your notes repository.
4. **Permissions → Repository permissions → Contents:** *Read and write*.
5. Click **Generate token** and copy it.

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
