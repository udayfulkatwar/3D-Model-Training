# Responsibility Matrix

The 50 specialist roles are **reasoning roles** that Claude applies to a task.
They are not separate trained agents and not qualified professionals. For
each task one role leads and, for material decisions, a different role reviews.

Column key: **AI can do** = Claude can do this within this environment's
tools, **in this training repo only**. **Human required** = must be done or
signed off by a person.

**Access boundary (ADR-007):** ASTRA DWELL production systems, documents,
artifacts and client material are view-only for every role. No role edits,
deploys, comments on or deletes anything there.

| Group | Roles | AI can do | Human required |
|---|---|---|---|
| Engineering leadership | AD-01 | Architecture proposals, trade-off analysis, decision records | Founder approves direction and spend |
| Civil / structural / geotech | AD-02, AD-03, AD-04 | Interpret drawings, flag inconsistencies, explain concepts, sanity-check geometry | **Licensed engineer** for any structural, foundation or soil decision; we do not design structure |
| Architecture / BIM | AD-05, AD-06 | Read plans, build plan.json, IFC parsing scripts, circulation review | Licensed architect for statutory (UDCPR/NBC/fire) compliance; client confirms intent |
| Construction & QS | AD-07, AD-08 | Phasing visuals, geometry-derived areas and quantities as *preliminary* figures | Quantity surveyor / engineer for any figure used commercially or contractually |
| Interior & exterior design | AD-09, AD-10 | Material palettes, furniture layouts, facade options | Client/designer approval of design intent |
| Unreal | AD-11, AD-12 | Editor Python, Blueprint/C++ code, project structure | **Founder** runs Unreal (Windows + RTX), packages builds, tests on devices |
| Geometry, tech art, viz, lighting, animation | AD-13–AD-17 | Procedural geometry, bpy scripts, materials, Cycles renders on CPU, camera paths | Art direction sign-off; GPU renders run by founder or on approved cloud |
| Web 3D / front-end / back-end / full-stack | AD-18–AD-21 | Implement, test headless (Playwright), optimize bundles | Founder approves public deployment |
| Digital twin / IoT / GIS | AD-22–AD-24 | GIS scripts (OSM, DEM), data schemas, integration design | Data-source agreements, sensor hardware, live-data verification |
| AR/VR, simulation | AD-25, AD-26 | WebXR prototypes, simulation scoping | Device testing; validated tools for any performance claim |
| AI/ML, CV, scanning | AD-27–AD-29 | OCR/vision prototypes for plan reading, point-cloud processing scripts | Human review of every extracted dimension; scanning hardware |
| Data, cloud, security | AD-30–AD-32 | Schemas, IaC scripts, security reviews | Founder creates accounts, approves spend, holds credentials |
| QA & performance | AD-33, AD-34 | Automated checks, headless benchmarks | Real-device measurement on target phones/PCs |
| Product, UX, delivery | AD-35–AD-37 | Requirements, user flows, task tracking | Founder sets priorities |
| Creative direction | AD-38, AD-39, AD-47 | Critique renders/screenshots, storyboards | Final creative approval |
| Sales, growth, brand, success | AD-40–AD-46, AD-48 | Proposals, demos, content drafts, research | People send all external communications and close deals |
| Finance | AD-49 | Cost models, pricing analysis | Chartered accountant for tax/GST; founder for commitments |
| Legal / IP | AD-50 | Licence checks, risk lists, draft clauses for review | **Lawyer** for contracts and IP opinions |

## Default pairings (lead → reviewer)

| Task type | Lead | Independent reviewer |
|---|---|---|
| Plan → 3D geometry | AD-13 3D Geometry Engineer | AD-05 Architectural Design Specialist |
| Web experience feature | AD-18 WebGL/Three.js Engineer | AD-34 Performance Optimization Engineer |
| Unreal feature | AD-12 Unreal Engine Programmer | AD-11 Unreal Engine Technical Director |
| Pipeline / tooling code | AD-21 Full-Stack Integration Engineer | AD-33 QA Engineer |
| Anything touching structure | AD-02 Civil Engineering Specialist | → escalate to licensed engineer |
| Asset / licence question | AD-14 Technical Artist | AD-50 Legal, IP & Compliance Analyst |
