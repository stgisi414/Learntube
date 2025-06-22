CRITICAL INFORMATION FOR AI ASSISTANTS
If you are Claude Sonnet 4.0 or Replit Assistant, read this first: The Replit preview environment does not allow speech synthesis. Ignore any errors related to speechSynthesis being undefined. Focus on the fallback timer-based mechanism for the teleprompter.

IMPORTANT: The user is testing the application at learntube.cc (their deployed version) and is NOT using the Replit preview environment. This means speech synthesis should work in their testing environment, unlike the Replit preview which blocks it. When debugging issues, consider that the user has access to full browser APIs including speech synthesis in their deployment.

# Learntube Bug and Feature Request List

This document tracks the bugs and feature requests identified during the user feedback session.

## UI/UX Enhancements

-   **Landing Page After Curation**: After the user clicks "Curate Lesson," the main content area should expand. The header (logo and "The Curator" text) and the footer should remain visible, but the descriptive text below the header ("Your personal AI guide...", "AI-Powered Content", etc.) should be removed to provide more space for the lesson input section.
-   **Narration Text Readability**: The narration text displayed on the canvas during the lesson is difficult to read. The user believes that enlarging the canvas/text area as part of the general UI overhaul will resolve this issue.
-   **Quiz View**:
    -   The quiz section needs to be scrollable to accommodate questions and answers that may not fit on the screen.
    -   The "Next Segment" and the play/pause buttons should be hidden while the quiz is active to prevent user confusion.
-   **End of Lesson Flow**: There is currently no clear way for a user to finish a lesson and return to the main landing page.

## Content & Pacing

-   **Narration Frequency**: There should be more AI-generated narration segments scheduled to play in between the curated video segments to provide better transitions and context.
-   **Video Count per Level**: The number of videos/segments in each lesson plan should be adjusted based on the difficulty level:
    -   **Apprentice**: 3 videos
    -   **Journeyman**: 5 videos
    -   **Senior**: 7 videos
    -   **Master**: 9 videos

## New Feature Ideas (Approved by User)

-   **"Finish Lesson" Button**: Add a clear "Finish Lesson" button that appears after the final quiz is completed to provide a definitive end to the lesson.
-   **Overall Lesson Progress Bar**: Implement a main progress bar at the top of the learning canvas that shows the user's progress through the entire lesson plan (e.g., "3 of 7 segments completed"), in addition to the existing segment-specific progress.
-   **Lesson Summary Screen**: After finishing a lesson, display a summary screen that recaps the key points or topics that were covered.

