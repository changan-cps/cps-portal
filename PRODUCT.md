# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Everyone at the CHANGAN plant who works with CPS (Changan Production System). Each group signs in once and sees only the apps their role allows:

- **IE engineers / CPS team** do time studies, SWCT, line balancing and kaizen tracking, at a desk or on a tablet beside the line.
- **Line leaders (TL / GL)** work on phones and tablets on the shop floor: PJO audits and checking their team's results.
- **Managers / plant management** read dashboards and download PPT reports for weekly and monthly meetings. This group includes both Thai and Chinese managers.
- **General employees** play Lean Quest, read announcements, and use the apps their role grants.

## Product Purpose

CPS Digital Platform is a single sign-on front door to the plant's CPS apps. One login (CPS SSO) shows each person the apps that match their role and opens them without a second sign-in. Success means people reach the right tool quickly, on any device, in their own language, and admins can manage apps, users, roles and announcements without touching code.

## Positioning

It is built in-house for one factory's own production system. The apps, the roles (admin, auditor, tlgl, verifier, issue_owner, employee, viewer) and the vocabulary (SWCT, TAKT, Line Balance Rate, PJO, kaizen, VA / NNVA / NVA) come from CHANGAN's actual CPS work. It is not a generic intranet.

## Operating Context

- **Two kinds of hosting.** Apps on the External Server open from anywhere. Apps on the Factory Server (localhost or an internal IP) open only inside the plant network, and the portal labels them that way.
- **Installs as a PWA.** It runs on desktop and on phones (iPhone: Share → Add to Home Screen). In the installed window, same-site apps and SSO-ticket apps open inside the portal window.
- **Admins publish settings.** An admin edits apps, links, users, roles and announcements in the settings page, downloads `config.json`, and uploads it to the repo to publish it to every device.
- **Connected apps right now:** IE Digital Program (IE Studio) and its admin, CPS PJO Audit, Lean Quest and its admin, CPS Survey, CPS AI Audit, Downtime Analyze System, JDY, and the factory CPS system.
- **Management reporting.** IE Studio's Dashboard and its downloadable PPT report, built on the CHANGAN Confidential 16:9 template, feed weekly and monthly meetings.

## Capabilities and Constraints

- **Static site on GitHub Pages.** No build step. The only backend is Google Sheets and Apps Script (CPS SSO endpoint in `sso.json`, source in `sso/Code.gs`). Pages caches files for about 10 minutes, so script and CSS links carry `?v=` version stamps.
- **Three languages: Thai, 中文 and English.** The language is stored in localStorage `cpsPortal.lang` and shared by apps on the same origin. Pages that managers see must also support a bilingual 中 / EN view on one page.
- **Works on a phone on the shop floor.** It has to stay usable at phone width.
- **Access limits.** The portal controls which menu items each person sees. An app's own backend must check SSO tokens for real access control.
- **Passwords** are stored as PBKDF2 hashes. Secrets such as `SSO_SECRET` are entered by the admin themself, never written into the code.
- **Demo data.** IE demo records are tagged `demo-` so they can be removed before real use.

## Brand Commitments

- **CHANGAN corporate identity.** CHANGAN blue (brand `#00467F` in reports; theme colour `#0b469f`), the CHANGAN wordmark, and the "Strategic Focus | AI Transformation | …" tagline strip from the corporate template.
- **Template-bound documents.** Reports follow the CHANGAN Confidential 16:9 template, with the confidential badge and a blue rule under the header.
- **App icons.** Each app in `config.json` carries an emoji icon and an accent colour.

## Evidence on Hand

- App icons: `icon-192.png`, `icon-512.png`, `icon-maskable-512.png`, `icon.webp`, `favicon.png`, `apple-touch-icon.png`.
- The live app catalogue and roles in `config.json`.
- IE Studio demo data, Dashboard screenshots (`ie-demo-screens/`) and sample PPT reports (`ie-ppt-samples/`).
- There are no testimonials, usage metrics or adoption figures. Don't invent any.

## Product Principles

1. **One door, the right rooms.** Sign in once and see only what your role needs.
2. **The shop floor is the real test.** A phone in a gloved hand on a noisy line is the baseline device.
3. **Managers read it in their own language.** Every manager-facing view works in Thai, Chinese and English, and in 中 / EN side by side.
4. **Data comes out ready for the meeting.** Anything a manager sees should export cleanly into the CHANGAN template.
5. **Plain infrastructure.** Static files and Google Apps Script that the CPS team can maintain without a build pipeline.
