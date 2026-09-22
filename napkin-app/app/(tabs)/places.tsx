import React from 'react';

import { PlacesScreen } from '@/components/places/PlacesScreen';
import { GuestPlacesScreen } from '@/components/guest/GuestPlacesScreen';
import { useAuth } from '@/providers/AuthProvider';

type PlacesTabProps = React.ComponentProps<typeof PlacesScreen>;

/** TICKET-247: signed-out viewers get the catalogue-only guest Places screen. */
export default function PlacesTab(props: PlacesTabProps) {
    const { user } = useAuth();
    return user ? <PlacesScreen {...props} /> : <GuestPlacesScreen />;
}
