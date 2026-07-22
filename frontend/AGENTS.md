<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

<!-- BEGIN:case3-front-end-rules -->
# The file system
The file system should be clear and readable. A file can be maximum 300 lines. Make it componentized for better readability without losing any functionality.
We should explain the structure and functionalities with markdown files and comment lines.

## Example File system
/src/app/test/page.tsx
/src/app/test/components/PageComponentOne.tsx
/src/app/test/components/PageService.ts

# The Back-end connection and structure
We are going to use BFF structure with Next.js in front-end, with proper rate limit handling and caching in ssr.
/src/components/GeneralService.ts

# Design System
Design is going to be 2 themes, dark and light. We should care about contrast. The general UI design system is going to be minimalistic and modern.
With using the power of Tailwindcss and ShadcnUI.
IMPORTNAT: every page MUST be responsive.

# Complexity of carrying datas component to component
Use React's ContextAPI if we are carrying the data for too much(like 3+ times). But always check about re-renders and performance.

# Re-requests
We are going to use tanstack react query, so we should cache the datas with tanstack. Cache everything as much as possible for performance and avoiding re-requests.
IMPORTANT: If caching something is breaking the functionality, then find a better way or simply don't cache it.
<!-- END:case3-front-end-rules -->