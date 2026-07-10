# Version 0.2 — Data safety

This version separates the website code from recipe data.

## What is stored where

### Website code
GitHub contains:
- `index.html`
- `styles.css`
- `app.js`
- `config.js`
- `service-worker.js`

These files can be replaced during updates.

### Shared recipe data
Your Google Sheet stores the shared recipe collection.

Updating the website does **not** delete the Sheet.

### Personal browser data
Each browser stores:
- Favorites
- Personal star ratings
- Weekly meal plan
- Locally added recipes before shared mode is connected

Use **Manage → Export backup** before clearing browser data or switching devices.

## Version 0.2 features

- Search and filters
- Favorites
- In-browser PDF viewing
- Shared Google Sheet support
- Bulk HelloFresh URL import
- Personal 1–5 star ratings
- Weekly meal planner
- Backup/export tools

## One-click import from arbitrary websites

This version can reliably auto-read HelloFresh URL structure.

Importing full recipe details from arbitrary websites, especially TikTok, requires a server-side importer. A static GitHub Pages site cannot reliably bypass site restrictions, read video content, or fetch protected page data.

That importer should be a later phase using a small backend service. The recipe database remains separate, so adding that later will not erase existing recipes.
