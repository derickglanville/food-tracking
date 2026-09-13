# Gather meal journal

Live app: https://derickglanville.github.io/food-tracking/

Responsive meal journal with Firebase storage, search, trends, CSV export, and meal ideas. Unlock with your existing Gather access code. Meal contents are AES-GCM encrypted; the code is never committed. This repository contains only the static website, not the spreadsheet, data backups, or local credentials.

GitHub Pages publishes the `/docs` directory on the default branch. The app runs directly in your browser and does not require the local Flask server.

Keep your access code safe: it is required to decrypt your history. Encryption protects meal contents; Firebase database access rules remain a separate concern.
