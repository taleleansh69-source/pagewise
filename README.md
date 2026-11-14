# Pagewise

Pagewise is a camera-first document reader. Capture or upload up to three page photos, choose Gemini, Groq, or Sarvam AI, and get answers to the questions visible in the document.

## Run locally

1. Install [Node.js 20 or newer](https://nodejs.org/).
2. In this folder, install the dependencies:

   ```bash
   npm install
   ```

3. Copy `.env.example` to `.env` and add at least one provider key. For example:

   ```env
   GEMINI_API_KEY=your_key_here
   ```

   You can use `GROQ_API_KEY` or `SARVAM_API_KEY` instead. The app’s provider menu will show which keys are configured.
   Create keys from [Google AI Studio](https://aistudio.google.com/app/apikey), [Groq Console](https://console.groq.com/keys), or the [Sarvam dashboard](https://dashboard.sarvam.ai/).
4. Start the site:

   ```bash
   npm start
   ```

5. Open [http://localhost:3000](http://localhost:3000).

Camera access requires HTTPS or `localhost`. You can always choose a photo instead.

## Add it to GitHub

Create an empty repository on GitHub, then run these commands in this project folder:

```bash
git init
git add .
git commit -m "Create Pagewise document answer app"
git branch -M main
git remote add origin https://github.com/YOUR_USERNAME/YOUR_REPOSITORY.git
git push -u origin main
```

`.gitignore` excludes `.env` and `node_modules`. Commit `.env.example` as the list of required settings, but never commit your real `.env` or API keys.

## Publish on Render

1. Push the project to GitHub.
2. In Render, choose **New → Web Service** and connect the repository. Render can use the included `render.yaml`.
3. In the service’s **Environment** settings, add at least one secret key: `GEMINI_API_KEY`, `GROQ_API_KEY`, or `SARVAM_API_KEY`.
4. Save and deploy. Render runs `npm install` and `npm start`; the site listens on Render’s `PORT` setting.

Optional model overrides are listed in `.env.example`. The defaults are Gemini `gemini-3.8-flash`, Groq `qwen/qwen3.8-27b`, and Sarvam `gemma4`.

The API endpoint applies basic per-IP request throttling. If you share the site publicly, set usage limits with your AI provider as well.
