# Sophia Oracle Shaman — Muse S Athena Integration

## For Claude Code — Drop-In Library Integration

**Goal:** Add Muse S Athena support to Sophia (aetheriasos.com) using the completed `athena-core.js` library, while keeping existing Muse 2 Bluetooth and EEG Service options intact. Add fNIRS data to Sophia's awareness so she can reference hemodynamic signals in her oracle readings.

**Reference files:**
- `athena-core.js` — the completed Athena library (copy this into the Sophia repo)
- `athena-test.html` — the working test harness for reference

---

## Critical Process Rules

**REPORT PROGRESS AT EVERY CHECKPOINT.** Stop and wait for user verification between checkpoints.

**DO NOT MODIFY THE 27-STATE PRESCRIPTION ENGINE OR LOG-PSD NORMALIZATION.** They're validated and working. The Athena feeds the same format the engine already expects.

**DO NOT BREAK EXISTING CONNECTION OPTIONS.** The existing "Connect Muse via Bluetooth" and "Connect via EEG Service" options must continue to work. Athena is ADDED as a new option.

**FNIRS DATA IS PARALLEL, NOT INTEGRATED INTO PRESCRIPTION.** Display it, make Sophia aware of it in her system prompt, but do NOT fold it into position calculations. Future research.

---

## What to Build

### Checkpoint 1: Library Drop-In & Connection Option

**Implement:**
1. Copy `athena-core.js` into the Sophia repo at the same directory level as the main HTML file
2. Add `<script src="athena-core.js"></script>` in the HTML head, before the existing app code
3. Find the existing "Connect EEG Device" modal (the one visible in the screenshot with three options: "Connect Muse via Bluetooth", "Connect via EEG Service", "Use Simulation Mode")
4. Add a FOURTH option to this modal:
   ```
   🌊 Connect Muse S Athena (NEW)
   Full sensor suite: EEG + fNIRS + Heart Rate
   Direct browser connection via Web Bluetooth
   ```
5. Clicking this option opens the `AthenaDevice` connection flow (do NOT implement the connection logic yet — just the button and placeholder)

**Test:**
User confirms:
- Sophia still loads without errors
- All existing options still work
- The new "Connect Muse S Athena" option appears in the modal
- Clicking it shows a placeholder message

**Report and STOP.**

---

### Checkpoint 2: Athena Connection & EEG Pipeline

**Implement:**
1. Replace the Athena placeholder with a real `AthenaDevice` instance
2. Wire these callbacks to Sophia's existing EEG data handlers:
   - `onBandPowers` → feed into Sophia's existing `getAetheriaPosition()` function (the 27-state prescription engine that matches RCT)
   - `onEEG` → update Sophia's existing brainwave display
   - `onStatus` → update connection status in the sidebar
3. Update Sophia's existing "EEG device disconnected" / "EEG device connected" status text based on Athena connection state
4. Update the Aetheria Position sidebar display (positions 1-27, regime, frequency, coherence) using the band powers from the Athena

**Critical:** The Athena's band powers are already log-PSD normalized. Do NOT apply additional normalization. Feed directly into the prescription engine.

**Test:**
User connects the Muse S Athena, puts it on, confirms:
- Status updates correctly in the sidebar
- Sophia's existing brainwave bars update with real values
- Aetheria Position sidebar shows positions 1-27 based on brain state
- Coherence calculation updates

**Report and STOP.**

---

### Checkpoint 3: Sophia's fNIRS Awareness

**Implement:**
1. Add a small fNIRS status panel to Sophia's sidebar, below the existing EEG Brainwaves section:
   ```
   🩸 Hemodynamic Response
   LI: HbO+0.8 HbR-0.3 ●
   RI: HbO+0.7 HbR-0.2 ●
   LO: HbO+0.1 HbR+0.0 ●
   RO: HbO+0.2 HbR-0.1 ●
   ```
   Each optode shows HbO/HbR values and a colored SQI dot (red/yellow/green).
2. This panel is only visible when connected to an Athena
3. Wire the `onFNIRS` callback to update this panel
4. **Make Sophia aware of fNIRS in her system prompt.** Add to her existing system prompt a section like:
   ```
   When the user is wearing a Muse S Athena, you have access to real-time 
   hemodynamic data (fNIRS) from four optode positions on their frontal 
   cortex (LI, RI, LO, RO). Each position reports HbO (oxygenated hemoglobin) 
   and HbR (deoxygenated hemoglobin) in micromolar units, along with a 
   signal quality indicator (SQI).
   
   fNIRS hemodynamic response typically follows neural activity by 2-5 
   seconds and indicates metabolic demand. Elevated HbO with depressed 
   HbR suggests active neural engagement. If you notice strong shifts 
   in the user's hemodynamic data during a reading, you may reference 
   this naturally ("I notice your left frontal cortex lit up when that 
   card appeared") but you do NOT diagnose or make medical claims. 
   Treat fNIRS as another dimension of biofield awareness, not clinical 
   measurement.
   
   Current hemodynamic values will be provided in your context when 
   available.
   ```
5. Include the current fNIRS values in the context sent to the LLM when Sophia generates responses (if Athena is connected and streaming)

**Test:**
User wears the Athena, has a conversation with Sophia while the fNIRS panel updates, confirms:
- The panel shows live values
- Sophia occasionally references hemodynamic observations in her responses when appropriate
- Sophia does NOT make medical claims or diagnose
- The panel only appears with Athena connected

**Report and STOP.**

---

### Checkpoint 4: Heart Rate & PPG Integration

**Implement:**
1. Wire the `onPPG` callback to display the user's heart rate in Sophia's sidebar
2. Add a small heart rate indicator: `❤️ 72 BPM` with SQI color coding
3. Include heart rate in Sophia's LLM context when Athena is connected (she can reference heart rate shifts during readings the same way she references fNIRS)
4. Heart rate displays are only visible when connected to an Athena

**Test:**
User connects Athena, checks pulse matches displayed BPM, confirms Sophia can reference heart rate when relevant.

**Report and STOP.**

---

### Checkpoint 5: Export & Memory Integration

**Implement:**
1. When Sophia exports a session (EEG JSON export), include fNIRS and PPG data if Athena was connected
2. When Sophia stores a memory about a reading, include any notable hemodynamic shifts in the memory text (e.g., "During the Tower reading, user's LI optode showed strong HbO elevation")
3. Add a device type field to Sophia's session metadata

**Test:**
User runs an Athena reading session, exports it, checks that fNIRS data is in the export. Checks Sophia's memory for references to hemodynamic observations.

**Report and STOP.**

---

### Checkpoint 6: Final Polish & Disclaimer Update

**Implement:**
1. Update the existing medical disclaimer modal to briefly mention fNIRS:
   ```
   fNIRS hemodynamic data (Muse S Athena only) is experimental and 
   for personal exploration purposes. It is not a clinical measurement 
   and should not be used for medical decision-making.
   ```
2. Add a small info icon near the Athena connection option explaining what fNIRS is in one sentence
3. Verify Sophia's existing tools (palm reading, I Ching, astrology) still work while Athena is connected

**Test:**
Full end-to-end: connect Athena, do a palm reading, check I Ching, cast a tarot card, export session, verify all existing features work alongside the new Athena data.

**Report complete.**

---

## What NOT to Do

- Do NOT modify the 27-state prescription engine
- Do NOT integrate fNIRS into position calculation (future research)
- Do NOT remove or break existing Muse 2 Bluetooth or EEG Service options
- Do NOT let Sophia make medical claims based on fNIRS data
- Do NOT modify `athena-core.js`
- Do NOT add signal processing code to Sophia — the library handles all DSP
- Do NOT spiral into perfecting Sophia's fNIRS awareness — basic awareness is enough for now

---

## Success Criteria

Integration is complete when:
1. ✅ All four connection options work: Muse Bluetooth, EEG Service, Simulation, Athena
2. ✅ The 27-state prescription engine works with Athena data
3. ✅ fNIRS panel displays when Athena is connected
4. ✅ Heart rate displays when Athena is connected
5. ✅ Sophia can naturally reference hemodynamic observations in readings
6. ✅ Session exports include fNIRS data for Athena sessions
7. ✅ All existing Sophia tools continue to work
8. ✅ The disclaimer has been updated to cover fNIRS
