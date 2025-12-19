Here is the comprehensive Master Blueprint for your project. This document consolidates the product vision, the strategic pivots, and the technical architecture into a single source of truth for your development sprint.

Project Master Plan: "Letterboxd for Dining" (MVP v1.0)
1. Executive Summary

The Concept: A journal-first mobile application for cataloguing dining experiences. Unlike Google Maps (utility/discovery) or Instagram (highlight reels), this platform is designed for the "Logger" archetype—users who want to curate a personal archive of their dining history, reflect on taste, and build identity through food.

The Goal: Launch a polished, aesthetic "Walk" MVP by February 2026 (New Year’s/Valentine’s window).

The Business Model: Freemium.

Free: Core logging, social feed, basic lists.

Pro (Future): Deep analytics (spending/calorie/cuisine stats), infinite lists, exclusive badges. No Ads in V1.

2. The "Secret Sauce": The Value Profile

This is the primary differentiator from Beli and Google Maps. It solves the "Cold Start" problem and powers future recommendation algorithms.

The Concept: Users define their dining identity via a 100% zero-sum allocation across the Big 5 Categories:

Flavor (Quality of food)

Ambience (Vibe/Decor)

Value (Price-to-quality ratio)

Service (Hospitality)

Usage:

Onboarding: User sets their "Ideal Dining Experience" (e.g., 50% Flavor, 30% Value, 20% Ambience).

Logging: Every review includes a "Value Profile" tag for that specific meal.

Result: We stop showing "Trending Restaurants" and start showing "Trending for people who value Ambience like you."

3. Data Strategy & Infrastructure (The "Waterfall" Model)

To balance the high cost of data (Google) with the need for a custom aesthetic.

A. The Visual Layer (Mapbox)

Provider: Mapbox Mobile SDK.

Why: Allows for a completely custom "Dark Mode" map to match the premium aesthetic. Google Maps SDK is too restrictive and ugly for this brand.

B. The Data Layer (Waterfall Logic)

Step 1 (Default): Search Google Places API first.

Role: Autocomplete, Feed Metadata, Location names.

Cost: Low.

Action: When a user selects a place, cache the Name, Address, and Lat/Long into your Supabase Restaurants table immediately.

Step 3 (Enrichment): Google Places Photos.

Role: Only fetch high-res hero images from Google if user opens the "Restaurant Details" view.

4. Technical Architecture (The "Indie Stack")

Frontend (Mobile First)

Framework: React Native with Expo Router.

Styling: NativeWind (Tailwind CSS). Fast iteration, consistent design system.

Web Strategy: Read-Only Marketing/Profile pages for MVP. No complex logging on web yet.

Backend (Serverless)

Platform: Supabase.

Database: PostgreSQL (Relational Data).

Auth: Supabase Auth (Apple Login + Email/Password).

Logic: Supabase Edge Functions (TypeScript).

Purpose: Acts as the "Proxy" to hide API keys. The App calls the Edge Function -> Edge Function calls Google -> Returns JSON to App.

State Management

Library: TanStack Query (React Query).

Purpose: Handles caching, pull-to-refresh, and optimistic updates. Essential for making the app feel "Native" and snappy.

5. Core MVP Features (The "Walk" Phase)

1. The Logging Engine (The Atom)

Search Restaurant (Google default).

Date Picker.

Star Rating (1-5).

Value Profile: Sliders/Tags for this specific meal.

Photo Upload (Compressed via expo-image-manipulator before upload).

Review Text.

2. The Profile (The Identity)

Top 4: User selects 4 favorite spots (Global or Local).

The Graph: Visual representation of their "Value Profile."

The Diary: Chronological list of past logs.

3. Social (The Hook & Growth Engine)

This system differentiates between casual dining (Tagging) and core relationships (The Table).

A. Ad-Hoc Dining: "The Open Seat" (Tagging)

    Logic: Ephemeral tagging for one-off meals.

    The Ghost Tag (Growth Hack): If a user dines with a non-user (e.g., "Dad"), they can tag them as a "Ghost."

        Action: The app generates a web-link receipt: "Review logged. Send Dad his receipt?"

        Conversion: If Dad downloads the app via the link, that "Ghost" tag converts to a real User ID, retroactively populating his diary with this meal immediately.

B. Core Squads: "The Table" (Permanent Entity)

    The Concept: A "Table" is not a group chat; it is a Shared Profile Entity (e.g., "The Sunday Roast Club").

    The Structure: It has its own Avatar, Stats (Aggregate Value Profile), and Map.

    The Utility (Retention):

        Shared Wishlist: Members add spots to the Table’s "To-Eat" list. (Solves the "Where should we eat?" friction).

        Shared Diary: A filtered timeline showing only meals eaten by this specific group.

    The Limits (Business Model):

        Free: Unlimited Tables (V1 - for user growth).

        Pro (Future): Premium Table features (analytics, custom avatars, etc.).

C. The Feed (Aggregated View)

    Logic: Chronological, but "De-Cluttered."

    Bundled Events: If User A and User B belong to the same Table and log the same meal, the Feed displays a single "Table Event Card" (Split-screen photos/ratings) rather than two separate posts.

    The Interaction: Likes/Comments apply to the Event, reinforcing the social proof of the group outing.

D. Wishlist Overlap Detection (The "Perfect Pick" Feature)

    The Problem: "Where should we eat?" is the #1 friction for group dining.

    The Solution: When users share a Table, the app automatically detects overlapping "Want to Try" restaurants.

    The UX:
        - Table Dashboard: Shows a "Mutual Picks" section with restaurants wishlisted by 2+ members.
        - Sort by Overlap: "Everyone wants to try Carbone. Just go already."

    The Psychology: Creates FOMO and urgency. "We've both wanted to try this place forever!"

E. External Sharing → Auto-Wishlist (The Growth Hack)

    The Problem: Users discover restaurants on TikTok, Instagram, and Google Maps but forget to save them.

    The Solution: Share a link TO Napkin → Save to wishlist.

    MVP Scope (User-Assisted Entry):

        Tier 1 — Auto-Parse (When Possible):
            - Google Maps links: Direct Place ID extraction → Auto-add ✅
            - Instagram location tags: Extract if tagged → Auto-add ✅

        Tier 2 — User-Assisted Entry (Default Fallback):
            - TikTok/Reels without location: Show search prompt
            - Compilation videos ("What I ate in December"): User adds each restaurant manually

        The UX Flow:
            1. User shares TikTok/Reel/Maps link to Napkin
            2. App attempts to parse restaurant (Google Maps = auto-success)
            3. If parse fails → Prompt:
               ┌────────────────────────────────┐
               │ 📍 What restaurant is this?    │
               │ [Search for restaurant...]     │
               │                                │
               │ 🔗 Link saved for reference    │
               │ [I'll add it later]            │
               └────────────────────────────────┘
            4. User searches → Adds to wishlist
            5. Optional: "Share to Sunday Roast Club wishlist?"

        Compilation Videos:
            - If multiple restaurants detected in caption OR user indicates
            - Show multi-add interface:
               [+ Add restaurant]
                 • First restaurant added
                 • Second restaurant added
               [+ Add another]
               [Save All to Wishlist]

    Future (Post-MVP):
        - AI thumbnail analysis for restaurant name extraction
        - Video keyframe extraction for compilations
        - Audio transcription parsing

    The Hook: "Napkin is your second brain for restaurants. Share once, never forget."

6. Development Roadmap (3-Month Sprint)

Month 1: The Foundation (Data & Logic)

Initialize Expo Router project.

Setup Supabase project (Auth + Tables).

Critical: Build the Supabase Edge Function to query Google Places.

Build the "Search & Select" UI (unstyled).

Milestone: You can search for a restaurant, click it, and save it to the Postgres database.

Month 2: The Aesthetic (UI & UX)

Install NativeWind.

Design the "Review Card" (The core visual element).

Implement Mapbox for the map view.

Build the "Value Profile" slider interface.

Milestone: The app looks beautiful. You can log a visit and it looks like a premium product.

Month 3: The Polish (Performance & Store)

Implement TanStack Query for caching (loading skeletons, no spinners).

"The Table" logic (tagging friends).

Privacy Policy & Apple Store screenshots.

Launch: Submit to TestFlight/App Store.

7. Critical "Don't Do" List (V1 Scope Creep)

NO Collaborative Lists (Too complex for now).

NO Direct Messaging (Use WhatsApp/iMessage).

NO Dish-level ratings (Keep it to Restaurant-level for V1 to save data headaches).

NO Web Dashboard (Focus 100% on Mobile experience).