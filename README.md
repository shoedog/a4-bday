# Ava Jinks 4th Birthday Website

Static rainbow unicorn birthday invite with RSVP and guest-list support.

## Preview Locally

```bash
python3 -m http.server 8080
```

Then open `http://localhost:8080`.

Without backend settings the RSVP form uses browser local storage only when
`allowLocalDemo` is true in `config.js`. That is useful for testing, but it is
not shared across guests.

## Fill In Placeholders

Edit `config.js`:

- `contactPhone`
- `contactPhoneHref`
- `contactEmail`
- `supabaseUrl`
- `supabaseAnonKey`
- `allowLocalDemo`

The phone/email placeholders are shown in the Questions row.

## Recommended Cheap Hosting

Use GitHub Pages or Cloudflare Pages for the static files, plus Supabase free
tier for RSVPs.

This repo now includes `.github/workflows/deploy-pages.yml`, which packages the
site and deploys it to GitHub Pages from the `main` branch.

1. Create a Supabase project.
2. In Supabase SQL Editor, run `supabase/schema.sql`.
3. Create a party code in Supabase SQL Editor:
   ```sql
   select public.create_invite_code('replace-with-your-party-code', 'Ava birthday');
   ```
   Share that code with invited guests. You can also add it to the invite link
   as `?code=replace-with-your-party-code` if you are comfortable with anyone
   who has the full URL being able to RSVP and view the guest list.
4. Push this folder to a GitHub repo.
5. In the GitHub repo, go to Settings -> Pages and set Source to GitHub Actions.
6. In Settings -> Secrets and variables -> Actions -> Variables, add:
   - `CONTACT_PHONE`
   - `CONTACT_PHONE_HREF`, such as `+15555555555`
   - `CONTACT_EMAIL`
   - `SITE_URL`, such as `https://yourname.github.io/ava-4-bday`
   - `SUPABASE_URL`
   - `SUPABASE_ANON_KEY`
7. Push to `main` or run the `Deploy to GitHub Pages` workflow manually.

This folder is meant to be pushed as its own repo, not as a subdirectory of a
larger monorepo. The current target repo is `shoedog/a4-bday`.

```bash
git init
git add .
git commit -m "Add Ava birthday site"
git remote add origin git@github.com:shoedog/a4-bday.git
git push -u origin main
```

GitHub Pages is free for public repos on GitHub Free. If you want the repo
private without paying for GitHub Pages support, use Cloudflare Pages instead;
the deployed invitation is still public either way.

Do not put a Supabase `service_role` key in `config.js`. Only the anon public
key belongs in the browser.

The Supabase schema does not grant direct anonymous reads or writes on the RSVP
tables. The browser calls RPC functions that require the party code. RSVP notes
are accepted for the host, but the guest-list function returns only names and
headcounts for attending guests.

AWS S3 + CloudFront also works for the static files, but GitHub Pages or
Cloudflare Pages are usually cheaper and simpler for this size of site.

## Event Details

- Ava Jinks' 4th birthday
- Tuesday, June 2, 2026
- 4:00 PM to 7:00 PM
- Centennial Center Park
- 13050 E. Peakview Ave., Centennial, CO 80112
- Pizza, snacks, and drinks provided
- Playground open
- Splash pad should be open, weather and park conditions permitting
- Swimsuit and towel recommended for water play, optional
