# Nomen-Trainer

Practise German nouns: a picture (emoji or Wikipedia photo) and the English meaning pop up at random,
you type the singular (with article) and the plural, and get corrected.

## Adding your own nouns

Edit **`my-words.txt`**, commit and push. One word per line:

```
die Tasse
Stift
die Katze; Katzen; 🐈; cat      # spell everything out: article noun; plural; emoji; English
```

Gender, plural and English are looked up automatically from German Wiktionary (and cached in the browser).
Lines starting with `#` are ignored. The built-in starter list lives in `words.js`.

## Hosting on GitHub Pages

1. Push this repo to GitHub.
2. Repo → Settings → Pages → Source: *Deploy from a branch* → `main` / `/ (root)`.
3. Open `https://<your-user>.github.io/<repo-name>/` on phone and computer.
   On the phone, use "Add to Home Screen" to get an app icon.

No build step; the site is plain HTML/CSS/JS. Progress is stored per device in the browser.
