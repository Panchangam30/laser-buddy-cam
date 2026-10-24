# CAC Submission Readiness — Laser Buddy

**Checked:** October 24, 2026  
**Short answer:** The project looks like a strong, substantial entry, but I cannot call the submission fully ready until the team confirms eligibility, checks the public repo, records the required demo, and verifies the main features they plan to claim. Submit by **Monday, October 26, 2026 at 12:00 PM Eastern**. The official rules PDF gives noon; submit well before then in case the registration page wording differs.

## What the project is

Laser Buddy combines a browser based Arduino learning workspace with optional physical hardware. It includes 3D breadboard planning and tutorials, a code editor/library, camera based board geometry and guidance, and an optional Arduino pan/tilt laser pointer. This combination of software, computer vision, and hardware is a good fit for CAC, which permits web apps, robots, and embedded systems.

Keep the pitch focused on the problem and the working experience: **Laser Buddy helps beginners plan an Arduino circuit, compare it with a real breadboard, and get step by step guidance.** Explain that the physical pointer is an optional calibrated feature, not required for the core web app.

## Must finish before submitting

- [ ] **Confirm team eligibility today.** There can be at most four students; each must be in middle or high school on October 26 and a U.S. resident. At least half of the team must live in or attend school in the congressional district entered, and that district must host the challenge. Each student may enter only one app in one district. The README lists four teammates; check the district for all four and invite each person into the application.
- [ ] **Confirm the entry is allowed by the project date rule.** CAC 2026 accepts apps created after October 30, 2025. If this is a continuation or 2.0, identify the new work being submitted.
- [ ] **Make the GitHub repository public and open it in a private/logged-out browser** to confirm the README, setup guide, and source files are visible. Submit the repository URL in the application if asked; the demo video is a separate required item.
- [ ] **Do a public-repo privacy check.** Review tracked files and recent commits for API keys, passwords, personal addresses, camera footage, private student information, and local machine files. `.env.example` should contain placeholders only. Do not commit `.agents/` or `skills-lock.json` unless the team intentionally wants those files public; they are currently untracked in this working copy.
- [ ] **Make and upload a 1–3 minute public YouTube or Vimeo demo.** Include every participant's name, the app name, one sentence on its purpose, target audience, tools/languages, and a clear working demonstration. Set the video to Public and test the link in a logged-out browser.
- [ ] **Complete every application question accurately.** Be ready to describe what inspired the app, a technical problem and how the team solved it, what the students learned, and what they would build for version 2.
- [ ] **Disclose AI use fully.** State which tools helped with development and what they helped produce, as well as which AI features run inside the app (for example optional Groq code feedback, OpenAI image identification, and the configured voice provider). Describe what each student personally designed, coded, debugged, or tested. Do not claim generated or assisted work as unaided student work. CAC permits AI support when fully disclosed and expects significant student contribution and technical understanding.
- [ ] **Submit before the deadline and save proof.** After submitting, save the confirmation page/email and check that the team entry and video link appear correctly.

## Firmware work completed in this checkout

I simplified the comments in `firmware/laserbuddy/laserbuddy.ino` so they state what the code does in direct language. I also changed two input-handling cases: malformed laser commands no longer turn the laser on just because the text contains a `1`, and an overlong serial line is rejected instead of executing its truncated prefix.

The students should read this file together, confirm the command format with the host code, and make sure they can explain the pin choices, angle limits, motion steps, serial parsing, and laser timeout. The edits here do not disguise authorship; disclose AI assistance in the application as required. No Arduino compile, board, servo, or laser test was run for this review. **Do not claim the firmware or physical rig works unless a student has tested it on the actual hardware.**

## Demo checklist

- [ ] Start the project using the steps in `SETUP.md` on the computer used for recording. Use the simplest reliable setup; do not try to show every optional provider feature.
- [ ] Show a complete path a beginner can follow: open a tutorial or project, inspect/build a circuit in the 3D workbench, use the code tools, and explain what guidance the app provides.
- [ ] If showing the camera, use a well lit supported 830 point breadboard and show a real successful comparison. Explain that occluded wires, lighting, and unsupported layouts can affect results.
- [ ] If showing the laser rig, demonstrate only after calibration and a safety check. Never point it at eyes or reflective surfaces. If it is not reliable, describe it as optional work in progress and focus the demo on proven features.
- [ ] Keep the narration student-led and specific. Say which parts each teammate worked on and one concrete technical challenge the team solved.
- [ ] Avoid claiming that the 3D preview simulates electrical behavior or executes Arduino sketches. The README correctly says it is a wiring guide, not a circuit simulator.

## Final repo polish

- [ ] Check the README claims against the current build. In particular, verify counts (tutorials, projects, help records, examples) and mark features that are unfinished or optional.
- [ ] Make sure `SETUP.md` has the exact commands and prerequisites needed to reproduce the demo, and that the repo does not rely on untracked local files.
- [ ] Confirm license and attribution for models, icons, fonts, datasets, and other assets; retain required notices and link sources where needed.
- [ ] Confirm the app can be opened by a judge, or provide a short setup route in the README if it only runs locally. Keep provider keys out of the repo and explain which features need them.
- [ ] Check that the application’s app description matches what the video actually demonstrates.
- [ ] Have every teammate review the final README and their own contribution/AI disclosure. A judge may ask to see the app and source code.

## Readiness verdict

**Promising entry; not verified as ready to submit yet.** The repository already describes a coherent, ambitious project and documents meaningful limitations. The remaining deadline-critical work is eligibility, public-repo/privacy review, an accurate AI and contribution disclosure, and the public 1–3 minute video. The app’s true readiness depends on a clean setup and the features shown working during the demo. This review was a source/documentation inspection; it did not build the app or test camera, Arduino, or laser hardware.

## Official CAC references

- [2026 CAC rules (PDF)](https://www.congressionalappchallenge.us/wp-content/uploads/2026/05/2026-CAC-Rules.pdf) — eligibility, team size, AI disclosure, video requirements, deadline, and judging criteria.
- [CAC student rules page](https://www.congressionalappchallenge.us/students/rules/) — eligibility and competition dates.
- [CAC student registration](https://www.congressionalappchallenge.us/students/student-registration/) — registration and current submission instructions.
