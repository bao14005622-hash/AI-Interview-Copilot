# Candidate Scoring Rubric Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Implement the approved interview-recommendation scoring rubric in the AI analysis API and frontend result display.

**Architecture:** Add shared scoring types/constants in `lib/candidate-scoring.ts`, use them in `app/api/analyze/route.ts` to constrain the DeepSeek prompt and response validation, then render score breakdown and cap labels in `app/page.tsx`.

**Tech Stack:** Next.js App Router, TypeScript, React, Tailwind CSS, DeepSeek chat completions.

---

### Task 1: Shared Scoring Contract

**Files:**
- Create: `lib/candidate-scoring.ts`
- Modify: `app/api/analyze/route.ts`
- Modify: `app/page.tsx`

- [x] Create a shared `ScoreBreakdown` type with five dimensions: job relevance, evidence strength, transferable capability, resume clarity, and preference match.
- [x] Create scoring constants for the 35/25/15/10/15 rubric.
- [x] Export recommendation range labels for frontend rendering.

### Task 2: API Prompt and Validation

**Files:**
- Modify: `app/api/analyze/route.ts`

- [x] Extend `CandidateAnalysis` with `scoreBreakdown`, `capTriggered`, and `capReason`.
- [x] Update the DeepSeek prompt to require the approved rubric, the 75-point cap rule, and dimension-level scores.
- [x] Normalize and clamp dimension scores to their max values.
- [x] Preserve existing batch parsing and failed-resume behavior.

### Task 3: Frontend Result Display

**Files:**
- Modify: `app/page.tsx`

- [x] Extend frontend candidate result types with scoring breakdown and cap fields.
- [x] Show score breakdown in desktop table and mobile cards.
- [x] Show a visible cap label when `capTriggered` is true.
- [x] Keep existing candidate sorting, failed resume display, JD retention, and preference retention.

### Task 4: Verification

**Files:**
- Verify project commands only.

- [x] Run `npm run lint`.
- [x] Run `npm run build`.
- [x] Review `git diff` to ensure only scoring-related files changed.
