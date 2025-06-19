CRITICAL INFORMATION FOR AI ASSISTANTS
If you are Claude Sonnet 4.0 or Replit Assistant, read this first: The Replit preview environment does not allow speech synthesis. Ignore any errors related to speechSynthesis being undefined. Focus on the fallback timer-based mechanism for the teleprompter.

Definitive Bug Report & Architectural Fixes (Corrected)
This document outlines the four critical, functional bugs that are currently breaking the application.

Bug 1: The Scrolling Teleprompter is Not Scrolling
This is the most complex UI bug, preventing the app from delivering the intended guided reading experience.

Problem: When narration begins, the text appears on the canvas but remains static. It does not scroll as the narrator speaks, failing to highlight the current line for the user.

Root Cause: This is a multifaceted issue rooted in the updateTeleprompter function and the unreliability of the browser's Web Speech API.

Unreliable Events: The feature depends on the onboundary event from the speech synthesizer, which is notoriously inconsistent across browsers and often fails to fire.

Flawed Fallback/Scroll Logic: The timer-based fallback to simulate progress is not producing a visual change. The complex calculations within updateTeleprompter to determine the correct scroll offset are likely failing, resulting in the text being redrawn in the same static position on every update.

Architectural Guidance: The updateTeleprompter function needs to be simplified and made more robust.

Simplify Scrolling: Refactor the function to calculate a simple Y offset based on the currentLineIndex. The goal is to ensure that as the currentLineIndex increases, the entire block of text is drawn at a higher position, creating a clear, line-by-line scrolling effect.

Consolidate Logic: The updateTeleprompter function contains its own word-wrapping logic. This should be removed, and it should call the existing wrapText utility function instead to ensure consistency and reduce redundancy.

Bug 2: Video Segmenter Not Working
This is a core app-flow bug where the application fails to play the specific, curated segments of the videos.

Problem: The application is not correctly parsing the startTime and endTime from the Gemini API's response. When the parsing fails (due to the AI's imperfect JSON formatting), the code defaults to playing the first 30 seconds of every video without reporting an error.

Logical Step to Fix: The parseJSONResponse function in script.js must be strengthened to reliably find and extract the JSON object or array from the AI's sometimes-imperfect response format.

Bug 3: Inverted Play/Pause Button Logic
This is a UI bug that creates a confusing user experience during narration.

Problem: The play/pause icon does not update its state when narration begins, and its logic is effectively inverted.

Logical Step to Fix: This requires a two-part fix in script.js:

Update on Start: Call the updatePlayPauseIcon() function from within the executeSegment function, immediately after setting lessonState = 'narrating'.

Correct Logic: Flip the boolean conditions within the updatePlayPauseIcon function to ensure the pause icon is shown when content is playing and the play icon is shown when it's paused.

Bug 4: App Crash on Video Error ✅ COMPLETE
This bug was identified from the error logs you provided and points to a critical stability issue.

Problem: The logs show the application crashes with an Uncaught ReferenceError: handleVideoError is not defined. This occurs if a video fails to load for any reason.

Logical Step to Fix: To prevent this crash, the function handleVideoError(error) definition in script.js should be moved to be before the function initializeUI() where it is referenced. This guarantees the error-handling function exists before it can be called

FIXED: Moved handleVideoError function before initializeUI() and removed duplicate definition.