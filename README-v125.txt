Recipe Vault v125 — server-enforced meal-plan sync lock

This release prevents stale browsers or delayed requests from overwriting a newer shared meal plan.

Install both parts:
1. Replace website files from this folder in GitHub.
2. In Apps Script, preserve your current FAMILY_KEY, replace the code with AppsScript-server-sync-lock-v125.txt, save, and deploy a New version on the existing deployment.
