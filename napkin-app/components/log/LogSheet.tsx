/**
 * LogSheetRestaurant — the restaurant payload contract for the logger.
 *
 * TICKET-071: the LogSheet bottom-sheet component was retired; the logger is
 * now the full-screen route `app/log-meal.tsx`. Only this type survives here.
 */
export interface LogSheetRestaurant {
    id?: string;           // Napkin DB id (if persisted)
    external_id?: string;  // Google Place ID
    name: string;
    city?: string | null;
    cuisine?: string | null;
    price_level?: string | null;
    placePayload?: any;    // Full payload for ghost restaurants
}
