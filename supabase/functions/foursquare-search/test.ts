import { assertEquals } from "https://deno.land/std@0.224.0/testing/asserts.ts";
import { clamp, firstNumber, parsePayload } from "./index.ts";

// ----------------------------------------------------------------------------
// Test: clamp()
// Purpose: Ensure we don't request too many items or weird radii.
// ----------------------------------------------------------------------------
Deno.test("clamp: should stay within range", () => {
  assertEquals(clamp(10, 1, 20), 10); // Inside range
});

Deno.test("clamp: should respect min", () => {
  assertEquals(clamp(-5, 1, 20), 1); // Too small -> 1
});

Deno.test("clamp: should respect max", () => {
  assertEquals(clamp(100, 1, 20), 20); // Too big -> 20
});

// ----------------------------------------------------------------------------
// Test: firstNumber()
// Purpose: Ensure we handle query params (strings) and JSON body (numbers) safely.
// ----------------------------------------------------------------------------
Deno.test("firstNumber: prefers body value if number", () => {
  assertEquals(firstNumber(42, "100"), 42);
});

Deno.test("firstNumber: falls back to query param if body undefined", () => {
  assertEquals(firstNumber(undefined, "100"), 100);
});

Deno.test("firstNumber: handles invalid query strings gracefully", () => {
  assertEquals(firstNumber(undefined, "not-a-number"), undefined);
});

// ----------------------------------------------------------------------------
// Test: parsePayload()
// Purpose: Ensure we can extract 'query', 'near', and coords from requests.
// ----------------------------------------------------------------------------
Deno.test("parsePayload: extracts from JSON body", async () => {
  const req = new Request("http://localhost", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ query: "Sushi", near: "Tokyo", limit: 50 }),
  });
  
  const payload = await parsePayload(req);
  assertEquals(payload.query, "Sushi");
  assertEquals(payload.near, "Tokyo");
  assertEquals(payload.limit, 50); // Note: parsePayload doesn't clamp, the main logic does
});

Deno.test("parsePayload: extracts from URL params", async () => {
  const req = new Request("http://localhost?query=Pizza&near=Rome&limit=5", {
    method: "GET",
  });
  
  const payload = await parsePayload(req);
  assertEquals(payload.query, "Pizza");
  assertEquals(payload.near, "Rome");
  assertEquals(payload.limit, 5);
});

