# Documentation design

Reference pages retrieved on October 23, 2026:

- https://www.better-auth.com/docs/introduction
- https://nextjs.org/docs

Firecrawl returned page text, branding metadata, and screenshot URLs. Reference screenshot download was interrupted; reference pixels were not inspected. This implementation takes structural inspiration from the retrieved navigation and content, rather than reproducing exact reference geometry. Screenshots of the implemented UI were inspected locally.

## Evidence and interpretation

Both references expose grouped topic navigation, an article, and an “On this page” navigation list. Better Auth's reported body typeface is Geist; Next.js reports Geist Sans and Geist Mono. Reported heading sizes span 28–40px for h1 and 24px for h2. Branding extraction can confuse syntax colors with page accents, so those reported accent values were not adopted.

## Implementation choices

Retain Laser Buddy's Inter and JetBrains Mono fonts and restore the original blue accent. Use a neutral article surface with distinct light and dark text roles. All dimensions and colors below are implementation choices, not measured reference values.

- Article: 824px maximum outer width, 48px side padding; 15px body text with 1.85 line height.
- Headings: 38px h1, 24px h2, 16px h3.
- Desktop: 252px topic rail, central reading column, 180px section rail.
- Dark: #111214 canvas, #17181b panels, #ededee headings, #b6b7bf body copy, #2b2c31 borders.
- Light: #ffffff canvas, #fafafa panels, #18181b headings, #52525b body copy, #e4e4e7 borders.
- Blue: #2f6bd8 action fills and #245ea8 links in light mode; #a5c4ff links and fills in dark mode.
- Breakpoints: hide section rail below 1180px; collapse topic rail into a menu below 760px.

## Components and behavior

Use a fixed utility header, topic filter, scroll-aware selected links, responsive topic menu, section permalinks, labelled code panels with copy controls, numbered build steps, bordered callouts, and horizontally scrollable reference tables. Preserve existing section hashes and content.

No reference logos or imagery are needed. Local Playwright coverage verifies navigation, clipboard, responsive overflow, and body contrast in both themes.
