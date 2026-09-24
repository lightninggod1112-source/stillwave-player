# Stillwave

A personal MP3 player. The site itself is public static code; the MP3 bucket and playlists are private behind Supabase email-link sign-in and owner-only database rules.

## Local preview

```bash
npm install
npm run dev
```

With no `.env` file, the app runs in local preview mode. MP3s added in preview stay only in that browser tab and disappear when the page reloads.

## Connect Supabase

1. Create a free Supabase project. In SQL Editor, open `supabase.sql`, replace `YOUR_EMAIL@example.com` with your email, and run the SQL once.
2. In Authentication → URL Configuration, set **Site URL** and add a **Redirect URL** matching the eventual GitHub Pages URL, including the trailing `/`. For local testing also add `http://localhost:5173/`.
3. In Project Settings → API (or Connect), copy the Project URL and **publishable** key into `.env` using `.env.example`. Never use the service role or secret key in the website.
4. Run `npm run build`. The resulting `dist/` folder is the standalone static website.
5. Deploy `dist/` to GitHub Pages. On GitHub Free, its repository and static code are public; do not commit `.env`, account passwords, or music. You can use a Pages deployment workflow or a branch containing only the built files. The actual MP3s live privately in Supabase, not on GitHub.
6. Sign in with the same email you placed in `supabase.sql`. The email link returns to the website. Upload a small MP3 and verify playback on another device.

The free Supabase tier currently has 1 GB storage and a 50 MB file limit. Email links depend on Supabase's email delivery limits; high-volume use would require custom SMTP.

Shuffle chooses independently from the current list for every next song, so immediate repeats are possible. Loop song takes precedence over shuffle. Playlist order can be changed via each song's options menu.

## Audio effects

The audio engine uses Signalsmith Stretch 1.3.2 (MIT licensed), compiled to WebAssembly and running in an AudioWorklet. It changes pitch and tempo independently, with formant compensation enabled. The six-band EQ uses Web Audio biquad shelf/peaking filters, smoothed gain changes, and conservative boost headroom. Large boosts can reduce overall volume to prevent clipping.

Temporary pitch, tempo, and local EQ reset whenever a track is loaded. Global EQ is remembered on the current device. Local EQ replaces global EQ, rather than stacking on top. Saved versions appear as separate library entries, store their processing settings in Supabase, and share the original MP3. They are not exported/rendered MP3 files. Removing one version retains the shared audio while other entries use it. Preview versions disappear on reload, like preview uploads.

For an already configured database, run `effects-migration.sql` once. New installations can use the updated `supabase.sql`.

Audio is decoded in memory before playback; large files can take a moment and consume significant RAM. Effects require HTTPS (or localhost) and a browser with AudioWorklet support. Extreme pitch and tempo settings can introduce audible artifacts. Mobile background playback depends on the browser/OS.
