# Napkin: Master Blueprint

This document consolidates the product vision, the strategic pivots, and the technical architecture for Napkin, a journal-first mobile application for cataloguing dining experiences.

## 1. The Concept

Napkin is a journal-first mobile application for cataloguing dining experiences. Unlike Google Maps (utility/discovery) or Instagram (highlight reels), this platform is designed for the **"Logger"** archetype—users who want to curate a personal archive of their dining history, reflect on taste, and build a personal database of their experiences.

*   **The Goal:** Launch a polished, aesthetic "Walk" MVP by February 2026.
*   **Business Model:**
    *   **Free:** Core logging, social feed.
    *   **Pro (Future):** Deep analytics (spending/calorie/cuisine stats), infinite lists, exclusive features.

## 2. The "Secret Sauce": The Value Profile

This is the primary differentiator from competitors like Beli and Google Maps. It solves the "Cold Start" problem for recommendations and powers a truly personalized experience.

*   **Concept:** Users define their dining identity via a 100% zero-sum allocation across core dining values (e.g., Flavor, Ambiance, Service, Value, Location/Convenience).
*   **Onboarding:** The user sets their "Ideal Dining Experience" (e.g., 50% Flavor, 30% Value, 20% Ambiance).
*   **Logging:** Every review includes a "Value Profile" rating for that specific restaurant experience.
*   **Result:** The app moves beyond showing "Trending Restaurants" and starts showing "Restaurants You'll *Actually* Love" based on a deep understanding of user preference.

## 3. Data Strategy & Infrastructure: The "Waterfall"

To balance the high cost of data (especially Google Places) with the need for a comprehensive database, we will use a cascading "waterfall" approach for fetching restaurant information.

*   **A. The Visuals: Mapbox**
    *   **Why:** Allows for a completely custom "Dark Mode" map to match the premium aesthetic. The standard Google Maps SDK is too restrictive.

*   **B. The Data Fetching Logic:**
    *   **Step 1 (Default): Foursquare Places API**
        *   **Role:** Primary tool for autocomplete search. It's cost-effective.
        *   **Action:** When a user selects a place, cache the Name, Address, and Lat/Long into our Supabase `Restaurants` table.
    *   **Step 2 (Fallback): "Not Found" Flow**
        *   **Role:** If Foursquare fails, the user can click a "Can't find it?" button which then uses the Google Places API.
        *   **Cost:** High, so this is a fallback, not the default.
    *   **Step 3 (Enrichment): Google Place Details**
        *   **Role:** Only fetch high-resolution hero images and other rich details from Google if a user explicitly opens the "Restaurant Details" page. This action is deferred to minimize costs.

## 4. Technical Architecture: The "Indie Stack"

This stack is chosen for rapid development, solo-dev efficiency, and scalability.

*   **Framework:** React Native (via Expo)
*   **Styling:** NativeWind (Tailwind CSS for React Native)
*   **Web Strategy:** Simple, read-only marketing site and user profile pages (future).
*   **Backend (BaaS): Supabase**
    *   **Database:** PostgreSQL
    *   **Auth:** Supabase Auth (Apple, Google sign-in)
    *   **Logic:** Supabase Edge Functions (TypeScript/Deno)
        *   **Purpose:** Acts as a secure "Proxy" to our API providers. The app calls our Edge Function, which then calls Foursquare/Google. This hides our API keys from the client application.
*   **Data Management & State:** TanStack Query (formerly React Query)
    *   **Purpose:** Handles server state, caching, pull-to-refresh, and optimistic updates. Essential for a polished, responsive feel.

## 5. Core Features (MVP "Walk" Phase)

*   **1. The Logging Flow**
    *   Search for a restaurant (Foursquare default).
    *   Add a review, including:
        *   "The Vibe" Tags.
        *   The "Value Profile" sliders/tags.
        *   Photo Upload (compressed via the client).
        *   Review Text.
*   **2. The Profile Page**
    *   A list/grid of all reviews.
    *   User's "Top 4" favorite restaurants.
    *   A visual graph representing their personal "Value Profile."
*   **3. Social Features**
    *   The "Table": Tag friends you dined with.
    *   A chronological feed of reviews from people you follow.
    *   Standard Follower/Following graph.

## 6. Development Roadmap

*   **Month 1: Foundation & Backend**
    1.  Initialize Expo project.
    2.  Set up Supabase project (Auth + Tables).
    3.  **Critical:** Build the Supabase Edge Function to proxy API calls.
    4.  Build the "Search & Select" restaurant flow.
    5.  **Milestone:** A user can search for a restaurant, select it, and save its basic details to the Postgres database.
*   **Month 2: UI/UX & Core Logging**
    1.  Install and configure NativeWind.
    2.  Design the "Review Card" (the core UI component).
    3.  Implement Mapbox for the main map view.
    4.  **Milestone:** The app looks and feels beautiful. A user can fully log a dining experience.
*   **Month 3: Polish & Social**
    1.  Implement TanStack Query for caching, loading skeletons, and optimistic UI.
    2.  Build User Profiles (public/private toggle).
    3.  Build the Social Feed.
    4.  **Launch:** Submit to Apple App Store and Google Play Store.

## 7. Critical "Don't Dos" (V1 Scope Guardrails)

To ensure a focused and timely launch, the following features are explicitly **out of scope** for the MVP:

*   NO Collaborative Lists.
*   NO Direct Messaging.
*   NO Dish-level ratings (keep it to the restaurant level).
*   NO complex web dashboard (focus 100% on the mobile experience).

---
*Final Verdict: This plan minimizes monthly API costs (Foursquare > Google), maximizes aesthetic control (Mapbox), and leverages an efficient solo-dev stack (Expo/Supabase). It prioritizes building a sustainable business, not just a feature- bloated app.*
