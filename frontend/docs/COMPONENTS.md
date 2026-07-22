# Component map

| Component | Responsibility | Why it exists |
|---|---|---|
| `AppHeader` | Reads the signed server session | Keeps request-time cookie work outside the shared page shell. |
| `AppShell` | Role-aware links, active state, theme and logout | These interactions require browser APIs; identity is still supplied by the server. |
| `LoginForm` | Collects GSM/OTP and invokes `useLogin` | Components never create authentication state locally. |
| `AnalystDashboard` | Queue selection, decisions and profile overlay | One client boundary owns the analyst interactions while SSR provides the first data. |
| `SupervisorDashboard` | Metrics, chart, performance and assignment | Related operations share one cache and avoid prop drilling. |
| `CustomerPortal` | Simulation, verification dialog and feedback | It is mounted only after the server authorizes a customer. |
| `Leaderboard` | Ranking presentation | SSR renders the initial top ten; Query handles later refreshes. |
| `PageSkeleton` | Route transition placeholder | Mirrors dashboard geometry to avoid the old-page pause and layout shift. |
| `Providers` | TanStack Query and toast roots | A single instance prevents cache loss between client navigations. |
| UI primitives | Button, cards, form controls, dialog and table | Small shadcn-style wrappers keep accessibility and design tokens consistent. |

Comments in the source explain boundaries and non-obvious decisions. Straight JSX helpers are documented here instead of being narrated line by line.
