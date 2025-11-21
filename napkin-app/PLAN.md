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

Location (Convenience)

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

Step 1 (Default): Search Foursquare API first.

Role: Autocomplete, Feed Metadata, Location names.

Cost: Low.

Action: When a user selects a place, cache the Name, Address, and Lat/Long into your Supabase Restaurants table immediately.

Step 2 (Fallback): The "Not Found?" Button.

Role: If Foursquare fails, user clicks this to query Google Places API.

Cost: High (use sparingly).

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

Purpose: Acts as the "Proxy" to hide API keys. The App calls the Edge Function -> Edge Function calls Foursquare/Google -> Returns JSON to App.

State Management

Library: TanStack Query (React Query).

Purpose: Handles caching, pull-to-refresh, and optimistic updates. Essential for making the app feel "Native" and snappy.

5. Core MVP Features (The "Walk" Phase)

1. The Logging Engine (The Atom)

Search Restaurant (Foursquare waterfall).

Date Picker.

Star Rating (1-5).

Value Profile: Sliders/Tags for this specific meal.

Photo Upload (Compressed via expo-image-manipulator before upload).

Review Text.

2. The Profile (The Identity)

Top 4: User selects 4 favorite spots (Global or Local).

The Graph: Visual representation of their "Value Profile."

The Diary: Chronological list of past logs.

3. Social (The Hook)

The "Table": When logging, tag other users.

Feed: Chronological feed of friends' logs.

Follow Graph: Standard Follower/Following.

6. Development Roadmap (3-Month Sprint)

Month 1: The Foundation (Data & Logic)

Initialize Expo Router project.

Setup Supabase project (Auth + Tables).

Critical: Build the Supabase Edge Function to query Foursquare.

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

Final Verdict: This plan minimizes your monthly API costs (Foursquare > Google), maximizes your aesthetic control (Mapbox), and leverages the most efficient solo-dev stack (Expo/Supabase). You are building a sustainable business, not just an app.