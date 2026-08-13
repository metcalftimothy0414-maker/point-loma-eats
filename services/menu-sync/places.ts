export interface PlaceDetails {
  websiteUrl: string | null;
  formattedAddress: string | null;
  phoneNumber: string | null;
  lat: number | null;
  lng: number | null;
  openingHours: string[] | null;
}

interface PlacesApiResponse {
  websiteUri?: string;
  formattedAddress?: string;
  internationalPhoneNumber?: string;
  location?: { latitude: number; longitude: number };
  regularOpeningHours?: { weekdayDescriptions?: string[] };
}

/**
 * Google Places API (Places API New, Place Details by resource name).
 * Requires GOOGLE_PLACES_API_KEY. This is the one source in the pipeline
 * that's a genuine, documented, self-serve public API — no scraping, no
 * platform-detection guesswork.
 */
export async function lookupPlace(placeId: string): Promise<PlaceDetails> {
  const apiKey = process.env.GOOGLE_PLACES_API_KEY;
  if (!apiKey) throw new Error('GOOGLE_PLACES_API_KEY is not set');

  const res = await fetch(`https://places.googleapis.com/v1/places/${placeId}`, {
    headers: {
      'X-Goog-Api-Key': apiKey,
      'X-Goog-FieldMask': 'websiteUri,formattedAddress,internationalPhoneNumber,location,regularOpeningHours',
    },
  });

  if (!res.ok) {
    throw new Error(`Places API returned ${res.status}: ${await res.text()}`);
  }

  const data = (await res.json()) as PlacesApiResponse;

  return {
    websiteUrl: data.websiteUri ?? null,
    formattedAddress: data.formattedAddress ?? null,
    phoneNumber: data.internationalPhoneNumber ?? null,
    lat: data.location?.latitude ?? null,
    lng: data.location?.longitude ?? null,
    openingHours: data.regularOpeningHours?.weekdayDescriptions ?? null,
  };
}
