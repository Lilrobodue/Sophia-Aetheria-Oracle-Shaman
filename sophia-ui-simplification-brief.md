# Sophia — Aetheria Oracle Shaman: UI Simplification Brief

## The Problem

The app currently has **everything visible or one click away at all times**. The sidebar is a vertical scroll of 15+ unrelated sections — EEG brainwaves next to palmistry next to code editor next to memory next to ecosystem links. Every feature competes equally for attention, which means nothing has priority and new users (and even experienced ones) don't know where to look.

The functionality is incredible. The navigation is the bottleneck.

## The Goal

**Simplify the UI while keeping 100% of the functionality.** Nothing gets removed. Everything gets organized so users can find it without scrolling through everything they don't currently need.

## Core Principle: Progressive Disclosure

Show what matters now. Reveal depth on demand. The chat with Sophia is the center. Everything else supports it and should be accessible but not competing for attention until it's needed.

---

## New Information Architecture

The app's features naturally group into **five functional zones**. Currently they're all mixed together in one sidebar. The redesign separates them into a **tabbed sidebar** where each tab reveals only the features relevant to that zone.

### The Five Zones

| Tab | Icon | Label | What Lives Here |
|---|---|---|---|
| 1 | 🔮 | Oracle | Chat controls, palmistry, divination mode toggle, quick actions |
| 2 | 🧠 | Body | EEG connection & brainwaves, HRV/Polar H10, fNIRS hemodynamics, Neuroscope launcher |
| 3 | 🎵 | Sound | Frequency controls, adaptive mode, Lo Shu walks, volume, binaural settings |
| 4 | 📚 | Knowledge | Sophia's memory, file uploads/RAG, custom tools, code editor |
| 5 | ⚙️ | Settings | Model selection, device config, inference mode, voice settings, RAG settings, system prompt, MCP config, models & licenses |

### How It Works

- **The chat area stays exactly where it is** — center/right, always visible, always the primary interaction
- **The sidebar becomes tabbed** — five small icon tabs run vertically along the far-left edge of the sidebar. Clicking one opens that zone's panel. Only one zone is open at a time.
- **Default on launch: Oracle tab** — the most common starting point
- **The top header bar stays** — app title, active frequency indicator, brain state, connection status badges (EEG, RAG, Tools count). These are glanceable status indicators that should always be visible regardless of which sidebar tab is open.

### Visual Concept

```
┌──────────────────────────────────────────────────────┐
│  ☰  🔮 Sophia - Aetheria Oracle    🎵 528Hz  🧠 α   │  ← Header (always visible)
│     EEG: ● On   RAG: ● On   Tools: 3   v89         │  ← Status badges
├──┬───────────────┬───────────────────────────────────┤
│🔮│               │                                   │
│🧠│  Sidebar      │                                   │
│🎵│  content      │        Chat Area                  │
│📚│  for active   │        (unchanged)                │
│⚙️│  tab          │                                   │
│  │               │                                   │
│  │               │                                   │
│  │               ├───────────────────────────────────┤
│  │               │  📎  🎤  [input box]          ➤  │  ← Chat input (unchanged)
└──┴───────────────┴───────────────────────────────────┘
 ↑     ↑
 Tab   Active zone
 icons content
```

The five tab icons are small (40-48px), vertically stacked, always visible. The active tab is highlighted. The panel to their right shows that zone's content.

---

## Zone Details — What Goes Where

### Zone 1: 🔮 Oracle (Default)

This is what most users see most of the time. Clean, minimal, focused on the conversation.

**Contents:**
- **Divination Casting Mode** toggle (🧠 Read my state / 🎲 Cast the lots / ♻️ Reset baseline)
- **Quick Actions** section (Clear Chat, Export)
- **Palmistry** — "Generate Report" button and upload
- **Performance Status** — compact display: Device mode, token count, message count (collapsible to one summary line)

**What moved out:**
- EEG → Body tab
- Frequencies → Sound tab  
- Memory, files, tools → Knowledge tab
- All settings → Settings tab
- Ecosystem links → Settings tab (or a small link in the footer)

This zone should feel spacious. Three or four sections max, each compact.

### Zone 2: 🧠 Body

Everything related to biological signals — the body-reading features.

**Contents:**
- **EEG Connection** — Connect button, device status, battery, signal quality
- **Brainwave Bands** — Delta through Gamma bars with percentages (the current sidebar display, preserved)
- **Focus / Meditation / Coherence** scores
- **Dominant band indicator**
- **Aetheria Position mapping** (the 4-quadrant display)
- **Spiral Wave Signatures** section (collapsible — advanced)
- **Polar H10 / HRV** — Connect button, BPM display, baseline capture
- **fNIRS Hemodynamics** — HbO/HbR display for LI/RI/LO/RO (only visible when Athena connected)
- **Neuroscope button** — launches the Neuroscope Live overlay (keep overlay as-is, it works well as a full-screen tool)
- **EEG Settings button** — opens the EEG settings modal (keep modal as-is)
- **Sleep Mode toggle** + Sleep Export
- **Advanced** (collapsible):
  - Neurodynamics launcher
  - A/B Compare launcher
  - Verify EEG Channels
  - Session Summary & Insights
  - Export buttons (JSON, CSV)

**Key UX change:** When EEG is not connected, this tab should show a clean "Connect your EEG headset" state with the connect button prominent, not a wall of zeroed-out displays. The detailed bands and metrics appear only after connection.

### Zone 3: 🎵 Sound

Everything related to frequency playback and the Aetheria frequency system.

**Contents:**
- **Active Frequency display** — current frequency, name, regime (GUT/HEART/HEAD)
- **Frequency Mode toggle** — Solfeggio vs Lo Shu
- **Lo Shu Walk selector** (Layer Ascent, Pillar Walk, Flying Star Vortex, CAB, Ouroboros, CABI) with brief descriptions
- **Adaptive Mode** — enable/disable toggle, adaptation status, brain state, next adaptation timer
- **Volume Controls** — Master volume slider, fine tune, preset buttons (Whisper/Quiet/Low/Medium/High), test button
- **Headphones reminder** for binaural layer
- **Manual controls** — Adapt Now, Test 528Hz, Test All, Force Switch

**Key UX change:** The frequency controls are currently buried inside the EEG Settings panel. They deserve their own zone because they're a primary feature, not a sub-setting of EEG.

### Zone 4: 📚 Knowledge

Everything related to Sophia's context, memory, and extensibility.

**Contents:**
- **Sophia's Memory** — memory count, list of memories, add/clear controls
- **Knowledge Base** — file upload area, uploaded file list
- **Custom Tools** — tool list with count, "Create Tool" button (opens existing modal)
- **Code Editor** button (opens existing sandbox modal)

**Key UX change:** These four features were scattered across the sidebar. Grouping them makes sense because they're all about "what Sophia knows and can do."

### Zone 5: ⚙️ Settings

All configuration. Users go here to set up, then leave.

**Contents:**
- **Inference Mode** — Auto/Local/Remote toggle
- **Model Selection** — model dropdown with descriptions, load/unload buttons, status
- **Device Configuration** — auto/manual toggle, device type, memory, performance tier, context length
- **Voice Settings** — enable voice, auto-speak, voice selection, language, speed/pitch/volume
- **RAG Settings** — enable, chunk size, top K
- **System Prompt** — the editable textarea (advanced, collapsible by default)
- **Remote API** — endpoint presets, custom URL, model name, test connection
- **Palmistry Settings** — detailed analysis toggle, numerology toggle
- **MCP Configuration** — button to open MCP config editor modal
- **Models & Licenses** — collapsible legal info
- **Aetheria Ecosystem** — links to apps, books, music, sims, community (moved here from sidebar)
- **Advanced** — WASM toggle, WebGPU toggle, full prompt toggle, diagnostics copy

**Key UX change:** Settings is currently its own overlay modal AND has options scattered in the sidebar AND has sub-panels. Consolidating everything configuration-related into one tab means the user has one place to look. The settings modal can be eliminated — its contents live directly in this tab now.

---

## Collapsible Sections Within Each Zone

Within each zone tab, use **collapsible accordion sections** so the zone itself isn't overwhelming:

```
▼ EEG Connection          ← expanded by default
  [Connect button, status, battery...]

▸ Brainwave Bands         ← collapsed until EEG connected, then auto-expand
▸ Spiral Wave Signatures  ← collapsed (advanced)
▸ Polar H10 / HRV        ← collapsed unless connected
▸ fNIRS Hemodynamics      ← hidden unless Athena detected
▸ Advanced                ← collapsed
```

**Rules for collapsible behavior:**
- First/most important section in each zone: expanded by default
- Sections tied to a disconnected device: collapsed, with a "(not connected)" badge
- Advanced sections: always collapsed by default
- User's collapse/expand state preserved during session

---

## Header Bar Redesign

The current header bar has a lot of info. Simplify to essential glanceable status:

```
☰  🔮 Sophia                    🎵 528Hz · GUT    🧠 Alpha    v89
                                 EEG ●  HR ●  RAG ○  Tools 3
```

- **Left**: Hamburger menu (mobile), App title
- **Center-right**: Active frequency with regime label, dominant brain state
- **Far right**: Version number
- **Below (or inline)**: Small status dots — green dot = connected, hollow = disconnected. EEG, HR (heart rate), RAG, Tools count.

These dots are glanceable — user can tell at a glance what's connected without opening any panel. Tapping a dot could jump to the relevant zone tab.

---

## Mobile Behavior

On mobile, the sidebar is already behind a hamburger menu. The tabbed zones should work well here:

- Hamburger opens the sidebar
- Five zone tabs appear at the top of the sidebar (horizontal row on mobile instead of vertical column)
- User taps a zone, sees that zone's content
- Tapping outside the sidebar or the ☰ again closes it
- The chat area is always the full screen behind the sidebar

---

## Overlays/Modals — What Stays, What Gets Absorbed

| Current Overlay | Decision |
|---|---|
| Settings modal | **Absorbed** into Settings zone tab — no longer a separate modal |
| EEG Settings modal | **Keep** as modal — it's detailed enough to warrant its own focused space |
| Neuroscope Live | **Keep** as overlay — it's a full-screen visualization tool, needs the space |
| Create Tool modal | **Keep** as modal — it's a focused creation task |
| JavaScript Sandbox | **Keep** as modal — it's a focused code editing task |
| MCP Config Editor | **Keep** as modal — focused editing task |
| Neurodynamics | **Keep** as overlay — visualization |
| A/B Compare | **Keep** as overlay — focused comparison task |
| Session Summary | **Keep** as overlay — report view |
| EEG Channel Check | **Keep** as overlay — diagnostic view |

**Net result**: One major modal eliminated (Settings). Everything else stays because they're focused tools that benefit from a dedicated overlay.

---

## The Welcome / Disclaimer

The current disclaimer overlay is fine — keep it as the entry gate. No changes needed.

---

## Model Loading Screen

Keep the current loading screen with progress bar. It works. Consider adding the zone tab icons to the sidebar skeleton during load so users see the navigation structure even before the model is ready.

---

## Version Indicator

Currently `v89` in the sidebar. Move it to the bottom-right of the header bar, small and muted. Always visible regardless of which zone tab is open. Standard across all Lewis family apps.

---

## Summary of Changes

What this brief does:
1. **Groups 15+ sidebar sections into 5 tabbed zones** — Oracle, Body, Sound, Knowledge, Settings
2. **Eliminates the Settings overlay modal** — absorbs it into the Settings zone tab
3. **Introduces collapsible accordion sections** within each zone for progressive disclosure
4. **Cleans up the header bar** to show glanceable status (connected devices, active frequency, brain state)
5. **Makes disconnected features gracefully hidden** — EEG details don't show until EEG connects, fNIRS only appears with Athena
6. **Gives the frequency system its own zone** — currently buried inside EEG settings
7. **Moves ecosystem links and legal info to Settings** — not primary navigation items

What this brief does NOT do:
- Remove any features
- Change any functionality
- Alter the chat interface
- Modify the Neuroscope, EEG Settings, or other overlay tools
- Change the system prompt or model inference logic
- Break the existing JavaScript — this is a CSS/HTML layout restructure, not a logic rewrite

---

## Implementation Notes for Claude Code

- The underlying JavaScript modules (`aetheria-bus.js`, `aetheria-signal.js`, `athena-core.js`, `hrv-analysis.js`, `interval-analysis.js`, `neurodynamics.js`, `polar-h10.js`, `polar-wiring.js`, `prescription-engine.js`, `sensor-base.js`, `spiral-wave.js`) should be **untouched**. All changes are to `index.html` layout/structure and associated CSS.
- The tab system can be implemented with pure CSS + minimal JS (show/hide zone panels based on active tab class). No framework needed.
- Preserve all existing `id` attributes on elements — many are referenced by the JavaScript modules. Restructuring the DOM order is fine; renaming IDs is not.
- The collapsible accordion sections can use `<details>/<summary>` HTML elements for zero-JS collapsibility, with CSS styling to match the existing aesthetic.
- Test all five zones on mobile after restructuring — the hamburger menu behavior needs to work with the new tab layer.
- After restructuring, verify: EEG connect/disconnect flow, Polar H10 connect flow, model loading, voice input/output, file upload, tool creation, frequency playback, Neuroscope launch, and all overlay modals still open/close correctly.
