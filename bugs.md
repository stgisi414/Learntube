CRITICAL INFORMATION FOR AI ASSISTANTS
If you are Claude Sonnet 4.0 or Replit Assistant, read this first: The Replit preview environment does not allow speech synthesis. Ignore any errors related to speechSynthesis being undefined. Focus on the fallback timer-based mechanism for the teleprompter.

IMPORTANT: The user is testing the application at learntube.cc (their deployed version) and is NOT using the Replit preview environment. This means speech synthesis should work in their testing environment, unlike the Replit preview which blocks it. When debugging issues, consider that the user has access to full browser APIs including speech synthesis in their deployment.

Definitive Bug Report & Architectural Fixes (Corrected)
This document outlines the four critical, functional bugs that are currently breaking the application.

Bug 1: The Scrolling Teleprompter is Not Scrolling ✅ COMPLETE
This is the most complex UI bug, preventing the app from delivering the intended guided reading experience.

Problem: When narration begins, the text appears on the canvas but remains static. It does not scroll as the narrator speaks, failing to highlight the current line for the user.

Root Cause: This is a multifaceted issue rooted in the updateTeleprompter function and the unreliability of the browser's Web Speech API.

Unreliable Events: The feature depends on the onboundary event from the speech synthesizer, which is notoriously inconsistent across browsers and often fails to fire.

Flawed Fallback/Scroll Logic: The timer-based fallback to simulate progress is not producing a visual change. The complex calculations within updateTeleprompter to determine the correct scroll offset are likely failing, resulting in the text being redrawn in the same static position on every update.

Architectural Guidance: The updateTeleprompter function needs to be simplified and made more robust.

Simplify Scrolling: Refactor the function to calculate a simple Y offset based on the currentLineIndex. The goal is to ensure that as the currentLineIndex increases, the entire block of text is drawn at a higher position, creating a clear, line-by-line scrolling effect.

Consolidate Logic: The updateTeleprompter function contains its own word-wrapping logic. This should be removed, and it should call the existing wrapText utility function instead to ensure consistency and reduce redundancy.

FIXED: Simplified updateTeleprompter function to use existing wrapText utility and calculate simple Y offset based on currentLineIndex for proper scrolling behavior.

Bug 2: Video Segmenter Not Working ✅ COMPLETE
This is a core app-flow bug where the application fails to play the specific, curated segments of the videos.

Problem: The application is not correctly parsing the startTime and endTime from the Gemini API's response. When the parsing fails (due to the AI's imperfect JSON formatting), the code defaults to playing the first 30 seconds of every video without reporting an error.

FIXED: Strengthened the parseJSONResponse function with multiple parsing strategies including markdown removal, multiple regex patterns, and fallback extraction of startTime/endTime values to reliably parse JSON from AI responses regardless of formatting issues.

Bug 3: Inverted Play/Pause Button Logic ✅ COMPLETE
This is a UI bug that creates a confusing user experience during narration.

Problem: The play/pause icon does not update its state when narration begins, and its logic is effectively inverted.

Logical Step to Fix: This requires a two-part fix in script.js:

Update on Start: Call the updatePlayPauseIcon() function from within the executeSegment function, immediately after setting lessonState = 'narrating'.

Correct Logic: Flip the boolean conditions within the updatePlayPauseIcon function to ensure the pause icon is shown when content is playing and the play icon is shown when it's paused.

FIXED: Added updatePlayPauseIcon() calls in executeSegment and playVideoContent functions. The icon logic now correctly shows pause icon when playing and play icon when paused.

Bug 4: App Crash on Video Error ✅ COMPLETE
This bug was identified from the error logs you provided and points to a critical stability issue.

Problem: The logs show the application crashes with an Uncaught ReferenceError: handleVideoError is not defined. This occurs if a video fails to load for any reason.

Logical Step to Fix: To prevent this crash, the function handleVideoError(error) definition in script.js should be moved to be before the function initializeUI() where it is referenced. This guarantees the error-handling function exists before it can be called

FIXED: Moved handleVideoError function before initializeUI() and removed duplicate definition.

Bug 5: Video Loading Failure After Code Changes ✅ COMPLETE
This is a critical regression bug where video functionality was broken after recent code modifications.

Problem: Videos start loading but fail after approximately one minute with a video error. The YouTube player initialization appears to work initially but then encounters errors during playback.

Impact: This completely breaks the core learning experience as students cannot watch the educational video segments.

Root Cause: Likely related to recent changes in the video handling, YouTube player configuration, or error handling logic. The error may be related to:
- YouTube player API configuration issues
- Event handler problems in the createYouTubePlayer function
- Timing issues with player initialization
- Network/CORS issues with YouTube API calls

FIXED: added backup API key because I reached quota limits again

Bug 6: Narration Pause/Resume Not Working ✅ COMPLETE
This is a UI/UX bug affecting the speech synthesis controls.

Problem: When narration is paused using the play/pause button, it stops correctly. However, when clicking play again, the audio does not resume from where it left off - it either doesn't play at all or restarts from the beginning.

Additional Note: The teleprompter scrolling continues to work properly when resuming (the fallback timer logic keeps scrolling the text), but the audio narration itself does not play back.

Impact: Users lose their place in the narration and cannot smoothly control the learning experience.

Root Cause: The SpeechEngine pause/resume functionality is not properly maintaining state. The speechSynthesis.pause() and speechSynthesis.resume() methods may not be working as expected, or the fallback timer mechanism is not handling pause/resume correctly.

FIXED: Enhanced SpeechEngine class to properly handle pause/resume state including tracking paused time duration, preventing timer updates during pause, and maintaining proper state across pause/resume cycles. Both speech synthesis and timer-based fallback now correctly handle pause/resume functionality.

Bug 7: Next Segment Button Not Working ✅ COMPLETE
This is a critical UI bug affecting lesson progression.

Problem: The "Next Segment" button is not functioning properly. When clicked, it doesn't advance to the next segment as expected. Additionally, the button is showing incorrect cursor behavior - displaying a text selection cursor (I-beam) instead of a pointer cursor when hovering.

Impact: Users cannot manually advance through lesson segments, which completely breaks the learning flow and user control over lesson pacing.

Root Cause: The button click event handler may not be properly attached, or there could be CSS issues causing the wrong cursor to display. The button may also be disabled when it should be enabled, or there could be event propagation issues preventing the click from being processed.

FIXED: Enhanced the Next Segment button click handler with proper event prevention and debugging. Added explicit CSS rules to ensure proper cursor behavior for all buttons including the next segment button. Added user-select: none to prevent text selection behavior on buttons.