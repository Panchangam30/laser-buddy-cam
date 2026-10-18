# Contributing

Thanks for helping with Laser Buddy. [SETUP.md](SETUP.md) explains how to run it.
The UI, examples, code tools, and synthetic vision tests do not need a laser
rig or API key.

For bug reports, include what you tried, what happened, your OS, and your
Node/Python versions. Remove keys, private code, camera images, project links,
and personal information from logs or screenshots before posting them.

For a pull request:

1. Keep the change focused and explain how to try it.
2. Run `npm run build` and the relevant Playwright tests from `web/`.
3. If you change geometry or tracking, also run
   `.venv/bin/python -m vision.selftest` from the repository root.
4. Say what you could not test, especially live providers or hardware. Do not
   describe a behavior animation as electrical simulation.

Keep the breadboard profile shared between Python and TypeScript. Do not
silently guess unreadable values, measured positions, or wiring safety. Use
simulated provider responses in tests instead of spending a maintainer's key.

Keep real environment files, calibration, dependencies, captures, and generated
reports out of commits. The ignored `captures/`, `recordings/`, `exports/`, and
`.local/` folders are available for local material. Check your staged diff and
`git status` before committing.
