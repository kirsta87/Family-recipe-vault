# Glaister Family Recipe Vault — Setup

This folder is the actual website.

## What works immediately

Open `index.html` in a browser to preview the design.

For the full version, publish the folder with **GitHub Pages**. It is free for a public repository.

The site includes:

- Search
- Protein, meal-type, and tag filters
- Favorites
- One-recipe and bulk URL import
- In-browser recipe-card viewing
- Local backup and restore
- Optional shared Google Sheet and Google Form connection
- Mobile-friendly layout
- Installable web-app support

## Important difference: local versus shared

Recipes added before the Google Sheet is connected are stored in that browser only.

Once the Google Sheet and Form are connected:

- You and your husband use the Form to add recipes.
- The website reads the shared Sheet.
- Both people see the same shared recipe list.

Favorites remain personal to each browser.

---

# Part 1 — Put the site on GitHub Pages

1. Go to GitHub and create a free account.
2. Create a new repository named `family-recipe-vault`.
3. Choose **Public**.
4. Upload every file from this folder into the repository.
5. Open the repository's **Settings**.
6. Click **Pages**.
7. Under “Build and deployment,” choose:
   - Source: **Deploy from a branch**
   - Branch: **main**
   - Folder: **/(root)**
8. Save.

GitHub will show the website address after it publishes.

It will normally look like:

`https://YOUR-USERNAME.github.io/family-recipe-vault/`

---

# Part 2 — Create the shared Google Sheet

Create a Google Sheet with this exact header row:

| name | url | id | protein | type | tags | time | rating | favorite | notes | added |
|---|---|---|---|---|---|---|---|---|---|---|

Example row:

| One-Pan Mango Salsa Pork Tacos | https://www.hellofresh.com/recipes/one-pan-mango-salsa-pork-tacos-66019b2bda283ecbc2883d33 | 66019b2bda283ecbc2883d33 | Pork | Tacos | Mexican\|One Pan\|Quick | 30 min | 0 | false |  | 2026-07-09 |

Then publish the sheet:

1. In Google Sheets, click **File → Share → Publish to web**.
2. Select the recipe tab.
3. Select **Comma-separated values (.csv)**.
4. Click **Publish**.
5. Copy the published CSV link.

The sheet must be published for the website to read it. Anyone with the CSV link can technically read that sheet, so do not put private information in it.

---

# Part 3 — Create the family “Add Recipe” form

Create a Google Form with fields matching the Sheet:

- name
- url
- id
- protein
- type
- tags
- time
- rating
- favorite
- notes
- added

Connect the Form responses to the same Google Sheet, or use a separate response tab and copy the response columns into the recipe tab.

For the easiest first version, the only required field should be `url`. You can fill the other columns later.

Copy the public Google Form link.

---

# Part 4 — Connect the website

1. Open the published website.
2. Click **Manage**.
3. Paste:
   - the Google Sheet CSV URL
   - the Google Form URL
4. Click **Save shared settings**.

The links are stored in that browser. To hard-code them for every device, paste them into `config.js` and upload the updated file to GitHub.

---

# About recipe-card viewing

The website loads each HelloFresh PDF through Google’s embedded document viewer. That usually displays it in-browser instead of downloading it.

The “Open PDF directly” button is still included as a fallback.

---

# Updating the website later

When a new version is made:

1. Keep a backup from **Manage → Export backup**.
2. Replace the website code files in GitHub.
3. Do not delete your Google Sheet.

The Sheet is the shared database, so redesigning the website does not erase shared recipes.
