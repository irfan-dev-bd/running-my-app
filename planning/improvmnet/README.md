# Reg-Starter Improvement Plan

This folder contains the phased improvement roadmap for the Reg-Starter local developer dashboard.

## Documents

| File | Description |
|------|-------------|
| [phase-1-quick-wins.md](phase-1-quick-wins.md) | Immediate UX improvements, no architecture changes |
| [phase-2-power-features.md](phase-2-power-features.md) | Core dev workflow features: env vars, health checks, log persistence |
| [phase-3-workflow-integration.md](phase-3-workflow-integration.md) | Startup ordering, workspaces, dependency chains |
| [phase-4-polish-and-scale.md](phase-4-polish-and-scale.md) | Code quality, extensibility, and long-term maintainability |

## Guiding Principles

- Keep it local-only, no cloud, no auth required
- No build step — changes to `public/` must still work on refresh
- Each phase must leave the app fully functional between releases
- Prefer editing fewer, focused files over new abstractions
- Don't break the `normalizeConfig → validateConfig → writeConfig` pipeline
