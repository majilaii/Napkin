type EditMatchCandidate = {
    area?: string | null;
    restaurant: {
        name: string | null;
        city: string | null;
    };
};

type EditMatchCoords = { latitude: number; longitude: number };

export function initialImportEditMatchQuery(candidate: EditMatchCandidate): string {
    return candidate.restaurant.name?.trim() || candidate.restaurant.city?.trim() || '';
}

export function buildImportEditMatchSearchBody(
    query: string,
    candidate: EditMatchCandidate | null,
    coords: EditMatchCoords | null,
): {
    query: string;
    limit: number;
    city?: string;
    area?: string;
    lat?: number;
    lng?: number;
} {
    const city = candidate?.restaurant.city?.trim();
    const area = candidate?.area?.trim();
    return {
        query: query.trim(),
        limit: 5,
        ...(city ? { city } : {}),
        ...(area ? { area } : {}),
        ...(coords ? { lat: coords.latitude, lng: coords.longitude } : {}),
    };
}
