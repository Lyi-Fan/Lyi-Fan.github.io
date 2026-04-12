# Repository Guidelines

## Project Structure & Module Organization
- `source/_posts/` contains Markdown posts; `source/img/` stores site images referenced by posts/pages.
- `scaffolds/` defines front-matter templates used by `hexo new`.
- `_config.yml` controls core Hexo behavior and deployment; `_config.butterfly.yml` and `_config.landscape.yml` hold theme-specific settings.
- `themes/butterfly/` is the active theme source (layouts, Stylus, scripts). Treat `public/` as generated output only.
- `.deploy_git/` is the publish worktree/repo used by `hexo deploy`.
- Do not edit `node_modules/` or commit generated artifacts unless a release/deploy workflow explicitly requires them.

## Build, Test, and Development Commands
- `npm install`: install Hexo and theme dependencies.
- `npm run clean`: remove Hexo cache and previous generated files.
- `npm run server`: start local preview (default `http://localhost:4000`).
- `npm run build`: generate the static site into `public/`.
- `npm run deploy`: push generated output using `hexo-deployer-git`.
- Example content workflow: `npx hexo new post "web-security-notes"`.

## Coding Style & Naming Conventions
- Use UTF-8 Markdown with YAML front matter (`title`, `date`, `tags`) as defined in `scaffolds/post.md`.
- Keep YAML indentation at 2 spaces; avoid tabs in config files.
- Prefer concise, URL-friendly post titles/slugs and consistent tag naming.
- When modifying theme files, follow existing Butterfly conventions (lowercase file names, existing helper/tag patterns).

## Testing Guidelines
- No automated test suite is configured in this repository.
- Before opening a PR, run: `npm run clean && npm run build` and ensure the build completes without errors.
- Validate locally with `npm run server`; spot-check home, post, archive, category, and tag pages.
- For UI/theme changes, include before/after screenshots in the PR.

## Commit & Pull Request Guidelines
- Available deploy history in `.deploy_git` uses `Site updated: YYYY-MM-DD HH:mm:ss` for generated publish commits.
- For source changes, use clear, scoped commit messages (example: `feat(post): add SSTI fuzzing writeup`).
- PRs should include: change summary, affected paths (content/config/theme), validation commands run, and linked issue (if any).
- Keep PRs focused; avoid mixing content edits with unrelated theme/config refactors.
